import { eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/lib/db/client";
import { getCurrentUser, canSeeMoney, writeAudit, diffFields } from "@/lib/auth";
import {
  Card,
  PageHeader,
  SectionTitle,
  Button,
  LinkButton,
  Field,
  Input,
  Money,
  StatusPill,
  Table,
  Th,
  Td,
  EmptyState,
} from "@/components/ui";
import { parseNum, parseStr } from "../orders/_shared";

export const metadata = { title: "Фурнитура — Luna Production" };

/**
 * Фурнитура: бирки, пуговицы, пояса, упаковка.
 * Входит в состав изделий (BOM) и в себестоимость заказа наравне с тканью.
 */
export default async function AccessoriesPage() {
  const user = await getCurrentUser();
  const showMoney = canSeeMoney(user);

  const rows = await db
    .select({
      acc: schema.accessories,
      usedIn: sql<number>`(
        SELECT COUNT(*) FROM ${schema.bomAccessoryLines}
        WHERE ${schema.bomAccessoryLines.accessoryId} = ${schema.accessories.id}
      )`,
    })
    .from(schema.accessories)
    .orderBy(schema.accessories.name);

  async function createAccessory(formData: FormData) {
    "use server";
    const actor = await getCurrentUser();
    if (!actor) redirect("/login");

    const sku = parseStr(formData.get("sku"));
    const name = parseStr(formData.get("name"));
    if (!sku || !name) return;

    const [created] = await db
      .insert(schema.accessories)
      .values({
        sku,
        name,
        unit: parseStr(formData.get("unit")) ?? "шт",
        unitCost: parseNum(formData.get("unitCost")) ?? 0,
        stockQty: parseNum(formData.get("stockQty")) ?? 0,
      })
      .returning();

    await writeAudit(actor, {
      action: "CREATE",
      entityType: "Accessory",
      entityId: created.id,
      entityName: `${name} (${sku})`,
    });
    revalidatePath("/accessories");
  }

  async function updateAccessory(formData: FormData) {
    "use server";
    const actor = await getCurrentUser();
    if (!actor) redirect("/login");

    const id = String(formData.get("id") ?? "");
    const existing = await db
      .select()
      .from(schema.accessories)
      .where(eq(schema.accessories.id, id))
      .limit(1);
    if (!existing.length) return;

    const patch = {
      name: parseStr(formData.get("name")) ?? existing[0].name,
      unitCost: parseNum(formData.get("unitCost")) ?? existing[0].unitCost,
      stockQty: parseNum(formData.get("stockQty")) ?? existing[0].stockQty,
    };

    await db
      .update(schema.accessories)
      .set(patch)
      .where(eq(schema.accessories.id, id));

    await writeAudit(actor, {
      action: "UPDATE",
      entityType: "Accessory",
      entityId: id,
      entityName: existing[0].name,
      changes: diffFields(existing[0], patch, ["name", "unitCost", "stockQty"]),
    });
    revalidatePath("/accessories");
  }

  return (
    <>
      <PageHeader
        title="Фурнитура"
        subtitle="Бирки, пуговицы, пояса, упаковка — входят в состав изделий и в себестоимость заказа"
        action={<LinkButton href="/collections">← К коллекциям</LinkButton>}
      />

      {rows.length === 0 ? (
        <EmptyState
          title="Фурнитуры пока нет"
          hint="Добавьте бирки, пуговицы и упаковку — они будут учитываться в составе изделий и в бюджете заказа."
        />
      ) : (
        <Card padded={false}>
          <Table>
            <thead>
              <tr>
                <Th>Наименование</Th>
                <Th>SKU</Th>
                <Th>Ед.</Th>
                <Th align="right">Цена за ед.</Th>
                <Th align="right">Остаток</Th>
                <Th align="right">В изделиях</Th>
                <Th align="right">Изменить</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ acc, usedIn }) => (
                <tr key={acc.id}>
                  <Td>
                    <span className="font-medium">{acc.name}</span>
                  </Td>
                  <Td>
                    <span className="text-xs text-[var(--color-muted)]">
                      {acc.sku}
                    </span>
                  </Td>
                  <Td>{acc.unit}</Td>
                  <Td align="right">
                    <Money value={acc.unitCost} hidden={!showMoney} />
                  </Td>
                  <Td align="right">
                    {acc.stockQty <= 0 ? (
                      <StatusPill tone="critical">нет</StatusPill>
                    ) : acc.stockQty < 50 ? (
                      <StatusPill tone="warn">{acc.stockQty}</StatusPill>
                    ) : (
                      <span className="tnum">{acc.stockQty}</span>
                    )}
                  </Td>
                  <Td align="right">{Number(usedIn)}</Td>
                  <Td align="right">
                    <form
                      action={updateAccessory}
                      className="flex items-center justify-end gap-1.5"
                    >
                      <input type="hidden" name="id" value={acc.id} />
                      <input type="hidden" name="name" value={acc.name} />
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        name="unitCost"
                        defaultValue={acc.unitCost}
                        className="w-20 text-right"
                        aria-label="цена"
                      />
                      <Input
                        type="number"
                        step="1"
                        min="0"
                        name="stockQty"
                        defaultValue={acc.stockQty}
                        className="w-20 text-right"
                        aria-label="остаток"
                      />
                      <Button type="submit" variant="secondary" className="px-3">
                        ОК
                      </Button>
                    </form>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="border-t border-[var(--color-line)] px-4 py-2.5 text-xs text-[var(--color-muted)]">
            Поля в последнем столбце — цена за единицу и остаток.
          </div>
        </Card>
      )}

      <SectionTitle>Добавить фурнитуру</SectionTitle>
      <Card>
        <form action={createAccessory} className="grid gap-3 sm:grid-cols-6">
          <div className="sm:col-span-2">
            <Field label="Наименование" required>
              <Input name="name" required placeholder="Пуговица золотая" />
            </Field>
          </div>
          <Field label="SKU" required>
            <Input name="sku" required placeholder="ACC-BTN-GOLD" />
          </Field>
          <Field label="Единица">
            <Input name="unit" defaultValue="шт" />
          </Field>
          <Field label="Цена за ед., THB">
            <Input type="number" name="unitCost" min="0" step="0.01" />
          </Field>
          <div className="flex items-end">
            <Button type="submit" variant="primary" className="w-full">
              Добавить
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
