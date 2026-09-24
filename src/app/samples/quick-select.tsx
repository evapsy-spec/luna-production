"use client";

/**
 * Компактный dropdown прямо на карточке модели (статус / «у кого задача»),
 * который сохраняется сразу при выборе — без отдельной кнопки «Сохранить».
 * ТЗ Евы: карточка должна быть компактной и сразу показывать, что нужно
 * менять, без захода внутрь модели ради простой смены статуса.
 */
import { useRef, useTransition } from "react";

export function QuickSelect({
  action,
  hidden,
  name,
  value,
  options,
  className = "",
}: {
  action: (formData: FormData) => void | Promise<void>;
  hidden: Record<string, string>;
  name: string;
  value: string;
  options: { value: string; label: string }[];
  className?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      ref={formRef}
      action={action}
      onClick={(e) => e.stopPropagation()}
      className="inline-block"
    >
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <select
        name={name}
        defaultValue={value}
        disabled={pending}
        onChange={() => startTransition(() => formRef.current?.requestSubmit())}
        className={`touch rounded-lg border border-[var(--color-line)] bg-white px-2 py-1.5 text-xs outline-none focus:border-[var(--color-gold)] disabled:opacity-60 ${className}`}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </form>
  );
}
