/**
 * Разведка: есть ли себестоимость в документах поступления Ainur.
 * В /product её нет вообще, в строках продаж cost приходит нулём —
 * остаётся приход товара, где по логике POS должна быть цена закупки.
 *
 * Запуск: npx tsx --env-file=.env scripts/probe-purchases.ts [дней]
 */
import { ainurClient } from "../src/lib/ainur/token";

async function main() {
  const days = Number(process.argv[2]) || 120;
  const client = await ainurClient();
  const from = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

  const docs = await client.getPurchases({ timeStart: from });
  console.log(`Документов прихода за ${days} дней: ${docs.length}`);
  if (docs.length === 0) {
    console.log("Пусто. Либо приходы не оформляют, либо эндпоинт отдаёт другое.");
    return;
  }

  const docKeys = new Map<string, number>();
  const lineKeys = new Map<string, number>();
  const lineFilled = new Map<string, number>();
  let lines = 0;

  for (const d of docs as unknown as Record<string, unknown>[]) {
    for (const k of Object.keys(d)) docKeys.set(k, (docKeys.get(k) ?? 0) + 1);
    const items = (d.line_items ?? []) as Record<string, unknown>[];
    for (const l of items) {
      lines++;
      for (const [k, v] of Object.entries(l)) {
        lineKeys.set(k, (lineKeys.get(k) ?? 0) + 1);
        const empty = v === null || v === undefined || v === "" || v === 0 ||
          (Array.isArray(v) && v.length === 0);
        if (!empty) lineFilled.set(k, (lineFilled.get(k) ?? 0) + 1);
      }
    }
  }

  console.log("\nПОЛЯ ДОКУМЕНТА: " + [...docKeys.keys()].sort().join(", "));
  console.log(`\nСТРОК ВСЕГО: ${lines}`);
  console.log("ПОЛЯ СТРОКИ (всего / заполнено):");
  for (const [k, c] of [...lineKeys.entries()].sort()) {
    console.log(`  ${k.padEnd(24)} ${String(c).padStart(6)}  заполнено ${lineFilled.get(k) ?? 0}`);
  }

  console.log("\nПОЛНЫЙ JSON ОДНОГО ДОКУМЕНТА:");
  console.log(JSON.stringify(docs[0], null, 1).slice(0, 2200));
}

main().catch((e) => {
  console.error("ОШИБКА:", e);
  process.exit(1);
});
