import { redirect } from "next/navigation";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import {
  Button,
  Card,
  EmptyState,
  Field,
  LinkButton,
  PageHeader,
  Select,
  formatDateTime,
} from "@/components/ui";

export const metadata = { title: "История изменений — Luna Production" };

const PER_PAGE = 50;

const ACTION_RU: Record<string, string> = {
  CREATE: "создал",
  UPDATE: "изменил",
  DELETE: "удалил",
  SYNC: "синхронизировал",
  RESERVE: "зарезервировал",
  RELEASE: "снял резерв",
  APPLY_CREDIT: "зачёл кредит",
};

const ENTITY_RU: Record<string, string> = {
  Fabric: "Ткань",
  Factory: "Фабрика",
  FactoryPrice: "Цена пошива",
  Product: "Изделие",
  ProductVariant: "Вариант изделия",
  ProductionOrder: "Заказ",
  FabricPurchase: "Заявка на ткань",
  Collection: "Коллекция",
  CollectionLaunch: "Запуск коллекции",
  Supplier: "Поставщик",
  User: "Пользователь",
  Warehouse: "Склад",
  Settings: "Настройки",
  DefectCredit: "Кредит за брак",
  OrderPayment: "Оплата заказа",
};

const FIELD_RU: Record<string, string> = {
  name: "название",
  specialization: "специализация",
  contact: "контактное лицо",
  phone: "телефон",
  whatsapp: "WhatsApp",
  email: "email",
  address: "адрес",
  country: "страна",
  note: "примечание",
  mapsLat: "широта",
  mapsLng: "долгота",
  mapsUrl: "ссылка на карту",
  monthlyCapacityUnits: "мощность, шт/мес",
  collections: "коллекции",
  pricePerUnit: "цена пошива",
  status: "статус",
  quantity: "количество",
  isDone: "сделано",
  isActive: "активен",
  isArchived: "в архиве",
  leadTimeDays: "время пошива, дней",
  targetOnSaleAt: "дата продажи",
  plannedReadyAt: "плановая готовность",
  actualReadyAt: "фактическая готовность",
  role: "роль",
  passwordHash: "пароль",
  value: "значение",
  purchasePrice: "цена закупки",
  onHandM: "на складе, м",
  reservedM: "в резерве, м",
  default_horizon_months: "горизонт планирования, мес",
  velocity_window_days: "окно расчёта продаж, дней",
  overstock_months_threshold: "порог избытка, мес",
};

const ROLE_RU: Record<string, string> = {
  OWNER: "владелец",
  MANAGER: "менеджер производства",
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function fieldLabel(key: string): string {
  return FIELD_RU[key] ?? key;
}

function valueLabel(value: unknown): string {
  if (value === null || value === undefined || value === "") return "не задано";
  if (typeof value === "boolean") return value ? "да" : "нет";
  if (typeof value === "number") return String(value);
  const s = String(value);
  if (ROLE_RU[s]) return ROLE_RU[s];
  if (ISO_DATE.test(s)) return formatDateTime(s);
  return s;
}

function parseChanges(
  raw: string | null,
): { field: string; from: unknown; to: unknown }[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Record<
      string,
      { from?: unknown; to?: unknown }
    >;
    return Object.entries(parsed).map(([field, v]) => ({
      field,
      from: v?.from,
      to: v?.to,
    }));
  } catch {
    return [];
  }
}

