/**
 * Ночная синхронизация с Ainur. Запускается таймером systemd (luna-sync.timer),
 * а не человеком.
 *
 * Запуск: npm run sync:scheduled
 * ВАЖНО: только через npm-скрипт, там прописан --env-file=.env. Без него
 * DATABASE_FILE не подхватится и скрипт молча уйдёт в ./luna.db.
 *
 * Коды выхода важны — по ним systemd решает, ругаться в журнал или нет:
 *   0 — отработала, или сознательно ничего не делала (выключено, занято)
 *   1 — реальная беда: нет токена, шаг синхронизации упал
 */
import { syncAll } from "../src/lib/ainur/sync";
import { getTokenInfo } from "../src/lib/ainur/token";
import { acquireSyncLock, releaseSyncLock, describeAge } from "../src/lib/ainur/lock";
import { readSchedule, describeSchedule } from "../src/lib/ainur/schedule";
import {
  saveLastSyncResult,
  SCHEDULED_ACTOR,
  type StoredResult,
} from "../src/lib/ainur/last-result";

function stamp(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}
function say(line: string): void {
  console.log(`[${stamp()}] ${line}`);
}

async function main(): Promise<number> {
  const schedule = await readSchedule();
  say(`расписание: ${describeSchedule(schedule)}`);

  if (!schedule.enabled) {
    say("автосинхронизация выключена в настройках — выхожу, ничего не делаю");
    return 0;
  }

  const token = await getTokenInfo();
  if (!token.configured) {
    console.error(
      "Токен Ainur не задан. Его вставляют руками на странице «Синхронизация» — " +
        "скрипт этого делать не должен и не будет.",
    );
    return 1;
  }
  say(`токен: ${token.masked} (${token.source === "app" ? "из приложения" : "из окружения"})`);

  /**
   * Блокировка. Если Ева в этот момент нажала «Обновить» — молча уходим:
   * данные всё равно свежие, а два прогона разом дадут 429 от Ainur.
   * Это не ошибка, поэтому код выхода 0.
   */
  const attempt = acquireSyncLock(SCHEDULED_ACTOR);
  if (!attempt.ok) {
    say(
      `синхронизация уже идёт (запустил: ${attempt.heldBy}, ` +
        `${describeAge(attempt.ageMs)} назад) — не мешаю, выхожу`,
    );
    return 0;
  }
  if (attempt.stolenFrom) {
    say(
      `подобрала брошенную блокировку от «${attempt.stolenFrom}» — ` +
        `видимо, тот процесс упал, не сняв её`,
    );
  }

  const stored: StoredResult = {
    at: new Date().toISOString(),
    actor: SCHEDULED_ACTOR,
    label: `По расписанию, продажи за ${schedule.salesDays} дн.`,
    results: [],
  };

  try {
    const salesFrom = new Date(
      Date.now() - schedule.salesDays * 24 * 3600 * 1000,
    ).toISOString();

    say(
      `начинаю: продажи с ${salesFrom.slice(0, 10)}, ` +
        `пауза между шагами ${schedule.stepDelaySec} с`,
    );

    stored.results = await syncAll(SCHEDULED_ACTOR, {
      salesFrom,
      stepDelayMs: schedule.stepDelaySec * 1000,
    });
  } catch (err) {
    stored.error = (err as Error).message;
    say(`синхронизация упала целиком: ${stored.error}`);
  } finally {
    // Снимаем блокировку в любом случае, иначе следующая ночь встанет
    releaseSyncLock(attempt.lock);
    await saveLastSyncResult(stored);
  }

  say("итог:");
  for (const r of stored.results) {
    say(
      `  ${r.ok ? "OK  " : "СБОЙ"} ${r.kind.padEnd(10)} ` +
        `прочитано ${String(r.itemsRead).padStart(6)} · ` +
        `записано ${String(r.itemsWritten).padStart(6)} · ` +
        `${(r.durationMs / 1000).toFixed(1)} с`,
    );
    if (r.error) say(`       ошибка: ${r.error}`);
    for (const d of r.details.slice(0, 6)) say(`       · ${d}`);
  }

  const bad = stored.results.filter((r) => !r.ok).map((r) => r.kind);
  if (stored.error || bad.length > 0) {
    console.error(
      stored.error
        ? `ПРОВАЛ: ${stored.error}`
        : `ПРОВАЛ на шагах: ${bad.join(", ")}`,
    );
    return 1;
  }

  say("готово, всё чисто");
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error("Скрипт синхронизации упал:", e);
    process.exit(1);
  });
