
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Combobox from "../components/Combobox.jsx";
import MoneyText from "../components/MoneyText.jsx";
import { listAccounts, listBooks } from "../api/glAdmin.js";
import {
  getGeneralLedgerReport,
  normalizeLocalReportParams,
} from "../api/glReports.js";
import { listFiscalPeriods, listLegalEntities } from "../api/orgAdmin.js";
import { useAuth } from "../auth/useAuth.js";
import { useI18n } from "../i18n/useI18n.js";
import { resolveSourceLinkDestination } from "../utils/journalSourceLinkDestinations.js";
const PERIOD_BASIS_OPTIONS = Object.freeze([
  { value: "FISCAL_PERIOD", label: "Fiscal Period" },
  { value: "DATE_RANGE", label: "Date Range" },
]);
const LEDGER_SORT_OPTIONS = Object.freeze([
  { value: "ENTRY_DATE", label: "Posting Date" },
  { value: "JOURNAL_NO", label: "Journal No" },
  { value: "REFERENCE_NO", label: "Reference No" },
  { value: "DOCUMENT_DATE", label: "Document Date" },
]);
const SORT_DIRECTION_OPTIONS = Object.freeze([
  { value: "ASC", label: "Ascending" },
  { value: "DESC", label: "Descending" },
]);
const PAGE_SIZE_OPTIONS = Object.freeze([
  { value: "50", label: "50 rows" },
  { value: "100", label: "100 rows" },
  { value: "200", label: "200 rows" },
]);
const DEFAULT_PAGE_SIZE = "50";
const DEFAULT_SORT_BY = "ENTRY_DATE";
const DEFAULT_SORT_DIRECTION = "ASC";
const REFERENCE_PERMISSION_CODES = Object.freeze([
  "org.tree.read",
  "gl.book.read",
  "gl.account.read",
  "org.fiscal_period.read",
]);
function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;}
function normalizePositiveIntText(value) {
  const parsed = toPositiveInt(value);
  return parsed ? String(parsed) : "";}
function normalizeDateText(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim())
    ? String(value).trim().slice(0, 10)
    : "";}
function normalizePageSize(value) {
  const normalized = String(value || "").trim();
  return PAGE_SIZE_OPTIONS.some((option) => option.value === normalized)
    ? normalized
    : DEFAULT_PAGE_SIZE;}
function normalizeOffsetText(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? String(parsed) : "0";}
function normalizeSortBy(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return LEDGER_SORT_OPTIONS.some((option) => option.value === normalized)
    ? normalized
    : DEFAULT_SORT_BY;}
function normalizeSortDirection(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized === "DESC" ? "DESC" : DEFAULT_SORT_DIRECTION;}
function formatPeriodLabel(row) {
  if (!row) {
    return "-";
  }
  return `FY${row.fiscal_year} P${String(row.period_no).padStart(2, "0")} - ${row.period_name}`;}
function hasRowId(rows, id) {
  return rows.some((row) => Number(row?.id) === Number(id));}
function createInitialFilters(searchParams) {
  const params = normalizeLocalReportParams(
    Object.fromEntries((searchParams || new URLSearchParams()).entries())
  );
  const fiscalPeriodId = normalizePositiveIntText(params.fiscalPeriodId);
  const fiscalPeriodIdFrom =
    normalizePositiveIntText(params.fiscalPeriodIdFrom) || fiscalPeriodId;
  const fiscalPeriodIdTo =
    normalizePositiveIntText(params.fiscalPeriodIdTo) || fiscalPeriodId;
  const dateFrom = normalizeDateText(params.dateFrom);
  const dateTo = normalizeDateText(params.dateTo);
  const periodBasis =
    dateFrom || dateTo ? "DATE_RANGE" : "FISCAL_PERIOD";
  return {
    legalEntityId: normalizePositiveIntText(params.legalEntityId),
    bookId: normalizePositiveIntText(params.bookId),
    accountId: normalizePositiveIntText(params.accountId),
    periodBasis,
    fiscalPeriodIdFrom,
    fiscalPeriodIdTo,
    dateFrom,
    dateTo,
    limit: normalizePageSize(params.limit),
    offset: normalizeOffsetText(params.offset),
    sortBy: normalizeSortBy(params.sortBy),
    sortDirection: normalizeSortDirection(params.sortDirection),
  };}
function areFiltersEqual(left, right) {
  return (
    String(left?.legalEntityId || "") === String(right?.legalEntityId || "") &&
    String(left?.bookId || "") === String(right?.bookId || "") &&
    String(left?.accountId || "") === String(right?.accountId || "") &&
    String(left?.periodBasis || "") === String(right?.periodBasis || "") &&
    String(left?.fiscalPeriodIdFrom || "") ===
      String(right?.fiscalPeriodIdFrom || "") &&
    String(left?.fiscalPeriodIdTo || "") === String(right?.fiscalPeriodIdTo || "") &&
    String(left?.dateFrom || "") === String(right?.dateFrom || "") &&
    String(left?.dateTo || "") === String(right?.dateTo || "") &&
    String(left?.limit || "") === String(right?.limit || "") &&
    String(left?.offset || "") === String(right?.offset || "") &&
    String(left?.sortBy || "") === String(right?.sortBy || "") &&
    String(left?.sortDirection || "") === String(right?.sortDirection || "")
  );}
