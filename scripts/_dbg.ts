import { db, schema, } from "../src/lib/db/client";
import { rawSqlite } from "../src/lib/db/client";
import { gte, sql } from "drizzle-orm";

async function main() {
  const raw = rawSqlite();
  console.log("raw count sales:", raw.prepare("SELECT COUNT(*) c FROM variant_sales_daily").get());
  console.log("raw sample:", raw.prepare("SELECT variant_id, day, units FROM variant_sales_daily LIMIT 3").all());
  console.log("raw min/max day:", raw.prepare("SELECT MIN(day) mn, MAX(day) mx FROM variant_sales_daily").get());

  const since = new Date(Date.now() - 90*24*3600*1000).toISOString().slice(0,10);
  console.log("since =", since);
  console.log("raw filtered count:", raw.prepare("SELECT COUNT(*) c FROM variant_sales_daily WHERE day >= ?").get(since));

  const plain = await db.select().from(schema.variantSalesDaily).limit(3);
  console.log("drizzle plain select:", plain.length, JSON.stringify(plain[0]));

  const agg = await db.select({
    variantId: schema.variantSalesDaily.variantId,
    units: sql<number>`COALESCE(SUM(${schema.variantSalesDaily.units}), 0)`,
    revenue: sql<number>`COALESCE(SUM(${schema.variantSalesDaily.revenue}), 0)`,
  }).from(schema.variantSalesDaily)
    .where(gte(schema.variantSalesDaily.day, since))
    .groupBy(schema.variantSalesDaily.variantId);
  console.log("drizzle agg rows:", agg.length, JSON.stringify(agg.slice(0,3)));

  const stock = await db.select({
    variantId: schema.variantStock.variantId,
    qty: sql<number>`COALESCE(SUM(${schema.variantStock.quantity}), 0)`,
  }).from(schema.variantStock).groupBy(schema.variantStock.variantId);
  console.log("drizzle stock agg rows:", stock.length, JSON.stringify(stock.slice(0,2)));

  const variants = await db.select({
    variantId: schema.productVariants.id,
    sku: schema.productVariants.sku,
  }).from(schema.productVariants).limit(3);
  console.log("variants:", JSON.stringify(variants));
}
main().catch(e=>{console.error(e);process.exit(1);});
