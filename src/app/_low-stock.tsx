/**
 * Блок «Пора заказывать» на главной — короткая сводка.
 * Полный список с фильтрами и планированием живёт в разделе /replenish.
 */
import { getReplenish, LOW_STOCK_THRESHOLD } from "@/lib/replenish";
import {
  Card,
  SectionTitle,
  StatusPill,
  LinkButton,
  Table,
  Th,
  Td,
} from "@/components/ui";

/** Сколько самых срочных строк показываем на главной */
const ROWS_ON_DASHBOARD = 8;

export async function LowStockTable() {
  const { rows, warehouses, totalActive, soldOutCount, totalExcluded } =
    await getReplenish({ excluded: "hide" });

  if (rows.length === 0) return null;

  const shown = rows.slice(0, ROWS_ON_DASHBOARD);

  return (
    <>
      <SectionTitle>Пора заказывать</SectionTitle>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <StatusPill tone="warn">на исходе: {totalActive}</StatusPill>
        {soldOutCount > 0 ? (
          <StatusPill tone="critical">распродано: {soldOutCount}</StatusPill>
        ) : null}
        <span className="text-xs text-[var(--color-muted)]">
          меньше {LOW_STOCK_THRESHOLD} шт на Пангане, Пхукете или в Fotesko
          {totalExcluded > 0 ? ` · ${totalExcluded} убрано вручную` : ""}
        </span>
      </div>
      <Card padded={false}>
        <Table>
          <thead>
            <tr>
              <Th>SKU</Th>
              <Th>Модель</Th>
              {warehouses.map((w) => (
                <Th key={w.id} align="right">
                  {w.short}
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
                  {r.color || r.size ? (
                    <span className="block text-xs text-[var(--color-muted)]">
                      {[r.color, r.size].filter(Boolean).join(" · ")}
                    </span>
                  ) : null}
                </Td>
                {r.cells.map((c, i) => {
                  if (c.qty === null) {
                    return (
                      <Td key={warehouses[i].id} align="right">
                        <span className="text-[var(--color-faint)]">—</span>
                      </Td>
                    );
                  }
                  if (c.soldOut) {
                    return (
                      <Td
                        key={warehouses[i].id}
                        align="right"
                        className="bg-[#FBE9E7]"
                      >
                        <span className="font-semibold text-[#A82C2C]">0</span>
                      </Td>
                    );
                  }
                  if (c.alert) {
                    return (
                      <Td
                        key={warehouses[i].id}
                        align="right"
                        className="bg-[#FDF1E3]"
                      >
                        <span className="font-semibold text-[#9A5B12]">
                          {c.qty}
                        </span>
                      </Td>
                    );
                  }
                  return (
                    <Td key={warehouses[i].id} align="right">
                      {c.qty}
                    </Td>
                  );
                })}
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
      <div className="mt-3">
        <LinkButton href="/replenish" variant="primary">
          Открыть весь список ({totalActive}) и распределить по фабрикам
        </LinkButton>
      </div>
    </>
  );
}
