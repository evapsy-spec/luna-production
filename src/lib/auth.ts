/**
 * Аутентификация и роли.
 *
 * OWNER  — Ева и Константин: полный доступ, включая финансы
 *          (себестоимость, оплаты фабрикам, бюджеты).
 * MANAGER — менеджер производства: ткани, фабрики, заказы, но
 *          денежные суммы скрыты.
 *
 * Сессия — подписанный JWT в httpOnly cookie. Внешний провайдер не нужен:
 * пользователей три, и заводит их владелец.
 */
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";

const COOKIE_NAME = "luna_session";
const SESSION_DAYS = 30;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: "OWNER" | "MANAGER";
}

function secret(): Uint8Array {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 16) {
    throw new Error(
      "SESSION_SECRET не задан или слишком короткий — укажите его в .env",
    );
  }
  return new TextEncoder().encode(value);
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

/** Проверяет пару email+пароль. Возвращает пользователя или null. */
export async function verifyCredentials(
  email: string,
  password: string,
): Promise<SessionUser | null> {
  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email.trim().toLowerCase()))
    .limit(1);

  const user = rows[0];
  if (!user || !user.isActive) return null;

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role === "OWNER" ? "OWNER" : "MANAGER",
  };
}

export async function createSession(user: SessionUser): Promise<void> {
  const token = await new SignJWT({
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret());

  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookie(),
    path: "/",
    maxAge: SESSION_DAYS * 24 * 3600,
  });
}

/**
 * Помечать ли cookie сессии как secure.
 *
 * По умолчанию в продакшене — да, и это правильно: по http cookie улетит
 * в открытом виде. Но браузер тогда её и НЕ СОХРАНИТ, если сайт открыт по
 * http — а именно так приложение работает в локальной сети
 * (http://MacBook-Pro-Islombek.local:3000). Исключение у Chrome есть только
 * для localhost, поэтому на самом Mac вход держался, а на планшете
 * каждый переход выкидывал на страницу входа.
 *
 * LUNA_ALLOW_INSECURE_COOKIE=1 снимает флаг — только для тестов в своей
 * сети. На хостинге с https переменную не задавать.
 */
function secureCookie(): boolean {
  if (process.env.LUNA_ALLOW_INSECURE_COOKIE === "1") return false;
  return process.env.NODE_ENV === "production";
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

/** Текущий пользователь или null. Не бросает исключение. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  try {
    const jar = await cookies();
    const token = jar.get(COOKIE_NAME)?.value;
    if (!token) return null;

    const { payload } = await jwtVerify(token, secret());
    return {
      id: String(payload.sub),
      email: String(payload.email),
      name: String(payload.name),
      role: payload.role === "OWNER" ? "OWNER" : "MANAGER",
    };
  } catch {
    return null;
  }
}

/** Требует вход. Бросает — вызывающий код перенаправляет на /login. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  return user;
}

/** Требует роль OWNER — для финансовых разделов и управления пользователями. */
export async function requireOwner(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "OWNER") throw new Error("FORBIDDEN");
  return user;
}

/** Видит ли пользователь денежные суммы */
export function canSeeMoney(user: SessionUser | null): boolean {
  return user?.role === "OWNER";
}

// ============================================================
// АУДИТ-ЛОГ
// ============================================================

export interface AuditInput {
  action:
    | "CREATE"
    | "UPDATE"
    | "DELETE"
    | "SYNC"
    | "RESERVE"
    | "RELEASE"
    | "APPLY_CREDIT";
  entityType: string;
  entityId: string;
  entityName: string;
  changes?: Record<string, { from: unknown; to: unknown }>;
}

/**
 * Пишет запись в аудит-лог. Вызывать при каждом изменении данных —
 * Ева отдельно просила видеть, кто и когда что менял.
 */
export async function writeAudit(
  user: SessionUser | null,
  input: AuditInput,
): Promise<void> {
  await db.insert(schema.auditLog).values({
    userId: user?.id ?? null,
    actorName: user?.name ?? "система",
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    entityName: input.entityName,
    changes: input.changes ? JSON.stringify(input.changes) : null,
  });
}

/**
 * Сравнивает две версии объекта и возвращает только изменённые поля —
 * удобно передавать в writeAudit, чтобы в логе не было шума.
 */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
  fields: (keyof T)[],
): Record<string, { from: unknown; to: unknown }> | undefined {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const field of fields) {
    if (!(field in after)) continue;
    const from = before[field];
    const to = after[field];
    if (from !== to) changes[String(field)] = { from, to };
  }
  return Object.keys(changes).length ? changes : undefined;
}
