/**
 * Наполняет базу демонстрационными данными на основе реальных коллекций
 * EVA MOON — чтобы приложение можно было смотреть и тестировать до
 * подключения живого Ainur API.
 *
 * Запуск: npm run db:seed
 * Полный сброс: npm run db:reset
 */
import bcrypt from "bcryptjs";
import { db, schema } from "../src/lib/db/client";

const iso = (d: Date) => d.toISOString();
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 3600 * 1000);
const daysAhead = (n: number) => new Date(Date.now() + n * 24 * 3600 * 1000);
const day = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  console.log("Наполняем базу демо-данными EVA MOON...\n");

  // ---------- Пользователи ----------
  const passwordHash = await bcrypt.hash("luna2026", 10);
  const [eva] = await db
    .insert(schema.users)
    .values({
      email: "eva@evamoon.co",
      name: "Ева",
      passwordHash,
      role: "OWNER",
    })
    .returning();
  await db.insert(schema.users).values([
    {
      email: "konstantin@evamoon.co",
      name: "Константин",
      passwordHash,
      role: "OWNER",
    },
    {
      email: "manager@evamoon.co",
      name: "Менеджер производства",
      passwordHash,
      role: "MANAGER",
    },
  ]);
  console.log("✓ Пользователи: eva@evamoon.co / konstantin@evamoon.co / manager@evamoon.co");
  console.log("  пароль у всех: luna2026\n");

  // ---------- Склады ----------
  const warehouses = await db
    .insert(schema.warehouses)
    .values([
      { name: "Панган", kind: "GOODS", country: "TH", ainurId: "demo-pangan" },
      { name: "Пхукет", kind: "GOODS", country: "TH", ainurId: "demo-phuket" },
      { name: "USA Warehouse", kind: "GOODS", country: "US", ainurId: "demo-usa" },
      { name: "Склад тканей Бали", kind: "FABRIC", country: "ID" },
      { name: "Склад тканей Панган", kind: "FABRIC", country: "TH" },
    ])
    .returning();
  const wPangan = warehouses[0];
  const wPhuket = warehouses[1];
  const wUsa = warehouses[2];
  const fabBali = warehouses[3];
  const fabPangan = warehouses[4];
  console.log(`✓ Склады: ${warehouses.length}`);

  // ---------- Поставщики ----------
  const suppliers = await db
    .insert(schema.suppliers)
    .values([
      {
        name: "Bali Silk House",
        contact: "Wayan",
        whatsapp: "6281234567890",
        address: "Jl. Raya Ubud No. 12, Bali",
        mapsLat: -8.5069,
        mapsLng: 115.2625,
        country: "ID",
        note: "Основной поставщик шёлка, красят под заказ",
      },
      {
        name: "Textile Kyiv",
        contact: "Оксана",
        whatsapp: "380671112233",
        address: "Київ, вул. Складська 4",
        country: "UA",
        note: "Вискоза и лён, оплата в USD",
      },
      {
        name: "Bangkok Fabric Market",
        contact: "Nok",
        whatsapp: "66812345678",
        address: "Sampheng Market, Bangkok",
        mapsLat: 13.7442,
        mapsLng: 100.5011,
        country: "TH",
      },
    ])
    .returning();
  console.log(`✓ Поставщики: ${suppliers.length}`);

  // ---------- Ткани ----------
  const fabrics = await db
    .insert(schema.fabrics)
    .values([
      {
        sku: "SILK-DO-140",
        name: "Шёлк Deep Ocean",
        composition: "100% silk satin",
        color: "Deep Ocean",
        isDyed: true,
        rollLengthM: 50,
        widthCm: 140,
        purchasePrice: 11.5,
        purchaseCurrency: "USD",
        fxRateToThb: 36.2,
        priceDate: iso(daysAgo(40)),
        supplierId: suppliers[0].id,
        qrToken: "fab-silk-do",
      },
      {
        sku: "SILK-LEO-140",
        name: "Шёлк Leopard Sea Blue",
        composition: "100% silk twill",
        color: "Leopard Sea Blue",
        isDyed: false,
        rollLengthM: 45,
        widthCm: 140,
        purchasePrice: 13.2,
        purchaseCurrency: "USD",
        fxRateToThb: 36.2,
        priceDate: iso(daysAgo(35)),
        supplierId: suppliers[0].id,
        qrToken: "fab-silk-leo",
      },
      {
        sku: "SILK-GOLD-140",
        name: "Шёлк Golden Mist",
        composition: "100% silk satin",
        color: "Golden Mist",
        isDyed: true,
        rollLengthM: 50,
        widthCm: 140,
        purchasePrice: 12.8,
        purchaseCurrency: "USD",
        fxRateToThb: 36.2,
        priceDate: iso(daysAgo(20)),
        supplierId: suppliers[0].id,
        qrToken: "fab-silk-gold",
      },
      {
        sku: "VISC-BLK-150",
        name: "Вискоза чёрная",
        composition: "Viscose",
        color: "Black",
        isDyed: false,
        rollLengthM: 60,
        widthCm: 150,
        purchasePrice: 320,
        purchaseCurrency: "THB",
        fxRateToThb: 1,
        priceDate: iso(daysAgo(15)),
        supplierId: suppliers[2].id,
        qrToken: "fab-visc-blk",
      },
      {
        sku: "LINEN-SAND-150",
        name: "Лён песочный",
        composition: "Linen",
        color: "Sand",
        isDyed: false,
        rollLengthM: 40,
        widthCm: 150,
        purchasePrice: 9.4,
        purchaseCurrency: "USD",
        fxRateToThb: 36.2,
        priceDate: iso(daysAgo(60)),
        supplierId: suppliers[1].id,
        isOnOrder: true,
        qrToken: "fab-linen-sand",
      },
    ])
    .returning();
  console.log(`✓ Ткани: ${fabrics.length}`);

  // Остатки тканей — намеренно оставляем «Golden Mist» в дефиците,
  // чтобы на демо было видно, как срабатывает заявка на дозакупку
  await db.insert(schema.fabricStock).values([
    { fabricId: fabrics[0].id, warehouseId: fabBali.id, onHandM: 168 },
    { fabricId: fabrics[0].id, warehouseId: fabPangan.id, onHandM: 42 },
    { fabricId: fabrics[1].id, warehouseId: fabBali.id, onHandM: 96 },
    { fabricId: fabrics[2].id, warehouseId: fabBali.id, onHandM: 12 },
    { fabricId: fabrics[3].id, warehouseId: fabPangan.id, onHandM: 210 },
    { fabricId: fabrics[4].id, warehouseId: fabBali.id, onHandM: 8 },
  ]);

  await db.insert(schema.fabricLots).values([
    {
      fabricId: fabrics[0].id,
      warehouseId: fabBali.id,
      lotCode: "LOT-SILK-DO-0142",
      lengthM: 50,
      remainingM: 34,
      arrivedAt: iso(daysAgo(38)),
    },
    {
      fabricId: fabrics[1].id,
      warehouseId: fabBali.id,
      lotCode: "LOT-SILK-LEO-0087",
      lengthM: 45,
      remainingM: 45,
      arrivedAt: iso(daysAgo(12)),
    },
  ]);

  // ---------- Фурнитура ----------
  const accessories = await db
    .insert(schema.accessories)
    .values([
      { sku: "ACC-LABEL", name: "Бирка EVA MOON", unitCost: 6, stockQty: 1800 },
      { sku: "ACC-BTN-GOLD", name: "Пуговица золотая", unitCost: 12, stockQty: 640 },
      { sku: "ACC-BELT", name: "Пояс шёлковый", unitCost: 85, stockQty: 120 },
      { sku: "ACC-PACK", name: "Упаковка подарочная", unitCost: 45, stockQty: 300 },
    ])
    .returning();
  console.log(`✓ Фурнитура: ${accessories.length}`);

  // ---------- Коллекции ----------
  const collections = await db
    .insert(schema.collections)
    .values([
      { name: "Silk collection", ainurCategoryId: "demo-silk" },
      { name: "Shiva Shakti", ainurCategoryId: "demo-shiva" },
      { name: "DESERT CHIC", ainurCategoryId: "demo-desert" },
      { name: "BOUDOIR", ainurCategoryId: "demo-boudoir" },
      { name: "For Men", ainurCategoryId: "demo-men" },
    ])
    .returning();
  const [cSilk, cShiva, cDesert, cBoudoir, cMen] = collections;
  console.log(`✓ Коллекции: ${collections.length}`);

  // ---------- Изделия и варианты ----------
  interface ProductSeed {
    collectionId: string;
    name: string;
    sewing: number;
    variants: { sku: string; color?: string; size?: string; price: number }[];
    bom: { fabricId: string; metersPerUnit: number; wastePct?: number }[];
    accessories?: { accessoryId: string; qtyPerUnit: number }[];
  }

  const productSeeds: ProductSeed[] = [
    {
      collectionId: cSilk.id,
      name: "Eva silk kimono",
      sewing: 620,
      variants: [
        { sku: "ESK-GOLD-S", color: "Golden Mist", size: "S", price: 8700 },
        { sku: "ESK-GOLD-M", color: "Golden Mist", size: "M", price: 8700 },
        { sku: "ESK-LEO-S", color: "Leopard Sea Blue", size: "S", price: 8900 },
        { sku: "ESK-LEO-M", color: "Leopard Sea Blue", size: "M", price: 8900 },
        { sku: "ESK-OCEAN-S", color: "Oceanscape", size: "S", price: 8700 },
      ],
      bom: [{ fabricId: fabrics[2].id, metersPerUnit: 2.6, wastePct: 8 }],
      accessories: [
        { accessoryId: accessories[0].id, qtyPerUnit: 1 },
        { accessoryId: accessories[3].id, qtyPerUnit: 1 },
      ],
    },
    {
      collectionId: cSilk.id,
      name: "Silk kimono blazer",
      sewing: 880,
      variants: [
        { sku: "SKB-DO-S", color: "Deep Ocean Snake", size: "S", price: 9800 },
        { sku: "SKB-DO-M", color: "Deep Ocean Snake", size: "M", price: 9800 },
        { sku: "SKB-BRZ-S", color: "Bronze Leopard", size: "S", price: 9800 },
      ],
      bom: [
        { fabricId: fabrics[0].id, metersPerUnit: 2.9, wastePct: 10 },
        { fabricId: fabrics[3].id, metersPerUnit: 1.2, wastePct: 5 },
      ],
      accessories: [
        { accessoryId: accessories[0].id, qtyPerUnit: 1 },
        { accessoryId: accessories[1].id, qtyPerUnit: 4 },
      ],
    },
    {
      collectionId: cSilk.id,
      name: "Silk flared trousers",
      sewing: 540,
      variants: [
        { sku: "SFT-BLK-S", color: "Black", size: "S", price: 6900 },
        { sku: "SFT-BLK-M", color: "Black", size: "M", price: 6900 },
        { sku: "SFT-DO-S", color: "Deep Ocean", size: "S", price: 6900 },
        { sku: "SFT-BRN-S", color: "Brown", size: "S", price: 6900 },
      ],
      bom: [{ fabricId: fabrics[0].id, metersPerUnit: 2.2, wastePct: 7 }],
      accessories: [{ accessoryId: accessories[0].id, qtyPerUnit: 1 }],
    },
    {
      collectionId: cShiva.id,
      name: "Men robe",
      sewing: 460,
      variants: [
        { sku: "SS-MR-BLK-L", color: "Black", size: "L", price: 5400 },
        { sku: "SS-MR-GRN-L", color: "Green", size: "L", price: 5400 },
        { sku: "SS-MR-BLU-M", color: "Blue", size: "M", price: 5400 },
      ],
      bom: [{ fabricId: fabrics[3].id, metersPerUnit: 2.4, wastePct: 6 }],
      accessories: [{ accessoryId: accessories[0].id, qtyPerUnit: 1 }],
    },
    {
      collectionId: cShiva.id,
      name: "Shakti kimono",
      sewing: 520,
      variants: [
        { sku: "SS-SK-SUN-S", color: "Sun", size: "S", price: 6200 },
        { sku: "SS-SK-MOON-S", color: "Moon", size: "S", price: 6200 },
        { sku: "SS-SK-ICE-M", color: "Ice", size: "M", price: 6200 },
      ],
      bom: [{ fabricId: fabrics[1].id, metersPerUnit: 2.5, wastePct: 8 }],
      accessories: [{ accessoryId: accessories[0].id, qtyPerUnit: 1 }],
    },
    {
      collectionId: cShiva.id,
      name: "Men boxers",
      sewing: 180,
      variants: [
        { sku: "SS-BX-BLK-L", color: "Black", size: "L", price: 1800 },
        { sku: "SS-BX-GRN-L", color: "Green", size: "L", price: 1800 },
      ],
      bom: [{ fabricId: fabrics[3].id, metersPerUnit: 0.8, wastePct: 5 }],
    },
    {
      collectionId: cDesert.id,
      name: "Kimono Desert Chic",
      sewing: 940,
      variants: [
        { sku: "DC-KIM-BRZ-S", color: "Bronze", size: "S", price: 11400 },
        { sku: "DC-KIM-BRZ-M", color: "Bronze", size: "M", price: 11400 },
      ],
      bom: [{ fabricId: fabrics[4].id, metersPerUnit: 3.1, wastePct: 9 }],
      accessories: [{ accessoryId: accessories[2].id, qtyPerUnit: 1 }],
    },
    {
      collectionId: cDesert.id,
      name: "Split Harem Pants",
      sewing: 610,
      variants: [
        { sku: "DC-SHP-BRZ-S", color: "Bronze", size: "S", price: 7200 },
        { sku: "DC-SHP-BRZ-M", color: "Bronze", size: "M", price: 7200 },
      ],
      bom: [{ fabricId: fabrics[4].id, metersPerUnit: 2.4, wastePct: 7 }],
    },
    {
      collectionId: cBoudoir.id,
      name: "Ruffle Cropped Top",
      sewing: 320,
      variants: [
        { sku: "BD-RCT-BLK-S", color: "Black", size: "S", price: 3400 },
        { sku: "BD-RCT-BLK-M", color: "Black", size: "M", price: 3400 },
      ],
      bom: [{ fabricId: fabrics[3].id, metersPerUnit: 1.1, wastePct: 6 }],
    },
    {
      collectionId: cMen.id,
      name: "ULTRALIGHT",
      sewing: 380,
      variants: [
        { sku: "FM-UL-WHT-L", color: "White", size: "L", price: 3900 },
        { sku: "FM-UL-BLK-L", color: "Black", size: "L", price: 3900 },
        { sku: "FM-UL-BLK-XL", color: "Black", size: "XL", price: 3900 },
      ],
      bom: [{ fabricId: fabrics[4].id, metersPerUnit: 1.6, wastePct: 5 }],
    },
  ];

  const variantIdBySku = new Map<string, string>();
  const productIdByName = new Map<string, string>();

  for (const seed of productSeeds) {
    const [product] = await db
      .insert(schema.products)
      .values({
        collectionId: seed.collectionId,
        name: seed.name,
        baseSku: seed.variants[0].sku.split("-").slice(0, 2).join("-"),
        defaultSewingCost: seed.sewing,
      })
      .returning();
    productIdByName.set(seed.name, product.id);

    for (const v of seed.variants) {
      const [variant] = await db
        .insert(schema.productVariants)
        .values({
          productId: product.id,
          sku: v.sku,
          color: v.color ?? null,
          size: v.size ?? null,
          price: v.price,
          qrToken: `var-${v.sku.toLowerCase()}`,
        })
        .returning();
      variantIdBySku.set(v.sku, variant.id);
    }

    for (const b of seed.bom) {
      await db.insert(schema.bomFabricLines).values({
        productId: product.id,
        fabricId: b.fabricId,
        metersPerUnit: b.metersPerUnit,
        wastePct: b.wastePct ?? 0,
      });
    }
    for (const a of seed.accessories ?? []) {
      await db.insert(schema.bomAccessoryLines).values({
        productId: product.id,
        accessoryId: a.accessoryId,
        qtyPerUnit: a.qtyPerUnit,
      });
    }
  }
  console.log(
    `✓ Изделия: ${productSeeds.length}, вариантов (SKU): ${variantIdBySku.size}`,
  );

  // ---------- Остатки готовой продукции ----------
  // Shiva Shakti в основном лежит в США — это норма: коллекция продаётся
  // через Etsy/Shopify американским покупателям.
  const stockPlan: [string, string, number][] = [
    ["ESK-GOLD-S", wPangan.id, 4],
    ["ESK-GOLD-M", wPangan.id, 2],
    ["ESK-LEO-S", wPangan.id, 11],
    ["ESK-LEO-M", wPhuket.id, 9],
    ["ESK-OCEAN-S", wPhuket.id, 18],
    ["SKB-DO-S", wPangan.id, 6],
    ["SKB-DO-M", wPangan.id, 3],
    ["SKB-BRZ-S", wPhuket.id, 14],
    ["SFT-BLK-S", wPangan.id, 7],
    ["SFT-BLK-M", wPhuket.id, 5],
    ["SFT-DO-S", wPangan.id, 4],
    ["SFT-BRN-S", wPhuket.id, 16],
    ["SS-MR-BLK-L", wUsa.id, 62],
    ["SS-MR-GRN-L", wUsa.id, 48],
    ["SS-MR-BLU-M", wUsa.id, 31],
    ["SS-SK-SUN-S", wUsa.id, 44],
    ["SS-SK-MOON-S", wUsa.id, 39],
    ["SS-SK-ICE-M", wPangan.id, 8],
    ["SS-BX-BLK-L", wUsa.id, 96],
    ["SS-BX-GRN-L", wUsa.id, 74],
    ["DC-KIM-BRZ-S", wPangan.id, 5],
    ["DC-KIM-BRZ-M", wPangan.id, 3],
    ["DC-SHP-BRZ-S", wPangan.id, 9],
    ["DC-SHP-BRZ-M", wPhuket.id, 6],
    ["BD-RCT-BLK-S", wPangan.id, 12],
    ["BD-RCT-BLK-M", wPhuket.id, 1],
    ["FM-UL-WHT-L", wPangan.id, 21],
    ["FM-UL-BLK-L", wPangan.id, 17],
    ["FM-UL-BLK-XL", wPhuket.id, 4],
    // один и тот же SKU на двух складах с разной скоростью продаж —
    // на этих позициях видно, как работают рекомендации по перемещению
    ["ESK-LEO-S", wPhuket.id, 26],
    ["FM-UL-BLK-L", wPhuket.id, 29],
    ["SS-SK-ICE-M", wPhuket.id, 22],
    // мёртвый груз на Пангане при живых продажах на Пхукете —
    // на этой позиции видно рекомендацию по перемещению
    ["BD-RCT-BLK-M", wPangan.id, 48],
  ];
  for (const [sku, warehouseId, quantity] of stockPlan) {
    const variantId = variantIdBySku.get(sku);
    if (!variantId) continue;
    await db
      .insert(schema.variantStock)
      .values({ variantId, warehouseId, quantity });
  }
  console.log(`✓ Остатки готовой продукции: ${stockPlan.length} позиций`);

  // ---------- Продажи за 120 дней ----------
  // Скорость подобрана так, чтобы на демо были видны все случаи:
  // что-то заканчивается (нужно шить), что-то лежит мёртвым грузом.
  const velocity: Record<string, number> = {
    "ESK-GOLD-S": 3.2,
    "ESK-GOLD-M": 2.8,
    "ESK-LEO-S": 3.6,
    "ESK-LEO-M": 2.4,
    "ESK-OCEAN-S": 0.3,
    "SKB-DO-S": 2.1,
    "SKB-DO-M": 1.6,
    "SKB-BRZ-S": 0.5,
    "SFT-BLK-S": 2.4,
    "SFT-BLK-M": 1.9,
    "SFT-DO-S": 2.0,
    "SFT-BRN-S": 0.6,
    "SS-MR-BLK-L": 5.4,
    "SS-MR-GRN-L": 4.1,
    "SS-MR-BLU-M": 2.6,
    "SS-SK-SUN-S": 3.8,
    "SS-SK-MOON-S": 3.1,
    "SS-SK-ICE-M": 1.4,
    "SS-BX-BLK-L": 7.2,
    "SS-BX-GRN-L": 5.8,
    "DC-KIM-BRZ-S": 1.2,
    "DC-KIM-BRZ-M": 0.9,
    "DC-SHP-BRZ-S": 1.6,
    "DC-SHP-BRZ-M": 1.1,
    "BD-RCT-BLK-S": 2.2,
    "BD-RCT-BLK-M": 1.8,
    "FM-UL-WHT-L": 6.4,
    "FM-UL-BLK-L": 5.9,
    "FM-UL-BLK-XL": 2.1,
  };
  const priceBySku = new Map<string, number>();
  for (const seed of productSeeds)
    for (const v of seed.variants) priceBySku.set(v.sku, v.price);

  // детерминированный «шум», чтобы графики не были идеально ровными
  let noiseSeed = 42;
  const noise = () => {
    noiseSeed = (noiseSeed * 1103515245 + 12345) % 2147483648;
    return noiseSeed / 2147483648;
  };

  let salesRows = 0;
  const warehouseChoices = [wPangan.id, wPhuket.id, wUsa.id];
  for (let d = 120; d >= 0; d--) {
    const date = daysAgo(d);
    for (const [sku, perMonth] of Object.entries(velocity)) {
      const variantId = variantIdBySku.get(sku);
      if (!variantId) continue;
      const perDay = perMonth / 30.4;
      // вероятностная продажа: получаем реалистичную разреженность по дням
      const units = noise() < perDay ? 1 + (noise() < 0.15 ? 1 : 0) : 0;
      if (units === 0) continue;

      const price = priceBySku.get(sku) ?? 5000;
      const isShiva = sku.startsWith("SS-");
      const warehouseId = isShiva
        ? wUsa.id
        : warehouseChoices[Math.floor(noise() * 2)];

      await db.insert(schema.variantSalesDaily).values({
        variantId,
        warehouseId,
        day: day(date),
        units,
        revenue: price * units,
        cost: price * units * 0.32,
      });
      salesRows++;
    }
  }
  console.log(`✓ Продажи: ${salesRows} записей за 120 дней`);

  // ---------- Снимки остатков (динамика склада) ----------
  for (let weeks = 12; weeks >= 0; weeks--) {
    const takenAt = iso(daysAgo(weeks * 7));
    const drift = 1 + (weeks - 6) * 0.02;
    await db.insert(schema.stockSnapshots).values({
      takenAt,
      scope: "total",
      refId: null,
      quantity: Math.round(620 * drift),
    });
    for (const c of collections) {
      await db.insert(schema.stockSnapshots).values({
        takenAt,
        scope: "collection",
        refId: c.id,
        quantity: Math.round((80 + noise() * 120) * drift),
      });
    }
  }
  console.log("✓ Снимки остатков за 12 недель");

  // ---------- Фабрики ----------
  const factories = await db
    .insert(schema.factories)
    .values([
      {
        name: "Fotesko Production",
        specialization: "Шёлк, кимоно, сложный крой",
        contact: "Putu",
        whatsapp: "6281100002222",
        address: "Jl. Pantai Berawa, Canggu, Bali",
        mapsLat: -8.6549,
        mapsLng: 115.1382,
        country: "ID",
        monthlyCapacityUnits: 450,
        note: "Основная фабрика, работаем с 2024",
      },
      {
        name: "Ryan Bali Garment (Джонни)",
        specialization: "Вискоза, мужская линия, трикотаж",
        contact: "Johnny",
        whatsapp: "6281233334444",
        address: "Jl. Sunset Road, Kuta, Bali",
        mapsLat: -8.7167,
        mapsLng: 115.1789,
        country: "ID",
        monthlyCapacityUnits: 700,
        note: "Дешевле по мужской линии, сроки плавают",
      },
      {
        name: "Phuket Atelier",
        specialization: "Мелкие партии, образцы, доработки",
        contact: "Mai",
        whatsapp: "66898887777",
        address: "Rawai, Phuket",
        mapsLat: 7.7745,
        mapsLng: 98.3245,
        country: "TH",
        monthlyCapacityUnits: 120,
      },
    ])
    .returning();
  const [fFotesko, fJohnny, fPhuket] = factories;
  console.log(`✓ Фабрики: ${factories.length}`);

  // какие коллекции где шьются (Silk — на двух фабриках сразу)
  await db.insert(schema.factoryCollections).values([
    { factoryId: fFotesko.id, collectionId: cSilk.id },
    { factoryId: fFotesko.id, collectionId: cDesert.id },
    { factoryId: fFotesko.id, collectionId: cBoudoir.id },
    { factoryId: fJohnny.id, collectionId: cShiva.id },
    { factoryId: fJohnny.id, collectionId: cMen.id },
    { factoryId: fJohnny.id, collectionId: cSilk.id },
    { factoryId: fPhuket.id, collectionId: cBoudoir.id },
  ]);

  // цены пошива по парам фабрика–изделие
  const pricePlan: [string, string, number][] = [
    [fFotesko.id, "Eva silk kimono", 620],
    [fFotesko.id, "Silk kimono blazer", 880],
    [fFotesko.id, "Silk flared trousers", 540],
    [fFotesko.id, "Kimono Desert Chic", 940],
    [fFotesko.id, "Split Harem Pants", 610],
    [fFotesko.id, "Ruffle Cropped Top", 320],
    [fJohnny.id, "Men robe", 430],
    [fJohnny.id, "Shakti kimono", 495],
    [fJohnny.id, "Men boxers", 165],
    [fJohnny.id, "ULTRALIGHT", 355],
    [fJohnny.id, "Eva silk kimono", 690],
    [fPhuket.id, "Ruffle Cropped Top", 390],
  ];
  for (const [factoryId, productName, pricePerUnit] of pricePlan) {
    const productId = productIdByName.get(productName);
    if (!productId) continue;
    await db
      .insert(schema.factoryPrices)
      .values({ factoryId, productId, pricePerUnit });
  }
  console.log(`✓ Цены пошива: ${pricePlan.length}`);

  // ---------- Заказы на пошив ----------
  // 1) Заказ в производстве с резервом ткани
  const [order1] = await db
    .insert(schema.productionOrders)
    .values({
      number: "PO-2026-001",
      createdAt: iso(daysAgo(52)),
      factoryId: fFotesko.id,
      status: "IN_PRODUCTION",
      sampleRequestedAt: iso(daysAgo(48)),
      sampleApprovedAt: iso(daysAgo(41)),
      plannedReadyAt: iso(daysAhead(9)),
      horizonMonths: 3,
      snapshotFabricCost: 47_800,
      snapshotAccessoryCost: 1_640,
      snapshotSewingCost: 39_200,
      snapshotTotalCost: 88_640,
      createdById: eva.id,
      note: "Летняя допартия шёлка под высокий сезон",
    })
    .returning();

  await db.insert(schema.productionOrderLines).values([
    {
      orderId: order1.id,
      productId: productIdByName.get("Eva silk kimono")!,
      variantId: variantIdBySku.get("ESK-LEO-S")!,
      size: "S",
      quantity: 24,
      unitSewingCost: 620,
      unitFabricCost: 1_290,
      plannedReadyAt: iso(daysAhead(9)),
      qtyProduced: 18,
    },
    {
      orderId: order1.id,
      productId: productIdByName.get("Silk kimono blazer")!,
      variantId: variantIdBySku.get("SKB-DO-S")!,
      size: "S",
      quantity: 16,
      unitSewingCost: 880,
      unitFabricCost: 1_540,
      plannedReadyAt: iso(daysAhead(9)),
      qtyProduced: 10,
    },
  ]);

  await db.insert(schema.fabricReservations).values([
    {
      fabricId: fabrics[2].id,
      warehouseId: fabBali.id,
      orderId: order1.id,
      meters: 67.4,
    },
    {
      fabricId: fabrics[0].id,
      warehouseId: fabBali.id,
      orderId: order1.id,
      meters: 51.0,
    },
  ]);

  await db.insert(schema.orderPayments).values([
    {
      orderId: order1.id,
      kind: "DEPOSIT",
      amount: 44_320,
      paidAt: iso(daysAgo(40)),
      invoiceNo: "INV-019",
      note: "Аванс 50%",
    },
  ]);

  // 2) Заказ на этапе образца
  const [order2] = await db
    .insert(schema.productionOrders)
    .values({
      number: "PO-2026-002",
      createdAt: iso(daysAgo(7)),
      factoryId: fJohnny.id,
      status: "SAMPLE",
      sampleRequestedAt: iso(daysAgo(6)),
      plannedReadyAt: iso(daysAhead(34)),
      horizonMonths: 3,
      snapshotFabricCost: 26_500,
      snapshotAccessoryCost: 900,
      snapshotSewingCost: 31_450,
      snapshotTotalCost: 58_850,
      createdById: eva.id,
      note: "Мужская линия под рост Shiva Shakti, ждём образец",
    })
    .returning();

  await db.insert(schema.productionOrderLines).values([
    {
      orderId: order2.id,
      productId: productIdByName.get("Men robe")!,
      variantId: variantIdBySku.get("SS-MR-BLK-L")!,
      size: "L",
      quantity: 40,
      unitSewingCost: 430,
      unitFabricCost: 814,
      plannedReadyAt: iso(daysAhead(34)),
    },
    {
      orderId: order2.id,
      productId: productIdByName.get("Men boxers")!,
      variantId: variantIdBySku.get("SS-BX-BLK-L")!,
      size: "L",
      quantity: 80,
      unitSewingCost: 165,
      unitFabricCost: 271,
      plannedReadyAt: iso(daysAhead(34)),
    },
  ]);

  // 3) Завершённый заказ с браком — кредит ещё не зачтён
  const [order3] = await db
    .insert(schema.productionOrders)
    .values({
      number: "PO-2025-014",
      createdAt: iso(daysAgo(145)),
      factoryId: fJohnny.id,
      status: "RECEIVED",
      sampleRequestedAt: iso(daysAgo(140)),
      sampleApprovedAt: iso(daysAgo(133)),
      plannedReadyAt: iso(daysAgo(95)),
      actualReadyAt: iso(daysAgo(88)), // сдали с опозданием — видно в скоркарде
      snapshotFabricCost: 18_900,
      snapshotAccessoryCost: 720,
      snapshotSewingCost: 21_300,
      snapshotTotalCost: 40_920,
      createdById: eva.id,
    })
    .returning();

  const [order3line] = await db
    .insert(schema.productionOrderLines)
    .values({
      orderId: order3.id,
      productId: productIdByName.get("ULTRALIGHT")!,
      variantId: variantIdBySku.get("FM-UL-BLK-L")!,
      size: "L",
      quantity: 60,
      unitSewingCost: 355,
      unitFabricCost: 315,
      plannedReadyAt: iso(daysAgo(95)),
      qtyProduced: 60,
      qtyDefect: 4,
    })
    .returning();

  await db.insert(schema.defectCredits).values({
    orderId: order3.id,
    factoryId: fJohnny.id,
    orderLineId: order3line.id,
    quantity: 4,
    amount: 4 * (355 + 315),
    reason: "Кривой шов на планке, 4 шт не пошли в продажу",
  });

  await db.insert(schema.orderPayments).values([
    {
      orderId: order3.id,
      kind: "DEPOSIT",
      amount: 20_460,
      paidAt: iso(daysAgo(130)),
      invoiceNo: "INV-014",
    },
    {
      orderId: order3.id,
      kind: "BALANCE",
      amount: 20_460,
      paidAt: iso(daysAgo(86)),
      invoiceNo: "INV-014",
    },
  ]);

  // 4) Заказ, сданный вовремя — чтобы скоркард не был на 100% плохим
  const [order4] = await db
    .insert(schema.productionOrders)
    .values({
      number: "PO-2025-011",
      createdAt: iso(daysAgo(186)),
      factoryId: fFotesko.id,
      status: "RECEIVED",
      sampleApprovedAt: iso(daysAgo(180)),
      plannedReadyAt: iso(daysAgo(150)),
      actualReadyAt: iso(daysAgo(152)),
      snapshotFabricCost: 52_100,
      snapshotAccessoryCost: 2_100,
      snapshotSewingCost: 44_600,
      snapshotTotalCost: 98_800,
      createdById: eva.id,
    })
    .returning();
  await db.insert(schema.productionOrderLines).values({
    orderId: order4.id,
    productId: productIdByName.get("Eva silk kimono")!,
    variantId: variantIdBySku.get("ESK-GOLD-S")!,
    size: "S",
    quantity: 52,
    unitSewingCost: 620,
    unitFabricCost: 1_290,
    plannedReadyAt: iso(daysAgo(150)),
    qtyProduced: 52,
    qtyDefect: 1,
  });
  await db.insert(schema.orderPayments).values({
    orderId: order4.id,
    kind: "FULL",
    amount: 98_800,
    paidAt: iso(daysAgo(148)),
    invoiceNo: "INV-011",
  });

  console.log("✓ Заказы на пошив: 4 (в производстве, образец, 2 завершённых)");

  // ---------- Заявка на дозакупку ткани ----------
  const [purchase] = await db
    .insert(schema.fabricPurchases)
    .values({
      number: "FP-2026-003",
      status: "DRAFT",
      reason: "Нехватка под заказ PO-2026-001",
      orderId: order1.id,
      supplierId: suppliers[0].id,
    })
    .returning();
  await db.insert(schema.fabricPurchaseLines).values([
    {
      purchaseId: purchase.id,
      fabricId: fabrics[2].id,
      metersNeeded: 55.4,
      note: "Шёлк Golden Mist — на складе всего 12 м",
    },
  ]);
  console.log("✓ Заявка на дозакупку: 1 черновик");

  // ---------- Календарь запуска коллекций ----------
  await db.insert(schema.collectionLaunches).values([
    {
      collectionId: cSilk.id,
      season: "High Season 2027",
      targetOnSaleAt: iso(daysAhead(120)),
      leadTimeDays: 50,
      productionStartBy: iso(daysAhead(70)),
      note: "Обновить цветовую линейку: Deep Ocean и анималистика",
    },
    {
      collectionId: cShiva.id,
      season: "US Holiday 2026",
      targetOnSaleAt: iso(daysAhead(75)),
      leadTimeDays: 45,
      productionStartBy: iso(daysAhead(30)),
      note: "Основной объём под Etsy/Shopify США",
    },
    {
      collectionId: cDesert.id,
      season: "Resort 2027",
      targetOnSaleAt: iso(daysAhead(200)),
      leadTimeDays: 55,
      productionStartBy: iso(daysAhead(145)),
      note: "Добавить 1–2 тона к бронзе",
    },
  ]);
  console.log("✓ Календарь запуска: 3 коллекции");

  // ---------- Настройки ----------
  await db.insert(schema.settings).values([
    { key: "default_horizon_months", value: "3" },
    { key: "velocity_window_days", value: "90" },
    { key: "overstock_months_threshold", value: "6" },
    { key: "demo_data", value: "true" },
  ]);

  console.log("\nГотово. Запустите: npm run dev → http://localhost:3000");
  console.log("Вход: eva@evamoon.co / luna2026");
}

main().catch((err) => {
  console.error("\nОшибка при наполнении базы:", err);
  process.exit(1);
});
