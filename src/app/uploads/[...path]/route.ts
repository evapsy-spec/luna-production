/**
 * Отдаём загруженные файлы (фото тканей/изделий, лекала) сами, а не через
 * встроенную статику Next.js из public/.
 *
 * Почему: на самохостинге (next start) Next.js один раз сканирует public/
 * при старте процесса и дальше отдаёт оттуда — файлы, загруженные уже ПОСЛЕ
 * старта сервиса, 404-ились, пока сервис не перезапустят вручную. Проверено
 * эмпирически 25.09.2026: один и тот же файл давал 404, а после
 * `systemctl restart luna` без единой правки кода — сразу 200.
 *
 * Обработчик ниже читает файл с диска при каждом запросе — новый файл
 * подхватывается сразу же, без перезапуска.
 */
import { NextResponse, type NextRequest } from "next/server";
import { readFile, stat } from "node:fs/promises";
import { join, normalize, sep, extname } from "node:path";

// Тот же UPLOAD_ROOT, что и при сохранении, см. src/lib/uploads.ts —
// в продакшене задаётся UPLOADS_DIR (файлы лежат отдельно от кода
// приложения, в /srv/luna-data, как и сама база — так их не затронет
// `git reset --hard` при следующем деплое).
const UPLOAD_ROOT = normalize(
  process.env.UPLOADS_DIR || join(process.cwd(), "public", "uploads"),
);

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
  ".ai": "application/postscript",
  ".eps": "application/postscript",
  ".zip": "application/zip",
  ".dxf": "image/vnd.dxf",
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: segments } = await params;

  // Защита от выхода за пределы папки с файлами (../../etc/passwd и т.п.)
  if (!segments.length || segments.some((s) => !s || s.includes("\0"))) {
    return new NextResponse("Not found", { status: 404 });
  }
  const filePath = normalize(join(UPLOAD_ROOT, ...segments));
  if (filePath !== UPLOAD_ROOT && !filePath.startsWith(UPLOAD_ROOT + sep)) {
    return new NextResponse("Not found", { status: 404 });
  }

  try {
    const info = await stat(filePath);
    if (!info.isFile()) {
      return new NextResponse("Not found", { status: 404 });
    }
    const buffer = await readFile(filePath);
    const contentType =
      MIME_BY_EXT[extname(filePath).toLowerCase()] ?? "application/octet-stream";
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(info.size),
        // Имя файла всегда уникальное (метка времени + случайный id) —
        // содержимое по одному URL никогда не меняется, кэшировать можно
        // надолго и безопасно.
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
