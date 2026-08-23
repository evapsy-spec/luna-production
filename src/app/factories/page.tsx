import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { canSeeMoney, getCurrentUser } from "@/lib/auth";
import { getFactoryScorecards, formatThb } from "@/lib/production";
import {
  Card,
  EmptyState,
  LinkButton,
  MapsLink,
  Money,
  PageHeader,
  StatusPill,
  WhatsappLink,
} from "@/components/ui";
import {
  CapacityBar,
  LoadPill,
  defectTone,
  formatPct,
  onTimeTone,
} from "./_parts";

export const metadata = { title: "Фабрики — Luna Production" };

export default async function FactoriesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const showMoney = canSeeMoney(user);

  const factories = await db
    .select()
    .from(schema.factories)
    .where(eq(schema.factories.isArchived, false))
    .orderBy(asc(schema.factories.name));

  const links = await db
    .select({
      factoryId: schema.factoryCollections.factoryId,
      collectionId: schema.factoryCollections.collectionId,
      collectionName: schema.collections.name,
    })
    .from(schema.factoryCollections)
    .innerJoin(
      schema.collections,
      eq(schema.factoryCollections.collectionId, schema.collections.id),
    )
    .orderBy(asc(schema.collections.name));

  const scorecards = await getFactoryScorecards();
  const cardById = new Map(scorecards.map((s) => [s.factoryId, s]));

  return (
    <>
      <PageHeader
        title="Фабрики"
        subtitle="Кто что шьёт, насколько загружен и как держит сроки"
        action={
          <div className="flex flex-wrap gap-2">
            <LinkButton href="/factories/compare">Сравнить</LinkButton>
            <LinkButton href="/factories/new" variant="primary">
              Добавить фабрику
            </LinkButton>
          </div>
        }
      />

      {factories.length === 0 ? (
        <EmptyState
          title="Фабрик пока нет"
          hint="Добавьте первую фабрику — после этого можно будет назначать ей коллекции, цены пошива и заказы."
          action={
            <LinkButton href="/factories/new" variant="primary">
              Добавить фабрику
            </LinkButton>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {factories.map((factory) => {
            const card = cardById.get(factory.id);
            const collectionNames = links
              .filter((l) => l.factoryId === factory.id)
              .map((l) => l.collectionName);
            const pct = card?.capacityUsedPct ?? null;

            return (
              <Card key={factory.id}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <a
                      href={`/factories/${factory.id}`}
                      className="text-lg font-semibold text-[var(--color-ocean)] no-underline"
                    >
                      {factory.name}
                    </a>
                    <div className="mt-0.5 text-sm text-[var(--color-muted)]">
                      {[factory.specialization, factory.country]
                        .filter(Boolean)
                        .join(" · ") || "специализация не указана"}
                    </div>
                  </div>
                  <LoadPill pct={pct} />
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
                  <WhatsappLink phone={factory.whatsapp} />
                  <MapsLink
                    lat={factory.mapsLat}
                    lng={factory.mapsLng}
                    address={factory.address}
                    url={factory.mapsUrl}
                  />
                </div>

                {collectionNames.length ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {collectionNames.map((name) => (
                      <span
                        key={name}
                        className="rounded-full bg-[var(--color-sand-warm)] px-2.5 py-1 text-xs text-[var(--color-ocean)]"
                      >
                        {name}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 text-xs text-[var(--color-faint)]">
                    Коллекции не назначены
                  </div>
                )}

                <div className="mt-4">
                  <CapacityBar
                    unitsInProgress={card?.unitsInProgress ?? 0}
                    capacityUnits={factory.monthlyCapacityUnits}
                    pct={pct}
                  />
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 border-t border-[var(--color-line)] pt-3 text-sm">
                  <div>
                    <div className="text-xs text-[var(--color-muted)]">
                      Сдано вовремя
                    </div>
                    <div className="mt-1">
                      <StatusPill tone={onTimeTone(card?.onTimePct ?? null)}>
                        {formatPct(card?.onTimePct ?? null)}
                      </StatusPill>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-[var(--color-muted)]">Брак</div>
                    <div className="mt-1">
                      <StatusPill tone={defectTone(card?.defectPct ?? null)}>
                        {formatPct(card?.defectPct ?? null)}
                      </StatusPill>
                    </div>
                  </div>
                  <div className="col-span-2">
                    <div className="text-xs text-[var(--color-muted)]">
                      Заказано на сумму · заказов {card?.ordersTotal ?? 0}
                    </div>
                    <div className="mt-0.5">
                      <Money
                        value={card?.totalOrderedThb ?? 0}
                        hidden={!showMoney}
                      />
                    </div>
                  </div>
                </div>

                {card && card.openDefectCreditThb > 0 ? (
                  <div className="mt-3">
                    <StatusPill tone="serious">
                      {showMoney
                        ? `Незачтённый кредит за брак ${formatThb(card.openDefectCreditThb)}`
                        : "Есть незачтённый кредит за брак"}
                    </StatusPill>
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
