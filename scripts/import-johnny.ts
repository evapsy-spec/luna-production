/**
 * Импорт истории заказов фабрики Джонни (Бали) из файла
 * «BALANCE SHEET EVA MOON 2026 1.xlsx» за 2026 год.
 *
 * Запуск: npx tsx --env-file=.env scripts/import-johnny.ts
 *
 * Решения, принятые Константином 21.08.2026:
 *  - блок без номера инвойса (105 шт, 13 950 000 IDR) — черновик инвойса 075,
 *    НЕ импортируется;
 *  - курс один на весь год: 1 IDR = 0.001853 THB (курс на 21.08.2026);
 *  - строки без SKU (SHIRT UNISEX BPJ, WOMEN SHORT KIMONO Black&Gold) пропущены;
 *  - образцы вынесены в отдельные заказы со статусом «образец».
 *
 * Скрипт идемпотентен по номеру заказа: если PO-2026-0NN уже есть, он пропускается.
 */
import { rawSqlite } from "../src/lib/db/client";

interface PlanLine {
  sku?: string;
  sampleName?: string;
  size: string;
  qty: number;
  unitIdr: number;
  src: string;
}
interface PlanOrder {
  number: string;
  kind: "PRODUCTION" | "SAMPLE";
  inv: string;
  date: string | null;
  ship: string | null;
  awb: string | null;
  lines: PlanLine[];
}
interface Plan {
  fx: number;
  orders: PlanOrder[];
  sampleProducts: string[];
  skipped: { inv: string; style: string; color: string; qty: number; amt: number; why?: string }[];
}

