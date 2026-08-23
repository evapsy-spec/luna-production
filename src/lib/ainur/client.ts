/**
 * Клиент Ainur Connect API v4.
 *
 * База: https://connect.ainur.app/api/v4
 * Авторизация: заголовок X-AINUR-API-Access-Token
 * Документация: https://connect.ainur.app/api/documentation
 *
 * Терминология API (смоделирована по Shopify):
 *   группа Ainur (= наша коллекция)  → ext-category
 *   категории/теги Ainur             → ext-tags
 *   склад/точка                      → store
 *
 * Для Luna Production нужен токен уровня Readonly — мы только читаем.
 */

const DEFAULT_BASE = "https://connect.ainur.app/api/v4";

export class AinurError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly endpoint?: string,
  ) {
    super(message);
    this.name = "AinurError";
  }
}

// ---------- Типы ответов (по OpenAPI-схеме Connect API) ----------

export interface AinurStore {
  id: string;
  name?: string;
  address?: string;
  [k: string]: unknown;
}

export interface AinurProduct {
  id: string;
  published_at?: string;
  updated_at?: string;
  options?: { id?: string; uuid?: string; name?: string; description?: string | null };
  is_variable?: boolean;
  variation?: {
    id?: string;
    name?: string;
    property?: { key?: string; value?: string }[];
  } | null;
  sku?: string;
  barcode?: string;
  plu_code?: string;
  /** ключ синхронизации — совпадает с SKU в каталоге EVA MOON */
  code?: string;
  unit?: string;
  price?: number;
  discount?: number;
  /** остаток по складам: { <store_id>: количество } */
  stock?: Record<string, number>;
  /** цена по складам: { <store_id>: цена } */
  store_prices?: Record<string, number> | null;
  in_stock?: boolean;
  tags?: unknown;
  category_id?: string;
  img?: string;
  components?: unknown;
}

export interface AinurCategory {
  id: string;
  name?: string;
  [k: string]: unknown;
}

export interface AinurLineItem {
  product_id?: string;
  variant_id?: string;
  sku?: string;
  code?: string;
  name?: string;
  /** ВНИМАНИЕ: в документах продаж количество приходит отрицательным (-1) */
  quantity?: number;
  /** цена за единицу, положительная */
  price?: number;
  total?: number;
  cost?: number;
  /** название товара — единственный ориентир у строк без SKU */
  title?: string;
  variant_title?: string | null;
  vendor?: string | null;
  total_discount?: number | string;
  /** итог по строке уже с учётом скидки — самый надёжный источник выручки */
  legacy_line?: {
    sum?: number;
    sub?: number;
    price?: number;
    qty?: number;
    discount_sum?: number;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

export interface AinurDocument {
  id: string;
  uuid?: string;
  name?: string;
  order_number?: string;
  created_at?: string;
  updated_at?: string;
  processed_at?: string;
  financial_status?: string;
  total_price?: number;
  note?: string;
  location_id?: string;
  user_id?: string;
  line_items?: AinurLineItem[];
  /** склад-источник (для перемещений) */
  source?: { id?: string; name?: string } | string | null;
  /** склад-получатель (для перемещений) */
  destination?: { id?: string; name?: string } | string | null;
  document_flags?: unknown;
  metrics?: unknown;
  timeline?: unknown;
  references?: unknown;
  actor?: unknown;
}

export interface DateRange {
  /** ISO-строка или YYYY-MM-DD */
  timeStart?: string;
  timeEnd?: string;
}

// ---------- Клиент ----------

export interface AinurClientOptions {
  token: string;
  baseUrl?: string;
  /** пауза между страницами, мс — щадим API, лимиты в доках не указаны */
  pageDelayMs?: number;
  /** сколько записей за страницу */
  pageSize?: number;
}

export class AinurClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly pageDelayMs: number;
  private readonly pageSize: number;

  constructor(opts: AinurClientOptions) {
    if (!opts.token) {
      throw new AinurError(
        "Токен Ainur не задан. Откройте страницу «Синхронизация» — там есть " +
          "поле для токена и инструкция, где его взять в AinurPOS.",
      );
    }
    this.token = opts.token;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/$/, "");
    this.pageDelayMs = opts.pageDelayMs ?? 250;
    // Ainur ограничивает limit сотней: у /documents/* больший размер страницы
    // отклоняется с 422 «The limit field must not be greater than 100».
    this.pageSize = Math.min(opts.pageSize ?? 100, 100);
  }

