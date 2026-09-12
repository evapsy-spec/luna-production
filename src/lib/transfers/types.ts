/**
 * Типы для «Перемещений», отдельно от src/lib/transfers.ts.
 *
 * Зачем отдельный файл: src/lib/transfers.ts тянет @/lib/db/client, а тот —
 * node:sqlite. Клиентский компонент таблицы (transfer-table.tsx, "use
 * client") импортирует только ТИП строки — но Turbopack всё равно падает
 * при сборке клиентского чанка ("does not support external modules
 * (request: node:sqlite)"), если тип приходит из модуля, где node:sqlite
 * есть хоть где-то в графе импортов, даже через `import type`. Вынеся типы
 * сюда — в файл без единого импорта из @/lib/db — проблема уходит
 * структурно, а не костылём.
 */
import type { Bucket } from "@/lib/transfers/logic";
import type { RouteDef } from "@/lib/transfer-routes";

export type { Bucket };

export interface TransferTableRow {
  variantId: string;
  sku: string;
  productId: string;
  productName: string;
  size: string | null;
  color: string | null;
  collectionId: string;
  collectionName: string;
  brand: string;
  /** true — товар чужого бренда (см. other_brand_*), у него нет карточки
   * /products/[id], ссылку на неё рисовать нельзя. */
  isOtherBrand: boolean;
  from: string;
  to: string;
  stock: { fotesko: number; phuket: number; phangan: number };
  negativeStock: { fotesko: boolean; phuket: boolean; phangan: boolean };
  sales: {
    phuket90: number;
    phangan90: number;
    phuket12m: number;
    phangan12m: number;
    /** для сортировки по выбранному периоду анализа */
    phuketPeriod: number;
    phanganPeriod: number;
  };
  lastSaleAtDest: string | null;
  suggestedQty: number;
  /** доступно на складе-источнике — верхняя граница для ручного ввода количества */
  maxQty: number;
  reason: string;
  bucket: Bucket;
  isNew: boolean;
  lastUnitWarning: boolean;
  hasNegativeStock: boolean;
  priority: number;
}

export interface NegativeStockIssue {
  variantId: string;
  sku: string;
  productName: string;
  warehouse: string;
  quantity: number;
}

export type AnalysisPeriod = "90d" | "6m" | "12m";

export interface TransferFilters {
  q?: string;
  brand?: string;
  collectionId?: string;
  onlySoldOut?: boolean;
  onlyLowStock?: boolean;
  onlyNew?: boolean;
  hideNoSales?: boolean;
  period?: AnalysisPeriod;
}

export interface RouteRows {
  route: RouteDef;
  rows: TransferTableRow[];
}

export interface TransferResult {
  routes: RouteRows[];
  negativeIssues: NegativeStockIssue[];
  lastUpdatedAt: string | null;
  brands: string[];
  collections: { id: string; name: string }[];
}
