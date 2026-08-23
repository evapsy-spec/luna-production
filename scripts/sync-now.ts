/**
 * Запуск синхронизации с Ainur из командной строки.
 * Нужен, чтобы видеть полный вывод и ошибки без интерфейса.
 *
 * Запуск: npm run sync:now            (продажи за 60 дней)
 *         npm run sync:now -- 180     (продажи за 180 дней)
 */
import { syncAll } from "../src/lib/ainur/sync";
import { getTokenInfo } from "../src/lib/ainur/token";

async function main() {
  const days = Number(process.argv[2]) || 60;

  const info = await getTokenInfo();
  if (!info.configured) {
    console.error("Токен Ainur не задан. Вставьте его на странице «Синхронизация».");
    process.exit(1);
  }
  console.log(`Токен: ${info.masked} (${info.source === "app" ? "из приложения" : "из окружения"})`);
  console.log(`Период продаж: последние ${days} дн.\n`);

  const salesFrom = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  const results = await syncAll("командная строка", { salesFrom });

  console.log("========== РЕЗУЛЬТАТ ==========");
  for (const r of results) {
    const mark = r.ok ? "OK  " : "СБОЙ";
    console.log(
      `${mark} ${r.kind.padEnd(10)} прочитано ${String(r.itemsRead).padStart(6)} · ` +
        `записано ${String(r.itemsWritten).padStart(6)} · ${(r.durationMs / 1000).toFixed(1)}с`,
    );
    if (r.error) console.log(`     ошибка: ${r.error}`);
    for (const d of r.details.slice(0, 12)) console.log(`     · ${d}`);
    if (r.details.length > 12) {
      console.log(`     · …ещё ${r.details.length - 12} строк подробностей`);
    }
  }
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

main().catch((e) => {
  console.error("Синхронизация упала целиком:", e);
  process.exit(1);
});
