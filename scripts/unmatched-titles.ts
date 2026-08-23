/**
 * Выгрузка названий из продаж Ainur, которые НЕ сопоставились с каталогом
 * EVA MOON — для сверочного файла Евы.
 *
 * Ainur примерно в половине строк продаж не пишет SKU, там только название.
 * Такие продажи не попадают в статистику. Здесь мы собираем все уникальные
 * названия за период, считаем количество и деньги и помечаем, похоже ли
 * название на что-то из нашего каталога.
 *
 * Запуск: npx tsx --env-file=.env scripts/unmatched-titles.ts [дней]
 * По умолчанию 180 дней. Результат: /tmp/unmatched-titles.csv
 */
import { writeFileSync } from "node:fs";
import { asInt, asNumber, asString } from "../src/lib/ainur/client";
import { ainurClient } from "../src/lib/ainur/token";
import { db, schema } from "../src/lib/db/client";
import { eq } from "drizzle-orm";

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[«»"'(),.\-–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface Row {
  title: string;
  lines: number;
  units: number;
  revenue: number;
  first: string;
  last: string;
  guess: string;
  hasSku: boolean;
}

async function main() {
  const days = Number(process.argv[2]) || 180;
  const client = await ainurClient();
  const from = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

  const catalog = await db
    .select({
      sku: schema.productVariants.sku,
      ainurName: schema.productVariants.ainurName,
      product: schema.products.name,
      collection: schema.collections.name,
    })
    .from(schema.productVariants)
    .innerJoin(schema.products, eq(schema.productVariants.productId, schema.products.id))
    .innerJoin(schema.collections, eq(schema.products.collectionId, schema.collections.id));

  const byName = new Map<string, string>();
  for (const c of catalog) {
    const label = `${c.sku} · ${c.product} · ${c.collection}`;
    if (c.ainurName) byName.set(norm(c.ainurName), label);
    byName.set(norm(c.product), label);
  }
  const keys = [...byName.keys()];
  const skuSet = new Set(catalog.map((c) => c.sku));

  console.log(`Каталог: ${catalog.length} SKU. Читаю продажи за ${days} дней...`);
  const docs = await client.getSales({ timeStart: from });
  console.log(`Документов: ${docs.length}`);

  const map = new Map<string, Row>();
  let total = 0;
  let matchedBySku = 0;

  for (const doc of docs) {
    const day = String(doc.processed_at ?? doc.created_at ?? "").slice(0, 10);
    for (const l of doc.line_items ?? []) {
      total++;
      const sku = asString(l.code) ?? asString(l.sku);
      if (sku && skuSet.has(sku)) {
        matchedBySku++;
        continue;
      }
      const title = (asString(l.title) ?? "без названия").trim();
      const units = -asInt(l.quantity);
      const sum = asNumber(l.legacy_line?.sum);
      const revenue = sum !== null ? Math.abs(sum) : (asNumber(l.price) ?? 0) * units;

      const e = map.get(title) ?? {
        title,
        lines: 0,
        units: 0,
        revenue: 0,
        first: day,
        last: day,
        guess: "",
        hasSku: Boolean(sku),
      };
      e.lines++;
      e.units += units;
      e.revenue += revenue;
      if (day && day < e.first) e.first = day;
      if (day && day > e.last) e.last = day;
      if (sku) e.hasSku = true;
      map.set(title, e);
    }
  }

  for (const row of map.values()) {
    const n = norm(row.title);
    const exact = byName.get(n);
    if (exact) {
      row.guess = exact;
      continue;
    }
    const partial = keys.find((k) => k.length > 6 && (n.includes(k) || k.includes(n)));
    row.guess = partial ? `похоже: ${byName.get(partial)}` : "";
  }

  const rows = [...map.values()].sort((a, b) => b.units - a.units);
  const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
  const csv = [
    "Название в кассе Ainur;Строк;Штук;Выручка THB;Первая продажа;Последняя продажа;Есть ли SKU в строке;Похоже на наш товар",
    ...rows.map((r) =>
      [
        esc(r.title),
        r.lines,
        r.units,
        Math.round(r.revenue),
        r.first,
        r.last,
        r.hasSku ? "есть" : "нет",
        esc(r.guess),
      ].join(";"),
    ),
  ].join("\n");
  writeFileSync("/tmp/unmatched-titles.csv", "﻿" + csv, "utf8");

  const withGuess = rows.filter((r) => r.guess).length;
  console.log(
    `Всего строк продаж: ${total}, из них сопоставлено по SKU: ${matchedBySku}.\n` +
      `Не сопоставлено: уникальных названий ${rows.length}, ` +
      `из них похожи на наш каталог ${withGuess}, совсем не найдено ${rows.length - withGuess}.`,
  );
  console.log("Файл: /tmp/unmatched-titles.csv");
}

main().catch((e) => {
  console.error("ОШИБКА:", e);
  process.exit(1);
});
