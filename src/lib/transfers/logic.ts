/**
 * Чистая бизнес-логика «Перемещения между складами».
 *
 * Здесь нет обращений к базе — только числа на входе и решение на выходе.
 * Это то, что описано в ТЗ на переработку страницы: определение бренда
 * (см. @/lib/brands), целевой остаток, распределение ограниченного
 * количества, доступное количество источника, причина рекомендации,
 * приоритет, обработка нового товара без продаж, обработка отрицательного
 * остатка. Всё это тестируется в logic.test.ts без базы и без сети.
 *
 * src/lib/transfers.ts достаёт числа из базы (остатки, продажи по складам,
 * дату создания варианта) и вызывает эти функции — сам он бизнес-решений
 * не принимает.
 */

// ============================================================
// Отрицательные остатки — «складская алхимия нам не нужна»
// ============================================================

export interface SanitizedStock {
  /** остаток, как он пришёл из Ainur — может быть отрицательным (ошибка учёта) */
  raw: number;
  /** сколько реально доступно для перемещения — отрицательное всегда 0 */
  available: number;
  /** это отрицательный остаток — ошибка учёта в Ainur, не нормальный ноль */
  isNegative: boolean;
}

export function sanitizeStock(raw: number): SanitizedStock {
  const n = Number.isFinite(raw) ? raw : 0;
  return { raw: n, available: Math.max(0, n), isNegative: n < 0 };
}

// ============================================================
// Новое поступление
// ============================================================

export const NEW_ARRIVAL_DAYS = 60;

/**
 * «Новое поступление»: недавно заведено (createdAt) и ещё нигде не имеет
 * истории продаж. Дата в прошлом дальше NEW_ARRIVAL_DAYS — уже не «новое»,
 * даже без продаж (иначе мёртвый остаток многолетней давности незаслуженно
 * получал бы приоритет новинки).
 */
export function isNewArrival(params: {
  createdAt: string;
  hasAnySalesEver: boolean;
  now?: Date;
  thresholdDays?: number;
}): boolean {
  if (params.hasAnySalesEver) return false;
  const created = new Date(params.createdAt).getTime();
  if (Number.isNaN(created)) return false;
  const now = (params.now ?? new Date()).getTime();
  const days = (now - created) / (24 * 3600 * 1000);
  return days >= 0 && days <= (params.thresholdDays ?? NEW_ARRIVAL_DAYS);
}

// ============================================================
// Целевое количество на точке
// ============================================================

/** «3 единицы» — не менее стольки продаж за последние 90 дней */
export const TARGET_3_MIN_SOLD_90D = 3;
/**
 * «3 единицы» — не менее стольки продаж за 12 месяцев (запасной путь для
 * товара, который продаётся ровно в течение года, а не рывками — основной
 * путь для «горячего» товара выше, через TARGET_3_MIN_SOLD_90D).
 *
 * В исходном ТЗ было «не менее 88 продаж за 12 месяцев» — для одного
 * SKU/размера в островном бутике это нереалистично много, похоже на
 * опечатку при надиктовке. Подтверждено с Евой: 6 продаж за год (то есть
 * примерно раз в 2 месяца) — порог, при котором точке уже нужен полный
 * комплект «3 единицы» (витрина + зал + запас).
 */
export const TARGET_3_MIN_SOLD_12M = 6;

export interface TargetInput {
  sold90d: number;
  sold12m: number;
  /** новое поступление — ещё не успело получить историю продаж */
  isNew: boolean;
  /** у ДРУГОЙ точки в этом же маршруте есть подтверждённый спрос (sold12m > 0 либо isNew) */
  otherPointHasDemand: boolean;
  /**
   * Остаток этой точки и точки-соседа по маршруту — используются ТОЛЬКО
   * для случая «здесь ещё не продавалось, а у соседа спрос подтверждён»
   * (см. ниже): вместо жёсткого 0 делим общий остаток маршрута пополам,
   * а не оставляем всё там, где уже продавалось. Если не передано —
   * ведёт себя как раньше (0): это для точки-источника, которая сама
   * никогда не продавала товар и не должна резервировать его для себя,
   * когда сосед его явно ждёт — там splitting не нужен, только у точки,
   * которую мы решаем, стоит ли впервые попробовать.
   * Ева, 2026-09-16, про партию Mockni на Пангане: «можно вносить на
   * пробу, не обязательно минимум один, можно и два, в зависимости от
   * количества... если товар новый пришёл, логично разделить его между
   * двух магазинов поровну».
   */
  thisPointAvailable?: number;
  otherPointAvailable?: number;
}

