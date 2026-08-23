/**
 * Синхронизация Ainur → Luna Production.
 *
 * Запускается вручную по кнопке «Обновить» (так решила Ева — не по расписанию).
 * Единственное исключение — перемещения между складами: они тянутся
 * автоматически вместе с любой синхронизацией остатков.
 *
 * Направление всегда одно: Ainur — источник правды по товарам, остаткам,
 * продажам и перемещениям. Luna ничего не записывает обратно в Ainur.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { ainurClient } from "./token";
import {
  asInt,
  asNumber,
  asString,
  extractStoreId,
  type AinurCategory,
  type AinurClient,
  type AinurDocument,
  type AinurProduct,
} from "./client";

/**
 * Складывает строку в список подробностей, но не даёт ему разрастись.
 * При 2700 товарах наивный push давал 2800+ строк, и весь этот текст потом
 * лежал в базе и рендерился на странице — читать это невозможно.
 */
const MAX_DETAILS = 40;
function addDetail(details: string[], line: string): void {
  if (details.length < MAX_DETAILS) {
    details.push(line);
  } else if (details.length === MAX_DETAILS) {
    details.push("…дальнейшие однотипные строки не показываю");
  }
}

export interface SyncResult {
  kind: string;
  ok: boolean;
  itemsRead: number;
  itemsWritten: number;
  durationMs: number;
  details: string[];
  error?: string;
}

// ============================================================
// СКЛАДЫ
// ============================================================

/**
 * Подтягивает список складов/точек. Нужен первым: без него ID из поля
 * stock не превратить в человеческое «Панган» / «USA Warehouse».
 */
export async function syncStores(
  client: AinurClient,
  actor = "system",
): Promise<SyncResult> {
  const started = Date.now();
  const details: string[] = [];
  const run = await beginRun("stores", actor);

  try {
    const stores = await client.getStores();
    let written = 0;

    if (stores.length === 0) {
      details.push(
        "Ainur вернул пустой список складов. Форма ответа: " +
          (client.lastEmptyShape ?? "неизвестна") +
          ". Склады всё равно появятся сами при загрузке товаров — их ID есть " +
          "в остатках каждого SKU.",
      );
    }

    for (const store of stores) {
      const name = asString(store.name) ?? `Склад ${store.id}`;
      const existing = await db
        .select()
        .from(schema.warehouses)
        .where(eq(schema.warehouses.ainurId, store.id))
        .limit(1);

      if (existing.length === 0) {
        await db.insert(schema.warehouses).values({
          name,
          kind: "GOODS",
          ainurId: store.id,
        });
        addDetail(details, `новый склад: ${name}`);
        written++;
      } else if (existing[0].name !== name) {
        // переименовали в Ainur — подхватываем, но не ломаем наши связи
        await db
          .update(schema.warehouses)
          .set({ name })
          .where(eq(schema.warehouses.id, existing[0].id));
        addDetail(details, `переименован: ${existing[0].name} → ${name}`);
        written++;
      }
    }

    await finishRun(run, "OK", stores.length, written);
    return {
      kind: "stores",
      ok: true,
      itemsRead: stores.length,
      itemsWritten: written,
      durationMs: Date.now() - started,
      details,
    };
  } catch (err) {
    await finishRun(run, "ERROR", 0, 0, (err as Error).message);
    return errorResult("stores", started, err, details);
  }
}

// ============================================================
// ТОВАРЫ И ОСТАТКИ
// ============================================================

/**
 * Товары, коллекции и остатки по складам.
 *
 * Иерархия у нас: коллекция → изделие (модель) → вариант (SKU).
 * В Ainur вариант — это отдельная запись товара; имя модели лежит в
 * options.name, а цвет/размер — в variation.property. По ним и собираем
 * изделия, чтобы BOM и лекала висели на модели, а не на каждом цвете.
 */
