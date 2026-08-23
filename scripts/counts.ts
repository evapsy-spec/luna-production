/** Быстрая сводка: что лежит в базе. Запуск: npm run db:counts */
import { rawSqlite } from "../src/lib/db/client";
const db = rawSqlite();
const rows: [string, string][] = [
  ["Коллекции", "collections"],
  ["Изделия (модели)", "products"],
  ["SKU (варианты)", "product_variants"],
  ["Остатки по складам", "variant_stock"],
  ["Склады", "warehouses"],
  ["Продажи (день×SKU)", "variant_sales_daily"],
  ["Перемещения", "stock_movements"],
  ["Ткани", "fabrics"],
  ["Фабрики", "factories"],
  ["Заказы на пошив", "production_orders"],
];
for (const [label, table] of rows) {
  const r = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number };
  console.log(`${label.padEnd(22)} ${String(r.c).padStart(7)}`);
}
const stock = db.prepare("SELECT COALESCE(SUM(quantity),0) AS s FROM variant_stock").get() as { s: number };
console.log(`${"Всего единиц товара".padEnd(22)} ${String(stock.s).padStart(7)}`);
