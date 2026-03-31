import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Combobox from "../components/Combobox.jsx";
import MoneyText from "../components/MoneyText.jsx";
import { listAccounts, listBooks } from "../api/glAdmin.js";
import {
  getGeneralLedgerReport,
  normalizeLocalReportParams,
} from "../api/glReports.js";
import {
  listFiscalPeriods,
  listLegalEntities,
  listOperatingUnits,
} from "../api/orgAdmin.js";
import { useAuth } from "../auth/useAuth.js";
import { useI18n } from "../i18n/useI18n.js";
import { resolveSourceLinkDestination } from "../utils/journalSourceLinkDestinations.js";

const PERIOD_BASIS_OPTIONS = Object.freeze([
  ["FISCAL_PERIOD", "Fiscal Period"],
  ["DATE_RANGE", "Date Range"],
]);

const SORT_OPTIONS = Object.freeze([
  ["ENTRY_DATE", "Posting Date"],
  ["JOURNAL_NO", "Journal No"],
  ["REFERENCE_NO", "Reference No"],
  ["DOCUMENT_DATE", "Document Date"],
]);

const DIRECTION_OPTIONS = Object.freeze([
  ["ASC", "Ascending"],
  ["DESC", "Descending"],
]);

const PAGE_SIZE_OPTIONS = Object.freeze(["50", "100", "200"]);

const SOURCE_OPTIONS = Object.freeze([
  ["MANUAL", "Manual"],
  ["SYSTEM", "System"],
  ["INTERCOMPANY", "Intercompany"],
  ["ELIMINATION", "Elimination"],
  ["ADJUSTMENT", "Adjustment"],
  ["CASH", "Cash"],
]);

const STATUS_OPTIONS = Object.freeze([
  ["POSTED", "Posted"],
  ["REVERSED", "Reversed"],
  ["DRAFT", "Draft"],
  ["CANCELLED", "Cancelled"],
]);

const GROUP_OPTIONS = Object.freeze([
  ["NONE", "No grouping"],
  ["MONTH", "By month"],
  ["SOURCE_TYPE", "By source type"],
  ["OPERATING_UNIT", "By operating unit"],
  ["SUBLEDGER_REF", "By subledger ref"],
]);

const SCOPE_OPTIONS = Object.freeze([
  ["ALL", "All scopes"],
  ["OPERATING_UNIT", "One operating unit"],
  ["CENTRAL", "CENTRAL only"],
]);

const PRESET_OPTIONS = Object.freeze([
  ["GL_DETAIL", "GL detail"],
  ["SUBLEDGER_DETAIL", "Subledger detail"],
  ["POSTED_ONLY", "Posted only"],
]);

const DEFAULT_LIMIT = "50";
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
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim())
    ? String(value).trim().slice(0, 10)
    : "";
}

function normalizeText(value, max = 80) {
  return String(value || "")
    .trim()
    .slice(0, max);
}

function normalizeEnum(value, options, fallback = "") {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  return options.some(([code]) => code === normalized) ? normalized : fallback;
}

function parseBooleanFlag(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function defaultPreset(reportMode) {
  return String(reportMode || "").toUpperCase() === "MUAVIN"
    ? "SUBLEDGER_DETAIL"
    : "GL_DETAIL";
}

function defaultGroupBy(preset) {
  return String(preset || "").toUpperCase() === "SUBLEDGER_DETAIL"
    ? "SUBLEDGER_REF"
    : "NONE";
}

function formatPeriodLabel(row) {
  if (!row) {
    return "-";
  }
  return `FY${row.fiscal_year} P${String(row.period_no).padStart(
    2,
    "0",
  )} - ${row.period_name}`;
}

function hasRowId(rows, id) {
  return rows.some((row) => Number(row?.id) === Number(id));
}

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
  return fromLabel || toLabel || "-";
}

function createInitialFilters(searchParams, reportMode) {
  const params = normalizeLocalReportParams(
    Object.fromEntries((searchParams || new URLSearchParams()).entries()),
  );
  const preset = normalizeEnum(
    params.reportPreset,
    PRESET_OPTIONS,
    defaultPreset(reportMode),
  );
  const fiscalPeriodId = String(toPositiveInt(params.fiscalPeriodId) || "");
  return {
    legalEntityId: String(toPositiveInt(params.legalEntityId) || ""),
    bookId: String(toPositiveInt(params.bookId) || ""),
    accountId: String(toPositiveInt(params.accountId) || ""),
    accountCodeFrom: normalizeText(params.accountCodeFrom, 60),
    accountCodeTo: normalizeText(params.accountCodeTo, 60),
    periodBasis:
      normalizeDate(params.dateFrom) || normalizeDate(params.dateTo)
        ? "DATE_RANGE"
        : "FISCAL_PERIOD",
    fiscalPeriodIdFrom: String(
      toPositiveInt(params.fiscalPeriodIdFrom) || fiscalPeriodId || "",
    ),
    fiscalPeriodIdTo: String(
      toPositiveInt(params.fiscalPeriodIdTo) || fiscalPeriodId || "",
    ),
    dateFrom: normalizeDate(params.dateFrom),
    dateTo: normalizeDate(params.dateTo),
    operatingUnitScope: normalizeEnum(
      params.operatingUnitScope,
      SCOPE_OPTIONS,
      "ALL",
    ),
    operatingUnitId: String(toPositiveInt(params.operatingUnitId) || ""),
    subledgerReferenceNo: normalizeText(params.subledgerReferenceNo),
    sourceType: normalizeEnum(params.sourceType, SOURCE_OPTIONS, ""),
    status: normalizeEnum(params.status, STATUS_OPTIONS, ""),
    includeReversed: parseBooleanFlag(params.includeReversed, false),
    reportPreset: preset,
    groupBy: normalizeEnum(
      params.groupBy,
      GROUP_OPTIONS,
      defaultGroupBy(preset),
    ),
    limit: PAGE_SIZE_OPTIONS.includes(String(params.limit || ""))
      ? String(params.limit)
      : DEFAULT_LIMIT,
    offset: String(Math.max(0, Number(params.offset || 0)) || 0),
    sortBy: normalizeEnum(params.sortBy, SORT_OPTIONS, DEFAULT_SORT_BY),
    sortDirection: normalizeEnum(
      params.sortDirection,
      DIRECTION_OPTIONS,
      DEFAULT_SORT_DIRECTION,
    ),
  };
}

function filtersEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function buildSearchParams(filters, reportMode) {
  const params = normalizeLocalReportParams({
    legalEntityId: toPositiveInt(filters.legalEntityId) || undefined,
    bookId: toPositiveInt(filters.bookId) || undefined,
    accountId: toPositiveInt(filters.accountId) || undefined,
    accountCodeFrom: normalizeText(filters.accountCodeFrom, 60) || undefined,
    accountCodeTo: normalizeText(filters.accountCodeTo, 60) || undefined,
    operatingUnitScope:
      filters.operatingUnitScope !== "ALL"
        ? filters.operatingUnitScope
        : undefined,
    operatingUnitId: toPositiveInt(filters.operatingUnitId) || undefined,
    subledgerReferenceNo:
      normalizeText(filters.subledgerReferenceNo) || undefined,
    sourceType: filters.sourceType || undefined,
    status: filters.status || undefined,
    includeReversed: filters.includeReversed ? "true" : undefined,
    groupBy:
      filters.groupBy !== defaultGroupBy(filters.reportPreset)
        ? filters.groupBy
        : undefined,
    reportPreset:
      filters.reportPreset !== defaultPreset(reportMode)
        ? filters.reportPreset
        : undefined,
    limit: filters.limit !== DEFAULT_LIMIT ? filters.limit : undefined,
    offset: filters.offset !== "0" ? filters.offset : undefined,
    sortBy: filters.sortBy !== DEFAULT_SORT_BY ? filters.sortBy : undefined,
    sortDirection:
      filters.sortDirection !== DEFAULT_SORT_DIRECTION
        ? filters.sortDirection
        : undefined,
  });

  if (filters.periodBasis === "DATE_RANGE") {
    params.dateFrom = normalizeDate(filters.dateFrom) || undefined;
    params.dateTo = normalizeDate(filters.dateTo) || undefined;
  } else if (
    filters.fiscalPeriodIdFrom &&
    filters.fiscalPeriodIdFrom === filters.fiscalPeriodIdTo
  ) {
    params.fiscalPeriodId = filters.fiscalPeriodIdFrom;
  } else {
    params.fiscalPeriodIdFrom = filters.fiscalPeriodIdFrom || undefined;
    params.fiscalPeriodIdTo = filters.fiscalPeriodIdTo || undefined;
  }

  return new URLSearchParams(
    Object.entries(params).filter(([, value]) => value),
  );
}

function buildSourceActions(sourceLinks, l) {
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
        sourceLink?.source_ref_type || sourceLink?.sourceRefType || "",
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
        return {
          route,
          label: l("Open Asset Transaction", "Demirbas Hareketini Ac"),
        };
      }
      if (sourceRefType === "FIXED_ASSET_DEPRECIATION_RUN") {
        return {
          route,
          label: l("Open Depreciation Run", "Amortisman Run'ini Ac"),
        };
      }

      return { route, label: l("Open Source", "Kaynagi Ac") };
    })
    .filter(Boolean);
}

/**
 * Render the shared report-grade ledger page used by both Defter-i Kebir and
 * Muavin, keeping one query contract and one drillthrough surface.
 */
