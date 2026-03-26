import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import MoneyText from "../../components/MoneyText.jsx";
import { useAuth } from "../../auth/useAuth.js";
import { useI18n } from "../../i18n/useI18n.js";
import {
  getInventoryLandedCostVoucher,
  reverseInventoryLandedCostVoucher,
} from "../../api/inventory.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function todayDateOnly() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeApiError(error, fallback) {
  const message = String(error?.response?.data?.message || error?.message || fallback).trim();
  const requestId = String(error?.response?.data?.requestId || "").trim();
  return requestId ? `${message} (requestId: ${requestId})` : message || fallback;
}

function getStatusBadgeClass(value) {
  switch (String(value || "").trim().toUpperCase()) {
    case "POSTED":
      return "border border-emerald-200 bg-emerald-50 text-emerald-800";
    case "REVERSED":
      return "border border-rose-200 bg-rose-50 text-rose-800";
    case "REVERSAL_BLOCKED":
      return "border border-amber-200 bg-amber-50 text-amber-800";
    case "DRAFT":
    default:
      return "border border-slate-200 bg-slate-100 text-slate-700";
  }
}

function getStatusLabel(value, l) {
  switch (String(value || "").trim().toUpperCase()) {
    case "POSTED":
      return l("Posted", "Kaydedildi");
    case "REVERSED":
      return l("Reversed", "Ters kaydedildi");
    case "REVERSAL_BLOCKED":
      return l("Reversal Blocked", "Ters kayit bloklu");
    case "DRAFT":
    default:
      return l("Draft", "Taslak");
  }
}

function getOwnershipLabel(row, l) {
  const scope = String(row?.ownershipScope || "").trim().toUpperCase();
  if (scope === "OPERATING_UNIT") {
    const code = normalizeText(row?.operatingUnitCode);
    const name = normalizeText(row?.operatingUnitName);
    return code && name
      ? `${code} - ${name}`
      : code || name || `${l("Operating unit", "Isletme birimi")} #${row?.operatingUnitId || "-"}`;
  }
  return l("Central", "Merkez");
}

function SummaryStat({ label, value, children }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-lg font-semibold text-slate-900">{value ?? children ?? "-"}</div>
    </div>
  );
}

