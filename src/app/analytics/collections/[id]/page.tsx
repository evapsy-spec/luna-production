import { notFound, redirect } from "next/navigation";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { canSeeMoney, getCurrentUser } from "@/lib/auth";
import { formatThb, getVelocity, type VelocityRow } from "@/lib/production";
import {
  Card,
  EmptyState,
  LinkButton,
  Money,
  PageHeader,
  SectionTitle,
  Stat,
  Table,
  Td,
  Th,
} from "@/components/ui";
import { CoverageBar, LineChart, RankBars } from "@/components/charts";
import {
  WINDOW_OPTIONS,
  formatUnits,
  isoDaysAgo,
  lastMonths,
  parseWindow,
} from "../../_shared";

export const metadata = { title: "Аналитика коллекции — Luna Production" };

function variantLabel(row: VelocityRow): string {
  return [row.productName, row.color, row.size].filter(Boolean).join(" · ");
}

function snapshotLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

export default async function CollectionAnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ days?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const showMoney = canSeeMoney(user);

  const { id } = await params;
  const query = await searchParams;
  const days = parseWindow(query.days);

  const collectionRows = await db
    .select()
    .from(schema.collections)
    .where(eq(schema.collections.id, id))
    .limit(1);
  const collection = collectionRows[0];
  if (!collection) notFound();

  const velocity = (await getVelocity(days)).filter(
    (r) => r.collectionId === id,
  );

  const unitsSold = velocity.reduce((s, r) => s + r.unitsSold, 0);
  const revenue = velocity.reduce((s, r) => s + r.revenue, 0);
  const stockTotal = velocity.reduce((s, r) => s + r.stockQty, 0);

  // ---------- Продажи по месяцам ----------
  const months = lastMonths(6);
  const monthRows = await db
    .select({
      month: sql<string>`substr(${schema.variantSalesDaily.day}, 1, 7)`,
      units: sql<number>`COALESCE(SUM(${schema.variantSalesDaily.units}), 0)`,
    })
    .from(schema.variantSalesDaily)
    .innerJoin(
      schema.productVariants,
      eq(schema.variantSalesDaily.variantId, schema.productVariants.id),
    )
    .innerJoin(
      schema.products,
      eq(schema.productVariants.productId, schema.products.id),
    )
    .where(
      and(
        eq(schema.products.collectionId, id),
        gte(schema.variantSalesDaily.day, `${months[0].key}-01`),
      ),
    )
    .groupBy(sql`substr(${schema.variantSalesDaily.day}, 1, 7)`);

  const unitsByMonth = new Map(
    monthRows.map((r) => [r.month, Number(r.units)]),
  );
  const salesSeries = [
    {
      name: "Продано, шт",
      points: months.map((m) => ({
        label: m.label,
        value: unitsByMonth.get(m.key) ?? 0,
      })),
    },
  ];

  // ---------- Модели внутри коллекции ----------
  const modelAgg = new Map<
    string,
    { name: string; units: number; revenue: number; stock: number }
  >();
  for (const row of velocity) {
    const entry = modelAgg.get(row.productId) ?? {
      name: row.productName,
      units: 0,
      revenue: 0,
      stock: 0,
    };
    entry.units += row.unitsSold;
    entry.revenue += row.revenue;
    entry.stock += row.stockQty;
    modelAgg.set(row.productId, entry);
  }
  const modelValue = (m: { units: number; revenue: number }) =>
    showMoney ? m.revenue : m.units;
  const modelFormatter = showMoney
    ? formatThb
    : (n: number) => `${formatUnits(n)} шт`;
  const topModels = [...modelAgg.values()]
    .sort((a, b) => modelValue(b) - modelValue(a))
    .slice(0, 10)
    .map((m) => ({
      label: m.name,
      value: modelValue(m),
      hint: `продано ${formatUnits(m.units)} шт · остаток ${formatUnits(m.stock)} шт`,
    }));

  // ---------- Цвета ----------
  const colorAgg = new Map<string, { units: number; stock: number }>();
  for (const row of velocity) {
    const color = row.color?.trim() || "цвет не указан";
    const entry = colorAgg.get(color) ?? { units: 0, stock: 0 };
    entry.units += row.unitsSold;
    entry.stock += row.stockQty;
    colorAgg.set(color, entry);
  }
  const colors = [...colorAgg.entries()]
    .map(([color, v]) => ({ color, ...v }))
    .sort((a, b) => b.units - a.units);
  const bestColors = colors.slice(0, 5);
  // хвост не пересекается с лидерами — иначе один цвет попадёт в оба списка
  const worstColors = colors.slice(Math.max(5, colors.length - 5)).reverse();
  const colorScale = Math.max(1, bestColors[0]?.units ?? 1);

  // ---------- Остаток по складам ----------
  const warehouseRows = await db
    .select({
      warehouseId: schema.warehouses.id,
      warehouseName: schema.warehouses.name,
      quantity: sql<number>`COALESCE(SUM(${schema.variantStock.quantity}), 0)`,
    })
    .from(schema.variantStock)
    .innerJoin(
      schema.warehouses,
      eq(schema.variantStock.warehouseId, schema.warehouses.id),
    )
    .innerJoin(
      schema.productVariants,
      eq(schema.variantStock.variantId, schema.productVariants.id),
    )
    .innerJoin(
      schema.products,
      eq(schema.productVariants.productId, schema.products.id),
    )
    .where(eq(schema.products.collectionId, id))
    .groupBy(schema.warehouses.id, schema.warehouses.name)
    .orderBy(asc(schema.warehouses.name));

  // ---------- Динамика остатка по снимкам ----------
  const snapshots = await db
    .select({
      takenAt: schema.stockSnapshots.takenAt,
      quantity: schema.stockSnapshots.quantity,
    })
    .from(schema.stockSnapshots)
    .where(
      and(
        eq(schema.stockSnapshots.scope, "collection"),
        eq(schema.stockSnapshots.refId, id),
      ),
    )
    .orderBy(desc(schema.stockSnapshots.takenAt))
    .limit(30);

  const stockSeries = [
    {
      name: "Остаток, шт",
      points: [...snapshots].reverse().map((s) => ({
        label: snapshotLabel(s.takenAt),
        value: Number(s.quantity),
      })),
    },
  ];

  const coverageRows = velocity
    .filter((r) => r.stockQty > 0 || r.unitsSold > 0)
    .sort((a, b) => (a.monthsOfCover ?? Infinity) - (b.monthsOfCover ?? Infinity));

  return (
    <>
      <PageHeader
        title={collection.name}
        subtitle={`Аналитика коллекции · окно расчёта ${days} дней`}
        action={<LinkButton href="/analytics">Ко всей аналитике</LinkButton>}
      />

      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-[var(--color-muted)]">
            Считать продажи за:
          </span>
          {WINDOW_OPTIONS.map((option) => (
            <LinkButton
              key={option}
              href={`/analytics/collections/${id}?days=${option}`}
              variant={option === days ? "primary" : "secondary"}
            >
              {option} дней
            </LinkButton>
          ))}
        </div>
      </Card>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Продано за период" value={`${formatUnits(unitsSold)} шт`} />
        <Stat
          label="Выручка за период"
          value={<Money value={revenue} hidden={!showMoney} />}
        />
        <Stat label="Остаток сейчас" value={`${formatUnits(stockTotal)} шт`} />
        <Stat label="Активных SKU" value={formatUnits(velocity.length)} />
      </div>

      <SectionTitle>Продажи по месяцам</SectionTitle>
      <Card>
        <LineChart
          series={salesSeries}
          label="Штук продано"
          valueFormatter={(n) => formatUnits(n)}
        />
      </Card>

      <SectionTitle>
        Модели коллекции {showMoney ? "по выручке" : "по количеству"}
      </SectionTitle>
      <Card>
        <RankBars data={topModels} valueFormatter={modelFormatter} />
      </Card>

      <SectionTitle>Цвета коллекции</SectionTitle>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-3 text-sm font-medium text-[var(--color-ok)]">
            <span aria-hidden="true">↑</span> Лидеры — просят увеличения
          </div>
          <RankBars
            data={bestColors.map((c) => ({
              label: c.color,
              value: c.units,
              hint: `остаток ${formatUnits(c.stock)} шт`,
            }))}
            valueFormatter={(n) => `${formatUnits(n)} шт`}
          />
        </Card>
        <Card>
          <div className="mb-3 text-sm font-medium text-[var(--color-critical)]">
            <span aria-hidden="true">↓</span> Хвост — кандидаты на сокращение
          </div>
          {worstColors.length === 0 ? (
            <p className="m-0 text-sm text-[var(--color-faint)]">
              В коллекции слишком мало цветов, чтобы делить их на лидеров и
              хвост.
            </p>
          ) : (
            <RankBars
              data={worstColors.map((c) => ({
                label: c.color,
                value: c.units,
                hint: `остаток ${formatUnits(c.stock)} шт`,
              }))}
              valueFormatter={(n) => `${formatUnits(n)} шт`}
              max={colorScale}
            />
          )}
        </Card>
      </div>

      <SectionTitle>Запас в месяцах по вариантам</SectionTitle>
      {coverageRows.length === 0 ? (
        <EmptyState
          title="Ни остатков, ни продаж"
          hint="У вариантов этой коллекции нет ни остатка на складах, ни продаж за период."
        />
      ) : (
        <Card padded={false}>
          <Table>
            <thead>
              <tr>
                <Th>Модель, цвет, размер</Th>
                <Th>SKU</Th>
                <Th align="right">Остаток</Th>
                <Th align="right">Шт/мес</Th>
                <Th>Хватит на</Th>
              </tr>
            </thead>
            <tbody>
              {coverageRows.map((row) => (
                <tr key={row.variantId}>
                  <Td>{variantLabel(row)}</Td>
                  <Td>
                    <span className="text-xs text-[var(--color-faint)]">
                      {row.sku}
                    </span>
                  </Td>
                  <Td align="right">{formatUnits(row.stockQty)}</Td>
                  <Td align="right">{row.perMonth}</Td>
                  <Td>
                    <CoverageBar months={row.monthsOfCover} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <SectionTitle>Остаток по складам</SectionTitle>
      {warehouseRows.length === 0 ? (
        <EmptyState
          title="Остатков нет"
          hint="Остатки приходят из Ainur вместе с товарами. Запустите синхронизацию на странице «Синхронизация с Ainur»."
        />
      ) : (
        <Card padded={false}>
          <Table>
            <thead>
              <tr>
                <Th>Склад</Th>
                <Th align="right">Штук</Th>
                <Th align="right">Доля</Th>
              </tr>
            </thead>
            <tbody>
              {warehouseRows.map((row) => {
                const qty = Number(row.quantity);
                const share = stockTotal > 0 ? (qty / stockTotal) * 100 : 0;
                return (
                  <tr key={row.warehouseId}>
                    <Td>{row.warehouseName}</Td>
                    <Td align="right">{formatUnits(qty)}</Td>
                    <Td align="right">{Math.round(share)}%</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      )}

      <SectionTitle>Динамика остатка</SectionTitle>
      <Card>
        {snapshots.length < 2 ? (
          <p className="m-0 text-sm text-[var(--color-muted)]">
            Снимков остатка пока меньше двух — строить линию не из чего. Снимок
            складывается при каждой синхронизации товаров с Ainur, так что
            график появится сам через несколько обновлений.
          </p>
        ) : (
          <LineChart
            series={stockSeries}
            label="Остаток коллекции на складах по снимкам"
            valueFormatter={(n) => formatUnits(n)}
          />
        )}
      </Card>
    </>
  );
}
