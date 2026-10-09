import { sql } from "drizzle-orm";
import { schema } from "@/lib/db/client";
import { USA_ORDER_NOTE_MARKER } from "@/lib/usa-reorder-rules";

/** SQL-условие: заказ НЕ для склада США (см. USA_ORDER_NOTE_MARKER). */
export function notUsaOrder() {
  return sql`(${schema.productionOrders.note} IS NULL OR ${schema.productionOrders.note} NOT LIKE ${"%" + USA_ORDER_NOTE_MARKER + "%"})`;
}
