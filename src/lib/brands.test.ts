import { test } from "node:test";
import assert from "node:assert/strict";
import { detectBrand, DEFAULT_BRAND } from "./brands";

test("свои модели остаются Eva Moon, даже если начинаются на «Eva»", () => {
  assert.equal(detectBrand("Pantaloons with Slits", "Silk collection"), DEFAULT_BRAND);
  assert.equal(detectBrand("Eva Silk Kimono Deep Ocean", "Silk collection"), DEFAULT_BRAND);
  assert.equal(detectBrand("Silk Flared Trousers Sand", "Silk collection"), DEFAULT_BRAND);
});

test("сторонний бренд определяется по началу названия модели", () => {
  assert.equal(detectBrand("Mockni Ameli Black Maxi Dress"), "Mockni");
  assert.equal(detectBrand("Fotesko Tencel Top Green"), "Fotesko");
});

test("сравнение по названию модели — только целыми словами, не по первому слову", () => {
  // Названия моделей, которые не должны стать «брендами» сами по себе
  assert.equal(detectBrand("Aphrodite Wrap Dress"), DEFAULT_BRAND);
  assert.equal(detectBrand("Shiva Shakti Kimono"), DEFAULT_BRAND);
  // и не должно ложно сработать на слово, лишь НАЧИНАЮЩЕЕСЯ так же
  assert.equal(detectBrand("Mocknilicious Something"), DEFAULT_BRAND);
  assert.equal(detectBrand("Foteskovo Something"), DEFAULT_BRAND);
});

test("название коллекции — основной источник, приоритетнее названия модели", () => {
  assert.equal(detectBrand("Ameli Black Maxi Dress", "Mockni"), "Mockni");
  // даже если название модели само по себе выглядело бы как Eva Moon
  assert.equal(detectBrand("Classic Top", "Fotesko"), "Fotesko");
});

test("регистр и лишние пробелы не влияют на определение", () => {
  assert.equal(detectBrand("  MOCKNI   Ameli Dress "), "Mockni");
  assert.equal(detectBrand("fotesko tencel top"), "Fotesko");
});
