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

const DATA_TIMEOUT_MS = 10_000;

/**
 * На сервере /заказы (и потенциально другие команды с данными) иногда
 * зависают намертво без единой ошибки в логе — похоже на конфликт при
 * обращении к SQLite из отдельного процесса бота, пока не выяснили причину
 * до конца. Пока не разобрались — оборачиваем в таймаут, чтобы бот отвечал
 * человеку вместо вечного молчания.
 */
function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`[timeout] ${label} не ответил за ${DATA_TIMEOUT_MS / 1000}с`)), DATA_TIMEOUT_MS),
    ),
  ]);
}

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
    try {
      if (query) {
        const card = await withTimeout(productCard({ query, showMoney: caller.seesMoney }), "/остатки");
        await ctx.reply(`<pre>${esc(JSON.stringify(card, null, 1))}</pre>`, HTML);
      } else {
        const data = await withTimeout(getReplenish({ excluded: "hide" }), "/остатки");
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
    } catch (err) {
      console.error("[bot] /остатки не ответил:", err);
      return ctx.reply("Не получилось получить данные (сервер не ответил вовремя). Попробуйте ещё раз чуть позже.");
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
    try {
      const data = await withTimeout(
        salesByMonth({ sku: query || undefined, showMoney: caller.seesMoney }),
        "/продажи",
      );
      await ctx.reply(`<pre>${esc(JSON.stringify(data, null, 1).slice(0, 3500))}</pre>`, HTML);
    } catch (err) {
      console.error("[bot] /продажи не ответил:", err);
      return ctx.reply("Не получилось получить данные (сервер не ответил вовремя). Попробуйте ещё раз чуть позже.");
    }
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
    try {
      const data = await withTimeout(ordersStatus({ showMoney: caller.seesMoney }), "/заказы");
      await ctx.reply(`<pre>${esc(JSON.stringify(data, null, 1).slice(0, 3500))}</pre>`, HTML);
    } catch (err) {
      console.error("[bot] /заказы не ответил:", err);
      return ctx.reply("Не получилось получить данные (сервер не ответил вовремя). Попробуйте ещё раз чуть позже.");
    }
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
