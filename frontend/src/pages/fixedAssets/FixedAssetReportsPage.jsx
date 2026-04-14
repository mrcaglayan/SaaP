import { useState } from "react";
import { useAuth } from "../../auth/useAuth.js";
import { useI18n } from "../../i18n/useI18n.js";
import { useWorkingContext } from "../../context/useWorkingContext.js";
import {
  getFixedAssetReport,
  exportFixedAssetReport,
} from "../../api/fixedAssets.js";
import { formatFixedAssetTransactionDisplayLabel } from "./fixedAssetTransactionDisplay.js";

const REPORT_LIST = [
  { key: "register", i18nKey: "register" },
  { key: "depreciation-schedule", i18nKey: "depreciationSchedule" },
  { key: "additions", i18nKey: "additions" },
  { key: "disposals", i18nKey: "disposals" },
  { key: "transfers", i18nKey: "transfers" },
  { key: "by-owner-ou", i18nKey: "byOwnerOu" },
  { key: "by-location-ou", i18nKey: "byLocationOu" },
  { key: "by-custodian", i18nKey: "byCustodian" },
  { key: "depreciation-by-owner-ou", i18nKey: "depreciationByOwnerOu" },
  { key: "rollforward", i18nKey: "rollforward" },
];

const DATE_RANGE_REPORTS = new Set([
  "additions",
  "disposals",
  "transfers",
  "rollforward",
  "depreciation-by-owner-ou",
]);

const REGISTER_STYLE_REPORTS = new Set([
  "register",
  "by-owner-ou",
  "by-location-ou",
  "by-custodian",
]);

const DEPRECIATION_BY_OWNER_OU_REPORT = "depreciation-by-owner-ou";
const BY_OWNER_OU_REPORT = "by-owner-ou";

