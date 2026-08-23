import { db, schema } from "../src/lib/db/client";
import { eq } from "drizzle-orm";
import { getVelocity } from "../src/lib/production";

async function main() {
  const noWhere = await db.select({
    variantId: schema.productVariants.id, sku: schema.productVariants.sku,
    productName: schema.products.name, collectionName: schema.collections.name,
  }).from(schema.productVariants)
    .innerJoin(schema.products, eq(schema.productVariants.productId, schema.products.id))
    .innerJoin(schema.collections, eq(schema.products.collectionId, schema.collections.id));
  console.log("join WITHOUT where:", noWhere.length);

  const withWhere = await db.select({
    variantId: schema.productVariants.id, sku: schema.productVariants.sku,
  }).from(schema.productVariants)
    .innerJoin(schema.products, eq(schema.productVariants.productId, schema.products.id))
    .innerJoin(schema.collections, eq(schema.products.collectionId, schema.collections.id))
    .where(eq(schema.productVariants.isArchived, false));
  console.log("join WITH isArchived=false:", withWhere.length);

  const boolTest = await db.select().from(schema.productVariants).where(eq(schema.productVariants.isArchived, false));
  console.log("simple isArchived=false:", boolTest.length);

  const v = await getVelocity(90);
  console.log("getVelocity rows:", v.length);
  const withSales = v.filter(r => r.unitsSold > 0);
  console.log("rows with sales:", withSales.length);
  console.log(JSON.stringify(withSales.slice(0,3), null, 1));
}
main().catch(e=>{console.error(e);process.exit(1);});
