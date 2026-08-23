/**
 * Поля изделия — один набор для создания и для редактирования.
 * Цена пошива — деньги, поэтому менеджеру поле не показываем и при
 * сохранении не трогаем (иначе сохранение формы обнулит цифру Евы).
 */
import { Field, Input, Select, Textarea, Thumb } from "@/components/ui";

export interface ProductFieldValues {
  collectionId?: string | null;
  name?: string | null;
  baseSku?: string | null;
  defaultSewingCost?: number | null;
  note?: string | null;
  photoUrl?: string | null;
}

export interface CollectionOption {
  id: string;
  name: string;
}

function numValue(value?: number | null): string | undefined {
  return value == null ? undefined : String(value);
}

export function ProductFields({
  values = {},
  collections,
  money,
}: {
  values?: ProductFieldValues;
  collections: CollectionOption[];
  money: boolean;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Коллекция" required>
        <Select
          name="collectionId"
          required
          defaultValue={values.collectionId ?? ""}
        >
          <option value="">— выберите коллекцию —</option>
          {collections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Название изделия" required>
        <Input
          name="name"
          required
          defaultValue={values.name ?? ""}
          placeholder="Платье Luna"
        />
      </Field>

      <Field
        label="Базовый SKU"
        hint="Основа кода вариантов, например DRESS-LUNA"
      >
        <Input
          name="baseSku"
          defaultValue={values.baseSku ?? ""}
          placeholder="DRESS-LUNA"
        />
      </Field>

      {money ? (
        <Field
          label="Себестоимость пошива, THB"
          hint="Берётся, если для пары фабрика–изделие нет отдельной цены"
        >
          <Input
            name="defaultSewingCost"
            type="number"
            step="0.01"
            min="0"
            defaultValue={numValue(values.defaultSewingCost)}
          />
        </Field>
      ) : (
        <Field
          label="Себестоимость пошива, THB"
          hint="Денежные суммы меняют Ева и Константин"
        >
          <Input disabled placeholder="—" />
        </Field>
      )}

      <div className="sm:col-span-2">
        <Field
          label="Фото изделия"
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

      <div className="sm:col-span-2">
        <Field label="Примечание">
          <Textarea
            name="note"
            defaultValue={values.note ?? ""}
            placeholder="Подклад только на лифе, молния сзади"
          />
        </Field>
      </div>
    </div>
  );
}
