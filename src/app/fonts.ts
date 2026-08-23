import localFont from "next/font/local";

/**
 * Шрифты вложены в само приложение, а не подгружаются с Google Fonts.
 *
 * Почему так: при обращении к fonts.googleapis.com Next пытается скачать
 * шрифт, и если сеть недоступна или медленная, рендер страницы подвисает
 * (в наших замерах — до 20 секунд на запрос). Приложением пользуются с
 * планшета по Wi-Fi, иногда в поездках, поэтому внешняя зависимость в
 * критическом пути недопустима. Файлы лежат в src/app/fonts (140 КБ на всё),
 * подключены с кириллическими и латинскими подмножествами.
 *
 * Файлы взяты из пакетов @fontsource/playfair-display и @fontsource/jost —
 * это те же самые шрифты, что и в Google Fonts.
 */

export const playfair = localFont({
  src: [
    {
      path: "./fonts/playfair-display-cyrillic-600-normal.woff2",
      weight: "600",
      style: "normal",
    },
    {
      path: "./fonts/playfair-display-cyrillic-700-normal.woff2",
      weight: "700",
      style: "normal",
    },
    {
      path: "./fonts/playfair-display-latin-600-normal.woff2",
      weight: "600",
      style: "normal",
    },
    {
      path: "./fonts/playfair-display-latin-700-normal.woff2",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-playfair",
  display: "swap",
  fallback: ["Georgia", "Times New Roman", "serif"],
});

export const jost = localFont({
  src: [
    {
      path: "./fonts/jost-cyrillic-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "./fonts/jost-cyrillic-500-normal.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "./fonts/jost-cyrillic-600-normal.woff2",
      weight: "600",
      style: "normal",
    },
    {
      path: "./fonts/jost-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "./fonts/jost-latin-500-normal.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "./fonts/jost-latin-600-normal.woff2",
      weight: "600",
      style: "normal",
    },
  ],
  variable: "--font-jost",
  display: "swap",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "sans-serif"],
});
