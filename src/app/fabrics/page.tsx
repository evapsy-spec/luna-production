import { redirect } from "next/navigation";
import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { canSeeMoney, getCurrentUser } from "@/lib/auth";
import {
  fabricCostPerMeterThb,
  formatMeters,
  getFabricAvailability,
  round2,
} from "@/lib/production";
import {
  Button,
  Card,
  EmptyState,
  Input,
  LinkButton,
  Money,
  PageHeader,
  Stat,
  StatusPill,
  Table,
  Td,
  Th,
  Thumb,
} from "@/components/ui";

export const metadata = { title: "Ткани — Luna Production" };

/** Ниже этого остатка ткань считаем дефицитной */
const LOW_STOCK_M = 10;

export default async function FabricsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const query = (params.q ?? "").trim();

  const rows = await db
    .select({
      id: schema.fabrics.id,
      sku: schema.fabrics.sku,
      name: schema.fabrics.name,
      composition: schema.fabrics.composition,
      color: schema.fabrics.color,
      isDyed: schema.fabrics.isDyed,
      isOnOrder: schema.fabrics.isOnOrder,
      photoUrl: schema.fabrics.photoUrl,
      purchasePrice: schema.fabrics.purchasePrice,
      purchaseCurrency: schema.fabrics.purchaseCurrency,
      fxRateToThb: schema.fabrics.fxRateToThb,
      supplierName: schema.suppliers.name,
    })
    .from(schema.fabrics)
    .leftJoin(schema.suppliers, eq(schema.fabrics.supplierId, schema.suppliers.id))
    .where(eq(schema.fabrics.isArchived, false))
    .orderBy(asc(schema.fabrics.name));

  /**
   * Поиск фильтруем в JS, а не через LIKE: в SQLite без ICU функция lower()
   * не знает кириллицу, и «Шёлк» не нашёлся бы по запросу «шёлк».
   */
  const needle = query.toLowerCase();
  const fabrics = needle
    ? rows.filter(
        (f) =>
          f.name.toLowerCase().includes(needle) ||
          f.sku.toLowerCase().includes(needle) ||
          (f.color ?? "").toLowerCase().includes(needle) ||
          (f.composition ?? "").toLowerCase().includes(needle),
      )
    : rows;

  const availability = await getFabricAvailability(fabrics.map((f) => f.id));

  const list = fabrics.map((f) => {
    const a = availability.get(f.id) ?? { onHand: 0, reserved: 0 };
    const available = round2(a.onHand - a.reserved);
    return {
      ...f,
      onHand: round2(a.onHand),
      reserved: round2(a.reserved),
      available,
      costPerMeter: fabricCostPerMeterThb(f),
    };
  });

  const lowCount = list.filter((f) => f.available < LOW_STOCK_M).length;
  const stockValueThb = list.reduce(
    (sum, f) => sum + Math.max(0, f.onHand) * f.costPerMeter,
    0,
  );

  return (
    <>
      <PageHeader
        title="Ткани"
        subtitle="Остатки по складам тканей, резервы под заказы и цена метра"
        action={
          <div className="flex flex-wrap gap-2">
            {/* в меню раздела поставщиков нет — вход к нему отсюда */}
            <LinkButton href="/suppliers">Поставщики</LinkButton>
            <LinkButton href="/purchases">Заявки на ткань</LinkButton>
            <LinkButton href="/fabrics/new" variant="primary">
              + Добавить ткань
            </LinkButton>
          </div>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Stat label="Тканей в работе" value={list.length} />
        <Stat
          label="Мало на складе"
          value={lowCount}
          sub={`меньше ${LOW_STOCK_M} м доступно`}
        />
        <Stat
          label="Запас в деньгах"
          value={<Money value={stockValueThb} hidden={!canSeeMoney(user)} />}
          sub="по цене закупки, все склады тканей"
        />
      </div>

      <Card className="mb-5">
        <form action="/fabrics" className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <Input
              name="q"
              defaultValue={query}
              placeholder="Поиск по названию, SKU, цвету"
              aria-label="Поиск ткани"
            />
          </div>
          <Button type="submit" variant="secondary">
            Найти
          </Button>
          {query ? (
            <LinkButton href="/fabrics" variant="ghost">
              Сбросить
            </LinkButton>
          ) : null}
        </form>
      </Card>

      {list.length === 0 ? (
        <EmptyState
          title={query ? "Ничего не нашлось" : "Тканей пока нет"}
          hint={
            query
              ? "Попробуйте другой запрос — поиск идёт по названию, SKU, цвету и составу."
              : "Добавьте первую ткань: название, SKU, цену за метр и остатки по складам."
          }
          action={
            <LinkButton href="/fabrics/new" variant="primary">
              + Добавить ткань
            </LinkButton>
          }
        />
      ) : (
        <Card padded={false} className="overflow-hidden">
          <Table>
            <thead>
              <tr>
                <Th>Ткань</Th>
                <Th>Состав и цвет</Th>
                <Th align="right">На складах</Th>
                <Th align="right">В резерве</Th>
                <Th align="right">Доступно</Th>
                <Th align="right">Цена / м</Th>
                <Th>Статус</Th>
              </tr>
            </thead>
            <tbody>
              {list.map((f) => (
                <tr key={f.id}>
                  <Td>
                    <div className="flex items-center gap-3">
                      <Thumb src={f.photoUrl} alt={f.name} size={44} />
                      <div>
                        <Link
                          href={`/fabrics/${f.id}`}
                          className="font-medium text-[var(--color-ocean)]"
                        >
                          {f.name}
                        </Link>
                        <div className="text-xs text-[var(--color-muted)]">
                          {f.sku}
                          {f.supplierName ? ` · ${f.supplierName}` : ""}
                        </div>
                      </div>
                    </div>
                  </Td>
                  <Td>
                    <div className="text-sm">{f.composition ?? "—"}</div>
                    <div className="text-xs text-[var(--color-muted)]">
                      {f.color ?? "цвет не указан"} ·{" "}
                      {f.isDyed ? "красим сами" : "не красим"}
                    </div>
                  </Td>
                  <Td align="right">{formatMeters(f.onHand)}</Td>
                  <Td align="right">
                    {f.reserved > 0 ? formatMeters(f.reserved) : "—"}
                  </Td>
                  <Td align="right" className="font-medium">
                    {formatMeters(f.available)}
                  </Td>
                  <Td align="right">
                    <Money
                      value={f.costPerMeter}
                      hidden={!canSeeMoney(user)}
                    />
                    {canSeeMoney(user) && f.purchaseCurrency !== "THB" ? (
                      <div className="text-xs text-[var(--color-muted)]">
                        {f.purchasePrice} {f.purchaseCurrency} × {f.fxRateToThb}
                      </div>
                    ) : null}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1.5">
                      {f.available < 0 ? (
                        <StatusPill tone="critical">Перерезервировано</StatusPill>
                      ) : f.available < LOW_STOCK_M ? (
                        <StatusPill tone="critical">Мало</StatusPill>
                      ) : null}
                      {f.isOnOrder ? (
                        <StatusPill tone="warn">Заказано, ожидаем</StatusPill>
                      ) : null}
                      {f.available >= LOW_STOCK_M && !f.isOnOrder ? (
                        <StatusPill tone="ok">Хватает</StatusPill>
                      ) : null}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
