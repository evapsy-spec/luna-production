/**
 * «Пора заказывать» — что заканчивается на наших собственных складах.
 *
 * Партнёрские магазины (BBH, Birds of Paradice, MUSE Group) и склад в США
 * сюда НЕ входят: у них своя логика пополнения. Следим только за складами
 * из WATCHED_WAREHOUSES.
 *
 * Порог: меньше трёх штук на складе — повод думать о заказе.
 *
 * Про нули. В базе почти у каждого SKU есть запись с нулём по каждому складу —
 * это «никогда там не лежало», а не «закончилось». Если показывать все нули,
 * в список попадает 905 SKU из 924 и читать его бессмысленно. Поэтому ноль
 * считаем сигналом только тогда, когда позиция на ЭТОМ складе продавалась за
 * последние ZERO_SALES_DAYS дней: значит спрос есть, а товара нет.
 */
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";

/** Склады, за которыми следим. Порядок задаёт порядок колонок. */
export const WATCHED_WAREHOUSES = [
  "Phangan",
  "Phuket",
  "Fotesko Warehouse",
] as const;

/** Короткая подпись и ключ фильтра в адресе страницы */
export const WAREHOUSE_META: Record<string, { short: string; slug: string }> = {
  Phangan: { short: "Панган", slug: "phangan" },
  Phuket: { short: "Пхукет", slug: "phuket" },
  "Fotesko Warehouse": { short: "Fotesko", slug: "fotesko" },
};

/** Меньше этого количества на складе — пора заказывать */
export const LOW_STOCK_THRESHOLD = 3;

/** За сколько дней смотрим продажи, чтобы отличить «закончилось» от «не было» */
export const ZERO_SALES_DAYS = 90;

export interface Cell {
  /** остаток на складе; null — записи по этому складу нет вовсе */
  qty: number | null;
  /** попадает под порог и это осмысленный сигнал */
  alert: boolean;
  /** ноль, но позиция здесь продавалась — самый срочный случай */
  soldOut: boolean;
}

export interface ReplenishRow {
  variantId: string;
  sku: string;
  productId: string;
  productName: string;
  size: string | null;
  color: string | null;
  collectionId: string;
  collectionName: string;
  cells: Cell[];
  /** сколько складов из наблюдаемых дали сигнал */
  alerts: number;
  /** сколько складов распродано в ноль при живом спросе */
  soldOuts: number;
  /** суммарный остаток по наблюдаемым складам */
  totalWatched: number;
  /** осталось дошить в активных заказах, шт */
  onOrder: number;
  /** решение человека */
  plannedFactoryId: string | null;
  excluded: boolean;
}

export interface WarehouseCol {
  id: string;
  name: string;
  short: string;
  slug: string;
}

export interface ReplenishFilters {
  /** по слагу склада: показывать только если остаток ≤ значения */
  maxBySlug?: Record<string, number>;
  collectionId?: string;
  /** id фабрики, "none" — фабрика не выбрана, undefined — не фильтруем */
  factory?: string;
  /** hide (по умолчанию) | only | all */
  excluded?: "hide" | "only" | "all";
  /** поиск по SKU и названию модели */
  q?: string;
  sort?: "urgency" | "sku" | "stock" | "collection";
}

