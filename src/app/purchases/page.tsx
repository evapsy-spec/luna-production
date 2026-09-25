import { redirect } from "next/navigation";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { canSeeMoney, getCurrentUser, writeAudit } from "@/lib/auth";
import { formatMeters, round2 } from "@/lib/production";
import {
  Button,
  Callout,
  Card,
  EmptyState,
  Field,
  formatDate,
  LinkButton,
  Money,
  PageHeader,
  Select,
  StatusPill,
  type StatusTone,
  Table,
  Td,
  Th,
  WhatsappLink,
} from "@/components/ui";

export const metadata = { title: "Заявки на ткань — Luna Production" };

const STATUS_VIEW: Record<string, { tone: StatusTone; label: string }> = {
  DRAFT: { tone: "warn", label: "Черновик" },
  SENT: { tone: "neutral", label: "Отправлена" },
  RECEIVED: { tone: "ok", label: "Получена" },
  CANCELLED: { tone: "neutral", label: "Отменена" },
};

// ============================================================
// SERVER ACTIONS
// ============================================================

async function purchaseLabel(purchaseId: string): Promise<string> {
  const rows = await db
    .select({ number: schema.fabricPurchases.number })
    .from(schema.fabricPurchases)
    .where(eq(schema.fabricPurchases.id, purchaseId))
    .limit(1);
  return rows[0]?.number ?? purchaseId;
}

async function sendPurchase(formData: FormData) {
  "use server";
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const id = String(formData.get("purchaseId") ?? "");
  if (!id) redirect("/purchases");

  await db
    .update(schema.fabricPurchases)
    .set({ status: "SENT", sentAt: new Date().toISOString() })
    .where(eq(schema.fabricPurchases.id, id));

  await writeAudit(user, {
    action: "UPDATE",
    entityType: "fabric_purchase",
    entityId: id,
    entityName: await purchaseLabel(id),
    changes: { статус: { from: "DRAFT", to: "SENT" } },
  });

  revalidatePath("/purchases");
  redirect("/purchases?ok=sent");
}

async function cancelPurchase(formData: FormData) {
  "use server";
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const id = String(formData.get("purchaseId") ?? "");
  if (!id) redirect("/purchases");

  const before = (
    await db
      .select({ status: schema.fabricPurchases.status })
      .from(schema.fabricPurchases)
      .where(eq(schema.fabricPurchases.id, id))
      .limit(1)
  )[0];

  await db
    .update(schema.fabricPurchases)
    .set({ status: "CANCELLED" })
    .where(eq(schema.fabricPurchases.id, id));

  await writeAudit(user, {
    action: "UPDATE",
    entityType: "fabric_purchase",
    entityId: id,
    entityName: await purchaseLabel(id),
    changes: { статус: { from: before?.status ?? null, to: "CANCELLED" } },
  });

  revalidatePath("/purchases");
  redirect("/purchases?ok=cancelled");
}

