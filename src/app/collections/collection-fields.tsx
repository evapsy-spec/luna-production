/**
 * Поля коллекции — один набор для создания и для редактирования,
 * чтобы формы не расходились между собой.
 */
import { Field, Input, Textarea, Thumb } from "@/components/ui";

export interface CollectionFieldValues {
  name?: string | null;
  description?: string | null;
  photoUrl?: string | null;
  ainurCategoryId?: string | null;
}

export function CollectionFields({
  values = {},
}: {
  values?: CollectionFieldValues;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Название" required>
        <Input
          name="name"
          required
          defaultValue={values.name ?? ""}
          placeholder="Essential"
        />
      </Field>

      <Field
        label="Категория в Ainur"
        hint={
          values.ainurCategoryId
            ? "Приходит из Ainur, менять нельзя"
            : "Заполнится сама при синхронизации с Ainur"
        }
      >
        <Input
          name="ainurCategoryId"
          disabled
          defaultValue={values.ainurCategoryId ?? ""}
          placeholder="—"
        />
      </Field>

      <div className="sm:col-span-2">
        <Field label="Описание">
          <Textarea
            name="description"
            defaultValue={values.description ?? ""}
            placeholder="Базовая линия: лёгкие платья и топы на каждый день"
          />
        </Field>
      </div>

      <div className="sm:col-span-2">
        <Field
          label="Фото коллекции"
          hint={values.photoUrl ? "Новый файл заменит текущее фото" : undefined}
        >
          <div className="flex items-center gap-3">
            {values.photoUrl ? (
              <Thumb src={values.photoUrl} alt="Текущее фото" />
            ) : null}
            <Input type="file" name="photo" accept="image/*" />
          </div>
        </Field>
      </div>
    </div>
  );
}