export default function GeneralLedgerPage({ reportMode = "GENERAL_LEDGER" }) {
  const normalizedReportMode = String(reportMode || "").toUpperCase();
  const isMuavinMode = normalizedReportMode === "MUAVIN";
  const { hasPermission } = useAuth();
  const { language } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();

  const isTr = language === "tr";
  const l = useCallback((en, tr) => (isTr ? tr : en), [isTr]);

  const [filters, setFilters] = useState(() =>
    createInitialFilters(searchParams, normalizedReportMode),
  );
  const [loadingRefs, setLoadingRefs] = useState(false);
  const [loadingPeriods, setLoadingPeriods] = useState(false);
  const [loadingReport, setLoadingReport] = useState(false);
  const [error, setError] = useState("");
  const [referenceWarning, setReferenceWarning] = useState("");
  const [legalEntities, setLegalEntities] = useState([]);
  const [books, setBooks] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [operatingUnits, setOperatingUnits] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [reportResponse, setReportResponse] = useState(null);

  const canReadOrgTree = hasPermission("org.tree.read");
  const canReadBooks = hasPermission("gl.book.read");
  const canReadAccounts = hasPermission("gl.account.read");
  const canReadPeriods = hasPermission("org.fiscal_period.read");

  const missingReferencePermissions = REFERENCE_PERMISSION_CODES.filter(
    (permissionCode) => !hasPermission(permissionCode),
  );

  const selectedLegalEntityId = toPositiveInt(filters.legalEntityId);
  const selectedBookId = toPositiveInt(filters.bookId);
  const selectedAccountId = toPositiveInt(filters.accountId);
  const selectedOperatingUnitId = toPositiveInt(filters.operatingUnitId);

  const selectedBook = useMemo(
    () =>
      books.find((row) => Number(row?.id) === Number(selectedBookId)) || null,
    [books, selectedBookId],
  );

  const selectedAccount = useMemo(
    () =>
      accounts.find((row) => Number(row?.id) === Number(selectedAccountId)) ||
      null,
    [accounts, selectedAccountId],
  );

  const selectedEntity = useMemo(
    () =>
      legalEntities.find(
        (row) => Number(row?.id) === Number(selectedLegalEntityId),
      ) || null,
    [legalEntities, selectedLegalEntityId],
  );

  const selectedOperatingUnit = useMemo(
    () =>
      operatingUnits.find(
        (row) => Number(row?.id) === Number(selectedOperatingUnitId),
      ) || null,
    [operatingUnits, selectedOperatingUnitId],
  );

  const reportRows = Array.isArray(reportResponse?.rows)
    ? reportResponse.rows
    : [];
  const reportSummary = reportResponse?.summary || {
    openingBalance: 0,
    debitTotal: 0,
    creditTotal: 0,
    closingBalance: 0,
    totalRows: 0,
  };
  const reportGrouping = reportResponse?.grouping || {
    groupBy: "NONE",
    rows: [],
  };
  const reportBook = reportResponse?.book || null;
  const reportAccount = reportResponse?.account || null;
  const reportAccountRange = reportResponse?.accountRange || null;
  const reportRange = reportResponse?.range || null;
  const reportFilters = reportResponse?.filters || {};

  const currencyCode = String(
    reportBook?.baseCurrencyCode || selectedBook?.base_currency_code || "",
  ).toUpperCase();

  const currentLimit = Math.max(
    1,
    Number(filters.limit || DEFAULT_LIMIT) || 50,
  );
  const currentOffset = Math.max(0, Number(filters.offset || 0) || 0);
  const currentPage = Math.floor(currentOffset / currentLimit) + 1;
  const totalPages = Math.max(
    1,
    Math.ceil(
      Number(reportResponse?.total || reportSummary.totalRows || 0) /
        currentLimit || 1,
    ),
  );

  const hasAccountRange = Boolean(
    filters.accountCodeFrom || filters.accountCodeTo,
  );
  const showAdvanced =
    isMuavinMode ||
    hasAccountRange ||
    filters.operatingUnitScope !== "ALL" ||
    Boolean(filters.subledgerReferenceNo) ||
    Boolean(filters.sourceType) ||
    Boolean(filters.status) ||
    Boolean(filters.includeReversed);

  useEffect(() => {
    const nextFilters = createInitialFilters(
      searchParams,
      normalizedReportMode,
    );
    setFilters((prev) =>
      filtersEqual(prev, nextFilters) ? prev : nextFilters,
    );
  }, [normalizedReportMode, searchParams]);

  useEffect(() => {
    const nextSearchParams = buildSearchParams(
      filters,
      normalizedReportMode,
    ).toString();
    const currentSearchParams = searchParams.toString();
    if (nextSearchParams !== currentSearchParams) {
      setSearchParams(buildSearchParams(filters, normalizedReportMode), {
        replace: true,
      });
    }
  }, [filters, normalizedReportMode, searchParams, setSearchParams]);

  useEffect(() => {
    let cancelled = false;

    async function loadReferences() {
      if (!canReadOrgTree && !canReadBooks && !canReadAccounts) {
        setReferenceWarning(
          l(
            "Direct report reads still work from query params, but the selectors need the legacy lookup permissions for now.",
            "Dogrudan rapor okumalari query parametreleriyle calisir, ancak seciciler simdilik legacy lookup yetkilerine ihtiyac duyar.",
          ),
        );
        setLegalEntities([]);
        setBooks([]);
        setAccounts([]);
        setOperatingUnits([]);
        return;
      }

      setLoadingRefs(true);
      setReferenceWarning("");

      try {
        const [entityResponse, bookResponse, accountResponse, unitResponse] =
          await Promise.all([
            canReadOrgTree
              ? listLegalEntities({ limit: 500, includeInactive: true })
              : Promise.resolve({ rows: [] }),
            canReadBooks
              ? listBooks(
                  selectedLegalEntityId
                    ? { legalEntityId: selectedLegalEntityId }
                    : {},
                )
              : Promise.resolve({ rows: [] }),
            canReadAccounts
              ? listAccounts(
                  selectedLegalEntityId
                    ? { legalEntityId: selectedLegalEntityId, limit: 1000 }
                    : { limit: 1000 },
                )
              : Promise.resolve({ rows: [] }),
            canReadOrgTree
              ? listOperatingUnits(
                  selectedLegalEntityId
                    ? { legalEntityId: selectedLegalEntityId, limit: 1000 }
                    : { limit: 1000 },
                )
              : Promise.resolve({ rows: [] }),
          ]);

        if (cancelled) {
          return;
        }

        const nextEntities = Array.isArray(entityResponse?.rows)
          ? entityResponse.rows
          : [];
        const nextBooks = Array.isArray(bookResponse?.rows)
          ? bookResponse.rows
          : [];
        const nextAccounts = Array.isArray(accountResponse?.rows)
          ? accountResponse.rows
          : [];
        const nextUnits = Array.isArray(unitResponse?.rows)
          ? unitResponse.rows
          : [];

        setLegalEntities(nextEntities);
        setBooks(nextBooks);
        setAccounts(nextAccounts);
        setOperatingUnits(nextUnits);

        setFilters((prev) => {
          const next = { ...prev };
          if (!prev.legalEntityId && nextEntities[0]?.id) {
            next.legalEntityId = String(nextEntities[0].id);
          }
          if (!prev.bookId && nextBooks[0]?.id) {
            next.bookId = String(nextBooks[0].id);
          }
          if (
            prev.operatingUnitId &&
            !hasRowId(nextUnits, prev.operatingUnitId)
          ) {
            next.operatingUnitId = "";
            next.operatingUnitScope = "ALL";
          }
          return filtersEqual(prev, next) ? prev : next;
        });
      } catch (err) {
        if (!cancelled) {
          setReferenceWarning(
            err?.response?.data?.message ||
              l(
                "Reference lookups could not be loaded.",
                "Referans lookup'lari yuklenemedi.",
              ),
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
      const calendarId = toPositiveInt(selectedBook?.calendar_id);
      if (!canReadPeriods || !selectedBookId || !calendarId) {
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
          if (prev.periodBasis !== "FISCAL_PERIOD") {
            return prev;
          }
          const next = { ...prev };
          if (!prev.fiscalPeriodIdFrom && nextPeriods[0]?.id) {
            next.fiscalPeriodIdFrom = String(nextPeriods[0].id);
          }
          if (!prev.fiscalPeriodIdTo && nextPeriods[0]?.id) {
            next.fiscalPeriodIdTo = String(nextPeriods[0].id);
          }
          return filtersEqual(prev, next) ? prev : next;
        });
      } catch (err) {
        if (!cancelled) {
          setReferenceWarning(
            err?.response?.data?.message ||
              l(
                "Fiscal periods could not be loaded.",
                "Mali donemler yuklenemedi.",
              ),
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
    const hasAccountSelection =
      Boolean(selectedAccountId) ||
      Boolean(filters.accountCodeFrom) ||
      Boolean(filters.accountCodeTo);
    const hasRange =
      (filters.periodBasis === "FISCAL_PERIOD" &&
        filters.fiscalPeriodIdFrom &&
        filters.fiscalPeriodIdTo) ||
      (filters.periodBasis === "DATE_RANGE" &&
        normalizeDate(filters.dateFrom) &&
        normalizeDate(filters.dateTo));

    if (!selectedBookId || !hasAccountSelection || !hasRange) {
      setReportResponse(null);
      return;
    }

    setLoadingReport(true);
    setError("");

    try {
      const params = {
        legalEntityId: selectedLegalEntityId || undefined,
        bookId: selectedBookId,
        accountId: selectedAccountId || undefined,
        accountCodeFrom: filters.accountCodeFrom || undefined,
        accountCodeTo: filters.accountCodeTo || undefined,
        operatingUnitScope:
          filters.operatingUnitScope !== "ALL"
            ? filters.operatingUnitScope
            : undefined,
        operatingUnitId: selectedOperatingUnitId || undefined,
        subledgerReferenceNo: filters.subledgerReferenceNo || undefined,
        sourceType: filters.sourceType || undefined,
        status: filters.status || undefined,
        includeReversed: filters.includeReversed ? "true" : undefined,
        groupBy: filters.groupBy,
        limit: filters.limit,
        offset: filters.offset,
        sortBy: filters.sortBy,
        sortDirection: filters.sortDirection,
      };

      if (filters.periodBasis === "DATE_RANGE") {
        params.dateFrom = normalizeDate(filters.dateFrom);
        params.dateTo = normalizeDate(filters.dateTo);
      } else if (filters.fiscalPeriodIdFrom === filters.fiscalPeriodIdTo) {
        params.fiscalPeriodId = filters.fiscalPeriodIdFrom;
      } else {
        params.fiscalPeriodIdFrom = filters.fiscalPeriodIdFrom || undefined;
        params.fiscalPeriodIdTo = filters.fiscalPeriodIdTo || undefined;
      }

      setReportResponse(await getGeneralLedgerReport(params));
    } catch (err) {
      setReportResponse(null);
      setError(
        err?.response?.data?.message ||
          l("Ledger detail could not be loaded.", "Defter detayi yuklenemedi."),
      );
    } finally {
      setLoadingReport(false);
    }
  }, [
    filters,
    l,
    selectedAccountId,
    selectedBookId,
    selectedLegalEntityId,
    selectedOperatingUnitId,
  ]);

  useEffect(() => {
    void loadLedgerReport();
  }, [loadLedgerReport]);

  const legalEntityOptions = useMemo(
    () =>
      legalEntities.map((row) => ({
        value: String(row.id),
        label: row.code
          ? `${row.code} - ${row.name}`
          : row.name || String(row.id),
      })),
    [legalEntities],
  );

  const bookOptions = useMemo(
    () =>
      books.map((row) => ({
        value: String(row.id),
        label: row.code
          ? `${row.code} - ${row.name}`
          : row.name || String(row.id),
        description: String(row.base_currency_code || "").toUpperCase(),
      })),
    [books],
  );

  const accountOptions = useMemo(
    () =>
      accounts.map((row) => ({
        value: String(row.id),
        label: row.code
          ? `${row.code} - ${row.name}`
          : row.name || String(row.id),
        description: row.account_breadcrumb || "",
      })),
    [accounts],
  );

  const operatingUnitOptions = useMemo(
    () =>
      operatingUnits.map((row) => ({
        value: String(row.id),
        label: row.code
          ? `${row.code} - ${row.name}`
          : row.name || String(row.id),
      })),
    [operatingUnits],
  );

  const periodOptions = useMemo(
    () =>
      periods.map((row) => ({
        value: String(row.id),
        label: formatPeriodLabel(row),
        description: `${String(row.start_date || "").slice(0, 10)} -> ${String(
          row.end_date || "",
        ).slice(0, 10)}`,
      })),
    [periods],
  );

  function setFilterValue(key, value) {
    setFilters((prev) => {
      if (key === "legalEntityId") {
        return {
          ...prev,
          legalEntityId: value,
          bookId: "",
          accountId: "",
          accountCodeFrom: "",
          accountCodeTo: "",
          operatingUnitId: "",
          fiscalPeriodIdFrom: "",
          fiscalPeriodIdTo: "",
          offset: "0",
        };
      }

      if (key === "bookId") {
        return {
          ...prev,
          bookId: value,
          accountId: "",
          accountCodeFrom: "",
          accountCodeTo: "",
          fiscalPeriodIdFrom: "",
          fiscalPeriodIdTo: "",
          offset: "0",
        };
      }

      if (key === "accountId") {
        return {
          ...prev,
          accountId: value,
          accountCodeFrom: "",
          accountCodeTo: "",
          offset: "0",
        };
      }

      if (key === "accountCodeFrom" || key === "accountCodeTo") {
        return {
          ...prev,
          [key]: normalizeText(value, 60).toUpperCase(),
          accountId: "",
          offset: "0",
        };
      }

      if (key === "operatingUnitScope") {
        return {
          ...prev,
          operatingUnitScope: value,
          operatingUnitId:
            value === "OPERATING_UNIT" ? prev.operatingUnitId : "",
          offset: "0",
        };
      }

      if (key === "periodBasis") {
        const next = {
          ...prev,
          periodBasis: value,
          offset: "0",
        };

        // When the user flips to date range, keep the same fiscal coverage by
        // projecting the selected periods into start/end dates.
        if (value === "DATE_RANGE") {
          const fromPeriod =
            periods.find(
              (row) => Number(row?.id) === Number(prev.fiscalPeriodIdFrom),
            ) || null;
          const toPeriod =
            periods.find(
              (row) => Number(row?.id) === Number(prev.fiscalPeriodIdTo),
            ) || null;

          next.dateFrom =
            normalizeDate(fromPeriod?.start_date) ||
            normalizeDate(prev.dateFrom);
          next.dateTo =
            normalizeDate(toPeriod?.end_date) || normalizeDate(prev.dateTo);
        } else {
          next.dateFrom = "";
          next.dateTo = "";
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

  function applyPreset(preset) {
    setFilters((prev) => {
      if (preset === "SUBLEDGER_DETAIL") {
        return {
          ...prev,
          reportPreset: preset,
          groupBy: "SUBLEDGER_REF",
          includeReversed: false,
          status: "",
          offset: "0",
        };
      }

      if (preset === "POSTED_ONLY") {
        return {
          ...prev,
          reportPreset: preset,
          includeReversed: false,
          status: "",
          offset: "0",
        };
      }

      return {
        ...prev,
        reportPreset: preset,
        groupBy: "NONE",
        offset: "0",
      };
    });
  }

  function goToPage(nextPage) {
    setFilters((prev) => ({
      ...prev,
      offset: String(
        (Math.max(1, nextPage) - 1) *
          Math.max(1, Number(prev.limit || DEFAULT_LIMIT)),
      ),
    }));
  }

  const selectedEntityLabel = selectedEntity?.code
    ? `${selectedEntity.code} - ${selectedEntity.name}`
    : selectedEntity?.name || "-";
  const selectedBookLabel = selectedBook?.code
    ? `${selectedBook.code} - ${selectedBook.name}`
    : reportBook?.code
      ? `${reportBook.code} - ${reportBook.name}`
      : "-";
  const accountScopeLabel = reportAccount
    ? `${reportAccount.code || ""} - ${reportAccount.name || ""}`.trim()
    : reportAccountRange
      ? `${reportAccountRange.codeFrom || "-"} -> ${reportAccountRange.codeTo || "-"}`
      : selectedAccount?.code
        ? `${selectedAccount.code} - ${selectedAccount.name || ""}`.trim()
        : selectedAccountId
          ? `#${selectedAccountId}`
          : hasAccountRange
            ? `${filters.accountCodeFrom || "-"} -> ${filters.accountCodeTo || "-"}`
            : "-";
  const effectiveGroupBy = reportGrouping.groupBy || filters.groupBy || "NONE";
  const showRunningBalanceSortNote =
    filters.sortBy !== DEFAULT_SORT_BY ||
    filters.sortDirection !== DEFAULT_SORT_DIRECTION;
  const detailColSpan = showAdvanced
    ? isMuavinMode || reportAccountRange
      ? 11
      : 10
    : isMuavinMode || reportAccountRange
      ? 9
      : 8;

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">
              {isMuavinMode
                ? l("Muavin", "Muavin")
                : l("Defter-i Kebir", "Defter-i Kebir")}
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              {isMuavinMode
                ? l(
                    "Muavin runs on the same ledger engine with dimensional and subledger filters.",
                    "Muavin ayni ledger motoru uzerinde boyutsal ve alt defter filtreleriyle calisir.",
                  )
                : l(
                    "Review posted account movement with opening balance, running balance, journal drillthrough, and source-link drillback on one report-grade ledger surface.",
                    "Acilis bakiyesi, hareketli bakiye, mahsup drillthrough'u ve kaynak baglanti drillback'i ile post edilmis hesap hareketlerini tek bir rapor-seviyesinde inceleyin.",
                  )}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              void loadLedgerReport();
            }}
            disabled={loadingReport || !selectedBookId}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60"
          >
            {loadingReport
              ? l("Refreshing...", "Yenileniyor...")
              : l("Refresh", "Yenile")}
          </button>
        </div>

        <div className="mt-4 grid gap-3 xl:grid-cols-4">
          <Combobox
            value={filters.legalEntityId || null}
            options={legalEntityOptions}
            onChange={(value) =>
              setFilterValue("legalEntityId", value ? String(value) : "")
            }
            placeholder={l("Select legal entity", "Yasal varlik secin")}
            noOptionsText={l(
              "No legal entities found.",
              "Yasal varlik bulunamadi.",
            )}
            loading={loadingRefs}
            disabled={!canReadOrgTree}
            clearable={false}
          />
          <Combobox
            value={filters.bookId || null}
            options={bookOptions}
            onChange={(value) =>
              setFilterValue("bookId", value ? String(value) : "")
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
            onChange={(value) =>
              setFilterValue("accountId", value ? String(value) : "")
            }
            placeholder={l("Select account", "Hesap secin")}
            noOptionsText={l("No accounts found.", "Hesap bulunamadi.")}
            loading={loadingRefs}
            disabled={!canReadAccounts}
            clearable
          />
          <Combobox
            value={filters.periodBasis}
            options={PERIOD_BASIS_OPTIONS.map(([value, label]) => ({
              value,
              label: l(
                label,
                value === "FISCAL_PERIOD" ? "Mali Donem" : "Tarih Araligi",
              ),
            }))}
            onChange={(value) =>
              setFilterValue(
                "periodBasis",
                normalizeEnum(value, PERIOD_BASIS_OPTIONS, "FISCAL_PERIOD"),
              )
            }
            clearable={false}
          />
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {filters.periodBasis === "DATE_RANGE" ? (
            <>
              <label className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {l("Date From", "Tarih Baslangici")}
                </div>
                <input
                  type="date"
                  value={filters.dateFrom}
                  onChange={(event) =>
                    setFilterValue("dateFrom", event.target.value)
                  }
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
                  onChange={(event) =>
                    setFilterValue("dateTo", event.target.value)
                  }
                  className="w-full bg-transparent outline-none"
                />
              </label>
            </>
          ) : (
            <>
              <Combobox
                value={filters.fiscalPeriodIdFrom || null}
                options={periodOptions}
                onChange={(value) =>
                  setFilterValue(
                    "fiscalPeriodIdFrom",
                    value ? String(value) : "",
                  )
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
                onChange={(value) =>
                  setFilterValue("fiscalPeriodIdTo", value ? String(value) : "")
                }
                placeholder={l("Period to", "Donem bitisi")}
                noOptionsText={l("No periods found.", "Donem bulunamadi.")}
                loading={loadingPeriods}
                disabled={!canReadPeriods}
                clearable={false}
              />
            </>
          )}
          <Combobox
            value={filters.sortBy}
            options={SORT_OPTIONS.map(([value, label]) => ({
              value,
              label: l(label, label),
            }))}
            onChange={(value) =>
              setFilterValue(
                "sortBy",
                normalizeEnum(value, SORT_OPTIONS, DEFAULT_SORT_BY),
              )
            }
            clearable={false}
          />
          <Combobox
            value={filters.sortDirection}
            options={DIRECTION_OPTIONS.map(([value, label]) => ({
              value,
              label: l(label, value === "ASC" ? "Artan" : "Azalan"),
            }))}
            onChange={(value) =>
              setFilterValue(
                "sortDirection",
                normalizeEnum(value, DIRECTION_OPTIONS, DEFAULT_SORT_DIRECTION),
              )
            }
            clearable={false}
          />
        </div>

        {showAdvanced ? (
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="grid gap-3 xl:grid-cols-4">
              <Combobox
                value={filters.reportPreset}
                options={PRESET_OPTIONS.map(([value, label]) => ({
                  value,
                  label: l(
                    label,
                    value === "GL_DETAIL"
                      ? "GL detayi"
                      : value === "SUBLEDGER_DETAIL"
                        ? "Alt defter detayi"
                        : "Yalniz posted",
                  ),
                }))}
                onChange={(value) =>
                  applyPreset(
                    normalizeEnum(
                      value,
                      PRESET_OPTIONS,
                      defaultPreset(normalizedReportMode),
                    ),
                  )
                }
                clearable={false}
              />
              <label className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {l("Account Code From", "Hesap Kodu Baslangici")}
                </div>
                <input
                  type="text"
                  value={filters.accountCodeFrom}
                  onChange={(event) =>
                    setFilterValue("accountCodeFrom", event.target.value)
                  }
                  className="w-full bg-transparent outline-none"
                />
              </label>
              <label className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {l("Account Code To", "Hesap Kodu Bitisi")}
                </div>
                <input
                  type="text"
                  value={filters.accountCodeTo}
                  onChange={(event) =>
                    setFilterValue("accountCodeTo", event.target.value)
                  }
                  className="w-full bg-transparent outline-none"
                />
              </label>
              <Combobox
                value={filters.operatingUnitScope}
                options={SCOPE_OPTIONS.map(([value, label]) => ({
                  value,
                  label: l(
                    label,
                    value === "ALL"
                      ? "Tum kapsamlar"
                      : value === "OPERATING_UNIT"
                        ? "Tek OU"
                        : "Yalniz CENTRAL",
                  ),
                }))}
                onChange={(value) =>
                  setFilterValue(
                    "operatingUnitScope",
                    normalizeEnum(value, SCOPE_OPTIONS, "ALL"),
                  )
                }
                clearable={false}
              />
              <Combobox
                value={filters.operatingUnitId || null}
                options={operatingUnitOptions}
                onChange={(value) =>
                  setFilterValue("operatingUnitId", value ? String(value) : "")
                }
                placeholder={l("Select operating unit", "Isletme birimi secin")}
                noOptionsText={l(
                  "No operating units found.",
                  "Isletme birimi bulunamadi.",
                )}
                loading={loadingRefs}
                disabled={
                  !canReadOrgTree ||
                  filters.operatingUnitScope !== "OPERATING_UNIT"
                }
                clearable
              />
              <label className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {l("Subledger Ref", "Alt Defter Ref")}
                </div>
                <input
                  type="text"
                  value={filters.subledgerReferenceNo}
                  onChange={(event) =>
                    setFilterValue("subledgerReferenceNo", event.target.value)
                  }
                  className="w-full bg-transparent outline-none"
                />
              </label>
              <Combobox
                value={filters.sourceType || null}
                options={SOURCE_OPTIONS.map(([value, label]) => ({
                  value,
                  label: l(label, label),
                }))}
                onChange={(value) =>
                  setFilterValue(
                    "sourceType",
                    normalizeEnum(value, SOURCE_OPTIONS, ""),
                  )
                }
                placeholder={l("Source module / type", "Kaynak modul / tur")}
                clearable
              />
              <Combobox
                value={filters.status || null}
                options={STATUS_OPTIONS.map(([value, label]) => ({
                  value,
                  label: l(
                    label,
                    value === "REVERSED"
                      ? "Terslenmis"
                      : value === "DRAFT"
                        ? "Taslak"
                        : value === "CANCELLED"
                          ? "Iptal"
                          : label,
                  ),
                }))}
                onChange={(value) =>
                  setFilterValue(
                    "status",
                    normalizeEnum(value, STATUS_OPTIONS, ""),
                  )
                }
                placeholder={l("Journal status", "Fis durumu")}
                clearable
              />
              <Combobox
                value={filters.groupBy}
                options={GROUP_OPTIONS.map(([value, label]) => ({
                  value,
                  label: l(
                    label,
                    value === "NONE"
                      ? "Gruplama yok"
                      : value === "MONTH"
                        ? "Aya gore"
                        : value === "SOURCE_TYPE"
                          ? "Kaynak ture gore"
                          : value === "OPERATING_UNIT"
                            ? "OU'ya gore"
                            : "Alt defter ref'e gore",
                  ),
                }))}
                onChange={(value) =>
                  setFilterValue(
                    "groupBy",
                    normalizeEnum(value, GROUP_OPTIONS, "NONE"),
                  )
                }
                clearable={false}
              />
            </div>

            <label className="mt-3 flex items-center gap-3 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={filters.includeReversed}
                onChange={(event) =>
                  setFilterValue("includeReversed", event.target.checked)
                }
              />
              <span>
                {l(
                  "Include reversed rows when no explicit status filter is selected",
                  "Acik durum filtresi secilmediginde terslenmis satirlari dahil et",
                )}
              </span>
            </label>
          </div>
        ) : null}

        <div className="mt-3 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs text-cyan-900">
          {isMuavinMode
            ? l(
                "RP04 keeps Muavin on the same ledger engine. The current repo maps source module/type to the existing journal source category.",
                "RP04 Muavin'i ayni ledger motoru uzerinde tutar. Mevcut repo kaynak modul/turunu mevcut fis kaynak kategorisine esler.",
              )
            : l(
                "Muavin now reuses this same ledger route and service family instead of creating a second engine.",
                "Muavin artik ikinci bir motor yaratmak yerine ayni ledger route ve service ailesini yeniden kullanir.",
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
                "Lookup permissions still missing for self-service filters",
                "Self-servis filtreler icin lookup yetkileri hala eksik",
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
              {isMuavinMode
                ? l("Muavin Context", "Muavin Baglami")
                : l("Report Context", "Rapor Baglami")}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {l(
                "The opening balance is computed before the selected range, and running balance continues through the in-range movements on one canonical currency basis.",
                "Acilis bakiyesi secilen araligin oncesinden hesaplanir ve hareketli bakiye aralik icindeki hareketler boyunca tek bir kanonik para birimi bazinda devam eder.",
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
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {l("Entity / Book", "Varlik / Defter")}
            </div>
            <div className="mt-1 text-sm font-semibold text-slate-900">
              {selectedEntityLabel}
            </div>
            <div className="mt-1 text-xs text-slate-600">
              {selectedBookLabel}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {l("Account Scope", "Hesap Kapsami")}
            </div>
            <div className="mt-1 text-sm font-semibold text-slate-900">
              {accountScopeLabel}
            </div>
            <div className="mt-1 text-xs text-slate-600">
              {reportAccountRange
                ? l(
                    `${reportAccountRange.matchedAccountCount || 0} accounts in range`,
                    `${reportAccountRange.matchedAccountCount || 0} hesap aralikta`,
                  )
                : reportAccount?.includesDescendants
                  ? l(
                      "Roll-up account: descendant postings included",
                      "Toplam hesap: alt hesap hareketleri dahil",
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
              {reportFilters.periodBasis || filters.periodBasis || "-"} |{" "}
              {currencyCode || "-"}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {l("Mode / Grouping", "Mod / Gruplama")}
            </div>
            <div className="mt-1 text-sm font-semibold text-slate-900">
              {isMuavinMode
                ? l("Muavin", "Muavin")
                : l("Defter-i Kebir", "Defter-i Kebir")}
            </div>
            <div className="mt-1 text-xs text-slate-600">
              {effectiveGroupBy} |{" "}
              {selectedOperatingUnit?.code
                ? `${selectedOperatingUnit.code} - ${selectedOperatingUnit.name}`
                : filters.operatingUnitScope === "CENTRAL"
                  ? "CENTRAL"
                  : l("All scopes", "Tum kapsamlar")}
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
              {l("Page", "Sayfa")} {currentPage} / {totalPages} |{" "}
              {l("Limit", "Limit")} {currentLimit}
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
                currencyCode={currencyCode}
              />
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {l("Debit Total", "Borc Toplami")}
            </div>
            <div className="mt-2 text-lg font-semibold text-slate-900">
              <MoneyText
                amount={reportSummary.debitTotal}
                currencyCode={currencyCode}
              />
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {l("Credit Total", "Alacak Toplami")}
            </div>
            <div className="mt-2 text-lg font-semibold text-slate-900">
              <MoneyText
                amount={reportSummary.creditTotal}
                currencyCode={currencyCode}
              />
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {l("Closing Balance", "Kapanis Bakiyesi")}
            </div>
            <div className="mt-2 text-lg font-semibold text-slate-900">
              <MoneyText
                amount={reportSummary.closingBalance}
                currencyCode={currencyCode}
              />
            </div>
          </div>
        </div>

        {showRunningBalanceSortNote ? (
          <div className="mt-3 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs text-cyan-900">
            {l(
              "Running balance always follows chronological posting order even when the display sort is changed.",
              "Gorunum siralamasi degisse bile hareketli bakiye her zaman kronolojik post sirasini izler.",
            )}
          </div>
        ) : null}
      </section>

      {Array.isArray(reportGrouping.rows) && reportGrouping.rows.length > 0 ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">
            {l("Grouping Summary", "Gruplama Ozeti")}
          </h2>
          <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-3">{l("Group", "Grup")}</th>
                  <th className="px-3 py-3">{l("Lines", "Satir")}</th>
                  <th className="px-3 py-3">{l("Debit", "Borc")}</th>
                  <th className="px-3 py-3">{l("Credit", "Alacak")}</th>
                  <th className="px-3 py-3">{l("Balance", "Bakiye")}</th>
                </tr>
              </thead>
              <tbody>
                {reportGrouping.rows.map((row) => (
                  <tr
                    key={`${row.groupKey}-${row.groupLabel}`}
                    className="border-t border-slate-100 bg-white"
                  >
                    <td className="px-3 py-3 font-medium text-slate-800">
                      {row.groupLabel || row.groupKey || "-"}
                    </td>
                    <td className="px-3 py-3 text-slate-700">
                      {row.lineCount || 0}
                    </td>
                    <td className="px-3 py-3 text-slate-700">
                      <MoneyText
                        amount={row.debitTotal}
                        currencyCode={currencyCode}
                      />
                    </td>
                    <td className="px-3 py-3 text-slate-700">
                      <MoneyText
                        amount={row.creditTotal}
                        currencyCode={currencyCode}
                      />
                    </td>
                    <td className="px-3 py-3 font-medium text-slate-900">
                      <MoneyText
                        amount={row.balanceTotal}
                        currencyCode={currencyCode}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              {isMuavinMode
                ? l("Muavin Detail", "Muavin Detayi")
                : l("Ledger Detail", "Defter Detayi")}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {l(
                "The same page now serves direct menu entry and live Mizan drillthrough on one shared ledger contract.",
                "Ayni sayfa artik dogrudan menu girisini ve canli Mizan drillthrough'unu tek bir ortak ledger sozlesmesi uzerinden servis eder.",
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Combobox
              value={filters.limit}
              options={PAGE_SIZE_OPTIONS.map((value) => ({
                value,
                label: l(`${value} rows`, `${value} satir`),
              }))}
              onChange={(value) =>
                setFilterValue(
                  "limit",
                  PAGE_SIZE_OPTIONS.includes(String(value || ""))
                    ? String(value)
                    : DEFAULT_LIMIT,
                )
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
                <th className="px-3 py-3">
                  {l("Posting Date", "Kayit Tarihi")}
                </th>
                {isMuavinMode || reportAccountRange ? (
                  <th className="px-3 py-3">{l("Account", "Hesap")}</th>
                ) : null}
                <th className="px-3 py-3">{l("Journal No", "Fis No")}</th>
                <th className="px-3 py-3">
                  {l("Reference No", "Referans No")}
                </th>
                <th className="px-3 py-3">{l("Description", "Aciklama")}</th>
                {showAdvanced ? (
                  <th className="px-3 py-3">
                    {l("OU / Subledger", "OU / Alt Defter")}
                  </th>
                ) : null}
                {showAdvanced ? (
                  <th className="px-3 py-3">
                    {l("Source / Status", "Kaynak / Durum")}
                  </th>
                ) : null}
                <th className="px-3 py-3">{l("Debit", "Borc")}</th>
                <th className="px-3 py-3">{l("Credit", "Alacak")}</th>
                <th className="px-3 py-3">
                  {l("Running Balance", "Hareketli Bakiye")}
                </th>
                <th className="px-3 py-3">{l("Actions", "Aksiyonlar")}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-slate-100 bg-slate-50/70">
                <td className="px-3 py-3 text-slate-500">
                  {l("Opening", "Acilis")}
                </td>
                {isMuavinMode || reportAccountRange ? (
                  <td className="px-3 py-3 text-slate-500">-</td>
                ) : null}
                <td className="px-3 py-3 text-slate-500">-</td>
                <td className="px-3 py-3 text-slate-500">-</td>
                <td className="px-3 py-3 font-medium text-slate-700">
                  {l(
                    "Opening balance before the selected range",
                    "Secilen araliktan onceki acilis bakiyesi",
                  )}
                </td>
                {showAdvanced ? (
                  <td className="px-3 py-3 text-slate-500">-</td>
                ) : null}
                {showAdvanced ? (
                  <td className="px-3 py-3 text-slate-500">-</td>
                ) : null}
                <td className="px-3 py-3 text-slate-500">-</td>
                <td className="px-3 py-3 text-slate-500">-</td>
                <td className="px-3 py-3 font-semibold text-slate-900">
                  <MoneyText
                    amount={reportSummary.openingBalance}
                    currencyCode={currencyCode}
                  />
                </td>
                <td className="px-3 py-3 text-slate-500">-</td>
              </tr>

              {reportRows.map((row) => {
                const sourceActions = buildSourceActions(row.source_links, l);
                const operatingUnitLabel = row.operating_unit_code
                  ? `${row.operating_unit_code} - ${row.operating_unit_name || ""}`.trim()
                  : "CENTRAL";

                return (
                  <tr
                    key={`${row.journal_line_id || row.journal_id}-${row.line_no || 0}`}
                    className="border-t border-slate-100 bg-white"
                  >
                    <td className="px-3 py-3 text-slate-700">
                      {String(row.entry_date || "").slice(0, 10) || "-"}
                    </td>
                    {isMuavinMode || reportAccountRange ? (
                      <td className="px-3 py-3 text-slate-700">
                        {row.account_code || "-"} - {row.account_name || "-"}
                      </td>
                    ) : null}
                    <td className="px-3 py-3 text-slate-700">
                      {row.journal_no || "-"}
                    </td>
                    <td className="px-3 py-3 text-slate-700">
                      {row.reference_no || "-"}
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-medium text-slate-800">
                        {row.description || "-"}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {l("Line", "Satir")} {row.line_no || "-"} |{" "}
                        {String(row.document_date || "").slice(0, 10) || "-"}
                      </div>
                    </td>
                    {showAdvanced ? (
                      <td className="px-3 py-3 text-slate-700">
                        <div>{operatingUnitLabel}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {row.subledger_reference_no ||
                            l("No subledger ref", "Alt defter ref yok")}
                        </div>
                      </td>
                    ) : null}
                    {showAdvanced ? (
                      <td className="px-3 py-3 text-slate-700">
                        <div>{row.source_type || "-"}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {row.status || "-"}
                        </div>
                      </td>
                    ) : null}
                    <td className="px-3 py-3 text-slate-700">
                      <MoneyText
                        amount={row.debit_base}
                        currencyCode={currencyCode}
                      />
                    </td>
                    <td className="px-3 py-3 text-slate-700">
                      <MoneyText
                        amount={row.credit_base}
                        currencyCode={currencyCode}
                      />
                    </td>
                    <td className="px-3 py-3 font-medium text-slate-900">
                      <MoneyText
                        amount={row.running_balance}
                        currencyCode={currencyCode}
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
                  <td
                    colSpan={detailColSpan}
                    className="px-3 py-6 text-center text-sm text-slate-500"
                  >
                    {loadingReport
                      ? l(
                          "Loading ledger movements...",
                          "Defter hareketleri yukleniyor...",
                        )
                      : selectedBookId &&
                          (selectedAccountId ||
                            filters.accountCodeFrom ||
                            filters.accountCodeTo)
                        ? l(
                            "No ledger movements found for the selected scope.",
                            "Secilen kapsam icin defter hareketi bulunamadi.",
                          )
                        : l(
                            "Choose a book, an account or account range, and a valid period/date range to load the ledger.",
                            "Defteri yuklemek icin bir defter, hesap veya hesap araligi ve gecerli donem/tarih araligi secin.",
                          )}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
