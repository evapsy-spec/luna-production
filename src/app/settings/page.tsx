import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import {
  hashPassword,
  requireOwner,
  writeAudit,
  type SessionUser,
} from "@/lib/auth";
import {
  Button,
  Callout,
  Card,
  Field,
  Input,
  PageHeader,
  SectionTitle,
  Select,
  StatusPill,
  Table,
  Td,
  Th,
} from "@/components/ui";

export const metadata = { title: "Настройки — Luna Production" };

const ROLE_RU: Record<string, string> = {
  OWNER: "владелец",
  MANAGER: "менеджер производства",
};

const MESSAGES: Record<string, string> = {
  user_created: "Пользователь добавлен",
  password_changed: "Пароль изменён",
  user_toggled: "Доступ обновлён",
  settings_saved: "Параметры расчётов сохранены",
  warehouse_created: "Склад тканей добавлен",
};

const ERRORS: Record<string, string> = {
  fields: "Заполните все обязательные поля",
  email_taken: "Пользователь с таким email уже есть",
  short_password: "Пароль должен быть не короче 8 символов",
  self_deactivate: "Себя деактивировать нельзя — попросите второго владельца",
};

/** Параметры расчётов: ключ → подпись, подсказка и значение по умолчанию */
const CALC_KEYS = [
  {
    key: "default_horizon_months",
    label: "Горизонт планирования по умолчанию, месяцев",
    hint: "на сколько месяцев вперёд Luna считает потребность в заказе",
    fallback: "3",
  },
  {
    key: "velocity_window_days",
    label: "Окно расчёта скорости продаж, дней",
    hint: "за какой период смотрим продажи, чтобы понять скорость",
    fallback: "90",
  },
  {
    key: "overstock_months_threshold",
    label: "Порог избытка, месяцев запаса",
    hint: "с какого запаса в месяцах считаем товар избыточным",
    fallback: "6",
  },
] as const;

async function addUser(formData: FormData) {
  "use server";
  const owner = await requireOwner();

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  const role = String(formData.get("role") ?? "MANAGER") === "OWNER" ? "OWNER" : "MANAGER";

  if (!name || !email) redirect("/settings?error=fields");
  if (password.length < 8) redirect("/settings?error=short_password");

  const existing = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);
  if (existing.length) redirect("/settings?error=email_taken");

  const id = crypto.randomUUID();
  await db.insert(schema.users).values({
    id,
    email,
    name,
    passwordHash: await hashPassword(password),
    role,
    isActive: true,
  });

  await writeAudit(owner, {
    action: "CREATE",
    entityType: "User",
    entityId: id,
    entityName: `${name} (${email})`,
    changes: { role: { from: null, to: role } },
  });

  revalidatePath("/settings");
  redirect("/settings?msg=user_created");
}

async function changePassword(formData: FormData) {
  "use server";
  const owner = await requireOwner();

  const userId = String(formData.get("userId") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!userId) redirect("/settings?error=fields");
  if (password.length < 8) redirect("/settings?error=short_password");

  const target = (
    await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1)
  )[0];
  if (!target) redirect("/settings?error=fields");

  await db
    .update(schema.users)
    .set({ passwordHash: await hashPassword(password) })
    .where(eq(schema.users.id, userId));

  await writeAudit(owner, {
    action: "UPDATE",
    entityType: "User",
    entityId: userId,
    entityName: `${target.name} (${target.email})`,
    changes: { passwordHash: { from: "прежний", to: "новый" } },
  });

  revalidatePath("/settings");
  redirect("/settings?msg=password_changed");
}

async function toggleUser(formData: FormData) {
  "use server";
  const owner = await requireOwner();

  const userId = String(formData.get("userId") ?? "");
  if (!userId) redirect("/settings?error=fields");
  if (userId === owner.id) redirect("/settings?error=self_deactivate");

  const target = (
    await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1)
  )[0];
  if (!target) redirect("/settings?error=fields");

  const next = !target.isActive;
  await db
    .update(schema.users)
    .set({ isActive: next })
    .where(eq(schema.users.id, userId));

  await writeAudit(owner, {
    action: "UPDATE",
    entityType: "User",
    entityId: userId,
    entityName: `${target.name} (${target.email})`,
    changes: { isActive: { from: target.isActive, to: next } },
  });

  revalidatePath("/settings");
  redirect("/settings?msg=user_toggled");
}