function buildQuery(
  base: { entity?: string; user?: string; action?: string },
  page: number,
): string {
  const sp = new URLSearchParams();
  if (base.entity) sp.set("entity", base.entity);
  if (base.user) sp.set("user", base.user);
  if (base.action) sp.set("action", base.action);
  if (page > 1) sp.set("page", String(page));
  const s = sp.toString();
  return s ? `/audit?${s}` : "/audit";
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{
    entity?: string;
    user?: string;
    action?: string;
    page?: string;
  }>;
}) {
  const currentUser = await getCurrentUser();
  if (!currentUser) redirect("/login");

  const params = await searchParams;
  const entity = params.entity?.trim() || "";
  const actorId = params.user?.trim() || "";
  const action = params.action?.trim() || "";
  const pageNum = Math.max(1, Number(params.page ?? "1") || 1);

  const conditions = [
    entity ? eq(schema.auditLog.entityType, entity) : undefined,
    actorId ? eq(schema.auditLog.userId, actorId) : undefined,
    action ? eq(schema.auditLog.action, action) : undefined,
  ].filter((c) => c !== undefined);
  const where = conditions.length ? and(...conditions) : undefined;

  const totalRow = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(schema.auditLog)
    .where(where);
  const total = Number(totalRow[0]?.n ?? 0);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const page = Math.min(pageNum, pages);

  const entries = await db
    .select()
    .from(schema.auditLog)
    .where(where)
    .orderBy(desc(schema.auditLog.createdAt))
    .limit(PER_PAGE)
    .offset((page - 1) * PER_PAGE);

  const entityTypes = await db
    .selectDistinct({ entityType: schema.auditLog.entityType })
    .from(schema.auditLog);
  const actions = await db
    .selectDistinct({ action: schema.auditLog.action })
    .from(schema.auditLog);
  const users = await db
    .select({ id: schema.users.id, name: schema.users.name })
    .from(schema.users);

  const filters = { entity, user: actorId, action };

  return (
    <>
      <PageHeader
        title="История изменений"
        subtitle={`Кто и что менял · записей ${total}`}
      />

      <Card>
        <form method="get" action="/audit">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Тип объекта">
              <Select name="entity" defaultValue={entity}>
                <option value="">все объекты</option>
                {entityTypes
                  .map((t) => t.entityType)
                  .sort((a, b) =>
                    (ENTITY_RU[a] ?? a).localeCompare(ENTITY_RU[b] ?? b, "ru"),
                  )
                  .map((type) => (
                    <option key={type} value={type}>
                      {ENTITY_RU[type] ?? type}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Кто">
              <Select name="user" defaultValue={actorId}>
                <option value="">все</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Действие">
              <Select name="action" defaultValue={action}>
                <option value="">любое</option>
                {actions.map((a) => (
                  <option key={a.action} value={a.action}>
                    {ACTION_RU[a.action] ?? a.action}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="submit">Показать</Button>
            <LinkButton href="/audit" variant="ghost">
              Сбросить фильтры
            </LinkButton>
          </div>
        </form>
      </Card>

      {entries.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title="Записей нет"
            hint="Либо ещё ничего не меняли, либо под фильтры ничего не подошло."
          />
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-2.5">
          {entries.map((entry) => {
            const changes = parseChanges(entry.changes);
            return (
              <Card key={entry.id}>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="font-medium text-[var(--color-ocean)]">
                    {entry.actorName}
                  </span>
                  <span className="text-sm text-[var(--color-muted)]">
                    {ACTION_RU[entry.action] ?? entry.action}
                  </span>
                  <span className="text-sm">
                    {ENTITY_RU[entry.entityType] ?? entry.entityType} «
                    {entry.entityName}»
                  </span>
                  <span className="ml-auto text-xs text-[var(--color-faint)]">
                    {formatDateTime(entry.createdAt)}
                  </span>
                </div>

                {changes.length ? (
                  <details className="mt-2">
                    <summary className="touch cursor-pointer text-xs text-[var(--color-ocean)]">
                      Что изменилось ({changes.length})
                    </summary>
                    <ul className="mt-1.5 mb-0 list-none pl-0 text-sm">
                      {changes.map((c) => (
                        <li
                          key={c.field}
                          className="border-t border-[var(--color-line)] py-1.5"
                        >
                          <span className="text-[var(--color-muted)]">
                            {fieldLabel(c.field)}:
                          </span>{" "}
                          <span className="text-[var(--color-muted)] line-through">
                            {valueLabel(c.from)}
                          </span>{" "}
                          <span aria-hidden="true">→</span>{" "}
                          <span className="font-medium">{valueLabel(c.to)}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}

      {pages > 1 ? (
        <div className="mt-5 flex items-center justify-between gap-3">
          {page > 1 ? (
            <LinkButton href={buildQuery(filters, page - 1)}>Назад</LinkButton>
          ) : (
            <span />
          )}
          <span className="text-sm text-[var(--color-muted)]">
            Страница {page} из {pages}
          </span>
          {page < pages ? (
            <LinkButton href={buildQuery(filters, page + 1)}>Дальше</LinkButton>
          ) : (
            <span />
          )}
        </div>
      ) : null}
    </>
  );
}
