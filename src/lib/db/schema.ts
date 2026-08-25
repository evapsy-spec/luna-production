/**
 * LUNA PRODUCTION — схема данных (Drizzle ORM, SQLite-совместимая)
 *
 * Денежные значения храним в THB как real. Курс конвертации фиксируется
 * на дату закупки (fxRateToThb) — задним числом ничего не пересчитывается.
 * Даты храним как ISO-строки (text) — переносимо между SQLite и Postgres.
 */
import { sql, relations } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  real,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const now = () =>
  text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString());

// ============================================================
// ПОЛЬЗОВАТЕЛИ, ДОСТУП, АУДИТ
// ============================================================

/** OWNER — Ева и Константин (всё, включая финансы). MANAGER — производство. */
export const ROLES = ["OWNER", "MANAGER"] as const;
export type Role = (typeof ROLES)[number];

export const users = sqliteTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("MANAGER"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: now(),
});

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: id(),
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    actorName: text("actor_name").notNull(),
    action: text("action").notNull(), // CREATE | UPDATE | DELETE | SYNC | RESERVE | RELEASE | APPLY_CREDIT
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    entityName: text("entity_name").notNull(),
    changes: text("changes"), // JSON { field: { from, to } }
    createdAt: now(),
  },
  (t) => [
    index("audit_entity_idx").on(t.entityType, t.entityId),
    index("audit_created_idx").on(t.createdAt),
  ],
);

// ============================================================
// СКЛАДЫ
// ============================================================

export const WAREHOUSE_KINDS = ["GOODS", "FABRIC"] as const;