const COLUMN_CONFIGS = {
  register: [
    { key: "assetNo", label: "Asset No" },
    { key: "name", label: "Name" },
    { key: "status", label: "Status" },
    { key: "categoryCode", label: "Category" },
    { key: "ownerOuCode", label: "Owner OU" },
    { key: "locationOuCode", label: "Location OU" },
    { key: "acquisitionDate", label: "Acquisition Date" },
    { key: "currencyCode", label: "Currency" },
    { key: "originalCostBase", label: "Cost (Base)", numeric: true },
    { key: "depreciationMethod", label: "Method" },
  ],
  "depreciation-schedule": [
    { key: "assetNo", label: "Asset No" },
    { key: "assetName", label: "Name" },
    { key: "periodKey", label: "Period" },
    { key: "plannedAmountBase", label: "Planned (Base)", numeric: true },
    { key: "openingNbvBase", label: "Opening NBV", numeric: true },
    { key: "closingNbvBase", label: "Closing NBV", numeric: true },
    { key: "scheduleStatus", label: "Status" },
  ],
  additions: [
    { key: "assetNo", label: "Asset No" },
    { key: "assetName", label: "Name" },
    { key: "transactionType", label: "Type" },
    { key: "categoryCode", label: "Category" },
    { key: "ownerOuCode", label: "Owner OU" },
    { key: "effectiveDate", label: "Effective Date" },
    { key: "grossAmountBase", label: "Amount (Base)", numeric: true },
    { key: "depreciationKind", label: "Depr. Kind" },
    { key: "isBelowThreshold", label: "Below Threshold" },
    { key: "isLowValueFullExpense", label: "Low-Value FE" },
  ],
  disposals: [
    { key: "assetNo", label: "Asset No" },
    { key: "assetName", label: "Name" },
    { key: "transactionType", label: "Type" },
    { key: "categoryCode", label: "Category" },
    { key: "effectiveDate", label: "Effective Date" },
    { key: "grossAmountBase", label: "Gross (Base)", numeric: true },
    { key: "accumDeprAmountBase", label: "Accum Depr", numeric: true },
    { key: "nbvAmountBase", label: "NBV (Base)", numeric: true },
    { key: "proceedsAmountBase", label: "Proceeds", numeric: true },
  ],
  transfers: [
    { key: "assetNo", label: "Asset No" },
    { key: "assetName", label: "Name" },
    { key: "effectiveDate", label: "Effective Date" },
    { key: "fromOwnerOuCode", label: "From OU" },
    { key: "toOwnerOuCode", label: "To OU" },
    { key: "grossAmountBase", label: "Gross (Base)", numeric: true },
    { key: "nbvAmountBase", label: "NBV (Base)", numeric: true },
  ],
  "by-owner-ou": [
    { key: "ownerOuCode", label: "OU Code" },
    { key: "ownerOuName", label: "OU Name" },
    { key: "assetCount", label: "Assets", numeric: true },
    { key: "totalOriginalCostBase", label: "Total Cost (Base)", numeric: true },
    { key: "totalSalvageValueBase", label: "Total Salvage (Base)", numeric: true },
  ],
  "by-location-ou": [
    { key: "locationOuCode", label: "OU Code" },
    { key: "locationOuName", label: "OU Name" },
    { key: "assetCount", label: "Assets", numeric: true },
    { key: "totalOriginalCostBase", label: "Total Cost (Base)", numeric: true },
  ],
  "by-custodian": [
    { key: "custodianCode", label: "Code" },
    { key: "custodianDisplayName", label: "Name" },
    { key: "assetCount", label: "Assets", numeric: true },
    { key: "totalOriginalCostBase", label: "Total Cost (Base)", numeric: true },
  ],
  "depreciation-by-owner-ou": [
    { key: "ownerOuCode", label: "OU Code" },
    { key: "ownerOuName", label: "OU Name" },
    { key: "assetCount", label: "Assets", numeric: true },
    { key: "totalDeprBase", label: "Depreciation (Base)", numeric: true },
    { key: "totalEligibleDays", label: "Eligible Days", numeric: true },
  ],
  rollforward: [
    { key: "transactionType", label: "Movement Type" },
    { key: "depreciationKind", label: "Depr. Kind" },
    { key: "totalGrossBase", label: "Gross (Base)", numeric: true },
    { key: "totalAccumDeprBase", label: "Accum Depr (Base)", numeric: true },
    { key: "totalNbvBase", label: "NBV (Base)", numeric: true },
    { key: "count", label: "Count", numeric: true },
  ],
};

function buildFilterParams(reportName, filters) {
  const params = {};
  if (filters.legalEntityId) params.legalEntityId = filters.legalEntityId;
  if (filters.ownerOperatingUnitId) {
    params.ownerOperatingUnitId = filters.ownerOperatingUnitId;
  }
  if (filters.dateFrom) params.dateFrom = filters.dateFrom;
  if (filters.dateTo) params.dateTo = filters.dateTo;
  if (filters.categoryId) params.categoryId = filters.categoryId;
  if (filters.status) params.status = filters.status;
  if (filters.periodKey) params.periodKey = filters.periodKey;
  if (
    reportName === DEPRECIATION_BY_OWNER_OU_REPORT
    && filters.reportBasis
  ) {
    params.reportBasis = filters.reportBasis;
  }
  return params;
}

