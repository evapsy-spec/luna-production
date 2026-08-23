/**
 * Навигация. Мобильно-ориентированная: на телефоне — нижняя панель,
 * до которой легко дотянуться большим пальцем; на компьютере — верхнее меню.
 */
"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";

interface NavItem {
  href: string;
  label: string;
  icon: string;
  ownerOnly?: boolean;
}

const ITEMS: NavItem[] = [
  { href: "/", label: "Главная", icon: "◉" },
  { href: "/orders", label: "Заказы", icon: "✂" },
  { href: "/replenish", label: "На исходе", icon: "⚑" },
  { href: "/collections", label: "Коллекции", icon: "❖" },
  { href: "/fabrics", label: "Ткани", icon: "▤" },
  { href: "/factories", label: "Фабрики", icon: "⌂" },
  { href: "/analytics", label: "Аналитика", icon: "◫" },
];

const MORE_ITEMS: NavItem[] = [
  { href: "/calendar", label: "Календарь коллекций", icon: "▦" },
  { href: "/purchases", label: "Заявки на ткань", icon: "▧" },
  { href: "/suppliers", label: "Поставщики", icon: "◈" },
  { href: "/accessories", label: "Фурнитура", icon: "◇" },
  { href: "/factories/compare", label: "Сравнить фабрики", icon: "⊞" },
  { href: "/sync", label: "Синхронизация с Ainur", icon: "⟳" },
  { href: "/export", label: "Экспорт в Excel", icon: "⤓" },
  { href: "/audit", label: "История изменений", icon: "≡" },
  { href: "/settings", label: "Настройки", icon: "⚙", ownerOnly: true },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function TopNav({
  userName,
  role,
}: {
  userName: string;
  role: "OWNER" | "MANAGER";
}) {
  const pathname = usePathname();
  const visibleMore = MORE_ITEMS.filter(
    (i) => !i.ownerOnly || role === "OWNER",
  );

  return (
    <header className="sticky top-0 z-40 bg-[var(--color-ocean)] text-[var(--color-sand)]">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Link
          href="/"
          className="touch flex items-center gap-2 py-2 no-underline text-[var(--color-sand)]"
        >
          <span
            className="display text-xl leading-none"
            style={{ color: "var(--color-gold)" }}
          >
            LUNA
          </span>
          <span className="hidden text-xs uppercase tracking-[0.18em] opacity-70 sm:inline">
            Production
          </span>
        </Link>

        {/* Меню на компьютере */}
        <nav className="hidden items-center gap-1 md:flex">
          {ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`touch inline-flex items-center rounded-lg px-3 py-2.5 text-sm no-underline transition-colors ${
                isActive(pathname, item.href)
                  ? "bg-white/12 text-[var(--color-gold)]"
                  : "text-[var(--color-sand)]/85 hover:bg-white/8 active:bg-white/15"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <details className="relative">
            <summary className="touch flex cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-white/10 active:bg-white/20">
              <span className="hidden sm:inline">{userName}</span>
              <span aria-hidden="true">▾</span>
            </summary>
            <div className="absolute right-0 z-50 mt-2 w-64 rounded-xl border border-[var(--color-line)] bg-white p-2 text-[var(--color-ink)] shadow-lg">
              <div className="px-3 py-2 text-xs text-[var(--color-muted)]">
                {userName} ·{" "}
                {role === "OWNER" ? "владелец" : "менеджер производства"}
              </div>
              {visibleMore.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="touch flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm no-underline text-[var(--color-ink)] hover:bg-[var(--color-sand-warm)] active:bg-[var(--color-sand-warm)]"
                >
                  <span aria-hidden="true" className="opacity-60">
                    {item.icon}
                  </span>
                  {item.label}
                </Link>
              ))}
              <form action="/api/logout" method="post" className="mt-1 border-t border-[var(--color-line)] pt-1">
                <button
                  type="submit"
                  className="touch w-full rounded-lg px-3 py-2.5 text-left text-sm text-[var(--color-critical)] hover:bg-[#FDF3F3] active:bg-[#F8E4E4]"
                >
                  Выйти
                </button>
              </form>
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}

/** Нижняя панель — основной способ навигации на телефоне */
export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-[var(--color-line)] bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
      <div className="flex">
        {ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              /*
                active: обязателен — на планшете и телефоне hover не
                срабатывает вообще, и без него нижняя панель на нажатие
                визуально не отвечает.
              */
              className={`touch flex flex-1 flex-col items-center gap-0.5 py-2 no-underline transition-colors active:bg-[var(--color-sand-warm)] ${
                active
                  ? "text-[var(--color-gold-deep)]"
                  : "text-[var(--color-muted)]"
              }`}
            >
              <span aria-hidden="true" className="text-base leading-none">
                {item.icon}
              </span>
              <span className="text-[10px] leading-tight">{item.label}</span>
              {active ? (
                <span className="mt-0.5 h-0.5 w-6 rounded-full bg-[var(--color-gold)]" />
              ) : (
                <span className="mt-0.5 h-0.5 w-6" />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
