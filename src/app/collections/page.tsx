import { redirect } from "next/navigation";
import { canSeeMoney, getCurrentUser } from "@/lib/auth";
import {
  Callout,
  Card,
  EmptyState,
  LinkButton,
  Money,
  PageHeader,
  Stat,
  Thumb,
} from "@/components/ui";
import { loadCatalog, ProductsTable, StockChips } from "./_shared";

export const metadata = { title: "Коллекции — Luna Production" };

export default async function CollectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const money = canSeeMoney(user);
  const flags = await searchParams;

  const collections = await loadCatalog();

  const totals = {
    products: collections.reduce((s, c) => s + c.productCount, 0),
    skus: collections.reduce((s, c) => s + c.skuCount, 0),
    stock: collections.reduce((s, c) => s + c.stockQty, 0),
    revenue: collections.reduce((s, c) => s + c.revenue, 0),
  };

  const withoutBom = collections
    .flatMap((c) => c.products)
    .filter((p) => !p.hasBom).length;

  return (
    <>
      <PageHeader
        title="Коллекции"
        subtitle="Коллекция → изделие → вариант (SKU). Состав, лекала и остатки живут в карточке изделия."
        action={
          <LinkButton href="/collections/new" variant="primary">
            Добавить коллекцию
          </LinkButton>
        }
      />

      {flags.ok === "deleted" ? (
        <Callout tone="ok" title="Коллекция удалена">
          Вместе с ней убраны её изделия и варианты.
        </Callout>
      ) : null}

      {collections.length === 0 ? (
        <EmptyState
          title="Коллекций пока нет"
          hint="Добавьте первую коллекцию — внутри неё появятся изделия, а у изделий состав (BOM) и лекала."
          action={
            <LinkButton href="/collections/new" variant="primary">
              Добавить коллекцию
            </LinkButton>
          }
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Коллекций" value={collections.length} />
            <Stat
              label="Изделий"
              value={totals.products}
              sub={`${totals.skus} SKU`}
            />
            <Stat label="Остаток, шт" value={totals.stock} />
            <Stat
              label="Выручка 90 дней"
              value={<Money value={totals.revenue} hidden={!money} />}
              sub={money ? "по данным Ainur" : "суммы видны владельцам"}
            />
          </div>

          {withoutBom > 0 ? (
            <div className="mt-4">
              <Callout tone="warn" title={`Без состава: ${withoutBom} изделий`}>
                Для таких изделий Luna не посчитает расход ткани и бюджет заказа.
                Откройте карточку изделия и задайте состав (BOM).
              </Callout>
            </div>
          ) : null}

          <div className="mt-5 flex flex-col gap-3">
            {collections.map((c) => (
              <Card key={c.id} padded={false}>
                {/* раскрытие через <details> — без клиентского JS */}
                <details>
                  <summary className="touch cursor-pointer list-none p-4 sm:p-5">
                    <div className="flex flex-wrap items-start gap-3">
                      <Thumb src={c.photoUrl} alt={c.name} size={64} />
                      <div className="min-w-[200px] flex-1">
                        <div className="text-base font-medium text-[var(--color-ocean)]">
                          {c.name}
                        </div>
                        <div className="mt-0.5 text-xs text-[var(--color-muted)]">
                          {c.productCount} изделий · {c.skuCount} SKU · остаток{" "}
                          {c.stockQty} шт
                        </div>
                        <div className="mt-2">
                          <StockChips rows={c.byWarehouse} />
                        </div>
                        {c.factories.length > 0 ? (
                          <div className="mt-2 text-xs text-[var(--color-muted)]">
                            Шьют: {c.factories.map((f) => f.name).join(", ")}
                          </div>
                        ) : (
                          <div className="mt-2 text-xs text-[var(--color-faint)]">
                            Фабрика не назначена
                          </div>
                        )}
                      </div>
                      <div className="text-right">
                        <div className="tnum text-sm text-[var(--color-ocean)]">
                          {c.unitsSold} шт за 90 дней
                        </div>
                        <div className="mt-0.5 text-sm">
                          <Money value={c.revenue} hidden={!money} />
                        </div>
                        <div className="mt-1 text-xs text-[var(--color-faint)]">
                          нажмите, чтобы раскрыть
                        </div>
                      </div>
                    </div>
                  </summary>

                  <div className="border-t border-[var(--color-line)]">
                    {c.products.length === 0 ? (
                      <div className="p-4 sm:p-5">
                        <p className="mt-0 mb-3 text-sm text-[var(--color-muted)]">
                          В коллекции пока нет изделий.
                        </p>
                        <LinkButton
                          href={`/products/new?collectionId=${c.id}`}
                          variant="primary"
                        >
                          Добавить изделие
                        </LinkButton>
                      </div>
                    ) : (
                      <>
                        <div className="px-0 py-2 sm:px-1">
                          <ProductsTable products={c.products} money={money} />
                        </div>
                        <div className="flex flex-wrap gap-2 p-4 sm:p-5">
                          <LinkButton href={`/collections/${c.id}`}>
                            Открыть коллекцию
                          </LinkButton>
                          <LinkButton
                            href={`/products/new?collectionId=${c.id}`}
                            variant="primary"
                          >
                            Добавить изделие
                          </LinkButton>
                        </div>
                      </>
                    )}
                  </div>
                </details>
              </Card>
            ))}
          </div>
        </>
      )}
    </>
  );
}
