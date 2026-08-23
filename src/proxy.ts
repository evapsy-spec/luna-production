import { NextResponse, type NextRequest } from "next/server";

/**
 * Пускает в приложение только с сессионным cookie.
 * Сам токен здесь не проверяем (для jose нужен Node-рантайм) — это делает
 * layout через getCurrentUser. Middleware только отсекает анонимов,
 * чтобы они не грузили страницы приложения.
 *
 * Заодно прокидывает текущий путь в заголовок — layout по нему понимает,
 * что страницу входа и версию для печати надо рендерить без навигации.
 */
const PUBLIC_PATHS = ["/login", "/api/logout", "/api/login"];

/**
 * Файлы, которые обязаны отдаваться без входа.
 *
 * Манифест и иконки Chrome запрашивает ДО авторизации — когда решает,
 * можно ли предложить «Установить приложение» на планшет. Если закрыть их
 * редиректом на /login, установка на домашний экран просто не предлагается,
 * причём молча.
 */
const PUBLIC_ASSET_PREFIXES = ["/_next", "/uploads", "/icons"];
const PUBLIC_ASSET_FILES = [
  "/favicon.ico",
  "/manifest.webmanifest",
  "/robots.txt",
  "/apple-icon.png",
];

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isPublic =
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
    PUBLIC_ASSET_PREFIXES.some((p) => pathname.startsWith(p)) ||
    PUBLIC_ASSET_FILES.includes(pathname);

  /**
   * Проверяем именно НЕПУСТОЕ значение.
   * cookies.has() возвращает true и для `luna_session=` без значения, то есть
   * пустым cookie можно было пройти мимо страницы входа. Сам токен здесь не
   * разбираем (для jose нужен Node-рантайм) — подпись проверяет getCurrentUser,
   * но пускать дальше с заведомо пустым значением нельзя.
   */
  const sessionValue = request.cookies.get("luna_session")?.value?.trim();
  const hasSession = Boolean(sessionValue);

  if (!isPublic && !hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  if (pathname === "/login" && hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  const headers = new Headers(request.headers);
  headers.set("x-pathname", pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
