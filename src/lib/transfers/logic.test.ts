import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeStock,
  isNewArrival,
  computeTargetQty,
  compareDemand,
  allocateLimited,
  evaluateBoutiqueLeg,
  evaluateFoteskoLeg,
} from "./logic";

// ---------- отрицательные остатки ----------

test("отрицательный остаток — не доступен для перемещения, помечен ошибкой", () => {
  const s = sanitizeStock(-1);
  assert.equal(s.available, 0);
  assert.equal(s.isNegative, true);
  assert.equal(s.raw, -1);
});

test("положительный остаток — доступен целиком, не ошибка", () => {
  const s = sanitizeStock(5);
  assert.equal(s.available, 5);
  assert.equal(s.isNegative, false);
});

// ---------- новое поступление ----------

test("новое поступление: недавно создано и нет продаж", () => {
  const now = new Date("2026-09-01T00:00:00Z");
  assert.equal(
    isNewArrival({ createdAt: "2026-08-20T00:00:00Z", hasAnySalesEver: false, now }),
    true,
  );
});

test("не новое: продажи уже были, даже если создано недавно", () => {
  const now = new Date("2026-09-01T00:00:00Z");
  assert.equal(
    isNewArrival({ createdAt: "2026-08-20T00:00:00Z", hasAnySalesEver: true, now }),
    false,
  );
});

test("не новое: создано слишком давно, даже без продаж (не мёртвый остаток выдаём за новинку)", () => {
  const now = new Date("2026-09-01T00:00:00Z");
  assert.equal(
    isNewArrival({ createdAt: "2025-01-01T00:00:00Z", hasAnySalesEver: false, now }),
    false,
  );
});

// ---------- целевое количество ----------

test("целевое количество: 3 при активных продажах за 90 дней", () => {
  assert.equal(
    computeTargetQty({ sold90d: 3, sold12m: 3, isNew: false, otherPointHasDemand: false }),
    3,
  );
});

test("целевое количество: 2 при продажах за 12 мес или для новинки", () => {
  assert.equal(
    computeTargetQty({ sold90d: 0, sold12m: 1, isNew: false, otherPointHasDemand: false }),
    2,
  );
  assert.equal(
    computeTargetQty({ sold90d: 0, sold12m: 0, isNew: true, otherPointHasDemand: false }),
    2,
  );
});

test("целевое количество: 0, если здесь не продавалось, а у соседней точки спрос есть", () => {
  assert.equal(
    computeTargetQty({ sold90d: 0, sold12m: 0, isNew: false, otherPointHasDemand: true }),
    0,
  );
});

test("целевое количество: 1 по умолчанию — для представленности", () => {
  assert.equal(
    computeTargetQty({ sold90d: 0, sold12m: 0, isNew: false, otherPointHasDemand: false }),
    1,
  );
});

test("целевое количество: если известны остатки обеих точек — делим маршрут пополам, не 0", () => {
  assert.equal(
    computeTargetQty({
      sold90d: 0,
      sold12m: 0,
      isNew: false,
      otherPointHasDemand: true,
      thisPointAvailable: 0,
      otherPointAvailable: 10,
    }),
    5,
  );
  assert.equal(
    computeTargetQty({
      sold90d: 0,
      sold12m: 0,
      isNew: false,
      otherPointHasDemand: true,
      thisPointAvailable: 0,
      otherPointAvailable: 1,
    }),
    1,
  );
});

// ---------- сравнение спроса и распределение дефицита ----------

test("compareDemand: выше продажи за 90 дней — приоритетнее", () => {
  const a = { key: "a", need: 1, sold90d: 5, sold12m: 5, lastSaleAt: null };
  const b = { key: "b", need: 1, sold90d: 1, sold12m: 5, lastSaleAt: null };
  assert.ok(compareDemand(a, b) < 0);
});

test("allocateLimited: хватает на обоих — раздаёт по потребности", () => {
  const res = allocateLimited(5, [
    { key: "phuket", need: 2, sold90d: 1, sold12m: 1, lastSaleAt: null },
    { key: "phangan", need: 2, sold90d: 0, sold12m: 1, lastSaleAt: null },
  ]);
  assert.equal(res.allocated.phuket, 2);
  assert.equal(res.allocated.phangan, 2);
  assert.equal(res.insufficientTotal, false);
});

