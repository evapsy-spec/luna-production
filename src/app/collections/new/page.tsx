import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/lib/db/client";
import { getCurrentUser, writeAudit } from "@/lib/auth";
import { saveOptionalUpload } from "@/lib/uploads";
import {
  Button,
  Callout,
  Card,
  LinkButton,
  PageHeader,
} from "@/components/ui";
import { CollectionFields } from "../collection-fields";
import { parseText } from "../_shared";

export const metadata = { title: "Новая коллекция — Luna Production" };

async function createCollection(formData: FormData) {
  "use server";
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const name = parseText(formData.get("name"));
  if (!name) redirect("/collections/new?error=required");

  let photoUrl: string | null = null;
  try {
    const saved = await saveOptionalUpload(formData.get("photo"), "products");
    photoUrl = saved?.url ?? null;
  } catch {
    redirect("/collections/new?error=photo");
  }

  const [collection] = await db
    .insert(schema.collections)
    .values({
      name,
      description: parseText(formData.get("description")),
      photoUrl,
    })
    .returning();

  await writeAudit(user, {
    action: "CREATE",
    entityType: "collection",
    entityId: collection.id,
    entityName: collection.name,
  });

  revalidatePath("/collections");
  redirect(`/collections/${collection.id}`);
}

const ERRORS: Record<string, string> = {
  required: "Название коллекции обязательно",
  photo: "Фото не сохранилось: поддерживаются JPG, PNG, WEBP и GIF до 25 МБ",
};

export default async function NewCollectionPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const error = params.error ? ERRORS[params.error] : null;

  return (
    <>
      <PageHeader
        title="Новая коллекция"
        subtitle="Дальше внутрь коллекции добавляются изделия, а у изделия — состав и лекала"
        action={<LinkButton href="/collections">Назад к коллекциям</LinkButton>}
      />

      {error ? (
        <Callout tone="critical" title="Не сохранено">
          {error}
        </Callout>
      ) : null}

      <form action={createCollection}>
        <Card>
          <CollectionFields />
        </Card>

        <div className="mt-5 flex flex-wrap gap-3">
          <Button type="submit" variant="primary">
            Сохранить коллекцию
          </Button>
          <LinkButton href="/collections" variant="ghost">
            Отмена
          </LinkButton>
        </div>
      </form>
    </>
  );
}
