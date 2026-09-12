#!/usr/bin/env bash
# Деплой Luna Production на сервер. Запуск на сервере: /srv/luna/deploy.sh
# (обычно не руками, а через luna-autodeploy.timer — см. deploy/README-autodeploy.md)
#
# Код тянем из remote'а $DEPLOY_SOURCE_REMOTE (по умолчанию "origin" —
# это GitHub, настраивается один раз, см. deploy/README-autodeploy.md).
# Если origin ещё не настроен, откатываемся на старый способ — bare-репозиторий
# /srv/luna.git, куда раньше пушил макбук — чтобы ничего не сломать по пути.
#
# Если сборка падает, откатываемся на предыдущий коммит и поднимаем его же:
# лучше вчерашняя рабочая версия, чем 502 у Евы на планшете.
set -euo pipefail

APP=/srv/luna
BARE=/srv/luna.git
SOURCE_REMOTE="${DEPLOY_SOURCE_REMOTE:-origin}"
cd "$APP"

# Переменные окружения нужны и служебным скриптам тоже: без них миграции
# уходят в ./luna.db вместо настоящей базы в /srv/luna-data.
if [ -f "$APP/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$APP/.env"
  set +a
fi

PREV=$(git rev-parse HEAD)
if git remote get-url "$SOURCE_REMOTE" >/dev/null 2>&1; then
  echo "== забираем код (remote: $SOURCE_REMOTE)"
  git fetch --quiet "$SOURCE_REMOTE" main
else
  echo "== забираем код (remote '$SOURCE_REMOTE' не настроен, беру из $BARE)"
  git fetch --quiet "$BARE" main
fi
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
if systemctl list-unit-files luna-mcp.service >/dev/null 2>&1; then
  sudo systemctl restart luna-mcp || true
fi
sleep 4
systemctl is-active luna
systemctl is-active luna-mcp 2>/dev/null || echo "luna-mcp: не установлен"

# Caddyfile живёт в репозитории, но сам Caddy читает /etc/caddy/Caddyfile —
# без этого шага правки в deploy/Caddyfile молча не долетают до Caddy, и
# новые пути (например, для OAuth у MCP) 404-ятся или уходят не туда.
# Именно это один раз уже случилось — см. историю чата от 2026-08-24.
if [ -f "$APP/deploy/Caddyfile" ] && command -v caddy >/dev/null 2>&1; then
  if ! cmp -s "$APP/deploy/Caddyfile" /etc/caddy/Caddyfile 2>/dev/null; then
    echo "== обновляем Caddyfile"
    sudo cp "$APP/deploy/Caddyfile" /etc/caddy/Caddyfile
    sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
    sudo systemctl reload caddy
  fi
fi
echo "== готово"
