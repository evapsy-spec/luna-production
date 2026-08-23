import { desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { getCurrentUser, canSeeMoney } from "@/lib/auth";
import {
  Card,
  PageHeader,
  LinkButton,
  Money,
  OrderStatusPill,
  StatusPill,
  Stat,
  EmptyState,
  formatDate,
} from "@/components/ui";
import {
  DeadlinePill,
  getPaidByOrder,
  getUnitsByOrder,
  isOverdue,
  STATUS_LABELS,
} from "./_shared";

export const metadata = { title: "Заказы на пошив — Luna Production" };

const TABS: { key: string; label: string }[] = [
  { key: "active", label: "Активные" },
  { key: "SAMPLE", label: "Образец" },
  { key: "IN_PRODUCTION", label: "В производстве" },
  { key: "READY", label: "Готово" },
  { key: "RECEIVED", label: "Принято" },
  { key: "all", label: "Все" },
];

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await getCurrentUser();
  const showMoney = canSeeMoney(user);
  const { tab: tabParam } = await searchParams;

  const all = await db
    .select({
      id: schema.productionOrders.id,
      number: schema.productionOrders.number,
      status: schema.productionOrders.status,
      plannedReadyAt: schema.productionOrders.plannedReadyAt,
      actualReadyAt: schema.productionOrders.actualReadyAt,
      sampleApprovedAt: schema.productionOrders.sampleApprovedAt,
      snapshotTotalCost: schema.productionOrders.snapshotTotalCost,
      appliedDefectCredit: schema.productionOrders.appliedDefectCredit,
      createdAt: schema.productionOrders.createdAt,
      note: schema.productionOrders.note,
      factoryId: schema.factories.id,
      factoryName: schema.factories.name,
    })
    .from(schema.productionOrders)
    .innerJoin(
      schema.factories,
      eq(schema.productionOrders.factoryId, schema.factories.id),
    )
    .orderBy(desc(schema.productionOrders.createdAt));

  const orderIds = all.map((o) => o.id);
  const paidByOrder = await getPaidByOrder(orderIds);
  const unitsByOrder = await getUnitsByOrder(orderIds);

  const active = all.filter(
    (o) => o.status === "SAMPLE" || o.status === "IN_PRODUCTION",
  );

  /**
   * По умолчанию открываем «Активные» — это рабочий экран.
   * Но если активных нет, а заказы в базе есть (например, только что
   * загрузили историю фабрики), пустой список с текстом «создайте первый
   * заказ» вводит в заблуждение — там ниже десять заказов, просто в другом
   * фильтре. В этом случае сразу показываем «Все».
   */
  const tab =
    tabParam ?? (active.length === 0 && all.length > 0 ? "all" : "active");

  const filtered = all.filter((o) => {
    if (tab === "all") return true;
    if (tab === "active")
      return o.status === "SAMPLE" || o.status === "IN_PRODUCTION";
    return o.status === tab;
  });
  const overdue = all.filter(isOverdue);
  const unitsInWork = active.reduce((sum, o) => {
    const u = unitsByOrder.get(o.id);
    return sum + (u ? Math.max(0, u.quantity - u.produced) : 0);
  }, 0);
  const activeBudget = active.reduce((s, o) => s + o.snapshotTotalCost, 0);

  return (
    <>
      <PageHeader
        title="Заказы на пошив"
        subtitle="Выберите фабрику — Luna посчитает расход тканей и бюджет"
        action={
          <LinkButton href="/orders/new" variant="primary">
            + Новый заказ
          </LinkButton>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Активных заказов" value={active.length} />
        <Stat
          label="В работе"
          value={`${unitsInWork} шт`}
          sub="ещё не отшито"
        />
        <Stat
          label="Бюджет активных"
          value={<Money value={activeBudget} hidden={!showMoney} />}
          sub="по снэпшоту на момент заказа"
        />
        <Stat
          label="Просрочено"
          value={overdue.length}
          sub={overdue.length > 0 ? "нужно связаться с фабрикой" : "всё в срок"}
        />
      </div>

      {/* Фильтр по статусу */}
      <div className="mb-4 -mx-4 overflow-x-auto px-4">
        <div className="flex gap-2">
          {TABS.map((t) => {
            const count =
              t.key === "all"
                ? all.length
                : t.key === "active"
                  ? active.length
                  : all.filter((o) => o.status === t.key).length;
            const isCurrent = t.key === tab;
            return (
              <a
                key={t.key}
                href={`/orders?tab=${t.key}`}
                className={`touch inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-sm no-underline transition-transform duration-100 active:scale-[0.97] ${
                  isCurrent
                    ? "border-[var(--color-gold)] bg-[var(--color-gold)]/10 text-[var(--color-gold-deep)]"
                    : "border-[var(--color-line)] bg-white text-[var(--color-ink)]"
                }`}
              >
                {t.label}
                <span className="tnum text-xs opacity-60">{count}</span>
              </a>
            );
          })}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={all.length === 0 ? "Заказов пока нет" : "В этом фильтре пусто"}
          hint={
            all.length === 0
              ? "Создайте первый заказ — Luna предложит, что стоит отшить, исходя из скорости продаж и остатков на складах."
              : `Заказов в базе ${all.length}, но ни один не попадает в этот фильтр. Откройте «Все», чтобы увидеть остальные.`
          }
          action={
            all.length === 0 ? (
              <LinkButton href="/orders/new" variant="primary">
                + Новый заказ
              </LinkButton>
            ) : (
              <LinkButton href="/orders?tab=all" variant="secondary">
                Показать все заказы
              </LinkButton>
            )
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((order) => {
            const units = unitsByOrder.get(order.id);
            const paid = paidByOrder.get(order.id) ?? 0;
            const due = Math.max(
              0,
              order.snapshotTotalCost - order.appliedDefectCredit - paid,
            );

            return (
              <Card key={order.id} padded={false}>
                <a
                  href={`/orders/${order.id}`}
                  className="block p-4 no-underline text-[var(--color-ink)] hover:bg-[var(--color-sand-warm)] active:bg-[var(--color-sand-warm)] sm:p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="figure text-base text-[var(--color-ocean)]">
                          {order.number}
                        </span>
                        <OrderStatusPill status={order.status} />
                        <DeadlinePill
                          plannedReadyAt={order.plannedReadyAt}
                          actualReadyAt={order.actualReadyAt}
                          status={order.status}
                        />
                        {order.status === "SAMPLE" && !order.sampleApprovedAt ? (
                          <StatusPill tone="warn">образец не утверждён</StatusPill>
                        ) : null}
                      </div>
                      {/*
                        Примечание в списке обрезаем одной строкой: у
                        импортированных заказов там несколько предложений
                        (инвойс, сумма в IDR, курс, что не перенесено), и
                        без обрезки карточка расплывается на пол-экрана.
                        Полный текст — на странице заказа.
                      */}
                      <div className="mt-1.5 line-clamp-1 text-sm text-[var(--color-muted)]">
                        {order.factoryName}
                        {order.note ? ` · ${order.note}` : ""}
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-1 text-right">
                      <Money
                        value={order.snapshotTotalCost}
                        hidden={!showMoney}
                        className="text-base"
                      />
                      {showMoney && due > 0 ? (
                        <span className="text-xs text-[var(--color-muted)]">
                          остаток к оплате{" "}
                          {Math.round(due).toLocaleString("ru-RU").replace(/,/g, " ")} THB
                        </span>
                      ) : null}
                      {showMoney && order.appliedDefectCredit > 0 ? (
                        <span className="text-xs text-[#0A7A0A]">
                          зачтён брак −
                          {Math.round(order.appliedDefectCredit)
                            .toLocaleString("ru-RU")
                            .replace(/,/g, " ")}{" "}
                          THB
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--color-muted)]">
                    <span>
                      заказано{" "}
                      <b className="tnum text-[var(--color-ink)]">
                        {units?.quantity ?? 0} шт
                      </b>
                    </span>
                    <span>
                      отшито{" "}
                      <b className="tnum text-[var(--color-ink)]">
                        {units?.produced ?? 0} шт
                      </b>
                    </span>
                    {units && units.defect > 0 ? (
                      <span className="text-[#A82C2C]">
                        брак <b className="tnum">{units.defect} шт</b>
                      </span>
                    ) : null}
                    <span>
                      план готовности{" "}
                      <b className="text-[var(--color-ink)]">
                        {formatDate(order.plannedReadyAt)}
                      </b>
                    </span>
                    <span>создан {formatDate(order.createdAt)}</span>
                  </div>

                  {/* Прогресс: сколько отшито от заказанного */}
                  {units && units.quantity > 0 ? (
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--color-sand-warm)]">
                      <div
                        className="h-full rounded-full bg-[var(--color-gold)]"
                        style={{
                          width: `${Math.min(100, (units.produced / units.quantity) * 100)}%`,
                        }}
                      />
                    </div>
                  ) : null}
                </a>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