/**
 * Целевое количество для точки (раздел ТЗ «Целевое количество»).
 *
 * Порядок проверки — не буквально «3,2,1,0» сверху вниз: «1» — это общий
 * запасной вариант («мало, но нужно для представленности»), а «0» —
 * специальное исключение из него, когда здесь спроса не было вовсе, а у
 * другой точки маршрута он подтверждён. Поэтому «0» проверяется раньше
 * запасного «1».
 */
export function computeTargetQty(input: TargetInput): number {
  const { sold90d, sold12m, isNew, otherPointHasDemand, thisPointAvailable, otherPointAvailable } =
    input;
  if (sold90d >= TARGET_3_MIN_SOLD_90D || sold12m >= TARGET_3_MIN_SOLD_12M) return 3;
  if (sold12m >= 1 || isNew) return 2;
  if (sold12m === 0 && sold90d === 0 && !isNew && otherPointHasDemand) {
    // Раньше здесь был жёсткий 0 — и рекомендация «стоит попробовать на
    // непроверенной точке» пропадала совсем, даже если это уже доказанный
    // бестселлер на соседней точке, просто пока не пробовали здесь. Если
    // остатки обеих точек известны — делим общий остаток маршрута пополам
    // (минимум 1), а не отдаём всё туда, где уже продавалось.
    if (thisPointAvailable === undefined || otherPointAvailable === undefined) return 0;
    return Math.max(1, Math.round((thisPointAvailable + otherPointAvailable) / 2));
  }
  return 1;
}

// ============================================================
// Причины и группы (бакеты)
// ============================================================

export const REASONS = {
  SOLD_OUT_RECENT_SALES: "Закончился на {dest}, продавался недавно",
  SOLD_OUT_HAS_SUPPLY: "Закончился на {dest}, есть запас на {source}",
  LOW_STOCK: "Низкий остаток",
  ACTIVE_SALES: "Активные продажи",
  NEW_ARRIVAL: "Новое поступление",
  NOT_SOLD_AT_SOURCE: "Не продаётся на складе-источнике",
  NEEDS_PURCHASE: "Недостаточно общего остатка — нужна закупка",
} as const;

export type ReasonCode = keyof typeof REASONS;

export function formatReason(
  code: ReasonCode,
  vars: { dest?: string; source?: string } = {},
): string {
  return REASONS[code]
    .replace("{dest}", vars.dest ?? "")
    .replace("{source}", vars.source ?? "");
}

export type Bucket =
  | "moveNow"
  | "lowStock"
  | "newArrivals"
  | "needsPurchase"
  | "unconfirmedDemand";

export const BUCKET_LABELS: Record<Bucket, string> = {
  moveNow: "Переместить сейчас",
  lowStock: "Низкий остаток",
  newArrivals: "Новые поступления",
  needsPurchase: "Нужна закупка — перемещать нечего",
  unconfirmedDemand: "Без подтверждённого спроса",
};

// ============================================================
// Приоритет строки внутри бренда/бакета
// ============================================================

export interface PriorityInput {
  destAvailable: number;
  destSoldOutRecently: boolean;
  sold90d: number;
  sold12m: number;
  isNew: boolean;
}

/**
 * Численный приоритет для сортировки (больше — выше в списке). Порядок
 * соответствует разделу ТЗ «Приоритет рекомендаций»: закончилось и
 * недавно продавалось > остаток 1 > активные продажи > новое поступление
 * > остальное, по убыванию продаж.
 */
export function priorityScore(input: PriorityInput): number {
  if (input.destAvailable === 0 && input.destSoldOutRecently) return 5_000_000;
  if (input.destAvailable === 1) return 4_000_000;
  const velocity = input.sold90d * 100 + input.sold12m;
  if (velocity > 0) return 3_000_000 + velocity;
  if (input.isNew) return 2_000_000;
  return 1_000_000 - input.destAvailable; // «медленнее» — ниже
}