/** Приход по заявке: метраж строк ложится на выбранный склад тканей */
async function receivePurchase(formData: FormData) {
  "use server";
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const id = String(formData.get("purchaseId") ?? "");
  const warehouseId = String(formData.get("warehouseId") ?? "");
  if (!id) redirect("/purchases");
  if (!warehouseId) redirect("/purchases?error=warehouse");

  const lines = await db
    .select({
      id: schema.fabricPurchaseLines.id,
      fabricId: schema.fabricPurchaseLines.fabricId,
      draftName: schema.fabricPurchaseLines.draftName,
      metersNeeded: schema.fabricPurchaseLines.metersNeeded,
      metersOrdered: schema.fabricPurchaseLines.metersOrdered,
      fabricName: schema.fabrics.name,
      fabricSku: schema.fabrics.sku,
    })
    .from(schema.fabricPurchaseLines)
    .leftJoin(
      schema.fabrics,
      eq(schema.fabricPurchaseLines.fabricId, schema.fabrics.id),
    )
    .where(eq(schema.fabricPurchaseLines.purchaseId, id));

  const changes: Record<string, { from: unknown; to: unknown }> = {
    статус: { from: "SENT", to: "RECEIVED" },
  };

  // строки-черновики (ткань ещё не заведена в библиотеке) — приход пропускаем,
  // остатки по ним проводят вручную после того, как ткань оформят карточкой
  let skipped = 0;

  for (const line of lines) {
    if (!line.fabricId) {
      skipped++;
      continue;
    }
    const fabricId = line.fabricId;

    // если поставщик не уточнял отгруженный метраж — приходуем запрошенный
    const meters = line.metersOrdered ?? line.metersNeeded;
    if (meters <= 0) continue;

    const existing = await db
      .select()
      .from(schema.fabricStock)
      .where(
        and(
          eq(schema.fabricStock.fabricId, fabricId),
          eq(schema.fabricStock.warehouseId, warehouseId),
        ),
      )
      .limit(1);

    const from = existing[0]?.onHandM ?? 0;
    const to = round2(from + meters);

    if (existing[0]) {
      await db
        .update(schema.fabricStock)
        .set({ onHandM: to, updatedAt: new Date().toISOString() })
        .where(eq(schema.fabricStock.id, existing[0].id));
    } else {
      await db
        .insert(schema.fabricStock)
        .values({ fabricId, warehouseId, onHandM: to });
    }

    if (line.metersOrdered == null) {
      await db
        .update(schema.fabricPurchaseLines)
        .set({ metersOrdered: meters })
        .where(eq(schema.fabricPurchaseLines.id, line.id));
    }

    // ткань пришла — пометку «ожидаем» снимаем, чтобы не висела вечно
    await db
      .update(schema.fabrics)
      .set({ isOnOrder: false, updatedAt: new Date().toISOString() })
      .where(eq(schema.fabrics.id, fabricId));

    changes[`${line.fabricName} (${line.fabricSku ?? "без SKU"})`] = { from, to };
  }

  await db
    .update(schema.fabricPurchases)
    .set({ status: "RECEIVED", receivedAt: new Date().toISOString() })
    .where(eq(schema.fabricPurchases.id, id));

  await writeAudit(user, {
    action: "UPDATE",
    entityType: "fabric_purchase",
    entityId: id,
    entityName: await purchaseLabel(id),
    changes,
  });

  revalidatePath("/purchases");
  revalidatePath("/fabrics");
  redirect(`/purchases?ok=received${skipped > 0 ? `&skipped=${skipped}` : ""}`);
}

// ============================================================
// СТРАНИЦА
// ============================================================

