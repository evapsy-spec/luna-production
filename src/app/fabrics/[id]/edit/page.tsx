import { redirect, notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, asc, eq, ne } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { diffFields, getCurrentUser, writeAudit } from "@/lib/auth";
import { saveOptionalUpload } from "@/lib/uploads";
import {
  Button,
  Callout,
  Card,
  LinkButton,
  PageHeader,
} from "@/components/ui";
import { FabricFields, parseNumber, parseText } from "../../fabric-fields";

async function updateFabric(formData: FormData) {
  "use server";
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const id = String(formData.get("id") ?? "");
  const name = parseText(formData.get("name"));
  const sku = parseText(formData.get("sku"));
  if (!id) redirect("/fabrics");
  if (!name) redirect(`/fabrics/${id}/edit?error=required`);

  const before = (
    await db.select().from(schema.fabrics).where(eq(schema.fabrics.id, id)).limit(1)
  )[0];
  if (!before) redirect("/fabrics");

  if (sku) {
    const duplicate = await db
      .select({ id: schema.fabrics.id })
      .from(schema.fabrics)
      .where(and(eq(schema.fabrics.sku, sku), ne(schema.fabrics.id, id)))
      .limit(1);
    if (duplicate.length > 0) redirect(`/fabrics/${id}/edit?error=sku`);
  }

  let photoUrl = before.photoUrl;
  try {
    const saved = await saveOptionalUpload(formData.get("photo"), "fabrics");
    if (saved) photoUrl = saved.url;
  } catch {
    redirect(`/fabrics/${id}/edit?error=photo`);
  }

  const priceDate = parseText(formData.get("priceDate"));

  const after = {
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
    note: parseText(formData.get("note")),
    isOnOrder: formData.get("isOnOrder") === "on",
    updatedAt: new Date().toISOString(),
  };

  await db.update(schema.fabrics).set(after).where(eq(schema.fabrics.id, id));

  await writeAudit(user, {
    action: "UPDATE",
    entityType: "fabric",
    entityId: id,
    entityName: `${name} (${sku})`,
    changes: diffFields(before, after, [
      "sku",
      "name",
      "composition",
      "color",
      "isDyed",
      "rollLengthM",
      "widthCm",
      "purchasePrice",
      "purchaseCurrency",
      "fxRateToThb",
      "priceDate",
      "supplierId",
      "photoUrl",
      "note",
      "isOnOrder",
    ]),
  });

  revalidatePath("/fabrics");
  revalidatePath(`/fabrics/${id}`);
  redirect(`/fabrics/${id}`);
}

const ERRORS: Record<string, string> = {
  required: "Укажите название ткани",
  sku: "Такой SKU уже занят другой тканью",
  photo: "Фото не сохранилось: поддерживаются JPG, PNG, WEBP и GIF до 25 МБ",
};

export default async function EditFabricPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const flags = await searchParams;
  const error = flags.error ? ERRORS[flags.error] : null;

  const rows = await db
    .select()
    .from(schema.fabrics)
    .where(eq(schema.fabrics.id, id))
    .limit(1);
  const fabric = rows[0];
  if (!fabric) notFound();

  const suppliers = await db
    .select({ id: schema.suppliers.id, name: schema.suppliers.name })
    .from(schema.suppliers)
    .orderBy(asc(schema.suppliers.name));

  return (
    <>
      <PageHeader
        title="Редактирование ткани"
        subtitle={fabric.sku ? `${fabric.name} · ${fabric.sku}` : fabric.name}
        action={
          <LinkButton href={`/fabrics/${id}`}>Назад к карточке</LinkButton>
        }
      />

      {error ? <Callout tone="critical" title="Не сохранено">{error}</Callout> : null}

      <Callout tone="neutral" title="Про курс">
        Курс к THB фиксируется на дату закупки. Меняйте его только вместе с новой
        ценой — уже созданные заказы пересчитаны не будут, у них свой снэпшот
        себестоимости.
      </Callout>

      <form action={updateFabric}>
        <input type="hidden" name="id" value={id} />
        <Card>
          <FabricFields values={fabric} suppliers={suppliers} />
        </Card>

        <div className="mt-5 flex flex-wrap gap-3">
          <Button type="submit" variant="primary">
            Сохранить изменения
          </Button>
          <LinkButton href={`/fabrics/${id}`} variant="ghost">
            Отмена
          </LinkButton>
        </div>
      </form>
    </>
  );
}
