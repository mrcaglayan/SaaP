import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/useAuth.js";
import { useI18n } from "../../i18n/useI18n.js";
import { useWorkingContext } from "../../context/useWorkingContext.js";
import { getFixedAsset, listFixedAssets, listFixedAssetTransactions } from "../../api/fixedAssets.js";
import {
  formatFixedAssetTransactionDisplayLabel,
  isRetroOwnershipCorrectionTransaction,
} from "./fixedAssetTransactionDisplay.js";

function parsePositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeApiError(error, fallback) {
  const message = String(
    error?.response?.data?.message || error?.message || fallback
  ).trim();
  const requestId = String(error?.response?.data?.requestId || "").trim();
  return requestId ? `${message} (requestId: ${requestId})` : message || fallback;
}

function formatDate(value) {
  if (!value) return "-";
  return String(value).slice(0, 10) || "-";
}

function formatNumber(value) {
  if (value == null) return "-";
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Render the fixed-asset disposal list plus transaction deep links, including
 * Track 43 retro-correction transaction labels where disposal context shows
 * the shared fixed-asset transaction feed.
 */
export default function FixedAssetDisposalsPage() {
  const { l } = useI18n();
  const { hasPermission } = useAuth();
  const { legalEntity, workingContext } = useWorkingContext();
  const [searchParams] = useSearchParams();
  const canRead = hasPermission("fixed_assets.read");
  const canDispose = hasPermission("fixed_assets.dispose");

  const queryTransactionId = parsePositiveInt(searchParams.get("transactionId"));
  const queryAssetId = parsePositiveInt(searchParams.get("assetId"));

  // ── Deep-link state ──────────────────────────────────────────────
  const [asset, setAsset] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [deepLinkLoading, setDeepLinkLoading] = useState(false);
  const [deepLinkError, setDeepLinkError] = useState("");

  // ── List mode state ──────────────────────────────────────────────
  const [disposedAssets, setDisposedAssets] = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState("");

  const legalEntityId = legalEntity?.id || "";
  const ownerOperatingUnitId = parsePositiveInt(workingContext?.operatingUnitId);

  // Load disposal context when deep-link params are present
  useEffect(() => {
    if (!canRead || !queryTransactionId) return;
    let active = true;
    (async () => {
      setDeepLinkLoading(true);
      setDeepLinkError("");
      try {
        if (queryAssetId) {
          const [assetRes, txRes] = await Promise.all([
            getFixedAsset(queryAssetId).catch(() => null),
            listFixedAssetTransactions(queryAssetId).catch(() => ({ rows: [] })),
          ]);
          if (active) {
            setAsset(assetRes);
            setTransactions(txRes.rows || []);
          }
        }
      } catch (err) {
        if (active) {
          setDeepLinkError(normalizeApiError(err, l("Failed to load disposal context.", "Satis bilgileri yuklenemedi.")));
        }
      } finally {
        if (active) setDeepLinkLoading(false);
      }
    })();
    return () => { active = false; };
  }, [canRead, queryTransactionId, queryAssetId, l]);

  // Load disposed assets list when in list mode
  useEffect(() => {
    if (!canRead || queryTransactionId) return;
    let active = true;
    (async () => {
      setListLoading(true);
      setListError("");
      try {
        const res = await listFixedAssets({
          legalEntityId: legalEntityId || undefined,
          ownerOperatingUnitId: ownerOperatingUnitId || undefined,
          disposed: "true",
        });
        if (active) setDisposedAssets(Array.isArray(res?.rows) ? res.rows : []);
      } catch (err) {
        if (active) {
          setDisposedAssets([]);
          setListError(normalizeApiError(err, l("Failed to load disposals.", "Satis islemleri yuklenemedi.")));
        }
      } finally {
        if (active) setListLoading(false);
      }
    })();
    return () => { active = false; };
  }, [canRead, queryTransactionId, legalEntityId, ownerOperatingUnitId, l]);

  if (!canRead) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm text-slate-600">
          {l("Missing permission: fixed_assets.read", "Eksik yetki: fixed_assets.read")}
        </p>
      </div>
    );
  }

  // ── List mode ──────────────────────────────────────────────────────
  if (!queryTransactionId) {
    return (
      <div className="space-y-6">
        {/* Header */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">
            {l("Fixed Asset Disposals", "Demirbas Satis/Elden Cikarma")}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {l(
              "Sale, write-off, and disposal transactions. Assets that have been disposed are listed below.",
              "Satis, hurda ve elden cikarma islemleri. Elden cikarilmis varliklar asagida listelenir."
            )}
          </p>
          {!canDispose ? (
            <p className="mt-2 text-xs text-amber-700">
              {l(
                "Read-only access — you do not have disposal permissions.",
                "Salt okunur erisim — elden cikarma yetkiniz yok."
              )}
            </p>
          ) : null}
        </section>

        {/* Results */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">
            {l("Disposed Assets", "Elden Cikarilmis Varliklar")}
            {!listLoading ? <span className="ml-2 text-sm font-normal text-slate-500">({disposedAssets.length})</span> : null}
          </h2>
          {listError ? <p className="mt-3 text-sm text-rose-700">{listError}</p> : null}
          {listLoading ? <p className="mt-3 text-sm text-slate-600">{l("Loading...", "Yukleniyor...")}</p> : null}
          {!listLoading && disposedAssets.length === 0 && !listError ? (
            <p className="mt-3 text-sm text-slate-600">
              {l("No sale or disposal transactions found.", "Satis veya elden cikarma islemi bulunamadi.")}
            </p>
          ) : null}
          {!listLoading && disposedAssets.length > 0 ? (
            <div className="mt-3 overflow-auto rounded-lg border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-slate-600">
                  <tr>
                    <th className="px-3 py-2">{l("Asset No", "Demirbas No")}</th>
                    <th className="px-3 py-2">{l("Name", "Ad")}</th>
                    <th className="px-3 py-2">{l("Status", "Durum")}</th>
                    <th className="px-3 py-2">{l("Disposal Date", "Elden Cikarma Tarihi")}</th>
                    <th className="px-3 py-2 text-right">{l("Original Cost", "Orijinal Maliyet")}</th>
                    <th className="px-3 py-2">{l("Currency", "Para Birimi")}</th>
                  </tr>
                </thead>
                <tbody>
                  {disposedAssets.map((row) => (
                    <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-2">
                        <Link
                          to={`/app/demirbas-karti-detayi/${row.id}`}
                          className="font-medium text-cyan-700 hover:underline"
                        >
                          {row.assetNo || "-"}
                        </Link>
                      </td>
                      <td className="px-3 py-2 max-w-[200px] truncate">{row.name || "-"}</td>
                      <td className="px-3 py-2">
                        <span className="inline-block rounded-full px-2 py-0.5 text-xs font-semibold bg-rose-100 text-rose-800">
                          {row.status || "-"}
                        </span>
                      </td>
                      <td className="px-3 py-2">{formatDate(row.disposalDate)}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatNumber(row.originalCostBase)}</td>
                      <td className="px-3 py-2">{row.currencyCode || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      </div>
    );
  }

  // ── Deep-link mode ─────────────────────────────────────────────────

  if (deepLinkLoading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm text-slate-600">{l("Loading...", "Yukleniyor...")}</p>
      </div>
    );
  }

  if (deepLinkError) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 shadow-sm">
        <p className="text-sm text-rose-700">{deepLinkError}</p>
      </div>
    );
  }

  const focusedTx = transactions.find(
    (tx) => parsePositiveInt(tx.id) === queryTransactionId
  );
  const focusedTxDisplayLabel = formatFixedAssetTransactionDisplayLabel(
    focusedTx?.transactionType || focusedTx?.transaction_type,
    focusedTx?.sourceRefType || focusedTx?.source_ref_type,
    focusedTx?.displayLabel || focusedTx?.display_label
  );

  return (
    <div className="space-y-4">
      {/* Back link */}
      <Link to="/app/demirbas-satis-islemleri" className="text-sm text-cyan-700 hover:underline">
        {l("Back to disposals", "Satis listesine don")}
      </Link>

      {/* Context banner */}
      <section className="rounded-xl border border-cyan-200 bg-cyan-50 p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">
          {l("Disposal Transaction", "Satis/Elden Cikarma Hareketi")} #{queryTransactionId}
        </h2>
        {asset ? (
          <p className="mt-1 text-sm text-slate-600">
            {l("Asset", "Demirbas")}: {asset.assetNo || `#${asset.id}`} — {asset.name || "-"}
            {" "}
            <Link
              to={`/app/demirbas-karti-detayi/${queryAssetId}`}
              className="text-cyan-700 hover:underline"
            >
              {l("View asset", "Demirbase git")}
            </Link>
          </p>
        ) : queryAssetId ? (
          <p className="mt-1 text-sm text-slate-500">
            {l("Asset ID", "Demirbas ID")}: {queryAssetId}
          </p>
        ) : null}
      </section>

      {/* Focused transaction detail */}
      {focusedTx ? (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-base font-semibold text-slate-900">
            {l("Transaction Detail", "Hareket Detayi")}
          </h3>
          <dl className="mt-3 grid gap-x-4 gap-y-3 md:grid-cols-4">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{l("ID", "ID")}</dt>
              <dd className="mt-0.5 text-sm text-slate-900 font-mono">{focusedTx.id}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{l("Type", "Tip")}</dt>
              <dd className="mt-0.5 text-sm text-slate-900">
                <div className="flex flex-wrap items-center gap-2">
                  <span>{focusedTxDisplayLabel}</span>
                  {isRetroOwnershipCorrectionTransaction(
                    focusedTx.transactionType || focusedTx.transaction_type
                  ) && parsePositiveInt(
                    focusedTx.retroCorrectionId || focusedTx.retro_correction_id
                  ) ? (
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                      {l(
                        `Correction #${focusedTx.retroCorrectionId || focusedTx.retro_correction_id}`,
                        `Duzeltme #${focusedTx.retroCorrectionId || focusedTx.retro_correction_id}`
                      )}
                    </span>
                  ) : null}
                </div>
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{l("Status", "Durum")}</dt>
              <dd className="mt-0.5 text-sm text-slate-900">{focusedTx.status || "-"}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{l("Effective Date", "Gecerlilik Tarihi")}</dt>
              <dd className="mt-0.5 text-sm text-slate-900">{formatDate(focusedTx.effectiveDate || focusedTx.effective_date)}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{l("Posting Date", "Kayit Tarihi")}</dt>
              <dd className="mt-0.5 text-sm text-slate-900">{formatDate(focusedTx.postingDate || focusedTx.posting_date)}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{l("Proceeds (Base)", "Tahsilat (Baz)")}</dt>
              <dd className="mt-0.5 text-sm text-slate-900 font-mono">{formatNumber(focusedTx.proceedsAmountBase || focusedTx.proceeds_amount_base)}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{l("NBV (Base)", "NBV (Baz)")}</dt>
              <dd className="mt-0.5 text-sm text-slate-900 font-mono">{formatNumber(focusedTx.nbvAmountBase || focusedTx.nbv_amount_base)}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{l("Gross (Base)", "Brut (Baz)")}</dt>
              <dd className="mt-0.5 text-sm text-slate-900 font-mono">{formatNumber(focusedTx.grossAmountBase || focusedTx.gross_amount_base)}</dd>
            </div>
          </dl>
        </section>
      ) : (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
          <p className="text-sm text-amber-800">
            {l(
              `Transaction #${queryTransactionId} was not found in this asset's transaction list.`,
              `Hareket #${queryTransactionId} bu varligin hareket listesinde bulunamadi.`
            )}
          </p>
        </section>
      )}

      {/* All transactions for context */}
      {transactions.length > 0 ? (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-base font-semibold text-slate-900">
            {l("Asset Transactions", "Varlik Hareketleri")}
          </h3>
          <div className="mt-3 overflow-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-2 py-2">{l("ID", "ID")}</th>
                  <th className="px-2 py-2">{l("Type", "Tip")}</th>
                  <th className="px-2 py-2">{l("Status", "Durum")}</th>
                  <th className="px-2 py-2">{l("Effective Date", "Gecerlilik Tarihi")}</th>
                  <th className="px-2 py-2 text-right">{l("NBV (Base)", "NBV (Baz)")}</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => {
                  const isFocused = parsePositiveInt(tx.id) === queryTransactionId;
                  const transactionLabel = formatFixedAssetTransactionDisplayLabel(
                    tx.transactionType || tx.transaction_type,
                    tx.sourceRefType || tx.source_ref_type,
                    tx.displayLabel || tx.display_label
                  );
                  const retroCorrectionId = parsePositiveInt(
                    tx.retroCorrectionId || tx.retro_correction_id
                  );
                  const isRetroCorrection = isRetroOwnershipCorrectionTransaction(
                    tx.transactionType || tx.transaction_type
                  );
                  return (
                    <tr
                      key={tx.id}
                      className={`border-b border-slate-100 ${
                        isFocused
                          ? "bg-cyan-50 ring-1 ring-cyan-300"
                          : isRetroCorrection
                            ? "bg-emerald-50/40 hover:bg-emerald-50"
                            : "hover:bg-slate-50"
                      }`}
                    >
                      <td className="px-2 py-1.5 font-mono text-xs">{tx.id}</td>
                      <td className="px-2 py-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span>{transactionLabel}</span>
                          {retroCorrectionId ? (
                            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                              {l(
                                `Correction #${retroCorrectionId}`,
                                `Duzeltme #${retroCorrectionId}`
                              )}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-2 py-1.5">{tx.status || "-"}</td>
                      <td className="px-2 py-1.5">{formatDate(tx.effectiveDate || tx.effective_date)}</td>
                      <td className="px-2 py-1.5 text-right font-mono">{formatNumber(tx.nbvAmountBase || tx.nbv_amount_base)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
