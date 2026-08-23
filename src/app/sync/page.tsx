import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { getCurrentUser, requireOwner, requireUser, writeAudit } from "@/lib/auth";
import { ainurClient, getTokenInfo, isAinurReady, setAinurToken, clearAinurToken } from "@/lib/ainur/token";
import {
  getLastSyncTimes,
  syncAll,
  syncProducts,
  syncSales,
  syncStores,
  type SyncResult,
} from "@/lib/ainur/sync";
import {
  acquireSyncLock,
  releaseSyncLock,
  currentSyncLock,
  describeAge,
  type LockAttempt,
} from "@/lib/ainur/lock";
import {
  readSchedule,
  writeSchedule,
  nextRunAt,
  describeSchedule,
  describeUntil,
} from "@/lib/ainur/schedule";
import {
  saveLastSyncResult,
  readLastSyncResult,
  SCHEDULED_ACTOR,
  type StoredResult,
} from "@/lib/ainur/last-result";
import { SubmitButton } from "@/components/submit-button";
import {
  Callout,
  Card,
  Field,
  Input,
  PageHeader,
  SectionTitle,
  Select,
  StatusPill,
  Table,
  Td,
  Th,
  formatDateTime,
  type StatusTone,
} from "@/components/ui";

export const metadata = { title: "Синхронизация с Ainur — Luna Production" };

const KIND_RU: Record<string, string> = {
  products: "Товары и остатки",
  sales: "Продажи",
  movements: "Перемещения между складами",
  stores: "Склады",
};

const SALES_PERIODS = [30, 60, 90, 180] as const;

function kindLabel(kind: string): string {
  return KIND_RU[kind] ?? kind;
}

function statusTone(status: string): StatusTone {
  if (status === "OK") return "ok";
  if (status === "ERROR") return "critical";
  if (status === "RUNNING") return "warn";
  return "neutral";
}

function statusLabel(status: string): string {
  if (status === "OK") return "успешно";
  if (status === "ERROR") return "ошибка";
  if (status === "RUNNING") return "идёт";
  return status;
}

function seconds(ms: number): string {
  if (ms < 1000) return `${ms} мс`;
  return `${(ms / 1000).toFixed(1)} с`;
}

function durationBetween(from: string, to: string | null): string {
  if (!to) return "—";
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  return seconds(ms);
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
}

// ============================================================
// SERVER ACTIONS — синхронизация запускается только руками, по кнопке
// ============================================================

/**
 * Берёт блокировку или уводит пользователя на страницу с объяснением.
 *
 * Блокировка общая с ночным таймером и живёт в базе: два прогона одновременно
 * означают 429 от Ainur, а это мы уже проходили. Кнопка сама по себе от второго
 * нажатия защищена (SubmitButton её гасит), но это не спасает от двух вкладок,
 * двух людей и совпадения с ночным прогоном.
 */
function takeLockOrBail(holder: string): Extract<LockAttempt, { ok: true }> {
  const attempt = acquireSyncLock(holder);
  if (!attempt.ok) {
    redirect(
      `/sync?busy=1&who=${encodeURIComponent(attempt.heldBy)}` +
        `&age=${encodeURIComponent(describeAge(attempt.ageMs))}`,
    );
  }
  return attempt;
}

async function checkConnection() {
  "use server";
  await requireUser();

  let query = "ping=error&message=" + encodeURIComponent("не удалось проверить");
  try {
    const result = await (await ainurClient()).ping();
    query = result.ok
      ? `ping=ok&message=${encodeURIComponent(result.company ?? "подключение работает")}`
      : `ping=error&message=${encodeURIComponent((result.error ?? "").slice(0, 300))}`;
  } catch (err) {
    // без токена клиент бросает исключение уже в конструкторе — страница не должна падать
    query = `ping=error&message=${encodeURIComponent((err as Error).message.slice(0, 300))}`;
  }

  revalidatePath("/sync");
  redirect(`/sync?${query}`);
}

/**
 * Сохраняет токен Ainur, введённый в интерфейсе.
 * Сам токен в аудит-лог не пишем — только факт изменения.
 */
