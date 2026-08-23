import type { MetadataRoute } from "next";

/**
 * Манифест для установки на планшет и телефон.
 *
 * С ним Chrome на Android предлагает «Установить приложение»: на домашнем
 * экране появляется иконка, и приложение открывается без адресной строки
 * браузера — визуально это обычное приложение.
 *
 * display: standalone — именно то, что убирает браузерную рамку.
 * orientation не фиксируем: Ева работает и в портретной, и в альбомной.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Luna Production — EVA MOON",
    short_name: "Luna",
    description:
      "Управление производством EVA MOON: ткани, фабрики, коллекции, заказы на пошив и аналитика.",
    lang: "ru",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#02333A",
    theme_color: "#02333A",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      // maskable — Android обрезает иконку под форму темы (круг, квадрат
      // со скруглением), поэтому для него отдельный вариант с полями
      {
        src: "/icons/maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
