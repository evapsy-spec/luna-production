#!/usr/bin/env bash
# Луна-бот — установка каркаса. Запускать из корня репозитория:
#   cd ~/Downloads/luna-production && bash apply-luna-bot.sh
set -euo pipefail

if [ ! -f package.json ] || ! grep -q "luna-production" package.json; then
  echo "Похоже, вы не в корне репозитория luna-production. Перейдите туда (cd ~/Downloads/luna-production) и запустите снова." >&2
  exit 1
fi

if grep -q "botChats" src/lib/db/schema.ts 2>/dev/null; then
  echo "Похоже, это уже применялось раньше (botChats уже есть в schema.ts). Повторный запуск может задвоить код — прервано." >&2
  exit 1
fi

mkdir -p bot scripts deploy

echo 'Пишу bot/auth.ts...'
cat > bot/auth.ts <<'LUNA_BOT_EOF_BOT_AUTH_TS'
/**
 * Луна-бот — кто пишет боту и что ему можно.
 *
 * Все проверки идут по telegram user id из ctx.from.id — тому самому, что
 * Telegram присылает с каждым сообщением. Разрешение вопрос/действие
 * получает только тот, кто уже есть в bot_users (заводит туда Константин
 * вручную, см. README бота) — случайный человек, добавленный в группу,
 * получает вежливый отказ, а не тихо молчащего бота.
 */
import type { Context } from "grammy";
import { getBotUserByTelegramId, type BotUser } from "./db";

export async function resolveCaller(ctx: Context): Promise<BotUser | null> {
  const telegramId = ctx.from?.id;
  if (telegramId === undefined) return null;
  return getBotUserByTelegramId(String(telegramId));
}

export const NOT_RECOGNIZED_TEXT =
  "Я вас не узнаю — вашего Telegram-аккаунта нет в списке команды. " +
  "Попросите Константина добавить вас в bot_users.";

export const CANNOT_CONFIRM_MONEY_TEXT =
  "Подтверждать денежные и ценовые действия может только Константин или Ева.";

LUNA_BOT_EOF_BOT_AUTH_TS

echo 'Пишу bot/db.ts...'
cat > bot/db.ts <<'LUNA_BOT_EOF_BOT_DB_TS'
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

LUNA_BOT_EOF_BOT_DB_TS

echo 'Пишу bot/commands.ts...'
cat > bot/commands.ts <<'LUNA_BOT_EOF_BOT_COMMANDS_TS'
/**
 * Луна-бот — команды.
 *
 * Границы те же, что у MCP-коннектора и у всего проекта: читать можно
 * свободно (с поправкой на seesMoney), а цены, скидки, остатки, письма
 * клиентам, живой сайт и деньги меняет только человек — бот только готовит
 * действие и просит подтверждения инлайн-кнопкой (см. requestConfirmation).
 */
import { Bot, InlineKeyboard } from "grammy";
import { salesByMonth, productCard, ordersStatus } from "@/lib/reports";
import { getReplenish, LOW_STOCK_THRESHOLD } from "@/lib/replenish";
import { resolveCaller, NOT_RECOGNIZED_TEXT, CANNOT_CONFIRM_MONEY_TEXT } from "./auth";
import {
  logBotAudit,
  createTask,
  listOpenTasks,
  completeTask,
  listActiveBotUsers,
  createPendingAction,
  resolvePendingAction,
  getPendingAction,
} from "./db";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const HTML = { parse_mode: "HTML" as const };

