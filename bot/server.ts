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

