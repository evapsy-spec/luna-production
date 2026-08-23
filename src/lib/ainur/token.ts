/**
 * Хранение токена Ainur Connect API.
 *
 * Токен можно задать двумя способами:
 *  1. через интерфейс (страница «Синхронизация») — тогда он лежит в таблице
 *     settings и его можно поменять без доступа к серверу;
 *  2. через переменную окружения AINUR_API_TOKEN — удобно на продакшене,
 *     где секреты задаются в панели хостинга.
 *
 * Приоритет у того, что задано в интерфейсе: если Ева поменяла токен в
 * приложении, значит она хочет именно его, а не тот, что прописан в окружении.
 *
 * Токен НИКОГДА не показывается целиком и не пишется в логи и аудит —
 * в интерфейсе видны только последние 4 символа.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { AinurClient } from "./client";

const SETTING_KEY = "ainur_api_token";

export interface TokenInfo {
  /** задан ли токен вообще */
  configured: boolean;
  /** откуда взят: интерфейс или переменная окружения */
  source: "app" | "env" | null;
  /** «••••••3f9c» — для показа в интерфейсе */
  masked: string | null;
}

/** Возвращает токен для запросов к API. Пустая строка = не настроен. */
export async function getAinurToken(): Promise<string> {
  const rows = await db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, SETTING_KEY))
    .limit(1);

  const fromApp = rows[0]?.value?.trim();
  if (fromApp) return fromApp;

  return (process.env.AINUR_API_TOKEN ?? "").trim();
}

/** Что показать в интерфейсе, не раскрывая сам токен */
export async function getTokenInfo(): Promise<TokenInfo> {
  const rows = await db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, SETTING_KEY))
    .limit(1);

  const fromApp = rows[0]?.value?.trim();
  const fromEnv = (process.env.AINUR_API_TOKEN ?? "").trim();
  const value = fromApp || fromEnv;

  if (!value) return { configured: false, source: null, masked: null };

  return {
    configured: true,
    source: fromApp ? "app" : "env",
    masked: mask(value),
  };
}

export async function setAinurToken(value: string): Promise<void> {
  const clean = value.trim();
  const existing = await db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, SETTING_KEY))
    .limit(1);

  const updatedAt = new Date().toISOString();
  if (existing.length) {
    await db
      .update(schema.settings)
      .set({ value: clean, updatedAt })
      .where(eq(schema.settings.key, SETTING_KEY));
  } else {
    await db
      .insert(schema.settings)
      .values({ key: SETTING_KEY, value: clean, updatedAt });
  }
}

export async function clearAinurToken(): Promise<void> {
  await db
    .delete(schema.settings)
    .where(eq(schema.settings.key, SETTING_KEY));
}

/** Готов ли Ainur к синхронизации */
export async function isAinurReady(): Promise<boolean> {
  return (await getAinurToken()).length > 0;
}

/**
 * Клиент для запросов к Ainur с токеном из настроек.
 * Кидает понятную ошибку, если токен не задан.
 */
export async function ainurClient(): Promise<AinurClient> {
  const token = await getAinurToken();
  return new AinurClient({ token, baseUrl: process.env.AINUR_API_BASE });
}

function mask(value: string): string {
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 3)}${"•".repeat(10)}${value.slice(-4)}`;
}