export async function syncProducts(
  client: AinurClient,
  actor = "system",
  opts: { snapshot?: boolean } = { snapshot: true },
): Promise<SyncResult> {
  const started = Date.now();
  const details: string[] = [];
  const run = await beginRun("products", actor);

  try {
    // 0. Склады должны существовать до раскладки остатков
    const warehouseByAinurId = await loadWarehouseMap();

    // 1. Коллекции (группы Ainur)
    //
    // В Ainur лежат каталоги нескольких брендов, разложенные по корневым
    // папкам. Нас интересует только поддерево бренда EVA MOON — остальное
    // (Forever Beach, Munay, Kalifesta и прочие) в это приложение попадать
    // не должно.
    //
    // Коллекцией считаем ПРЯМОГО ребёнка корня бренда: Silk collection,
    // Shiva Shakti, For Men и т.д. Более глубокие группы (например
    // Silk collection → Kimono) сворачиваются в свою верхнюю коллекцию —
    // именно так эти данные привыкли видеть в EVA MOON.
    const categories = await client.getCategories();
    const brandRootId = await resolveBrandRoot(categories);

    if (!brandRootId) {
      throw new Error(
        "Не удалось определить корневую папку бренда EVA MOON в Ainur. " +
          "Проверьте настройку ainur_brand_root_id или наличие группы «Eva Moon».",
      );
    }

    const catById = new Map(categories.map((c) => [c.id, c]));
    /** Категория → верхняя коллекция бренда (или null, если это чужой бренд) */
    const topLevelOf = (categoryId: string): AinurCategory | null => {
      let current = catById.get(categoryId);
      const seen = new Set<string>();
      while (current) {
        if (seen.has(current.id)) return null; // защита от циклов в данных
        seen.add(current.id);
        const parentId = asString(
          (current as { parent_id?: unknown }).parent_id,
        );
        if (parentId === brandRootId) return current;
        if (!parentId) return null; // дошли до корня, и это не наш бренд
        current = catById.get(parentId);
      }
      return null;
    };

    // Заранее считаем соответствие «любая категория бренда → id коллекции»
    const collectionByAinurId = new Map<string, string>();
    const topLevels = categories.filter(
      (c) => asString((c as { parent_id?: unknown }).parent_id) === brandRootId,
    );
    addDetail(
      details,
      `бренд EVA MOON: коллекций верхнего уровня ${topLevels.length}, ` +
        `всего групп бренда ${categories.filter((c) => topLevelOf(c.id)).length}`,
    );

    for (const top of topLevels) {
      const name = asString(top.name) ?? `Коллекция ${top.id}`;
      const existing = await db
        .select()
        .from(schema.collections)
        .where(eq(schema.collections.ainurCategoryId, top.id))
        .limit(1);

      let collectionId: string;
      if (existing.length === 0) {
        const [created] = await db
          .insert(schema.collections)
          .values({ name, ainurCategoryId: top.id })
          .returning();
        collectionId = created.id;
        addDetail(details, `новая коллекция: ${name}`);
      } else {
        collectionId = existing[0].id;
        if (existing[0].name !== name) {
          await db
            .update(schema.collections)
            .set({ name })
            .where(eq(schema.collections.id, existing[0].id));
        }
      }
      // сама коллекция и все её вложенные группы ведут к одному id
      collectionByAinurId.set(top.id, collectionId);
    }

    for (const cat of categories) {
      const top = topLevelOf(cat.id);
      if (!top) continue;
      const collectionId = collectionByAinurId.get(top.id);
      if (collectionId) collectionByAinurId.set(cat.id, collectionId);
    }

    let skippedOtherBrands = 0;
    let skippedExcluded = 0;

    /**
     * Список SKU, которые мы сознательно НЕ ведём, даже если в Ainur они
     * лежат внутри папки EVA MOON. Так бывает с чужим товаром, который
     * просто положили не в ту группу: например, «Antistress ring» —
     * не наша коллекция.
     *
     * Без этого списка удалить такую позицию бесполезно: следующая
     * синхронизация создаст её заново, а архивирование снимется, потому
     * что ниже мы принудительно ставим isArchived: false.
     *
     * Список ведётся скриптом sku:exclude, лежит в настройке
     * ainur_excluded_skus.
     */
    const excludedSkus = await loadExcludedSkus();

    // Коллекция-заглушка для товаров без категории — чтобы ничего не потерять
    let fallbackCollectionId: string | null = null;
    const ensureFallbackCollection = async (): Promise<string> => {
      if (fallbackCollectionId) return fallbackCollectionId;
      const existing = await db
        .select()
        .from(schema.collections)
        .where(eq(schema.collections.name, "Без коллекции"))
        .limit(1);
      if (existing.length) {
        fallbackCollectionId = existing[0].id;
      } else {
        const [created] = await db
          .insert(schema.collections)
          .values({ name: "Без коллекции" })
          .returning();
        fallbackCollectionId = created.id;
      }
      return fallbackCollectionId;
    };

    // 2. Товары
    let read = 0;
    const products = await client.getAllProducts((_, total) => {
      read = total;
    });
    read = products.length;

    let written = 0;
    // кеш «коллекция + имя модели» → id изделия
    const productCache = new Map<string, string>();
    const seenVariantIds: string[] = [];

    // Обрабатываем каждый товар отдельно: в реальном каталоге всегда есть
    // особые случаи, и один такой не должен обнулять всю синхронизацию.
    const failures: string[] = [];

    for (const item of products) {
      try {
      const sku =
        asString(item.code) ?? asString(item.sku) ?? asString(item.barcode);
      if (!sku) {
        addDetail(details, `пропущен товар без SKU: ${item.options?.name ?? item.id}`);
        continue;
      }

      if (excludedSkus.has(sku)) {
        skippedExcluded++;
        continue;
      }

      const modelName = asString(item.options?.name) ?? "Без названия";
      const { color, size } = parseVariation(item);

      const categoryId = asString(item.category_id);

      // Товар чужого бренда — пропускаем молча, это не ошибка
      if (!categoryId || !collectionByAinurId.has(categoryId)) {
        skippedOtherBrands++;
        continue;
      }
      const collectionId = collectionByAinurId.get(categoryId)!;

      // 2a. Изделие (модель)
      const productKey = `${collectionId}::${modelName}`;
      let productId = productCache.get(productKey);
      if (!productId) {
        const existing = await db
          .select()
          .from(schema.products)
          .where(
            and(
              eq(schema.products.collectionId, collectionId),
              eq(schema.products.name, modelName),
            ),
          )
          .limit(1);

        if (existing.length) {
          productId = existing[0].id;
          if (!existing[0].photoUrl && asString(item.img)) {
            await db
              .update(schema.products)
              .set({ photoUrl: asString(item.img) })
              .where(eq(schema.products.id, productId));
          }
        } else {
          const [created] = await db
            .insert(schema.products)
            .values({
              collectionId,
              name: modelName,
              baseSku: sku,
              photoUrl: asString(item.img),
            })
            .returning();
          productId = created.id;
          addDetail(details, `новое изделие: ${modelName}`);
        }
        productCache.set(productKey, productId);
      }

      // 2b. Вариант (конкретный SKU)
      const existingVariant = await db
        .select()
        .from(schema.productVariants)
        .where(eq(schema.productVariants.sku, sku))
        .limit(1);

      let variantId: string;
      if (existingVariant.length) {
        variantId = existingVariant[0].id;
        await db
          .update(schema.productVariants)
          .set({
            productId,
            color,
            size,
            ainurId: asString(item.id),
            ainurName: asString(item.options?.name),
            price: asNumber(item.price),
            isArchived: false,
          })
          .where(eq(schema.productVariants.id, variantId));
      } else {
        const [created] = await db
          .insert(schema.productVariants)
          .values({
            productId,
            sku,
            color,
            size,
            ainurId: asString(item.id),
            ainurName: asString(item.options?.name),
            price: asNumber(item.price),
          })
          .returning();
        variantId = created.id;
        written++;
      }
      seenVariantIds.push(variantId);

      // 2c. Остатки по складам — приходят прямо в поле stock
      if (item.stock) {
        for (const [ainurStoreId, qty] of Object.entries(item.stock)) {
          const warehouseId = warehouseByAinurId.get(ainurStoreId);
          if (!warehouseId) {
            // склад появился в Ainur после нашей синхронизации складов —
            // создаём на лету, чтобы не терять остаток
            const [created] = await db
              .insert(schema.warehouses)
              .values({
                name: `Склад ${ainurStoreId}`,
                kind: "GOODS",
                ainurId: ainurStoreId,
              })
              .returning();
            warehouseByAinurId.set(ainurStoreId, created.id);
            addDetail(details, `склад создан на лету: ${created.name}`);
          }
          const wid = warehouseByAinurId.get(ainurStoreId)!;

          await upsertVariantStock(variantId, wid, Math.round(Number(qty) || 0));
        }
      }
      } catch (itemError) {
        const label =
          item.code ?? item.sku ?? item.options?.name ?? item.id ?? "без имени";
        failures.push(`${label}: ${describeError(itemError).slice(0, 200)}`);
      }
    }

    if (skippedOtherBrands > 0) {
      details.push(
        `пропущено товаров других брендов: ${skippedOtherBrands} из ${products.length}`,
      );
    }

    if (skippedExcluded > 0) {
      details.push(
        `пропущено по списку исключений: ${skippedExcluded} ` +
          `(настройка ainur_excluded_skus, правится через npm run sku:exclude)`,
      );
    }

    if (failures.length > 0) {
      details.push(
        `не удалось загрузить позиций: ${failures.length} из ${products.length}`,
      );
      // показываем первые пять — остальное было бы нечитаемой простыней
      for (const f of failures.slice(0, 5)) addDetail(details, f);
      if (failures.length > 5) {
        details.push(`…и ещё ${failures.length - 5} с похожими причинами`);
      }
    }

    // 3. Снимок общего остатка — Ainur историю не хранит, храним у себя
    if (opts.snapshot) {
      await writeStockSnapshots();
      details.push("снимок остатков сохранён");
    }

    await finishRun(run, "OK", read, written);
    return {
      kind: "products",
      ok: true,
      itemsRead: read,
      itemsWritten: written,
      durationMs: Date.now() - started,
      details,
    };
  } catch (err) {
    await finishRun(run, "ERROR", 0, 0, (err as Error).message);
    return errorResult("products", started, err, details);
  }
}

