/**
 * Чистая логика алертов склада США — без базы, чтобы проверять тестами.
 * Правила: @/lib/usa-reorder-rules. Сборка данных из базы: @/lib/usa-reorder.
 */
import { USA_TIER_THRESHOLD, type UsaRule } from "@/lib/usa-reorder-rules";

export type RuleState = "need" | "covered" | "ok" | "unknown";

export interface RuleResult {
  rule: UsaRule;
  /** остаток на складе США; null — ни одного из SKU правила нет в базе */
  stock: number | null;
  threshold: number;
  /** сколько этой позиции стоит в активных заказах, шт */
  ordered: number;
  state: RuleState;
}

/**
 * Чистая логика: правила + остатки + количество в заказе → результат по каждому правилу.
 * Вынесена отдельно от базы, чтобы её можно было проверить тестами.
 */
export function evaluateUsaRules(
  rules: readonly UsaRule[],
  stockBySku: ReadonlyMap<string, number>,
  orderedBySku: ReadonlyMap<string, number>,
): RuleResult[] {
  return rules.map((rule) => {
    const known = rule.skus.filter((s) => stockBySku.has(s));
    const stock =
      known.length === 0
        ? null
        : known.reduce((sum, s) => sum + (stockBySku.get(s) ?? 0), 0);
    const ordered = rule.skus.reduce(
      (sum, s) => sum + (orderedBySku.get(s) ?? 0),
      0,
    );
    const threshold = USA_TIER_THRESHOLD[rule.tier];
    let state: RuleState;
    if (stock === null) state = "unknown";
    else if (stock >= threshold) state = "ok";
    else state = ordered > 0 ? "covered" : "need";
    return { rule, stock, threshold, ordered, state };
  });
}
