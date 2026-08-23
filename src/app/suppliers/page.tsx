import { redirect } from "next/navigation";
import Link from "next/link";
import { asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import {
  Card,
  EmptyState,
  LinkButton,
  MapsLink,
  PageHeader,
  Table,
  Td,
  Th,
  WhatsappLink,
} from "@/components/ui";

export const metadata = { title: "Поставщики — Luna Production" };

export default async function SuppliersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const suppliers = await db
    .select()
    .from(schema.suppliers)
    .orderBy(asc(schema.suppliers.name));

  const counts = await db
    .select({
      supplierId: schema.fabrics.supplierId,
      fabrics: sql<number>`COUNT(*)`,
    })
    .from(schema.fabrics)
    .where(eq(schema.fabrics.isArchived, false))
    .groupBy(schema.fabrics.supplierId);
  const countBySupplier = new Map(
    counts.map((c) => [c.supplierId ?? "", Number(c.fabrics) || 0]),
  );

  return (
    <>
      <PageHeader
        title="Поставщики"
        subtitle="У кого покупаем ткань: контакты, WhatsApp и маршрут"
        action={
          <LinkButton href="/suppliers/new" variant="primary">
            + Добавить
          </LinkButton>
        }
      />

      {suppliers.length === 0 ? (
        <EmptyState
          title="Поставщиков пока нет"
          hint="Добавьте поставщика — тогда в карточке ткани появится кнопка «Написать в WhatsApp» и заявки на дозакупку можно будет отправлять в один клик."
          action={
            <LinkButton href="/suppliers/new" variant="primary">
              + Добавить поставщика
            </LinkButton>
          }
        />
      ) : (
        <Card padded={false}>
          <Table>
            <thead>
              <tr>
                <Th>Поставщик</Th>
                <Th>Контакт</Th>
                <Th>Страна</Th>
                <Th>Связь</Th>
                <Th align="right">Тканей</Th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.id}>
                  <Td>
                    <Link
                      href={`/suppliers/${s.id}/edit`}
                      className="font-medium text-[var(--color-ocean)]"
                    >
                      {s.name}
                    </Link>
                    {s.address ? (
                      <div className="text-xs text-[var(--color-muted)]">
                        {s.address}
                      </div>
                    ) : null}
                  </Td>
                  <Td>
                    <div>{s.contact ?? "—"}</div>
                    <div className="text-xs text-[var(--color-muted)]">
                      {s.phone ?? s.email ?? ""}
                    </div>
                  </Td>
                  <Td>{s.country ?? "—"}</Td>
                  <Td>
                    <div className="flex flex-col gap-1">
                      <WhatsappLink phone={s.whatsapp} />
                      <MapsLink
                        lat={s.mapsLat}
                        lng={s.mapsLng}
                        address={s.address}
                        url={s.mapsUrl}
                      />
                    </div>
                  </Td>
                  <Td align="right">{countBySupplier.get(s.id) ?? 0}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
