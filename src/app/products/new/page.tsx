import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { canSeeMoney, getCurrentUser, writeAudit } from "@/lib/auth";
import { saveOptionalUpload } from "@/lib/uploads";
import {
  Button,
  Callout,
  Card,
  EmptyState,
  LinkButton,
  PageHeader,
} from "@/components/ui";
import { parseNumber, parseText } from "../../collections/_shared";
import { ProductFields } from "../product-fields";

export const metadata = { title: "Новое изделие — Luna Production" };

async function createProduct(formData: FormData) {
  "use server";
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const collectionId = parseText(formData.get("collectionId"));
  const name = parseText(formData.get("name"));
  const back = `/products/new${collectionId ? `?collectionId=${collectionId}` : ""}`;
  if (!collectionId || !name) {
    redirect(`${back}${collectionId ? "&" : "?"}error=required`);
  }

  let photoUrl: string | null = null;
  try {
    const saved = await saveOptionalUpload(formData.get("photo"), "products");
    photoUrl = saved?.url ?? null;
  } catch {
    redirect(`${back}${collectionId ? "&" : "?"}error=photo`);
  }

  const [product] = await db
    .insert(schema.products)
    .values({
      collectionId,
      name,
      baseSku: parseText(formData.get("baseSku")),
      photoUrl,
      note: parseText(formData.get("note")),
      defaultSewingCost: canSeeMoney(user)
        ? parseNumber(formData.get("defaultSewingCost"))
        : null,
    })
    .returning();

  await writeAudit(user, {
    action: "CREATE",
    entityType: "product",
    entityId: product.id,
    entityName: product.name,
  });

  revalidatePath("/collections");
  revalidatePath(`/collections/${collectionId}`);
  // сразу в карточку: следующий шаг — задать состав (BOM)
  redirect(`/products/${product.id}?ok=created`);
}

const ERRORS: Record<string, string> = {
  required: "Коллекция и название изделия обязательны",
  photo: "Фото не сохранилось: поддерживаются JPG, PNG, WEBP и GIF до 25 МБ",
};

export default async function NewProductPage({
  searchParams,
}: {
  searchParams: Promise<{ collectionId?: string; error?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const error = params.error ? ERRORS[params.error] : null;

  const collections = await db
    .select({ id: schema.collections.id, name: schema.collections.name })
    .from(schema.collections)
    .where(eq(schema.collections.isArchived, false))
    .orderBy(asc(schema.collections.name));

  if (collections.length === 0) {
    return (
      <>
        <PageHeader title="Новое изделие" />
        <EmptyState
          title="Сначала нужна коллекция"
          hint="Изделие всегда лежит внутри коллекции. Создайте коллекцию — и вернитесь сюда."
          action={
            <LinkButton href="/collections/new" variant="primary">
              Добавить коллекцию
            </LinkButton>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Новое изделие"
        subtitle="После сохранения сразу откроется карточка — там задаётся состав (BOM) и загружаются лекала"
        action={
          <LinkButton
            href={
              params.collectionId
                ? `/collections/${params.collectionId}`
                : "/collections"
            }
          >
            Назад
          </LinkButton>
        }
      />

      {error ? (
        <Callout tone="critical" title="Не сохранено">
          {error}
        </Callout>
      ) : null}

      <form action={createProduct}>
        <Card>
          <ProductFields
            collections={collections}
            money={canSeeMoney(user)}
            values={{ collectionId: params.collectionId ?? null }}
          />
        </Card>

        <div className="mt-5 flex flex-wrap gap-3">
          <Button type="submit" variant="primary">
            Сохранить изделие
          </Button>
          <LinkButton href="/collections" variant="ghost">
            Отмена
          </LinkButton>
        </div>
      </form>
    </>
  );
}
