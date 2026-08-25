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

