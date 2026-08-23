import { redirect, notFound } from "next/navigation";
import { headers } from "next/headers";
import { asc, eq } from "drizzle-orm";
import QRCode from "qrcode";
import { db, schema } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import { formatDate, LinkButton } from "@/components/ui";
import { formatMeters } from "@/lib/production";
import { PrintButton } from "./print-button";

export const metadata = { title: "QR-метки ткани — Luna Production" };

/**
 * Телефон сканирует метку камерой, поэтому в QR нужен полный адрес, а не
 * просто путь /scan/fabric/<token> — иначе камера не откроет ссылку.
 * Хост берём из заголовков запроса: он верный и на localhost, и на сервере.
 */
async function absoluteUrl(path: string): Promise<string> {
  const envBase = process.env.NEXT_PUBLIC_APP_URL;
  if (envBase) return `${envBase.replace(/\/$/, "")}${path}`;

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}${path}`;
}

async function qrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, { width: 320, margin: 1, errorCorrectionLevel: "M" });
}

export default async function FabricQrPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id } = await params;

  const rows = await db
    .select()
    .from(schema.fabrics)
    .where(eq(schema.fabrics.id, id))
    .limit(1);
  const fabric = rows[0];
  if (!fabric) notFound();

  const lots = await db
    .select({
      id: schema.fabricLots.id,
      lotCode: schema.fabricLots.lotCode,
      lengthM: schema.fabricLots.lengthM,
      remainingM: schema.fabricLots.remainingM,
      arrivedAt: schema.fabricLots.arrivedAt,
      warehouseName: schema.warehouses.name,
    })
    .from(schema.fabricLots)
    .innerJoin(
      schema.warehouses,
      eq(schema.fabricLots.warehouseId, schema.warehouses.id),
    )
    .where(eq(schema.fabricLots.fabricId, id))
    .orderBy(asc(schema.fabricLots.lotCode));

  // у старых записей токена может не быть — тогда сканируем по id,
  // страница /scan/fabric принимает и то, и другое
  const token = fabric.qrToken ?? fabric.id;
  const fabricLink = await absoluteUrl(`/scan/fabric/${token}`);

  const fabricQr = await qrDataUrl(fabricLink);
  const lotQrs = await Promise.all(
    lots.map(async (lot) => ({
      ...lot,
      qr: await qrDataUrl(
        await absoluteUrl(`/scan/fabric/${token}?lot=${encodeURIComponent(lot.lotCode)}`),
      ),
    })),
  );

  return (
    <>
      {/* Шапку и навигацию печатать не нужно — на бумаге нужны только метки */}
      <style>{`
        @media print {
          header, nav { display: none !important; }
          main { padding: 0 !important; max-width: none !important; }
          .label { break-inside: avoid; }
        }
      `}</style>

      <div className="no-print mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="m-0 text-2xl">QR-метки</h1>
          <p className="mt-1 mb-0 text-sm text-[var(--color-muted)]">
            {fabric.name} · {fabric.sku} — метка ткани и по одной на каждый
            рулон. Ссылка ведёт на карточку ткани в Luna.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <PrintButton />
          <LinkButton href={`/fabrics/${id}`}>Назад к карточке</LinkButton>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="label rounded-lg border border-[var(--color-line)] bg-white p-3 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={fabricQr} alt={`QR ${fabric.sku}`} className="mx-auto w-full max-w-[150px]" />
          <div className="mt-2 text-sm font-semibold text-[var(--color-ocean)]">
            {fabric.name}
          </div>
          <div className="text-xs text-[var(--color-muted)]">{fabric.sku}</div>
          <div className="text-xs text-[var(--color-muted)]">
            {fabric.color ?? "—"}
            {fabric.widthCm ? ` · ${fabric.widthCm} см` : ""}
          </div>
          <div className="mt-1 text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
            Ткань
          </div>
        </div>

        {lotQrs.map((lot) => (
          <div
            key={lot.id}
            className="label rounded-lg border border-[var(--color-line)] bg-white p-3 text-center"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lot.qr}
              alt={`QR ${lot.lotCode}`}
              className="mx-auto w-full max-w-[150px]"
            />
            <div className="mt-2 text-sm font-semibold text-[var(--color-ocean)]">
              {fabric.name}
            </div>
            <div className="text-xs text-[var(--color-muted)]">{fabric.sku}</div>
            <div className="text-xs font-medium">{lot.lotCode}</div>
            <div className="text-xs text-[var(--color-muted)]">
              {formatMeters(lot.lengthM)} · осталось {formatMeters(lot.remainingM)}
            </div>
            <div className="text-[11px] text-[var(--color-faint)]">
              {lot.warehouseName} · {formatDate(lot.arrivedAt)}
            </div>
          </div>
        ))}
      </div>

      {lots.length === 0 ? (
        <p className="no-print mt-4 text-sm text-[var(--color-muted)]">
          Рулонов пока нет — напечатана только метка ткани. Рулоны добавляются в
          карточке ткани, код присваивается автоматически.
        </p>
      ) : null}
    </>
  );
}
