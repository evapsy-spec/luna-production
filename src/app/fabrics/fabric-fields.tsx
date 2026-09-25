/**
 * Поля карточки ткани — один набор для создания и для редактирования,
 * чтобы формы не расходились между собой.
 */
import { Checkbox, Field, Input, Select, Textarea, Thumb } from "@/components/ui";

export const CURRENCIES = ["THB", "USD", "IDR", "UAH", "EUR"] as const;

export interface FabricFieldValues {
  sku?: string | null;
  name?: string | null;
  composition?: string | null;
  color?: string | null;
  isDyed?: boolean;
  rollLengthM?: number | null;
  widthCm?: number | null;
  purchasePrice?: number | null;
  purchaseCurrency?: string | null;
  fxRateToThb?: number | null;
  priceDate?: string | null;
  supplierId?: string | null;
  note?: string | null;
  isOnOrder?: boolean;
  photoUrl?: string | null;
}

export interface SupplierOption {
  id: string;
  name: string;
}

/** Число в значение поля: null не должен превратиться в строку «null» */
function numValue(value?: number | null): string | undefined {
  return value == null ? undefined : String(value);
}

/** input type="date" принимает только YYYY-MM-DD, а в базе лежит ISO-строка */
function dateValue(value?: string | null): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString().slice(0, 10);
}

export function FabricFields({
  values = {},
  suppliers,
}: {
  values?: FabricFieldValues;
  suppliers: SupplierOption[];
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Название" required>
        <Input
          name="name"
          required
          defaultValue={values.name ?? ""}
          placeholder="Шёлк Deep Ocean"
        />
      </Field>

      <Field label="SKU" hint="Необязательно. Уникальный код ткани, как в закупках — если не ведёте коды, оставьте пустым">
        <Input
          name="sku"
          defaultValue={values.sku ?? ""}
          placeholder="SILK-DO-140"
        />
      </Field>

      <Field label="Состав">
        <Input
          name="composition"
          defaultValue={values.composition ?? ""}
          placeholder="100% silk satin"
        />
      </Field>

      <Field label="Цвет">
        <Input
          name="color"
          defaultValue={values.color ?? ""}
          placeholder="Deep Ocean"
        />
      </Field>

      <Field label="Метраж рулона, м">
        <Input
          name="rollLengthM"
          type="number"
          step="0.01"
          min="0"
          defaultValue={numValue(values.rollLengthM)}
        />
      </Field>

      <Field label="Ширина, см">
        <Input
          name="widthCm"
          type="number"
          step="0.1"
          min="0"
          defaultValue={numValue(values.widthCm)}
        />
      </Field>

      <Field label="Цена за метр" required>
        <Input
          name="purchasePrice"
          type="number"
          step="0.01"
          min="0"
          required
          defaultValue={numValue(values.purchasePrice)}
        />
      </Field>

      <Field label="Валюта закупки">
        <Select name="purchaseCurrency" defaultValue={values.purchaseCurrency ?? "THB"}>
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Курс к THB"
        required
        hint="Цена × курс = цена в THB. Курс фиксируется на дату закупки и задним числом не пересчитывается. Для THB ставьте 1."
      >
        <Input
          name="fxRateToThb"
          type="number"
          step="0.0001"
          min="0"
          required
          defaultValue={numValue(values.fxRateToThb) ?? "1"}
        />
      </Field>

      <Field label="Дата цены">
        <Input name="priceDate" type="date" defaultValue={dateValue(values.priceDate)} />
      </Field>

      <Field label="Поставщик">
        <div className="flex items-center gap-2">
          <Select name="supplierId" defaultValue={values.supplierId ?? ""} className="flex-1">
            <option value="">— не выбран —</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <a
            href="/suppliers/new"
            target="_blank"
            rel="noreferrer"
            className="touch whitespace-nowrap text-sm text-[var(--color-ocean)] underline hover:no-underline"
          >
            + Новый
          </a>
        </div>
      </Field>

      <Field
        label="Фото ткани"
        hint={values.photoUrl ? "Новый файл заменит текущее фото" : undefined}
      >
        <div className="flex items-center gap-3">
          {values.photoUrl ? <Thumb src={values.photoUrl} alt="Текущее фото" /> : null}
          <Input type="file" name="photo" accept="image/*" />
        </div>
      </Field>

      <div className="sm:col-span-2">
        <Field label="Примечание">
          <Textarea
            name="note"
            defaultValue={values.note ?? ""}
            placeholder="Красят под заказ, срок 10 дней"
          />
        </Field>
      </div>

      <div className="flex flex-col gap-2 sm:col-span-2">
        <Checkbox
          name="isDyed"
          label="Красим сами (ткань приходит белой)"
          defaultChecked={values.isDyed ?? false}
        />
        <Checkbox
          name="isOnOrder"
          label="Заказано, ожидаем поставку"
          defaultChecked={values.isOnOrder ?? false}
        />
      </div>
    </div>
  );
}

/** Число из формы: люди пишут и «12,5», и «12.5» */
export function parseNumber(value: FormDataEntryValue | null): number | null {
  if (value == null) return null;
  const text = String(value).trim().replace(",", ".");
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** Пустая строка из формы должна лечь в базу как NULL, а не как "" */
export function parseText(value: FormDataEntryValue | null): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}
