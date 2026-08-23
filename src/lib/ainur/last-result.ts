/**
 * Результат последнего запуска синхронизации.
 *
 * Вынесено из страницы в отдельный модуль, потому что писать сюда теперь
 * не только страница, но и ночной скрипт (scripts/sync-scheduled.ts).
 * Если бы форма записи жила в двух местах, она бы разошлась — и страница
 * однажды перестала бы понимать то, что записал таймер.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import type { SyncResult } from "./sync";

export const RESULT_KEY = "last_sync_result";

/** Кто запустил: имя человека или «расписание» для ночного прогона */
export const SCHEDULED_ACTOR = "расписание";

export interface StoredResult {
  at: string;
  actor: string;
  label: string;
  results: SyncResult[];
  error?: string;
}

export async function saveLastSyncResult(stored: StoredResult): Promise<void> {
  const value = JSON.stringify(stored);
  const now = new Date().toISOString();
  await db
    .insert(schema.settings)
    .values({ key: RESULT_KEY, value, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.settings.key,
      set: { value, updatedAt: now },
    });
}

export async function readLastSyncResult(): Promise<StoredResult | null> {
  const rows = await db
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, RESULT_KEY))
    .limit(1);
  if (!rows[0]?.value) return null;
  try {
    return JSON.parse(rows[0].value) as StoredResult;
  } catch {
    return null;
  }
}
