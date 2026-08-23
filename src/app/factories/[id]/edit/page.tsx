import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import {
  diffFields,
  getCurrentUser,
  requireUser,
  writeAudit,
} from "@/lib/auth";
import {
  Button,
  Callout,
  Card,
  LinkButton,
  PageHeader,
} from "@/components/ui";
import { FactoryFormFields, formInt, formNum, formStr } from "../../_parts";

export const metadata = { title: "Изменить фабрику — Luna Production" };

const TRACKED = [
  "name",
  "specialization",
  "contact",
  "phone",
  "whatsapp",
  "email",
  "address",
  "mapsLat",
  "mapsLng",
  "mapsUrl",
  "country",
  "monthlyCapacityUnits",
  "note",
] as const;

async function updateFactory(formData: FormData) {
  "use server";
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const before = (
    await db
      .select()
      .from(schema.factories)
      .where(eq(schema.factories.id, id))
      .limit(1)
  )[0];
  if (!before) return;

  const name = formStr(formData.get("name"));
  if (!name) redirect(`/factories/${id}/edit?error=name`);

  const patch = {
    name,
    specialization: formStr(formData.get("specialization")),
    contact: formStr(formData.get("contact")),
    phone: formStr(formData.get("phone")),
    whatsapp: formStr(formData.get("whatsapp")),
    email: formStr(formData.get("email")),
    address: formStr(formData.get("address")),
    mapsLat: formNum(formData.get("mapsLat")),
    mapsLng: formNum(formData.get("mapsLng")),
    mapsUrl: formStr(formData.get("mapsUrl")),
    country: formStr(formData.get("country")),
    monthlyCapacityUnits: formInt(formData.get("monthlyCapacityUnits")),
    note: formStr(formData.get("note")),
    updatedAt: new Date().toISOString(),
  };

  await db
    .update(schema.factories)
    .set(patch)
    .where(eq(schema.factories.id, id));

  const changes = diffFields(before, patch, [...TRACKED]);
  await writeAudit(user, {
    action: "UPDATE",
    entityType: "Factory",
    entityId: id,
    entityName: name,
    changes,
  });

  revalidatePath("/factories");
  revalidatePath(`/factories/${id}`);
  redirect(`/factories/${id}`);
}

export default async function EditFactoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const query = await searchParams;

  const factory = (
    await db
      .select()
      .from(schema.factories)
      .where(eq(schema.factories.id, id))
      .limit(1)
  )[0];

  if (!factory) {
    return (
      <>
        <PageHeader title="Фабрика не найдена" />
        <Callout tone="warn" title="Такой фабрики нет">
          Возможно, её удалили. Вернитесь к списку и выберите другую.
        </Callout>
        <LinkButton href="/factories">Все фабрики</LinkButton>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`Изменить: ${factory.name}`}
        action={<LinkButton href={`/factories/${id}`}>Отмена</LinkButton>}
      />

      <Card>
        <form action={updateFactory}>
          <input type="hidden" name="id" value={id} />

          {query.error === "name" ? (
            <div className="mb-4 rounded-lg bg-[#FBE9E9] px-3.5 py-2.5 text-sm text-[#A82C2C]">
              <span aria-hidden="true">✕</span> Название обязательно
            </div>
          ) : null}

          <FactoryFormFields values={factory} />

          <div className="mt-5 flex flex-wrap gap-2">
            <Button type="submit">Сохранить</Button>
            <LinkButton href={`/factories/${id}`} variant="ghost">
              Отмена
            </LinkButton>
          </div>
        </form>
      </Card>
    </>
  );
}
