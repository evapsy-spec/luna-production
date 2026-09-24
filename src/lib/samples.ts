/**
 * Образцы — разработка новых моделей одежды: от идеи/ТЗ до финального
 * утверждения и передачи в производственный заказ.
 *
 * Одна карточка = одна модель (разные цвета/варианты внутри неё, не
 * отдельные карточки). См. полное ТЗ Евы от 24.09.2026 и таблицы
 * sampleModels/sampleVersions/sampleFabricLinks в @/lib/db/schema.
 */
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import {
  DESIGNERS,
  SAMPLE_ASSIGNEES,
  SAMPLE_STATUSES,
  type Designer,
  type SampleAssignee,
  type SampleStatus,
} from "@/lib/db/schema";

export { DESIGNERS, SAMPLE_ASSIGNEES, SAMPLE_STATUSES };
export type { Designer, SampleAssignee, SampleStatus };

export const DESIGNER_LABELS: Record<Designer, string> = {
  EVA: "Ева",
  NATALIE: "Натали",
};

/**
 * Статусы разработки в порядке из ТЗ п.5. Ключ — значение в базе,
 * label — то, что видит пользователь в dropdown.
 */
export const SAMPLE_STATUS_LABELS: Record<SampleStatus, string> = {
  IDEA: "Идея / ТЗ не готово",
  SPEC_READY: "ТЗ готово",
  MATERIALS_SELECTED: "Материалы выбраны",
  SENT_TO_FACTORY: "Передано фабрике",
  SAMPLE_IN_PROGRESS: "Образец в работе",
  SAMPLE_READY: "Образец готов",
  SAMPLE_REVIEW: "Образец на проверке",
  REVISION: "Доработка",
  DESIGNER_APPROVED: "Утверждено дизайнером",
  FINAL_APPROVED: "Финально утверждено",
  DROPPED: "Снято",
};

/** % прогресса — определяется статусом, пользователь не вводит вручную (ТЗ п.5) */
export const SAMPLE_STATUS_PROGRESS: Record<SampleStatus, number> = {
  IDEA: 0,
  SPEC_READY: 15,
  MATERIALS_SELECTED: 25,
  SENT_TO_FACTORY: 35,
  SAMPLE_IN_PROGRESS: 45,
  SAMPLE_READY: 60,
  SAMPLE_REVIEW: 70,
  REVISION: 80,
  DESIGNER_APPROVED: 90,
  FINAL_APPROVED: 100,
  DROPPED: 0,
};

/** Статусы, которые считаются «активной разработкой» (не показываем «Снято» по умолчанию, ТЗ п.5) */
export function isActiveStatus(status: SampleStatus): boolean {
  return status !== "DROPPED";
}

/**
 * «У кого задача» — если FACTORY, показываем название конкретной фабрики
 * модели, а не слово «Фабрика» (ТЗ п.3).
 */
export function assigneeLabel(
  assignee: SampleAssignee,
  factoryName: string | null | undefined,
): string {
  if (assignee === "FACTORY") return factoryName ?? "Фабрика";
  return DESIGNER_LABELS[assignee as Designer] ?? assignee;
}

/**
 * Штампы дат при смене статуса — фиксируем только первое достижение
 * статуса (история), не перезаписываем при повторной установке того же
 * статуса. Если дизайнер — Ева, промежуточный «Утверждено дизайнером»
 * можно не проставлять вовсе: её собственное финальное утверждение сразу
 * переводит модель в 100% (ТЗ п.6) — сама смена статуса это уже позволяет,
 * никакого отдельного запрета тут нет.
 */
export function statusTimestampPatch(
  newStatus: SampleStatus,
  now: string,
): Partial<{
  designerApprovedAt: string;
  finalApprovedAt: string;
  droppedAt: string;
}> {
  if (newStatus === "DESIGNER_APPROVED") return { designerApprovedAt: now };
  if (newStatus === "FINAL_APPROVED") return { finalApprovedAt: now };
  if (newStatus === "DROPPED") return { droppedAt: now };
  return {};
}

// ============================================================
// СПИСОК
// ============================================================

export interface SampleListRow {
  id: string;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  status: SampleStatus;
  designer: Designer;
  assignee: SampleAssignee;
  factoryId: string | null;
  factoryName: string | null;
  currentTask: string | null;
  dueDate: string | null;
  sketchPhotoUrl: string | null;
  seasonCollection: string | null;
  progress: number;
}