export function registerCommands(bot: Bot): void {
  bot.command("start", async (ctx) => {
    const caller = await resolveCaller(ctx);
    if (!caller) {
      await ctx.reply(
        `Привет! ${NOT_RECOGNIZED_TEXT}\n\nВаш Telegram id: <code>${ctx.from?.id}</code> — ` +
          "перешлите его Константину, он добавит вас в bot_users.",
        HTML,
      );
      return;
    }
    await ctx.reply(
      `Привет, ${esc(caller.name)}! Я Луна-бот. Команды: /остатки, /продажи, /заказы, ` +
        "/задача, /задачи, /выполнено, /whoami.",
    );
    await logBotAudit({
      actorName: caller.name,
      action: "BOT_START",
      entityType: "bot_command",
      entityId: String(ctx.chat?.id ?? ""),
      entityName: "/start",
    });
  });

  bot.command("whoami", async (ctx) => {
    const caller = await resolveCaller(ctx);
    if (!caller) return ctx.reply(NOT_RECOGNIZED_TEXT);
    await ctx.reply(
      `Вы: ${esc(caller.name)}\n` +
        `Деньги видите: ${caller.seesMoney ? "да" : "нет"}\n` +
        `Подтверждаете денежные действия: ${caller.canConfirmMoney ? "да" : "нет"}`,
    );
  });

  bot.command("остатки", async (ctx) => {
    const caller = await resolveCaller(ctx);
    if (!caller) return ctx.reply(NOT_RECOGNIZED_TEXT);

    const query = ctx.match?.toString().trim();
    if (query) {
      const card = await productCard({ query, showMoney: caller.seesMoney });
      await ctx.reply(`<pre>${esc(JSON.stringify(card, null, 1))}</pre>`, HTML);
    } else {
      const data = await getReplenish({ excluded: "hide" });
      const rows = data.rows.slice(0, 20);
      const lines = rows.map((r) => {
        const stock = data.warehouses
          .map((w, i) => `${w.name}: ${r.cells[i]?.qty ?? "—"}`)
          .join(", ");
        return `• ${esc(r.sku)} (${esc(r.productName)}) — ${stock}`;
      });
      await ctx.reply(
        `Меньше ${LOW_STOCK_THRESHOLD} шт (первые ${rows.length} из ${data.totalActive}):\n` +
          (lines.join("\n") || "Пусто — ничего не заканчивается."),
      );
    }
    await logBotAudit({
      actorName: caller.name,
      action: "BOT_QUERY",
      entityType: "bot_command",
      entityId: String(ctx.chat?.id ?? ""),
      entityName: `/остатки ${query ?? ""}`.trim(),
    });
  });

  bot.command("продажи", async (ctx) => {
    const caller = await resolveCaller(ctx);
    if (!caller) return ctx.reply(NOT_RECOGNIZED_TEXT);
    const query = ctx.match?.toString().trim();
    const data = await salesByMonth({ sku: query || undefined, showMoney: caller.seesMoney });
    await ctx.reply(`<pre>${esc(JSON.stringify(data, null, 1).slice(0, 3500))}</pre>`, HTML);
    await logBotAudit({
      actorName: caller.name,
      action: "BOT_QUERY",
      entityType: "bot_command",
      entityId: String(ctx.chat?.id ?? ""),
      entityName: `/продажи ${query ?? ""}`.trim(),
    });
  });

  bot.command("заказы", async (ctx) => {
    const caller = await resolveCaller(ctx);
    if (!caller) return ctx.reply(NOT_RECOGNIZED_TEXT);
    const data = await ordersStatus({ showMoney: caller.seesMoney });
    await ctx.reply(`<pre>${esc(JSON.stringify(data, null, 1).slice(0, 3500))}</pre>`, HTML);
    await logBotAudit({
      actorName: caller.name,
      action: "BOT_QUERY",
      entityType: "bot_command",
      entityId: String(ctx.chat?.id ?? ""),
      entityName: "/заказы",
    });
  });

  // /задача Наталья заполнить листинг X к 28.08
  bot.command("задача", async (ctx) => {
    const caller = await resolveCaller(ctx);
    if (!caller) return ctx.reply(NOT_RECOGNIZED_TEXT);

    const text = ctx.match?.toString().trim();
    if (!text) {
      return ctx.reply("Формат: /задача Имя текст поручения [к ДД.ММ]");
    }
    const [nameGuess, ...rest] = text.split(" ");
    const description = rest.join(" ").trim();
    if (!description) {
      return ctx.reply("Формат: /задача Имя текст поручения [к ДД.ММ]");
    }

    const people = await listActiveBotUsers();
    const assignee = people.find(
      (p) => p.name.toLowerCase() === nameGuess.toLowerCase().replace(/^@/, ""),
    );

    const task = await createTask({
      chatId: String(ctx.chat?.id ?? ""),
      assignedToUserId: assignee?.id ?? null,
      assignedToName: assignee?.name ?? nameGuess,
      assignedByName: caller.name,
      description,
    });

    await ctx.reply(
      `Поручение №${task.id.slice(0, 8)} записано: ${esc(assignee?.name ?? nameGuess)} — ${esc(description)}`,
    );
    await logBotAudit({
      actorName: caller.name,
      action: "BOT_TASK_CREATE",
      entityType: "bot_task",
      entityId: task.id,
      entityName: description,
    });
  });

  bot.command("задачи", async (ctx) => {
    const caller = await resolveCaller(ctx);
    if (!caller) return ctx.reply(NOT_RECOGNIZED_TEXT);
    const tasks = await listOpenTasks(caller.id);
    if (tasks.length === 0) return ctx.reply("Открытых поручений на вас нет.");
    const lines = tasks.map((t) => `• №${t.id.slice(0, 8)} — ${esc(t.description)} (от ${esc(t.assignedByName)})`);
    await ctx.reply(lines.join("\n"));
  });

  bot.command("выполнено", async (ctx) => {
    const caller = await resolveCaller(ctx);
    if (!caller) return ctx.reply(NOT_RECOGNIZED_TEXT);
    const idPrefix = ctx.match?.toString().trim();
    if (!idPrefix) return ctx.reply("Формат: /выполнено <номер поручения>");

    const tasks = await listOpenTasks();
    const task = tasks.find((t) => t.id.startsWith(idPrefix));
    if (!task) return ctx.reply("Такое открытое поручение не найдено.");

    await completeTask(task.id);
    await ctx.reply(`Отмечено выполненным: ${esc(task.description)}`);
    await logBotAudit({
      actorName: caller.name,
      action: "BOT_TASK_DONE",
      entityType: "bot_task",
      entityId: task.id,
      entityName: task.description,
    });
  });

  /**
   * Пример механики подтверждения — на сегодня нет ни одного реального
   * денежного action_type (Shopify и финфайл ещё не подключены), поэтому
   * команды, которые бы его вызывали, пока нет. Это готовый обработчик
   * на будущее: requestConfirmation(...) → кнопки → callback_query ниже.
   */
  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    const [kind, id] = data.split(":");
    if (kind !== "confirm" && kind !== "cancel") return;

    const caller = await resolveCaller(ctx);
    if (!caller) return ctx.answerCallbackQuery({ text: NOT_RECOGNIZED_TEXT, show_alert: true });
    if (!caller.canConfirmMoney) {
      return ctx.answerCallbackQuery({ text: CANNOT_CONFIRM_MONEY_TEXT, show_alert: true });
    }

    const pending = await getPendingAction(id);
    if (!pending || pending.status !== "PENDING") {
      return ctx.answerCallbackQuery({ text: "Это действие уже закрыто.", show_alert: true });
    }

    const resolved = await resolvePendingAction(id, kind === "confirm" ? "CONFIRMED" : "CANCELLED", caller.name);
    if (!resolved) return ctx.answerCallbackQuery({ text: "Не удалось обновить." });

    await ctx.answerCallbackQuery({ text: kind === "confirm" ? "Подтверждено" : "Отменено" });
    await ctx.editMessageText(
      `${esc(pending.summary)}\n\n${kind === "confirm" ? "✅ Подтвердил" : "❌ Отменил"}: ${esc(caller.name)}`,
    );
    await logBotAudit({
      actorName: caller.name,
      action: kind === "confirm" ? "BOT_ACTION_CONFIRM" : "BOT_ACTION_CANCEL",
      entityType: "bot_pending_action",
      entityId: id,
      entityName: pending.summary,
    });
    // Реальное исполнение действия (payload) подключается здесь, когда
    // появится первая настоящая интеграция (Shopify/финфайл).
  });
}

