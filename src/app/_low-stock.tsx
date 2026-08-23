/**
 * «Пора заказывать» — что заканчивается на трёх наших собственных складах.
 *
 * Партнёрские магазины (BBH, Birds of Paradice, MUSE Group) и склад в США
 * сюда НЕ входят: у них другая логика пополнения. Следим только за складами
 * из WATCHED_WAREHOUSES.
 *
 * Порог: меньше трёх штук на складе — уже повод думать о заказе.
 *
 * Про нули. В базе почти у каждого SKU есть запись с нулём по каждому складу —
 * это «никогда там не лежало», а не «закончилось». Если показывать все нули,
 * в таблицу попадает 905 SKU из 924 и читать её бессмысленно. Поэтому ноль
 * считаем сигналом только тогда, когда позиция на ЭТОМ складе продавалась за
 * последние ZERO_SALES_DAYS дней: значит спрос есть, а товара нет.
 */
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import {
  Card,
  SectionTitle,
  StatusPill,
  Table,
  Th,
  Td,
} from "@/components/ui";

/** Склады, за которыми следим. Порядок задаёт порядок колонок. */
export const WATCHED_WAREHOUSES = [
  "Phangan",
  "Phuket",
  "Fotesko Warehouse",
] as const;

/** Короткие подписи для колонок */
const SHORT_NAME: Record<string, string> = {
  Phangan: "Панган",
  Phuket: "Пхукет",
  "Fotesko Warehouse": "Fotesko",
};

/** Меньше этого количества на складе — пора заказывать */
export const LOW_STOCK_THRESHOLD = 3;

/** За сколько дней смотрим продажи, чтобы отличить «закончилось» от «не было» */
const ZERO_SALES_DAYS = 90;

/** Сколько строк показываем на главной */
const ROWS_ON_DASHBOARD = 15;

interface Cell {
  /** остаток на складе; null — записи по этому складу нет вовсе */
  qty: number | null;
  /** попадает под порог и это осмысленный сигнал */
  alert: boolean;
  /** ноль, но позиция здесь продавалась — самый срочный случай */
  soldOut: boolean;
}

