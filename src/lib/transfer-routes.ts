/**
 * Разрешённые направления перемещений между складами — единственный
 * источник правды. Ни в интерфейсе, ни в бизнес-логике ID или названия
 * складов для перемещений не хардкодятся — всё берётся отсюда и из
 * WATCHED_WAREHOUSES / WAREHOUSE_META (@/lib/replenish).
 *
 * Разрешено РОВНО три маршрута. Ни один не ведёт НА Fotesko — это склад
 * производства/поставок, товар с него только уходит на Phuket; дальше, при
 * необходимости, отдельным перемещением на Phangan.
 */
import { WATCHED_WAREHOUSES } from "@/lib/replenish";

const byName = (n: string) => {
  const found = WATCHED_WAREHOUSES.find((w) => w === n);
  if (!found) throw new Error(`Склад "${n}" отсутствует в WATCHED_WAREHOUSES`);
  return found;
};

export const PHANGAN = byName("Phangan");
export const PHUKET = byName("Phuket");
export const FOTESKO = byName("Fotesko Warehouse");

export type RouteKey = "fotesko-phuket" | "phuket-phangan" | "phangan-phuket";

export interface RouteDef {
  key: RouteKey;
  from: string;
  to: string;
  label: string;
}

/** Порядок — это и порядок вкладок на странице. */
export const TRANSFER_ROUTES: readonly RouteDef[] = [
  { key: "fotesko-phuket", from: FOTESKO, to: PHUKET, label: "Fotesko → Phuket" },
  { key: "phuket-phangan", from: PHUKET, to: PHANGAN, label: "Phuket → Phangan" },
  { key: "phangan-phuket", from: PHANGAN, to: PHUKET, label: "Phangan → Phuket" },
];

export function routeByKey(key: string): RouteDef {
  const found = TRANSFER_ROUTES.find((r) => r.key === key);
  return found ?? TRANSFER_ROUTES[0];
}
