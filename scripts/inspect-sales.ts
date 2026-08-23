/** Что за строки продаж приходят без SKU. Запуск: npm run ainur:sales */
import { ainurClient } from "../src/lib/ainur/token";

async function main() {
  const client = await ainurClient();
  const from = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString();
  const sales = await client.getSales({ timeStart: from });

  const noSku: Record<string, unknown>[] = [];
  const withSku: Record<string, unknown>[] = [];
  for (const doc of sales) {
    for (const l of (doc.line_items ?? []) as unknown as Record<string, unknown>[]) {
      const sku = l.sku ?? l.code;
      if (!sku || String(sku).trim() === "") noSku.push(l);
      else withSku.push(l);
    }
  }
  console.log(`строк всего: ${noSku.length + withSku.length}; без SKU: ${noSku.length}`);

  console.log("\n=== примеры строк БЕЗ SKU (10) ===");
  for (const l of noSku.slice(0, 10)) {
    console.log(
      `  title=${String(l.title ?? "").slice(0, 42)} | variant=${String(l.variant_title ?? "")} | ` +
        `vendor=${String(l.vendor ?? "")} | qty=${l.quantity} | price=${l.price}`,
    );
  }
  console.log("\n=== какие vendor встречаются у строк без SKU ===");
  const vendors = new Map<string, number>();
  for (const l of noSku) {
    const v = String(l.vendor ?? "(пусто)");
    vendors.set(v, (vendors.get(v) ?? 0) + 1);
  }
  for (const [v, n] of [...vendors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`  ${v} — ${n}`);
  }
  console.log("\n=== пример строки СО SKU для сравнения ===");
  if (withSku[0]) {
    console.log("  " + JSON.stringify(withSku[0]).slice(0, 400));
  }
}
main().catch((e) => { console.error("ОШИБКА:", e); process.exit(1); });
