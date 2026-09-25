import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { canSeeMoney, getCurrentUser, writeAudit } from "@/lib/auth";
import { formatFileSize, saveOptionalUpload } from "@/lib/uploads";
import {
  fabricCostPerMeterThb,
  formatMeters,
  getVelocity,
  round2,
} from "@/lib/production";
import { CoverageBar } from "@/components/charts";
import {
  Button,
  Callout,
  Card,
  Field,
  Input,
  LinkButton,
  Money,
  PageHeader,
  SectionTitle,
  Select,
  Stat,
  StatusPill,
  Table,
  Td,
  Th,
  Thumb,
  formatDate,
} from "@/components/ui";
import {
  BomPill,
  PatternPill,
  StockChips,
  parseNumber,
  parseText,
  type WarehouseQty,
} from "../../collections/_shared";

export const metadata = { title: "Изделие — Luna Production" };

// ============================================================
// SERVER ACTIONS
// ============================================================

async function productName(productId: string): Promise<string> {
  const rows = await db
    .select({ name: schema.products.name })
    .from(schema.products)
    .where(eq(schema.products.id, productId))
    .limit(1);
  return rows[0]?.name ?? productId;
}

async function addVariant(formData: FormData) {
  "use server";
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const productId = String(formData.get("productId") ?? "");
  const sku = parseText(formData.get("sku"));
  if (!productId) redirect("/collections");
  if (!sku) redirect(`/products/${productId}?error=variant`);

  const duplicate = await db
    .select({ id: schema.productVariants.id })
    .from(schema.productVariants)
    .where(eq(schema.productVariants.sku, sku))
    .limit(1);
  if (duplicate.length > 0) redirect(`/products/${productId}?error=variantSku`);

  const [variant] = await db
    .insert(schema.productVariants)
    .values({
      productId,
      sku,
      color: parseText(formData.get("color")),
      size: parseText(formData.get("size")),
      price: parseNumber(formData.get("price")),
      // токен для QR-метки партии — по нему склад открывает вариант с телефона
      qrToken: `var-${crypto.randomUUID().slice(0, 12)}`,
    })
    .returning();

  await writeAudit(user, {
    action: "CREATE",
    entityType: "product_variant",
    entityId: variant.id,
    entityName: `${sku} · ${await productName(productId)}`,
  });

  revalidatePath(`/products/${productId}`);
  revalidatePath("/collections");
  redirect(`/products/${productId}?ok=variant`);
}

async function toggleVariantArchive(formData: FormData) {
  "use server";
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const productId = String(formData.get("productId") ?? "");
  const variantId = String(formData.get("variantId") ?? "");
  if (!productId || !variantId) redirect("/collections");

  const rows = await db
    .select()
    .from(schema.productVariants)
    .where(eq(schema.productVariants.id, variantId))
    .limit(1);
  const variant = rows[0];
  if (!variant) redirect(`/products/${productId}`);

  const next = !variant.isArchived;
  await db
    .update(schema.productVariants)
    .set({ isArchived: next })
    .where(eq(schema.productVariants.id, variantId));

  await writeAudit(user, {
    action: "UPDATE",
    entityType: "product_variant",
    entityId: variantId,
    entityName: `${variant.sku} · ${await productName(productId)}`,
    changes: { архив: { from: variant.isArchived, to: next } },
  });

  revalidatePath(`/products/${productId}`);
  revalidatePath("/collections");
  redirect(`/products/${productId}?ok=${next ? "archived" : "restored"}`);
}

async function addBomFabric(formData: FormData) {
  "use server";
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const productId = String(formData.get("productId") ?? "");
  const fabricId = parseText(formData.get("fabricId"));
  const metersPerUnit = parseNumber(formData.get("metersPerUnit"));
  if (!productId) redirect("/collections");
  if (!fabricId || metersPerUnit == null || metersPerUnit <= 0) {
    redirect(`/products/${productId}?error=bomFabric`);
  }

  const duplicate = await db
    .select({ id: schema.bomFabricLines.id })
    .from(schema.bomFabricLines)
    .where(
      and(
        eq(schema.bomFabricLines.productId, productId),
        eq(schema.bomFabricLines.fabricId, fabricId),
      ),
    )
    .limit(1);
  if (duplicate.length > 0) redirect(`/products/${productId}?error=bomDouble`);

  const [line] = await db
    .insert(schema.bomFabricLines)
    .values({
      productId,
      fabricId,
      metersPerUnit,
      wastePct: parseNumber(formData.get("wastePct")) ?? 0,
      note: parseText(formData.get("note")),
    })
    .returning();

  const fabric = await db
    .select({ name: schema.fabrics.name, sku: schema.fabrics.sku })
    .from(schema.fabrics)
    .where(eq(schema.fabrics.id, fabricId))
    .limit(1);

  await writeAudit(user, {
    action: "CREATE",
    entityType: "bom_fabric_line",
    entityId: line.id,
    entityName: `${await productName(productId)} ← ${fabric[0]?.name ?? fabricId}`,
    changes: {
      "метров на изделие": { from: null, to: metersPerUnit },
      припуск: { from: null, to: line.wastePct },
    },
  });

  revalidatePath(`/products/${productId}`);
  revalidatePath("/collections");
  redirect(`/products/${productId}?ok=bomFabric`);
}

