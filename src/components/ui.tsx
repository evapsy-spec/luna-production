/**
 * UI-кит Luna Production.
 *
 * Правила дизайна (из ТЗ):
 *  - Deep Ocean — шапка, навигация, текст и заголовки
 *  - Gold Moon — акцент: главные кнопки, активные состояния, денежные суммы
 *  - White Sand — фон страниц и карточек
 *  - Playfair Display для заголовков и крупных цифр, Jost для остального
 *  - тач-таргеты не меньше 44×44, карточки со скруглением 10–12px
 *  - статус НИКОГДА не передаётся одним цветом — всегда цвет + иконка + подпись
 */
import type { ReactNode } from "react";

// ============================================================
// Карточки и раскладка
// ============================================================

export function Card({
  children,
  className = "",
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border border-[var(--color-line)] bg-white shadow-[0_1px_3px_rgba(2,51,58,0.06)] ${
        padded ? "p-4 sm:p-5" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="m-0 text-2xl leading-tight sm:text-[28px]">{title}</h1>
        {subtitle ? (
          <p className="mt-1 mb-0 text-sm text-[var(--color-muted)]">{subtitle}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="mt-8 mb-3 border-b-2 border-[var(--color-gold)] pb-2 text-lg">
      {children}
    </h2>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <Card className="text-center">
      <p className="m-0 font-medium text-[var(--color-ocean)]">{title}</p>
      {hint ? (
        <p className="mx-auto mt-2 mb-0 max-w-md text-sm text-[var(--color-muted)]">
          {hint}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </Card>
  );
}

// ============================================================
// Кнопки — тач-таргет 44px минимум
// ============================================================

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

/**
 * ВАЖНО про hover и планшет.
 *
 * В Tailwind v4 вариант hover: сам обёрнут в @media (hover: hover) — на
 * тач-экране он НЕ СРАБАТЫВАЕТ ВООБЩЕ. Пока здесь были только hover-стили,
 * кнопка на планшете при нажатии не менялась никак и выглядела неживой.
 * Поэтому у каждого варианта обязателен active: — он работает и мышью,
 * и пальцем. Добавляя новый вариант, не забудь про active.
 */
export const buttonStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--color-gold)] text-white border-transparent hover:bg-[var(--color-gold-deep)] active:bg-[var(--color-gold-deep)]",
  secondary:
    "bg-white text-[var(--color-ocean)] border-[var(--color-line)] hover:bg-[var(--color-sand-warm)] active:bg-[var(--color-sand-warm)] active:border-[var(--color-gold)]",
  ghost:
    "bg-transparent text-[var(--color-ocean)] border-transparent hover:bg-[var(--color-sand-warm)] active:bg-[var(--color-sand-warm)]",
  danger:
    "bg-white text-[var(--color-critical)] border-[#EBC3C3] hover:bg-[#FDF3F3] active:bg-[#F8E4E4]",
};

/** Общая часть класса кнопки: нажатие видно и пальцем, а не только мышью */
export const BUTTON_BASE =
  "touch inline-flex items-center justify-center gap-2 rounded-lg border px-4 py-2.5 " +
  "text-sm font-medium transition-[background-color,border-color,transform] duration-100 " +
  "active:scale-[0.98]";

export function Button({
  children,
  variant = "primary",
  type = "button",
  className = "",
  disabled,
  onClick,
  formAction,
  name,
  value,
}: {
  children: ReactNode;
  variant?: ButtonVariant;
  type?: "button" | "submit";
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
  formAction?: (formData: FormData) => void | Promise<void>;
  name?: string;
  value?: string;
}) {
  return (
    <button
      type={type}
      name={name}
      value={value}
      disabled={disabled}
      onClick={onClick}
      formAction={formAction}
      className={`${BUTTON_BASE} disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 ${buttonStyles[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function LinkButton({
  href,
  children,
  variant = "secondary",
  className = "",
}: {
  href: string;
  children: ReactNode;
  variant?: ButtonVariant;
  className?: string;
}) {
  return (
    <a
      href={href}
      className={`${BUTTON_BASE} no-underline ${buttonStyles[variant]} ${className}`}
    >
      {children}
    </a>
  );
}

// ============================================================
// Поля ввода
// ============================================================

export function Field({
  label,
  children,
  hint,
  required,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
        {label}
        {required ? <span className="text-[var(--color-gold)]"> *</span> : null}
      </span>
      {children}
      {hint ? (
        <span className="mt-1 block text-xs text-[var(--color-faint)]">{hint}</span>
      ) : null}
    </label>
  );
}

const inputClass =
  "touch w-full rounded-lg border border-[var(--color-line)] bg-white px-3 py-2.5 text-[15px] text-[var(--color-ink)] outline-none focus:border-[var(--color-gold)] focus:ring-2 focus:ring-[var(--color-gold)]/20";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

export function Textarea(
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement>,
) {
  return (
    <textarea
      {...props}
      className={`${inputClass} min-h-[80px] ${props.className ?? ""}`}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={`${inputClass} ${props.className ?? ""}`}>
      {props.children}
    </select>
  );
}

export function Checkbox({
  label,
  name,
  defaultChecked,
}: {
  label: string;
  name: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="touch flex cursor-pointer items-center gap-2.5">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="h-5 w-5 rounded border-[var(--color-line)] accent-[var(--color-gold)]"
      />
      <span className="text-sm">{label}</span>
    </label>
  );
}

// ============================================================
// Статусы — цвет + иконка + подпись, никогда не цвет один
// ============================================================

export type StatusTone = "ok" | "warn" | "serious" | "critical" | "neutral";

const statusVisual: Record<StatusTone, { color: string; bg: string; icon: string }> =
  {
    ok: { color: "#0A7A0A", bg: "#EAF6EA", icon: "✓" },
    warn: { color: "#8A5A17", bg: "#FBF1E1", icon: "!" },
    serious: { color: "#A8522F", bg: "#FBEDE7", icon: "▲" },
    critical: { color: "#A82C2C", bg: "#FBE9E9", icon: "✕" },
    neutral: { color: "#5C7278", bg: "#F1EEE5", icon: "•" },
  };

export function StatusPill({
  tone,
  children,
}: {
  tone: StatusTone;
  children: ReactNode;
}) {
  const v = statusVisual[tone];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap"
      style={{ color: v.color, background: v.bg }}
    >
      <span aria-hidden="true">{v.icon}</span>
      {children}
    </span>
  );
}

/** Статусы заказа на пошив в человеческом виде */
export function OrderStatusPill({ status }: { status: string }) {
  const map: Record<string, { tone: StatusTone; label: string }> = {
    SAMPLE: { tone: "warn", label: "Образец" },
    IN_PRODUCTION: { tone: "ok", label: "В производстве" },
    READY: { tone: "ok", label: "Готово" },
    RECEIVED: { tone: "neutral", label: "Принято на склад" },
    CANCELLED: { tone: "neutral", label: "Отменён" },
  };
  const v = map[status] ?? { tone: "neutral" as StatusTone, label: status };
  return <StatusPill tone={v.tone}>{v.label}</StatusPill>;
}

// ============================================================
// Числа и деньги
// ============================================================

export function Money({
  value,
  hidden,
  className = "",
}: {
  value: number;
  /** для роли MANAGER суммы скрыты */
  hidden?: boolean;
  className?: string;
}) {
  if (hidden) {
    return (
      <span className={`text-[var(--color-faint)] ${className}`} title="Финансы видны только владельцам">
        —
      </span>
    );
  }
  return (
    <span className={`figure text-[var(--color-gold-deep)] ${className}`}>
      {Math.round(value).toLocaleString("ru-RU").replace(/,/g, " ")}
      <span className="ml-1 text-xs font-normal opacity-70">THB</span>
    </span>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: StatusTone;
}) {
  return (
    <Card>
      <div className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
        {label}
      </div>
      <div className="figure mt-1.5 text-2xl text-[var(--color-ocean)]">{value}</div>
      {sub ? (
        <div className="mt-1.5 text-xs text-[var(--color-muted)]">{sub}</div>
      ) : null}
      {tone ? <div className="mt-2">{/* место под индикатор */}</div> : null}
    </Card>
  );
}

// ============================================================
// Таблицы — на телефоне скроллятся горизонтально
// ============================================================

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0">
      <table className="w-full min-w-[520px] border-collapse text-sm">
        {children}
      </table>
    </div>
  );
}

export function Th({
  children,
  align = "left",
}: {
  children: ReactNode;
  align?: "left" | "right" | "center";
}) {
  return (
    <th
      className="bg-[var(--color-sand-warm)] px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]"
      style={{ textAlign: align }}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = "left",
  className = "",
}: {
  children: ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
}) {
  return (
    <td
      className={`border-t border-[var(--color-line)] px-3 py-2.5 ${
        align === "right" ? "tnum" : ""
      } ${className}`}
      style={{ textAlign: align }}
    >
      {children}
    </td>
  );
}

// ============================================================
// Прочее
// ============================================================

/** Ссылка на WhatsApp — общение с фабриками и поставщиками идёт там */
export function WhatsappLink({
  phone,
  text,
  children,
}: {
  phone: string | null;
  text?: string;
  children?: ReactNode;
}) {
  if (!phone) return null;
  const clean = phone.replace(/[^\d]/g, "");
  const url = `https://wa.me/${clean}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="touch inline-flex items-center gap-1.5 text-sm text-[var(--color-ocean)] underline decoration-[var(--color-line)]"
    >
      {children ?? `WhatsApp ${phone}`}
    </a>
  );
}

/** Кнопка «Маршрут» — открывает Google Maps по координатам или адресу */
export function MapsLink({
  lat,
  lng,
  address,
  url,
  label = "Маршрут",
}: {
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
  url?: string | null;
  label?: string;
}) {
  let href: string | null = null;
  if (lat != null && lng != null) {
    href = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  } else if (url) {
    href = url;
  } else if (address) {
    href = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
  }
  if (!href) return null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="touch inline-flex items-center gap-1.5 text-sm text-[var(--color-ocean)] underline decoration-[var(--color-line)]"
    >
      📍 {label}
    </a>
  );
}

/** Превью фото в едином формате — квадрат со скруглением */
export function Thumb({
  src,
  alt,
  size = 56,
}: {
  src?: string | null;
  alt: string;
  size?: number;
}) {
  if (!src) {
    return (
      <div
        className="flex shrink-0 items-center justify-center rounded-lg bg-[var(--color-sand-warm)] text-[var(--color-faint)]"
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        <span className="text-lg">▢</span>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className="shrink-0 rounded-lg object-cover"
      style={{ width: size, height: size }}
    />
  );
}

export function Callout({
  tone = "neutral",
  title,
  children,
}: {
  tone?: StatusTone;
  title?: string;
  children: ReactNode;
}) {
  const v = statusVisual[tone];
  return (
    <div
      className="mb-4 rounded-lg px-4 py-3 text-sm"
      style={{ background: v.bg, color: v.color }}
    >
      {title ? (
        <div className="mb-1 flex items-center gap-1.5 font-semibold">
          <span aria-hidden="true">{v.icon}</span>
          {title}
        </div>
      ) : null}
      <div>{children}</div>
    </div>
  );
}

export function formatDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