function buildLedgerSearchParams(filters) {
  const periodBasis = String(filters?.periodBasis || "FISCAL_PERIOD").toUpperCase();
  const params = normalizeLocalReportParams({
    legalEntityId: toPositiveInt(filters?.legalEntityId) || undefined,
    bookId: toPositiveInt(filters?.bookId) || undefined,
    accountId: toPositiveInt(filters?.accountId) || undefined,
  });
  if (periodBasis === "DATE_RANGE") {
    params.dateFrom = normalizeDateText(filters?.dateFrom) || undefined;
    params.dateTo = normalizeDateText(filters?.dateTo) || undefined;
  } else {
    const fiscalPeriodIdFrom = normalizePositiveIntText(filters?.fiscalPeriodIdFrom);
    const fiscalPeriodIdTo = normalizePositiveIntText(filters?.fiscalPeriodIdTo);
    if (fiscalPeriodIdFrom && fiscalPeriodIdFrom === fiscalPeriodIdTo) {
      params.fiscalPeriodId = fiscalPeriodIdFrom;
    } else {
      params.fiscalPeriodIdFrom = fiscalPeriodIdFrom || undefined;
      params.fiscalPeriodIdTo = fiscalPeriodIdTo || undefined;
    }
  }
  if (String(filters?.limit || DEFAULT_PAGE_SIZE) !== DEFAULT_PAGE_SIZE) {
    params.limit = normalizePageSize(filters?.limit);
  }
  if (String(filters?.offset || "0") !== "0") {
    params.offset = normalizeOffsetText(filters?.offset);
  }
  if (normalizeSortBy(filters?.sortBy) !== DEFAULT_SORT_BY) {
    params.sortBy = normalizeSortBy(filters?.sortBy);
  }
  if (normalizeSortDirection(filters?.sortDirection) !== DEFAULT_SORT_DIRECTION) {
    params.sortDirection = normalizeSortDirection(filters?.sortDirection);
  }
  const nextParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    nextParams.set(key, String(value));
  }
  return nextParams;}
function buildSourceActions(sourceLinks = [], l) {
  const seen = new Set();
  return (Array.isArray(sourceLinks) ? sourceLinks : [])
    .map((sourceLink) => {
      const route =
        resolveSourceLinkDestination(sourceLink) ||
        String(sourceLink?.destination?.route || "").trim() ||
        null;
      if (!route || seen.has(route)) {
        return null;
      }
      seen.add(route);
      const sourceRefType = String(
        sourceLink?.source_ref_type || sourceLink?.sourceRefType || ""
      )
        .trim()
        .toUpperCase();
      if (sourceRefType === "CARI_DOCUMENT") {
        return { route, label: l("Open Document", "Belgeyi Ac") };
      }
      if (sourceRefType === "CARI_SETTLEMENT_BATCH") {
        return { route, label: l("Open Settlement", "Mahsuplastirmayi Ac") };
      }
      if (sourceRefType === "PAYMENT_BATCH") {
        return { route, label: l("Open Payment Batch", "Odeme Batch'ini Ac") };
      }
      if (sourceRefType === "FIXED_ASSET_TRANSACTION") {
        return { route, label: l("Open Asset Transaction", "Demirbas Hareketini Ac") };
      }
      if (sourceRefType === "FIXED_ASSET_DEPRECIATION_RUN") {
        return { route, label: l("Open Depreciation Run", "Amortisman Run'ini Ac") };
      }
      return { route, label: l("Open Source", "Kaynagi Ac") };
    })
    .filter(Boolean);}
function formatRangeLabel(reportRange) {
  if (!reportRange) {
    return "-";
  }
  if (String(reportRange.periodBasis || "").toUpperCase() === "DATE_RANGE") {
    return `${reportRange.startDate || "-"} -> ${reportRange.endDate || "-"}`;
  }
  const fromLabel = String(reportRange.fromPeriodLabel || "").trim();
  const toLabel = String(reportRange.toPeriodLabel || "").trim();
  if (fromLabel && toLabel && fromLabel !== toLabel) {
    return `${fromLabel} -> ${toLabel}`;
  }
  return fromLabel || toLabel || "-";}
/**
 * Render the shared report-grade Defter-i Kebir page for local posted ledger detail.
 */
