"use client";

/**
 * Кнопка отправки формы, которая честно показывает, что работает.
 *
 * Зачем: Server Action синхронизации с Ainur идёт минутами. Обычная кнопка
 * при этом выглядит так, будто нажатие не сработало — особенно на планшете,
 * где нет курсора и hover-состояния. Здесь через useFormStatus мы знаем,
 * что форма отправлена, и на время запроса блокируем кнопку и показываем
 * крутилку с текстом. Второе нажатие становится невозможным.
 */
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { BUTTON_BASE, buttonStyles, type ButtonVariant } from "./ui";

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="3"
        strokeOpacity="0.25"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function SubmitButton({
  children,
  pendingLabel = "Работаю…",
  variant = "primary",
  className = "",
}: {
  children: ReactNode;
  /** что писать, пока запрос идёт */
  pendingLabel?: string;
  variant?: ButtonVariant;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={`${BUTTON_BASE} disabled:cursor-progress disabled:active:scale-100 ${buttonStyles[variant]} ${className}`}
    >
      {pending ? (
        <>
          <Spinner />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}
