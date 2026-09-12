// Проверяет, что всё, что реально запускают systemd-юниты в ops/ и deploy/,
// существует: npm-скрипты — в package.json, файлы (.ts/.sh) — на диске.
//
// Почему это тест, а не просто вычитка глазами: 23 августа кто-то удалил
// "sync:scheduled" из package.json (коммит d391d29, попутно с переписыванием
// под MCP-коннектор), а systemd-юнит ops/luna-sync.service продолжал звать
// именно его. Ни typecheck, ни build, ни остальные тесты этого не ловят —
// строка в package.json "scripts" никак не связана с TS-графом импортов.
// Синхронизация с Айнур молча падала три недели, пока это не нашли руками.
// Этот тест — чтобы такой класс поломки физически не доехал до прода снова.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");

const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
  scripts?: Record<string, string>;
};
const npmScripts = new Set(Object.keys(pkg.scripts ?? {}));

function unitFiles(dir: string): string[] {
  const full = join(REPO_ROOT, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full)
    .filter((f) => f.endsWith(".service"))
    .map((f) => join(dir, f));
}

const UNIT_DIRS = ["ops", "deploy"];
const units = UNIT_DIRS.flatMap(unitFiles);

// Каждый ExecStart= (может быть не одна строка в файле — например, ExecStartPre)
function execStartLines(content: string): string[] {
  return content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("ExecStart") && l.includes("="))
    .map((l) => l.slice(l.indexOf("=") + 1).trim());
}

test("каждый юнит в ops/ и deploy/ найден и непуст", () => {
  assert.ok(units.length > 0, "не нашли ни одного .service файла в ops/ или deploy/ — проверь пути");
});

for (const unitPath of units) {
  const content = readFileSync(join(REPO_ROOT, unitPath), "utf8");
  const lines = execStartLines(content);

  for (const line of lines) {
    const tokens = line.split(/\s+/).filter(Boolean);
    const bin = tokens[0] ?? "";
    const binName = bin.split("/").pop() ?? "";

    if (binName === "npm") {
      // .../npm run --silent <script>  →  первый не-флаговый токен после "run"
      const runIdx = tokens.indexOf("run");
      const script = tokens.slice(runIdx + 1).find((t) => !t.startsWith("-"));
      test(`${unitPath}: npm-скрипт "${script}" существует в package.json`, () => {
        assert.ok(script, `не удалось распарсить имя npm-скрипта из строки: ${line}`);
        assert.ok(
          npmScripts.has(script!),
          `${unitPath} зовёт "npm run ${script}", но такого скрипта нет в package.json scripts. ` +
            `Доступные: ${[...npmScripts].join(", ")}`
        );
      });
      continue;
    }

    if (binName === "tsx" || binName === "node") {
      // .../tsx <file.ts> — файл-аргумент (первый не-флаговый токен, не сам бинарь)
      const file = tokens.slice(1).find((t) => !t.startsWith("-"));
      test(`${unitPath}: файл "${file}" запускаемый через ${binName}, существует`, () => {
        assert.ok(file, `не удалось распарсить аргумент-файл из строки: ${line}`);
        const relPath = file!.startsWith("/srv/luna/") ? file!.slice("/srv/luna/".length) : file!;
        assert.ok(
          existsSync(join(REPO_ROOT, relPath)),
          `${unitPath} зовёт "${line}", но файла ${relPath} нет в репозитории`
        );
      });
      continue;
    }

    if (bin.startsWith("/srv/luna/")) {
      // Прямой запуск скрипта из репозитория (например, deploy/auto-deploy.sh)
      const relPath = bin.slice("/srv/luna/".length);
      test(`${unitPath}: скрипт "${relPath}" существует в репозитории`, () => {
        assert.ok(
          existsSync(join(REPO_ROOT, relPath)),
          `${unitPath} зовёт "${line}", но файла ${relPath} нет в репозитории`
        );
      });
      continue;
    }

    // Всё остальное (например /usr/local/bin/luna-backup) — бинарь, который
    // устанавливается отдельно через ops/install.sh, вне контроля package.json.
    // Такие пропускаем: их целостность проверяет install.sh при установке.
  }
}
