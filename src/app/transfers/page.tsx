/**
 * «Перемещения между складами» — что и куда стоит перевезти.
 *
 * Три ФИКСИРОВАННЫХ направления (вкладки) — не склады как раньше, см.
 * @/lib/transfer-routes. Расчёт и группировка по брендам/подгруппам — в
 * @/lib/transfers (данные) и @/lib/transfers/logic (правила).
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser, writeAudit } from "@/lib/auth";
import { syncAll } from "@/lib/ainur/sync";
import { saveLastSyncResult } from "@/lib/ainur/last-result";
import {
  acquireSyncLock,
  releaseSyncLock,
  describeAge,
  type LockAttempt,
} from "@/lib/ainur/lock";
import {
  getTransferRecommendations,
  TRANSFER_ROUTES,
  type AnalysisPeriod,
} from "@/lib/transfers";
import {
  Card,
  PageHeader,
  StatusPill,
  Callout,
  Field,
  Input,
  Select,
  Checkbox,
  Button,
  LinkButton,
  EmptyState,
  formatDateTime,
} from "@/components/ui";
import { TransferTable } from "./transfer-table";

export const metadata = { title: "Перемещения — Luna Production" };

interface Params {
  route?: string;
  q?: string;
  brand?: string;
  collection?: string;
  soldOut?: string;
  lowStock?: string;
  onlyNew?: string;
  hideNoSales?: string;
  period?: string;
  busy?: string;
  who?: string;
  age?: string;
  ran?: string;
}

function takeLockOrBail(holder: string): Extract<LockAttempt, { ok: true }> {
  const attempt = acquireSyncLock(holder);
  if (!attempt.ok) {
    redirect(
      `/transfers?busy=1&who=${encodeURIComponent(attempt.heldBy)}` +
        `&age=${encodeURIComponent(describeAge(attempt.ageMs))}`,
    );
  }
  return attempt;
}

async function refreshData() {
  "use server";
  const user = await requireUser();
  const lock = takeLockOrBail(user.name);
  const stored = {
    at: new Date().toISOString(),
    actor: user.name,
    label: "Обновить (со страницы «Перемещения»)",
    results: [] as Awaited<ReturnType<typeof syncAll>>,
    error: undefined as string | undefined,
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
    entityName: "Обновить всё (Перемещения)",
  });
  revalidatePath("/transfers");
  redirect("/transfers?ran=1");
}

export default async function TransfersPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const params = await searchParams;

  const period: AnalysisPeriod =
    params.period === "90d" || params.period === "6m" ? params.period : "12m";

  const data = await getTransferRecommendations({
    q: params.q,
    brand: params.brand || undefined,
    collectionId: params.collection || undefined,
    onlySoldOut: params.soldOut === "1",
    onlyLowStock: params.lowStock === "1",
    onlyNew: params.onlyNew === "1",
    hideNoSales: params.hideNoSales === "1",
    period,
  });

  const activeKey =
    (params.route && TRANSFER_ROUTES.find((r) => r.key === params.route)?.key) ||
    TRANSFER_ROUTES[0].key;
  const activeRoute = data.routes.find((r) => r.route.key === activeKey) ?? data.routes[0];

  // Хвост фильтров, чтобы переключение вкладки не сбрасывало фильтры
  const tail = new URLSearchParams();
  if (params.q) tail.set("q", params.q);
  if (params.brand) tail.set("brand", params.brand);
  if (params.collection) tail.set("collection", params.collection);
  if (params.soldOut) tail.set("soldOut", params.soldOut);
  if (params.lowStock) tail.set("lowStock", params.lowStock);
  if (params.onlyNew) tail.set("onlyNew", params.onlyNew);
  if (params.hideNoSales) tail.set("hideNoSales", params.hideNoSales);
  if (params.period) tail.set("period", params.period);
  const tailStr = tail.toString() ? `&${tail.toString()}` : "";

  return (
    <>
      <PageHeader
        title="Перемещения между складами"
        subtitle="Fotesko отдаёт только на Phuket. Phuket и Phangan обмениваются между собой в обе стороны. Расчёт учитывает продажи, свежесть спроса и остаток на каждой точке — не просто выравнивает количество."
      />

      {params.busy === "1" ? (
        <Callout tone="warn" title="Синхронизация уже идёт">
          Занято пользователем «{params.who}» ({params.age} назад). Подождите и
          попробуйте ещё раз.
        </Callout>
      ) : null}
      {params.ran === "1" ? (
        <Callout tone="ok" title="Данные обновлены">
          Свежие остатки и продажи подтянуты из Ainur.
        </Callout>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <StatusPill tone="neutral">
          обновлено: {data.lastUpdatedAt ? formatDateTime(data.lastUpdatedAt) : "ещё не было"}
        </StatusPill>
        <form action={refreshData}>
          <Button type="submit" variant="secondary">
            Обновить данные
          </Button>
        </form>
      </div>

      {data.negativeIssues.length > 0 ? (
        <Callout tone="critical" title={`Ошибка учёта в Ainur: ${data.negativeIssues.length}`}>
          <details>
            <summary className="cursor-pointer">
              Отрицательный остаток — не участвует в рекомендациях, нужно
              проверить в Ainur
            </summary>
            <ul className="mt-2 space-y-1 text-xs">
              {data.negativeIssues.map((i) => (
                <li key={`${i.variantId}-${i.warehouse}`}>
                  {i.sku} · {i.productName} · {i.warehouse}:{" "}
                  <span className="font-semibold">{i.quantity}</span>
                </li>
              ))}
            </ul>
          </details>
        </Callout>
      ) : null}

      {/* ---------- Вкладки-направления ---------- */}
      <div className="mb-4 -mx-4 overflow-x-auto px-4">
        <div className="flex gap-2">
          {data.routes.map(({ route, rows }) => {
            const isCurrent = route.key === activeKey;
            return (
              <a
                key={route.key}
                href={`/transfers?route=${route.key}${tailStr}`}
                className={`touch inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-sm no-underline transition-transform duration-100 active:scale-[0.97] ${
                  isCurrent
                    ? "border-[var(--color-gold)] bg-[var(--color-gold)]/10 text-[var(--color-gold-deep)]"
                    : "border-[var(--color-line)] bg-white text-[var(--color-ink)]"
                }`}
              >
                {route.label}
                <span className="tnum text-xs opacity-60">{rows.length}</span>
              </a>
            );
          })}
        </div>
      </div>

      {/* ---------- Фильтры ---------- */}
      <Card className="mb-4">
        <form method="get" className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6 sm:items-end">
          <input type="hidden" name="route" value={activeKey} />
          <Field label="Поиск">
            <Input name="q" defaultValue={params.q ?? ""} placeholder="SKU или название" />
          </Field>
          <Field label="Бренд">
            <Select name="brand" defaultValue={params.brand ?? ""}>
              <option value="">Все</option>
              {data.brands.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Коллекция">
            <Select name="collection" defaultValue={params.collection ?? ""}>
              <option value="">Все</option>
              {data.collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Период анализа">
            <Select name="period" defaultValue={period}>
              <option value="90d">90 дней</option>
              <option value="6m">6 месяцев</option>
              <option value="12m">12 месяцев</option>
            </Select>
          </Field>
          <div className="flex flex-wrap gap-3 sm:col-span-3 lg:col-span-6">
            <Checkbox label="Только закончившиеся" name="soldOut" defaultChecked={params.soldOut === "1"} />
            <Checkbox label="Только низкий остаток" name="lowStock" defaultChecked={params.lowStock === "1"} />
            <Checkbox label="Только новые поступления" name="onlyNew" defaultChecked={params.onlyNew === "1"} />
            <Checkbox label="Скрыть без продаж" name="hideNoSales" defaultChecked={params.hideNoSales === "1"} />
          </div>
          <div className="flex gap-2 sm:col-span-3 lg:col-span-6">
            <Button type="submit" variant="primary">
              Применить
            </Button>
            <LinkButton href={`/transfers?route=${activeKey}`}>Сбросить фильтры</LinkButton>
          </div>
        </form>
      </Card>

      {activeRoute.rows.length === 0 ? (
        <EmptyState
          title="По этому направлению перемещать пока нечего"
          hint="Либо всё в достатке, либо ничего не подошло под фильтры — попробуйте их сбросить."
          action={<LinkButton href={`/transfers?route=${activeKey}`}>Сбросить фильтры</LinkButton>}
        />
      ) : (
        <TransferTable rows={activeRoute.rows} />
      )}

      <p className="mt-4 text-xs text-[var(--color-faint)]">
        Это рекомендация, не факт перемещения — сам перевоз и списание/приход
        между складами делаются руками в Ainur. Позиции, помеченные «не
        повторять» в «Пора заказывать», сюда не попадают.
      </p>
    </>
  );
}