// ============================================================
// ПРОДАЖИ
// ============================================================

/**
 * Продажи за период, свёрнутые по дню и варианту.
 * Из них считается скорость продаж и «на сколько месяцев хватит запаса».
 */
export async function syncSales(
  client: AinurClient,
  range: { from: string; to?: string },
  actor = "system",
): Promise<SyncResult> {
  const started = Date.now();
  const details: string[] = [];
  const run = await beginRun("sales", actor, range.from, range.to);

  try {
    const docs = await client.getSales({
      timeStart: range.from,
      timeEnd: range.to,
    });

    const variantBySku = await loadVariantSkuMap();
    const warehouseByAinurId = await loadWarehouseMap();

    // агрегируем в память: ключ = вариант|склад|день
    type Bucket = { units: number; revenue: number; cost: number };
    const buckets = new Map<string, Bucket>();
    let lineCount = 0;
    let unmatched = 0;

    for (const doc of docs) {
      const day = toDay(doc.processed_at ?? doc.created_at);
      if (!day) continue;
      const warehouseId = doc.location_id
        ? (warehouseByAinurId.get(doc.location_id) ?? null)
        : null;

      for (const line of doc.line_items ?? []) {
        lineCount++;
        const sku = asString(line.code) ?? asString(line.sku);
        const variantId = sku ? variantBySku.get(sku) : undefined;
        if (!variantId) {
          unmatched++;
          continue;
        }

        const key = `${variantId}|${warehouseId ?? ""}|${day}`;
        const bucket = buckets.get(key) ?? { units: 0, revenue: 0, cost: 0 };
        /**
         * Количество в Ainur записано со знаком движения склада: продажа
         * одной штуки приходит как -1. Поэтому знак меняем, а не берём
         * модуль: если строка окажется возвратом (+1), она правильно
         * уменьшит итог продаж, а не добавится к нему.
         */
        bucket.units += -asInt(line.quantity);

        /**
         * Выручку берём из legacy_line.sum — это итог по строке уже со
         * скидкой. Поля total у строк нет, а price — цена за ЕДИНИЦУ:
         * если брать её, выручка по строке с двумя штуками будет вдвое
         * меньше настоящей.
         */
        const lineSum = asNumber(line.legacy_line?.sum);
        const unitPrice = asNumber(line.price) ?? 0;
        const units = -asInt(line.quantity);
        bucket.revenue += lineSum !== null ? Math.abs(lineSum) : unitPrice * units;
        bucket.cost += asNumber(line.cost) ?? 0;
        buckets.set(key, bucket);
      }
    }

    if (unmatched > 0) {
      details.push(
        `${unmatched} строк продаж не сопоставлено: часть — товары других ` +
          `брендов (их мы не учитываем), часть — строки, в которых Ainur не ` +
          `указал SKU (есть только название). Такие продажи в скорость не входят.`,
      );
    }

    // перезаписываем дни, которые попали в период: повторный запуск
    // синхронизации за тот же период не должен удваивать продажи
    let written = 0;
    for (const [key, bucket] of buckets) {
      const [variantId, warehouseRaw, day] = key.split("|");
      const warehouseId = warehouseRaw === "" ? null : warehouseRaw;

      const existing = await db
        .select()
        .from(schema.variantSalesDaily)
        .where(
          and(
            eq(schema.variantSalesDaily.variantId, variantId),
            eq(schema.variantSalesDaily.day, day),
            warehouseId === null
              ? sql`${schema.variantSalesDaily.warehouseId} IS NULL`
              : eq(schema.variantSalesDaily.warehouseId, warehouseId),
          ),
        )
        .limit(1);

      if (existing.length) {
        await db
          .update(schema.variantSalesDaily)
          .set({
            units: bucket.units,
            revenue: bucket.revenue,
            cost: bucket.cost,
          })
          .where(eq(schema.variantSalesDaily.id, existing[0].id));
      } else {
        await db.insert(schema.variantSalesDaily).values({
          variantId,
          warehouseId,
          day,
          units: bucket.units,
          revenue: bucket.revenue,
          cost: bucket.cost,
        });
      }
      written++;
    }

    details.push(`документов: ${docs.length}, строк: ${lineCount}`);
    await finishRun(run, "OK", docs.length, written);
    return {
      kind: "sales",
      ok: true,
      itemsRead: docs.length,
      itemsWritten: written,
      durationMs: Date.now() - started,
      details,
    };
  } catch (err) {
    await finishRun(run, "ERROR", 0, 0, (err as Error).message);
    return errorResult("sales", started, err, details);
  }
}

