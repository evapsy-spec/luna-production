import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import {
  canSeeMoney,
  diffFields,
  getCurrentUser,
  writeAudit,
} from "@/lib/auth";
import { saveOptionalUpload } from "@/lib/uploads";
import {
  Button,
  Callout,
  Card,
  LinkButton,
  PageHeader,
} from "@/components/ui";
import { parseNumber, parseText } from "../../../collections/_shared";
import { ProductFields } from "../../product-fields";

export const metadata = { title: "Изделие — редактирование" };

async function updateProduct(formData: FormData) {
  "use server";
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/collections");

  const collectionId = parseText(formData.get("collectionId"));
  const name = parseText(formData.get("name"));
  if (!collectionId || !name) redirect(`/products/${id}/edit?error=required`);

  const rows = await db
    .select()
    .from(schema.products)
    .where(eq(schema.products.id, id))
    .limit(1);
  const before = rows[0];
  if (!before) redirect("/collections");

  let photoUrl = before.photoUrl;
  try {
    const saved = await saveOptionalUpload(formData.get("photo"), "products");
    if (saved) photoUrl = saved.url;
  } catch {
    redirect(`/products/${id}/edit?error=photo`);
  }

  const after = {
    collectionId,
    name,
    baseSku: parseText(formData.get("baseSku")),
    photoUrl,
    note: parseText(formData.get("note")),
    // менеджер поле не видит — оставляем прежнее значение
    defaultSewingCost: canSeeMoney(user)
      ? parseNumber(formData.get("defaultSewingCost"))
      : before.defaultSewingCost,
    updatedAt: new Date().toISOString(),
  };

  await db.update(schema.products).set(after).where(eq(schema.products.id, id));

  await writeAudit(user, {
    action: "UPDATE",
    entityType: "product",
    entityId: id,
    entityName: name,
    changes: diffFields(before, after, [
      "collectionId",
      "name",
      "baseSku",
      "photoUrl",
      "note",
      "defaultSewingCost",
    ]),
  });

  revalidatePath(`/products/${id}`);
  revalidatePath("/collections");
  revalidatePath(`/collections/${collectionId}`);
  redirect(`/products/${id}?ok=saved`);
}

async function archiveProduct(formData: FormData) {
  "use server";
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/collections");

  const rows = await db
    .select()
    .from(schema.products)
    .where(eq(schema.products.id, id))
    .limit(1);
  const product = rows[0];
  if (!product) redirect("/collections");

  const next = !product.isArchived;
  await db
    .update(schema.products)
    .set({ isArchived: next, updatedAt: new Date().toISOString() })
    .where(eq(schema.products.id, id));

  await writeAudit(user, {
    action: "UPDATE",
    entityType: "product",
    entityId: id,
    entityName: product.name,
    changes: { архив: { from: product.isArchived, to: next } },
  });

  revalidatePath(`/products/${id}`);
  revalidatePath("/collections");
  revalidatePath(`/collections/${product.collectionId}`);
  redirect(`/products/${id}?ok=archive`);
}

const ERRORS: Record<string, string> = {
  required: "Коллекция и название изделия обязательны",
  photo: "Фото не сохранилось: поддерживаются JPG, PNG, WEBP и GIF до 25 МБ",
};

export default async function EditProductPage({
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
    .from(schema.products)
    .where(eq(schema.products.id, id))
    .limit(1);
  const product = rows[0];
  if (!product) notFound();

  const collections = await db
    .select({ id: schema.collections.id, name: schema.collections.name })
    .from(schema.collections)
    .orderBy(asc(schema.collections.name));

  return (
    <>
      <PageHeader
        title={`Изделие: ${product.name}`}
        subtitle="Состав, варианты и лекала меняются в карточке изделия"
        action={<LinkButton href={`/products/${id}`}>Назад к изделию</LinkButton>}
      />

      {error ? (
        <Callout tone="critical" title="Не сохранено">
          {error}
        </Callout>
      ) : null}

      <form action={updateProduct}>
        <input type="hidden" name="id" value={id} />
        <Card>
          <ProductFields
            collections={collections}
            money={canSeeMoney(user)}
            values={{
              collectionId: product.collectionId,
              name: product.name,
              baseSku: product.baseSku,
              defaultSewingCost: product.defaultSewingCost,
              note: product.note,
              photoUrl: product.photoUrl,
            }}
          />
        </Card>

        <div className="mt-5 flex flex-wrap gap-3">
          <Button type="submit" variant="primary">
            Сохранить изменения
          </Button>
          <LinkButton href={`/products/${id}`} variant="ghost">
            Отмена
          </LinkButton>
        </div>
      </form>

      <Card className="mt-6">
        <h3 className="m-0 mb-2 text-base">
          {product.isArchived ? "Изделие в архиве" : "Архив"}
        </h3>
        <p className="mt-0 mb-3 text-sm text-[var(--color-muted)]">
          {product.isArchived
            ? "Изделие скрыто из списков коллекции. Верните его, если снова шьёте."
            : "Архивное изделие исчезает из списков, но история заказов и состав остаются."}
        </p>
        <form action={archiveProduct}>
          <input type="hidden" name="id" value={id} />
          <Button type="submit" variant={product.isArchived ? "secondary" : "danger"}>
            {product.isArchived ? "Вернуть из архива" : "Убрать в архив"}
          </Button>
        </form>
      </Card>
    </>
  );
}
