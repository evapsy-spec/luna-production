#!/usr/bin/env bash
#
# Проба восстановления. Берёт последний бэкап (или указанный файл), разворачивает
# его в отдельную папку, проверяет целостность и сверяет количества с живой базой.
# Живую базу НЕ ТРОГАЕТ ни при каком развитии событий — только читает.
#
# Запуск:  luna-restore-drill              последний бэкап
#          luna-restore-drill FILE.db.gz   конкретный
#
set -euo pipefail

DB="${DATABASE_FILE:-/srv/luna-data/luna.db}"
DEST="${BACKUP_DIR:-/srv/luna-backups}"
SQL=(sqlite3 -cmd ".timeout 15000")

ARCHIVE="${1:-}"
if [ -z "$ARCHIVE" ]; then
  ARCHIVE="$(find "$DEST" -maxdepth 1 -name 'luna-*.db.gz' | sort | tail -1)"
  [ -n "$ARCHIVE" ] || { echo "[ОШИБКА] в $DEST нет ни одного бэкапа" >&2; exit 1; }
fi
[ -f "$ARCHIVE" ] || { echo "[ОШИБКА] нет файла: $ARCHIVE" >&2; exit 1; }

WORK="$(mktemp -d /tmp/luna-drill.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

echo "===== ПРОБА ВОССТАНОВЛЕНИЯ ====="
echo "архив:  $ARCHIVE"
echo "размер: $(du -h "$ARCHIVE" | cut -f1), создан $(date -ur "$ARCHIVE" '+%Y-%m-%d %H:%M UTC')"
echo "куда:   $WORK/restored.db  (временно, удалю по выходу)"
echo

# --- 1. Разворачиваем --------------------------------------------------------
gzip -dc "$ARCHIVE" > "$WORK/restored.db"
echo "распаковано: $(du -h "$WORK/restored.db" | cut -f1)"

# --- 2. Целостность ----------------------------------------------------------
CHECK="$("${SQL[@]}" "$WORK/restored.db" 'PRAGMA integrity_check;' | head -1)"
if [ "$CHECK" != "ok" ]; then
  echo "[ПРОВАЛ] integrity_check = $CHECK" >&2
  exit 1
fi
echo "целостность: ok"

FK="$("${SQL[@]}" "$WORK/restored.db" 'PRAGMA foreign_key_check;' | head -3)"
if [ -n "$FK" ]; then
  echo "внимание: битые ссылки между таблицами:"
  echo "$FK"
else
  echo "ссылки между таблицами: ok"
fi
echo

# --- 3. Сверка с живой базой -------------------------------------------------
printf '%-24s %10s %10s %8s\n' 'таблица' 'сервер' 'из бэкапа' 'разница'
printf '%-24s %10s %10s %8s\n' '------------------------' '----------' '----------' '--------'
WORST=0
for T in collections products product_variants variant_stock variant_sales_daily \
         warehouses factories production_orders production_order_lines \
         factory_prices order_payments replenish_plan users settings sync_runs; do
  LIVE="$("${SQL[@]}" "$DB" "SELECT COUNT(*) FROM $T;" 2>/dev/null || echo 0)"
  SNAP="$("${SQL[@]}" "$WORK/restored.db" "SELECT COUNT(*) FROM $T;" 2>/dev/null || echo 0)"
  DIFF=$(( SNAP - LIVE ))
  MARK=""
  if [ "$DIFF" -ne 0 ]; then
    MARK="  <-"
    A=${DIFF#-}
    [ "$A" -gt "$WORST" ] && WORST=$A
  fi
  printf '%-24s %10s %10s %8s%s\n' "$T" "$LIVE" "$SNAP" "$DIFF" "$MARK"
done
echo

# --- 4. Проверка, что данные читаются, а не просто лежат ---------------------
echo "выборочная проверка содержимого:"
"${SQL[@]}" -header -column "$WORK/restored.db" \
  "SELECT (SELECT COUNT(*) FROM product_variants) AS sku,
          (SELECT COUNT(DISTINCT name) FROM collections) AS collections,
          (SELECT COUNT(*) FROM users) AS users,
          (SELECT IFNULL(MAX(day),'—') FROM variant_sales_daily) AS last_sale_day;"
echo
echo "первые 3 коллекции из бэкапа:"
"${SQL[@]}" "$WORK/restored.db" "SELECT '  · ' || name FROM collections ORDER BY name LIMIT 3;"
echo

# --- 5. Вывод ----------------------------------------------------------------
if [ "$WORST" -eq 0 ]; then
  echo "===== ИТОГ: бэкап разворачивается, цифры совпадают с сервером ====="
else
  echo "===== ИТОГ: бэкап разворачивается и целостен."
  echo "      Расхождение до $WORST строк — это нормально, если после снятия"
  echo "      бэкапа успела пройти синхронизация или Ева что-то меняла. ====="
fi
