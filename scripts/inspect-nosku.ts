/**
 * Разбор строк продаж без SKU: что это за позиции.
 * Запуск: npm run ainur:nosku
 */
import { ainurClient } from "../src/lib/ainur/token";
import { db, schema } from "../src/lib/db/client";

function norm(s: string): string {
  return s.toLowerCase().replace(/[«»"'(),.\-–—]/g, " ").replace(/\s+/g, " ").trim();
}

async function main() {
  const client = await ainurClient();
  const from = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString();
  const sales = await client.getSales({ timeStart: from });

  // наш каталог EVA MOON — для проверки, узнаётся ли позиция по названию
  const catalog = await db
    .select({
      sku: schema.productVariants.sku,
      ainurName: schema.productVariants.ainurName,
      product: schema.products.name,
    })
    .from(schema.productVariants)
    .innerJoin(
      schema.products,
      (await import("drizzle-orm")).eq(schema.productVariants.productId, schema.products.id),
    );
  const byName = new Map<string, string>();
  for (const c of catalog) {
    if (c.ainurName) byName.set(norm(c.ainurName), c.sku);
    byName.set(norm(c.product), c.sku);
  }

  interface Row { doc: string; date: string; title: string; qty: number; price: number; hasSku: boolean }
  const rows: Row[] = [];
  for (const doc of sales) {
    for (const l of (doc.line_items ?? []) as unknown as Record<string, unknown>[]) {
      const sku = String(l.sku ?? l.code ?? "").trim();
      rows.push({
        doc: String(doc.name ?? doc.order_number ?? doc.id).slice(0, 10),
        date: String(doc.processed_at ?? doc.created_at ?? "").slice(0, 10),
        title: String(l.title ?? ""),
        qty: -(Number(l.quantity) || 0),
        price: Number(l.price) || 0,
        hasSku: sku !== "",
      });
    }
  }
  const noSku = rows.filter((r) => !r.hasSku);
  const withSku = rows.filter((r) => r.hasSku);

  console.log(`Всего строк: ${rows.length} | со SKU: ${withSku.length} | без SKU: ${noSku.length}\n`);

  console.log("=== ПОЛНОЕ СОДЕРЖИМОЕ одной строки без SKU ===");
  for (const doc of sales) {
    const l = (doc.line_items ?? []).find(
      (x) => !String((x as Record<string, unknown>).sku ?? "").trim(),
    );
    if (l) { console.log(JSON.stringify(l, null, 1).slice(0, 1100)); break; }
  }

  console.log("\n=== 20 ПРИМЕРОВ строк без SKU ===");
  console.log("документ  дата        шт   цена     название");
  for (const r of noSku.slice(0, 20)) {
    console.log(
      `${r.doc.padEnd(9)} ${r.date}  ${String(r.qty).padStart(3)}  ${String(r.price).padStart(7)}  ${r.title.slice(0, 46)}`,
    );
  }

  console.log("\n=== ПОВТОРЯЮЩИЕСЯ названия (топ-15) ===");
  const counts = new Map<string, number>();
  for (const r of noSku) counts.set(r.title, (counts.get(r.title) ?? 0) + 1);
  for (const [t, n] of [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`  ${String(n).padStart(3)}× ${t.slice(0, 60)}`);
  }

  console.log("\n=== УЗНАЮТСЯ ЛИ ПО НАЗВАНИЮ в каталоге EVA MOON ===");
  let exact = 0, partial = 0, no = 0;
  const examplesNo: string[] = [];
  for (const [title] of counts) {
    const n = norm(title);
    if (byName.has(n)) exact++;
    else if ([...byName.keys()].some((k) => k.length > 6 && (n.includes(k) || k.includes(n)))) partial++;
    else { no++; if (examplesNo.length < 8) examplesNo.push(title); }
  }
  console.log(`уникальных названий: ${counts.size} | точное совпадение: ${exact} | частичное: ${partial} | не найдено: ${no}`);
  console.log("примеры не найденных (вероятно другие бренды или разовые позиции):");
  for (const e of examplesNo) console.log(`  ${e.slice(0, 60)}`);

  console.log("\n=== РАСПРЕДЕЛЕНИЕ ПО ДАТАМ ===");
  const byMonth = new Map<string, { no: number; yes: number }>();
  for (const r of rows) {
    const m = r.date.slice(0, 7);
    const e = byMonth.get(m) ?? { no: 0, yes: 0 };
    r.hasSku ? e.yes++ : e.no++;
    byMonth.set(m, e);
  }
  for (const [m, e] of [...byMonth.entries()].sort()) {
    console.log(`  ${m}: со SKU ${String(e.yes).padStart(4)} | без SKU ${String(e.no).padStart(4)}`);
  }
}
main().catch((e) => { console.error("ОШИБКА:", e); process.exit(1); });
