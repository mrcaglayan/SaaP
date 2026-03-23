import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth.js";
import { useI18n } from "../../i18n/useI18n.js";
import { useWorkingContext } from "../../context/useWorkingContext.js";
import {
  listFixedAssets,
  getFixedAsset,
  listCariEligibleApLines,
  createFixedAssetFromCariDocumentLine,
  listFixedAssetCategories,
} from "../../api/fixedAssets.js";
import { listOperatingUnits } from "../../api/orgAdmin.js";

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

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

const ACQUISITION_STATUSES = ["DRAFT", "ACTIVE"];

function buildCariDocumentPath(documentId) {
  const normalizedDocumentId = toPositiveInt(documentId);
  if (!normalizedDocumentId) {
    return "/app/alis-faturalari";
  }
  const params = new URLSearchParams();
  params.set("documentId", String(normalizedDocumentId));
  return `/app/alis-faturalari?${params.toString()}`;
}

export default function FixedAssetAcquisitionsPage() {
  const { l, t } = useI18n();
  const { hasPermission } = useAuth();
  const { legalEntity } = useWorkingContext();
  const navigate = useNavigate();
  const canRead = hasPermission("fixed_assets.read");
  const canPost = hasPermission("fixed_assets.post");

  const legalEntityId = legalEntity?.id || "";

  // ── Acquisitions list state ──────────────────────────────────────
  const [rows, setRows] = useState([]);
  const [assetCariMetaById, setAssetCariMetaById] = useState(new Map());
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  // ── CARI capitalization state ────────────────────────────────────
  const [capOpen, setCapOpen] = useState(false);
  const [docIdInput, setDocIdInput] = useState("");
  const [eligibleLines, setEligibleLines] = useState([]);
  const [searchingLines, setSearchingLines] = useState(false);
  const [lineSearchError, setLineSearchError] = useState("");
  const [selectedLine, setSelectedLine] = useState(null);

  const [capForm, setCapForm] = useState({
    unitCount: "1",
    categoryId: "",
    ownerOperatingUnitId: "",
    locationOperatingUnitId: "",
    capitalizationDate: "",
    inServiceDate: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitSuccess, setSubmitSuccess] = useState("");

  // ── Lookup data for capitalize form ──────────────────────────────
  const [catOptions, setCatOptions] = useState([]);
  const [ouOptions, setOuOptions] = useState([]);

  // ── Load acquisitions list ───────────────────────────────────────
  useEffect(() => {
    if (!canRead) {
      setRows([]);
      setAssetCariMetaById(new Map());
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

  useEffect(() => {
    if (!canRead || rows.length === 0) {
      setAssetCariMetaById(new Map());
      return;
    }
    let active = true;
    (async () => {
      const detailResults = await Promise.allSettled(
        rows.map((row) => getFixedAsset(row.id))
      );
      if (!active) {
        return;
      }
      const nextMetaById = new Map();
      detailResults.forEach((result, index) => {
        const row = rows[index];
        if (!row?.id) {
          return;
        }
        if (result.status === "fulfilled") {
          nextMetaById.set(row.id, {
            sourceCariDocumentId: toPositiveInt(result.value?.sourceCariDocumentId),
            sourceCariDocumentLineId: toPositiveInt(result.value?.sourceCariDocumentLineId),
            sourceCariDocumentLineUnitNo: toPositiveInt(result.value?.sourceCariDocumentLineUnitNo),
            hasCariCapitalization: Boolean(result.value?.hasCariCapitalization),
          });
          return;
        }
        nextMetaById.set(row.id, {
          sourceCariDocumentId: toPositiveInt(row.sourceCariDocumentId),
          sourceCariDocumentLineId: toPositiveInt(row.sourceCariDocumentLineId),
          sourceCariDocumentLineUnitNo: toPositiveInt(row.sourceCariDocumentLineUnitNo),
          hasCariCapitalization: false,
        });
      });
      setAssetCariMetaById(nextMetaById);
    })();
    return () => {
      active = false;
    };
  }, [canRead, rows]);

  // ── Load category + OU lookups when capitalize section opens ─────
  useEffect(() => {
    if (!capOpen || !canPost) return;
    let active = true;
    (async () => {
      try {
        const res = await listFixedAssetCategories({
          legalEntityId: legalEntityId || undefined,
          status: "ACTIVE",
        });
        const items = Array.isArray(res?.rows) ? res.rows : [];
        if (active) setCatOptions(items);
      } catch {
        if (active) setCatOptions([]);
      }
    })();
    return () => { active = false; };
  }, [capOpen, canPost, legalEntityId]);

  useEffect(() => {
    if (!capOpen || !canPost) return;
    let active = true;
    (async () => {
      try {
        const res = await listOperatingUnits({ legalEntityId: legalEntityId || undefined });
        const items = Array.isArray(res?.rows) ? res.rows : [];
        if (active) setOuOptions(items);
      } catch {
        if (active) setOuOptions([]);
      }
    })();
    return () => { active = false; };
  }, [capOpen, canPost, legalEntityId]);

  // ── Search eligible AP lines ─────────────────────────────────────
  async function handleSearchLines() {
    const docId = toPositiveInt(docIdInput);
    if (!docId) {
      setLineSearchError(t("fixedAssets.acquisitions.documentIdRequired"));
      return;
    }
    setSearchingLines(true);
    setLineSearchError("");
    setEligibleLines([]);
    setSelectedLine(null);
    try {
      const res = await listCariEligibleApLines({ sourceCariDocumentId: docId });
      const items = (Array.isArray(res?.rows) ? res.rows : Array.isArray(res) ? res : [])
        .filter((line) => line.eligibleForFa06 !== false);
      setEligibleLines(items);
      if (items.length === 0) {
        setLineSearchError(t("fixedAssets.acquisitions.noEligibleLines"));
      }
    } catch (err) {
      setLineSearchError(normalizeApiError(err, t("fixedAssets.acquisitions.submitFailed")));
    } finally {
      setSearchingLines(false);
    }
  }

  // ── Submit capitalization ────────────────────────────────────────
  async function handleCapitalize() {
    if (!selectedLine) {
      setSubmitError(t("fixedAssets.acquisitions.lineRequired"));
      return;
    }
    const payload = {
      sourceCariDocumentId: toPositiveInt(docIdInput),
      sourceCariDocumentLineId: toPositiveInt(selectedLine.lineId),
      unitCount: toPositiveInt(capForm.unitCount) || 1,
      categoryId: toPositiveInt(capForm.categoryId),
      ownerOperatingUnitId: toPositiveInt(capForm.ownerOperatingUnitId),
      locationOperatingUnitId: toPositiveInt(capForm.locationOperatingUnitId),
      capitalizationDate: capForm.capitalizationDate || undefined,
      inServiceDate: capForm.inServiceDate || undefined,
    };
    if (!payload.categoryId || !payload.ownerOperatingUnitId || !payload.locationOperatingUnitId) {
      setSubmitError(l("All fields are required.", "Tum alanlar zorunludur."));
      return;
    }
    if (!payload.capitalizationDate || !payload.inServiceDate) {
      setSubmitError(l("All fields are required.", "Tum alanlar zorunludur."));
      return;
    }
    setSubmitting(true);
    setSubmitError("");
    setSubmitSuccess("");
    try {
      const result = await createFixedAssetFromCariDocumentLine(payload);
      setSubmitSuccess(t("fixedAssets.acquisitions.submitSuccess"));
      // Navigate to the new asset's detail page
      const newId = result?.asset?.id || result?.id;
      if (newId) {
        navigate(`/app/demirbas-karti-detayi/${newId}`);
      }
    } catch (err) {
      setSubmitError(normalizeApiError(err, t("fixedAssets.acquisitions.submitFailed")));
    } finally {
      setSubmitting(false);
    }
  }

  function updateCapForm(field, value) {
    setCapForm((prev) => ({ ...prev, [field]: value }));
  }

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

      <section className="rounded-xl border border-cyan-200 bg-cyan-50 p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-cyan-900">
          {t("fixedAssets.acquisitions.preferredFlowTitle")}
        </p>
        <p className="mt-2 text-sm text-cyan-950">
          {t("fixedAssets.acquisitions.preferredFlowNote")}
        </p>
        <p className="mt-2 text-sm text-cyan-900">
          {t("fixedAssets.acquisitions.expandGuidanceNote")}
        </p>
      </section>

      {/* CARI Capitalization Section — permission-gated */}
      {canPost ? (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <button
            type="button"
            className="flex w-full items-center justify-between text-left"
            onClick={() => setCapOpen((v) => !v)}
          >
            <h2 className="text-lg font-semibold text-slate-900">
              {t("fixedAssets.acquisitions.capitalizeFromAp")}
            </h2>
            <span className="text-sm text-slate-400">{capOpen ? "\u25B2" : "\u25BC"}</span>
          </button>
          {capOpen ? (
            <div className="mt-4 space-y-5">
              <p className="text-sm text-slate-600">
                {t("fixedAssets.acquisitions.capitalizeDescription")}
              </p>
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-900">
                  {t("fixedAssets.acquisitions.fallbackTitle")}
                </p>
                <p className="mt-2 text-sm text-amber-900">
                  {t("fixedAssets.acquisitions.fallbackDescription")}
                </p>
              </div>

              {/* Step 1: Enter document ID and search */}
              <div className="flex items-end gap-3">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  {t("fixedAssets.acquisitions.documentId")}
                  <input
                    type="number"
                    min="1"
                    className="mt-1 block w-48 rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                    value={docIdInput}
                    onChange={(e) => setDocIdInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleSearchLines(); }}
                  />
                </label>
                <button
                  type="button"
                  className="rounded-md bg-cyan-700 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-800 disabled:opacity-50"
                  onClick={handleSearchLines}
                  disabled={searchingLines}
                >
                  {searchingLines
                    ? t("fixedAssets.acquisitions.searching")
                    : t("fixedAssets.acquisitions.searchLines")}
                </button>
              </div>
              {lineSearchError ? <p className="text-sm text-rose-700">{lineSearchError}</p> : null}

              {/* Step 2: Eligible lines table */}
              {eligibleLines.length > 0 && !selectedLine ? (
                <div>
                  <h3 className="text-sm font-semibold text-slate-700">
                    {t("fixedAssets.acquisitions.eligibleLines")}
                    <span className="ml-2 font-normal text-slate-500">({eligibleLines.length})</span>
                  </h3>
                  <div className="mt-2 overflow-auto rounded-lg border border-slate-200">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-50 text-left text-slate-600">
                        <tr>
                          <th className="px-3 py-2">#</th>
                          <th className="px-3 py-2">{t("fixedAssets.acquisitions.lineDescription")}</th>
                          <th className="px-3 py-2 text-right">{t("fixedAssets.acquisitions.lineAmount")}</th>
                          <th className="px-3 py-2">{l("Qty", "Adet")}</th>
                          <th className="px-3 py-2">{t("fixedAssets.acquisitions.lineAccount")}</th>
                          <th className="px-3 py-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {eligibleLines.map((line, idx) => (
                          <tr key={line.lineId || idx} className="border-t border-slate-100 hover:bg-slate-50">
                            <td className="px-3 py-2 text-slate-500">{idx + 1}</td>
                            <td className="px-3 py-2 max-w-[250px] truncate">
                              {line.description || "-"}
                            </td>
                            <td className="px-3 py-2 text-right font-mono">
                              {formatNumber(line.lineNetAmountBase ?? line.lineNetAmountTxn)}
                            </td>
                            <td className="px-3 py-2">{line.quantity || "-"}</td>
                            <td className="px-3 py-2">{line.postingAccountId || "-"}</td>
                            <td className="px-3 py-2">
                              <button
                                type="button"
                                className="rounded bg-cyan-50 px-3 py-1 text-xs font-medium text-cyan-700 hover:bg-cyan-100"
                                onClick={() => setSelectedLine(line)}
                              >
                                {t("fixedAssets.acquisitions.selectLine")}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}

              {/* Step 3: Selected line + asset details form */}
              {selectedLine ? (
                <div className="space-y-4">
                  {/* Selected line summary */}
                  <div className="flex items-center justify-between rounded-lg border border-cyan-200 bg-cyan-50 px-4 py-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-cyan-800">
                        {t("fixedAssets.acquisitions.selectedLine")}
                      </p>
                      <p className="mt-1 text-sm text-slate-700">
                        {selectedLine.description || "-"}
                        {" — "}
                        <span className="font-mono">{formatNumber(selectedLine.lineNetAmountBase ?? selectedLine.lineNetAmountTxn)}</span>
                        {" "}
                        ({l("Qty", "Adet")}: {selectedLine.quantity || "-"})
                      </p>
                    </div>
                    <button
                      type="button"
                      className="text-xs text-cyan-700 underline hover:text-cyan-900"
                      onClick={() => { setSelectedLine(null); setSubmitError(""); setSubmitSuccess(""); }}
                    >
                      {t("fixedAssets.acquisitions.clearSelection")}
                    </button>
                  </div>

                  {/* Asset details form */}
                  <h3 className="text-sm font-semibold text-slate-700">
                    {t("fixedAssets.acquisitions.assetDetails")}
                  </h3>
                  <div className="grid gap-3 md:grid-cols-3">
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {t("fixedAssets.acquisitions.fieldUnitCount")}
                      <input
                        type="number"
                        min="1"
                        className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                        value={capForm.unitCount}
                        onChange={(e) => updateCapForm("unitCount", e.target.value)}
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {t("fixedAssets.acquisitions.fieldCategory")}
                      <select
                        className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                        value={capForm.categoryId}
                        onChange={(e) => updateCapForm("categoryId", e.target.value)}
                      >
                        <option value="">{l("Select...", "Secin...")}</option>
                        {catOptions.map((cat) => (
                          <option key={cat.id} value={cat.id}>
                            {cat.code ? `${cat.code} - ${cat.name}` : cat.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {t("fixedAssets.acquisitions.fieldOwnerOu")}
                      <select
                        className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                        value={capForm.ownerOperatingUnitId}
                        onChange={(e) => updateCapForm("ownerOperatingUnitId", e.target.value)}
                      >
                        <option value="">{l("Select...", "Secin...")}</option>
                        {ouOptions.map((ou) => (
                          <option key={ou.id} value={ou.id}>
                            {ou.code ? `${ou.code} - ${ou.name}` : ou.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {t("fixedAssets.acquisitions.fieldLocationOu")}
                      <select
                        className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                        value={capForm.locationOperatingUnitId}
                        onChange={(e) => updateCapForm("locationOperatingUnitId", e.target.value)}
                      >
                        <option value="">{l("Select...", "Secin...")}</option>
                        {ouOptions.map((ou) => (
                          <option key={ou.id} value={ou.id}>
                            {ou.code ? `${ou.code} - ${ou.name}` : ou.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {t("fixedAssets.acquisitions.fieldCapitalizationDate")}
                      <input
                        type="date"
                        className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                        value={capForm.capitalizationDate}
                        onChange={(e) => updateCapForm("capitalizationDate", e.target.value)}
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {t("fixedAssets.acquisitions.fieldInServiceDate")}
                      <input
                        type="date"
                        className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                        value={capForm.inServiceDate}
                        onChange={(e) => updateCapForm("inServiceDate", e.target.value)}
                      />
                    </label>
                  </div>

                  {submitError ? <p className="text-sm text-rose-700">{submitError}</p> : null}
                  {submitSuccess ? <p className="text-sm text-emerald-700">{submitSuccess}</p> : null}

                  <button
                    type="button"
                    className="rounded-md bg-cyan-700 px-5 py-2 text-sm font-medium text-white hover:bg-cyan-800 disabled:opacity-50"
                    onClick={handleCapitalize}
                    disabled={submitting}
                  >
                    {submitting
                      ? t("fixedAssets.acquisitions.submitting")
                      : t("fixedAssets.acquisitions.submit")}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

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
                      {(() => {
                        const assetCariMeta = assetCariMetaById.get(row.id) || null;
                        const sourceCariDocumentId =
                          toPositiveInt(assetCariMeta?.sourceCariDocumentId) ||
                          toPositiveInt(row.sourceCariDocumentId);
                        const sourceCariDocumentLineId =
                          toPositiveInt(assetCariMeta?.sourceCariDocumentLineId) ||
                          toPositiveInt(row.sourceCariDocumentLineId);
                        const sourceCariDocumentLineUnitNo =
                          toPositiveInt(assetCariMeta?.sourceCariDocumentLineUnitNo) ||
                          toPositiveInt(row.sourceCariDocumentLineUnitNo);
                        const hasCariCapitalization =
                          Boolean(assetCariMeta?.hasCariCapitalization) ||
                          Boolean(sourceCariDocumentId);

                        if (sourceCariDocumentId) {
                          return (
                            <div className="space-y-1">
                              <span className="inline-flex rounded-full bg-cyan-100 px-2 py-0.5 font-semibold text-cyan-800">
                                {t("fixedAssets.acquisitions.linkedFromCari")}
                              </span>
                              <div>
                                <Link
                                  to={buildCariDocumentPath(sourceCariDocumentId)}
                                  className="font-medium text-cyan-700 hover:underline"
                                >
                                  {l(
                                    `Source document #${sourceCariDocumentId}`,
                                    `Kaynak belge #${sourceCariDocumentId}`
                                  )}
                                </Link>
                              </div>
                              {sourceCariDocumentLineId || sourceCariDocumentLineUnitNo ? (
                                <p className="text-slate-500">
                                  {[
                                    sourceCariDocumentLineId
                                      ? l(
                                          `Line ${sourceCariDocumentLineId}`,
                                          `Satir ${sourceCariDocumentLineId}`
                                        )
                                      : null,
                                    sourceCariDocumentLineUnitNo
                                      ? l(
                                          `Unit ${sourceCariDocumentLineUnitNo}`,
                                          `Birim ${sourceCariDocumentLineUnitNo}`
                                        )
                                      : null,
                                  ]
                                    .filter(Boolean)
                                    .join(" | ")}
                                </p>
                              ) : null}
                            </div>
                          );
                        }

                        if (hasCariCapitalization) {
                          return (
                            <span className="inline-flex rounded-full bg-cyan-100 px-2 py-0.5 font-semibold text-cyan-800">
                              {t("fixedAssets.acquisitions.cariCapitalization")}
                            </span>
                          );
                        }

                        return l("Manual", "Manuel");
                      })()}
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
