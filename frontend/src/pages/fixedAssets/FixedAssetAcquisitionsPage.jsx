import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/useAuth.js";
import { useI18n } from "../../i18n/useI18n.js";
import { useWorkingContext } from "../../context/useWorkingContext.js";
import { listFixedAssets } from "../../api/fixedAssets.js";

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

const ACQUISITION_STATUSES = ["DRAFT", "ACTIVE"];

export default function FixedAssetAcquisitionsPage() {
  const { l } = useI18n();
  const { hasPermission } = useAuth();
  const { legalEntity } = useWorkingContext();
  const canRead = hasPermission("fixed_assets.read");

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  const legalEntityId = legalEntity?.id || "";

  useEffect(() => {
    if (!canRead) {
      setRows([]);
      setListError(l("Missing permission: fixed_assets.read", "Eksik yetki: fixed_assets.read"));
      return;
    }
    let active = true;
    (async () => {
      setLoading(true);
      setListError("");
      try {
        const res = await listFixedAssets({
          legalEntityId: legalEntityId || undefined,
          status: filterStatus || undefined,
        });
        // Filter to show only assets that were acquired or capitalized
        // (DRAFT and ACTIVE statuses are relevant for the acquisitions queue)
        const items = Array.isArray(res?.rows) ? res.rows : [];
        if (active) setRows(items);
      } catch (err) {
        if (active) {
          setRows([]);
          setListError(normalizeApiError(err, l("Failed to load acquisitions.", "Alim islemleri yuklenemedi.")));
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [canRead, legalEntityId, filterStatus, l]);

  if (!canRead) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm text-slate-600">
          {l("Missing permission: fixed_assets.read", "Eksik yetki: fixed_assets.read")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">
          {l("Fixed Asset Acquisitions", "Demirbas Alim Islemleri")}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {l(
            "Filtered view of acquisition and capitalization transactions. Draft assets pending activation and recently activated assets are shown here.",
            "Alim ve kapitalizasyon islemlerinin filtrelenmis gorunumu. Aktiflestirme bekleyen taslak varliklar ve yakin zamanda aktiflestirilen varliklar burada gosterilir."
          )}
        </p>
      </section>

      {/* Filters */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">{l("Filters", "Filtreler")}</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Status", "Durum")}
            <select
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option value="">{l("All", "Tumu")}</option>
              {ACQUISITION_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
        </div>
        {listError ? <p className="mt-3 text-sm text-rose-700">{listError}</p> : null}
      </section>

      {/* Results */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">
            {l("Assets", "Demirbaslar")}
            {!loading ? <span className="ml-2 text-sm font-normal text-slate-500">({rows.length})</span> : null}
          </h2>
        </div>
        {loading ? <p className="mt-3 text-sm text-slate-600">{l("Loading...", "Yukleniyor...")}</p> : null}
        {!loading && rows.length === 0 && !listError ? (
          <p className="mt-3 text-sm text-slate-600">
            {l("No acquisition or capitalization transactions found.", "Alim veya kapitalizasyon islemi bulunamadi.")}
          </p>
        ) : null}
        {!loading && rows.length > 0 ? (
          <div className="mt-3 overflow-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2">{l("Asset No", "Demirbas No")}</th>
                  <th className="px-3 py-2">{l("Name", "Ad")}</th>
                  <th className="px-3 py-2">{l("Category", "Kategori")}</th>
                  <th className="px-3 py-2">{l("Status", "Durum")}</th>
                  <th className="px-3 py-2">{l("Acquisition", "Alim Tarihi")}</th>
                  <th className="px-3 py-2">{l("In Service", "Hizmet Tarihi")}</th>
                  <th className="px-3 py-2 text-right">{l("Original Cost", "Orijinal Maliyet")}</th>
                  <th className="px-3 py-2">{l("Currency", "Para Birimi")}</th>
                  <th className="px-3 py-2">{l("Source", "Kaynak")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
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
                    <td className="px-3 py-2">{row.categoryCode || "-"}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                        row.status === "ACTIVE" ? "bg-emerald-100 text-emerald-800" :
                        row.status === "DRAFT" ? "bg-slate-100 text-slate-700" :
                        "bg-slate-100 text-slate-700"
                      }`}>
                        {row.status || "-"}
                      </span>
                    </td>
                    <td className="px-3 py-2">{formatDate(row.acquisitionDate)}</td>
                    <td className="px-3 py-2">{formatDate(row.inServiceDate)}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatNumber(row.originalCostBase)}</td>
                    <td className="px-3 py-2">{row.currencyCode || "-"}</td>
                    <td className="px-3 py-2 text-xs">
                      {row.sourceCariDocumentId
                        ? l("CARI", "CARI")
                        : l("Manual", "Manuel")}
                    </td>
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
