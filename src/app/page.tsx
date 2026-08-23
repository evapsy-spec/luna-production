import { desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { getCurrentUser, canSeeMoney } from "@/lib/auth";
import {
  getFactoryScorecards,
  getVelocity,
  recommendForHorizon,
  suggestTransfers,
  formatThb,
} from "@/lib/production";
import { getLastSyncTimes } from "@/lib/ainur/sync";
import { isAinurReady } from "@/lib/ainur/token";
import {
  Card,
  PageHeader,
  SectionTitle,
  Stat,
  Money,
  LinkButton,
  StatusPill,
  Callout,
  Table,
  Th,
  Td,
  EmptyState,
  formatDate,
  formatDateTime,
} from "@/components/ui";
import { BarChart, RankBars, CoverageBar } from "@/components/charts";
import { DeadlinePill, getUnitsByOrder, isOverdue, plural } from "./orders/_shared";

export const metadata = { title: "Luna Production — EVA MOON" };

/** Порог, после которого запас считаем избыточным (кандидат на скидку) */
const OVERSTOCK_MONTHS = 6;

export default async function DashboardPage() {
  const user = await getCurrentUser();
  const showMoney = canSeeMoney(user);

  // ---------- Заказы в производстве ----------
  const orders = await db
    .select({
      id: schema.productionOrders.id,
      number: schema.productionOrders.number,
      status: schema.productionOrders.status,
      plannedReadyAt: schema.productionOrders.plannedReadyAt,
      actualReadyAt: schema.productionOrders.actualReadyAt,
      snapshotTotalCost: schema.productionOrders.snapshotTotalCost,
      createdAt: schema.productionOrders.createdAt,
      factoryName: schema.factories.name,
    })
    .from(schema.productionOrders)
    .innerJoin(
      schema.factories,
      eq(schema.productionOrders.factoryId, schema.factories.id),
    )
    .orderBy(desc(schema.productionOrders.createdAt));

  const activeOrders = orders.filter(
    (o) => o.status === "SAMPLE" || o.status === "IN_PRODUCTION",
  );
  const unitsByOrder = await getUnitsByOrder(activeOrders.map((o) => o.id));
  const overdueOrders = orders.filter(isOverdue);

  const unitsInWork = activeOrders.reduce((sum, o) => {
    const u = unitsByOrder.get(o.id);
    return sum + (u ? Math.max(0, u.quantity - u.produced) : 0);
  }, 0);
  const activeBudget = activeOrders.reduce((s, o) => s + o.snapshotTotalCost, 0);

  // ---------- Склад ----------
  const stockTotalRow = await db
    .select({
      total: sql<number>`COALESCE(SUM(${schema.variantStock.quantity}), 0)`,
    })
    .from(schema.variantStock);
  const stockTotal = Number(stockTotalRow[0]?.total ?? 0);

  const stockByWarehouse = await db
    .select({
      name: schema.warehouses.name,
      total: sql<number>`COALESCE(SUM(${schema.variantStock.quantity}), 0)`,
    })
    .from(schema.variantStock)
    .innerJoin(
      schema.warehouses,
      eq(schema.variantStock.warehouseId, schema.warehouses.id),
    )
    .groupBy(schema.warehouses.name);

  // ---------- Продажи и запас ----------
  const velocity = await getVelocity(90);

  const salesByCollection = new Map<
    string,
    { name: string; units: number; revenue: number }
  >();
  for (const row of velocity) {
    const entry = salesByCollection.get(row.collectionId) ?? {
      name: row.collectionName,
      units: 0,
      revenue: 0,
    };
    entry.units += row.unitsSold;
    entry.revenue += row.revenue;
    salesByCollection.set(row.collectionId, entry);
  }
  const topCollections = [...salesByCollection.values()]
    .filter((c) => c.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 6);

  // Медленные и в избытке — кандидаты на скидки и акции
  const overstock = velocity
    .filter(
      (v) =>
        v.stockQty > 0 &&
        (v.monthsOfCover === null || v.monthsOfCover > OVERSTOCK_MONTHS),
    )
    .sort((a, b) => {
      const aCover = a.monthsOfCover ?? Infinity;
      const bCover = b.monthsOfCover ?? Infinity;
      if (aCover === bCover) return b.stockQty - a.stockQty;
      return bCover - aCover;
    })
    .slice(0, 8);

  // Что заканчивается — надо шить
  const running = velocity
    .filter((v) => v.monthsOfCover !== null && v.monthsOfCover < 2)
    .sort((a, b) => (a.monthsOfCover ?? 0) - (b.monthsOfCover ?? 0))
    .slice(0, 8);

  // ---------- Производство по месяцам ----------
  const allUnitsByOrder = await getUnitsByOrder(orders.map((o) => o.id));
  const monthly = buildMonthlyProduction(orders, allUnitsByOrder, 6);

  // ---------- Фабрики ----------
  const scorecards = await getFactoryScorecards();

  // ---------- Ткани: где мало / перерезервировано ----------
  const fabricStockRows = await db
    .select({
      fabricId: schema.fabrics.id,
      name: schema.fabrics.name,
      sku: schema.fabrics.sku,
      onHand: sql<number>`COALESCE(SUM(${schema.fabricStock.onHandM}), 0)`,
      reserved: sql<number>`COALESCE(SUM(${schema.fabricStock.reservedM}), 0)`,
    })
    .from(schema.fabrics)
    .leftJoin(
      schema.fabricStock,
      eq(schema.fabricStock.fabricId, schema.fabrics.id),
    )
    .where(eq(schema.fabrics.isArchived, false))
    .groupBy(schema.fabrics.id);

  const fabricAlerts = fabricStockRows
    .map((f) => ({
      ...f,
      onHand: Number(f.onHand),
      reserved: Number(f.reserved),
      available: Number(f.onHand) - Number(f.reserved),
    }))
    .filter((f) => f.available < 10)
    .sort((a, b) => a.available - b.available);

  // ---------- Заявки на дозакупку и перемещения ----------
  const draftPurchases = await db
    .select()
    .from(schema.fabricPurchases)
    .where(eq(schema.fabricPurchases.status, "DRAFT"));

  const transfers = await suggestTransfers(90);
  const recommendations = await recommendForHorizon(3);

  const openCredits = await db
    .select({
      total: sql<number>`COALESCE(SUM(${schema.defectCredits.amount}), 0)`,
    })
    .from(schema.defectCredits)
    .where(isNull(schema.defectCredits.appliedToOrderId));
  const openCreditTotal = Number(openCredits[0]?.total ?? 0);

  const lastSync = await getLastSyncTimes();
  const ainurReady = await isAinurReady();

  return (
    <>
      <PageHeader
        title="Производство EVA MOON"
        subtitle={`Обзор на ${formatDate(new Date().toISOString())}`}
        action={
          <div className="flex flex-wrap gap-2">
            <LinkButton href="/orders/new" variant="primary">
              + Новый заказ
            </LinkButton>
            <LinkButton href="/sync">Обновить из Ainur</LinkButton>
          </div>
        }
      />

      {!ainurReady ? (
        <Callout tone="warn" title="Ainur пока не подключён">
          Данные ниже — демонстрационные, из локальной базы. Чтобы приложение
          показывало живые остатки и продажи, нужно один раз вставить токен
          Ainur на странице{" "}
          <a href="/sync" className="text-inherit underline">
            Синхронизация
          </a>{" "}
          — там же расписано, где его взять.
        </Callout>
      ) : null}

      {/* ---------- Главные цифры ---------- */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Заказов в работе"
          value={activeOrders.length}
          sub={`${unitsInWork} шт ещё не отшито`}
        />
        <Stat
          label="Товара на складах"
          value={`${stockTotal.toLocaleString("ru-RU").replace(/,/g, " ")} шт`}
          sub={stockByWarehouse
            .map((w) => `${w.name}: ${w.total}`)
            .join(" · ")}
        />
        <Stat
          label="Бюджет в производстве"
          value={<Money value={activeBudget} hidden={!showMoney} />}
          sub="по снэпшоту на момент заказа"
        />
        <Stat
          label="Просрочено заказов"
          value={overdueOrders.length}
          sub={
            overdueOrders.length > 0
              ? "нужно связаться с фабриками"
              : "все идут в срок"
          }
        />
      </div>

      {/* ---------- Что требует внимания ---------- */}
      {(overdueOrders.length > 0 ||
        fabricAlerts.length > 0 ||
        draftPurchases.length > 0 ||
        openCreditTotal > 0) ? (
        <>
          <SectionTitle>Требует внимания</SectionTitle>
          <div className="grid gap-3 md:grid-cols-2">
            {overdueOrders.length > 0 ? (
              <Card>
                <div className="mb-2 flex items-center gap-2">
                  <StatusPill tone="critical">
                    {overdueOrders.length}{" "}
                    {plural(overdueOrders.length, "заказ", "заказа", "заказов")}{" "}
                    просрочено
                  </StatusPill>
                </div>
                <div className="flex flex-col gap-2">
                  {overdueOrders.slice(0, 4).map((o) => (
                    <a
                      key={o.id}
                      href={`/orders/${o.id}`}
                      className="flex flex-wrap items-center justify-between gap-2 text-sm no-underline text-[var(--color-ink)]"
                    >
                      <span>
                        <b>{o.number}</b> · {o.factoryName}
                      </span>
                      <DeadlinePill
                        plannedReadyAt={o.plannedReadyAt}
                        actualReadyAt={o.actualReadyAt}
                        status={o.status}
                      />
                    </a>
                  ))}
                </div>
              </Card>
            ) : null}

            {fabricAlerts.length > 0 ? (
              <Card>
                <div className="mb-2 flex items-center gap-2">
                  <StatusPill tone="warn">
                    ткань заканчивается: {fabricAlerts.length}
                  </StatusPill>
                </div>
                <div className="flex flex-col gap-2">
                  {fabricAlerts.slice(0, 4).map((f) => (
                    <a
                      key={f.fabricId}
                      href={`/fabrics/${f.fabricId}`}
                      className="flex flex-wrap items-center justify-between gap-2 text-sm no-underline text-[var(--color-ink)]"
                    >
                      <span>{f.name}</span>
                      <span
                        className={`tnum text-xs ${
                          f.available < 0
                            ? "text-[#A82C2C]"
                            : "text-[var(--color-muted)]"
                        }`}
                      >
                        доступно {f.available.toFixed(1)} м
                        {f.available < 0 ? " (перерезервировано)" : ""}
                      </span>
                    </a>
                  ))}
                </div>
              </Card>
            ) : null}

            {draftPurchases.length > 0 ? (
              <Card>
                <div className="mb-2">
                  <StatusPill tone="warn">
                    заявок на ткань в черновиках: {draftPurchases.length}
                  </StatusPill>
                </div>
                <p className="m-0 text-sm text-[var(--color-muted)]">
                  Luna подготовила заявки автоматически — осталось отправить их
                  поставщику.
                </p>
                <div className="mt-2">
                  <LinkButton href="/purchases">Открыть заявки</LinkButton>
                </div>
              </Card>
            ) : null}

            {openCreditTotal > 0 && showMoney ? (
              <Card>
                <div className="mb-2">
                  <StatusPill tone="ok">
                    незачтённый брак: {formatThb(openCreditTotal)}
                  </StatusPill>
                </div>
                <p className="m-0 text-sm text-[var(--color-muted)]">
                  Эта сумма автоматически вычтется из следующих заказов на
                  соответствующих фабриках.
                </p>
              </Card>
            ) : null}
          </div>
        </>
      ) : null}

      {/* ---------- Заказы в производстве ---------- */}
      <SectionTitle>Сейчас в производстве</SectionTitle>
      {activeOrders.length === 0 ? (
        <EmptyState
          title="Активных заказов нет"
          hint="Luna подскажет, что стоит отшить, исходя из скорости продаж и остатков."
          action={
            <LinkButton href="/orders/new" variant="primary">
              + Новый заказ
            </LinkButton>
          }
        />
      ) : (
        <Card padded={false}>
          <Table>
            <thead>
              <tr>
                <Th>Заказ</Th>
                <Th>Фабрика</Th>
                <Th>Статус</Th>
                <Th align="right">Шт</Th>
                <Th align="right">Готово</Th>
                <Th>Срок</Th>
                {showMoney ? <Th align="right">Бюджет</Th> : null}
              </tr>
            </thead>
            <tbody>
              {activeOrders.map((o) => {
                const u = unitsByOrder.get(o.id);
                return (
                  <tr key={o.id}>
                    <Td>
                      <a
                        href={`/orders/${o.id}`}
                        className="font-medium text-[var(--color-ocean)] no-underline hover:underline active:underline"
                      >
                        {o.number}
                      </a>
                    </Td>
                    <Td>{o.factoryName}</Td>
                    <Td>
                      <StatusPill
                        tone={o.status === "SAMPLE" ? "warn" : "ok"}
                      >
                        {o.status === "SAMPLE" ? "образец" : "пошив"}
                      </StatusPill>
                    </Td>
                    <Td align="right">{u?.quantity ?? 0}</Td>
                    <Td align="right">
                      {u && u.quantity > 0
                        ? `${Math.round((u.produced / u.quantity) * 100)}%`
                        : "—"}
                    </Td>
                    <Td>
                      <DeadlinePill
                        plannedReadyAt={o.plannedReadyAt}
                        actualReadyAt={o.actualReadyAt}
                        status={o.status}
                      />
                    </Td>
                    {showMoney ? (
                      <Td align="right">
                        <Money value={o.snapshotTotalCost} />
                      </Td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      )}

      {/* ---------- Продажи и запас ---------- */}
      <SectionTitle>Продажи и запас</SectionTitle>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-3 text-sm font-medium text-[var(--color-ocean)]">
            Топ коллекций по выручке за 90 дней
          </div>
          {topCollections.length > 0 ? (
            <RankBars
              data={topCollections.map((c) => ({
                label: c.name,
                value: c.revenue,
                hint: `${c.units} шт продано`,
              }))}
              valueFormatter={(n) => `${Math.round(n / 1000)} тыс THB`}
            />
          ) : (
            <p className="m-0 text-sm text-[var(--color-faint)]">
              Нет данных о продажах — синхронизируйте их из Ainur.
            </p>
          )}
        </Card>

        <Card>
          <div className="mb-3 text-sm font-medium text-[var(--color-ocean)]">
            Заканчивается — стоит отшить
          </div>
          {running.length > 0 ? (
            <div className="flex flex-col gap-2.5">
              {running.map((v) => (
                <div
                  key={v.variantId}
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <a
                      href={`/products/${v.productId}`}
                      className="text-sm no-underline text-[var(--color-ink)] hover:underline active:underline"
                    >
                      {v.productName}
                      {v.color ? ` · ${v.color}` : ""}
                      {v.size ? ` · ${v.size}` : ""}
                    </a>
                    <div className="text-xs text-[var(--color-muted)]">
                      {v.stockQty} шт на складе · {v.perMonth} шт/мес
                    </div>
                  </div>
                  <CoverageBar months={v.monthsOfCover} target={OVERSTOCK_MONTHS} />
                </div>
              ))}
              <div className="mt-1">
                <LinkButton href="/orders/new" variant="primary">
                  Создать заказ на пошив
                </LinkButton>
              </div>
            </div>
          ) : (
            <p className="m-0 text-sm text-[var(--color-faint)]">
              Ничего не заканчивается — запаса хватает по всем позициям.
            </p>
          )}
        </Card>

        <Card>
          <div className="mb-1 text-sm font-medium text-[var(--color-ocean)]">
            Лежит в избытке — кандидаты на скидку или акцию
          </div>
          <p className="mt-0 mb-3 text-xs text-[var(--color-muted)]">
            Запас больше {OVERSTOCK_MONTHS} мес при текущей скорости продаж
          </p>
          {overstock.length > 0 ? (
            <div className="flex flex-col gap-2.5">
              {overstock.map((v) => (
                <div
                  key={v.variantId}
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <a
                      href={`/products/${v.productId}`}
                      className="text-sm no-underline text-[var(--color-ink)] hover:underline active:underline"
                    >
                      {v.productName}
                      {v.color ? ` · ${v.color}` : ""}
                      {v.size ? ` · ${v.size}` : ""}
                    </a>
                    <div className="text-xs text-[var(--color-muted)]">
                      {v.stockQty} шт ·{" "}
                      {v.perMonth > 0
                        ? `${v.perMonth} шт/мес`
                        : "продаж за 90 дней нет"}
                    </div>
                  </div>
                  <CoverageBar months={v.monthsOfCover} target={OVERSTOCK_MONTHS} />
                </div>
              ))}
            </div>
          ) : (
            <p className="m-0 text-sm text-[var(--color-faint)]">
              Избытка нет — склад сбалансирован.
            </p>
          )}
        </Card>

        <Card>
          <div className="mb-1 text-sm font-medium text-[var(--color-ocean)]">
            Стоит переместить между складами
          </div>
          <p className="mt-0 mb-3 text-xs text-[var(--color-muted)]">
            Где лежит без продаж — туда, где заканчивается
          </p>
          {transfers.length > 0 ? (
            <div className="flex flex-col gap-3">
              {transfers.slice(0, 5).map((t, i) => (
                <div key={`${t.variantId}-${i}`} className="text-sm">
                  <div>
                    <b className="tnum">{t.quantity} шт</b> «{t.label}»
                  </div>
                  <div className="text-xs text-[var(--color-muted)]">
                    {t.fromWarehouseName} → {t.toWarehouseName}: {t.reason}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="m-0 text-sm text-[var(--color-faint)]">
              Перемещать нечего — товар лежит там, где продаётся.
            </p>
          )}
        </Card>
      </div>

      {/* ---------- Производство по месяцам ---------- */}
      <SectionTitle>Производство по месяцам</SectionTitle>
      <Card>
        <BarChart
          data={monthly.map((m) => ({ label: m.label, value: m.units }))}
          label="Заказано в пошив, шт"
          valueFormatter={(n) => String(Math.round(n))}
        />
        {showMoney ? (
          <div className="mt-5 border-t border-[var(--color-line)] pt-4">
            <BarChart
              data={monthly.map((m) => ({ label: m.label, value: m.cost }))}
              label="Бюджет на производство, THB"
              valueFormatter={(n) =>
                n >= 1000 ? `${Math.round(n / 1000)} тыс` : String(Math.round(n))
              }
            />
          </div>
        ) : null}
      </Card>

      {/* ---------- Фабрики ---------- */}
      <SectionTitle>Фабрики</SectionTitle>
      <Card padded={false}>
        <Table>
          <thead>
            <tr>
              <Th>Фабрика</Th>
              <Th align="right">В работе</Th>
              <Th align="right">Загрузка</Th>
              <Th align="right">Вовремя</Th>
              <Th align="right">Брак</Th>
              {showMoney ? <Th align="right">Всего заказано</Th> : null}
              {showMoney ? <Th align="right">Оплачено</Th> : null}
            </tr>
          </thead>
          <tbody>
            {scorecards.map((s) => (
              <tr key={s.factoryId}>
                <Td>
                  <a
                    href={`/factories/${s.factoryId}`}
                    className="font-medium text-[var(--color-ocean)] no-underline hover:underline active:underline"
                  >
                    {s.name}
                  </a>
                </Td>
                <Td align="right">{s.unitsInProgress} шт</Td>
                <Td align="right">
                  {s.capacityUsedPct === null ? (
                    <span className="text-xs text-[var(--color-faint)]">
                      мощность не задана
                    </span>
                  ) : (
                    <StatusPill
                      tone={
                        s.capacityUsedPct > 85
                          ? "critical"
                          : s.capacityUsedPct > 60
                            ? "warn"
                            : "ok"
                      }
                    >
                      {s.capacityUsedPct}%
                    </StatusPill>
                  )}
                </Td>
                <Td align="right">
                  {s.onTimePct === null ? (
                    <span className="text-xs text-[var(--color-faint)]">—</span>
                  ) : (
                    <StatusPill
                      tone={
                        s.onTimePct >= 90
                          ? "ok"
                          : s.onTimePct >= 60
                            ? "warn"
                            : "critical"
                      }
                    >
                      {s.onTimePct}%
                    </StatusPill>
                  )}
                </Td>
                <Td align="right">
                  {s.defectPct === null ? (
                    <span className="text-xs text-[var(--color-faint)]">—</span>
                  ) : (
                    <StatusPill
                      tone={
                        s.defectPct <= 2
                          ? "ok"
                          : s.defectPct <= 5
                            ? "warn"
                            : "critical"
                      }
                    >
                      {s.defectPct}%
                    </StatusPill>
                  )}
                </Td>
                {showMoney ? (
                  <Td align="right">
                    <Money value={s.totalOrderedThb} />
                  </Td>
                ) : null}
                {showMoney ? (
                  <Td align="right">
                    <Money value={s.totalPaidThb} />
                  </Td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {/* ---------- Рекомендация Luna ---------- */}
      {recommendations.length > 0 ? (
        <>
          <SectionTitle>
            Рекомендация Luna: что отшить на 3 месяца вперёд
          </SectionTitle>
          <Card>
            <div className="flex flex-col gap-2.5">
              {recommendations.slice(0, 6).map((r) => (
                <div key={r.variantId} className="flex flex-wrap gap-2 text-sm">
                  <b className="tnum shrink-0 text-[var(--color-gold-deep)]">
                    {r.suggestedQty} шт
                  </b>
                  <span className="min-w-0">
                    {r.label}
                    <span className="block text-xs text-[var(--color-muted)]">
                      {r.reason}
                    </span>
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-4">
              <LinkButton href="/orders/new" variant="primary">
                Собрать заказ по рекомендации
              </LinkButton>
            </div>
          </Card>
        </>
      ) : null}

      {/* ---------- Синхронизация ---------- */}
      <div className="mt-8 flex flex-wrap gap-x-6 gap-y-1 border-t border-[var(--color-line)] pt-4 text-xs text-[var(--color-muted)]">
        <span>
          Товары и остатки:{" "}
          {lastSync.products
            ? formatDateTime(lastSync.products.at)
            : "ещё не синхронизировались"}
        </span>
        <span>
          Продажи:{" "}
          {lastSync.sales
            ? formatDateTime(lastSync.sales.at)
            : "ещё не синхронизировались"}
        </span>
        <span>
          Перемещения:{" "}
          {lastSync.movements
            ? formatDateTime(lastSync.movements.at)
            : "ещё не синхронизировались"}
        </span>
        <a href="/sync" className="text-[var(--color-ocean)] underline">
          Обновить из Ainur
        </a>
      </div>
    </>
  );
}

/**
 * Производство по месяцам: сколько штук и на какую сумму заказано.
 * Считаем по дате создания заказа — это момент, когда деньги на партию
 * фактически планируются.
 */
function buildMonthlyProduction(
  orders: { createdAt: string; snapshotTotalCost: number; id: string }[],
  unitsByOrder: Map<string, { quantity: number }>,
  months: number,
): { label: string; units: number; cost: number }[] {
  const out: { key: string; label: string; units: number; cost: number }[] = [];
  const now = new Date();

  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleDateString("ru-RU", { month: "short" }),
      units: 0,
      cost: 0,
    });
  }

  for (const order of orders) {
    const d = new Date(order.createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const bucket = out.find((b) => b.key === key);
    if (!bucket) continue;
    bucket.cost += order.snapshotTotalCost;
    bucket.units += unitsByOrder.get(order.id)?.quantity ?? 0;
  }

  return out.map(({ label, units, cost }) => ({ label, units, cost }));
}
