import { redirect } from "next/navigation";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { canSeeMoney, getCurrentUser } from "@/lib/auth";
import {
  formatThb,
  getVelocity,
  round1,
  suggestTransfers,
  type VelocityRow,
} from "@/lib/production";
import {
  Card,
  EmptyState,
  LinkButton,
  Money,
  PageHeader,
  SectionTitle,
  Stat,
  StatusPill,
  Table,
  Td,
  Th,
} from "@/components/ui";
import {
  CoverageBar,
  LineChart,
  RankBars,
  foldToTop,
  type LineSeries,
} from "@/components/charts";
import {
  WINDOW_OPTIONS,
  formatUnits,
  isoDaysAgo,
  lastMonths,
  parseWindow,
} from "./_shared";
import { YearOverYear, parseYear, salesYears } from "./_year";

export const metadata = { title: "Аналитика — Luna Production" };

/** сколько строк показываем в каждой группе запаса, чтобы страница не разрослась */
const COVERAGE_LIMIT = 80;

interface CollectionMonths {
  name: string;
  value: number;
  byMonth: number[];
}

function variantLabel(row: VelocityRow): string {
  return [row.productName, row.color, row.size].filter(Boolean).join(" · ");
}

/** Рост или падение: цвет + стрелка + словами — не только цветом */
function ChangeCell({ before, after }: { before: number; after: number }) {
  if (before === 0 && after === 0) {
    return <span className="text-[var(--color-faint)]">продаж не было</span>;
  }
  if (before === 0) {
    return (
      <span className="font-medium text-[var(--color-ok)]">
        <span aria-hidden="true">↑</span> новые продажи
      </span>
    );
  }
  if (after === 0) {
    return (
      <span className="font-medium text-[var(--color-critical)]">
        <span aria-hidden="true">↓</span> продажи прекратились
      </span>
    );
  }
  const pct = round1(((after - before) / before) * 100);
  if (Math.abs(pct) < 1) {
    return (
      <span className="text-[var(--color-muted)]">
        <span aria-hidden="true">→</span> без изменений
      </span>
    );
  }
  const up = pct > 0;
  return (
    <span
      className="font-medium"
      style={{
        color: up ? "var(--color-ok)" : "var(--color-critical)",
      }}
    >
      <span aria-hidden="true">{up ? "↑" : "↓"}</span>{" "}
      {up ? "рост" : "падение"} {Math.abs(pct)}%
    </span>
  );
}