export default function GeneralLedgerPage() {
  const { hasPermission } = useAuth();
  const { language } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const isTr = language === "tr";
  const l = useCallback((en, tr) => (isTr ? tr : en), [isTr]);
  const canReadOrgTree = hasPermission("org.tree.read");
  const canReadBooks = hasPermission("gl.book.read");
  const canReadAccounts = hasPermission("gl.account.read");
  const canReadPeriods = hasPermission("org.fiscal_period.read");
  const missingReferencePermissions = REFERENCE_PERMISSION_CODES.filter(
    (permissionCode) => !hasPermission(permissionCode)
  );
  const [filters, setFilters] = useState(() => createInitialFilters(searchParams));
  const [loadingRefs, setLoadingRefs] = useState(false);
  const [loadingPeriods, setLoadingPeriods] = useState(false);
  const [loadingReport, setLoadingReport] = useState(false);
  const [error, setError] = useState("");
  const [referenceWarning, setReferenceWarning] = useState("");
  const [legalEntities, setLegalEntities] = useState([]);
  const [books, setBooks] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [reportResponse, setReportResponse] = useState(null);
  const selectedLegalEntityId = toPositiveInt(filters.legalEntityId);
  const selectedBookId = toPositiveInt(filters.bookId);
  const selectedAccountId = toPositiveInt(filters.accountId);
  const selectedBook = useMemo(
    () => books.find((row) => Number(row?.id) === Number(selectedBookId)) || null,
    [books, selectedBookId]
  );
  const selectedAccount = useMemo(
    () => accounts.find((row) => Number(row?.id) === Number(selectedAccountId)) || null,
    [accounts, selectedAccountId]
  );
  const selectedEntity = useMemo(
    () =>
      legalEntities.find((row) => Number(row?.id) === Number(selectedLegalEntityId)) || null,
    [legalEntities, selectedLegalEntityId]
  );
  const reportRows = Array.isArray(reportResponse?.rows) ? reportResponse.rows : [];
  const reportSummary = reportResponse?.summary || {
    openingBalance: 0,
    debitTotal: 0,
    creditTotal: 0,
    closingBalance: 0,
    totalRows: 0,
  };
  const reportFilters = reportResponse?.filters || {};
  const reportBook = reportResponse?.book || null;
  const reportAccount = reportResponse?.account || null;
  const reportRange = reportResponse?.range || null;
  const bookBaseCurrencyCode = String(
    reportBook?.baseCurrencyCode || selectedBook?.base_currency_code || ""
  ).toUpperCase();
  const currentLimit = Number(filters.limit || DEFAULT_PAGE_SIZE);
  const currentOffset = Number(filters.offset || 0);
  const currentPage = Math.floor(currentOffset / currentLimit) + 1;
  const totalPages = Math.max(
    1,
    Math.ceil(Number(reportResponse?.total || reportSummary.totalRows || 0) / currentLimit || 1)
  );
  useEffect(() => {
    const nextFilters = createInitialFilters(searchParams);
    setFilters((prev) => (areFiltersEqual(prev, nextFilters) ? prev : nextFilters));
  }, [searchParams]);
  useEffect(() => {
    const nextParams = buildLedgerSearchParams(filters);
    const nextQuery = nextParams.toString();
    const currentQuery = searchParams.toString();
    if (nextQuery !== currentQuery) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [filters, searchParams, setSearchParams]);
  useEffect(() => {
    let cancelled = false;
    async function loadReferences() {
      if (!canReadOrgTree && !canReadBooks && !canReadAccounts) {
        setLegalEntities([]);
        setBooks([]);
        setAccounts([]);
        setReferenceWarning(
          l(
            "Direct report reads still work with preset query params, but selector lookups need the legacy org/book/account read permissions for now.",
            "Dogrudan rapor okumalari hazir query parametreleriyle calisabilir, ancak secici lookup'lari simdilik legacy org/defter/hesap okuma yetkilerine ihtiyac duyar."
          )
        );
        return;
      }
      setLoadingRefs(true);
      setReferenceWarning("");
      try {
        const [entityResponse, bookResponse, accountResponse] = await Promise.all([
          canReadOrgTree
            ? listLegalEntities({ limit: 500, includeInactive: true })
            : Promise.resolve({ rows: [] }),
          canReadBooks
            ? listBooks(
                selectedLegalEntityId ? { legalEntityId: selectedLegalEntityId } : {}
              )
            : Promise.resolve({ rows: [] }),
          canReadAccounts
            ? listAccounts(
                selectedLegalEntityId
                  ? { legalEntityId: selectedLegalEntityId, limit: 1000 }
                  : { limit: 1000 }
              )
            : Promise.resolve({ rows: [] }),
        ]);
        if (cancelled) {
          return;
        }
        const nextEntities = Array.isArray(entityResponse?.rows) ? entityResponse.rows : [];
        const nextBooks = Array.isArray(bookResponse?.rows) ? bookResponse.rows : [];
        const nextAccounts = Array.isArray(accountResponse?.rows)
          ? accountResponse.rows
          : [];
        setLegalEntities(nextEntities);
        setBooks(nextBooks);
        setAccounts(nextAccounts);
        setFilters((prev) => {
          const next = { ...prev };
          if (!prev.legalEntityId && nextEntities[0]?.id) {
            next.legalEntityId = String(nextEntities[0].id);
          }
          if (!prev.bookId && nextBooks[0]?.id) {
            next.bookId = String(nextBooks[0].id);
          }
          return areFiltersEqual(prev, next) ? prev : next;
        });
      } catch (err) {
        if (!cancelled) {
          setReferenceWarning(
            err?.response?.data?.message ||
              l(
                "Reference lookup lists could not be loaded. Preset report URLs still remain usable.",
                "Referans lookup listeleri yuklenemedi. Hazir rapor URL'leri yine de kullanilabilir."
              )
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingRefs(false);
        }
      }
    }
    void loadReferences();
    return () => {
      cancelled = true;
    };
  }, [canReadAccounts, canReadBooks, canReadOrgTree, l, selectedLegalEntityId]);
  useEffect(() => {
    let cancelled = false;
    async function loadPeriods() {
      if (!canReadPeriods || !selectedBookId) {
        setPeriods([]);
        return;
      }
      const calendarId = toPositiveInt(selectedBook?.calendar_id);
      if (!calendarId) {
        setPeriods([]);
        return;
      }
      setLoadingPeriods(true);
      try {
        const response = await listFiscalPeriods(calendarId, { limit: 500 });
        if (cancelled) {
          return;
        }
        const nextPeriods = Array.isArray(response?.rows) ? response.rows : [];
        setPeriods(nextPeriods);
        setFilters((prev) => {
          if (String(prev.periodBasis || "FISCAL_PERIOD").toUpperCase() !== "FISCAL_PERIOD") {
            return prev;
          }
          const next = { ...prev };
          if (!prev.fiscalPeriodIdFrom && nextPeriods[0]?.id) {
            next.fiscalPeriodIdFrom = String(nextPeriods[0].id);
          }
          if (!prev.fiscalPeriodIdTo && nextPeriods[0]?.id) {
            next.fiscalPeriodIdTo = String(nextPeriods[0].id);
          }
          if (
            prev.fiscalPeriodIdFrom &&
            !hasRowId(nextPeriods, prev.fiscalPeriodIdFrom) &&
            nextPeriods[0]?.id
          ) {
            next.fiscalPeriodIdFrom = String(nextPeriods[0].id);
          }
          if (
            prev.fiscalPeriodIdTo &&
            !hasRowId(nextPeriods, prev.fiscalPeriodIdTo) &&
            nextPeriods[0]?.id
          ) {
            next.fiscalPeriodIdTo = String(nextPeriods[0].id);
          }
          return areFiltersEqual(prev, next) ? prev : next;
        });
      } catch (err) {
        if (!cancelled) {
          setReferenceWarning(
            err?.response?.data?.message ||
              l("Fiscal periods could not be loaded.", "Mali donemler yuklenemedi.")
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingPeriods(false);
        }
      }
    }
    void loadPeriods();
    return () => {
      cancelled = true;
    };
  }, [canReadPeriods, l, selectedBook, selectedBookId]);
  const loadLedgerReport = useCallback(async () => {
    if (!selectedBookId || !selectedAccountId) {
      setReportResponse(null);
      return;
    }
    const periodBasis = String(filters.periodBasis || "FISCAL_PERIOD").toUpperCase();
    const hasPeriodRange =
      periodBasis === "FISCAL_PERIOD" &&
      toPositiveInt(filters.fiscalPeriodIdFrom) &&
      toPositiveInt(filters.fiscalPeriodIdTo);
    const hasDateRange =
      periodBasis === "DATE_RANGE" &&
      normalizeDateText(filters.dateFrom) &&
      normalizeDateText(filters.dateTo);
    if (!hasPeriodRange && !hasDateRange) {
      setReportResponse(null);
      return;
    }
    setLoadingReport(true);
    setError("");
    try {
      const params = {
        legalEntityId: selectedLegalEntityId || undefined,
        bookId: selectedBookId,
        accountId: selectedAccountId,
        limit: filters.limit,
        offset: filters.offset,
        sortBy: filters.sortBy,
        sortDirection: filters.sortDirection,
      };
      if (periodBasis === "DATE_RANGE") {
        params.dateFrom = normalizeDateText(filters.dateFrom);
        params.dateTo = normalizeDateText(filters.dateTo);
      } else {
        const fiscalPeriodIdFrom = normalizePositiveIntText(filters.fiscalPeriodIdFrom);
        const fiscalPeriodIdTo = normalizePositiveIntText(filters.fiscalPeriodIdTo);
        if (fiscalPeriodIdFrom && fiscalPeriodIdFrom === fiscalPeriodIdTo) {
          params.fiscalPeriodId = fiscalPeriodIdFrom;
        } else {
          params.fiscalPeriodIdFrom = fiscalPeriodIdFrom;
          params.fiscalPeriodIdTo = fiscalPeriodIdTo;
        }
      }
      const response = await getGeneralLedgerReport(params);
      setReportResponse(response || null);
    } catch (err) {
      setReportResponse(null);
      setError(
        err?.response?.data?.message ||
          l("Ledger detail could not be loaded.", "Defter detayi yuklenemedi.")
      );
    } finally {
      setLoadingReport(false);
    }
  }, [filters, l, selectedAccountId, selectedBookId, selectedLegalEntityId]);
  useEffect(() => {
    void loadLedgerReport();
  }, [loadLedgerReport]);
  const legalEntityOptions = useMemo(
    () =>
      legalEntities.map((row) => ({
        value: String(row.id),
        label: row.code ? `${row.code} - ${row.name}` : row.name || String(row.id),
        description: l("Legal entity", "Yasal varlik"),
      })),
    [l, legalEntities]
  );
  const bookOptions = useMemo(
    () =>
      books.map((row) => ({
        value: String(row.id),
        label: row.code ? `${row.code} - ${row.name}` : row.name || String(row.id),
        description: String(row.base_currency_code || "").toUpperCase(),
      })),
    [books]
  );
  const accountOptions = useMemo(
    () =>
      accounts.map((row) => ({
        value: String(row.id),
        label: row.code ? `${row.code} - ${row.name}` : row.name || String(row.id),
        description: row.account_breadcrumb || "",
      })),
    [accounts]
  );
  const periodOptions = useMemo(
    () =>
      periods.map((row) => ({
        value: String(row.id),
        label: formatPeriodLabel(row),
        description: `${String(row.start_date || "").slice(0, 10)} -> ${String(
          row.end_date || ""
        ).slice(0, 10)}`,
      })),
    [periods]
  );
  function setFilterValue(key, value) {
    setFilters((prev) => {
      if (key === "legalEntityId") {
        return {
          ...prev,
          legalEntityId: value,
          bookId: "",
          accountId: "",
          fiscalPeriodIdFrom: "",
          fiscalPeriodIdTo: "",
          offset: "0",
        };
      }
      if (key === "bookId") {
        return {
          ...prev,
          bookId: value,
          fiscalPeriodIdFrom: "",
          fiscalPeriodIdTo: "",
          offset: "0",
        };
      }
      if (key === "periodBasis") {
        const next = {
          ...prev,
          periodBasis: value,
          offset: "0",
        };
        if (value === "DATE_RANGE") {
          const fromPeriod =
            periods.find((row) => Number(row?.id) === Number(prev.fiscalPeriodIdFrom)) || null;
          const toPeriod =
            periods.find((row) => Number(row?.id) === Number(prev.fiscalPeriodIdTo)) || null;
          next.dateFrom = String(fromPeriod?.start_date || "").slice(0, 10);
          next.dateTo = String(toPeriod?.end_date || "").slice(0, 10);
        } else {
          next.dateFrom = "";
          next.dateTo = "";
          if (!next.fiscalPeriodIdFrom && periods[0]?.id) {
            next.fiscalPeriodIdFrom = String(periods[0].id);
          }
          if (!next.fiscalPeriodIdTo && periods[0]?.id) {
            next.fiscalPeriodIdTo = String(periods[0].id);
          }
        }
        return next;
      }
      return {
        ...prev,
        [key]: value,
        offset: key === "offset" ? value : "0",
      };
    });
  }
  function goToPage(nextPage) {
    const normalizedPage = Math.max(1, nextPage);
    setFilters((prev) => ({
      ...prev,
      offset: String((normalizedPage - 1) * Number(prev.limit || DEFAULT_PAGE_SIZE)),
    }));
  }
  const selectedAccountLabel =
    selectedAccount?.code && selectedAccount?.name
      ? `${selectedAccount.code} - ${selectedAccount.name}`
      : reportAccount?.code && reportAccount?.name
        ? `${reportAccount.code} - ${reportAccount.name}`
        : selectedAccountId
          ? `#${selectedAccountId}`
          : "-";
  const selectedBookLabel =
    selectedBook?.code && selectedBook?.name
      ? `${selectedBook.code} - ${selectedBook.name}`
      : reportBook?.code && reportBook?.name
        ? `${reportBook.code} - ${reportBook.name}`
        : selectedBookId
          ? `#${selectedBookId}`
          : "-";
  const selectedEntityLabel =
    selectedEntity?.code && selectedEntity?.name
      ? `${selectedEntity.code} - ${selectedEntity.name}`
      : selectedEntity?.name || (selectedLegalEntityId ? `#${selectedLegalEntityId}` : "-");
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">
              {l("Defter-i Kebir", "Defter-i Kebir")}
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              {l(
                "Review posted account movement with opening balance, running balance, journal drillthrough, and source-link drillback on one report-grade ledger surface.",
                "Acilis bakiyesi, hareketli bakiye, mahsup drillthrough'u ve kaynak baglanti drillback'i ile post edilmis hesap hareketlerini tek bir rapor-seviyesinde inceleyin."
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              void loadLedgerReport();
            }}
            disabled={loadingReport || !selectedBookId || !selectedAccountId}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60"
          >
            {loadingReport ? l("Refreshing...", "Yenileniyor...") : l("Refresh", "Yenile")}
          </button>
        </div>
        <div className="mt-4 grid gap-3 xl:grid-cols-4">
          <Combobox
            value={filters.legalEntityId || null}
            options={legalEntityOptions}
            onChange={(nextValue) =>
              setFilterValue("legalEntityId", nextValue ? String(nextValue) : "")
            }
            placeholder={l("Select legal entity", "Yasal varlik secin")}
            noOptionsText={l("No legal entities found.", "Yasal varlik bulunamadi.")}
            loading={loadingRefs}
            disabled={!canReadOrgTree}
            clearable={false}
          />
          <Combobox
            value={filters.bookId || null}
            options={bookOptions}
            onChange={(nextValue) =>
              setFilterValue("bookId", nextValue ? String(nextValue) : "")
            }
            placeholder={l("Select book", "Defter secin")}
            noOptionsText={l("No books found.", "Defter bulunamadi.")}
            loading={loadingRefs}
            disabled={!canReadBooks}
            clearable={false}
          />
          <Combobox
            value={filters.accountId || null}
            options={accountOptions}
            onChange={(nextValue) =>
              setFilterValue("accountId", nextValue ? String(nextValue) : "")
            }
            placeholder={l("Select account", "Hesap secin")}
            noOptionsText={l("No accounts found.", "Hesap bulunamadi.")}
            loading={loadingRefs}
            disabled={!canReadAccounts}
            clearable={false}
          />
          <Combobox
            value={filters.periodBasis}
            options={PERIOD_BASIS_OPTIONS.map((option) => ({
              value: option.value,
              label: l(option.label, option.value === "FISCAL_PERIOD" ? "Mali Donem" : "Tarih Araligi"),
            }))}
            onChange={(nextValue) =>
              setFilterValue(
                "periodBasis",
                String(nextValue || "FISCAL_PERIOD").toUpperCase()
              )
            }
            placeholder={l("Select basis", "Baz secin")}
            clearable={false}
          />
        </div>
        {String(filters.periodBasis || "FISCAL_PERIOD").toUpperCase() === "DATE_RANGE" ? (
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {l("Date From", "Tarih Baslangici")}
              </div>
              <input
                type="date"
                value={filters.dateFrom}
                onChange={(event) => setFilterValue("dateFrom", event.target.value)}
                className="w-full bg-transparent outline-none"
              />
            </label>
            <label className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {l("Date To", "Tarih Bitisi")}
              </div>
              <input
                type="date"
                value={filters.dateTo}
                onChange={(event) => setFilterValue("dateTo", event.target.value)}
                className="w-full bg-transparent outline-none"
              />
            </label>
            <Combobox
              value={filters.sortBy}
              options={LEDGER_SORT_OPTIONS.map((option) => ({
                value: option.value,
                label: l(option.label, option.label),
              }))}
              onChange={(nextValue) =>
                setFilterValue("sortBy", normalizeSortBy(nextValue))
              }
              clearable={false}
            />
            <Combobox
              value={filters.sortDirection}
              options={SORT_DIRECTION_OPTIONS.map((option) => ({
                value: option.value,
                label: l(option.label, option.value === "ASC" ? "Artan" : "Azalan"),
              }))}
              onChange={(nextValue) =>
                setFilterValue("sortDirection", normalizeSortDirection(nextValue))
              }
              clearable={false}
            />
          </div>
        ) : (
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Combobox
              value={filters.fiscalPeriodIdFrom || null}
              options={periodOptions}
              onChange={(nextValue) =>
                setFilterValue("fiscalPeriodIdFrom", nextValue ? String(nextValue) : "")
              }
              placeholder={l("Period from", "Donem baslangici")}
              noOptionsText={l("No periods found.", "Donem bulunamadi.")}
              loading={loadingPeriods}
              disabled={!canReadPeriods}
              clearable={false}
            />
            <Combobox
              value={filters.fiscalPeriodIdTo || null}
              options={periodOptions}
              onChange={(nextValue) =>
                setFilterValue("fiscalPeriodIdTo", nextValue ? String(nextValue) : "")
              }
              placeholder={l("Period to", "Donem bitisi")}
              noOptionsText={l("No periods found.", "Donem bulunamadi.")}
              loading={loadingPeriods}
              disabled={!canReadPeriods}
              clearable={false}
            />
            <Combobox
              value={filters.sortBy}
              options={LEDGER_SORT_OPTIONS.map((option) => ({
                value: option.value,
                label: l(option.label, option.label),
              }))}
              onChange={(nextValue) =>
                setFilterValue("sortBy", normalizeSortBy(nextValue))
              }
              clearable={false}
            />
            <Combobox
              value={filters.sortDirection}
              options={SORT_DIRECTION_OPTIONS.map((option) => ({
                value: option.value,
                label: l(option.label, option.value === "ASC" ? "Artan" : "Azalan"),
              }))}
              onChange={(nextValue) =>
                setFilterValue("sortDirection", normalizeSortDirection(nextValue))
              }
              clearable={false}
            />
          </div>
        )}
        <div className="mt-3 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs text-cyan-900">
          {l(
            "RP03 keeps Defter-i Kebir on posted local truth. OU, CENTRAL, subledger, and Muavin-specific dimensional extensions remain later steps.",
            "RP03 Defter-i Kebir'i post edilmis yerel hakikat uzerinde tutar. OU, CENTRAL, alt defter ve Muavin'e ozgu boyutsal genislemeler sonraki adimlara kalir."
          )}
        </div>
        {referenceWarning ? (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {referenceWarning}
          </div>
        ) : null}
        {missingReferencePermissions.length > 0 ? (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <div className="font-semibold">
              {l(
                "Lookup permissions still missing for fully self-service filter selection",
                "Tam self-servis filtre secimi icin lookup yetkileri hala eksik"
              )}
            </div>
            <div className="mt-1 font-mono text-[11px] text-amber-800">
              {missingReferencePermissions.join(", ")}
            </div>
          </div>
        ) : null}
      </section>
      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              {l("Report Context", "Rapor Baglami")}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {l(
                "The opening balance is computed before the selected range, and running balance continues through the in-range movements on one canonical currency basis.",
                "Acilis bakiyesi secilen araligin oncesinden hesaplanir ve hareketli bakiye aralik icindeki hareketler boyunca tek bir kanonik para birimi bazinda devam eder."
              )}
            </p>
          </div>
          <div className="text-xs text-slate-500">
            {loadingReport
              ? l("Loading ledger rows...", "Defter satirlari yukleniyor...")
              : l("Rows loaded", "Yuklenen satir")}{" "}
            <span className="font-semibold text-slate-700">
              {Number(reportResponse?.total || reportSummary.totalRows || 0)}
            </span>
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {l("Entity / Book", "Varlik / Defter")}
            </div>
            <div className="mt-1 text-sm font-semibold text-slate-900">{selectedEntityLabel}</div>
            <div className="mt-1 text-xs text-slate-600">{selectedBookLabel}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {l("Account", "Hesap")}
            </div>
            <div className="mt-1 text-sm font-semibold text-slate-900">{selectedAccountLabel}</div>
            <div className="mt-1 text-xs text-slate-600">
              {reportAccount?.includesDescendants
                ? l(
                    "Roll-up account: descendant postings included",
                    "Toplam hesap: alt hesap hareketleri dahil"
                  )
                : l("Direct account detail", "Dogrudan hesap detayi")}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {l("Range Basis", "Aralik Bazi")}
            </div>
            <div className="mt-1 text-sm font-semibold text-slate-900">
              {formatRangeLabel(reportRange)}
            </div>
            <div className="mt-1 text-xs text-slate-600">
              {(reportFilters.periodBasis || filters.periodBasis || "-")} |{" "}
              {bookBaseCurrencyCode || "-"}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {l("Sort / Page", "Siralama / Sayfa")}
            </div>
            <div className="mt-1 text-sm font-semibold text-slate-900">
              {filters.sortBy} {filters.sortDirection}
            </div>
            <div className="mt-1 text-xs text-slate-600">
              {l("Page", "Sayfa")} {currentPage} / {totalPages} | {l("Limit", "Limit")}{" "}
              {currentLimit}
            </div>
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-slate-200 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {l("Opening Balance", "Acilis Bakiyesi")}
            </div>
            <div className="mt-2 text-lg font-semibold text-slate-900">
              <MoneyText
                amount={reportSummary.openingBalance}
                currencyCode={bookBaseCurrencyCode}
              />
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {l("Debit Total", "Borc Toplami")}
            </div>
            <div className="mt-2 text-lg font-semibold text-slate-900">
              <MoneyText amount={reportSummary.debitTotal} currencyCode={bookBaseCurrencyCode} />
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {l("Credit Total", "Alacak Toplami")}
            </div>
            <div className="mt-2 text-lg font-semibold text-slate-900">
              <MoneyText amount={reportSummary.creditTotal} currencyCode={bookBaseCurrencyCode} />
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {l("Closing Balance", "Kapanis Bakiyesi")}
            </div>
            <div className="mt-2 text-lg font-semibold text-slate-900">
              <MoneyText
                amount={reportSummary.closingBalance}
                currencyCode={bookBaseCurrencyCode}
              />
            </div>
          </div>
        </div>
        {filters.sortBy !== DEFAULT_SORT_BY || filters.sortDirection !== DEFAULT_SORT_DIRECTION ? (
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            {l(
              "Running balance always follows chronological posting order even when the display sort is changed.",
              "Gorunum siralamasi degisse bile hareketli bakiye her zaman kronolojik post sirasini izler."
            )}
          </div>
        ) : null}
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              {l("Ledger Detail", "Defter Detayi")}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {l(
                "The same page now serves direct menu entry and live Mizan drillthrough on the shared RP03 contract.",
                "Ayni sayfa artik dogrudan menu girisini ve canli Mizan drillthrough'unu ortak RP03 sozlesmesiyle servis eder."
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Combobox
              value={filters.limit}
              options={PAGE_SIZE_OPTIONS.map((option) => ({
                value: option.value,
                label: l(option.label, option.value === "50" ? "50 satir" : `${option.value} satir`),
              }))}
              onChange={(nextValue) =>
                setFilterValue("limit", normalizePageSize(nextValue))
              }
              clearable={false}
              className="min-w-[10rem]"
            />
            <button
              type="button"
              onClick={() => goToPage(currentPage - 1)}
              disabled={currentPage <= 1 || loadingReport}
              className="rounded border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-60"
            >
              {l("Previous", "Onceki")}
            </button>
            <button
              type="button"
              onClick={() => goToPage(currentPage + 1)}
              disabled={currentPage >= totalPages || loadingReport}
              className="rounded border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-60"
            >
              {l("Next", "Sonraki")}
            </button>
          </div>
        </div>
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-3 py-3">{l("Posting Date", "Kayit Tarihi")}</th>
                <th className="px-3 py-3">{l("Journal No", "Fis No")}</th>
                <th className="px-3 py-3">{l("Reference No", "Referans No")}</th>
                <th className="px-3 py-3">{l("Description", "Aciklama")}</th>
                <th className="px-3 py-3">{l("Debit", "Borc")}</th>
                <th className="px-3 py-3">{l("Credit", "Alacak")}</th>
                <th className="px-3 py-3">{l("Running Balance", "Hareketli Bakiye")}</th>
                <th className="px-3 py-3">{l("Actions", "Aksiyonlar")}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-slate-100 bg-slate-50/70">
                <td className="px-3 py-3 text-slate-500">{l("Opening", "Acilis")}</td>
                <td className="px-3 py-3 text-slate-500">-</td>
                <td className="px-3 py-3 text-slate-500">-</td>
                <td className="px-3 py-3 font-medium text-slate-700">
                  {l(
                    "Opening balance before the selected range",
                    "Secilen araliktan onceki acilis bakiyesi"
                  )}
                </td>
                <td className="px-3 py-3 text-slate-500">-</td>
                <td className="px-3 py-3 text-slate-500">-</td>
                <td className="px-3 py-3 font-semibold text-slate-900">
                  <MoneyText
                    amount={reportSummary.openingBalance}
                    currencyCode={bookBaseCurrencyCode}
                  />
                </td>
                <td className="px-3 py-3 text-slate-500">-</td>
              </tr>
              {reportRows.map((row) => {
                const sourceActions = buildSourceActions(row.source_links, l);
                return (
                  <tr
                    key={`${row.journal_line_id || row.journal_id}-${row.line_no || 0}`}
                    className="border-t border-slate-100 bg-white"
                  >
                    <td className="px-3 py-3 text-slate-700">
                      {String(row.entry_date || "").slice(0, 10) || "-"}
                    </td>
                    <td className="px-3 py-3 text-slate-700">{row.journal_no || "-"}</td>
                    <td className="px-3 py-3 text-slate-700">{row.reference_no || "-"}</td>
                    <td className="px-3 py-3">
                      <div className="font-medium text-slate-800">{row.description || "-"}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {l("Line", "Satir")} {row.line_no || "-"} |{" "}
                        {String(row.document_date || "").slice(0, 10) || "-"}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-slate-700">
                      <MoneyText amount={row.debit_base} currencyCode={bookBaseCurrencyCode} />
                    </td>
                    <td className="px-3 py-3 text-slate-700">
                      <MoneyText amount={row.credit_base} currencyCode={bookBaseCurrencyCode} />
                    </td>
                    <td className="px-3 py-3 font-medium text-slate-900">
                      <MoneyText
                        amount={row.running_balance}
                        currencyCode={bookBaseCurrencyCode}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-2">
                        <Link
                          to={`/app/mahsup-islemleri?journalId=${row.journal_id}`}
                          className="rounded border border-cyan-300 px-2 py-1 text-xs font-semibold text-cyan-700 hover:bg-cyan-50"
                        >
                          {l("Open Journal", "Mahsubu Ac")}
                        </Link>
                        {sourceActions.map((action) => (
                          <Link
                            key={`${row.journal_line_id || row.journal_id}-${action.route}`}
                            to={action.route}
                            className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            {action.label}
                          </Link>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {reportRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-sm text-slate-500">
                    {loadingReport
                      ? l(
                          "Loading ledger movements...",
                          "Defter hareketleri yukleniyor..."
                        )
                      : selectedBookId && selectedAccountId
                        ? l(
                            "No posted ledger movements found for the selected scope.",
                            "Secilen kapsam icin post edilmis defter hareketi bulunamadi."
                          )
                        : l(
                            "Choose at least a book, account, and valid period/date range to load the ledger.",
                            "Defteri yuklemek icin en az bir defter, hesap ve gecerli donem/tarih araligi secin."
                          )}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );}
