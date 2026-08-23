import { sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { getCurrentUser, canSeeMoney } from "@/lib/auth";
import {
  Card,
  PageHeader,
  LinkButton,
  Callout,
  Table,
  Th,
  Td,
} from "@/components/ui";

export const metadata = { title: "Экспорт в Excel — Luna Production" };

export default async function ExportPage() {
  const user = await getCurrentUser();
  const showMoney = canSeeMoney(user);

  const counts = await db
    .select({
      fabrics: sql<number>`(SELECT COUNT(*) FROM ${schema.fabrics})`,
      variants: sql<number>`(SELECT COUNT(*) FROM ${schema.productVariants})`,
      products: sql<number>`(SELECT COUNT(*) FROM ${schema.products})`,
      collections: sql<number>`(SELECT COUNT(*) FROM ${schema.collections})`,
      orders: sql<number>`(SELECT COUNT(*) FROM ${schema.productionOrders})`,
      orderLines: sql<number>`(SELECT COUNT(*) FROM ${schema.productionOrderLines})`,
      factories: sql<number>`(SELECT COUNT(*) FROM ${schema.factories})`,
      stock: sql<number>`(SELECT COUNT(*) FROM ${schema.variantStock})`,
      sales: sql<number>`(SELECT COUNT(*) FROM ${schema.variantSalesDaily})`,
      bom: sql<number>`(SELECT COUNT(*) FROM ${schema.bomFabricLines})`,
    })
    .from(schema.settings)
    .limit(1);

  const c = counts[0] ?? {
    fabrics: 0,
    variants: 0,
    products: 0,
    collections: 0,
    orders: 0,
    orderLines: 0,
    factories: 0,
    stock: 0,
    sales: 0,
    bom: 0,
  };

  const sheets: { name: string; rows: number; note: string }[] = [
    { name: "Ткани", rows: Number(c.fabrics), note: "с остатками, резервом и ценой закупки" },
    {
      name: "Изделия и SKU",
      rows: Number(c.variants),
      note: "остаток и продажи за 90 дней по каждому SKU",
    },
    { name: "Состав изделий", rows: Number(c.bom), note: "BOM: расход ткани на 1 шт" },
    { name: "Заказы", rows: Number(c.orders), note: "статусы, сроки, себестоимость, оплаты" },
    { name: "Позиции заказов", rows: Number(c.orderLines), note: "построчно, с браком" },
    { name: "Фабрики", rows: Number(c.factories), note: "контакты и мощность" },
    { name: "Остатки по складам", rows: Number(c.stock), note: "в разбивке по складам" },
    { name: "Продажи по дням", rows: Number(c.sales), note: "из Ainur" },
    { name: "О выгрузке", rows: 1, note: "пояснения к цифрам и методике" },
  ];

  return (
    <>
      <PageHeader
        title="Экспорт в Excel"
        subtitle="Вся база одним файлом — для бэкапа или передачи бухгалтеру"
      />

      <Card className="mb-4">
        <p className="mt-0 text-sm text-[var(--color-muted)]">
          Файл собирается на момент нажатия кнопки: {sheets.length} листов,
          каждый с фильтрами и закреплённой первой строкой.
        </p>
        <LinkButton href="/api/export" variant="primary">
          ⤓ Скачать выгрузку .xlsx
        </LinkButton>
      </Card>

      {!showMoney ? (
        <Callout tone="warn" title="Финансы в вашей выгрузке будут скрыты">
          Себестоимость, цены закупки и оплаты фабрикам доступны только
          владельцам. Если выгрузка нужна с деньгами — попросите Еву или
          Константина.
        </Callout>
      ) : null}

      <Card padded={false}>
        <Table>
          <thead>
            <tr>
              <Th>Лист</Th>
              <Th align="right">Строк</Th>
              <Th>Что внутри</Th>
            </tr>
          </thead>
          <tbody>
            {sheets.map((s) => (
              <tr key={s.name}>
                <Td>
                  <span className="font-medium">{s.name}</span>
                </Td>
                <Td align="right">{s.rows}</Td>
                <Td>
                  <span className="text-[var(--color-muted)]">{s.note}</span>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
