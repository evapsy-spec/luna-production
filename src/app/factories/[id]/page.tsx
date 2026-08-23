import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import {
  canSeeMoney,
  getCurrentUser,
  requireUser,
  writeAudit,
} from "@/lib/auth";
import { getFactoryScorecards, formatThb } from "@/lib/production";
import {
  Button,
  Callout,
  Card,
  Checkbox,
  Input,
  LinkButton,
  MapsLink,
  Money,
  OrderStatusPill,
  PageHeader,
  SectionTitle,
  StatusPill,
  Table,
  Td,
  Th,
  WhatsappLink,
  formatDate,
} from "@/components/ui";
import {
  CapacityBar,
  LoadPill,
  defectTone,
  formatPct,
  formNum,
  onTimeTone,
} from "../_parts";

/** Сохранение списка коллекций фабрики (many-to-many) */
async function saveCollections(formData: FormData) {
  "use server";
  const user = await requireUser();
  const factoryId = String(formData.get("factoryId") ?? "");
  if (!factoryId) return;

  const allIds = String(formData.get("allCollectionIds") ?? "")
    .split(",")
    .filter(Boolean);
  // компонент Checkbox не умеет value — поэтому имя чекбокса содержит id
  const selected = allIds.filter((id) => formData.get(`collection_${id}`));

  const factory = (
    await db
      .select()
      .from(schema.factories)
      .where(eq(schema.factories.id, factoryId))
      .limit(1)
  )[0];
  if (!factory) return;

  const collections = await db
    .select({ id: schema.collections.id, name: schema.collections.name })
    .from(schema.collections);
  const nameById = new Map(collections.map((c) => [c.id, c.name]));

  const before = await db
    .select({ collectionId: schema.factoryCollections.collectionId })
    .from(schema.factoryCollections)
    .where(eq(schema.factoryCollections.factoryId, factoryId));
  const beforeIds = before.map((b) => b.collectionId);

  await db
    .delete(schema.factoryCollections)
    .where(eq(schema.factoryCollections.factoryId, factoryId));

  if (selected.length) {
    await db.insert(schema.factoryCollections).values(
      selected.map((collectionId) => ({
        id: crypto.randomUUID(),
        factoryId,
        collectionId,
      })),
    );
  }

  const label = (ids: string[]) =>
    ids.map((i) => nameById.get(i) ?? i).join(", ") || "не назначены";

  if (
    beforeIds.length !== selected.length ||
    beforeIds.some((id) => !selected.includes(id))
  ) {
    await writeAudit(user, {
      action: "UPDATE",
      entityType: "Factory",
      entityId: factoryId,
      entityName: factory.name,
      changes: { collections: { from: label(beforeIds), to: label(selected) } },
    });
  }

  revalidatePath(`/factories/${factoryId}`);
}

/**
 * Новая цена пошива. Старая запись не удаляется: ей ставим isCurrent=false,
 * чтобы история цен осталась целой.
 */
async function savePrice(formData: FormData) {
  "use server";
  const user = await requireUser();
  const factoryId = String(formData.get("factoryId") ?? "");
  const productId = String(formData.get("productId") ?? "");
  const price = formNum(formData.get("price"));
  if (!factoryId || !productId || price === null || price < 0) return;

  const factory = (
    await db
      .select()
      .from(schema.factories)
      .where(eq(schema.factories.id, factoryId))
      .limit(1)
  )[0];
  const product = (
    await db
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, productId))
      .limit(1)
  )[0];
  if (!factory || !product) return;

  const current = (
    await db
      .select()
      .from(schema.factoryPrices)
      .where(
        and(
          eq(schema.factoryPrices.factoryId, factoryId),
          eq(schema.factoryPrices.productId, productId),
          eq(schema.factoryPrices.isCurrent, true),
        ),
      )
  )[0];

  if (current && current.pricePerUnit === price) return;

  if (current) {
    await db
      .update(schema.factoryPrices)
      .set({ isCurrent: false })
      .where(eq(schema.factoryPrices.id, current.id));
  }

  await db.insert(schema.factoryPrices).values({
    id: crypto.randomUUID(),
    factoryId,
    productId,
    pricePerUnit: price,
    validFrom: new Date().toISOString(),
    isCurrent: true,
  });

  await writeAudit(user, {
    action: current ? "UPDATE" : "CREATE",
    entityType: "FactoryPrice",
    entityId: productId,
    entityName: `${factory.name} · ${product.name}`,
    changes: {
      pricePerUnit: { from: current?.pricePerUnit ?? null, to: price },
    },
  });

  revalidatePath(`/factories/${factoryId}`);
}

