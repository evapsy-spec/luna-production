/**
 * «Перемещения между складами» — рекомендации, что и куда перевезти.
 *
 * Переработано под три ФИКСИРОВАННЫХ направления вместо трёх равноправных
 * складов (см. @/lib/transfer-routes и постановку задачи в истории чата):
 *
 *   Fotesko Warehouse → Phuket   — пополнение точек с производственного/
 *                                  буферного склада (Fotesko товар только
 *                                  ОТДАЁТ, никогда не получает);
 *   Phuket → Phangan             — распределение внутри Таиланда;
 *   Phangan → Phuket             — то же в обратную сторону, реже.
 *
 * Само решение «сколько и почему» считают чистые функции в
 * @/lib/transfers/logic — здесь только достаём числа из базы (остатки,
 * продажи по складам за 90/180/365 дней, дату создания варианта, бренд) и
 * вызываем эти функции. Это единственная причина, зачем нужен именно этот
 * файл: чтобы бизнес-правила можно было тестировать без базы данных.
 *
 * Как и раньше — только чтение и только рекомендация: само перемещение
 * человек делает руками в Ainur/на складе, здесь это не фиксируется (Ainur
 * — источник правды, Luna в него не пишет, см. sync.ts).
 */
import { and, eq, gte, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { detectBrand, DEFAULT_BRAND } from "@/lib/brands";
import {
  TRANSFER_ROUTES,
  FOTESKO,
  PHUKET,
  PHANGAN,
  type RouteKey,
} from "@/lib/transfer-routes";
import {
  isNewArrival,
  priorityScore,
  formatReason,
  evaluateFoteskoLeg,
  evaluateBoutiqueLeg,
  type Bucket,
  type PointSales,
  type ReasonCode,
} from "@/lib/transfers/logic";
import { readLastSyncResult } from "@/lib/ainur/last-result";
import type {
  TransferTableRow,
  NegativeStockIssue,
  AnalysisPeriod,
  TransferFilters as BaseTransferFilters,
  RouteRows,
  TransferResult,
} from "@/lib/transfers/types";

export type { Bucket };
export { TRANSFER_ROUTES };
export type {
  TransferTableRow,
  NegativeStockIssue,
  AnalysisPeriod,
  RouteRows,
  TransferResult,
} from "@/lib/transfers/types";

export interface TransferFilters extends BaseTransferFilters {
  route?: RouteKey;
}

function daysAgoIso(n: number): string {
  return new Date(Date.now() - n * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

export async function getTransferRecommendations(
  filters: TransferFilters = {},
): Promise<TransferResult> {
  const found = await db
    .select({ id: schema.warehouses.id, name: schema.warehouses.name })
    .from(schema.warehouses)
    .where(inArray(schema.warehouses.name, [FOTESKO, PHUKET, PHANGAN]));

  const idByName = new Map(found.map((w) => [w.name, w.id]));
  const foteskoId = idByName.get(FOTESKO);
  const phuketId = idByName.get(PHUKET);
  const phanganId = idByName.get(PHANGAN);

  const lastSync = await readLastSyncResult();
  const empty: TransferResult = {
    routes: TRANSFER_ROUTES.map((route) => ({ route, rows: [] })),
    negativeIssues: [],
    lastUpdatedAt: lastSync?.at ?? null,
    brands: [],
    collections: [],
  };

  if (!foteskoId || !phuketId || !phanganId) return empty;

  const whIds = [foteskoId, phuketId, phanganId];

  // ---------- остатки + карточка товара ----------
  const stock = await db
    .select({
      variantId: schema.variantStock.variantId,
      warehouseId: schema.variantStock.warehouseId,
      quantity: schema.variantStock.quantity,
      sku: schema.productVariants.sku,
      size: schema.productVariants.size,
      color: schema.productVariants.color,
      createdAt: schema.productVariants.createdAt,
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
    .innerJoin(schema.products, eq(schema.productVariants.productId, schema.products.id))
    .innerJoin(schema.collections, eq(schema.products.collectionId, schema.collections.id))
    .where(
      and(
        inArray(schema.variantStock.warehouseId, whIds),
        eq(schema.productVariants.isArchived, false),
        eq(schema.products.isArchived, false),
        eq(schema.collections.isArchived, false),
      ),
    );

  // «не повторять» — та же исключающая логика, что и в «Пора заказывать»:
  // человек уже решил, что этой моделью не занимаемся.
  const excludedRows = await db
    .select({ variantId: schema.replenishPlan.variantId })
    .from(schema.replenishPlan)
    .where(eq(schema.replenishPlan.excluded, true));
  const excluded = new Set(excludedRows.map((r) => r.variantId));

  interface Bucket0 {
    sku: string;
    productId: string;
    productName: string;
    size: string | null;
    color: string | null;
    collectionId: string;
    collectionName: string;
    createdAt: string;
    qty: Record<string, number>; // warehouseId -> raw quantity
  }
  const byVariant = new Map<string, Bucket0>();
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
        collectionId: s.collectionId,
        collectionName: s.collectionName,
        createdAt: s.createdAt,
        qty: {},
      };
      byVariant.set(s.variantId, b);
    }
    b.qty[s.warehouseId] = Number(s.quantity);
  }

  const variantIds = [...byVariant.keys()];

  // ---------- продажи за 365 дней, по варианту+складу+дню ----------
  const since365 = daysAgoIso(365);
  const salesRows = variantIds.length
    ? await db
        .select({
          variantId: schema.variantSalesDaily.variantId,
          warehouseId: schema.variantSalesDaily.warehouseId,
          day: schema.variantSalesDaily.day,
          units: schema.variantSalesDaily.units,
        })
        .from(schema.variantSalesDaily)
        .where(
          and(
            inArray(schema.variantSalesDaily.variantId, variantIds),
            gte(schema.variantSalesDaily.day, since365),
          ),
        )
    : [];

  const since90 = daysAgoIso(90);
  const since180 = daysAgoIso(180);

  interface SalesAgg {
    sold90: number;
    sold180: number;
    sold365: number;
    lastSaleAt: string | null;
  }
  const salesByVariantWarehouse = new Map<string, SalesAgg>();
  for (const r of salesRows) {
    if (!r.warehouseId) continue; // продажи без привязки к складу здесь не участвуют
    const key = `${r.variantId}|${r.warehouseId}`;
    let agg = salesByVariantWarehouse.get(key);
    if (!agg) {
      agg = { sold90: 0, sold180: 0, sold365: 0, lastSaleAt: null };
      salesByVariantWarehouse.set(key, agg);
    }
    const units = Number(r.units);
    if (units > 0) {
      agg.sold365 += units;
      if (r.day >= since180) agg.sold180 += units;
      if (r.day >= since90) agg.sold90 += units;
      if (!agg.lastSaleAt || r.day > agg.lastSaleAt) agg.lastSaleAt = r.day;
    }
  }

  const salesFor = (variantId: string, warehouseId: string): SalesAgg =>
    salesByVariantWarehouse.get(`${variantId}|${warehouseId}`) ?? {
      sold90: 0,
      sold180: 0,
      sold365: 0,
      lastSaleAt: null,
    };

  function periodValue(agg: SalesAgg, p: AnalysisPeriod): number {
    if (p === "90d") return agg.sold90;
    if (p === "6m") return agg.sold180;
    return agg.sold365;
  }
  const period = filters.period ?? "12m";

  // ---------- считаем по каждому варианту ----------
  const negativeIssues: NegativeStockIssue[] = [];
  const seenNegative = new Set<string>();
  const pushNegative = (variantId: string, b: Bucket0, warehouseId: string, whName: string) => {
    const key = `${variantId}|${warehouseId}`;
    if (seenNegative.has(key)) return;
    seenNegative.add(key);
    negativeIssues.push({
      variantId,
      sku: b.sku,
      productName: b.productName,
      warehouse: whName,
      quantity: b.qty[warehouseId] ?? 0,
    });
  };

  const rowsByRoute: Record<RouteKey, TransferTableRow[]> = {
    "fotesko-phuket": [],
    "phuket-phangan": [],
    "phangan-phuket": [],
  };

  const brandsSeen = new Set<string>();

  for (const [variantId, b] of byVariant) {
    const foteskoQty = b.qty[foteskoId] ?? 0;
    const phuketQty = b.qty[phuketId] ?? 0;
    const phanganQty = b.qty[phanganId] ?? 0;

    if (foteskoQty < 0) pushNegative(variantId, b, foteskoId, FOTESKO);
    if (phuketQty < 0) pushNegative(variantId, b, phuketId, PHUKET);
    if (phanganQty < 0) pushNegative(variantId, b, phanganId, PHANGAN);

    const phuketSalesAgg = salesFor(variantId, phuketId);
    const phanganSalesAgg = salesFor(variantId, phanganId);
    const hasAnySalesEver = phuketSalesAgg.sold365 > 0 || phanganSalesAgg.sold365 > 0;
    const isNew = isNewArrival({ createdAt: b.createdAt, hasAnySalesEver });

    const brand = detectBrand(b.productName, b.collectionName);
    brandsSeen.add(brand);

    const phuketSales: PointSales = {
      sold90d: phuketSalesAgg.sold90,
      sold12m: phuketSalesAgg.sold365,
      lastSaleAt: phuketSalesAgg.lastSaleAt,
    };
    const phanganSales: PointSales = {
      sold90d: phanganSalesAgg.sold90,
      sold12m: phanganSalesAgg.sold365,
      lastSaleAt: phanganSalesAgg.lastSaleAt,
    };

    const common = {
      variantId,
      sku: b.sku,
      productId: b.productId,
      productName: b.productName,
      size: b.size,
      color: b.color,
      collectionId: b.collectionId,
      collectionName: b.collectionName,
      brand,
      isNew,
      stock: { fotesko: foteskoQty, phuket: phuketQty, phangan: phanganQty },
      negativeStock: {
        fotesko: foteskoQty < 0,
        phuket: phuketQty < 0,
        phangan: phanganQty < 0,
      },
      hasNegativeStock: foteskoQty < 0 || phuketQty < 0 || phanganQty < 0,
      sales: {
        phuket90: phuketSalesAgg.sold90,
        phangan90: phanganSalesAgg.sold90,
        phuket12m: phuketSalesAgg.sold365,
        phangan12m: phanganSalesAgg.sold365,
        phuketPeriod: periodValue(phuketSalesAgg, period),
        phanganPeriod: periodValue(phanganSalesAgg, period),
      },
    };

    // --- 1) Fotesko → Phuket ---
    const fotesko = evaluateFoteskoLeg({
      foteskoRawQty: foteskoQty,
      phuketRawQty: phuketQty,
      phanganRawQty: phanganQty,
      phuketSales,
      phanganSales,
      isNew,
    });
    if (fotesko) {
      const reasonCode: ReasonCode = fotesko.reason;
      // "Закончился на {dest}" для этого маршрута — про Таиланд в целом (см.
      // комментарий у evaluateFoteskoLeg: количество считается сразу на оба
      // острова), поэтому dest должен называть именно тот остров(а), где
      // реально пусто, а не всегда "Phuket" — иначе для товара, который
      // кончился на Пангане при полном Пхукете, текст был бы неверным.
      const phuketOut = phuketQty <= 0;
      const phanganOut = phanganQty <= 0;
      const foteskoDest =
        phuketOut && phanganOut
          ? `${PHUKET} и ${PHANGAN}`
          : phanganOut
            ? PHANGAN
            : PHUKET;
      rowsByRoute["fotesko-phuket"].push({
        ...common,
        from: FOTESKO,
        to: PHUKET,
        lastSaleAtDest: phuketSalesAgg.lastSaleAt,
        suggestedQty: fotesko.sendQty,
        maxQty: fotesko.foteskoAvailable,
        reason: formatReason(reasonCode, { dest: foteskoDest, source: FOTESKO }),
        bucket: fotesko.bucket,
        lastUnitWarning: false,
        priority: priorityScore({
          destAvailable: phuketQty < 0 ? 0 : phuketQty,
          destSoldOutRecently: phuketQty <= 0 && phuketSalesAgg.sold90 > 0,
          sold90d: phuketSalesAgg.sold90 + phanganSalesAgg.sold90,
          sold12m: phuketSalesAgg.sold365 + phanganSalesAgg.sold365,
          isNew,
        }),
      });
    }

    // --- 2) Phuket → Phangan ---
    const toPhangan = evaluateBoutiqueLeg({
      sourceRawQty: phuketQty,
      destRawQty: phanganQty,
      sourceSales: phuketSales,
      destSales: phanganSales,
      isNew,
    });
    if (toPhangan && toPhangan.sendQty > 0) {
      rowsByRoute["phuket-phangan"].push({
        ...common,
        from: PHUKET,
        to: PHANGAN,
        lastSaleAtDest: phanganSalesAgg.lastSaleAt,
        suggestedQty: toPhangan.sendQty,
        maxQty: toPhangan.sourceAvailable,
        reason: formatReason(toPhangan.reason, { dest: PHANGAN, source: PHUKET }),
        bucket: toPhangan.bucket,
        lastUnitWarning: toPhangan.lastUnitWarning,
        priority: priorityScore({
          destAvailable: toPhangan.destAvailable,
          destSoldOutRecently: toPhangan.destAvailable === 0 && phanganSalesAgg.sold90 > 0,
          sold90d: phanganSalesAgg.sold90,
          sold12m: phanganSalesAgg.sold365,
          isNew,
        }),
      });
    } else if (toPhangan && toPhangan.bucket === "needsPurchase") {
      rowsByRoute["phuket-phangan"].push({
        ...common,
        from: PHUKET,
        to: PHANGAN,
        lastSaleAtDest: phanganSalesAgg.lastSaleAt,
        suggestedQty: 0,
        maxQty: toPhangan.sourceAvailable,
        reason: formatReason("NEEDS_PURCHASE"),
        bucket: "needsPurchase",
        lastUnitWarning: false,
        priority: 0,
      });
    }

    // --- 3) Phangan → Phuket ---
    const toPhuket = evaluateBoutiqueLeg({
      sourceRawQty: phanganQty,
      destRawQty: phuketQty,
      sourceSales: phanganSales,
      destSales: phuketSales,
      isNew,
    });
    if (toPhuket && toPhuket.sendQty > 0) {
      rowsByRoute["phangan-phuket"].push({
        ...common,
        from: PHANGAN,
        to: PHUKET,
        lastSaleAtDest: phuketSalesAgg.lastSaleAt,
        suggestedQty: toPhuket.sendQty,
        maxQty: toPhuket.sourceAvailable,
        reason: formatReason(toPhuket.reason, { dest: PHUKET, source: PHANGAN }),
        bucket: toPhuket.bucket,
        lastUnitWarning: toPhuket.lastUnitWarning,
        priority: priorityScore({
          destAvailable: toPhuket.destAvailable,
          destSoldOutRecently: toPhuket.destAvailable === 0 && phuketSalesAgg.sold90 > 0,
          sold90d: phuketSalesAgg.sold90,
          sold12m: phuketSalesAgg.sold365,
          isNew,
        }),
      });
    } else if (toPhuket && toPhuket.bucket === "needsPurchase") {
      rowsByRoute["phangan-phuket"].push({
        ...common,
        from: PHANGAN,
        to: PHUKET,
        lastSaleAtDest: phuketSalesAgg.lastSaleAt,
        suggestedQty: 0,
        maxQty: toPhuket.sourceAvailable,
        reason: formatReason("NEEDS_PURCHASE"),
        bucket: "needsPurchase",
        lastUnitWarning: false,
        priority: 0,
      });
    }
  }

  // ---------- фильтры (общие для всех вкладок) ----------
  function applyFilters(rows: TransferTableRow[]): TransferTableRow[] {
    let out = rows;
    if (filters.q) {
      const needle = filters.q.trim().toLowerCase();
      if (needle) {
        out = out.filter(
          (r) =>
            r.sku.toLowerCase().includes(needle) ||
            r.productName.toLowerCase().includes(needle),
        );
      }
    }
    if (filters.brand) out = out.filter((r) => r.brand === filters.brand);
    if (filters.collectionId) out = out.filter((r) => r.collectionId === filters.collectionId);
    if (filters.onlySoldOut) out = out.filter((r) => r.bucket === "moveNow");
    if (filters.onlyLowStock) out = out.filter((r) => r.bucket === "lowStock");
    if (filters.onlyNew) out = out.filter((r) => r.isNew);
    if (filters.hideNoSales) out = out.filter((r) => r.bucket !== "unconfirmedDemand");
    return out;
  }

  const collMap = new Map<string, string>();
  for (const b of byVariant.values()) collMap.set(b.collectionId, b.collectionName);

  const routes: RouteRows[] = TRANSFER_ROUTES.map((route) => {
    const rows = applyFilters(rowsByRoute[route.key]).sort((a, c) => {
      if (a.bucket !== c.bucket) {
        const order: Bucket[] = [
          "moveNow",
          "lowStock",
          "newArrivals",
          "needsPurchase",
          "unconfirmedDemand",
        ];
        return order.indexOf(a.bucket) - order.indexOf(c.bucket);
      }
      return c.priority - a.priority || a.sku.localeCompare(c.sku);
    });
    return { route, rows };
  });

  return {
    routes,
    negativeIssues,
    lastUpdatedAt: lastSync?.at ?? null,
    brands: [...brandsSeen].sort((a, b) =>
      a === DEFAULT_BRAND ? -1 : b === DEFAULT_BRAND ? 1 : a.localeCompare(b),
    ),
    collections: [...collMap.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}
