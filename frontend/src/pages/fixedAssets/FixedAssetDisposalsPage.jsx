import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/useAuth.js";
import { useI18n } from "../../i18n/useI18n.js";
import { getFixedAsset, listFixedAssetTransactions } from "../../api/fixedAssets.js";
import FixedAssetModulePage from "./FixedAssetModulePage.jsx";

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

export default function FixedAssetDisposalsPage() {
  const { l } = useI18n();
  const { hasPermission } = useAuth();
  const [searchParams] = useSearchParams();
  const canRead = hasPermission("fixed_assets.read");

  const queryTransactionId = parsePositiveInt(searchParams.get("transactionId"));
  const queryAssetId = parsePositiveInt(searchParams.get("assetId"));

  const [asset, setAsset] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Load disposal context when deep-link params are present
  useEffect(() => {
    if (!canRead || !queryTransactionId) return;
    let active = true;
    (async () => {
      setLoading(true);
      setError("");
      try {
        // If assetId is provided, load asset context and its transactions
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
          setError(normalizeApiError(err, l("Failed to load disposal context.", "Satis bilgileri yuklenemedi.")));
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [canRead, queryTransactionId, queryAssetId, l]);

  // No deep-link: show the scaffold
  if (!queryTransactionId) {
    return (
      <FixedAssetModulePage
        route="/app/demirbas-satis-islemleri"
        description={l(
          "Disposal, sale, and write-off queue aligned to FA11, with explicit NBV, gain/loss, and schedule-cutoff behavior.",
          "FA11 ile uyumlu satis, elden cikarma ve hurda kuyrugu; acik NBV, kar/zarar ve plan-kesme davranisini hedefler."
        )}
        currentScope={[
          l(
            "Keep disposal separate from physical move and ownership transfer.",
            "Satis/elden cikarmayi fiziksel hareket ve ownership transfer akisindan ayir."
          ),
          l(
            "Prepare queue columns for disposal date, proceeds, NBV, gain/loss, and journal traceability.",
            "Kuyruk kolonlarini disposal tarihi, tahsilat, NBV, kar/zarar ve fis izlenebilirligi icin hazirla."
          ),
          l(
            "Show period-open and posting prerequisites before allowing the disposal action.",
            "Disposal aksiyonundan once donem-acik ve posting on kosullarini goster."
          ),
        ]}
        nextSteps={[
          l(
            "Implement disposal and write-off endpoints with owner-OU posting validation.",
            "Owner-OU posting kontrolu ile disposal ve write-off endpointlerini uygula."
          ),
          l(
            "Stop future depreciation schedule lines after disposal posting.",
            "Disposal posting sonrasinda gelecek amortisman plan satirlarini durdur."
          ),
          l(
            "Surface reversal policy only after the source and disposal accounting rules are locked.",
            "Ters kayit politikasini ancak kaynak ve disposal muhasebe kurallari kilitlendikten sonra ac."
          ),
        ]}
        decisionItems={[
          l(
            "Every posting action must enforce book, fiscal-period-open, and posting-date legality checks.",
            "Tum posting aksiyonlari defter, mali donem-acik ve posting tarihi uygunluk kontrollerini uygulamali."
          ),
        ]}
      />
    );
  }

  // Deep-link: show focused disposal transaction
  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm text-slate-600">{l("Loading...", "Yukleniyor...")}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 shadow-sm">
        <p className="text-sm text-rose-700">{error}</p>
      </div>
    );
  }

  // Find the focused transaction
  const focusedTx = transactions.find(
    (tx) => parsePositiveInt(tx.id) === queryTransactionId
  );

  return (
    <div className="space-y-4">
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
              <dd className="mt-0.5 text-sm text-slate-900">{focusedTx.transactionType || focusedTx.transaction_type || "-"}</dd>
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

      {/* All disposal-type transactions for context */}
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
                  return (
                    <tr
                      key={tx.id}
                      className={`border-b border-slate-100 ${isFocused ? "bg-cyan-50 ring-1 ring-cyan-300" : "hover:bg-slate-50"}`}
                    >
                      <td className="px-2 py-1.5 font-mono text-xs">{tx.id}</td>
                      <td className="px-2 py-1.5">{tx.transactionType || tx.transaction_type || "-"}</td>
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
