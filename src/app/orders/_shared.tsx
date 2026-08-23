/**
 * Общие части раздела заказов на пошив.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { StatusPill, type StatusTone } from "@/components/ui";

export function parseNum(value: FormDataEntryValue | null): number | null {
  if (value === null) return null;
  const raw = String(value).trim().replace(",", ".");
  if (raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function parseInt0(value: FormDataEntryValue | null): number {
  const n = parseNum(value);
  return n === null ? 0 : Math.max(0, Math.round(n));
}

export function parseStr(value: FormDataEntryValue | null): string | null {
  if (value === null) return null;
  const raw = String(value).trim();
  return raw === "" ? null : raw;
}

/** Дата из <input type="date"> → ISO-строка, как хранится в БД */
export function parseDate(value: FormDataEntryValue | null): string | null {
  const raw = parseStr(value);
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** ISO-строка → значение для <input type="date"> */
export function toDateInput(value?: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

export const STATUS_LABELS: Record<string, string> = {
  SAMPLE: "Образец",
  IN_PRODUCTION: "В производстве",
  READY: "Готово",
  RECEIVED: "Принято на склад",
  CANCELLED: "Отменён",
};

/**
 * Следующий номер заказа вида PO-2026-007.
 * Считаем от максимального занятого номера в текущем году, а не от количества
 * заказов — иначе после удаления номер бы повторился.
 */
export async function nextOrderNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `PO-${year}-`;
  const rows = await db
    .select({ number: schema.productionOrders.number })
    .from(schema.productionOrders);

  let max = 0;
  for (const row of rows) {
    if (!row.number.startsWith(prefix)) continue;
    const n = Number(row.number.slice(prefix.length));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

export async function nextPurchaseNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `FP-${year}-`;
  const rows = await db
    .select({ number: schema.fabricPurchases.number })
    .from(schema.fabricPurchases);

  let max = 0;
  for (const row of rows) {
    if (!row.number.startsWith(prefix)) continue;
    const n = Number(row.number.slice(prefix.length));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

/** Просрочен ли заказ: плановая дата в прошлом, а он всё ещё не сдан */
export function isOverdue(order: {
  status: string;
  plannedReadyAt: string | null;
  actualReadyAt: string | null;
}): boolean {
  if (order.status === "RECEIVED" || order.status === "CANCELLED") return false;
  if (order.actualReadyAt) return false;
  if (!order.plannedReadyAt) return false;
  return new Date(order.plannedReadyAt) < new Date();
}

export function daysUntil(value?: string | null): number | null {
  if (!value) return null;
  const diff = new Date(value).getTime() - Date.now();
  return Math.ceil(diff / (24 * 3600 * 1000));
}

/** Срок: «через 9 дней» / «просрочен на 4 дня» — с иконкой и подписью */
export function DeadlinePill({
  plannedReadyAt,
  status,
  actualReadyAt,
}: {
  plannedReadyAt: string | null;
  status: string;
  actualReadyAt: string | null;
}) {
  if (!plannedReadyAt) {
    return <StatusPill tone="neutral">срок не задан</StatusPill>;
  }
  if (actualReadyAt) {
    const late =
      new Date(actualReadyAt).getTime() > new Date(plannedReadyAt).getTime();
    return (
      <StatusPill tone={late ? "serious" : "ok"}>
        {late ? "сдан с опозданием" : "сдан вовремя"}
      </StatusPill>
    );
  }
  if (status === "CANCELLED") return <StatusPill tone="neutral">отменён</StatusPill>;

  const days = daysUntil(plannedReadyAt);
  if (days === null) return null;
  if (days < 0) {
    const late = Math.abs(days);
    return (
      <StatusPill tone="critical">
        просрочен на {late} {plural(late, "день", "дня", "дней")}
      </StatusPill>
    );
  }
  const tone: StatusTone = days <= 7 ? "warn" : "ok";
  return (
    <StatusPill tone={tone}>
      через {days} {plural(days, "день", "дня", "дней")}
    </StatusPill>
  );
}

export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

/** Сумма оплат по заказам: id заказа → сколько уже заплачено */
export async function getPaidByOrder(
  orderIds: string[],
): Promise<Map<string, number>> {
  if (orderIds.length === 0) return new Map();
  const rows = await db
    .select({
      orderId: schema.orderPayments.orderId,
      total: sql<number>`COALESCE(SUM(${schema.orderPayments.amount}), 0)`,
    })
    .from(schema.orderPayments)
    .where(inArray(schema.orderPayments.orderId, orderIds))
    .groupBy(schema.orderPayments.orderId);
  return new Map(rows.map((r) => [r.orderId, Number(r.total) || 0]));
}

/** Штуки по заказам: сколько заказано / сделано / забраковано */
export async function getUnitsByOrder(orderIds: string[]): Promise<
  Map<string, { quantity: number; produced: number; defect: number }>
> {
  if (orderIds.length === 0) return new Map();
  const rows = await db
    .select({
      orderId: schema.productionOrderLines.orderId,
      quantity: sql<number>`COALESCE(SUM(${schema.productionOrderLines.quantity}), 0)`,
      produced: sql<number>`COALESCE(SUM(${schema.productionOrderLines.qtyProduced}), 0)`,
      defect: sql<number>`COALESCE(SUM(${schema.productionOrderLines.qtyDefect}), 0)`,
    })
    .from(schema.productionOrderLines)
    .where(inArray(schema.productionOrderLines.orderId, orderIds))
    .groupBy(schema.productionOrderLines.orderId);

  return new Map(
    rows.map((r) => [
      r.orderId,
      {
        quantity: Number(r.quantity) || 0,
        produced: Number(r.produced) || 0,
        defect: Number(r.defect) || 0,
      },
    ]),
  );
}

/**
 * Снимает резерв ткани по заказу и синхронизирует денормализованное
 * поле reservedM на складе. Вызывается при отмене и при приёмке заказа:
 * ткань уже израсходована или больше не нужна — держать её незачем.
 */
export async function releaseReservations(orderId: string): Promise<void> {
  const reservations = await db
    .select()
    .from(schema.fabricReservations)
    .where(
      and(
        eq(schema.fabricReservations.orderId, orderId),
        eq(schema.fabricReservations.released, false),
      ),
    );

  for (const res of reservations) {
    await db
      .update(schema.fabricReservations)
      .set({ released: true })
      .where(eq(schema.fabricReservations.id, res.id));

    if (!res.warehouseId) continue;
    const stock = await db
      .select()
      .from(schema.fabricStock)
      .where(
        and(
          eq(schema.fabricStock.fabricId, res.fabricId),
          eq(schema.fabricStock.warehouseId, res.warehouseId),
        ),
      )
      .limit(1);
    if (!stock.length) continue;

    await db
      .update(schema.fabricStock)
      .set({
        reservedM: Math.max(0, stock[0].reservedM - res.meters),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.fabricStock.id, stock[0].id));
  }
}

/**
 * Списывает израсходованный метраж со склада при приёмке заказа.
 * До этого момента ткань только зарезервирована, физически она ещё на складе.
 */
export async function consumeReservedFabric(orderId: string): Promise<void> {
  const reservations = await db
    .select()
    .from(schema.fabricReservations)
    .where(
      and(
        eq(schema.fabricReservations.orderId, orderId),
        eq(schema.fabricReservations.released, false),
      ),
    );

  for (const res of reservations) {
    if (!res.warehouseId) continue;
    const stock = await db
      .select()
      .from(schema.fabricStock)
      .where(
        and(
          eq(schema.fabricStock.fabricId, res.fabricId),
          eq(schema.fabricStock.warehouseId, res.warehouseId),
        ),
      )
      .limit(1);
    if (!stock.length) continue;

    await db
      .update(schema.fabricStock)
      .set({
        onHandM: Math.max(0, stock[0].onHandM - res.meters),
        reservedM: Math.max(0, stock[0].reservedM - res.meters),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.fabricStock.id, stock[0].id));
  }

  await db
    .update(schema.fabricReservations)
    .set({ released: true })
    .where(
      and(
        eq(schema.fabricReservations.orderId, orderId),
        eq(schema.fabricReservations.released, false),
      ),
    );
}

/**
 * Зачитывает незакрытый кредит за брак в новый заказ этой фабрики.
 * Ева просила: стоимость брака вычитается из СЛЕДУЮЩЕГО заказа.
 * Возвращает зачтённую сумму.
 */
export async function applyDefectCredits(
  factoryId: string,
  orderId: string,
): Promise<number> {
  const open = await db
    .select()
    .from(schema.defectCredits)
    .where(
      and(
        eq(schema.defectCredits.factoryId, factoryId),
        isNull(schema.defectCredits.appliedToOrderId),
      ),
    );

  if (open.length === 0) return 0;

  const now = new Date().toISOString();
  let total = 0;
  for (const credit of open) {
    // не зачитываем брак в тот же заказ, в котором он и возник
    if (credit.orderId === orderId) continue;
    await db
      .update(schema.defectCredits)
      .set({ appliedToOrderId: orderId, appliedAt: now })
      .where(eq(schema.defectCredits.id, credit.id));
    total += credit.amount;
  }

  if (total > 0) {
    await db
      .update(schema.productionOrders)
      .set({ appliedDefectCredit: total, updatedAt: now })
      .where(eq(schema.productionOrders.id, orderId));
  }
  return total;
}