async function updateBomFabric(formData: FormData) {
  "use server";
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const productId = String(formData.get("productId") ?? "");
  const lineId = String(formData.get("lineId") ?? "");
  const metersPerUnit = parseNumber(formData.get("metersPerUnit"));
  if (!productId || !lineId) redirect("/collections");
  if (metersPerUnit == null || metersPerUnit <= 0) {
    redirect(`/products/${productId}?error=bomFabric`);
  }

  const rows = await db
    .select({
      line: schema.bomFabricLines,
      fabricName: schema.fabrics.name,
    })
    .from(schema.bomFabricLines)
    .innerJoin(
      schema.fabrics,
      eq(schema.bomFabricLines.fabricId, schema.fabrics.id),
    )
    .where(eq(schema.bomFabricLines.id, lineId))
    .limit(1);
  const before = rows[0];
  if (!before) redirect(`/products/${productId}`);

  const wastePct = parseNumber(formData.get("wastePct")) ?? 0;

  await db
    .update(schema.bomFabricLines)
    .set({ metersPerUnit, wastePct })
    .where(eq(schema.bomFabricLines.id, lineId));

  await writeAudit(user, {
    action: "UPDATE",
    entityType: "bom_fabric_line",
    entityId: lineId,
    entityName: `${await productName(productId)} ← ${before.fabricName}`,
    changes: {
      "метров на изделие": {
        from: before.line.metersPerUnit,
        to: metersPerUnit,
      },
      припуск: { from: before.line.wastePct, to: wastePct },
    },
  });

  revalidatePath(`/products/${productId}`);
  redirect(`/products/${productId}?ok=bomSaved`);
}

async function deleteBomFabric(formData: FormData) {
  "use server";
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const productId = String(formData.get("productId") ?? "");
  const lineId = String(formData.get("lineId") ?? "");
  if (!productId || !lineId) redirect("/collections");

  const rows = await db
    .select({ fabricName: schema.fabrics.name })
    .from(schema.bomFabricLines)
    .innerJoin(
      schema.fabrics,
      eq(schema.bomFabricLines.fabricId, schema.fabrics.id),
    )
    .where(eq(schema.bomFabricLines.id, lineId))
    .limit(1);

  await db
    .delete(schema.bomFabricLines)
    .where(eq(schema.bomFabricLines.id, lineId));

  await writeAudit(user, {
    action: "DELETE",
    entityType: "bom_fabric_line",
    entityId: lineId,
    entityName: `${await productName(productId)} ← ${rows[0]?.fabricName ?? "ткань"}`,
  });

  revalidatePath(`/products/${productId}`);
  revalidatePath("/collections");
  redirect(`/products/${productId}?ok=bomDeleted`);
}

async function addBomAccessory(formData: FormData) {
  "use server";
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const productId = String(formData.get("productId") ?? "");
  const accessoryId = parseText(formData.get("accessoryId"));
  const qtyPerUnit = parseNumber(formData.get("qtyPerUnit"));
  if (!productId) redirect("/collections");
  if (!accessoryId || qtyPerUnit == null || qtyPerUnit <= 0) {
    redirect(`/products/${productId}?error=bomAccessory`);
  }

  const duplicate = await db
    .select({ id: schema.bomAccessoryLines.id })
    .from(schema.bomAccessoryLines)
    .where(
      and(
        eq(schema.bomAccessoryLines.productId, productId),
        eq(schema.bomAccessoryLines.accessoryId, accessoryId),
      ),
    )
    .limit(1);
  if (duplicate.length > 0) redirect(`/products/${productId}?error=bomDouble`);

  const [line] = await db
    .insert(schema.bomAccessoryLines)
    .values({ productId, accessoryId, qtyPerUnit })
    .returning();

  const accessory = await db
    .select({ name: schema.accessories.name })
    .from(schema.accessories)
    .where(eq(schema.accessories.id, accessoryId))
    .limit(1);

  await writeAudit(user, {
    action: "CREATE",
    entityType: "bom_accessory_line",
    entityId: line.id,
    entityName: `${await productName(productId)} ← ${accessory[0]?.name ?? accessoryId}`,
    changes: { "на изделие": { from: null, to: qtyPerUnit } },
  });

  revalidatePath(`/products/${productId}`);
  redirect(`/products/${productId}?ok=bomAccessory`);
}

async function updateBomAccessory(formData: FormData) {
  "use server";
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const productId = String(formData.get("productId") ?? "");
  const lineId = String(formData.get("lineId") ?? "");
  const qtyPerUnit = parseNumber(formData.get("qtyPerUnit"));
  if (!productId || !lineId) redirect("/collections");
  if (qtyPerUnit == null || qtyPerUnit <= 0) {
    redirect(`/products/${productId}?error=bomAccessory`);
  }

  const rows = await db
    .select({
      qtyPerUnit: schema.bomAccessoryLines.qtyPerUnit,
      accessoryName: schema.accessories.name,
    })
    .from(schema.bomAccessoryLines)
    .innerJoin(
      schema.accessories,
      eq(schema.bomAccessoryLines.accessoryId, schema.accessories.id),
    )
    .where(eq(schema.bomAccessoryLines.id, lineId))
    .limit(1);
  const before = rows[0];
  if (!before) redirect(`/products/${productId}`);

  await db
    .update(schema.bomAccessoryLines)
    .set({ qtyPerUnit })
    .where(eq(schema.bomAccessoryLines.id, lineId));

  await writeAudit(user, {
    action: "UPDATE",
    entityType: "bom_accessory_line",
    entityId: lineId,
    entityName: `${await productName(productId)} ← ${before.accessoryName}`,
    changes: { "на изделие": { from: before.qtyPerUnit, to: qtyPerUnit } },
  });

  revalidatePath(`/products/${productId}`);
  redirect(`/products/${productId}?ok=bomSaved`);
}

