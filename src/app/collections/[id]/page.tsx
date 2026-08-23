import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { and, eq, gte, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { canSeeMoney, getCurrentUser } from "@/lib/auth";
import { LineChart } from "@/components/charts";
import {
  Callout,
  Card,
  LinkButton,
  Money,
  PageHeader,
  SectionTitle,
  Stat,
  StatusPill,
  Table,
  Td,
  Th,
  Thumb,
  formatDate,
} from "@/components/ui";
import { loadCatalog, ProductsTable, StockChips } from "../_shared";

export const metadata = { title: "Коллекция — Luna Production" };

const MONTHS_BACK = 6;

/** Ключи и подписи последних N месяцев: [{ key: "2026-03", label: "мар 26" }] */
function lastMonths(count: number): { key: string; label: string }[] {
  const now = new Date();
  const out: { key: string; label: string }[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = d.toISOString().slice(0, 7);
    const month = d
      .toLocaleDateString("ru-RU", { month: "short", timeZone: "UTC" })
      .replace(".", "");
    out.push({ key, label: `${month} ${String(d.getUTCFullYear()).slice(2)}` });
  }
  return out;
}

export default async function CollectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const money = canSeeMoney(user);

  const { id } = await params;
  const flags = await searchParams;

  const [collection] = await loadCatalog({ collectionId: id });
  if (!collection) notFound();

  const months = lastMonths(MONTHS_BACK);
  const since = `${months[0].key}-01`;

  const variantRows = await db
    .select({ id: schema.productVariants.id })
    .from(schema.productVariants)
    .innerJoin(
      schema.products,
      eq(schema.productVariants.productId, schema.products.id),
    )
    .where(eq(schema.products.collectionId, id));
  const variantIds = variantRows.map((v) => v.id);

  // inArray с пустым списком собирает нерабочий SQL — просто не ходим в базу
  const salesRows =
    variantIds.length > 0
      ? await db
          .select({
            day: schema.variantSalesDaily.day,
            units: schema.variantSalesDaily.units,
            revenue: schema.variantSalesDaily.revenue,
          })
          .from(schema.variantSalesDaily)
          .where(
            and(
              inArray(schema.variantSalesDaily.variantId, variantIds),
              gte(schema.variantSalesDaily.day, since),
            ),
          )
      : [];

  const unitsByMonth = new Map(months.map((m) => [m.key, 0]));
  const revenueByMonth = new Map(months.map((m) => [m.key, 0]));
  for (const s of salesRows) {
    const key = s.day.slice(0, 7);
    if (!unitsByMonth.has(key)) continue;
    unitsByMonth.set(key, (unitsByMonth.get(key) ?? 0) + s.units);
    revenueByMonth.set(key, (revenueByMonth.get(key) ?? 0) + s.revenue);
  }

  const chartSeries = [
    {
      name: "Продано, шт",
      points: months.map((m) => ({
        label: m.label,
        value: unitsByMonth.get(m.key) ?? 0,
      })),
    },
  ];
  const hasSales = chartSeries[0].points.some((p) => p.value > 0);

  const withoutBom = collection.products.filter((p) => !p.hasBom);

  return (
    <>
      <PageHeader
        title={collection.name}
        subtitle={`${collection.productCount} изделий · ${collection.skuCount} SKU · создана ${formatDate(collection.createdAt)}`}
        action={
          <div className="flex flex-wrap gap-2">
            <LinkButton href="/collections">Все коллекции</LinkButton>
            <LinkButton href={`/collections/${id}/edit`} variant="primary">
              Редактировать
            </LinkButton>
          </div>
        }
      />

      {flags.ok === "saved" ? (
        <Callout tone="ok" title="Изменения сохранены">
          Запись ушла в историю изменений.
        </Callout>
      ) : null}

      {withoutBom.length > 0 ? (
        <Callout tone="warn" title={`Без состава: ${withoutBom.length} изделий`}>
          {withoutBom.map((p) => p.name).join(", ")} — Luna не сможет посчитать
          расход ткани и бюджет заказа, пока состав не задан.
        </Callout>
      ) : null}

      <div className="grid gap-4 md:grid-cols-[auto_1fr]">
        <Card>
          <Thumb src={collection.photoUrl} alt={collection.name} size={160} />
          {collection.ainurCategoryId ? (
            <div className="mt-3">
              <StatusPill tone="neutral">
                Ainur: {collection.ainurCategoryId}
              </StatusPill>
            </div>
          ) : null}
        </Card>

        <div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Изделий" value={collection.productCount} />
            <Stat label="SKU" value={collection.skuCount} />
            <Stat
              label="Остаток, шт"
              value={collection.stockQty}
              sub={`${collection.byWarehouse.length} складов`}
            />
            <Stat
              label="Продажи 90 дней"
              value={`${collection.unitsSold} шт`}
              sub={<Money value={collection.revenue} hidden={!money} />}
            />
          </div>
          <div className="mt-3">
            <StockChips rows={collection.byWarehouse} />
          </div>
        </div>
      </div>

      <Card className="mt-4">
        <div className="grid gap-4 text-sm sm:grid-cols-3">
          <div className="sm:col-span-2">
            <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
              Описание
            </div>
            <div className="mt-1">{collection.description ?? "—"}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
              Шьют на фабриках
            </div>
            <div className="mt-1">
              {collection.factories.length === 0 ? (
                <span className="text-[var(--color-faint)]">
                  фабрика не назначена — привяжите коллекцию в карточке фабрики
                </span>
              ) : (
                <div className="flex flex-col gap-1">
                  {collection.factories.map((f) => (
                    <Link key={f.id} href={`/factories/${f.id}`}>
                      {f.name}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </Card>

      <SectionTitle>Остаток по складам</SectionTitle>
      {collection.byWarehouse.length === 0 ? (
        <Card>
          <p className="m-0 text-sm text-[var(--color-muted)]">
            Остатков нет ни на одном складе. Данные приходят из Ainur при
            синхронизации.
          </p>
        </Card>
      ) : (
        <Card padded={false}>
          <Table>
            <thead>
              <tr>
                <Th>Склад</Th>
                <Th align="right">Штук</Th>
                <Th align="right">Доля остатка</Th>
              </tr>
            </thead>
            <tbody>
              {collection.byWarehouse.map((w) => (
                <tr key={w.warehouseId}>
                  <Td>{w.warehouseName}</Td>
                  <Td align="right">{w.qty}</Td>
                  <Td align="right">
                    {collection.stockQty > 0
                      ? `${Math.round((w.qty / collection.stockQty) * 100)}%`
                      : "—"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <SectionTitle>Продажи по месяцам</SectionTitle>
      <Card>
        {hasSales ? (
          <>
            <LineChart series={chartSeries} label="Продано штук за 6 месяцев" />
            <div className="mt-3 text-xs text-[var(--color-muted)]">
              Выручка за тот же период:{" "}
              <Money
                value={months.reduce(
                  (s, m) => s + (revenueByMonth.get(m.key) ?? 0),
                  0,
                )}
                hidden={!money}
              />
            </div>
          </>
        ) : (
          <p className="m-0 text-sm text-[var(--color-muted)]">
            За последние {MONTHS_BACK} месяцев продаж по коллекции нет —
            синхронизируйте продажи с Ainur или проверьте, заведены ли варианты.
          </p>
        )}
      </Card>

      <SectionTitle>Изделия коллекции</SectionTitle>
      {collection.products.length === 0 ? (
        <Card>
          <p className="mt-0 mb-3 text-sm text-[var(--color-muted)]">
            В коллекции пока нет изделий. Начните с первого — у него зададите
            состав и загрузите лекала.
          </p>
          <LinkButton
            href={`/products/new?collectionId=${id}`}
            variant="primary"
          >
            Добавить изделие
          </LinkButton>
        </Card>
      ) : (
        <>
          <Card padded={false}>
            <ProductsTable products={collection.products} money={money} />
          </Card>
          <div className="mt-4">
            <LinkButton
              href={`/products/new?collectionId=${id}`}
              variant="primary"
            >
              Добавить изделие
            </LinkButton>
          </div>
        </>
      )}
    </>
  );
}
