/**
 * MCP-сервер Luna Production — доступ к данным из чата с Луной без макбука.
 *
 * Слушает 127.0.0.1, наружу его выставляет Caddy по адресу того же домена
 * (пути /mcp, /authorize, /consent, /token, /register, /.well-known/oauth*).
 * Отдельного поддомена и сертификата не нужно, новых портов в файрволе тоже.
 *
 * Только чтение. Записывающих инструментов здесь нет и появиться они должны
 * только отдельным решением: границы те же, что у телеграм-бота — читать
 * свободно, менять данные только с подтверждением человека, а цены, скидки,
 * остатки, письма клиентам, живой сайт и деньги — никогда.
 *
 * Авторизация — через настоящий OAuth (см. ./oauth.ts): у кастомных
 * коннекторов claude.ai нет поля для токена в заголовке, только OAuth,
 * поэтому человек один раз вводит тот же секрет (MCP_TOKEN) в форму входа
 * на этой странице, а не в поле коннектора. Сам /mcp по-прежнему проверяет
 * тот же самый токен — просто теперь он приезжает от Клода честным путём.
 *
 * Запуск: npm run mcp   (systemd-юнит luna-mcp)
 */
import express, { type Request, type Response } from "express";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { salesByMonth, productCard, ordersStatus } from "@/lib/reports";
import { getReplenish, LOW_STOCK_THRESHOLD } from "@/lib/replenish";
import { createOAuthProvider, createConsentHandler } from "./oauth.js";

const PORT = Number(process.env.MCP_PORT ?? 3100);
const HOST = process.env.MCP_HOST ?? "127.0.0.1";
const TOKEN = (process.env.MCP_TOKEN ?? "").trim();
const PUBLIC_URL = (process.env.MCP_PUBLIC_URL ?? "https://luna.evamoon.boutique").replace(/\/+$/, "");

if (!TOKEN || TOKEN.length < 24) {
  console.error(
    "MCP_TOKEN не задан или слишком короткий. Сгенерируй его на сервере и добавь в .env:\n" +
      "  echo MCP_TOKEN=$(openssl rand -hex 32) >> /srv/luna/.env",
  );
  process.exit(1);
}

function textResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 1) }],
  };
}

/**
 * Новый экземпляр на каждый запрос: сервер работает без сессий, так проще
 * и не надо хранить состояние между вызовами.
 */
