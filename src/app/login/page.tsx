import { redirect } from "next/navigation";
import { verifyCredentials, createSession } from "@/lib/auth";
import { Button, Field, Input } from "@/components/ui";

export const metadata = { title: "Вход — Luna Production" };

async function login(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/");

  const user = await verifyCredentials(email, password);
  if (!user) {
    redirect(`/login?error=1${next !== "/" ? `&next=${encodeURIComponent(next)}` : ""}`);
  }
  await createSession(user);
  redirect(next.startsWith("/") ? next : "/");
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const params = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-ocean)] px-4">
      <div className="w-full max-w-sm">
        <div className="mb-7 text-center">
          <div
            className="display text-4xl leading-none"
            style={{ color: "var(--color-gold)" }}
          >
            LUNA
          </div>
          <div className="mt-1.5 text-xs uppercase tracking-[0.22em] text-[var(--color-sand)]/70">
            Production · EVA MOON
          </div>
        </div>

        <form
          action={login}
          className="rounded-2xl bg-white p-6 shadow-[0_8px_30px_rgba(0,0,0,0.2)]"
        >
          <h1 className="m-0 mb-5 text-xl">Вход</h1>

          {params.error ? (
            <div className="mb-4 rounded-lg bg-[#FBE9E9] px-3.5 py-2.5 text-sm text-[#A82C2C]">
              <span aria-hidden="true">✕</span> Неверный email или пароль
            </div>
          ) : null}

          <input type="hidden" name="next" value={params.next ?? "/"} />

          <div className="flex flex-col gap-4">
            <Field label="Email" required>
              <Input
                type="email"
                name="email"
                autoComplete="email"
                required
                autoFocus
                placeholder="eva@evamoon.co"
              />
            </Field>
            <Field label="Пароль" required>
              <Input
                type="password"
                name="password"
                autoComplete="current-password"
                required
              />
            </Field>
            <Button type="submit" className="w-full">
              Войти
            </Button>
          </div>
        </form>

        <p className="mt-5 text-center text-xs text-[var(--color-sand)]/55">
          Доступ выдаёт владелец. Забыли пароль — попросите Еву или Константина
          сбросить его в настройках.
        </p>
      </div>
    </div>
  );
}
