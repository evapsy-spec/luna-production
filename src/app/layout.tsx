import type { Metadata, Viewport } from "next";
import { playfair, jost } from "./fonts";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getCurrentUser } from "@/lib/auth";
import { TopNav, BottomNav } from "@/components/nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Luna Production — EVA MOON",
  description:
    "Управление производством EVA MOON: ткани, фабрики, коллекции, заказы на пошив и аналитика.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#02333A",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

  // Страницы входа и печати рендерятся без навигации
  const headerList = await headers();
  const pathname = headerList.get("x-pathname") ?? "";
  const isBare = pathname.startsWith("/login") || pathname.includes("/spec");

  return (
    <html lang="ru">
      <body
        className={`${playfair.variable} ${jost.variable}`}
        style={
          {
            "--font-display": "var(--font-playfair), Georgia, serif",
            "--font-sans": "var(--font-jost), system-ui, sans-serif",
          } as React.CSSProperties
        }
      >
        {user && !isBare ? (
          <>
            <TopNav userName={user.name} role={user.role} />
            <main className="mx-auto max-w-6xl px-4 pb-24 pt-5 md:pb-10">
              {children}
            </main>
            <BottomNav />
          </>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