/** Ставит денежное/ценовое действие на подтверждение — используется будущими командами. */
export async function requestConfirmation(
  bot: Bot,
  chatId: string,
  requestedByName: string,
  actionType: string,
  payload: unknown,
  summary: string,
): Promise<void> {
  const pending = await createPendingAction({ chatId, requestedByName, actionType, payload, summary });
  const kb = new InlineKeyboard()
    .text("✅ Подтверждаю", `confirm:${pending.id}`)
    .text("❌ Отмена", `cancel:${pending.id}`);
  await bot.api.sendMessage(chatId, `${esc(summary)}\n\nТребует подтверждения Константина или Евы.`, {
    reply_markup: kb,
    parse_mode: "HTML",
  });
}

LUNA_BOT_EOF_BOT_COMMANDS_TS

echo 'Пишу bot/digest.ts...'
cat > bot/digest.ts <<'LUNA_BOT_EOF_BOT_DIGEST_TS'
/**
 * Вечерняя сводка — личным сообщением каждому активному пользователю бота.
 * Условие из плана: получают все пятеро (Константин, Ева, Наталья, Ольга),
 * каждый должен один раз написать боту /start — иначе Telegram не даст
 * написать ему первым (ограничение самого API, не наше решение).
 *
 * Время задаётся в UTC переменными окружения BOT_DIGEST_HOUR_UTC /
 * BOT_DIGEST_MINUTE_UTC. По умолчанию 11:00 UTC = 18:00 по Таиланду.
 * Планировщик — обычный setInterval раз в минуту, без лишней зависимости:
 * объём и точность здесь не требуют полноценного cron.
 */
