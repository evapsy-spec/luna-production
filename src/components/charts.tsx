/**
 * Графики — собственные SVG, без внешних библиотек.
 *
 * ВАЖНО про цвет: брендовые Deep Ocean и Gold Moon как цвета данных
 * не различимы между собой и не проходят проверку на дальтонизм.
 * Поэтому:
 *  - один ряд  → Gold Moon (это акцент бренда, здесь он уместен),
 *  - несколько рядов → палитра --series-1..8, назначается строго по порядку,
 *    никогда по кругу; при 9+ рядах лишние сворачиваются в «Прочее».
 *  - легенда есть всегда при 2+ рядах, плюс прямые подписи там, где влезают,
 *    чтобы принадлежность читалась не только по цвету.
 */
import type { ReactNode } from "react";

const SERIES = [
  "var(--color-series-1)",
  "var(--color-series-2)",
  "var(--color-series-3)",
  "var(--color-series-4)",
  "var(--color-series-5)",
  "var(--color-series-6)",
  "var(--color-series-7)",
  "var(--color-series-8)",
];
const GOLD = "var(--color-gold)";
/** Диаметр точки на линейном графике, px. Минимум по гайдлайну — 8. */
const MARKER = 9;

const GRID = "var(--color-grid)";
const AXIS = "var(--color-axis)";
const MUTED = "var(--color-muted)";

export function seriesColor(index: number): string {
  return SERIES[index] ?? "var(--color-faint)";
}

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

