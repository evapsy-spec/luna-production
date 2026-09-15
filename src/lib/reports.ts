/**
 * Отчёты для внешних потребителей — MCP-коннектора и телеграм-бота.
 *
 * Здесь только чтение. Функции возвращают простые объекты, готовые к отдаче
 * наружу: без объектов Drizzle, без null там, где ожидается число, и с уже
 * посчитанной маржой — чтобы потребитель не считал её сам и не считал по-разному.
 *
 * Правило про деньги: если вызывающая сторона не имеет права видеть суммы,
 * она передаёт showMoney: false, и денежные поля не попадают в ответ вообще
 * (не нули, не «скрыто» — их просто нет).
 */
import { and, asc, desc, eq, gte, inArray, like, lte, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";

const MAX_ROWS = 200;

function monthOf(day: string): string {
  return day.slice(0, 7);
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

// ============================================================
// Продажи по месяцам
// ============================================================

export interface SalesByMonthInput {
  /** SKU целиком или его часть; можно несколько через запятую */
  sku?: string;
  /** название коллекции целиком или часть */
  collection?: string;
  /** YYYY-MM-DD, по умолчанию — 24 месяца назад */
  from?: string;
  /** YYYY-MM-DD, по умолчанию — сегодня */
  to?: string;
  showMoney?: boolean;
}

export interface SalesMonthRow {
  month: string;
  units: number;
  revenue?: number;
}

export async function salesByMonth(input: SalesByMonthInput) {
  const showMoney = input.showMoney !== false;
  const to = input.to ?? new Date().toISOString().slice(0, 10);
  const from =
    input.from ??
    new Date(Date.now() - 730 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  const conds = [
    gte(schema.variantSalesDaily.day, from),
    lte(schema.variantSalesDaily.day, to),
  ];

  const skuList = (input.sku ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (skuList.length) {
    const skuConds = skuList.map((s) =>
      like(schema.productVariants.sku, `%${s}%`),
    );
    conds.push(skuConds.length === 1 ? skuConds[0] : or(...skuConds)!);
  }
  if (input.collection) {
    conds.push(like(schema.collections.name, `%${input.collection}%`));
  }

  const rows = await db
    .select({
      day: schema.variantSalesDaily.day,
      units: schema.variantSalesDaily.units,
      revenue: schema.variantSalesDaily.revenue,
      sku: schema.productVariants.sku,
      product: schema.products.name,
      collection: schema.collections.name,
    })
    .from(schema.variantSalesDaily)
    .innerJoin(
      schema.productVariants,
      eq(schema.variantSalesDaily.variantId, schema.productVariants.id),
    )
    .innerJoin(
      schema.products,
      eq(schema.productVariants.productId, schema.products.id),
    )
    .innerJoin(
      schema.collections,
      eq(schema.products.collectionId, schema.collections.id),
    )
    .where(and(...conds));

  const byMonth = new Map<string, { units: number; revenue: number }>();
  const skus = new Set<string>();
  let units = 0;
  let revenue = 0;

  for (const r of rows) {
    const m = monthOf(r.day);
    const e = byMonth.get(m) ?? { units: 0, revenue: 0 };
    e.units += Number(r.units);
    e.revenue += Number(r.revenue);
    byMonth.set(m, e);
    skus.add(r.sku);
    units += Number(r.units);
    revenue += Number(r.revenue);
  }

  const months: SalesMonthRow[] = [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, e]) => ({
      month,
      units: e.units,
      ...(showMoney ? { revenue: round(e.revenue) } : {}),
    }));

  // разбивка по годам — чтобы сразу видеть сезонность и сравнение год к году
  const byYear = new Map<string, { units: number; revenue: number }>();
  for (const m of months) {
    const y = m.month.slice(0, 4);
    const e = byYear.get(y) ?? { units: 0, revenue: 0 };
    e.units += m.units;
    e.revenue += m.revenue ?? 0;
    byYear.set(y, e);
  }

  return {
    period: { from, to },
    matchedSkus: skus.size,
    totals: { units, ...(showMoney ? { revenueThb: round(revenue) } : {}) },
    byYear: [...byYear.entries()].map(([year, e]) => ({
      year,
      units: e.units,
      ...(showMoney ? { revenueThb: round(e.revenue) } : {}),
    })),
    months,
    note:
      skus.size === 0
        ? "Ничего не найдено. Проверь SKU или название коллекции — поиск идёт по части строки."
        : undefined,
  };
}

// ============================================================
// Карточка изделия
// ============================================================

export interface ProductCardInput {
  /** SKU целиком или часть, либо часть названия модели */
  query: string;
  showMoney?: boolean;
}

export async function productCard(input: ProductCardInput) {
  const showMoney = input.showMoney !== false;
  const q = input.query.trim();
  if (!q) return { found: 0, variants: [] };

  const variants = await db
    .select({
      variantId: schema.productVariants.id,
      sku: schema.productVariants.sku,
      color: schema.productVariants.color,
      size: schema.productVariants.size,
      price: schema.productVariants.price,
      purchaseCost: schema.productVariants.ainurPurchaseCost,
      productId: schema.products.id,
      product: schema.products.name,
      collection: schema.collections.name,
      archived: schema.productVariants.isArchived,
    })
    .from(schema.productVariants)
    .innerJoin(
      schema.products,
      eq(schema.productVariants.productId, schema.products.id),
    )
    .innerJoin(
      schema.collections,
      eq(schema.products.collectionId, schema.collections.id),
    )
    .where(
      or(
        like(schema.productVariants.sku, `%${q}%`),
        like(schema.products.name, `%${q}%`),
      ),
    )
    .orderBy(asc(schema.productVariants.sku))
    .limit(MAX_ROWS);

  if (variants.length === 0) {
    return {
      found: 0,
      variants: [],
      note: "Ничего не найдено. Поиск идёт по части SKU или названия модели.",
    };
  }

  const ids = variants.map((v) => v.variantId);

  const stock = await db
    .select({
      variantId: schema.variantStock.variantId,
      quantity: schema.variantStock.quantity,
      warehouse: schema.warehouses.name,
    })
    .from(schema.variantStock)
    .innerJoin(
      schema.warehouses,
      eq(schema.variantStock.warehouseId, schema.warehouses.id),
    )
    .where(inArray(schema.variantStock.variantId, ids));

  const since = new Date(Date.now() - 365 * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);

  const sales = await db
    .select({
      variantId: schema.variantSalesDaily.variantId,
      units: sql<number>`COALESCE(SUM(${schema.variantSalesDaily.units}), 0)`,
      revenue: sql<number>`COALESCE(SUM(${schema.variantSalesDaily.revenue}), 0)`,
    })
    .from(schema.variantSalesDaily)
    .where(
      and(
        inArray(schema.variantSalesDaily.variantId, ids),
        gte(schema.variantSalesDaily.day, since),
      ),
    )
    .groupBy(schema.variantSalesDaily.variantId);

  const salesBy = new Map(
    sales.map((s) => [s.variantId, { units: Number(s.units), revenue: Number(s.revenue) }]),
  );

  const stockBy = new Map<string, Record<string, number>>();
  for (const s of stock) {
    const e = stockBy.get(s.variantId) ?? {};
    if (Number(s.quantity) !== 0) e[s.warehouse] = Number(s.quantity);
    stockBy.set(s.variantId, e);
  }

  return {
    found: variants.length,
    variants: variants.map((v) => {
      const sold = salesBy.get(v.variantId);
      const stockMap = stockBy.get(v.variantId) ?? {};
      const totalStock = Object.values(stockMap).reduce((a, b) => a + b, 0);
      const price = v.price ?? null;
      const cost = v.purchaseCost ?? null;
      const marginPct =
        price && cost && price > 0 ? round(((price - cost) / price) * 100) : null;

      return {
        sku: v.sku,
        model: v.product,
        collection: v.collection,
        color: v.color,
        size: v.size,
        archived: v.archived,
        stockByWarehouse: stockMap,
        totalStock,
        soldLast12m: sold?.units ?? 0,
        ...(showMoney
          ? {
              priceThb: price,
              purchaseCostThb: cost,
              marginPerUnitThb: price && cost ? round(price - cost) : null,
              marginPct,
              revenueLast12mThb: round(sold?.revenue ?? 0),
            }
          : {}),
      };
    }),
  };
}

// ============================================================
// Заказы на пошив
// ============================================================

export async function ordersStatus(opts: { showMoney?: boolean } = {}) {
  const showMoney = opts.showMoney !== false;
  const today = new Date().toISOString().slice(0, 10);

  const orders = await db
    .select({
      id: schema.productionOrders.id,
      number: schema.productionOrders.number,
      status: schema.productionOrders.status,
      plannedReadyAt: schema.productionOrders.plannedReadyAt,
      actualReadyAt: schema.productionOrders.actualReadyAt,
      totalCost: schema.productionOrders.snapshotTotalCost,
      createdAt: schema.productionOrders.createdAt,
      factory: schema.factories.name,
    })
    .from(schema.productionOrders)
    .innerJoin(
      schema.factories,
      eq(schema.productionOrders.factoryId, schema.factories.id),
    )
    .orderBy(desc(schema.productionOrders.createdAt))
    .limit(MAX_ROWS);

  const lines = await db
    .select({
      orderId: schema.productionOrderLines.orderId,
      quantity: sql<number>`COALESCE(SUM(${schema.productionOrderLines.quantity}), 0)`,
      produced: sql<number>`COALESCE(SUM(${schema.productionOrderLines.qtyProduced}), 0)`,
    })
    .from(schema.productionOrderLines)
    .groupBy(schema.productionOrderLines.orderId);

  const byOrder = new Map(
    lines.map((l) => [l.orderId, { qty: Number(l.quantity), made: Number(l.produced) }]),
  );

  /**
   * Фактический срок пошива, дней. Считаем только по заказам, которые реально
   * заводились в Луне: у истории, залитой импортом, дата создания — это дата
   * импорта, а не дата заказа, поэтому разница выходит нулевой или
   * отрицательной. Порог в 3 дня отсекает именно такие записи: быстрее чем за
   * три дня не шьётся ничего.
   */
  const MIN_PLAUSIBLE_DAYS = 3;
  const leadTimes: number[] = [];
  for (const o of orders) {
    if (o.actualReadyAt && o.createdAt) {
      const d =
        (Date.parse(o.actualReadyAt) - Date.parse(o.createdAt)) / 86400000;
      if (Number.isFinite(d) && d >= MIN_PLAUSIBLE_DAYS && d < 400) {
        leadTimes.push(Math.round(d));
      }
    }
  }
  leadTimes.sort((a, b) => a - b);
  const medianLeadDays =
    leadTimes.length > 0 ? leadTimes[Math.floor(leadTimes.length / 2)] : null;

  return {
    medianLeadDays,
    leadTimeSampleSize: leadTimes.length,
    leadTimeNote:
      leadTimes.length === 0
        ? "Фактический срок пошива посчитать пока не на чем: вся история заказов залита импортом, и дата создания в ней — дата импорта. Срок начнёт считаться по заказам, которые заводятся в Луне."
        : undefined,
    orders: orders.map((o) => {
      const u = byOrder.get(o.id);
      const overdue =
        o.status !== "RECEIVED" &&
        o.status !== "CANCELLED" &&
        !o.actualReadyAt &&
        Boolean(o.plannedReadyAt && o.plannedReadyAt < today);
      return {
        number: o.number,
        factory: o.factory,
        status: o.status,
        plannedReadyAt: o.plannedReadyAt,
        actualReadyAt: o.actualReadyAt,
        units: u?.qty ?? 0,
        produced: u?.made ?? 0,
        overdue,
        ...(showMoney ? { totalCostThb: round(o.totalCost) } : {}),
      };
    }),
  };
}

// ============================================================
// Экспорт для планирования сезона (только Eva Moon, активные варианты)
// ============================================================
//
// В отличие от productCard/salesByMonth это не поиск по одной модели, а
// массовая выгрузка сразу по многим SKU: себестоимость/цена, остаток на
// наших складах, продажи по месяцам с 2024-01 и уже подтверждённые (не
// полученные) строки заказов на пошив — всё, что нужно для планирования
// повторов к сезону, без сотен отдельных вызовов product_card.
//
// Единица анализа — SKU (модель+цвет+размер), коллекции не сворачиваем.

export interface SeasonExportInput {
  /** ограничить одной коллекцией (часть названия) — без этого ответ рискует быть огромным */
  collection?: string;
  limit?: number;
  offset?: number;
  /** начало окна помесячных продаж, YYYY-MM-DD; по умолчанию — с января 2024 */
  salesFrom?: string;
}

const SEASON_EXPORT_MAX_ROWS = 500;

export async function seasonPlanningExport(input: SeasonExportInput = {}) {
  const limit = Math.min(input.limit ?? SEASON_EXPORT_MAX_ROWS, SEASON_EXPORT_MAX_ROWS);
  const offset = input.offset ?? 0;
  const salesFrom = input.salesFrom ?? "2024-01-01";

  const conds = [
    eq(schema.productVariants.isArchived, false),
    eq(schema.products.isArchived, false),
    eq(schema.collections.isArchived, false),
  ];
  if (input.collection) {
    conds.push(like(schema.collections.name, `%${input.collection}%`));
  }

  const totalRow = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(schema.productVariants)
    .innerJoin(schema.products, eq(schema.productVariants.productId, schema.products.id))
    .innerJoin(schema.collections, eq(schema.products.collectionId, schema.collections.id))
    .where(and(...conds));

  const variants = await db
    .select({
      variantId: schema.productVariants.id,
      sku: schema.productVariants.sku,
      color: schema.productVariants.color,
      size: schema.productVariants.size,
      price: schema.productVariants.price,
      purchaseCost: schema.productVariants.ainurPurchaseCost,
      createdAt: schema.productVariants.createdAt,
      model: schema.products.name,
      collection: schema.collections.name,
    })
    .from(schema.productVariants)
    .innerJoin(schema.products, eq(schema.productVariants.productId, schema.products.id))
    .innerJoin(schema.collections, eq(schema.products.collectionId, schema.collections.id))
    .where(and(...conds))
    .orderBy(asc(schema.productVariants.sku))
    .limit(limit)
    .offset(offset);

  if (variants.length === 0) {
    return {
      totalMatching: Number(totalRow[0]?.count ?? 0),
      returned: 0,
      salesFrom,
      variants: [],
      note: "Ничего не найдено — проверь название коллекции или offset.",
    };
  }

  const ids = variants.map((v) => v.variantId);

  // остаток по всем складам, где он есть
  const stock = await db
    .select({
      variantId: schema.variantStock.variantId,
      quantity: schema.variantStock.quantity,
      warehouse: schema.warehouses.name,
    })
    .from(schema.variantStock)
    .innerJoin(schema.warehouses, eq(schema.variantStock.warehouseId, schema.warehouses.id))
    .where(inArray(schema.variantStock.variantId, ids));

  const stockBy = new Map<string, Record<string, number>>();
  for (const s of stock) {
    const e = stockBy.get(s.variantId) ?? {};
    e[s.warehouse] = Number(s.quantity);
    stockBy.set(s.variantId, e);
  }

  // продажи по месяцам с salesFrom — сразу по всем найденным вариантам
  const sales = await db
    .select({
      variantId: schema.variantSalesDaily.variantId,
      day: schema.variantSalesDaily.day,
      units: schema.variantSalesDaily.units,
      revenue: schema.variantSalesDaily.revenue,
    })
    .from(schema.variantSalesDaily)
    .where(
      and(
        inArray(schema.variantSalesDaily.variantId, ids),
        gte(schema.variantSalesDaily.day, salesFrom),
      ),
    );

  const salesBy = new Map<string, Map<string, { units: number; revenue: number }>>();
  for (const s of sales) {
    const month = s.day.slice(0, 7);
    let byMonth = salesBy.get(s.variantId);
    if (!byMonth) {
      byMonth = new Map();
      salesBy.set(s.variantId, byMonth);
    }
    const e = byMonth.get(month) ?? { units: 0, revenue: 0 };
    e.units += Number(s.units);
    e.revenue += Number(s.revenue);
    byMonth.set(month, e);
  }

  // подтверждённые поступления — незакрытые строки заказов на пошив
  const openLines = await db
    .select({
      variantId: schema.productionOrderLines.variantId,
      quantity: schema.productionOrderLines.quantity,
      qtyProduced: schema.productionOrderLines.qtyProduced,
      plannedReadyAt: schema.productionOrderLines.plannedReadyAt,
      orderStatus: schema.productionOrders.status,
    })
    .from(schema.productionOrderLines)
    .innerJoin(
      schema.productionOrders,
      eq(schema.productionOrderLines.orderId, schema.productionOrders.id),
    )
    .where(inArray(schema.productionOrderLines.variantId, ids));

  const incomingBy = new Map<string, { qty: number; plannedReadyAt: string | null }[]>();
  for (const l of openLines) {
    if (!l.variantId) continue;
    if (l.orderStatus === "RECEIVED" || l.orderStatus === "CANCELLED") continue;
    const remaining = Number(l.quantity) - Number(l.qtyProduced ?? 0);
    if (remaining <= 0) continue;
    const arr = incomingBy.get(l.variantId) ?? [];
    arr.push({ qty: remaining, plannedReadyAt: l.plannedReadyAt });
    incomingBy.set(l.variantId, arr);
  }

  return {
    totalMatching: Number(totalRow[0]?.count ?? 0),
    returned: variants.length,
    salesFrom,
    variants: variants.map((v) => {
      const price = v.price ?? null;
      const cost = v.purchaseCost ?? null;
      const monthly = [...(salesBy.get(v.variantId)?.entries() ?? [])]
        .filter(([, e]) => e.units !== 0 || e.revenue !== 0)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([month, e]) => ({ month, units: e.units, revenueThb: round(e.revenue) }));
      return {
        sku: v.sku,
        model: v.model,
        collection: v.collection,
        color: v.color,
        size: v.size,
        createdAt: v.createdAt,
        priceThb: price,
        purchaseCostThb: cost,
        marginPerUnitThb: price && cost ? round(price - cost) : null,
        marginPct: price && cost && price > 0 ? round(((price - cost) / price) * 100) : null,
        stockByWarehouse: stockBy.get(v.variantId) ?? {},
        monthlySales: monthly,
        incomingConfirmed: incomingBy.get(v.variantId) ?? [],
      };
    }),
  };
}
