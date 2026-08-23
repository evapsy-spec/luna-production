/**
 * Догрузка истории продаж из Ainur месяц за месяцем.
 *
 * Зачем отдельный скрипт: обычная синхронизация берёт последние 60 дней —
 * этого хватает для скорости продаж, но не для сравнения года с годом.
 * Здесь мы проходим по месяцам с самого начала истории и складываем всё
 * в variant_sales_daily. Ainur не даёт запрашивать больше 31 дня за раз,
 * а сами запросы медленные (около двух минут на месяц), поэтому идём
 * по одному месяцу и печатаем прогресс.
 *
 * Скрипт можно прерывать и запускать снова: пройденный месяц запоминается
 * в настройке sales_backfill_until, и повторный запуск продолжает с него.
 *
 *   npm run ainur:backfill              — продолжить с последнего места
 *   npm run ainur:backfill 2024-01      — начать заново с указанного месяца
 *   npm run ainur:backfill 2024-01 force — пройти заново, игнорируя отметку
 */
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { ainurClient } from "../src/lib/ainur/token";
import { syncSales } from "../src/lib/ainur/sync";
import { db, schema } from "../src/lib/db/client";

const FIRST_MONTH = "2024-01";
const SETTING = "sales_backfill_until";

function nextMonth(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
}

function monthBounds(m: string): { from: string; to: string } {
  return { from: `${m}-01T00:00:00.000Z`, to: `${nextMonth(m)}-01T00:00:00.000Z` };
}

async function getSetting(key: string): Promise<string | null> {
  const rows = await db
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, key))
    .limit(1);
  return rows[0]?.value ?? null;
}

async function setSetting(key: string, value: string): Promise<void> {
  const rows = await db
    .select({ key: schema.settings.key })
    .from(schema.settings)
    .where(eq(schema.settings.key, key))
    .limit(1);
  if (rows.length > 0) {
    await db.update(schema.settings).set({ value }).where(eq(schema.settings.key, key));
  } else {
    await db.insert(schema.settings).values({ key, value });
  }
}

/** Сколько штук и денег уже лежит в базе за этот месяц */
async function monthTotals(m: string): Promise<{ units: number; revenue: number }> {
  const { from, to } = monthBounds(m);
  const rows = await db
    .select({
      units: sql<number>`COALESCE(SUM(${schema.variantSalesDaily.units}), 0)`,
      revenue: sql<number>`COALESCE(SUM(${schema.variantSalesDaily.revenue}), 0)`,
    })
    .from(schema.variantSalesDaily)
    .where(
      and(
        gte(schema.variantSalesDaily.day, from.slice(0, 10)),
        lt(schema.variantSalesDaily.day, to.slice(0, 10)),
      ),
    );
  return { units: Number(rows[0]?.units ?? 0), revenue: Number(rows[0]?.revenue ?? 0) };
}

async function main() {
  const argStart = process.argv[2];
  const force = process.argv.includes("force");
  const client = await ainurClient();

  const done = await getSetting(SETTING);
  let month = argStart ?? (done && !force ? nextMonth(done) : FIRST_MONTH);
  const now = new Date();
  const lastMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  console.log(`Догрузка истории продаж: с ${month} по ${lastMonth}`);
  if (done) console.log(`Отметка о пройденном: ${done}${force ? " (игнорирую, force)" : ""}`);
  console.log("Ainur отвечает медленно — примерно 1–2 минуты на месяц. Можно прерывать.\n");
  console.log("месяц     прочитано  записано   штук   выручка THB   сек");

  let totalUnits = 0;
  let totalRevenue = 0;
  const failed: string[] = [];

  while (month <= lastMonth) {
    const { from, to } = monthBounds(month);
    const t0 = Date.now();
    const res = await syncSales(client, { from, to }, "backfill");
    const totals = await monthTotals(month);
    const secs = Math.round((Date.now() - t0) / 1000);

    if (!res.ok) {
      failed.push(month);
      console.log(`${month}   ОШИБКА: ${(res.details ?? []).join(" ").slice(0, 90)}`);
    } else {
      console.log(
        `${month}   ${String(res.itemsRead).padStart(9)} ${String(res.itemsWritten).padStart(9)} ` +
          `${String(totals.units).padStart(6)} ${Math.round(totals.revenue).toLocaleString("ru-RU").padStart(13)} ` +
          `${String(secs).padStart(5)}`,
      );
      totalUnits += totals.units;
      totalRevenue += totals.revenue;
      await setSetting(SETTING, month);
    }
    month = nextMonth(month);
  }

  console.log(`\nГотово. Всего в загруженных месяцах: ${totalUnits} шт, ${Math.round(totalRevenue).toLocaleString("ru-RU")} THB`);
  if (failed.length) {
    console.log(`Не получилось: ${failed.join(", ")} — запустите скрипт ещё раз, он повторит с отметки.`);
  }

  const byYear = await db
    .select({
      year: sql<string>`substr(${schema.variantSalesDaily.day}, 1, 4)`,
      units: sql<number>`SUM(${schema.variantSalesDaily.units})`,
      revenue: sql<number>`SUM(${schema.variantSalesDaily.revenue})`,
      days: sql<number>`COUNT(DISTINCT ${schema.variantSalesDaily.day})`,
    })
    .from(schema.variantSalesDaily)
    .groupBy(sql`substr(${schema.variantSalesDaily.day}, 1, 4)`);
  console.log("\nЧто теперь в базе по годам:");
  for (const r of byYear.sort((a, b) => a.year.localeCompare(b.year))) {
    console.log(
      `  ${r.year}: ${r.units} шт, ` +
        `${Math.round(Number(r.revenue)).toLocaleString("ru-RU")} THB, ` +
        `дней с продажами ${r.days}`,
    );
  }
}

main().catch((e) => {
  console.error("ОШИБКА:", e);
  process.exit(1);
});
