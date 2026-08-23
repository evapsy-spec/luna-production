/**
 * Разведка: есть ли в Ainur себестоимость у товара и как называется поле.
 * Запуск: npx tsx --env-file=.env scripts/probe-cost.ts
 */
import { ainurClient } from "../src/lib/ainur/token";

const HINTS = ["cost", "prime", "purchase", "buy", "self", "wholesale", "input"];

async function main() {
  const client = await ainurClient();
  const products = await client.getAllProducts();
  console.log(`Товаров получено: ${products.length}`);

  const keyCount = new Map<string, number>();
  const filled = new Map<string, number>();
  for (const p of products as unknown as Record<string, unknown>[]) {
    for (const [k, v] of Object.entries(p)) {
      keyCount.set(k, (keyCount.get(k) ?? 0) + 1);
      const empty =
        v === null ||
        v === undefined ||
        v === "" ||
        (Array.isArray(v) && v.length === 0) ||
        v === 0;
      if (!empty) filled.set(k, (filled.get(k) ?? 0) + 1);
    }
  }

  console.log("\nВСЕ ПОЛЯ ТОВАРА (сколько записей, у скольких заполнено):");
  for (const [k, c] of [...keyCount.entries()].sort()) {
    console.log(`  ${k.padEnd(26)} ${String(c).padStart(6)}  заполнено ${filled.get(k) ?? 0}`);
  }

  const hits = [...keyCount.keys()].filter((k) =>
    HINTS.some((h) => k.toLowerCase().includes(h)),
  );
  console.log("\nПОХОЖЕ НА СЕБЕСТОИМОСТЬ:", hits.length ? hits.join(", ") : "полей с такими именами нет");

  const sample = (products as unknown as Record<string, unknown>[]).filter(
    (p) => hits.some((h) => p[h] !== null && p[h] !== undefined && p[h] !== 0 && p[h] !== ""),
  );
  console.log(`Товаров с непустым значением в этих полях: ${sample.length}`);
  for (const p of sample.slice(0, 5)) {
    const short: Record<string, unknown> = { code: p.code, title: p.title ?? p.name, price: p.price };
    for (const h of hits) short[h] = p[h];
    console.log("  " + JSON.stringify(short));
  }

  console.log("\nПОЛНЫЙ JSON ОДНОГО ТОВАРА:");
  console.log(JSON.stringify(products[0], null, 1).slice(0, 1800));
}

main().catch((e) => {
  console.error("ОШИБКА:", e);
  process.exit(1);
});
