/** Поля поставщика — один набор для создания и редактирования */
import { Field, Input, Textarea } from "@/components/ui";

export interface SupplierFieldValues {
  name?: string | null;
  contact?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  address?: string | null;
  mapsLat?: number | null;
  mapsLng?: number | null;
  mapsUrl?: string | null;
  country?: string | null;
  note?: string | null;
}

function numValue(value?: number | null): string | undefined {
  return value == null ? undefined : String(value);
}

export function SupplierFields({ values = {} }: { values?: SupplierFieldValues }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Название" required>
        <Input
          name="name"
          required
          defaultValue={values.name ?? ""}
          placeholder="Bali Silk House"
        />
      </Field>

      <Field label="Контактное лицо">
        <Input name="contact" defaultValue={values.contact ?? ""} placeholder="Wayan" />
      </Field>

      <Field label="Телефон">
        <Input name="phone" defaultValue={values.phone ?? ""} placeholder="+62 812 345 678" />
      </Field>

      <Field label="WhatsApp" hint="Только цифры, например 6281234567890">
        <Input
          name="whatsapp"
          inputMode="numeric"
          defaultValue={values.whatsapp ?? ""}
          placeholder="6281234567890"
        />
      </Field>

      <Field label="Email">
        <Input name="email" type="email" defaultValue={values.email ?? ""} />
      </Field>

      <Field label="Страна" hint="Код или название: ID, TH, UA">
        <Input name="country" defaultValue={values.country ?? ""} placeholder="ID" />
      </Field>

      <div className="sm:col-span-2">
        <Field label="Адрес">
          <Input
            name="address"
            defaultValue={values.address ?? ""}
            placeholder="Jl. Raya Ubud No. 12, Bali"
          />
        </Field>
      </div>

      <Field label="Широта" hint="Для кнопки «Маршрут»">
        <Input
          name="mapsLat"
          type="number"
          step="0.000001"
          defaultValue={numValue(values.mapsLat)}
          placeholder="-8.5069"
        />
      </Field>

      <Field label="Долгота">
        <Input
          name="mapsLng"
          type="number"
          step="0.000001"
          defaultValue={numValue(values.mapsLng)}
          placeholder="115.2625"
        />
      </Field>

      <div className="sm:col-span-2">
        <Field
          label="Ссылка Google Maps"
          hint="Если координат нет — маршрут пойдёт по этой ссылке"
        >
          <Input name="mapsUrl" defaultValue={values.mapsUrl ?? ""} />
        </Field>
      </div>

      <div className="sm:col-span-2">
        <Field label="Примечание">
          <Textarea
            name="note"
            defaultValue={values.note ?? ""}
            placeholder="Красят под заказ, оплата в USD"
          />
        </Field>
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

/** Значения поставщика из формы — одинаковые для создания и обновления */
export function supplierValuesFromForm(formData: FormData) {
  return {
    name: parseText(formData.get("name")) ?? "",
    contact: parseText(formData.get("contact")),
    phone: parseText(formData.get("phone")),
    // в wa.me уходят только цифры, поэтому чистим сразу при сохранении
    whatsapp: parseText(formData.get("whatsapp"))?.replace(/\D/g, "") || null,
    email: parseText(formData.get("email")),
    address: parseText(formData.get("address")),
    mapsLat: parseNumber(formData.get("mapsLat")),
    mapsLng: parseNumber(formData.get("mapsLng")),
    mapsUrl: parseText(formData.get("mapsUrl")),
    country: parseText(formData.get("country")),
    note: parseText(formData.get("note")),
  };
}
