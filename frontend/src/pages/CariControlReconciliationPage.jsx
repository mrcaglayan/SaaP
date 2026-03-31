import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { listBooks } from "../api/glAdmin.js";
import {
  appendLocalReportContextParams,
  getCariControlReconciliationDetail,
  getCariControlReconciliationReport,
} from "../api/glReports.js";
import { listCariCounterparties } from "../api/cariCounterparty.js";
import { useAuth } from "../auth/useAuth.js";
import LocalCloseReportBanner from "../components/LocalCloseReportBanner.jsx";
import MoneyText from "../components/MoneyText.jsx";
import ReportAuditPanel from "../components/ReportAuditPanel.jsx";
import { useI18n } from "../i18n/useI18n.js";
import { listFiscalPeriods, listLegalEntities, listOperatingUnits } from "../api/orgAdmin.js";
import { resolveSourceLinkDestination } from "../utils/journalSourceLinkDestinations.js";

const CARI_CONTROL_RECONCILIATION_ROUTE_PATH = "/app/cari-kontrol-mutabakati";
const DEFAULT_FILTERS = Object.freeze({
  legalEntityId: "",
  bookId: "",
  fiscalPeriodId: "",
  operatingUnitScope: "ALL",
  operatingUnitId: "",
  direction: "ALL",
  rowStatus: "EXCEPTIONS_ONLY",
  counterpartyId: "",
});

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeEnum(value, allowedValues, fallback) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  return allowedValues.includes(normalized) ? normalized : fallback;
}

function formatDate(value) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? String(value).slice(0, 10)
    : parsed.toLocaleDateString();
}

function buildSourceActions(sourceLinks, l) {
  const seen = new Set();
  return (Array.isArray(sourceLinks) ? sourceLinks : [])
    .map((sourceLink) => {
      const route = resolveSourceLinkDestination(sourceLink);
      if (!route || seen.has(route)) {
        return null;
      }
      seen.add(route);
      const sourceRefType = String(
        sourceLink?.source_ref_type || sourceLink?.sourceRefType || ""
      )
        .trim()
        .toUpperCase();
      const label =
        sourceRefType === "CARI_SETTLEMENT_BATCH"
          ? l("Open settlement", "Mutabakati ac")
          : l("Open source", "Kaynagi ac");
      return { route, label };
    })
    .filter(Boolean);
}

function createInitialFilters(searchParams) {
  return {
    ...DEFAULT_FILTERS,
    legalEntityId: String(toPositiveInt(searchParams.get("legalEntityId")) || ""),
    bookId: String(toPositiveInt(searchParams.get("bookId")) || ""),
    fiscalPeriodId: String(toPositiveInt(searchParams.get("fiscalPeriodId")) || ""),
    operatingUnitScope: normalizeEnum(
      searchParams.get("operatingUnitScope"),
      ["ALL", "OPERATING_UNIT", "CENTRAL"],
      "ALL"
    ),
    operatingUnitId: String(toPositiveInt(searchParams.get("operatingUnitId")) || ""),
    direction: normalizeEnum(searchParams.get("direction"), ["ALL", "AR", "AP"], "ALL"),
    rowStatus: normalizeEnum(
      searchParams.get("rowStatus"),
      ["ALL", "EXCEPTIONS_ONLY"],
      "EXCEPTIONS_ONLY"
    ),
    counterpartyId: String(toPositiveInt(searchParams.get("counterpartyId")) || ""),
  };
}

function hasRequiredReportFilters(filters) {
  return Boolean(
    toPositiveInt(filters?.bookId) && toPositiveInt(filters?.fiscalPeriodId)
  );
}

