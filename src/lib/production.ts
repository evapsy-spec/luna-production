/**
 * Ядро производственной логики Luna Production.
 *
 * Здесь живёт всё, что считает деньги и метры:
 *  - потребность в ткани по BOM,
 *  - проверка наличия и резерв метража под заказ,
 *  - снэпшот себестоимости на момент создания заказа,
 *  - скорость продаж и «на сколько месяцев хватит запаса»,
 *  - рекомендации Luna «что заказать, чтобы хватило на N месяцев»,
 *  - скоркард фабрики и зачёт брака.
 */
import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";

// ============================================================
// СЕБЕСТОИМОСТЬ ТКАНИ
// ============================================================

/** Цена метра ткани в THB: цена в валюте закупки × курс на дату закупки */
export function fabricCostPerMeterThb(fabric: {
  purchasePrice: number | null;
  fxRateToThb: number;
}): number {
  if (fabric.purchasePrice == null) return 0;
  return fabric.purchasePrice * (fabric.fxRateToThb || 1);
}

// ============================================================
// ПОТРЕБНОСТЬ В ТКАНИ ПО BOM
// ============================================================

export interface OrderLineInput {
  productId: string;
  variantId?: string | null;
  size?: string | null;
  quantity: number;
  plannedReadyAt?: string | null;
}

export interface FabricRequirement {
  fabricId: string;
  fabricSku: string | null;
  fabricName: string;
  /** метров нужно с учётом припуска на раскрой */
  metersNeeded: number;
  /** физически на складах */
  metersOnHand: number;
  /** уже занято другими активными заказами */
  metersReserved: number;
  /** доступно = onHand − reserved */
  metersAvailable: number;
  /** сколько не хватает (0, если хватает) */
  metersShort: number;
  costPerMeterThb: number;
  /** стоимость нужного метража, THB */
  costThb: number;
}

export interface AccessoryRequirement {
  accessoryId: string;
  name: string;
  unit: string;
  qtyNeeded: number;
  qtyOnHand: number;
  qtyShort: number;
  unitCost: number;
  costThb: number;
}

export interface OrderCalculation {
  fabrics: FabricRequirement[];
  accessories: AccessoryRequirement[];
  /** позиции, у которых вообще нет BOM — нельзя посчитать расход ткани */
  productsWithoutBom: { productId: string; productName: string }[];
  totals: {
    units: number;
    fabricCostThb: number;
    accessoryCostThb: number;
    sewingCostThb: number;
    /** до вычета кредита за брак */
    totalCostThb: number;
  };
  /** построчная себестоимость — уходит в снэпшот позиций заказа */
  perLine: {
    productId: string;
    variantId?: string | null;
    size?: string | null;
    quantity: number;
    unitFabricCost: number;
    unitSewingCost: number;
  }[];
  hasShortage: boolean;
}

/**
 * Считает всё, что нужно знать до создания заказа: сколько ткани уйдёт,
 * хватает ли её, сколько это стоит.
 *
 * Учитывается припуск на раскрой (wastePct) и уже existing резервы других
 * заказов — иначе два заказа «съели» бы один и тот же рулон.
 */
