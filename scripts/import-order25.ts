/**
 * Загрузка заказа № 25 (склад США, фабрика Джонни) из ORDER.xlsx, вкладка «Order 25».
 *
 * По умолчанию — только проверка («сухой прогон»): печатает, что будет создано,
 * и ничего не пишет. Чтобы записать в базу:
 *
 *   npx tsx --env-file=.env scripts/import-order25.ts --apply
 *
 * Скрипт идемпотентен по номеру заказа: если PO-2026-011 уже есть, пропускает.
 * Цены пошива — из вкладки (IDR за штуку), курс тот же, что в import-johnny: 1 IDR = 0.001853 THB.
 * По Black Panther цены во вкладке не заполнены — цена пошива 0, в примечании это сказано.
 * Для блоков «Нужно заказать / Заканчивается» важны только SKU и количество.
 */
import { rawSqlite } from "../src/lib/db/client";

const NUMBER = "PO-2026-011";
const FX = 0.001853;
const FACTORY_LIKE = "%Джонни%";
const APPLY = process.argv.includes("--apply");

// [SKU, штук, IDR за штуку, что это в таблице заказов]
const LINES: [string, number, number, string][] = [
  // Men long kimono
  ["00343-1", 10, 140000, "Men Long Kimono / Sun"],
  ["00343-2", 25, 140000, "Men Long Kimono / Moon"],
  ["00300", 20, 140000, "Men Long Kimono / Black&Gold"],
  ["00303", 20, 140000, "Men Long Kimono / Black&Ivory"],
  ["00307", 15, 140000, "Men Long Kimono / Green&Gold"],
  ["00306", 15, 140000, "Men Long Kimono / Red"],
  ["00308", 15, 140000, "Men Long Kimono / Grey&Brown"],
  // Men short kimono
  ["00316-6", 15, 125000, "Men Short Kimono / Black&Gold"],
  ["00316-1", 10, 125000, "Men Short Kimono / Black&Ivory"],
  ["00316-2", 10, 125000, "Men Short Kimono / Red"],
  ["00316-4", 10, 125000, "Men Short Kimono / Grey&Brown"],
  // Boxers
  ["00317-2", 15, 90000, "Boxers / Black&Ivory"],
  ["00317-3", 15, 90000, "Boxers / Red"],
  ["00317-5", 15, 90000, "Boxers / Grey&Brown"],
  // Women long kimono (Shakti)
  ["00672-1", 20, 125000, "Women Kimono Shakti / Black&Gold"],
  ["00672-6", 20, 125000, "Women Kimono Shakti / Grey&Brown"],
  ["00672-2", 10, 125000, "Women Kimono Shakti / Black&Ivory"],
  ["00516", 5, 125000, "Women Kimono Shakti / Fire"],
  ["00495", 4, 125000, "Women Kimono Shakti / Ice"],
  // Women short kimono
  ["00318-1", 15, 100000, "Women Short Kimono / Black&Gold"],
  // Black Panther Jaquard (цены во вкладке не заполнены)
  ["01865", 10, 0, "Kimono Black Panther Jaquard"],
  ["01772", 10, 0, "Shirt Black Panther Jaquard"],
  ["01866", 10, 0, "Unisex pants Black Panther Jaquard"],
];

function main() {
  const db = rawSqlite();
  db.exec("PRAGMA foreign_keys = ON");

  const total = LINES.reduce((s, l) => s + l[1], 0);
  const idr = LINES.reduce((s, l) => s + l[1] * l[2], 0);
  console.log(`Заказ ${NUMBER}: ${LINES.length} строк, ${total} шт, ${idr.toLocaleString("ru-RU")} IDR (по вкладке: 314 шт, 35 350 000 IDR)`);
  if (total !== 314) throw new Error(`Ожидали 314 шт, получили ${total}`);

  if (db.prepare("SELECT id FROM production_orders WHERE number = ?").get(NUMBER)) {
    console.log(`${NUMBER} уже есть, пропускаю`);
    return;
  }
  const factory = db
    .prepare("SELECT id, name FROM factories WHERE name LIKE ?")
    .get(FACTORY_LIKE) as { id: string; name: string } | undefined;
  if (!factory) throw new Error("Фабрика Джонни не найдена (сначала import-johnny.ts)");

  const find = db.prepare(
    "SELECT v.id AS vid, v.product_id AS pid FROM product_variants v WHERE v.sku = ?",
  );
  const resolved: { vid: string; pid: string; qty: number; unitThb: number; src: string }[] = [];
  const missing: string[] = [];
  for (const [sku, qty, unitIdr, src] of LINES) {
    const row = find.get(sku) as { vid: string; pid: string } | undefined;
    if (!row) { missing.push(`${sku} (${src})`); continue; }
    resolved.push({ ...row, qty, unitThb: unitIdr * FX, src });
  }
  if (missing.length) {
    console.log("НЕ НАЙДЕНЫ SKU:", missing.join(", "));
    throw new Error("Есть SKU, которых нет в базе — заказ не создан");
  }

  const sewing = resolved.reduce((s, l) => s + l.qty * l.unitThb, 0);
  console.log(`Фабрика: ${factory.name}. Стоимость пошива по вкладке: ${Math.round(sewing).toLocaleString("ru-RU")} THB`);
  if (!APPLY) {
    console.log("Сухой прогон: ничего не записано. Добавьте --apply, чтобы создать заказ.");
    return;
  }

  const now = new Date().toISOString();
  const oid = crypto.randomUUID();
  const note =
    "Заказ № 25 из ORDER.xlsx (вкладка Order 25), склад США. " +
    "Сумма по вкладке: 35 350 000 IDR (курс 1 IDR = " + FX + " THB). " +
    "Цены по Black Panther (кимоно, рубашка, штаны) во вкладке не заполнены — пошив 0. " +
    "Плановая дата и номер инвойса не указаны.";

  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO production_orders
         (id, number, factory_id, status, planned_ready_at, actual_ready_at,
          snapshot_fabric_cost, snapshot_accessory_cost, snapshot_sewing_cost,
          snapshot_total_cost, snapshot_at, applied_defect_credit, note, created_at, updated_at)
       VALUES (?,?,?,'IN_PRODUCTION',NULL,NULL,0,0,?,?,?,0,?,?,?)`,
    ).run(oid, NUMBER, factory.id, sewing, sewing, now, note, now, now);
    const ins = db.prepare(
      `INSERT INTO production_order_lines
         (id, order_id, product_id, variant_id, size, quantity,
          unit_sewing_cost, unit_fabric_cost, planned_ready_at, qty_produced, qty_defect)
       VALUES (?,?,?,?,?,?,?,0,NULL,0,0)`,
    );
    for (const l of resolved) ins.run(crypto.randomUUID(), oid, l.pid, l.vid, "ONE SIZE", l.qty, l.unitThb);
    db.prepare(
      `INSERT INTO audit_log (id, actor_name, action, entity_type, entity_id, entity_name, changes, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run(
      crypto.randomUUID(), "LUNA (импорт заказа 25)", "CREATE", "production_order", oid, NUMBER,
      JSON.stringify({ source: "ORDER.xlsx / Order 25", units: total, idr, fx: FX }), now,
    );
    db.exec("COMMIT");
    console.log(`Создан ${NUMBER}: ${resolved.length} строк, ${total} шт`);
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

main();
