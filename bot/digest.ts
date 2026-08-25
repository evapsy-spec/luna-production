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

