/**
 * Склад США: что заказано, что пора заказывать, что заканчивается.
 *
 * Три блока страницы «Заказы → Склад США» и две карточки на главной.
 *
 *  1. «Что заказано» — активные заказы фабрики Джонни (в производстве / готово,
 *     то есть ещё не принятые на склад), позиции сгруппированы по модели и цвету.
 *  2. «Нужно заказать» — остаток США ниже порога уровня, и этой позиции нет
 *     в активном заказе.
 *  3. «Заканчивается» — остаток ниже порога, но позиция уже есть в активном
 *     заказе: заказывать повторно не нужно, показываем для спокойствия.
 *
 * Правила (SKU, уровни, пороги, дозаказ) — в @/lib/usa-reorder-rules.
 * Остатки США — из variant_stock (приходят из Ainur), заказы — из production_orders.
 */
import { and, eq, inArray, like, or } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import {
  USA_LABEL_BY_SKU,
  USA_RULES,
  USA_WAREHOUSE_NAMES,
} from "@/lib/usa-reorder-rules";
import { evaluateUsaRules, type RuleResult } from "@/lib/usa-reorder-logic";

export { evaluateUsaRules };
export type { RuleResult, RuleState } from "@/lib/usa-reorder-logic";

/** Статусы заказа, при которых товар ещё не на складе */
export const USA_ACTIVE_ORDER_STATUSES = ["IN_PRODUCTION", "READY"] as const;

export interface UsaOrderGroup {
  model: string;
  total: number;
  colors: { color: string; qty: number }[];
}

export interface UsaActiveOrder {
  id: string;
  number: string;
  factoryName: string;
  status: string;
  plannedReadyAt: string | null;
  createdAt: string;
  note: string | null;
  units: number;
  groups: UsaOrderGroup[];
}

export interface UsaOverview {
  orders: UsaActiveOrder[];
  need: RuleResult[];
  covered: RuleResult[];
  /** правила, у которых ни один SKU не найден в базе — подсветить, чтобы не пропустить */
  unknown: RuleResult[];
  totalUnitsInOrders: number;
}

export async function getUsaOverview(): Promise<UsaOverview> {
  // ---- остатки США по SKU ----
  const allSkus = [...new Set(USA_RULES.flatMap((r) => r.skus))];
  const stockRows = await db
    .select({
      sku: schema.productVariants.sku,
      qty: schema.variantStock.quantity,
      warehouse: schema.warehouses.name,
    })
    .from(schema.productVariants)
    .leftJoin(
      schema.variantStock,
      eq(schema.variantStock.variantId, schema.productVariants.id),
    )
    .leftJoin(
      schema.warehouses,
      eq(schema.warehouses.id, schema.variantStock.warehouseId),
    )
    .where(inArray(schema.productVariants.sku, allSkus));

  const stockBySku = new Map<string, number>();
  for (const row of stockRows) {
    // SKU есть в базе — значит известен; остаток складываем только по складу США
    if (!stockBySku.has(row.sku)) stockBySku.set(row.sku, 0);
    if (
      row.warehouse &&
      (USA_WAREHOUSE_NAMES as readonly string[]).includes(row.warehouse)
    ) {
      stockBySku.set(row.sku, (stockBySku.get(row.sku) ?? 0) + (row.qty ?? 0));
    }
  }

  // ---- активные заказы фабрики Джонни ----
  const orderRows = await db
    .select({
      id: schema.productionOrders.id,
      number: schema.productionOrders.number,
      status: schema.productionOrders.status,
      plannedReadyAt: schema.productionOrders.plannedReadyAt,
      createdAt: schema.productionOrders.createdAt,
      note: schema.productionOrders.note,
      factoryName: schema.factories.name,
    })
    .from(schema.productionOrders)
    .innerJoin(
      schema.factories,
      eq(schema.productionOrders.factoryId, schema.factories.id),
    )
    .where(
      and(
        inArray(schema.productionOrders.status, [...USA_ACTIVE_ORDER_STATUSES]),
        or(
          like(schema.factories.name, "%Джонни%"),
          like(schema.factories.name, "%Johnny%"),
        ),
      ),
    );

  const orderIds = orderRows.map((o) => o.id);
  const lineRows = orderIds.length
    ? await db
        .select({
          orderId: schema.productionOrderLines.orderId,
          qty: schema.productionOrderLines.quantity,
          sku: schema.productVariants.sku,
          color: schema.productVariants.color,
          productName: schema.products.name,
        })
        .from(schema.productionOrderLines)
        .innerJoin(
          schema.products,
          eq(schema.productionOrderLines.productId, schema.products.id),
        )
        .leftJoin(
          schema.productVariants,
          eq(schema.productionOrderLines.variantId, schema.productVariants.id),
        )
        .where(inArray(schema.productionOrderLines.orderId, orderIds))
    : [];

  const orderedBySku = new Map<string, number>();
  const groupsByOrder = new Map<string, Map<string, Map<string, number>>>();
  for (const l of lineRows) {
    if (l.sku) orderedBySku.set(l.sku, (orderedBySku.get(l.sku) ?? 0) + l.qty);
    const label = l.sku ? USA_LABEL_BY_SKU.get(l.sku) : undefined;
    const model = label?.model ?? l.productName;
    const color = label?.color ?? l.color ?? "—";
    const byModel = groupsByOrder.get(l.orderId) ?? new Map();
    const byColor = byModel.get(model) ?? new Map();
    byColor.set(color, (byColor.get(color) ?? 0) + l.qty);
    byModel.set(model, byColor);
    groupsByOrder.set(l.orderId, byModel);
  }

  const orders: UsaActiveOrder[] = orderRows
    .map((o) => {
      const byModel = groupsByOrder.get(o.id) ?? new Map();
      const groups: UsaOrderGroup[] = [...byModel.entries()].map(
        ([model, byColor]) => {
          const colors = [...byColor.entries()]
            .map(([color, qty]) => ({ color, qty }))
            .sort((a, b) => b.qty - a.qty);
          return { model, total: colors.reduce((s, c) => s + c.qty, 0), colors };
        },
      );
      return {
        ...o,
        groups,
        units: groups.reduce((s, g) => s + g.total, 0),
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const results = evaluateUsaRules(USA_RULES, stockBySku, orderedBySku);
  const byUrgency = (a: RuleResult, b: RuleResult) =>
    a.rule.tier - b.rule.tier || (a.stock ?? 0) - (b.stock ?? 0);

  return {
    orders,
    need: results.filter((r) => r.state === "need").sort(byUrgency),
    covered: results.filter((r) => r.state === "covered").sort(byUrgency),
    unknown: results.filter((r) => r.state === "unknown"),
    totalUnitsInOrders: orders.reduce((s, o) => s + o.units, 0),
  };
}