// ============================================================
// ПЕРЕМЕЩЕНИЯ МЕЖДУ СКЛАДАМИ
// ============================================================

/**
 * Перемещения — из документов изменения остатков: поля source → destination.
 * Тянутся автоматически, без отдельной кнопки.
 */
export async function syncMovements(
  client: AinurClient,
  range: { from: string; to?: string },
  actor = "system",
): Promise<SyncResult> {
  const started = Date.now();
  const details: string[] = [];
  const run = await beginRun("movements", actor, range.from, range.to);

  try {
    const docs = await client.getStockChanges({
      timeStart: range.from,
      timeEnd: range.to,
    });

    const variantBySku = await loadVariantSkuMap();
    const warehouseByAinurId = await loadWarehouseMap();
    let written = 0;
    let skippedNonMove = 0;

    for (const doc of docs) {
      const fromAinur = extractStoreId(doc.source);
      const toAinur = extractStoreId(doc.destination);

      // перемещение — это документ, у которого есть и источник, и получатель.
      // Прочие корректировки остатка нас здесь не интересуют.
      if (!fromAinur || !toAinur || fromAinur === toAinur) {
        skippedNonMove++;
        continue;
      }

      const occurredAt = doc.processed_at ?? doc.created_at;
      if (!occurredAt) continue;

      for (const [idx, line] of (doc.line_items ?? []).entries()) {
        const sku = asString(line.code) ?? asString(line.sku);
        const variantId = sku ? variantBySku.get(sku) : undefined;
        const docKey = `${doc.id}:${idx}`;

        const existing = await db
          .select()
          .from(schema.stockMovements)
          .where(eq(schema.stockMovements.ainurDocumentId, docKey))
          .limit(1);
        if (existing.length) continue; // уже загружено

        await db.insert(schema.stockMovements).values({
          ainurDocumentId: docKey,
          variantId: variantId ?? null,
          fromWarehouseId: warehouseByAinurId.get(fromAinur) ?? null,
          toWarehouseId: warehouseByAinurId.get(toAinur) ?? null,
          // в документах склада количество тоже со знаком движения
          quantity: Math.abs(asInt(line.quantity)),
          occurredAt: new Date(occurredAt).toISOString(),
          note: asString(line.name) ?? asString(doc.note),
        });
        written++;
      }
    }

    details.push(
      `документов изменения остатка: ${docs.length}` +
        (skippedNonMove > 0
          ? `, из них ${skippedNonMove} — корректировки на одном складе ` +
            `(у них не заполнен склад-получатель), а не переброски между складами`
          : ""),
    );
    await finishRun(run, "OK", docs.length, written);
    return {
      kind: "movements",
      ok: true,
      itemsRead: docs.length,
      itemsWritten: written,
      durationMs: Date.now() - started,
      details,
    };
  } catch (err) {
    await finishRun(run, "ERROR", 0, 0, (err as Error).message);
    return errorResult("movements", started, err, details);
  }
}