export async function calculateOrder(
  factoryId: string,
  lines: OrderLineInput[],
): Promise<OrderCalculation> {
  const productIds = [...new Set(lines.map((l) => l.productId))];
  if (productIds.length === 0) {
    return emptyCalculation();
  }

  // 1. BOM по тканям
  const bomFabrics = await db
    .select({
      productId: schema.bomFabricLines.productId,
      fabricId: schema.bomFabricLines.fabricId,
      metersPerUnit: schema.bomFabricLines.metersPerUnit,
      wastePct: schema.bomFabricLines.wastePct,
      fabricSku: schema.fabrics.sku,
      fabricName: schema.fabrics.name,
      purchasePrice: schema.fabrics.purchasePrice,
      fxRateToThb: schema.fabrics.fxRateToThb,
    })
    .from(schema.bomFabricLines)
    .innerJoin(
      schema.fabrics,
      eq(schema.bomFabricLines.fabricId, schema.fabrics.id),
    )
    .where(inArray(schema.bomFabricLines.productId, productIds));

  // 2. BOM по фурнитуре
  const bomAccessories = await db
    .select({
      productId: schema.bomAccessoryLines.productId,
      accessoryId: schema.bomAccessoryLines.accessoryId,
      qtyPerUnit: schema.bomAccessoryLines.qtyPerUnit,
      name: schema.accessories.name,
      unit: schema.accessories.unit,
      unitCost: schema.accessories.unitCost,
      stockQty: schema.accessories.stockQty,
    })
    .from(schema.bomAccessoryLines)
    .innerJoin(
      schema.accessories,
      eq(schema.bomAccessoryLines.accessoryId, schema.accessories.id),
    )
    .where(inArray(schema.bomAccessoryLines.productId, productIds));

  // 3. Цены пошива на этой фабрике (текущие) + значение по умолчанию
  const prices = await db
    .select({
      productId: schema.factoryPrices.productId,
      pricePerUnit: schema.factoryPrices.pricePerUnit,
    })
    .from(schema.factoryPrices)
    .where(
      and(
        eq(schema.factoryPrices.factoryId, factoryId),
        eq(schema.factoryPrices.isCurrent, true),
        inArray(schema.factoryPrices.productId, productIds),
      ),
    );
  const priceByProduct = new Map(prices.map((p) => [p.productId, p.pricePerUnit]));

  const productRows = await db
    .select({
      id: schema.products.id,
      name: schema.products.name,
      defaultSewingCost: schema.products.defaultSewingCost,
    })
    .from(schema.products)
    .where(inArray(schema.products.id, productIds));
  const productById = new Map(productRows.map((p) => [p.id, p]));

  // 4. Считаем метраж по тканям
  const fabricAgg = new Map<
    string,
    {
      fabricId: string;
      fabricSku: string | null;
      fabricName: string;
      metersNeeded: number;
      costPerMeterThb: number;
    }
  >();
  const accessoryAgg = new Map<string, AccessoryRequirement>();
  const perLine: OrderCalculation["perLine"] = [];
  const productsWithBom = new Set(bomFabrics.map((b) => b.productId));
  const productsWithoutBom: { productId: string; productName: string }[] = [];

  let totalUnits = 0;
  let sewingCostThb = 0;

  for (const line of lines) {
    const qty = Math.max(0, Math.round(line.quantity));
    if (qty === 0) continue;
    totalUnits += qty;

    const product = productById.get(line.productId);
    const unitSewingCost =
      priceByProduct.get(line.productId) ?? product?.defaultSewingCost ?? 0;
    sewingCostThb += unitSewingCost * qty;

    // ткань этой позиции
    let unitFabricCost = 0;
    const linesForProduct = bomFabrics.filter(
      (b) => b.productId === line.productId,
    );

    if (linesForProduct.length === 0 && !productsWithBom.has(line.productId)) {
      if (!productsWithoutBom.some((p) => p.productId === line.productId)) {
        productsWithoutBom.push({
          productId: line.productId,
          productName: product?.name ?? "неизвестное изделие",
        });
      }
    }

    for (const bom of linesForProduct) {
      const withWaste = bom.metersPerUnit * (1 + (bom.wastePct || 0) / 100);
      const meters = withWaste * qty;
      const costPerMeter = fabricCostPerMeterThb(bom);
      unitFabricCost += withWaste * costPerMeter;

      const current = fabricAgg.get(bom.fabricId);
      if (current) {
        current.metersNeeded += meters;
      } else {
        fabricAgg.set(bom.fabricId, {
          fabricId: bom.fabricId,
          fabricSku: bom.fabricSku,
          fabricName: bom.fabricName,
          metersNeeded: meters,
          costPerMeterThb: costPerMeter,
        });
      }
    }

    // фурнитура
    for (const acc of bomAccessories.filter(
      (a) => a.productId === line.productId,
    )) {
      const needed = acc.qtyPerUnit * qty;
      const current = accessoryAgg.get(acc.accessoryId);
      if (current) {
        current.qtyNeeded += needed;
        current.costThb += needed * acc.unitCost;
      } else {
        accessoryAgg.set(acc.accessoryId, {
          accessoryId: acc.accessoryId,
          name: acc.name,
          unit: acc.unit,
          qtyNeeded: needed,
          qtyOnHand: acc.stockQty,
          qtyShort: 0,
          unitCost: acc.unitCost,
          costThb: needed * acc.unitCost,
        });
      }
    }

    perLine.push({
      productId: line.productId,
      variantId: line.variantId ?? null,
      size: line.size ?? null,
      quantity: qty,
      unitFabricCost: round2(unitFabricCost),
      unitSewingCost: round2(unitSewingCost),
    });
  }

  // 5. Наличие ткани: onHand и уже занятое другими активными заказами
  const fabricIds = [...fabricAgg.keys()];
  const availability = await getFabricAvailability(fabricIds);

  const fabrics: FabricRequirement[] = [...fabricAgg.values()].map((f) => {
    const avail = availability.get(f.fabricId) ?? { onHand: 0, reserved: 0 };
    const metersAvailable = avail.onHand - avail.reserved;
    const metersShort = Math.max(0, f.metersNeeded - metersAvailable);
    return {
      fabricId: f.fabricId,
      fabricSku: f.fabricSku,
      fabricName: f.fabricName,
      metersNeeded: round2(f.metersNeeded),
      metersOnHand: round2(avail.onHand),
      metersReserved: round2(avail.reserved),
      metersAvailable: round2(metersAvailable),
      metersShort: round2(metersShort),
      costPerMeterThb: round2(f.costPerMeterThb),
      costThb: round2(f.metersNeeded * f.costPerMeterThb),
    };
  });

  const accessories = [...accessoryAgg.values()].map((a) => ({
    ...a,
    qtyNeeded: round2(a.qtyNeeded),
    qtyShort: round2(Math.max(0, a.qtyNeeded - a.qtyOnHand)),
    costThb: round2(a.costThb),
  }));

  const fabricCostThb = fabrics.reduce((s, f) => s + f.costThb, 0);
  const accessoryCostThb = accessories.reduce((s, a) => s + a.costThb, 0);

  return {
    fabrics,
    accessories,
    productsWithoutBom,
    perLine,
    totals: {
      units: totalUnits,
      fabricCostThb: round2(fabricCostThb),
      accessoryCostThb: round2(accessoryCostThb),
      sewingCostThb: round2(sewingCostThb),
      totalCostThb: round2(fabricCostThb + accessoryCostThb + sewingCostThb),
    },
    hasShortage:
      fabrics.some((f) => f.metersShort > 0.01) ||
      accessories.some((a) => a.qtyShort > 0.01),
  };
}

