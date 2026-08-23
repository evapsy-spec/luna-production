import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { and, asc, desc, eq, like } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { canSeeMoney, getCurrentUser, writeAudit } from "@/lib/auth";
import {
  fabricCostPerMeterThb,
  formatMeters,
  getFabricAvailability,
  round2,
} from "@/lib/production";
import {
  Button,
  Callout,
  Card,
  Field,
  formatDate,
  Input,
  LinkButton,
  Money,
  OrderStatusPill,
  PageHeader,
  SectionTitle,
  Select,
  StatusPill,
  Stat,
  Table,
  Td,
  Th,
  Thumb,
  WhatsappLink,
} from "@/components/ui";
import { parseNumber, parseText } from "../fabric-fields";

const LOW_STOCK_M = 10;

// ============================================================
// SERVER ACTIONS
// ============================================================

/** Одна точка входа для изменения остатка: либо прибавить, либо выставить ровно */
async function writeStock(
  fabricId: string,
  warehouseId: string,
  mode: "add" | "set",
  meters: number,
): Promise<{ from: number; to: number }> {
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
  const to = round2(mode === "add" ? from + meters : meters);

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

  return { from: round2(from), to };
}

async function fabricLabel(fabricId: string): Promise<string> {
  const rows = await db
    .select({ name: schema.fabrics.name, sku: schema.fabrics.sku })
    .from(schema.fabrics)
    .where(eq(schema.fabrics.id, fabricId))
    .limit(1);
  return rows[0] ? `${rows[0].name} (${rows[0].sku})` : fabricId;
}

async function warehouseName(warehouseId: string): Promise<string> {
  const rows = await db
    .select({ name: schema.warehouses.name })
    .from(schema.warehouses)
    .where(eq(schema.warehouses.id, warehouseId))
    .limit(1);
  return rows[0]?.name ?? "склад";
}

async function receiveFabric(formData: FormData) {
  "use server";
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const fabricId = String(formData.get("fabricId") ?? "");
  const warehouseId = String(formData.get("warehouseId") ?? "");
  const meters = parseNumber(formData.get("meters"));
  if (!fabricId || !warehouseId || meters == null || meters <= 0) {
    redirect(`/fabrics/${fabricId}?error=meters`);
  }

  const change = await writeStock(fabricId, warehouseId, "add", meters);
  const note = parseText(formData.get("note"));
  const where = await warehouseName(warehouseId);

  await writeAudit(user, {
    action: "UPDATE",
    entityType: "fabric_stock",
    entityId: fabricId,
    entityName: `Приход ${formatMeters(meters)} · ${await fabricLabel(fabricId)} · ${where}`,
    changes: {
      [`остаток · ${where}`]: change,
      ...(note ? { примечание: { from: null, to: note } } : {}),
    },
  });

  revalidatePath(`/fabrics/${fabricId}`);
  revalidatePath("/fabrics");
  redirect(`/fabrics/${fabricId}?ok=receive`);
}

async function adjustStock(formData: FormData) {
  "use server";
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const fabricId = String(formData.get("fabricId") ?? "");
  const warehouseId = String(formData.get("warehouseId") ?? "");
  const meters = parseNumber(formData.get("meters"));
  if (!fabricId || !warehouseId || meters == null || meters < 0) {
    redirect(`/fabrics/${fabricId}?error=meters`);
  }

  const change = await writeStock(fabricId, warehouseId, "set", meters);
  const reason = parseText(formData.get("reason"));
  const where = await warehouseName(warehouseId);

  await writeAudit(user, {
    action: "UPDATE",
    entityType: "fabric_stock",
    entityId: fabricId,
    entityName: `Корректировка остатка · ${await fabricLabel(fabricId)} · ${where}`,
    changes: {
      [`остаток · ${where}`]: change,
      ...(reason ? { причина: { from: null, to: reason } } : {}),
    },
  });

  revalidatePath(`/fabrics/${fabricId}`);
  revalidatePath("/fabrics");
  redirect(`/fabrics/${fabricId}?ok=adjust`);
}

