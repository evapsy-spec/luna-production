/**
 * Блокировка синхронизации с Ainur.
 *
 * Зачем нужна. Синхронизацию запускают из двух разных процессов: из приложения
 * по кнопке «Обновить» и из ночного таймера. Ainur отдаёт 429 при частых
 * запросах — мы это уже получали, когда кнопку нажали дважды подряд
 * (см. sync_runs, products ERROR «Ainur вернул 429 на /product»).
 * Значит блокировка обязана быть общей для процессов, то есть жить в базе,
 * а не в памяти приложения.
 *
 * Атомарность даёт сам SQLite: INSERT ... ON CONFLICT DO NOTHING меняет ноль
 * строк, если ключ уже занят, и это единственная операция — гонки нет. Снятие
 * и угон брошенной блокировки сделаны так же, через сравнение старого значения
 * в самом UPDATE/DELETE: своё снимаем, чужое не трогаем.
 */
import { randomUUID } from "node:crypto";
import { rawSqlite } from "@/lib/db/client";

const LOCK_KEY = "sync_lock";

/**
 * Через сколько блокировка считается брошенной. Полный прогон занимает
 * около 35 секунд, при паузах между шагами — до пары минут. Полчаса означает,
 * что процесс упал и снять блокировку было некому: иначе одно падение
 * заблокировало бы синхронизацию навсегда.
 */
const STALE_MS = 30 * 60 * 1000;

export interface SyncLock {
  token: string;
  holder: string;
}

interface LockValue {
  token: string;
  holder: string;
  at: string;
}

export type LockAttempt =
  | { ok: true; lock: SyncLock; stolenFrom?: string }
  | { ok: false; heldBy: string; since: string; ageMs: number };

function readRaw(): { value: string; parsed: LockValue } | null {
  const row = rawSqlite()
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(LOCK_KEY) as { value?: string } | undefined;
  if (!row?.value) return null;
  try {
    return { value: row.value, parsed: JSON.parse(row.value) as LockValue };
  } catch {
    // мусор вместо JSON — считаем блокировку испорченной и брошенной
    return { value: row.value, parsed: { token: "", holder: "неизвестно", at: "" } };
  }
}

/**
 * Пытается взять блокировку. Ничего не ждёт: вызывающий сам решает,
 * ругаться пользователю или тихо выйти (для таймера — тихо выйти).
 */
export function acquireSyncLock(holder: string): LockAttempt {
  const sqlite = rawSqlite();
  const token = randomUUID();
  const now = new Date().toISOString();
  const mine = JSON.stringify({ token, holder, at: now } satisfies LockValue);

  const taken = sqlite
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO NOTHING`,
    )
    .run(LOCK_KEY, mine, now);
  if (Number(taken.changes) === 1) {
    return { ok: true, lock: { token, holder } };
  }

  const existing = readRaw();
  if (!existing) {
    // Строку удалили между нашими двумя запросами — пробуем ещё раз, один раз.
    const retry = sqlite
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO NOTHING`,
      )
      .run(LOCK_KEY, mine, now);
    return Number(retry.changes) === 1
      ? { ok: true, lock: { token, holder } }
      : { ok: false, heldBy: "неизвестно", since: now, ageMs: 0 };
  }

  const startedAt = Date.parse(existing.parsed.at);
  const ageMs = Number.isFinite(startedAt) ? Date.now() - startedAt : Infinity;

  if (ageMs < STALE_MS) {
    return {
      ok: false,
      heldBy: existing.parsed.holder || "неизвестно",
      since: existing.parsed.at,
      ageMs,
    };
  }

  // Брошена. Угоняем сравнением со старым значением: если её в этот же миг
  // снял или обновил кто-то другой, UPDATE не найдёт строку и мы уйдём ни с чем.
  const stolen = sqlite
    .prepare(
      "UPDATE settings SET value = ?, updated_at = ? WHERE key = ? AND value = ?",
    )
    .run(mine, now, LOCK_KEY, existing.value);
  if (Number(stolen.changes) === 1) {
    return {
      ok: true,
      lock: { token, holder },
      stolenFrom: existing.parsed.holder || "неизвестно",
    };
  }

  return {
    ok: false,
    heldBy: existing.parsed.holder || "неизвестно",
    since: existing.parsed.at,
    ageMs,
  };
}

/**
 * Снимает свою блокировку. Чужую не тронет: удаляем только строку,
 * значение которой совпадает с тем, что мы записывали.
 */
export function releaseSyncLock(lock: SyncLock): void {
  const existing = readRaw();
  if (!existing) return;
  if (existing.parsed.token !== lock.token) return;
  rawSqlite()
    .prepare("DELETE FROM settings WHERE key = ? AND value = ?")
    .run(LOCK_KEY, existing.value);
}

/** Кто сейчас держит блокировку — для показа на странице. */
export function currentSyncLock(): { holder: string; since: string } | null {
  const existing = readRaw();
  if (!existing) return null;
  const startedAt = Date.parse(existing.parsed.at);
  if (Number.isFinite(startedAt) && Date.now() - startedAt >= STALE_MS) return null;
  return { holder: existing.parsed.holder || "неизвестно", since: existing.parsed.at };
}

/** Человеческое «сколько уже идёт» для сообщения об отказе. */
export function describeAge(ageMs: number): string {
  if (!Number.isFinite(ageMs)) return "неизвестно сколько";
  const s = Math.round(ageMs / 1000);
  if (s < 60) return `${s} с`;
  return `${Math.floor(s / 60)} мин ${s % 60} с`;
}
