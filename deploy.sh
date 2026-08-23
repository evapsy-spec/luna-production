#!/usr/bin/env bash
# Деплой Luna Production на сервер. Запуск на сервере: /srv/luna/deploy.sh
#
# Код едет через bare-репозиторий /srv/luna.git — туда пушит макбук.
# Если сборка падает, откатываемся на предыдущий коммит и поднимаем его же:
# лучше вчерашняя рабочая версия, чем 502 у Евы на планшете.
set -euo pipefail

APP=/srv/luna
BARE=/srv/luna.git
cd "$APP"

# Переменные окружения нужны и служебным скриптам тоже: без них миграции
# уходят в ./luna.db вместо настоящей базы в /srv/luna-data.
if [ -f "$APP/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$APP/.env"
  set +a
fi

echo "== забираем код"
PREV=$(git rev-parse HEAD)
git fetch --quiet "$BARE" main
git reset --hard --quiet FETCH_HEAD
echo "   $PREV -> $(git rev-parse HEAD)"

rollback() {
  echo "!! не собралось, откат на $PREV"
  git reset --hard --quiet "$PREV"
  npm ci --silent || true
  npm run build || true
  sudo systemctl restart luna || true
  exit 1
}
trap rollback ERR

echo "== зависимости"
npm ci --silent

echo "== миграции (база: ${DATABASE_FILE:-./luna.db})"
npm run db:migrate

echo "== сборка"
NODE_OPTIONS=--max-old-space-size=1536 npm run build

trap - ERR

echo "== перезапуск"
sudo systemctl restart luna
sleep 4
systemctl is-active luna
echo "== готово"