const PLAN: Plan = {
  "fx": 0.001853,
  "orders": [
    {
      "number": "PO-2026-001",
      "kind": "PRODUCTION",
      "inv": "001",
      "date": "2026-01-19",
      "ship": "2026-01-19",
      "awb": null,
      "lines": [
        {
          "sku": "01865",
          "size": "ONE SIZE",
          "qty": 10,
          "unitIdr": 150000,
          "src": "LONG MEN KIMONO NEW / BLACK PANTHER JACQUARD"
        },
        {
          "sku": "01866",
          "size": "ONE SIZE",
          "qty": 10,
          "unitIdr": 160000,
          "src": "LONG PANT(UNISEX PANT)) / BLACK PANTHER JACQUARD"
        }
      ]
    },
    {
      "number": "PO-2026-002",
      "kind": "SAMPLE",
      "inv": "001",
      "date": "2026-01-19",
      "ship": "2026-01-19",
      "awb": null,
      "lines": [
        {
          "sampleName": "New Slip Dress (Viscose Satin Gold)",
          "size": "ONE SIZE",
          "qty": 2,
          "unitIdr": 250000.0,
          "src": "NEW SLIP DRESS / VISCOSE SATIN GOLD"
        },
        {
          "sampleName": "New Shirt Crop (Viscose Satin Gold)",
          "size": "ONE SIZE",
          "qty": 1,
          "unitIdr": 150000.0,
          "src": "NEW SHIRT CROP / VISCOSE SATIN GOLD"
        },
        {
          "sampleName": "New Long Pant Rope (Viscose Satin Gold)",
          "size": "ONE SIZE",
          "qty": 1,
          "unitIdr": 150000.0,
          "src": "NEW LONG PANT ROPE / VISCOSE SATIN GOLD"
        },
        {
          "sampleName": "Bra Top (Viscose Satin Deep Ocean)",
          "size": "ONE SIZE",
          "qty": 1,
          "unitIdr": 170000.0,
          "src": "BRA TOP / VISCOSE SATIN DEEP OCEAN"
        }
      ]
    },
    {
      "number": "PO-2026-003",
      "kind": "PRODUCTION",
      "inv": "065",
      "date": "2026-02-20",
      "ship": "2026-02-20",
      "awb": null,
      "lines": [
        {
          "sku": "01935",
          "size": "ONE SIZE",
          "qty": 8,
          "unitIdr": 95000,
          "src": "NEW BOXER / BLACK PANTHER JACQUARD"
        },
        {
          "sku": "01940",
          "size": "ONE SIZE",
          "qty": 16,
          "unitIdr": 25000,
          "src": "FAN POUCH / BLACK VELVET & SATIN"
        },
        {
          "sku": "00398-2",
          "size": "ONE SIZE",
          "qty": 6,
          "unitIdr": 150000,
          "src": "KIMONO SOFI / DEEP OCEAN"
        }
      ]
    },
    {
      "number": "PO-2026-004",
      "kind": "SAMPLE",
      "inv": "065",
      "date": "2026-02-20",
      "ship": "2026-02-20",
      "awb": null,
      "lines": [
        {
          "sampleName": "New Slip Dress (Viscose Satin Gold)",
          "size": "ONE SIZE",
          "qty": 1,
          "unitIdr": 250000.0,
          "src": "NEW SLIP DRESS / VISCOSE SATIN GOLD"
        }
      ]
    },
    {
      "number": "PO-2026-005",
      "kind": "PRODUCTION",
      "inv": "070",
      "date": "2026-04-17",
      "ship": "2026-04-17",
      "awb": null,
      "lines": [
        {
          "sku": "01865",
          "size": "ONE SIZE",
          "qty": 20,
          "unitIdr": 150000,
          "src": "MEN LONG KIMONO NEW / "
        },
        {
          "sku": "01760-3",
          "size": "M-L",
          "qty": 10,
          "unitIdr": 75000,
          "src": "RAGLAN SLEEVE T-SHIRT / цвет не указан → принят Black"
        },
        {
          "sku": "01760-4",
          "size": "L-XL",
          "qty": 10,
          "unitIdr": 75000,
          "src": "RAGLAN SLEEVE T-SHIRT / цвет не указан → принят Black"
        },
        {
          "sku": "01757-1",
          "size": "M-L",
          "qty": 10,
          "unitIdr": 75000,
          "src": "ASTMMETRIC T-SHIRT / цвет не указан → принят Black"
        },
        {
          "sku": "01757-2",
          "size": "L-XL",
          "qty": 10,
          "unitIdr": 75000,
          "src": "ASTMMETRIC T-SHIRT / цвет не указан → принят Black"
        },
        {
          "sku": "01935",
          "size": "ONE SIZE",
          "qty": 10,
          "unitIdr": 95000,
          "src": "BOXER NEW / "
        },
        {
          "sku": "01940",
          "size": "ONE SIZE",
          "qty": 11,
          "unitIdr": 25000,
          "src": "FAN POCH / "
        }
      ]
    },
    {
      "number": "PO-2026-006",
      "kind": "PRODUCTION",
      "inv": "071",
      "date": "2026-04-25",
      "ship": "2026-04-17",
      "awb": null,
      "lines": [
        {
          "sku": "01762",
          "size": "ONE SIZE",
          "qty": 10,
          "unitIdr": 150000,
          "src": "KIMONO SOFI / GOLD"
        },
        {
          "sku": "02089-1",
          "size": "XS-S",
          "qty": 4,
          "unitIdr": 170000,
          "src": "TOP BRALATTE / BLUE"
        },
        {
          "sku": "02089-2",
          "size": "S-M",
          "qty": 6,
          "unitIdr": 170000,
          "src": "TOP BRALATTE / BLUE"
        },
        {
          "sku": "02089-3",
          "size": "M-L",
          "qty": 4,
          "unitIdr": 170000,
          "src": "TOP BRALATTE / BLUE"
        }
      ]
    },
    {
      "number": "PO-2026-007",
      "kind": "PRODUCTION",
      "inv": "072",
      "date": "2026-05-28",
      "ship": null,
      "awb": null,
      "lines": [
        {
          "sku": "00468",
          "size": "ONE SIZE",
          "qty": 5,
          "unitIdr": 140000,
          "src": "MEN LONG KIMONO / FIRE"
        },
        {
          "sku": "00343-1",
          "size": "ONE SIZE",
          "qty": 5,
          "unitIdr": 140000,
          "src": "MEN LONG KIMONO / SUN"
        },
        {
          "sku": "00343-2",
          "size": "ONE SIZE",
          "qty": 20,
          "unitIdr": 140000,
          "src": "MEN LONG KIMONO / MOON"
        },
        {
          "sku": "00303",
          "size": "ONE SIZE",
          "qty": 15,
          "unitIdr": 140000,
          "src": "MEN LONG KIMONO / BLACK & IVORY"
        },
        {
          "sku": "00307",
          "size": "ONE SIZE",
          "qty": 15,
          "unitIdr": 140000,
          "src": "MEN LONG KIMONO / GREEN & GOLD"
        },
        {
          "sku": "00300",
          "size": "ONE SIZE",
          "qty": 10,
          "unitIdr": 140000,
          "src": "MEN LONG KIMONO / BLACK & GOLD"
        },
        {
          "sku": "00308",
          "size": "ONE SIZE",
          "qty": 5,
          "unitIdr": 140000,
          "src": "MEN LONG KIMONO / GREY & BROWN"
        },
        {
          "sku": "00672-1",
          "size": "ONE SIZE",
          "qty": 15,
          "unitIdr": 150000,
          "src": "KIMONO SKAHTI / BLACK & GOLD"
        },
        {
          "sku": "00672-6",
          "size": "ONE SIZE",
          "qty": 20,
          "unitIdr": 150000,
          "src": "KIMONO SKAHTI / GREY & BROWN"
        }
      ]
    },
    {
      "number": "PO-2026-008",
      "kind": "SAMPLE",
      "inv": "072",
      "date": "2026-05-28",
      "ship": null,
      "awb": null,
      "lines": [
        {
          "sampleName": "Short Pant Frill Women (White Embroidery)",
          "size": "ONE SIZE",
          "qty": 1,
          "unitIdr": 60000.0,
          "src": "SHORT PANT FRILL WOMEN / WHITE EMBROIDERY"
        },
        {
          "sampleName": "New Kimono (White Embroidery)",
          "size": "ONE SIZE",
          "qty": 1,
          "unitIdr": 125000.0,
          "src": "NEW KIMONO / WHITE EMBROIDERY"
        },
        {
          "sampleName": "Babydoll Dress With Open Back (White Embroidery)",
          "size": "ONE SIZE",
          "qty": 1,
          "unitIdr": 200000.0,
          "src": "BABYDOLL DRESS WITH OPEN BACK / WHITE EMBROIDERY"
        },
        {
          "sampleName": "Short Pant Women (White Embroidery)",
          "size": "ONE SIZE",
          "qty": 1,
          "unitIdr": 50000.0,
          "src": "SHORT PANT WOMEN / WHITE EMBROIDERY"
        },
        {
          "sampleName": "Frill Top (Cream Embroidery)",
          "size": "ONE SIZE",
          "qty": 1,
          "unitIdr": 50000.0,
          "src": "FRILL TOP / CREAM EMBROIDERY"
        },
        {
          "sampleName": "Frill Skirt (Cream Embroidery)",
          "size": "ONE SIZE",
          "qty": 1,
          "unitIdr": 150000.0,
          "src": "FRILL SKIRT / CREAM EMBROIDERY"
        },
        {
          "sampleName": "Slip Dress",
          "size": "ONE SIZE",
          "qty": 3,
          "unitIdr": 150000.0,
          "src": "SLIP DRESS / "
        }
      ]
    },
    {
      "number": "PO-2026-009",
      "kind": "SAMPLE",
      "inv": "073",
      "date": "2026-06-29",
      "ship": null,
      "awb": null,
      "lines": [
        {
          "sampleName": "Long Dress (Viscose White)",
          "size": "ONE SIZE",
          "qty": 1,
          "unitIdr": 217500.0,
          "src": "LONG DRESS / VISCOSE WHITE"
        },
        {
          "sampleName": "New Short Kimono (Moon)",
          "size": "ONE SIZE",
          "qty": 2,
          "unitIdr": 203000.0,
          "src": "NEW SHORT KIMONO / MOON"
        },
        {
          "sampleName": "Jacket With Ties (Denim 7 0z Blue)",
          "size": "ONE SIZE",
          "qty": 1,
          "unitIdr": 449500.0,
          "src": "JACKET WITH TIES / DENIM 7 0Z BLUE"
        },
        {
          "sampleName": "Pajama Mini Dress (Cotton Embroidery)",
          "size": "ONE SIZE",
          "qty": 1,
          "unitIdr": 203000.0,
          "src": "PAJAMA MINI DRESS / COTTON EMBROIDERY"
        },
        {
          "sampleName": "Slip Dress (Satin Gold)",
          "size": "ONE SIZE",
          "qty": 1,
          "unitIdr": 217500.0,
          "src": "SLIIP DRESS / SATIN GOLD"
        }
      ]
    },
    {
      "number": "PO-2026-010",
      "kind": "PRODUCTION",
      "inv": "075",
      "date": "2026-08-20",
      "ship": "2026-08-20",
      "awb": "1000088121",
      "lines": [
        {
          "sku": "00306",
          "size": "ONE SIZE",
          "qty": 5,
          "unitIdr": 140000,
          "src": "MEN LONG KIMONO / RED & BLACK"
        },
        {
          "sku": "00343-1",
          "size": "ONE SIZE",
          "qty": 15,
          "unitIdr": 140000,
          "src": "MEN LONG KIMONO / SUN"
        },
        {
          "sku": "00343-4",
          "size": "ONE SIZE",
          "qty": 5,
          "unitIdr": 140000,
          "src": "MEN LONG KIMONO / ICE"
        },
        {
          "sku": "00300",
          "size": "ONE SIZE",
          "qty": 25,
          "unitIdr": 140000,
          "src": "MEN LONG KIMONO / BLACK & GOLD"
        },
        {
          "sku": "00317-3",
          "size": "ONE SIZE",
          "qty": 10,
          "unitIdr": 90000,
          "src": "MEN'S BOXER (SHORT) / RED & BLACK"
        },
        {
          "sku": "00317-1",
          "size": "ONE SIZE",
          "qty": 20,
          "unitIdr": 90000,
          "src": "MEN'S BOXER (SHORT) / BLACK & GOLD"
        },
        {
          "sku": "00317-5",
          "size": "ONE SIZE",
          "qty": 5,
          "unitIdr": 90000,
          "src": "MEN'S BOXER (SHORT) / GREY & BROWN"
        },
        {
          "sku": "00672-2",
          "size": "ONE SIZE",
          "qty": 5,
          "unitIdr": 150000,
          "src": "WOMEN KIMONO SHAKTI (LONG) / BLACK & IVORY"
        },
        {
          "sku": "00672-3",
          "size": "ONE SIZE",
          "qty": 9,
          "unitIdr": 150000,
          "src": "WOMEN KIMONO SHAKTI (LONG) / RED & BLACK"
        },
        {
          "sku": "00672-1",
          "size": "ONE SIZE",
          "qty": 25,
          "unitIdr": 150000,
          "src": "WOMEN KIMONO SHAKTI (LONG) / BLACK & GOLD"
        },
        {
          "sku": "00672-5",
          "size": "ONE SIZE",
          "qty": 10,
          "unitIdr": 150000,
          "src": "WOMEN KIMONO SHAKTI (LONG) / GREEN & GOLD"
        },
        {
          "sku": "00672-6",
          "size": "ONE SIZE",
          "qty": 8,
          "unitIdr": 150000,
          "src": "WOMEN KIMONO SHAKTI (LONG) / GREY &K BROWN"
        },
        {
          "sku": "00671-1",
          "size": "ONE SIZE",
          "qty": 5,
          "unitIdr": 150000,
          "src": "WOMEN SHORT KIMONO / FIRE"
        },
        {
          "sku": "00671-2",
          "size": "ONE SIZE",
          "qty": 5,
          "unitIdr": 150000,
          "src": "WOMEN SHORT KIMONO / ICE"
        },
        {
          "sku": "01866",
          "size": "ONE SIZE",
          "qty": 10,
          "unitIdr": 150000,
          "src": "PANT UNISEX / BLACK PANTHER JAQUARD"
        },
        {
          "sku": "01935",
          "size": "ONE SIZE",
          "qty": 10,
          "unitIdr": 95000,
          "src": "BOXERS NEW / BLACK PANTHER JAQUARD"
        }
      ]
    }
  ],
  "sampleProducts": [
    "Babydoll Dress With Open Back (White Embroidery)",
    "Bra Top (Viscose Satin Deep Ocean)",
    "Frill Skirt (Cream Embroidery)",
    "Frill Top (Cream Embroidery)",
    "Jacket With Ties (Denim 7 0z Blue)",
    "Long Dress (Viscose White)",
    "New Kimono (White Embroidery)",
    "New Long Pant Rope (Viscose Satin Gold)",
    "New Shirt Crop (Viscose Satin Gold)",
    "New Short Kimono (Moon)",
    "New Slip Dress (Viscose Satin Gold)",
    "Pajama Mini Dress (Cotton Embroidery)",
    "Short Pant Frill Women (White Embroidery)",
    "Short Pant Women (White Embroidery)",
    "Slip Dress",
    "Slip Dress (Satin Gold)"
  ],
  "skipped": [
    {
      "inv": "072",
      "style": "WOMEN SHORT KIMONO",
      "color": "BLACK & GOLD",
      "qty": 10,
      "amt": 1500000
    },
    {
      "inv": "073",
      "style": "UNISEX SHIRT",
      "color": "BLACK PANTHER JAQUARD",
      "qty": 20,
      "amt": 3200000
    },
    {
      "inv": "075",
      "style": "SHIRT UNISEX",
      "color": "BLACK PANTHER JAQUARD",
      "qty": 10,
      "amt": 1600000
    }
  ]
};

