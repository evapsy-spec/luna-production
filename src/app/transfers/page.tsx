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
  Field,
  Input,
  Button,
  LinkButton,
} from "@/components/ui";

export const metadata = { title: "Перемещения — Luna Production" };

interface Params {
  from?: string;
  minSold12m?: string;
  minQty?: string;
}

function toNonNeg(raw?: string): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
}

export default async function TransfersPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const params = await searchParams;
  const minSold12m = toNonNeg(params.minSold12m);
  const minSuggestedQty = toNonNeg(params.minQty);

  const data = await getTransferRecommendations({ minSold12m, minSuggestedQty });

  const activeSource =
    params.from && data.warehouseOrder.includes(params.from)
      ? params.from
      : data.warehouseOrder[0];

  const rows = data.bySource[activeSource] ?? [];

  // Хвост фильтров, чтобы вкладки склада не сбрасывали выбранные фильтры
  const filterQuery = new URLSearchParams();
  if (params.minSold12m) filterQuery.set("minSold12m", params.minSold12m);
  if (params.minQty) filterQuery.set("minQty", params.minQty);
  const filterTail = filterQuery.toString() ? `&${filterQuery.toString()}` : "";

  return (
    <>
      <PageHeader
        title="Перемещения между складами"
        subtitle={`Fotesko пополняет точки, когда там меньше ${LOW_STOCK_THRESHOLD} шт. Пхукет и Панган ещё выравниваются между собой — цель, чтобы одной модели было примерно поровну на обеих точках. Наверху — модели с движением за последние 12 месяцев, внизу — то, что не продавалось вовсе.`}
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
                href={`/transfers?from=${encodeURIComponent(wh)}${filterTail}`}
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

      {/* ---------- Фильтры ---------- */}
      <Card className="mb-4">
        <form method="get" className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
          <input type="hidden" name="from" value={activeSource} />
          <Field label="Продано за 12 мес, не меньше" hint="пусто — не фильтровать">
            <Input
              type="number"
              name="minSold12m"
              min={0}
              inputMode="numeric"
              defaultValue={params.minSold12m ?? ""}
              placeholder="—"
            />
          </Field>
          <Field label="Везём, не меньше" hint="отсечь рейсы ради пары штук">
            <Input
              type="number"
              name="minQty"
              min={0}
              inputMode="numeric"
              defaultValue={params.minQty ?? ""}
              placeholder="—"
            />
          </Field>
          <Button type="submit" variant="primary">
            Применить
          </Button>
          <LinkButton href={`/transfers?from=${encodeURIComponent(activeSource)}`}>
            Сбросить
          </LinkButton>
        </form>
      </Card>

      {rows.length === 0 ? (
        <EmptyState
          title="С этого склада перемещать пока ничего не нужно"
          hint={
            minSold12m !== undefined || minSuggestedQty !== undefined
              ? "По этим фильтрам ничего нет — попробуйте их сбросить."
              : "Либо всё в достатке, либо нечем поделиться с соседними точками."
          }
          action={
            minSold12m !== undefined || minSuggestedQty !== undefined ? (
              <LinkButton href={`/transfers?from=${encodeURIComponent(activeSource)}`}>
                Сбросить фильтры
              </LinkButton>
            ) : undefined
          }
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
                <TransferRowView key={`${r.variantId}-${r.from}-${r.reason}`} row={r} />
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
  // Обычно одна точка назначения. Когда с Fotesko не хватает сразу и
  // Пхукету, и Пангану, splits содержит обе — тогда в каждой ячейке
  // выводим их построчно, друг под другом, в одном и том же порядке.
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
      <Td>
        <div className="flex flex-col gap-0.5">
          {row.splits.map((s) => {
            const destMeta = WAREHOUSE_META[s.to] ?? { short: s.to };
            return <span key={s.to}>{destMeta.short}</span>;
          })}
        </div>
      </Td>
      <Td align="right">
        <div className="flex flex-col gap-0.5">
          {row.splits.map((s) => (
            <span
              key={s.to}
              className={
                s.toQty === 0
                  ? "font-semibold text-[#A82C2C]"
                  : "font-semibold text-[#9A5B12]"
              }
            >
              {s.toQty}
            </span>
          ))}
        </div>
      </Td>
      <Td align="right">
        <div className="flex flex-col gap-0.5">
          {row.splits.map((s) => (
            <span key={s.to} className="font-semibold text-[var(--color-ocean)]">
              {s.suggestedQty}
            </span>
          ))}
        </div>
      </Td>
      <Td>
        <span className="text-xs text-[var(--color-muted)]">
          {row.reason === "restock" ? "пополнение" : "выравнивание"}
          {row.splits.length > 1 ? " · обеим точкам" : ""}
        </span>
      </Td>
    </tr>
  );
}
