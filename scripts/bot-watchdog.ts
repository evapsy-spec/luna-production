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

