/**
 * Диагностика структуры ответов Ainur.
 * Печатает только форму данных и названия — ни токена, ни денежных сумм.
 *
 * Запуск: npm run ainur:inspect
 */
import { ainurClient } from "../src/lib/ainur/token";

function keysOf(o: unknown): string {
  if (!o || typeof o !== "object") return typeof o;
  return Object.keys(o as Record<string, unknown>).join(", ");
}
function shortVal(v: unknown): string {
  if (v === null || v === undefined) return String(v);
  if (Array.isArray(v)) return `[массив, ${v.length}]`;
  if (typeof v === "object") return `{${Object.keys(v as object).slice(0,6).join(",")}}`;
  return String(v).slice(0, 60);
}

async function main() {
  const client = await ainurClient();

  console.log("========== 1. КОЛЛЕКЦИИ (ext-categories) ==========");
  const cats = await client.getCategories();
  console.log(`всего: ${cats.length}`);
  console.log(`поля первой записи: ${keysOf(cats[0])}`);
  console.log("первые 5 записей целиком:");
  for (const c of cats.slice(0, 5)) {
    const entries = Object.entries(c as Record<string, unknown>)
      .map(([k, v]) => `${k}=${shortVal(v)}`).join("  ");
    console.log(`  ${entries}`);
  }
  // есть ли признак родителя / вложенности
  const parentKeys = Object.keys(cats[0] ?? {}).filter((k) =>
    /parent|root|level|path|tree|group/i.test(k));
  console.log(`поля, похожие на иерархию: ${parentKeys.length ? parentKeys.join(", ") : "НЕ НАЙДЕНЫ"}`);

  console.log("\n========== 2. ТОВАР: поля и признаки бренда ==========");
  const products = await client.getAllProducts();
  console.log(`всего товаров: ${products.length}`);
  console.log(`поля товара: ${keysOf(products[0])}`);
  for (const p of products.slice(0, 3)) {
    console.log(`  name=${shortVal(p.options?.name)} | code=${shortVal(p.code)} | category_id=${shortVal(p.category_id)} | tags=${shortVal(p.tags)}`);
  }
  const withTags = products.filter((p) => Array.isArray(p.tags) && p.tags.length > 0);
  console.log(`товаров с непустыми tags: ${withTags.length} из ${products.length}`);
  if (withTags[0]) console.log(`  пример tags: ${JSON.stringify(withTags[0].tags).slice(0, 200)}`);

  console.log("\n========== 3. ДОКУМЕНТЫ ИЗМЕНЕНИЙ (перемещения) ==========");
  const from = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString();
  const changes = await client.getStockChanges({ timeStart: from });
  console.log(`документов: ${changes.length}`);
  if (changes[0]) {
    console.log(`поля документа: ${keysOf(changes[0])}`);
    for (const d of changes.slice(0, 3)) {
      console.log(`  name=${shortVal(d.name)} | source=${shortVal(d.source)} | destination=${shortVal(d.destination)} | location_id=${shortVal(d.location_id)} | flags=${shortVal(d.document_flags)}`);
    }
    // ищем поля, похожие на склад-источник/получатель
    const shapeKeys = Object.keys(changes[0]).filter((k) =>
      /from|to|source|dest|store|shop|location|warehouse|move/i.test(k));
    console.log(`поля, похожие на склады: ${shapeKeys.join(", ") || "НЕ НАЙДЕНЫ"}`);
  }

  console.log("\n========== 4. НЕСОПОСТАВЛЕННЫЕ ПРОДАЖИ ==========");
  const sales = await client.getSales({ timeStart: from });
  const codes = new Set(products.map((p) => p.code ?? p.sku).filter(Boolean));
  const unmatched = new Map<string, number>();
  let lines = 0;
  for (const doc of sales) {
    for (const l of doc.line_items ?? []) {
      lines++;
      const c = l.code ?? l.sku;
      if (!c || !codes.has(c)) {
        const key = c ? String(c) : "(нет кода)";
        unmatched.set(key, (unmatched.get(key) ?? 0) + 1);
      }
    }
  }
  console.log(`строк продаж: ${lines}, несопоставлено: ${[...unmatched.values()].reduce((a, b) => a + b, 0)}`);
  console.log("топ несопоставленных кодов:");
  for (const [code, n] of [...unmatched.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  ${code} — ${n} раз`);
  }
  if (sales[0]?.line_items?.[0]) {
    console.log(`поля строки продажи: ${keysOf(sales[0].line_items[0])}`);
  }
}
main().catch((e) => { console.error("ОШИБКА:", e); process.exit(1); });
