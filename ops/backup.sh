#!/usr/bin/env bash
#
# Ночной бэкап Luna Production.
#
# Живёт установленной копией в /usr/local/bin/luna-backup, а не в /srv/luna:
# система резервных копий не должна зависеть от состояния деплоя. Откат сборки
# не должен уносить с собой бэкап. Канонический исходник — здесь, в репозитории;
# установка — ops/install.sh.
#
# Что делает: снимок базы через sqlite3 .backup, проверка снимка ДО архивации,
# архив папки загрузок, чистка старше 30 дней, запись итога в базу и в лог.
#
set -euo pipefail

DB="${DATABASE_FILE:-/srv/luna-data/luna.db}"
UPLOADS="${UPLOADS_DIR:-/srv/luna/public/uploads}"
DEST="${BACKUP_DIR:-/srv/luna-backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
MIN_FREE_MB=500

STAMP="$(date -u +%Y-%m-%d_%H%M)"
TMP="$(mktemp -d /tmp/luna-backup.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

log() { echo "[$(date -u +%H:%M:%S)] $*"; }
die() { echo "[ОШИБКА] $*" >&2; exit 1; }

# sqlite3 CLI не знает про busy_timeout из приложения — задаём свой,
# иначо параллельная запись из Next.js даст "database is locked".
SQL=(sqlite3 -cmd ".timeout 15000")

echo "===== БЭКАП $STAMP UTC ====="

# --- 0. Место на диске -------------------------------------------------------
mkdir -p "$DEST"
chmod 700 "$DEST"
FREE_MB="$(df -Pm "$DEST" | awk 'NR==2 {print $4}')"
[ "$FREE_MB" -ge "$MIN_FREE_MB" ] || die "на диске всего ${FREE_MB} МБ, нужно минимум ${MIN_FREE_MB}"
log "свободно ${FREE_MB} МБ"

[ -f "$DB" ] || die "базы нет: $DB"

# --- 1. Снимок базы ----------------------------------------------------------
# Только .backup. Обычный cp при включённом WAL даёт файл без незаписанных
# страниц, то есть тихо битый — узнаешь об этом в день, когда он понадобится.
log "снимок базы"
"${SQL[@]}" "$DB" ".backup '$TMP/luna.db'"
[ -s "$TMP/luna.db" ] || die "снимок пустой"

# --- 2. Проверка снимка ДО архивации ----------------------------------------
# Непроверенный бэкап бэкапом не считается.
log "проверка целостности"
CHECK="$("${SQL[@]}" "$TMP/luna.db" 'PRAGMA integrity_check;' | head -1)"
[ "$CHECK" = "ok" ] || die "снимок негоден: integrity_check = $CHECK"

# Ключевые таблицы обязаны быть непустыми. Ловит случай, когда база на месте,
# integrity_check доволен, а данных внутри нет.
log "сверка количеств (живая база → снимок)"
FAIL=0
for T in product_variants variant_sales_daily variant_stock collections \
         products warehouses users settings factories; do
  LIVE="$("${SQL[@]}" "$DB" "SELECT COUNT(*) FROM $T;" 2>/dev/null || echo "?")"
  SNAP="$("${SQL[@]}" "$TMP/luna.db" "SELECT COUNT(*) FROM $T;" 2>/dev/null || echo "?")"
  printf '    %-22s %8s → %8s\n' "$T" "$LIVE" "$SNAP"
  if [ "$SNAP" = "?" ] || [ "$SNAP" -eq 0 ] 2>/dev/null; then
    echo "    ^^ таблица $T в снимке пуста" >&2
    FAIL=1
  fi
done
[ "$FAIL" -eq 0 ] || die "в снимке пустые таблицы"

# --- 3. Архивация ------------------------------------------------------------
log "сжатие"
gzip -6 "$TMP/luna.db"
mv "$TMP/luna.db.gz" "$DEST/luna-${STAMP}.db.gz"
DB_SIZE="$(du -h "$DEST/luna-${STAMP}.db.gz" | cut -f1)"

# Папка загрузок: лекала и фото. Архивируем, только если там что-то есть
# кроме .gitkeep — иначе плодим пустые архивы каждую ночь.
UP_SIZE="—"
if [ -d "$UPLOADS" ] && [ -n "$(find "$UPLOADS" -type f ! -name '.gitkeep' -print -quit)" ]; then
  tar -czf "$DEST/uploads-${STAMP}.tar.gz" -C "$(dirname "$UPLOADS")" "$(basename "$UPLOADS")"
  UP_SIZE="$(du -h "$DEST/uploads-${STAMP}.tar.gz" | cut -f1)"
  log "загрузки: $UP_SIZE"
else
  log "загрузки: пусто, архив не делаю"
fi

# --- 4. Чистка старых --------------------------------------------------------
REMOVED=0
while IFS= read -r f; do
  rm -f "$f"
  REMOVED=$((REMOVED + 1))
done < <(find "$DEST" -maxdepth 1 -type f \
           \( -name 'luna-*.db.gz' -o -name 'uploads-*.tar.gz' \) \
           -mtime +"$KEEP_DAYS")
KEPT="$(find "$DEST" -maxdepth 1 -name 'luna-*.db.gz' | wc -l | tr -d ' ')"
log "удалено старых: $REMOVED, хранится копий базы: $KEPT"

# --- 5. Итог в базу ----------------------------------------------------------
# Чтобы приложение могло показать «последний бэкап» без захода на сервер.
# Не роняем бэкап, если запись не удалась — файл уже на диске, это главное.
RESULT="{\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"file\":\"luna-${STAMP}.db.gz\",\"dbSize\":\"${DB_SIZE}\",\"uploads\":\"${UP_SIZE}\",\"kept\":${KEPT},\"ok\":true}"
NOW="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
"${SQL[@]}" "$DB" \
  "INSERT INTO settings (key, value, updated_at)
   VALUES ('last_backup_result', '$RESULT', '$NOW')
   ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;" \
  2>/dev/null || log "предупреждение: не смогла записать итог в базу"

echo "===== ГОТОВО: luna-${STAMP}.db.gz ($DB_SIZE), загрузки $UP_SIZE ====="
