/**
 * Общие части раздела «Коллекции»: агрегаты остатков и продаж, чипы складов,
 * таблица изделий. Один источник расчёта для списка коллекций, карточки
 * коллекции и карточки изделия — иначе цифры в трёх местах расходятся.
 */
import Link from "next/link";
import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { Money, StatusPill, Table, Td, Th } from "@/components/ui";

// ============================================================
// Разбор значений из форм
// ============================================================

/** Число из формы: люди пишут и «12,5», и «12.5» */
export function parseNumber(value: FormDataEntryValue | null): number | null {
  if (value == null) return null;
  const text = String(value).trim().replace(",", ".");
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** Пустая строка из формы должна лечь в базу как NULL, а не как "" */
export function parseText(value: FormDataEntryValue | null): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

// ============================================================
// Агрегаты
// ============================================================

export interface WarehouseQty {
  warehouseId: string;
  warehouseName: string;
  qty: number;
}

export interface ProductAgg {
  id: string;
  name: string;
  baseSku: string | null;
  photoUrl: string | null;
  collectionId: string;
  collectionName: string;
  skuCount: number;
  stockQty: number;
  byWarehouse: WarehouseQty[];
  unitsSold: number;
  revenue: number;
  /** состав по ткани задан — без него не посчитать расход и бюджет */
  hasBom: boolean;
  hasPatterns: boolean;
}

export interface CollectionAgg {
  id: string;
  name: string;
  description: string | null;
  photoUrl: string | null;
  ainurCategoryId: string | null;
  createdAt: string;
  productCount: number;
  skuCount: number;
  stockQty: number;
  byWarehouse: WarehouseQty[];
  unitsSold: number;
  revenue: number;
  factories: { id: string; name: string }[];
  products: ProductAgg[];
}

/** Начало окна продаж в формате YYYY-MM-DD — поле day хранится так же */
export function salesWindowStart(days: number): string {
  return new Date(Date.now() - days * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
}

/**
 * Собирает коллекции с изделиями, остатками по складам и продажами за окно.
 * Агрегация делается в JS: объёмы каталога небольшие, зато не приходится
 * гонять пять GROUP BY подряд и склеивать их в SQL.
 */
export async function loadCatalog(options?: {
  collectionId?: string;
  days?: number;
}): Promise<CollectionAgg[]> {
  const days = options?.days ?? 90;
  const since = salesWindowStart(days);

  const collectionRows = await (options?.collectionId
    ? db
        .select()
        .from(schema.collections)
        .where(eq(schema.collections.id, options.collectionId))
    : db
        .select()
        .from(schema.collections)
        .where(eq(schema.collections.isArchived, false))
        .orderBy(asc(schema.collections.name)));

  if (collectionRows.length === 0) return [];
  const collectionIds = collectionRows.map((c) => c.id);

  const [productRows, variantRows, stockRows, salesRows, bomFabricRows, patternRows, factoryRows] =
    await Promise.all([
      db
        .select({
          id: schema.products.id,
          name: schema.products.name,
          baseSku: schema.products.baseSku,
          photoUrl: schema.products.photoUrl,
          collectionId: schema.products.collectionId,
        })
        .from(schema.products)
        .where(
          and(
            eq(schema.products.isArchived, false),
            inArray(schema.products.collectionId, collectionIds),
          ),
        )
        .orderBy(asc(schema.products.name)),

      db
        .select({
          id: schema.productVariants.id,
          productId: schema.productVariants.productId,
        })
        .from(schema.productVariants)
        .where(eq(schema.productVariants.isArchived, false)),

      db
        .select({
          variantId: schema.variantStock.variantId,
          warehouseId: schema.warehouses.id,
          warehouseName: schema.warehouses.name,
          quantity: schema.variantStock.quantity,
        })
        .from(schema.variantStock)
        .innerJoin(
          schema.warehouses,
          eq(schema.variantStock.warehouseId, schema.warehouses.id),
        ),

      db
        .select({
          variantId: schema.variantSalesDaily.variantId,
          units: sql<number>`COALESCE(SUM(${schema.variantSalesDaily.units}), 0)`,
          revenue: sql<number>`COALESCE(SUM(${schema.variantSalesDaily.revenue}), 0)`,
        })
        .from(schema.variantSalesDaily)
        .where(gte(schema.variantSalesDaily.day, since))
        .groupBy(schema.variantSalesDaily.variantId),

      db
        .select({ productId: schema.bomFabricLines.productId })
        .from(schema.bomFabricLines),

      db
        .select({ productId: schema.patternFiles.productId })
        .from(schema.patternFiles),

      db
        .select({
          collectionId: schema.factoryCollections.collectionId,
          factoryId: schema.factories.id,
          factoryName: schema.factories.name,
        })
        .from(schema.factoryCollections)
        .innerJoin(
          schema.factories,
          eq(schema.factoryCollections.factoryId, schema.factories.id),
        )
        .orderBy(asc(schema.factories.name)),
    ]);

  const productById = new Map(productRows.map((p) => [p.id, p]));
  const variantToProduct = new Map(
    variantRows
      .filter((v) => productById.has(v.productId))
      .map((v) => [v.id, v.productId]),
  );

  const withBom = new Set(bomFabricRows.map((r) => r.productId));
  const withPatterns = new Set(patternRows.map((r) => r.productId));

  const skuCount = new Map<string, number>();
  for (const v of variantRows) {
    if (!variantToProduct.has(v.id)) continue;
    skuCount.set(v.productId, (skuCount.get(v.productId) ?? 0) + 1);
  }

  // остатки: продукт → склад → штук
  const stockByProduct = new Map<string, Map<string, WarehouseQty>>();
  for (const s of stockRows) {
    const productId = variantToProduct.get(s.variantId);
    if (!productId) continue;
    const perWarehouse =
      stockByProduct.get(productId) ?? new Map<string, WarehouseQty>();
    const current = perWarehouse.get(s.warehouseId) ?? {
      warehouseId: s.warehouseId,
      warehouseName: s.warehouseName,
      qty: 0,
    };
    current.qty += s.quantity;
    perWarehouse.set(s.warehouseId, current);
    stockByProduct.set(productId, perWarehouse);
  }

  const salesByProduct = new Map<string, { units: number; revenue: number }>();
  for (const s of salesRows) {
    const productId = variantToProduct.get(s.variantId);
    if (!productId) continue;
    const current = salesByProduct.get(productId) ?? { units: 0, revenue: 0 };
    current.units += Number(s.units);
    current.revenue += Number(s.revenue);
    salesByProduct.set(productId, current);
  }

  const factoriesByCollection = new Map<string, { id: string; name: string }[]>();
  for (const f of factoryRows) {
    const list = factoriesByCollection.get(f.collectionId) ?? [];
    if (!list.some((x) => x.id === f.factoryId)) {
      list.push({ id: f.factoryId, name: f.factoryName });
    }
    factoriesByCollection.set(f.collectionId, list);
  }

  const collectionName = new Map(collectionRows.map((c) => [c.id, c.name]));

  const products: ProductAgg[] = productRows.map((p) => {
    const warehouses = [...(stockByProduct.get(p.id)?.values() ?? [])]
      .filter((w) => w.qty !== 0)
      .sort((a, b) => b.qty - a.qty || a.warehouseName.localeCompare(b.warehouseName, "ru"));
    const sales = salesByProduct.get(p.id) ?? { units: 0, revenue: 0 };
    return {
      id: p.id,
      name: p.name,
      baseSku: p.baseSku,
      photoUrl: p.photoUrl,
      collectionId: p.collectionId,
      collectionName: collectionName.get(p.collectionId) ?? "",
      skuCount: skuCount.get(p.id) ?? 0,
      stockQty: warehouses.reduce((s, w) => s + w.qty, 0),
      byWarehouse: warehouses,
      unitsSold: sales.units,
      revenue: sales.revenue,
      hasBom: withBom.has(p.id),
      hasPatterns: withPatterns.has(p.id),
    };
  });

  return collectionRows.map((c) => {
    const own = products
      .filter((p) => p.collectionId === c.id)
      .sort((a, b) => b.unitsSold - a.unitsSold || a.name.localeCompare(b.name, "ru"));

    const perWarehouse = new Map<string, WarehouseQty>();
    for (const p of own) {
      for (const w of p.byWarehouse) {
        const current = perWarehouse.get(w.warehouseId) ?? {
          warehouseId: w.warehouseId,
          warehouseName: w.warehouseName,
          qty: 0,
        };
        current.qty += w.qty;
        perWarehouse.set(w.warehouseId, current);
      }
    }

    return {
      id: c.id,
      name: c.name,
      description: c.description,
      photoUrl: c.photoUrl,
      ainurCategoryId: c.ainurCategoryId,
      createdAt: c.createdAt,
      productCount: own.length,
      skuCount: own.reduce((s, p) => s + p.skuCount, 0),
      stockQty: own.reduce((s, p) => s + p.stockQty, 0),
      byWarehouse: [...perWarehouse.values()].sort(
        (a, b) => b.qty - a.qty || a.warehouseName.localeCompare(b.warehouseName, "ru"),
      ),
      unitsSold: own.reduce((s, p) => s + p.unitsSold, 0),
      revenue: own.reduce((s, p) => s + p.revenue, 0),
      factories: factoriesByCollection.get(c.id) ?? [],
      products: own,
    };
  });
}

// ============================================================
// Части интерфейса
// ============================================================

/** Разбивка остатка по складам — маленькие чипы «склад: N шт» */
export function StockChips({
  rows,
  empty = "нет на складах",
}: {
  rows: WarehouseQty[];
  empty?: string;
}) {
  if (rows.length === 0) {
    return <span className="text-xs text-[var(--color-faint)]">{empty}</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {rows.map((r) => (
        <span
          key={r.warehouseId}
          className="tnum whitespace-nowrap rounded-full bg-[var(--color-sand-warm)] px-2 py-0.5 text-[11px] text-[var(--color-muted)]"
        >
          {r.warehouseName}: {r.qty} шт
        </span>
      ))}
    </div>
  );
}

export function BomPill({ hasBom }: { hasBom: boolean }) {
  return hasBom ? (
    <StatusPill tone="ok">состав задан</StatusPill>
  ) : (
    <StatusPill tone="warn">нет состава</StatusPill>
  );
}

export function PatternPill({ hasPatterns }: { hasPatterns: boolean }) {
  return hasPatterns ? (
    <StatusPill tone="ok">лекала есть</StatusPill>
  ) : (
    <StatusPill tone="neutral">нет лекал</StatusPill>
  );
}

/** Таблица изделий коллекции — одинаковая в списке и в карточке коллекции */
export function ProductsTable({
  products,
  money,
}: {
  products: ProductAgg[];
  money: boolean;
}) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>Изделие</Th>
          <Th align="right">SKU</Th>
          <Th align="right">Остаток</Th>
          <Th align="right">Продано 90 дн</Th>
          <Th>Состав</Th>
          <Th>Лекала</Th>
        </tr>
      </thead>
      <tbody>
        {products.map((p) => (
          <tr key={p.id}>
            <Td>
              <Link href={`/products/${p.id}`}>{p.name}</Link>
              {p.baseSku ? (
                <div className="text-xs text-[var(--color-muted)]">{p.baseSku}</div>
              ) : null}
            </Td>
            <Td align="right">{p.skuCount}</Td>
            <Td align="right">
              <div className="tnum">{p.stockQty} шт</div>
              <div className="mt-1 flex justify-end">
                <StockChips rows={p.byWarehouse} empty="—" />
              </div>
            </Td>
            <Td align="right">
              <div className="tnum">{p.unitsSold} шт</div>
              <div className="mt-0.5 text-xs">
                <Money value={p.revenue} hidden={!money} />
              </div>
            </Td>
            <Td>
              <BomPill hasBom={p.hasBom} />
            </Td>
            <Td>
              <PatternPill hasPatterns={p.hasPatterns} />
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
