import { Card, StatusPill, formatDate } from "@/components/ui";
import { plural } from "./orders/_shared";
import { usaOrderShortNumber } from "@/lib/usa-reorder-rules";
import type { UsaOverview } from "@/lib/usa-reorder";

/** Пара карточек по складу США: активный заказ + что заказывать (как на утверждённом макете). */
export function UsaCards({
  usa,
  usaProgress,
  className = "mt-3",
}: {
  usa: UsaOverview;
  usaProgress: number;
  className?: string;
}) {
  return (
    <div className={`${className} grid grid-cols-2 gap-3`}>
            <Card padded={false}>
              <a
                href="/orders/usa"
                className="block p-3 no-underline text-[var(--color-ink)] hover:bg-[var(--color-sand-warm)] sm:p-5"
              >
                <div className="flex items-center gap-2 text-sm font-medium">
                  Активный заказ США
                  {usa.orders.length > 0 ? (
                    <StatusPill tone="ok">В работе</StatusPill>
                  ) : null}
                </div>
                {usa.orders.length === 0 ? (
                  <div className="mt-2 text-sm text-[var(--color-muted)]">
                    Активных заказов нет
                  </div>
                ) : (
                  <>
                    <div className="mt-2 text-2xl font-semibold text-[var(--color-ink)] sm:text-3xl">
                      № {usa.orders.map((o) => usaOrderShortNumber(o.number, o.note)).join(", ")}
                      <span className="ml-2 text-base font-normal text-[var(--color-muted)]">
                        · {usa.totalUnitsInOrders} шт
                      </span>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#E6E6E6]">
                      <div
                        className="h-full rounded-full bg-[var(--color-ocean)]"
                        style={{ width: `${usaProgress}%` }}
                      />
                    </div>
                    <div className="mt-1.5 flex justify-between text-xs text-[var(--color-muted)]">
                      <span>{usa.orders[0].factoryName}</span>
                      <span>
                        {usa.orders[0].plannedReadyAt
                          ? `готовность ${formatDate(usa.orders[0].plannedReadyAt)}`
                          : "срок не задан"}
                      </span>
                    </div>
                  </>
                )}
                <div className="mt-3 text-sm font-medium text-[#3B5BA5]">
                  Открыть заказ →
                </div>
              </a>
            </Card>
            <Card padded={false}>
              <a
                href="/orders/usa"
                className="block p-3 no-underline text-[var(--color-ink)] hover:bg-[var(--color-sand-warm)] sm:p-5"
              >
                <div className="flex items-center gap-2 text-sm font-medium">
                  Склад США: что заказывать
                  {usa.need.length > 0 ? (
                    <StatusPill tone="critical">{usa.need.length}</StatusPill>
                  ) : null}
                </div>
                <div
                  className={`mt-2 text-2xl font-semibold sm:text-3xl ${
                    usa.need.length > 0 ? "text-[#A82C2C]" : "text-[var(--color-ocean)]"
                  }`}
                >
                  {usa.need.length}
                  <span className="ml-2 text-base font-normal text-[var(--color-muted)]">
                    {plural(usa.need.length, "позиция не в заказе", "позиции не в заказе", "позиций не в заказе")}
                  </span>
                </div>
                <div className="mt-2 flex flex-col gap-0.5 text-sm">
                  {usa.need.length > 0 ? (
                    <>
                      {usa.need.slice(0, 3).map((r) => (
                        <div key={r.rule.skus[0]}>
                          <b>{r.rule.model} {r.rule.color}</b>
                          <span className="text-[var(--color-muted)]">
                            {" "}· остаток {r.stock} · заказать {r.rule.reorderQty} шт
                          </span>
                        </div>
                      ))}
                      {usa.need.length > 3 ? (
                        <div className="text-xs text-[var(--color-muted)]">
                          и ещё {usa.need.length - 3}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="text-[var(--color-muted)]">
                      Всё, что заканчивается, уже закрыто заказом
                    </div>
                  )}
                </div>
                {usa.covered.length > 0 ? (
                  <div className="mt-2 text-xs text-[var(--color-muted)]">
                    Ещё {usa.covered.length} заканчиваются, но уже в заказе{" "}
                    {usa.orders.map((o) => usaOrderShortNumber(o.number, o.note)).join(", ")}
                  </div>
                ) : null}
                <div className="mt-3 text-sm font-medium text-[#3B5BA5]">
                  Открыть Orders →
                </div>
              </a>
            </Card>
          </div>
  );
}