// ============================================================
// Сравнение спроса двух точек (кому отдать дефицитный остаток)
// ============================================================

export interface DemandPoint {
  key: string;
  need: number;
  sold90d: number;
  sold12m: number;
  lastSaleAt: string | null;
}

/**
 * <0 — a приоритетнее b, >0 — b приоритетнее a, 0 — паритет (раздел ТЗ
 * «Приоритет рекомендаций»: 90 дней → 12 месяцев → дата последней продажи).
 */
export function compareDemand(a: DemandPoint, b: DemandPoint): number {
  if (a.sold90d !== b.sold90d) return b.sold90d - a.sold90d;
  if (a.sold12m !== b.sold12m) return b.sold12m - a.sold12m;
  const at = a.lastSaleAt ? new Date(a.lastSaleAt).getTime() : -Infinity;
  const bt = b.lastSaleAt ? new Date(b.lastSaleAt).getTime() : -Infinity;
  if (at !== bt) return bt - at;
  return 0;
}

export interface AllocationResult {
  allocated: Record<string, number>;
  /** общего остатка не хватает, чтобы закрыть обе точки сразу */
  insufficientTotal: boolean;
  /** спрос двух точек равен — спорную последнюю единицу не отдали никому */
  tiedLastUnit: boolean;
}

/**
 * Раздел ТЗ «Если товара недостаточно для минимального количества в обоих
 * магазинах»: сравнить продажи за 90 дней → за 12 месяцев → дату последней
 * продажи, больше отдать точке с более высокой скоростью; если спрос
 * примерно одинаковый — не забирать последнюю единицу, показать дефицит;
 * если это новый товар без продаж — распределить хотя бы по одной штуке.
 */
export function allocateLimited(
  available: number,
  demands: DemandPoint[],
  opts: { isNewItem?: boolean } = {},
): AllocationResult {
  const allocated: Record<string, number> = {};
  for (const d of demands) allocated[d.key] = 0;

  const totalNeed = demands.reduce((sum, d) => sum + Math.max(0, d.need), 0);
  const insufficientTotal = Math.max(0, available) < totalNeed;

  let remaining = Math.max(0, available);
  if (demands.length === 0 || remaining <= 0) {
    return { allocated, insufficientTotal, tiedLastUnit: false };
  }

  if (opts.isNewItem) {
    for (const d of demands) {
      if (remaining <= 0) break;
      if (d.need > 0) {
        allocated[d.key] += 1;
        remaining -= 1;
      }
    }
  }

  const sorted = [...demands].sort(compareDemand);
  let tiedLastUnit = false;

  for (let i = 0; i < sorted.length && remaining > 0; i++) {
    const d = sorted[i];
    const stillNeed = Math.max(0, d.need - allocated[d.key]);
    if (stillNeed <= 0) continue;

    const next = sorted.slice(i + 1).find((o) => o.need - allocated[o.key] > 0);
    if (remaining === 1 && next && compareDemand(d, next) === 0) {
      // Последняя спорная единица при точном паритете — никому не отдаём,
      // это дефицит, а не решение в пользу случайного порядка сортировки.
      tiedLastUnit = true;
      break;
    }

    const give = Math.min(stillNeed, remaining);
    allocated[d.key] += give;
    remaining -= give;
  }

  return { allocated, insufficientTotal, tiedLastUnit };
}

// ============================================================
// Один прогон точки-получателя ↔ точки-источника (Пхукет ↔ Панган)
// ============================================================

export interface PointSales {
  sold90d: number;
  sold12m: number;
  lastSaleAt: string | null;
}

export interface BoutiqueLegInput {
  sourceRawQty: number;
  destRawQty: number;
  sourceSales: PointSales;
  destSales: PointSales;
  /** новое поступление — нет истории продаж нигде */
  isNew: boolean;
}

