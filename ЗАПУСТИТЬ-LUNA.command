#!/bin/bash
# Двойной клик по этому файлу запускает Luna Production.
# Первый запуск занимает 2–4 минуты (устанавливаются библиотеки), дальше — секунды.
cd "$(dirname "$0")"
clear
echo "════════════════════════════════════════════"
echo "  LUNA PRODUCTION — запуск"
echo "════════════════════════════════════════════"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "✕ Node.js не установлен."
  echo
  echo "Поставьте его одним из способов:"
  echo "  1) Скачать установщик: https://nodejs.org  (кнопка LTS)"
  echo "  2) Или в Терминале:  brew install node"
  echo
  echo "После установки закройте это окно и запустите файл заново."
  echo
  read -p "Нажмите Enter, чтобы закрыть..."
  exit 1
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
echo "→ Node.js версии $(node -v)"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo
  echo "✕ Нужна версия 22 или новее (у вас $(node -v))."
  echo "  Обновите Node.js: https://nodejs.org"
  echo
  read -p "Нажмите Enter, чтобы закрыть..."
  exit 1
fi

if [ ! -f .env ]; then
  echo "→ Создаю файл настроек .env"
  cat > .env <<'ENVEOF'
DATABASE_FILE=./luna.db
SESSION_SECRET=luna-local-test-secret-0123456789abcdef
AINUR_API_BASE=https://connect.ainur.app/api/v4
AINUR_API_TOKEN=
ENVEOF
fi

if [ ! -d node_modules ]; then
  echo "→ Устанавливаю библиотеки (2–4 минуты, только в первый раз)..."
  npm install --no-audit --no-fund || { echo; echo "✕ Не удалось установить библиотеки. Проверьте интернет."; read -p "Enter..."; exit 1; }
fi

if [ ! -f luna.db ]; then
  echo "→ Создаю базу данных и наполняю демо-данными EVA MOON..."
  npm run db:migrate --silent && npm run db:seed --silent
fi

echo
echo "════════════════════════════════════════════"
echo "  Открываю http://localhost:3000"
echo
echo "  Вход:   eva@evamoon.co"
echo "  Пароль: luna2026"
echo
echo "  Чтобы остановить — закройте это окно"
echo "  или нажмите Control+C"
echo "════════════════════════════════════════════"
echo

(sleep 6 && open http://localhost:3000) &
npm run dev
