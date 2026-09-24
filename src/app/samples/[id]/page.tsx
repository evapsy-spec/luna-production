import { redirect, notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { canSeeMoney, diffFields, getCurrentUser, writeAudit } from "@/lib/auth";
import { saveOptionalUpload } from "@/lib/uploads";
import {
  Button,
  Callout,
  Card,
  Field,
  Input,
  LinkButton,
  Money,
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
import {
  DESIGNERS,
  DESIGNER_LABELS,
  SAMPLE_ASSIGNEES,
  SAMPLE_STATUSES,
  SAMPLE_STATUS_LABELS,
  assigneeLabel,
  getActiveFactories,
  getSampleCategories,
  getSampleModel,
  nextVersionNumber,
  parseNum,
  parseStr,
  statusTimestampPatch,
  type SampleAssignee,
  type SampleStatus,
} from "@/lib/samples";

export const metadata = { title: "Модель — Образцы — Luna Production" };

// ============================================================
// Server actions
// ============================================================

async function updateModel(formData: FormData) {
  "use server";
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const id = String(formData.get("id") ?? "");
  const before = (
    await db.select().from(schema.sampleModels).where(eq(schema.sampleModels.id, id)).limit(1)
  )[0];
  if (!before) return;

  const name = parseStr(formData.get("name")) ?? before.name;
  const status = (parseStr(formData.get("status")) ?? before.status) as SampleStatus;
  const assignee = (parseStr(formData.get("assignee")) ?? before.assignee) as SampleAssignee;
  const now = new Date().toISOString();
  const patch = statusTimestampPatch(status, now);

  let sketchPhotoUrl = before.sketchPhotoUrl;
  try {
    const saved = await saveOptionalUpload(formData.get("sketch"), "products");
    if (saved) sketchPhotoUrl = saved.url;
  } catch {
    redirect(`/samples/${id}?error=photo`);
  }

  const after = {
    name,
    categoryId: parseStr(formData.get("categoryId")),
    status,
    designer: parseStr(formData.get("designer")) ?? before.designer,
    assignee,
    factoryId: parseStr(formData.get("factoryId")),
    currentTask: parseStr(formData.get("currentTask")),
    dueDate: parseStr(formData.get("dueDate")),
    driveFolderUrl: parseStr(formData.get("driveFolderUrl")),
    seasonCollection: parseStr(formData.get("seasonCollection")),
    estimatedUnitCostThb: canSeeMoney(user)
      ? parseNum(formData.get("estimatedUnitCostThb"))
      : before.estimatedUnitCostThb,
    note: parseStr(formData.get("note")),
    sketchPhotoUrl,
    updatedAt: now,
    designerApprovedAt:
      patch.designerApprovedAt && !before.designerApprovedAt
        ? patch.designerApprovedAt
        : before.designerApprovedAt,
    finalApprovedAt:
      patch.finalApprovedAt && !before.finalApprovedAt
        ? patch.finalApprovedAt
        : before.finalApprovedAt,
    droppedAt: patch.droppedAt && !before.droppedAt ? patch.droppedAt : before.droppedAt,
  };

  await db.update(schema.sampleModels).set(after).where(eq(schema.sampleModels.id, id));

  const changes = diffFields(before, after, [
    "name",
    "categoryId",
    "status",
    "designer",
    "assignee",
    "factoryId",
    "currentTask",
    "dueDate",
    "seasonCollection",
  ]);
  if (changes) {
    await writeAudit(user, {
      action: "UPDATE",
      entityType: "SampleModel",
      entityId: id,
      entityName: name,
      changes,
    });
  }

  revalidatePath("/samples");
  revalidatePath(`/samples/${id}`);
  redirect(`/samples/${id}?ok=saved`);
}

async function addVersion(formData: FormData) {
  "use server";
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const modelId = String(formData.get("modelId") ?? "");
  const model = (
    await db.select().from(schema.sampleModels).where(eq(schema.sampleModels.id, modelId)).limit(1)
  )[0];
  if (!model) return;

  let photoUrl: string | null = null;
  try {
    const saved = await saveOptionalUpload(formData.get("photo"), "products");
    photoUrl = saved?.url ?? null;
  } catch {
    redirect(`/samples/${modelId}?error=photo`);
  }

  const versionNumber = await nextVersionNumber(modelId);
  await db.insert(schema.sampleVersions).values({
    modelId,
    versionNumber,
    photoUrl,
    comment: parseStr(formData.get("comment")),
    sampleCostThb: canSeeMoney(user) ? parseNum(formData.get("sampleCostThb")) : null,
    shippingCostThb: canSeeMoney(user) ? parseNum(formData.get("shippingCostThb")) : null,
  });

  await writeAudit(user, {
    action: "CREATE",
    entityType: "SampleVersion",
    entityId: modelId,
    entityName: `${model.name} — Sample V${versionNumber}`,
  });

  revalidatePath(`/samples/${modelId}`);
  redirect(`/samples/${modelId}?ok=version`);
}

async function addFabricLink(formData: FormData) {
  "use server";
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const modelId = String(formData.get("modelId") ?? "");
  const model = (
    await db.select().from(schema.sampleModels).where(eq(schema.sampleModels.id, modelId)).limit(1)
  )[0];
  if (!model) return;

  const name = parseStr(formData.get("name"));
  const composition = parseStr(formData.get("composition"));
  const color = parseStr(formData.get("color"));
  // хотя бы что-то из ключевых полей — иначе пустая "идея" не имеет смысла
  if (!name && !composition && !color) redirect(`/samples/${modelId}?error=fabric`);

  await db.insert(schema.sampleFabricLinks).values({
    modelId,
    name,
    composition,
    color,
    supplierName: parseStr(formData.get("supplierName")),
    price: canSeeMoney(user) ? parseNum(formData.get("price")) : null,
    currency: parseStr(formData.get("currency")),
    widthCm: parseNum(formData.get("widthCm")),
    moq: parseStr(formData.get("moq")),
    code: parseStr(formData.get("code")),
    url: parseStr(formData.get("url")),
    note: parseStr(formData.get("note")),
  });

  revalidatePath(`/samples/${modelId}`);
  redirect(`/samples/${modelId}?ok=fabric`);
}

async function deleteFabricLink(formData: FormData) {
  "use server";
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const id = String(formData.get("id") ?? "");
  const modelId = String(formData.get("modelId") ?? "");
  if (!id || !modelId) return;
  await db.delete(schema.sampleFabricLinks).where(eq(schema.sampleFabricLinks.id, id));
  revalidatePath(`/samples/${modelId}`);
}

// ============================================================
// Страница
// ============================================================

const OK_MESSAGES: Record<string, string> = {
  created: "Модель создана",
  saved: "Изменения сохранены",
  version: "Версия образца добавлена",
  fabric: "Ткань добавлена",
};

const ERROR_MESSAGES: Record<string, string> = {
  photo: "Фото не сохранилось: поддерживаются JPG, PNG, WEBP и GIF до 25 МБ",
  fabric: "Заполните хотя бы название, состав или цвет ткани",
};

export default async function SampleModelPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const sp = await searchParams;
  const data = await getSampleModel(id);
  if (!data) notFound();
  const { model, versions, fabricLinks, category, factory } = data;
  const money = canSeeMoney(user);

  const [categories, factories] = await Promise.all([
    getSampleCategories(),
    getActiveFactories(),
  ]);

  const status = model.status as SampleStatus;
  const canCreateOrder = status === "FINAL_APPROVED" && !model.productionOrderId;

  return (
    <>
      <PageHeader
        title={model.name}
        subtitle={[category?.name, assigneeLabel(model.assignee as SampleAssignee, factory?.name)]
          .filter(Boolean)
          .join(" · ")}
        action={
          <div className="flex flex-wrap gap-2">
            {model.driveFolderUrl ? (
              <LinkButton href={model.driveFolderUrl} variant="secondary">
                📁 Drive
              </LinkButton>
            ) : null}
            <LinkButton href="/samples">Назад к списку</LinkButton>
          </div>
        }
      />

      {sp.ok ? (
        <Callout tone="ok" title={OK_MESSAGES[sp.ok] ?? "Сохранено"}>{null}</Callout>
      ) : null}
      {sp.error ? (
        <Callout tone="critical" title="Не сохранено">
          {ERROR_MESSAGES[sp.error] ?? sp.error}
        </Callout>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusPill tone={status === "DROPPED" ? "neutral" : status === "FINAL_APPROVED" ? "ok" : "warn"}>
          {SAMPLE_STATUS_LABELS[status]}
        </StatusPill>
        {model.seasonCollection ? <StatusPill tone="neutral">{model.seasonCollection}</StatusPill> : null}
        {canCreateOrder ? (
          <span title="Перейдёт во вкладку «Заказы» — пока не реализовано">
            <Button variant="secondary" disabled>
              Создать заказ →
            </Button>
          </span>
        ) : null}
      </div>

      {/* ---------- Основные поля ---------- */}
      <form action={updateModel}>
        <input type="hidden" name="id" value={model.id} />
        <Card className="grid gap-4 sm:grid-cols-2">
          <Field label="Название модели" required>
            <Input name="name" defaultValue={model.name} required />
          </Field>
          <Field label="Категория">
            <Select name="categoryId" defaultValue={model.categoryId ?? ""}>
              <option value="">Не выбрана</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Статус">
            <Select name="status" defaultValue={status}>
              {SAMPLE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {SAMPLE_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="У кого задача">
            <Select name="assignee" defaultValue={model.assignee}>
              {SAMPLE_ASSIGNEES.map((a) => (
                <option key={a} value={a}>
                  {a === "FACTORY" ? (factory?.name ?? "Фабрика") : DESIGNER_LABELS[a]}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Дизайнер">
            <Select name="designer" defaultValue={model.designer}>
              {DESIGNERS.map((d) => (
                <option key={d} value={d}>
                  {DESIGNER_LABELS[d]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Фабрика">
            <Select name="factoryId" defaultValue={model.factoryId ?? ""}>
              <option value="">Не выбрана</option>
              {factories.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Текущая задача">
            <Input name="currentTask" defaultValue={model.currentTask ?? ""} />
          </Field>
          <Field label="Срок">
            <Input type="date" name="dueDate" defaultValue={model.dueDate ?? ""} />
          </Field>

          <Field label="Папка Google Drive">
            <Input name="driveFolderUrl" defaultValue={model.driveFolderUrl ?? ""} />
          </Field>
          <Field label="Сезон / коллекция">
            <Input name="seasonCollection" defaultValue={model.seasonCollection ?? ""} />
          </Field>

          {money ? (
            <Field
              label="Предварительная стоимость производства / ед., THB"
              hint="Ориентир от фабрики — НЕ стоимость образца, не влияет на цену изделия"
            >
              <Input
                type="number"
                step="0.01"
                name="estimatedUnitCostThb"
                defaultValue={model.estimatedUnitCostThb ?? ""}
              />
            </Field>
          ) : null}

          <div className="sm:col-span-2">
            <Field label="Заметка">
              <Textarea name="note" defaultValue={model.note ?? ""} />
            </Field>
          </div>

          <div className="sm:col-span-2">
            <Field label="Заменить эскиз / фото" hint="Необязательно — текущее фото сохранится, если не выбрано новое">
              <input type="file" name="sketch" accept="image/*" className="touch block w-full text-sm" />
            </Field>
          </div>
        </Card>

        <div className="mt-4">
          <Button type="submit" variant="primary">
            Сохранить
          </Button>
        </div>
      </form>

      {/* ---------- Версии образцов ---------- */}
      <SectionTitle>Версии образца</SectionTitle>
      {versions.length === 0 ? (
        <p className="text-sm text-[var(--color-muted)]">Пока не добавлено ни одной версии.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Версия</Th>
              <Th>Дата</Th>
              <Th>Комментарий</Th>
              {money ? <Th align="right">Sample</Th> : null}
              {money ? <Th align="right">Доставка</Th> : null}
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.id}>
                <Td>
                  V{v.versionNumber}
                  {v.photoUrl ? (
                    <a href={v.photoUrl} target="_blank" rel="noreferrer" className="ml-2 text-xs underline">
                      фото
                    </a>
                  ) : null}
                </Td>
                <Td>{formatDate(v.date)}</Td>
                <Td>{v.comment ?? "—"}</Td>
                {money ? <Td align="right">{v.sampleCostThb != null ? <Money value={v.sampleCostThb} /> : "—"}</Td> : null}
                {money ? <Td align="right">{v.shippingCostThb != null ? <Money value={v.shippingCostThb} /> : "—"}</Td> : null}
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <Card className="mt-3">
        <form action={addVersion} className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="modelId" value={model.id} />
          <Field label="Комментарий">
            <Input name="comment" placeholder="Проверили посадку, рукав узковат" />
          </Field>
          <Field label="Фото образца">
            <input type="file" name="photo" accept="image/*" className="touch block w-full text-sm" />
          </Field>
          {money ? (
            <Field label="Стоимость образца, THB">
              <Input type="number" step="0.01" name="sampleCostThb" />
            </Field>
          ) : null}
          {money ? (
            <Field label="Стоимость доставки, THB">
              <Input type="number" step="0.01" name="shippingCostThb" />
            </Field>
          ) : null}
          <div className="sm:col-span-2">
            <Button type="submit" variant="secondary">
              + Добавить версию Sample V{versions.length + 1}
            </Button>
          </div>
        </form>
      </Card>

      {/* ---------- Ткани и материалы ---------- */}
      <SectionTitle>Ткани и материалы</SectionTitle>
      {fabricLinks.length === 0 ? (
        <p className="text-sm text-[var(--color-muted)]">Пока не привязано ни одной ткани.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {fabricLinks.map((f) => (
            <Card key={f.id} className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm">
                <div className="font-medium text-[var(--color-ocean)]">
                  {f.name ?? "Без названия"} {f.color ? `· ${f.color}` : ""}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-[var(--color-muted)]">
                  {f.composition ? <span>{f.composition}</span> : null}
                  {f.supplierName ? <span>поставщик: {f.supplierName}</span> : null}
                  {money && f.price != null ? (
                    <span>
                      {f.price} {f.currency ?? "THB"}/м
                    </span>
                  ) : null}
                  {f.widthCm ? <span>{f.widthCm} см</span> : null}
                  {f.moq ? <span>MOQ {f.moq}</span> : null}
                  {f.code ? <span>код {f.code}</span> : null}
                  {f.fabricId ? <span className="text-[#0A7A0A]">в библиотеке тканей</span> : null}
                  {f.url ? (
                    <a href={f.url} target="_blank" rel="noreferrer" className="underline">
                      ссылка
                    </a>
                  ) : null}
                </div>
              </div>
              <form action={deleteFabricLink}>
                <input type="hidden" name="id" value={f.id} />
                <input type="hidden" name="modelId" value={model.id} />
                <Button type="submit" variant="danger">
                  Убрать
                </Button>
              </form>
            </Card>
          ))}
        </div>
      )}

      <Card className="mt-3">
        <form action={addFabricLink} className="grid gap-3 sm:grid-cols-3">
          <input type="hidden" name="modelId" value={model.id} />
          <Field label="Название">
            <Input name="name" placeholder="Шёлк-сатин" />
          </Field>
          <Field label="Цвет">
            <Input name="color" />
          </Field>
          <Field label="Состав">
            <Input name="composition" placeholder="100% шёлк" />
          </Field>
          <Field label="Поставщик">
            <Input name="supplierName" />
          </Field>
          {money ? (
            <Field label="Цена / м">
              <Input type="number" step="0.01" name="price" />
            </Field>
          ) : null}
          <Field label="Валюта">
            <Input name="currency" placeholder="THB" />
          </Field>
          <Field label="Ширина, см">
            <Input type="number" step="0.1" name="widthCm" />
          </Field>
          <Field label="MOQ">
            <Input name="moq" placeholder="30 м" />
          </Field>
          <Field label="Код / артикул">
            <Input name="code" />
          </Field>
          <div className="sm:col-span-3">
            <Field label="Ссылка">
              <Input name="url" placeholder="https://..." />
            </Field>
          </div>
          <div className="sm:col-span-3">
            <Field label="Доп. заметка">
              <Input name="note" />
            </Field>
          </div>
          <div className="sm:col-span-3">
            <Button type="submit" variant="secondary">
              + Добавить ткань
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
