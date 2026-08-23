/**
 * Год к году: переключатель года и сравнение с предыдущим.
 *
 * Зачем отдельно от основной аналитики: там окно скользящее (30/90/180 дней)
 * — оно нужно для скорости продаж и рекомендаций, что отшить. А здесь
 * календарные годы: какие коллекции росли, какие мы перестали производить.
 * Данные приходят из variant_sales_daily, историю с 2024 года догружает
 * scripts/backfill-sales.ts.
 *
 * Сравнение всегда «как с как»: если выбран текущий год, у прошлого берём
 * ровно столько же месяцев, иначе август против полного декабря выглядел бы
 * провалом.
 */
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import {
  Card,
  Money,
  SectionTitle,
  Stat,
  Table,
  Td,
  Th,
} from "@/components/ui";
import { LineChart, type LineSeries } from "@/components/charts";
import { formatUnits } from "./_shared";

const MONTHS_RU = [
  "янв", "фев", "мар", "апр", "май", "июн",
  "июл", "авг", "сен", "окт", "ноя", "дек",
];

/** Годы, за которые в базе есть хоть одна продажа, по возрастанию */
export async function salesYears(): Promise<string[]> {
  const rows = await db
    .select({ year: sql<string>`substr(${schema.variantSalesDaily.day}, 1, 4)` })
    .from(schema.variantSalesDaily)
    .groupBy(sql`substr(${schema.variantSalesDaily.day}, 1, 4)`);
  return rows
    .map((r) => String(r.year))
    .filter((y) => /^\d{4}$/.test(y))
    .sort();
}

/** Год из адреса страницы; если его нет или он не из списка — последний доступный */
export function parseYear(raw: string | undefined, years: string[]): string {
  if (raw && years.includes(raw)) return raw;
  return years[years.length - 1] ?? String(new Date().getUTCFullYear());
}

interface MonthAgg {
  units: number;
  revenue: number;
}

/** Продажи по месяцам одного года: массив из 12 элементов, индекс = месяц-1 */
async function monthsOfYear(year: string): Promise<MonthAgg[]> {
  const rows = await db
    .select({
      month: sql<string>`substr(${schema.variantSalesDaily.day}, 6, 2)`,
      units: sql<number>`COALESCE(SUM(${schema.variantSalesDaily.units}), 0)`,
      revenue: sql<number>`COALESCE(SUM(${schema.variantSalesDaily.revenue}), 0)`,
    })
    .from(schema.variantSalesDaily)
    .where(
      and(
        gte(schema.variantSalesDaily.day, `${year}-01-01`),
        lt(schema.variantSalesDaily.day, `${Number(year) + 1}-01-01`),
      ),
    )
    .groupBy(sql`substr(${schema.variantSalesDaily.day}, 6, 2)`);

  const out: MonthAgg[] = Array.from({ length: 12 }, () => ({
    units: 0,
    revenue: 0,
  }));
  for (const r of rows) {
    const i = Number(r.month) - 1;
    if (i < 0 || i > 11) continue;
    out[i] = { units: Number(r.units), revenue: Number(r.revenue) };
  }
  return out;
}

