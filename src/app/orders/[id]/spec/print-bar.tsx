"use client";

/**
 * Панель над спецификацией: печать (она же «сохранить в PDF») и отправка
 * фабрике в WhatsApp. На печати сама панель скрывается.
 */
export function PrintBar({
  orderNumber,
  whatsapp,
}: {
  orderNumber: string;
  whatsapp: string | null;
}) {
  const waHref = whatsapp
    ? `https://wa.me/${whatsapp.replace(/[^\d]/g, "")}?text=${encodeURIComponent(
        `Здравствуйте! Отправляю спецификацию по заказу ${orderNumber}.`,
      )}`
    : null;

  return (
    <>
      <style>{`
        @media print {
          .print-bar { display: none !important; }
          header, nav { display: none !important; }
          @page { margin: 12mm; }
        }
      `}</style>
      <div className="print-bar mb-5 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-sand-warm)] px-3 py-2.5">
        <button
          type="button"
          onClick={() => window.print()}
          className="touch inline-flex items-center justify-center rounded-lg border border-transparent bg-[var(--color-gold)] px-4 py-2.5 text-sm font-medium text-white"
        >
          Печать / сохранить в PDF
        </button>
        {waHref ? (
          <a
            href={waHref}
            target="_blank"
            rel="noreferrer"
            className="touch inline-flex items-center justify-center rounded-lg border border-[var(--color-line)] bg-white px-4 py-2.5 text-sm font-medium text-[var(--color-ocean)] no-underline"
          >
            Написать фабрике в WhatsApp
          </a>
        ) : null}
        <a
          href="../"
          className="touch inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm text-[var(--color-ocean)] no-underline"
        >
          ← Назад к заказу
        </a>
        <span className="ml-auto text-xs text-[var(--color-muted)]">
          Сохраните как PDF и отправьте фабрике
        </span>
      </div>
    </>
  );
}
