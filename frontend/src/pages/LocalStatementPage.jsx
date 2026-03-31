import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Combobox from "../components/Combobox.jsx";
import MoneyText from "../components/MoneyText.jsx";
import { listBooks } from "../api/glAdmin.js";
import {
  appendLocalReportContextParams,
  buildLocalReportLocation,
  getLocalBalanceSheetReport,
  getLocalIncomeStatementReport,
  getLocalStatementAccountSummary,
  LOCAL_REPORT_ROUTE_PATHS,
  normalizeLocalReportParams,
} from "../api/glReports.js";
import { listFiscalPeriods, listLegalEntities } from "../api/orgAdmin.js";
import { useAuth } from "../auth/useAuth.js";
import LocalCloseReportBanner from "../components/LocalCloseReportBanner.jsx";
import { useI18n } from "../i18n/useI18n.js";

const REQUIRED_PAGE_PERMISSIONS = Object.freeze([
  "org.tree.read",
  "gl.book.read",
  "org.fiscal_period.read",
  "gl.report.statement.read",
]);

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function toIdText(value) {
  const parsed = toPositiveInt(value);
  return parsed ? String(parsed) : "";
}

function parseBooleanFlag(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function formatPeriodLabel(row) {
  if (!row) return "-";
  return `FY${row.fiscal_year} P${String(row.period_no).padStart(2, "0")} - ${row.period_name}`;
}

function hasRowId(rows, id) {
  return rows.some((row) => Number(row?.id) === Number(id));
}

function filtersEqual(left, right) {
  return (
    String(left?.legalEntityId || "") === String(right?.legalEntityId || "") &&
    String(left?.bookId || "") === String(right?.bookId || "") &&
    String(left?.fiscalPeriodId || "") === String(right?.fiscalPeriodId || "") &&
    Boolean(left?.includeZero) === Boolean(right?.includeZero)
  );
}

function createInitialFilters(searchParams) {
  const params = normalizeLocalReportParams(
    Object.fromEntries((searchParams || new URLSearchParams()).entries()),
  );
  return {
    legalEntityId: toIdText(params.legalEntityId),
    bookId: toIdText(params.bookId),
    fiscalPeriodId: toIdText(params.fiscalPeriodId),
    includeZero: parseBooleanFlag(params.includeZero, false),
  };
}

function getStatementMeta(statementType, l) {
  if (statementType === "INCOME_STATEMENT") {
    return {
      title: l("Gelir Tablosu", "Gelir Tablosu"),
      subtitle: l(
        "Read fiscal-year-to-date local profit and loss by legal entity, book, and fiscal period. RP05 excludes the repo's auto year-end P&L close journal from the YTD presentation so performance remains readable after close.",
        "Yasal varlik, defter ve mali donem bazinda mali yil bugune kadarki yerel kar/zarar tablosunu okuyun. RP05, performans gorunumu kapanistan sonra da okunabilir kalsin diye repodaki otomatik yil sonu kar/zarar kapatma fisini YTD sunumundan dislar.",
      ),
      loadReport: getLocalIncomeStatementReport,
      totals: [
        ["netSales", l("Net Sales", "Net Satislar")],
        ["grossProfitLoss", l("Gross Profit / Loss", "Brut Kar / Zarar")],
        ["operatingProfitLoss", l("Operating Profit / Loss", "Faaliyet Kari / Zarari")],
        ["profitBeforeTax", l("Profit Before Tax", "Vergi Oncesi Kar / Zarar")],
        ["netIncomeLoss", l("Net Income / Loss", "Net Donem Kari / Zarari")],
      ],
      lockText: l(
        "RP05 lock: fiscal-year-to-date statement rows with explicit code-band mapping and row-to-account-summary-to-ledger drillthrough.",
        "RP05 kilidi: acik kod-band eslemesi ve satirdan hesap ozetine, oradan deftere giden drillthrough ile mali yil bugune kadarki tablo.",
      ),
    };
  }

  return {
    title: l("Bilanco", "Bilanco"),
    subtitle: l(
      "Read posted local balances at the selected period end. RP05 keeps retained earnings on posted equity and shows current-year result as a separate synthetic row until the repo's posted year-end close absorbs it into equity.",
      "Secilen donem sonu itibariyla post edilmis yerel bakiyeleri okuyun. RP05 dagitilmamis karlari post edilmis ozkaynakta tutar ve repodaki post edilmis yil sonu kapanisi bunu ozkaynak icine almadan once cari donem sonucunu ayri bir sentetik satir olarak gosterir.",
    ),
    loadReport: getLocalBalanceSheetReport,
    totals: [
      ["assetsTotal", l("Assets Total", "Toplam Varliklar")],
      ["liabilitiesTotal", l("Liabilities Total", "Toplam Yukumlulukler")],
      ["postedEquityTotal", l("Posted Equity", "Post Edilmis Ozkaynak")],
      ["currentYearResult", l("Current-Year Result", "Cari Donem Sonucu")],
      ["equationDelta", l("Equation Delta", "Denklem Farki")],
    ],
    lockText: l(
      "RP05 lock: posted period-end balance sheet with retained earnings kept on posted equity and current-year result shown as a separate synthetic row until year-end close absorbs it.",
      "RP05 kilidi: dagitilmamis karlarin post edilmis ozkaynakta tutuldugu ve yil sonu kapanisi onu ozkaynak icine almadan once cari donem sonucunun ayri bir sentetik satir oldugu post edilmis donem sonu bilanco.",
    ),
  };
}

function buildStatementResponseSnapshot(reportResponse) {
  return {
    contract: reportResponse?.contract || {},
    totals: reportResponse?.totals || {},
    range: reportResponse?.range || null,
    rowCount: Array.isArray(reportResponse?.rows) ? reportResponse.rows.length : 0,
    book: reportResponse?.book || null,
    legalEntity: reportResponse?.legalEntity || null,
    fiscalPeriod: reportResponse?.fiscalPeriod || null,
  };
}

/**
 * Render the RP05 local Bilanco and Gelir Tablosu pages with explicit
 * statement-row -> account-summary -> ledger drillthrough.
 */
export default function LocalStatementPage({ statementType = "BALANCE_SHEET" }) {
  const normalizedStatementType = String(statementType || "").toUpperCase();
  const { hasPermission } = useAuth();
  const { language } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const isTr = language === "tr";
  const l = useCallback((en, tr) => (isTr ? tr : en), [isTr]);
  const meta = useMemo(
    () => getStatementMeta(normalizedStatementType, l),
    [l, normalizedStatementType],
  );
  const routePath =
    normalizedStatementType === "INCOME_STATEMENT"
      ? LOCAL_REPORT_ROUTE_PATHS.incomeStatement
      : LOCAL_REPORT_ROUTE_PATHS.balanceSheet;
  const reportKey =
    normalizedStatementType === "INCOME_STATEMENT"
      ? "incomeStatement"
      : "balanceSheet";

  const missingPermissions = REQUIRED_PAGE_PERMISSIONS.filter(
    (permissionCode) => !hasPermission(permissionCode),
  );
  const hasRequiredReads = missingPermissions.length === 0;
  const canReviewLocalClose = hasPermission("ouclose.prepare");

  const [filters, setFilters] = useState(() => createInitialFilters(searchParams));
  const [loadingRefs, setLoadingRefs] = useState(false);
  const [loadingPeriods, setLoadingPeriods] = useState(false);
  const [loadingReport, setLoadingReport] = useState(false);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [error, setError] = useState("");
  const [summaryError, setSummaryError] = useState("");
  const [legalEntities, setLegalEntities] = useState([]);
  const [books, setBooks] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [reportResponse, setReportResponse] = useState(null);
  const [accountSummaryResponse, setAccountSummaryResponse] = useState(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  const selectedLegalEntityId = toPositiveInt(filters.legalEntityId);
  const selectedBookId = toPositiveInt(filters.bookId);
  const selectedPeriodId = toPositiveInt(filters.fiscalPeriodId);

  const selectedBook = useMemo(
    () => books.find((row) => Number(row?.id) === Number(selectedBookId)) || null,
    [books, selectedBookId],
  );
  const selectedEntity = useMemo(
    () => legalEntities.find((row) => Number(row?.id) === Number(selectedLegalEntityId)) || null,
    [legalEntities, selectedLegalEntityId],
  );
  const selectedPeriod = useMemo(
    () => periods.find((row) => Number(row?.id) === Number(selectedPeriodId)) || null,
    [periods, selectedPeriodId],
  );

  const reportRows = Array.isArray(reportResponse?.rows) ? reportResponse.rows : [];
  const reportWarnings = Array.isArray(reportResponse?.warnings) ? reportResponse.warnings : [];
  const reportTotals = reportResponse?.totals || {};
  const reportContract = reportResponse?.contract || {};
  const reportRange = reportResponse?.range || {};
  const currencyCode = String(
    reportResponse?.book?.baseCurrencyCode || selectedBook?.base_currency_code || "",
  ).toUpperCase();

  useEffect(() => {
    if (!hasRequiredReads) return undefined;
    const nextFilters = createInitialFilters(searchParams);
    setFilters((prev) => (filtersEqual(prev, nextFilters) ? prev : nextFilters));
  }, [hasRequiredReads, searchParams]);

  useEffect(() => {
    if (!hasRequiredReads) return undefined;
    const nextParams = appendLocalReportContextParams(
      searchParams,
      new URLSearchParams(),
    );
    const normalized = normalizeLocalReportParams({
      legalEntityId: selectedLegalEntityId || undefined,
      bookId: selectedBookId || undefined,
      fiscalPeriodId: selectedPeriodId || undefined,
      includeZero: filters.includeZero ? "true" : undefined,
    });
    for (const [key, value] of Object.entries(normalized)) {
      if (value !== undefined && value !== null && value !== "") nextParams.set(key, String(value));
    }
    if (nextParams.toString() !== searchParams.toString()) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [
    filters.includeZero,
    hasRequiredReads,
    searchParams,
    selectedBookId,
    selectedLegalEntityId,
    selectedPeriodId,
    setSearchParams,
  ]);

  useEffect(() => {
    if (!hasRequiredReads) return undefined;
    let cancelled = false;
    async function loadReferences() {
      setLoadingRefs(true);
      try {
        const [entityResponse, bookResponse] = await Promise.all([
          listLegalEntities({ limit: 500, includeInactive: true }),
          listBooks(selectedLegalEntityId ? { legalEntityId: selectedLegalEntityId } : {}),
        ]);
        if (cancelled) return;
        const nextEntities = Array.isArray(entityResponse?.rows) ? entityResponse.rows : [];
        const nextBooks = Array.isArray(bookResponse?.rows) ? bookResponse.rows : [];
        setLegalEntities(nextEntities);
        setBooks(nextBooks);
        setFilters((prev) => {
          const next = { ...prev };
          if (!hasRowId(nextEntities, prev.legalEntityId)) next.legalEntityId = String(nextEntities[0]?.id || "");
          if (!hasRowId(nextBooks, prev.bookId)) next.bookId = String(nextBooks[0]?.id || "");
          return filtersEqual(prev, next) ? prev : next;
        });
      } catch (err) {
        if (!cancelled) {
          setError(err?.response?.data?.message || l("Failed to load statement references.", "Finansal tablo referanslari yuklenemedi."));
        }
      } finally {
        if (!cancelled) setLoadingRefs(false);
      }
    }
    void loadReferences();
    return () => {
      cancelled = true;
    };
  }, [hasRequiredReads, l, selectedLegalEntityId]);

  useEffect(() => {
    if (!hasRequiredReads) return undefined;
    let cancelled = false;
    async function loadPeriods() {
      const calendarId = toPositiveInt(selectedBook?.calendar_id);
      if (!selectedBookId || !calendarId) {
        setPeriods([]);
        return;
      }
      setLoadingPeriods(true);
      try {
        const response = await listFiscalPeriods(calendarId, { limit: 500 });
        if (cancelled) return;
        const nextPeriods = Array.isArray(response?.rows) ? response.rows : [];
        setPeriods(nextPeriods);
        setFilters((prev) =>
          hasRowId(nextPeriods, prev.fiscalPeriodId)
            ? prev
            : { ...prev, fiscalPeriodId: String(nextPeriods[0]?.id || "") },
        );
      } catch (err) {
        if (!cancelled) {
          setError(err?.response?.data?.message || l("Failed to load fiscal periods.", "Mali donemler yuklenemedi."));
        }
      } finally {
        if (!cancelled) setLoadingPeriods(false);
      }
    }
    void loadPeriods();
    return () => {
      cancelled = true;
    };
  }, [hasRequiredReads, l, selectedBook, selectedBookId]);

  useEffect(() => {
    if (!hasRequiredReads || !selectedBookId || !selectedPeriodId) {
      setReportResponse(null);
      return;
    }
    let cancelled = false;
    async function loadReport() {
      setLoadingReport(true);
      setError("");
      try {
        const response = await meta.loadReport({
          legalEntityId: selectedLegalEntityId || undefined,
          bookId: selectedBookId,
          fiscalPeriodId: selectedPeriodId,
          includeZero: filters.includeZero,
        });
        if (!cancelled) setReportResponse(response || null);
      } catch (err) {
        if (!cancelled) {
          setReportResponse(null);
          setError(err?.response?.data?.message || l("Failed to load statement.", "Finansal tablo yuklenemedi."));
        }
      } finally {
        if (!cancelled) setLoadingReport(false);
      }
    }
    void loadReport();
    return () => {
      cancelled = true;
    };
  }, [
    filters.includeZero,
    hasRequiredReads,
    l,
    meta,
    reloadNonce,
    selectedBookId,
    selectedLegalEntityId,
    selectedPeriodId,
  ]);

  useEffect(() => {
    setAccountSummaryResponse(null);
    setSummaryError("");
  }, [normalizedStatementType, selectedBookId, selectedPeriodId, selectedLegalEntityId]);

  async function handleOpenAccountSummary(rowKey) {
    if (!selectedBookId || !selectedPeriodId) return;
    setLoadingSummary(true);
    setSummaryError("");
    try {
      const response = await getLocalStatementAccountSummary({
        statementType: normalizedStatementType,
        statementRowKey: rowKey,
        legalEntityId: selectedLegalEntityId || undefined,
        bookId: selectedBookId,
        fiscalPeriodId: selectedPeriodId,
      });
      setAccountSummaryResponse(response || null);
    } catch (err) {
      setAccountSummaryResponse(null);
      setSummaryError(
        err?.response?.data?.message ||
          l("Failed to load statement account summary.", "Finansal tablo hesap ozeti yuklenemedi."),
      );
    } finally {
      setLoadingSummary(false);
    }
  }

  function setFilterValue(key, value) {
    setFilters((prev) => {
      if (key === "legalEntityId") return { ...prev, legalEntityId: value, bookId: "", fiscalPeriodId: "" };
      if (key === "bookId") return { ...prev, bookId: value, fiscalPeriodId: "" };
      return { ...prev, [key]: value };
    });
  }

  const legalEntityOptions = legalEntities.map((row) => ({
    value: String(row.id),
    label: row.code ? `${row.code} - ${row.name}` : row.name || String(row.id),
    description: l("Legal entity", "Yasal varlik"),
  }));
  const bookOptions = books.map((row) => ({
    value: String(row.id),
    label: row.code ? `${row.code} - ${row.name}` : row.name || String(row.id),
    description: String(row.base_currency_code || "").toUpperCase(),
  }));
  const periodOptions = periods.map((row) => ({
    value: String(row.id),
    label: formatPeriodLabel(row),
    description: `${String(row.start_date || "").slice(0, 10)} -> ${String(row.end_date || "").slice(0, 10)}`,
  }));

  if (!hasRequiredReads) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-900">{meta.title}</h1>
          <p className="mt-2 text-sm text-slate-600">
            {l(
              "RP05 local statement pages are live, but the current repo still needs the report permission plus the basic entity/book/period lookup reads for this first-pass page.",
              "RP05 yerel finansal tablo sayfalari artik canli, ancak mevcut repo bu ilk gecis sayfasi icin rapor yetkisine ek olarak temel varlik/defter/donem lookup okumalarina halen ihtiyac duyuyor.",
            )}
          </p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="font-semibold">{l("Additional permissions currently required", "Su anda gereken ek yetkiler")}</div>
          <div className="mt-2 font-mono text-xs text-amber-800">{missingPermissions.join(", ")}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">{meta.title}</h1>
            <p className="mt-2 max-w-4xl text-sm text-slate-600">{meta.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={() => setReloadNonce((prev) => prev + 1)}
            disabled={loadingReport || !selectedBookId || !selectedPeriodId}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60"
          >
            {loadingReport ? l("Refreshing...", "Yenileniyor...") : l("Refresh", "Yenile")}
          </button>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-4">
          <Combobox value={filters.legalEntityId || null} options={legalEntityOptions} onChange={(value) => setFilterValue("legalEntityId", value ? String(value) : "")} placeholder={l("Select legal entity", "Yasal varlik secin")} noOptionsText={l("No legal entities found.", "Yasal varlik bulunamadi.")} loading={loadingRefs} clearable={false} />
          <Combobox value={filters.bookId || null} options={bookOptions} onChange={(value) => setFilterValue("bookId", value ? String(value) : "")} placeholder={l("Select book", "Defter secin")} noOptionsText={l("No books found.", "Defter bulunamadi.")} loading={loadingRefs} clearable={false} />
          <Combobox value={filters.fiscalPeriodId || null} options={periodOptions} onChange={(value) => setFilterValue("fiscalPeriodId", value ? String(value) : "")} placeholder={l("Select fiscal period", "Mali donem secin")} noOptionsText={l("No periods found.", "Donem bulunamadi.")} loading={loadingPeriods} clearable={false} />
          <label className="flex min-h-[42px] items-center gap-3 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <input type="checkbox" checked={filters.includeZero} onChange={(event) => setFilters((prev) => ({ ...prev, includeZero: event.target.checked }))} />
            <span>{l("Include zero rows", "Sifir satirlari dahil et")}</span>
          </label>
        </div>

        <div className="mt-3 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs text-cyan-900">{meta.lockText}</div>
        <LocalCloseReportBanner
          searchParams={searchParams}
          reportKey={reportKey}
          routePath={routePath}
          reportResponse={reportResponse}
          buildResponseSnapshot={buildStatementResponseSnapshot}
          canReview={canReviewLocalClose}
          l={l}
        />
      </section>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
      {reportWarnings.map((warning) => <div key={warning} className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{warning}</div>)}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{l("Report Context", "Rapor Baglami")}</h2>
            <p className="mt-1 text-sm text-slate-600">{l("The header makes the RP05 statement contract explicit instead of borrowing the consolidation contract.", "Baslik RP05 finansal tablo sozlesmesini konsolidasyon sozlesmesinden odunc almadan acik hale getirir.")}</p>
          </div>
          <div className="text-xs text-slate-500">
            {loadingReport ? l("Loading statement rows...", "Finansal tablo satirlari yukleniyor...") : l("Rows loaded", "Yuklenen satir")} <span className="font-semibold text-slate-700">{reportRows.length}</span>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{l("Entity / Book", "Varlik / Defter")}</div><div className="mt-1 text-sm font-semibold text-slate-900">{selectedEntity?.code ? `${selectedEntity.code} / ${selectedBook?.code || "-"}` : selectedBook?.code || "-"}</div><div className="mt-1 text-xs text-slate-600">{selectedEntity?.name || "-"} | {selectedBook?.name || "-"}</div></div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{l("Period Basis", "Donem Bazi")}</div><div className="mt-1 text-sm font-semibold text-slate-900">{formatPeriodLabel(selectedPeriod)}</div><div className="mt-1 text-xs text-slate-600">{reportContract.statementBasis || "-"} | {reportRange.periodEndDate || "-"}</div></div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{l("Mapping / Currency", "Esleme / Para Birimi")}</div><div className="mt-1 text-sm font-semibold text-slate-900">{currencyCode || "-"}</div><div className="mt-1 text-xs text-slate-600">{reportContract.mappingSource || "-"}</div></div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{l("Current-Year Result", "Cari Donem Sonucu")}</div><div className="mt-1 text-sm font-semibold text-slate-900">{reportContract.currentYearResultPolicy || "-"}</div><div className="mt-1 text-xs text-slate-600">{reportContract.retainedEarningsPolicy || "-"}</div></div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {meta.totals.map(([key, label]) => (
            <div key={key} className="rounded-xl border border-slate-200 px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
              <div className="mt-2 text-lg font-semibold text-slate-900"><MoneyText amount={reportTotals[key]} currencyCode={currencyCode} /></div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{meta.title}</h2>
          <p className="mt-1 text-sm text-slate-600">{l("Statement rows open account summary first, then ledger detail, so totals stay explainable row by row.", "Toplamlar satir satir aciklanabilir kalsin diye finansal tablo satirlari once hesap ozetini, sonra defter detayini acar.")}</p>
        </div>
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-600"><tr><th className="px-3 py-3">{l("Statement Row", "Finansal Tablo Satiri")}</th><th className="px-3 py-3">{l("Section", "Bolum")}</th><th className="px-3 py-3">{l("Accounts", "Hesaplar")}</th><th className="px-3 py-3">{l("Amount", "Tutar")}</th><th className="px-3 py-3">{l("Drillthrough", "Drillthrough")}</th></tr></thead>
            <tbody>
              {reportRows.map((row) => {
                const rowClasses =
                  row.rowKind === "CHECK"
                    ? Math.abs(Number(row.amount || 0)) < 0.0001 ? "bg-emerald-50/70" : "bg-rose-50/60"
                    : row.rowKind === "TOTAL"
                      ? "bg-slate-50/70"
                      : "bg-white";
                return (
                  <tr key={row.key} className={`border-t border-slate-100 ${rowClasses}`}>
                    <td className="px-3 py-3"><button type="button" disabled={!row.drillthroughEnabled || loadingSummary} onClick={() => handleOpenAccountSummary(row.key)} className="text-left font-semibold text-cyan-700 hover:underline disabled:cursor-not-allowed disabled:text-slate-500">{row.label}</button></td>
                    <td className="px-3 py-3 text-slate-600">{row.section || "-"}</td>
                    <td className="px-3 py-3 text-slate-600">{row.accountCount || 0}</td>
                    <td className="px-3 py-3 font-medium text-slate-900"><MoneyText amount={row.amount} currencyCode={currencyCode} /></td>
                    <td className="px-3 py-3"><button type="button" disabled={!row.drillthroughEnabled || loadingSummary} onClick={() => handleOpenAccountSummary(row.key)} className="rounded border border-cyan-300 px-2 py-1 text-xs font-semibold text-cyan-700 hover:bg-cyan-50 disabled:opacity-60">{loadingSummary ? l("Loading...", "Yukleniyor...") : row.drillthroughEnabled ? l("Open Accounts", "Hesaplari Ac") : l("No Detail", "Detay Yok")}</button></td>
                  </tr>
                );
              })}
              {reportRows.length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-slate-500">{loadingReport ? l("Loading statement rows...", "Finansal tablo satirlari yukleniyor...") : l("No statement rows found for the selected scope.", "Secilen kapsam icin finansal tablo satiri bulunamadi.")}</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{l("Account Summary Drillthrough", "Hesap Ozeti Drillthrough")}</h2>
            <p className="mt-1 text-sm text-slate-600">{l("This is the explicit middle step between statement rows and ledger detail required by Track 51.", "Bu, Track 51'in gerektirdigi finansal tablo satirlari ile defter detayi arasindaki acik ara adimdir.")}</p>
          </div>
          {accountSummaryResponse?.statementRow ? <div className="rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs text-cyan-900">{accountSummaryResponse.statementRow.label}</div> : null}
        </div>

        {summaryError ? <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{summaryError}</div> : null}
        {!accountSummaryResponse && !summaryError ? <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-600">{loadingSummary ? l("Loading statement account summary...", "Finansal tablo hesap ozeti yukleniyor...") : l("Select a statement row to load the supporting account summary.", "Destekleyen hesap ozetini yuklemek icin bir finansal tablo satiri secin.")}</div> : null}

        {accountSummaryResponse ? (
          <>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{l("Statement Row", "Finansal Tablo Satiri")}</div><div className="mt-1 text-sm font-semibold text-slate-900">{accountSummaryResponse.statementRow?.label || "-"}</div><div className="mt-1 text-xs text-slate-600">{accountSummaryResponse.statementRow?.rowKind || "-"}</div></div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{l("Ledger Range", "Defter Araligi")}</div><div className="mt-1 text-sm font-semibold text-slate-900">{accountSummaryResponse.range?.periodLabel || "-"}</div><div className="mt-1 text-xs text-slate-600">{accountSummaryResponse.drillthrough?.fiscalPeriodIdFrom || "-"} - {accountSummaryResponse.drillthrough?.fiscalPeriodIdTo || "-"}</div></div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{l("Statement Amount", "Finansal Tablo Tutari")}</div><div className="mt-1 text-sm font-semibold text-slate-900"><MoneyText amount={accountSummaryResponse.summary?.amount} currencyCode={currencyCode} /></div><div className="mt-1 text-xs text-slate-600">{l("Accounts", "Hesaplar")}: {accountSummaryResponse.summary?.accountCount || 0}</div></div>
            </div>

            <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-slate-600"><tr><th className="px-3 py-3">{l("Account", "Hesap")}</th><th className="px-3 py-3">{l("Debit", "Borc")}</th><th className="px-3 py-3">{l("Credit", "Alacak")}</th><th className="px-3 py-3">{l("Contribution", "Katki")}</th><th className="px-3 py-3">{l("Ledger Detail", "Defter Detayi")}</th></tr></thead>
                <tbody>
                  {(accountSummaryResponse.rows || []).map((row) => {
                    const ledgerLocation = buildLocalReportLocation("generalLedger", {
                      legalEntityId: selectedLegalEntityId || undefined,
                      bookId: selectedBookId || undefined,
                      fiscalPeriodIdFrom: accountSummaryResponse.drillthrough?.fiscalPeriodIdFrom || undefined,
                      fiscalPeriodIdTo: accountSummaryResponse.drillthrough?.fiscalPeriodIdTo || undefined,
                      accountId: row.accountId || undefined,
                      closePackId: searchParams.get("closePackId") || undefined,
                      closeLaunchMode: searchParams.get("closeLaunchMode") || undefined,
                    });
                    return (
                      <tr key={row.accountId} className="border-t border-slate-100 bg-white">
                        <td className="px-3 py-3 text-slate-800"><div className="font-semibold">{row.accountCode} - {row.accountName}</div><div className="mt-1 text-xs text-slate-500">{row.accountType || "-"} | {row.normalSide || "-"}</div></td>
                        <td className="px-3 py-3 text-slate-700"><MoneyText amount={row.debitTotal} currencyCode={currencyCode} /></td>
                        <td className="px-3 py-3 text-slate-700"><MoneyText amount={row.creditTotal} currencyCode={currencyCode} /></td>
                        <td className="px-3 py-3 font-medium text-slate-900"><MoneyText amount={row.contributionAmount} currencyCode={currencyCode} /></td>
                        <td className="px-3 py-3"><Link to={ledgerLocation} className="rounded border border-cyan-300 px-2 py-1 text-xs font-semibold text-cyan-700 hover:bg-cyan-50">{l("Open Ledger", "Defteri Ac")}</Link></td>
                      </tr>
                    );
                  })}
                  {(accountSummaryResponse.rows || []).length === 0 ? <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-slate-500">{loadingSummary ? l("Loading statement account summary...", "Finansal tablo hesap ozeti yukleniyor...") : l("No supporting accounts found for the selected statement row.", "Secilen finansal tablo satiri icin destekleyen hesap bulunamadi.")}</td></tr> : null}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}