/** Продажи по коллекциям за год, ограниченные первыми `throughMonth` месяцами */
async function collectionsOfYear(
  year: string,
  throughMonth: number,
): Promise<Map<string, { name: string; units: number; revenue: number }>> {
  const to =
    throughMonth >= 12
      ? `${Number(year) + 1}-01-01`
      : `${year}-${String(throughMonth + 1).padStart(2, "0")}-01`;

  const rows = await db
    .select({
      id: schema.collections.id,
      name: schema.collections.name,
      units: sql<number>`COALESCE(SUM(${schema.variantSalesDaily.units}), 0)`,
      revenue: sql<number>`COALESCE(SUM(${schema.variantSalesDaily.revenue}), 0)`,
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
      and(gte(schema.variantSalesDaily.day, `${year}-01-01`), lt(schema.variantSalesDaily.day, to)),
    )
    .groupBy(schema.collections.id, schema.collections.name);

  return new Map(
    rows.map((r) => [
      r.id,
      { name: r.name, units: Number(r.units), revenue: Number(r.revenue) },
    ]),
  );
}

function pct(before: number, after: number): string {
  if (before === 0 && after === 0) return "—";
  if (before === 0) return "новые продажи";
  if (after === 0) return "прекратились";
  const p = Math.round(((after - before) / before) * 100);
  return `${p > 0 ? "+" : ""}${p}%`;
}

function Delta({ before, after }: { before: number; after: number }) {
  const text = pct(before, after);
  if (text === "—") {
    return <span className="text-[var(--color-faint)]">нет данных</span>;
  }
  const up = after > before;
  const tone = up ? "var(--color-ok)" : "var(--color-critical)";
  return (
    <span className="font-medium" style={{ color: tone }}>
      <span aria-hidden="true">{up ? "↑" : "↓"}</span> {text}
    </span>
  );
}

export async function YearOverYear({
  year,
  years,
  showMoney,
  days,
}: {
  year: string;
  years: string[];
  showMoney: boolean;
  days: number;
}) {
  const prev = String(Number(year) - 1);
  const nowYear = String(new Date().getUTCFullYear());
  const isCurrent = year === nowYear;
  /** до какого месяца сравниваем — у текущего года только закрытая часть */
  const throughMonth = isCurrent ? new Date().getUTCMonth() + 1 : 12;

  const [cur, before] = await Promise.all([
    monthsOfYear(year),
    monthsOfYear(prev),
  ]);
  const [curCols, prevCols] = await Promise.all([
    collectionsOfYear(year, throughMonth),
    collectionsOfYear(prev, throughMonth),
  ]);

  const sum = (a: MonthAgg[], key: "units" | "revenue") =>
    a.slice(0, throughMonth).reduce((s, m) => s + m[key], 0);

  const curUnits = sum(cur, "units");
  const prevUnits = sum(before, "units");
  const curRevenue = sum(cur, "revenue");
  const prevRevenue = sum(before, "revenue");
  const hasPrev = before.some((m) => m.units !== 0);

  const labels = MONTHS_RU.slice(0, isCurrent ? throughMonth : 12);
  const series: LineSeries[] = [
    {
      name: `${year}`,
      points: labels.map((l, i) => ({ label: l, value: cur[i]?.units ?? 0 })),
    },
  ];
  if (hasPrev) {
    series.push({
      name: `${prev}`,
      points: labels.map((l, i) => ({ label: l, value: before[i]?.units ?? 0 })),
    });
  }

  const rows = [...new Set([...curCols.keys(), ...prevCols.keys()])]
    .map((id) => {
      const a = prevCols.get(id);
      const b = curCols.get(id);
      return {
        id,
        name: b?.name ?? a?.name ?? "без коллекции",
        beforeUnits: a?.units ?? 0,
        afterUnits: b?.units ?? 0,
        beforeRevenue: a?.revenue ?? 0,
        afterRevenue: b?.revenue ?? 0,
      };
    })
    .sort((x, y) => y.afterUnits - x.afterUnits);

  const stopped = rows.filter((r) => r.beforeUnits > 0 && r.afterUnits === 0);

  return (
    <>
      <SectionTitle>Год к году</SectionTitle>

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-[var(--color-muted)]">Год:</span>
          {years.map((y) => {
            const current = y === year;
            return (
              <a
                key={y}
                href={`/analytics?days=${days}&year=${y}`}
                aria-current={current ? "page" : undefined}
                className={
                  "touch inline-flex items-center rounded-lg border px-4 py-2.5 text-sm font-medium " +
                  "transition-transform duration-100 active:scale-[0.97] " +
                  (current
                    ? "border-[var(--color-gold)] bg-[var(--color-gold)] text-white"
                    : "border-[var(--color-line)] bg-white text-[var(--color-ocean)]")
                }
              >
                {y}
              </a>
            );
          })}
        </div>
        <p className="mt-3 text-sm text-[var(--color-muted)]">
          {isCurrent
            ? `${year} год ещё не закончился, поэтому с ${prev} сравниваем ровно тот же отрезок — январь–${MONTHS_RU[throughMonth - 1]}.`
            : `Полный ${year} год против полного ${prev}.`}
          {" "}
          Учтены только продажи с SKU из каталога EVA MOON.
        </p>
      </Card>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label={`Продано, ${year}`}
          value={`${formatUnits(curUnits)} шт`}
          sub={hasPrev ? `${formatUnits(prevUnits)} шт в ${prev}` : `данных за ${prev} нет`}
        />
        <Stat
          label="Изменение по штукам"
          value={<Delta before={prevUnits} after={curUnits} />}
          sub={hasPrev ? `${prev} → ${year}` : undefined}
        />
        {showMoney ? (
          <>
            <Stat
              label={`Выручка, ${year}`}
              value={<Money value={curRevenue} hidden={false} />}
              sub={hasPrev ? `${formatThbShort(prevRevenue)} в ${prev}` : undefined}
            />
            <Stat
              label="Изменение по выручке"
              value={<Delta before={prevRevenue} after={curRevenue} />}
              sub={hasPrev ? `${prev} → ${year}` : undefined}
            />
          </>
        ) : null}
      </div>

      <Card className="mb-6">
        <LineChart
          series={series}
          label={
            hasPrev
              ? `Штук продано по месяцам: ${year} и ${prev}`
              : `Штук продано по месяцам, ${year}`
          }
          valueFormatter={(n) => formatUnits(n)}
        />
      </Card>

      <SectionTitle>Коллекции: {year} против {prev}</SectionTitle>
      <Card padded={false} className="mb-6">
        <Table>
          <thead>
            <tr>
              <Th>Коллекция</Th>
              <Th>{prev}, шт</Th>
              <Th>{year}, шт</Th>
              <Th>Изменение</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td>
                  <span className="font-medium">{r.name}</span>
                </Td>
                <Td>
                  <span className="tnum">{formatUnits(r.beforeUnits)}</span>
                </Td>
                <Td>
                  <span className="tnum">{formatUnits(r.afterUnits)}</span>
                </Td>
                <Td>
                  <Delta before={r.beforeUnits} after={r.afterUnits} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {stopped.length > 0 ? (
        <Card className="mb-6">
          <p className="text-sm">
            <span className="font-medium text-[var(--color-ocean)]">
              Перестали продаваться в {year}:
            </span>{" "}
            {stopped.map((r) => `${r.name} (${formatUnits(r.beforeUnits)} шт в ${prev})`).join(", ")}.
            {" "}
            Проверьте, сняты ли они с производства — или просто закончились остатки.
          </p>
        </Card>
      ) : null}
    </>
  );
}

function formatThbShort(n: number): string {
  return `${Math.round(n).toLocaleString("ru-RU").replace(/,/g, " ")} THB`;
}