export const warehouses = sqliteTable("warehouses", {
  id: id(),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("GOODS"),
  /** ID склада в Ainur — сопоставление ключей объекта stock из API */
  ainurId: text("ainur_id").unique(),
  country: text("country"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: now(),
});

// ============================================================
// ПОСТАВЩИКИ И ТКАНИ
// ============================================================

export const suppliers = sqliteTable("suppliers", {
  id: id(),
  name: text("name").notNull(),
  contact: text("contact"),
  phone: text("phone"),
  /** номер для ссылки wa.me — переписка и заказы */
  whatsapp: text("whatsapp"),
  email: text("email"),
  address: text("address"),
  mapsLat: real("maps_lat"),
  mapsLng: real("maps_lng"),
  mapsUrl: text("maps_url"),
  country: text("country"),
  note: text("note"),
  createdAt: now(),
});

export const fabrics = sqliteTable(
  "fabrics",
  {
    id: id(),
    sku: text("sku").notNull().unique(),
    name: text("name").notNull(),
    composition: text("composition"),
    color: text("color"),
    /** красим мы эту ткань или берём уже цветной */
    isDyed: integer("is_dyed", { mode: "boolean" }).notNull().default(false),

    rollLengthM: real("roll_length_m"),
    widthCm: real("width_cm"),

    /** цена за метр в валюте закупки */
    purchasePrice: real("purchase_price"),
    purchaseCurrency: text("purchase_currency").notNull().default("THB"),
    /** курс на дату закупки: purchasePrice * fxRateToThb = цена в THB */
    fxRateToThb: real("fx_rate_to_thb").notNull().default(1),
    priceDate: text("price_date"),

    supplierId: text("supplier_id").references(() => suppliers.id, {
      onDelete: "set null",
    }),

    photoUrl: text("photo_url"),
    qrToken: text("qr_token").unique(),
    note: text("note"),

    /** ткань заказана у поставщика и ожидается — простая пометка */
    isOnOrder: integer("is_on_order", { mode: "boolean" })
      .notNull()
      .default(false),

    isArchived: integer("is_archived", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: now(),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (t) => [index("fabric_name_idx").on(t.name)],
);

export const fabricStock = sqliteTable(
  "fabric_stock",
  {
    id: id(),
    fabricId: text("fabric_id")
      .notNull()
      .references(() => fabrics.id, { onDelete: "cascade" }),
    warehouseId: text("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "cascade" }),
    /** физически лежит на складе, метры */
    onHandM: real("on_hand_m").notNull().default(0),
    /** зарезервировано под активные заказы, метры */
    reservedM: real("reserved_m").notNull().default(0),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (t) => [uniqueIndex("fabric_stock_uq").on(t.fabricId, t.warehouseId)],
);

/** Рулон с QR-меткой — учёт телефоном на складе */
export const fabricLots = sqliteTable("fabric_lots", {
  id: id(),
  fabricId: text("fabric_id")
    .notNull()
    .references(() => fabrics.id, { onDelete: "cascade" }),
  warehouseId: text("warehouse_id")
    .notNull()
    .references(() => warehouses.id, { onDelete: "cascade" }),
  lotCode: text("lot_code").notNull().unique(),
  lengthM: real("length_m").notNull(),
  remainingM: real("remaining_m").notNull(),
  arrivedAt: text("arrived_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  note: text("note"),
  createdAt: now(),
});

/** Резерв метража под заказ — два заказа не могут занять одну ткань */
export const fabricReservations = sqliteTable(
  "fabric_reservations",
  {
    id: id(),
    fabricId: text("fabric_id")
      .notNull()
      .references(() => fabrics.id, { onDelete: "cascade" }),
    warehouseId: text("warehouse_id").references(() => warehouses.id, {
      onDelete: "set null",
    }),
    orderId: text("order_id")
      .notNull()
      .references(() => productionOrders.id, { onDelete: "cascade" }),
    meters: real("meters").notNull(),
    released: integer("released", { mode: "boolean" }).notNull().default(false),
    createdAt: now(),
  },
  (t) => [index("reservation_order_idx").on(t.orderId)],
);

// ============================================================
// ЗАЯВКИ НА ДОЗАКУПКУ ТКАНИ
// ============================================================

export const PURCHASE_STATUSES = [
  "DRAFT",
  "SENT",
  "RECEIVED",
  "CANCELLED",
] as const;

export const fabricPurchases = sqliteTable("fabric_purchases", {
  id: id(),
  number: text("number").notNull().unique(),
  status: text("status").notNull().default("DRAFT"),
  /** «нехватка под заказ №...» — заполняется автоматически */
  reason: text("reason"),
  orderId: text("order_id").references(() => productionOrders.id, {
    onDelete: "set null",
  }),
  supplierId: text("supplier_id").references(() => suppliers.id, {
    onDelete: "set null",
  }),
  createdAt: now(),
  sentAt: text("sent_at"),
  receivedAt: text("received_at"),
});

export const fabricPurchaseLines = sqliteTable("fabric_purchase_lines", {
  id: id(),
  purchaseId: text("purchase_id")
    .notNull()
    .references(() => fabricPurchases.id, { onDelete: "cascade" }),
  fabricId: text("fabric_id")
    .notNull()
    .references(() => fabrics.id, { onDelete: "cascade" }),
  metersNeeded: real("meters_needed").notNull(),
  metersOrdered: real("meters_ordered"),
  note: text("note"),
});

// ============================================================
// ФАБРИКИ
// ============================================================

export const factories = sqliteTable("factories", {
  id: id(),
  name: text("name").notNull(),
  specialization: text("specialization"),
  contact: text("contact"),
  phone: text("phone"),
  whatsapp: text("whatsapp"),
  email: text("email"),
  address: text("address"),
  mapsLat: real("maps_lat"),
  mapsLng: real("maps_lng"),
  mapsUrl: text("maps_url"),
  country: text("country"),
  note: text("note"),
  /** для индикатора загрузки: сколько единиц в месяц фабрика физически может */
  monthlyCapacityUnits: integer("monthly_capacity_units"),
  isArchived: integer("is_archived", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: now(),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

/** Одна коллекция может шиться на нескольких фабриках одновременно */
export const factoryCollections = sqliteTable(
  "factory_collections",
  {
    id: id(),
    factoryId: text("factory_id")
      .notNull()
      .references(() => factories.id, { onDelete: "cascade" }),
    collectionId: text("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("factory_collection_uq").on(t.factoryId, t.collectionId)],
);

/**
 * Фиксированная цена пошива за изделие на фабрике.
 * История сохраняется: при изменении цены старая запись остаётся
 * с isCurrent=false — это питает скоркард «история цен».
 */
export const factoryPrices = sqliteTable(
  "factory_prices",
  {
    id: id(),
    factoryId: text("factory_id")
      .notNull()
      .references(() => factories.id, { onDelete: "cascade" }),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    pricePerUnit: real("price_per_unit").notNull(),
    validFrom: text("valid_from")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    isCurrent: integer("is_current", { mode: "boolean" })
      .notNull()
      .default(true),
    createdAt: now(),
  },
  (t) => [
    index("factory_price_idx").on(t.factoryId, t.productId, t.isCurrent),
  ],
);

// ============================================================
// КОЛЛЕКЦИИ / ИЗДЕЛИЯ / ВАРИАНТЫ
// ============================================================

export const collections = sqliteTable("collections", {
  id: id(),
  name: text("name").notNull(),
  /** ext-category в Ainur Connect API */
  ainurCategoryId: text("ainur_category_id").unique(),
  description: text("description"),
  photoUrl: text("photo_url"),
  isArchived: integer("is_archived", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: now(),
});

/** Изделие (модель): здесь живут BOM, лекала и цена пошива */
export const products = sqliteTable(
  "products",
  {
    id: id(),
    collectionId: text("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    baseSku: text("base_sku"),
    photoUrl: text("photo_url"),
    note: text("note"),
    /** используется, если для пары фабрика–изделие нет записи в factoryPrices */
    defaultSewingCost: real("default_sewing_cost"),
    isArchived: integer("is_archived", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: now(),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (t) => [index("product_collection_idx").on(t.collectionId)],
);

/** Вариант = конкретный SKU в Ainur (цвет + размер) */
export const productVariants = sqliteTable(
  "product_variants",
  {
    id: id(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** = code в Ainur, ключ синхронизации */
    sku: text("sku").notNull().unique(),
    color: text("color"),
    size: text("size"),
    ainurId: text("ainur_id").unique(),
    ainurName: text("ainur_name"),
    price: real("price"),
    /**
     * Себестоимость из Ainur, THB.
     *
     * В Connect API её нет ни в /product, ни в строках продаж — только в
     * веб-интерфейсе Ainur (колонки Purchasing price и Cost в каталоге).
     * Поэтому значения приходят не синхронизацией, а разовым импортом:
     * страница каталога Ainur отправляет их в POST /api/ainur-cost.
     *
     * ainurPurchaseCost — цена закупки из карточки товара, заполнена почти
     * везде; на неё и опираемся. ainurAvgCost — средняя по фактическим
     * приходам, у многих наших позиций нулевая, держим как справочную.
     */
    ainurPurchaseCost: real("ainur_purchase_cost"),
    ainurAvgCost: real("ainur_avg_cost"),
    ainurCostSyncedAt: text("ainur_cost_synced_at"),
    qrToken: text("qr_token").unique(),
    isArchived: integer("is_archived", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: now(),
  },
  (t) => [index("variant_product_idx").on(t.productId)],
);

/** Остаток варианта по складам — приходит из Ainur: stock { storeId: qty } */
export const variantStock = sqliteTable(
  "variant_stock",
  {
    id: id(),
    variantId: text("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    warehouseId: text("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull().default(0),
    syncedAt: text("synced_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (t) => [uniqueIndex("variant_stock_uq").on(t.variantId, t.warehouseId)],
);

/**
 * История остатков. Ainur отдаёт только текущий срез, поэтому при каждой
 * синхронизации складываем снимок — иначе графики динамики склада построить
 * не из чего.
 */
export const stockSnapshots = sqliteTable(
  "stock_snapshots",
  {
    id: id(),
    takenAt: text("taken_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    scope: text("scope").notNull(), // variant | collection | total
    refId: text("ref_id"),
    quantity: integer("quantity").notNull(),
  },
  (t) => [index("snapshot_idx").on(t.scope, t.refId, t.takenAt)],
);

/** Продажи, свёрнутые по дню и варианту — из /documents/sales */
export const variantSalesDaily = sqliteTable(
  "variant_sales_daily",
  {
    id: id(),
    variantId: text("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    warehouseId: text("warehouse_id"),
    day: text("day").notNull(), // YYYY-MM-DD
    units: integer("units").notNull().default(0),
    revenue: real("revenue").notNull().default(0),
    cost: real("cost").notNull().default(0),
  },
  (t) => [
    uniqueIndex("sales_daily_uq").on(t.variantId, t.warehouseId, t.day),
    index("sales_day_idx").on(t.day),
  ],
);

/** Перемещения между складами — из /documents/changes (source → destination) */
export const stockMovements = sqliteTable(
  "stock_movements",
  {
    id: id(),
    ainurDocumentId: text("ainur_document_id").unique(),
    variantId: text("variant_id").references(() => productVariants.id, {
      onDelete: "set null",
    }),
    fromWarehouseId: text("from_warehouse_id").references(() => warehouses.id, {
      onDelete: "set null",
    }),
    toWarehouseId: text("to_warehouse_id").references(() => warehouses.id, {
      onDelete: "set null",
    }),
    quantity: integer("quantity").notNull(),
    occurredAt: text("occurred_at").notNull(),
    note: text("note"),
    createdAt: now(),
  },
  (t) => [index("movement_date_idx").on(t.occurredAt)],
);

// ============================================================
// BOM — состав изделия
// ============================================================

export const bomFabricLines = sqliteTable(
  "bom_fabric_lines",
  {
    id: id(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    fabricId: text("fabric_id")
      .notNull()
      .references(() => fabrics.id, { onDelete: "cascade" }),
    /** метров на одно изделие */
    metersPerUnit: real("meters_per_unit").notNull(),
    /** припуск на раскрой, % — учитывается в расчёте потребности */
    wastePct: real("waste_pct").notNull().default(0),
    note: text("note"),
  },
  (t) => [uniqueIndex("bom_fabric_uq").on(t.productId, t.fabricId)],
);

export const accessories = sqliteTable("accessories", {
  id: id(),
  sku: text("sku").notNull().unique(),
  name: text("name").notNull(),
  unit: text("unit").notNull().default("шт"),
  unitCost: real("unit_cost").notNull().default(0),
  stockQty: real("stock_qty").notNull().default(0),
  photoUrl: text("photo_url"),
  createdAt: now(),
});

export const bomAccessoryLines = sqliteTable(
  "bom_accessory_lines",
  {
    id: id(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    accessoryId: text("accessory_id")
      .notNull()
      .references(() => accessories.id, { onDelete: "cascade" }),
    qtyPerUnit: real("qty_per_unit").notNull(),
  },
  (t) => [uniqueIndex("bom_accessory_uq").on(t.productId, t.accessoryId)],
);

/** Технические лекала — передаём от фабрики к фабрике */
export const patternFiles = sqliteTable("pattern_files", {
  id: id(),
  productId: text("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  fileUrl: text("file_url").notNull(),
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes"),
  version: text("version"),
  uploadedBy: text("uploaded_by"),
  createdAt: now(),
});

// ============================================================
// ЗАКАЗЫ НА ПОШИВ
// ============================================================

export const ORDER_STATUSES = [
  "SAMPLE", // ждём/проверяем образец — массовый пошив ещё не начат
  "IN_PRODUCTION", // образец утверждён
  "READY", // готово на фабрике
  "RECEIVED", // принято на склад
  "CANCELLED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const productionOrders = sqliteTable(
  "production_orders",
  {
    id: id(),
    number: text("number").notNull().unique(),
    factoryId: text("factory_id")
      .notNull()
      .references(() => factories.id),
    status: text("status").notNull().default("SAMPLE"),

    // Этап образца — обязателен перед массовым пошивом
    sampleRequestedAt: text("sample_requested_at"),
    sampleApprovedAt: text("sample_approved_at"),
    sampleNote: text("sample_note"),

    plannedReadyAt: text("planned_ready_at"),
    actualReadyAt: text("actual_ready_at"),

    /** под какой горизонт считали рекомендацию, месяцев */
    horizonMonths: integer("horizon_months"),

    /**
     * Снэпшот себестоимости на момент создания заказа.
     * Будущее изменение цены ткани или пошива это НЕ переписывает.
     */
    snapshotFabricCost: real("snapshot_fabric_cost").notNull().default(0),
    snapshotAccessoryCost: real("snapshot_accessory_cost").notNull().default(0),
    snapshotSewingCost: real("snapshot_sewing_cost").notNull().default(0),
    snapshotTotalCost: real("snapshot_total_cost").notNull().default(0),
    snapshotAt: text("snapshot_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),

    /** зачтённый брак с прошлых заказов этой фабрики, THB */
    appliedDefectCredit: real("applied_defect_credit").notNull().default(0),

    note: text("note"),
    createdById: text("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: now(),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (t) => [
    index("order_status_idx").on(t.status),
    index("order_factory_idx").on(t.factoryId),
  ],
);

export const productionOrderLines = sqliteTable(
  "production_order_lines",
  {
    id: id(),
    orderId: text("order_id")
      .notNull()
      .references(() => productionOrders.id, { onDelete: "cascade" }),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    variantId: text("variant_id").references(() => productVariants.id, {
      onDelete: "set null",
    }),
    size: text("size"),
    quantity: integer("quantity").notNull(),
    /** снэпшот цены пошива за штуку на момент заказа */
    unitSewingCost: real("unit_sewing_cost").notNull().default(0),
    /** снэпшот стоимости ткани на штуку на момент заказа */
    unitFabricCost: real("unit_fabric_cost").notNull().default(0),
    /** плановая дата готовности — обязательное поле по позиции */
    plannedReadyAt: text("planned_ready_at"),
    qtyProduced: integer("qty_produced").notNull().default(0),
    qtyDefect: integer("qty_defect").notNull().default(0),
  },
  (t) => [index("order_line_idx").on(t.orderId)],
);

export const PAYMENT_KINDS = ["DEPOSIT", "BALANCE", "FULL", "OTHER"] as const;

export const orderPayments = sqliteTable("order_payments", {
  id: id(),
  orderId: text("order_id")
    .notNull()
    .references(() => productionOrders.id, { onDelete: "cascade" }),
  kind: text("kind").notNull().default("DEPOSIT"),
  amount: real("amount").notNull(),
  currency: text("currency").notNull().default("THB"),
  paidAt: text("paid_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  invoiceNo: text("invoice_no"),
  note: text("note"),
});

/**
 * Брак. Стоимость забракованных единиц становится «кредитом» на фабрику
 * и вычитается из следующего заказа на ней же.
 */
export const defectCredits = sqliteTable(
  "defect_credits",
  {
    id: id(),
    orderId: text("order_id")
      .notNull()
      .references(() => productionOrders.id, { onDelete: "cascade" }),
    factoryId: text("factory_id")
      .notNull()
      .references(() => factories.id, { onDelete: "cascade" }),
    orderLineId: text("order_line_id").references(
      () => productionOrderLines.id,
      { onDelete: "set null" },
    ),
    quantity: integer("quantity").notNull(),
    amount: real("amount").notNull(),
    reason: text("reason"),
    /** в какой заказ зачли; null = кредит ещё не использован */
    appliedToOrderId: text("applied_to_order_id"),
    appliedAt: text("applied_at"),
    createdAt: now(),
  },
  (t) => [index("defect_factory_idx").on(t.factoryId, t.appliedToOrderId)],
);

// ============================================================
// КАЛЕНДАРЬ ЗАПУСКА КОЛЛЕКЦИЙ
// ============================================================

export const collectionLaunches = sqliteTable(
  "collection_launches",
  {
    id: id(),
    collectionId: text("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    season: text("season").notNull(),
    /** когда коллекция должна быть в продаже */
    targetOnSaleAt: text("target_on_sale_at").notNull(),
    /** сколько дней занимает пошив — из него считается дата старта */
    leadTimeDays: integer("lead_time_days").notNull().default(45),
    productionStartBy: text("production_start_by"),
    note: text("note"),
    isDone: integer("is_done", { mode: "boolean" }).notNull().default(false),
    createdAt: now(),
  },
  (t) => [index("launch_date_idx").on(t.targetOnSaleAt)],
);

// ============================================================
// СИНХРОНИЗАЦИЯ И НАСТРОЙКИ
// ============================================================

export const syncRuns = sqliteTable(
  "sync_runs",
  {
    id: id(),
    kind: text("kind").notNull(), // products | sales | movements | stores
    status: text("status").notNull().default("RUNNING"),
    startedAt: text("started_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    finishedAt: text("finished_at"),
    itemsRead: integer("items_read").notNull().default(0),
    itemsWritten: integer("items_written").notNull().default(0),
    rangeFrom: text("range_from"),
    rangeTo: text("range_to"),
    error: text("error"),
    triggeredBy: text("triggered_by"),
  },
  (t) => [index("sync_kind_idx").on(t.kind, t.startedAt)],
);

/**
 * План пополнения — решения человека по позициям, которые заканчиваются.
 *
 * Живёт отдельной таблицей, а не полем в каталоге, по одной причине:
 * синхронизация с Ainur перезаписывает товары и остатки целиком, и любое
 * решение, записанное в product_variants, она бы стёрла при первом же обмене.
 */
export const replenishPlan = sqliteTable("replenish_plan", {
  id: id(),
  variantId: text("variant_id")
    .notNull()
    .unique()
    .references(() => productVariants.id, { onDelete: "cascade" }),
  /** на какой фабрике планируем шить */
  factoryId: text("factory_id").references(() => factories.id, {
    onDelete: "set null",
  }),
  /** «эту модель больше не повторяем» — убрать из списка пополнения */
  excluded: integer("excluded", { mode: "boolean" }).notNull().default(false),
  note: text("note"),
  updatedById: text("updated_by_id").references(() => users.id, {
    onDelete: "set null",
  }),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// ============================================================
// СВЯЗИ (для db.query.* с вложенными выборками)
// ============================================================

export const collectionsRelations = relations(collections, ({ many }) => ({
  products: many(products),
  factories: many(factoryCollections),
  launches: many(collectionLaunches),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  collection: one(collections, {
    fields: [products.collectionId],
    references: [collections.id],
  }),
  variants: many(productVariants),
  bomFabrics: many(bomFabricLines),
  bomAccessories: many(bomAccessoryLines),
  patterns: many(patternFiles),
  factoryPrices: many(factoryPrices),
}));

export const productVariantsRelations = relations(
  productVariants,
  ({ one, many }) => ({
    product: one(products, {
      fields: [productVariants.productId],
      references: [products.id],
    }),
    stock: many(variantStock),
    sales: many(variantSalesDaily),
  }),
);

export const variantStockRelations = relations(variantStock, ({ one }) => ({
  variant: one(productVariants, {
    fields: [variantStock.variantId],
    references: [productVariants.id],
  }),
  warehouse: one(warehouses, {
    fields: [variantStock.warehouseId],
    references: [warehouses.id],
  }),
}));

export const fabricsRelations = relations(fabrics, ({ one, many }) => ({
  supplier: one(suppliers, {
    fields: [fabrics.supplierId],
    references: [suppliers.id],
  }),
  stock: many(fabricStock),
  lots: many(fabricLots),
  bomLines: many(bomFabricLines),
  reservations: many(fabricReservations),
}));

export const fabricStockRelations = relations(fabricStock, ({ one }) => ({
  fabric: one(fabrics, {
    fields: [fabricStock.fabricId],
    references: [fabrics.id],
  }),
  warehouse: one(warehouses, {
    fields: [fabricStock.warehouseId],
    references: [warehouses.id],
  }),
}));

export const bomFabricLinesRelations = relations(bomFabricLines, ({ one }) => ({
  product: one(products, {
    fields: [bomFabricLines.productId],
    references: [products.id],
  }),
  fabric: one(fabrics, {
    fields: [bomFabricLines.fabricId],
    references: [fabrics.id],
  }),
}));

export const bomAccessoryLinesRelations = relations(
  bomAccessoryLines,
  ({ one }) => ({
    product: one(products, {
      fields: [bomAccessoryLines.productId],
      references: [products.id],
    }),
    accessory: one(accessories, {
      fields: [bomAccessoryLines.accessoryId],
      references: [accessories.id],
    }),
  }),
);

export const factoriesRelations = relations(factories, ({ many }) => ({
  prices: many(factoryPrices),
  orders: many(productionOrders),
  collections: many(factoryCollections),
  defectCredits: many(defectCredits),
}));

export const factoryCollectionsRelations = relations(
  factoryCollections,
  ({ one }) => ({
    factory: one(factories, {
      fields: [factoryCollections.factoryId],
      references: [factories.id],
    }),
    collection: one(collections, {
      fields: [factoryCollections.collectionId],
      references: [collections.id],
    }),
  }),
);

export const factoryPricesRelations = relations(factoryPrices, ({ one }) => ({
  factory: one(factories, {
    fields: [factoryPrices.factoryId],
    references: [factories.id],
  }),
  product: one(products, {
    fields: [factoryPrices.productId],
    references: [products.id],
  }),
}));

export const productionOrdersRelations = relations(
  productionOrders,
  ({ one, many }) => ({
    factory: one(factories, {
      fields: [productionOrders.factoryId],
      references: [factories.id],
    }),
    createdBy: one(users, {
      fields: [productionOrders.createdById],
      references: [users.id],
    }),
    lines: many(productionOrderLines),
    reservations: many(fabricReservations),
    payments: many(orderPayments),
    defects: many(defectCredits),
  }),
);

export const productionOrderLinesRelations = relations(
  productionOrderLines,
  ({ one }) => ({
    order: one(productionOrders, {
      fields: [productionOrderLines.orderId],
      references: [productionOrders.id],
    }),
    product: one(products, {
      fields: [productionOrderLines.productId],
      references: [products.id],
    }),
    variant: one(productVariants, {
      fields: [productionOrderLines.variantId],
      references: [productVariants.id],
    }),
  }),
);

export const fabricReservationsRelations = relations(
  fabricReservations,
  ({ one }) => ({
    fabric: one(fabrics, {
      fields: [fabricReservations.fabricId],
      references: [fabrics.id],
    }),
    order: one(productionOrders, {
      fields: [fabricReservations.orderId],
      references: [productionOrders.id],
    }),
  }),
);

export const orderPaymentsRelations = relations(orderPayments, ({ one }) => ({
  order: one(productionOrders, {
    fields: [orderPayments.orderId],
    references: [productionOrders.id],
  }),
}));

export const defectCreditsRelations = relations(defectCredits, ({ one }) => ({
  order: one(productionOrders, {
    fields: [defectCredits.orderId],
    references: [productionOrders.id],
  }),
  factory: one(factories, {
    fields: [defectCredits.factoryId],
    references: [factories.id],
  }),
}));

export const fabricPurchasesRelations = relations(
  fabricPurchases,
  ({ one, many }) => ({
    lines: many(fabricPurchaseLines),
    supplier: one(suppliers, {
      fields: [fabricPurchases.supplierId],
      references: [suppliers.id],
    }),
  }),
);

export const fabricPurchaseLinesRelations = relations(
  fabricPurchaseLines,
  ({ one }) => ({
    purchase: one(fabricPurchases, {
      fields: [fabricPurchaseLines.purchaseId],
      references: [fabricPurchases.id],
    }),
    fabric: one(fabrics, {
      fields: [fabricPurchaseLines.fabricId],
      references: [fabrics.id],
    }),
  }),
);

export const patternFilesRelations = relations(patternFiles, ({ one }) => ({
  product: one(products, {
    fields: [patternFiles.productId],
    references: [products.id],
  }),
}));

export const collectionLaunchesRelations = relations(
  collectionLaunches,
  ({ one }) => ({
    collection: one(collections, {
      fields: [collectionLaunches.collectionId],
      references: [collections.id],
    }),
  }),
);

export const suppliersRelations = relations(suppliers, ({ many }) => ({
  fabrics: many(fabrics),
}));

export const warehousesRelations = relations(warehouses, ({ many }) => ({
  fabricStock: many(fabricStock),
  variantStock: many(variantStock),
  fabricLots: many(fabricLots),
}));

export const usersRelations = relations(users, ({ many }) => ({
  auditEntries: many(auditLog),
  orders: many(productionOrders),
}));

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  user: one(users, { fields: [auditLog.userId], references: [users.id] }),
}));

export const accessoriesRelations = relations(accessories, ({ many }) => ({
  bomLines: many(bomAccessoryLines),
}));

export const fabricLotsRelations = relations(fabricLots, ({ one }) => ({
  fabric: one(fabrics, {
    fields: [fabricLots.fabricId],
    references: [fabrics.id],
  }),
  warehouse: one(warehouses, {
    fields: [fabricLots.warehouseId],
    references: [warehouses.id],
  }),
}));

export const variantSalesDailyRelations = relations(
  variantSalesDaily,
  ({ one }) => ({
    variant: one(productVariants, {
      fields: [variantSalesDaily.variantId],
      references: [productVariants.id],
    }),
  }),
);

export const stockMovementsRelations = relations(stockMovements, ({ one }) => ({
  variant: one(productVariants, {
    fields: [stockMovements.variantId],
    references: [productVariants.id],
  }),
  fromWarehouse: one(warehouses, {
    fields: [stockMovements.fromWarehouseId],
    references: [warehouses.id],
    relationName: "fromWarehouse",
  }),
  toWarehouse: one(warehouses, {
    fields: [stockMovements.toWarehouseId],
    references: [warehouses.id],
    relationName: "toWarehouse",
  }),
}));

// ============================================================
// ЛУНА-БОТ (Telegram) — добавлено 25.08.2026
// ============================================================

/** Категории чатов, где присутствует бот. FACTORY заложена на будущее. */
export const BOT_CHAT_TYPES = ["TEAM", "DESIGNER", "FACTORY"] as const;
export type BotChatType = (typeof BOT_CHAT_TYPES)[number];

/**
 * Каталог чатов бота — какой чат, какого типа, и для DESIGNER — какой бренд.
 * Заполняется вручную командой /привязать_чат или напрямую в базе; источник —
 * Excel-каталог чатов, который ведёт Ева.
 */
export const botChats = sqliteTable("bot_chats", {
  id: id(),
  chatId: text("chat_id").notNull().unique(), // telegram chat id (у групп отрицательный)
  title: text("title").notNull(), // название группы в Telegram на момент привязки
  chatType: text("chat_type").notNull(), // TEAM | DESIGNER | FACTORY
  brandName: text("brand_name"), // для DESIGNER — бренд/поставщик из каталога Ainur
  payerName: text("payer_name"), // юр.лицо для банка, если известно
  currency: text("currency"),
  notes: text("notes"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: now(),
});

/**
 * Люди, которые могут писать боту в личку и получать от него сообщения.
 * seesMoney=false — единственное ограничение по деньгам (Наталья), см.
 * claude/luna-telegram-bot-plan.md, раздел «Ещё три решения».
 * canConfirmMoney — уже отдельно: подтверждать денежные/ценовые действия
 * (и запись в финфайл) может только Константин и Ева, даже если видеть суммы
 * может и Ольга — это разные права, путать нельзя.
 */
export const botUsers = sqliteTable("bot_users", {
  id: id(),
  telegramUserId: text("telegram_user_id").notNull().unique(),
  telegramUsername: text("telegram_username"),
  name: text("name").notNull(), // Константин / Ева / Ольга / Наталья
  seesMoney: integer("sees_money", { mode: "boolean" }).notNull().default(true),
  canConfirmMoney: integer("can_confirm_money", { mode: "boolean" }).notNull().default(false),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: now(),
});

/** Явные команды-поручения через /задача — без угадывания из свободной переписки. */
export const BOT_TASK_STATUSES = ["OPEN", "DONE", "CANCELLED"] as const;
export type BotTaskStatus = (typeof BOT_TASK_STATUSES)[number];

export const botTasks = sqliteTable(
  "bot_tasks",
  {
    id: id(),
    chatId: text("chat_id").notNull(), // где создана
    assignedToUserId: text("assigned_to_user_id").references(() => botUsers.id, {
      onDelete: "set null",
    }),
    assignedToName: text("assigned_to_name").notNull(), // на случай если исполнитель ещё не писал /start
    assignedByName: text("assigned_by_name").notNull(),
    description: text("description").notNull(),
    dueAt: text("due_at"),
    status: text("status").notNull().default("OPEN"),
    createdAt: now(),
    completedAt: text("completed_at"),
  },
  (t) => [
    index("bot_tasks_status_idx").on(t.status),
    index("bot_tasks_assignee_idx").on(t.assignedToUserId),
  ],
);

export const botTasksRelations = relations(botTasks, ({ one }) => ({
  assignedTo: one(botUsers, {
    fields: [botTasks.assignedToUserId],
    references: [botUsers.id],
  }),
}));

/**
 * Денежные/ценовые действия по команде в боте — исполняются только после
 * явного подтверждения инлайн-кнопкой («LUNA рекомендует, человек делает»).
 * Пока нет ни одного реального action_type: запись цены в Shopify и запись в
 * финфайл ждут своих интеграций (см. открытые вопросы в плане). Таблица и
 * обработчик готовы, чтобы подключить их без переделки бота.
 */
export const BOT_PENDING_STATUSES = ["PENDING", "CONFIRMED", "CANCELLED", "EXPIRED"] as const;
export type BotPendingStatus = (typeof BOT_PENDING_STATUSES)[number];

export const botPendingActions = sqliteTable("bot_pending_actions", {
  id: id(),
  chatId: text("chat_id").notNull(),
  requestedByName: text("requested_by_name").notNull(),
  actionType: text("action_type").notNull(), // например PRICE_CHANGE, FINANCE_ENTRY
  payload: text("payload").notNull(), // JSON с деталями действия
  summary: text("summary").notNull(), // человекочитаемый текст на кнопке подтверждения
  status: text("status").notNull().default("PENDING"),
  createdAt: now(),
  resolvedAt: text("resolved_at"),
  resolvedByName: text("resolved_by_name"),
});