  private async request<T>(
    path: string,
    query: Record<string, string | number | string[] | undefined> = {},
  ): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const v of value) url.searchParams.append(key, v);
      } else {
        url.searchParams.set(key, String(value));
      }
    }

    let lastError: unknown;
    // Пара повторов: сетевые сбои и 429/5xx — не повод валить всю синхронизацию
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, {
          headers: {
            "X-AINUR-API-Access-Token": this.token,
            Accept: "application/json",
          },
          cache: "no-store",
        });

        if (res.status === 401 || res.status === 403) {
          throw new AinurError(
            `Ainur отклонил токен (${res.status}). Скорее всего токен скопирован ` +
              `не полностью, уже удалён в Ainur или у него слишком низкий уровень ` +
              `доступа. Сгенерируйте новый в AinurPOS → Integration → Connect API ` +
              `с уровнем Readonly и вставьте заново.`,
            res.status,
            path,
          );
        }

        if (res.status === 429 || res.status >= 500) {
          // ждём с увеличением паузы и пробуем снова
          await sleep(500 * Math.pow(2, attempt));
          lastError = new AinurError(
            `Ainur вернул ${res.status} на ${path}`,
            res.status,
            path,
          );
          continue;
        }

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new AinurError(
            `Ainur вернул ${res.status} на ${path}: ${body.slice(0, 200)}`,
            res.status,
            path,
          );
        }

        return (await res.json()) as T;
      } catch (err) {
        if (err instanceof AinurError && err.status && err.status < 500) throw err;
        lastError = err;
        await sleep(500 * Math.pow(2, attempt));
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new AinurError(`Не удалось получить ${path}`, undefined, path);
  }

  /**
   * Проверка токена и доступности API — для кнопки «Проверить подключение».
   *
   * Пробуем несколько эндпоинтов по очереди. Проверять только /company нельзя:
   * токену уровня Readonly данные компании закрыты, он получает 403 — и рабочий
   * токен выглядел бы как неверный. Успех на любом читаемом эндпоинте означает,
   * что токен принят.
   */
  async ping(): Promise<{ ok: boolean; company?: string; error?: string }> {
    const attempts: { path: string; label: string }[] = [
      { path: "/company", label: "" },
      { path: "/stores", label: "склады читаются" },
      { path: "/product/ext-categories", label: "коллекции читаются" },
    ];

    let lastError = "";
    for (const attempt of attempts) {
      try {
        const data = await this.request<unknown>(attempt.path, {
          ...(attempt.path === "/product/ext-categories"
            ? { limit: 1, offset: 0 }
            : {}),
        });

        if (attempt.path === "/company") {
          const c = data as { id?: string; email?: string; name?: string };
          return { ok: true, company: c.name ?? c.email ?? c.id };
        }
        const count = unwrapList<unknown>(data).length;
        return {
          ok: true,
          company: `${attempt.label} (получено записей: ${count})`,
        };
      } catch (err) {
        lastError = (err as Error).message;
        // 401 — токен точно негодный, дальше пробовать нечего
        if (err instanceof AinurError && err.status === 401) break;
      }
    }
    return { ok: false, error: lastError || "не удалось проверить подключение" };
  }

  /** Склады и точки продаж — нужны, чтобы связать ID из stock с названием */
  async getStores(): Promise<AinurStore[]> {
    const data = await this.request<AinurStore[] | { data?: AinurStore[] }>("/stores");
    const list = unwrapList<AinurStore>(data);
    // Если список пуст, запоминаем форму ответа: значит либо структура не та,
    // что мы разбираем, либо токену склады не отдают. Без этого «прочитано 0»
    // ничего не объясняет.
    if (list.length === 0) this.lastEmptyShape = describeShape(data);
    return list;
  }

  /** Форма последнего пустого ответа — для понятного сообщения в интерфейсе */
  lastEmptyShape: string | null = null;

  /** Коллекции (группы Ainur) */
  async getCategories(): Promise<AinurCategory[]> {
    const data = await this.request<AinurCategory[] | { data?: AinurCategory[] }>(
      "/product/ext-categories",
    );
    return unwrapList<AinurCategory>(data);
  }

  /**
   * Все товары с остатками по складам.
   * Остаток приходит прямо в поле stock — отдельных запросов на склад не нужно.
   */
  async getAllProducts(
    onPage?: (items: AinurProduct[], total: number) => void,
  ): Promise<AinurProduct[]> {
    return this.paginate<AinurProduct>("/product", {}, onPage);
  }

  /** Только изменённые товары — для быстрой инкрементальной синхронизации */
  async getUpdatedProducts(since: string): Promise<AinurProduct[]> {
    return this.paginate<AinurProduct>("/product/updated", {
      time_start: toApiDate(since),
    });
  }

  /** Удалённые товары — чтобы архивировать их у себя */
  async getDeletedProducts(since?: string): Promise<AinurProduct[]> {
    return this.paginate<AinurProduct>("/product/deleted", {
      time_start: since ? toApiDate(since) : undefined,
    });
  }

  /**
   * Документы продаж за период.
   * ВАЖНО: у Ainur ограничение — период не больше 31 дня за один запрос,
   * поэтому длинные интервалы нарезаем на месячные окна (см. splitRange).
   */
  async getSales(range: DateRange, stores?: string[]): Promise<AinurDocument[]> {
    const out: AinurDocument[] = [];
    for (const window of splitRange(range, 30)) {
      const chunk = await this.paginate<AinurDocument>("/documents/sales", {
        time_start: window.timeStart,
        time_end: window.timeEnd,
        "access_stores[]": stores,
      });
      out.push(...chunk);
    }
    return out;
  }

  /**
   * Документы изменения остатков — здесь живут перемещения между складами
   * (поля source → destination). То же ограничение в 31 день.
   */
  async getStockChanges(range: DateRange): Promise<AinurDocument[]> {
    const out: AinurDocument[] = [];
    for (const window of splitRange(range, 30)) {
      const chunk = await this.paginate<AinurDocument>("/documents/changes", {
        time_start: window.timeStart,
        time_end: window.timeEnd,
        include_inventory_move: 1,
      });
      out.push(...chunk);
    }
    return out;
  }

  /** Документы закупок — для аналитики себестоимости */
  async getPurchases(range: DateRange): Promise<AinurDocument[]> {
    const out: AinurDocument[] = [];
    for (const window of splitRange(range, 30)) {
      const chunk = await this.paginate<AinurDocument>("/documents/purchases", {
        time_start: window.timeStart,
        time_end: window.timeEnd,
      });
      out.push(...chunk);
    }
    return out;
  }

  /** Постраничный обход через offset/limit до пустой страницы */
  private async paginate<T>(
    path: string,
    query: Record<string, string | number | string[] | undefined>,
    onPage?: (items: T[], total: number) => void,
  ): Promise<T[]> {
    const all: T[] = [];
    let offset = 0;

    // предохранитель от бесконечного цикла, если API проигнорирует offset
    for (let page = 0; page < 500; page++) {
      const raw = await this.request<T[] | { data?: T[] }>(path, {
        ...query,
        offset,
        limit: this.pageSize,
      });
      const items = unwrapList<T>(raw);
      all.push(...items);
      onPage?.(items, all.length);

      if (items.length < this.pageSize) break;
      offset += this.pageSize;
      if (this.pageDelayMs) await sleep(this.pageDelayMs);
    }
    return all;
  }
}