test("allocateLimited: явный лидер по продажам получает больше при нехватке", () => {
  const res = allocateLimited(1, [
    { key: "phuket", need: 1, sold90d: 5, sold12m: 20, lastSaleAt: "2026-09-01" },
    { key: "phangan", need: 1, sold90d: 0, sold12m: 0, lastSaleAt: null },
  ]);
  assert.equal(res.allocated.phuket, 1);
  assert.equal(res.allocated.phangan, 0);
  assert.equal(res.insufficientTotal, true);
});

test("allocateLimited: спрос равен — последняя единица никому, это дефицит", () => {
  const res = allocateLimited(1, [
    { key: "phuket", need: 1, sold90d: 2, sold12m: 2, lastSaleAt: "2026-08-01" },
    { key: "phangan", need: 1, sold90d: 2, sold12m: 2, lastSaleAt: "2026-08-01" },
  ]);
  assert.equal(res.allocated.phuket, 0);
  assert.equal(res.allocated.phangan, 0);
  assert.equal(res.tiedLastUnit, true);
});

test("allocateLimited: новый товар без продаж — хотя бы по одной штуке каждому", () => {
  const res = allocateLimited(2, [
    { key: "phuket", need: 2, sold90d: 0, sold12m: 0, lastSaleAt: null },
    { key: "phangan", need: 2, sold90d: 0, sold12m: 0, lastSaleAt: null },
  ], { isNewItem: true });
  assert.equal(res.allocated.phuket, 1);
  assert.equal(res.allocated.phangan, 1);
});

// ---------- Пхукет ↔ Панган ----------

test("Phuket → Phangan: Пхукет отдаёт, Панган закончился и недавно продавался", () => {
  const r = evaluateBoutiqueLeg({
    sourceRawQty: 6,
    destRawQty: 0,
    sourceSales: { sold90d: 4, sold12m: 10, lastSaleAt: "2026-09-01" },
    destSales: { sold90d: 2, sold12m: 6, lastSaleAt: "2026-08-20" },
    isNew: false,
  });
  assert.ok(r);
  assert.equal(r!.bucket, "moveNow");
  assert.equal(r!.reason, "SOLD_OUT_RECENT_SALES");
  assert.ok(r!.sendQty > 0);
});

test("Phangan → Phuket: последняя единица на Пангане, там не продавалось, на Пхукете есть спрос — предупреждение", () => {
  const r = evaluateBoutiqueLeg({
    sourceRawQty: 1,
    destRawQty: 0,
    sourceSales: { sold90d: 0, sold12m: 0, lastSaleAt: null },
    destSales: { sold90d: 1, sold12m: 4, lastSaleAt: "2026-08-15" },
    isNew: false,
  });
  assert.ok(r);
  assert.equal(r!.sendQty, 1);
  assert.equal(r!.lastUnitWarning, true);
  // dest (Phuket) закончился и недавно продавался — это и есть основная причина
  assert.equal(r!.reason, "SOLD_OUT_RECENT_SALES");
});

test("причина «не продаётся на складе-источнике», когда назначение не в нуле, но источник сам не продаёт", () => {
  const r = evaluateBoutiqueLeg({
    sourceRawQty: 3,
    destRawQty: 1,
    sourceSales: { sold90d: 0, sold12m: 0, lastSaleAt: null },
    destSales: { sold90d: 1, sold12m: 4, lastSaleAt: "2026-08-15" },
    isNew: false,
  });
  assert.ok(r);
  assert.equal(r!.reason, "NOT_SOLD_AT_SOURCE");
});

test("нельзя забрать последнюю единицу, если товар продаётся в обоих местах", () => {
  const r = evaluateBoutiqueLeg({
    sourceRawQty: 1,
    destRawQty: 0,
    sourceSales: { sold90d: 1, sold12m: 5, lastSaleAt: "2026-09-05" },
    destSales: { sold90d: 1, sold12m: 5, lastSaleAt: "2026-09-01" },
    isNew: false,
  });
  // источнику самому нужна эта última unidad (sourceTarget >= 1) — отдавать нечего
  assert.ok(r);
  assert.equal(r!.sendQty, 0);
  assert.equal(r!.bucket, "needsPurchase");
});

