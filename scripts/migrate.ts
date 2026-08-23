/**
 * Применяет SQL-миграции из ./drizzle к базе SQLite.
 * Запуск: npm run db:migrate
 *
 * Свою мини-реализацию используем вместо штатного миграционного раннера
 * drizzle-orm, потому что база подключена через sqlite-proxy (node:sqlite),
 * а у прокси-драйвера готового раннера нет.
 */
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DB_FILE = process.env.DATABASE_FILE ?? "./luna.db";
const MIGRATIONS_DIR = join(process.cwd(), "drizzle");

const db = new DatabaseSync(DB_FILE);
db.exec("PRAGMA journal_mode = WAL");

db.exec(`CREATE TABLE IF NOT EXISTS __migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
)`);

const applied = new Set(
  (db.prepare("SELECT name FROM __migrations").all() as { name: string }[]).map(
    (r) => r.name,
  ),
);

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

let count = 0;
for (const file of files) {
  if (applied.has(file)) continue;

  const raw = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
  // drizzle-kit разделяет операторы маркером --> statement-breakpoint
  const statements = raw
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);

  db.exec("BEGIN");
  try {
    for (const stmt of statements) db.exec(stmt);
    db.prepare("INSERT INTO __migrations (name, applied_at) VALUES (?, ?)").run(
      file,
      new Date().toISOString(),
    );
    db.exec("COMMIT");
    console.log(`✓ ${file} (${statements.length} операторов)`);
    count++;
  } catch (err) {
    db.exec("ROLLBACK");
    console.error(`✗ ${file}:`, (err as Error).message);
    process.exit(1);
  }
}

// Внешние ключи включаем после миграций, чтобы порядок CREATE TABLE не мешал
db.exec("PRAGMA foreign_keys = ON");

console.log(
  count === 0
    ? "База уже актуальна — новых миграций нет"
    : `Применено миграций: ${count}`,
);
db.close();
