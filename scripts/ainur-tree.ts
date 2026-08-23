/**
 * Разбор дерева групп Ainur: какие есть корневые папки (бренды) и что в них.
 *
 * Бренды у EVA MOON разложены по корневым папкам, причём у самого бренда
 * EVA MOON названия-префикса нет. Этот скрипт показывает структуру, чтобы
 * выбрать корень, по которому фильтровать.
 *
 * Запуск: npm run ainur:tree
 */
import { ainurClient } from "../src/lib/ainur/token";

interface Cat {
  id: string;
  name?: string;
  parent_id?: string | null;
}

async function main() {
  const client = await ainurClient();
  const cats = (await client.getCategories()) as unknown as Cat[];

  const byId = new Map(cats.map((c) => [c.id, c]));
  const children = new Map<string, Cat[]>();
  const roots: Cat[] = [];

  for (const c of cats) {
    const parent = c.parent_id ?? null;
    // Корень — это либо запись без родителя, либо запись, чей родитель
    // не пришёл в списке (папка верхнего уровня самого Ainur).
    if (!parent || !byId.has(parent)) {
      roots.push(c);
    } else {
      const list = children.get(parent) ?? [];
      list.push(c);
      children.set(parent, list);
    }
  }

  function countAll(id: string): number {
    const kids = children.get(id) ?? [];
    return kids.reduce((sum, k) => sum + 1 + countAll(k.id), 0);
  }

  console.log(`всего групп: ${cats.length}, корневых: ${roots.length}\n`);
  console.log("=== КОРНЕВЫЕ ПАПКИ (вероятно бренды) ===");
  const sorted = [...roots].sort((a, b) => countAll(b.id) - countAll(a.id));
  for (const r of sorted) {
    const kids = children.get(r.id) ?? [];
    console.log(
      `\n■ ${r.name ?? "(без имени)"}  [id ${r.id}]  вложенных всего: ${countAll(r.id)}`,
    );
    for (const k of kids.slice(0, 14)) {
      const deep = countAll(k.id);
      console.log(`    – ${k.name}${deep ? ` (+${deep} внутри)` : ""}`);
    }
    if (kids.length > 14) console.log(`    …и ещё ${kids.length - 14}`);
  }

  // Родители, на которые ссылаются, но которых нет в ответе
  const missing = new Set<string>();
  for (const c of cats) {
    if (c.parent_id && !byId.has(c.parent_id)) missing.add(c.parent_id);
  }
  if (missing.size) {
    console.log(
      `\nВНИМАНИЕ: ${missing.size} родительских папок не пришли в ответе — ` +
        `их названия неизвестны, дети показаны как корневые:`,
    );
    for (const m of [...missing].slice(0, 10)) {
      const kids = cats.filter((c) => c.parent_id === m);
      console.log(`  id ${m} → дети: ${kids.map((k) => k.name).slice(0, 8).join(", ")}`);
    }
  }
}
main().catch((e) => { console.error("ОШИБКА:", e); process.exit(1); });