function buildSearchParams(filters, sourceSearchParams) {
  const nextParams = new URLSearchParams();
  if (toPositiveInt(filters.legalEntityId)) {
    nextParams.set("legalEntityId", String(toPositiveInt(filters.legalEntityId)));
  }
  if (toPositiveInt(filters.bookId)) {
    nextParams.set("bookId", String(toPositiveInt(filters.bookId)));
  }
  if (toPositiveInt(filters.fiscalPeriodId)) {
    nextParams.set("fiscalPeriodId", String(toPositiveInt(filters.fiscalPeriodId)));
  }
  if (filters.operatingUnitScope !== "ALL") {
    nextParams.set("operatingUnitScope", filters.operatingUnitScope);
  }
  if (
    filters.operatingUnitScope === "OPERATING_UNIT" &&
    toPositiveInt(filters.operatingUnitId)
  ) {
    nextParams.set("operatingUnitId", String(toPositiveInt(filters.operatingUnitId)));
  }
  if (filters.direction !== "ALL") {
    nextParams.set("direction", filters.direction);
  }
  if (filters.rowStatus !== "EXCEPTIONS_ONLY") {
    nextParams.set("rowStatus", filters.rowStatus);
  }
  if (toPositiveInt(filters.counterpartyId)) {
    nextParams.set("counterpartyId", String(toPositiveInt(filters.counterpartyId)));
  }
  return appendLocalReportContextParams(sourceSearchParams, nextParams);
}

function resolveIssueTone(issueCodes) {
  return Array.isArray(issueCodes) && issueCodes.length > 0
    ? "border-amber-200 bg-amber-50"
    : "border-emerald-200 bg-emerald-50";
}

function formatIssueLabel(issueCode, l) {
  switch (String(issueCode || "").trim().toUpperCase()) {
    case "MISSING_CARI_LINK":
      return l("Missing CARI link", "Cari baglantisi eksik");
    case "MISSING_SUBLEDGER_REF":
      return l("Missing subledger ref", "Alt defter ref eksik");
    case "BALANCE_DIFFERENCE":
      return l("Balance difference", "Bakiye farki");
    default:
      return l("Match", "Eslesme");
  }
}

function buildReconciliationResponseSnapshot(payload) {
  return {
    rowCount: Number(payload?.total || 0),
    summary: payload?.summary || null,
    period: payload?.period || null,
    book: payload?.book || null,
  };
}

