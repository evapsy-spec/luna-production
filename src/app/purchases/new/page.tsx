import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { asc, eq, like } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { getCurrentUser, writeAudit } from "@/lib/auth";
import {
  Button,
  Callout,
  Card,
  Field,
  Input,
  LinkButton,
  PageHeader,
  SectionTitle,
  Select,
} from "@/components/ui";
import { CURRENCIES, parseNumber, parseText } from "../../fabrics/fabric-fields";

export const metadata = { title: "Новая заявка на ткань — Luna Production" };

/** Пустых строк в форме — столько; заполнять можно любые */
const LINE_SLOTS = 5;

/** Номер вида FP-2026-004: продолжаем нумерацию текущего года */
async function nextNumber(): Promise<string> {
  const prefix = `FP-${new Date().getFullYear()}-`;
  const taken = await db
    .select({ number: schema.fabricPurchases.number })
    .from(schema.fabricPurchases)
    .where(like(schema.fabricPurchases.number, `${prefix}%`));
  const maxSeq = taken.reduce(
    (max, r) => Math.max(max, Number(r.number.slice(prefix.length)) || 0),
    0,
  );
  return `${prefix}${String(maxSeq + 1).padStart(3, "0")}`;
}

interface LineInput {
  fabricId: string | null;
  draftName: string | null;
  metersNeeded: number;
  pricePerMeter: number | null;
  currency: string | null;
  fxRateToThb: number | null;
  note: string | null;
}

async function createPurchase(formData: FormData) {
  "use server";
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const rows: LineInput[] = [];
  for (let i = 0; i < LINE_SLOTS; i++) {
    const fabricId = parseText(formData.get(`fabricId_${i}`));
    const draftName = parseText(formData.get(`draftName_${i}`));
    const meters = parseNumber(formData.get(`meters_${i}`));
    // строка существует, только если выбрана ткань из библиотеки ИЛИ вписано
    // название новой — а метраж больше нуля обязателен в обоих случаях
    if ((!fabricId && !draftName) || meters == null || meters <= 0) continue;

    const price = parseNumber(formData.get(`price_${i}`));
    rows.push({
      // если выбрали существующую ткань — черновик игнорируем, чтобы не путать
      fabricId: fabricId || null,
      draftName: fabricId ? null : draftName,
      metersNeeded: meters,
      pricePerMeter: price,
      currency: price != null ? (parseText(formData.get(`currency_${i}`)) ?? "THB") : null,
      fxRateToThb: price != null ? (parseNumber(formData.get(`fx_${i}`)) ?? 1) : null,
      note: parseText(formData.get(`note_${i}`)),
    });
  }
  if (rows.length === 0) redirect("/purchases/new?error=lines");

  const [purchase] = await db
    .insert(schema.fabricPurchases)
    .values({
      number: await nextNumber(),
      status: "DRAFT",
      reason: parseText(formData.get("reason")),
      supplierId: parseText(formData.get("supplierId")),
    })
    .returning();

  await db.insert(schema.fabricPurchaseLines).values(
    rows.map((r) => ({
      purchaseId: purchase.id,
      fabricId: r.fabricId,
      draftName: r.draftName,
      metersNeeded: r.metersNeeded,
      pricePerMeter: r.pricePerMeter,
      currency: r.currency,
      fxRateToThb: r.fxRateToThb,
      note: r.note,
    })),
  );

  await writeAudit(user, {
    action: "CREATE",
    entityType: "fabric_purchase",
    entityId: purchase.id,
    entityName: purchase.number,
    changes: {
      строк: { from: null, to: rows.length },
      метров: { from: null, to: rows.reduce((s, r) => s + r.metersNeeded, 0) },
    },
  });

  revalidatePath("/purchases");
  redirect("/purchases");
}

export default async function NewPurchasePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const flags = await searchParams;

  const suppliers = await db
    .select({ id: schema.suppliers.id, name: schema.suppliers.name })
    .from(schema.suppliers)
    .orderBy(asc(schema.suppliers.name));

  const fabrics = await db
    .select({
      id: schema.fabrics.id,
      name: schema.fabrics.name,
      sku: schema.fabrics.sku,
    })
    .from(schema.fabrics)
    .where(eq(schema.fabrics.isArchived, false))
    .orderBy(asc(schema.fabrics.name));

  return (
    <>
      <PageHeader
        title="Новая заявка на ткань"
        subtitle="Вручную — когда докупаем не под конкретный заказ на пошив"
        action={<LinkButton href="/purchases">Назад к заявкам</LinkButton>}
      />

      {flags.error === "lines" ? (
        <Callout tone="critical" title="Заявка не создана">
          Заполните хотя бы одну строку: выберите ткань из библиотеки или
          впишите название новой, и укажите метраж больше нуля.
        </Callout>
      ) : null}

      <form action={createPurchase}>
        <Card>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Поставщик">
              <Select name="supplierId" defaultValue="">
                <option value="">— не выбран —</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Причина" hint="Например: пополнение запаса перед сезоном">
              <Input name="reason" placeholder="Пополнение запаса" />
            </Field>
          </div>
        </Card>

        <SectionTitle>Строки заявки</SectionTitle>
        <p className="-mt-3 mb-3 text-sm text-[var(--color-muted)]">
          В каждой строке — либо ткань из библиотеки, либо название новой,
          которой там ещё нет. Цена нужна, только если уже известна —
          заявку можно собрать и без неё.
        </p>
        <Card>
          <div className="flex flex-col gap-5">
            {Array.from({ length: LINE_SLOTS }).map((_, i) => (
              <div
                key={i}
                className="flex flex-col gap-3 border-b border-[var(--color-line)] pb-5 last:border-0 last:pb-0"
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={`Ткань ${i + 1}, из библиотеки`}>
                    <Select name={`fabricId_${i}`} defaultValue="">
                      <option value="">— не из библиотеки —</option>
                      {fabrics.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                          {f.sku ? ` · ${f.sku}` : ""}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field
                    label="…или новая ткань"
                    hint="Заполняйте, только если выше ничего не выбрано"
                  >
                    <Input name={`draftName_${i}`} placeholder="Название новой ткани" />
                  </Field>
                </div>
                <div className="grid gap-3 sm:grid-cols-5">
                  <Field label="Метров">
                    <Input
                      name={`meters_${i}`}
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0"
                    />
                  </Field>
                  <Field label="Цена за метр">
                    <Input
                      name={`price_${i}`}
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="необязательно"
                    />
                  </Field>
                  <Field label="Валюта">
                    <Select name={`currency_${i}`} defaultValue="THB">
                      {CURRENCIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Курс к THB">
                    <Input
                      name={`fx_${i}`}
                      type="number"
                      step="0.0001"
                      min="0"
                      placeholder="1"
                    />
                  </Field>
                  <Field label="Примечание">
                    <Input name={`note_${i}`} placeholder="Нужен тот же оттенок" />
                  </Field>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <div className="mt-5 flex flex-wrap gap-3">
          <Button type="submit" variant="primary">
            Создать заявку
          </Button>
          <LinkButton href="/purchases" variant="ghost">
            Отмена
          </LinkButton>
        </div>
      </form>
    </>
  );
}