// ============================================================
// ПОЛНАЯ СИНХРОНИЗАЦИЯ — то, что делает кнопка «Обновить»
// ============================================================

export async function syncAll(
  actor = "system",
  opts: { salesFrom?: string } = {},
): Promise<SyncResult[]> {
  const client = await ainurClient();
  const results: SyncResult[] = [];

  results.push(await syncStores(client, actor));

  const products = await syncProducts(client, actor);
  results.push(products);

  // продажи: по умолчанию добираем последние 60 дней —
  // хватает для скорости продаж, не перегружая API
  const salesFrom =
    opts.salesFrom ??
    new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString();
  results.push(await syncSales(client, { from: salesFrom }, actor));
  results.push(await syncMovements(client, { from: salesFrom }, actor));

  return results;
}

// ============================================================
// Вспомогательные
// ============================================================

/**
 * SKU, которые не ведём в Luna, хотя в Ainur они лежат в папке EVA MOON.
 * Хранятся одной строкой через запятую в настройке ainur_excluded_skus.
 */
export async function loadExcludedSkus(): Promise<Set<string>> {
  const rows = await db
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, "ainur_excluded_skus"))
    .limit(1);
  const raw = rows[0]?.value ?? "";
  return new Set(
    raw
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/**
 * Находит корневую папку бренда EVA MOON.
 *
 * Сначала смотрим настройку ainur_brand_root_id — она позволяет переключить
 * бренд без правки кода. Если её нет, ищем корневую группу с названием
 * «Eva Moon»: у EVA MOON, в отличие от остальных брендов, названия-префикса
 * у вложенных коллекций нет, поэтому опираться можно только на корень.
 */
async function resolveBrandRoot(
  categories: AinurCategory[],
): Promise<string | null> {
  const setting = await db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, "ainur_brand_root_id"))
    .limit(1);
  const configured = setting[0]?.value?.trim();
  if (configured) return configured;

  const byName = categories.find(
    (c) => (asString(c.name) ?? "").toLowerCase() === "eva moon",
  );
  if (byName) {
    // запоминаем, чтобы дальше не искать по названию каждый раз
    await db
      .insert(schema.settings)
      .values({
        key: "ainur_brand_root_id",
        value: byName.id,
        updatedAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: schema.settings.key,
        set: { value: byName.id, updatedAt: new Date().toISOString() },
      });
    return byName.id;
  }
  return null;
}