function buildReconciliationDetailSnapshot(payload) {
  return {
    row: payload?.row || null,
    glRowCount: Array.isArray(payload?.glRows) ? payload.glRows.length : 0,
    sourceRowCount: Array.isArray(payload?.sourceRows)
      ? payload.sourceRows.length
      : 0,
  };
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * First-pass RP10 page for GL-vs-CARI control-account reconciliation with OU
 * as a grouping/filter axis and direct journal/source drillthrough.
 */
export default function CariControlReconciliationPage() {
  const { hasPermission } = useAuth();
  const { language } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const l = useCallback((en, tr) => (language === "tr" ? tr : en), [language]);
  const canReadPage =
    hasPermission("gl.report.ledger.read") && hasPermission("cari.report.read");
  const canReadOrg = hasPermission("org.tree.read");
  const canReadBooks = hasPermission("gl.book.read");
  const canReadPeriods = hasPermission("org.fiscal_period.read");
  const canReadCards = hasPermission("cari.card.read");

  const [filters, setFilters] = useState(() => createInitialFilters(searchParams));
  const [legalEntities, setLegalEntities] = useState([]);
  const [books, setBooks] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [operatingUnits, setOperatingUnits] = useState([]);
  const [counterparties, setCounterparties] = useState([]);
  const [report, setReport] = useState(null);
  const [detailsByRowKey, setDetailsByRowKey] = useState({});
  const [expandedRowKey, setExpandedRowKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [detailLoadingKey, setDetailLoadingKey] = useState("");
  const [error, setError] = useState("");

  const selectedLegalEntityId = toPositiveInt(filters.legalEntityId);
  const selectedBook = useMemo(
    () => books.find((row) => Number(row?.id) === Number(filters.bookId)) || null,
    [books, filters.bookId]
  );
  const baseCurrencyCode = report?.book?.baseCurrencyCode || selectedBook?.base_currency_code || "";
  const auditSpecs = useMemo(() => {
    if (!report) {
      return [];
    }

    const specs = [];
    const rowExports = (report.rows || []).map((row) => ({
      rowKey: row.rowKey || "",
      direction: row.direction || "",
      operatingUnitLabel: row.operatingUnitLabel || "",
      counterpartyLabel: row.counterpartyLabel || "",
      issueCodes: Array.isArray(row.issueCodes) ? row.issueCodes.join(", ") : "",
      missingSourceLinkCount: Number(row.missingSourceLinkCount || 0),
      missingSubledgerRefCount: Number(row.missingSubledgerRefCount || 0),
      glAmountBase: Number(row.glAmountBase || 0),
      sourceAmountBase: Number(row.sourceAmountBase || 0),
      differenceBase: Number(row.differenceBase || 0),
    }));

    if (rowExports.length > 0) {
      specs.push({
        key: "cariControlReconciliationRows",
        label: l("Reconciliation rows", "Mutabakat satirlari"),
        rowCount: rowExports.length,
        routePath: CARI_CONTROL_RECONCILIATION_ROUTE_PATH,
        fileName: `track51-cari-control-reconciliation-${selectedBook?.code || filters.bookId || "book"}-${todayIsoDate()}.csv`,
        exportColumns: [
          { key: "rowKey", header: "Row Key" },
          { key: "direction", header: "Direction" },
          { key: "operatingUnitLabel", header: "Operating Unit" },
          { key: "counterpartyLabel", header: "Counterparty" },
          { key: "issueCodes", header: "Issue Codes" },
          { key: "missingSourceLinkCount", header: "Missing Source Links" },
          { key: "missingSubledgerRefCount", header: "Missing Subledger Refs" },
          { key: "glAmountBase", header: "GL Amount Base" },
          { key: "sourceAmountBase", header: "Source Amount Base" },
          { key: "differenceBase", header: "Difference Base" },
        ],
        exportRows: rowExports,
        fingerprintParameters: {
          legalEntityId: toPositiveInt(filters.legalEntityId) || null,
          bookId: toPositiveInt(filters.bookId) || null,
          fiscalPeriodId: toPositiveInt(filters.fiscalPeriodId) || null,
          operatingUnitScope: filters.operatingUnitScope,
          operatingUnitId: toPositiveInt(filters.operatingUnitId) || null,
          direction: filters.direction,
          rowStatus: filters.rowStatus,
          counterpartyId: toPositiveInt(filters.counterpartyId) || null,
        },
        fingerprintContext: {
          routePath: CARI_CONTROL_RECONCILIATION_ROUTE_PATH,
          baseCurrencyCode,
        },
        fingerprintSnapshot: {
          report: buildReconciliationResponseSnapshot(report),
          rows: rowExports,
        },
      });
    }

    if (activeDetail?.row) {
      const detailRows = [
        ...(activeDetail.glRows || []).map((row) => ({
          detailType: "GL_LINE",
          referenceNo: row.journalNo || "",
          counterpartyOrAccount:
            `${row.accountCode || ""} ${row.accountName || ""}`.trim(),
          date: row.entryDate || "",
          context: row.operatingUnitLabel || "",
          amountBase: Number(row.normalizedAmountBase || 0),
        })),
        ...(activeDetail.sourceRows || []).map((row) => ({
          detailType: "SOURCE_OPEN_ITEM",
          referenceNo: row.documentNo || "",
          counterpartyOrAccount:
            `${row.counterpartyCode || ""} ${row.counterpartyName || ""}`.trim(),
          date: row.documentDate || "",
          context: row.operatingUnitLabel || "",
          amountBase: Number(row.residualAmountBaseAsOf || 0),
        })),
      ];

      specs.push({
        key: "cariControlReconciliationDetail",
        label: l("Expanded drill detail", "Acilmis drill detayi"),
        rowCount: detailRows.length,
        routePath: CARI_CONTROL_RECONCILIATION_ROUTE_PATH,
        fileName: `track51-cari-control-reconciliation-detail-${expandedRowKey || "row"}-${todayIsoDate()}.csv`,
        exportColumns: [
          { key: "detailType", header: "Detail Type" },
          { key: "referenceNo", header: "Reference No" },
          { key: "counterpartyOrAccount", header: "Counterparty / Account" },
          { key: "date", header: "Date" },
          { key: "context", header: "Context" },
          { key: "amountBase", header: "Amount Base" },
        ],
        exportRows: detailRows,
        fingerprintParameters: {
          ...DEFAULT_FILTERS,
          legalEntityId: toPositiveInt(filters.legalEntityId) || null,
          bookId: toPositiveInt(filters.bookId) || null,
          fiscalPeriodId: toPositiveInt(filters.fiscalPeriodId) || null,
          rowKey: expandedRowKey || null,
        },
        fingerprintContext: {
          routePath: CARI_CONTROL_RECONCILIATION_ROUTE_PATH,
          baseCurrencyCode,
          expandedRowKey: expandedRowKey || null,
        },
        fingerprintSnapshot: {
          detail: buildReconciliationDetailSnapshot(activeDetail),
          rows: detailRows,
        },
      });
    }

    return specs;
  }, [activeDetail, baseCurrencyCode, expandedRowKey, filters, l, report, selectedBook]);

  const loadReport = useCallback(
    async (nextFilters) => {
      if (!canReadPage) {
        return;
      }
      if (!hasRequiredReportFilters(nextFilters)) {
        setReport(null);
        setDetailsByRowKey({});
        setError("");
        return;
      }
      setLoading(true);
      setError("");
      try {
        const payload = await getCariControlReconciliationReport({
          legalEntityId: toPositiveInt(nextFilters.legalEntityId) || undefined,
          bookId: toPositiveInt(nextFilters.bookId) || undefined,
          fiscalPeriodId: toPositiveInt(nextFilters.fiscalPeriodId) || undefined,
          operatingUnitScope: nextFilters.operatingUnitScope,
          operatingUnitId:
            nextFilters.operatingUnitScope === "OPERATING_UNIT"
              ? toPositiveInt(nextFilters.operatingUnitId) || undefined
              : undefined,
          direction: nextFilters.direction,
          rowStatus: nextFilters.rowStatus,
          counterpartyId: toPositiveInt(nextFilters.counterpartyId) || undefined,
        });
        setReport(payload || null);
      } catch (err) {
        setReport(null);
        setError(err?.response?.data?.message || l("Failed to load reconciliation.", "Mutabakat yuklenemedi."));
      } finally {
        setLoading(false);
      }
    },
    [canReadPage, l]
  );

  const applyFilters = useCallback(
    async (nextFilters) => {
      setSearchParams(buildSearchParams(nextFilters, searchParams), { replace: true });
      setExpandedRowKey("");
      setDetailsByRowKey({});
      if (!hasRequiredReportFilters(nextFilters)) {
        setReport(null);
        setError("");
        return;
      }
      await loadReport(nextFilters);
    },
    [loadReport, searchParams, setSearchParams]
  );

  const loadRowDetail = useCallback(
    async (rowKey) => {
      if (!rowKey || detailsByRowKey[rowKey]) {
        setExpandedRowKey(rowKey);
        return;
      }
      setDetailLoadingKey(rowKey);
      setError("");
      try {
        const payload = await getCariControlReconciliationDetail({
          legalEntityId: toPositiveInt(filters.legalEntityId) || undefined,
          bookId: toPositiveInt(filters.bookId) || undefined,
          fiscalPeriodId: toPositiveInt(filters.fiscalPeriodId) || undefined,
          operatingUnitScope: filters.operatingUnitScope,
          operatingUnitId:
            filters.operatingUnitScope === "OPERATING_UNIT"
              ? toPositiveInt(filters.operatingUnitId) || undefined
              : undefined,
          direction: filters.direction,
          counterpartyId: toPositiveInt(filters.counterpartyId) || undefined,
          rowKey,
        });
        setDetailsByRowKey((prev) => ({ ...prev, [rowKey]: payload }));
        setExpandedRowKey(rowKey);
      } catch (err) {
        setError(err?.response?.data?.message || l("Failed to load detail.", "Detay yuklenemedi."));
      } finally {
        setDetailLoadingKey("");
      }
    },
    [detailsByRowKey, filters, l]
  );

  useEffect(() => {
    if (!canReadPage) {
      return;
    }
    if (!hasRequiredReportFilters(filters)) {
      setReport(null);
      setError("");
      return;
    }
    void applyFilters(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canReadPage]);

  useEffect(() => {
    let cancelled = false;
    async function loadLookups() {
      try {
        const [entityRes, counterpartyRes] = await Promise.all([
          canReadOrg ? listLegalEntities({ limit: 500, includeInactive: true }) : Promise.resolve({ rows: [] }),
          canReadCards ? listCariCounterparties({ limit: 500, offset: 0 }) : Promise.resolve({ rows: [] }),
        ]);
        if (cancelled) {
          return;
        }
        setLegalEntities(Array.isArray(entityRes?.rows) ? entityRes.rows : []);
        setCounterparties(Array.isArray(counterpartyRes?.rows) ? counterpartyRes.rows : []);
      } catch {
        if (!cancelled) {
          setLegalEntities([]);
          setCounterparties([]);
        }
      }
    }
    void loadLookups();
    return () => {
      cancelled = true;
    };
  }, [canReadCards, canReadOrg]);

  useEffect(() => {
    let cancelled = false;
    async function loadScopedLookups() {
      if (!selectedLegalEntityId) {
        setBooks([]);
        setOperatingUnits([]);
        return;
      }
      try {
        const [bookRes, unitRes] = await Promise.all([
          canReadBooks ? listBooks({ legalEntityId: selectedLegalEntityId, limit: 500 }) : Promise.resolve({ rows: [] }),
          canReadOrg ? listOperatingUnits({ legalEntityId: selectedLegalEntityId, limit: 1000 }) : Promise.resolve({ rows: [] }),
        ]);
        if (cancelled) {
          return;
        }
        setBooks(Array.isArray(bookRes?.rows) ? bookRes.rows : []);
        setOperatingUnits(Array.isArray(unitRes?.rows) ? unitRes.rows : []);
      } catch {
        if (!cancelled) {
          setBooks([]);
          setOperatingUnits([]);
        }
      }
    }
    void loadScopedLookups();
    return () => {
      cancelled = true;
    };
  }, [canReadBooks, canReadOrg, selectedLegalEntityId]);

  useEffect(() => {
    let cancelled = false;
    async function loadBookPeriods() {
      const calendarId = toPositiveInt(selectedBook?.calendar_id || selectedBook?.calendarId);
      if (!calendarId || !canReadPeriods) {
        setPeriods([]);
        return;
      }
      try {
        const response = await listFiscalPeriods(calendarId, { limit: 1000 });
        if (!cancelled) {
          setPeriods(Array.isArray(response?.rows) ? response.rows : []);
        }
      } catch {
        if (!cancelled) {
          setPeriods([]);
        }
      }
    }
    void loadBookPeriods();
    return () => {
      cancelled = true;
    };
  }, [canReadPeriods, selectedBook]);

  if (!canReadPage) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
        {l(
          "Missing permissions: gl.report.ledger.read and cari.report.read",
          "Eksik yetkiler: gl.report.ledger.read ve cari.report.read"
        )}
      </div>
    );
  }

  const activeDetail = expandedRowKey ? detailsByRowKey[expandedRowKey] || null : null;

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">
          {l("CARI Control Reconciliation", "Cari Kontrol Mutabakati")}
        </h1>
        <p className="mt-2 max-w-5xl text-sm text-slate-600">
          {l(
            "First-pass RP10 compares configured CARI control-account balances against CARI open-item residuals at the selected fiscal-period end, with OU kept as a grouping and exception axis.",
            "Ilk gecis RP10, secilen mali donem sonunda tanimli cari kontrol hesap bakiyelerini cari acik kalem residual'lariyla karsilastirir; OU ise gruplama ve istisna ekseni olarak korunur."
          )}
        </p>
        <LocalCloseReportBanner
          searchParams={searchParams}
          reportKey="cariControlReconciliation"
          routePath={CARI_CONTROL_RECONCILIATION_ROUTE_PATH}
          reportResponse={report}
          buildResponseSnapshot={buildReconciliationResponseSnapshot}
          canReview={false}
          l={l}
        />
      </section>
      <ReportAuditPanel
        specs={auditSpecs}
        title={l(
          "Audit export and fingerprint",
          "Audit disa aktarim ve fingerprint",
        )}
        subtitle={l(
          "RP13 now gives the RP10 reconciliation surface one stable frontend fingerprint plus CSV export for both the loaded exception rows and the expanded drill detail when opened.",
          "RP13 artik RP10 mutabakat yuzeyine yuklu istisna satirlari ve acildiysa genisletilmis drill detayi icin bir kararlı frontend fingerprint'i ve CSV disa aktarimi verir.",
        )}
        l={l}
      />
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="text-sm text-slate-700">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {l("Legal Entity", "Yasal varlik")}
            </div>
            <select
              value={filters.legalEntityId}
              onChange={(event) =>
                setFilters((prev) => ({
                  ...prev,
                  legalEntityId: event.target.value,
                  bookId: "",
                  fiscalPeriodId: "",
                  operatingUnitId: "",
                }))
              }
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="">{l("Select legal entity", "Yasal varlik secin")}</option>
              {legalEntities.map((row) => (
                <option key={`rp10-le-${row.id}`} value={row.id}>
                  {row.code} - {row.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-700">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {l("Book", "Defter")}
            </div>
            <select
              value={filters.bookId}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, bookId: event.target.value, fiscalPeriodId: "" }))
              }
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="">{l("Select book", "Defter secin")}</option>
              {books.map((row) => (
                <option key={`rp10-book-${row.id}`} value={row.id}>
                  {row.code} - {row.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-700">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {l("Fiscal Period", "Mali donem")}
            </div>
            <select
              value={filters.fiscalPeriodId}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, fiscalPeriodId: event.target.value }))
              }
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="">{l("Select period", "Donem secin")}</option>
              {periods.map((row) => (
                <option key={`rp10-period-${row.id}`} value={row.id}>
                  {`FY${row.fiscal_year} P${String(row.period_no).padStart(2, "0")} - ${row.period_name}`}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-700">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {l("Direction", "Yon")}
            </div>
            <select
              value={filters.direction}
              onChange={(event) => setFilters((prev) => ({ ...prev, direction: event.target.value }))}
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="ALL">{l("All", "Tum")}</option>
              <option value="AR">AR</option>
              <option value="AP">AP</option>
            </select>
          </label>
          <label className="text-sm text-slate-700">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {l("OU Scope", "OU kapsami")}
            </div>
            <select
              value={filters.operatingUnitScope}
              onChange={(event) =>
                setFilters((prev) => ({
                  ...prev,
                  operatingUnitScope: event.target.value,
                  operatingUnitId: event.target.value === "OPERATING_UNIT" ? prev.operatingUnitId : "",
                }))
              }
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="ALL">{l("All scopes", "Tum kapsamlar")}</option>
              <option value="OPERATING_UNIT">{l("One operating unit", "Tek isletme birimi")}</option>
              <option value="CENTRAL">CENTRAL</option>
            </select>
          </label>
          <label className="text-sm text-slate-700">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {l("Operating Unit", "Isletme birimi")}
            </div>
            <select
              value={filters.operatingUnitId}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, operatingUnitId: event.target.value }))
              }
              disabled={filters.operatingUnitScope !== "OPERATING_UNIT"}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 disabled:bg-slate-100"
            >
              <option value="">{l("Select operating unit", "Isletme birimi secin")}</option>
              {operatingUnits.map((row) => (
                <option key={`rp10-ou-${row.id}`} value={row.id}>
                  {row.code} - {row.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-700">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {l("Counterparty", "Cari")}
            </div>
            <select
              value={filters.counterpartyId}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, counterpartyId: event.target.value }))
              }
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="">{l("All counterparties", "Tum cariler")}</option>
              {counterparties.map((row) => (
                <option key={`rp10-cp-${row.id}`} value={row.id}>
                  {row.code} - {row.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-700">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {l("Row Mode", "Satir modu")}
            </div>
            <select
              value={filters.rowStatus}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, rowStatus: event.target.value }))
              }
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="EXCEPTIONS_ONLY">{l("Exceptions only", "Yalniz istisnalar")}</option>
              <option value="ALL">{l("All rows", "Tum satirlar")}</option>
            </select>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void applyFilters(filters)}
            disabled={loading}
            className="rounded-lg border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {loading ? l("Loading...", "Yukleniyor...") : l("Apply", "Uygula")}
          </button>
          <button
            type="button"
            onClick={() => {
              const nextFilters = createInitialFilters(new URLSearchParams());
              setFilters(nextFilters);
              void applyFilters(nextFilters);
            }}
            disabled={loading}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60"
          >
            {l("Reset", "Sifirla")}
          </button>
        </div>
      </section>
      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}
      {report ? (
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {l("Period Basis", "Donem bazisi")}
            </div>
            <div className="mt-1 text-sm font-semibold text-slate-900">
              {report.period?.label || "-"}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {l("As of", "Tarih")}: {report.period?.asOfDate || "-"}
            </div>
          </article>
          <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {l("Exception Rows", "Istisna satirlari")}
            </div>
            <div className="mt-1 text-2xl font-semibold text-slate-900">
              {report.summary?.exceptionRowCount || 0}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {l("Matched rows", "Eslesen satirlar")}: {report.summary?.matchedRowCount || 0}
            </div>
          </article>
          <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {l("Absolute Difference", "Mutlak fark")}
            </div>
            <div className="mt-1 text-lg font-semibold text-slate-900">
              <MoneyText amount={report.summary?.absoluteDifferenceBaseTotal || 0} currencyCode={baseCurrencyCode} />
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {l("Net difference", "Net fark")}: <MoneyText amount={report.summary?.differenceBaseTotal || 0} currencyCode={baseCurrencyCode} />
            </div>
          </article>
          <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {l("Exceptions", "Istisnalar")}
            </div>
            <div className="mt-1 text-sm font-semibold text-slate-900">
              {l("Missing links", "Eksik baglar")}: {report.summary?.missingSourceLinkCount || 0}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {l("Missing subledger refs", "Eksik alt defter ref'leri")}: {report.summary?.missingSubledgerRefCount || 0}
            </div>
          </article>
        </section>
      ) : null}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-900">
            {l("Reconciliation Rows", "Mutabakat satirlari")}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {l(
              "Rows compare normalized GL control balances to CARI open-item residuals within the same OU/counterparty context.",
              "Satirlar, ayni OU/cari baglaminda normalize GL kontrol bakiyelerini cari acik kalem residual'lariyla karsilastirir."
            )}
          </p>
        </div>
        {report?.rows?.length ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-4 py-3">{l("Issue", "Sorun")}</th>
                  <th className="px-4 py-3">{l("Direction", "Yon")}</th>
                  <th className="px-4 py-3">{l("OU", "OU")}</th>
                  <th className="px-4 py-3">{l("Counterparty", "Cari")}</th>
                  <th className="px-4 py-3">{l("GL Base", "GL baz")}</th>
                  <th className="px-4 py-3">{l("CARI Base", "Cari baz")}</th>
                  <th className="px-4 py-3">{l("Difference", "Fark")}</th>
                  <th className="px-4 py-3">{l("Detail", "Detay")}</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.rowKey} className="border-t border-slate-100 align-top">
                    <td className="px-4 py-3">
                      <div className={`inline-flex flex-wrap gap-1 rounded-lg border px-2 py-1 text-xs font-semibold ${resolveIssueTone(row.issueCodes)}`}>
                        {(row.issueCodes?.length ? row.issueCodes : ["MATCH"]).map((issueCode) => (
                          <span key={`${row.rowKey}-${issueCode}`}>{formatIssueLabel(issueCode, l)}</span>
                        ))}
                      </div>
                      <div className="mt-2 text-xs text-slate-500">
                        {row.missingSourceLinkCount || 0} {l("missing links", "eksik bag")} | {row.missingSubledgerRefCount || 0} {l("missing subledger refs", "eksik alt defter ref")}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{row.direction}</td>
                    <td className="px-4 py-3 text-slate-700">{row.operatingUnitLabel}</td>
                    <td className="px-4 py-3 text-slate-700">{row.counterpartyLabel}</td>
                    <td className="px-4 py-3"><MoneyText amount={row.glAmountBase} currencyCode={baseCurrencyCode} /></td>
                    <td className="px-4 py-3"><MoneyText amount={row.sourceAmountBase} currencyCode={baseCurrencyCode} /></td>
                    <td className="px-4 py-3"><MoneyText amount={row.differenceBase} currencyCode={baseCurrencyCode} /></td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => void loadRowDetail(row.rowKey)}
                        disabled={detailLoadingKey === row.rowKey}
                        className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-60"
                      >
                        {detailLoadingKey === row.rowKey ? l("Loading...", "Yukleniyor...") : expandedRowKey === row.rowKey ? l("Open detail", "Detay acik") : l("Show detail", "Detayi goster")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-5 py-6 text-sm text-slate-500">
            {loading
              ? l("Loading reconciliation...", "Mutabakat yukleniyor...")
              : hasRequiredReportFilters(filters)
                ? l("No rows found for the selected scope.", "Secilen kapsam icin satir bulunamadi.")
                : l(
                    "Select a book and fiscal period to run the reconciliation.",
                    "Mutabakati calistirmak icin bir defter ve mali donem secin."
                  )}
          </div>
        )}
      </section>
      {expandedRowKey && activeDetail ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">
            {l("Row Drillthrough", "Satir drillthrough")}
          </h2>
          <div className="mt-1 text-sm text-slate-600">
            {activeDetail.row?.direction} | {activeDetail.row?.operatingUnitLabel} | {activeDetail.row?.counterpartyLabel}
          </div>
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <div className="space-y-2">
              <div className="text-sm font-semibold text-slate-900">{l("GL Lines", "GL satirlari")}</div>
              {activeDetail.glRows?.length ? activeDetail.glRows.map((row) => {
                const sourceActions = buildSourceActions(row.sourceLinks, l);
                return (
                  <div key={`gl-detail-${row.journalLineId}`} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">
                          {row.journalNo || "-"} | {row.accountCode || "-"} {row.accountName || ""}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {formatDate(row.entryDate)} | {row.operatingUnitLabel} | {row.subledgerReferenceNo || l("No subledger ref", "Alt defter ref yok")}
                        </div>
                        {row.lineDescription ? <div className="mt-1 text-xs text-slate-600">{row.lineDescription}</div> : null}
                      </div>
                      <div className="text-sm font-semibold text-slate-900">
                        <MoneyText amount={row.normalizedAmountBase} currencyCode={baseCurrencyCode} />
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link to={`/app/mahsup-islemleri?journalId=${row.journalId}`} className="rounded border border-cyan-300 px-2 py-1 text-xs font-semibold text-cyan-700 hover:bg-cyan-50">
                        {l("Open journal", "Mahsubu ac")}
                      </Link>
                      {sourceActions.map((action) => (
                        <Link key={`${row.journalLineId}-${action.route}`} to={action.route} className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100">
                          {action.label}
                        </Link>
                      ))}
                    </div>
                  </div>
                );
              }) : (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                  {l("No GL lines for this row.", "Bu satir icin GL satiri yok.")}
                </div>
              )}
            </div>
            <div className="space-y-2">
              <div className="text-sm font-semibold text-slate-900">{l("Source Open Items", "Kaynak acik kalemler")}</div>
              {activeDetail.sourceRows?.length ? activeDetail.sourceRows.map((row) => (
                <div key={`source-row-${row.openItemId}`} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">
                        {row.documentNo || "-"} | {row.counterpartyCode || "-"} {row.counterpartyName || ""}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {formatDate(row.documentDate)} | {row.operatingUnitLabel} | {row.asOfStatus || "-"}
                      </div>
                    </div>
                    <div className="text-sm font-semibold text-slate-900">
                      <MoneyText amount={row.residualAmountBaseAsOf} currencyCode={baseCurrencyCode} />
                    </div>
                  </div>
                  {row.documentId ? (
                    <div className="mt-3">
                      <Link to={`/app/cari-belgeler?documentId=${row.documentId}`} className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100">
                        {l("Open document", "Belgeyi ac")}
                      </Link>
                    </div>
                  ) : null}
                </div>
              )) : (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                  {l("No open-item source rows for this drillthrough.", "Bu drillthrough icin acik kalem kaynak satiri yok.")}
                </div>
              )}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
