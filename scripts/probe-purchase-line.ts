/**
 * Можно ли вообще привязать строки прихода Ainur к нашим SKU.
 * Печатает одну строку целиком и ищет в ней (на любой глубине) значение,
 * совпадающее с кодом из нашего каталога.
 *
 * Запуск: npx tsx --env-file=.env scripts/probe-purchase-line.ts [дней]
 */
import { ainurClient } from "../src/lib/ainur/token";
import { db, schema } from "../src/lib/db/client";

function walk(v: unknown, path: string, out: [string, string][]): void {
  if (v === null || v === undefined) return;
  if (typeof v === "string" || typeof v === "number") {
    out.push([path, String(v)]);
    return;
  }
  if (Array.isArray(v)) {
    v.forEach((x, i) => walk(x, `${path}[${i}]`, out));
    return;
  }
  if (typeof v === "object") {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      walk(x, path ? `${path}.${k}` : k, out);
    }
  }
}

async function main() {
  const days = Number(process.argv[2]) || 120;
  const client = await ainurClient();
  const from = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  const docs = await client.getPurchases({ timeStart: from });

  const skus = new Set(
    (await db.select({ sku: schema.productVariants.sku }).from(schema.productVariants)).map(
      (r) => r.sku,
    ),
  );
  console.log(`Документов: ${docs.length}. SKU в каталоге: ${skus.size}`);

  const first = (docs[0] as unknown as { line_items?: unknown[] })?.line_items?.[0];
  console.log("\nОДНА СТРОКА ПРИХОДА ЦЕЛИКОМ:");
  console.log(JSON.stringify(first, null, 1));

  let lines = 0;
  let matched = 0;
  const matchPaths = new Map<string, number>();
  for (const d of docs as unknown as { line_items?: unknown[] }[]) {
    for (const l of d.line_items ?? []) {
      lines++;
      const flat: [string, string][] = [];
      walk(l, "", flat);
      const hit = flat.find(([, val]) => skus.has(val.trim()));
      if (hit) {
        matched++;
        matchPaths.set(hit[0], (matchPaths.get(hit[0]) ?? 0) + 1);
      }
    }
  }
  console.log(`\nСтрок всего: ${lines}. Нашёлся наш SKU где-нибудь в строке: ${matched}`);
  if (matchPaths.size) {
    console.log("В каких полях лежал код:");
    for (const [p, c] of matchPaths) console.log(`  ${p}: ${c}`);
  } else {
    console.log("Ни в одном поле строки прихода нашего кода нет — привязать можно только по названию.");
  }
}

main().catch((e) => {
  console.error("ОШИБКА:", e);
  process.exit(1);
});