function buildServer(): McpServer {
  const server = new McpServer({ name: "luna-production", version: "1.0.0" });

  server.registerTool(
    "sales_by_month",
    {
      title: "Продажи по месяцам",
      description:
        "Продажи EVA MOON по месяцам: штуки и выручка в THB. Фильтр по SKU " +
        "(целиком или части, можно несколько через запятую) и по названию " +
        "коллекции. По умолчанию — последние 24 месяца. Возвращает также " +
        "разбивку по годам, чтобы видеть сезонность и сравнение год к году. " +
        "История есть с января 2024 года.",
      inputSchema: {
        sku: z.string().optional().describe("SKU или его часть; несколько — через запятую"),
        collection: z.string().optional().describe("название коллекции или его часть"),
        from: z.string().optional().describe("начало периода, YYYY-MM-DD"),
        to: z.string().optional().describe("конец периода, YYYY-MM-DD"),
      },
    },
    async ({ sku, collection, from, to }) => textResult(await salesByMonth({ sku, collection, from, to })),
  );

  server.registerTool(
    "product_card",
    {
      title: "Карточка изделия",
      description:
        "Изделие или список изделий по части SKU либо названия модели: " +
        "цена, себестоимость (цена закупки), маржа в THB и в процентах, " +
        "остатки по складам, продажи за последние 12 месяцев. " +
        "Себестоимость заполнена у 955 SKU из 965.",
      inputSchema: {
        query: z.string().describe("часть SKU или названия модели, например: silk bralette"),
      },
    },
    async ({ query }) => textResult(await productCard({ query })),
  );

  server.registerTool(
    "low_stock",
    {
      title: "Что заканчивается",
      description:
        `Позиции, которых на наших складах осталось меньше ${LOW_STOCK_THRESHOLD} штук. ` +
        "Склады: Phangan, Phuket и Fotesko Warehouse — партнёрские магазины и " +
        "склад в США сюда не входят. Ноль показывается только если позиция на " +
        "этом складе продавалась за последние 90 дней (иначе это «никогда там " +
        "не лежало»). Позиции, помеченные в приложении как «не повторять», по " +
        "умолчанию скрыты.",
      inputSchema: {
        collection: z.string().optional().describe("ограничить одной коллекцией (точное имя)"),
        onlySoldOut: z.boolean().optional().describe("только те, что распродались в ноль при живом спросе"),
        limit: z.number().int().min(1).max(300).optional(),
      },
    },
    async ({ collection, onlySoldOut, limit }) => {
      const data = await getReplenish({ excluded: "hide" });
      let rows = data.rows;
      if (collection) {
        const needle = collection.toLowerCase();
        rows = rows.filter((r) => r.collectionName.toLowerCase().includes(needle));
      }
      if (onlySoldOut) rows = rows.filter((r) => r.soldOuts > 0);
      const shown = rows.slice(0, limit ?? 50);

      return textResult({
        warehouses: data.warehouses.map((w) => w.name),
        threshold: LOW_STOCK_THRESHOLD,
        totalActive: data.totalActive,
        totalExcludedByHand: data.totalExcluded,
        shown: shown.length,
        rows: shown.map((r) => ({
          sku: r.sku,
          model: r.productName,
          collection: r.collectionName,
          color: r.color,
          size: r.size,
          stock: Object.fromEntries(data.warehouses.map((w, i) => [w.name, r.cells[i]?.qty ?? null])),
          soldOutAt: data.warehouses.filter((_, i) => r.cells[i]?.soldOut).map((w) => w.name),
          onOrderUnits: r.onOrder,
        })),
      });
    },
  );

  server.registerTool(
    "orders_status",
    {
      title: "Заказы на пошив",
      description:
        "Заказы на пошив: фабрика, статус, плановая и фактическая готовность, " +
        "штуки, что просрочено, стоимость. Плюс медианный фактический срок " +
        "пошива по завершённым заказам — им можно считать, к какой дате нужно " +
        "отдать новый заказ, чтобы успеть к сезону.",
      inputSchema: {},
    },
    async () => textResult(await ordersStatus({})),
  );

  return server;
}

const provider = createOAuthProvider(TOKEN);
const resourceUrl = new URL(`${PUBLIC_URL}/mcp`);
const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(resourceUrl);

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true); // за Caddy — чтобы req.protocol/host были верными

/**
 * Журнал запросов. Без него отладка подключения превращается в гадание:
 * не видно, дошёл ли запрос вообще и был ли в нём заголовок с токеном.
 * Само значение токена и пароля из формы входа в журнал не попадает.
 */
app.use((req, _res, next) => {
  const hasAuth = Boolean(req.headers.authorization);
  console.log(
    `${req.method} ${req.path} заголовок=${hasAuth ? "есть" : "НЕТ"} agent=${
      (req.headers["user-agent"] ?? "-").toString().slice(0, 60)
    }`,
  );
  next();
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "luna-mcp" });
});

// /authorize, /token, /register, /.well-known/oauth-authorization-server,
// /.well-known/oauth-protected-resource/mcp — всё стандартное отсюда.
app.use(
  mcpAuthRouter({
    provider,
    issuerUrl: new URL(PUBLIC_URL),
    resourceServerUrl: resourceUrl,
    resourceName: "Luna Production",
  }),
);

// Наша собственная форма входа шлёт сюда — сознательно НЕ под /authorize/*,
// чтобы не попасть под внутренний body-parser роутера авторизации выше.
app.post("/consent", express.urlencoded({ extended: false }), createConsentHandler(TOKEN));

app.all(
  "/mcp",
  express.json({ limit: "1mb" }),
  requireBearerAuth({ verifier: provider, resourceMetadataUrl }),
  async (req: Request, res: Response) => {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on("close", () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.method === "POST" ? req.body : undefined);
    } catch (e) {
      console.error("Ошибка обработки MCP-запроса:", e);
      if (!res.headersSent) res.status(500).json({ error: "Внутренняя ошибка" });
    }
  },
);

app.use((_req, res) => {
  res.status(404).json({ error: "Не найдено" });
});

app.listen(PORT, HOST, () => {
  console.log(`luna-mcp слушает http://${HOST}:${PORT}/mcp (OAuth issuer: ${PUBLIC_URL})`);
});
