import { eq, or } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import {
  Card,
  PageHeader,
  LinkButton,
  EmptyState,
  Table,
  Th,
  Td,
  Thumb,
  StatusPill,
} from "@/components/ui";

/**
 * Куда ведёт QR-метка партии изделий: сканируешь камерой телефона на складе —
 * сразу видишь, что это за SKU и сколько его где лежит.
 * Принимаем и qrToken, и сам id — метки, напечатанные до появления токена,
 * должны продолжать работать.
 */
export default async function ScanVariantPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const rows = await db
    .select({
      variant: schema.productVariants,
      productId: schema.products.id,
      productName: schema.products.name,
      productPhoto: schema.products.photoUrl,
      collectionName: schema.collections.name,
    })
    .from(schema.productVariants)
    .innerJoin(
      schema.products,
      eq(schema.productVariants.productId, schema.products.id),
    )
    .innerJoin(
      schema.collections,
      eq(schema.products.collectionId, schema.collections.id),
    )
    .where(
      or(
        eq(schema.productVariants.qrToken, token),
        eq(schema.productVariants.id, token),
        eq(schema.productVariants.sku, token),
      ),
    )
    .limit(1);

  if (!rows.length) {
    return (
      <>
        <PageHeader title="Метка не найдена" />
        <EmptyState
          title="Такой SKU в базе не числится"
          hint={`Метка «${token}» не соответствует ни одному варианту. Возможно, позиция была удалена или метка от другой системы.`}
          action={<LinkButton href="/collections">Открыть коллекции</LinkButton>}
        />
      </>
    );
  }

  const { variant, productId, productName, productPhoto, collectionName } =
    rows[0];

  const stock = await db
    .select({
      quantity: schema.variantStock.quantity,
      syncedAt: schema.variantStock.syncedAt,
      warehouseName: schema.warehouses.name,
    })
    .from(schema.variantStock)
    .innerJoin(
      schema.warehouses,
      eq(schema.variantStock.warehouseId, schema.warehouses.id),
    )
    .where(eq(schema.variantStock.variantId, variant.id));

  const total = stock.reduce((s, r) => s + r.quantity, 0);

  return (
    <>
      <PageHeader
        title={variant.sku}
        subtitle={`${productName} · ${collectionName}`}
        action={
          <LinkButton href={`/products/${productId}`} variant="primary">
            Открыть изделие
          </LinkButton>
        }
      />

      <Card className="mb-4">
        <div className="flex items-start gap-4">
          <Thumb src={productPhoto} alt={productName} size={72} />
          <div>
            <div className="figure text-2xl text-[var(--color-ocean)]">
              {total} шт
            </div>
            <div className="mt-1 text-sm text-[var(--color-muted)]">
              всего по всем складам
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {variant.color ? (
                <StatusPill tone="neutral">{variant.color}</StatusPill>
              ) : null}
              {variant.size ? (
                <StatusPill tone="neutral">размер {variant.size}</StatusPill>
              ) : null}
              {variant.isArchived ? (
                <StatusPill tone="warn">в архиве</StatusPill>
              ) : null}
            </div>
          </div>
        </div>
      </Card>

      <Card padded={false}>
        <Table>
          <thead>
            <tr>
              <Th>Склад</Th>
              <Th align="right">Количество</Th>
              <Th>Обновлено</Th>
            </tr>
          </thead>
          <tbody>
            {stock.map((row, i) => (
              <tr key={i}>
                <Td>{row.warehouseName}</Td>
                <Td align="right">
                  <span className="tnum font-semibold">{row.quantity}</span>
                </Td>
                <Td>
                  <span className="text-xs text-[var(--color-muted)]">
                    {new Date(row.syncedAt).toLocaleString("ru-RU", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </Td>
              </tr>
            ))}
            {stock.length === 0 ? (
              <tr>
                <Td>
                  <span className="text-[var(--color-muted)]">
                    Остатков нет ни на одном складе
                  </span>
                </Td>
                <Td align="right">0</Td>
                <Td>—</Td>
              </tr>
            ) : null}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
