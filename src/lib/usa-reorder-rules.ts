/**
 * Правила пополнения склада США — единственный источник правды.
 *
 * Три уровня (решение Евы, 09.10.2026):
 *   1 — хиты:  остаток меньше 10 шт → дозаказ 10–25 шт;
 *   2 — ходовые: остаток меньше 5 шт → дозаказ 5–15 шт;
 *   3 — редкие: остаток меньше 2 шт → дозаказ 5 шт.
 *
 * Всё, чего здесь нет (Sleeveless, Men's Shorts long, аксессуары, «не повторять»),
 * в алерты не попадает — иначе главная снова превращается в простыню.
 *
 * Привязка идёт по SKU, а не по названию: в Ainur цвет у части товаров
 * записан в названии, а поле «цвет» пустое или неверное
 * (00468, 00436, 00469, 00539). Названия модели и цвета здесь — для людей.
 *
 * Названия в Ainur отличаются от названий в таблице заказов:
 *   Men Long Kimono  = «Men robe (цвет)»        Women Long Kimono  = «Shakti kimono (цвет)»
 *   Men Short Kimono = «Men short robe (цвет)»   Women Short Kimono = «Women robe (цвет)»
 *                                                 (Fire/Ice/Sun/Moon — «Women short kimono (цвет)»)
 */

export type UsaTier = 1 | 2 | 3;

/** Меньше этого остатка на складе США — сигнал */
export const USA_TIER_THRESHOLD: Record<UsaTier, number> = { 1: 10, 2: 5, 3: 2 };

export interface UsaRule {
  tier: UsaTier;
  /** как модель называется в таблице заказов Евы */
  model: string;
  color: string;
  /** SKU в Ainur/Luna. Несколько — если в Ainur завели дубль, остатки суммируются */
  skus: string[];
  /** сколько заказывать, шт */
  reorderQty: number;
}

const r = (
  tier: UsaTier,
  model: string,
  color: string,
  skus: string | string[],
  reorderQty: number,
): UsaRule => ({ tier, model, color, skus: Array.isArray(skus) ? skus : [skus], reorderQty });

export const USA_RULES: readonly UsaRule[] = [
  // ---- уровень 1: меньше 10 шт ----
  r(1, "Men Long Kimono", "Black&Gold", "00300", 20),
  r(1, "Men Long Kimono", "Moon", "00343-2", 25),
  r(1, "Men Long Kimono", "Sun", "00343-1", 15),
  r(1, "Men Long Kimono", "Black Panther", "01865", 15),
  r(1, "Women Long Kimono", "Black&Gold", "00672-1", 25),
  r(1, "Women Long Kimono", "Grey&Brown", "00672-6", 25),
  r(1, "Boxers", "Black&Gold", "00317-1", 20),
  r(1, "Men Shirt", "Black Panther", "01772", 10),
  r(1, "Men Pants", "Black Panther", "01866", 10),

  // ---- уровень 2: меньше 5 шт ----
  r(2, "Men Long Kimono", "Black&Ivory", "00303", 15),
  r(2, "Men Long Kimono", "Grey&Brown", "00308", 15),
  r(2, "Men Long Kimono", "Red", ["00306", "02142"], 15), // 02142 — дубль «Red - 2»
  r(2, "Men Long Kimono", "Green&Gold", "00307", 15),
  r(2, "Men Short Kimono", "Black&Gold", "00316-6", 10),
  r(2, "Men Short Kimono", "Grey&Brown", "00316-4", 10),
  r(2, "Men Short Kimono", "Red", "00316-2", 10),
  r(2, "Men Short Kimono", "Black&Ivory", "00316-1", 10),
  r(2, "Men Short Kimono", "Green&Gold", "00316-3", 10),
  r(2, "Women Long Kimono", "Black&Ivory", "00672-2", 10),
  r(2, "Women Long Kimono", "Green&Gold", "00672-5", 10),
  r(2, "Women Long Kimono", "Red", "00672-3", 5),
  r(2, "Women Long Kimono", "Moon", "00377", 5),
  r(2, "Women Long Kimono", "Fire", "00516", 5),
  r(2, "Women Long Kimono", "Ice", "00495", 5),
  r(2, "Women Long Kimono", "Sun", "00376", 5),
  r(2, "Women Short Kimono", "Black&Gold", "00318-1", 10),
  r(2, "Women Short Kimono", "Green&Gold", "00318-4", 10),
  r(2, "Women Short Kimono", "Red", "00318-3", 10),
  r(2, "Women Short Kimono", "Black&Ivory", "00318-2", 5),
  r(2, "Women Short Kimono", "Grey&Brown", "00318-5", 5),
  r(2, "Boxers", "Black&Ivory", "00317-2", 15),
  r(2, "Boxers", "Green&Gold", "00317-4", 15),
  r(2, "Boxers", "Red", "00317-3", 15),
  r(2, "Boxers", "Grey&Brown", "00317-5", 15),

  // ---- уровень 3: меньше 2 шт ----
  r(3, "Women Short Kimono", "Ice", "00671-2", 5),
  r(3, "Women Short Kimono", "Fire", "00671-1", 5),
  r(3, "Women Short Kimono", "Sun", "00671-3", 5),
  r(3, "Women Short Kimono", "Moon", "00671-4", 5),
  r(3, "Boxers", "Sun", "00665-3", 5),
  r(3, "Boxers", "Moon", "00665-4", 5),
];

/**
 * SKU → как показывать в заказе (модель + цвет).
 * Black Panther показываем отдельной моделью: «Black Panther Jaquard» — кимоно, рубашка, штаны.
 */
export const USA_LABEL_BY_SKU: ReadonlyMap<string, { model: string; color: string }> =
  new Map(
    USA_RULES.flatMap((rule) => {
      const label =
        rule.color === "Black Panther"
          ? {
              model: "Black Panther Jaquard",
              color: rule.model.replace(/^Men /, "").replace(/ Kimono$/, "Kimono"),
            }
          : { model: rule.model, color: rule.color };
      return rule.skus.map((sku) => [sku, label] as const);
    }),
  );

/** Названия склада США в базе (в Ainur — «US Warehouse», в демо-данных — «USA Warehouse») */
export const USA_WAREHOUSE_NAMES = ["US Warehouse", "USA Warehouse"] as const;
