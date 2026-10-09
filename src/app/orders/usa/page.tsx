/**
 * «Склад США» — три блока: что заказано, что нужно заказать, что заканчивается.
 * Логика и правила — в @/lib/usa-reorder и @/lib/usa-reorder-rules.
 */
import {
  Card,
  PageHeader,
  LinkButton,
  Stat,
  StatusPill,
  OrderStatusPill,
  EmptyState,
  Callout,
  Table,
  Th,
  Td,
  formatDate,
} from "@/components/ui";
import { getUsaOverview, type RuleResult } from "@/lib/usa-reorder";
import { plural } from "../_shared";

export const metadata = { title: "Склад США — Luna Production" };
export const dynamic = "force-dynamic";

function RuleRows({ items, withOrdered }: { items: RuleResult[]; withOrdered: boolean }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>Позиция</Th>
          <Th align="center">Уровень</Th>
          <Th align="right">Остаток США</Th>
          <Th align="right">Порог</Th>
          <Th align="right">{withOrdered ? "В заказе" : "Заказать"}</Th>
        </tr>
      </thead>
      <tbody>
        {items.map((r) => (
          <tr key={r.rule.skus.join("+")}>
            <Td>
              <div className="font-medium">
                {r.rule.model} · {r.rule.color}
              </div>
              <div className="text-xs text-[var(--color-muted)]">
                SKU {r.rule.skus.join(" + ")}
              </div>
            </Td>
            <Td align="center">{r.rule.tier}</Td>
            <Td align="right">
              <b className={r.stock === 0 ? "text-[#A82C2C]" : ""}>{r.stock}</b>
            </Td>
            <Td align="right">&lt; {r.threshold}</Td>
            <Td align="right">
              <b>{withOrdered ? `${r.ordered} шт` : `${r.rule.reorderQty} шт`}</b>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export default async function UsaOrdersPage() {
  const ov = await getUsaOverview();
  const main = ov.orders[0];

  return (
    <>
      <PageHeader
        title="Склад США"
        subtitle="Что заказано у Джонни, что пора заказывать и что заканчивается"
        action={
          <div className="flex flex-wrap gap-2">
            <LinkButton href="/orders">← Все заказы на пошив</LinkButton>
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Активных заказов"
          value={ov.orders.length}
          sub={ov.orders.map((o) => o.number).join(", ") || "нет"}
        />
        <Stat label="В заказах" value={`${ov.totalUnitsInOrders} шт`} sub="ещё не принято на склад" />
        <Stat
          label="Нужно заказать"
          value={ov.need.length}
          sub={ov.need.length > 0 ? "нет в активном заказе" : "всё закрыто заказом"}
        />
        <Stat
          label="Заканчивается"
          value={ov.covered.length}
          sub="уже есть в активном заказе"
        />
      </div>

      {ov.unknown.length > 0 ? (
        <Callout tone="warn" title="Часть правил не нашла товар в базе">
          Нет SKU: {ov.unknown.map((u) => u.rule.skus.join("+")).join(", ")}.
          Эти позиции пока не отслеживаются — проверьте синхронизацию с Ainur.
        </Callout>
      ) : null}

      {/* ---------- 1. Что заказано ---------- */}
      <h2 className="mt-2 mb-3 border-b-2 border-[var(--color-gold)] pb-2 text-lg">
        1. Что заказано
      </h2>
      {ov.orders.length === 0 ? (
        <EmptyState
          title="Активных заказов для склада США нет"
          hint="Заказ Джонни появится здесь, когда его статус «В производстве» или «Готово»."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {ov.orders.map((o) => (
            <Card key={o.id}>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <a href={`/orders/${o.id}`} className="figure text-base text-[var(--color-ocean)]">
                  {o.number}
                </a>
                <OrderStatusPill status={o.status} />
                {o.plannedReadyAt ? (
                  <StatusPill tone="neutral">готовность {formatDate(o.plannedReadyAt)}</StatusPill>
                ) : (
                  <StatusPill tone="warn">срок не задан</StatusPill>
                )}
                <span className="text-sm text-[var(--color-muted)]">
                  {o.factoryName} · {o.units} шт · создан {formatDate(o.createdAt)}
                </span>
              </div>
              <Table>
                <thead>
                  <tr>
                    <Th>Модель</Th>
                    <Th>Цвета и количество</Th>
                    <Th align="right">Всего</Th>
                  </tr>
                </thead>
                <tbody>
                  {o.groups.map((g) => (
                    <tr key={g.model}>
                      <Td className="font-medium">{g.model}</Td>
                      <Td>
                        <div className="flex flex-wrap gap-1.5">
                          {g.colors.map((c) => (
                            <span
                              key={c.color}
                              className="rounded-md bg-[var(--color-sand-warm)] px-2 py-0.5 text-[13px]"
                            >
                              {c.color} <b className="tnum">{c.qty}</b>
                            </span>
                          ))}
                        </div>
                      </Td>
                      <Td align="right">
                        <b>{g.total}</b>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          ))}
        </div>
      )}

      {/* ---------- 2. Нужно заказать ---------- */}
      <h2 className="mt-8 mb-3 flex flex-wrap items-center gap-2 border-b-2 border-[var(--color-gold)] pb-2 text-lg">
        2. Нужно заказать
        <StatusPill tone={ov.need.length > 0 ? "critical" : "ok"}>
          {ov.need.length > 0
            ? `${ov.need.length} ${plural(ov.need.length, "позиция", "позиции", "позиций")}`
            : "ничего"}
        </StatusPill>
      </h2>
      <p className="mt-0 mb-3 text-sm text-[var(--color-muted)]">
        Остаток на складе США ниже порога, и позиции нет в активном заказе.
        {main ? "" : " Активных заказов сейчас нет, поэтому в список попадает всё, что ниже порога."}
      </p>
      {ov.need.length === 0 ? (
        <Card>
          <p className="m-0 text-sm">Всё, что ниже порога, уже закрыто активным заказом.</p>
        </Card>
      ) : (
        <Card padded={false}>
          <RuleRows items={ov.need} withOrdered={false} />
        </Card>
      )}

      {/* ---------- 3. Заканчивается ---------- */}
      <h2 className="mt-8 mb-3 flex flex-wrap items-center gap-2 border-b-2 border-[var(--color-gold)] pb-2 text-lg">
        3. Заканчивается
        <StatusPill tone="ok">
          {ov.covered.length} {plural(ov.covered.length, "позиция", "позиции", "позиций")} · закрыты заказом
        </StatusPill>
      </h2>
      <p className="mt-0 mb-3 text-sm text-[var(--color-muted)]">
        Ниже порога, но уже заказано — повторно заказывать не нужно.
      </p>
      {ov.covered.length === 0 ? (
        <Card>
          <p className="m-0 text-sm">Таких позиций нет.</p>
        </Card>
      ) : (
        <Card padded={false}>
          <RuleRows items={ov.covered} withOrdered />
        </Card>
      )}

      <p className="mt-6 text-xs text-[var(--color-muted)]">
        Остатки США — из Ainur (склад «US Warehouse»), заказы — из раздела «Заказы на пошив».
        Правила пополнения (уровни, пороги, количество) — в файле
        {" "}<code>src/lib/usa-reorder-rules.ts</code>.
      </p>
    </>
  );
}
