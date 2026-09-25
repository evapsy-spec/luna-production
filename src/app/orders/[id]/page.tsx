import { and, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/lib/db/client";
import { getCurrentUser, canSeeMoney, writeAudit } from "@/lib/auth";
import { formatMeters, formatThb } from "@/lib/production";
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
  OrderStatusPill,
  StatusPill,
  Callout,
  Table,
  Th,
  Td,
  WhatsappLink,
  formatDate,
  formatDateTime,
} from "@/components/ui";
import {
  consumeReservedFabric,
  DeadlinePill,
  parseDate,
  parseInt0,
  parseNum,
  parseStr,
  plural,
  releaseReservations,
} from "../_shared";

export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const user = await getCurrentUser();
  const showMoney = canSeeMoney(user);
  const { id } = await params;
  const { created } = await searchParams;

  const rows = await db
    .select({
      order: schema.productionOrders,
      factory: schema.factories,
    })
    .from(schema.productionOrders)
    .innerJoin(
      schema.factories,
      eq(schema.productionOrders.factoryId, schema.factories.id),
    )
    .where(eq(schema.productionOrders.id, id))
    .limit(1);

  if (!rows.length) notFound();
  const { order, factory } = rows[0];

  const lines = await db
    .select({
      line: schema.productionOrderLines,
      productName: schema.products.name,
      productId: schema.products.id,
      sku: schema.productVariants.sku,
      color: schema.productVariants.color,
      collectionName: schema.collections.name,
    })
    .from(schema.productionOrderLines)
    .innerJoin(
      schema.products,
      eq(schema.productionOrderLines.productId, schema.products.id),
    )
    .innerJoin(
      schema.collections,
      eq(schema.products.collectionId, schema.collections.id),
    )
    .leftJoin(
      schema.productVariants,
      eq(schema.productionOrderLines.variantId, schema.productVariants.id),
    )
    .where(eq(schema.productionOrderLines.orderId, id));

  const reservations = await db
    .select({
      res: schema.fabricReservations,
      fabricName: schema.fabrics.name,
      fabricSku: schema.fabrics.sku,
      warehouseName: schema.warehouses.name,
    })
    .from(schema.fabricReservations)
    .innerJoin(
      schema.fabrics,
      eq(schema.fabricReservations.fabricId, schema.fabrics.id),
    )
    .leftJoin(
      schema.warehouses,
      eq(schema.fabricReservations.warehouseId, schema.warehouses.id),
    )
    .where(eq(schema.fabricReservations.orderId, id));

  const payments = await db
    .select()
    .from(schema.orderPayments)
    .where(eq(schema.orderPayments.orderId, id));

  const defects = await db
    .select()
    .from(schema.defectCredits)
    .where(eq(schema.defectCredits.orderId, id));

  const purchases = await db
    .select()
    .from(schema.fabricPurchases)
    .where(eq(schema.fabricPurchases.orderId, id));

  const totalUnits = lines.reduce((s, l) => s + l.line.quantity, 0);
  const totalProduced = lines.reduce((s, l) => s + l.line.qtyProduced, 0);
  const totalDefect = lines.reduce((s, l) => s + l.line.qtyDefect, 0);
  const paid = payments.reduce((s, p) => s + p.amount, 0);
  const netTotal = order.snapshotTotalCost - order.appliedDefectCredit;
  const due = Math.max(0, netTotal - paid);

  // ---------------- Server actions ----------------

  async function approveSample(formData: FormData) {
    "use server";
    const actor = await getCurrentUser();
    if (!actor) redirect("/login");
    const note = parseStr(formData.get("sampleNote"));
    const now = new Date().toISOString();

    await db
      .update(schema.productionOrders)
      .set({
        status: "IN_PRODUCTION",
        sampleApprovedAt: now,
        sampleNote: note,
        updatedAt: now,
      })
      .where(eq(schema.productionOrders.id, id));

    await writeAudit(actor, {
      action: "UPDATE",
      entityType: "ProductionOrder",
      entityId: id,
      entityName: `${order.number}: образец утверждён, запущен массовый пошив`,
    });
    revalidatePath(`/orders/${id}`);
    revalidatePath("/orders");
    revalidatePath("/");
  }

  async function setStatus(formData: FormData) {
    "use server";
    const actor = await getCurrentUser();
    if (!actor) redirect("/login");
    const status = String(formData.get("status") ?? "");
    if (!["READY", "RECEIVED", "CANCELLED"].includes(status)) return;

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { status, updatedAt: now };

    if (status === "READY") {
      // фактическая дата готовности — из неё считается «вовремя» в скоркарде
      patch.actualReadyAt = parseDate(formData.get("actualReadyAt")) ?? now;
    }

    await db
      .update(schema.productionOrders)
      .set(patch)
      .where(eq(schema.productionOrders.id, id));

    // Приёмка: ткань физически израсходована — списываем её со склада.
    // Отмена: ткань не тронута — просто снимаем резерв.
    if (status === "RECEIVED") await consumeReservedFabric(id);
    if (status === "CANCELLED") await releaseReservations(id);

    await writeAudit(actor, {
      action: "UPDATE",
      entityType: "ProductionOrder",
      entityId: id,
      entityName: `${order.number}: статус → ${status}`,
      changes: { status: { from: order.status, to: status } },
    });
    revalidatePath(`/orders/${id}`);
    revalidatePath("/orders");
    revalidatePath("/fabrics");
    revalidatePath("/");
  }

  async function updateLine(formData: FormData) {
    "use server";
    const actor = await getCurrentUser();
    if (!actor) redirect("/login");

    const lineId = String(formData.get("lineId") ?? "");
    const produced = parseInt0(formData.get("qtyProduced"));
    const defect = parseInt0(formData.get("qtyDefect"));

    const existing = await db
      .select()
      .from(schema.productionOrderLines)
      .where(eq(schema.productionOrderLines.id, lineId))
      .limit(1);
    if (!existing.length) return;
    const line = existing[0];

    await db
      .update(schema.productionOrderLines)
      .set({ qtyProduced: produced, qtyDefect: defect })
      .where(eq(schema.productionOrderLines.id, lineId));

    /**
     * Брак: заводим кредит на фабрику — его стоимость вычтется из следующего
     * заказа. Пересоздаём запись по этой строке, чтобы при правке количества
     * брака сумма не удваивалась.
     */
    if (defect !== line.qtyDefect) {
      await db
        .delete(schema.defectCredits)
        .where(
          and(
            eq(schema.defectCredits.orderLineId, lineId),
            eq(schema.defectCredits.orderId, id),
          ),
        );

      if (defect > 0) {
        const unitCost = line.unitSewingCost + line.unitFabricCost;
        await db.insert(schema.defectCredits).values({
          orderId: id,
          factoryId: order.factoryId,
          orderLineId: lineId,
          quantity: defect,
          amount: defect * unitCost,
          reason: parseStr(formData.get("defectReason")),
        });
      }

      await writeAudit(actor, {
        action: "UPDATE",
        entityType: "ProductionOrderLine",
        entityId: lineId,
        entityName: `${order.number}: брак ${line.qtyDefect} → ${defect} шт`,
        changes: { qtyDefect: { from: line.qtyDefect, to: defect } },
      });
    }

    revalidatePath(`/orders/${id}`);
    revalidatePath("/factories");
    revalidatePath("/");
  }

  async function addPayment(formData: FormData) {
    "use server";
    const actor = await getCurrentUser();
    if (!actor) redirect("/login");
    if (actor.role !== "OWNER") return; // оплаты — только владельцы

    const amount = parseNum(formData.get("amount"));
    if (amount === null || amount <= 0) return;

    await db.insert(schema.orderPayments).values({
      orderId: id,
      kind: String(formData.get("kind") ?? "DEPOSIT"),
      amount,
      paidAt: parseDate(formData.get("paidAt")) ?? new Date().toISOString(),
      invoiceNo: parseStr(formData.get("invoiceNo")),
      note: parseStr(formData.get("note")),
    });

    await writeAudit(actor, {
      action: "CREATE",
      entityType: "OrderPayment",
      entityId: id,
      entityName: `${order.number}: оплата ${formatThb(amount)}`,
    });
    revalidatePath(`/orders/${id}`);
    revalidatePath("/factories");
  }

  const specText =
    `Заказ ${order.number} · ${factory.name}\n` +
    lines
      .map(
        (l) =>
          `${l.productName}${l.color ? ` (${l.color})` : ""}${l.line.size ? ` ${l.line.size}` : ""} — ${l.line.quantity} шт`,
      )
      .join("\n") +
    `\nВсего: ${totalUnits} шт\nПлан готовности: ${formatDate(order.plannedReadyAt)}`;

  return (
    <>
      <PageHeader
        title={`Заказ ${order.number}`}
        subtitle={`${factory.name}${order.note ? ` · ${order.note}` : ""}`}
        action={
          <div className="flex flex-wrap gap-2">
            <LinkButton href={`/orders/${id}/spec`} variant="secondary">
              Спецификация для фабрики
            </LinkButton>
            <LinkButton href="/orders">← К заказам</LinkButton>
          </div>
        }
      />

      {created ? (
        <Callout tone="ok" title="Заказ создан">
          Метраж тканей зарезервирован.
          {purchases.length > 0
            ? " Ткани не хватило — черновик заявки на дозакупку уже готов, посмотрите в разделе «Заявки на ткань»."
            : ""}
        </Callout>
      ) : null}

      {/* ---------- Статус и ключевые цифры ---------- */}
      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <OrderStatusPill status={order.status} />
          <DeadlinePill
            plannedReadyAt={order.plannedReadyAt}
            actualReadyAt={order.actualReadyAt}
            status={order.status}
          />
          {order.horizonMonths ? (
            <StatusPill tone="neutral">
              горизонт {order.horizonMonths} мес
            </StatusPill>
          ) : null}
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
              Заказано
            </div>
            <div className="figure text-xl text-[var(--color-ocean)]">
              {totalUnits} шт
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
              Отшито
            </div>
            <div className="figure text-xl text-[var(--color-ocean)]">
              {totalProduced} шт
            </div>
            {totalDefect > 0 ? (
              <div className="mt-1 text-xs text-[#A82C2C]">
                из них брак {totalDefect} шт
              </div>
            ) : null}
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
              Себестоимость заказа
            </div>
            <Money value={order.snapshotTotalCost} hidden={!showMoney} className="text-xl" />
            {order.appliedDefectCredit > 0 && showMoney ? (
              <div className="mt-1 text-xs text-[#0A7A0A]">
                зачтён брак −{formatThb(order.appliedDefectCredit)}
              </div>
            ) : null}
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
              Остаток к оплате
            </div>
            <Money value={due} hidden={!showMoney} className="text-xl" />
            {showMoney ? (
              <div className="mt-1 text-xs text-[var(--color-muted)]">
                оплачено {formatThb(paid)} из {formatThb(netTotal)}
              </div>
            ) : null}
          </div>
        </div>

        {showMoney ? (
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 border-t border-[var(--color-line)] pt-3 text-xs text-[var(--color-muted)]">
            <span>ткань {formatThb(order.snapshotFabricCost)}</span>
            <span>фурнитура {formatThb(order.snapshotAccessoryCost)}</span>
            <span>пошив {formatThb(order.snapshotSewingCost)}</span>
            <span>снэпшот от {formatDateTime(order.snapshotAt)}</span>
          </div>
        ) : null}
      </Card>

      {/* ---------- Этап образца ---------- */}
      {order.status === "SAMPLE" ? (
        <Card className="mb-4">
          <div className="mb-3 text-base font-semibold text-[var(--color-ocean)]">
            Образец
          </div>
          <p className="mt-0 text-sm text-[var(--color-muted)]">
            Запрошен {formatDate(order.sampleRequestedAt)}. Пока образец не
            утверждён, массовый пошив не начинается.
          </p>
          <form action={approveSample} className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Field label="Комментарий к образцу">
                <Input
                  name="sampleNote"
                  placeholder="Например: подогнали посадку в плече, всё ок"
                />
              </Field>
            </div>
            <Button type="submit" variant="primary">
              Утвердить образец → в производство
            </Button>
          </form>
          <div className="mt-3">
            <WhatsappLink
              phone={factory.whatsapp}
              text={`Здравствуйте! По заказу ${order.number}: как продвигается образец?`}
            >
              Спросить про образец в WhatsApp
            </WhatsappLink>
          </div>
        </Card>
      ) : order.sampleApprovedAt ? (
        <Card className="mb-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <StatusPill tone="ok">образец утверждён</StatusPill>
            <span className="text-[var(--color-muted)]">
              {formatDate(order.sampleApprovedAt)}
              {order.sampleNote ? ` · ${order.sampleNote}` : ""}
            </span>
          </div>
        </Card>
      ) : null}

      {/* ---------- Позиции ---------- */}
      <SectionTitle>Позиции заказа</SectionTitle>
      <Card padded={false}>
        <Table>
          <thead>
            <tr>
              <Th>Изделие</Th>
              <Th>Размер</Th>
              <Th align="right">Заказано</Th>
              <Th align="right">Отшито</Th>
              <Th align="right">Брак</Th>
              {showMoney ? <Th align="right">Себестоим. 1 шт</Th> : null}
              <Th align="right">Обновить</Th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.line.id}>
                <Td>
                  <a
                    href={`/products/${l.productId}`}
                    className="font-medium text-[var(--color-ocean)] no-underline hover:underline active:underline"
                  >
                    {l.productName}
                  </a>
                  <div className="text-xs text-[var(--color-muted)]">
                    {l.collectionName}
                    {l.color ? ` · ${l.color}` : ""}
                    {l.sku ? ` · ${l.sku}` : ""}
                  </div>
                </Td>
                <Td>{l.line.size ?? "—"}</Td>
                <Td align="right">{l.line.quantity}</Td>
                <Td align="right">{l.line.qtyProduced}</Td>
                <Td align="right">
                  {l.line.qtyDefect > 0 ? (
                    <StatusPill tone="critical">{l.line.qtyDefect}</StatusPill>
                  ) : (
                    "0"
                  )}
                </Td>
                {showMoney ? (
                  <Td align="right">
                    {formatThb(l.line.unitSewingCost + l.line.unitFabricCost)}
                  </Td>
                ) : null}
                <Td align="right">
                  <form action={updateLine} className="flex items-center justify-end gap-1.5">
                    <input type="hidden" name="lineId" value={l.line.id} />
                    <Input
                      type="number"
                      min="0"
                      name="qtyProduced"
                      defaultValue={l.line.qtyProduced}
                      className="w-20 text-right"
                      aria-label="отшито"
                    />
                    <Input
                      type="number"
                      min="0"
                      name="qtyDefect"
                      defaultValue={l.line.qtyDefect}
                      className="w-16 text-right"
                      aria-label="брак"
                    />
                    <Button type="submit" variant="secondary" className="px-3">
                      ОК
                    </Button>
                  </form>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <div className="border-t border-[var(--color-line)] px-4 py-2.5 text-xs text-[var(--color-muted)]">
          Второе поле — брак. Его стоимость автоматически становится кредитом на
          фабрику и вычитается из следующего заказа.
        </div>
      </Card>

      {/* ---------- Брак ---------- */}
      {defects.length > 0 ? (
        <>
          <SectionTitle>Брак по этому заказу</SectionTitle>
          <Card padded={false}>
            <Table>
              <thead>
                <tr>
                  <Th align="right">Шт</Th>
                  <Th align="right">Сумма к вычету</Th>
                  <Th>Причина</Th>
                  <Th>Зачтено</Th>
                </tr>
              </thead>
              <tbody>
                {defects.map((d) => (
                  <tr key={d.id}>
                    <Td align="right">{d.quantity}</Td>
                    <Td align="right">
                      <Money value={d.amount} hidden={!showMoney} />
                    </Td>
                    <Td>{d.reason ?? "—"}</Td>
                    <Td>
                      {d.appliedToOrderId ? (
                        <StatusPill tone="ok">
                          зачтён {formatDate(d.appliedAt)}
                        </StatusPill>
                      ) : (
                        <StatusPill tone="warn">
                          ждёт следующего заказа
                        </StatusPill>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </>
      ) : null}

      {/* ---------- Резерв тканей ---------- */}
      <SectionTitle>Ткань под заказ</SectionTitle>
      <Card padded={false}>
        <Table>
          <thead>
            <tr>
              <Th>Ткань</Th>
              <Th>Склад</Th>
              <Th align="right">Метраж</Th>
              <Th>Резерв</Th>
            </tr>
          </thead>
          <tbody>
            {reservations.map((r) => (
              <tr key={r.res.id}>
                <Td>
                  <a
                    href={`/fabrics/${r.res.fabricId}`}
                    className="text-[var(--color-ocean)] no-underline hover:underline active:underline"
                  >
                    {r.fabricName}
                  </a>
                  <div className="text-xs text-[var(--color-muted)]">
                    {r.fabricSku ?? "без SKU"}
                  </div>
                </Td>
                <Td>{r.warehouseName ?? "—"}</Td>
                <Td align="right">{formatMeters(r.res.meters)}</Td>
                <Td>
                  {r.res.released ? (
                    <StatusPill tone="neutral">снят / израсходован</StatusPill>
                  ) : (
                    <StatusPill tone="ok">держится</StatusPill>
                  )}
                </Td>
              </tr>
            ))}
            {reservations.length === 0 ? (
              <tr>
                <Td>
                  <span className="text-[var(--color-muted)]">
                    Резерва нет — у изделий не задан состав (BOM)
                  </span>
                </Td>
                <Td>—</Td>
                <Td align="right">—</Td>
                <Td>—</Td>
              </tr>
            ) : null}
          </tbody>
        </Table>
      </Card>

      {purchases.length > 0 ? (
        <Callout tone="warn" title="По этому заказу есть заявка на дозакупку ткани">
          {purchases.map((p) => (
            <div key={p.id}>
              <a href="/purchases" className="text-inherit underline">
                {p.number}
              </a>{" "}
              — {p.reason}
            </div>
          ))}
        </Callout>
      ) : null}

      {/* ---------- Оплаты (только владельцы) ---------- */}
      {showMoney ? (
        <>
          <SectionTitle>Оплаты фабрике</SectionTitle>
          <Card padded={false} className="mb-4">
            <Table>
              <thead>
                <tr>
                  <Th>Вид</Th>
                  <Th align="right">Сумма</Th>
                  <Th>Дата</Th>
                  <Th>Инвойс</Th>
                  <Th>Примечание</Th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <Td>
                      {p.kind === "DEPOSIT"
                        ? "Аванс"
                        : p.kind === "BALANCE"
                          ? "Остаток"
                          : p.kind === "FULL"
                            ? "Полная оплата"
                            : "Прочее"}
                    </Td>
                    <Td align="right">
                      <Money value={p.amount} />
                    </Td>
                    <Td>{formatDate(p.paidAt)}</Td>
                    <Td>{p.invoiceNo ?? "—"}</Td>
                    <Td>{p.note ?? "—"}</Td>
                  </tr>
                ))}
                {payments.length === 0 ? (
                  <tr>
                    <Td>
                      <span className="text-[var(--color-muted)]">
                        Оплат пока нет
                      </span>
                    </Td>
                    <Td align="right">—</Td>
                    <Td>—</Td>
                    <Td>—</Td>
                    <Td>—</Td>
                  </tr>
                ) : null}
              </tbody>
            </Table>
          </Card>

          <Card>
            <form action={addPayment} className="grid gap-3 sm:grid-cols-5">
              <Field label="Вид">
                <Select name="kind" defaultValue="DEPOSIT">
                  <option value="DEPOSIT">Аванс</option>
                  <option value="BALANCE">Остаток</option>
                  <option value="FULL">Полная оплата</option>
                  <option value="OTHER">Прочее</option>
                </Select>
              </Field>
              <Field label="Сумма, THB" required>
                <Input type="number" name="amount" min="0" step="0.01" required />
              </Field>
              <Field label="Дата">
                <Input type="date" name="paidAt" />
              </Field>
              <Field label="Инвойс">
                <Input name="invoiceNo" placeholder="INV-020" />
              </Field>
              <div className="flex items-end">
                <Button type="submit" variant="secondary" className="w-full">
                  Добавить оплату
                </Button>
              </div>
            </form>
          </Card>
        </>
      ) : null}

      {/* ---------- Смена статуса ---------- */}
      <SectionTitle>Движение заказа</SectionTitle>
      <Card>
        <div className="flex flex-wrap gap-3">
          {order.status === "IN_PRODUCTION" ? (
            <form action={setStatus} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="status" value="READY" />
              <Field label="Фактическая дата готовности">
                <Input type="date" name="actualReadyAt" />
              </Field>
              <Button type="submit" variant="primary">
                Готово на фабрике
              </Button>
            </form>
          ) : null}

          {order.status === "READY" ? (
            <form action={setStatus}>
              <input type="hidden" name="status" value="RECEIVED" />
              <Button type="submit" variant="primary">
                Принять на склад (списать ткань)
              </Button>
            </form>
          ) : null}

          {order.status !== "CANCELLED" && order.status !== "RECEIVED" ? (
            <form action={setStatus}>
              <input type="hidden" name="status" value="CANCELLED" />
              <Button type="submit" variant="danger">
                Отменить заказ (снять резерв ткани)
              </Button>
            </form>
          ) : null}

          <WhatsappLink phone={factory.whatsapp} text={specText}>
            Отправить состав заказа в WhatsApp
          </WhatsappLink>
        </div>

        <div className="mt-4 border-t border-[var(--color-line)] pt-3 text-xs text-[var(--color-muted)]">
          При приёмке на склад зарезервированный метраж списывается со склада
          тканей — до этого момента ткань только забронирована. При отмене резерв
          просто снимается, ткань остаётся.
        </div>
      </Card>

      <div className="mt-6 text-xs text-[var(--color-muted)]">
        Создан {formatDateTime(order.createdAt)} · обновлён{" "}
        {formatDateTime(order.updatedAt)} · плановая готовность{" "}
        {formatDate(order.plannedReadyAt)}
        {order.actualReadyAt
          ? ` · фактически ${formatDate(order.actualReadyAt)}`
          : ""}
      </div>
    </>
  );
}