import type { Bot } from "grammy";
import { listActiveBotUsers, listOpenTasks, logBotAudit } from "./db";

const DIGEST_HOUR_UTC = Number(process.env.BOT_DIGEST_HOUR_UTC ?? 11);
const DIGEST_MINUTE_UTC = Number(process.env.BOT_DIGEST_MINUTE_UTC ?? 0);

let lastSentOn: string | null = null; // "YYYY-MM-DD" по UTC — не даёт отправить дважды в один день

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function sendDigestOnce(bot: Bot): Promise<void> {
  const people = await listActiveBotUsers();
  const allOpen = await listOpenTasks();

  for (const person of people) {
    const mine = allOpen.filter((t) => t.assignedToUserId === person.id);
    const lines: string[] = [`Вечерняя сводка, ${new Date().toISOString().slice(0, 10)}:`];

    if (mine.length === 0) {
      lines.push("На вас нет открытых поручений.");
    } else {
      lines.push(`Ваши открытые поручения (${mine.length}):`);
      for (const t of mine) lines.push(`• ${esc(t.description)} (от ${esc(t.assignedByName)})`);
    }

    if (allOpen.length > mine.length) {
      lines.push(`\nВсего открытых поручений по команде: ${allOpen.length}.`);
    }

    try {
      await bot.api.sendMessage(person.telegramUserId, lines.join("\n"));
    } catch (err) {
      // Частый случай — человек ни разу не написал боту /start, Telegram
      // такое сообщение отклоняет. Не роняем весь прогон из-за одного адресата.
      console.error(`[digest] не удалось написать ${person.name}:`, (err as Error).message);
    }
  }

  await logBotAudit({
    actorName: "Луна-бот",
    action: "BOT_DIGEST_SENT",
    entityType: "bot_digest",
    entityId: new Date().toISOString().slice(0, 10),
    entityName: `Вечерняя сводка, получателей: ${people.length}`,
  });
}

export function startDigestScheduler(bot: Bot): void {
  setInterval(() => {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    if (now.getUTCHours() === DIGEST_HOUR_UTC && now.getUTCMinutes() === DIGEST_MINUTE_UTC && lastSentOn !== today) {
      lastSentOn = today;
      sendDigestOnce(bot).catch((err) => console.error("[digest] ошибка отправки:", err));
    }
  }, 60_000);
  console.log(
    `[digest] запланирована на ${String(DIGEST_HOUR_UTC).padStart(2, "0")}:${String(DIGEST_MINUTE_UTC).padStart(2, "0")} UTC ежедневно`,
  );
}

LUNA_BOT_EOF_BOT_DIGEST_TS

echo 'Пишу bot/server.ts...'
cat > bot/server.ts <<'LUNA_BOT_EOF_BOT_SERVER_TS'
/**
 * Луна-бот — Telegram-бот Luna Production (long polling, не webhook — не
 * нужен публичный адрес и меньше поверхности для атаки).
 *
 * Границы те же, что у mcp/server.ts: читать можно свободно (с поправкой на
 * то, что видит конкретный человек — botUsers.seesMoney), а денежные и
 * ценовые действия исполняются только после подтверждения инлайн-кнопкой
 * (см. bot/commands.ts, requestConfirmation).
 *
 * /health на отдельном локальном порту — за ним следит watchdog
 * (scripts/bot-watchdog.ts + systemd-таймер), не Caddy: наружу этот порт не
 * выставлен, снаружи бота не трогают вообще, только Telegram long polling.
 *
 * Запуск: npm run bot   (systemd-юнит luna-bot)
 */
