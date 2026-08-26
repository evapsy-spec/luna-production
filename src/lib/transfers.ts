/**
 * «Перемещения между складами» — рекомендации, что перевезти и куда.
 *
 * Два независимых правила:
 *
 * 1. Пополнение со склада Fotesko. Fotesko — буферный склад, Пхукет и
 *    Панган — торговые точки. Если на точке меньше LOW_STOCK_THRESHOLD, а
 *    на Fotesko есть остаток — предлагаем довезти оттуда. Если НЕ хватает
 *    сразу обеим точкам — это одна поездка с Fotesko, а не два независимых
 *    предложения: остаток на Fotesko один, и если бы мы предлагали
 *    отправить его целиком «на Пхукет» и отдельно ещё раз целиком «на
 *    Панган», получилось бы, что рекомендуем увезти больше, чем реально
 *    есть на складе. Поэтому такие случаи — одна строка с раскладкой по
 *    точкам (кому сколько), и весь остаток Fotesko делится между ними, не
 *    задваивается. Приоритет — той точке, где сейчас меньше.
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
 *
 * Порядок и фильтры. По умолчанию наверху — модели, которые реально
 * продавались за последние 12 месяцев (активные), внизу — то, что не
 * продавалось вовсе (возможно, мёртвый остаток). Плюс два необязательных
 * фильтра: минимум продаж за 12 мес и минимум штук в самой рекомендации —
 * чтобы не тратить рейс ради одной футболки, которую никто не берёт.
 */
import { and, eq, gte, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { WATCHED_WAREHOUSES, WAREHOUSE_META, LOW_STOCK_THRESHOLD } from "@/lib/replenish";

const [FOTESKO, PHUKET, PHANGAN] = WATCHED_WAREHOUSES;

/** Одна точка назначения внутри строки — сколько там сейчас и сколько везём именно туда */
export interface TransferSplit {
  to: string;
  toQty: number;
  suggestedQty: number;
}

export interface TransferRow {
  variantId: string;
  sku: string;
  productId: string;
  productName: string;
  size: string | null;
  color: string | null;
  collectionName: string;
  from: string;
  fromQty: number;
  reason: "restock" | "balance";
  soldLast12m: number;
  /**
   * Обычно одна точка назначения. Для пополнения с Fotesko, когда не
   * хватает и Пхукету, и Пангану одновременно, — обе, с раскладкой
   * остатка Fotesko между ними.
   */
  splits: TransferSplit[];
  /** сумма suggestedQty по всем splits — сколько всего везти этой строкой */
  totalQty: number;
}

export interface TransferFilters {
  /** показывать только строки, где продано за 12 мес не меньше этого */
  minSold12m?: number;
  /** показывать только строки, где предлагаемое количество (totalQty) не меньше этого */
  minSuggestedQty?: number;
}

export interface TransferResult {
  bySource: Record<string, TransferRow[]>;
  total: number;
  warehouseOrder: string[];
}

export async function getTransferRecommendations(
  filters: TransferFilters = {},
): Promise<TransferResult> {
  const found = await db
    .select({ id: schema.warehouses.id, name: schema.warehouses.name })
    .from(schema.warehouses)
    .where(inArray(schema.warehouses.name, [...WATCHED_WAREHOUSES]));

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

  const variantIds = [...new Set(stock.map((s) => s.variantId))];
  const since = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const salesRows = variantIds.length
    ? await db
        .select({
          variantId: schema.variantSalesDaily.variantId,
          units: schema.variantSalesDaily.units,
        })
        .from(schema.variantSalesDaily)
        .where(
          and(
            inArray(schema.variantSalesDaily.variantId, variantIds),
            gte(schema.variantSalesDaily.day, since),
          ),
        )
    : [];
  const soldLast12mByVariant = new Map<string, number>();
  for (const r of salesRows) {
    soldLast12mByVariant.set(
      r.variantId,
      (soldLast12mByVariant.get(r.variantId) ?? 0) + Number(r.units),
    );
  }

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
    fromQty: number,
    splits: TransferSplit[],
    reason: "restock" | "balance",
  ) {
    const totalQty = splits.reduce((sum, s) => sum + s.suggestedQty, 0);
    if (totalQty <= 0) return;
    const soldLast12m = soldLast12mByVariant.get(variantId) ?? 0;
    if (filters.minSold12m !== undefined && soldLast12m < filters.minSold12m) return;
    if (filters.minSuggestedQty !== undefined && totalQty < filters.minSuggestedQty) return;
    bySource[from].push({
      variantId,
      sku: b.sku,
      productId: b.productId,
      productName: b.productName,
      size: b.size,
      color: b.color,
      collectionName: b.collectionName,
      from,
      fromQty,
      reason,
      soldLast12m,
      splits,
      totalQty,
    });
  }

  for (const [variantId, b] of byVariant) {
    const F = b.qty[FOTESKO];
    const Ph = b.qty[PHUKET];
    const Pn = b.qty[PHANGAN];

    // --- 1) Пополнение с Fotesko: одна строка на обе точки сразу ---
    const needPh = Ph < thr ? thr - Ph : 0;
    const needPn = Pn < thr ? thr - Pn : 0;
    if (F > 0 && (needPh > 0 || needPn > 0)) {
      // Кому не хватает больше — того обслуживаем первым, если остатка
      // Fotesko не хватает на обоих сразу.
      const order: Array<[string, number, number]> =
        Ph <= Pn
          ? [
              [PHUKET, needPh, Ph],
              [PHANGAN, needPn, Pn],
            ]
          : [
              [PHANGAN, needPn, Pn],
              [PHUKET, needPh, Ph],
            ];
      let remaining = F;
      const splits: TransferSplit[] = [];
      for (const [name, need, curQty] of order) {
        if (need <= 0 || remaining <= 0) continue;
        const send = Math.min(need, remaining);
        if (send > 0) {
          splits.push({ to: name, toQty: curQty, suggestedQty: send });
          remaining -= send;
        }
      }
      pushRow(variantId, b, FOTESKO, F, splits, "restock");
    }

    // --- 2) Выравнивание Пхукет ↔ Панган (не зависит от Fotesko) ---
    if (Ph < thr && Pn >= thr && Pn > Ph) {
      pushRow(
        variantId,
        b,
        PHANGAN,
        Pn,
        [{ to: PHUKET, toQty: Ph, suggestedQty: Math.floor((Pn - Ph) / 2) }],
        "balance",
      );
    }
    if (Pn < thr && Ph >= thr && Ph > Pn) {
      pushRow(
        variantId,
        b,
        PHUKET,
        Ph,
        [{ to: PHANGAN, toQty: Pn, suggestedQty: Math.floor((Ph - Pn) / 2) }],
        "balance",
      );
    }
  }

  let total = 0;
  for (const wh of WATCHED_WAREHOUSES) {
    // Наверху — модели с реальным движением за 12 мес (больше продано —
    // выше), внизу — то, что не продавалось вовсе. Внутри одной активности
    // сортируем как раньше: сначала где «там» пусто (по самой нуждающейся
    // из точек в строке).
    bySource[wh].sort((a, c) => {
      const minToA = Math.min(...a.splits.map((s) => s.toQty));
      const minToC = Math.min(...c.splits.map((s) => s.toQty));
      return c.soldLast12m - a.soldLast12m || minToA - minToC || a.sku.localeCompare(c.sku);
    });
    total += bySource[wh].length;
  }

  return { bySource, total, warehouseOrder: [...WATCHED_WAREHOUSES] };
}

export { WAREHOUSE_META, LOW_STOCK_THRESHOLD };
