// Проверяет resolveBrandAndCollection — определение бренда и «коллекции»
// по структуре папок в Айноре (см. комментарий у функции и историю чата
// 2026-09-12: старый список KNOWN_BRANDS был захардкожен всего на два
// примера, которые не совпадали ни с одним реальным товаром в каталоге).
//
// Форма дерева категорий здесь — точно та, что Ева показала на скриншоте
// AinurPOS: у Eva Moon есть вложенные коллекции (Silk collection и т.д.),
// у остальных брендов (BBH, Bamboo, ...) — нет, товар лежит прямо в корне
// папки бренда.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveBrandAndCollection } from "./sync";
import type { AinurCategory } from "./client";

const CATEGORIES: AinurCategory[] = [
  // бренды верхнего уровня — без parent_id
  { id: "root-eva-moon", name: "Eva Moon" },
  { id: "root-bbh", name: "BBH" },
  { id: "root-bamboo", name: "Bamboo" },
  // у Eva Moon есть вложенные коллекции
  { id: "col-silk", name: "Silk collection", parent_id: "root-eva-moon" },
  { id: "col-shiva", name: "Shiva Shakti", parent_id: "root-eva-moon" },
  // и более глубокая вложенность внутри одной коллекции (сворачивается в неё)
  { id: "col-silk-kimono", name: "Kimono", parent_id: "col-silk" },
];

const catById = new Map(CATEGORIES.map((c) => [c.id, c]));

test("товар Eva Moon внутри коллекции — бренд Eva Moon, коллекция своя", () => {
  const r = resolveBrandAndCollection("col-silk", catById);
  assert.equal(r?.brandName, "Eva Moon");
  assert.equal(r?.collectionName, "Silk collection");
  assert.equal(r?.collectionCategoryId, "col-silk");
});

test("товар Eva Moon в более глубоко вложенной группе — сворачивается в верхнюю коллекцию", () => {
  const r = resolveBrandAndCollection("col-silk-kimono", catById);
  assert.equal(r?.brandName, "Eva Moon");
  assert.equal(r?.collectionName, "Silk collection");
  assert.equal(r?.collectionCategoryId, "col-silk"); // не "Kimono" — сворачивается
});

test("чужой бренд без вложенных коллекций — сам корень и есть коллекция", () => {
  const r = resolveBrandAndCollection("root-bbh", catById);
  assert.equal(r?.brandName, "BBH");
  assert.equal(r?.collectionName, "BBH");
  assert.equal(r?.collectionCategoryId, "root-bbh");
});

test("другой чужой бренд — определяется так же, без списка имён", () => {
  const r = resolveBrandAndCollection("root-bamboo", catById);
  assert.equal(r?.brandName, "Bamboo");
});

test("категории нет в списке — null, а не падение", () => {
  const r = resolveBrandAndCollection("does-not-exist", catById);
  assert.equal(r, null);
});

test("цикл в parent_id — null, а не бесконечный цикл", () => {
  const cyclic: AinurCategory[] = [
    { id: "a", name: "A", parent_id: "b" },
    { id: "b", name: "B", parent_id: "a" },
  ];
  const cyclicById = new Map(cyclic.map((c) => [c.id, c]));
  const r = resolveBrandAndCollection("a", cyclicById);
  assert.equal(r, null);
});

test("родитель указан, но сам отсутствует в списке категорий — текущая считается корнем", () => {
  const orphan: AinurCategory[] = [
    { id: "child", name: "Осиротевшая группа", parent_id: "missing-parent" },
  ];
  const orphanById = new Map(orphan.map((c) => [c.id, c]));
  const r = resolveBrandAndCollection("child", orphanById);
  assert.equal(r?.brandName, "Осиротевшая группа");
  assert.equal(r?.collectionName, "Осиротевшая группа");
});