export interface LowStockRow {
  variantId: string;
  sku: string;
  productId: string;
  productName: string;
  size: string | null;
  color: string | null;
  collectionName: string;
  cells: Cell[];
  /** сколько складов из наблюдаемых дали сигнал */
  alerts: number;
  /** суммарный остаток по наблюдаемым складам */
  totalWatched: number;
  /** осталось дошить в активных заказах, шт */
  onOrder: number;
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

export async function getLowStock(): Promise<{
  rows: LowStockRow[];
  warehouses: { id: string; name: string }[];
}> {
  const warehouses = await db
    .select({ id: schema.warehouses.id, name: schema.warehouses.name })
    .from(schema.warehouses)
    .where(inArray(schema.warehouses.name, [...WATCHED_WAREHOUSES]));

  // порядок колонок — как в WATCHED_WAREHOUSES, а не как вернула база
  const ordered = WATCHED_WAREHOUSES.map((n) =>
    warehouses.find((w) => w.name === n),
  ).filter((w): w is { id: string; name: string } => Boolean(w));

  if (ordered.length === 0) return { rows: [], warehouses: [] };

  const whIds = ordered.map((w) => w.id);

  // ---------- остатки ----------
  const stock = await db
    .select({
      variantId: schema.variantStock.variantId,
      warehouseId: schema.variantStock.warehouseId,
      quantity: schema.variantStock.quantity,
      sku: schema.productVariants.sku,
      size: schema.productVariants.size,
      color: schema.productVariants.color,
      productId: schema.products.id,
      productName: schema.products.name,
      collectionName: schema.collections.name,
    })
    .from(schema.variantStock)
    .innerJoin(
      schema.productVariants,
      eq(schema.variantStock.variantId, schema.productVariants.id),
    )
    .innerJoin(
      schema.products,
      eq(schema.productVariants.productId, schema.products.id),
    )
    .innerJoin(
      schema.collections,
      eq(schema.products.collectionId, schema.collections.id),
    )
    .where(
      and(
        inArray(schema.variantStock.warehouseId, whIds),
        eq(schema.productVariants.isArchived, false),
        eq(schema.products.isArchived, false),
      ),
    );

  // ---------- продажи за окно: variantId|warehouseId -> шт ----------
  const soldRows = await db
    .select({
      variantId: schema.variantSalesDaily.variantId,
      warehouseId: schema.variantSalesDaily.warehouseId,
      units: sql<number>`COALESCE(SUM(${schema.variantSalesDaily.units}), 0)`,
    })
    .from(schema.variantSalesDaily)
    .where(gte(schema.variantSalesDaily.day, daysAgo(ZERO_SALES_DAYS)))
    .groupBy(
      schema.variantSalesDaily.variantId,
      schema.variantSalesDaily.warehouseId,
    );

  const sold = new Set<string>();
  for (const r of soldRows) {
    if (Number(r.units) > 0 && r.warehouseId) {
      sold.add(`${r.variantId}|${r.warehouseId}`);
    }
  }

  // ---------- сколько ещё дошьют по активным заказам ----------
  const orderRows = await db
    .select({
      variantId: schema.productionOrderLines.variantId,
      quantity: schema.productionOrderLines.quantity,
      produced: schema.productionOrderLines.qtyProduced,
    })
    .from(schema.productionOrderLines)
    .innerJoin(
      schema.productionOrders,
      eq(schema.productionOrderLines.orderId, schema.productionOrders.id),
    )
    .where(
      inArray(schema.productionOrders.status, ["SAMPLE", "IN_PRODUCTION"]),
    );

  const onOrder = new Map<string, number>();
  for (const r of orderRows) {
    if (!r.variantId) continue;
    const left = Math.max(0, Number(r.quantity) - Number(r.produced));
    if (left > 0) onOrder.set(r.variantId, (onOrder.get(r.variantId) ?? 0) + left);
  }

  // ---------- собираем строки ----------
  const byVariant = new Map<string, LowStockRow>();

  for (const s of stock) {
    let row = byVariant.get(s.variantId);
    if (!row) {
      row = {
        variantId: s.variantId,
        sku: s.sku,
        productId: s.productId,
        productName: s.productName,
        size: s.size,
        color: s.color,
        collectionName: s.collectionName,
        cells: ordered.map(() => ({ qty: null, alert: false, soldOut: false })),
        alerts: 0,
        totalWatched: 0,
        onOrder: onOrder.get(s.variantId) ?? 0,
      };
      byVariant.set(s.variantId, row);
    }

    const idx = whIds.indexOf(s.warehouseId);
    if (idx < 0) continue;

    const qty = Number(s.quantity);
    const soldHere = sold.has(`${s.variantId}|${s.warehouseId}`);
    const alert = qty < LOW_STOCK_THRESHOLD && (qty > 0 || soldHere);

    row.cells[idx] = { qty, alert, soldOut: qty === 0 && soldHere };
    row.totalWatched += qty;
  }

  const rows: LowStockRow[] = [];
  for (const row of byVariant.values()) {
    row.alerts = row.cells.filter((c) => c.alert).length;
    if (row.alerts > 0) rows.push(row);
  }

  // сначала то, где пусто на нескольких складах, потом по общему остатку
  rows.sort((a, b) => {
    const soldA = a.cells.filter((c) => c.soldOut).length;
    const soldB = b.cells.filter((c) => c.soldOut).length;
    if (soldB !== soldA) return soldB - soldA;
    if (b.alerts !== a.alerts) return b.alerts - a.alerts;
    if (a.totalWatched !== b.totalWatched) return a.totalWatched - b.totalWatched;
    return a.sku.localeCompare(b.sku);
  });

  return { rows, warehouses: ordered };
}

function QtyCell({ cell }: { cell: Cell }) {
  if (cell.qty === null) {
    return (
      <Td align="right">
        <span className="text-[var(--color-faint)]">—</span>
      </Td>
    );
  }
  if (cell.soldOut) {
    return (
      <Td align="right" className="bg-[#FBE9E7]">
        <span className="font-semibold text-[#A82C2C]">0</span>
      </Td>
    );
  }
  if (cell.alert) {
    return (
      <Td align="right" className="bg-[#FDF1E3]">
        <span className="font-semibold text-[#9A5B12]">{cell.qty}</span>
      </Td>
    );
  }
  return <Td align="right">{cell.qty}</Td>;
}

/**
 * Таблица «Пора заказывать» для главной страницы.
 * Ничего не показывает, если заказывать нечего.
 */
export async function LowStockTable() {
  const { rows, warehouses } = await getLowStock();
  if (rows.length === 0) return null;

  const soldOutCount = rows.filter((r) =>
    r.cells.some((c) => c.soldOut),
  ).length;
  const shown = rows.slice(0, ROWS_ON_DASHBOARD);

  return (
    <>
      <SectionTitle>Пора заказывать</SectionTitle>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <StatusPill tone="warn">позиций на исходе: {rows.length}</StatusPill>
        {soldOutCount > 0 ? (
          <StatusPill tone="critical">
            распродано полностью: {soldOutCount}
          </StatusPill>
        ) : null}
        <span className="text-xs text-[var(--color-muted)]">
          меньше {LOW_STOCK_THRESHOLD} шт на складе · только Панган, Пхукет и
          Fotesko · ноль показываем, если позиция там продавалась за{" "}
          {ZERO_SALES_DAYS} дней
        </span>
      </div>
      <Card padded={false}>
        <Table>
          <thead>
            <tr>
              <Th>SKU</Th>
              <Th>Модель</Th>
              <Th>Коллекция</Th>
              {warehouses.map((w) => (
                <Th key={w.id} align="right">
                  {SHORT_NAME[w.name] ?? w.name}
                </Th>
              ))}
              <Th align="right">В заказе</Th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.variantId}>
                <Td>
                  <a
                    href={`/products/${r.productId}`}
                    className="font-medium text-[var(--color-ocean)] no-underline hover:underline active:underline"
                  >
                    {r.sku}
                  </a>
                </Td>
                <Td>
                  <span className="line-clamp-1">{r.productName}</span>
                  {r.size || r.color ? (
                    <span className="block text-xs text-[var(--color-muted)]">
                      {[r.color, r.size].filter(Boolean).join(" · ")}
                    </span>
                  ) : null}
                </Td>
                <Td>
                  <span className="line-clamp-1 text-[var(--color-muted)]">
                    {r.collectionName}
                  </span>
                </Td>
                {r.cells.map((c, i) => (
                  <QtyCell key={warehouses[i].id} cell={c} />
                ))}
                <Td align="right">
                  {r.onOrder > 0 ? (
                    <span className="text-[var(--color-ocean)]">
                      {r.onOrder}
                    </span>
                  ) : (
                    <span className="text-[var(--color-faint)]">—</span>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      {rows.length > shown.length ? (
        <p className="mt-2 mb-0 text-xs text-[var(--color-muted)]">
          Показаны первые {shown.length} из {rows.length} — самые срочные
          сверху. Полный список: раздел «Изделия», фильтр по остаткам.
        </p>
      ) : null}
    </>
  );
}
