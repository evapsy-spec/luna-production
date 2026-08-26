#!/usr/bin/env bash
# Автодеплой: проверяет GitHub на новые коммиты и запускает deploy.sh,
# только если они реально есть — чтобы не гонять npm ci/build впустую
# на каждой проверке. Вызывается по таймеру, см. luna-autodeploy.timer.
set -euo pipefail

APP=/srv/luna
REMOTE="${DEPLOY_SOURCE_REMOTE:-origin}"
LOG=/var/log/luna-autodeploy.log

cd "$APP"
exec >> "$LOG" 2>&1
echo "=== $(date -Is) проверка обновлений ($REMOTE)"

if ! git remote get-url "$REMOTE" >/dev/null 2>&1; then
  echo "remote '$REMOTE' не настроен — см. deploy/README-autodeploy.md"
  exit 0
fi

git fetch --quiet "$REMOTE" main
LOCAL=$(git rev-parse HEAD)
REMOTE_HEAD=$(git rev-parse "$REMOTE/main")

if [ "$LOCAL" = "$REMOTE_HEAD" ]; then
  echo "нет изменений ($LOCAL)"
  exit 0
fi

echo "новый коммит: $LOCAL -> $REMOTE_HEAD, запускаю deploy.sh"
"$APP/deploy.sh"
