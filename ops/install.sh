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
for U in luna-backup.service luna-backup.timer luna-sync.service luna-sync.timer; do
  sudo install -m 0644 "$HERE/$U" "/etc/systemd/system/$U"
done
sudo systemctl daemon-reload
sudo systemctl enable --now luna-backup.timer
sudo systemctl enable --now luna-sync.timer

echo "== проверка"
systemctl is-enabled luna-backup.timer luna-sync.timer
systemctl list-timers luna-backup.timer luna-sync.timer --no-pager
echo
echo "== готово."
echo "   бэкап вручную:       sudo systemctl start luna-backup"
echo "   синхронизация вручную: sudo systemctl start luna-sync"
echo "   журнал:              journalctl -u luna-sync -n 60 --no-pager"
