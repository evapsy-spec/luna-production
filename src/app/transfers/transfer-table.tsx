"use client";

/**
 * Интерактивная часть страницы «Перемещения»: чекбоксы, редактируемое
 * количество, группировка по брендам и подгруппам, «выбрать все» и
 * «скопировать список». Фильтры и вкладки-направления остаются на сервере
 * (обычные GET-формы, как везде в приложении) — здесь только выбор строк
 * и то, что с ними физически повезут.
 *
 * Мы не пишем в Ainur (см. @/lib/ainur/sync — направление синхронизации
 * всегда одно, от Ainur к нам): «скопировать список» — это весь итог,
 * дальше человек сам оформляет перемещение в Ainur или на складе.
 *
 * По просьбе Евы (после первого предпросмотра):
 *  - «Нужна закупка — перемещать нечего» здесь не показываем: это не
 *    рекомендация к перемещению, а сигнал для отдельного будущего раздела
 *    планирования закупки/пошива. Сервер по-прежнему присылает эти строки
 *    (пригодятся тому разделу), но эта таблица их просто не рендерит.
 *  - Колонки остатка и колонки «Прод. ... 12мес» показываем только для
 *    складов, реально участвующих в текущем маршруте (например, на вкладке
 *    Phuket → Phangan не показываем остаток на Fotesko — это неважно для
 *    менеджера, который собирает посылку на Пхукете).
 *  - Убрали колонки «Откуда»/«Куда» — направление и так понятно по вкладке.
 *  - Оставили только продажи за 12 месяцев (без 90 дней) — меньше цифр.
 *  - Название модели показываем полностью, без обрезки.
 *
 * По просьбе Евы (второй раунд, после вопроса про вкладку Fotesko → Phuket):
 *  - С Фотески товар физически едет только на Пхукет (дальше, при необходимости,
 *    отдельным перемещением на Панган — см. @/lib/transfer-routes) — Панган на
 *    этой вкладке был скрыт целиком. Но количество, которое рекомендуется
 *    привезти, изначально уже покрывает нехватку ОБОИХ островов (см.
 *    evaluateFoteskoLeg в @/lib/transfers/logic), а таблица показывала только
 *    остаток/продажи Пхукета — по одной этой цифре непонятно, откуда взялось
 *    «Везём». На вкладке Fotesko → Phuket остаток и продажи Пхукета и Пангана
 *    теперь складываются в один столбец «Таиланд» (сама логика расчёта
 *    рекомендации не менялась, это только отображение). На вкладках
 *    Phuket ↔ Phangan ничего не складываем — там как раз важно видеть остров
 *    отдельно, это и есть суть перемещения.
 */
import { useMemo, useState } from "react";
import { BUCKET_LABELS, type Bucket } from "@/lib/transfers/logic";
import type { TransferTableRow } from "@/lib/transfers/types";
import { StatusPill, Button } from "@/components/ui";

/**
 * Короткие подписи складов — продублировано из WAREHOUSE_META
 * (@/lib/replenish) вместо импорта оттуда: тот модуль тянет @/lib/db/client
 * (node:sqlite), а это клиентский компонент — Turbopack не умеет собирать
 * такой чанк для браузера («does not support external modules»). Поменяется
 * склад — поправить в двух местах.
 */
const SHORT_NAME: Record<string, string> = {
  Phangan: "Панган",
  Phuket: "Пхукет",
  "Fotesko Warehouse": "Fotesko",
};

/** Ровно эти же строковые имена складов используются в r.from / r.to. */
const FOTESKO_NAME = "Fotesko Warehouse";
const PHUKET_NAME = "Phuket";
const PHANGAN_NAME = "Phangan";

const BUCKET_ORDER: Bucket[] = ["moveNow", "lowStock", "newArrivals", "unconfirmedDemand"];

function short(name: string): string {
  return SHORT_NAME[name] ?? name;
}