/** onHand и активный резерв по каждой ткани (сумма по всем складам тканей) */
export async function getFabricAvailability(
  fabricIds: string[],
): Promise<Map<string, { onHand: number; reserved: number }>> {
  const result = new Map<string, { onHand: number; reserved: number }>();
  if (fabricIds.length === 0) return result;

  const stock = await db
    .select({
      fabricId: schema.fabricStock.fabricId,
      onHand: sql<number>`COALESCE(SUM(${schema.fabricStock.onHandM}), 0)`,
    })
    .from(schema.fabricStock)
    .where(inArray(schema.fabricStock.fabricId, fabricIds))
    .groupBy(schema.fabricStock.fabricId);

  // резерв считаем от живых резерваций, а не от денормализованного поля —
  // так цифра не разъедется, если что-то пойдёт не так при откате
  const reserved = await db
    .select({
      fabricId: schema.fabricReservations.fabricId,
      reserved: sql<number>`COALESCE(SUM(${schema.fabricReservations.meters}), 0)`,
    })
    .from(schema.fabricReservations)
    .where(
      and(
        inArray(schema.fabricReservations.fabricId, fabricIds),
        eq(schema.fabricReservations.released, false),
      ),
    )
    .groupBy(schema.fabricReservations.fabricId);

  for (const id of fabricIds) result.set(id, { onHand: 0, reserved: 0 });
  for (const row of stock) {
    result.set(row.fabricId, {
      onHand: Number(row.onHand) || 0,
      reserved: result.get(row.fabricId)?.reserved ?? 0,
    });
  }
  for (const row of reserved) {
    const entry = result.get(row.fabricId) ?? { onHand: 0, reserved: 0 };
    entry.reserved = Number(row.reserved) || 0;
    result.set(row.fabricId, entry);
  }
  return result;
}

