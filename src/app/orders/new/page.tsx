import { eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/lib/db/client";
import { getCurrentUser, canSeeMoney, writeAudit } from "@/lib/auth";
import {
  calculateOrder,
  recommendForHorizon,
  getOpenDefectCredit,
  formatMeters,
  type OrderLineInput,
} from "@/lib/production";
import {
  Card,
  PageHeader,
  SectionTitle,
  Button,
  LinkButton,
  Field,
  Input,
  Select,
  Textarea,
  Money,
  StatusPill,
  Callout,
  Table,
  Th,
  Td,
  EmptyState,
} from "@/components/ui";
import {
  applyDefectCredits,
  nextOrderNumber,
  nextPurchaseNumber,
  parseDate,
  parseInt0,
  parseStr,
} from "../_shared";

export const metadata = { title: "Новый заказ — Luna Production" };

/**
 * Создание заказа на пошив.
 *
 * Шаг 1 — выбор фабрики и горизонта планирования (N месяцев, настраивается
 *          при каждом заказе).
 * Шаг 2 — Luna показывает рекомендацию «что отшить, чтобы хватило на N мес»,
 *          пользователь правит количества, приложение считает расход тканей
 *          и бюджет. При создании метраж резервируется, а при нехватке
 *          автоматически создаётся черновик заявки на дозакупку.
 */
export default async function NewOrderPage({
  searchParams,
}: {
  searchParams: Promise<{
    factory?: string;
    horizon?: string;
    collection?: string;
  }>;
}) {
  const user = await getCurrentUser();
  const showMoney = canSeeMoney(user);
  const params = await searchParams;

  const factories = await db
    .select()
    .from(schema.factories)
    .where(eq(schema.factories.isArchived, false));

  const factoryId = params.factory ?? "";
  const horizonMonths = Math.max(1, Math.min(24, Number(params.horizon) || 3));
  const factory = factories.find((f) => f.id === factoryId);

  // Коллекции, которые эта фабрика действительно шьёт
  const factoryCollections = factoryId
    ? await db
        .select({
          id: schema.collections.id,
          name: schema.collections.name,
        })
        .from(schema.factoryCollections)
        .innerJoin(
          schema.collections,
          eq(schema.factoryCollections.collectionId, schema.collections.id),
        )
        .where(eq(schema.factoryCollections.factoryId, factoryId))
    : [];

  return (
    <>
      <PageHeader
        title="Новый заказ на пошив"
        subtitle="Luna посчитает расход тканей, проверит остатки и соберёт бюджет"
        action={<LinkButton href="/orders">← К заказам</LinkButton>}
      />

      {/* ---------- Шаг 1: фабрика и горизонт ---------- */}
      <Card>
        <form method="get" className="grid gap-4 sm:grid-cols-[1.4fr_1fr_1fr_auto]">
          <Field label="Фабрика" required>
            <Select name="factory" defaultValue={factoryId}>
              <option value="">— выберите фабрику —</option>
              {factories.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                  {f.specialization ? ` — ${f.specialization}` : ""}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Заполнить запас на"
            hint="горизонт планирования — задаётся под каждый заказ"
          >
            <Select name="horizon" defaultValue={String(horizonMonths)}>
              {[1, 2, 3, 4, 6, 9, 12].map((m) => (
                <option key={m} value={m}>
                  {m} мес
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Коллекция" hint="необязательно — можно все">
            <Select name="collection" defaultValue={params.collection ?? ""}>
              <option value="">все коллекции фабрики</option>
              {factoryCollections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>

          <div className="flex items-end">
            <Button type="submit" variant="secondary" className="w-full">
              Показать
            </Button>
          </div>
        </form>
      </Card>

      {!factory ? (
        <div className="mt-5">
          <EmptyState
            title="Выберите фабрику, чтобы продолжить"
            hint="Luna покажет, какие изделия этой фабрики стоит отшить: возьмёт скорость продаж за последние 90 дней, вычтет текущий остаток на складах и то, что уже в пошиве."
          />
        </div>
      ) : (
        <OrderBuilder
          factoryId={factory.id}
          factoryName={factory.name}
          horizonMonths={horizonMonths}
          collectionId={params.collection}
          showMoney={showMoney}
        />
      )}
    </>
  );
}

async function OrderBuilder({
  factoryId,
  factoryName,
  horizonMonths,
  collectionId,
  showMoney,
}: {
  factoryId: string;
  factoryName: string;
  horizonMonths: number;
  collectionId?: string;
  showMoney: boolean;
}) {
  const recommendations = await recommendForHorizon(horizonMonths, {
    factoryId,
    collectionId: collectionId || undefined,
  });
  const openCredit = await getOpenDefectCredit(factoryId);

  // Изделия этой фабрики — для добавления позиций вручную,
  // если нужного нет в рекомендациях
  const catalogRows = await db
    .select({
      productId: schema.products.id,
      productName: schema.products.name,
      collectionName: schema.collections.name,
      variantId: schema.productVariants.id,
      sku: schema.productVariants.sku,
      color: schema.productVariants.color,
      size: schema.productVariants.size,
    })
    .from(schema.factoryCollections)
    .innerJoin(
      schema.products,
      eq(schema.products.collectionId, schema.factoryCollections.collectionId),
    )
    .innerJoin(
      schema.productVariants,
      eq(schema.productVariants.productId, schema.products.id),
    )
    .innerJoin(
      schema.collections,
      eq(schema.products.collectionId, schema.collections.id),
    )
    .where(eq(schema.factoryCollections.factoryId, factoryId));

  const catalog = catalogRows.filter(
    (row) => !collectionId || row.collectionName,
  );

  /**
   * Создаёт заказ: пишет позиции, снэпшот себестоимости, резервирует ткань,
   * зачитывает кредит за брак и при нехватке ткани создаёт черновик заявки
   * на дозакупку.
   */
  async function createOrder(formData: FormData) {
    "use server";

    const user = await getCurrentUser();
    if (!user) redirect("/login");

    const factory = String(formData.get("factoryId") ?? "");
    const horizon = Number(formData.get("horizonMonths")) || null;
    const note = parseStr(formData.get("note"));
    const plannedReadyAt = parseDate(formData.get("plannedReadyAt"));

    // Собираем позиции: ключи вида qty_<variantId>
    const lines: OrderLineInput[] = [];
    for (const [key, value] of formData.entries()) {
      if (!key.startsWith("qty_")) continue;
      const quantity = parseInt0(value as FormDataEntryValue);
      if (quantity <= 0) continue;

      const variantId = key.slice(4);
      const productId = String(formData.get(`product_${variantId}`) ?? "");
      const size = parseStr(formData.get(`size_${variantId}`));
      if (!productId) continue;

      lines.push({ productId, variantId, size, quantity, plannedReadyAt });
    }

    if (lines.length === 0) {
      redirect(
        `/orders/new?factory=${factory}&horizon=${horizon ?? 3}&error=empty`,
      );
    }

    const calc = await calculateOrder(factory, lines);
    const number = await nextOrderNumber();
    const nowIso = new Date().toISOString();

    const [order] = await db
      .insert(schema.productionOrders)
      .values({
        number,
        factoryId: factory,
        // Новый заказ всегда начинается с образца: массовый пошив
        // стартует только после того, как образец утвердили.
        status: "SAMPLE",
        sampleRequestedAt: nowIso,
        plannedReadyAt,
        horizonMonths: horizon,
        snapshotFabricCost: calc.totals.fabricCostThb,
        snapshotAccessoryCost: calc.totals.accessoryCostThb,
        snapshotSewingCost: calc.totals.sewingCostThb,
        snapshotTotalCost: calc.totals.totalCostThb,
        snapshotAt: nowIso,
        note,
        createdById: user.id,
      })
      .returning();

    for (const line of calc.perLine) {
      await db.insert(schema.productionOrderLines).values({
        orderId: order.id,
        productId: line.productId,
        variantId: line.variantId ?? null,
        size: line.size ?? null,
        quantity: line.quantity,
        unitSewingCost: line.unitSewingCost,
        unitFabricCost: line.unitFabricCost,
        plannedReadyAt,
      });
    }

    // Резерв ткани: списываем с того склада, где её больше всего.
    // Без резерва два одновременных заказа claim'ят один и тот же рулон.
    for (const fabric of calc.fabrics) {
      const stockRows = await db
        .select()
        .from(schema.fabricStock)
        .where(eq(schema.fabricStock.fabricId, fabric.fabricId));

      const best = stockRows
        .slice()
        .sort((a, b) => b.onHandM - b.reservedM - (a.onHandM - a.reservedM))[0];

      await db.insert(schema.fabricReservations).values({
        fabricId: fabric.fabricId,
        warehouseId: best?.warehouseId ?? null,
        orderId: order.id,
        meters: fabric.metersNeeded,
      });

      if (best) {
        await db
          .update(schema.fabricStock)
          .set({
            reservedM: best.reservedM + fabric.metersNeeded,
            updatedAt: nowIso,
          })
          .where(eq(schema.fabricStock.id, best.id));
      }
    }

    await writeAudit(user, {
      action: "RESERVE",
      entityType: "ProductionOrder",
      entityId: order.id,
      entityName: `${number}: резерв ткани по ${calc.fabrics.length} позициям`,
    });

    // Зачёт брака с прошлых заказов этой фабрики
    const credited = await applyDefectCredits(factory, order.id);
    if (credited > 0) {
      await writeAudit(user, {
        action: "APPLY_CREDIT",
        entityType: "ProductionOrder",
        entityId: order.id,
        entityName: `${number}: зачтён брак ${Math.round(credited)} THB`,
      });
    }

    // Нехватка ткани → черновик заявки на дозакупку
    const short = calc.fabrics.filter((f) => f.metersShort > 0.01);
    if (short.length > 0) {
      const purchaseNumber = await nextPurchaseNumber();
      const firstFabric = await db
        .select({ supplierId: schema.fabrics.supplierId })
        .from(schema.fabrics)
        .where(eq(schema.fabrics.id, short[0].fabricId))
        .limit(1);

      const [purchase] = await db
        .insert(schema.fabricPurchases)
        .values({
          number: purchaseNumber,
          status: "DRAFT",
          reason: `Нехватка под заказ ${number}`,
          orderId: order.id,
          supplierId: firstFabric[0]?.supplierId ?? null,
        })
        .returning();

      for (const fabric of short) {
        await db.insert(schema.fabricPurchaseLines).values({
          purchaseId: purchase.id,
          fabricId: fabric.fabricId,
          metersNeeded: fabric.metersShort,
          note: `${fabric.fabricName}: нужно ${fabric.metersNeeded} м, доступно ${fabric.metersAvailable} м`,
        });
      }

      await writeAudit(user, {
        action: "CREATE",
        entityType: "FabricPurchase",
        entityId: purchase.id,
        entityName: `${purchaseNumber} (автоматически, нехватка под ${number})`,
      });
    }

    await writeAudit(user, {
      action: "CREATE",
      entityType: "ProductionOrder",
      entityId: order.id,
      entityName: `${number} — ${factoryName}, ${calc.totals.units} шт`,
    });

    revalidatePath("/orders");
    revalidatePath("/fabrics");
    revalidatePath("/purchases");
    revalidatePath("/");
    redirect(`/orders/${order.id}?created=1`);
  }

  // Предрасчёт по рекомендации — чтобы бюджет был виден ДО создания заказа
  const previewLines: OrderLineInput[] = recommendations.map((r) => ({
    productId: r.productId,
    variantId: r.variantId,
    size: r.size,
    quantity: r.suggestedQty,
  }));
  const preview =
    previewLines.length > 0
      ? await calculateOrder(factoryId, previewLines)
      : null;

  return (
    <form action={createOrder}>
      <input type="hidden" name="factoryId" value={factoryId} />
      <input type="hidden" name="horizonMonths" value={horizonMonths} />

      <SectionTitle>
        Рекомендация Luna — что отшить, чтобы хватило на {horizonMonths} мес
      </SectionTitle>

      {recommendations.length === 0 ? (
        <Callout tone="ok" title="Дошивать нечего">
          По всем изделиям этой фабрики текущего остатка и того, что уже в
          пошиве, хватает на {horizonMonths} мес вперёд. Можно добавить позиции
          вручную ниже.
        </Callout>
      ) : (
        <Card padded={false}>
          <Table>
            <thead>
              <tr>
                <Th>Изделие</Th>
                <Th align="right">Продаётся</Th>
                <Th align="right">На складе</Th>
                <Th align="right">Запас</Th>
                <Th align="right">Заказать, шт</Th>
              </tr>
            </thead>
            <tbody>
              {recommendations.map((r) => (
                <tr key={r.variantId}>
                  <Td>
                    <div className="font-medium">{r.label}</div>
                    <div className="text-xs text-[var(--color-muted)]">
                      {r.sku}
                    </div>
                  </Td>
                  <Td align="right">
                    <span className="tnum">{r.perMonth}</span>
                    <span className="text-xs text-[var(--color-muted)]"> шт/мес</span>
                  </Td>
                  <Td align="right">
                    <span className="tnum">{r.stockQty}</span>
                  </Td>
                  <Td align="right">
                    {r.monthsOfCover === null ? (
                      <span className="text-xs text-[var(--color-faint)]">—</span>
                    ) : (
                      <StatusPill
                        tone={
                          r.monthsOfCover < 1
                            ? "critical"
                            : r.monthsOfCover < 2
                              ? "warn"
                              : "ok"
                        }
                      >
                        {r.monthsOfCover} мес
                      </StatusPill>
                    )}
                  </Td>
                  <Td align="right">
                    <input type="hidden" name={`product_${r.variantId}`} value={r.productId} />
                    <input type="hidden" name={`size_${r.variantId}`} value={r.size ?? ""} />
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      name={`qty_${r.variantId}`}
                      defaultValue={r.suggestedQty}
                      className="w-24 text-right"
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {/* ---------- Предварительный расчёт ---------- */}
      {preview ? (
        <>
          <SectionTitle>Расход тканей и бюджет по рекомендации</SectionTitle>

          {preview.productsWithoutBom.length > 0 ? (
            <Callout tone="warn" title="У части изделий не задан состав">
              {preview.productsWithoutBom.map((p) => p.productName).join(", ")} —
              без состава (BOM) расход ткани и её стоимость посчитать нельзя.
              Задайте состав в карточке изделия, иначе бюджет будет неполным.
            </Callout>
          ) : null}

          {preview.hasShortage ? (
            <Callout tone="critical" title="Ткани не хватает">
              По позициям ниже не хватает метража. Заказ создать можно — Luna
              сразу подготовит черновик заявки на дозакупку, останется только
              отправить его поставщику.
            </Callout>
          ) : null}

          <Card padded={false} className="mb-4">
            <Table>
              <thead>
                <tr>
                  <Th>Ткань</Th>
                  <Th align="right">Нужно</Th>
                  <Th align="right">На складе</Th>
                  <Th align="right">Резерв</Th>
                  <Th align="right">Доступно</Th>
                  <Th align="right">Не хватает</Th>
                  <Th align="right">Стоимость</Th>
                </tr>
              </thead>
              <tbody>
                {preview.fabrics.map((f) => (
                  <tr key={f.fabricId}>
                    <Td>
                      <a
                        href={`/fabrics/${f.fabricId}`}
                        className="text-[var(--color-ocean)] no-underline hover:underline active:underline"
                      >
                        {f.fabricName}
                      </a>
                      <div className="text-xs text-[var(--color-muted)]">
                        {f.fabricSku}
                      </div>
                    </Td>
                    <Td align="right">{formatMeters(f.metersNeeded)}</Td>
                    <Td align="right">{formatMeters(f.metersOnHand)}</Td>
                    <Td align="right">{formatMeters(f.metersReserved)}</Td>
                    <Td align="right">{formatMeters(f.metersAvailable)}</Td>
                    <Td align="right">
                      {f.metersShort > 0.01 ? (
                        <StatusPill tone="critical">
                          {formatMeters(f.metersShort)}
                        </StatusPill>
                      ) : (
                        <StatusPill tone="ok">хватает</StatusPill>
                      )}
                    </Td>
                    <Td align="right">
                      <Money value={f.costThb} hidden={!showMoney} />
                    </Td>
                  </tr>
                ))}
                {preview.fabrics.length === 0 ? (
                  <tr>
                    <Td>
                      <span className="text-[var(--color-muted)]">
                        Состав изделий не задан — расход ткани неизвестен
                      </span>
                    </Td>
                    <Td align="right">—</Td>
                    <Td align="right">—</Td>
                    <Td align="right">—</Td>
                    <Td align="right">—</Td>
                    <Td align="right">—</Td>
                    <Td align="right">—</Td>
                  </tr>
                ) : null}
              </tbody>
            </Table>
          </Card>

          {preview.accessories.length > 0 ? (
            <Card className="mb-4">
              <div className="mb-2 text-sm font-medium text-[var(--color-ocean)]">
                Фурнитура
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
                {preview.accessories.map((a) => (
                  <span key={a.accessoryId}>
                    {a.name}:{" "}
                    <b className="tnum">
                      {a.qtyNeeded} {a.unit}
                    </b>
                    {a.qtyShort > 0.01 ? (
                      <span className="ml-1 text-[#A82C2C]">
                        (не хватает {a.qtyShort})
                      </span>
                    ) : null}
                  </span>
                ))}
              </div>
            </Card>
          ) : null}

          <Card className="mb-4">
            <div className="grid gap-4 sm:grid-cols-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
                  Ткань
                </div>
                <Money value={preview.totals.fabricCostThb} hidden={!showMoney} />
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
                  Фурнитура
                </div>
                <Money
                  value={preview.totals.accessoryCostThb}
                  hidden={!showMoney}
                />
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
                  Пошив
                </div>
                <Money value={preview.totals.sewingCostThb} hidden={!showMoney} />
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
                  Итого · {preview.totals.units} шт
                </div>
                <Money
                  value={preview.totals.totalCostThb}
                  hidden={!showMoney}
                  className="text-xl"
                />
              </div>
            </div>

            {openCredit > 0 && showMoney ? (
              <div className="mt-3 border-t border-[var(--color-line)] pt-3 text-sm text-[#0A7A0A]">
                <span aria-hidden="true">✓</span> С этой фабрики есть незачтённый
                брак на{" "}
                {Math.round(openCredit).toLocaleString("ru-RU").replace(/,/g, " ")}{" "}
                THB — он будет автоматически вычтен из этого заказа.
              </div>
            ) : null}

            <div className="mt-3 border-t border-[var(--color-line)] pt-3 text-xs text-[var(--color-muted)]">
              Себестоимость фиксируется на момент создания заказа. Если цена
              ткани или пошива изменится позже, этот заказ не пересчитается.
            </div>
          </Card>
        </>
      ) : null}

      {/* ---------- Добавить вручную ---------- */}
      <SectionTitle>Добавить позиции вручную</SectionTitle>
      <Card>
        <p className="mt-0 mb-3 text-sm text-[var(--color-muted)]">
          Если нужного изделия нет в рекомендации — впишите количество здесь.
          Показаны все SKU коллекций, которые шьёт {factoryName}.
        </p>
        <details>
          <summary className="touch cursor-pointer py-1 text-sm font-medium text-[var(--color-ocean)]">
            Показать каталог фабрики ({catalog.length} SKU)
          </summary>
          <div className="mt-3 max-h-[420px] overflow-y-auto">
            <Table>
              <thead>
                <tr>
                  <Th>Изделие</Th>
                  <Th>SKU</Th>
                  <Th align="right">Заказать, шт</Th>
                </tr>
              </thead>
              <tbody>
                {catalog
                  .filter((row) => !recommendations.some((r) => r.variantId === row.variantId))
                  .map((row) => (
                    <tr key={row.variantId}>
                      <Td>
                        <div>{row.productName}</div>
                        <div className="text-xs text-[var(--color-muted)]">
                          {row.collectionName}
                          {row.color ? ` · ${row.color}` : ""}
                          {row.size ? ` · ${row.size}` : ""}
                        </div>
                      </Td>
                      <Td>
                        <span className="text-xs">{row.sku}</span>
                      </Td>
                      <Td align="right">
                        <input
                          type="hidden"
                          name={`product_${row.variantId}`}
                          value={row.productId}
                        />
                        <input
                          type="hidden"
                          name={`size_${row.variantId}`}
                          value={row.size ?? ""}
                        />
                        <Input
                          type="number"
                          min="0"
                          step="1"
                          name={`qty_${row.variantId}`}
                          placeholder="0"
                          className="w-24 text-right"
                        />
                      </Td>
                    </tr>
                  ))}
              </tbody>
            </Table>
          </div>
        </details>
      </Card>

      {/* ---------- Срок и создание ---------- */}
      <SectionTitle>Срок и подтверждение</SectionTitle>
      <Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Плановая дата готовности"
            required
            hint="по ней считается «вовремя / с опозданием» в скоркарде фабрики"
          >
            <Input type="date" name="plannedReadyAt" required />
          </Field>
          <Field label="Примечание для фабрики">
            <Textarea name="note" placeholder="Например: под высокий сезон, приоритет по шёлку" />
          </Field>
        </div>

        <Callout tone="warn" title="Заказ создаётся на этапе «Образец»">
          Сначала фабрика шьёт образец. Массовый пошив начинается только после
          того, как вы утвердите образец в карточке заказа. Метраж тканей
          резервируется сразу — чтобы его не занял другой заказ.
        </Callout>

        <div className="flex flex-wrap gap-3">
          <Button type="submit" variant="primary">
            Создать заказ и зарезервировать ткань
          </Button>
          <LinkButton href="/orders">Отмена</LinkButton>
        </div>
      </Card>
    </form>
  );
}
