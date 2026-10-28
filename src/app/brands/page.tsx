/**
 * «Бренды» — что хорошо продаётся и что закончилось / заканчивается у сторонних
 * брендов, чтобы сделать заказ поставщику. Данные: other_brand_* (остатки и
 * продажи по дням из Ainur). Открывать так: /brands?brand=Mockni
 */
import { eq, gte, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { Card, PageHeader, Stat, StatusPill, Table, Th, Td, EmptyState } from "@/components/ui";

export const metadata = { title: "Бренды — Luna Production" };
export const dynamic = "force-dynamic";

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export default async function BrandsPage({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string }>;
}) {
  const { brand: brandParam } = await searchParams;
  const brand = (brandParam ?? "Mockni").trim();

  const variants = await db
    .select()
    .from(schema.otherBrandVariants)
    .where(sql`lower(${schema.otherBrandVariants.brand}) = lower(${brand})`);
  const ids = variants.map((v) => v.id);

  const stockRows = ids.length
    ? await db
        .select({
          variantId: schema.otherBrandStock.variantId,
          qty: schema.otherBrandStock.quantity,
          warehouse: schema.warehouses.name,
        })
        .from(schema.otherBrandStock)
        .innerJoin(schema.warehouses, eq(schema.warehouses.id, schema.otherBrandStock.warehouseId))
        .where(inArray(schema.otherBrandStock.variantId, ids))
    : [];

  const d12 = daysAgo(365);
  const d90 = daysAgo(90);
  const salesRows = ids.length
    ? await db
        .select({
          variantId: schema.otherBrandSalesDaily.variantId,
          day: schema.otherBrandSalesDaily.day,
          units: schema.otherBrandSalesDaily.units,
        })
        .from(schema.otherBrandSalesDaily)
        .where(gte(schema.otherBrandSalesDaily.day, d12))
    : [];

  const idSet = new Set(ids);
  const sales12 = new Map<string, number>();
  const sales90 = new Map<string, number>();
  let firstSaleDay = "";
  for (const r of salesRows) {
    if (!idSet.has(r.variantId)) continue;
    if (!firstSaleDay || r.day < firstSaleDay) firstSaleDay = r.day;
    sales12.set(r.variantId, (sales12.get(r.variantId) ?? 0) + r.units);
    if (r.day >= d90) sales90.set(r.variantId, (sales90.get(r.variantId) ?? 0) + r.units);
  }
  const stock = new Map<string, { total: number; byWh: Map<string, number> }>();
  for (const r of stockRows) {
    const e = stock.get(r.variantId) ?? { total: 0, byWh: new Map() };
    e.total += r.qty;
    e.byWh.set(r.warehouse, (e.byWh.get(r.warehouse) ?? 0) + r.qty);
    stock.set(r.variantId, e);
  }

  const rows = variants
    .filter((v) => !v.isArchived)
    .map((v) => {
      const s = stock.get(v.id);
      const total = Math.max(0, s?.total ?? 0);
      const u12 = sales12.get(v.id) ?? 0;
      const u90 = sales90.get(v.id) ?? 0;
      const perMonth = u90 / 3;
      const cover = perMonth > 0 ? total / perMonth : null;
      let state: "out" | "low" | "ok" | "idle" = "ok";
      if (u12 === 0) state = "idle";
      else if (total <= 0) state = "out";
      else if (total <= 2 || (cover !== null && cover < 1.5)) state = "low";
      return { v, s, total, u12, u90, perMonth, cover, state };
    })
    .filter((r) => r.u12 > 0 || r.total > 0)
    .sort((a, b) => b.u12 - a.u12);

  const out = rows.filter((r) => r.state === "out");
  const low = rows.filter((r) => r.state === "low");
  const whCols = ["Phuket", "Phangan", "Fotesko Warehouse"];

  const tone = (s: string) => (s === "out" ? "critical" : s === "low" ? "warn" : "ok");
  const label = (s: string) =>
    s === "out" ? "закончилось" : s === "low" ? "заканчивается" : s === "idle" ? "нет продаж" : "в наличии";

  return (
    <>
      <PageHeader
        title={`Бренд: ${brand}`}
        subtitle={`Что хорошо продаётся и что закончилось или заканчивается — чтобы сделать заказ поставщику. Продажи в базе с ${firstSaleDay || "—"}`}
      />
      {variants.length === 0 ? (
        <EmptyState
          title="Бренд не найден"
          hint="Проверьте написание: /brands?brand=Mockni. Данные берутся из последней синхронизации с Ainur."
        />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Позиций с продажами за 12 мес" value={rows.filter((r) => r.u12 > 0).length} />
            <Stat label="Закончилось" value={out.length} sub="при живом спросе" />
            <Stat label="Заканчивается" value={low.length} sub="≤2 шт или меньше 1,5 мес" />
            <Stat label="Продано за 12 мес" value={`${rows.reduce((s, r) => s + r.u12, 0)} шт`} />
          </div>
          <Card padded={false}>
            <Table>
              <thead>
                <tr>
                  <Th>SKU</Th>
                  <Th>Модель</Th>
                  <Th>Цвет / размер</Th>
                  {whCols.map((w) => (
                    <Th key={w} align="right">{w === "Fotesko Warehouse" ? "Fotesko" : w}</Th>
                  ))}
                  <Th align="right">Всего</Th>
                  <Th align="right">90 дн</Th>
                  <Th align="right">12 мес</Th>
                  <Th align="right">Хватит, мес</Th>
                  <Th>Статус</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.v.id}>
                    <Td>{r.v.sku}</Td>
                    <Td className="font-medium">{r.v.modelName}</Td>
                    <Td>{[r.v.color, r.v.size].filter(Boolean).join(" · ")}</Td>
                    {whCols.map((w) => (
                      <Td key={w} align="right">{r.s?.byWh.get(w) ?? 0}</Td>
                    ))}
                    <Td align="right">{r.total}</Td>
                    <Td align="right">{r.u90}</Td>
                    <Td align="right">{r.u12}</Td>
                    <Td align="right">{r.cover === null ? "—" : r.cover.toFixed(1)}</Td>
                    <Td>
                      <StatusPill tone={tone(r.state)}>{label(r.state)}</StatusPill>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </>
      )}
    </>
  );
}