async function saveToken(formData: FormData) {
  "use server";
  const user = await requireOwner();

  const token = String(formData.get("token") ?? "").trim();
  if (!token) {
    redirect("/sync?ping=error&message=" + encodeURIComponent("Пустой токен"));
  }
  if (!token.startsWith("sk_")) {
    redirect(
      "/sync?ping=error&message=" +
        encodeURIComponent(
          "Похоже, это не токен Ainur — он начинается с sk_. Скопируйте значение целиком.",
        ),
    );
  }

  await setAinurToken(token);
  await writeAudit(user, {
    action: "UPDATE",
    entityType: "Setting",
    entityId: "ainur_api_token",
    entityName: "Токен Ainur обновлён",
  });

  // сразу проверяем, что токен рабочий — иначе Ева узнает об этом только
  // при первой синхронизации
  let query = "saved=1";
  try {
    const result = await (await ainurClient()).ping();
    query = result.ok
      ? `saved=1&ping=ok&message=${encodeURIComponent(result.company ?? "подключение работает")}`
      : `saved=1&ping=error&message=${encodeURIComponent((result.error ?? "").slice(0, 300))}`;
  } catch (err) {
    query = `saved=1&ping=error&message=${encodeURIComponent((err as Error).message.slice(0, 300))}`;
  }

  revalidatePath("/sync");
  revalidatePath("/");
  redirect(`/sync?${query}`);
}

async function removeToken() {
  "use server";
  const user = await requireOwner();
  await clearAinurToken();
  await writeAudit(user, {
    action: "DELETE",
    entityType: "Setting",
    entityId: "ainur_api_token",
    entityName: "Токен Ainur удалён",
  });
  revalidatePath("/sync");
  revalidatePath("/");
  redirect("/sync?removed=1");
}

async function runEverything() {
  "use server";
  const user = await requireUser();
  const lock = takeLockOrBail(user.name);
  const stored: StoredResult = {
    at: new Date().toISOString(),
    actor: user.name,
    label: "Обновить всё",
    results: [],
  };

  try {
    stored.results = await syncAll(user.name);
  } catch (err) {
    stored.error = (err as Error).message;
  } finally {
    releaseSyncLock(lock.lock);
  }

  await saveLastSyncResult(stored);
  await writeAudit(user, {
    action: "SYNC",
    entityType: "Ainur",
    entityId: "all",
    entityName: "Обновить всё",
  });
  revalidatePath("/sync");
  redirect("/sync?ran=1");
}

async function runProducts() {
  "use server";
  const user = await requireUser();
  const lock = takeLockOrBail(user.name);
  const stored: StoredResult = {
    at: new Date().toISOString(),
    actor: user.name,
    label: "Только товары и остатки",
    results: [],
  };

  try {
    stored.results = [await syncProducts(await ainurClient(), user.name)];
  } catch (err) {
    stored.error = (err as Error).message;
  } finally {
    releaseSyncLock(lock.lock);
  }

  await saveLastSyncResult(stored);
  await writeAudit(user, {
    action: "SYNC",
    entityType: "Ainur",
    entityId: "products",
    entityName: "Товары и остатки",
  });
  revalidatePath("/sync");
  redirect("/sync?ran=1");
}

async function runSales(formData: FormData) {
  "use server";
  const user = await requireUser();
  const raw = Number(formData.get("days"));
  const days = SALES_PERIODS.includes(raw as (typeof SALES_PERIODS)[number])
    ? raw
    : 60;

  const lock = takeLockOrBail(user.name);
  const stored: StoredResult = {
    at: new Date().toISOString(),
    actor: user.name,
    label: `Только продажи за ${days} дней`,
    results: [],
  };

  try {
    stored.results = [
      await syncSales(await ainurClient(), { from: isoDaysAgo(days) }, user.name),
    ];
  } catch (err) {
    stored.error = (err as Error).message;
  } finally {
    releaseSyncLock(lock.lock);
  }

  await saveLastSyncResult(stored);
  await writeAudit(user, {
    action: "SYNC",
    entityType: "Ainur",
    entityId: "sales",
    entityName: `Продажи за ${days} дней`,
  });
  revalidatePath("/sync");
  redirect("/sync?ran=1");
}

async function runStores() {
  "use server";
  const user = await requireUser();
  const lock = takeLockOrBail(user.name);
  const stored: StoredResult = {
    at: new Date().toISOString(),
    actor: user.name,
    label: "Только склады",
    results: [],
  };

  try {
    stored.results = [await syncStores(await ainurClient(), user.name)];
  } catch (err) {
    stored.error = (err as Error).message;
  } finally {
    releaseSyncLock(lock.lock);
  }

  await saveLastSyncResult(stored);
  await writeAudit(user, {
    action: "SYNC",
    entityType: "Ainur",
    entityId: "stores",
    entityName: "Склады",
  });
  revalidatePath("/sync");
  redirect("/sync?ran=1");
}

