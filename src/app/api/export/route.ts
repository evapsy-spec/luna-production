import { eq, sql } from "drizzle-orm";
import ExcelJS from "exceljs";
import { db, schema } from "@/lib/db/client";
import { getCurrentUser, canSeeMoney, writeAudit } from "@/lib/auth";
import { fabricCostPerMeterThb } from "@/lib/production";

/**
 * Выгрузка всей базы в один файл Excel — для бэкапа и для передачи
 * бухгалтеру или партнёру вне приложения.
 *
 * Денежные листы отдаются только владельцам: у менеджера производства
 * финансов быть не должно, в том числе в выгрузке.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return new Response("Требуется вход", { status: 401 });
  }
  const showMoney = canSeeMoney(user);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Luna Production · EVA MOON";
  wb.created = new Date();

  const HEADER_FILL = "FF02333A";
  const ACCENT = "FFE9924A";

  function addSheet(
    name: string,
    columns: { header: string; key: string; width: number }[],
    rows: Record<string, unknown>[],
  ) {
    const ws = wb.addWorksheet(name, {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    ws.columns = columns;

    const header = ws.getRow(1);
    header.font = { name: "Arial", bold: true, size: 10, color: { argb: "FFFFFAF2" } };
    header.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: HEADER_FILL },
    };
    header.alignment = { vertical: "middle", wrapText: true };
    header.height = 26;

    for (const row of rows) ws.addRow(row);

    ws.eachRow((row, i) => {
      if (i === 1) return;
      row.font = { name: "Arial", size: 10 };
    });
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: columns.length },
    };
    return ws;
  }

  // ---------- Ткани ----------
  const fabrics = await db
    .select({
      f: schema.fabrics,
      supplierName: schema.suppliers.name,
      onHand: sql<number>`(
        SELECT COALESCE(SUM(${schema.fabricStock.onHandM}), 0)
        FROM ${schema.fabricStock}
        WHERE ${schema.fabricStock.fabricId} = ${schema.fabrics.id}
      )`,
      reserved: sql<number>`(
        SELECT COALESCE(SUM(${schema.fabricStock.reservedM}), 0)
        FROM ${schema.fabricStock}
        WHERE ${schema.fabricStock.fabricId} = ${schema.fabrics.id}
      )`,
    })
    .from(schema.fabrics)
    .leftJoin(
      schema.suppliers,
      eq(schema.fabrics.supplierId, schema.suppliers.id),
    );

  addSheet(
    "Ткани",
    [
      { header: "SKU", key: "sku", width: 18 },
      { header: "Название", key: "name", width: 28 },
      { header: "Состав", key: "composition", width: 20 },
      { header: "Цвет", key: "color", width: 18 },
      { header: "Красим", key: "dyed", width: 10 },
      { header: "Рулон, м", key: "roll", width: 11 },
      { header: "Ширина, см", key: "width", width: 12 },
      { header: "На складе, м", key: "onHand", width: 13 },
      { header: "Резерв, м", key: "reserved", width: 12 },
      { header: "Доступно, м", key: "available", width: 13 },
      ...(showMoney
        ? [
            { header: "Цена закупки", key: "price", width: 14 },
            { header: "Валюта", key: "currency", width: 10 },
            { header: "Курс к THB", key: "fx", width: 12 },
            { header: "Цена за метр, THB", key: "thb", width: 18 },
          ]
        : []),
      { header: "Поставщик", key: "supplier", width: 24 },
      { header: "Ожидается", key: "onOrder", width: 12 },
    ],
    fabrics.map(({ f, supplierName, onHand, reserved }) => ({
      sku: f.sku,
      name: f.name,
      composition: f.composition ?? "",
      color: f.color ?? "",
      dyed: f.isDyed ? "да" : "нет",
      roll: f.rollLengthM ?? "",
      width: f.widthCm ?? "",
      onHand: Number(onHand),
      reserved: Number(reserved),
      available: Number(onHand) - Number(reserved),
      ...(showMoney
        ? {
            price: f.purchasePrice ?? "",
            currency: f.purchaseCurrency,
            fx: f.fxRateToThb,
            thb: Math.round(fabricCostPerMeterThb(f) * 100) / 100,
          }
        : {}),
      supplier: supplierName ?? "",
      onOrder: f.isOnOrder ? "заказано" : "",
    })),
  );

  // ---------- Изделия и варианты ----------
  const variants = await db
    .select({
      sku: schema.productVariants.sku,
      color: schema.productVariants.color,
      size: schema.productVariants.size,
      price: schema.productVariants.price,
      productName: schema.products.name,
      collectionName: schema.collections.name,
      sewing: schema.products.defaultSewingCost,
      stock: sql<number>`(
        SELECT COALESCE(SUM(${schema.variantStock.quantity}), 0)
        FROM ${schema.variantStock}
        WHERE ${schema.variantStock.variantId} = ${schema.productVariants.id}
      )`,
      sold90: sql<number>`(
        SELECT COALESCE(SUM(${schema.variantSalesDaily.units}), 0)
        FROM ${schema.variantSalesDaily}
        WHERE ${schema.variantSalesDaily.variantId} = ${schema.productVariants.id}
          AND ${schema.variantSalesDaily.day} >= date('now', '-90 days')
      )`,
    })
    .from(schema.productVariants)
    .innerJoin(
      schema.products,
      eq(schema.productVariants.productId, schema.products.id),
    )
    .innerJoin(
      schema.collections,
      eq(schema.products.collectionId, schema.collections.id),
    );

  addSheet(
    "Изделия и SKU",
    [
      { header: "Коллекция", key: "collection", width: 22 },
      { header: "Изделие", key: "product", width: 26 },
      { header: "SKU", key: "sku", width: 18 },
      { header: "Цвет", key: "color", width: 20 },
      { header: "Размер", key: "size", width: 10 },
      { header: "Остаток, шт", key: "stock", width: 13 },
      { header: "Продано за 90 дн", key: "sold", width: 17 },
      ...(showMoney
        ? [
            { header: "Розничная цена", key: "price", width: 15 },
            { header: "Пошив, THB", key: "sewing", width: 13 },
          ]
        : []),
    ],
    variants.map((v) => ({
      collection: v.collectionName,
      product: v.productName,
      sku: v.sku,
      color: v.color ?? "",
      size: v.size ?? "",
      stock: Number(v.stock),
      sold: Number(v.sold90),
      ...(showMoney ? { price: v.price ?? "", sewing: v.sewing ?? "" } : {}),
    })),
  );

  // ---------- Состав изделий (BOM) ----------
  const bom = await db
    .select({
      productName: schema.products.name,
      collectionName: schema.collections.name,
      fabricName: schema.fabrics.name,
      fabricSku: schema.fabrics.sku,
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
    .innerJoin(
      schema.fabrics,
      eq(schema.bomFabricLines.fabricId, schema.fabrics.id),
    );

  addSheet(
    "Состав изделий",
    [
      { header: "Коллекция", key: "collection", width: 22 },
      { header: "Изделие", key: "product", width: 26 },
      { header: "Ткань", key: "fabric", width: 26 },
      { header: "SKU ткани", key: "fabricSku", width: 18 },
      { header: "Метров на 1 шт", key: "meters", width: 16 },
      { header: "Припуск, %", key: "waste", width: 12 },
      { header: "Итого с припуском", key: "total", width: 18 },
    ],
    bom.map((b) => ({
      collection: b.collectionName,
      product: b.productName,
      fabric: b.fabricName,
      fabricSku: b.fabricSku,
      meters: b.metersPerUnit,
      waste: b.wastePct,
      total: Math.round(b.metersPerUnit * (1 + b.wastePct / 100) * 100) / 100,
    })),
  );

  // ---------- Заказы ----------
  const orders = await db
    .select({
      o: schema.productionOrders,
      factoryName: schema.factories.name,
      units: sql<number>`(
        SELECT COALESCE(SUM(${schema.productionOrderLines.quantity}), 0)
        FROM ${schema.productionOrderLines}
        WHERE ${schema.productionOrderLines.orderId} = ${schema.productionOrders.id}
      )`,
      paid: sql<number>`(
        SELECT COALESCE(SUM(${schema.orderPayments.amount}), 0)
        FROM ${schema.orderPayments}
        WHERE ${schema.orderPayments.orderId} = ${schema.productionOrders.id}
      )`,
    })
    .from(schema.productionOrders)
    .innerJoin(
      schema.factories,
      eq(schema.productionOrders.factoryId, schema.factories.id),
    );

  const STATUS_RU: Record<string, string> = {
    SAMPLE: "Образец",
    IN_PRODUCTION: "В производстве",
    READY: "Готово",
    RECEIVED: "Принято",
    CANCELLED: "Отменён",
  };

  addSheet(
    "Заказы",
    [
      { header: "Номер", key: "number", width: 16 },
      { header: "Фабрика", key: "factory", width: 26 },
      { header: "Статус", key: "status", width: 16 },
      { header: "Штук", key: "units", width: 10 },
      { header: "План готовности", key: "planned", width: 17 },
      { header: "Фактически", key: "actual", width: 15 },
      ...(showMoney
        ? [
            { header: "Ткань, THB", key: "fabric", width: 13 },
            { header: "Фурнитура, THB", key: "acc", width: 15 },
            { header: "Пошив, THB", key: "sewing", width: 13 },
            { header: "Итого, THB", key: "total", width: 14 },
            { header: "Зачтён брак", key: "credit", width: 13 },
            { header: "Оплачено", key: "paid", width: 13 },
            { header: "Остаток к оплате", key: "due", width: 17 },
          ]
        : []),
      { header: "Примечание", key: "note", width: 34 },
    ],
    orders.map(({ o, factoryName, units, paid }) => ({
      number: o.number,
      factory: factoryName,
      status: STATUS_RU[o.status] ?? o.status,
      units: Number(units),
      planned: o.plannedReadyAt ? o.plannedReadyAt.slice(0, 10) : "",
      actual: o.actualReadyAt ? o.actualReadyAt.slice(0, 10) : "",
      ...(showMoney
        ? {
            fabric: Math.round(o.snapshotFabricCost),
            acc: Math.round(o.snapshotAccessoryCost),
            sewing: Math.round(o.snapshotSewingCost),
            total: Math.round(o.snapshotTotalCost),
            credit: Math.round(o.appliedDefectCredit),
            paid: Math.round(Number(paid)),
            due: Math.max(
              0,
              Math.round(
                o.snapshotTotalCost - o.appliedDefectCredit - Number(paid),
              ),
            ),
          }
        : {}),
      note: o.note ?? "",
    })),
  );

  // ---------- Позиции заказов ----------
  const orderLines = await db
    .select({
      orderNumber: schema.productionOrders.number,
      productName: schema.products.name,
      sku: schema.productVariants.sku,
      size: schema.productionOrderLines.size,
      quantity: schema.productionOrderLines.quantity,
      produced: schema.productionOrderLines.qtyProduced,
      defect: schema.productionOrderLines.qtyDefect,
      unitSewing: schema.productionOrderLines.unitSewingCost,
      unitFabric: schema.productionOrderLines.unitFabricCost,
    })
    .from(schema.productionOrderLines)
    .innerJoin(
      schema.productionOrders,
      eq(schema.productionOrderLines.orderId, schema.productionOrders.id),
    )
    .innerJoin(
      schema.products,
      eq(schema.productionOrderLines.productId, schema.products.id),
    )
    .leftJoin(
      schema.productVariants,
      eq(schema.productionOrderLines.variantId, schema.productVariants.id),
    );

  addSheet(
    "Позиции заказов",
    [
      { header: "Заказ", key: "order", width: 16 },
      { header: "Изделие", key: "product", width: 26 },
      { header: "SKU", key: "sku", width: 18 },
      { header: "Размер", key: "size", width: 10 },
      { header: "Заказано", key: "qty", width: 11 },
      { header: "Отшито", key: "produced", width: 11 },
      { header: "Брак", key: "defect", width: 9 },
      ...(showMoney
        ? [
            { header: "Пошив 1 шт", key: "sewing", width: 13 },
            { header: "Ткань 1 шт", key: "fabric", width: 13 },
          ]
        : []),
    ],
    orderLines.map((l) => ({
      order: l.orderNumber,
      product: l.productName,
      sku: l.sku ?? "",
      size: l.size ?? "",
      qty: l.quantity,
      produced: l.produced,
      defect: l.defect,
      ...(showMoney
        ? {
            sewing: Math.round(l.unitSewing),
            fabric: Math.round(l.unitFabric),
          }
        : {}),
    })),
  );

  // ---------- Фабрики ----------
  const factories = await db.select().from(schema.factories);
  addSheet(
    "Фабрики",
    [
      { header: "Название", key: "name", width: 28 },
      { header: "Специализация", key: "spec", width: 30 },
      { header: "Контакт", key: "contact", width: 18 },
      { header: "WhatsApp", key: "whatsapp", width: 18 },
      { header: "Адрес", key: "address", width: 34 },
      { header: "Страна", key: "country", width: 10 },
      { header: "Мощность, шт/мес", key: "capacity", width: 18 },
    ],
    factories.map((f) => ({
      name: f.name,
      spec: f.specialization ?? "",
      contact: f.contact ?? "",
      whatsapp: f.whatsapp ?? "",
      address: f.address ?? "",
      country: f.country ?? "",
      capacity: f.monthlyCapacityUnits ?? "",
    })),
  );

  // ---------- Остатки по складам ----------
  const stockRows = await db
    .select({
      warehouse: schema.warehouses.name,
      sku: schema.productVariants.sku,
      productName: schema.products.name,
      collectionName: schema.collections.name,
      quantity: schema.variantStock.quantity,
      syncedAt: schema.variantStock.syncedAt,
    })
    .from(schema.variantStock)
    .innerJoin(
      schema.warehouses,
      eq(schema.variantStock.warehouseId, schema.warehouses.id),
    )
    .innerJoin(
      schema.productVariants,
      eq(schema.variantStock.variantId, schema.productVariants.id),
    )
    .innerJoin(
      schema.products,
      eq(schema.productVariants.productId, schema.products.id),
    )
    .innerJoin(
      schema.collections,
      eq(schema.products.collectionId, schema.collections.id),
    );

  addSheet(
    "Остатки по складам",
    [
      { header: "Склад", key: "warehouse", width: 22 },
      { header: "Коллекция", key: "collection", width: 22 },
      { header: "Изделие", key: "product", width: 26 },
      { header: "SKU", key: "sku", width: 18 },
      { header: "Количество", key: "qty", width: 13 },
      { header: "Обновлено", key: "synced", width: 18 },
    ],
    stockRows.map((r) => ({
      warehouse: r.warehouse,
      collection: r.collectionName,
      product: r.productName,
      sku: r.sku,
      qty: r.quantity,
      synced: r.syncedAt.slice(0, 16).replace("T", " "),
    })),
  );

  // ---------- Продажи по дням ----------
  const sales = await db
    .select({
      day: schema.variantSalesDaily.day,
      sku: schema.productVariants.sku,
      productName: schema.products.name,
      units: schema.variantSalesDaily.units,
      revenue: schema.variantSalesDaily.revenue,
    })
    .from(schema.variantSalesDaily)
    .innerJoin(
      schema.productVariants,
      eq(schema.variantSalesDaily.variantId, schema.productVariants.id),
    )
    .innerJoin(
      schema.products,
      eq(schema.productVariants.productId, schema.products.id),
    );

  addSheet(
    "Продажи по дням",
    [
      { header: "Дата", key: "day", width: 13 },
      { header: "Изделие", key: "product", width: 26 },
      { header: "SKU", key: "sku", width: 18 },
      { header: "Штук", key: "units", width: 10 },
      ...(showMoney ? [{ header: "Выручка", key: "revenue", width: 14 }] : []),
    ],
    sales.map((s) => ({
      day: s.day,
      product: s.productName,
      sku: s.sku,
      units: s.units,
      ...(showMoney ? { revenue: Math.round(s.revenue) } : {}),
    })),
  );

  // ---------- Лист-легенда ----------
  const info = wb.addWorksheet("О выгрузке");
  info.columns = [
    { header: "", key: "k", width: 30 },
    { header: "", key: "v", width: 80 },
  ];
  const infoRows: [string, string][] = [
    ["Выгрузка", "Luna Production · EVA MOON"],
    ["Дата", new Date().toLocaleString("ru-RU")],
    ["Кто выгрузил", `${user.name} (${user.email})`],
    [
      "Финансовые данные",
      showMoney
        ? "включены (роль «владелец»)"
        : "скрыты — выгрузку делал менеджер производства",
    ],
    [
      "Себестоимость заказов",
      "Зафиксирована на момент создания заказа. Изменение цены ткани или пошива позже не пересчитывает старые заказы.",
    ],
    [
      "Цена тканей",
      "Хранится в валюте закупки; курс к THB зафиксирован на дату закупки.",
    ],
    [
      "Остатки готовой продукции",
      "Источник правды — Ainur POS. Дата последней синхронизации указана в столбце «Обновлено».",
    ],
    ["Ткани и их остатки", "Ведутся только в Luna Production, в Ainur их нет."],
  ];
  for (const [k, v] of infoRows) info.addRow({ k, v });
  info.getColumn("k").font = { name: "Arial", bold: true, size: 10 };
  info.getColumn("v").font = { name: "Arial", size: 10 };
  info.getColumn("v").alignment = { wrapText: true, vertical: "top" };
  info.getRow(1).hidden = true;
  info.getCell("A1").fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: ACCENT },
  };

  await writeAudit(user, {
    action: "UPDATE",
    entityType: "Export",
    entityId: "excel",
    entityName: `Выгрузка базы в Excel (${showMoney ? "с финансами" : "без финансов"})`,
  });

  const buffer = await wb.xlsx.writeBuffer();
  const stamp = new Date().toISOString().slice(0, 10);

  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="luna-production-${stamp}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
