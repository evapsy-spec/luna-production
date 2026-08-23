/**
 * Импорт себестоимости из выгрузки каталога Ainur.
 *
 * Откуда берётся файл. В Connect API себестоимости нет: /product отдаёт 22
 * поля без неё, в строках продаж cost всегда 0, а в документах прихода цена
 * есть, но код товара пустой у 97% строк. Реально себестоимость лежит только
 * в веб-интерфейсе Ainur — колонки Purchasing price и Cost в каталоге.
 * Файл снимается оттуда и кладётся в ~/Downloads/ainur-cost.csv.
 *
 * Формат: code;purchase;cost;price;name — точка с запятой, первая строка
 * заголовок.
 *
 * purchase (Purchasing price) — цена из карточки товара, заполнена почти
 * везде, её и считаем себестоимостью. cost — средняя по фактическим
 * приходам, у части наших позиций нулевая, храним справочно.
 *
 * Запуск: npm run cost:import [путь]
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/lib/db/client";

function num(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

async function main() {
  const path = process.argv[2] ?? join(homedir(), "Downloads", "ainur-cost.csv");
  const text = readFileSync(path, "utf8").replace(/^﻿/, "");
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) {
    console.error(`Файл ${path} пустой или без данных.`);
    process.exit(1);
  }
  console.log(`Файл: ${path}, строк с данными: ${lines.length - 1}`);

  const variants = await db
    .select({ id: schema.productVariants.id, sku: schema.productVariants.sku })
    .from(schema.productVariants);
  const bySku = new Map(variants.map((v) => [v.sku, v.id]));
  console.log(`SKU в базе: ${bySku.size}`);

  const now = new Date().toISOString();
  let updated = 0;
  let zero = 0;
  const notFound: string[] = [];

  for (const line of lines.slice(1)) {
    const parts = line.split(";");
    const code = (parts[0] ?? "").trim();
    if (!code) continue;
    const purchase = num(parts[1]);
    const avg = num(parts[2]);
    const id = bySku.get(code);
    if (!id) {
      if (notFound.length < 30) notFound.push(code);
      continue;
    }
    if (!purchase) zero++;
    await db
      .update(schema.productVariants)
      .set({
        ainurPurchaseCost: purchase && purchase > 0 ? purchase : null,
        ainurAvgCost: avg && avg > 0 ? avg : null,
        ainurCostSyncedAt: now,
      })
      .where(eq(schema.productVariants.id, id));
    updated++;
  }

  console.log(`\nОбновлено SKU: ${updated}`);
  console.log(`Из них без цены закупки в Ainur: ${zero}`);
  console.log(`Не найдено в нашем каталоге: ${notFound.length}`);
  if (notFound.length) console.log("  " + notFound.slice(0, 15).join(", "));

  const rows = await db
    .select({
      sku: schema.productVariants.sku,
      p: schema.productVariants.ainurPurchaseCost,
      a: schema.productVariants.ainurAvgCost,
    })
    .from(schema.productVariants);
  const withP = rows.filter((r) => (r.p ?? 0) > 0).length;
  const withA = rows.filter((r) => (r.a ?? 0) > 0).length;
  const sum = rows.reduce((s, r) => s + (r.p ?? 0), 0);
  console.log(
    `\nИтог по базе: себестоимость есть у ${withP} SKU из ${rows.length}, ` +
      `средняя по приходам — у ${withA}.`,
  );
  console.log(
    `Средняя себестоимость: ${Math.round(sum / Math.max(withP, 1)).toLocaleString("ru-RU")} THB.`,
  );
}

main().catch((e) => {
  console.error("ОШИБКА:", e);
  process.exit(1);
});
