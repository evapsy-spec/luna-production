# Автодеплой через GitHub — разовая настройка

Цель: сервер сам подтягивает код с GitHub каждые 2 минуты и деплоит, если
есть новые коммиты. Больше не нужно заходить по SSH и руками запускать
`deploy.sh` после каждого патча — только `git push` в GitHub-репозиторий
(`evapsy-spec/luna-production`), с любого устройства.

Всё ниже выполняется **один раз** на сервере (`ssh luna`).

## 1. Ключ для чтения GitHub (только для сервера, отдельный от твоего личного)

```bash
ssh-keygen -t ed25519 -f ~/.ssh/luna_github_deploy -N "" -C "luna-server-deploy"
cat ~/.ssh/luna_github_deploy.pub
```

Скопируй вывод `cat` (публичный ключ, начинается с `ssh-ed25519`).

## 2. Добавить ключ в GitHub — только на чтение

На github.com → репозиторий `evapsy-spec/luna-production` → Settings →
Deploy keys → Add deploy key. Вставь ключ из шага 1.
**"Allow write access" НЕ ставь** — серверу достаточно читать.

## 3. Настроить SSH и remote на сервере

```bash
cat >> ~/.ssh/config << 'EOF'
Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/luna_github_deploy
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config

cd /srv/luna
git remote add origin git@github.com:evapsy-spec/luna-production.git
# Если origin уже существует и указывает на что-то другое:
# git remote set-url origin git@github.com:evapsy-spec/luna-production.git

ssh -T git@github.com   # должно сказать "successfully authenticated", это нормально
git fetch origin main
```

Если `git fetch origin main` прошёл без ошибок — сервер видит GitHub.

## 4. Включить таймер

```bash
sudo cp /srv/luna/deploy/luna-autodeploy.service /etc/systemd/system/
sudo cp /srv/luna/deploy/luna-autodeploy.timer /etc/systemd/system/
sudo chmod +x /srv/luna/deploy/auto-deploy.sh
sudo systemctl daemon-reload
sudo systemctl enable --now luna-autodeploy.timer
systemctl status luna-autodeploy.timer --no-pager
```

Если деплой на этом сервере обычно запускается не под `root`, а под
отдельным пользователем — открой `/etc/systemd/system/luna-autodeploy.service`
и поменяй `User=root` на нужного пользователя перед `daemon-reload`.

## 5. Первый пуш в GitHub (с любого компьютера, где есть текущий код — например, с Мака)

```bash
cd ~/luna-production   # где у тебя сейчас рабочая копия с историей коммитов
git remote add github git@github.com:evapsy-spec/luna-production.git
# Если на Маке ещё не настроен SSH-доступ к GitHub — GitHub подскажет
# при первом push, это стандартная разовая вещь для любого репозитория.
git push github main
```

С этого момента: применил патч → `git add -A && git commit -m "..." && git
push github main` (или сразу в `origin`, если переименуешь remote) — и в
течение 2 минут сервер сам подтянет и задеплоит. Смотреть, что происходит:

```bash
tail -f /var/log/luna-autodeploy.log
```

## Откат / отключить автодеплой

```bash
sudo systemctl disable --now luna-autodeploy.timer
```

Ручной `bash /srv/luna/deploy.sh` по-прежнему работает как раньше (и как
резервный вариант, если `origin` вдруг недоступен — деплой сам откатится на
старый bare-репозиторий `/srv/luna.git`).
