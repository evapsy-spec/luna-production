import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { diffFields, getCurrentUser, writeAudit } from "@/lib/auth";
import {
  Button,
  Callout,
  Card,
  LinkButton,
  MapsLink,
  PageHeader,
  SectionTitle,
  Table,
  Td,
  Th,
  WhatsappLink,
} from "@/components/ui";
import { SupplierFields, supplierValuesFromForm } from "../../supplier-fields";

async function updateSupplier(formData: FormData) {
  "use server";
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/suppliers");

  const values = supplierValuesFromForm(formData);
  if (!values.name) redirect(`/suppliers/${id}/edit?error=required`);

  const before = (
    await db.select().from(schema.suppliers).where(eq(schema.suppliers.id, id)).limit(1)
  )[0];
  if (!before) redirect("/suppliers");

  await db.update(schema.suppliers).set(values).where(eq(schema.suppliers.id, id));

  await writeAudit(user, {
    action: "UPDATE",
    entityType: "supplier",
    entityId: id,
    entityName: values.name,
    changes: diffFields(before, values, [
      "name",
      "contact",
      "phone",
      "whatsapp",
      "email",
      "address",
      "mapsLat",
      "mapsLng",
      "mapsUrl",
      "country",
      "note",
    ]),
  });

  revalidatePath("/suppliers");
  redirect("/suppliers");
}

export default async function EditSupplierPage({
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

  const rows = await db
    .select()
    .from(schema.suppliers)
    .where(eq(schema.suppliers.id, id))
    .limit(1);
  const supplier = rows[0];
  if (!supplier) notFound();

  const fabrics = await db
    .select({
      id: schema.fabrics.id,
      sku: schema.fabrics.sku,
      name: schema.fabrics.name,
      isOnOrder: schema.fabrics.isOnOrder,
    })
    .from(schema.fabrics)
    .where(eq(schema.fabrics.supplierId, id))
    .orderBy(asc(schema.fabrics.name));

  return (
    <>
      <PageHeader
        title={supplier.name}
        subtitle="Поставщик ткани"
        action={<LinkButton href="/suppliers">Назад к списку</LinkButton>}
      />

      {flags.error ? (
        <Callout tone="critical" title="Не сохранено">
          Название обязательно.
        </Callout>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-4">
        <WhatsappLink phone={supplier.whatsapp} />
        <MapsLink
          lat={supplier.mapsLat}
          lng={supplier.mapsLng}
          address={supplier.address}
          url={supplier.mapsUrl}
        />
      </div>

      <form action={updateSupplier}>
        <input type="hidden" name="id" value={id} />
        <Card>
          <SupplierFields values={supplier} />
        </Card>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button type="submit" variant="primary">
            Сохранить изменения
          </Button>
          <LinkButton href="/suppliers" variant="ghost">
            Отмена
          </LinkButton>
        </div>
      </form>

      <SectionTitle>Что у него покупаем</SectionTitle>
      {fabrics.length === 0 ? (
        <Card>
          <p className="m-0 text-sm text-[var(--color-muted)]">
            К этому поставщику пока не привязана ни одна ткань.
          </p>
        </Card>
      ) : (
        <Card padded={false}>
          <Table>
            <thead>
              <tr>
                <Th>Ткань</Th>
                <Th>SKU</Th>
                <Th>Статус</Th>
              </tr>
            </thead>
            <tbody>
              {fabrics.map((f) => (
                <tr key={f.id}>
                  <Td>
                    <a href={`/fabrics/${f.id}`}>{f.name}</a>
                  </Td>
                  <Td>{f.sku}</Td>
                  <Td>{f.isOnOrder ? "заказано, ожидаем" : "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