async function deleteBomAccessory(formData: FormData) {
  "use server";
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const productId = String(formData.get("productId") ?? "");
  const lineId = String(formData.get("lineId") ?? "");
  if (!productId || !lineId) redirect("/collections");

  const rows = await db
    .select({ accessoryName: schema.accessories.name })
    .from(schema.bomAccessoryLines)
    .innerJoin(
      schema.accessories,
      eq(schema.bomAccessoryLines.accessoryId, schema.accessories.id),
    )
    .where(eq(schema.bomAccessoryLines.id, lineId))
    .limit(1);

  await db
    .delete(schema.bomAccessoryLines)
    .where(eq(schema.bomAccessoryLines.id, lineId));

  await writeAudit(user, {
    action: "DELETE",
    entityType: "bom_accessory_line",
    entityId: lineId,
    entityName: `${await productName(productId)} ← ${rows[0]?.accessoryName ?? "фурнитура"}`,
  });

  revalidatePath(`/products/${productId}`);
  redirect(`/products/${productId}?ok=bomDeleted`);
}

async function uploadPattern(formData: FormData) {
  "use server";
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const productId = String(formData.get("productId") ?? "");
  if (!productId) redirect("/collections");

  let saved;
  try {
    saved = await saveOptionalUpload(formData.get("file"), "patterns");
  } catch {
    redirect(`/products/${productId}?error=patternFile`);
  }
  if (!saved) redirect(`/products/${productId}?error=patternEmpty`);

  const [pattern] = await db
    .insert(schema.patternFiles)
    .values({
      productId,
      fileName: saved.fileName,
      fileUrl: saved.url,
      mimeType: saved.mimeType,
      sizeBytes: saved.sizeBytes,
      version: parseText(formData.get("version")),
      uploadedBy: user.name,
    })
    .returning();

  await writeAudit(user, {
    action: "CREATE",
    entityType: "pattern_file",
    entityId: pattern.id,
    entityName: `${saved.fileName} · ${await productName(productId)}`,
    changes: { версия: { from: null, to: pattern.version } },
  });

  revalidatePath(`/products/${productId}`);
  revalidatePath("/collections");
  redirect(`/products/${productId}?ok=pattern`);
}

async function deletePattern(formData: FormData) {
  "use server";
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const productId = String(formData.get("productId") ?? "");
  const patternId = String(formData.get("patternId") ?? "");
  if (!productId || !patternId) redirect("/collections");

  const rows = await db
    .select({
      fileName: schema.patternFiles.fileName,
      version: schema.patternFiles.version,
    })
    .from(schema.patternFiles)
    .where(eq(schema.patternFiles.id, patternId))
    .limit(1);

  await db
    .delete(schema.patternFiles)
    .where(eq(schema.patternFiles.id, patternId));

  await writeAudit(user, {
    action: "DELETE",
    entityType: "pattern_file",
    entityId: patternId,
    entityName: `${rows[0]?.fileName ?? "лекало"}${
      rows[0]?.version ? ` (${rows[0].version})` : ""
    } · ${await productName(productId)}`,
  });

  revalidatePath(`/products/${productId}`);
  revalidatePath("/collections");
  redirect(`/products/${productId}?ok=patternDeleted`);
}

// ============================================================
// СТРАНИЦА
// ============================================================

const OK_MESSAGES: Record<string, string> = {
  created: "Изделие создано. Следующий шаг — задать состав (BOM).",
  saved: "Изменения сохранены.",
  variant: "Вариант добавлен.",
  archived: "Вариант убран в архив.",
  restored: "Вариант возвращён из архива.",
  archive: "Видимость изделия изменена.",
  bomFabric: "Ткань добавлена в состав.",
  bomAccessory: "Фурнитура добавлена в состав.",
  bomSaved: "Строка состава сохранена.",
  bomDeleted: "Строка состава удалена.",
  pattern: "Лекало загружено.",
  patternDeleted: "Файл лекала удалён.",
};