// ============================================================
// СКОРОСТЬ ПРОДАЖ И ЗАПАС В МЕСЯЦАХ
// ============================================================

export interface VelocityRow {
  variantId: string;
  sku: string;
  productId: string;
  productName: string;
  collectionId: string;
  collectionName: string;
  color: string | null;
  size: string | null;
  unitsSold: number;
  revenue: number;
  /** штук в месяц по факту за окно наблюдения */
  perMonth: number;
  stockQty: number;
  /** на сколько месяцев хватит текущего остатка; null = продаж нет */
  monthsOfCover: number | null;
}

/**
 * Скорость продаж по вариантам за последние N дней + текущий остаток.
 * Из этого считаются и «месяцы запаса», и рекомендации Luna.
 */
export async function getVelocity(days = 90): Promise<VelocityRow[]> {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);

  const sales = await db
    .select({
      variantId: schema.variantSalesDaily.variantId,
      units: sql<number>`COALESCE(SUM(${schema.variantSalesDaily.units}), 0)`,
      revenue: sql<number>`COALESCE(SUM(${schema.variantSalesDaily.revenue}), 0)`,
    })
    .from(schema.variantSalesDaily)
    .where(gte(schema.variantSalesDaily.day, since))
    .groupBy(schema.variantSalesDaily.variantId);
  const salesByVariant = new Map(
    sales.map((s) => [s.variantId, { units: Number(s.units), revenue: Number(s.revenue) }]),
  );

  const stock = await db
    .select({
      variantId: schema.variantStock.variantId,
      qty: sql<number>`COALESCE(SUM(${schema.variantStock.quantity}), 0)`,
    })
    .from(schema.variantStock)
    .groupBy(schema.variantStock.variantId);
  const stockByVariant = new Map(stock.map((s) => [s.variantId, Number(s.qty)]));

  const variants = await db
    .select({
      variantId: schema.productVariants.id,
      sku: schema.productVariants.sku,
      color: schema.productVariants.color,
      size: schema.productVariants.size,
      productId: schema.products.id,
      productName: schema.products.name,
      collectionId: schema.collections.id,
      collectionName: schema.collections.name,
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
    .where(eq(schema.productVariants.isArchived, false));

  const monthsInWindow = days / 30.4;

  return variants.map((v) => {
    const sale = salesByVariant.get(v.variantId) ?? { units: 0, revenue: 0 };
    const stockQty = stockByVariant.get(v.variantId) ?? 0;
    const perMonth = sale.units / monthsInWindow;
    return {
      ...v,
      unitsSold: sale.units,
      revenue: sale.revenue,
      perMonth: round2(perMonth),
      stockQty,
      monthsOfCover: perMonth > 0 ? round2(stockQty / perMonth) : null,
    };
  });
}

// ============================================================
// РЕКОМЕНДАЦИИ LUNA
// ============================================================

export interface Recommendation {
  variantId: string;
  productId: string;
  sku: string;
  label: string;
  color: string | null;
  size: string | null;
  perMonth: number;
  stockQty: number;
  monthsOfCover: number | null;
  /** сколько нужно, чтобы хватило на horizonMonths */
  suggestedQty: number;
  reason: string;
}

/**
 * «Что заказать, чтобы хватило на N месяцев» — горизонт задаётся при каждом
 * заказе. Формула: нужно = скорость_в_месяц × N − текущий_остаток,
 * минус то, что уже едет из активных заказов на пошив.
 */
export async function recommendForHorizon(
  horizonMonths: number,
  opts: { collectionId?: string; factoryId?: string; velocityDays?: number } = {},
): Promise<Recommendation[]> {
  const velocity = await getVelocity(opts.velocityDays ?? 90);
  const incoming = await getIncomingQuantities();

  let rows = velocity;
  if (opts.collectionId) {
    rows = rows.filter((r) => r.collectionId === opts.collectionId);
  }
  if (opts.factoryId) {
    // только те коллекции, которые эта фабрика действительно шьёт
    const allowed = await db
      .select({ collectionId: schema.factoryCollections.collectionId })
      .from(schema.factoryCollections)
      .where(eq(schema.factoryCollections.factoryId, opts.factoryId));
    if (allowed.length > 0) {
      const set = new Set(allowed.map((a) => a.collectionId));
      rows = rows.filter((r) => set.has(r.collectionId));
    }
  }

  const out: Recommendation[] = [];
  for (const row of rows) {
    if (row.perMonth <= 0) continue; // не продаётся — не предлагаем шить

    const onTheWay = incoming.get(row.variantId) ?? 0;
    const target = row.perMonth * horizonMonths;
    const need = target - row.stockQty - onTheWay;
    if (need < 1) continue;

    const suggestedQty = Math.ceil(need);
    const cover =
      row.monthsOfCover === null ? "продаж нет" : `${row.monthsOfCover} мес`;

    out.push({
      variantId: row.variantId,
      productId: row.productId,
      sku: row.sku,
      label: [row.productName, row.color, row.size].filter(Boolean).join(" · "),
      color: row.color,
      size: row.size,
      perMonth: row.perMonth,
      stockQty: row.stockQty,
      monthsOfCover: row.monthsOfCover,
      suggestedQty,
      reason:
        `продаётся ${row.perMonth} шт/мес, на складе ${row.stockQty} шт` +
        (onTheWay > 0 ? `, в пошиве ${onTheWay} шт` : "") +
        ` — запаса на ${cover}`,
    });
  }

  // сначала то, что заканчивается быстрее всего
  return out.sort((a, b) => {
    const aCover = a.monthsOfCover ?? Infinity;
    const bCover = b.monthsOfCover ?? Infinity;
    return aCover - bCover;
  });
}

/** Сколько штук каждого варианта уже в активных заказах на пошив */
export async function getIncomingQuantities(): Promise<Map<string, number>> {
  const rows = await db
    .select({
      variantId: schema.productionOrderLines.variantId,
      qty: sql<number>`COALESCE(SUM(${schema.productionOrderLines.quantity} - ${schema.productionOrderLines.qtyProduced}), 0)`,
    })
    .from(schema.productionOrderLines)
    .innerJoin(
      schema.productionOrders,
      eq(schema.productionOrderLines.orderId, schema.productionOrders.id),
    )
    .where(
      inArray(schema.productionOrders.status, [
        "SAMPLE",
        "IN_PRODUCTION",
        "READY",
      ]),
    )
    .groupBy(schema.productionOrderLines.variantId);

  const map = new Map<string, number>();
  for (const row of rows) {
    if (row.variantId) map.set(row.variantId, Math.max(0, Number(row.qty) || 0));
  }
  return map;
}

// ============================================================
// РЕКОМЕНДАЦИИ ПО ПЕРЕМЕЩЕНИЮ МЕЖДУ СКЛАДАМИ
// ============================================================

export interface TransferSuggestion {
  variantId: string;
  sku: string;
  label: string;
  fromWarehouseId: string;
  fromWarehouseName: string;
  toWarehouseId: string;
  toWarehouseName: string;
  quantity: number;
  reason: string;
}

/**
 * Где товар лежит мёртвым грузом, а где заканчивается.
 * Считаем скорость продаж отдельно по складам и сравниваем с остатком там же.
 */
export async function suggestTransfers(
  velocityDays = 90,
  minQty = 3,
): Promise<TransferSuggestion[]> {
  const since = new Date(Date.now() - velocityDays * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
  const monthsInWindow = velocityDays / 30.4;

  const salesRows = await db
    .select({
      variantId: schema.variantSalesDaily.variantId,
      warehouseId: schema.variantSalesDaily.warehouseId,
      units: sql<number>`COALESCE(SUM(${schema.variantSalesDaily.units}), 0)`,
    })
    .from(schema.variantSalesDaily)
    .where(gte(schema.variantSalesDaily.day, since))
    .groupBy(
      schema.variantSalesDaily.variantId,
      schema.variantSalesDaily.warehouseId,
    );

  const stockRows = await db
    .select({
      variantId: schema.variantStock.variantId,
      warehouseId: schema.variantStock.warehouseId,
      qty: schema.variantStock.quantity,
      warehouseName: schema.warehouses.name,
      sku: schema.productVariants.sku,
      color: schema.productVariants.color,
      size: schema.productVariants.size,
      productName: schema.products.name,
    })
    .from(schema.variantStock)
    .innerJoin(
      schema.warehouses,
      eq(schema.variantStock.warehouseId, schema.warehouses.id),
    )
    .innerJoin(
      schema.productVariants,
      eq(schema.variantStock.variantId, schema.productVariants.id),
    )
    .innerJoin(
      schema.products,
      eq(schema.productVariants.productId, schema.products.id),
    );

  const velocityKey = (v: string, w: string | null) => `${v}|${w ?? ""}`;
  const perMonthByKey = new Map<string, number>();
  for (const row of salesRows) {
    perMonthByKey.set(
      velocityKey(row.variantId, row.warehouseId),
      Number(row.units) / monthsInWindow,
    );
  }

  // группируем остатки по варианту
  const byVariant = new Map<string, typeof stockRows>();
  for (const row of stockRows) {
    const list = byVariant.get(row.variantId) ?? [];
    list.push(row);
    byVariant.set(row.variantId, list);
  }

  const out: TransferSuggestion[] = [];

  for (const [variantId, rows] of byVariant) {
    if (rows.length < 2) continue;

    const enriched = rows.map((r) => {
      const perMonth = perMonthByKey.get(velocityKey(variantId, r.warehouseId)) ?? 0;
      return {
        ...r,
        perMonth,
        monthsOfCover: perMonth > 0 ? r.qty / perMonth : r.qty > 0 ? Infinity : 0,
      };
    });

    // откуда: много запаса и продаётся плохо; куда: продаётся, но заканчивается
    const donors = enriched
      .filter((e) => e.qty >= minQty && e.monthsOfCover > 6)
      .sort((a, b) => b.monthsOfCover - a.monthsOfCover);
    const receivers = enriched
      .filter((e) => e.perMonth > 0 && e.monthsOfCover < 2)
      .sort((a, b) => a.monthsOfCover - b.monthsOfCover);

    if (!donors.length || !receivers.length) continue;

    for (const receiver of receivers) {
      const donor = donors.find(
        (d) => d.warehouseId !== receiver.warehouseId && d.qty >= minQty,
      );
      if (!donor) continue;

      // добираем получателя до 3 месяцев запаса, но не больше половины у донора
      const wanted = Math.ceil(receiver.perMonth * 3 - receiver.qty);
      const canGive = Math.floor(donor.qty / 2);
      const quantity = Math.max(0, Math.min(wanted, canGive));
      if (quantity < 1) continue;

      donor.qty -= quantity;

      const coverText =
        donor.monthsOfCover === Infinity
          ? "не продаётся вообще"
          : `запас на ${round1(donor.monthsOfCover)} мес`;

      out.push({
        variantId,
        sku: receiver.sku,
        label: [receiver.productName, receiver.color, receiver.size]
          .filter(Boolean)
          .join(" · "),
        fromWarehouseId: donor.warehouseId,
        fromWarehouseName: donor.warehouseName,
        toWarehouseId: receiver.warehouseId,
        toWarehouseName: receiver.warehouseName,
        quantity,
        reason:
          `на «${donor.warehouseName}» ${coverText}, ` +
          `а на «${receiver.warehouseName}» продаётся ${round1(receiver.perMonth)} шт/мес ` +
          `и осталось ${receiver.qty} шт`,
      });
    }
  }

  return out;
}

// ============================================================
// СКОРКАРД ФАБРИКИ
// ============================================================

export interface FactoryScorecard {
  factoryId: string;
  name: string;
  ordersTotal: number;
  ordersCompleted: number;
  /** % заказов, сданных не позже плановой даты */
  onTimePct: number | null;
  /** % брака от общего выпуска */
  defectPct: number | null;
  unitsProduced: number;
  unitsDefect: number;
  /** всего заплачено фабрике, THB */
  totalPaidThb: number;
  /** сумма заказов по снэпшоту себестоимости, THB */
  totalOrderedThb: number;
  /** незачтённый кредит за брак, THB */
  openDefectCreditThb: number;
  /** сколько единиц сейчас в работе */
  unitsInProgress: number;
  capacityUsedPct: number | null;
}

export async function getFactoryScorecards(): Promise<FactoryScorecard[]> {
  const factories = await db
    .select()
    .from(schema.factories)
    .where(eq(schema.factories.isArchived, false));

  const out: FactoryScorecard[] = [];

  for (const factory of factories) {
    const orders = await db
      .select()
      .from(schema.productionOrders)
      .where(eq(schema.productionOrders.factoryId, factory.id));

    const orderIds = orders.map((o) => o.id);

    const lines = orderIds.length
      ? await db
          .select()
          .from(schema.productionOrderLines)
          .where(inArray(schema.productionOrderLines.orderId, orderIds))
      : [];

    const payments = orderIds.length
      ? await db
          .select({
            total: sql<number>`COALESCE(SUM(${schema.orderPayments.amount}), 0)`,
          })
          .from(schema.orderPayments)
          .where(inArray(schema.orderPayments.orderId, orderIds))
      : [{ total: 0 }];

    const openCredits = await db
      .select({
        total: sql<number>`COALESCE(SUM(${schema.defectCredits.amount}), 0)`,
      })
      .from(schema.defectCredits)
      .where(
        and(
          eq(schema.defectCredits.factoryId, factory.id),
          isNull(schema.defectCredits.appliedToOrderId),
        ),
      );

    const completed = orders.filter(
      (o) => o.status === "READY" || o.status === "RECEIVED",
    );
    // считаем «вовремя» только там, где есть обе даты — иначе процент врёт
    const measurable = completed.filter(
      (o) => o.plannedReadyAt && o.actualReadyAt,
    );
    const onTime = measurable.filter(
      (o) => new Date(o.actualReadyAt!) <= new Date(o.plannedReadyAt!),
    );

    const unitsProduced = lines.reduce((s, l) => s + l.qtyProduced, 0);
    const unitsDefect = lines.reduce((s, l) => s + l.qtyDefect, 0);

    const activeOrderIds = new Set(
      orders
        .filter((o) => o.status === "SAMPLE" || o.status === "IN_PRODUCTION")
        .map((o) => o.id),
    );
    const unitsInProgress = lines
      .filter((l) => activeOrderIds.has(l.orderId))
      .reduce((s, l) => s + Math.max(0, l.quantity - l.qtyProduced), 0);

    out.push({
      factoryId: factory.id,
      name: factory.name,
      ordersTotal: orders.length,
      ordersCompleted: completed.length,
      onTimePct: measurable.length
        ? round1((onTime.length / measurable.length) * 100)
        : null,
      defectPct:
        unitsProduced > 0
          ? round1((unitsDefect / unitsProduced) * 100)
          : null,
      unitsProduced,
      unitsDefect,
      totalPaidThb: round2(Number(payments[0]?.total ?? 0)),
      totalOrderedThb: round2(
        orders.reduce((s, o) => s + o.snapshotTotalCost, 0),
      ),
      openDefectCreditThb: round2(Number(openCredits[0]?.total ?? 0)),
      unitsInProgress,
      capacityUsedPct: factory.monthlyCapacityUnits
        ? round1((unitsInProgress / factory.monthlyCapacityUnits) * 100)
        : null,
    });
  }

  return out.sort((a, b) => b.totalOrderedThb - a.totalOrderedThb);
}

/** Незачтённый кредит за брак по фабрике — вычитается из следующего заказа */
export async function getOpenDefectCredit(factoryId: string): Promise<number> {
  const rows = await db
    .select({
      total: sql<number>`COALESCE(SUM(${schema.defectCredits.amount}), 0)`,
    })
    .from(schema.defectCredits)
    .where(
      and(
        eq(schema.defectCredits.factoryId, factoryId),
        isNull(schema.defectCredits.appliedToOrderId),
      ),
    );
  return round2(Number(rows[0]?.total ?? 0));
}

// ============================================================
// Утилиты
// ============================================================

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function emptyCalculation(): OrderCalculation {
  return {
    fabrics: [],
    accessories: [],
    productsWithoutBom: [],
    perLine: [],
    totals: {
      units: 0,
      fabricCostThb: 0,
      accessoryCostThb: 0,
      sewingCostThb: 0,
      totalCostThb: 0,
    },
    hasShortage: false,
  };
}

/** Форматирование денег для интерфейса: 1 234 567 THB */
export function formatThb(value: number): string {
  return `${Math.round(value).toLocaleString("ru-RU").replace(/,/g, " ")} THB`;
}

export function formatMeters(value: number): string {
  return `${round2(value).toLocaleString("ru-RU")} м`;
}
