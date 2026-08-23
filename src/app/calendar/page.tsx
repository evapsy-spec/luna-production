import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { getCurrentUser, requireUser, writeAudit } from "@/lib/auth";
import {
  Button,
  Callout,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  SectionTitle,
  Select,
  StatusPill,
  Table,
  Td,
  Textarea,
  Th,
  formatDate,
} from "@/components/ui";
import type { StatusTone } from "@/components/ui";

export const metadata = { title: "Календарь коллекций — Luna Production" };

const DAY_MS = 24 * 3600 * 1000;

/** Дата «начать пошив не позже» = дата продажи минус время пошива */
function productionStart(targetOnSaleAt: string, leadTimeDays: number): string {
  return new Date(
    new Date(targetOnSaleAt).getTime() - leadTimeDays * DAY_MS,
  ).toISOString();
}

/** Дни до даты, считаем по календарным сутками — время внутри дня не важно */
function daysUntil(iso: string): number {
  const target = new Date(iso);
  const today = new Date();
  const t = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate());
  const n = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((t - n) / DAY_MS);
}

function launchStatus(
  isDone: boolean,
  daysLeft: number,
): { tone: StatusTone; label: string } {
  if (isDone) return { tone: "neutral", label: "сделано" };
  if (daysLeft < 0) return { tone: "critical", label: "пора было начать" };
  if (daysLeft < 14) return { tone: "warn", label: "скоро старт" };
  return { tone: "ok", label: "в графике" };
}

function daysText(daysLeft: number): string {
  if (daysLeft === 0) return "старт сегодня";
  if (daysLeft < 0) return `просрочено на ${Math.abs(daysLeft)} дн`;
  return `осталось ${daysLeft} дн`;
}

async function createLaunch(formData: FormData) {
  "use server";
  const user = await requireUser();

  const collectionId = String(formData.get("collectionId") ?? "");
  const season = String(formData.get("season") ?? "").trim();
  const target = String(formData.get("targetOnSaleAt") ?? "").trim();
  const leadRaw = Number(String(formData.get("leadTimeDays") ?? "45"));
  const leadTimeDays = Number.isFinite(leadRaw) && leadRaw > 0 ? Math.round(leadRaw) : 45;
  const note = String(formData.get("note") ?? "").trim() || null;

  if (!collectionId || !season || !target) redirect("/calendar?error=fields");

  const collection = (
    await db
      .select()
      .from(schema.collections)
      .where(eq(schema.collections.id, collectionId))
      .limit(1)
  )[0];
  if (!collection) redirect("/calendar?error=fields");

  const targetIso = new Date(`${target}T00:00:00.000Z`).toISOString();
  const id = crypto.randomUUID();

  await db.insert(schema.collectionLaunches).values({
    id,
    collectionId,
    season,
    targetOnSaleAt: targetIso,
    leadTimeDays,
    productionStartBy: productionStart(targetIso, leadTimeDays),
    note,
    isDone: false,
  });

  await writeAudit(user, {
    action: "CREATE",
    entityType: "CollectionLaunch",
    entityId: id,
    entityName: `${collection.name} · ${season}`,
  });

  revalidatePath("/calendar");
}

async function toggleDone(formData: FormData) {
  "use server";
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const launch = (
    await db
      .select()
      .from(schema.collectionLaunches)
      .where(eq(schema.collectionLaunches.id, id))
      .limit(1)
  )[0];
  if (!launch) return;

  const collection = (
    await db
      .select({ name: schema.collections.name })
      .from(schema.collections)
      .where(eq(schema.collections.id, launch.collectionId))
      .limit(1)
  )[0];

  const next = !launch.isDone;
  await db
    .update(schema.collectionLaunches)
    .set({ isDone: next })
    .where(eq(schema.collectionLaunches.id, id));

  await writeAudit(user, {
    action: "UPDATE",
    entityType: "CollectionLaunch",
    entityId: id,
    entityName: `${collection?.name ?? "коллекция"} · ${launch.season}`,
    changes: { isDone: { from: launch.isDone, to: next } },
  });

  revalidatePath("/calendar");
}