export interface BoutiqueLegResult {
  sendQty: number;
  destTarget: number;
  sourceTarget: number;
  sourceAvailable: number;
  sourceIsNegative: boolean;
  destAvailable: number;
  destIsNegative: boolean;
  /** отдаём источнику последнюю единицу, при этом там не было спроса */
  lastUnitWarning: boolean;
  bucket: Bucket;
  reason: ReasonCode;
}

/**
 * Считает одно направление Пхукет↔Панган (вызывается дважды с разными
 * source/dest — само направление, в котором получилось sendQty > 0,
 * и есть рекомендация; если получилось 0 в обе стороны — перемещать
 * нечего). Раздел ТЗ 2 и 3.
 */
export function evaluateBoutiqueLeg(input: BoutiqueLegInput): BoutiqueLegResult | null {
  const source = sanitizeStock(input.sourceRawQty);
  const dest = sanitizeStock(input.destRawQty);

  const sourceHasDemand = input.sourceSales.sold12m > 0;
  const destHasDemand = input.destSales.sold12m > 0 || input.isNew;

  const destTarget = computeTargetQty({
    sold90d: input.destSales.sold90d,
    sold12m: input.destSales.sold12m,
    isNew: input.isNew,
    otherPointHasDemand: sourceHasDemand,
    // Только здесь: решаем, стоит ли впервые попробовать эту точку — если
    // да, делим остаток маршрута пополам, а не даём равно 0 (см. TargetInput).
    thisPointAvailable: dest.available,
    otherPointAvailable: source.available,
  });
  const sourceTarget = computeTargetQty({
    sold90d: input.sourceSales.sold90d,
    sold12m: input.sourceSales.sold12m,
    isNew: input.isNew,
    otherPointHasDemand: destHasDemand,
  });

  const need = Math.max(0, destTarget - dest.available);
  const base = {
    destTarget,
    sourceTarget,
    sourceAvailable: source.available,
    sourceIsNegative: source.isNegative,
    destAvailable: dest.available,
    destIsNegative: dest.isNegative,
  };

  if (need <= 0) return null; // этой точке хватает — рекомендовать нечего

  const noEvidenceAnywhere =
    !sourceHasDemand && !destHasDemand && input.destSales.sold90d === 0;
  if (noEvidenceAnywhere) {
    return {
      ...base,
      sendQty: Math.min(need, Math.max(0, source.available - sourceTarget)),
      lastUnitWarning: false,
      bucket: "unconfirmedDemand",
      reason: "LOW_STOCK",
    };
  }

  const spare = Math.max(0, source.available - sourceTarget);
  if (spare <= 0) {
    return {
      ...base,
      sendQty: 0,
      lastUnitWarning: false,
      bucket: "needsPurchase",
      reason: "NEEDS_PURCHASE",
    };
  }

  const sendQty = Math.min(need, spare);
  const takesLastUnit = source.available - sendQty === 0;
  // Структурно уже гарантировано формулой spare = available − sourceTarget:
  // если у источника был свой спрос (sourceTarget ≥ 1), последняя единица
  // никогда не будет предложена — spare тогда ≤ available − 1.
  const lastUnitWarning = takesLastUnit && sourceTarget === 0;

  let bucket: Bucket;
  let reason: ReasonCode;
  if (dest.available === 0 && input.destSales.sold90d > 0) {
    bucket = "moveNow";
    reason = "SOLD_OUT_RECENT_SALES";
  } else if (dest.available === 0) {
    bucket = "moveNow";
    reason = "SOLD_OUT_HAS_SUPPLY";
  } else if (input.isNew) {
    bucket = "newArrivals";
    reason = "NEW_ARRIVAL";
  } else if (!sourceHasDemand) {
    bucket = "lowStock";
    reason = "NOT_SOLD_AT_SOURCE";
  } else if (input.destSales.sold90d > 0) {
    bucket = "lowStock";
    reason = "ACTIVE_SALES";
  } else {
    bucket = "lowStock";
    reason = "LOW_STOCK";
  }

  return { ...base, sendQty, lastUnitWarning, bucket, reason };
}

// ============================================================
// Fotesko → Phuket (пополнение точек с производственного/буферного склада)
// ============================================================

