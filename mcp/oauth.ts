/**
 * Мини-OAuth для MCP-коннектора Luna Production.
 *
 * Почему это вообще есть. У кастомных коннекторов claude.ai в интерфейсе
 * нет поля для статичного токена в заголовке — только OAuth (URL сервера +
 * необязательные OAuth Client ID/Secret). Поэтому вместо заголовка
 * Authorization реализован предельно простой, но настоящий OAuth 2.1:
 *
 *   1. Клод запрашивает /authorize — мы показываем свою форму входа.
 *   2. Человек вводит туда тот же секрет, что раньше стоял в заголовке
 *      (MCP_TOKEN), как пароль.
 *   3. Если секрет верный — выдаём одноразовый код, Клод меняет его на
 *      access_token на /token.
 *   4. access_token — это и есть MCP_TOKEN. Отдельной базы токенов не
 *      заводим: секрет тот же самый, просто человек передаёт его через
 *      форму на нашем домене, а не вписывает в поле коннектора.
 *
 * Регистрация клиента (сама запись коннектора в Клоде) сохраняется на
 * диск, чтобы после перезапуска luna-mcp не пришлось пересоздавать
 * коннектор заново.
 *
 * Открытая регистрация клиентов (RFC 7591, эндпоинт /register) в норме
 * доступна кому угодно в интернете — иначе Клод не смог бы
 * зарегистрироваться сам. Поэтому единственная защита — жёсткий список
 * разрешённых redirect_uri (только claude.ai): без этого кто угодно мог
 * бы зарегистрировать свой клиент с чужим redirect_uri, прислать
 * Константину ссылку на нашу форму входа и увести код авторизации к себе.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Response } from "express";
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
  OAuthClientInformationFull,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  InvalidClientMetadataError,
  InvalidGrantError,
  InvalidTokenError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";

/** Кому разрешено регистрироваться как клиент коннектора. */
const ALLOWED_REDIRECT_HOSTS = new Set(["claude.ai", "claude.com"]);

/**
 * "Срок действия" access_token. Токен на самом деле не протухает — просто
 * при каждой проверке мы честно называем библиотеке дату на год вперёд,
 * потому что MCP SDK требует numeric expiresAt и без него отклоняет
 * запрос ("Token has no expiration time").
 */
const TOKEN_TTL_SECONDS = 365 * 24 * 3600;

/** Куда сохранять зарегистрированных клиентов между перезапусками. */
const DATA_DIR = dirname(process.env.DATABASE_FILE ?? "./luna.db");
const CLIENTS_FILE = join(DATA_DIR, "mcp-oauth-clients.json");

function loadClients(): Map<string, OAuthClientInformationFull> {
  try {
    if (!existsSync(CLIENTS_FILE)) return new Map();
    const raw = JSON.parse(readFileSync(CLIENTS_FILE, "utf8")) as OAuthClientInformationFull[];
    return new Map(raw.map((c) => [c.client_id, c]));
  } catch (e) {
    console.error("Не смог прочитать сохранённых OAuth-клиентов, начинаю с пустого списка:", e);
    return new Map();
  }
}

function saveClients(clients: Map<string, OAuthClientInformationFull>) {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(CLIENTS_FILE, JSON.stringify([...clients.values()], null, 1));
  } catch (e) {
    console.error("Не смог сохранить OAuth-клиента на диск:", e);
  }
}

const clients = loadClients();

function checkRedirectUris(uris: string[]) {
  for (const raw of uris) {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      throw new InvalidClientMetadataError(`redirect_uri не похож на URL: ${raw}`);
    }
    if (u.protocol !== "https:" || !ALLOWED_REDIRECT_HOSTS.has(u.hostname)) {
      throw new InvalidClientMetadataError(
        `redirect_uri разрешён только на claude.ai/claude.com, получено: ${raw}`,
      );
    }
  }
}