async function loadWarehouseMap(): Promise<Map<string, string>> {
  const rows = await db.select().from(schema.warehouses);
  const map = new Map<string, string>();
  for (const row of rows) if (row.ainurId) map.set(row.ainurId, row.id);
  return map;
}

async function loadVariantSkuMap(): Promise<Map<string, string>> {
  const rows = await db
    .select({
      id: schema.productVariants.id,
      sku: schema.productVariants.sku,
    })
    .from(schema.productVariants);
  return new Map(rows.map((r) => [r.sku, r.id]));
}

async function upsertVariantStock(
  variantId: string,
  warehouseId: string,
  quantity: number,
): Promise<void> {
  const existing = await db
    .select()
    .from(schema.variantStock)
    .where(
      and(
        eq(schema.variantStock.variantId, variantId),
        eq(schema.variantStock.warehouseId, warehouseId),
      ),
    )
    .limit(1);

  const syncedAt = new Date().toISOString();
  if (existing.length) {
    await db
      .update(schema.variantStock)
      .set({ quantity, syncedAt })
      .where(eq(schema.variantStock.id, existing[0].id));
  } else {
    await db
      .insert(schema.variantStock)
      .values({ variantId, warehouseId, quantity, syncedAt });
  }
}

/** Складывает снимок остатков: всего и по коллекциям */
async function writeStockSnapshots(): Promise<void> {
  const takenAt = new Date().toISOString();

  const totalRow = await db
    .select({ total: sql<number>`COALESCE(SUM(${schema.variantStock.quantity}), 0)` })
    .from(schema.variantStock);
  await db.insert(schema.stockSnapshots).values({
    takenAt,
    scope: "total",
    refId: null,
    quantity: Number(totalRow[0]?.total ?? 0),
  });

  const byCollection = await db
    .select({
      collectionId: schema.products.collectionId,
      total: sql<number>`COALESCE(SUM(${schema.variantStock.quantity}), 0)`,
    })
    .from(schema.variantStock)
    .innerJoin(
      schema.productVariants,
      eq(schema.variantStock.variantId, schema.productVariants.id),
    )
    .innerJoin(
      schema.products,
      eq(schema.productVariants.productId, schema.products.id),
    )
    .groupBy(schema.products.collectionId);

  for (const row of byCollection) {
    await db.insert(schema.stockSnapshots).values({
      takenAt,
      scope: "collection",
      refId: row.collectionId,
      quantity: Number(row.total ?? 0),
    });
  }
}

