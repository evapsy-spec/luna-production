import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { canSeeMoney, getCurrentUser } from "@/lib/auth";
import {
  getFactoryScorecards,
  formatThb,
  round1,
} from "@/lib/production";
import { RankBars } from "@/components/charts";
import {
  Callout,
  Card,
  EmptyState,
  LinkButton,
  Money,
  PageHeader,
  SectionTitle,
  StatusPill,
  Table,
  Td,
  Th,
} from "@/components/ui";
import { defectTone, formatPct, onTimeTone } from "../_parts";

export const metadata = { title: "Сравнение фабрик — Luna Production" };

export default async function CompareFactoriesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const showMoney = canSeeMoney(user);

  const factories = await db
    .select()
    .from(schema.factories)
    .where(eq(schema.factories.isArchived, false))
    .orderBy(asc(schema.factories.name));

  const scorecards = await getFactoryScorecards();
  const cardById = new Map(scorecards.map((s) => [s.factoryId, s]));

  // текущие цены пошива — для сравнения «кто дешевле»
  const priceRows = await db
    .select({
      factoryId: schema.factoryPrices.factoryId,
      productId: schema.factoryPrices.productId,
      pricePerUnit: schema.factoryPrices.pricePerUnit,
      productName: schema.products.name,
    })
    .from(schema.factoryPrices)
    .innerJoin(
      schema.products,
      eq(schema.factoryPrices.productId, schema.products.id),
    )
    .where(eq(schema.factoryPrices.isCurrent, true));

  const priceByFactory = new Map<string, Map<string, number>>();
  for (const row of priceRows) {
    const map = priceByFactory.get(row.factoryId) ?? new Map<string, number>();
    map.set(row.productId, row.pricePerUnit);
    priceByFactory.set(row.factoryId, map);
  }

  const factoriesWithPrices = factories.filter(
    (f) => (priceByFactory.get(f.id)?.size ?? 0) > 0,
  );

  // общие изделия — те, у которых цена есть на каждой фабрике с ценами
  const commonProductIds =
    factoriesWithPrices.length >= 2
      ? [
          ...(
            priceByFactory.get(factoriesWithPrices[0].id) ??
            new Map<string, number>()
          ).keys(),
        ].filter(
          (productId) =>
            factoriesWithPrices.every((f) =>
              priceByFactory.get(f.id)?.has(productId),
            ),
        )
      : [];

  const avgPrices = commonProductIds.length
    ? factoriesWithPrices
        .map((f) => {
          const map = priceByFactory.get(f.id)!;
          const sum = commonProductIds.reduce(
            (s, productId) => s + (map.get(productId) ?? 0),
            0,
          );
          return {
            factoryId: f.id,
            name: f.name,
            avg: round1(sum / commonProductIds.length),
          };
        })
        .sort((a, b) => a.avg - b.avg)
    : [];

  const measurable = scorecards.filter((s) => s.onTimePct !== null);
  const mostReliable = [...measurable].sort(
    (a, b) => (b.onTimePct ?? 0) - (a.onTimePct ?? 0),
  )[0];
  const withDefect = scorecards.filter((s) => s.defectPct !== null);
  const cleanest = [...withDefect].sort(
    (a, b) => (a.defectPct ?? 0) - (b.defectPct ?? 0),
  )[0];
  const cheapest = avgPrices[0];

  if (factories.length === 0) {
    return (
      <>
        <PageHeader title="Сравнение фабрик" />
        <EmptyState
          title="Сравнивать пока нечего"
          hint="Добавьте хотя бы две фабрики — и здесь появится сравнение по срокам, браку и ценам."
          action={
            <LinkButton href="/factories/new" variant="primary">
              Добавить фабрику
            </LinkButton>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Сравнение фабрик"
        subtitle="Куда отдать новый заказ: сроки, брак, загрузка и цены"
        action={<LinkButton href="/factories">Все фабрики</LinkButton>}
      />

      <Card padded={false}>
        <Table>
          <thead>
            <tr>
              <Th>Фабрика</Th>
              <Th align="right">Заказов</Th>
              <Th align="center">Вовремя</Th>
              <Th align="center">Брак</Th>
              <Th align="right">Загрузка</Th>
              <Th align="right">Заказано</Th>
              <Th align="right">Оплачено</Th>
            </tr>
          </thead>
          <tbody>
            {factories.map((factory) => {
              const card = cardById.get(factory.id);
              return (
                <tr key={factory.id}>
                  <Td>
                    <a
                      href={`/factories/${factory.id}`}
                      className="font-medium text-[var(--color-ocean)]"
                    >
                      {factory.name}
                    </a>
                    <div className="text-xs text-[var(--color-muted)]">
                      {factory.specialization ?? "специализация не указана"}
                    </div>
                  </Td>
                  <Td align="right">
                    {card?.ordersTotal ?? 0}
                    <div className="text-xs text-[var(--color-muted)]">
                      завершено {card?.ordersCompleted ?? 0}
                    </div>
                  </Td>
                  <Td align="center">
                    <StatusPill tone={onTimeTone(card?.onTimePct ?? null)}>
                      {formatPct(card?.onTimePct ?? null)}
                    </StatusPill>
                  </Td>
                  <Td align="center">
                    <StatusPill tone={defectTone(card?.defectPct ?? null)}>
                      {formatPct(card?.defectPct ?? null)}
                    </StatusPill>
                  </Td>
                  <Td align="right">
                    {card?.capacityUsedPct !== null &&
                    card?.capacityUsedPct !== undefined ? (
                      <>
                        {card.capacityUsedPct}%
                        <div className="text-xs text-[var(--color-muted)]">
                          {card.unitsInProgress} из{" "}
                          {factory.monthlyCapacityUnits} шт
                        </div>
                      </>
                    ) : (
                      <span className="text-xs text-[var(--color-faint)]">
                        {card?.unitsInProgress ?? 0} шт · мощность не указана
                      </span>
                    )}
                  </Td>
                  <Td align="right">
                    <Money value={card?.totalOrderedThb ?? 0} hidden={!showMoney} />
                  </Td>
                  <Td align="right">
                    <Money value={card?.totalPaidThb ?? 0} hidden={!showMoney} />
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      <SectionTitle>Сумма заказов по фабрикам</SectionTitle>
      <Card>
        {showMoney ? (
          <RankBars
            data={scorecards.map((s) => ({
              label: s.name,
              value: s.totalOrderedThb,
              hint: `заказов ${s.ordersTotal}, произведено ${s.unitsProduced} шт`,
            }))}
            valueFormatter={(n) => formatThb(n)}
          />
        ) : (
          <p className="m-0 text-sm text-[var(--color-muted)]">
            Денежные суммы видят только владельцы.
          </p>
        )}
      </Card>

      <SectionTitle>Брак по фабрикам</SectionTitle>
      <Card>
        {withDefect.length ? (
          <RankBars
            data={withDefect.map((s) => ({
              label: s.name,
              value: s.defectPct ?? 0,
              hint: `${s.unitsDefect} брака из ${s.unitsProduced} шт`,
            }))}
            valueFormatter={(n) => `${round1(n)}%`}
          />
        ) : (
          <p className="m-0 text-sm text-[var(--color-muted)]">
            Выпуска ещё не было — процент брака посчитать не из чего.
          </p>
        )}
      </Card>

      {showMoney && avgPrices.length ? (
        <>
          <SectionTitle>Средняя цена пошива по общим изделиям</SectionTitle>
          <Card>
            <RankBars
              data={avgPrices.map((p) => ({
                label: p.name,
                value: p.avg,
                hint: `по ${commonProductIds.length} изделиям, которые шьются на всех фабриках`,
              }))}
              valueFormatter={(n) => formatThb(n)}
            />
          </Card>
        </>
      ) : null}

      <SectionTitle>Вывод</SectionTitle>
      <Callout tone="neutral" title="Куда отдать новый заказ">
        <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5">
          <li>
            {mostReliable ? (
              <>
                По срокам надёжнее всех <b>{mostReliable.name}</b> —{" "}
                {formatPct(mostReliable.onTimePct)} заказов сданы не позже плана.
              </>
            ) : (
              <>
                По срокам сравнить пока нельзя: ни у одного заказа нет сразу
                плановой и фактической даты готовности.
              </>
            )}
          </li>
          <li>
            {cleanest ? (
              <>
                Меньше всего брака у <b>{cleanest.name}</b> —{" "}
                {formatPct(cleanest.defectPct)} от выпуска.
              </>
            ) : (
              <>Брак сравнить нельзя: выпуска ещё не было.</>
            )}
          </li>
          <li>
            {!showMoney ? (
              <>Сравнение по ценам доступно только владельцам.</>
            ) : cheapest ? (
              <>
                Дешевле шьёт <b>{cheapest.name}</b> — в среднем{" "}
                {formatThb(cheapest.avg)} за изделие по{" "}
                {commonProductIds.length} позициям, которые есть на всех
                фабриках.
              </>
            ) : (
              <>
                По ценам сравнить не с чем: нет изделий, у которых цена задана
                сразу на нескольких фабриках.
              </>
            )}
          </li>
          <li>
            Прежде чем отдавать заказ, посмотрите загрузку: у фабрики выше 85%
            мощности сроки поедут.
          </li>
        </ul>
      </Callout>
    </>
  );
}
