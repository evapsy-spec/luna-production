import { redirect } from "next/navigation";
import { eq, or } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import { Callout, LinkButton, PageHeader } from "@/components/ui";

export const metadata = { title: "Сканирование метки — Luna Production" };

/**
 * Точка входа с QR-метки на рулоне. Ищем и по токену метки, и по id ткани —
 * у тканей, завёденных до появления токенов, в метке лежит id.
 */
export default async function ScanFabricPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { token } = await params;
  const value = decodeURIComponent(token);

  const rows = await db
    .select({ id: schema.fabrics.id })
    .from(schema.fabrics)
    .where(or(eq(schema.fabrics.qrToken, value), eq(schema.fabrics.id, value)))
    .limit(1);

  if (rows[0]) redirect(`/fabrics/${rows[0].id}`);

  return (
    <>
      <PageHeader title="Метка не найдена" />
      <Callout tone="critical" title={`Код «${value}» ни к одной ткани не привязан`}>
        Такое бывает, если ткань удалили из Luna или метку переклеили с другого
        рулона. Найдите ткань в списке по названию или SKU и напечатайте метку
        заново — кнопка «Печать QR» в карточке ткани.
      </Callout>
      <LinkButton href="/fabrics" variant="primary">
        Открыть список тканей
      </LinkButton>
    </>
  );
}