async function beginRun(
  kind: string,
  actor: string,
  rangeFrom?: string,
  rangeTo?: string,
): Promise<string> {
  const [row] = await db
    .insert(schema.syncRuns)
    .values({
      kind,
      status: "RUNNING",
      triggeredBy: actor,
      rangeFrom: rangeFrom ?? null,
      rangeTo: rangeTo ?? null,
    })
    .returning();
  return row.id;
}

async function finishRun(
  id: string,
  status: "OK" | "ERROR",
  itemsRead: number,
  itemsWritten: number,
  error?: string,
): Promise<void> {
  await db
    .update(schema.syncRuns)
    .set({
      status,
      itemsRead,
      itemsWritten,
      error: error ?? null,
      finishedAt: new Date().toISOString(),
    })
    .where(eq(schema.syncRuns.id, id));
}

function errorResult(
  kind: string,
  started: number,
  err: unknown,
  details: string[],
): SyncResult {
  return {
    kind,
    ok: false,
    itemsRead: 0,
    itemsWritten: 0,
    durationMs: Date.now() - started,
    details,
    error: describeError(err),
  };
}

/**
 * Разворачивает вложенные ошибки до сообщения драйвера.
 * Drizzle оборачивает ошибку SQLite в свою («Failed query: insert into...»),
 * а настоящая причина — SQLITE_CONSTRAINT и подобное — лежит в cause.
 * Без этого в интерфейсе видно только текст запроса и непонятно, что не так.
 */
export function describeError(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    const e = current as { message?: string; cause?: unknown; code?: string };
    if (e.message) {
      const line = e.code ? `${e.code}: ${e.message}` : e.message;
      if (!parts.includes(line)) parts.push(line);
    }
    current = e.cause;
  }
  // Причину ставим первой: сообщение Drizzle начинается с текста запроса,
  // и при обрезке самое важное — ошибка драйвера — терялось.
  return parts.reverse().join(" ← ").slice(0, 900);
}

/** Из вариации Ainur достаём цвет и размер */
function parseVariation(item: AinurProduct): {
  color: string | null;
  size: string | null;
} {
  const props = item.variation?.property ?? [];
  let color: string | null = null;
  let size: string | null = null;

  for (const prop of props) {
    const key = (prop.key ?? "").toLowerCase();
    const value = prop.value ?? null;
    if (!value) continue;
    if (/цвет|color|colour/.test(key)) color = value;
    else if (/размер|size/.test(key)) size = value;
  }

  // если ключи не распознались — берём имя вариации целиком как цвет
  if (!color && !size && item.variation?.name) {
    color = item.variation.name;
  }
  return { color, size };
}

function toDay(value?: string): string | null {
  if (!value) return null;
  const d = new Date(value.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** Последняя успешная синхронизация каждого вида — для показа «обновлено ...» */
export async function getLastSyncTimes(): Promise<
  Record<string, { at: string; status: string } | undefined>
> {
  const rows = await db
    .select()
    .from(schema.syncRuns)
    .orderBy(sql`${schema.syncRuns.startedAt} DESC`)
    .limit(50);

  const out: Record<string, { at: string; status: string } | undefined> = {};
  for (const row of rows) {
    if (!out[row.kind]) {
      out[row.kind] = {
        at: row.finishedAt ?? row.startedAt,
        status: row.status,
      };
    }
  }
  return out;
}
