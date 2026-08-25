/**
 * Луна-бот — доступ к данным бота (пользователи, чаты, поручения, действия
 * на подтверждении). Отдельный модуль, чтобы server.ts и commands.ts не
 * дублировали запросы к базе.
 *
 * Все функции работают через общее подключение @/lib/db/client — отдельного
 * соединения с базой бот не открывает (см. конвенцию из mcp/server.ts).
 */
import { eq, and, desc } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";

export interface BotUser {
  id: string;
  telegramUserId: string;
  telegramUsername: string | null;
  name: string;
  seesMoney: boolean;
  canConfirmMoney: boolean;
  isActive: boolean;
}

function toBotUser(u: typeof schema.botUsers.$inferSelect): BotUser {
  return {
    id: u.id,
    telegramUserId: u.telegramUserId,
    telegramUsername: u.telegramUsername,
    name: u.name,
    seesMoney: u.seesMoney,
    canConfirmMoney: u.canConfirmMoney,
    isActive: u.isActive,
  };
}

export async function getBotUserByTelegramId(telegramUserId: string): Promise<BotUser | null> {
  const rows = await db
    .select()
    .from(schema.botUsers)
    .where(eq(schema.botUsers.telegramUserId, String(telegramUserId)))
    .limit(1);
  const u = rows[0];
  if (!u || !u.isActive) return null;
  return toBotUser(u);
}

export async function listActiveBotUsers(): Promise<BotUser[]> {
  const rows = await db.select().from(schema.botUsers).where(eq(schema.botUsers.isActive, true));
  return rows.map(toBotUser);
}

/** Записывает действие/вопрос к боту в общий журнал аудита приложения. */
export async function logBotAudit(input: {
  actorName: string;
  action: string; // BOT_QUERY | BOT_TASK_CREATE | BOT_TASK_DONE | BOT_ACTION_CONFIRM | ...
  entityType: string; // например "bot_command", "bot_task"
  entityId: string;
  entityName: string;
  changes?: unknown;
}): Promise<void> {
  await db.insert(schema.auditLog).values({
    actorName: input.actorName,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    entityName: input.entityName,
    changes: input.changes ? JSON.stringify(input.changes) : null,
  });
}

// ---------------------------------------------------------------
// Поручения (/задача)
// ---------------------------------------------------------------

export async function createTask(input: {
  chatId: string;
  assignedToUserId: string | null;
  assignedToName: string;
  assignedByName: string;
  description: string;
  dueAt?: string | null;
}) {
  const [row] = await db
    .insert(schema.botTasks)
    .values({
      chatId: input.chatId,
      assignedToUserId: input.assignedToUserId,
      assignedToName: input.assignedToName,
      assignedByName: input.assignedByName,
      description: input.description,
      dueAt: input.dueAt ?? null,
    })
    .returning();
  return row;
}

export async function listOpenTasks(filterByUserId?: string) {
  const conditions = [eq(schema.botTasks.status, "OPEN")];
  if (filterByUserId) conditions.push(eq(schema.botTasks.assignedToUserId, filterByUserId));
  return db
    .select()
    .from(schema.botTasks)
    .where(and(...conditions))
    .orderBy(desc(schema.botTasks.createdAt));
}

export async function completeTask(taskId: string) {
  const [row] = await db
    .update(schema.botTasks)
    .set({ status: "DONE", completedAt: new Date().toISOString() })
    .where(eq(schema.botTasks.id, taskId))
    .returning();
  return row;
}

// ---------------------------------------------------------------
// Действия на подтверждении (денежные/ценовые команды)
// ---------------------------------------------------------------

export async function createPendingAction(input: {
  chatId: string;
  requestedByName: string;
  actionType: string;
  payload: unknown;
  summary: string;
}) {
  const [row] = await db
    .insert(schema.botPendingActions)
    .values({
      chatId: input.chatId,
      requestedByName: input.requestedByName,
      actionType: input.actionType,
      payload: JSON.stringify(input.payload),
      summary: input.summary,
    })
    .returning();
  return row;
}

export async function resolvePendingAction(id: string, status: "CONFIRMED" | "CANCELLED", byName: string) {
  const [row] = await db
    .update(schema.botPendingActions)
    .set({ status, resolvedAt: new Date().toISOString(), resolvedByName: byName })
    .where(and(eq(schema.botPendingActions.id, id), eq(schema.botPendingActions.status, "PENDING")))
    .returning();
  return row ?? null;
}

export async function getPendingAction(id: string) {
  const rows = await db.select().from(schema.botPendingActions).where(eq(schema.botPendingActions.id, id)).limit(1);
  return rows[0] ?? null;
}

