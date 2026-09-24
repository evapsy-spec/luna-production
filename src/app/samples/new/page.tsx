import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { getCurrentUser, writeAudit } from "@/lib/auth";
import { saveOptionalUpload } from "@/lib/uploads";
import {
  Button,
  Callout,
  Card,
  Field,
  Input,
  LinkButton,
  PageHeader,
  Select,
} from "@/components/ui";
import {
  DESIGNERS,
  DESIGNER_LABELS,
  getActiveFactories,
  getSampleCategories,
  parseStr,
} from "@/lib/samples";

export const metadata = { title: "Новая модель — Образцы" };

async function createSampleModel(formData: FormData) {
  "use server";
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const name = parseStr(formData.get("name"));
  if (!name) redirect("/samples/new?error=required");

  const designer = parseStr(formData.get("designer")) ?? "EVA";
  // по умолчанию задача у того же, кто ведёт разработку — дальше можно
  // сразу поменять на карточке (ТЗ: assignee и designer — разные поля)
  const assignee = parseStr(formData.get("assignee")) ?? designer;

  let sketchPhotoUrl: string | null = null;
  try {
    const saved = await saveOptionalUpload(formData.get("sketch"), "products");
    sketchPhotoUrl = saved?.url ?? null;
  } catch {
    redirect("/samples/new?error=photo");
  }

  const [model] = await db
    .insert(schema.sampleModels)
    .values({
      name,
      categoryId: parseStr(formData.get("categoryId")),
      designer,
      assignee,
      factoryId: parseStr(formData.get("factoryId")),
      currentTask: parseStr(formData.get("currentTask")),
      dueDate: parseStr(formData.get("dueDate")),
      driveFolderUrl: parseStr(formData.get("driveFolderUrl")),
      seasonCollection: parseStr(formData.get("seasonCollection")),
      sketchPhotoUrl,
    })
    .returning();

  await writeAudit(user, {
    action: "CREATE",
    entityType: "SampleModel",
    entityId: model.id,
    entityName: model.name,
  });

  revalidatePath("/samples");
  redirect(`/samples/${model.id}?ok=created`);
}

async function createCategory(formData: FormData) {
  "use server";
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const name = parseStr(formData.get("categoryName"));
  if (!name) redirect("/samples/new?error=category");

  const existing = (
    await db.select().from(schema.sampleCategories).where(eq(schema.sampleCategories.name, name)).limit(1)
  )[0];
  const category =
    existing ??
    (
      await db.insert(schema.sampleCategories).values({ name }).returning()
    )[0];

  revalidatePath("/samples");
  revalidatePath("/samples/new");
  redirect(`/samples/new?category=${category.id}`);
}

const ERRORS: Record<string, string> = {
  required: "Название модели обязательно",
  photo: "Фото не сохранилось: поддерживаются JPG, PNG, WEBP и GIF до 25 МБ",
  category: "Введите название категории",
};

export default async function NewSamplePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; category?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const error = params.error ? ERRORS[params.error] : null;

  const [categories, factories] = await Promise.all([
    getSampleCategories(),
    getActiveFactories(),
  ]);

  return (
    <>
      <PageHeader
        title="Новая модель"
        subtitle="Остальные детали — версии образцов, ткани, стоимость — добавляются внутри карточки после создания"
        action={<LinkButton href="/samples">Назад</LinkButton>}
      />

      {error ? (
        <Callout tone="critical" title="Не сохранено">
          {error}
        </Callout>
      ) : null}

      <Card className="mb-4">
        <details>
          <summary className="cursor-pointer text-sm text-[var(--color-ocean)]">
            + добавить новую категорию в справочник
          </summary>
          <form action={createCategory} className="mt-3 flex flex-wrap items-end gap-2">
            <div className="min-w-[200px] flex-1">
              <Field label="Название категории">
                <Input name="categoryName" placeholder="Например «Пальто»" />
              </Field>
            </div>
            <Button type="submit" variant="secondary">
              Добавить категорию
            </Button>
          </form>
        </details>
      </Card>

      <form action={createSampleModel}>
        <Card className="grid gap-4 sm:grid-cols-2">
          <Field label="Название модели" required>
            <Input name="name" placeholder="Sophie Kimono" required />
          </Field>
          <Field label="Категория">
            <Select name="categoryId" defaultValue={params.category ?? ""}>
              <option value="">Не выбрана</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Дизайнер" hint="Кто ведёт разработку модели">
            <Select name="designer" defaultValue="EVA">
              {DESIGNERS.map((d) => (
                <option key={d} value={d}>
                  {DESIGNER_LABELS[d]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Фабрика" hint="На этом этапе — одна фабрика на модель">
            <Select name="factoryId" defaultValue="">
              <option value="">Пока не выбрана</option>
              {factories.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Текущая задача" hint="Например «Изменить форму рукава»">
            <Input name="currentTask" placeholder="Подготовить ТЗ" />
          </Field>
          <Field label="Срок" hint="Необязательно">
            <Input type="date" name="dueDate" />
          </Field>

          <Field label="Папка Google Drive" hint="Ссылка на папку модели, не на отдельный файл">
            <Input name="driveFolderUrl" placeholder="https://drive.google.com/..." />
          </Field>
          <Field label="Сезон / коллекция" hint="Например SS27, Beach Capsule 27">
            <Input name="seasonCollection" placeholder="SS27" />
          </Field>

          <div className="sm:col-span-2">
            <Field label="Эскиз / фото" hint="Превью на карточке в общем списке">
              <input
                type="file"
                name="sketch"
                accept="image/*"
                className="touch block w-full text-sm"
              />
            </Field>
          </div>
        </Card>

        <div className="mt-5 flex flex-wrap gap-3">
          <Button type="submit" variant="primary">
            Сохранить модель
          </Button>
          <LinkButton href="/samples" variant="ghost">
            Отмена
          </LinkButton>
        </div>
      </form>
    </>
  );
}