export async function listSampleModels(): Promise<SampleListRow[]> {
  const rows = await db
    .select({
      id: schema.sampleModels.id,
      name: schema.sampleModels.name,
      categoryId: schema.sampleModels.categoryId,
      categoryName: schema.sampleCategories.name,
      status: schema.sampleModels.status,
      designer: schema.sampleModels.designer,
      assignee: schema.sampleModels.assignee,
      factoryId: schema.sampleModels.factoryId,
      factoryName: schema.factories.name,
      currentTask: schema.sampleModels.currentTask,
      dueDate: schema.sampleModels.dueDate,
      sketchPhotoUrl: schema.sampleModels.sketchPhotoUrl,
      seasonCollection: schema.sampleModels.seasonCollection,
    })
    .from(schema.sampleModels)
    .leftJoin(
      schema.sampleCategories,
      eq(schema.sampleModels.categoryId, schema.sampleCategories.id),
    )
    .leftJoin(
      schema.factories,
      eq(schema.sampleModels.factoryId, schema.factories.id),
    )
    .orderBy(desc(schema.sampleModels.updatedAt));

  return rows.map((r) => {
    const status = r.status as SampleStatus;
    return {
      ...r,
      status,
      designer: r.designer as Designer,
      assignee: r.assignee as SampleAssignee,
      progress: SAMPLE_STATUS_PROGRESS[status] ?? 0,
    };
  });
}

export interface SampleListFilters {
  category?: string;
  status?: string;
  designer?: string;
  factory?: string;
  assignee?: string;
  season?: string;
  q?: string;
}

/** «Снято» скрыто, если явно не выбран фильтр по статусу = DROPPED (ТЗ п.5) */
export function applyFilters(
  rows: SampleListRow[],
  filters: SampleListFilters,
): SampleListRow[] {
  return rows.filter((r) => {
    if (r.status === "DROPPED" && filters.status !== "DROPPED") return false;
    if (filters.category && r.categoryId !== filters.category) return false;
    if (filters.status && r.status !== filters.status) return false;
    if (filters.designer && r.designer !== filters.designer) return false;
    if (filters.factory && r.factoryId !== filters.factory) return false;
    if (filters.assignee && r.assignee !== filters.assignee) return false;
    if (filters.season && r.seasonCollection !== filters.season) return false;
    if (filters.q) {
      const q = filters.q.trim().toLowerCase();
      if (q && !r.name.toLowerCase().includes(q)) return false;
    }
    return true;
  });
}

/** Кликабельная сводка по категориям над списком, с учётом фильтров (ТЗ п.14) */
export function summarizeByCategory(
  rows: SampleListRow[],
): { id: string; name: string; count: number }[] {
  const counts = new Map<string, { name: string; count: number }>();
  for (const r of rows) {
    const key = r.categoryId ?? "__none__";
    const name = r.categoryName ?? "Без категории";
    const cur = counts.get(key);
    if (cur) cur.count++;
    else counts.set(key, { name, count: 1 });
  }
  return [...counts.entries()]
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.count - a.count);
}

// ============================================================
// СПРАВОЧНИКИ ДЛЯ ФОРМ
// ============================================================

export async function getSampleCategories() {
  return db
    .select()
    .from(schema.sampleCategories)
    .where(eq(schema.sampleCategories.isArchived, false))
    .orderBy(schema.sampleCategories.sortOrder, schema.sampleCategories.name);
}

export async function getActiveFactories() {
  return db
    .select({ id: schema.factories.id, name: schema.factories.name })
    .from(schema.factories)
    .where(eq(schema.factories.isArchived, false))
    .orderBy(schema.factories.name);
}

// ============================================================
// КАРТОЧКА МОДЕЛИ (детальный экран)
// ============================================================

export async function getSampleModel(id: string) {
  const model = (
    await db
      .select()
      .from(schema.sampleModels)
      .where(eq(schema.sampleModels.id, id))
      .limit(1)
  )[0];
  if (!model) return null;

  const [versions, fabricLinks, category, factory] = await Promise.all([
    db
      .select()
      .from(schema.sampleVersions)
      .where(eq(schema.sampleVersions.modelId, id))
      .orderBy(desc(schema.sampleVersions.versionNumber)),
    db
      .select()
      .from(schema.sampleFabricLinks)
      .where(eq(schema.sampleFabricLinks.modelId, id)),
    model.categoryId
      ? db
          .select()
          .from(schema.sampleCategories)
          .where(eq(schema.sampleCategories.id, model.categoryId))
          .limit(1)
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
    model.factoryId
      ? db
          .select()
          .from(schema.factories)
          .where(eq(schema.factories.id, model.factoryId))
          .limit(1)
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
  ]);

  return { model, versions, fabricLinks, category, factory };
}

export async function nextVersionNumber(modelId: string): Promise<number> {
  const rows = await db
    .select({ versionNumber: schema.sampleVersions.versionNumber })
    .from(schema.sampleVersions)
    .where(eq(schema.sampleVersions.modelId, modelId));
  return rows.reduce((max, r) => Math.max(max, r.versionNumber), 0) + 1;
}

// ============================================================
// Мелкие парсеры форм — те же соглашения, что в src/app/orders/_shared.tsx
// ============================================================

export function parseStr(v: FormDataEntryValue | null): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

export function parseNum(v: FormDataEntryValue | null): number | null {
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
