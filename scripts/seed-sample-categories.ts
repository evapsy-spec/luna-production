/**
 * Наполняет справочник категорий «Образцов» стартовым списком из ТЗ Евы.
 * Идемпотентно — повторный запуск ничего не дублирует (name уникально).
 *
 * Запуск: npx tsx --env-file=.env scripts/seed-sample-categories.ts
 */
import { db, schema } from "../src/lib/db/client";
import { sql } from "drizzle-orm";

const NAMES = [
  "Платье",
  "Кимоно",
  "Топ",
  "Брюки",
  "Шорты",
  "Юбка",
  "Комплект",
  "Мужское",
];

async function main() {
  for (let i = 0; i < NAMES.length; i++) {
    await db
      .insert(schema.sampleCategories)
      .values({ name: NAMES[i], sortOrder: i })
      .onConflictDoNothing({ target: schema.sampleCategories.name });
  }
  const rows = await db.select().from(schema.sampleCategories);
  console.log(`Категорий в справочнике: ${rows.length}`);
  for (const r of rows) console.log(` - ${r.name}`);
}

main();
