/**
 * Общие части раздела «Фабрики»: индикатор загрузки, оценки скоркарда
 * и набор полей формы фабрики (одинаковый для создания и редактирования).
 */
import type { StatusTone } from "@/components/ui";
import { Field, Input, StatusPill, Textarea } from "@/components/ui";

/** Порог, после которого фабрику считаем перегруженной */
export const OVERLOAD_PCT = 85;

export function formatPct(value: number | null): string {
  return value === null ? "—" : `${value}%`;
}

/** Чем выше процент сдачи в срок, тем лучше */
export function onTimeTone(value: number | null): StatusTone {
  if (value === null) return "neutral";
  if (value >= 90) return "ok";
  if (value >= 70) return "warn";
  return "critical";
}

/** Брака чем меньше, тем лучше */
export function defectTone(value: number | null): StatusTone {
  if (value === null) return "neutral";
  if (value <= 2) return "ok";
  if (value <= 5) return "warn";
  return "critical";
}

export function capacityTone(pct: number | null): StatusTone {
  if (pct === null) return "neutral";
  if (pct > 100) return "critical";
  if (pct > OVERLOAD_PCT) return "warn";
  return "ok";
}

/**
 * Полоска загрузки: сколько единиц сейчас в работе против мощности в месяц.
 * Без указанной мощности процент посчитать нельзя — тогда показываем только штуки.
 */
export function CapacityBar({
  unitsInProgress,
  capacityUnits,
  pct,
}: {
  unitsInProgress: number;
  capacityUnits: number | null;
  pct: number | null;
}) {
  if (!capacityUnits || pct === null) {
    return (
      <div className="text-xs text-[var(--color-muted)]">
        <span className="tnum font-semibold text-[var(--color-ocean)]">
          {unitsInProgress}
        </span>{" "}
        шт в работе · мощность не указана, загрузку посчитать не из чего
      </div>
    );
  }

  const tone = capacityTone(pct);
  const color =
    tone === "critical"
      ? "var(--color-critical)"
      : tone === "warn"
        ? "var(--color-warn)"
        : "var(--color-ok)";

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-xs text-[var(--color-muted)]">
        <span>Загрузка</span>
        <span className="tnum font-semibold text-[var(--color-ocean)]">
          {unitsInProgress} из {capacityUnits} шт/мес · {pct}%
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[var(--color-sand-warm)]">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(100, Math.max(2, pct))}%`, background: color }}
        />
      </div>
    </div>
  );
}

/** Подпись к загрузке — обязательна, цветом одним статус не передаём */
export function LoadPill({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  if (pct > 100) return <StatusPill tone="critical">перегружена</StatusPill>;
  if (pct > OVERLOAD_PCT) return <StatusPill tone="warn">перегружена</StatusPill>;
  return <StatusPill tone="ok">есть свободная мощность</StatusPill>;
}

// ============================================================
// Форма фабрики
// ============================================================

export interface FactoryFormValues {
  name?: string | null;
  specialization?: string | null;
  contact?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  address?: string | null;
  mapsLat?: number | null;
  mapsLng?: number | null;
  mapsUrl?: string | null;
  country?: string | null;
  monthlyCapacityUnits?: number | null;
  note?: string | null;
}

export function FactoryFormFields({ values }: { values?: FactoryFormValues }) {
  const v = values ?? {};
  return (
    <div className="flex flex-col gap-4">
      <Field label="Название" required>
        <Input name="name" required defaultValue={v.name ?? ""} maxLength={120} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Специализация" hint="например: трикотаж, шёлк, вечерние платья">
          <Input name="specialization" defaultValue={v.specialization ?? ""} />
        </Field>
        <Field label="Страна">
          <Input name="country" defaultValue={v.country ?? ""} />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Контактное лицо">
          <Input name="contact" defaultValue={v.contact ?? ""} />
        </Field>
        <Field label="Телефон">
          <Input name="phone" type="tel" defaultValue={v.phone ?? ""} />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="WhatsApp" hint="только цифры, например 6281234567890">
          <Input
            name="whatsapp"
            inputMode="numeric"
            defaultValue={v.whatsapp ?? ""}
            placeholder="6281234567890"
          />
        </Field>
        <Field label="Email">
          <Input name="email" type="email" defaultValue={v.email ?? ""} />
        </Field>
      </div>

      <Field label="Адрес">
        <Textarea name="address" defaultValue={v.address ?? ""} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Широта" hint="можно не заполнять">
          <Input
            name="mapsLat"
            inputMode="decimal"
            defaultValue={v.mapsLat ?? ""}
            placeholder="-8.6500"
          />
        </Field>
        <Field label="Долгота">
          <Input
            name="mapsLng"
            inputMode="decimal"
            defaultValue={v.mapsLng ?? ""}
            placeholder="115.2167"
          />
        </Field>
        <Field label="Ссылка Google Maps" hint="если координат нет">
          <Input name="mapsUrl" defaultValue={v.mapsUrl ?? ""} />
        </Field>
      </div>

      <Field
        label="Мощность, штук в месяц"
        hint="нужно для индикатора загрузки"
      >
        <Input
          name="monthlyCapacityUnits"
          inputMode="numeric"
          defaultValue={v.monthlyCapacityUnits ?? ""}
          placeholder="400"
        />
      </Field>

      <Field label="Примечание">
        <Textarea name="note" defaultValue={v.note ?? ""} />
      </Field>
    </div>
  );
}

// ============================================================
// Разбор значений формы
// ============================================================

/** Пустую строку превращаем в null, чтобы в базе не было «пустых» значений */
export function formStr(value: FormDataEntryValue | null): string | null {
  const s = String(value ?? "").trim();
  return s.length ? s : null;
}

export function formNum(value: FormDataEntryValue | null): number | null {
  const s = String(value ?? "")
    .trim()
    .replace(",", ".");
  if (!s.length) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function formInt(value: FormDataEntryValue | null): number | null {
  const n = formNum(value);
  return n === null ? null : Math.round(n);
}