/**
 * Включает и выключает автосинхронизацию.
 *
 * Выключатель живёт в базе, а не в юните systemd: таймер всё равно проснётся,
 * но скрипт прочитает настройку и тихо выйдет. Так расписание можно погасить
 * из приложения, не заходя на сервер по ssh — и, что важнее, не имея на это прав.
 * Право менять — только у владельцев.
 */
async function toggleSchedule() {
  "use server";
  const user = await requireOwner();
  const current = await readSchedule();
  const next = { ...current, enabled: !current.enabled };
  await writeSchedule(next);
  await writeAudit(user, {
    action: "SYNC",
    entityType: "Ainur",
    entityId: "schedule",
    entityName: next.enabled
      ? "Автосинхронизация включена"
      : "Автосинхронизация выключена",
  });
  revalidatePath("/sync");
  redirect(next.enabled ? "/sync?schedule=on" : "/sync?schedule=off");
}

// ============================================================
// СТРАНИЦА
// ============================================================

export default async function SyncPage({
  searchParams,
}: {
  searchParams: Promise<{
    ping?: string;
    message?: string;
    ran?: string;
    saved?: string;
    removed?: string;
    busy?: string;
    who?: string;
    age?: string;
    schedule?: string;
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const tokenInfo = await getTokenInfo();
  const configured = tokenInfo.configured;

  const lastTimes = await getLastSyncTimes();

  const lastResult = await readLastSyncResult();

  const schedule = await readSchedule();
  const nextRun = nextRunAt(schedule);
  const runningNow = currentSyncLock();
  const isOwner = user.role === "OWNER";

  /**
   * Последний прогон именно по расписанию. Нужен отдельно от «последнего
   * запуска вообще»: если Ева нажимала кнопку днём, её запуск затрёт вид,
   * и вопрос «а ночью-то оно сработало само?» останется без ответа.
   */
  const lastScheduled = await db
    .select()
    .from(schema.syncRuns)
    .where(eq(schema.syncRuns.triggeredBy, SCHEDULED_ACTOR))
    .orderBy(desc(schema.syncRuns.startedAt))
    .limit(1);
  const lastNight = lastScheduled[0] ?? null;

  const history = await db
    .select()
    .from(schema.syncRuns)
    .orderBy(desc(schema.syncRuns.startedAt))
    .limit(20);

  return (
    <>
      <PageHeader
        title="Синхронизация с Ainur"
        subtitle="Каждое утро сама, плюс кнопка в любой момент. Два прогона одновременно невозможны."
      />

      <SectionTitle>Подключение к Ainur</SectionTitle>

      {params.saved ? (
        <Callout tone="ok" title="Токен сохранён">
          Проверка подключения выполнена автоматически — результат ниже.
        </Callout>
      ) : null}
      {params.removed ? (
        <Callout tone="neutral" title="Токен удалён">
          Синхронизация с Ainur отключена. Данные в приложении остались на месте.
        </Callout>
      ) : null}
      {params.busy ? (
        <Callout tone="warn" title="Синхронизация уже идёт">
          Запустил: {params.who || "неизвестно"}, {params.age || "только что"}{" "}
          назад. Второй прогон не начала намеренно: Ainur ограничивает частоту
          запросов и на двойной заход отвечает отказом. Подождите, пока
          закончится первый, и обновите страницу.
        </Callout>
      ) : null}
      {params.schedule === "on" ? (
        <Callout tone="ok" title="Автосинхронизация включена">
          Ночной прогон снова будет обновлять данные сам.
        </Callout>
      ) : null}
      {params.schedule === "off" ? (
        <Callout tone="neutral" title="Автосинхронизация выключена">
          Ночной прогон больше не тронет данные. Кнопки на этой странице
          работают как раньше.
        </Callout>
      ) : null}

      <Card className="mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {configured ? (
              <>
                <StatusPill tone="ok">Токен задан</StatusPill>
                <span className="tnum text-sm text-[var(--color-muted)]">
                  {tokenInfo.masked}
                </span>
                <span className="text-xs text-[var(--color-faint)]">
                  {tokenInfo.source === "app"
                    ? "введён в приложении"
                    : "взят из переменной окружения"}
                </span>
              </>
            ) : (
              <StatusPill tone="warn">Токен не задан</StatusPill>
            )}
          </div>

          {configured ? (
            <form action={checkConnection}>
              <SubmitButton variant="secondary" pendingLabel="Проверяю…">
                Проверить подключение
              </SubmitButton>
            </form>
          ) : null}
        </div>

        {params.ping === "ok" ? (
          <div className="mt-4">
            <Callout tone="ok" title="Ainur отвечает">
              Подключение работает. Аккаунт: {params.message || "—"}
            </Callout>
          </div>
        ) : null}
        {params.ping === "error" ? (
          <div className="mt-4">
            <Callout tone="critical" title="Ainur не отвечает">
              {params.message ||
                "Проверьте токен и его уровень доступа в AinurPOS → Integration → Connect API."}
            </Callout>
          </div>
        ) : null}

        {user.role === "OWNER" ? (
          <div className="mt-5 border-t border-[var(--color-line)] pt-4">
            <form action={saveToken} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <Field
                  label={configured ? "Заменить токен" : "Вставьте токен Ainur"}
                  hint="Начинается с sk_. Вставляйте целиком, вместе с sk_."
                  required
                >
                  <Input
                    name="token"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="sk_..."
                    required
                  />
                </Field>
              </div>
              <SubmitButton variant="primary" pendingLabel="Проверяю…">
                Сохранить и проверить
              </SubmitButton>
            </form>

            {configured && tokenInfo.source === "app" ? (
              <form action={removeToken} className="mt-3">
                <SubmitButton variant="danger" pendingLabel="Удаляю…">
                  Удалить токен
                </SubmitButton>
              </form>
            ) : null}
          </div>
        ) : (
          <div className="mt-4 border-t border-[var(--color-line)] pt-3 text-sm text-[var(--color-muted)]">
            Токен настраивают владельцы — Ева или Константин.
          </div>
        )}
      </Card>

      {!configured ? (
        <Card className="mb-4">
          <div className="mb-2 text-sm font-semibold text-[var(--color-ocean)]">
            Где взять токен — по шагам
          </div>
          <ol className="m-0 flex flex-col gap-2 pl-5 text-sm">
            <li>
              Откройте{" "}
              <a
                href="https://web.ainur.app/card/integrations/"
                target="_blank"
                rel="noreferrer"
                className="text-[var(--color-ocean)] underline"
              >
                AinurPOS → Integration
              </a>
              .
            </li>
            <li>
              Найдите блок <b>Connect API</b> и откройте его (в аккаунте EVA MOON
              он уже установлен и включён).
            </li>
            <li>
              Нажмите <b>Generate a token</b>. В поле <b>ACCESS</b> выберите{" "}
              <b>Readonly</b> — Luna только читает данные и ничего не меняет
              в Ainur, больших прав ей не нужно.
            </li>
            <li>
              Скопируйте показанный токен целиком (он начинается на{" "}
              <code>sk_</code>). Ainur показывает его полностью только один раз —
              потом останутся только последние символы.
            </li>
            <li>Вставьте его в поле выше и нажмите «Сохранить и проверить».</li>
          </ol>
          <div className="mt-3 text-xs text-[var(--color-muted)]">
            Токен хранится только в вашей базе и виден в интерфейсе лишь
            последними символами. Если он попадёт не туда — удалите его в Ainur
            и сгенерируйте новый, приложение продолжит работать после замены.
          </div>
        </Card>
      ) : null}

      <SectionTitle>Автоматически, каждое утро</SectionTitle>
      <Card className="mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {schedule.enabled ? (
              <StatusPill tone="ok">Включена</StatusPill>
            ) : (
              <StatusPill tone="neutral">Выключена</StatusPill>
            )}
            <span className="text-sm text-[var(--color-ocean)]">
              {describeSchedule(schedule)}
            </span>
          </div>

          {isOwner ? (
            <form action={toggleSchedule}>
              <SubmitButton variant="secondary" pendingLabel="Меняю…">
                {schedule.enabled ? "Выключить" : "Включить"}
              </SubmitButton>
            </form>
          ) : null}
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <div className="text-xs text-[var(--color-faint)]">
              Следующий запуск
            </div>
            <div className="tnum text-sm text-[var(--color-ocean)]">
              {schedule.enabled ? (
                <>
                  {formatDateTime(nextRun.toISOString())}{" "}
                  <span className="text-[var(--color-muted)]">
                    ({describeUntil(nextRun)})
                  </span>
                </>
              ) : (
                <span className="text-[var(--color-faint)]">
                  не запустится, расписание выключено
                </span>
              )}
            </div>
          </div>

          <div>
            <div className="text-xs text-[var(--color-faint)]">
              Последний раз сработало само
            </div>
            {lastNight ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <StatusPill tone={statusTone(lastNight.status)}>
                  {statusLabel(lastNight.status)}
                </StatusPill>
                <span className="tnum text-[var(--color-ocean)]">
                  {formatDateTime(lastNight.startedAt)}
                </span>
                <span className="tnum text-[var(--color-muted)]">
                  {durationBetween(lastNight.startedAt, lastNight.finishedAt)}
                </span>
              </div>
            ) : (
              <div className="text-sm text-[var(--color-faint)]">
                ещё ни разу — первый ночной прогон впереди
              </div>
            )}
            {lastNight?.error ? (
              <div className="mt-1 text-xs text-[var(--color-critical)]">
                {lastNight.error}
              </div>
            ) : null}
          </div>
        </div>

        {runningNow ? (
          <div className="mt-4">
            <Callout tone="warn" title="Прямо сейчас идёт синхронизация">
              Запустил: {runningNow.holder}, начало{" "}
              {formatDateTime(runningNow.since)}. Кнопки ниже пока не сработают —
              это защита от отказа Ainur, а не поломка.
            </Callout>
          </div>
        ) : null}

        <p className="mt-4 mb-0 text-xs text-[var(--color-muted)]">
          Порядок шагов всегда один: склады → товары с остатками → продажи за{" "}
          {schedule.salesDays} дн. → перемещения. Между шагами пауза{" "}
          {schedule.stepDelaySec} с: у Ainur есть ограничение на частоту запросов,
          и без паузы он отвечает отказом. Ручные кнопки никуда не делись —
          расписание их не заменяет, а дополняет.
        </p>
      </Card>

      <SectionTitle>Когда последний раз обновляли</SectionTitle>
      <Card padded={false}>
        <Table>
          <thead>
            <tr>
              <Th>Что обновляем</Th>
              <Th>Когда</Th>
              <Th>Статус</Th>
            </tr>
          </thead>
          <tbody>
            {Object.keys(KIND_RU).map((kind) => {
              const entry = lastTimes[kind];
              return (
                <tr key={kind}>
                  <Td>{KIND_RU[kind]}</Td>
                  <Td>
                    {entry ? (
                      formatDateTime(entry.at)
                    ) : (
                      <span className="text-[var(--color-faint)]">
                        ещё ни разу
                      </span>
                    )}
                  </Td>
                  <Td>
                    {entry ? (
                      <StatusPill tone={statusTone(entry.status)}>
                        {statusLabel(entry.status)}
                      </StatusPill>
                    ) : (
                      <StatusPill tone="neutral">нет данных</StatusPill>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      <SectionTitle>Запустить обновление</SectionTitle>
      <Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <form action={runEverything}>
              <SubmitButton
                className="w-full"
                pendingLabel="Обновляю, это минуты…"
              >
                Обновить всё
              </SubmitButton>
            </form>
            <p className="mt-2 mb-0 text-xs text-[var(--color-muted)]">
              Склады, товары с остатками, продажи и перемещения за последние 60
              дней. Занимает больше всего времени — не закрывайте страницу.
            </p>
          </div>

          <div>
            <form action={runProducts}>
              <SubmitButton
                variant="secondary"
                className="w-full"
                pendingLabel="Читаю товары…"
              >
                Только товары и остатки
              </SubmitButton>
            </form>
            <p className="mt-2 mb-0 text-xs text-[var(--color-muted)]">
              Коллекции, SKU и остатки по складам. Заодно складывается снимок
              остатка — из него строится график динамики.
            </p>
          </div>

          <div>
            <form action={runSales}>
              <Field label="Период продаж">
                <Select name="days" defaultValue="60">
                  {SALES_PERIODS.map((d) => (
                    <option key={d} value={d}>
                      последние {d} дней
                    </option>
                  ))}
                </Select>
              </Field>
              <SubmitButton
                variant="secondary"
                className="mt-3 w-full"
                pendingLabel="Читаю продажи…"
              >
                Только продажи
              </SubmitButton>
            </form>
            <p className="mt-2 mb-0 text-xs text-[var(--color-muted)]">
              Продажи по дням и SKU. Повторный запуск за тот же период не
              удваивает цифры — дни перезаписываются.
            </p>
          </div>

          <div>
            <form action={runStores}>
              <SubmitButton
                variant="secondary"
                className="w-full"
                pendingLabel="Читаю склады…"
              >
                Только склады
              </SubmitButton>
            </form>
            <p className="mt-2 mb-0 text-xs text-[var(--color-muted)]">
              Список складов и точек продаж. Нужен, если в Ainur появился новый
              склад или его переименовали.
            </p>
          </div>
        </div>
      </Card>

      {lastResult ? (
        <>
          <SectionTitle>Результат последнего запуска</SectionTitle>
          <Card>
            <div className="text-sm text-[var(--color-muted)]">
              {lastResult.label} · запустил {lastResult.actor} ·{" "}
              {formatDateTime(lastResult.at)}
            </div>

            {lastResult.error ? (
              <div className="mt-3">
                <Callout tone="critical" title="Синхронизация не запустилась">
                  {lastResult.error}
                </Callout>
              </div>
            ) : null}

            {lastResult.results?.length ? (
              <div className="mt-3 flex flex-col gap-3">
                {lastResult.results.map((r, i) => (
                  <div
                    key={`${r.kind}-${i}`}
                    className="rounded-lg border border-[var(--color-line)] p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill tone={r.ok ? "ok" : "critical"}>
                        {r.ok ? "успешно" : "ошибка"}
                      </StatusPill>
                      <span className="font-medium text-[var(--color-ocean)]">
                        {kindLabel(r.kind)}
                      </span>
                      <span className="text-sm text-[var(--color-muted)]">
                        прочитано {r.itemsRead} · записано {r.itemsWritten} · за{" "}
                        {seconds(r.durationMs)}
                      </span>
                    </div>

                    {r.error ? (
                      <p className="mt-2 mb-0 text-sm text-[var(--color-critical)]">
                        <span aria-hidden="true">✕</span> {r.error}
                      </p>
                    ) : null}

                    {r.details?.length ? (
                      <details className="mt-2">
                        <summary className="touch cursor-pointer text-xs text-[var(--color-ocean)] active:underline">
                          Подробности ({r.details.length})
                        </summary>
                        <ul className="mt-1.5 mb-0 pl-5 text-sm text-[var(--color-muted)]">
                          {r.details.map((d, di) => (
                            <li key={di}>{d}</li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </Card>
        </>
      ) : null}

      <SectionTitle>Что именно приходит из Ainur</SectionTitle>
      <Card>
        <ul className="m-0 pl-5 text-sm">
          <li>остатки по каждому складу — по каждому SKU;</li>
          <li>продажи по дням: количество, выручка, себестоимость;</li>
          <li>
            перемещения между складами — откуда и куда (source → destination);
          </li>
          <li>коллекции (группы Ainur) и сами SKU с ценой и вариациями.</li>
        </ul>
        <Callout tone="neutral" title="Направление только одно">
          Ainur — источник правды по товарам, остаткам и продажам. Luna НИКОГДА
          не записывает данные обратно в Ainur: цены, остатки и товары меняются
          только в самом AinurPOS. Ключ сопоставления — Code (он же SKU).
        </Callout>
      </Card>

      <SectionTitle>История запусков</SectionTitle>
      {history.length === 0 ? (
        <Card>
          <p className="m-0 text-sm text-[var(--color-muted)]">
            Синхронизацию ещё не запускали.
          </p>
        </Card>
      ) : (
        <Card padded={false}>
          <Table>
            <thead>
              <tr>
                <Th>Что</Th>
                <Th>Начало</Th>
                <Th>Длительность</Th>
                <Th align="right">Прочитано</Th>
                <Th align="right">Записано</Th>
                <Th>Кто</Th>
                <Th>Статус</Th>
              </tr>
            </thead>
            <tbody>
              {history.map((run) => (
                <tr key={run.id}>
                  <Td>{kindLabel(run.kind)}</Td>
                  <Td>{formatDateTime(run.startedAt)}</Td>
                  <Td>{durationBetween(run.startedAt, run.finishedAt)}</Td>
                  <Td align="right">{run.itemsRead}</Td>
                  <Td align="right">{run.itemsWritten}</Td>
                  <Td>{run.triggeredBy ?? "—"}</Td>
                  <Td>
                    <StatusPill tone={statusTone(run.status)}>
                      {statusLabel(run.status)}
                    </StatusPill>
                    {run.error ? (
                      <div className="mt-1 text-xs text-[var(--color-critical)]">
                        {run.error}
                      </div>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
