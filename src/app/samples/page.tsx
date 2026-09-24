import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { getCurrentUser, requireUser, writeAudit } from "@/lib/auth";
import {
  Callout,
  Card,
  PageHeader,
  LinkButton,
  Field,
  Input,
  Select,
  Button,
  EmptyState,
  formatDate,
} from "@/components/ui";
import {
  DESIGNERS,
  DESIGNER_LABELS,
  SAMPLE_ASSIGNEES,
  SAMPLE_STATUSES,
  SAMPLE_STATUS_LABELS,
  applyFilters,
  assigneeLabel,
  getActiveFactories,
  getSampleCategories,
  listSampleModels,
  statusTimestampPatch,
  summarizeByCategory,
  type SampleAssignee,
  type SampleListFilters,
  type SampleStatus,
} from "@/lib/samples";
import { QuickSelect } from "./quick-select";

export const metadata = { title: "Образцы — Luna Production" };

// ============================================================
// Быстрые действия прямо со списка — без захода в карточку модели
// ============================================================

async function updateStatus(formData: FormData) {
  "use server";
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "") as SampleStatus;
  if (!id || !SAMPLE_STATUSES.includes(status)) return;

  const before = (
    await db.select().from(schema.sampleModels).where(eq(schema.sampleModels.id, id)).limit(1)
  )[0];
  if (!before) return;

  const now = new Date().toISOString();
  const patch = statusTimestampPatch(status, now);
  const set: Record<string, unknown> = { status, updatedAt: now };
  if (patch.designerApprovedAt && !before.designerApprovedAt)
    set.designerApprovedAt = patch.designerApprovedAt;
  if (patch.finalApprovedAt && !before.finalApprovedAt)
    set.finalApprovedAt = patch.finalApprovedAt;
  if (patch.droppedAt && !before.droppedAt) set.droppedAt = patch.droppedAt;

  await db.update(schema.sampleModels).set(set).where(eq(schema.sampleModels.id, id));

  if (before.status !== status) {
    await writeAudit(user, {
      action: "UPDATE",
      entityType: "SampleModel",
      entityId: id,
      entityName: before.name,
      changes: {
        status: {
          from: SAMPLE_STATUS_LABELS[before.status as SampleStatus] ?? before.status,
          to: SAMPLE_STATUS_LABELS[status],
        },
      },
    });
  }
  revalidatePath("/samples");
}

async function updateAssignee(formData: FormData) {
  "use server";
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  const assignee = String(formData.get("assignee") ?? "") as SampleAssignee;
  if (!id || !SAMPLE_ASSIGNEES.includes(assignee)) return;

  const before = (
    await db.select().from(schema.sampleModels).where(eq(schema.sampleModels.id, id)).limit(1)
  )[0];
  if (!before) return;

  await db
    .update(schema.sampleModels)
    .set({ assignee, updatedAt: new Date().toISOString() })
    .where(eq(schema.sampleModels.id, id));

  if (before.assignee !== assignee) {
    await writeAudit(user, {
      action: "UPDATE",
      entityType: "SampleModel",
      entityId: id,
      entityName: before.name,
      changes: { assignee: { from: before.assignee, to: assignee } },
    });
  }
  revalidatePath("/samples");
}

// ============================================================
// Страница
// ============================================================

interface Params {
  category?: string;
  status?: string;
  designer?: string;
  factory?: string;
  assignee?: string;
  season?: string;
  q?: string;
  ok?: string;
}

const OK_MESSAGES: Record<string, string> = {
  deleted: "Модель удалена",
};

