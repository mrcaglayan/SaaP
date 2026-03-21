import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Combobox from "../../components/Combobox.jsx";
import { useAuth } from "../../auth/useAuth.js";
import { useI18n } from "../../i18n/useI18n.js";
import { useWorkingContext } from "../../context/useWorkingContext.js";
import { listFixedAssets, listFixedAssetCategories } from "../../api/fixedAssets.js";
import { listLegalEntities, listOperatingUnits } from "../../api/orgAdmin.js";

const ASSET_STATUS_VALUES = [
  "DRAFT",
  "ACTIVE",
  "SUSPENDED",
  "FULLY_DEPRECIATED",
  "DISPOSED",
];

function normalizeText(value) {
  return String(value || "").trim();
}

function toPositiveInt(value) {
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

function mapComboOption(row) {
  const value = String(toPositiveInt(row?.id) || "").trim();
  if (!value) return null;
  const code = normalizeText(row?.code);
  const name = normalizeText(row?.name);
  return {
    value,
    label: code && name ? `${code} - ${name}` : code || name || `#${value}`,
  };
}

function mapLegalEntityOption(row) {
  const opt = mapComboOption(row);
  if (!opt) return null;
  opt.description = normalizeText(
    row?.functional_currency_code || row?.functionalCurrencyCode
  );
  return opt;
}

function formatDate(value) {
  if (!value) return "-";
  const s = String(value).slice(0, 10);
  return s || "-";
}

function formatNumber(value) {
  if (value == null) return "-";
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function FixedAssetsPage() {
  const { l } = useI18n();
  const { hasPermission } = useAuth();
  const canRead = hasPermission("fixed_assets.read");
  const canUpsert = hasPermission("fixed_assets.upsert");
  const { legalEntity } = useWorkingContext();

  // ── Filters ───────────────────────────────────────────────────
  const [filterLeId, setFilterLeId] = useState("");
  const [filterOwnerOuId, setFilterOwnerOuId] = useState("");
  const [filterLocationOuId, setFilterLocationOuId] = useState("");
  const [filterCategoryId, setFilterCategoryId] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterAcqFrom, setFilterAcqFrom] = useState("");
  const [filterAcqTo, setFilterAcqTo] = useState("");
  const [filterInServiceFrom, setFilterInServiceFrom] = useState("");
  const [filterInServiceTo, setFilterInServiceTo] = useState("");
  const [filterDepartmentCode, setFilterDepartmentCode] = useState("");
  const [filterCostCenterCode, setFilterCostCenterCode] = useState("");
  const [filterDisposed, setFilterDisposed] = useState("");

  // ── Data ──────────────────────────────────────────────────────
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState("");

  // ── Lookups ───────────────────────────────────────────────────
  const [leOptions, setLeOptions] = useState([]);
  const [leLookupLoading, setLeLookupLoading] = useState(false);
  const [ouOptions, setOuOptions] = useState([]);
  const [ouLookupLoading, setOuLookupLoading] = useState(false);
  const [catOptions, setCatOptions] = useState([]);
  const [catLookupLoading, setCatLookupLoading] = useState(false);

  // ── Sync working context LE ───────────────────────────────────
  useEffect(() => {
    const ctxLeId = toPositiveInt(legalEntity?.id);
    if (ctxLeId) setFilterLeId(String(ctxLeId));
  }, [legalEntity]);

  // ── Load legal entity lookup ──────────────────────────────────
  useEffect(() => {
    let active = true;
    (async () => {
      setLeLookupLoading(true);
      try {
        const res = await listLegalEntities();
        const items = Array.isArray(res?.rows) ? res.rows : [];
        if (active) setLeOptions(items.map(mapLegalEntityOption).filter(Boolean));
      } catch {
        if (active) setLeOptions([]);
      } finally {
        if (active) setLeLookupLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  // ── Load OU lookup ────────────────────────────────────────────
  useEffect(() => {
    let active = true;
    (async () => {
      setOuLookupLoading(true);
      try {
        const res = await listOperatingUnits({ legalEntityId: filterLeId || undefined });
        const items = Array.isArray(res?.rows) ? res.rows : [];
        if (active) setOuOptions(items.map(mapComboOption).filter(Boolean));
      } catch {
        if (active) setOuOptions([]);
      } finally {
        if (active) setOuLookupLoading(false);
      }
    })();
    return () => { active = false; };
  }, [filterLeId]);

  // ── Load category lookup ──────────────────────────────────────
  useEffect(() => {
    let active = true;
    (async () => {
      setCatLookupLoading(true);
      try {
        const res = await listFixedAssetCategories({
          legalEntityId: filterLeId || undefined,
          status: "ACTIVE",
        });
        const items = Array.isArray(res?.rows) ? res.rows : [];
        if (active) setCatOptions(items.map(mapComboOption).filter(Boolean));
      } catch {
        if (active) setCatOptions([]);
      } finally {
        if (active) setCatLookupLoading(false);
      }
    })();
    return () => { active = false; };
  }, [filterLeId]);

  // ── Load asset list ───────────────────────────────────────────
  useEffect(() => {
    if (!canRead) { setRows([]); return; }
    let active = true;
    (async () => {
      setLoading(true);
      setListError("");
      try {
        const res = await listFixedAssets({
          legalEntityId: filterLeId || undefined,
          ownerOperatingUnitId: filterOwnerOuId || undefined,
          locationOperatingUnitId: filterLocationOuId || undefined,
          categoryId: filterCategoryId || undefined,
          status: filterStatus || undefined,
          acquisitionDateFrom: filterAcqFrom || undefined,
          acquisitionDateTo: filterAcqTo || undefined,
          inServiceDateFrom: filterInServiceFrom || undefined,
          inServiceDateTo: filterInServiceTo || undefined,
          departmentCode: filterDepartmentCode || undefined,
          costCenterCode: filterCostCenterCode || undefined,
          disposed: filterDisposed !== "" ? filterDisposed : undefined,
        });
        if (active) setRows(Array.isArray(res?.rows) ? res.rows : []);
      } catch (err) {
        if (active) {
          setRows([]);
          setListError(normalizeApiError(err, l("Failed to load assets.", "Demirbaslar yuklenemedi.")));
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [
    canRead, filterLeId, filterOwnerOuId, filterLocationOuId,
    filterCategoryId, filterStatus,
    filterAcqFrom, filterAcqTo, filterInServiceFrom, filterInServiceTo,
    filterDepartmentCode, filterCostCenterCode, filterDisposed, l,
  ]);

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">
              {l("Fixed Asset Register", "Demirbas Karti Listesi")}
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              {l(
                "Browse and filter the fixed-asset register. Click an asset to view its detail hub.",
                "Demirbas kayit defterini goruntuleyin ve filtreleyin. Detay icin bir demirbasa tiklayin."
              )}
            </p>
          </div>
          {canUpsert ? (
            <Link
              to="/app/demirbas-karti-olustur"
              className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-cyan-700"
            >
              {l("Create New Asset", "Yeni Demirbas Olustur")}
            </Link>
          ) : null}
        </div>
        {!canUpsert ? (
          <p className="mt-2 text-xs text-amber-700">
            {l(
              "Read-only access — you do not have edit permissions.",
              "Salt okunur erisim — duzenleme yetkiniz yok."
            )}
          </p>
        ) : null}
      </section>

      {/* Filters */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">{l("Filters", "Filtreler")}</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          {/* Legal Entity */}
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            <label className="block">
              {l("Legal Entity", "Tuzel Kisilik")}
              <Combobox className="mt-1" value={filterLeId} options={leOptions} loading={leLookupLoading}
                placeholder={l("All", "Tumu")} noOptionsText={l("None", "Yok")}
                onChange={(v) => setFilterLeId(v ? String(v) : "")} />
            </label>
          </div>

          {/* Owner OU */}
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            <label className="block">
              {l("Owner OU", "Sahibi OU")}
              <Combobox className="mt-1" value={filterOwnerOuId} options={ouOptions} loading={ouLookupLoading}
                placeholder={l("All", "Tumu")} noOptionsText={l("None", "Yok")}
                onChange={(v) => setFilterOwnerOuId(v ? String(v) : "")} />
            </label>
          </div>

          {/* Location OU */}
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            <label className="block">
              {l("Location OU", "Lokasyon OU")}
              <Combobox className="mt-1" value={filterLocationOuId} options={ouOptions} loading={ouLookupLoading}
                placeholder={l("All", "Tumu")} noOptionsText={l("None", "Yok")}
                onChange={(v) => setFilterLocationOuId(v ? String(v) : "")} />
            </label>
          </div>

          {/* Category */}
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            <label className="block">
              {l("Category", "Kategori")}
              <Combobox className="mt-1" value={filterCategoryId} options={catOptions} loading={catLookupLoading}
                placeholder={l("All", "Tumu")} noOptionsText={l("None", "Yok")}
                onChange={(v) => setFilterCategoryId(v ? String(v) : "")} />
            </label>
          </div>

          {/* Status */}
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Status", "Durum")}
            <select className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="">{l("All", "Tumu")}</option>
              {ASSET_STATUS_VALUES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>

          {/* Disposed */}
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Disposed", "Elden Cikarilmis")}
            <select className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={filterDisposed} onChange={(e) => setFilterDisposed(e.target.value)}>
              <option value="">{l("All", "Tumu")}</option>
              <option value="true">{l("Only disposed", "Yalniz elden cikarilmis")}</option>
              <option value="false">{l("Exclude disposed", "Elden cikarilmislari haric tut")}</option>
            </select>
          </label>

          {/* Department Code */}
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Department Code", "Departman Kodu")}
            <input type="text" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={filterDepartmentCode} onChange={(e) => setFilterDepartmentCode(e.target.value)}
              placeholder={l("All", "Tumu")} />
          </label>

          {/* Cost Center Code */}
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Cost Center Code", "Masraf Merkezi Kodu")}
            <input type="text" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={filterCostCenterCode} onChange={(e) => setFilterCostCenterCode(e.target.value)}
              placeholder={l("All", "Tumu")} />
          </label>

          {/* Acquisition Date From */}
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Acquisition From", "Alim Tarihi Baslangic")}
            <input type="date" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={filterAcqFrom} onChange={(e) => setFilterAcqFrom(e.target.value)} />
          </label>

          {/* Acquisition Date To */}
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Acquisition To", "Alim Tarihi Bitis")}
            <input type="date" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={filterAcqTo} onChange={(e) => setFilterAcqTo(e.target.value)} />
          </label>

          {/* In Service Date From */}
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("In Service From", "Hizmete Giris Baslangic")}
            <input type="date" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={filterInServiceFrom} onChange={(e) => setFilterInServiceFrom(e.target.value)} />
          </label>

          {/* In Service Date To */}
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("In Service To", "Hizmete Giris Bitis")}
            <input type="date" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={filterInServiceTo} onChange={(e) => setFilterInServiceTo(e.target.value)} />
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
          <p className="mt-3 text-sm text-slate-600">{l("No assets found.", "Demirbas bulunamadi.")}</p>
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
                  <th className="px-3 py-2">{l("Owner OU", "Sahibi OU")}</th>
                  <th className="px-3 py-2">{l("Location OU", "Lokasyon OU")}</th>
                  <th className="px-3 py-2">{l("Custodian", "Zimmetli")}</th>
                  <th className="px-3 py-2">{l("Acquisition", "Alim Tarihi")}</th>
                  <th className="px-3 py-2">{l("In Service", "Hizmet Tarihi")}</th>
                  <th className="px-3 py-2 text-right">{l("Original Cost", "Orijinal Maliyet")}</th>
                  <th className="px-3 py-2">{l("Currency", "Para Birimi")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2">
                      <Link to={`/app/demirbas-karti-detayi/${row.id}`}
                        className="font-medium text-cyan-700 hover:underline">
                        {row.assetNo || "-"}
                      </Link>
                    </td>
                    <td className="px-3 py-2 max-w-[200px] truncate">{row.name || "-"}</td>
                    <td className="px-3 py-2">{row.categoryCode || "-"}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                        row.status === "ACTIVE" ? "bg-emerald-100 text-emerald-800" :
                        row.status === "DISPOSED" ? "bg-rose-100 text-rose-800" :
                        row.status === "SUSPENDED" ? "bg-amber-100 text-amber-800" :
                        row.status === "FULLY_DEPRECIATED" ? "bg-blue-100 text-blue-800" :
                        "bg-slate-100 text-slate-700"
                      }`}>
                        {row.status || "-"}
                      </span>
                    </td>
                    <td className="px-3 py-2">{row.ownerOperatingUnitId || "-"}</td>
                    <td className="px-3 py-2">{row.locationOperatingUnitId || "-"}</td>
                    <td className="px-3 py-2">{row.custodianDisplayName || "-"}</td>
                    <td className="px-3 py-2">{formatDate(row.acquisitionDate)}</td>
                    <td className="px-3 py-2">{formatDate(row.inServiceDate)}</td>
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