function fmtShort(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}М`;
  if (Math.abs(n) >= 1_000) return `${Math.round(n / 1000)}т`;
  return String(Math.round(n));
}

// ============================================================
// Столбчатый график — один ряд, акцент Gold Moon
// ============================================================

export function BarChart({
  data,
  height = 200,
  valueFormatter = fmtShort,
  label,
}: {
  data: { label: string; value: number }[];
  height?: number;
  valueFormatter?: (n: number) => string;
  label?: string;
}) {
  if (data.length === 0) return <NoData />;

  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  const barW = 100 / data.length;

  return (
    <figure className="m-0">
      {label ? (
        <figcaption className="mb-2 text-sm font-medium text-[var(--color-ocean)]">
          {label}
        </figcaption>
      ) : null}
      <div className="relative" style={{ height }}>
        {/* сетка */}
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
          aria-hidden="true"
        >
          {[0, 25, 50, 75, 100].map((y) => (
            <line
              key={y}
              x1="0"
              x2="100"
              y1={y}
              y2={y}
              stroke={GRID}
              strokeWidth="0.4"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {data.map((d, i) => {
            const h = max > 0 ? (d.value / max) * 100 : 0;
            const w = barW * 0.62;
            const x = i * barW + (barW - w) / 2;
            return (
              <rect
                key={i}
                x={x}
                y={100 - h}
                width={w}
                height={Math.max(h, d.value > 0 ? 0.8 : 0)}
                fill={GOLD}
                rx="0.8"
              />
            );
          })}
        </svg>
        {/* значения над столбцами — прямая подпись вместо чтения по цвету */}
        <div className="absolute inset-0 flex items-end">
          {data.map((d, i) => (
            <div key={i} className="flex-1 text-center">
              <div
                className="tnum text-[10px] font-semibold text-[var(--color-ocean)]"
                style={{
                  marginBottom: `${max > 0 ? (d.value / max) * 100 : 0}%`,
                }}
              >
                {d.value > 0 ? valueFormatter(d.value) : ""}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-1 flex border-t" style={{ borderColor: AXIS }}>
        {data.map((d, i) => (
          <div
            key={i}
            className="flex-1 truncate pt-1 text-center text-[10px] text-[var(--color-muted)]"
            title={d.label}
          >
            {d.label}
          </div>
        ))}
      </div>
    </figure>
  );
}

// ============================================================
// Линейный график — 1..N рядов
// ============================================================

export interface LineSeries {
  name: string;
  points: { label: string; value: number }[];
}

export function LineChart({
  series,
  height = 220,
  label,
  valueFormatter = fmtShort,
}: {
  series: LineSeries[];
  height?: number;
  label?: string;
  valueFormatter?: (n: number) => string;
}) {
  const nonEmpty = series.filter((s) => s.points.length > 0);
  if (nonEmpty.length === 0) return <NoData />;

  const labels = nonEmpty[0].points.map((p) => p.label);
  const max = niceMax(
    Math.max(...nonEmpty.flatMap((s) => s.points.map((p) => p.value)), 0),
  );
  const single = nonEmpty.length === 1;

  const xFor = (i: number, count: number) =>
    count <= 1 ? 50 : (i / (count - 1)) * 100;

  return (
    <figure className="m-0">
      {label ? (
        <figcaption className="mb-2 text-sm font-medium text-[var(--color-ocean)]">
          {label}
        </figcaption>
      ) : null}

      <div className="flex gap-2">
        {/* ось значений */}
        <div
          className="flex w-10 shrink-0 flex-col justify-between text-right text-[10px] text-[var(--color-muted)]"
          style={{ height }}
        >
          <span>{valueFormatter(max)}</span>
          <span>{valueFormatter(max / 2)}</span>
          <span>0</span>
        </div>

        <div className="relative flex-1" style={{ height }}>
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="h-full w-full"
          >
            {[0, 50, 100].map((y) => (
              <line
                key={y}
                x1="0"
                x2="100"
                y1={y}
                y2={y}
                stroke={GRID}
                strokeWidth="0.4"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {nonEmpty.map((s, si) => {
              const color = single ? GOLD : seriesColor(si);
              const d = s.points
                .map((p, i) => {
                  const x = xFor(i, s.points.length);
                  const y = 100 - (max > 0 ? (p.value / max) * 100 : 0);
                  return `${i === 0 ? "M" : "L"}${x},${y}`;
                })
                .join(" ");
              return (
                <g key={s.name}>
                  <path
                    d={d}
                    fill="none"
                    stroke={color}
                    strokeWidth="2"
                    vectorEffect="non-scaling-stroke"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                </g>
              );
            })}
          </svg>

          {/*
            Точки рисуем HTML-элементами поверх графика, а не внутри SVG.
            У этого SVG preserveAspectRatio="none" — по X масштаб примерно
            в пять раз больше, чем по Y, поэтому любой <circle> внутри
            превращается в растянутый блин. Линии это не портит, у них
            vectorEffect="non-scaling-stroke", а вот кружкам нужен обычный
            слой вне SVG, чтобы остаться круглыми на любой ширине.
          */}
          {nonEmpty.map((s, si) => {
            const color = single ? GOLD : seriesColor(si);
            return s.points.map((p, i) => (
              <span
                key={`${s.name}-${i}`}
                title={`${s.name} · ${p.label}: ${valueFormatter(p.value)}`}
                aria-hidden="true"
                className="absolute block rounded-full"
                style={{
                  left: `${xFor(i, s.points.length)}%`,
                  top: `${100 - (max > 0 ? (p.value / max) * 100 : 0)}%`,
                  width: MARKER,
                  height: MARKER,
                  marginLeft: -MARKER / 2,
                  marginTop: -MARKER / 2,
                  background: color,
                  boxShadow: "0 0 0 2px var(--color-sand, #FFFAF2)",
                }}
              />
            ));
          })}
        </div>
      </div>

      {/*
        Подписи оси X ставим ровно под точками. Раньше это был flex с
        равными долями: точки стоят от края до края (0% и 100%), а подписи
        центрировались внутри своих долей — и первая подпись уезжала правее
        своей точки. Крайние подписи прижимаем к краям, чтобы не вылезали
        за график.
      */}
      <div className="mt-1 flex gap-2">
        <div className="w-10 shrink-0" aria-hidden="true" />
        <div className="relative h-4 flex-1">
          {labels.map((l, i) => {
            const isFirst = i === 0;
            const isLast = i === labels.length - 1 && labels.length > 1;
            return (
              <span
                key={i}
                title={l}
                className="absolute whitespace-nowrap text-[10px] text-[var(--color-muted)]"
                style={{
                  left: `${xFor(i, labels.length)}%`,
                  transform: isFirst
                    ? "none"
                    : isLast
                      ? "translateX(-100%)"
                      : "translateX(-50%)",
                }}
              >
                {l}
              </span>
            );
          })}
        </div>
      </div>

      {/* Легенда обязательна при 2+ рядах */}
      {!single ? <Legend items={nonEmpty.map((s) => s.name)} /> : null}
    </figure>
  );
}

// ============================================================
// Горизонтальные полосы — рейтинги (топ коллекций, траты по фабрикам)
// ============================================================

export function RankBars({
  data,
  valueFormatter = fmtShort,
  colorByIndex = false,
  max: forcedMax,
}: {
  data: { label: string; value: number; hint?: string }[];
  valueFormatter?: (n: number) => string;
  /** true = каждой строке свой цвет из палитры (когда строки — разные сущности) */
  colorByIndex?: boolean;
  max?: number;
}) {
  if (data.length === 0) return <NoData />;
  const max = forcedMax ?? Math.max(...data.map((d) => d.value), 1);

  return (
    <div className="flex flex-col gap-2.5">
      {data.map((d, i) => (
        <div key={`${d.label}-${i}`}>
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className="truncate text-sm" title={d.label}>
              {d.label}
            </span>
            <span className="tnum shrink-0 text-sm font-semibold text-[var(--color-ocean)]">
              {valueFormatter(d.value)}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[var(--color-sand-warm)]">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max(1, (d.value / max) * 100)}%`,
                background: colorByIndex ? seriesColor(i) : GOLD,
              }}
            />
          </div>
          {d.hint ? (
            <div className="mt-1 text-xs text-[var(--color-muted)]">{d.hint}</div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Полоса «на сколько месяцев хватит запаса»
// ============================================================

export function CoverageBar({
  months,
  target = 6,
}: {
  months: number | null;
  /** ориентир: сколько месяцев запаса считаем нормой */
  target?: number;
}) {
  if (months === null) {
    return (
      <span className="text-xs text-[var(--color-faint)]">продаж нет</span>
    );
  }
  const capped = Math.min(months, target * 2);
  const pct = (capped / (target * 2)) * 100;

  // цвет + подпись: значение всегда написано рядом, не только цветом
  const color =
    months < 1
      ? "var(--color-critical)"
      : months < 2
        ? "var(--color-warn)"
        : months > target * 1.5
          ? "var(--color-series-1)"
          : "var(--color-ok)";

  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-20 shrink-0 overflow-hidden rounded-full bg-[var(--color-sand-warm)]">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.max(2, pct)}%`, background: color }}
        />
      </div>
      <span className="tnum whitespace-nowrap text-xs text-[var(--color-muted)]">
        {months >= target * 2 ? `>${target * 2}` : months.toFixed(1)} мес
      </span>
    </div>
  );
}

// ============================================================
// Общие части
// ============================================================

export function Legend({ items }: { items: string[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
      {items.map((name, i) => (
        <span
          key={name}
          className="inline-flex items-center gap-1.5 text-xs text-[var(--color-muted)]"
        >
          <span
            aria-hidden="true"
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ background: seriesColor(i) }}
          />
          {name}
        </span>
      ))}
    </div>
  );
}

function NoData(): ReactNode {
  return (
    <div className="rounded-lg border border-dashed border-[var(--color-line)] px-4 py-8 text-center text-sm text-[var(--color-faint)]">
      Пока нет данных. Синхронизируйте продажи с Ainur — и график появится.
    </div>
  );
}

/**
 * Сворачивает длинный список в топ-N + «Прочее».
 * Палитра рассчитана максимум на 8 рядов — девятый цвет не выдумываем.
 */
export function foldToTop<T extends { value: number }>(
  rows: T[],
  topN: number,
  makeOther: (sum: number) => T,
): T[] {
  if (rows.length <= topN) return rows;
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  const top = sorted.slice(0, topN);
  const restSum = sorted.slice(topN).reduce((s, r) => s + r.value, 0);
  if (restSum > 0) top.push(makeOther(restSum));
  return top;
}