export default async function PurchasesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; skipped?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const flags = await searchParams;
  const money = canSeeMoney(user);

  const purchases = await db
    .select({
      id: schema.fabricPurchases.id,
      number: schema.fabricPurchases.number,
      status: schema.fabricPurchases.status,
      reason: schema.fabricPurchases.reason,
      createdAt: schema.fabricPurchases.createdAt,
      sentAt: schema.fabricPurchases.sentAt,
      receivedAt: schema.fabricPurchases.receivedAt,
      orderId: schema.productionOrders.id,
      orderNumber: schema.productionOrders.number,
      supplierId: schema.suppliers.id,
      supplierName: schema.suppliers.name,
      supplierWhatsapp: schema.suppliers.whatsapp,
    })
    .from(schema.fabricPurchases)
    .leftJoin(
      schema.productionOrders,
      eq(schema.fabricPurchases.orderId, schema.productionOrders.id),
    )
    .leftJoin(
      schema.suppliers,
      eq(schema.fabricPurchases.supplierId, schema.suppliers.id),
    )
    .orderBy(desc(schema.fabricPurchases.createdAt));

  const lines = purchases.length
    ? await db
        .select({
          purchaseId: schema.fabricPurchaseLines.purchaseId,
          fabricId: schema.fabricPurchaseLines.fabricId,
          draftName: schema.fabricPurchaseLines.draftName,
          metersNeeded: schema.fabricPurchaseLines.metersNeeded,
          metersOrdered: schema.fabricPurchaseLines.metersOrdered,
          pricePerMeter: schema.fabricPurchaseLines.pricePerMeter,
          currency: schema.fabricPurchaseLines.currency,
          fxRateToThb: schema.fabricPurchaseLines.fxRateToThb,
          note: schema.fabricPurchaseLines.note,
          fabricName: schema.fabrics.name,
          fabricSku: schema.fabrics.sku,
        })
        .from(schema.fabricPurchaseLines)
        .leftJoin(
          schema.fabrics,
          eq(schema.fabricPurchaseLines.fabricId, schema.fabrics.id),
        )
        .where(
          inArray(
            schema.fabricPurchaseLines.purchaseId,
            purchases.map((p) => p.id),
          ),
        )
    : [];

  const fabricWarehouses = await db
    .select({ id: schema.warehouses.id, name: schema.warehouses.name })
    .from(schema.warehouses)
    .where(
      and(eq(schema.warehouses.kind, "FABRIC"), eq(schema.warehouses.isActive, true)),
    )
    .orderBy(asc(schema.warehouses.name));

  const linesByPurchase = new Map<string, typeof lines>();
  for (const line of lines) {
    const list = linesByPurchase.get(line.purchaseId) ?? [];
    list.push(line);
    linesByPurchase.set(line.purchaseId, list);
  }

  return (
    <>
      <PageHeader
        title="Заявки на дозакупку ткани"
        subtitle="Что нужно докупить, кому отправлено и что уже пришло"
        action={
          <LinkButton href="/purchases/new" variant="primary">
            + Создать заявку
          </LinkButton>
        }
      />

      {flags.ok === "sent" ? (
        <Callout tone="ok" title="Заявка отмечена как отправленная">
          Не забудьте отправить текст поставщику в WhatsApp — ссылка в карточке
          заявки.
        </Callout>
      ) : null}
      {flags.ok === "received" ? (
        <Callout tone="ok" title="Приход проведён">
          Метраж добавлен на выбранный склад тканей, пометка «ожидаем» снята.
          {flags.skipped
            ? ` Строк-черновиков (ткань ещё не в библиотеке) пропущено: ${flags.skipped} — заведите на них карточку ткани и внесите остаток вручную.`
            : ""}
        </Callout>
      ) : null}
      {flags.ok === "cancelled" ? (
        <Callout tone="neutral" title="Заявка отменена">
          Остатки не тронуты.
        </Callout>
      ) : null}
      {flags.error === "warehouse" ? (
        <Callout tone="critical" title="Приход не проведён">
          Выберите склад тканей, на который пришла поставка.
        </Callout>
      ) : null}

      {purchases.length === 0 ? (
        <EmptyState
          title="Заявок нет"
          hint="Заявка создаётся автоматически, когда под заказ на пошив не хватает ткани. Можно завести её и вручную."
          action={
            <LinkButton href="/purchases/new" variant="primary">
              + Создать заявку
            </LinkButton>
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          {purchases.map((p) => {
            const view = STATUS_VIEW[p.status] ?? {
              tone: "neutral" as StatusTone,
              label: p.status,
            };
            const purchaseLines = linesByPurchase.get(p.id) ?? [];
            const totalMeters = purchaseLines.reduce(
              (s, l) => s + (l.metersOrdered ?? l.metersNeeded),
              0,
            );

            const totalCostThb = purchaseLines.reduce((s, l) => {
              if (l.pricePerMeter == null || l.fxRateToThb == null) return s;
              return s + (l.metersOrdered ?? l.metersNeeded) * l.pricePerMeter * l.fxRateToThb;
            }, 0);

            const waText =
              `Здравствуйте! EVA MOON, заявка ${p.number}.\n` +
              purchaseLines
                .map((l) => {
                  const label = l.fabricName ?? l.draftName ?? "ткань";
                  const sku = l.fabricSku ? ` (${l.fabricSku})` : "";
                  return `• ${label}${sku} — ${formatMeters(l.metersOrdered ?? l.metersNeeded)}`;
                })
                .join("\n") +
              `\nПодтвердите, пожалуйста, наличие, цену за метр и срок поставки.`;

            return (
              <Card key={p.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="figure text-lg text-[var(--color-ocean)]">
                        {p.number}
                      </span>
                      <StatusPill tone={view.tone}>{view.label}</StatusPill>
                    </div>
                    <div className="mt-1 text-sm text-[var(--color-muted)]">
                      {p.reason ?? "причина не указана"}
                      {p.orderId ? (
                        <>
                          {" · заказ "}
                          <Link href={`/orders/${p.orderId}`}>{p.orderNumber}</Link>
                        </>
                      ) : null}
                    </div>
                    <div className="mt-1 text-xs text-[var(--color-muted)]">
                      Поставщик:{" "}
                      {p.supplierId ? (
                        <Link href={`/suppliers/${p.supplierId}/edit`}>
                          {p.supplierName}
                        </Link>
                      ) : (
                        "не выбран"
                      )}{" "}
                      · создана {formatDate(p.createdAt)}
                      {p.sentAt ? ` · отправлена ${formatDate(p.sentAt)}` : ""}
                      {p.receivedAt ? ` · получена ${formatDate(p.receivedAt)}` : ""}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
                      Всего
                    </div>
                    <div className="figure text-lg">{formatMeters(totalMeters)}</div>
                    {money && totalCostThb > 0 ? (
                      <div className="mt-1 text-sm text-[var(--color-muted)]">
                        <Money value={totalCostThb} />
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="mt-3">
                  {purchaseLines.length === 0 ? (
                    <p className="m-0 text-sm text-[var(--color-muted)]">
                      В заявке нет ни одной строки.
                    </p>
                  ) : (
                    <Table>
                      <thead>
                        <tr>
                          <Th>Ткань</Th>
                          <Th align="right">Нужно</Th>
                          <Th align="right">Заказано</Th>
                          {money ? <Th align="right">Сумма</Th> : null}
                          <Th>Примечание</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {purchaseLines.map((l, i) => {
                          const meters = l.metersOrdered ?? l.metersNeeded;
                          const lineTotalThb =
                            l.pricePerMeter != null && l.fxRateToThb != null
                              ? meters * l.pricePerMeter * l.fxRateToThb
                              : null;
                          return (
                            <tr key={`${l.purchaseId}-${l.fabricId ?? l.draftName ?? i}`}>
                              <Td>
                                {l.fabricId ? (
                                  <Link href={`/fabrics/${l.fabricId}`}>
                                    {l.fabricName}
                                  </Link>
                                ) : (
                                  <span>{l.draftName ?? "без названия"}</span>
                                )}
                                <div className="text-xs text-[var(--color-muted)]">
                                  {l.fabricId
                                    ? (l.fabricSku ?? "без SKU")
                                    : "черновик — ещё не в библиотеке"}
                                </div>
                              </Td>
                              <Td align="right">{formatMeters(l.metersNeeded)}</Td>
                              <Td align="right">
                                {l.metersOrdered == null
                                  ? "—"
                                  : formatMeters(l.metersOrdered)}
                              </Td>
                              {money ? (
                                <Td align="right">
                                  {lineTotalThb != null ? (
                                    <Money value={lineTotalThb} />
                                  ) : (
                                    "—"
                                  )}
                                </Td>
                              ) : null}
                              <Td>{l.note ?? "—"}</Td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </Table>
                  )}
                </div>

                {p.status === "DRAFT" || p.status === "SENT" ? (
                  <div className="mt-4 flex flex-col gap-3 border-t border-[var(--color-line)] pt-4">
                    <div className="flex flex-wrap items-center gap-3">
                      {p.status === "DRAFT" ? (
                        <form action={sendPurchase}>
                          <input type="hidden" name="purchaseId" value={p.id} />
                          <Button type="submit" variant="primary">
                            Отправить поставщику
                          </Button>
                        </form>
                      ) : null}

                      {p.supplierWhatsapp && purchaseLines.length > 0 ? (
                        <WhatsappLink phone={p.supplierWhatsapp} text={waText}>
                          Открыть WhatsApp с текстом заявки
                        </WhatsappLink>
                      ) : (
                        <span className="text-xs text-[var(--color-muted)]">
                          {purchaseLines.length === 0
                            ? "Нет строк — текст заявки собрать не из чего"
                            : "У поставщика не указан WhatsApp"}
                        </span>
                      )}

                      <form action={cancelPurchase}>
                        <input type="hidden" name="purchaseId" value={p.id} />
                        <Button type="submit" variant="danger">
                          Отменить
                        </Button>
                      </form>
                    </div>

                    {fabricWarehouses.length > 0 && purchaseLines.length > 0 ? (
                      <form
                        action={receivePurchase}
                        className="flex flex-wrap items-end gap-3"
                      >
                        <input type="hidden" name="purchaseId" value={p.id} />
                        <div className="min-w-[220px]">
                          <Field
                            label="Приход на склад"
                            hint="Метраж строк ляжет на этот склад тканей"
                          >
                            <Select
                              name="warehouseId"
                              defaultValue={fabricWarehouses[0].id}
                            >
                              {fabricWarehouses.map((w) => (
                                <option key={w.id} value={w.id}>
                                  {w.name}
                                </option>
                              ))}
                            </Select>
                          </Field>
                        </div>
                        <Button type="submit" variant="secondary">
                          Получено
                        </Button>
                      </form>
                    ) : null}
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