const FX = PLAN.fx; // THB за 1 IDR
const FACTORY_NAME = "Джонни (Бали)";
const SAMPLE_COLLECTION = "Образцы (новые модели)";

function thb(idr: number): number {
  return Math.round(idr * FX * 100) / 100;
}
function fmtIdr(n: number): string {
  return n.toLocaleString("ru-RU");
}

function main() {
  const db = rawSqlite();
  db.exec("PRAGMA foreign_keys = ON");

  // ---------- фабрика ----------
  let factory = db
    .prepare("SELECT id FROM factories WHERE name = ?")
    .get(FACTORY_NAME) as { id: string } | undefined;
  if (!factory) {
    const fid = crypto.randomUUID();
    db.prepare(
      `INSERT INTO factories (id, name, specialization, country, note, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?)`,
    ).run(
      fid,
      FACTORY_NAME,
      "Кимоно, халаты, боксеры, рубашки и брюки; работа по образцу",
      "ID",
      "Адрес, WhatsApp и координаты для маршрута ещё не заполнены. " +
        "Расчёты в IDR, курс к THB зафиксирован на 21.08.2026: 1 IDR = " +
        FX +
        " THB.",
      new Date().toISOString(),
      new Date().toISOString(),
    );
    factory = { id: fid };
    console.log("Создана фабрика: " + FACTORY_NAME);
  } else {
    console.log("Фабрика уже есть: " + FACTORY_NAME);
  }

  // ---------- коллекция для образцов ----------
  let sampleCol = db
    .prepare("SELECT id FROM collections WHERE name = ?")
    .get(SAMPLE_COLLECTION) as { id: string } | undefined;
  if (!sampleCol) {
    const cid = crypto.randomUUID();
    db.prepare(
      `INSERT INTO collections (id, name, description, created_at) VALUES (?,?,?,?)`,
    ).run(
      cid,
      SAMPLE_COLLECTION,
      "Модели, отшитые как образец, но ещё не заведённые в Ainur. " +
        "Когда появится SKU — перенести в свою коллекцию.",
      new Date().toISOString(),
    );
    sampleCol = { id: cid };
    console.log("Создана коллекция: " + SAMPLE_COLLECTION);
  }

  // ---------- изделия-образцы ----------
  const sampleProductId = new Map<string, string>();
  for (const name of PLAN.sampleProducts) {
    const found = db
      .prepare("SELECT id FROM products WHERE name = ? AND collection_id = ?")
      .get(name, sampleCol.id) as { id: string } | undefined;
    if (found) {
      sampleProductId.set(name, found.id);
      continue;
    }
    const pid = crypto.randomUUID();
    db.prepare(
      `INSERT INTO products (id, collection_id, name, note, created_at, updated_at)
       VALUES (?,?,?,?,?,?)`,
    ).run(
      pid,
      sampleCol.id,
      name,
      "Образец с фабрики Джонни. В Ainur не заведено, SKU нет.",
      new Date().toISOString(),
      new Date().toISOString(),
    );
    sampleProductId.set(name, pid);
  }
  console.log("Изделий-образцов: " + sampleProductId.size);

  // ---------- резолв SKU ----------
  const skuRow = db.prepare(
    `SELECT v.id AS vid, v.product_id AS pid, p.name AS pname, p.collection_id AS cid
     FROM product_variants v JOIN products p ON p.id = v.product_id
     WHERE v.sku = ?`,
  );

  const usedCollections = new Set<string>();
  const priceByProduct = new Map<string, { price: number; date: string }>();
  let createdOrders = 0;
  let totalUnits = 0;
  let totalThb = 0;
  const problems: string[] = [];

  db.exec("BEGIN");
  try {
    for (const o of PLAN.orders) {
      const exists = db
        .prepare("SELECT id FROM production_orders WHERE number = ?")
        .get(o.number);
      if (exists) {
        console.log(o.number + " уже есть, пропускаю");
        continue;
      }

      // сначала собираем строки — если ни одна не разрешилась, заказ не создаём
      type L = { pid: string; vid: string | null; size: string; qty: number; unitThb: number; unitIdr: number };
      const lines: L[] = [];
      for (const l of o.lines) {
        if (l.sku) {
          const r = skuRow.get(l.sku) as
            | { vid: string; pid: string; pname: string; cid: string }
            | undefined;
          if (!r) {
            problems.push(o.number + ": SKU " + l.sku + " не найден в базе (" + l.src + ")");
            continue;
          }
          usedCollections.add(r.cid);
          lines.push({ pid: r.pid, vid: r.vid, size: l.size, qty: l.qty, unitThb: thb(l.unitIdr), unitIdr: l.unitIdr });
        } else if (l.sampleName) {
          const pid = sampleProductId.get(l.sampleName);
          if (!pid) {
            problems.push(o.number + ": не создано изделие-образец " + String(l.sampleName));
            continue;
          }
          usedCollections.add(sampleCol.id);
          lines.push({ pid, vid: null, size: l.size, qty: l.qty, unitThb: thb(l.unitIdr), unitIdr: l.unitIdr });
        }
      }
      if (lines.length === 0) {
        problems.push(o.number + ": ни одна строка не разрешилась, заказ не создан");
        continue;
      }

      const sewing = lines.reduce((s, l) => s + l.qty * l.unitThb, 0);
      const units = lines.reduce((s, l) => s + l.qty, 0);
      const idrSum = lines.reduce((s, l) => s + l.qty * l.unitIdr, 0);
      const date = o.date ?? o.ship ?? "2026-01-01";
      const iso = date + "T00:00:00.000Z";
      const ship = (o.ship ?? date) + "T00:00:00.000Z";

      const noteParts = [
        "Импорт из файла Джонни «BALANCE SHEET EVA MOON 2026».",
        "Инвойс фабрики № " + o.inv + " от " + date + ".",
        "Сумма по инвойсу: " + fmtIdr(idrSum) + " IDR (курс 1 IDR = " + FX + " THB).",
      ];
      if (o.awb) noteParts.push("Отправка DHL, AWB " + o.awb + ".");
      if (o.kind === "SAMPLE") noteParts.push("Заказ образцов: модели в Ainur ещё не заведены.");
      const skippedHere = PLAN.skipped.filter((s) => s.inv === o.inv);
      for (const s of skippedHere) {
        noteParts.push(
          "НЕ ПЕРЕНЕСЕНО: " + s.style + " / " + s.color + " — " + s.qty +
            " шт, " + fmtIdr(s.amt) + " IDR: нет SKU в Ainur.",
        );
      }
      if (o.lines.some((l) => "src" in l && String(l.src).includes("принят Black"))) {
        noteParts.push(
          "ВНИМАНИЕ: в инвойсе не указан цвет футболок — при импорте принят Black, требует уточнения у Джонни.",
        );
      }

      const oid = crypto.randomUUID();
      db.prepare(
        `INSERT INTO production_orders
           (id, number, factory_id, status, sample_requested_at, sample_approved_at,
            planned_ready_at, actual_ready_at,
            snapshot_fabric_cost, snapshot_accessory_cost, snapshot_sewing_cost,
            snapshot_total_cost, snapshot_at, applied_defect_credit, note,
            created_at, updated_at)
         VALUES (?,?,?,'RECEIVED',?,?,?,?,0,0,?,?,?,0,?,?,?)`,
      ).run(
        oid, o.number, factory.id,
        iso, iso,
        ship, ship,
        sewing, sewing, iso,
        noteParts.join(" "),
        iso, new Date().toISOString(),
      );

      const insLine = db.prepare(
        `INSERT INTO production_order_lines
           (id, order_id, product_id, variant_id, size, quantity,
            unit_sewing_cost, unit_fabric_cost, planned_ready_at, qty_produced, qty_defect)
         VALUES (?,?,?,?,?,?,?,0,?,?,0)`,
      );
      for (const l of lines) {
        insLine.run(crypto.randomUUID(), oid, l.pid, l.vid, l.size, l.qty, l.unitThb, ship, l.qty);
        const prev = priceByProduct.get(l.pid);
        if (!prev || prev.date <= date) priceByProduct.set(l.pid, { price: l.unitThb, date });
      }

      db.prepare(
        `INSERT INTO audit_log (id, actor_name, action, entity_type, entity_id, entity_name, changes, created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      ).run(
        crypto.randomUUID(), "LUNA (импорт истории)", "CREATE", "production_order",
        oid, o.number,
        JSON.stringify({ source: "BALANCE SHEET EVA MOON 2026 1.xlsx", invoice: o.inv, idr: idrSum, fx: FX }),
        new Date().toISOString(),
      );

      createdOrders++;
      totalUnits += units;
      totalThb += sewing;
      console.log(
        o.number + "  инв." + o.inv + "  " + date + "  " + (o.kind === "SAMPLE" ? "образцы" : "производство") +
          "  " + units + " шт  " + fmtIdr(idrSum) + " IDR = " + sewing.toFixed(0) + " THB",
      );
    }

    // ---------- цены пошива ----------
    let prices = 0;
    for (const [pid, v] of priceByProduct) {
      const has = db
        .prepare("SELECT id FROM factory_prices WHERE factory_id = ? AND product_id = ? AND is_current = 1")
        .get(factory.id, pid);
      if (has) continue;
      db.prepare(
        `INSERT INTO factory_prices (id, factory_id, product_id, price_per_unit, valid_from, is_current, created_at)
         VALUES (?,?,?,?,?,1,?)`,
      ).run(crypto.randomUUID(), factory.id, pid, v.price, v.date + "T00:00:00.000Z", new Date().toISOString());
      prices++;
    }

    // ---------- какие коллекции шьёт ----------
    let cols = 0;
    for (const cid of usedCollections) {
      const has = db
        .prepare("SELECT id FROM factory_collections WHERE factory_id = ? AND collection_id = ?")
        .get(factory.id, cid);
      if (has) continue;
      db.prepare(
        "INSERT INTO factory_collections (id, factory_id, collection_id) VALUES (?,?,?)",
      ).run(crypto.randomUUID(), factory.id, cid);
      cols++;
    }

    db.exec("COMMIT");
    console.log("\nЗаказов создано: " + createdOrders);
    console.log("Изделий: " + totalUnits + " шт");
    console.log("Пошив: " + totalThb.toFixed(0) + " THB");
    console.log("Цен пошива записано: " + prices);
    console.log("Коллекций привязано к фабрике: " + cols);
  } catch (err) {
    db.exec("ROLLBACK");
    console.error("Импорт отменён:", (err as Error).message);
    process.exit(1);
  }

  if (problems.length) {
    console.log("\nТребует внимания:");
    for (const p of problems) console.log("  " + p);
  }
  console.log("\nНе перенесено (нет SKU в Ainur):");
  for (const s of PLAN.skipped) {
    console.log("  инв." + s.inv + "  " + s.style + " / " + s.color + " — " + s.qty + " шт, " + fmtIdr(s.amt) + " IDR");
  }
}

main();
