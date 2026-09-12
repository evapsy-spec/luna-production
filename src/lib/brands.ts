/**
 * Сторонние бренды внутри каталога EVA MOON.
 *
 * Синхронизация с Ainur (см. src/lib/ainur/sync.ts) уже отфильтровывает
 * ЧУЖИЕ каталоги верхнего уровня (Forever Beach, Munay, Kalifesta и т.д.) —
 * их у нас в базе вообще нет. Но ВНУТРИ каталога EVA MOON встречаются
 * модели сторонних марок, которые бутик перепродаёт (например Mockni,
 * Fotesko) — их и определяет этот модуль, только для группировки в
 * интерфейсе «Перемещения».
 *
 * У Ainur нет отдельного надёжного поля «бренд» для товара (см.
 * AinurProduct в src/lib/ainur/client.ts — там только category_id и
 * название). Поэтому:
 *   1. Основной источник — название коллекции (родительской товарной
 *      папки), если оно само совпадает с известным сторонним брендом.
 *   2. Запасной вариант — начало названия модели, СРАВНИВАЕМОЕ ЦЕЛЫМИ
 *      СЛОВАМИ, а не первым словом само по себе (иначе «Pantaloons»,
 *      «Aphrodite», «Shiva» и другие названия моделей ошибочно станут
 *      брендами).
 *   3. Если ничего не совпало — бренд EVA MOON (свой, по умолчанию).
 *
 * Единственный источник правды об этом списке брендов — здесь. Появился
 * новый сторонний бренд в каталоге — добавь его в KNOWN_BRANDS.
 */

export const DEFAULT_BRAND = "Eva Moon";

export interface BrandDef {
  /** Каноническое имя бренда — так показываем в интерфейсе */
  name: string;
  /**
   * Варианты написания в начале названия товара или как название
   * коллекции, нижним регистром, без лишних пробелов.
   */
  aliases: string[];
}

/** Сторонние бренды, зарегистрированные в каталоге EVA MOON. */
export const KNOWN_BRANDS: BrandDef[] = [
  { name: "Mockni", aliases: ["mockni"] },
  { name: "Fotesko", aliases: ["fotesko"] },
];

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** true, если haystack начинается с needle целым словом (не частью другого) */
function startsWithWord(haystack: string, needle: string): boolean {
  if (!haystack.startsWith(needle)) return false;
  const rest = haystack.slice(needle.length);
  return rest === "" || /^[\s,.\-–—:/]/.test(rest);
}

function matchesBrand(value: string, brand: BrandDef): boolean {
  const norm = normalize(value);
  return brand.aliases.some((alias) => startsWithWord(norm, alias) || norm === alias);
}

/**
 * Определяет бренд товара.
 *
 * @param productName   название модели (обязательно)
 * @param collectionName название коллекции/родительской папки — надёжный
 *   источник, если он есть; название товара — только запасной вариант.
 */
export function detectBrand(
  productName: string,
  collectionName?: string | null,
): string {
  if (collectionName) {
    for (const brand of KNOWN_BRANDS) {
      if (matchesBrand(collectionName, brand)) return brand.name;
    }
  }
  for (const brand of KNOWN_BRANDS) {
    if (matchesBrand(productName, brand)) return brand.name;
  }
  return DEFAULT_BRAND;
}
