/**
 * Разведка: сколько истории продаж реально есть в Ainur и какая доля
 * строк сопоставляется с текущим каталогом EVA MOON.
 *
 * Ничего не пишет в базу — только читает Ainur и считает.
 * Запуск: npm run ainur:probe
 */
import { asInt, asNumber, asString } from "../src/lib/ainur/client";
import { ainurClient as makeClient } from "../src/lib/ainur/token";
import { db, schema } from "../src/lib/db/client";

function monthsBetween(fromISO: string, toISO: string): string[] {
  const out: string[] = [];
  const d = new Date(fromISO);
  d.setUTCDate(1);
  const end = new Date(toISO);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 7));
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

async function main() {
  const client = await makeClient();
  const skus = new Set(
    (await db.select({ sku: schema.productVariants.sku }).from(schema.productVariants)).map(
      (r) => r.sku,
    ),
  );
  console.log(`SKU в каталоге Luna: ${skus.size}\n`);
  console.log("месяц    док.  строк  сSKU  нашлось  штук   выручка THB");

  const totals = { docs: 0, lines: 0, withSku: 0, matched: 0, units: 0, revenue: 0 };
  const byYear = new Map<string, { units: number; revenue: number; lines: number; matched: number }>();

  for (const m of monthsBetween("2024-01-01", new Date().toISOString())) {
    const from = `${m}-01T00:00:00.000Z`;
    const endD = new Date(from);
    endD.setUTCMonth(endD.getUTCMonth() + 1);
    const to = endD.toISOString();
    let docs: Awaited<ReturnType<typeof client.getSales>> = [];
    try {
      docs = await client.getSales({ timeStart: from, timeEnd: to });
    } catch (e) {
      console.log(`${m}  ОШИБКА: ${String((e as Error).message).slice(0, 80)}`);
      continue;
    }
    let lines = 0, withSku = 0, matched = 0, units = 0, revenue = 0;
    for (const doc of docs) {
      for (const l of doc.line_items ?? []) {
        lines++;
        const sku = asString(l.code) ?? asString(l.sku);
        if (sku) withSku++;
        if (sku && skus.has(sku)) {
          matched++;
          const q = -asInt(l.quantity);
          units += q;
          const sum = asNumber(l.legacy_line?.sum);
          revenue += sum !== null ? Math.abs(sum) : (asNumber(l.price) ?? 0) * q;
        }
      }
    }
    const y = m.slice(0, 4);
    const e = byYear.get(y) ?? { units: 0, revenue: 0, lines: 0, matched: 0 };
    e.units += units; e.revenue += revenue; e.lines += lines; e.matched += matched;
    byYear.set(y, e);
    totals.docs += docs.length; totals.lines += lines; totals.withSku += withSku;
    totals.matched += matched; totals.units += units; totals.revenue += revenue;
    console.log(
      `${m}  ${String(docs.length).padStart(5)} ${String(lines).padStart(6)} ` +
        `${String(withSku).padStart(5)} ${String(matched).padStart(8)} ` +
        `${String(units).padStart(6)} ${Math.round(revenue).toLocaleString("ru-RU").padStart(13)}`,
    );
  }

  console.log("\n=== ПО ГОДАМ (только сопоставленные строки) ===");
  for (const [y, e] of [...byYear.entries()].sort()) {
    const pct = e.lines ? Math.round((e.matched / e.lines) * 100) : 0;
    console.log(`${y}: ${e.units} шт, ${Math.round(e.revenue).toLocaleString("ru-RU")} THB, сопоставлено ${pct}% строк (${e.matched} из ${e.lines})`);
  }
  console.log(
    `\nВСЕГО: документов ${totals.docs}, строк ${totals.lines}, из них со SKU ${totals.withSku}, ` +
      `сопоставлено с каталогом ${totals.matched}`,
  );
}

main().catch((e) => {
  console.error("ОШИБКА:", e);
  process.exit(1);
});
