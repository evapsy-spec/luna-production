import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/lib/db/client";
import { getCurrentUser, writeAudit } from "@/lib/auth";
import { Button, Callout, Card, LinkButton, PageHeader } from "@/components/ui";
import { SupplierFields, supplierValuesFromForm } from "../supplier-fields";

export const metadata = { title: "Новый поставщик — Luna Production" };

async function createSupplier(formData: FormData) {
  "use server";
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const values = supplierValuesFromForm(formData);
  if (!values.name) redirect("/suppliers/new?error=required");

  const [supplier] = await db.insert(schema.suppliers).values(values).returning();

  await writeAudit(user, {
    action: "CREATE",
    entityType: "supplier",
    entityId: supplier.id,
    entityName: supplier.name,
  });

  revalidatePath("/suppliers");
  redirect("/suppliers");
}

export default async function NewSupplierPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const flags = await searchParams;

  return (
    <>
      <PageHeader
        title="Новый поставщик"
        action={<LinkButton href="/suppliers">Назад к списку</LinkButton>}
      />

      {flags.error ? (
        <Callout tone="critical" title="Не сохранено">
          Название обязательно.
        </Callout>
      ) : null}

      <form action={createSupplier}>
        <Card>
          <SupplierFields />
        </Card>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button type="submit" variant="primary">
            Сохранить
          </Button>
          <LinkButton href="/suppliers" variant="ghost">
            Отмена
          </LinkButton>
        </div>
      </form>
    </>
  );
}
