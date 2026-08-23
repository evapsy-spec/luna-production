import { db, schema } from "../src/lib/db/client";
import { eq } from "drizzle-orm";
import { calculateOrder, recommendForHorizon, getVelocity, suggestTransfers, getFactoryScorecards, formatThb } from "../src/lib/production";

async function main() {
  const [fotesko] = await db.select().from(schema.factories).where(eq(schema.factories.name, "Fotesko Production"));
  const products = await db.select().from(schema.products);
  const esk = products.find(p => p.name === "Eva silk kimono")!;
  const skb = products.find(p => p.name === "Silk kimono blazer")!;

  console.log("=== 1. РАСЧЁТ ЗАКАЗА (30 кимоно + 20 блейзеров) ===");
  const calc = await calculateOrder(fotesko.id, [
    { productId: esk.id, quantity: 30 },
    { productId: skb.id, quantity: 20 },
  ]);
  for (const f of calc.fabrics) {
    console.log(`  ${f.fabricName}: нужно ${f.metersNeeded}м | доступно ${f.metersAvailable}м (склад ${f.metersOnHand}, резерв ${f.metersReserved}) | НЕ ХВАТАЕТ ${f.metersShort}м | ${formatThb(f.costThb)}`);
  }
  console.log(`  фурнитура: ${calc.accessories.map(a=>`${a.name} ${a.qtyNeeded}${a.unit}`).join(", ")}`);
  console.log(`  ИТОГО: ткань ${formatThb(calc.totals.fabricCostThb)} + фурнитура ${formatThb(calc.totals.accessoryCostThb)} + пошив ${formatThb(calc.totals.sewingCostThb)} = ${formatThb(calc.totals.totalCostThb)}`);
  console.log(`  дефицит есть: ${calc.hasShortage}`);

  console.log("\n=== 2. РЕКОМЕНДАЦИИ LUNA (горизонт 3 мес) ===");
  const recs = await recommendForHorizon(3);
  for (const r of recs.slice(0, 8)) {
    console.log(`  ${r.suggestedQty} шт — ${r.label} (${r.sku})`);
    console.log(`     ${r.reason}`);
  }
  console.log(`  всего позиций к заказу: ${recs.length}`);

  console.log("\n=== 3. МЕСЯЦЫ ЗАПАСА: избыток (кандидаты на скидку) ===");
  const vel = await getVelocity(90);
  const over = vel.filter(v => v.monthsOfCover !== null && v.monthsOfCover > 6).sort((a,b)=>(b.monthsOfCover!)-(a.monthsOfCover!));
  for (const v of over.slice(0,5)) console.log(`  ${v.productName} ${v.color ?? ""} ${v.size ?? ""} — ${v.stockQty} шт, ${v.perMonth}/мес → запас на ${v.monthsOfCover} мес`);

  console.log("\n=== 4. РЕКОМЕНДАЦИИ ПО ПЕРЕМЕЩЕНИЮ ===");
  const transfers = await suggestTransfers(90);
  for (const t of transfers.slice(0,5)) console.log(`  ${t.quantity} шт «${t.label}»: ${t.fromWarehouseName} → ${t.toWarehouseName}\n     ${t.reason}`);
  console.log(`  всего предложений: ${transfers.length}`);

  console.log("\n=== 5. СКОРКАРД ФАБРИК ===");
  for (const s of await getFactoryScorecards()) {
    console.log(`  ${s.name}: заказов ${s.ordersTotal} (завершено ${s.ordersCompleted}) | вовремя ${s.onTimePct ?? "н/д"}% | брак ${s.defectPct ?? "н/д"}%`);
    console.log(`     заказано ${formatThb(s.totalOrderedThb)} | оплачено ${formatThb(s.totalPaidThb)} | кредит за брак ${formatThb(s.openDefectCreditThb)} | в работе ${s.unitsInProgress} шт (загрузка ${s.capacityUsedPct ?? "н/д"}%)`);
  }
}
main().catch(e => { console.error("FAIL:", e); process.exit(1); });
