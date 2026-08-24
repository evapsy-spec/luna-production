/**
 * «Перемещения между складами» — рекомендации, что перевезти и куда.
 *
 * Два независимых правила:
 *
 * 1. Пополнение со склада Fotesko. Fotesko — буферный склад, Пхукет и
 *    Панган — торговые точки. Если на точке меньше LOW_STOCK_THRESHOLD, а
 *    на Fotesko есть остаток — предлагаем довезти оттуда.
 *
 * 2. Выравнивание Пхукет ↔ Панган. Смысл в том, чтобы на обеих точках было
 *    примерно одинаковое количество одной модели — это отдельная задача от
 *    пополнения с Fotesko, и её решаем, только когда у той точки, что
 *    богаче, остатка ХВАТАЕТ С ЗАПАСОМ (не ниже порога), иначе получится
 *    «раздеть» одну точку, чтобы одеть другую, а обе и так на исходе.
 *
 * Оба правила независимые и могут сработать одновременно для одной и той
 * же позиции — тогда у человека на выбор два способа закрыть нехватку
 * (привезти с Fotesko или перекинуть с соседней точки). Каждая
 * рекомендация показывается на вкладке склада-ИСТОЧНИКА: там, где стоит
 * товар, оттуда его и физически повезут.
 *
 * Только чтение и только рекомендация — само перемещение человек делает
 * руками в Ainur/на складе, здесь это не фиксируется.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { WATCHED_WAREHOUSES, WAREHOUSE_META, LOW_STOCK_THRESHOLD } from "@/lib/replenish";

const [FOTESKO, PHUKET, PHANGAN] = WATCHED_WAREHOUSES;

export interface TransferRow {
  variantId: string;
  sku: string;
  productId: string;
  productName: string;
  size: string | null;
  color: string | null;
  collectionName: string;
  from: string;
  to: string;
  fromQty: number;
  toQty: number;
  suggestedQty: number;
  reason: "restock" | "balance";
}

export interface TransferResult {
  bySource: Record<string, TransferRow[]>;
  total: number;
  warehouseOrder: string[];
}

export async function getTransferRecommendations(): Promise<TransferResult> {
  const found = await db
    .select({ id: schema.warehouses.id, name: schema.warehouses.name })
    .from(schema.warehouses)
    .where(inArray(schema.warehouses.name, [...WATCHED_WAREHOUSES]));

  const idByName = new Map(found.map((w) => [w.name, w.id]));
  const whIds = found.map((w) => w.id);

  const bySource: Record<string, TransferRow[]> = {
    [FOTESKO]: [],
    [PHUKET]: [],
    [PHANGAN]: [],
  };

  if (whIds.length === 0) {
    return { bySource, total: 0, warehouseOrder: [...WATCHED_WAREHOUSES] };
  }

  const stock = await db
    .select({
      variantId: schema.variantStock.variantId,
      warehouseId: schema.variantStock.warehouseId,
      quantity: schema.variantStock.quantity,
      sku: schema.productVariants.sku,
      size: schema.productVariants.size,
      color: schema.productVariants.color,
      productId: schema.products.id,
      productName: schema.products.name,
      collectionName: schema.collections.name,
    })
    .from(schema.variantStock)
    .innerJoin(
      schema.productVariants,
      eq(schema.variantStock.variantId, schema.productVariants.id),
    )
    .innerJoin(
      schema.products,
      eq(schema.productVariants.productId, schema.products.id),
    )
    .innerJoin(
      schema.collections,
      eq(schema.products.collectionId, schema.collections.id),
    )
    .where(
      and(
        inArray(schema.variantStock.warehouseId, whIds),
        eq(schema.productVariants.isArchived, false),
        eq(schema.products.isArchived, false),
      ),
    );

  const excludedRows = await db
    .select({ variantId: schema.replenishPlan.variantId })
    .from(schema.replenishPlan)
    .where(eq(schema.replenishPlan.excluded, true));
  const excluded = new Set(excludedRows.map((r) => r.variantId));

  interface Bucket {
    sku: string;
    productId: string;
    productName: string;
    size: string | null;
    color: string | null;
    collectionName: string;
    qty: Record<string, number>;
  }
  const byVariant = new Map<string, Bucket>();

  for (const s of stock) {
    if (excluded.has(s.variantId)) continue;
    let b = byVariant.get(s.variantId);
    if (!b) {
      b = {
        sku: s.sku,
        productId: s.productId,
        productName: s.productName,
        size: s.size,
        color: s.color,
        collectionName: s.collectionName,
        qty: { [FOTESKO]: 0, [PHUKET]: 0, [PHANGAN]: 0 },
      };
      byVariant.set(s.variantId, b);
    }
    const whName = found.find((w) => w.id === s.warehouseId)?.name;
    if (whName) b.qty[whName] = Number(s.quantity);
  }

  const thr = LOW_STOCK_THRESHOLD;

  function pushRow(
    variantId: string,
    b: Bucket,
    from: string,
    to: string,
    fromQty: number,
    toQty: number,
    suggestedQty: number,
    reason: "restock" | "balance",
  ) {
    if (suggestedQty <= 0) return;
    bySource[from].push({
      variantId,
      sku: b.sku,
      productId: b.productId,
      productName: b.productName,
      size: b.size,
      color: b.color,
      collectionName: b.collectionName,
      from,
      to,
      fromQty,
      toQty,
      suggestedQty,
      reason,
    });
  }

  for (const [variantId, b] of byVariant) {
    const F = b.qty[FOTESKO];
    const Ph = b.qty[PHUKET];
    const Pn = b.qty[PHANGAN];

    if (Ph < thr) {
      if (F > 0) pushRow(variantId, b, FOTESKO, PHUKET, F, Ph, Math.min(F, thr - Ph), "restock");
      if (Pn >= thr && Pn > Ph) {
        pushRow(variantId, b, PHANGAN, PHUKET, Pn, Ph, Math.floor((Pn - Ph) / 2), "balance");
      }
    }
    if (Pn < thr) {
      if (F > 0) pushRow(variantId, b, FOTESKO, PHANGAN, F, Pn, Math.min(F, thr - Pn), "restock");
      if (Ph >= thr && Ph > Pn) {
        pushRow(variantId, b, PHUKET, PHANGAN, Ph, Pn, Math.floor((Ph - Pn) / 2), "balance");
      }
    }
  }

  let total = 0;
  for (const wh of WATCHED_WAREHOUSES) {
    bySource[wh].sort((a, c) => a.toQty - c.toQty || a.sku.localeCompare(c.sku));
    total += bySource[wh].length;
  }

  return { bySource, total, warehouseOrder: [...WATCHED_WAREHOUSES] };
}

export { WAREHOUSE_META, LOW_STOCK_THRESHOLD };