export default function InventoryLandedCostVoucherDetailPage() {
  const { voucherId } = useParams();
  const { hasPermission } = useAuth();
  const { l } = useI18n();
  const canRead = hasPermission("inventory.read");
  const canUpsert = hasPermission("inventory.upsert");

  const [loading, setLoading] = useState(false);
  const [pageError, setPageError] = useState("");
  const [voucher, setVoucher] = useState(null);
  const [reverseOpen, setReverseOpen] = useState(false);
  const [reverseForm, setReverseForm] = useState({
    reversalDate: todayDateOnly(),
    reverseReason: "",
  });
  const [reverseSubmitting, setReverseSubmitting] = useState(false);
  const [reverseError, setReverseError] = useState("");

  const normalizedVoucherId = useMemo(() => toPositiveInt(voucherId), [voucherId]);
  const uiStatus = normalizeText(voucher?.uiStatus || voucher?.status || "DRAFT");
  const canReverseVoucher =
    canUpsert
    && String(voucher?.status || "").toUpperCase() === "POSTED"
    && !voucher?.hasReversalDependencies;

  useEffect(() => {
    let active = true;

    async function loadVoucher() {
      if (!canRead) {
        setPageError(l("Missing permission: inventory.read", "Eksik yetki: inventory.read"));
        setVoucher(null);
        return;
      }
      if (!normalizedVoucherId) {
        setPageError(l("Voucher id is invalid.", "Voucher kimligi gecersiz."));
        setVoucher(null);
        return;
      }

      setLoading(true);
      setPageError("");
      try {
        const response = await getInventoryLandedCostVoucher(normalizedVoucherId);
        if (!active) {
          return;
        }
        setVoucher(response || null);
      } catch (error) {
        if (!active) {
          return;
        }
        setPageError(
          normalizeApiError(
            error,
            l(
              "Failed to load landed-cost voucher detail.",
              "Stok maliyet voucher detayi yuklenemedi."
            )
          )
        );
        setVoucher(null);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadVoucher();
    return () => {
      active = false;
    };
  }, [canRead, l, normalizedVoucherId]);

  async function reloadVoucher() {
    if (!canRead || !normalizedVoucherId) {
      return;
    }
    const response = await getInventoryLandedCostVoucher(normalizedVoucherId);
    setVoucher(response || null);
  }

  async function handleReverseConfirm() {
    if (!canUpsert) {
      setReverseError(l("Missing permission: inventory.upsert", "Eksik yetki: inventory.upsert"));
      return;
    }
    setReverseSubmitting(true);
    setReverseError("");
    try {
      await reverseInventoryLandedCostVoucher(normalizedVoucherId, reverseForm);
      setReverseOpen(false);
      await reloadVoucher();
    } catch (error) {
      setReverseError(
        normalizeApiError(
          error,
          l("Failed to reverse voucher.", "Voucher ters kaydi yapilamadi.")
        )
      );
    } finally {
      setReverseSubmitting(false);
    }
  }

  return (
    <div className="space-y-6 pb-8">
      <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <div className="text-sm text-slate-500">
            <Link className="hover:text-slate-700" to="/app/stok-maliyet-voucherleri">
              {l("Inventory / Landed Cost Vouchers", "Stoklar / Stok Maliyet Voucherleri")}
            </Link>
            <span className="px-2 text-slate-300">/</span>
            <span className="text-slate-700">{voucher?.voucherNo || `#${voucherId || "-"}`}</span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950">
              {voucher?.voucherNo || l("Landed Cost Voucher", "Stok Maliyet Voucheri")}
            </h1>
            <span
              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${getStatusBadgeClass(
                uiStatus
              )}`}
            >
              {getStatusLabel(uiStatus, l)}
            </span>
          </div>
          <p className="text-sm text-slate-500">
            {l("Basic detail, source, and target visibility for the voucher.", "Voucher icin temel detay, kaynak ve hedef gorunumu.")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            className="inline-flex items-center rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-400 hover:text-slate-900"
            to="/app/stok-maliyet-voucherleri"
          >
            {l("Back to list", "Listeye don")}
          </Link>
          <button
            type="button"
            onClick={() => setReverseOpen(true)}
            disabled={!canReverseVoucher}
            title={
              voucher?.hasReversalDependencies
                ? l("Blocked by downstream dependency", "Asagi bagimlilik nedeniyle bloklu")
                : !canUpsert
                  ? l("Missing permission: inventory.upsert", "Eksik yetki: inventory.upsert")
                  : ""
            }
            className={`inline-flex items-center rounded-xl px-4 py-2 text-sm font-semibold ${
              canReverseVoucher
                ? "bg-rose-600 text-white hover:bg-rose-700"
                : "cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400"
            }`}
          >
            {l("Reverse Voucher", "Voucher ters kaydi")}
          </button>
        </div>
      </div>

      {!canRead ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          {l("Missing permission: inventory.read", "Eksik yetki: inventory.read")}
        </div>
      ) : null}

      {pageError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {pageError}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          {l("Loading voucher detail...", "Voucher detayi yukleniyor...")}
        </div>
      ) : null}

      {!loading && voucher ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <SummaryStat label={l("Posting Date", "Kayit tarihi")} value={voucher.postingDate} />
            <SummaryStat label={l("Context", "Baglam")} value={getOwnershipLabel(voucher, l)} />
            <SummaryStat label={l("Source Amount", "Kaynak tutari")}>
              <MoneyText amount={voucher?.sourceSummary?.totalAppliedAmountBase || 0} showCurrency={false} />
            </SummaryStat>
            <SummaryStat label={l("Capitalized / Consumed", "Aktiflesen / Tuketilen")}>
              <div className="space-y-1">
                <div>
                  <MoneyText amount={voucher?.targetSummary?.totalCapitalizedAmountBase || 0} showCurrency={false} />
                </div>
                <div className="text-sm font-normal text-slate-500">
                  <MoneyText amount={voucher?.targetSummary?.totalConsumedAmountBase || 0} showCurrency={false} />
                </div>
              </div>
            </SummaryStat>
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
            <section className="rounded-2xl border border-slate-200 bg-white">
              <div className="border-b border-slate-200 px-5 py-4">
                <h2 className="text-lg font-semibold text-slate-900">
                  {l("Source AP Lines", "Kaynak AP satirlari")}
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3">{l("Bill No", "Fatura no")}</th>
                      <th className="px-4 py-3">{l("Vendor", "Tedarikci")}</th>
                      <th className="px-4 py-3">{l("Description", "Aciklama")}</th>
                      <th className="px-4 py-3 text-right">{l("Applied", "Uygulanan")}</th>
                      <th className="px-4 py-3 text-right">{l("Remaining", "Kalan")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(voucher.sources || []).map((row) => (
                      <tr key={row.voucherSourceId} className="hover:bg-slate-50">
                        <td className="px-4 py-3 text-slate-700">{row.billNo || "-"}</td>
                        <td className="px-4 py-3 text-slate-700">{row.vendorName || row.vendorCode || "-"}</td>
                        <td className="px-4 py-3 text-slate-700">{row.lineDescription || "-"}</td>
                        <td className="px-4 py-3 text-right text-slate-900">
                          <MoneyText amount={row.appliedAmountBase} showCurrency={false} />
                        </td>
                        <td className="px-4 py-3 text-right text-slate-500">
                          <MoneyText amount={row.remainingUnappliedAmountBase} showCurrency={false} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white">
              <div className="border-b border-slate-200 px-5 py-4">
                <h2 className="text-lg font-semibold text-slate-900">
                  {l("Voucher Summary", "Voucher ozeti")}
                </h2>
              </div>
              <dl className="space-y-4 px-5 py-4 text-sm">
                <div>
                  <dt className="text-slate-500">{l("Legal Entity", "Tuzel kisilik")}</dt>
                  <dd className="mt-1 font-medium text-slate-900">{voucher.legalEntityId || "-"}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">{l("Operating Unit", "Isletme birimi")}</dt>
                  <dd className="mt-1 font-medium text-slate-900">{getOwnershipLabel(voucher, l)}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">{l("Journal Ref", "Yevmiye ref")}</dt>
                  <dd className="mt-1 font-medium text-slate-900">
                    {voucher.postedJournalEntryId
                      ? `JRN #${voucher.postedJournalEntryId}`
                      : l("Not posted", "Henuz kayit yok")}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">{l("Note", "Not")}</dt>
                  <dd className="mt-1 whitespace-pre-wrap text-slate-700">
                    {voucher.note || l("No note", "Not yok")}
                  </dd>
                </div>
                {!canUpsert ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-800">
                    {l("Missing permission: inventory.upsert", "Eksik yetki: inventory.upsert")}
                  </div>
                ) : null}
              </dl>
            </section>
          </div>

          <section className="rounded-2xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-lg font-semibold text-slate-900">
                {l("Target Receipts", "Hedef kabuller")}
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">{l("Receipt Ref", "Kabul ref")}</th>
                    <th className="px-4 py-3">{l("Item", "Stok")}</th>
                    <th className="px-4 py-3">{l("Warehouse", "Depo")}</th>
                    <th className="px-4 py-3">{l("Context", "Baglam")}</th>
                    <th className="px-4 py-3 text-right">{l("Allocated", "Dagitilan")}</th>
                    <th className="px-4 py-3 text-right">{l("On Hand", "Elde kalan")}</th>
                    <th className="px-4 py-3 text-right">{l("Consumed", "Tuketilen")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(voucher.targets || []).map((row) => (
                    <tr key={row.voucherTargetId} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-slate-700">{row.receiptRef || "-"}</td>
                      <td className="px-4 py-3 text-slate-700">
                        {row.itemCode && row.itemName ? `${row.itemCode} - ${row.itemName}` : row.itemCode || row.itemName || "-"}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {row.warehouseCode && row.warehouseName
                          ? `${row.warehouseCode} - ${row.warehouseName}`
                          : row.warehouseCode || row.warehouseName || "-"}
                      </td>
                      <td className="px-4 py-3 text-slate-700">{getOwnershipLabel(row, l)}</td>
                      <td className="px-4 py-3 text-right text-slate-900">
                        <MoneyText amount={row.allocatedAmountBase} showCurrency={false} />
                      </td>
                      <td className="px-4 py-3 text-right text-slate-700">
                        <MoneyText amount={row.onHandAllocatedAmountBase} showCurrency={false} />
                      </td>
                      <td className="px-4 py-3 text-right text-slate-500">
                        <MoneyText amount={row.consumedAllocatedAmountBase} showCurrency={false} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}

      {reverseOpen ? (
        <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/20">
          <div className="flex h-full w-full max-w-lg flex-col border-l border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  {l("Reverse Landed Cost Voucher", "Stok maliyet voucher ters kaydi")}
                </h2>
                <p className="mt-1 text-sm text-slate-500">{voucher?.voucherNo || "-"}</p>
              </div>
              <button
                type="button"
                onClick={() => setReverseOpen(false)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:border-slate-300 hover:text-slate-900"
              >
                {l("Close", "Kapat")}
              </button>
            </div>
            <div className="space-y-4 overflow-y-auto px-5 py-4 text-sm">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-500">{l("Status", "Durum")}</div>
                    <div className="mt-1 font-medium text-slate-900">{getStatusLabel(uiStatus, l)}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-500">{l("Journal Ref", "Yevmiye ref")}</div>
                    <div className="mt-1 font-medium text-slate-900">
                      {voucher?.postedJournalEntryId ? `JRN #${voucher.postedJournalEntryId}` : "-"}
                    </div>
                  </div>
                </div>
              </div>

              {voucher?.hasReversalDependencies ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800">
                  {l(
                    "Blocked because one or more capitalized landed-cost balances were later consumed or transferred.",
                    "Bir veya daha fazla aktifleştirilmis stok maliyet bakiyesi daha sonra tuketildigi veya transfer edildigi icin bloklu."
                  )}
                </div>
              ) : (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">
                  {l(
                    "This voucher can be reversed because no downstream dependency was found on capitalized landed-cost balances.",
                    "Bu voucher ters kaydedilebilir; aktifleştirilmis stok maliyet bakiyelerinde asagi bagimlilik bulunmadi."
                  )}
                </div>
              )}

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">
                  {l("Reversal Date", "Ters kayit tarihi")}
                </span>
                <input
                  type="date"
                  value={reverseForm.reversalDate}
                  onChange={(event) =>
                    setReverseForm((current) => ({ ...current, reversalDate: event.target.value }))
                  }
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">
                  {l("Reason", "Neden")}
                </span>
                <textarea
                  rows={4}
                  value={reverseForm.reverseReason}
                  onChange={(event) =>
                    setReverseForm((current) => ({ ...current, reverseReason: event.target.value }))
                  }
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none"
                />
              </label>

              {reverseError ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-rose-700">
                  {reverseError}
                </div>
              ) : null}
            </div>
            <div className="mt-auto flex items-center justify-end gap-3 border-t border-slate-200 px-5 py-4">
              <button
                type="button"
                onClick={() => setReverseOpen(false)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-400"
              >
                {l("Cancel", "Vazgec")}
              </button>
              <button
                type="button"
                onClick={handleReverseConfirm}
                disabled={!canReverseVoucher || reverseSubmitting}
                className={`rounded-xl px-4 py-2 text-sm font-semibold ${
                  canReverseVoucher && !reverseSubmitting
                    ? "bg-rose-600 text-white hover:bg-rose-700"
                    : "cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400"
                }`}
              >
                {reverseSubmitting
                  ? l("Reversing...", "Ters kaydediliyor...")
                  : l("Confirm Reverse", "Ters kaydi onayla")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