export interface ReplenishResult {
  rows: ReplenishRow[];
  warehouses: WarehouseCol[];
  /** всего позиций с сигналом, без учёта фильтров и без исключённых */
  totalActive: number;
  /** сколько убрано вручную («не повторяем») */
  totalExcluded: number;
  /** сколько из отфильтрованных уже распродано в ноль */
  soldOutCount: number;
  /** сколько из отфильтрованных уже с выбранной фабрикой */
  plannedCount: number;
  collections: { id: string; name: string }[];
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

export async function getReplenish(
  filters: ReplenishFilters = {},
): Promise<ReplenishResult> {
  const found = await db
    .select({ id: schema.warehouses.id, name: schema.warehouses.name })
    .from(schema.warehouses)
    .where(inArray(schema.warehouses.name, [...WATCHED_WAREHOUSES]));

  // порядок колонок — как в WATCHED_WAREHOUSES, а не как вернула база
  const warehouses: WarehouseCol[] = [];
  for (const n of WATCHED_WAREHOUSES) {
    const w = found.find((f) => f.name === n);
    if (!w) continue;
    const meta = WAREHOUSE_META[n] ?? { short: n, slug: n.toLowerCase() };
    warehouses.push({ id: w.id, name: n, short: meta.short, slug: meta.slug });
  }

  if (warehouses.length === 0) {
    return {
      rows: [],
      warehouses: [],
      totalActive: 0,
      totalExcluded: 0,
      soldOutCount: 0,
      plannedCount: 0,
      collections: [],
    };
  }

  const whIds = warehouses.map((w) => w.id);

  // ---------- остатки ----------
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
      collectionId: schema.collections.id,
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

  // ---------- продажи за окно: variantId|warehouseId ----------
  const soldRows = await db
    .select({
      variantId: schema.variantSalesDaily.variantId,
      warehouseId: schema.variantSalesDaily.warehouseId,
      units: sql<number>`COALESCE(SUM(${schema.variantSalesDaily.units}), 0)`,
    })
    .from(schema.variantSalesDaily)
    .where(gte(schema.variantSalesDaily.day, daysAgo(ZERO_SALES_DAYS)))
    .groupBy(
      schema.variantSalesDaily.variantId,
      schema.variantSalesDaily.warehouseId,
    );

  const sold = new Set<string>();
  for (const r of soldRows) {
    if (Number(r.units) > 0 && r.warehouseId) {
      sold.add(`${r.variantId}|${r.warehouseId}`);
    }
  }

  // ---------- сколько ещё дошьют по активным заказам ----------
  const orderRows = await db
    .select({
      variantId: schema.productionOrderLines.variantId,
      quantity: schema.productionOrderLines.quantity,
      produced: schema.productionOrderLines.qtyProduced,
    })
    .from(schema.productionOrderLines)
    .innerJoin(
      schema.productionOrders,
      eq(schema.productionOrderLines.orderId, schema.productionOrders.id),
    )
    .where(inArray(schema.productionOrders.status, ["SAMPLE", "IN_PRODUCTION"]));

  const onOrder = new Map<string, number>();
  for (const r of orderRows) {
    if (!r.variantId) continue;
    const left = Math.max(0, Number(r.quantity) - Number(r.produced));
    if (left > 0) {
      onOrder.set(r.variantId, (onOrder.get(r.variantId) ?? 0) + left);
    }
  }

  // ---------- решения человека ----------
  const plans = await db
    .select({
      variantId: schema.replenishPlan.variantId,
      factoryId: schema.replenishPlan.factoryId,
      excluded: schema.replenishPlan.excluded,
    })
    .from(schema.replenishPlan);

  const planByVariant = new Map(plans.map((p) => [p.variantId, p]));

  // ---------- собираем строки ----------
  const byVariant = new Map<string, ReplenishRow>();

  for (const s of stock) {
    let row = byVariant.get(s.variantId);
    if (!row) {
      const plan = planByVariant.get(s.variantId);
      row = {
        variantId: s.variantId,
        sku: s.sku,
        productId: s.productId,
        productName: s.productName,
        size: s.size,
        color: s.color,
        collectionId: s.collectionId,
        collectionName: s.collectionName,
        cells: warehouses.map(() => ({
          qty: null,
          alert: false,
          soldOut: false,
        })),
        alerts: 0,
        soldOuts: 0,
        totalWatched: 0,
        onOrder: onOrder.get(s.variantId) ?? 0,
        plannedFactoryId: plan?.factoryId ?? null,
        excluded: Boolean(plan?.excluded),
      };
      byVariant.set(s.variantId, row);
    }

    const idx = whIds.indexOf(s.warehouseId);
    if (idx < 0) continue;

    const qty = Number(s.quantity);
    const soldHere = sold.has(`${s.variantId}|${s.warehouseId}`);
    const alert = qty < LOW_STOCK_THRESHOLD && (qty > 0 || soldHere);

    row.cells[idx] = { qty, alert, soldOut: qty === 0 && soldHere };
    row.totalWatched += qty;
  }

  const all: ReplenishRow[] = [];
  for (const row of byVariant.values()) {
    row.alerts = row.cells.filter((c) => c.alert).length;
    row.soldOuts = row.cells.filter((c) => c.soldOut).length;
    if (row.alerts > 0) all.push(row);
  }

  const totalExcluded = all.filter((r) => r.excluded).length;
  const totalActive = all.length - totalExcluded;

  // ---------- фильтры ----------
  const mode = filters.excluded ?? "hide";
  let rows = all.filter((r) =>
    mode === "only" ? r.excluded : mode === "all" ? true : !r.excluded,
  );

  if (filters.maxBySlug) {
    for (const [slug, max] of Object.entries(filters.maxBySlug)) {
      const idx = warehouses.findIndex((w) => w.slug === slug);
      if (idx < 0) continue;
      rows = rows.filter((r) => {
        const q = r.cells[idx]?.qty;
        return q !== null && q !== undefined && q <= max;
      });
    }
  }

  if (filters.collectionId) {
    rows = rows.filter((r) => r.collectionId === filters.collectionId);
  }

  if (filters.factory === "none") {
    rows = rows.filter((r) => !r.plannedFactoryId);
  } else if (filters.factory) {
    rows = rows.filter((r) => r.plannedFactoryId === filters.factory);
  }

  if (filters.q) {
    const needle = filters.q.trim().toLowerCase();
    if (needle) {
      rows = rows.filter(
        (r) =>
          r.sku.toLowerCase().includes(needle) ||
          r.productName.toLowerCase().includes(needle) ||
          r.collectionName.toLowerCase().includes(needle),
      );
    }
  }

  // ---------- сортировка ----------
  const sort = filters.sort ?? "urgency";
  rows.sort((a, b) => {
    if (sort === "sku") return a.sku.localeCompare(b.sku);
    if (sort === "stock") return a.totalWatched - b.totalWatched;
    if (sort === "collection") {
      const c = a.collectionName.localeCompare(b.collectionName);
      return c !== 0 ? c : a.sku.localeCompare(b.sku);
    }
    if (b.soldOuts !== a.soldOuts) return b.soldOuts - a.soldOuts;
    if (b.alerts !== a.alerts) return b.alerts - a.alerts;
    if (a.totalWatched !== b.totalWatched) return a.totalWatched - b.totalWatched;
    return a.sku.localeCompare(b.sku);
  });

  // коллекции для выпадающего списка — только те, что реально есть в списке
  const collMap = new Map<string, string>();
  for (const r of all) collMap.set(r.collectionId, r.collectionName);
  const collections = [...collMap.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    rows,
    warehouses,
    totalActive,
    totalExcluded,
    soldOutCount: rows.filter((r) => r.soldOuts > 0).length,
    plannedCount: rows.filter((r) => r.plannedFactoryId).length,
    collections,
  };
}
