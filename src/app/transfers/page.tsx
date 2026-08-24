/**
 * «Перемещения между складами» — что и куда стоит перевезти.
 *
 * Вкладки — это склад-ОТПРАВИТЕЛЬ: каждая показывает, что можно отгрузить
 * именно оттуда. Логика описана в @/lib/transfers.
 */
import {
  getTransferRecommendations,
  WAREHOUSE_META,
  LOW_STOCK_THRESHOLD,
  type TransferRow,
} from "@/lib/transfers";
import {
  Card,
  PageHeader,
  StatusPill,
  Table,
  Th,
  Td,
  EmptyState,
} from "@/components/ui";

export const metadata = { title: "Перемещения — Luna Production" };

export default async function TransfersPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  const data = await getTransferRecommendations();

  const activeSource =
    from && data.warehouseOrder.includes(from) ? from : data.warehouseOrder[0];

  const rows = data.bySource[activeSource] ?? [];

  return (
    <>
      <PageHeader
        title="Перемещения между складами"
        subtitle={`Fotesko пополняет точки, когда там меньше ${LOW_STOCK_THRESHOLD} шт. Пхукет и Панган ещё выравниваются между собой — цель, чтобы одной модели было примерно поровну на обеих точках.`}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusPill tone={data.total > 0 ? "warn" : "ok"}>
          рекомендаций: {data.total}
        </StatusPill>
      </div>

      {/* ---------- Вкладки по складу-отправителю ---------- */}
      <div className="mb-4 -mx-4 overflow-x-auto px-4">
        <div className="flex gap-2">
          {data.warehouseOrder.map((wh) => {
            const meta = WAREHOUSE_META[wh] ?? { short: wh, slug: wh };
            const count = data.bySource[wh]?.length ?? 0;
            const isCurrent = wh === activeSource;
            return (
              <a
                key={wh}
                href={`/transfers?from=${encodeURIComponent(wh)}`}
                className={`touch inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-sm no-underline transition-transform duration-100 active:scale-[0.97] ${
                  isCurrent
                    ? "border-[var(--color-gold)] bg-[var(--color-gold)]/10 text-[var(--color-gold-deep)]"
                    : "border-[var(--color-line)] bg-white text-[var(--color-ink)]"
                }`}
              >
                {meta.short}
                <span className="tnum text-xs opacity-60">{count}</span>
              </a>
            );
          })}
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="С этого склада перемещать пока ничего не нужно"
          hint="Либо всё в достатке, либо нечем поделиться с соседними точками."
        />
      ) : (
        <Card padded={false}>
          <Table>
            <thead>
              <tr>
                <Th>SKU</Th>
                <Th>Модель</Th>
                <Th>Коллекция</Th>
                <Th align="right">Здесь</Th>
                <Th>Куда</Th>
                <Th align="right">Там сейчас</Th>
                <Th align="right">Везём</Th>
                <Th>Почему</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <TransferRowView key={`${r.variantId}-${r.to}`} row={r} />
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <p className="mt-4 text-xs text-[var(--color-faint)]">
        Это рекомендация, не факт перемещения — сам перевоз и списание/приход
        между складами делаются руками в Ainur. Позиции, помеченные «не
        повторять» в «Пора заказывать», сюда не попадают.
      </p>
    </>
  );
}

function TransferRowView({ row }: { row: TransferRow }) {
  const destMeta = WAREHOUSE_META[row.to] ?? { short: row.to };
  return (
    <tr>
      <Td>
        <a
          href={`/products/${row.productId}`}
          className="font-medium text-[var(--color-ocean)] no-underline hover:underline active:underline"
        >
          {row.sku}
        </a>
      </Td>
      <Td>
        <span className="line-clamp-1">{row.productName}</span>
        {row.color || row.size ? (
          <span className="block text-xs text-[var(--color-muted)]">
            {[row.color, row.size].filter(Boolean).join(" · ")}
          </span>
        ) : null}
      </Td>
      <Td>
        <span className="line-clamp-1 text-[var(--color-muted)]">
          {row.collectionName}
        </span>
      </Td>
      <Td align="right">{row.fromQty}</Td>
      <Td>{destMeta.short}</Td>
      <Td align="right">
        <span
          className={
            row.toQty === 0
              ? "font-semibold text-[#A82C2C]"
              : "font-semibold text-[#9A5B12]"
          }
        >
          {row.toQty}
        </span>
      </Td>
      <Td align="right">
        <span className="font-semibold text-[var(--color-ocean)]">
          {row.suggestedQty}
        </span>
      </Td>
      <Td>
        <span className="text-xs text-[var(--color-muted)]">
          {row.reason === "restock" ? "пополнение" : "выравнивание"}
        </span>
      </Td>
    </tr>
  );
}