export default async function FactoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const showMoney = canSeeMoney(user);
  const { id } = await params;

  const factory = (
    await db.select().from(schema.factories).where(eq(schema.factories.id, id)).limit(1)
  )[0];

  if (!factory) {
    return (
      <>
        <PageHeader title="Фабрика не найдена" />
        <Callout tone="warn" title="Такой фабрики нет">
          Возможно, её удалили. Вернитесь к списку и выберите другую.
        </Callout>
        <LinkButton href="/factories">Все фабрики</LinkButton>
      </>
    );
  }

  const scorecards = await getFactoryScorecards();
  const card = scorecards.find((s) => s.factoryId === id) ?? null;

  const allCollections = await db
    .select({ id: schema.collections.id, name: schema.collections.name })
    .from(schema.collections)
    .where(eq(schema.collections.isArchived, false))
    .orderBy(asc(schema.collections.name));

  const assigned = await db
    .select({ collectionId: schema.factoryCollections.collectionId })
    .from(schema.factoryCollections)
    .where(eq(schema.factoryCollections.factoryId, id));
  const assignedIds = new Set(assigned.map((a) => a.collectionId));

  // вся история цен этой фабрики — из неё берём и текущие цены, и историю
  const priceRows = await db
    .select()
    .from(schema.factoryPrices)
    .where(eq(schema.factoryPrices.factoryId, id))
    .orderBy(desc(schema.factoryPrices.validFrom));

  const pricedProductIds = [...new Set(priceRows.map((p) => p.productId))];
  const assignedCollectionIds = [...assignedIds];

  const productsFromCollections = assignedCollectionIds.length
    ? await db
        .select({
          id: schema.products.id,
          name: schema.products.name,
          defaultSewingCost: schema.products.defaultSewingCost,
          collectionName: schema.collections.name,
        })
        .from(schema.products)
        .innerJoin(
          schema.collections,
          eq(schema.products.collectionId, schema.collections.id),
        )
        .where(
          and(
            inArray(schema.products.collectionId, assignedCollectionIds),
            eq(schema.products.isArchived, false),
          ),
        )
    : [];

  const productsWithPrice = pricedProductIds.length
    ? await db
        .select({
          id: schema.products.id,
          name: schema.products.name,
          defaultSewingCost: schema.products.defaultSewingCost,
          collectionName: schema.collections.name,
        })
        .from(schema.products)
        .innerJoin(
          schema.collections,
          eq(schema.products.collectionId, schema.collections.id),
        )
        .where(inArray(schema.products.id, pricedProductIds))
    : [];

  const productMap = new Map<
    string,
    { id: string; name: string; defaultSewingCost: number | null; collectionName: string }
  >();
  for (const p of [...productsFromCollections, ...productsWithPrice]) {
    productMap.set(p.id, p);
  }
  const products = [...productMap.values()].sort(
    (a, b) =>
      a.collectionName.localeCompare(b.collectionName, "ru") ||
      a.name.localeCompare(b.name, "ru"),
  );

  const orders = await db
    .select()
    .from(schema.productionOrders)
    .where(eq(schema.productionOrders.factoryId, id))
    .orderBy(desc(schema.productionOrders.createdAt));

  const openCredits = await db
    .select({
      id: schema.defectCredits.id,
      quantity: schema.defectCredits.quantity,
      amount: schema.defectCredits.amount,
      reason: schema.defectCredits.reason,
      createdAt: schema.defectCredits.createdAt,
      orderNumber: schema.productionOrders.number,
    })
    .from(schema.defectCredits)
    .innerJoin(
      schema.productionOrders,
      eq(schema.defectCredits.orderId, schema.productionOrders.id),
    )
    .where(
      and(
        eq(schema.defectCredits.factoryId, id),
        isNull(schema.defectCredits.appliedToOrderId),
      ),
    )
    .orderBy(desc(schema.defectCredits.createdAt));

  const pct = card?.capacityUsedPct ?? null;

  return (
    <>
      <PageHeader
        title={factory.name}
        subtitle={
          [factory.specialization, factory.country].filter(Boolean).join(" · ") ||
          undefined
        }
        action={
          <div className="flex flex-wrap gap-2">
            <LinkButton href="/factories">Все фабрики</LinkButton>
            <LinkButton href={`/factories/${id}/edit`} variant="primary">
              Редактировать
            </LinkButton>
          </div>
        }
      />

      {/* Шапка: контакты и адрес */}
      <Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
              Контакты
            </div>
            <div className="mt-1.5 text-sm">
              {factory.contact ?? "контактное лицо не указано"}
            </div>
            {factory.phone ? (
              <div className="mt-1 text-sm">
                <a href={`tel:${factory.phone}`} className="text-[var(--color-ocean)]">
                  {factory.phone}
                </a>
              </div>
            ) : null}
            {factory.email ? (
              <div className="mt-1 text-sm">
                <a
                  href={`mailto:${factory.email}`}
                  className="text-[var(--color-ocean)]"
                >
                  {factory.email}
                </a>
              </div>
            ) : null}
            <div className="mt-2">
              <WhatsappLink phone={factory.whatsapp} />
            </div>
          </div>

          <div>
            <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
              Адрес
            </div>
            <div className="mt-1.5 text-sm whitespace-pre-line">
              {factory.address ?? "адрес не указан"}
            </div>
            <div className="mt-2">
              <MapsLink
                lat={factory.mapsLat}
                lng={factory.mapsLng}
                address={factory.address}
                url={factory.mapsUrl}
              />
            </div>
            <div className="mt-3 text-xs text-[var(--color-muted)]">
              Мощность:{" "}
              {factory.monthlyCapacityUnits
                ? `${factory.monthlyCapacityUnits} шт/мес`
                : "не указана"}
            </div>
          </div>
        </div>

        {factory.note ? (
          <div className="mt-4 border-t border-[var(--color-line)] pt-3 text-sm text-[var(--color-muted)] whitespace-pre-line">
            {factory.note}
          </div>
        ) : null}
      </Card>

      {/* Скоркард */}
      <SectionTitle>Скоркард</SectionTitle>
      <Card>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div>
            <div className="text-xs text-[var(--color-muted)]">Заказов всего</div>
            <div className="figure mt-1 text-2xl text-[var(--color-ocean)]">
              {card?.ordersTotal ?? 0}
            </div>
            <div className="mt-0.5 text-xs text-[var(--color-muted)]">
              завершено {card?.ordersCompleted ?? 0}
            </div>
          </div>
          <div>
            <div className="text-xs text-[var(--color-muted)]">Сдано вовремя</div>
            <div className="mt-1.5">
              <StatusPill tone={onTimeTone(card?.onTimePct ?? null)}>
                {formatPct(card?.onTimePct ?? null)}
              </StatusPill>
            </div>
          </div>
          <div>
            <div className="text-xs text-[var(--color-muted)]">Брак</div>
            <div className="mt-1.5">
              <StatusPill tone={defectTone(card?.defectPct ?? null)}>
                {formatPct(card?.defectPct ?? null)}
              </StatusPill>
            </div>
          </div>
          <div>
            <div className="text-xs text-[var(--color-muted)]">Произведено</div>
            <div className="figure mt-1 text-2xl text-[var(--color-ocean)]">
              {card?.unitsProduced ?? 0}
            </div>
            <div className="mt-0.5 text-xs text-[var(--color-muted)]">штук</div>
          </div>
          <div>
            <div className="text-xs text-[var(--color-muted)]">Брака</div>
            <div className="figure mt-1 text-2xl text-[var(--color-ocean)]">
              {card?.unitsDefect ?? 0}
            </div>
            <div className="mt-0.5 text-xs text-[var(--color-muted)]">штук</div>
          </div>
          <div>
            <div className="text-xs text-[var(--color-muted)]">
              Незачтённый кредит за брак
            </div>
            <div className="mt-1.5">
              <Money value={card?.openDefectCreditThb ?? 0} hidden={!showMoney} />
            </div>
          </div>
          <div>
            <div className="text-xs text-[var(--color-muted)]">Заказано на сумму</div>
            <div className="mt-1.5">
              <Money value={card?.totalOrderedThb ?? 0} hidden={!showMoney} />
            </div>
          </div>
          <div>
            <div className="text-xs text-[var(--color-muted)]">Оплачено</div>
            <div className="mt-1.5">
              <Money value={card?.totalPaidThb ?? 0} hidden={!showMoney} />
            </div>
          </div>
        </div>

        <div className="mt-5 border-t border-[var(--color-line)] pt-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-sm font-medium">Текущая загрузка</span>
            <LoadPill pct={pct} />
          </div>
          <CapacityBar
            unitsInProgress={card?.unitsInProgress ?? 0}
            capacityUnits={factory.monthlyCapacityUnits}
            pct={pct}
          />
        </div>

        <p className="mt-4 mb-0 text-xs text-[var(--color-muted)]">
          «Сдано вовремя» считается только по тем заказам, где заполнены и
          плановая, и фактическая дата готовности — иначе процент врёт. Брак —
          доля забракованных единиц от всего выпуска на этой фабрике.
        </p>
      </Card>

      {/* Коллекции */}
      <SectionTitle>Какие коллекции шьёт</SectionTitle>
      <Card>
        {allCollections.length === 0 ? (
          <p className="m-0 text-sm text-[var(--color-muted)]">
            Коллекций в системе пока нет — сначала добавьте их в разделе
            «Коллекции».
          </p>
        ) : (
          <form action={saveCollections}>
            <input type="hidden" name="factoryId" value={id} />
            <input
              type="hidden"
              name="allCollectionIds"
              value={allCollections.map((c) => c.id).join(",")}
            />
            <div className="grid gap-2 sm:grid-cols-2">
              {allCollections.map((c) => (
                <Checkbox
                  key={c.id}
                  name={`collection_${c.id}`}
                  label={c.name}
                  defaultChecked={assignedIds.has(c.id)}
                />
              ))}
            </div>
            <p className="mt-3 mb-0 text-xs text-[var(--color-muted)]">
              Одна коллекция может шиться на нескольких фабриках — отмечайте
              все, кто реально её берёт.
            </p>
            <div className="mt-4">
              <Button type="submit">Сохранить коллекции</Button>
            </div>
          </form>
        )}
      </Card>

      {/* Цены пошива */}
      <SectionTitle>Цены пошива</SectionTitle>
      {!showMoney ? (
        <Callout tone="neutral" title="Цены скрыты">
          Стоимость пошива видят только владельцы. Список изделий ниже доступен,
          цены — нет.
        </Callout>
      ) : null}
      <Card padded={false}>
        {products.length === 0 ? (
          <div className="p-4 text-sm text-[var(--color-muted)]">
            Пока нечего оценивать: назначьте фабрике коллекции выше — и здесь
            появятся её изделия.
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Изделие</Th>
                <Th align="right">Текущая цена</Th>
                <Th>Действует с</Th>
                <Th>{showMoney ? "Новая цена" : "История"}</Th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => {
                const history = priceRows.filter(
                  (p) => p.productId === product.id,
                );
                const current = history.find((p) => p.isCurrent);
                const past = history.filter((p) => !p.isCurrent);

                return (
                  <tr key={product.id}>
                    <Td>
                      <div className="font-medium">{product.name}</div>
                      <div className="text-xs text-[var(--color-muted)]">
                        {product.collectionName}
                      </div>
                      {past.length ? (
                        <details className="mt-1">
                          <summary className="touch cursor-pointer text-xs text-[var(--color-ocean)]">
                            История цен ({past.length})
                          </summary>
                          <ul className="mt-1 mb-0 list-none pl-0 text-xs text-[var(--color-muted)]">
                            {past.map((p) => (
                              <li key={p.id} className="tnum py-0.5">
                                {formatDate(p.validFrom)} —{" "}
                                {showMoney ? formatThb(p.pricePerUnit) : "—"}
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                    </Td>
                    <Td align="right">
                      {current ? (
                        <Money value={current.pricePerUnit} hidden={!showMoney} />
                      ) : product.defaultSewingCost != null ? (
                        <span className="text-xs text-[var(--color-muted)]">
                          по умолчанию{" "}
                          <Money
                            value={product.defaultSewingCost}
                            hidden={!showMoney}
                          />
                        </span>
                      ) : (
                        <span className="text-[var(--color-faint)]">не задана</span>
                      )}
                    </Td>
                    <Td>
                      {current ? (
                        formatDate(current.validFrom)
                      ) : (
                        <span className="text-[var(--color-faint)]">—</span>
                      )}
                    </Td>
                    <Td>
                      {showMoney ? (
                        <form action={savePrice} className="flex items-center gap-2">
                          <input type="hidden" name="factoryId" value={id} />
                          <input type="hidden" name="productId" value={product.id} />
                          <Input
                            name="price"
                            inputMode="decimal"
                            className="w-24"
                            placeholder="THB"
                            aria-label={`Новая цена пошива: ${product.name}`}
                          />
                          <Button type="submit" variant="secondary">
                            Сохранить
                          </Button>
                        </form>
                      ) : (
                        <span className="text-xs text-[var(--color-faint)]">
                          {past.length ? `${past.length} изменений` : "—"}
                        </span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      <p className="mt-2 text-xs text-[var(--color-muted)]">
        Старая цена не стирается: при сохранении новой она уходит в историю с
        датой, поэтому себестоимость прошлых заказов остаётся верной.
      </p>

      {/* Заказы */}
      <SectionTitle>Заказы на этой фабрике</SectionTitle>
      <Card padded={false}>
        {orders.length === 0 ? (
          <div className="p-4 text-sm text-[var(--color-muted)]">
            Заказов на эту фабрику ещё не было.
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Номер</Th>
                <Th>Статус</Th>
                <Th>План</Th>
                <Th>Факт</Th>
                <Th align="right">Сумма</Th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <Td>
                    <a
                      href={`/orders/${order.id}`}
                      className="font-medium text-[var(--color-ocean)]"
                    >
                      {order.number}
                    </a>
                  </Td>
                  <Td>
                    <OrderStatusPill status={order.status} />
                  </Td>
                  <Td>{formatDate(order.plannedReadyAt)}</Td>
                  <Td>{formatDate(order.actualReadyAt)}</Td>
                  <Td align="right">
                    <Money value={order.snapshotTotalCost} hidden={!showMoney} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {/* Кредиты за брак */}
      <SectionTitle>Незачтённые кредиты за брак</SectionTitle>
      <Card padded={false}>
        {openCredits.length === 0 ? (
          <div className="p-4 text-sm text-[var(--color-muted)]">
            Незачтённого брака нет.
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Заказ</Th>
                <Th align="right">Штук</Th>
                <Th align="right">Сумма</Th>
                <Th>Причина</Th>
                <Th>Когда</Th>
              </tr>
            </thead>
            <tbody>
              {openCredits.map((credit) => (
                <tr key={credit.id}>
                  <Td>
                    <span className="font-medium">{credit.orderNumber}</span>
                  </Td>
                  <Td align="right">{credit.quantity}</Td>
                  <Td align="right">
                    <Money value={credit.amount} hidden={!showMoney} />
                  </Td>
                  <Td>{credit.reason ?? "—"}</Td>
                  <Td>{formatDate(credit.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <p className="mt-2 text-xs text-[var(--color-muted)]">
        Эта сумма вычтется из следующего заказа на этой фабрике — отдельно
        возвращать деньги не нужно.
      </p>
    </>
  );
}
