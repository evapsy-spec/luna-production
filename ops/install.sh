#!/usr/bin/env bash
#
# Установка служебных скриптов Luna на сервер.
# Ставит копии в /usr/local/bin — вне гита, чтобы откат деплоя не унёс
# с собой систему бэкапов. Запускать после каждой правки ops/.
#
# Запуск на сервере: /srv/luna/ops/install.sh
#
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "== скрипты в /usr/local/bin"
sudo install -m 0755 "$HERE/backup.sh"        /usr/local/bin/luna-backup
sudo install -m 0755 "$HERE/restore-drill.sh" /usr/local/bin/luna-restore-drill

echo "== папка для бэкапов"
sudo install -d -o luna -g luna -m 0700 /srv/luna-backups

echo "== systemd"
sudo install -m 0644 "$HERE/luna-backup.service" /etc/systemd/system/luna-backup.service
sudo install -m 0644 "$HERE/luna-backup.timer"   /etc/systemd/system/luna-backup.timer
sudo systemctl daemon-reload
sudo systemctl enable --now luna-backup.timer

echo "== проверка"
systemctl is-enabled luna-backup.timer
systemctl list-timers luna-backup.timer --no-pager
echo "== готово. Пробный прогон: sudo systemctl start luna-backup && journalctl -u luna-backup -n 40 --no-pager"
