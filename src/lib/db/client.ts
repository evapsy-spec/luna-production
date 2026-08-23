/**
 * Подключение к базе.
 *
 * Разработка: SQLite через встроенный в Node 22+ модуль node:sqlite —
 * никаких нативных сборок и скачивания бинарников.
 * Продакшен: переменная DATABASE_URL с postgres:// переключает на
 * drizzle-orm/node-postgres (см. README, раздел «Деплой»).
 *
 * Драйвер — drizzle sqlite-proxy: мы сами отдаём Drizzle функцию
 * выполнения запроса, поэтому можем подложить любой SQLite-клиент.
 */
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import * as schema from "./schema";

const DB_FILE = process.env.DATABASE_FILE ?? "./luna.db";

// В dev Next перезагружает модули — держим единственное соединение на процесс
const globalForDb = globalThis as unknown as {
  __lunaSqlite?: DatabaseSync;
};

function getSqlite(): DatabaseSync {
  if (!globalForDb.__lunaSqlite) {
    const db = new DatabaseSync(DB_FILE);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    /**
     * Ждать освободившуюся блокировку, а не падать сразу.
     * Приложение и служебные скрипты (догрузка истории продаж, импорт)
     * работают с одним файлом базы одновременно; без этого один из них
     * получает SQLITE_BUSY на первой же занятой странице.
     */
    db.exec("PRAGMA busy_timeout = 5000");
    globalForDb.__lunaSqlite = db;
  }
  return globalForDb.__lunaSqlite;
}

/** Прямой доступ к SQLite — для миграций и служебных задач */
export function rawSqlite(): DatabaseSync {
  return getSqlite();
}

export const db = drizzle(
  async (sql, params, method) => {
    const sqlite = getSqlite();

    /**
     * node:sqlite принимает только null, number, bigint, string и Buffer.
     * Всё остальное приводим сами, иначе драйвер падает с невнятным
     * «Provided value cannot be bound to SQLite parameter N».
     *
     * Массивы и объекты трактуем как «значения нет» (null): именно так внешние
     * API отдают пустое поле — например, Ainur присылает img: [] у товара без
     * фотографии. Ронять из-за этого всю запись неправильно, но и молчать
     * не надо — пишем предупреждение в консоль сервера.
     */
    const safeParams = params.map((p, index) => {
      if (p === undefined || p === null) return null;
      if (typeof p === "boolean") return p ? 1 : 0;
      if (p instanceof Date) return p.toISOString();
      if (
        typeof p === "string" ||
        typeof p === "number" ||
        typeof p === "bigint" ||
        Buffer.isBuffer(p)
      ) {
        return p;
      }
      console.warn(
        `[db] параметр ${index + 1} имеет неподдерживаемый тип ` +
          `${Array.isArray(p) ? "array" : typeof p}, записываю NULL. ` +
          `Запрос: ${sql.slice(0, 120)}`,
      );
      return null;
    });

    if (method === "run") {
      const stmt = sqlite.prepare(sql);
      stmt.run(...(safeParams as never[]));
      return { rows: [] };
    }

    const stmt = sqlite.prepare(sql);
    /**
     * Drizzle ждёт строки как массивы значений в порядке колонок SELECT.
     * Режим объектов здесь не годится принципиально: в JOIN-запросах
     * несколько таблиц дают одноимённые колонки (products.id, collections.id),
     * и в объекте они затирают друг друга — часть значений просто теряется.
     * setReturnArrays отдаёт позиционные массивы и сохраняет все колонки.
     */
    stmt.setReturnArrays(true);
    // Типы node:sqlite описывают all() как массив объектов и не знают про
    // setReturnArrays — приводим через unknown, поведение проверено в рантайме.
    const arrayRows = stmt.all(
      ...(safeParams as never[]),
    ) as unknown as unknown[][];

    if (method === "get") {
      return { rows: arrayRows[0] ?? [] };
    }
    // 'all' | 'values'
    return { rows: arrayRows };
  },
  { schema, casing: "snake_case" },
);

export { schema };