test("товар без продаж нигде и не новый — уходит в «без подтверждённого спроса», не в основной список", () => {
  const r = evaluateBoutiqueLeg({
    sourceRawQty: 5,
    destRawQty: 0,
    sourceSales: { sold90d: 0, sold12m: 0, lastSaleAt: null },
    destSales: { sold90d: 0, sold12m: 0, lastSaleAt: null },
    isNew: false,
  });
  assert.ok(r);
  assert.equal(r!.bucket, "unconfirmedDemand");
});

test("Панган → Пхукет: модель проверена на Пангане, на Пхукете никогда не продавалась — теперь предлагаем попробовать, а не молчим", () => {
  // Ева, 2026-09-16: свежая закупка Mockni на Пангане, модель там реально
  // продаётся, но на Пхукете этот цвет ещё не пробовали ни разу — раньше
  // это давало target=0 у Пхукета и рекомендация пропадала совсем.
  const r = evaluateBoutiqueLeg({
    sourceRawQty: 10,
    destRawQty: 0,
    sourceSales: { sold90d: 2, sold12m: 4, lastSaleAt: "2026-09-01" },
    destSales: { sold90d: 0, sold12m: 0, lastSaleAt: null },
    isNew: false,
  });
  assert.ok(r, "рекомендация должна появиться, а не пропасть совсем");
  assert.ok(r!.sendQty > 0);
  // делим остаток маршрута (10 + 0) пополам -> target у Пхукета = 5
  assert.equal(r!.destTarget, 5);
});

test("отрицательный остаток на источнике — не считается доступным, а не даёт отрицательную рекомендацию", () => {
  const r = evaluateBoutiqueLeg({
    sourceRawQty: -1,
    destRawQty: 0,
    sourceSales: { sold90d: 2, sold12m: 6, lastSaleAt: "2026-09-01" },
    destSales: { sold90d: 1, sold12m: 4, lastSaleAt: "2026-08-01" },
    isNew: false,
  });
  assert.ok(r);
  assert.equal(r!.sourceIsNegative, true);
  assert.equal(r!.sourceAvailable, 0);
  assert.ok(r!.sendQty <= 0);
});

// ---------- Fotesko → Phuket ----------

test("Fotesko → Phuket: пример из ТЗ — Fotesko 10, Phuket 0, Phangan 0", () => {
  const r = evaluateFoteskoLeg({
    foteskoRawQty: 10,
    phuketRawQty: 0,
    phanganRawQty: 0,
    phuketSales: { sold90d: 2, sold12m: 5, lastSaleAt: "2026-09-01" },
    phanganSales: { sold90d: 1, sold12m: 4, lastSaleAt: "2026-08-20" },
    isNew: false,
  });
  assert.ok(r);
  assert.ok(r!.sendQty > 0);
  assert.equal(r!.bucket, "moveNow");
});

test("Fotesko → Phuket: новый товар без истории продаж всё равно попадает в рекомендации", () => {
  const r = evaluateFoteskoLeg({
    foteskoRawQty: 10,
    phuketRawQty: 0,
    phanganRawQty: 0,
    phuketSales: { sold90d: 0, sold12m: 0, lastSaleAt: null },
    phanganSales: { sold90d: 0, sold12m: 0, lastSaleAt: null },
    isNew: true,
  });
  assert.ok(r, "новинка должна давать рекомендацию без истории продаж");
  assert.ok(r!.sendQty > 0);
});

test("Fotesko → Phuket: недостаточно остатка на Fotesko для обеих точек — нужна закупка", () => {
  const r = evaluateFoteskoLeg({
    foteskoRawQty: 1,
    phuketRawQty: 0,
    phanganRawQty: 0,
    phuketSales: { sold90d: 3, sold12m: 10, lastSaleAt: "2026-09-01" },
    phanganSales: { sold90d: 3, sold12m: 10, lastSaleAt: "2026-09-01" },
    isNew: false,
  });
  assert.ok(r);
  assert.equal(r!.bucket, "needsPurchase");
});

test("Fotesko → Phuket: без остатка на Fotesko рекомендаций нет вовсе", () => {
  const r = evaluateFoteskoLeg({
    foteskoRawQty: 0,
    phuketRawQty: 0,
    phanganRawQty: 0,
    phuketSales: { sold90d: 1, sold12m: 4, lastSaleAt: "2026-08-01" },
    phanganSales: { sold90d: 0, sold12m: 0, lastSaleAt: null },
    isNew: false,
  });
  assert.equal(r, null);
});