/** Создаёт клиент из переменных окружения */
export function ainurFromEnv(): AinurClient {
  return new AinurClient({
    token: process.env.AINUR_API_TOKEN ?? "",
    baseUrl: process.env.AINUR_API_BASE,
  });
}

export function isAinurConfigured(): boolean {
  return Boolean(process.env.AINUR_API_TOKEN);
}

// ---------- Вспомогательные ----------

/**
 * Приведение значений из API к ожидаемым типам.
 *
 * Ainur не всегда присылает то, что обещает схема: например, у товара без
 * фотографии поле img приходит пустым МАССИВОМ, а не строкой. Драйвер базы
 * такое значение привязать не может и падает с «Provided value cannot be
 * bound to SQLite parameter N» — на этом молча ложилась вся синхронизация.
 * Поэтому всё, что идёт из API в базу, прогоняем через эти функции.
 */
export function asString(value: unknown): string | null {
  if (typeof value === "string") {
    const t = value.trim();
    return t === "" ? null : t;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  // массивы, объекты, null, undefined, boolean — значения нет
  return null;
}

export function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const t = value.trim();
    // Number("") === 0, поэтому пустую строку отсекаем явно: пустое поле
    // означает «значения нет», а не «ноль».
    if (t === "") return null;
    const n = Number(t.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function asInt(value: unknown): number {
  const n = asNumber(value);
  return n === null ? 0 : Math.round(n);
}

/** Короткое описание структуры ответа: тип и ключи верхнего уровня */
export function describeShape(raw: unknown): string {
  if (raw === null) return "null";
  if (Array.isArray(raw)) return `массив, элементов: ${raw.length}`;
  if (typeof raw === "object") {
    const keys = Object.keys(raw as Record<string, unknown>);
    return `объект с ключами: ${keys.slice(0, 12).join(", ") || "(нет)"}`;
  }
  return typeof raw;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** API может отдавать либо массив, либо { data: [...] } — принимаем оба */
function unwrapList<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    // Ainur не единообразен: склады лежат в "shops", товары в "products".
    // Проверяем известные варианты, потом — единственный массив в объекте.
    for (const key of [
      "data",
      "items",
      "result",
      "results",
      "products",
      "documents",
      "shops",
      "stores",
      "categories",
      "list",
      "rows",
    ]) {
      if (Array.isArray(obj[key])) return obj[key] as T[];
    }
    // Запасной вариант: если в ответе ровно один массив, это и есть список —
    // тогда новый эндпоинт не придётся прописывать в список выше вручную.
    const arrays = Object.values(obj).filter(Array.isArray);
    if (arrays.length === 1) return arrays[0] as T[];
  }
  return [];
}

function toApiDate(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  // формат, который использует Ainur в примерах: YYYY-MM-DD HH:mm:ss
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}

/**
 * Нарезает период на окна по maxDays дней.
 * Нужно из-за ограничения Ainur: для /documents/* период не больше 31 дня.
 */
export function splitRange(
  range: DateRange,
  maxDays: number,
): { timeStart: string; timeEnd: string }[] {
  const end = range.timeEnd ? new Date(range.timeEnd) : new Date();
  const start = range.timeStart
    ? new Date(range.timeStart)
    : new Date(end.getTime() - 7 * 24 * 3600 * 1000);

  const windows: { timeStart: string; timeEnd: string }[] = [];
  let cursor = new Date(start);
  const stepMs = maxDays * 24 * 3600 * 1000;

  while (cursor < end) {
    const next = new Date(Math.min(cursor.getTime() + stepMs, end.getTime()));
    windows.push({ timeStart: toApiDate(cursor), timeEnd: toApiDate(next) });
    cursor = new Date(next.getTime() + 1000);
  }
  return windows.length ? windows : [{ timeStart: toApiDate(start), timeEnd: toApiDate(end) }];
}

/** Достаёт ID склада из поля source/destination (строка или объект) */
export function extractStoreId(
  field: AinurDocument["source"] | AinurDocument["destination"],
): string | undefined {
  if (!field) return undefined;
  if (typeof field === "string") return field;
  return field.id;
}