async function deleteLaunch(formData: FormData) {
  "use server";
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const launch = (
    await db
      .select()
      .from(schema.collectionLaunches)
      .where(eq(schema.collectionLaunches.id, id))
      .limit(1)
  )[0];
  if (!launch) return;

  const collection = (
    await db
      .select({ name: schema.collections.name })
      .from(schema.collections)
      .where(eq(schema.collections.id, launch.collectionId))
      .limit(1)
  )[0];

  await db
    .delete(schema.collectionLaunches)
    .where(eq(schema.collectionLaunches.id, id));

  await writeAudit(user, {
    action: "DELETE",
    entityType: "CollectionLaunch",
    entityId: id,
    entityName: `${collection?.name ?? "коллекция"} · ${launch.season}`,
  });

  revalidatePath("/calendar");
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const query = await searchParams;

  const rows = await db
    .select({
      id: schema.collectionLaunches.id,
      season: schema.collectionLaunches.season,
      targetOnSaleAt: schema.collectionLaunches.targetOnSaleAt,
      leadTimeDays: schema.collectionLaunches.leadTimeDays,
      note: schema.collectionLaunches.note,
      isDone: schema.collectionLaunches.isDone,
      collectionId: schema.collectionLaunches.collectionId,
      collectionName: schema.collections.name,
    })
    .from(schema.collectionLaunches)
    .innerJoin(
      schema.collections,
      eq(schema.collectionLaunches.collectionId, schema.collections.id),
    )
    .orderBy(asc(schema.collectionLaunches.targetOnSaleAt));

  const launches = rows.map((row) => {
    // productionStartBy в базе может быть пустым — считаем дату здесь
    const startBy = productionStart(row.targetOnSaleAt, row.leadTimeDays);
    const daysLeft = daysUntil(startBy);
    return { ...row, startBy, daysLeft, status: launchStatus(row.isDone, daysLeft) };
  });

  const overdue = launches.filter(
    (l) => !l.isDone && l.daysLeft < 0,
  ).length;
  const soon = launches.filter(
    (l) => !l.isDone && l.daysLeft >= 0 && l.daysLeft < 14,
  ).length;
  const onTrack = launches.filter((l) => !l.isDone && l.daysLeft >= 14).length;
  const done = launches.filter((l) => l.isDone).length;

  const collections = await db
    .select({ id: schema.collections.id, name: schema.collections.name })
    .from(schema.collections)
    .where(eq(schema.collections.isArchived, false))
    .orderBy(asc(schema.collections.name));

  return (
    <>
      <PageHeader
        title="Календарь запуска коллекций"
        subtitle="Когда коллекция должна быть в продаже — и когда для этого начать пошив"
      />

      {overdue > 0 ? (
        <Callout tone="critical" title="Пошив пора было начать">
          {overdue} {overdue === 1 ? "запуск" : "запусков"} уже вышли за дату
          старта. Либо начинайте пошив сейчас, либо переносите дату продажи.
        </Callout>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
            Просрочено
          </div>
          <div className="figure mt-1 text-2xl text-[var(--color-ocean)]">
            {overdue}
          </div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
            Скоро старт
          </div>
          <div className="figure mt-1 text-2xl text-[var(--color-ocean)]">
            {soon}
          </div>
          <div className="mt-0.5 text-xs text-[var(--color-muted)]">
            меньше 14 дней
          </div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
            В графике
          </div>
          <div className="figure mt-1 text-2xl text-[var(--color-ocean)]">
            {onTrack}
          </div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
            Сделано
          </div>
          <div className="figure mt-1 text-2xl text-[var(--color-ocean)]">
            {done}
          </div>
        </Card>
      </div>

      <SectionTitle>Запуски</SectionTitle>
      {launches.length === 0 ? (
        <EmptyState
          title="Запусков пока нет"
          hint="Добавьте первый запуск ниже: укажите коллекцию, сезон и дату, к которой она должна быть в продаже."
        />
      ) : (
        <Card padded={false}>
          <Table>
            <thead>
              <tr>
                <Th>Коллекция</Th>
                <Th>Сезон</Th>
                <Th>В продаже с</Th>
                <Th>Пошив</Th>
                <Th>Начать не позже</Th>
                <Th>Статус</Th>
                <Th>Действия</Th>
              </tr>
            </thead>
            <tbody>
              {launches.map((launch) => (
                <tr key={launch.id}>
                  <Td>
                    <div className="font-medium">{launch.collectionName}</div>
                    {launch.note ? (
                      <div className="text-xs text-[var(--color-muted)]">
                        {launch.note}
                      </div>
                    ) : null}
                  </Td>
                  <Td>{launch.season}</Td>
                  <Td>{formatDate(launch.targetOnSaleAt)}</Td>
                  <Td align="right">{launch.leadTimeDays} дн</Td>
                  <Td>
                    <div className="font-medium">{formatDate(launch.startBy)}</div>
                    <div className="text-xs text-[var(--color-muted)]">
                      {launch.isDone ? "—" : daysText(launch.daysLeft)}
                    </div>
                  </Td>
                  <Td>
                    <StatusPill tone={launch.status.tone}>
                      {launch.status.label}
                    </StatusPill>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-2">
                      <form action={toggleDone}>
                        <input type="hidden" name="id" value={launch.id} />
                        <Button type="submit" variant="secondary">
                          {launch.isDone ? "Вернуть в работу" : "Сделано"}
                        </Button>
                      </form>
                      <form action={deleteLaunch}>
                        <input type="hidden" name="id" value={launch.id} />
                        <Button type="submit" variant="danger">
                          Удалить
                        </Button>
                      </form>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <SectionTitle>Добавить запуск</SectionTitle>
      <Card>
        {collections.length === 0 ? (
          <p className="m-0 text-sm text-[var(--color-muted)]">
            Сначала добавьте коллекции — запуск планируется для конкретной
            коллекции.
          </p>
        ) : (
          <form action={createLaunch}>
            {query.error === "fields" ? (
              <div className="mb-4 rounded-lg bg-[#FBE9E9] px-3.5 py-2.5 text-sm text-[#A82C2C]">
                <span aria-hidden="true">✕</span> Заполните коллекцию, сезон и
                дату продажи
              </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Коллекция" required>
                <Select name="collectionId" required defaultValue="">
                  <option value="" disabled>
                    Выберите коллекцию
                  </option>
                  {collections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Сезон" required hint="например: Лето 2027">
                <Input name="season" required placeholder="Лето 2027" />
              </Field>
              <Field label="Должно быть в продаже" required>
                <Input name="targetOnSaleAt" type="date" required />
              </Field>
              <Field
                label="Время пошива, дней"
                hint="из него считается дата «начать не позже»"
              >
                <Input
                  name="leadTimeDays"
                  inputMode="numeric"
                  defaultValue={45}
                />
              </Field>
            </div>
            <div className="mt-4">
              <Field label="Примечание">
                <Textarea name="note" />
              </Field>
            </div>
            <div className="mt-4">
              <Button type="submit">Добавить запуск</Button>
            </div>
          </form>
        )}
      </Card>
    </>
  );
}
