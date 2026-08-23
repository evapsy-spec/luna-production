/**
 * Чистый старт перед первой синхронизацией с живым Ainur.
 *
 * Удаляет ВСЕ данные, кроме пользователей и токена Ainur, и создаёт базовые
 * склады тканей. Нужен потому, что демо-коллекции называются так же, как
 * настоящие («Silk collection», «Shiva Shakti»), но привязаны к вымышленным
 * id категорий Ainur — после синхронизации появились бы дубли, и было бы
 * непонятно, где реальные остатки, а где придуманные.
 *
 * Запуск: npm run db:fresh
 *
 * Что остаётся: пользователи (чтобы не терять доступ) и токен Ainur.
 * Что удаляется: коллекции, изделия, SKU, остатки, продажи, перемещения,
 * ткани, поставщики, фабрики, заказы, заявки, календарь, аудит-лог.
 */
import { rawSqlite } from "../src/lib/db/client";

const KEEP_SETTINGS = ["ainur_api_token"];

// Порядок важен: сначала таблицы со ссылками, потом те, на которые ссылаются
const TABLES_TO_CLEAR = [
  "fabric_reservations",
  "fabric_purchase_lines",
  "fabric_purchases",
  "fabric_lots",
  "fabric_stock",
  "bom_fabric_lines",
  "bom_accessory_lines",
  "pattern_files",
  "defect_credits",
  "order_payments",
  "production_order_lines",
  "production_orders",
  "factory_prices",
  "factory_collections",
  "factories",
  "fabrics",
  "suppliers",
  "accessories",
  "variant_sales_daily",
  "stock_movements",
  "variant_stock",
  "stock_snapshots",
  "product_variants",
  "products",
  "collection_launches",
  "collections",
  "warehouses",
  "sync_runs",
  "audit_log",
];

function main() {
  const db = rawSqlite();

  const users = db.prepare("SELECT COUNT(*) AS c FROM users").get() as {
    c: number;
  };
  if (!users || users.c === 0) {
    console.error(
      "В базе нет пользователей — сначала создайте их (npm run db:seed), иначе войти будет нельзя.",
    );
    process.exit(1);
  }

  console.log("Очищаю базу перед подключением живого Ainur...\n");

  db.exec("PRAGMA foreign_keys = OFF");
  db.exec("BEGIN");
  try {
    for (const table of TABLES_TO_CLEAR) {
      const before = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as {
        c: number;
      };
      db.exec(`DELETE FROM ${table}`);
      if (before.c > 0) console.log(`  ${table}: удалено ${before.c}`);
    }

    // настройки: сохраняем только токен Ainur
    const placeholders = KEEP_SETTINGS.map(() => "?").join(",");
    db.prepare(`DELETE FROM settings WHERE key NOT IN (${placeholders})`).run(
      ...KEEP_SETTINGS,
    );

    // Склады тканей Ainur не знает — их ведём только мы, поэтому создаём сразу
    const now = new Date().toISOString();
    const insertWarehouse = db.prepare(
      "INSERT INTO warehouses (id, name, kind, country, is_active, created_at) VALUES (?,?,?,?,1,?)",
    );
    for (const [name, country] of [
      ["Склад тканей Бали", "ID"],
      ["Склад тканей Панган", "TH"],
    ]) {
      insertWarehouse.run(crypto.randomUUID(), name, "FABRIC", country, now);
    }

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    console.error("Не удалось очистить базу:", (err as Error).message);
    process.exit(1);
  }
  db.exec("PRAGMA foreign_keys = ON");

  console.log("\nГотово. В базе остались только пользователи и токен Ainur.");
  console.log("Созданы два склада тканей — их Ainur не знает, ведём сами.");
  console.log("\nДальше: страница «Синхронизация» → «Обновить всё».");
  console.log(
    "Оттуда придут коллекции, изделия, SKU, остатки по складам, продажи и перемещения.",
  );
  console.log(
    "Ткани, фабрики и состав изделий (BOM) заводятся в приложении вручную —\n" +
      "в Ainur этих данных нет.",
  );
}

main();