async function saveCalcSettings(formData: FormData) {
  "use server";
  const owner = await requireOwner();

  const rows = await db.select().from(schema.settings);
  const before = new Map(rows.map((r) => [r.key, r.value]));
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  for (const item of CALC_KEYS) {
    const raw = String(formData.get(item.key) ?? "").trim();
    if (!raw) continue;
    const n = Number(raw.replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) continue;
    const value = String(n);
    if (before.get(item.key) === value) continue;

    await db
      .insert(schema.settings)
      .values({ key: item.key, value, updatedAt: new Date().toISOString() })
      .onConflictDoUpdate({
        target: schema.settings.key,
        set: { value, updatedAt: new Date().toISOString() },
      });

    changes[item.key] = { from: before.get(item.key) ?? null, to: value };
  }

  if (Object.keys(changes).length) {
    await writeAudit(owner, {
      action: "UPDATE",
      entityType: "Settings",
      entityId: "calc",
      entityName: "Параметры расчётов",
      changes,
    });
  }

  revalidatePath("/settings");
  redirect("/settings?msg=settings_saved");
}

async function addFabricWarehouse(formData: FormData) {
  "use server";
  const owner = await requireOwner();

  const name = String(formData.get("name") ?? "").trim();
  const country = String(formData.get("country") ?? "").trim() || null;
  if (!name) redirect("/settings?error=fields");

  const id = crypto.randomUUID();
  await db.insert(schema.warehouses).values({
    id,
    name,
    kind: "FABRIC",
    country,
    isActive: true,
  });

  await writeAudit(owner, {
    action: "CREATE",
    entityType: "Warehouse",
    entityId: id,
    entityName: name,
    changes: { name: { from: null, to: name } },
  });

  revalidatePath("/settings");
  redirect("/settings?msg=warehouse_created");
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; error?: string }>;
}) {
  let owner: SessionUser;
  try {
    owner = await requireOwner();
  } catch (error) {
    if ((error as Error).message === "UNAUTHENTICATED") redirect("/login");
    return (
      <>
        <PageHeader title="Настройки" />
        <Callout tone="warn" title="Раздел доступен только владельцам">
          Здесь заводят пользователей, меняют пароли и параметры расчётов.
          Попросите Еву или Константина, если нужно что-то поменять.
        </Callout>
      </>
    );
  }

  const params = await searchParams;

  const users = await db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      role: schema.users.role,
      isActive: schema.users.isActive,
    })
    .from(schema.users)
    .orderBy(asc(schema.users.name));

  const settingRows = await db.select().from(schema.settings);
  const settingValue = new Map(settingRows.map((r) => [r.key, r.value]));

  const warehouses = await db
    .select()
    .from(schema.warehouses)
    .orderBy(asc(schema.warehouses.kind), asc(schema.warehouses.name));

  return (
    <>
      <PageHeader
        title="Настройки"
        subtitle="Пользователи, параметры расчётов и склады"
      />

      {params.msg && MESSAGES[params.msg] ? (
        <Callout tone="ok">{MESSAGES[params.msg]}</Callout>
      ) : null}
      {params.error && ERRORS[params.error] ? (
        <Callout tone="critical">{ERRORS[params.error]}</Callout>
      ) : null}

      {/* Пользователи */}
      <SectionTitle>Пользователи</SectionTitle>
      <Card padded={false}>
        <Table>
          <thead>
            <tr>
              <Th>Имя</Th>
              <Th>Email</Th>
              <Th>Роль</Th>
              <Th>Доступ</Th>
              <Th>Новый пароль</Th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <Td>
                  <span className="font-medium">{u.name}</span>
                  {u.id === owner.id ? (
                    <span className="ml-1.5 text-xs text-[var(--color-muted)]">
                      это вы
                    </span>
                  ) : null}
                </Td>
                <Td>{u.email}</Td>
                <Td>{ROLE_RU[u.role] ?? u.role}</Td>
                <Td>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill tone={u.isActive ? "ok" : "neutral"}>
                      {u.isActive ? "активен" : "отключён"}
                    </StatusPill>
                    {u.id === owner.id ? null : (
                      <form action={toggleUser}>
                        <input type="hidden" name="userId" value={u.id} />
                        <Button
                          type="submit"
                          variant={u.isActive ? "danger" : "secondary"}
                        >
                          {u.isActive ? "Деактивировать" : "Активировать"}
                        </Button>
                      </form>
                    )}
                  </div>
                </Td>
                <Td>
                  <form action={changePassword} className="flex items-center gap-2">
                    <input type="hidden" name="userId" value={u.id} />
                    <Input
                      type="password"
                      name="password"
                      className="w-36"
                      autoComplete="new-password"
                      aria-label={`Новый пароль для ${u.name}`}
                      placeholder="от 8 символов"
                    />
                    <Button type="submit" variant="secondary">
                      Сменить
                    </Button>
                  </form>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <div className="mt-4">
        <Card>
          <h3 className="mt-0 mb-3 text-base">Добавить пользователя</h3>
          <form action={addUser}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Имя" required>
                <Input name="name" required />
              </Field>
              <Field label="Email" required>
                <Input type="email" name="email" required />
              </Field>
              <Field label="Пароль" required hint="не короче 8 символов">
                <Input
                  type="password"
                  name="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </Field>
              <Field label="Роль" hint="владелец видит финансы, менеджер — нет">
                <Select name="role" defaultValue="MANAGER">
                  <option value="MANAGER">менеджер производства</option>
                  <option value="OWNER">владелец</option>
                </Select>
              </Field>
            </div>
            <div className="mt-4">
              <Button type="submit">Добавить пользователя</Button>
            </div>
          </form>
        </Card>
      </div>

      {/* Параметры расчётов */}
      <SectionTitle>Параметры расчётов</SectionTitle>
      <Card>
        <form action={saveCalcSettings}>
          <div className="grid gap-4 sm:grid-cols-3">
            {CALC_KEYS.map((item) => (
              <Field key={item.key} label={item.label} hint={item.hint}>
                <Input
                  name={item.key}
                  inputMode="decimal"
                  defaultValue={settingValue.get(item.key) ?? item.fallback}
                />
              </Field>
            ))}
          </div>
          <p className="mt-3 mb-0 text-xs text-[var(--color-muted)]">
            Это значения по умолчанию: в конкретном заказе горизонт можно
            задать другой.
          </p>
          <div className="mt-4">
            <Button type="submit">Сохранить параметры</Button>
          </div>
        </form>
      </Card>

      {/* Склады */}
      <SectionTitle>Склады</SectionTitle>
      <Card padded={false}>
        <Table>
          <thead>
            <tr>
              <Th>Название</Th>
              <Th>Тип</Th>
              <Th>ID в Ainur</Th>
              <Th>Страна</Th>
              <Th>Статус</Th>
            </tr>
          </thead>
          <tbody>
            {warehouses.length === 0 ? (
              <tr>
                <Td>
                  <span className="text-sm text-[var(--color-muted)]">
                    Складов пока нет
                  </span>
                </Td>
                <Td>—</Td>
                <Td>—</Td>
                <Td>—</Td>
                <Td>—</Td>
              </tr>
            ) : (
              warehouses.map((w) => (
                <tr key={w.id}>
                  <Td>
                    <span className="font-medium">{w.name}</span>
                  </Td>
                  <Td>
                    {w.kind === "FABRIC" ? "склад тканей" : "готовая продукция"}
                  </Td>
                  <Td>
                    {w.ainurId ?? (
                      <span className="text-[var(--color-faint)]">—</span>
                    )}
                  </Td>
                  <Td>{w.country ?? "—"}</Td>
                  <Td>
                    <StatusPill tone={w.isActive ? "ok" : "neutral"}>
                      {w.isActive ? "активен" : "отключён"}
                    </StatusPill>
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </Card>

      <div className="mt-4">
        <Card>
          <h3 className="mt-0 mb-3 text-base">Добавить склад тканей</h3>
          <p className="mt-0 mb-3 text-sm text-[var(--color-muted)]">
            Склады готовой продукции приходят из Ainur при синхронизации —
            вручную их заводить не нужно. Здесь добавляются только склады
            тканей, которых в Ainur нет.
          </p>
          <form action={addFabricWarehouse}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Название" required>
                <Input name="name" required placeholder="Склад тканей, Бали" />
              </Field>
              <Field label="Страна">
                <Input name="country" placeholder="Индонезия" />
              </Field>
            </div>
            <div className="mt-4">
              <Button type="submit">Добавить склад</Button>
            </div>
          </form>
        </Card>
      </div>
    </>
  );
}
