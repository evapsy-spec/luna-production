/**
 * Мелкие помощники аналитики — общие для сводной страницы и страницы коллекции.
 */

export const WINDOW_OPTIONS = [30, 90, 180] as const;

/** Окно расчёта из адреса страницы. Любая ерунда в параметре → 90 дней. */
export function parseWindow(raw?: string): number {
  const n = Number(raw);
  return WINDOW_OPTIONS.includes(n as (typeof WINDOW_OPTIONS)[number]) ? n : 90;
}

/** Дата N дней назад в формате YYYY-MM-DD — поле day хранится строкой */
export function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
}

const MONTHS_RU = [
  "янв",
  "фев",
  "мар",
  "апр",
  "май",
  "июн",
  "июл",
  "авг",
  "сен",
  "окт",
  "ноя",
  "дек",
];

export interface MonthPoint {
  /** YYYY-MM — совпадает с substr(day, 1, 7) */
  key: string;
  label: string;
}

/** Последние `count` месяцев по возрастанию, включая текущий */
export function lastMonths(count: number): MonthPoint[] {
  const now = new Date();
  const out: MonthPoint[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const month = d.getUTCMonth();
    const key = `${d.getUTCFullYear()}-${String(month + 1).padStart(2, "0")}`;
    // год подписываем только у января — иначе подписи не влезают на телефоне
    const label =
      month === 0
        ? `${MONTHS_RU[month]} ${String(d.getUTCFullYear()).slice(2)}`
        : MONTHS_RU[month];
    out.push({ key, label });
  }
  return out;
}

export function formatUnits(n: number): string {
  return Math.round(n).toLocaleString("ru-RU").replace(/,/g, " ");
}