const clientsStore: OAuthRegisteredClientsStore = {
  getClient(clientId) {
    return clients.get(clientId);
  },
  registerClient(client) {
    const full = client as OAuthClientInformationFull;
    checkRedirectUris(full.redirect_uris);
    clients.set(full.client_id, full);
    saveClients(clients);
    return full;
  },
};

interface PendingCode {
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  resource?: string;
  expiresAt: number;
}

const codes = new Map<string, PendingCode>();

function issueCode(entry: Omit<PendingCode, "expiresAt">): string {
  // чистим старые одноразовые коды заодно, чтобы карта не росла бесконечно
  const now = Date.now();
  for (const [k, v] of codes) if (v.expiresAt < now) codes.delete(k);

  const code = randomBytes(24).toString("hex");
  codes.set(code, { ...entry, expiresAt: now + 5 * 60_000 });
  return code;
}

function takeCode(code: string): PendingCode | undefined {
  const entry = codes.get(code);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    codes.delete(code);
    return undefined;
  }
  return entry;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

function renderLoginPage(opts: {
  clientId: string;
  redirectUri: string;
  state?: string;
  codeChallenge: string;
  resource?: string;
  error?: string;
}): string {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LUNA — вход для коннектора</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Jost:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root { --deep-ocean:#02333A; --gold-moon:#E9924A; --white-sand:#FFFAF2; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: var(--deep-ocean); font-family: 'Jost', sans-serif; color: var(--white-sand); padding: 24px;
  }
  .card {
    width: 100%; max-width: 400px; background: rgba(255,250,242,.04);
    border: 1px solid rgba(233,146,74,.35); border-radius: 14px; padding: 36px 32px;
  }
  h1 { font-family: 'Playfair Display', serif; font-weight: 700; font-size: 26px; margin: 0 0 6px; }
  p.sub { margin: 0 0 28px; font-size: 14px; line-height: 1.5; color: rgba(255,250,242,.65); }
  label {
    display: block; font-size: 13px; letter-spacing: .03em; text-transform: uppercase;
    color: rgba(255,250,242,.55); margin-bottom: 8px;
  }
  input[type="password"] {
    width: 100%; padding: 12px 14px; border-radius: 8px; border: 1px solid rgba(255,250,242,.2);
    background: rgba(255,250,242,.06); color: var(--white-sand); font-size: 15px; font-family: 'Jost', sans-serif;
  }
  input[type="password"]:focus { outline: none; border-color: var(--gold-moon); }
  button {
    width: 100%; margin-top: 22px; padding: 13px; border: none; border-radius: 8px;
    background: var(--gold-moon); color: var(--deep-ocean); font-family: 'Jost', sans-serif;
    font-weight: 600; font-size: 15px; cursor: pointer;
  }
  button:hover { filter: brightness(1.05); }
  .error {
    margin: 0 0 18px; padding: 10px 14px; border-radius: 8px; background: rgba(224,92,68,.15);
    border: 1px solid rgba(224,92,68,.4); color: #F2A08F; font-size: 13px;
  }
  .who { margin-top: 22px; font-size: 12px; color: rgba(255,250,242,.4); word-break: break-all; }
</style>
</head>
<body>
  <div class="card">
    <h1>Вход для коннектора</h1>
    <p class="sub">Клод запрашивает доступ к данным Luna Production. Введите токен коннектора, чтобы разрешить доступ.</p>
    ${opts.error ? `<div class="error">${escapeHtml(opts.error)}</div>` : ""}
    <form method="post" action="/consent">
      <label for="token">Токен коннектора</label>
      <input type="password" id="token" name="token" autofocus required autocomplete="off">
      <input type="hidden" name="client_id" value="${escapeHtml(opts.clientId)}">
      <input type="hidden" name="redirect_uri" value="${escapeHtml(opts.redirectUri)}">
      ${opts.state !== undefined ? `<input type="hidden" name="state" value="${escapeHtml(opts.state)}">` : ""}
      <input type="hidden" name="code_challenge" value="${escapeHtml(opts.codeChallenge)}">
      ${opts.resource ? `<input type="hidden" name="resource" value="${escapeHtml(opts.resource)}">` : ""}
      <button type="submit">Разрешить доступ</button>
    </form>
    <div class="who">Luna Production · luna.evamoon.boutique</div>
  </div>
</body>
</html>`;
}

export function createOAuthProvider(token: string): OAuthServerProvider {
  return {
    clientsStore,

    async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response) {
      const html = renderLoginPage({
        clientId: client.client_id,
        redirectUri: params.redirectUri,
        state: params.state,
        codeChallenge: params.codeChallenge,
        resource: params.resource?.href,
      });
      res.status(200).type("html").send(html);
    },

    async challengeForAuthorizationCode(_client, authorizationCode) {
      const entry = takeCode(authorizationCode);
      if (!entry) throw new InvalidGrantError("Код авторизации не найден или истёк");
      // код одноразовый только на обмен, а не на этот вызов — кладём обратно
      codes.set(authorizationCode, entry);
      return entry.codeChallenge;
    },

    async exchangeAuthorizationCode(_client, authorizationCode): Promise<OAuthTokens> {
      const entry = takeCode(authorizationCode);
      if (!entry) throw new InvalidGrantError("Код авторизации не найден, истёк или уже использован");
      codes.delete(authorizationCode);
      return {
        access_token: token,
        token_type: "bearer",
        expires_in: TOKEN_TTL_SECONDS,
        scope: "",
      };
    },

    async exchangeRefreshToken(): Promise<OAuthTokens> {
      // refresh_token никогда не выдаётся (см. exchangeAuthorizationCode),
      // так что сюда в норме дойти не должны — но интерфейс требует реализации.
      throw new InvalidGrantError("Обновление токена не поддерживается");
    },

    async verifyAccessToken(candidate: string): Promise<AuthInfo> {
      if (!constantTimeEqual(candidate, token)) {
        throw new InvalidTokenError("Неверный токен доступа");
      }
      return {
        token: candidate,
        clientId: "luna-mcp",
        scopes: [],
        expiresAt: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
      };
    },
  };
}

/**
 * Обработчик формы входа (POST /consent). Не часть стандартного роутера
 * MCP SDK — это наш собственный, человеческий шаг: проверяем пароль
 * (= MCP_TOKEN) и либо выдаём код и уводим обратно к Клоду, либо
 * показываем форму снова с ошибкой.
 */
export function createConsentHandler(token: string) {
  return (req: { body: Record<string, string> }, res: Response) => {
    const body = req.body ?? {};
    const clientId = body.client_id ?? "";
    const redirectUri = body.redirect_uri ?? "";
    const codeChallenge = body.code_challenge ?? "";
    const state = body.state;
    const resource = body.resource;
    const candidate = body.token ?? "";

    if (!clientId || !redirectUri || !codeChallenge) {
      res.status(400).type("html").send("Некорректный запрос: не хватает параметров формы.");
      return;
    }

    const client = clients.get(clientId);
    if (!client || !client.redirect_uris.includes(redirectUri)) {
      res
        .status(400)
        .type("html")
        .send("Коннектор не найден или redirect_uri не совпадает с зарегистрированным. Начните подключение заново в настройках Клода.");
      return;
    }

    if (!constantTimeEqual(candidate, token)) {
      res
        .status(401)
        .type("html")
        .send(
          renderLoginPage({
            clientId,
            redirectUri,
            state,
            codeChallenge,
            resource,
            error: "Неверный токен. Проверьте значение в /srv/luna/.env и попробуйте ещё раз.",
          }),
        );
      return;
    }

    const code = issueCode({ clientId, codeChallenge, redirectUri, resource });
    const url = new URL(redirectUri);
    url.searchParams.set("code", code);
    if (state !== undefined) url.searchParams.set("state", state);
    res.redirect(302, url.href);
  };
}