function renderTotals(reportKey, totals, rf) {
  if (!totals) return null;
  const items = [];

  switch (reportKey) {
    case "register":
      items.push([rf("totalCount"), totals.count]);
      items.push([rf("totalCostBase"), fmt(totals.totalOriginalCostBase)]);
      break;
    case "depreciation-schedule":
      items.push([rf("totalCount"), totals.count]);
      items.push([rf("totalDeprBase"), fmt(totals.totalPlannedBase)]);
      break;
    case "additions":
      items.push([rf("totalCount"), totals.count]);
      items.push([rf("acquisitionCount"), totals.acquisitionCount]);
      items.push([rf("capitalizationCount"), totals.capitalizationCount]);
      items.push([rf("belowThreshold"), totals.belowThresholdCount]);
      items.push([rf("lowValueFullExpense"), totals.lowValueFullExpenseCount]);
      break;
    case "disposals":
      items.push([rf("totalCount"), totals.count]);
      items.push([rf("writeoffCount"), totals.writeoffCount]);
      items.push([rf("saleCount"), totals.saleCount]);
      break;
    case "transfers":
      items.push([rf("totalCount"), totals.count]);
      break;
    case "by-owner-ou":
    case "by-location-ou":
    case "by-custodian":
      items.push([rf("totalCount"), totals.totalAssets]);
      items.push([rf("totalCostBase"), fmt(totals.totalOriginalCostBase)]);
      break;
    case "depreciation-by-owner-ou":
      items.push([rf("totalCount"), totals.totalAssets]);
      items.push([rf("totalDeprBase"), fmt(totals.totalDeprBase)]);
      break;
    case "rollforward":
      items.push([rf("openingNbv"), fmt(totals.openingNbvBase)]);
      items.push([rf("closingNbv"), fmt(totals.closingNbvBase)]);
      items.push([rf("totalDeprBase"), fmt(totals.totalDepreciationBase)]);
      break;
    default:
      break;
  }

  if (items.length === 0) return null;

  return (
    <div className="mt-3 flex flex-wrap gap-4">
      {items.map(([label, value], idx) => (
        <div key={idx} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
          <span className="text-xs text-slate-500">{label}</span>
          <span className="ml-2 text-sm font-semibold text-slate-900">{value}</span>
        </div>
      ))}
    </div>
  );
}

