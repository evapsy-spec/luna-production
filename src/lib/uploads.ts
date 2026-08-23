/**
 * Загрузка файлов: фото тканей и изделий, технические лекала.
 *
 * По решению Евы файлы хранятся в самом приложении, а не ссылками на
 * внешний Google Drive. В разработке — в public/uploads. В продакшене
 * подставляется S3-совместимое хранилище: достаточно заменить saveUpload
 * (см. README, раздел «Деплой»).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const UPLOAD_ROOT = join(process.cwd(), "public", "uploads");

/** Разрешаем только то, чем реально пользуются: картинки и файлы лекал */
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "application/postscript", // .ai / .eps — типичные форматы лекал
  "application/zip",
  "application/x-zip-compressed",
  "application/octet-stream", // .dxf и прочие CAD-форматы лекал
  "image/vnd.dxf",
]);

const MAX_BYTES = 25 * 1024 * 1024;

export interface SavedUpload {
  url: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export async function saveUpload(
  file: File,
  folder: "fabrics" | "products" | "patterns" | "accessories",
): Promise<SavedUpload> {
  if (!file || file.size === 0) {
    throw new Error("Файл пустой или не выбран");
  }
  if (file.size > MAX_BYTES) {
    throw new Error(
      `Файл больше 25 МБ (${Math.round(file.size / 1024 / 1024)} МБ) — уменьшите размер`,
    );
  }
  if (file.type && !ALLOWED_MIME.has(file.type)) {
    throw new Error(`Формат ${file.type} не поддерживается`);
  }

  const dir = join(UPLOAD_ROOT, folder);
  await mkdir(dir, { recursive: true });

  const safeName = sanitizeFileName(file.name);
  const unique = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safeName}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(join(dir, unique), buffer);

  return {
    url: `/uploads/${folder}/${unique}`,
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    sizeBytes: file.size,
  };
}

/** Необязательный файл из формы: пустой input не должен ломать сохранение */
export async function saveOptionalUpload(
  value: FormDataEntryValue | null,
  folder: "fabrics" | "products" | "patterns" | "accessories",
): Promise<SavedUpload | null> {
  if (!value || typeof value === "string") return null;
  if (value.size === 0) return null;
  return saveUpload(value, folder);
}

function sanitizeFileName(name: string): string {
  const translit: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh",
    з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
    п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts",
    ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu",
    я: "ya",
  };
  return name
    .toLowerCase()
    .split("")
    .map((ch) => translit[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

export function formatFileSize(bytes?: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}
