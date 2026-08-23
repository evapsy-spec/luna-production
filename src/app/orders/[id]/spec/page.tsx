import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema } from "@/lib/db/client";
import { getCurrentUser, canSeeMoney } from "@/lib/auth";
import { formatMeters } from "@/lib/production";
import { formatDate } from "@/components/ui";
import { PrintBar } from "./print-bar";

/**
 * Спецификация заказа для передачи на фабрику.
 *
 * Печатается в PDF стандартным диалогом браузера («Печать» → «Сохранить как
 * PDF»), после чего файл отправляется фабрике в WhatsApp. Такой путь выбран
 * вместо серверной генерации PDF намеренно: он одинаково работает с телефона,
 * планшета и компьютера и не требует шрифтовых пакетов для кириллицы.
 */
export default async function OrderSpecPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  const showMoney = canSeeMoney(user);
  const { id } = await params;

  const rows = await db
    .select({ order: schema.productionOrders, factory: schema.factories })
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
      meters: schema.fabricReservations.meters,
      fabricName: schema.fabrics.name,
      fabricSku: schema.fabrics.sku,
      color: schema.fabrics.color,
    })
    .from(schema.fabricReservations)
    .innerJoin(
      schema.fabrics,
      eq(schema.fabricReservations.fabricId, schema.fabrics.id),
    )
    .where(eq(schema.fabricReservations.orderId, id));

  const totalUnits = lines.reduce((s, l) => s + l.line.quantity, 0);

  // Группируем по изделию: фабрике удобнее видеть модель, а внутри — размеры
  const byProduct = new Map<
    string,
    { name: string; collection: string; rows: typeof lines }
  >();
  for (const l of lines) {
    const key = `${l.productName}|${l.color ?? ""}`;
    const entry = byProduct.get(key);
    if (entry) entry.rows.push(l);
    else
      byProduct.set(key, {
        name: l.color ? `${l.productName} — ${l.color}` : l.productName,
        collection: l.collectionName,
        rows: [l],
      });
  }

  return (
    <div className="mx-auto max-w-[820px] bg-white px-6 py-8 text-[#0E2A2E]">
      <PrintBar orderNumber={order.number} whatsapp={factory.whatsapp} />

      {/* Шапка документа */}
      <div
        className="mb-6 flex items-start justify-between gap-6 border-b-2 pb-4"
        style={{ borderColor: "#E9924A" }}
      >
        <div>
          <div
            className="text-2xl leading-none"
            style={{ fontFamily: "var(--font-display)", color: "#02333A", fontWeight: 700 }}
          >
            EVA MOON
          </div>
          <div className="mt-1 text-[11px] uppercase tracking-[0.18em] text-[#5C7278]">
            Производственная спецификация
          </div>
        </div>
        <div className="text-right">
          <div
            className="text-xl"
            style={{ fontFamily: "var(--font-display)", color: "#02333A", fontWeight: 700 }}
          >
            {order.number}
          </div>
          <div className="mt-1 text-xs text-[#5C7278]">
            от {formatDate(order.createdAt)}
          </div>
        </div>
      </div>

      {/* Реквизиты */}
      <div className="mb-6 grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-[#5C7278]">
            Фабрика
          </div>
          <div className="font-semibold">{factory.name}</div>
          {factory.contact ? <div>{factory.contact}</div> : null}
          {factory.address ? (
            <div className="text-xs text-[#5C7278]">{factory.address}</div>
          ) : null}
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-[#5C7278]">
            Плановая дата готовности
          </div>
          <div className="font-semibold">{formatDate(order.plannedReadyAt)}</div>
          <div className="mt-2 text-[11px] uppercase tracking-wide text-[#5C7278]">
            Всего в заказе
          </div>
          <div className="font-semibold">{totalUnits} шт</div>
        </div>
      </div>

      {/* Позиции */}
      <table className="mb-6 w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="border-b border-[#E4DED0] bg-[#FBF8F1] px-2 py-2 text-left text-[11px] uppercase tracking-wide text-[#5C7278]">
              Модель / цвет
            </th>
            <th className="border-b border-[#E4DED0] bg-[#FBF8F1] px-2 py-2 text-left text-[11px] uppercase tracking-wide text-[#5C7278]">
              SKU
            </th>
            <th className="border-b border-[#E4DED0] bg-[#FBF8F1] px-2 py-2 text-left text-[11px] uppercase tracking-wide text-[#5C7278]">
              Размер
            </th>
            <th className="border-b border-[#E4DED0] bg-[#FBF8F1] px-2 py-2 text-right text-[11px] uppercase tracking-wide text-[#5C7278]">
              Кол-во
            </th>
            {showMoney ? (
              <th className="border-b border-[#E4DED0] bg-[#FBF8F1] px-2 py-2 text-right text-[11px] uppercase tracking-wide text-[#5C7278]">
                Цена пошива
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {[...byProduct.values()].map((group, gi) => (
            <>
              {group.rows.map((l, i) => (
                <tr key={l.line.id}>
                  <td className="border-b border-[#F0EBE0] px-2 py-2">
                    {i === 0 ? (
                      <>
                        <div className="font-medium">{group.name}</div>
                        <div className="text-xs text-[#5C7278]">
                          {group.collection}
                        </div>
                      </>
                    ) : null}
                  </td>
                  <td className="border-b border-[#F0EBE0] px-2 py-2 text-xs">
                    {l.sku ?? "—"}
                  </td>
                  <td className="border-b border-[#F0EBE0] px-2 py-2">
                    {l.line.size ?? "—"}
                  </td>
                  <td
                    className="border-b border-[#F0EBE0] px-2 py-2 text-right font-semibold"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {l.line.quantity}
                  </td>
                  {showMoney ? (
                    <td
                      className="border-b border-[#F0EBE0] px-2 py-2 text-right"
                      style={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      {Math.round(l.line.unitSewingCost)} THB
                    </td>
                  ) : null}
                </tr>
              ))}
            </>
          ))}
          <tr>
            <td className="px-2 py-2.5 font-semibold" colSpan={3}>
              Итого
            </td>
            <td
              className="px-2 py-2.5 text-right font-semibold"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {totalUnits} шт
            </td>
            {showMoney ? (
              <td
                className="px-2 py-2.5 text-right font-semibold"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {Math.round(order.snapshotSewingCost)} THB
              </td>
            ) : null}
          </tr>
        </tbody>
      </table>

      {/* Ткань — фабрике важно знать, сколько метража на партию */}
      {reservations.length > 0 ? (
        <div className="mb-6">
          <div
            className="mb-2 text-sm font-semibold"
            style={{ color: "#02333A" }}
          >
            Ткань на партию
          </div>
          <table className="w-full border-collapse text-sm">
            <tbody>
              {reservations.map((r, i) => (
                <tr key={i}>
                  <td className="border-b border-[#F0EBE0] px-2 py-1.5">
                    {r.fabricName}
                    {r.color ? ` (${r.color})` : ""}
                  </td>
                  <td className="border-b border-[#F0EBE0] px-2 py-1.5 text-xs text-[#5C7278]">
                    {r.fabricSku}
                  </td>
                  <td
                    className="border-b border-[#F0EBE0] px-2 py-1.5 text-right font-semibold"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {formatMeters(r.meters)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {order.note ? (
        <div className="mb-6 rounded-lg bg-[#FBF8F1] px-4 py-3 text-sm">
          <div className="mb-1 text-[11px] uppercase tracking-wide text-[#5C7278]">
            Примечание
          </div>
          {order.note}
        </div>
      ) : null}

      {/* Подписи */}
      <div className="mt-10 grid grid-cols-2 gap-8 text-xs text-[#5C7278]">
        <div>
          <div className="mb-8">Передал (EVA MOON):</div>
          <div className="border-t border-[#C3C2B7] pt-1">подпись, дата</div>
        </div>
        <div>
          <div className="mb-8">Принял ({factory.name}):</div>
          <div className="border-t border-[#C3C2B7] pt-1">подпись, дата</div>
        </div>
      </div>
    </div>
  );
}