async function addLot(formData: FormData) {
  "use server";
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const fabricId = String(formData.get("fabricId") ?? "");
  const warehouseId = String(formData.get("warehouseId") ?? "");
  const lengthM = parseNumber(formData.get("lengthM"));
  if (!fabricId || !warehouseId || lengthM == null || lengthM <= 0) {
    redirect(`/fabrics/${fabricId}?error=lot`);
  }

  const fabricRows = await db
    .select({ sku: schema.fabrics.sku, name: schema.fabrics.name })
    .from(schema.fabrics)
    .where(eq(schema.fabrics.id, fabricId))
    .limit(1);
  const fabric = fabricRows[0];
  if (!fabric) redirect("/fabrics");

  // Номер рулона продолжаем от максимального уже занятого — так код не
  // повторится, даже если старые рулоны удалили из базы.
  const prefix = `LOT-${fabric.sku}-`;
  const taken = await db
    .select({ lotCode: schema.fabricLots.lotCode })
    .from(schema.fabricLots)
    .where(like(schema.fabricLots.lotCode, `${prefix}%`));
  const maxSeq = taken.reduce(
    (max, r) => Math.max(max, Number(r.lotCode.slice(prefix.length)) || 0),
    0,
  );
  const lotCode = `${prefix}${String(maxSeq + 1).padStart(4, "0")}`;

  const [lot] = await db
    .insert(schema.fabricLots)
    .values({
      fabricId,
      warehouseId,
      lotCode,
      lengthM,
      remainingM: lengthM,
      note: parseText(formData.get("note")),
    })
    .returning();

  // Рулон — это физический приход, поэтому метраж сразу ложится на склад:
  // иначе пришлось бы дублировать ту же поставку ещё и приходом.
  const change = await writeStock(fabricId, warehouseId, "add", lengthM);

  await writeAudit(user, {
    action: "CREATE",
    entityType: "fabric_lot",
    entityId: lot.id,
    entityName: `${lotCode} · ${fabric.name} · ${formatMeters(lengthM)}`,
    changes: {
      [`остаток · ${await warehouseName(warehouseId)}`]: change,
    },
  });

  revalidatePath(`/fabrics/${fabricId}`);
  revalidatePath("/fabrics");
  redirect(`/fabrics/${fabricId}?ok=lot`);
}

// ============================================================
// СТРАНИЦА
// ============================================================

