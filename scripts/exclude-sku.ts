/**
 * Убрать SKU из Luna и больше его не подтягивать.
 *
 * Зачем отдельный скрипт. Просто удалить позицию бесполезно: она лежит в
 * папке EVA MOON в Ainur, и следующая синхронизация создаст её заново.
 * Архивировать тоже бесполезно — синхронизация принудительно снимает
 * архив. Поэтому SKU попадает в список исключений (настройка
 * ainur_excluded_skus), и синхронизация его пропускает.
 *
 *   npm run sku:exclude 00738 00740 00741        добавить и удалить
 *   npm run sku:exclude --list                   показать список
 *   npm run sku:exclude --remove 00738           вернуть обратно
 *
 * Настоящее решение — переложить товар в Ainur из папки Eva Moon в папку
 * его бренда. Тогда он отфильтруется сам, и список исключений не нужен.
 */
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "../src/lib/db/client";

const KEY = "ainur_excluded_skus";

async function readList(): Promise<string[]> {
  const rows = await db
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, KEY))
    .limit(1);
  return (rows[0]?.value ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function writeList(list: string[]): Promise<void> {
  const value = [...new Set(list)].sort().join(",");
  const existing = await db
    .select({ key: schema.settings.key })
    .from(schema.settings)
    .where(eq(schema.settings.key, KEY))
    .limit(1);
  if (existing.length) {
    await db.update(schema.settings).set({ value }).where(eq(schema.settings.key, KEY));
  } else {
    await db.insert(schema.settings).values({ key: KEY, value });
  }
}

/** Ссылается ли на изделие что-то, что нельзя терять */
async function productInUse(productId: string): Promise<string | null> {
  const [orders, bomF, bomA, prices, patterns] = await Promise.all([
    db
      .select({ id: schema.productionOrderLines.id })
      .from(schema.productionOrderLines)
      .where(eq(schema.productionOrderLines.productId, productId))
      .limit(1),
    db
      .select({ id: schema.bomFabricLines.id })
      .from(schema.bomFabricLines)
      .where(eq(schema.bomFabricLines.productId, productId))
      .limit(1),
    db
      .select({ id: schema.bomAccessoryLines.id })
      .from(schema.bomAccessoryLines)
      .where(eq(schema.bomAccessoryLines.productId, productId))
      .limit(1),
    db
      .select({ id: schema.factoryPrices.id })
      .from(schema.factoryPrices)
      .where(eq(schema.factoryPrices.productId, productId))
      .limit(1),
    db
      .select({ id: schema.patternFiles.id })
      .from(schema.patternFiles)
      .where(eq(schema.patternFiles.productId, productId))
      .limit(1),
  ]);
  if (orders.length) return "есть в заказах на пошив";
  if (bomF.length || bomA.length) return "заведён состав изделия";
  if (prices.length) return "есть цена пошива";
  if (patterns.length) return "приложены лекала";
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const list = await readList();

  if (args.length === 0 || args.includes("--list")) {
    console.log(`В списке исключений ${list.length} SKU:`);
    console.log(list.length ? "  " + list.join(", ") : "  (пусто)");
    console.log("\nДобавить: npm run sku:exclude 00738 00740");
    return;
  }

  const remove = args[0] === "--remove";
  const skus = args
    .filter((a) => !a.startsWith("--"))
    .flatMap((a) => a.split(","))
    .map((s) => s.trim())
    .filter(Boolean);

  if (skus.length === 0) {
    console.error("Не указано ни одного SKU.");
    process.exit(1);
  }

  if (remove) {
    const next = list.filter((s) => !skus.includes(s));
    await writeList(next);
    console.log(`Убрал из исключений: ${skus.join(", ")}`);
    console.log(`Осталось в списке: ${next.length}`);
    console.log("Позиции вернутся при следующей синхронизации.");
    return;
  }

  await writeList([...list, ...skus]);
  console.log(`В список исключений добавлено: ${skus.join(", ")}`);

  const variants = await db
    .select({
      id: schema.productVariants.id,
      sku: schema.productVariants.sku,
      productId: schema.productVariants.productId,
    })
    .from(schema.productVariants)
    .where(inArray(schema.productVariants.sku, skus));

  if (variants.length === 0) {
    console.log("В базе этих SKU нет — удалять нечего.");
    return;
  }

  const productIds = [...new Set(variants.map((v) => v.productId))];
  await db
    .delete(schema.productVariants)
    .where(inArray(schema.productVariants.id, variants.map((v) => v.id)));
  console.log(`Удалено вариантов: ${variants.length} (остатки и продажи по ним удалились вместе с ними)`);

  let deletedProducts = 0;
  for (const pid of productIds) {
    const left = await db
      .select({ id: schema.productVariants.id })
      .from(schema.productVariants)
      .where(eq(schema.productVariants.productId, pid))
      .limit(1);
    if (left.length) continue;

    const reason = await productInUse(pid);
    const [prod] = await db
      .select({ name: schema.products.name })
      .from(schema.products)
      .where(eq(schema.products.id, pid))
      .limit(1);
    if (reason) {
      await db
        .update(schema.products)
        .set({ isArchived: true })
        .where(eq(schema.products.id, pid));
      console.log(`  «${prod?.name}» не удалил, отправил в архив: ${reason}`);
      continue;
    }
    await db.delete(schema.products).where(eq(schema.products.id, pid));
    deletedProducts++;
  }
  console.log(`Удалено изделий: ${deletedProducts}`);
  console.log("\nСинхронизация больше не будет их подтягивать.");
  console.log(
    "Правильнее переложить товар в Ainur из папки Eva Moon в папку его бренда —\n" +
      "тогда он отфильтруется сам и список исключений не понадобится.",
  );
}

main().catch((e) => {
  console.error("ОШИБКА:", e);
  process.exit(1);
});
