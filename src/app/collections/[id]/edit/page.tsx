import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { diffFields, getCurrentUser, writeAudit } from "@/lib/auth";
import { saveOptionalUpload } from "@/lib/uploads";
import {
  Button,
  Callout,
  Card,
  Checkbox,
  LinkButton,
  PageHeader,
} from "@/components/ui";
import { CollectionFields } from "../../collection-fields";
import { parseText } from "../../_shared";

export const metadata = { title: "Коллекция — редактирование" };

async function updateCollection(formData: FormData) {
  "use server";
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const id = String(formData.get("id") ?? "");
  const name = parseText(formData.get("name"));
  if (!id) redirect("/collections");
  if (!name) redirect(`/collections/${id}/edit?error=required`);

  const rows = await db
    .select()
    .from(schema.collections)
    .where(eq(schema.collections.id, id))
    .limit(1);
  const before = rows[0];
  if (!before) redirect("/collections");

  let photoUrl = before.photoUrl;
  try {
    const saved = await saveOptionalUpload(formData.get("photo"), "products");
    if (saved) photoUrl = saved.url;
  } catch {
    redirect(`/collections/${id}/edit?error=photo`);
  }

  const after = {
    name,
    description: parseText(formData.get("description")),
    photoUrl,
    isArchived: formData.get("isArchived") === "on",
  };

  await db
    .update(schema.collections)
    .set(after)
    .where(eq(schema.collections.id, id));

  await writeAudit(user, {
    action: "UPDATE",
    entityType: "collection",
    entityId: id,
    entityName: name,
    changes: diffFields(before, after, [
      "name",
      "description",
      "photoUrl",
      "isArchived",
    ]),
  });

  revalidatePath("/collections");
  revalidatePath(`/collections/${id}`);
  redirect(`/collections/${id}?ok=saved`);
}

const ERRORS: Record<string, string> = {
  required: "Название коллекции обязательно",
  photo: "Фото не сохранилось: поддерживаются JPG, PNG, WEBP и GIF до 25 МБ",
};

export default async function EditCollectionPage({
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
    .from(schema.collections)
    .where(eq(schema.collections.id, id))
    .limit(1);
  const collection = rows[0];
  if (!collection) notFound();

  return (
    <>
      <PageHeader
        title={`Коллекция: ${collection.name}`}
        subtitle="Название и описание видят все, кто работает с производством"
        action={
          <LinkButton href={`/collections/${id}`}>Назад к коллекции</LinkButton>
        }
      />

      {error ? (
        <Callout tone="critical" title="Не сохранено">
          {error}
        </Callout>
      ) : null}

      <form action={updateCollection}>
        <input type="hidden" name="id" value={id} />
        <Card>
          <CollectionFields
            values={{
              name: collection.name,
              description: collection.description,
              photoUrl: collection.photoUrl,
              ainurCategoryId: collection.ainurCategoryId,
            }}
          />
          <div className="mt-4">
            <Checkbox
              name="isArchived"
              label="Убрать из списка (архив)"
              defaultChecked={collection.isArchived}
            />
          </div>
        </Card>

        <div className="mt-5 flex flex-wrap gap-3">
          <Button type="submit" variant="primary">
            Сохранить изменения
          </Button>
          <LinkButton href={`/collections/${id}`} variant="ghost">
            Отмена
          </LinkButton>
        </div>
      </form>
    </>
  );
}