import express from "express";
import { Bot } from "grammy";
import { registerCommands } from "./commands";
import { startDigestScheduler } from "./digest";

const TOKEN = (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
const HEALTH_PORT = Number(process.env.BOT_HEALTH_PORT ?? 3200);
const HEALTH_HOST = process.env.BOT_HEALTH_HOST ?? "127.0.0.1";

if (!TOKEN) {
  console.error(
    "TELEGRAM_BOT_TOKEN не задан. Получить у @BotFather и добавить в .env:\n" +
      "  TELEGRAM_BOT_TOKEN=...\n" +
      "Секрет вставляет только человек, не Луна.",
  );
  process.exit(1);
}

const bot = new Bot(TOKEN);

registerCommands(bot);

bot.catch((err) => {
  console.error("[bot] необработанная ошибка обработчика:", err.error);
});

async function main() {
  const me = await bot.api.getMe();
  console.log(`[bot] запускаюсь как @${me.username} (long polling)`);

  startDigestScheduler(bot);

  // health-эндпоинт поднимаем до старта поллинга, чтобы watchdog видел
  // процесс живым даже в момент подключения к Telegram.
  const app = express();
  app.get("/health", (_req, res) => res.json({ ok: true, service: "luna-bot", username: me.username }));
  app.listen(HEALTH_PORT, HEALTH_HOST, () => {
    console.log(`[bot] health на http://${HEALTH_HOST}:${HEALTH_PORT}/health`);
  });

  await bot.start({
    onStart: () => console.log("[bot] long polling запущен"),
  });
}

main().catch((err) => {
  console.error("[bot] фатальная ошибка запуска:", err);
  process.exit(1);
});

LUNA_BOT_EOF_BOT_SERVER_TS

echo 'Пишу scripts/bot-watchdog.ts...'
cat > scripts/bot-watchdog.ts <<'LUNA_BOT_EOF_SCRIPTS_BOT_WATCHDOG_TS'
/**
 * Watchdog Луна-бота — отдельный процесс, не зависящий от самого бота:
 * если бот завис или упал, этот скрипт должен суметь сообщить об этом сам,
 * поэтому шлёт сообщение через HTTPS Bot API напрямую (это просто POST-запрос,
 * не зависит от того, жив ли наш long polling).
 *
 * Проверяет два признака: (1) systemd-юнит luna-bot активен; (2) health-порт
 * отвечает. Алерт шлётся один раз на весь простой (маркер-файл), и один раз —
 * сообщение о восстановлении, чтобы не заваливать чат повторами при каждом
 * запуске таймера.
 *
 * Запуск по таймеру (не постоянный процесс): systemd-юнит luna-bot-watchdog
 * + luna-bot-watchdog.timer, см. deploy/.
 */
import { execSync } from "node:child_process";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";

const TOKEN = (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
const HEALTH_URL = process.env.BOT_HEALTH_URL ?? "http://127.0.0.1:3200/health";
const MARKER_PATH = process.env.BOT_WATCHDOG_MARKER ?? "/srv/luna-data/.bot-watchdog-alerted";
// Кому слать алерт — telegram user id через запятую. Не решено окончательно
// (см. claude/luna-telegram-bot-plan.md, «Открытые вопросы») — Константин
// вписывает сюда себя и/или Еву сам.
const ALERT_CHAT_IDS = (process.env.BOT_WATCHDOG_ALERT_CHAT_IDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function isServiceActive(): boolean {
  try {
    const out = execSync("systemctl is-active luna-bot", { encoding: "utf8" }).trim();
    return out === "active";
  } catch {
    return false; // is-active выходит с кодом != 0, если юнит не active
  }
}

async function isHealthy(): Promise<boolean> {
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false;
  }
}

async function alert(text: string): Promise<void> {
  if (!TOKEN || ALERT_CHAT_IDS.length === 0) {
    console.error("[watchdog] нет TELEGRAM_BOT_TOKEN или BOT_WATCHDOG_ALERT_CHAT_IDS — некому слать:", text);
    return;
  }
  for (const chatId of ALERT_CHAT_IDS) {
    try {
      await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
    } catch (err) {
      console.error(`[watchdog] не смог отправить алерт в ${chatId}:`, (err as Error).message);
    }
  }
}

async function main() {
  const active = isServiceActive();
  const healthy = active && (await isHealthy());
  const wasAlerted = existsSync(MARKER_PATH);

  if (!healthy) {
    console.error(`[watchdog] проблема: systemd active=${active}, health=${healthy}`);
    if (!wasAlerted) {
      await alert(
        `⚠️ Луна-бот не отвечает (systemd active=${active}, health=${healthy}). ` +
          "Проверить: ssh luna, journalctl -u luna-bot -n 50 --no-pager",
      );
      writeFileSync(MARKER_PATH, new Date().toISOString());
    }
  } else {
    console.log("[watchdog] всё в порядке");
    if (wasAlerted) {
      await alert("✅ Луна-бот снова в порядке.");
      unlinkSync(MARKER_PATH);
    }
  }
}

main().catch((err) => {
  console.error("[watchdog] фатальная ошибка:", err);
  process.exit(1);
});

LUNA_BOT_EOF_SCRIPTS_BOT_WATCHDOG_TS

echo 'Пишу scripts/bot-add-user.ts...'
cat > scripts/bot-add-user.ts <<'LUNA_BOT_EOF_SCRIPTS_BOT_ADD_USER_TS'
/**
 * Добавляет/обновляет человека в bot_users — без этого бот отвечает
 * "не узнаю" и не может написать первым (Telegram не разрешает).
 *
 * Порядок: человек пишет боту /start → бот присылает его telegram id →
 * Константин запускает эту команду с этим id.
 *
 * Запуск:
 *   npm run bot:add-user -- 123456789 "Наталья" --no-money
 *   npm run bot:add-user -- 987654321 "Ольга"
 *   npm run bot:add-user -- 111111111 "Константин" --confirm-money
 *
 * Флаги: --no-money (seesMoney=false, сейчас только для Натальи),
 *        --confirm-money (canConfirmMoney=true, сейчас только Константин и Ева).
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";

async function main() {
  const [telegramUserId, name, ...flags] = process.argv.slice(2);
  if (!telegramUserId || !name) {
    console.error('Формат: tsx scripts/bot-add-user.ts <telegram_id> "<Имя>" [--no-money] [--confirm-money]');
    process.exit(1);
  }

  const seesMoney = !flags.includes("--no-money");
  const canConfirmMoney = flags.includes("--confirm-money");

  const existing = await db
    .select()
    .from(schema.botUsers)
    .where(eq(schema.botUsers.telegramUserId, telegramUserId))
    .limit(1);

  if (existing[0]) {
    await db
      .update(schema.botUsers)
      .set({ name, seesMoney, canConfirmMoney, isActive: true })
      .where(eq(schema.botUsers.telegramUserId, telegramUserId));
    console.log(`Обновлено: ${name} (${telegramUserId}), деньги: ${seesMoney}, подтверждение: ${canConfirmMoney}`);
  } else {
    await db.insert(schema.botUsers).values({ telegramUserId, name, seesMoney, canConfirmMoney });
    console.log(`Добавлено: ${name} (${telegramUserId}), деньги: ${seesMoney}, подтверждение: ${canConfirmMoney}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

LUNA_BOT_EOF_SCRIPTS_BOT_ADD_USER_TS

echo 'Пишу deploy/luna-bot.service...'
cat > deploy/luna-bot.service <<'LUNA_BOT_EOF_DEPLOY_LUNA_BOT_SERVICE'
[Unit]
Description=Луна-бот (Telegram, long polling)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=luna
Group=luna
WorkingDirectory=/srv/luna
EnvironmentFile=/srv/luna/.env
Environment=NODE_ENV=production
Environment=BOT_HEALTH_PORT=3200
Environment=BOT_HEALTH_HOST=127.0.0.1
ExecStart=/srv/luna/node_modules/.bin/tsx bot/server.ts
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=luna-bot

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=read-only
ReadWritePaths=/srv/luna /srv/luna-data

[Install]
WantedBy=multi-user.target

LUNA_BOT_EOF_DEPLOY_LUNA_BOT_SERVICE

echo 'Пишу deploy/luna-bot-watchdog.service...'
cat > deploy/luna-bot-watchdog.service <<'LUNA_BOT_EOF_DEPLOY_LUNA_BOT_WATCHDOG_SERVICE'
[Unit]
Description=Watchdog Луна-бота (разовая проверка, запускается таймером)
After=network-online.target

[Service]
Type=oneshot
User=luna
Group=luna
WorkingDirectory=/srv/luna
EnvironmentFile=/srv/luna/.env
ExecStart=/srv/luna/node_modules/.bin/tsx scripts/bot-watchdog.ts

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=read-only
ReadWritePaths=/srv/luna /srv/luna-data

LUNA_BOT_EOF_DEPLOY_LUNA_BOT_WATCHDOG_SERVICE

echo 'Пишу deploy/luna-bot-watchdog.timer...'
cat > deploy/luna-bot-watchdog.timer <<'LUNA_BOT_EOF_DEPLOY_LUNA_BOT_WATCHDOG_TIMER'
[Unit]
Description=Проверять Луна-бота каждые 10 минут

[Timer]
OnBootSec=2min
OnUnitActiveSec=10min
Persistent=true

[Install]
WantedBy=timers.target

LUNA_BOT_EOF_DEPLOY_LUNA_BOT_WATCHDOG_TIMER

echo 'Дописываю src/lib/db/schema.ts...'
cat >> src/lib/db/schema.ts <<'LUNA_BOT_EOF_SCHEMA_ADDITION_TS'

// ============================================================
// ЛУНА-БОТ (Telegram) — добавлено 25.08.2026
// ============================================================

/** Категории чатов, где присутствует бот. FACTORY заложена на будущее. */
export const BOT_CHAT_TYPES = ["TEAM", "DESIGNER", "FACTORY"] as const;
export type BotChatType = (typeof BOT_CHAT_TYPES)[number];

/**
 * Каталог чатов бота — какой чат, какого типа, и для DESIGNER — какой бренд.
 * Заполняется вручную командой /привязать_чат или напрямую в базе; источник —
 * Excel-каталог чатов, который ведёт Ева.
 */
export const botChats = sqliteTable("bot_chats", {
  id: id(),
  chatId: text("chat_id").notNull().unique(), // telegram chat id (у групп отрицательный)
  title: text("title").notNull(), // название группы в Telegram на момент привязки
  chatType: text("chat_type").notNull(), // TEAM | DESIGNER | FACTORY
  brandName: text("brand_name"), // для DESIGNER — бренд/поставщик из каталога Ainur
  payerName: text("payer_name"), // юр.лицо для банка, если известно
  currency: text("currency"),
  notes: text("notes"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: now(),
});

/**
 * Люди, которые могут писать боту в личку и получать от него сообщения.
 * seesMoney=false — единственное ограничение по деньгам (Наталья), см.
 * claude/luna-telegram-bot-plan.md, раздел «Ещё три решения».
 * canConfirmMoney — уже отдельно: подтверждать денежные/ценовые действия
 * (и запись в финфайл) может только Константин и Ева, даже если видеть суммы
 * может и Ольга — это разные права, путать нельзя.
 */
export const botUsers = sqliteTable("bot_users", {
  id: id(),
  telegramUserId: text("telegram_user_id").notNull().unique(),
  telegramUsername: text("telegram_username"),
  name: text("name").notNull(), // Константин / Ева / Ольга / Наталья
  seesMoney: integer("sees_money", { mode: "boolean" }).notNull().default(true),
  canConfirmMoney: integer("can_confirm_money", { mode: "boolean" }).notNull().default(false),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: now(),
});

/** Явные команды-поручения через /задача — без угадывания из свободной переписки. */
export const BOT_TASK_STATUSES = ["OPEN", "DONE", "CANCELLED"] as const;
export type BotTaskStatus = (typeof BOT_TASK_STATUSES)[number];

export const botTasks = sqliteTable(
  "bot_tasks",
  {
    id: id(),
    chatId: text("chat_id").notNull(), // где создана
    assignedToUserId: text("assigned_to_user_id").references(() => botUsers.id, {
      onDelete: "set null",
    }),
    assignedToName: text("assigned_to_name").notNull(), // на случай если исполнитель ещё не писал /start
    assignedByName: text("assigned_by_name").notNull(),
    description: text("description").notNull(),
    dueAt: text("due_at"),
    status: text("status").notNull().default("OPEN"),
    createdAt: now(),
    completedAt: text("completed_at"),
  },
  (t) => [
    index("bot_tasks_status_idx").on(t.status),
    index("bot_tasks_assignee_idx").on(t.assignedToUserId),
  ],
);

export const botTasksRelations = relations(botTasks, ({ one }) => ({
  assignedTo: one(botUsers, {
    fields: [botTasks.assignedToUserId],
    references: [botUsers.id],
  }),
}));

/**
 * Денежные/ценовые действия по команде в боте — исполняются только после
 * явного подтверждения инлайн-кнопкой («LUNA рекомендует, человек делает»).
 * Пока нет ни одного реального action_type: запись цены в Shopify и запись в
 * финфайл ждут своих интеграций (см. открытые вопросы в плане). Таблица и
 * обработчик готовы, чтобы подключить их без переделки бота.
 */
export const BOT_PENDING_STATUSES = ["PENDING", "CONFIRMED", "CANCELLED", "EXPIRED"] as const;
export type BotPendingStatus = (typeof BOT_PENDING_STATUSES)[number];

export const botPendingActions = sqliteTable("bot_pending_actions", {
  id: id(),
  chatId: text("chat_id").notNull(),
  requestedByName: text("requested_by_name").notNull(),
  actionType: text("action_type").notNull(), // например PRICE_CHANGE, FINANCE_ENTRY
  payload: text("payload").notNull(), // JSON с деталями действия
  summary: text("summary").notNull(), // человекочитаемый текст на кнопке подтверждения
  status: text("status").notNull().default("PENDING"),
  createdAt: now(),
  resolvedAt: text("resolved_at"),
  resolvedByName: text("resolved_by_name"),
});

LUNA_BOT_EOF_SCHEMA_ADDITION_TS

echo 'Дописываю .env.example...'
cat >> .env.example <<'LUNA_BOT_ENV_EOF'

# Луна-бот (Telegram)
# Токен от @BotFather — вставить самому, не через Луну
TELEGRAM_BOT_TOKEN=
BOT_HEALTH_PORT=3200
BOT_HEALTH_HOST=127.0.0.1
# Время вечерней сводки, UTC. По умолчанию 11:00 UTC = 18:00 по Таиланду
BOT_DIGEST_HOUR_UTC=11
BOT_DIGEST_MINUTE_UTC=0
# Watchdog: кому слать алерт, telegram user id через запятую
BOT_WATCHDOG_ALERT_CHAT_IDS=
BOT_HEALTH_URL=http://127.0.0.1:3200/health
LUNA_BOT_ENV_EOF

echo 'Добавляю npm-скрипты...'
npm pkg set scripts.bot="tsx --env-file=.env bot/server.ts"
npm pkg set scripts.bot:watchdog="tsx --env-file=.env scripts/bot-watchdog.ts"
npm pkg set "scripts.bot:add-user"="tsx --env-file=.env scripts/bot-add-user.ts"

echo 'Ставлю зависимость grammy...'
npm install grammy

echo 'Готовлю миграцию БД (drizzle-kit generate)...'
npm run db:generate

echo 'Применяю миграцию к локальной базе...'
npm run db:migrate

echo
echo 'Готово. Дальше:'
echo '  git add -A'
echo '  git commit -m "Луна-бот: каркас (long polling, задачи, роли, watchdog)"'
echo '  git push server main'
echo '  ssh luna "cd /srv/luna && ./deploy.sh"'
echo
echo 'Первый раз на сервере ещё нужно (см. подробную инструкцию):'
echo '  - скопировать deploy/luna-bot*.service и .timer в /etc/systemd/system'
echo '  - вписать TELEGRAM_BOT_TOKEN в /srv/luna/.env'
echo '  - systemctl daemon-reload && systemctl enable --now luna-bot luna-bot-watchdog.timer'
