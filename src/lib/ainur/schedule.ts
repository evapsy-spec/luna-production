/**
 * Расписание автоматической синхронизации с Ainur.
 *
 * Само расписание хранится в базе, в настройке sync_schedule, а не в файле
 * systemd. Причина простая: systemd задаёт только момент «разбудить скрипт»,
 * а всё остальное — включено ли, за сколько дней тянуть продажи, какая пауза
 * между шагами — должно меняться без захода на сервер по ssh. И выключить
 * автосинхронизацию тоже надо уметь из приложения, а не правкой юнита.
 *
 * Время в UTC, потому что сервер живёт в UTC. Для людей пересчитываем в Таиланд
 * (там Ева и склады) и на Бали (там Константин).
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";

export const SCHEDULE_KEY = "sync_schedule";

export interface SyncSchedule {
  /** Выключатель: таймер systemd всё равно проснётся, но скрипт тихо выйдет */
  enabled: boolean;
  utcHour: number;
  utcMinute: number;
  /** За сколько дней добирать продажи */
  salesDays: number;
  /** Пауза между шагами, секунды — защита от 429 */
  stepDelaySec: number;
}

/**
 * 23:30 UTC = 06:30 в Таиланде, 07:30 на Бали.
 * Утро, как просил Константин, и уже после ночного бэкапа в 02:30 по Таиланду:
 * если синхронизация притащит из Ainur что-то не то, вчерашняя копия цела.
 */
export const DEFAULT_SCHEDULE: SyncSchedule = {
  enabled: true,
  utcHour: 23,
  utcMinute: 30,
  salesDays: 60,
  stepDelaySec: 20,
};

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export async function readSchedule(): Promise<SyncSchedule> {
  const rows = await db
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, SCHEDULE_KEY))
    .limit(1);

  if (!rows[0]?.value) return DEFAULT_SCHEDULE;

  try {
    const raw = JSON.parse(rows[0].value) as Partial<SyncSchedule>;
    return {
      enabled: raw.enabled !== false,
      utcHour: clampInt(raw.utcHour, 0, 23, DEFAULT_SCHEDULE.utcHour),
      utcMinute: clampInt(raw.utcMinute, 0, 59, DEFAULT_SCHEDULE.utcMinute),
      salesDays: clampInt(raw.salesDays, 1, 365, DEFAULT_SCHEDULE.salesDays),
      stepDelaySec: clampInt(raw.stepDelaySec, 0, 300, DEFAULT_SCHEDULE.stepDelaySec),
    };
  } catch {
    // Испорченный JSON не должен ломать страницу — работаем по умолчанию
    return DEFAULT_SCHEDULE;
  }
}

export async function writeSchedule(next: SyncSchedule): Promise<void> {
  const value = JSON.stringify(next);
  const now = new Date().toISOString();
  await db
    .insert(schema.settings)
    .values({ key: SCHEDULE_KEY, value, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.settings.key,
      set: { value, updatedAt: now },
    });
}

/** Следующий момент срабатывания. Расписание суточное, считать легко и точно. */
export function nextRunAt(s: SyncSchedule, from: Date = new Date()): Date {
  const next = new Date(
    Date.UTC(
      from.getUTCFullYear(),
      from.getUTCMonth(),
      from.getUTCDate(),
      s.utcHour,
      s.utcMinute,
      0,
      0,
    ),
  );
  if (next.getTime() <= from.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next;
}

function shift(hour: number, minute: number, offsetHours: number): string {
  const h = (((hour + offsetHours) % 24) + 24) % 24;
  return `${String(h).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** «каждый день в 06:30 по Таиланду (07:30 Бали, 23:30 UTC)» */
export function describeSchedule(s: SyncSchedule): string {
  const thai = shift(s.utcHour, s.utcMinute, 7);
  const bali = shift(s.utcHour, s.utcMinute, 8);
  const utc = shift(s.utcHour, s.utcMinute, 0);
  return `каждый день в ${thai} по Таиланду (${bali} Бали, ${utc} UTC)`;
}

/** «через 11 ч 24 мин» */
export function describeUntil(target: Date, from: Date = new Date()): string {
  const ms = target.getTime() - from.getTime();
  if (ms <= 0) return "вот-вот";
  const totalMin = Math.round(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `через ${m} мин`;
  return `через ${h} ч ${m} мин`;
}
