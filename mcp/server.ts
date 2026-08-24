/**
 * MCP-сервер Luna Production — доступ к данным из чата с Луной без макбука.
 *
 * Слушает 127.0.0.1, наружу его выставляет Caddy по адресу /mcp того же домена.
 * Отдельного поддомена и сертификата не нужно, новых портов в файрволе тоже.
 *
 * Только чтение. Записывающих инструментов здесь нет и появиться они должны
 * только отдельным решением: границы те же, что у телеграм-бота — читать
 * свободно, менять данные только с подтверждением человека, а цены, скидки,
 * остатки, письма клиентам, живой сайт и деньги — никогда.
 *
 * Доступ по токену в заголовке Authorization: Bearer <MCP_TOKEN>.
 * Токен генерируется на самом сервере (см. README раздел «MCP») и вставляется
 * в настройки коннектора Claude вручную.
 *
 * Запуск: npm run mcp   (systemd-юнит luna-mcp)
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { salesByMonth, productCard, ordersStatus } from "@/lib/reports";
import { getReplenish, LOW_STOCK_THRESHOLD } from "@/lib/replenish";

const PORT = Number(process.env.MCP_PORT ?? 3100);
const HOST = process.env.MCP_HOST ?? "127.0.0.1";
const TOKEN = (process.env.MCP_TOKEN ?? "").trim();

if (!TOKEN || TOKEN.length < 24) {
  console.error(
    "MCP_TOKEN не задан или слишком короткий. Сгенерируй его на сервере и добавь в .env:\n" +
      "  echo MCP_TOKEN=$(openssl rand -hex 32) >> /srv/luna/.env",
  );
  process.exit(1);
}

/** Ответ на запросы, не прошедшие проверку токена */
function deny(res: ServerResponse, code: number, message: string) {
  res.writeHead(code, {
    "content-type": "application/json",
    ...(code === 401 ? { "www-authenticate": "Bearer" } : {}),
  });
  res.end(JSON.stringify({ error: message }));
}

function authorized(req: IncomingMessage): boolean {
  const header = req.headers.authorization ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  const given = m?.[1]?.trim() ?? "";
  if (given.length !== TOKEN.length) return false;
  // сравнение без ранних выходов, чтобы время ответа не подсказывало префикс
  let diff = 0;
  for (let i = 0; i < TOKEN.length; i++) {
    diff |= given.charCodeAt(i) ^ TOKEN.charCodeAt(i);
  }
  return diff === 0;
}

function textResult(value: unknown) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(value, null, 1) },
    ],
  };
}

/**
 * Новый экземпляр на каждый запрос: сервер работает без сессий, так проще
 * и не надо хранить состояние между вызовами.
 */
function buildServer(): McpServer {
  const server = new McpServer({
    name: "luna-production",
    version: "1.0.0",
  });

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
        sku: z
          .string()
          .optional()
          .describe("SKU или его часть; несколько — через запятую"),
        collection: z
          .string()
          .optional()
          .describe("название коллекции или его часть"),
        from: z.string().optional().describe("начало периода, YYYY-MM-DD"),
        to: z.string().optional().describe("конец периода, YYYY-MM-DD"),
      },
    },
    async ({ sku, collection, from, to }) =>
      textResult(await salesByMonth({ sku, collection, from, to })),
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
        query: z
          .string()
          .describe("часть SKU или названия модели, например: silk bralette"),
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
        collection: z
          .string()
          .optional()
          .describe("ограничить одной коллекцией (точное имя)"),
        onlySoldOut: z
          .boolean()
          .optional()
          .describe("только те, что распродались в ноль при живом спросе"),
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
          stock: Object.fromEntries(
            data.warehouses.map((w, i) => [w.name, r.cells[i]?.qty ?? null]),
          ),
          soldOutAt: data.warehouses
            .filter((_, i) => r.cells[i]?.soldOut)
            .map((w) => w.name),
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

const http = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "luna-mcp" }));
    return;
  }

  if (url.pathname !== "/mcp") {
    deny(res, 404, "Не найдено");
    return;
  }

  if (!authorized(req)) {
    deny(res, 401, "Нужен заголовок Authorization: Bearer <токен>");
    return;
  }

  let body: unknown;
  if (req.method === "POST") {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > 1_000_000) {
        deny(res, 413, "Слишком большой запрос");
        return;
      }
      chunks.push(chunk as Buffer);
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      deny(res, 400, "Тело запроса не разобралось как JSON");
      return;
    }
  }

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
    await transport.handleRequest(req, res, body);
  } catch (e) {
    console.error("Ошибка обработки запроса:", e);
    if (!res.headersSent) deny(res, 500, "Внутренняя ошибка");
  }
});

http.listen(PORT, HOST, () => {
  console.log(`luna-mcp слушает http://${HOST}:${PORT}/mcp`);
});
