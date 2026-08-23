import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { getCurrentUser, writeAudit } from "@/lib/auth";
import { saveOptionalUpload } from "@/lib/uploads";
import {
  Button,
  Callout,
  Card,
  Field,
  Input,
  LinkButton,
  PageHeader,
  SectionTitle,
} from "@/components/ui";
import { FabricFields, parseNumber, parseText } from "../fabric-fields";

export const metadata = { title: "Новая ткань — Luna Production" };

async function createFabric(formData: FormData) {
  "use server";
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const name = parseText(formData.get("name"));
  const sku = parseText(formData.get("sku"));
  if (!name || !sku) redirect("/fabrics/new?error=required");

  const duplicate = await db
    .select({ id: schema.fabrics.id })
    .from(schema.fabrics)
    .where(eq(schema.fabrics.sku, sku))
    .limit(1);
  if (duplicate.length > 0) redirect("/fabrics/new?error=sku");

  let photoUrl: string | null = null;
  try {
    const saved = await saveOptionalUpload(formData.get("photo"), "fabrics");
    photoUrl = saved?.url ?? null;
  } catch {
    redirect("/fabrics/new?error=photo");
  }

  const priceDate = parseText(formData.get("priceDate"));

  const [fabric] = await db
    .insert(schema.fabrics)
    .values({
      sku,
      name,
      composition: parseText(formData.get("composition")),
      color: parseText(formData.get("color")),
      isDyed: formData.get("isDyed") === "on",
      rollLengthM: parseNumber(formData.get("rollLengthM")),
      widthCm: parseNumber(formData.get("widthCm")),
      purchasePrice: parseNumber(formData.get("purchasePrice")),
      purchaseCurrency: parseText(formData.get("purchaseCurrency")) ?? "THB",
      fxRateToThb: parseNumber(formData.get("fxRateToThb")) ?? 1,
      priceDate: priceDate ? new Date(priceDate).toISOString() : null,
      supplierId: parseText(formData.get("supplierId")),
      photoUrl,
      // токен для QR-метки — по нему склад открывает карточку с телефона
      qrToken: `fab-${crypto.randomUUID().slice(0, 12)}`,
      note: parseText(formData.get("note")),
      isOnOrder: formData.get("isOnOrder") === "on",
    })
    .returning();

  // начальные остатки: заводим строку только там, где метраж действительно есть
  const warehouses = await db
    .select({ id: schema.warehouses.id })
    .from(schema.warehouses)
    .where(eq(schema.warehouses.kind, "FABRIC"));

  const stockRows = warehouses
    .map((w) => ({ warehouseId: w.id, meters: parseNumber(formData.get(`stock_${w.id}`)) }))
    .filter((r) => r.meters != null && r.meters > 0);

  if (stockRows.length > 0) {
    await db.insert(schema.fabricStock).values(
      stockRows.map((r) => ({
        fabricId: fabric.id,
        warehouseId: r.warehouseId,
        onHandM: r.meters as number,
      })),
    );
  }

  await writeAudit(user, {
    action: "CREATE",
    entityType: "fabric",
    entityId: fabric.id,
    entityName: `${fabric.name} (${fabric.sku})`,
    changes: {
      остатки: {
        from: null,
        to: stockRows.reduce((s, r) => s + (r.meters ?? 0), 0),
      },
    },
  });

  revalidatePath("/fabrics");
  redirect(`/fabrics/${fabric.id}`);
}

const ERRORS: Record<string, string> = {
  required: "Название и SKU обязательны",
  sku: "Ткань с таким SKU уже есть — откройте её карточку или выберите другой SKU",
  photo: "Фото не сохранилось: поддерживаются JPG, PNG, WEBP и GIF до 25 МБ",
};

export default async function NewFabricPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const error = params.error ? ERRORS[params.error] : null;

  const suppliers = await db
    .select({ id: schema.suppliers.id, name: schema.suppliers.name })
    .from(schema.suppliers)
    .orderBy(asc(schema.suppliers.name));

  const fabricWarehouses = await db
    .select({ id: schema.warehouses.id, name: schema.warehouses.name })
    .from(schema.warehouses)
    .where(and(eq(schema.warehouses.kind, "FABRIC"), eq(schema.warehouses.isActive, true)))
    .orderBy(asc(schema.warehouses.name));

  return (
    <>
      <PageHeader
        title="Новая ткань"
        subtitle="Заполните закупочные данные — из них считается себестоимость изделий"
        action={<LinkButton href="/fabrics">Назад к тканям</LinkButton>}
      />

      {error ? <Callout tone="critical" title="Не сохранено">{error}</Callout> : null}

      <form action={createFabric}>
        <Card>
          <FabricFields suppliers={suppliers} />
        </Card>

        <SectionTitle>Начальные остатки</SectionTitle>
        <Card>
          {fabricWarehouses.length === 0 ? (
            <p className="m-0 text-sm text-[var(--color-muted)]">
              Складов тканей пока нет — добавьте их в настройках, остатки можно
              будет завести позже приходом в карточке ткани.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {fabricWarehouses.map((w) => (
                <Field key={w.id} label={w.name} hint="метров сейчас на складе">
                  <Input
                    name={`stock_${w.id}`}
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0"
                  />
                </Field>
              ))}
            </div>
          )}
        </Card>

        <div className="mt-5 flex flex-wrap gap-3">
          <Button type="submit" variant="primary">
            Сохранить ткань
          </Button>
          <LinkButton href="/fabrics" variant="ghost">
            Отмена
          </LinkButton>
        </div>
      </form>
    </>
  );
}