const ERROR_MESSAGES: Record<string, string> = {
  variant: "Укажите SKU варианта",
  variantSku: "Вариант с таким SKU уже есть — SKU совпадает с кодом в Ainur и должен быть уникальным",
  bomFabric: "Выберите ткань и укажите метраж больше нуля",
  bomAccessory: "Выберите фурнитуру и укажите количество больше нуля",
  bomDouble: "Эта позиция уже есть в составе — измените существующую строку",
  patternFile: "Файл не сохранился: до 25 МБ, форматы PDF, ZIP, DXF, AI, изображения",
  patternEmpty: "Выберите файл лекала",
};

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const money = canSeeMoney(user);

  const { id } = await params;
  const flags = await searchParams;

  const productRows = await db
    .select({
      product: schema.products,
      collectionId: schema.collections.id,
      collectionName: schema.collections.name,
    })
    .from(schema.products)
    .innerJoin(
      schema.collections,
      eq(schema.products.collectionId, schema.collections.id),
    )
    .where(eq(schema.products.id, id))
    .limit(1);

  const row = productRows[0];
  if (!row) notFound();
  const product = row.product;

  const [
    variants,
    bomFabrics,
    bomAccessories,
    factoryPriceRows,
    patterns,
    fabricOptions,
    accessoryOptions,
  ] = await Promise.all([
    db
      .select()
      .from(schema.productVariants)
      .where(eq(schema.productVariants.productId, id))
      .orderBy(asc(schema.productVariants.sku)),

    db
      .select({
        line: schema.bomFabricLines,
        fabricId: schema.fabrics.id,
        fabricName: schema.fabrics.name,
        fabricSku: schema.fabrics.sku,
        purchasePrice: schema.fabrics.purchasePrice,
        fxRateToThb: schema.fabrics.fxRateToThb,
      })
      .from(schema.bomFabricLines)
      .innerJoin(
        schema.fabrics,
        eq(schema.bomFabricLines.fabricId, schema.fabrics.id),
      )
      .where(eq(schema.bomFabricLines.productId, id))
      .orderBy(asc(schema.fabrics.name)),

    db
      .select({
        line: schema.bomAccessoryLines,
        accessoryId: schema.accessories.id,
        accessoryName: schema.accessories.name,
        accessorySku: schema.accessories.sku,
        unit: schema.accessories.unit,
        unitCost: schema.accessories.unitCost,
      })
      .from(schema.bomAccessoryLines)
      .innerJoin(
        schema.accessories,
        eq(schema.bomAccessoryLines.accessoryId, schema.accessories.id),
      )
      .where(eq(schema.bomAccessoryLines.productId, id))
      .orderBy(asc(schema.accessories.name)),

    db
      .select({
        factoryId: schema.factories.id,
        factoryName: schema.factories.name,
        pricePerUnit: schema.factoryPrices.pricePerUnit,
        validFrom: schema.factoryPrices.validFrom,
      })
      .from(schema.factoryPrices)
      .innerJoin(
        schema.factories,
        eq(schema.factoryPrices.factoryId, schema.factories.id),
      )
      .where(
        and(
          eq(schema.factoryPrices.productId, id),
          eq(schema.factoryPrices.isCurrent, true),
        ),
      )
      .orderBy(asc(schema.factories.name)),

    db
      .select()
      .from(schema.patternFiles)
      .where(eq(schema.patternFiles.productId, id))
      .orderBy(desc(schema.patternFiles.createdAt)),

    db
      .select({
        id: schema.fabrics.id,
        name: schema.fabrics.name,
        sku: schema.fabrics.sku,
      })
      .from(schema.fabrics)
      .where(eq(schema.fabrics.isArchived, false))
      .orderBy(asc(schema.fabrics.name)),

    db
      .select({
        id: schema.accessories.id,
        name: schema.accessories.name,
        sku: schema.accessories.sku,
        unit: schema.accessories.unit,
      })
      .from(schema.accessories)
      .orderBy(asc(schema.accessories.name)),
  ]);

  // остатки вариантов по складам
  const variantIds = variants.map((v) => v.id);
  const stockRows =
    variantIds.length > 0
      ? await db
          .select({
            variantId: schema.variantStock.variantId,
            warehouseId: schema.warehouses.id,
            warehouseName: schema.warehouses.name,
            quantity: schema.variantStock.quantity,
          })
          .from(schema.variantStock)
          .innerJoin(
            schema.warehouses,
            eq(schema.variantStock.warehouseId, schema.warehouses.id),
          )
          .where(inArray(schema.variantStock.variantId, variantIds))
      : [];

  const stockByVariant = new Map<string, WarehouseQty[]>();
  for (const s of stockRows) {
    if (s.quantity === 0) continue;
    const list = stockByVariant.get(s.variantId) ?? [];
    list.push({
      warehouseId: s.warehouseId,
      warehouseName: s.warehouseName,
      qty: s.quantity,
    });
    stockByVariant.set(s.variantId, list);
  }

  const velocity = await getVelocity(90);
  const velocityByVariant = new Map(velocity.map((v) => [v.variantId, v]));

  const rowsForTable = variants
    .map((v) => {
      const stock = (stockByVariant.get(v.id) ?? []).sort(
        (a, b) => b.qty - a.qty,
      );
      const vel = velocityByVariant.get(v.id);
      return {
        variant: v,
        stock,
        stockQty: stock.reduce((s, w) => s + w.qty, 0),
        unitsSold: vel?.unitsSold ?? 0,
        perMonth: vel?.perMonth ?? 0,
        monthsOfCover: vel?.monthsOfCover ?? null,
      };
    })
    .sort((a, b) => {
      if (a.variant.isArchived !== b.variant.isArchived) {
        return a.variant.isArchived ? 1 : -1;
      }
      return b.unitsSold - a.unitsSold || a.variant.sku.localeCompare(b.variant.sku);
    });

  /**
   * Себестоимость из Ainur.
   *
   * Приходит не синхронизацией: в Connect API её нет, значения снимаются
   * из каталога веб-интерфейса Ainur и заливаются скриптом cost:import.
   * У вариантов одной модели она может отличаться, поэтому показываем
   * диапазон, а не одно число.
   */
  const ainurCosts = variants
    .filter((v) => !v.isArchived)
    .map((v) => v.ainurPurchaseCost)
    .filter((n): n is number => typeof n === "number" && n > 0);
  const ainurMin = ainurCosts.length > 0 ? Math.min(...ainurCosts) : null;
  const ainurMax = ainurCosts.length > 0 ? Math.max(...ainurCosts) : null;

  // себестоимость одного изделия
  const fabricLines = bomFabrics.map((b) => {
    const totalMeters = round2(
      b.line.metersPerUnit * (1 + (b.line.wastePct || 0) / 100),
    );
    const costPerMeter = fabricCostPerMeterThb({
      purchasePrice: b.purchasePrice,
      fxRateToThb: b.fxRateToThb,
    });
    return {
      ...b,
      totalMeters,
      costPerMeter,
      cost: round2(totalMeters * costPerMeter),
    };
  });

  const accessoryLines = bomAccessories.map((b) => ({
    ...b,
    cost: round2(b.line.qtyPerUnit * b.unitCost),
  }));

  const fabricCost = round2(fabricLines.reduce((s, l) => s + l.cost, 0));
  const accessoryCost = round2(accessoryLines.reduce((s, l) => s + l.cost, 0));
  const sewingCost = product.defaultSewingCost ?? 0;
  const unitCost = round2(fabricCost + accessoryCost + sewingCost);

  const bomEmpty = fabricLines.length === 0;
  const usedFabricIds = new Set(fabricLines.map((l) => l.fabricId));
  const usedAccessoryIds = new Set(accessoryLines.map((l) => l.accessoryId));
  const freeFabrics = fabricOptions.filter((f) => !usedFabricIds.has(f.id));
  const freeAccessories = accessoryOptions.filter(
    (a) => !usedAccessoryIds.has(a.id),
  );

  const totalStock = rowsForTable
    .filter((r) => !r.variant.isArchived)
    .reduce((s, r) => s + r.stockQty, 0);
  const totalSold = rowsForTable.reduce((s, r) => s + r.unitsSold, 0);

  const ok = flags.ok ? OK_MESSAGES[flags.ok] : null;
  const error = flags.error ? ERROR_MESSAGES[flags.error] : null;

  return (
    <>
      <PageHeader
        title={product.name}
        subtitle={`${row.collectionName}${product.baseSku ? ` · ${product.baseSku}` : ""}`}
        action={
          <div className="flex flex-wrap gap-2">
            <LinkButton href={`/collections/${row.collectionId}`}>
              К коллекции
            </LinkButton>
            <LinkButton href={`/products/${id}/edit`} variant="primary">
              Редактировать
            </LinkButton>
          </div>
        }
      />

      {ok ? (
        <Callout tone="ok" title="Готово">
          {ok}
        </Callout>
      ) : null}
      {error ? (
        <Callout tone="critical" title="Не сохранено">
          {error}
        </Callout>
      ) : null}
      {product.isArchived ? (
        <Callout tone="neutral" title="Изделие в архиве">
          Оно скрыто из списков коллекции. Вернуть можно на странице
          редактирования.
        </Callout>
      ) : null}

      <div className="grid gap-4 md:grid-cols-[auto_1fr]">
        <Card>
          <Thumb src={product.photoUrl} alt={product.name} size={160} />
          <div className="mt-3 flex flex-wrap gap-1.5">
            <BomPill hasBom={!bomEmpty} />
            <PatternPill hasPatterns={patterns.length > 0} />
          </div>
        </Card>

        <div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <Stat
              label="Вариантов (SKU)"
              value={variants.filter((v) => !v.isArchived).length}
              sub={
                variants.some((v) => v.isArchived)
                  ? `${variants.filter((v) => v.isArchived).length} в архиве`
                  : undefined
              }
            />
            <Stat label="Остаток, шт" value={totalStock} />
            <Stat label="Продано 90 дней" value={`${totalSold} шт`} />
            <Stat
              label="Себестоимость по составу"
              value={<Money value={unitCost} hidden={!money} />}
              sub="ткань + фурнитура + пошив"
            />
            <Stat
              label="Себестоимость Ainur"
              value={
                ainurMin === null ? (
                  <span className="text-[var(--color-faint)]">—</span>
                ) : (
                  <Money value={ainurMin} hidden={!money} />
                )
              }
              sub={
                ainurMin === null
                  ? "в Ainur не заполнена"
                  : ainurMax !== null && ainurMax !== ainurMin
                    ? `по вариантам до ${Math.round(ainurMax).toLocaleString("ru-RU")} THB`
                    : "цена закупки из карточки Ainur"
              }
            />
          </div>
          <Card className="mt-3">
            <div className="grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
                  Коллекция
                </div>
                <Link href={`/collections/${row.collectionId}`}>
                  {row.collectionName}
                </Link>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
                  Пошив по умолчанию
                </div>
                <Money value={sewingCost} hidden={!money} />
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
                  Примечание
                </div>
                <div>{product.note ?? "—"}</div>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* ---------------- ВАРИАНТЫ ---------------- */}
      <SectionTitle>Варианты (SKU)</SectionTitle>
      {rowsForTable.length === 0 ? (
        <Card>
          <p className="m-0 text-sm text-[var(--color-muted)]">
            Вариантов пока нет. Вариант — это конкретный SKU (цвет + размер), по
            нему считаются остатки и продажи.
          </p>
        </Card>
      ) : (
        <Card padded={false}>
          <Table>
            <thead>
              <tr>
                <Th>SKU</Th>
                <Th>Цвет</Th>
                <Th>Размер</Th>
                <Th align="right">Цена</Th>
                <Th align="right">Себест. Ainur</Th>
                <Th>Остаток по складам</Th>
                <Th align="right">Продано 90 дн</Th>
                <Th align="right">шт/мес</Th>
                <Th>Запас</Th>
                <Th>Действие</Th>
              </tr>
            </thead>
            <tbody>
              {rowsForTable.map((r) => (
                <tr key={r.variant.id}>
                  <Td>
                    <div>{r.variant.sku}</div>
                    {r.variant.isArchived ? (
                      <div className="mt-1">
                        <StatusPill tone="neutral">в архиве</StatusPill>
                      </div>
                    ) : null}
                  </Td>
                  <Td>{r.variant.color ?? "—"}</Td>
                  <Td>{r.variant.size ?? "—"}</Td>
                  <Td align="right">
                    {r.variant.price == null ? (
                      "—"
                    ) : (
                      <Money value={r.variant.price} hidden={!money} />
                    )}
                  </Td>
                  <Td align="right">
                    {r.variant.ainurPurchaseCost == null ? (
                      <span className="text-[var(--color-faint)]">—</span>
                    ) : (
                      <>
                        <Money
                          value={r.variant.ainurPurchaseCost}
                          hidden={!money}
                        />
                        {r.variant.ainurAvgCost != null &&
                        Math.abs(
                          r.variant.ainurAvgCost - r.variant.ainurPurchaseCost,
                        ) > 1 ? (
                          <div className="tnum text-xs text-[var(--color-muted)]">
                            средняя {Math.round(r.variant.ainurAvgCost).toLocaleString("ru-RU")}
                          </div>
                        ) : null}
                      </>
                    )}
                  </Td>
                  <Td>
                    <div className="tnum mb-1 text-xs text-[var(--color-muted)]">
                      всего {r.stockQty} шт
                    </div>
                    <StockChips rows={r.stock} empty="нет остатка" />
                  </Td>
                  <Td align="right">{r.unitsSold}</Td>
                  <Td align="right">{r.perMonth}</Td>
                  <Td>
                    <CoverageBar months={r.monthsOfCover} />
                  </Td>
                  <Td>
                    <form action={toggleVariantArchive}>
                      <input type="hidden" name="productId" value={id} />
                      <input
                        type="hidden"
                        name="variantId"
                        value={r.variant.id}
                      />
                      <Button
                        type="submit"
                        variant={r.variant.isArchived ? "secondary" : "danger"}
                      >
                        {r.variant.isArchived ? "Вернуть" : "В архив"}
                      </Button>
                    </form>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <Card className="mt-4">
        <h3 className="m-0 mb-3 text-base">Добавить вариант</h3>
        <form action={addVariant} className="grid gap-3 sm:grid-cols-4">
          <input type="hidden" name="productId" value={id} />
          <Field label="SKU" required hint="Совпадает с кодом в Ainur">
            <Input
              name="sku"
              required
              placeholder={
                product.baseSku ? `${product.baseSku}-BLK-S` : "DRESS-LUNA-BLK-S"
              }
            />
          </Field>
          <Field label="Цвет">
            <Input name="color" placeholder="Deep Ocean" />
          </Field>
          <Field label="Размер">
            <Input name="size" placeholder="S" />
          </Field>
          <Field label="Розничная цена, THB">
            <Input name="price" type="number" step="0.01" min="0" />
          </Field>
          <div className="sm:col-span-4">
            <Button type="submit" variant="primary">
              Добавить вариант
            </Button>
          </div>
        </form>
      </Card>

      {/* ---------------- BOM ---------------- */}
      <SectionTitle>Состав изделия (BOM)</SectionTitle>

      {bomEmpty ? (
        <Callout tone="warn" title="Состав не задан">
          Пока в составе нет ни одной ткани, Luna не может посчитать расход ткани
          на заказ и бюджет производства: заказ придётся считать руками.
          Добавьте ткани и фурнитуру ниже.
        </Callout>
      ) : null}

      <Card padded={false}>
        {fabricLines.length === 0 ? (
          <div className="p-4 sm:p-5">
            <p className="m-0 text-sm text-[var(--color-muted)]">
              Ткани в составе нет.
            </p>
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Ткань</Th>
                <Th align="right">м / изделие</Th>
                <Th align="right">Припуск</Th>
                <Th align="right">Итого с припуском</Th>
                <Th align="right">Цена метра</Th>
                <Th align="right">Стоимость на 1 шт</Th>
                <Th>Изменить</Th>
              </tr>
            </thead>
            <tbody>
              {fabricLines.map((l) => (
                <tr key={l.line.id}>
                  <Td>
                    <Link href={`/fabrics/${l.fabricId}`}>{l.fabricName}</Link>
                    <div className="text-xs text-[var(--color-muted)]">
                      {l.fabricSku ?? "без SKU"}
                    </div>
                  </Td>
                  <Td align="right">{l.line.metersPerUnit}</Td>
                  <Td align="right">{l.line.wastePct}%</Td>
                  <Td align="right">{formatMeters(l.totalMeters)}</Td>
                  <Td align="right">
                    <Money value={l.costPerMeter} hidden={!money} />
                  </Td>
                  <Td align="right">
                    <Money value={l.cost} hidden={!money} />
                  </Td>
                  <Td>
                    <div className="flex flex-wrap items-end gap-2">
                      <form
                        action={updateBomFabric}
                        className="flex items-end gap-2"
                      >
                        <input type="hidden" name="productId" value={id} />
                        <input type="hidden" name="lineId" value={l.line.id} />
                        <Field label="м/шт">
                          <Input
                            name="metersPerUnit"
                            type="number"
                            step="0.01"
                            min="0.01"
                            required
                            defaultValue={l.line.metersPerUnit}
                            className="w-24"
                          />
                        </Field>
                        <Field label="припуск %">
                          <Input
                            name="wastePct"
                            type="number"
                            step="0.1"
                            min="0"
                            defaultValue={l.line.wastePct}
                            className="w-24"
                          />
                        </Field>
                        <Button type="submit" variant="secondary">
                          Сохранить
                        </Button>
                      </form>
                      <form action={deleteBomFabric}>
                        <input type="hidden" name="productId" value={id} />
                        <input type="hidden" name="lineId" value={l.line.id} />
                        <Button type="submit" variant="danger">
                          Удалить
                        </Button>
                      </form>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card className="mt-4">
        <h3 className="m-0 mb-3 text-base">Добавить ткань в состав</h3>
        {freeFabrics.length === 0 ? (
          <p className="m-0 text-sm text-[var(--color-muted)]">
            Все ткани из справочника уже в составе этого изделия. Новую ткань
            сначала завести в разделе «Ткани».
          </p>
        ) : (
          <form action={addBomFabric} className="grid gap-3 sm:grid-cols-4">
            <input type="hidden" name="productId" value={id} />
            <Field label="Ткань" required>
              <Select name="fabricId" required defaultValue="">
                <option value="">— выберите ткань —</option>
                {freeFabrics.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} ({f.sku})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Метров на изделие" required>
              <Input
                name="metersPerUnit"
                type="number"
                step="0.01"
                min="0.01"
                required
                placeholder="1.8"
              />
            </Field>
            <Field label="Припуск на раскрой, %" hint="Обычно 5–10%">
              <Input
                name="wastePct"
                type="number"
                step="0.1"
                min="0"
                placeholder="7"
              />
            </Field>
            <Field label="Примечание">
              <Input name="note" placeholder="основная ткань" />
            </Field>
            <div className="sm:col-span-4">
              <Button type="submit" variant="primary">
                Добавить ткань
              </Button>
            </div>
          </form>
        )}
      </Card>

      <SectionTitle>Фурнитура в составе</SectionTitle>
      <Card padded={false}>
        {accessoryLines.length === 0 ? (
          <div className="p-4 sm:p-5">
            <p className="m-0 text-sm text-[var(--color-muted)]">
              Фурнитуры в составе нет — добавьте бирки, пуговицы и упаковку,
              чтобы себестоимость была полной.
            </p>
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Наименование</Th>
                <Th align="right">На 1 изделие</Th>
                <Th>Единица</Th>
                <Th align="right">Цена</Th>
                <Th align="right">Стоимость на 1 шт</Th>
                <Th>Изменить</Th>
              </tr>
            </thead>
            <tbody>
              {accessoryLines.map((l) => (
                <tr key={l.line.id}>
                  <Td>
                    <Link href="/accessories">{l.accessoryName}</Link>
                    <div className="text-xs text-[var(--color-muted)]">
                      {l.accessorySku}
                    </div>
                  </Td>
                  <Td align="right">{l.line.qtyPerUnit}</Td>
                  <Td>{l.unit}</Td>
                  <Td align="right">
                    <Money value={l.unitCost} hidden={!money} />
                  </Td>
                  <Td align="right">
                    <Money value={l.cost} hidden={!money} />
                  </Td>
                  <Td>
                    <div className="flex flex-wrap items-end gap-2">
                      <form
                        action={updateBomAccessory}
                        className="flex items-end gap-2"
                      >
                        <input type="hidden" name="productId" value={id} />
                        <input type="hidden" name="lineId" value={l.line.id} />
                        <Field label={`на 1 шт, ${l.unit}`}>
                          <Input
                            name="qtyPerUnit"
                            type="number"
                            step="0.01"
                            min="0.01"
                            required
                            defaultValue={l.line.qtyPerUnit}
                            className="w-24"
                          />
                        </Field>
                        <Button type="submit" variant="secondary">
                          Сохранить
                        </Button>
                      </form>
                      <form action={deleteBomAccessory}>
                        <input type="hidden" name="productId" value={id} />
                        <input type="hidden" name="lineId" value={l.line.id} />
                        <Button type="submit" variant="danger">
                          Удалить
                        </Button>
                      </form>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card className="mt-4">
        <h3 className="m-0 mb-3 text-base">Добавить фурнитуру в состав</h3>
        {accessoryOptions.length === 0 ? (
          <p className="m-0 text-sm text-[var(--color-muted)]">
            Справочник фурнитуры пуст.{" "}
            <Link href="/accessories">Заведите бирки, пуговицы и упаковку</Link>{" "}
            — потом они появятся здесь.
          </p>
        ) : freeAccessories.length === 0 ? (
          <p className="m-0 text-sm text-[var(--color-muted)]">
            Вся фурнитура из справочника уже в составе этого изделия.
          </p>
        ) : (
          <form action={addBomAccessory} className="grid gap-3 sm:grid-cols-3">
            <input type="hidden" name="productId" value={id} />
            <Field label="Фурнитура" required>
              <Select name="accessoryId" required defaultValue="">
                <option value="">— выберите позицию —</option>
                {freeAccessories.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.sku})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Сколько на 1 изделие" required>
              <Input
                name="qtyPerUnit"
                type="number"
                step="0.01"
                min="0.01"
                required
                placeholder="1"
              />
            </Field>
            <div className="flex items-end">
              <Button type="submit" variant="primary">
                Добавить фурнитуру
              </Button>
            </div>
          </form>
        )}
      </Card>

      <Card className="mt-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="text-sm text-[var(--color-muted)]">
            <div>
              Ткань: <Money value={fabricCost} hidden={!money} />
            </div>
            <div className="mt-1">
              Фурнитура: <Money value={accessoryCost} hidden={!money} />
            </div>
            <div className="mt-1">
              Пошив: <Money value={sewingCost} hidden={!money} />
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
              Итого себестоимость 1 изделия
            </div>
            <div className="mt-1">
              <Money value={unitCost} hidden={!money} className="text-3xl" />
            </div>
            {/*
              Рядом — цифра из Ainur. Это два независимых числа: наше
              считается по составу изделия, ainur-овское введено вручную в
              карточке товара. Расхождение — повод проверить и то, и другое.
            */}
            {ainurMin !== null ? (
              <div className="mt-2 text-xs text-[var(--color-muted)]">
                По Ainur: <Money value={ainurMin} hidden={!money} />
                {money && unitCost > 0 ? (
                  <span>
                    {" · "}
                    расхождение{" "}
                    {Math.round(Math.abs(unitCost - ainurMin)).toLocaleString("ru-RU")}{" "}
                    THB
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </Card>

      {/* ---------------- ЦЕНЫ ПОШИВА ---------------- */}
      <SectionTitle>Цены пошива по фабрикам</SectionTitle>
      <Card padded={false}>
        {factoryPriceRows.length === 0 ? (
          <div className="p-4 sm:p-5">
            <p className="m-0 text-sm text-[var(--color-muted)]">
              Отдельных цен по фабрикам нет — в расчётах используется
              себестоимость пошива по умолчанию. Цену задают в карточке фабрики.
            </p>
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Фабрика</Th>
                <Th align="right">Цена за штуку</Th>
                <Th>Действует с</Th>
                <Th>Изменение</Th>
              </tr>
            </thead>
            <tbody>
              {factoryPriceRows.map((p) => (
                <tr key={p.factoryId}>
                  <Td>
                    <Link href={`/factories/${p.factoryId}`}>
                      {p.factoryName}
                    </Link>
                  </Td>
                  <Td align="right">
                    <Money value={p.pricePerUnit} hidden={!money} />
                  </Td>
                  <Td>{formatDate(p.validFrom)}</Td>
                  <Td>
                    <Link href={`/factories/${p.factoryId}`}>
                      изменить на странице фабрики
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {/* ---------------- ЛЕКАЛА ---------------- */}
      <SectionTitle>Технические лекала</SectionTitle>
      <Callout tone="neutral" title="Зачем это здесь">
        Лекала хранятся в Luna, чтобы их можно было передать другой фабрике при
        смене подрядчика — без переписки и поиска по чатам.
      </Callout>

      <Card padded={false}>
        {patterns.length === 0 ? (
          <div className="p-4 sm:p-5">
            <p className="m-0 text-sm text-[var(--color-muted)]">
              Файлов лекал нет. Загрузите PDF, DXF, AI или архив — версии
              складываются в историю.
            </p>
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Файл</Th>
                <Th>Версия</Th>
                <Th align="right">Размер</Th>
                <Th>Загружено</Th>
                <Th>Кто загрузил</Th>
                <Th>Действие</Th>
              </tr>
            </thead>
            <tbody>
              {patterns.map((p) => (
                <tr key={p.id}>
                  <Td>
                    <a href={p.fileUrl} download>
                      {p.fileName}
                    </a>
                  </Td>
                  <Td>{p.version ?? "—"}</Td>
                  <Td align="right">{formatFileSize(p.sizeBytes) || "—"}</Td>
                  <Td>{formatDate(p.createdAt)}</Td>
                  <Td>{p.uploadedBy ?? "—"}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-2">
                      <LinkButton href={p.fileUrl}>Скачать</LinkButton>
                      <form action={deletePattern}>
                        <input type="hidden" name="productId" value={id} />
                        <input type="hidden" name="patternId" value={p.id} />
                        <Button type="submit" variant="danger">
                          Удалить
                        </Button>
                      </form>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card className="mt-4">
        <h3 className="m-0 mb-3 text-base">Загрузить лекало</h3>
        <form action={uploadPattern} className="grid gap-3 sm:grid-cols-3">
          <input type="hidden" name="productId" value={id} />
          <Field label="Файл" required hint="PDF, DXF, AI, ZIP или фото, до 25 МБ">
            <Input type="file" name="file" required />
          </Field>
          <Field label="Версия" hint="например: v2, после правок Fotesko">
            <Input name="version" placeholder="v2" />
          </Field>
          <div className="flex items-end">
            <Button type="submit" variant="primary">
              Загрузить
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