export function TransferTable({ rows: allRows }: { rows: TransferTableRow[] }) {
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [qtyOverride, setQtyOverride] = useState<Record<string, number>>({});
  const [copied, setCopied] = useState(false);

  // «Нужна закупка — перемещать нечего» на этой странице не показываем
  // (см. комментарий вверху файла).
  const rows = useMemo(
    () => allRows.filter((r) => r.bucket !== "needsPurchase"),
    [allRows],
  );

  // Склады текущего маршрута — берём из любой строки исходных данных (на
  // одной вкладке все строки идут в одном направлении), чтобы показать
  // только те колонки остатка/продаж, которые реально участвуют в этом
  // перемещении.
  const routeFrom = allRows[0]?.from;
  const routeTo = allRows[0]?.to;
  const showFotesko = routeFrom === FOTESKO_NAME || routeTo === FOTESKO_NAME;
  const showPhuket = routeFrom === PHUKET_NAME || routeTo === PHUKET_NAME;
  const showPhangan = routeFrom === PHANGAN_NAME || routeTo === PHANGAN_NAME;
  // Ровно один маршрут ведёт с Фотески — Fotesko → Phuket (см.
  // @/lib/transfer-routes: с Фотески товар уходит только на Пхукет). Только
  // на этой вкладке остаток/продажи Пхукета и Пангана сводим в один столбец
  // «Таиланд», потому что «Везём» здесь — это нужда обоих островов сразу.
  const combineThailand = routeFrom === FOTESKO_NAME;

  const byBrand = useMemo(() => {
    const map = new Map<string, TransferTableRow[]>();
    for (const r of rows) {
      const list = map.get(r.brand) ?? [];
      list.push(r);
      map.set(r.brand, list);
    }
    return [...map.entries()].sort(([a], [b]) => {
      if (a === "Eva Moon") return -1;
      if (b === "Eva Moon") return 1;
      return a.localeCompare(b, "ru");
    });
  }, [rows]);

  const qtyFor = (r: TransferTableRow) => qtyOverride[r.variantId] ?? r.suggestedQty;

  function setQty(r: TransferTableRow, raw: string) {
    const n = Math.floor(Number(raw));
    const clamped = Number.isFinite(n) ? Math.max(0, Math.min(r.maxQty, n)) : 0;
    setQtyOverride((prev) => ({ ...prev, [r.variantId]: clamped }));
  }

  function toggle(r: TransferTableRow, checked: boolean) {
    setSelected((prev) => ({ ...prev, [r.variantId]: checked }));
  }

  const actionable = rows.filter((r) => r.suggestedQty > 0);

  function selectAllRecommended() {
    setSelected(Object.fromEntries(actionable.map((r) => [r.variantId, true])));
  }
  function clearSelection() {
    setSelected({});
  }

  const selectedRows = rows.filter((r) => selected[r.variantId]);
  const totalUnits = selectedRows.reduce((sum, r) => sum + qtyFor(r), 0);

  async function copyList() {
    const lines = selectedRows.map((r) => {
      const variant = [r.color, r.size].filter(Boolean).join(" · ");
      return [
        r.sku,
        variant ? `${r.productName} (${variant})` : r.productName,
        `${short(r.from)} → ${short(r.to)}`,
        `${qtyFor(r)} шт`,
      ].join("\t");
    });
    const text = lines.join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // буфер обмена недоступен (например, не https) — просто молчим
    }
  }

  if (rows.length === 0) return null;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-line)] bg-white px-4 py-3">
        <Button variant="secondary" onClick={selectAllRecommended} type="button">
          Выбрать все рекомендации
        </Button>
        {selectedRows.length > 0 ? (
          <Button variant="ghost" onClick={clearSelection} type="button">
            Снять выбор
          </Button>
        ) : null}
        <span className="text-sm text-[var(--color-muted)]">
          выбрано: <span className="tnum font-semibold text-[var(--color-ink)]">{selectedRows.length}</span> SKU,{" "}
          <span className="tnum font-semibold text-[var(--color-ink)]">{totalUnits}</span> шт
        </span>
        <Button
          variant="primary"
          type="button"
          onClick={copyList}
          disabled={selectedRows.length === 0}
          className="ml-auto"
        >
          {copied ? "Скопировано ✓" : "Скопировать список"}
        </Button>
      </div>

      {byBrand.map(([brand, brandRows]) => {
        const units = brandRows.reduce((s, r) => s + qtyFor(r), 0);
        return (
          <details key={brand} open={brand === "Eva Moon"} className="mb-4 group">
            <summary className="touch flex cursor-pointer list-none items-center justify-between rounded-lg border border-[var(--color-line)] bg-[var(--color-sand-warm)] px-4 py-3 text-sm font-semibold text-[var(--color-ocean)]">
              <span>
                {brand} — {brandRows.length} {pluralPositions(brandRows.length)} / {units} шт
              </span>
              <span aria-hidden="true" className="text-xs text-[var(--color-muted)] group-open:rotate-180">
                ▾
              </span>
            </summary>
            <div className="mt-2 space-y-3 pl-1">
              {BUCKET_ORDER.map((bucket) => {
                const bucketRows = brandRows.filter((r) => r.bucket === bucket);
                if (bucketRows.length === 0) return null;
                return (
                  <BucketGroup
                    key={bucket}
                    bucket={bucket}
                    rows={bucketRows}
                    selected={selected}
                    qtyFor={qtyFor}
                    onToggle={toggle}
                    onQty={setQty}
                    showFotesko={showFotesko}
                    showPhuket={showPhuket}
                    showPhangan={showPhangan}
                    combineThailand={combineThailand}
                  />
                );
              })}
            </div>
          </details>
        );
      })}
    </div>
  );
}