export interface FoteskoLegInput {
  foteskoRawQty: number;
  phuketRawQty: number;
  phanganRawQty: number;
  phuketSales: PointSales;
  phanganSales: PointSales;
  isNew: boolean;
}

export interface FoteskoLegResult {
  sendQty: number;
  foteskoAvailable: number;
  foteskoIsNegative: boolean;
  phuketTarget: number;
  phanganTarget: number;
  /** сколько всего не хватает (Пхукету + Пангану) — для сравнения с тем, что реально отправили */
  totalNeed: number;
  bucket: Bucket;
  reason: ReasonCode;
}

/**
 * Раздел ТЗ 1: считаем потребность сразу двух точек (Пхукет + Панган), но
 * назначение — всегда Пхукет (Панган получает своё отдельным перемещением
 * Пхукет→Панган). Пример из ТЗ: Fotesko 10 / Phuket 0 / Phangan 0 →
 * рекомендация Fotesko→Phuket на нужное количество.
 *
 * ВАЖНО (Ева, 2026-09-16): «деление остатка маршрута пополам» из
 * computeTargetQty (см. TargetInput.thisPointAvailable/otherPointAvailable)
 * сюда НЕ подключено — ниже phuketTarget/phanganTarget вызываются без этих
 * полей, то есть здесь по-прежнему старое поведение (target=0, если точка
 * сама не продавала, а другая точка маршрута — да). Изменение затрагивает
 * только вкладки «Пхукет→Панган» и «Панган→Пхукет» (evaluateBoutiqueLeg
 * ниже), не «Фотеско→Пхукет».
 */
export function evaluateFoteskoLeg(input: FoteskoLegInput): FoteskoLegResult | null {
  const fotesko = sanitizeStock(input.foteskoRawQty);
  const phuket = sanitizeStock(input.phuketRawQty);
  const phangan = sanitizeStock(input.phanganRawQty);

  const phuketHasDemand = input.phuketSales.sold12m > 0 || input.isNew;
  const phanganHasDemand = input.phanganSales.sold12m > 0 || input.isNew;

  const phuketTarget = computeTargetQty({
    sold90d: input.phuketSales.sold90d,
    sold12m: input.phuketSales.sold12m,
    isNew: input.isNew,
    otherPointHasDemand: phanganHasDemand,
  });
  const phanganTarget = computeTargetQty({
    sold90d: input.phanganSales.sold90d,
    sold12m: input.phanganSales.sold12m,
    isNew: input.isNew,
    otherPointHasDemand: phuketHasDemand,
  });

  const needPhuket = Math.max(0, phuketTarget - phuket.available);
  const needPhangan = Math.max(0, phanganTarget - phangan.available);
  const totalNeed = needPhuket + needPhangan;

  if (totalNeed <= 0 || fotesko.available <= 0) return null;

  const sendQty = Math.min(fotesko.available, totalNeed);
  const base = {
    foteskoAvailable: fotesko.available,
    foteskoIsNegative: fotesko.isNegative,
    phuketTarget,
    phanganTarget,
    totalNeed,
  };

  const noEvidenceAnywhere = !phuketHasDemand && !phanganHasDemand;
  if (noEvidenceAnywhere) {
    return { ...base, sendQty, bucket: "unconfirmedDemand", reason: "LOW_STOCK" };
  }

  let bucket: Bucket;
  let reason: ReasonCode;
  if (phuket.available === 0 && input.phuketSales.sold90d > 0) {
    bucket = "moveNow";
    reason = "SOLD_OUT_RECENT_SALES";
  } else if (phuket.available === 0 || phangan.available === 0) {
    bucket = "moveNow";
    reason = "SOLD_OUT_HAS_SUPPLY";
  } else if (input.isNew) {
    bucket = "newArrivals";
    reason = "NEW_ARRIVAL";
  } else if (input.phuketSales.sold90d > 0 || input.phanganSales.sold90d > 0) {
    bucket = "lowStock";
    reason = "ACTIVE_SALES";
  } else {
    bucket = "lowStock";
    reason = "LOW_STOCK";
  }

  if (sendQty < totalNeed) bucket = "needsPurchase";

  return { ...base, sendQty, bucket, reason };
}