function fmt(val) {
  const n = Number(val);
  if (!Number.isFinite(n)) return "0.00";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtCell(value, numeric) {
  if (value === null || value === undefined) return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (numeric) return fmt(value);
  return String(value);
}

function formatReportRowCell(row, col) {
  if (col.key === "transactionType") {
    return formatFixedAssetTransactionDisplayLabel(
      row.transactionType,
      row.sourceRefType || row.source_ref_type,
      row.displayLabel || row.display_label
    );
  }
  return fmtCell(row[col.key], col.numeric);
}

function resolveDepreciationReportBasisLabel(value, l) {
  if (value === "INCLUDE_RETRO_CORRECTIONS") {
    return l(
      "Include Retro Corrections",
      "Retro Duzeltmeleri Dahil Et"
    );
  }
  return l("As Posted", "Kaydedildigi Gibi");
}

function isUnresolvedOwnerRow(row) {
  return Boolean(row?.isUnresolved) || String(row?.ownerOuCode || "").trim().toUpperCase() === "UNRESOLVED";
}

/**
 * Render fixed-asset reports with the Track 43 owner-report basis controls and
 * unresolved-attribution warning state without exposing unsupported V1 modes.
 */
export default function FixedAssetReportsPage() {
  const { l, t } = useI18n();
  const { hasPermission } = useAuth();
  const { legalEntity, workingContext } = useWorkingContext();
  const canRead = hasPermission("fixed_assets.report.read");
  const ownerOperatingUnitId = Number.isInteger(Number(workingContext?.operatingUnitId))
    && Number(workingContext?.operatingUnitId) > 0
    ? Number(workingContext.operatingUnitId)
    : null;

  const rf = (key) => t(["fixedAssets", "reports", key]);

  const [selectedReport, setSelectedReport] = useState("");
  const [filters, setFilters] = useState({
    legalEntityId: "",
    dateFrom: "",
    dateTo: "",
    categoryId: "",
    status: "",
    periodKey: "",
    reportBasis: "AS_POSTED",
  });
  const [reportData, setReportData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");

  const effectiveLegalEntityId = filters.legalEntityId || legalEntity?.id || "";
  const showDateRange = DATE_RANGE_REPORTS.has(selectedReport);
  const showRegisterFilters = REGISTER_STYLE_REPORTS.has(selectedReport);
  const showPeriodKey = selectedReport === DEPRECIATION_BY_OWNER_OU_REPORT;
  const showDepreciationReportBasis = selectedReport === DEPRECIATION_BY_OWNER_OU_REPORT;
  const columns = COLUMN_CONFIGS[selectedReport] || [];
  const rows = reportData?.rows || [];
  const totals = reportData?.totals || null;
  const effectiveReportBasis = reportData?.reportBasis || filters.reportBasis || "AS_POSTED";
  const hasUnresolvedRows = Boolean(reportData?.hasUnresolvedRows);

  const setFilter = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  async function handleRun() {
    if (!selectedReport) return;
    setLoading(true);
    setError("");
    setReportData(null);
    try {
      const params = buildFilterParams(selectedReport, {
        ...filters,
        legalEntityId: effectiveLegalEntityId,
        ownerOperatingUnitId: ownerOperatingUnitId || undefined,
      });
      const result = await getFixedAssetReport(selectedReport, params);
      setReportData(result);
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || "Report failed";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  async function handleExport() {
    if (!selectedReport) return;
    setExporting(true);
    try {
      const params = buildFilterParams(selectedReport, {
        ...filters,
        legalEntityId: effectiveLegalEntityId,
        ownerOperatingUnitId: ownerOperatingUnitId || undefined,
      });
      await exportFixedAssetReport(selectedReport, params);
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || "Export failed";
      setError(msg);
    } finally {
      setExporting(false);
    }
  }

  if (!canRead) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm text-slate-600">
          {l("Missing permission: fixed_assets.report.read", "Eksik yetki: fixed_assets.report.read")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">{rf("title")}</h1>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-3 md:grid-cols-4">
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
            {rf("selectReport")}
            <select
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={selectedReport}
              onChange={(e) => {
                const nextReport = e.target.value;
                setSelectedReport(nextReport);
                setReportData(null);
                setError("");
              }}
            >
              <option value="">{l("-- Select --", "-- Secin --")}</option>
              {REPORT_LIST.map((r) => (
                <option key={r.key} value={r.key}>
                  {rf(r.i18nKey)}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
            {rf("filterLegalEntity")}
            <input
              type="number"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={filters.legalEntityId}
              onChange={(e) => setFilter("legalEntityId", e.target.value)}
              placeholder={effectiveLegalEntityId ? String(effectiveLegalEntityId) : ""}
            />
          </label>

          {showDateRange ? (
            <>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
                {rf("filterDateFrom")}
                <input
                  type="date"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                  value={filters.dateFrom}
                  onChange={(e) => setFilter("dateFrom", e.target.value)}
                />
              </label>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
                {rf("filterDateTo")}
                <input
                  type="date"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                  value={filters.dateTo}
                  onChange={(e) => setFilter("dateTo", e.target.value)}
                />
              </label>
            </>
          ) : null}

          {showRegisterFilters ? (
            <>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
                {rf("filterCategory")}
                <input
                  type="number"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                  value={filters.categoryId}
                  onChange={(e) => setFilter("categoryId", e.target.value)}
                  placeholder="ID"
                />
              </label>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
                {rf("filterStatus")}
                <select
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                  value={filters.status}
                  onChange={(e) => setFilter("status", e.target.value)}
                >
                  <option value="">{l("All", "Tumu")}</option>
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="SUSPENDED">SUSPENDED</option>
                  <option value="FULLY_DEPRECIATED">FULLY_DEPRECIATED</option>
                  <option value="DISPOSED">DISPOSED</option>
                  <option value="DRAFT">DRAFT</option>
                </select>
              </label>
            </>
          ) : null}

          {showPeriodKey ? (
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
              {rf("filterPeriodKey")}
              <input
                type="text"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                value={filters.periodKey}
                onChange={(e) => setFilter("periodKey", e.target.value)}
                placeholder="YYYY-MM"
              />
            </label>
          ) : null}

          {showDepreciationReportBasis ? (
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
              {l("Report Basis", "Rapor Bazı")}
              <select
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                value={filters.reportBasis}
                onChange={(e) => setFilter("reportBasis", e.target.value)}
              >
                <option value="AS_POSTED">{l("As Posted", "Kaydedildigi Gibi")}</option>
                <option value="INCLUDE_RETRO_CORRECTIONS">
                  {l("Include Retro Corrections", "Retro Duzeltmeleri Dahil Et")}
                </option>
              </select>
            </label>
          ) : null}
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={handleRun}
            disabled={!selectedReport || loading}
            className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-cyan-700 disabled:opacity-50"
          >
            {loading ? rf("loading") : rf("runReport")}
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={!selectedReport || exporting}
            className="rounded-lg bg-slate-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-700 disabled:opacity-50"
          >
            {exporting ? rf("exporting") : rf("exportCsv")}
          </button>
        </div>

        {error ? (
          <p className="mt-2 text-sm text-rose-700">{error}</p>
        ) : null}
      </section>

      {reportData ? (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          {selectedReport === BY_OWNER_OU_REPORT ? (
            <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-sky-800">
                {l("Report Basis", "Rapor Bazı")}
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {l("Current Owner Snapshot", "Guncel Sahip Anlik Gorunumu")}
              </p>
              <p className="mt-1 text-xs text-sky-900/90">
                {l(
                  "This V1 report groups assets by the current owner on the asset master and does not restate historical owner attribution.",
                  "Bu V1 raporu demirbas kartindaki guncel sahibe gore gruplar; tarihsel sahip dagilimini yeniden yazmaz."
                )}
              </p>
            </div>
          ) : null}

          {selectedReport === DEPRECIATION_BY_OWNER_OU_REPORT ? (
            <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
                {l("Report Basis", "Rapor Bazı")}
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {resolveDepreciationReportBasisLabel(effectiveReportBasis, l)}
              </p>
              <p className="mt-1 text-xs text-emerald-900/90">
                {effectiveReportBasis === "INCLUDE_RETRO_CORRECTIONS"
                  ? l(
                      "Owner-based depreciation includes posted retro correction true-up reclassifications and suppresses current-owner fallback.",
                      "Sahip bazli amortisman, kaydedilmis retro duzeltme true-up siniflamalarini dahil eder ve guncel-sahip fallback yolunu kapatir."
                    )
                  : l(
                      "Owner-based depreciation reflects the originally posted attribution only.",
                      "Sahip bazli amortisman sadece ilk kaydedilen dagilimi gosterir."
                    )}
              </p>
            </div>
          ) : null}

          {selectedReport === DEPRECIATION_BY_OWNER_OU_REPORT && hasUnresolvedRows ? (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-900">
                {l("Unresolved Attribution", "Cozulemeyen Dagilim")}
              </p>
              <p className="mt-1 text-sm text-amber-950">
                {l(
                  "Some corrected owner-attribution rows could not be assigned deterministically and remain in the explicit UNRESOLVED bucket.",
                  "Bazi duzeltilmis sahip dagilimi satirlari deterministik olarak atanamadi ve acik UNRESOLVED kovasinda tutuldu."
                )}
              </p>
              <p className="mt-2 text-xs font-mono text-amber-900">
                txn={fmt(reportData.unresolvedAmountTxn)} / base={fmt(reportData.unresolvedAmountBase)}
              </p>
            </div>
          ) : null}

          {totals ? (
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-slate-700">{rf("totalsLabel")}</h2>
              {renderTotals(selectedReport, totals, rf)}
            </div>
          ) : null}

          {rows.length === 0 ? (
            <p className="text-sm text-slate-500">{rf("noResults")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    {columns.map((col) => (
                      <th
                        key={col.key}
                        className={`px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 ${
                          col.numeric ? "text-right" : "text-left"
                        }`}
                      >
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => {
                    const unresolvedRow = isUnresolvedOwnerRow(row);
                    return (
                      <tr
                        key={idx}
                        className={
                          unresolvedRow
                            ? "bg-amber-50"
                            : idx % 2 === 0
                              ? "bg-white"
                              : "bg-slate-50"
                        }
                      >
                        {columns.map((col) => (
                          <td
                            key={col.key}
                            className={`px-3 py-2 text-slate-700 ${
                              col.numeric ? "text-right font-mono" : "text-left"
                            } ${unresolvedRow ? "font-semibold text-amber-950" : ""}`}
                          >
                            {formatReportRowCell(row, col)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