export default async function SamplesPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const [allRows, categories, factories] = await Promise.all([
    listSampleModels(),
    getSampleCategories(),
    getActiveFactories(),
  ]);

  const filters: SampleListFilters = {
    category: params.category || undefined,
    status: params.status || undefined,
    designer: params.designer || undefined,
    factory: params.factory || undefined,
    assignee: params.assignee || undefined,
    season: params.season || undefined,
    q: params.q || undefined,
  };
  const rows = applyFilters(allRows, filters);
  const summary = summarizeByCategory(rows);
  const totalActive = allRows.filter((r) => r.status !== "DROPPED").length;

  const seasons = [
    ...new Set(allRows.map((r) => r.seasonCollection).filter((s): s is string => !!s)),
  ].sort();

  const qs = (over: Partial<Params>) => {
    const merged = { ...params, ...over };
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) if (v) sp.set(k, v);
    const s = sp.toString();
    return `/samples${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="Образцы"
        subtitle="Разработка новых моделей — от идеи до утверждённого образца"
        action={
          <LinkButton href="/samples/new" variant="primary">
            + Новая модель
          </LinkButton>
        }
      />

      {params.ok ? (
        <Callout tone="ok" title={OK_MESSAGES[params.ok] ?? "Готово"}>{null}</Callout>
      ) : null}

      {/* ---------- Сводка по категориям (кликабельная, с учётом фильтров) ---------- */}
      <div className="mb-4 -mx-4 overflow-x-auto px-4">
        <div className="flex flex-wrap gap-2 text-sm">
          <a
            href={qs({ category: undefined })}
            className={`touch inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 no-underline ${
              !params.category
                ? "border-[var(--color-gold)] bg-[var(--color-gold)]/10 text-[var(--color-gold-deep)]"
                : "border-[var(--color-line)] bg-white text-[var(--color-ink)]"
            }`}
          >
            Всего <span className="tnum ml-1 opacity-70">{rows.length}</span>
          </a>
          {summary.map((s) => (
            <a
              key={s.id}
              href={qs({ category: params.category === s.id ? undefined : s.id })}
              className={`touch inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 no-underline ${
                params.category === s.id
                  ? "border-[var(--color-gold)] bg-[var(--color-gold)]/10 text-[var(--color-gold-deep)]"
                  : "border-[var(--color-line)] bg-white text-[var(--color-ink)]"
              }`}
            >
              {s.name} <span className="tnum ml-1 opacity-70">{s.count}</span>
            </a>
          ))}
          {allRows.length > totalActive ? (
            <a
              href={qs({ status: params.status === "DROPPED" ? undefined : "DROPPED" })}
              className={`touch inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 no-underline ${
                params.status === "DROPPED"
                  ? "border-[var(--color-gold)] bg-[var(--color-gold)]/10 text-[var(--color-gold-deep)]"
                  : "border-[var(--color-line)] bg-white text-[var(--color-muted)]"
              }`}
            >
              Снято <span className="tnum ml-1 opacity-70">{allRows.length - totalActive}</span>
            </a>
          ) : null}
        </div>
      </div>

      {/* ---------- Фильтры ---------- */}
      <Card className="mb-4">
        <form method="get" className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4 sm:items-end">
          <Field label="Поиск по названию">
            <Input name="q" defaultValue={params.q ?? ""} placeholder="Sophie Kimono" />
          </Field>
          <Field label="Категория">
            <Select name="category" defaultValue={params.category ?? ""}>
              <option value="">Все</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Статус">
            <Select name="status" defaultValue={params.status ?? ""}>
              <option value="">Все активные</option>
              {SAMPLE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {SAMPLE_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Дизайнер">
            <Select name="designer" defaultValue={params.designer ?? ""}>
              <option value="">Все</option>
              {DESIGNERS.map((d) => (
                <option key={d} value={d}>
                  {DESIGNER_LABELS[d]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Фабрика">
            <Select name="factory" defaultValue={params.factory ?? ""}>
              <option value="">Все</option>
              {factories.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="У кого задача">
            <Select name="assignee" defaultValue={params.assignee ?? ""}>
              <option value="">Все</option>
              <option value="EVA">Ева</option>
              <option value="NATALIE">Натали</option>
              <option value="FACTORY">Фабрика</option>
            </Select>
          </Field>
          <Field label="Сезон / коллекция">
            <Select name="season" defaultValue={params.season ?? ""}>
              <option value="">Все</option>
              {seasons.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex gap-2 sm:col-span-3 lg:col-span-4">
            <Button type="submit" variant="primary">
              Применить
            </Button>
            <LinkButton href="/samples">Сбросить фильтры</LinkButton>
          </div>
        </form>
      </Card>

      {/* ---------- Список карточек ---------- */}
      {rows.length === 0 ? (
        <EmptyState
          title={allRows.length === 0 ? "Моделей в разработке пока нет" : "Под фильтры ничего не попало"}
          hint={
            allRows.length === 0
              ? "Добавьте первую модель — карточка появится здесь."
              : "Попробуйте сбросить фильтры."
          }
          action={
            allRows.length === 0 ? (
              <LinkButton href="/samples/new" variant="primary">
                + Новая модель
              </LinkButton>
            ) : (
              <LinkButton href="/samples">Сбросить фильтры</LinkButton>
            )
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((r) => (
            <Card key={r.id} padded={false} className="overflow-hidden">
              <div className="flex items-stretch">
                <a href={`/samples/${r.id}`} className="shrink-0">
                  {r.sketchPhotoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={r.sketchPhotoUrl}
                      alt={r.name}
                      className="h-full w-20 object-cover sm:w-24"
                    />
                  ) : (
                    <div className="flex h-full w-20 items-center justify-center bg-[var(--color-sand-warm)] text-[var(--color-faint)] sm:w-24">
                      <span className="text-lg">✎</span>
                    </div>
                  )}
                </a>

                <div className="flex min-w-0 flex-1 flex-col justify-between">
                  <div className="flex flex-wrap items-center gap-2 p-3 pb-2">
                    <a
                      href={`/samples/${r.id}`}
                      className="font-medium text-[var(--color-ocean)] no-underline"
                    >
                      {r.name}
                    </a>
                    {r.categoryName ? (
                      <span className="rounded-full bg-[var(--color-sand-warm)] px-2 py-0.5 text-xs text-[var(--color-muted)]">
                        {r.categoryName}
                      </span>
                    ) : null}

                    <QuickSelect
                      action={updateStatus}
                      hidden={{ id: r.id }}
                      name="status"
                      value={r.status}
                      options={SAMPLE_STATUSES.map((s) => ({
                        value: s,
                        label: SAMPLE_STATUS_LABELS[s],
                      }))}
                    />

                    <QuickSelect
                      action={updateAssignee}
                      hidden={{ id: r.id }}
                      name="assignee"
                      value={r.assignee}
                      options={[
                        { value: "EVA", label: "У кого задача: Ева" },
                        { value: "NATALIE", label: "У кого задача: Натали" },
                        {
                          value: "FACTORY",
                          label: `У кого задача: ${r.factoryName ?? "Фабрика"}`,
                        },
                      ]}
                    />

                    <span className="text-xs text-[var(--color-faint)]">
                      дизайнер {DESIGNER_LABELS[r.designer]}
                    </span>

                    {r.dueDate ? (
                      <span className="text-xs text-[var(--color-muted)]">
                        срок {formatDate(r.dueDate)}
                      </span>
                    ) : null}

                    {r.currentTask ? (
                      <span className="text-xs text-[var(--color-muted)]">
                        · задача: {r.currentTask}
                      </span>
                    ) : null}
                  </div>

                  {/* ---------- Нижняя строка: отдельный progress bar (ТЗ п.4) ---------- */}
                  <div className="px-3 pb-3">
                    <div className="mb-1 flex items-center justify-between text-[11px] text-[var(--color-muted)]">
                      <span>{SAMPLE_STATUS_LABELS[r.status]}</span>
                      <span className="tnum">{r.progress}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-[var(--color-sand-warm)]">
                      <div
                        className="h-full rounded-full bg-[var(--color-gold)]"
                        style={{ width: `${r.progress}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