function pluralPositions(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "позиция";
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return "позиции";
  return "позиций";
}

function BucketGroup({
  bucket,
  rows,
  selected,
  qtyFor,
  onToggle,
  onQty,
  showFotesko,
  showPhuket,
  showPhangan,
  combineThailand,
}: {
  bucket: Bucket;
  rows: TransferTableRow[];
  selected: Record<string, boolean>;
  qtyFor: (r: TransferTableRow) => number;
  onToggle: (r: TransferTableRow, checked: boolean) => void;
  onQty: (r: TransferTableRow, raw: string) => void;
  showFotesko: boolean;
  showPhuket: boolean;
  showPhangan: boolean;
  combineThailand: boolean;
}) {
  const collapsedByDefault = bucket === "unconfirmedDemand";
  return (
    <details open={!collapsedByDefault} className="rounded-lg border border-[var(--color-line)]">
      <summary className="touch cursor-pointer list-none px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
        {BUCKET_LABELS[bucket]} · {rows.length}
      </summary>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--color-line)] text-left text-xs text-[var(--color-muted)]">
              <th className="px-2 py-2"></th>
              <th className="px-2 py-2">SKU</th>
              <th className="px-2 py-2">Модель</th>
              <th className="px-2 py-2">Размер</th>
              <th className="px-2 py-2">Коллекция</th>
              {showFotesko ? <th className="px-2 py-2 text-right">Fotesko</th> : null}
              {combineThailand ? (
                <th className="px-2 py-2 text-right" title="Пхукет + Панган вместе">
                  Таиланд
                </th>
              ) : (
                <>
                  {showPhuket ? <th className="px-2 py-2 text-right">Phuket</th> : null}
                  {showPhangan ? <th className="px-2 py-2 text-right">Phangan</th> : null}
                </>
              )}
              {combineThailand ? (
                <th className="px-2 py-2 text-right" title="Продажи Пхукета + Пангана вместе">
                  Прод. Таиланд 12мес
                </th>
              ) : (
                <>
                  {showPhuket ? <th className="px-2 py-2 text-right">Прод. Ph 12мес</th> : null}
                  {showPhangan ? <th className="px-2 py-2 text-right">Прод. Pn 12мес</th> : null}
                </>
              )}
              <th className="px-2 py-2">Посл. продажа</th>
              <th className="px-2 py-2 text-right">Везём</th>
              <th className="px-2 py-2">Причина</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.variantId} className="border-b border-[var(--color-line)] last:border-0">
                <td className="px-2 py-2">
                  <input
                    type="checkbox"
                    checked={Boolean(selected[r.variantId])}
                    onChange={(e) => onToggle(r, e.target.checked)}
                    className="h-5 w-5 rounded border-[var(--color-line)] accent-[var(--color-gold)]"
                    aria-label={`Выбрать ${r.sku}`}
                  />
                </td>
                <td className="px-2 py-2 font-medium text-[var(--color-ocean)]">
                  {r.isOtherBrand ? (
                    // У чужих брендов нет карточки /products/[id] — ссылку не рисуем
                    <span>{r.sku}</span>
                  ) : (
                    <a href={`/products/${r.productId}`} className="no-underline hover:underline">
                      {r.sku}
                    </a>
                  )}
                </td>
                <td className="px-2 py-2">
                  <span>{r.productName}</span>
                  {r.color ? (
                    <span className="block text-xs text-[var(--color-muted)]">{r.color}</span>
                  ) : null}
                </td>
                <td className="px-2 py-2">{r.size ?? "—"}</td>
                <td className="px-2 py-2 text-[var(--color-muted)]">{r.collectionName}</td>
                {showFotesko ? <Qty value={r.stock.fotesko} negative={r.negativeStock.fotesko} /> : null}
                {combineThailand ? (
                  <Qty
                    value={r.stock.phuket + r.stock.phangan}
                    negative={r.negativeStock.phuket || r.negativeStock.phangan}
                  />
                ) : (
                  <>
                    {showPhuket ? <Qty value={r.stock.phuket} negative={r.negativeStock.phuket} /> : null}
                    {showPhangan ? <Qty value={r.stock.phangan} negative={r.negativeStock.phangan} /> : null}
                  </>
                )}
                {combineThailand ? (
                  <td className="px-2 py-2 text-right tnum">{r.sales.phuket12m + r.sales.phangan12m}</td>
                ) : (
                  <>
                    {showPhuket ? (
                      <td className="px-2 py-2 text-right tnum">{r.sales.phuket12m}</td>
                    ) : null}
                    {showPhangan ? (
                      <td className="px-2 py-2 text-right tnum">{r.sales.phangan12m}</td>
                    ) : null}
                  </>
                )}
                <td className="px-2 py-2 text-xs text-[var(--color-muted)]">
                  {r.lastSaleAtDest ?? "—"}
                </td>
                <td className="px-2 py-2 text-right">
                  <input
                    type="number"
                    min={0}
                    max={r.maxQty}
                    value={qtyFor(r)}
                    onChange={(e) => onQty(r, e.target.value)}
                    className="touch w-16 rounded border border-[var(--color-line)] px-2 py-1 text-right text-sm outline-none focus:border-[var(--color-gold)]"
                  />
                </td>
                <td className="px-2 py-2 text-xs">
                  <span className="text-[var(--color-muted)]">{r.reason}</span>
                  {r.lastUnitWarning ? (
                    <span className="mt-1 block">
                      <StatusPill tone="serious">Перенос последней единицы</StatusPill>
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function Qty({ value, negative }: { value: number; negative: boolean }) {
  return (
    <td
      className={`px-2 py-2 text-right tnum ${negative ? "font-semibold text-[var(--color-critical)]" : ""}`}
      title={negative ? "Ошибка учёта в Ainur" : undefined}
    >
      {value}
      {negative ? " ⚠" : ""}
    </td>
  );
}