/** Продажи по коллекциям за период: ключ — id коллекции */
async function unitsByCollection(
  from: string,
  toExclusive?: string,
): Promise<Map<string, { name: string; units: number }>> {
  const rows = await db
    .select({
      collectionId: schema.collections.id,
      name: schema.collections.name,
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
    .innerJoin(
      schema.collections,
      eq(schema.products.collectionId, schema.collections.id),
    )
    .where(
      toExclusive
        ? and(
            gte(schema.variantSalesDaily.day, from),
            lt(schema.variantSalesDaily.day, toExclusive),
          )
        : gte(schema.variantSalesDaily.day, from),
    )
    .groupBy(schema.collections.id, schema.collections.name);

  return new Map(
    rows.map((r) => [r.collectionId, { name: r.name, units: Number(r.units) }]),
  );
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; year?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const showMoney = canSeeMoney(user);

  const params = await searchParams;
  const days = parseWindow(params.days);
  const since = isoDaysAgo(days);
  const prevSince = isoDaysAgo(days * 2);

  const years = await salesYears();
  const year = parseYear(params.year, years);

  const velocity = await getVelocity(days);
  const transfers = await suggestTransfers(days, 3);
  const months = lastMonths(6);

  // ---------- KPI ----------
  const unitsSold = velocity.reduce((s, r) => s + r.unitsSold, 0);
  const revenue = velocity.reduce((s, r) => s + r.revenue, 0);
  const skuSelling = velocity.filter((r) => r.unitsSold > 0).length;
  const skuSilent = velocity.filter((r) => r.unitsSold === 0).length;

  // ---------- Продажи по коллекциям по месяцам ----------
  const monthRows = await db
    .select({
      collectionId: schema.collections.id,
      collectionName: schema.collections.name,
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
    .innerJoin(
      schema.collections,
      eq(schema.products.collectionId, schema.collections.id),
    )
    .where(gte(schema.variantSalesDaily.day, `${months[0].key}-01`))
    .groupBy(
      schema.collections.id,
      schema.collections.name,
      sql`substr(${schema.variantSalesDaily.day}, 1, 7)`,
    );

  const monthIndex = new Map(months.map((m, i) => [m.key, i]));
  const byCollection = new Map<string, CollectionMonths>();
  for (const row of monthRows) {
    const i = monthIndex.get(row.month);
    if (i === undefined) continue;
    const entry =
      byCollection.get(row.collectionId) ??
      ({
        name: row.collectionName,
        value: 0,
        byMonth: months.map(() => 0),
      } satisfies CollectionMonths);
    entry.byMonth[i] += Number(row.units);
    entry.value += Number(row.units);
    byCollection.set(row.collectionId, entry);
  }

  const collectionsSorted = [...byCollection.values()].sort(
    (a, b) => b.value - a.value,
  );
  // палитра рассчитана на 8 рядов — остальное сворачиваем в «Прочее»
  const foldedCollections = foldToTop(collectionsSorted, 6, (sum) => {
    const rest = collectionsSorted.slice(6);
    return {
      name: "Прочее",
      value: sum,
      byMonth: months.map((_, i) =>
        rest.reduce((s, r) => s + r.byMonth[i], 0),
      ),
    };
  });
  const collectionSeries: LineSeries[] = foldedCollections.map((c) => ({
    name: c.name,
    points: months.map((m, i) => ({ label: m.label, value: c.byMonth[i] })),
  }));

  // ---------- Рост и падение коллекций ----------
  const currentByCollection = await unitsByCollection(since);
  const previousByCollection = await unitsByCollection(prevSince, since);

  const growthRows = [
    ...new Set([...currentByCollection.keys(), ...previousByCollection.keys()]),
  ]
    .map((id) => {
      const now = currentByCollection.get(id);
      const before = previousByCollection.get(id);
      return {
        id,
        name: now?.name ?? before?.name ?? "без коллекции",
        before: before?.units ?? 0,
        after: now?.units ?? 0,
      };
    })
    .sort((a, b) => {
      // сначала самый заметный рост, в конце — самое сильное падение.
      // «было 0, стало что-то» — это рост без базы, поднимаем наверх
      const rate = (r: { before: number; after: number }) =>
        r.before === 0 ? (r.after > 0 ? 1_000_000 + r.after : -1) : r.after / r.before;
      return rate(b) - rate(a);
    });

  // ---------- Модели ----------
  const modelAgg = new Map<
    string,
    { name: string; collectionName: string; units: number; revenue: number; stock: number }
  >();
  for (const row of velocity) {
    const entry = modelAgg.get(row.productId) ?? {
      name: row.productName,
      collectionName: row.collectionName,
      units: 0,
      revenue: 0,
      stock: 0,
    };
    entry.units += row.unitsSold;
    entry.revenue += row.revenue;
    entry.stock += row.stockQty;
    modelAgg.set(row.productId, entry);
  }
  const models = [...modelAgg.values()];
  const modelValue = (m: { units: number; revenue: number }) =>
    showMoney ? m.revenue : m.units;
  const modelFormatter = showMoney ? formatThb : (n: number) => `${formatUnits(n)} шт`;

  const topModels = [...models]
    .sort((a, b) => modelValue(b) - modelValue(a))
    .slice(0, 10)
    .map((m) => ({
      label: m.name,
      value: modelValue(m),
      hint: `${m.collectionName} · продано ${formatUnits(m.units)} шт · остаток ${formatUnits(m.stock)} шт`,
    }));

  // худшие считаем только среди того, что лежит на складе:
  // модель без остатка и без продаж — просто снятая с производства
  const worstModels = models
    .filter((m) => m.stock > 0)
    .sort((a, b) => modelValue(a) - modelValue(b))
    .slice(0, 10)
    .map((m) => ({
      label: m.name,
      value: modelValue(m),
      hint: `${m.collectionName} · продано ${formatUnits(m.units)} шт · остаток ${formatUnits(m.stock)} шт`,
    }));

  // ---------- Цвета внутри коллекций ----------
  const colorAgg = new Map<
    string,
    {
      collectionId: string;
      collectionName: string;
      color: string;
      units: number;
      stock: number;
    }
  >();
  for (const row of velocity) {
    const color = row.color?.trim() || "цвет не указан";
    const key = `${row.collectionId}|${color}`;
    const entry = colorAgg.get(key) ?? {
      collectionId: row.collectionId,
      collectionName: row.collectionName,
      color,
      units: 0,
      stock: 0,
    };
    entry.units += row.unitsSold;
    entry.stock += row.stockQty;
    colorAgg.set(key, entry);
  }
  const colorsByCollection = new Map<
    string,
    { name: string; colors: { color: string; units: number; stock: number }[] }
  >();
  for (const entry of colorAgg.values()) {
    const group =
      colorsByCollection.get(entry.collectionId) ??
      { name: entry.collectionName, colors: [] };
    group.colors.push({
      color: entry.color,
      units: entry.units,
      stock: entry.stock,
    });
    colorsByCollection.set(entry.collectionId, group);
  }
  const colorBlocks = [...colorsByCollection.entries()]
    .map(([id, group]) => ({
      id,
      name: group.name,
      colors: [...group.colors].sort((a, b) => b.units - a.units),
      total: group.colors.reduce((s, c) => s + c.units, 0),
    }))
    .filter((block) => block.colors.length >= 2)
    .sort((a, b) => b.total - a.total);

  // ---------- Запас в месяцах ----------
  const coverageRows = velocity
    .filter((r) => r.stockQty > 0 || r.unitsSold > 0)
    .sort((a, b) => {
      const av = a.monthsOfCover ?? Infinity;
      const bv = b.monthsOfCover ?? Infinity;
      return av - bv;
    });
  const ending = coverageRows.filter(
    (r) => r.monthsOfCover !== null && r.monthsOfCover < 2,
  );
  const normal = coverageRows.filter(
    (r) => r.monthsOfCover !== null && r.monthsOfCover >= 2 && r.monthsOfCover <= 6,
  );
  // «продаж нет, а остаток лежит» — это тоже избыток, только самый тяжёлый
  const excess = coverageRows.filter(
    (r) => r.monthsOfCover === null || r.monthsOfCover > 6,
  );

  return (
    <>
      <PageHeader
        title="Аналитика"
        subtitle={`Окно расчёта — последние ${days} дней. Сравнение идёт с предыдущими ${days} днями.`}
      />

      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-[var(--color-muted)]">
            Считать продажи за:
          </span>
          {WINDOW_OPTIONS.map((option) => (
            <LinkButton
              key={option}
              /* year тащим с собой — иначе смена окна сбрасывает выбранный год */
              href={`/analytics?days=${option}&year=${year}`}
              variant={option === days ? "primary" : "secondary"}
            >
              {option} дней
            </LinkButton>
          ))}
        </div>
      </Card>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Продано за период"
          value={`${formatUnits(unitsSold)} шт`}
          sub={`по активным SKU за ${days} дней`}
        />
        <Stat
          label="Выручка за период"
          value={<Money value={revenue} hidden={!showMoney} />}
          sub={showMoney ? "по данным Ainur" : "суммы видны только владельцам"}
        />
        <Stat
          label="SKU продаются"
          value={formatUnits(skuSelling)}
          sub="хотя бы одна продажа за период"
        />
        <Stat
          label="SKU без продаж"
          value={formatUnits(skuSilent)}
          sub="ни одной продажи за период"
        />
      </div>

      {/*
        Блок «Год к году» — календарные годы и сравнение с предыдущим.
        Стоит выше скользящих 6 месяцев: сравнение годов отвечает на вопрос
        «что растёт, а что мы уже не производим», а скользящее окно — на
        вопрос «что отшивать сейчас».
      */}
      {years.length > 0 ? (
        <YearOverYear
          year={year}
          years={years}
          showMoney={showMoney}
          days={days}
        />
      ) : null}

      <SectionTitle>Продажи по коллекциям — 6 месяцев</SectionTitle>
      <Card>
        <LineChart
          series={collectionSeries}
          label="Штук продано по месяцам"
          valueFormatter={(n) => formatUnits(n)}
        />
      </Card>

      <SectionTitle>Рост и падение коллекций</SectionTitle>
      {growthRows.length === 0 ? (
        <EmptyState
          title="Сравнивать пока нечего"
          hint="За выбранный период и за предыдущий такой же период продаж нет. Синхронизируйте продажи с Ainur."
        />
      ) : (
        <Card padded={false}>
          <Table>
            <thead>
              <tr>
                <Th>Коллекция</Th>
                <Th align="right">Было, шт</Th>
                <Th align="right">Стало, шт</Th>
                <Th>Изменение</Th>
              </tr>
            </thead>
            <tbody>
              {growthRows.map((row) => (
                <tr key={row.id}>
                  <Td>
                    <a
                      href={`/analytics/collections/${row.id}`}
                      className="text-[var(--color-ocean)]"
                    >
                      {row.name}
                    </a>
                  </Td>
                  <Td align="right">{formatUnits(row.before)}</Td>
                  <Td align="right">{formatUnits(row.after)}</Td>
                  <Td>
                    <ChangeCell before={row.before} after={row.after} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <SectionTitle>
        Лучшие и худшие модели {showMoney ? "по выручке" : "по количеству"}
      </SectionTitle>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-3 text-sm font-medium text-[var(--color-ocean)]">
            <span aria-hidden="true">↑</span> Топ-10 — продаются лучше всех
          </div>
          <RankBars data={topModels} valueFormatter={modelFormatter} />
        </Card>
        <Card>
          <div className="mb-3 text-sm font-medium text-[var(--color-ocean)]">
            <span aria-hidden="true">↓</span> Худшие 10 — из тех, что лежат на
            складе
          </div>
          <RankBars data={worstModels} valueFormatter={modelFormatter} />
        </Card>
      </div>

      <SectionTitle>Цвета: что увеличить, что сократить</SectionTitle>
      {colorBlocks.length === 0 ? (
        <EmptyState
          title="Данных по цветам пока нет"
          hint="Цвет берётся из вариантов SKU. Как только появятся продажи по цветным вариантам — здесь будет разбор по каждой коллекции."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {colorBlocks.map((block) => {
            const leaders = block.colors.slice(0, 4);
            // хвост не должен пересекаться с лидерами — иначе один цвет в двух списках
            const tail = block.colors
              .slice(Math.max(4, block.colors.length - 4))
              .reverse();
            const scale = Math.max(1, leaders[0]?.units ?? 1);
            return (
              <Card key={block.id}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <a
                    href={`/analytics/collections/${block.id}`}
                    className="font-semibold text-[var(--color-ocean)]"
                  >
                    {block.name}
                  </a>
                  <span className="text-xs text-[var(--color-muted)]">
                    продано {formatUnits(block.total)} шт · цветов{" "}
                    {block.colors.length}
                  </span>
                </div>

                <div className="mt-3 text-xs font-medium text-[var(--color-ok)]">
                  <span aria-hidden="true">↑</span> Лидеры — просят увеличения
                </div>
                <div className="mt-2">
                  <RankBars
                    data={leaders.map((c) => ({
                      label: c.color,
                      value: c.units,
                      hint: `остаток ${formatUnits(c.stock)} шт`,
                    }))}
                    valueFormatter={(n) => `${formatUnits(n)} шт`}
                  />
                </div>

                {tail.length === 0 ? null : (
                  <>
                    <div className="mt-4 text-xs font-medium text-[var(--color-critical)]">
                      <span aria-hidden="true">↓</span> Хвост — кандидаты на
                      сокращение
                    </div>
                    <div className="mt-2">
                      <RankBars
                        data={tail.map((c) => ({
                          label: c.color,
                          value: c.units,
                          hint: `остаток ${formatUnits(c.stock)} шт`,
                        }))}
                        valueFormatter={(n) => `${formatUnits(n)} шт`}
                        max={scale}
                      />
                    </div>
                  </>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <SectionTitle>На сколько месяцев хватит запаса</SectionTitle>
      <div className="flex flex-col gap-5">
        <CoverageGroup
          title="Заканчивается — меньше 2 месяцев"
          hint="Это первые кандидаты в заказ на пошив."
          tone="critical"
          rows={ending}
        />
        <CoverageGroup
          title="Норма — 2–6 месяцев"
          hint="Запас в рабочем коридоре, вмешиваться не нужно."
          tone="ok"
          rows={normal}
        />
        <CoverageGroup
          title="Избыток — больше 6 месяцев, кандидаты на скидки и акции"
          hint="Деньги стоят на складе. Сюда же попадают SKU, у которых остаток есть, а продаж за период нет вовсе."
          tone="warn"
          rows={excess}
        />
      </div>

      <SectionTitle>Рекомендации по перемещению между складами</SectionTitle>
      {transfers.length === 0 ? (
        <EmptyState
          title="Перемещать пока нечего"
          hint="Luna предлагает перемещение, когда на одном складе товар лежит больше 6 месяцев запаса, а на другом того же SKU остаётся меньше чем на 2 месяца. Сейчас таких пар нет."
        />
      ) : (
        <Card padded={false}>
          <Table>
            <thead>
              <tr>
                <Th align="right">Штук</Th>
                <Th>Что</Th>
                <Th>Откуда → куда</Th>
                <Th>Почему</Th>
              </tr>
            </thead>
            <tbody>
              {transfers.map((t) => (
                <tr key={`${t.variantId}-${t.fromWarehouseId}-${t.toWarehouseId}`}>
                  <Td align="right">
                    <span className="font-semibold">{t.quantity}</span>
                  </Td>
                  <Td>
                    <div>{t.label}</div>
                    <div className="text-xs text-[var(--color-faint)]">{t.sku}</div>
                  </Td>
                  <Td>
                    {t.fromWarehouseName} <span aria-hidden="true">→</span>{" "}
                    {t.toWarehouseName}
                  </Td>
                  <Td>
                    <span className="text-sm text-[var(--color-muted)]">
                      {t.reason}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}

function CoverageGroup({
  title,
  hint,
  tone,
  rows,
}: {
  title: string;
  hint: string;
  tone: "ok" | "warn" | "critical";
  rows: VelocityRow[];
}) {
  const shown = rows.slice(0, COVERAGE_LIMIT);

  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-center justify-between gap-2 p-4 sm:p-5">
        <div>
          <div className="flex items-center gap-2">
            <StatusPill tone={tone}>{formatUnits(rows.length)} SKU</StatusPill>
            <span className="font-semibold text-[var(--color-ocean)]">{title}</span>
          </div>
          <p className="mt-1.5 mb-0 text-sm text-[var(--color-muted)]">{hint}</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="m-0 px-4 pb-4 text-sm text-[var(--color-faint)] sm:px-5">
          Здесь пока пусто.
        </p>
      ) : (
        <>
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
              {shown.map((row) => (
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
          {rows.length > shown.length ? (
            <p className="m-0 px-4 py-3 text-xs text-[var(--color-muted)] sm:px-5">
              Показаны первые {shown.length} из {formatUnits(rows.length)} —
              список отсортирован от того, что заканчивается раньше всех.
            </p>
          ) : null}
        </>
      )}
    </Card>
  );
}