export default async function FabricPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const flags = await searchParams;

  const fabricRows = await db
    .select({
      fabric: schema.fabrics,
      supplierId: schema.suppliers.id,
      supplierName: schema.suppliers.name,
      supplierWhatsapp: schema.suppliers.whatsapp,
      supplierContact: schema.suppliers.contact,
    })
    .from(schema.fabrics)
    .leftJoin(schema.suppliers, eq(schema.fabrics.supplierId, schema.suppliers.id))
    .where(eq(schema.fabrics.id, id))
    .limit(1);

  const row = fabricRows[0];
  if (!row) notFound();
  const fabric = row.fabric;

  const [stockRows, reservations, lots, bomRows, fabricWarehouses] =
    await Promise.all([
      db
        .select({
          warehouseId: schema.warehouses.id,
          warehouseName: schema.warehouses.name,
          onHandM: schema.fabricStock.onHandM,
          updatedAt: schema.fabricStock.updatedAt,
        })
        .from(schema.fabricStock)
        .innerJoin(
          schema.warehouses,
          eq(schema.fabricStock.warehouseId, schema.warehouses.id),
        )
        .where(eq(schema.fabricStock.fabricId, id))
        .orderBy(asc(schema.warehouses.name)),

      db
        .select({
          id: schema.fabricReservations.id,
          meters: schema.fabricReservations.meters,
          createdAt: schema.fabricReservations.createdAt,
          orderId: schema.productionOrders.id,
          orderNumber: schema.productionOrders.number,
          orderStatus: schema.productionOrders.status,
        })
        .from(schema.fabricReservations)
        .innerJoin(
          schema.productionOrders,
          eq(schema.fabricReservations.orderId, schema.productionOrders.id),
        )
        .where(
          and(
            eq(schema.fabricReservations.fabricId, id),
            eq(schema.fabricReservations.released, false),
          ),
        )
        .orderBy(desc(schema.fabricReservations.createdAt)),

      db
        .select({
          id: schema.fabricLots.id,
          lotCode: schema.fabricLots.lotCode,
          lengthM: schema.fabricLots.lengthM,
          remainingM: schema.fabricLots.remainingM,
          arrivedAt: schema.fabricLots.arrivedAt,
          note: schema.fabricLots.note,
          warehouseName: schema.warehouses.name,
        })
        .from(schema.fabricLots)
        .innerJoin(
          schema.warehouses,
          eq(schema.fabricLots.warehouseId, schema.warehouses.id),
        )
        .where(eq(schema.fabricLots.fabricId, id))
        .orderBy(desc(schema.fabricLots.arrivedAt)),

      db
        .select({
          productId: schema.products.id,
          productName: schema.products.name,
          collectionName: schema.collections.name,
          metersPerUnit: schema.bomFabricLines.metersPerUnit,
          wastePct: schema.bomFabricLines.wastePct,
        })
        .from(schema.bomFabricLines)
        .innerJoin(
          schema.products,
          eq(schema.bomFabricLines.productId, schema.products.id),
        )
        .innerJoin(
          schema.collections,
          eq(schema.products.collectionId, schema.collections.id),
        )
        .where(eq(schema.bomFabricLines.fabricId, id))
        .orderBy(asc(schema.products.name)),

      db
        .select({ id: schema.warehouses.id, name: schema.warehouses.name })
        .from(schema.warehouses)
        .where(
          and(
            eq(schema.warehouses.kind, "FABRIC"),
            eq(schema.warehouses.isActive, true),
          ),
        )
        .orderBy(asc(schema.warehouses.name)),
    ]);

  const availability = await getFabricAvailability([id]);
  const a = availability.get(id) ?? { onHand: 0, reserved: 0 };
  const onHand = round2(a.onHand);
  const reserved = round2(a.reserved);
  const available = round2(onHand - reserved);
  const costPerMeter = fabricCostPerMeterThb(fabric);
  const money = canSeeMoney(user);

  const waText =
    `Здравствуйте! EVA MOON.\n` +
    `Нужна ткань: ${fabric.name} (${fabric.sku})` +
    (fabric.color ? `, цвет ${fabric.color}` : "") +
    (fabric.widthCm ? `, ширина ${fabric.widthCm} см` : "") +
    `.\nПодскажите, пожалуйста, наличие, цену за метр и срок поставки.`;

  return (
    <>
      <PageHeader
        title={fabric.name}
        subtitle={`${fabric.sku}${fabric.color ? ` · ${fabric.color}` : ""}${
          fabric.composition ? ` · ${fabric.composition}` : ""
        }`}
        action={
          <div className="flex flex-wrap gap-2">
            <LinkButton href={`/fabrics/${id}/qr`}>Печать QR</LinkButton>
            <LinkButton href={`/fabrics/${id}/edit`} variant="primary">
              Редактировать
            </LinkButton>
          </div>
        }
      />

      {flags.ok === "receive" ? (
        <Callout tone="ok" title="Приход проведён">
          Метраж добавлен на склад.
        </Callout>
      ) : null}
      {flags.ok === "adjust" ? (
        <Callout tone="ok" title="Остаток скорректирован">
          Новое значение сохранено, запись ушла в историю изменений.
        </Callout>
      ) : null}
      {flags.ok === "lot" ? (
        <Callout tone="ok" title="Рулон добавлен">
          Код рулона сгенерирован, метраж проведён на склад. Метку можно
          распечатать кнопкой «Печать QR».
        </Callout>
      ) : null}
      {flags.error === "meters" ? (
        <Callout tone="critical" title="Не сохранено">
          Укажите склад и метраж числом больше нуля.
        </Callout>
      ) : null}
      {flags.error === "lot" ? (
        <Callout tone="critical" title="Рулон не добавлен">
          Нужны склад и длина рулона больше нуля.
        </Callout>
      ) : null}

      {available < 0 ? (
        <Callout tone="critical" title="Перерезервировано">
          Под заказы держат {formatMeters(reserved)}, а физически на складах
          только {formatMeters(onHand)}. Проверьте резервы или проведите приход.
        </Callout>
      ) : available < LOW_STOCK_M ? (
        <Callout tone="warn" title="Ткани мало">
          Доступно {formatMeters(available)} — меньше {LOW_STOCK_M} м. Стоит
          создать заявку на дозакупку.
        </Callout>
      ) : null}

      <div className="grid gap-4 md:grid-cols-[auto_1fr]">
        <Card>
          <Thumb src={fabric.photoUrl} alt={fabric.name} size={160} />
          <div className="mt-3 flex flex-wrap gap-1.5">
            <StatusPill tone={fabric.isDyed ? "warn" : "neutral"}>
              {fabric.isDyed ? "Красим сами" : "Не красим"}
            </StatusPill>
            {fabric.isOnOrder ? (
              <StatusPill tone="warn">Заказано, ожидаем</StatusPill>
            ) : null}
          </div>
        </Card>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="На складах" value={formatMeters(onHand)} />
          <Stat
            label="В резерве"
            value={formatMeters(reserved)}
            sub={`${reservations.length} активных заказов`}
          />
          <Stat
            label="Доступно"
            value={formatMeters(available)}
            sub={available < LOW_STOCK_M ? "нужно докупить" : "хватает"}
          />
          <Stat
            label="Цена за метр"
            value={<Money value={costPerMeter} hidden={!money} />}
            sub={
              money
                ? `${fabric.purchasePrice ?? 0} ${fabric.purchaseCurrency} × ${fabric.fxRateToThb} · ${formatDate(fabric.priceDate)}`
                : "суммы видны владельцам"
            }
          />
        </div>
      </div>

      <Card className="mt-4">
        <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
              Поставщик
            </div>
            <div>
              {row.supplierId ? (
                <Link href={`/suppliers/${row.supplierId}/edit`}>
                  {row.supplierName}
                </Link>
              ) : (
                "не указан"
              )}
            </div>
            {row.supplierWhatsapp ? (
              <div className="mt-1">
                <WhatsappLink phone={row.supplierWhatsapp} text={waText}>
                  Написать в WhatsApp
                </WhatsappLink>
              </div>
            ) : null}
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
              Рулон / ширина
            </div>
            <div>
              {fabric.rollLengthM ? formatMeters(fabric.rollLengthM) : "—"}
              {fabric.widthCm ? ` · ${fabric.widthCm} см` : ""}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
              Стоимость запаса
            </div>
            <div>
              <Money value={Math.max(0, onHand) * costPerMeter} hidden={!money} />
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
              Примечание
            </div>
            <div>{fabric.note ?? "—"}</div>
          </div>
        </div>
      </Card>

      <SectionTitle>Остатки по складам</SectionTitle>
      {stockRows.length === 0 ? (
        <Card>
          <p className="m-0 text-sm text-[var(--color-muted)]">
            Остатков нет ни на одном складе тканей. Проведите приход ниже.
          </p>
        </Card>
      ) : (
        <Card padded={false}>
          <Table>
            <thead>
              <tr>
                <Th>Склад</Th>
                <Th align="right">Метров</Th>
                <Th align="right">Стоимость</Th>
                <Th>Обновлено</Th>
              </tr>
            </thead>
            <tbody>
              {stockRows.map((s) => (
                <tr key={s.warehouseId}>
                  <Td>{s.warehouseName}</Td>
                  <Td align="right">{formatMeters(s.onHandM)}</Td>
                  <Td align="right">
                    <Money
                      value={Math.max(0, s.onHandM) * costPerMeter}
                      hidden={!money}
                    />
                  </Td>
                  <Td>{formatDate(s.updatedAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <SectionTitle>Резервы под заказы</SectionTitle>
      {reservations.length === 0 ? (
        <Card>
          <p className="m-0 text-sm text-[var(--color-muted)]">
            Ткань никем не занята — весь остаток доступен.
          </p>
        </Card>
      ) : (
        <Card padded={false}>
          <Table>
            <thead>
              <tr>
                <Th>Заказ</Th>
                <Th>Статус заказа</Th>
                <Th align="right">Метров держит</Th>
                <Th>Создан</Th>
              </tr>
            </thead>
            <tbody>
              {reservations.map((r) => (
                <tr key={r.id}>
                  <Td>
                    <Link href={`/orders/${r.orderId}`}>{r.orderNumber}</Link>
                  </Td>
                  <Td>
                    <OrderStatusPill status={r.orderStatus} />
                  </Td>
                  <Td align="right">{formatMeters(r.meters)}</Td>
                  <Td>{formatDate(r.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <SectionTitle>Рулоны</SectionTitle>
      {lots.length === 0 ? (
        <Card>
          <p className="m-0 text-sm text-[var(--color-muted)]">
            Рулоны с QR-метками пока не заведены.
          </p>
        </Card>
      ) : (
        <Card padded={false}>
          <Table>
            <thead>
              <tr>
                <Th>Код рулона</Th>
                <Th>Склад</Th>
                <Th align="right">Было</Th>
                <Th align="right">Осталось</Th>
                <Th>Пришёл</Th>
                <Th>Примечание</Th>
              </tr>
            </thead>
            <tbody>
              {lots.map((l) => (
                <tr key={l.id}>
                  <Td>{l.lotCode}</Td>
                  <Td>{l.warehouseName}</Td>
                  <Td align="right">{formatMeters(l.lengthM)}</Td>
                  <Td align="right">
                    {formatMeters(l.remainingM)}
                    {l.remainingM <= 0 ? (
                      <div>
                        <StatusPill tone="neutral">Израсходован</StatusPill>
                      </div>
                    ) : null}
                  </Td>
                  <Td>{formatDate(l.arrivedAt)}</Td>
                  <Td>{l.note ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <SectionTitle>Где используется</SectionTitle>
      {bomRows.length === 0 ? (
        <Card>
          <p className="m-0 text-sm text-[var(--color-muted)]">
            Ткань не привязана ни к одному изделию — добавьте её в состав
            изделия (BOM), чтобы расход считался автоматически.
          </p>
        </Card>
      ) : (
        <Card padded={false}>
          <Table>
            <thead>
              <tr>
                <Th>Изделие</Th>
                <Th>Коллекция</Th>
                <Th align="right">Расход, м/шт</Th>
                <Th align="right">Припуск</Th>
                <Th align="right">Итого с припуском</Th>
              </tr>
            </thead>
            <tbody>
              {bomRows.map((b) => (
                <tr key={b.productId}>
                  <Td>
                    <Link href={`/products/${b.productId}`}>{b.productName}</Link>
                  </Td>
                  <Td>{b.collectionName}</Td>
                  <Td align="right">{b.metersPerUnit}</Td>
                  <Td align="right">{b.wastePct}%</Td>
                  <Td align="right">
                    {round2(b.metersPerUnit * (1 + (b.wastePct || 0) / 100))}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <SectionTitle>Движение ткани</SectionTitle>
      {fabricWarehouses.length === 0 ? (
        <Card>
          <p className="m-0 text-sm text-[var(--color-muted)]">
            Нет активных складов тканей — приход провести некуда.
          </p>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <h3 className="m-0 mb-3 text-base">Приход ткани</h3>
            <form action={receiveFabric} className="flex flex-col gap-3">
              <input type="hidden" name="fabricId" value={id} />
              <Field label="Склад" required>
                <Select name="warehouseId" required defaultValue={fabricWarehouses[0].id}>
                  {fabricWarehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Метров пришло" required>
                <Input name="meters" type="number" step="0.01" min="0.01" required />
              </Field>
              <Field label="Примечание">
                <Input name="note" placeholder="Поставка от 12.08" />
              </Field>
              <Button type="submit" variant="primary">
                Провести приход
              </Button>
            </form>
          </Card>

          <Card>
            <h3 className="m-0 mb-3 text-base">Корректировка остатка</h3>
            <form action={adjustStock} className="flex flex-col gap-3">
              <input type="hidden" name="fabricId" value={id} />
              <Field label="Склад" required>
                <Select name="warehouseId" required defaultValue={fabricWarehouses[0].id}>
                  {fabricWarehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Стало метров"
                required
                hint="Значение после пересчёта на складе — заменит текущее"
              >
                <Input name="meters" type="number" step="0.01" min="0" required />
              </Field>
              <Field label="Причина">
                <Input name="reason" placeholder="Инвентаризация" />
              </Field>
              <Button type="submit" variant="secondary">
                Сохранить остаток
              </Button>
            </form>
          </Card>

          <Card>
            <h3 className="m-0 mb-3 text-base">Новый рулон</h3>
            <form action={addLot} className="flex flex-col gap-3">
              <input type="hidden" name="fabricId" value={id} />
              <Field label="Склад" required>
                <Select name="warehouseId" required defaultValue={fabricWarehouses[0].id}>
                  {fabricWarehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Длина рулона, м"
                required
                hint="Код рулона присвоится сам, метраж сразу встанет на склад"
              >
                <Input
                  name="lengthM"
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  defaultValue={fabric.rollLengthM ?? undefined}
                />
              </Field>
              <Field label="Примечание">
                <Input name="note" placeholder="Партия окрашена ровно" />
              </Field>
              <Button type="submit" variant="secondary">
                Добавить рулон
              </Button>
            </form>
          </Card>
        </div>
      )}
    </>
  );
}
