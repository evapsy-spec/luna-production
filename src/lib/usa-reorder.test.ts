import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateUsaRules } from "./usa-reorder-logic";
import { USA_RULES } from "./usa-reorder-rules";

const byKey = (res: ReturnType<typeof evaluateUsaRules>) =>
  Object.fromEntries(res.map((r) => [r.rule.skus[0], r]));

test("правил ровно 40, SKU уникальны", () => {
  assert.equal(USA_RULES.length, 40);
  const all = USA_RULES.flatMap((r) => r.skus);
  assert.equal(new Set(all).size, all.length);
});

test("порог строгий: остаток равен порогу — не сигнал", () => {
  const stock = new Map([["00343-1", 10], ["00316-4", 5], ["00671-1", 2]]);
  const r = byKey(evaluateUsaRules(USA_RULES, stock, new Map()));
  assert.equal(r["00343-1"].state, "ok"); // уровень 1, порог 10
  assert.equal(r["00316-4"].state, "ok"); // уровень 2, порог 5
  assert.equal(r["00671-1"].state, "ok"); // уровень 3, порог 2
});

test("ниже порога и нет в заказе — «нужно заказать»", () => {
  const stock = new Map([["00665-3", 0]]);
  const r = byKey(evaluateUsaRules(USA_RULES, stock, new Map()));
  assert.equal(r["00665-3"].state, "need");
  assert.equal(r["00665-3"].threshold, 2);
});

test("ниже порога, но есть в активном заказе — «закрыто заказом»", () => {
  const stock = new Map([["00343-2", 0]]);
  const ordered = new Map([["00343-2", 25]]);
  const r = byKey(evaluateUsaRules(USA_RULES, stock, ordered));
  assert.equal(r["00343-2"].state, "covered");
  assert.equal(r["00343-2"].ordered, 25);
});

test("дубль Red: остатки двух SKU складываются", () => {
  const stock = new Map([["00306", 3], ["02142", 1]]);
  const r = byKey(evaluateUsaRules(USA_RULES, stock, new Map()));
  assert.equal(r["00306"].stock, 4);
  assert.equal(r["00306"].state, "need"); // 4 < 5, уровень 2
});

test("SKU нет в базе — «unknown», а не ложный сигнал", () => {
  const r = byKey(evaluateUsaRules(USA_RULES, new Map(), new Map()));
  assert.equal(r["00300"].state, "unknown");
  assert.equal(r["00300"].stock, null);
});

test("живые данные 09.10.2026: одна позиция к заказу, восемь закрыты заказом 25", () => {
  const us: Record<string, number> = {
    "00300": 17, "00343-2": 0, "00343-1": 10, "01865": 10, "00672-1": 18, "00672-6": 2,
    "00317-1": 24, "01772": 9, "01866": 8, "00303": 1, "00308": 2, "00306": 6, "02142": 1,
    "00307": 10, "00316-6": 11, "00316-4": 5, "00316-2": 3, "00316-1": 10, "00316-3": 24,
    "00672-2": 5, "00672-5": 9, "00672-3": 9, "00377": 6, "00516": 4, "00495": 5, "00376": 8,
    "00318-1": 6, "00318-4": 6, "00318-3": 5, "00318-2": 6, "00318-5": 7, "00317-2": 15,
    "00317-4": 19, "00317-3": 9, "00317-5": 9, "00671-2": 5, "00671-1": 8, "00671-3": 3,
    "00671-4": 5, "00665-3": 0, "00665-4": 7,
  };
  const order25: Record<string, number> = {
    "00300": 20, "00343-2": 25, "00343-1": 10, "01865": 10, "00672-1": 20, "00672-6": 20,
    "01772": 10, "01866": 10, "00303": 20, "00308": 15, "00306": 15, "00307": 15,
    "00316-6": 15, "00316-4": 10, "00316-2": 10, "00316-1": 10, "00672-2": 10, "00516": 5,
    "00495": 4, "00318-1": 15, "00317-2": 15, "00317-3": 15, "00317-5": 15,
  };
  const res = evaluateUsaRules(
    USA_RULES,
    new Map(Object.entries(us)),
    new Map(Object.entries(order25)),
  );
  const need = res.filter((r) => r.state === "need").map((r) => r.rule.skus[0]);
  const covered = res.filter((r) => r.state === "covered").map((r) => r.rule.skus[0]).sort();
  assert.deepEqual(need, ["00665-3"]);
  assert.deepEqual(
    covered,
    ["00303", "00308", "00316-2", "00343-2", "00516", "00672-6", "01772", "01866"].sort(),
  );
});

test("isUsaOrderNote: заказ для склада США отличается от обычного пошива", async () => {
  const { isUsaOrderNote } = await import("./usa-reorder-rules");
  assert.equal(isUsaOrderNote("Заказ № 25 из ORDER.xlsx (вкладка Order 25), склад США. Сумма"), true);
  assert.equal(isUsaOrderNote("Обычный пошив для Пхукета"), false);
  assert.equal(isUsaOrderNote(null), false);
});
