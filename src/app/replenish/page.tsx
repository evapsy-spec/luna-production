/**
 * «Пора заказывать» — полный список позиций на исходе с планированием.
 *
 * Здесь Ева решает: что повторяем, на какой фабрике, а что больше не шьём
 * никогда. Решения хранятся в replenish_plan и синхронизацией не стираются.
 */
import { asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/lib/db/client";
import { getCurrentUser, writeAudit } from "@/lib/auth";
import {
  getReplenish,
  LOW_STOCK_THRESHOLD,
  ZERO_SALES_DAYS,
  type Cell,
  type ReplenishFilters,
} from "@/lib/replenish";
import {
  Card,
  PageHeader,
  Button,
  LinkButton,
  Field,
  Input,
  Select,
  StatusPill,
  Table,
  Th,
  Td,
  EmptyState,
} from "@/components/ui";
import { parseStr } from "../orders/_shared";

export const metadata = { title: "Пора заказывать — Luna Production" };

interface Params {
  phangan?: string;
  phuket?: string;
  fotesko?: string;
  collection?: string;
  factory?: string;
  excluded?: string;
  q?: string;
  sort?: string;
}

function toMax(raw?: string): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
}

/** Собрать адрес страницы с теми же фильтрами — чтобы форма не теряла состояние */
function queryOf(p: Params): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) {
    if (v !== undefined && v !== "") sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export default async function ReplenishPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const user = await getCurrentUser();
  const params = await searchParams;

  const maxBySlug: Record<string, number> = {};
  for (const slug of ["phangan", "phuket", "fotesko"] as const) {
    const v = toMax(params[slug]);
    if (v !== undefined) maxBySlug[slug] = v;
  }

  const excludedMode: ReplenishFilters["excluded"] =
    params.excluded === "only" || params.excluded === "all"
      ? params.excluded
      : "hide";

  const sort: ReplenishFilters["sort"] =
    params.sort === "sku" ||
    params.sort === "stock" ||
    params.sort === "collection"
      ? params.sort
      : "urgency";

  const data = await getReplenish({
    maxBySlug,
    collectionId: params.collection || undefined,
    factory: params.factory || undefined,
    excluded: excludedMode,
    q: params.q || undefined,
    sort,
  });

  const factories = await db
    .select({ id: schema.factories.id, name: schema.factories.name })
    .from(schema.factories)
    .where(eq(schema.factories.isArchived, false))
    .orderBy(asc(schema.factories.name));

  const factoryName = new Map(factories.map((f) => [f.id, f.name]));
  const backTo = queryOf(params);

  // ---------- действия ----------

  async function setFactory(formData: FormData) {
    "use server";
    const actor = await getCurrentUser();
    if (!actor) redirect("/login");

    const variantId = parseStr(formData.get("variantId"));
    if (!variantId) return;
    const factoryId = parseStr(formData.get("factoryId"));
    const back = parseStr(formData.get("back")) ?? "";

    const [variant] = await db
      .select({ sku: schema.productVariants.sku })
      .from(schema.productVariants)
      .where(eq(schema.productVariants.id, variantId))
      .limit(1);

    await db
      .insert(schema.replenishPlan)
      .values({
        variantId,
        factoryId,
        updatedById: actor.id,
        updatedAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: schema.replenishPlan.variantId,
        set: {
          factoryId,
          updatedById: actor.id,
          updatedAt: new Date().toISOString(),
        },
      });

    await writeAudit(actor, {
      action: "UPDATE",
      entityType: "ReplenishPlan",
      entityId: variantId,
      entityName: `${variant?.sku ?? variantId}: фабрика`,
    });
    revalidatePath("/replenish");
    revalidatePath("/");
    redirect(`/replenish${back}`);
  }

  async function setExcluded(formData: FormData) {
    "use server";
    const actor = await getCurrentUser();
    if (!actor) redirect("/login");

    const variantId = parseStr(formData.get("variantId"));
    if (!variantId) return;
    const value = parseStr(formData.get("value")) === "1";
    const back = parseStr(formData.get("back")) ?? "";

    const [variant] = await db
      .select({ sku: schema.productVariants.sku })
      .from(schema.productVariants)
      .where(eq(schema.productVariants.id, variantId))
      .limit(1);

    await db
      .insert(schema.replenishPlan)
      .values({
        variantId,
        excluded: value,
        updatedById: actor.id,
        updatedAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: schema.replenishPlan.variantId,
        set: {
          excluded: value,
          updatedById: actor.id,
          updatedAt: new Date().toISOString(),
        },
      });

    await writeAudit(actor, {
      action: "UPDATE",
      entityType: "ReplenishPlan",
      entityId: variantId,
      entityName: `${variant?.sku ?? variantId}: ${
        value ? "больше не повторяем" : "вернули в список"
      }`,
    });
    revalidatePath("/replenish");
    revalidatePath("/");
    redirect(`/replenish${back}`);
  }

  return (
    <>
      <PageHeader
        title="Пора заказывать"
        subtitle={`Меньше ${LOW_STOCK_THRESHOLD} шт на складах Панган, Пхукет и Fotesko. Ноль показываем, только если позиция там продавалась за ${ZERO_SALES_DAYS} дней — иначе это «никогда не лежало», а не «закончилось».`}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusPill tone="warn">на исходе: {data.totalActive}</StatusPill>
        {data.soldOutCount > 0 ? (
          <StatusPill tone="critical">
            распродано: {data.soldOutCount}
          </StatusPill>
        ) : null}
        {data.plannedCount > 0 ? (
          <StatusPill tone="ok">
            фабрика выбрана: {data.plannedCount}
          </StatusPill>
        ) : null}
        {data.totalExcluded > 0 ? (
          <a
            href={`/replenish?excluded=only`}
            className="text-xs text-[var(--color-muted)] underline"
          >
            не повторяем: {data.totalExcluded}
          </a>
        ) : null}
      </div>

      {/* ---------- Фильтры ---------- */}
      <Card className="mb-4">
        <form method="get" className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-3">
            {data.warehouses.map((w) => (
              <Field
                key={w.id}
                label={`${w.short}: остаток не больше`}
                hint="пусто — не фильтровать"
              >
                <Input
                  type="number"
                  name={w.slug}
                  min={0}
                  max={99}
                  inputMode="numeric"
                  defaultValue={params[w.slug as keyof Params] ?? ""}
                  placeholder="—"
                />
              </Field>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Коллекция">
              <Select name="collection" defaultValue={params.collection ?? ""}>
                <option value="">все</option>
                {data.collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Фабрика">
              <Select name="factory" defaultValue={params.factory ?? ""}>
                <option value="">любая</option>
                <option value="none">не выбрана</option>
                {factories.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Убранные вручную">
              <Select name="excluded" defaultValue={excludedMode}>
                <option value="hide">скрыть</option>
                <option value="only">только их</option>
                <option value="all">показать вместе</option>
              </Select>
            </Field>

            <Field label="Сортировка">
              <Select name="sort" defaultValue={sort}>
                <option value="urgency">по срочности</option>
                <option value="stock">по остатку</option>
                <option value="collection">по коллекции</option>
                <option value="sku">по SKU</option>
              </Select>
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
            <Field label="Поиск">
              <Input
                type="search"
                name="q"
                defaultValue={params.q ?? ""}
                placeholder="SKU, модель или коллекция"
              />
            </Field>
            <div className="flex items-end">
              <Button type="submit" variant="primary">
                Применить
              </Button>
            </div>
            <div className="flex items-end">
              <LinkButton href="/replenish">Сбросить</LinkButton>
            </div>
          </div>
        </form>
      </Card>

      {/* ---------- Таблица ---------- */}
      {data.rows.length === 0 ? (
        <EmptyState
          title="По этим условиям ничего нет"
          hint={
            data.totalActive === 0
              ? "На складах всего достаточно — заказывать пока нечего."
              : "Фильтры слишком узкие. Сбрось их и посмотри полный список."
          }
          action={<LinkButton href="/replenish">Сбросить фильтры</LinkButton>}
        />
      ) : (
        <>
          <p className="mb-2 mt-0 text-sm text-[var(--color-muted)]">
            Показано {data.rows.length}{" "}
            {data.rows.length === 1 ? "позиция" : "позиций"}
          </p>
          <Card padded={false}>
            <Table>
              <thead>
                <tr>
                  <Th>SKU</Th>
                  <Th>Модель</Th>
                  <Th>Коллекция</Th>
                  {data.warehouses.map((w) => (
                    <Th key={w.id} align="right">
                      {w.short}
                    </Th>
                  ))}
                  <Th align="right">В заказе</Th>
                  <Th>Где шьём</Th>
                  <Th> </Th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr
                    key={r.variantId}
                    className={r.excluded ? "opacity-50" : ""}
                  >
                    <Td>
                      <a
                        href={`/products/${r.productId}`}
                        className="font-medium text-[var(--color-ocean)] no-underline hover:underline active:underline"
                      >
                        {r.sku}
                      </a>
                    </Td>
                    <Td>
                      <span className="line-clamp-1">{r.productName}</span>
                      {r.color || r.size ? (
                        <span className="block text-xs text-[var(--color-muted)]">
                          {[r.color, r.size].filter(Boolean).join(" · ")}
                        </span>
                      ) : null}
                    </Td>
                    <Td>
                      <span className="line-clamp-1 text-[var(--color-muted)]">
                        {r.collectionName}
                      </span>
                    </Td>
                    {r.cells.map((c, i) => (
                      <QtyCell key={data.warehouses[i].id} cell={c} />
                    ))}
                    <Td align="right">
                      {r.onOrder > 0 ? (
                        <span className="text-[var(--color-ocean)]">
                          {r.onOrder}
                        </span>
                      ) : (
                        <span className="text-[var(--color-faint)]">—</span>
                      )}
                    </Td>
                    <Td>
                      <form action={setFactory} className="flex items-center gap-1">
                        <input
                          type="hidden"
                          name="variantId"
                          value={r.variantId}
                        />
                        <input type="hidden" name="back" value={backTo} />
                        <Select
                          name="factoryId"
                          defaultValue={r.plannedFactoryId ?? ""}
                          className="min-w-[9rem] py-1.5 text-sm"
                        >
                          <option value="">— не выбрана —</option>
                          {factories.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.name}
                            </option>
                          ))}
                        </Select>
                        <Button type="submit" variant="ghost" className="px-2">
                          ✓
                        </Button>
                      </form>
                      {r.plannedFactoryId ? (
                        <span className="mt-1 block text-xs text-[var(--color-muted)]">
                          сейчас: {factoryName.get(r.plannedFactoryId) ?? "—"}
                        </span>
                      ) : null}
                    </Td>
                    <Td>
                      <form action={setExcluded}>
                        <input
                          type="hidden"
                          name="variantId"
                          value={r.variantId}
                        />
                        <input type="hidden" name="back" value={backTo} />
                        <input
                          type="hidden"
                          name="value"
                          value={r.excluded ? "0" : "1"}
                        />
                        <Button
                          type="submit"
                          variant={r.excluded ? "secondary" : "ghost"}
                          className="whitespace-nowrap px-2 text-xs"
                        >
                          {r.excluded ? "Вернуть" : "Не повторять"}
                        </Button>
                      </form>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </>
      )}

      <p className="mt-4 text-xs text-[var(--color-faint)]">
        «Не повторять» ничего не удаляет: позиция остаётся в каталоге и в
        аналитике, просто перестаёт напоминать о себе здесь. Вернуть её можно в
        любой момент через фильтр «Убранные вручную».
        {user?.role === "MANAGER"
          ? " Все изменения записываются в историю."
          : ""}
      </p>
    </>
  );
}

function QtyCell({ cell }: { cell: Cell }) {
  if (cell.qty === null) {
    return (
      <Td align="right">
        <span className="text-[var(--color-faint)]">—</span>
      </Td>
    );
  }
  if (cell.soldOut) {
    return (
      <Td align="right" className="bg-[#FBE9E7]">
        <span className="font-semibold text-[#A82C2C]">0</span>
      </Td>
    );
  }
  if (cell.alert) {
    return (
      <Td align="right" className="bg-[#FDF1E3]">
        <span className="font-semibold text-[#9A5B12]">{cell.qty}</span>
      </Td>
    );
  }
  return <Td align="right">{cell.qty}</Td>;
}
