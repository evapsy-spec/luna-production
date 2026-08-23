import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/lib/db/client";
import { getCurrentUser, requireUser, writeAudit } from "@/lib/auth";
import { Button, Card, LinkButton, PageHeader } from "@/components/ui";
import { FactoryFormFields, formInt, formNum, formStr } from "../_parts";

export const metadata = { title: "Новая фабрика — Luna Production" };

async function createFactory(formData: FormData) {
  "use server";
  const user = await requireUser();

  const name = formStr(formData.get("name"));
  if (!name) redirect("/factories/new?error=name");

  const id = crypto.randomUUID();
  await db.insert(schema.factories).values({
    id,
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
  });

  await writeAudit(user, {
    action: "CREATE",
    entityType: "Factory",
    entityId: id,
    entityName: name,
  });

  revalidatePath("/factories");
  redirect(`/factories/${id}`);
}

export default async function NewFactoryPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const params = await searchParams;

  return (
    <>
      <PageHeader
        title="Новая фабрика"
        subtitle="Минимум — название. Остальное можно дописать позже"
        action={<LinkButton href="/factories">Отмена</LinkButton>}
      />

      <Card>
        <form action={createFactory}>
          {params.error === "name" ? (
            <div className="mb-4 rounded-lg bg-[#FBE9E9] px-3.5 py-2.5 text-sm text-[#A82C2C]">
              <span aria-hidden="true">✕</span> Название обязательно
            </div>
          ) : null}

          <FactoryFormFields />

          <div className="mt-5 flex flex-wrap gap-2">
            <Button type="submit">Создать фабрику</Button>
            <LinkButton href="/factories" variant="ghost">
              Отмена
            </LinkButton>
          </div>
        </form>
      </Card>
    </>
  );
}
