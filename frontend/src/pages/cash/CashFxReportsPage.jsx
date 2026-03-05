import { useEffect, useMemo, useState } from "react";
import {
  getCashExchangeHistoryReport,
  getCashFxRevaluationRunsReport,
  getForeignCashBalancesReport,
  listCashRegisters,
} from "../../api/cashAdmin.js";
import { listBooks } from "../../api/glAdmin.js";
import { listLegalEntities } from "../../api/orgAdmin.js";
import { useAuth } from "../../auth/useAuth.js";
import { exportRowsAsCsv } from "../../utils/csvExport.js";

const REPORT_TABS = Object.freeze({
  EXCHANGE_HISTORY: "EXCHANGE_HISTORY",
  FOREIGN_BALANCES: "FOREIGN_BALANCES",
  REVALUATION_RUNS: "REVALUATION_RUNS",
});

const TAB_CONFIG = [
  { id: REPORT_TABS.EXCHANGE_HISTORY, label: "Exchange History" },
  { id: REPORT_TABS.FOREIGN_BALANCES, label: "Foreign Balances" },
  { id: REPORT_TABS.REVALUATION_RUNS, label: "Revaluation Runs" },
];

const EXCHANGE_STATUSES = ["DRAFT", "POSTED", "REVERSED", "CANCELLED"];
const REVALUATION_RUN_TYPES = ["MONTH_END", "YEAR_END"];
const REVALUATION_RUN_STATUSES = ["DRAFT", "COMPLETED", "FAILED", "REVERSED"];

const INITIAL_FILTERS = {
  legalEntityId: "",
  sourceRegisterId: "",
  targetRegisterId: "",
  exchangeStatus: "",
  createdDateFrom: "",
  createdDateTo: "",
  asOfDate: new Date().toISOString().slice(0, 10),
  registerId: "",
  currencyCode: "",
  includeBaseCurrency: false,
  includeZeroBalances: false,
  bookId: "",
  revaluationRunType: "",
  revaluationStatus: "",
  periodEndFrom: "",
  periodEndTo: "",
  includeLineCurrencySummary: true,
};

const DEFAULT_PAGINATION_BY_TAB = Object.freeze({
  [REPORT_TABS.EXCHANGE_HISTORY]: { limit: 200, offset: 0 },
  [REPORT_TABS.FOREIGN_BALANCES]: { limit: 200, offset: 0 },
  [REPORT_TABS.REVALUATION_RUNS]: { limit: 100, offset: 0 },
});

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function toNonNegativeInt(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function toUpper(value) {
  return String(value || "").trim().toUpperCase();
}

function formatAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return "-";
  }
  return amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

function formatDate(value) {
  const normalized = String(value || "").slice(0, 10);
  if (!normalized) {
    return "-";
  }
  const date = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return normalized;
  }
  return date.toLocaleDateString();
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

function formatTxnId(value) {
  const id = toPositiveInt(value);
  return id ? `#${id}` : "-";
}

function normalizeError(err, fallback) {
  return String(err?.response?.data?.message || err?.message || fallback);
}

function extractRequestId(err) {
  return (
    err?.response?.data?.requestId ||
    err?.response?.headers?.["x-request-id"] ||
    null
  );
}

function toLegalEntityLabel(row) {
  return `${row?.code || row?.id || "-"} - ${row?.name || "-"}`;
}

function toRegisterLabel(row) {
  return `${row?.code || row?.id || "-"} - ${row?.name || "-"}`;
}

function toBookLabel(row) {
  return `${row?.code || row?.id || "-"} - ${row?.name || "-"}`;
}

function statusClassName(status) {
  const normalized = toUpper(status);
  if (normalized === "COMPLETED" || normalized === "POSTED") {
    return "bg-emerald-100 text-emerald-700";
  }
  if (normalized === "FAILED" || normalized === "CANCELLED") {
    return "bg-rose-100 text-rose-700";
  }
  if (normalized === "REVERSED") {
    return "bg-violet-100 text-violet-700";
  }
  if (normalized === "DRAFT") {
    return "bg-sky-100 text-sky-700";
  }
  return "bg-slate-200 text-slate-700";
}

function validateFilters(tab, filters) {
  if (tab === REPORT_TABS.EXCHANGE_HISTORY) {
    if (
      filters.createdDateFrom &&
      filters.createdDateTo &&
      filters.createdDateFrom > filters.createdDateTo
    ) {
      return "createdDateFrom cannot be greater than createdDateTo.";
    }
    return "";
  }

  if (tab === REPORT_TABS.FOREIGN_BALANCES) {
    if (
      filters.currencyCode &&
      !/^[A-Za-z]{3}$/.test(String(filters.currencyCode).trim())
    ) {
      return "currencyCode must be a 3-letter currency code.";
    }
    return "";
  }

  if (
    filters.periodEndFrom &&
    filters.periodEndTo &&
    filters.periodEndFrom > filters.periodEndTo
  ) {
    return "periodEndFrom cannot be greater than periodEndTo.";
  }
  return "";
}

function buildExchangeHistoryQuery(filters, pagination) {
  return {
    legalEntityId: toPositiveInt(filters.legalEntityId) || undefined,
    sourceRegisterId: toPositiveInt(filters.sourceRegisterId) || undefined,
    targetRegisterId: toPositiveInt(filters.targetRegisterId) || undefined,
    status: toUpper(filters.exchangeStatus) || undefined,
    createdDateFrom: filters.createdDateFrom || undefined,
    createdDateTo: filters.createdDateTo || undefined,
    limit: Number(pagination?.limit || 200),
    offset: toNonNegativeInt(pagination?.offset, 0),
  };
}

function buildForeignBalancesQuery(filters, pagination) {
  return {
    legalEntityId: toPositiveInt(filters.legalEntityId) || undefined,
    registerId: toPositiveInt(filters.registerId) || undefined,
    asOfDate: filters.asOfDate || undefined,
    currencyCode: toUpper(filters.currencyCode) || undefined,
    includeBaseCurrency: Boolean(filters.includeBaseCurrency),
    includeZeroBalances: Boolean(filters.includeZeroBalances),
    limit: Number(pagination?.limit || 200),
    offset: toNonNegativeInt(pagination?.offset, 0),
  };
}

function buildRevaluationRunsQuery(filters, pagination) {
  return {
    legalEntityId: toPositiveInt(filters.legalEntityId) || undefined,
    bookId: toPositiveInt(filters.bookId) || undefined,
    runType: toUpper(filters.revaluationRunType) || undefined,
    status: toUpper(filters.revaluationStatus) || undefined,
    periodEndFrom: filters.periodEndFrom || undefined,
    periodEndTo: filters.periodEndTo || undefined,
    includeLineCurrencySummary: Boolean(filters.includeLineCurrencySummary),
    limit: Number(pagination?.limit || 100),
    offset: toNonNegativeInt(pagination?.offset, 0),
  };
}

function resolveCsvFileName(tab) {
  const date = new Date().toISOString().slice(0, 10);
  if (tab === REPORT_TABS.EXCHANGE_HISTORY) {
    return `cash-fx-exchange-history-${date}.csv`;
  }
  if (tab === REPORT_TABS.FOREIGN_BALANCES) {
    return `cash-fx-foreign-balances-${date}.csv`;
  }
  return `cash-fx-revaluation-runs-${date}.csv`;
}

function resolveCsvColumns(tab) {
  if (tab === REPORT_TABS.EXCHANGE_HISTORY) {
    return [
      { header: "Batch ID", key: "id" },
      { header: "Legal Entity Code", key: "legalEntityCode" },
      { header: "Legal Entity Name", key: "legalEntityName" },
      { header: "Source Register", key: "sourceRegisterCode" },
      { header: "Source Amount Txn", key: "sourceAmountTxn" },
      { header: "Source Currency", key: "sourceCurrencyCode" },
      { header: "Target Register", key: "targetRegisterCode" },
      { header: "Target Amount Txn", key: "targetAmountTxn" },
      { header: "Target Currency", key: "targetCurrencyCode" },
      { header: "FX Rate", key: "fxRate" },
      { header: "FX Rate Source", key: "fxRateSource" },
      { header: "FX Rate Date", key: "fxRateDate" },
      { header: "Source Amount Base", key: "sourceAmountBase" },
      { header: "Target Amount Base", key: "targetAmountBase" },
      { header: "Realized FX Base", key: "realizedFxBase" },
      { header: "Reversal Realized FX Base", key: "reversalRealizedFxBase" },
      { header: "Fee Amount Txn", key: "feeAmountTxn" },
      { header: "Fee Amount Base", key: "feeAmountBase" },
      { header: "Spread Amount Base", key: "spreadAmountBase" },
      { header: "Original Out Txn ID", key: "exchangeOutCashTransactionId" },
      { header: "Original In Txn ID", key: "exchangeInCashTransactionId" },
      { header: "Reversal Out Txn ID", key: "reversalOutCashTransactionId" },
      { header: "Reversal In Txn ID", key: "reversalInCashTransactionId" },
      { header: "Reversed At", key: "reversedAt" },
      { header: "Reverse Reason", key: "reverseReason" },
      { header: "Status", key: "status" },
      { header: "Created At", key: "createdAt" },
    ];
  }

  if (tab === REPORT_TABS.FOREIGN_BALANCES) {
    return [
      { header: "Legal Entity Code", key: "legalEntityCode" },
      { header: "Legal Entity Name", key: "legalEntityName" },
      { header: "Register Code", key: "registerCode" },
      { header: "Register Name", key: "registerName" },
      { header: "Account Code", key: "accountCode" },
      { header: "Account Name", key: "accountName" },
      { header: "Currency", key: "currencyCode" },
      { header: "Base Currency", key: "baseCurrencyCode" },
      { header: "Balance Txn", key: "balanceAmountTxn" },
      { header: "Carrying Base", key: "carryingAmountBase" },
      { header: "Is Foreign Currency", value: (row) => (row?.isForeignCurrency ? "YES" : "NO") },
    ];
  }

  return [
    { header: "Run ID", key: "runId" },
    { header: "Legal Entity Code", key: "legalEntityCode" },
    { header: "Legal Entity Name", key: "legalEntityName" },
    { header: "Book ID", key: "bookId" },
    { header: "Fiscal Year", key: "fiscalYear" },
    { header: "Period No", key: "periodNo" },
    { header: "Period Name", key: "periodName" },
    { header: "Run Type", key: "runType" },
    { header: "Status", key: "status" },
    { header: "Period End Date", key: "periodEndDate" },
    { header: "Line Count", key: "lineCount" },
    { header: "Total Carrying Base", key: "totalCarryingBase" },
    { header: "Total Closing Base", key: "totalClosingBase" },
    { header: "Total Delta Base", key: "totalDeltaBase" },
    { header: "Journal Entry ID", key: "journalEntryId" },
    { header: "Completed At", key: "completedAt" },
    {
      header: "Line Currency Summary",
      value: (row) =>
        (row?.lineCurrencySummary || [])
          .map(
            (line) =>
              `${line.currencyCode || "?"}|reg:${line.registerCount || 0}|txn:${
                line.balanceAmountTxn || 0
              }|delta:${line.deltaBase || 0}`
          )
          .join(" ; "),
    },
  ];
}

export default function CashFxReportsPage() {
  const { hasPermission } = useAuth();
  const canRead = hasPermission("cash.report.read");
  const canReadRegisters = hasPermission("cash.register.read");
  const canReadBooks = hasPermission("gl.book.read");
  const canReadOrgTree = hasPermission("org.tree.read");

  const [activeTab, setActiveTab] = useState(REPORT_TABS.EXCHANGE_HISTORY);
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [paginationByTab, setPaginationByTab] = useState(
    DEFAULT_PAGINATION_BY_TAB
  );

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [errorRequestId, setErrorRequestId] = useState(null);
  const [message, setMessage] = useState("");
  const [lookupWarning, setLookupWarning] = useState("");

  const [legalEntityRows, setLegalEntityRows] = useState([]);
  const [registerRows, setRegisterRows] = useState([]);
  const [bookRows, setBookRows] = useState([]);

  const [reportByTab, setReportByTab] = useState({
    [REPORT_TABS.EXCHANGE_HISTORY]: null,
    [REPORT_TABS.FOREIGN_BALANCES]: null,
    [REPORT_TABS.REVALUATION_RUNS]: null,
  });

  const [expandedRunIds, setExpandedRunIds] = useState({});

  const selectedLegalEntityId = toPositiveInt(filters.legalEntityId);

  const legalEntityOptions = useMemo(() => {
    const map = new Map();

    for (const row of legalEntityRows) {
      const id = toPositiveInt(row?.id);
      if (!id || map.has(id)) {
        continue;
      }
      map.set(id, {
        id,
        code: row?.code || String(id),
        name: row?.name || "-",
      });
    }

    for (const row of registerRows) {
      const id = toPositiveInt(row?.legal_entity_id);
      if (!id || map.has(id)) {
        continue;
      }
      map.set(id, {
        id,
        code: row?.legal_entity_code || String(id),
        name: row?.legal_entity_name || "-",
      });
    }

    for (const row of bookRows) {
      const id = toPositiveInt(row?.legal_entity_id);
      if (!id || map.has(id)) {
        continue;
      }
      map.set(id, {
        id,
        code: row?.legal_entity_code || String(id),
        name: row?.legal_entity_name || "-",
      });
    }

    return [...map.values()].sort((a, b) =>
      String(a.code || "").localeCompare(String(b.code || ""))
    );
  }, [legalEntityRows, registerRows, bookRows]);

  const registerOptions = useMemo(() => {
    return registerRows
      .filter((row) => {
        if (!selectedLegalEntityId) {
          return true;
        }
        return toPositiveInt(row?.legal_entity_id) === selectedLegalEntityId;
      })
      .sort((a, b) => String(a?.code || "").localeCompare(String(b?.code || "")));
  }, [registerRows, selectedLegalEntityId]);

  const bookOptions = useMemo(() => {
    return bookRows
      .filter((row) => {
        if (!selectedLegalEntityId) {
          return true;
        }
        return toPositiveInt(row?.legal_entity_id) === selectedLegalEntityId;
      })
      .sort((a, b) => String(a?.code || "").localeCompare(String(b?.code || "")));
  }, [bookRows, selectedLegalEntityId]);

  const activeReport = reportByTab[activeTab];
  const activeRows = Array.isArray(activeReport?.rows) ? activeReport.rows : [];
  const activeTotal = Number(activeReport?.total || 0);
  const activeLimit = Number(
    activeReport?.limit || paginationByTab[activeTab]?.limit || 50
  );
  const activeOffset = toNonNegativeInt(
    activeReport?.offset ?? paginationByTab[activeTab]?.offset,
    0
  );
  const activePage = Math.floor(activeOffset / Math.max(activeLimit, 1)) + 1;
  const hasPrevPage = activeOffset > 0;
  const hasNextPage = activeOffset + activeRows.length < activeTotal;

  function updateReport(tab, payload) {
    setReportByTab((prev) => ({ ...prev, [tab]: payload || null }));
  }

  async function loadLookups() {
    if (!canRead) {
      setLegalEntityRows([]);
      setRegisterRows([]);
      setBookRows([]);
      setLookupWarning("");
      return;
    }

    const tasks = [];
    if (canReadOrgTree) {
      tasks.push({
        key: "legalEntities",
        promise: listLegalEntities({ limit: 500, includeInactive: true }),
      });
    }
    if (canReadRegisters) {
      tasks.push({
        key: "registers",
        promise: listCashRegisters({ limit: 500, offset: 0 }),
      });
    }
    if (canReadBooks) {
      tasks.push({
        key: "books",
        promise: listBooks({ limit: 500, offset: 0 }),
      });
    }

    const warnings = [];
    if (tasks.length === 0) {
      setLegalEntityRows([]);
      setRegisterRows([]);
      setBookRows([]);
      setLookupWarning("");
      return;
    }

    const settled = await Promise.allSettled(tasks.map((item) => item.promise));
    for (let index = 0; index < settled.length; index += 1) {
      const result = settled[index];
      const key = tasks[index]?.key;

      if (result.status === "fulfilled") {
        if (key === "legalEntities") {
          setLegalEntityRows(
            Array.isArray(result.value?.rows) ? result.value.rows : []
          );
        } else if (key === "registers") {
          setRegisterRows(Array.isArray(result.value?.rows) ? result.value.rows : []);
        } else if (key === "books") {
          setBookRows(Array.isArray(result.value?.rows) ? result.value.rows : []);
        }
        continue;
      }

      if (key === "legalEntities") {
        setLegalEntityRows([]);
        warnings.push(normalizeError(result.reason, "Legal entity lookup failed."));
      } else if (key === "registers") {
        setRegisterRows([]);
        warnings.push(normalizeError(result.reason, "Cash register lookup failed."));
      } else if (key === "books") {
        setBookRows([]);
        warnings.push(normalizeError(result.reason, "Book lookup failed."));
      }
    }

    setLookupWarning(warnings.join(" "));
  }

  async function loadReport(
    tab = activeTab,
    {
      nextFilters = filters,
      nextPagination = paginationByTab[tab] || DEFAULT_PAGINATION_BY_TAB[tab],
    } = {}
  ) {
    if (!canRead) {
      updateReport(tab, null);
      return;
    }

    const validationError = validateFilters(tab, nextFilters);
    if (validationError) {
      setError(validationError);
      setErrorRequestId(null);
      return;
    }

    setLoading(true);
    setError("");
    setErrorRequestId(null);

    try {
      let payload = null;
      if (tab === REPORT_TABS.EXCHANGE_HISTORY) {
        payload = await getCashExchangeHistoryReport(
          buildExchangeHistoryQuery(nextFilters, nextPagination)
        );
      } else if (tab === REPORT_TABS.FOREIGN_BALANCES) {
        payload = await getForeignCashBalancesReport(
          buildForeignBalancesQuery(nextFilters, nextPagination)
        );
      } else {
        payload = await getCashFxRevaluationRunsReport(
          buildRevaluationRunsQuery(nextFilters, nextPagination)
        );
      }
      updateReport(tab, payload || null);
    } catch (err) {
      updateReport(tab, null);
      setError(normalizeError(err, "Cash FX report could not be loaded."));
      setErrorRequestId(extractRequestId(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadLookups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead, canReadOrgTree, canReadRegisters, canReadBooks]);

  useEffect(() => {
    loadReport(activeTab, {
      nextFilters: filters,
      nextPagination: paginationByTab[activeTab],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, canRead]);

  function handleApplyFilters(event) {
    event.preventDefault();
    setMessage("");
    const nextPagination = {
      ...(paginationByTab[activeTab] || DEFAULT_PAGINATION_BY_TAB[activeTab]),
      offset: 0,
    };
    setPaginationByTab((prev) => ({ ...prev, [activeTab]: nextPagination }));
    loadReport(activeTab, { nextFilters: filters, nextPagination });
  }

  function handleResetFilters() {
    setFilters(INITIAL_FILTERS);
    setMessage("");
    setError("");
    setErrorRequestId(null);
    setExpandedRunIds({});
    const nextPagination = {
      ...(DEFAULT_PAGINATION_BY_TAB[activeTab] || { limit: 100, offset: 0 }),
      offset: 0,
    };
    setPaginationByTab((prev) => ({ ...prev, [activeTab]: nextPagination }));
    loadReport(activeTab, {
      nextFilters: INITIAL_FILTERS,
      nextPagination,
    });
  }

  function handleChangePage(step) {
    if (!Number.isInteger(step) || step === 0) {
      return;
    }
    const nextOffset = Math.max(0, activeOffset + step * activeLimit);
    if (nextOffset === activeOffset) {
      return;
    }
    setMessage("");
    const nextPagination = { limit: activeLimit, offset: nextOffset };
    setPaginationByTab((prev) => ({ ...prev, [activeTab]: nextPagination }));
    loadReport(activeTab, { nextFilters: filters, nextPagination });
  }

  function handleExportCsv() {
    if (activeRows.length === 0) {
      setError("No rows to export.");
      setErrorRequestId(null);
      return;
    }

    const exported = exportRowsAsCsv({
      rows: activeRows,
      columns: resolveCsvColumns(activeTab),
      fileName: resolveCsvFileName(activeTab),
    });
    if (!exported) {
      setError("CSV export is only available in browser sessions.");
      setErrorRequestId(null);
      return;
    }

    setError("");
    setErrorRequestId(null);
    setMessage(`CSV export ready (${activeRows.length} rows).`);
  }

  function toggleRunDetails(runId) {
    const resolvedRunId = toPositiveInt(runId);
    if (!resolvedRunId) {
      return;
    }
    setExpandedRunIds((prev) => ({
      ...prev,
      [String(resolvedRunId)]: !prev[String(resolvedRunId)],
    }));
  }

  function renderLegalEntityInput() {
    if (legalEntityOptions.length > 0) {
      return (
        <select
          className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm font-normal"
          value={filters.legalEntityId}
          onChange={(event) =>
            setFilters((prev) => ({
              ...prev,
              legalEntityId: event.target.value,
              sourceRegisterId: "",
              targetRegisterId: "",
              registerId: "",
              bookId: "",
            }))
          }
        >
          <option value="">All</option>
          {legalEntityOptions.map((row) => (
            <option key={`cash-fx-report-le-${row.id}`} value={row.id}>
              {toLegalEntityLabel(row)}
            </option>
          ))}
        </select>
      );
    }

    return (
      <input
        type="number"
        min="1"
        className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm font-normal"
        value={filters.legalEntityId}
        onChange={(event) =>
          setFilters((prev) => ({
            ...prev,
            legalEntityId: event.target.value,
            sourceRegisterId: "",
            targetRegisterId: "",
            registerId: "",
            bookId: "",
          }))
        }
        placeholder="legalEntityId"
      />
    );
  }

  function renderRegisterInput({ value, onChange, idPrefix, allLabel = "All" }) {
    if (registerOptions.length > 0) {
      return (
        <select
          className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm font-normal"
          value={value}
          onChange={onChange}
        >
          <option value="">{allLabel}</option>
          {registerOptions.map((row) => (
            <option key={`${idPrefix}-${row.id}`} value={row.id}>
              {toRegisterLabel(row)} ({toUpper(row?.currency_code) || "?"})
            </option>
          ))}
        </select>
      );
    }

    return (
      <input
        type="number"
        min="1"
        className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm font-normal"
        value={value}
        onChange={onChange}
        placeholder="registerId"
      />
    );
  }

  function renderBookInput() {
    if (bookOptions.length > 0) {
      return (
        <select
          className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm font-normal"
          value={filters.bookId}
          onChange={(event) =>
            setFilters((prev) => ({ ...prev, bookId: event.target.value }))
          }
        >
          <option value="">All</option>
          {bookOptions.map((row) => (
            <option key={`cash-fx-report-book-${row.id}`} value={row.id}>
              {toBookLabel(row)}
            </option>
          ))}
        </select>
      );
    }

    return (
      <input
        type="number"
        min="1"
        className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm font-normal"
        value={filters.bookId}
        onChange={(event) =>
          setFilters((prev) => ({ ...prev, bookId: event.target.value }))
        }
        placeholder="bookId"
      />
    );
  }

  function renderFiltersForTab() {
    if (activeTab === REPORT_TABS.EXCHANGE_HISTORY) {
      return (
        <>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Legal Entity
            {renderLegalEntityInput()}
          </label>

          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Source Register
            {renderRegisterInput({
              value: filters.sourceRegisterId,
              onChange: (event) =>
                setFilters((prev) => ({
                  ...prev,
                  sourceRegisterId: event.target.value,
                })),
              idPrefix: "cash-fx-report-source-register",
            })}
          </label>

          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Target Register
            {renderRegisterInput({
              value: filters.targetRegisterId,
              onChange: (event) =>
                setFilters((prev) => ({
                  ...prev,
                  targetRegisterId: event.target.value,
                })),
              idPrefix: "cash-fx-report-target-register",
            })}
          </label>

          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Status
            <select
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm font-normal"
              value={filters.exchangeStatus}
              onChange={(event) =>
                setFilters((prev) => ({
                  ...prev,
                  exchangeStatus: event.target.value,
                }))
              }
            >
              <option value="">All</option>
              {EXCHANGE_STATUSES.map((status) => (
                <option key={`cash-fx-report-ex-status-${status}`} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Created From
            <input
              type="date"
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm font-normal"
              value={filters.createdDateFrom}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, createdDateFrom: event.target.value }))
              }
            />
          </label>

          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Created To
            <input
              type="date"
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm font-normal"
              value={filters.createdDateTo}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, createdDateTo: event.target.value }))
              }
            />
          </label>
        </>
      );
    }

    if (activeTab === REPORT_TABS.FOREIGN_BALANCES) {
      return (
        <>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            As-Of Date
            <input
              type="date"
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm font-normal"
              value={filters.asOfDate}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, asOfDate: event.target.value }))
              }
            />
          </label>

          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Legal Entity
            {renderLegalEntityInput()}
          </label>

          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Register
            {renderRegisterInput({
              value: filters.registerId,
              onChange: (event) =>
                setFilters((prev) => ({ ...prev, registerId: event.target.value })),
              idPrefix: "cash-fx-report-register",
            })}
          </label>

          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Currency
            <input
              type="text"
              maxLength={3}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm font-normal uppercase"
              value={filters.currencyCode}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, currencyCode: event.target.value }))
              }
              placeholder="USD"
            />
          </label>

          <label className="flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
            <input
              type="checkbox"
              checked={Boolean(filters.includeBaseCurrency)}
              onChange={(event) =>
                setFilters((prev) => ({
                  ...prev,
                  includeBaseCurrency: event.target.checked,
                }))
              }
            />
            Include Base Currency
          </label>

          <label className="flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
            <input
              type="checkbox"
              checked={Boolean(filters.includeZeroBalances)}
              onChange={(event) =>
                setFilters((prev) => ({
                  ...prev,
                  includeZeroBalances: event.target.checked,
                }))
              }
            />
            Include Zero Balances
          </label>
        </>
      );
    }

    return (
      <>
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          Legal Entity
          {renderLegalEntityInput()}
        </label>

        <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          Book
          {renderBookInput()}
        </label>

        <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          Run Type
          <select
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm font-normal"
            value={filters.revaluationRunType}
            onChange={(event) =>
              setFilters((prev) => ({
                ...prev,
                revaluationRunType: event.target.value,
              }))
            }
          >
            <option value="">All</option>
            {REVALUATION_RUN_TYPES.map((item) => (
              <option key={`cash-fx-report-run-type-${item}`} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          Status
          <select
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm font-normal"
            value={filters.revaluationStatus}
            onChange={(event) =>
              setFilters((prev) => ({
                ...prev,
                revaluationStatus: event.target.value,
              }))
            }
          >
            <option value="">All</option>
            {REVALUATION_RUN_STATUSES.map((item) => (
              <option key={`cash-fx-report-run-status-${item}`} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          Period End From
          <input
            type="date"
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm font-normal"
            value={filters.periodEndFrom}
            onChange={(event) =>
              setFilters((prev) => ({
                ...prev,
                periodEndFrom: event.target.value,
              }))
            }
          />
        </label>

        <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          Period End To
          <input
            type="date"
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm font-normal"
            value={filters.periodEndTo}
            onChange={(event) =>
              setFilters((prev) => ({
                ...prev,
                periodEndTo: event.target.value,
              }))
            }
          />
        </label>

        <label className="flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
          <input
            type="checkbox"
            checked={Boolean(filters.includeLineCurrencySummary)}
            onChange={(event) =>
              setFilters((prev) => ({
                ...prev,
                includeLineCurrencySummary: event.target.checked,
              }))
            }
          />
          Include Line Currency Summary
        </label>
      </>
    );
  }

  function renderSummaryCards() {
    const summary = activeReport?.summary || {};
    if (activeTab === REPORT_TABS.EXCHANGE_HISTORY) {
      const statusCounts = summary?.statusCounts || {};
      const cards = [
        ["Total Rows", activeTotal],
        ["Posted Source Txn Total", formatAmount(summary?.sourceAmountTxnTotal)],
        ["Posted Target Txn Total", formatAmount(summary?.targetAmountTxnTotal)],
        ["Posted Principal FX Diff (Base)", formatAmount(summary?.principalFxDifferenceBaseTotal)],
        ["Posted Realized FX (Base)", formatAmount(summary?.realizedFxBaseTotal)],
        [
          "Posted Fees + Spread (Base)",
          formatAmount((summary?.feeAmountBaseTotal || 0) + (summary?.spreadAmountBaseTotal || 0)),
        ],
        ["Gross Source Txn Total", formatAmount(summary?.grossSourceAmountTxnTotal)],
        ["Gross Target Txn Total", formatAmount(summary?.grossTargetAmountTxnTotal)],
        ["Gross Realized FX (Base)", formatAmount(summary?.grossRealizedFxBaseTotal)],
        ["Reversal Realized FX (Base)", formatAmount(summary?.reversalRealizedFxBaseTotal)],
        [
          "Net Realized FX (Base)",
          formatAmount((summary?.realizedFxBaseTotal || 0) + (summary?.reversalRealizedFxBaseTotal || 0)),
        ],
      ];
      return (
        <>
          <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
            {cards.map(([label, value]) => (
              <article
                key={`cash-fx-summary-${label}`}
                className="rounded-xl border border-slate-200 bg-white p-3"
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {label}
                </p>
                <p className="mt-1 text-lg font-semibold text-slate-900">{value ?? "-"}</p>
              </article>
            ))}
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-700">Status Counts</h2>
            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              {Object.keys(statusCounts).length === 0 ? (
                <span className="text-slate-500">No status summary.</span>
              ) : (
                Object.entries(statusCounts).map(([key, value]) => (
                  <span
                    key={`cash-fx-status-count-${key}`}
                    className="rounded-full border border-slate-300 px-3 py-1 text-slate-700"
                  >
                    {key}: {Number(value || 0)}
                  </span>
                ))
              )}
            </div>
          </section>
        </>
      );
    }

    if (activeTab === REPORT_TABS.FOREIGN_BALANCES) {
      const cards = [
        ["Total Rows", activeTotal],
        ["Register Count", Number(summary?.registerCount || 0)],
        ["Total Balance Txn", formatAmount(summary?.totalBalanceTxn)],
        ["Total Carrying Base", formatAmount(summary?.totalCarryingBase)],
        ["As-Of Date", activeReport?.asOfDate || "-"],
      ];
      return (
        <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
          {cards.map(([label, value]) => (
            <article
              key={`cash-fx-summary-${label}`}
              className="rounded-xl border border-slate-200 bg-white p-3"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {label}
              </p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{value ?? "-"}</p>
            </article>
          ))}
        </section>
      );
    }

    const cards = [
      ["Total Runs", activeTotal],
      ["Total Carrying Base", formatAmount(summary?.totalCarryingBase)],
      ["Total Closing Base", formatAmount(summary?.totalClosingBase)],
      ["Total Delta Base", formatAmount(summary?.totalDeltaBase)],
      ["Include Line Summary", activeReport?.includeLineCurrencySummary ? "YES" : "NO"],
    ];
    return (
      <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
        {cards.map(([label, value]) => (
          <article
            key={`cash-fx-summary-${label}`}
            className="rounded-xl border border-slate-200 bg-white p-3"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {label}
            </p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{value ?? "-"}</p>
          </article>
        ))}
      </section>
    );
  }

  function renderExchangeHistoryTable() {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-700">Exchange History Rows</h2>
        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-3 py-2">Batch</th>
                <th className="px-3 py-2">Legal Entity</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Target</th>
                <th className="px-3 py-2">FX</th>
                <th className="px-3 py-2">Base / Realized</th>
                <th className="px-3 py-2">Fee / Spread</th>
                <th className="px-3 py-2">Original / Reversal</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {activeRows.map((row) => {
                const realizedFxBase = Number(row?.realizedFxBase || 0);
                const reversalRealizedFxBase = Number(row?.reversalRealizedFxBase || 0);
                const netRealizedFxBase = realizedFxBase + reversalRealizedFxBase;
                const isReversed = toUpper(row?.status) === "REVERSED";
                return (
                  <tr key={`cash-fx-ex-history-${row?.id}`} className="border-t border-slate-100">
                    <td className="px-3 py-2">#{row?.id || "-"}</td>
                    <td className="px-3 py-2">
                      {(row?.legalEntityCode || row?.legalEntityId || "-") +
                        " - " +
                        (row?.legalEntityName || "-")}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">
                        {row?.sourceRegisterCode || row?.sourceRegisterId || "-"}
                      </div>
                      <div className="text-slate-600">
                        {formatAmount(row?.sourceAmountTxn)} {row?.sourceCurrencyCode || "-"}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">
                        {row?.targetRegisterCode || row?.targetRegisterId || "-"}
                      </div>
                      <div className="text-slate-600">
                        {formatAmount(row?.targetAmountTxn)} {row?.targetCurrencyCode || "-"}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div>{row?.fxRate ? Number(row.fxRate).toFixed(10) : "-"}</div>
                      <div className="text-xs text-slate-600">
                        {(row?.fxRateSource || "-") + " / " + (row?.fxRateDate || "-")}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div>
                        Src: {formatAmount(row?.sourceAmountBase)} | Tgt:{" "}
                        {formatAmount(row?.targetAmountBase)}
                      </div>
                      <div>Realized: {formatAmount(realizedFxBase)}</div>
                      <div>Reversal Realized: {formatAmount(reversalRealizedFxBase)}</div>
                      <div>Net Realized: {formatAmount(netRealizedFxBase)}</div>
                    </td>
                    <td className="px-3 py-2">
                      <div>Fee: {formatAmount(row?.feeAmountBase)}</div>
                      <div>Spread: {formatAmount(row?.spreadAmountBase)}</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-xs">
                        Orig Out/In: {formatTxnId(row?.exchangeOutCashTransactionId)} /{" "}
                        {formatTxnId(row?.exchangeInCashTransactionId)}
                      </div>
                      <div className="text-xs">
                        Rev Out/In: {formatTxnId(row?.reversalOutCashTransactionId)} /{" "}
                        {formatTxnId(row?.reversalInCashTransactionId)}
                      </div>
                      <div className="text-xs text-slate-600">
                        Reversed At: {formatDateTime(row?.reversedAt)}
                      </div>
                      {isReversed ? (
                        <div className="text-xs text-slate-600">
                          Reason: {String(row?.reverseReason || "-")}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${statusClassName(
                          row?.status
                        )}`}
                      >
                        {row?.status || "-"}
                      </span>
                    </td>
                    <td className="px-3 py-2">{formatDateTime(row?.createdAt)}</td>
                  </tr>
                );
              })}
              {!loading && activeRows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-3 py-3 text-slate-500">
                    No rows.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  function renderForeignBalancesTable() {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-700">Foreign Balance Rows</h2>
        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-3 py-2">Legal Entity</th>
                <th className="px-3 py-2">Register</th>
                <th className="px-3 py-2">Account</th>
                <th className="px-3 py-2">Currency</th>
                <th className="px-3 py-2">Balance (Txn)</th>
                <th className="px-3 py-2">Carrying (Base)</th>
                <th className="px-3 py-2">Foreign?</th>
              </tr>
            </thead>
            <tbody>
              {activeRows.map((row) => (
                <tr
                  key={`cash-fx-foreign-balance-${row?.registerId || "x"}-${row?.currencyCode || "x"}`}
                  className="border-t border-slate-100"
                >
                  <td className="px-3 py-2">
                    {(row?.legalEntityCode || row?.legalEntityId || "-") +
                      " - " +
                      (row?.legalEntityName || "-")}
                  </td>
                  <td className="px-3 py-2">
                    {(row?.registerCode || row?.registerId || "-") +
                      " - " +
                      (row?.registerName || "-")}
                  </td>
                  <td className="px-3 py-2">
                    {(row?.accountCode || row?.accountId || "-") +
                      " - " +
                      (row?.accountName || "-")}
                  </td>
                  <td className="px-3 py-2">
                    {row?.currencyCode || "-"} / {row?.baseCurrencyCode || "-"}
                  </td>
                  <td className="px-3 py-2">{formatAmount(row?.balanceAmountTxn)}</td>
                  <td className="px-3 py-2">{formatAmount(row?.carryingAmountBase)}</td>
                  <td className="px-3 py-2">{row?.isForeignCurrency ? "YES" : "NO"}</td>
                </tr>
              ))}
              {!loading && activeRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-3 text-slate-500">
                    No rows.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  function renderRevaluationRunsTable() {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-700">Revaluation Run Rows</h2>
        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-3 py-2">Run</th>
                <th className="px-3 py-2">Legal Entity</th>
                <th className="px-3 py-2">Period</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Totals (Base)</th>
                <th className="px-3 py-2">Journal</th>
                <th className="px-3 py-2">Completed</th>
                <th className="px-3 py-2">Details</th>
              </tr>
            </thead>
            <tbody>
              {activeRows.map((row) => {
                const runId = toPositiveInt(row?.runId);
                const lineSummary = Array.isArray(row?.lineCurrencySummary)
                  ? row.lineCurrencySummary
                  : [];
                const expanded = Boolean(expandedRunIds[String(runId || 0)]);

                return (
                  <>
                    <tr
                      key={`cash-fx-reval-run-${row?.runId}`}
                      className="border-t border-slate-100"
                    >
                      <td className="px-3 py-2">
                        <div className="font-semibold">#{row?.runId || "-"}</div>
                        <div className="text-xs text-slate-600">
                          {formatDate(row?.periodEndDate)}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        {(row?.legalEntityCode || row?.legalEntityId || "-") +
                          " - " +
                          (row?.legalEntityName || "-")}
                      </td>
                      <td className="px-3 py-2">
                        <div>FY{row?.fiscalYear || "-"} P{row?.periodNo || "-"}</div>
                        <div className="text-xs text-slate-600">{row?.periodName || "-"}</div>
                      </td>
                      <td className="px-3 py-2">{row?.runType || "-"}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${statusClassName(
                            row?.status
                          )}`}
                        >
                          {row?.status || "-"}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div>Carry: {formatAmount(row?.totalCarryingBase)}</div>
                        <div>Close: {formatAmount(row?.totalClosingBase)}</div>
                        <div>Delta: {formatAmount(row?.totalDeltaBase)}</div>
                      </td>
                      <td className="px-3 py-2">
                        <div>JE: {row?.journalEntryId || "-"}</div>
                        <div className="text-xs text-slate-600">
                          Rev: {row?.reversalJournalEntryId || "-"}
                        </div>
                      </td>
                      <td className="px-3 py-2">{formatDateTime(row?.completedAt)}</td>
                      <td className="px-3 py-2">
                        {lineSummary.length > 0 ? (
                          <button
                            type="button"
                            className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700"
                            onClick={() => toggleRunDetails(runId)}
                          >
                            {expanded ? "Hide currencies" : "View currencies"}
                          </button>
                        ) : (
                          <span className="text-xs text-slate-500">No line summary</span>
                        )}
                      </td>
                    </tr>
                    {expanded && lineSummary.length > 0 ? (
                      <tr
                        key={`cash-fx-reval-lines-${row?.runId}`}
                        className="border-t border-slate-100 bg-slate-50"
                      >
                        <td colSpan={9} className="px-3 py-3">
                          <div className="overflow-x-auto rounded border border-slate-200 bg-white">
                            <table className="min-w-full text-xs">
                              <thead className="bg-slate-100 text-left text-slate-600">
                                <tr>
                                  <th className="px-2 py-1.5">Currency</th>
                                  <th className="px-2 py-1.5">Register Count</th>
                                  <th className="px-2 py-1.5">Balance Txn</th>
                                  <th className="px-2 py-1.5">Carrying Base</th>
                                  <th className="px-2 py-1.5">Closing Base</th>
                                  <th className="px-2 py-1.5">Delta Base</th>
                                </tr>
                              </thead>
                              <tbody>
                                {lineSummary.map((line, index) => (
                                  <tr
                                    key={`cash-fx-reval-line-${row?.runId}-${line?.currencyCode || index}`}
                                    className="border-t border-slate-100"
                                  >
                                    <td className="px-2 py-1.5">{line?.currencyCode || "-"}</td>
                                    <td className="px-2 py-1.5">
                                      {Number(line?.registerCount || 0)}
                                    </td>
                                    <td className="px-2 py-1.5">
                                      {formatAmount(line?.balanceAmountTxn)}
                                    </td>
                                    <td className="px-2 py-1.5">
                                      {formatAmount(line?.carryingAmountBase)}
                                    </td>
                                    <td className="px-2 py-1.5">
                                      {formatAmount(line?.closingAmountBase)}
                                    </td>
                                    <td className="px-2 py-1.5">
                                      {formatAmount(line?.deltaBase)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </>
                );
              })}
              {!loading && activeRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-3 text-slate-500">
                    No rows.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  if (!canRead) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Missing permission: `cash.report.read`
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h1 className="text-xl font-semibold text-slate-900">Cash FX Reports</h1>
        <p className="mt-1 text-sm text-slate-600">
          Exchange history, foreign balances, and revaluation runs in one workspace.
        </p>

        {lookupWarning ? (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
            {lookupWarning}
          </div>
        ) : null}
        {error ? (
          <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
            {errorRequestId ? (
              <span className="ml-2 text-xs">(requestId: {errorRequestId})</span>
            ) : null}
          </div>
        ) : null}
        {message ? (
          <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {message}
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          {TAB_CONFIG.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                activeTab === tab.id
                  ? "bg-cyan-700 text-white"
                  : "border border-slate-300 text-slate-700"
              }`}
              onClick={() => {
                setActiveTab(tab.id);
                setMessage("");
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <form className="mt-4 grid gap-2 md:grid-cols-7" onSubmit={handleApplyFilters}>
          {renderFiltersForTab()}

          <div className="md:col-span-7 flex flex-wrap items-center gap-2">
            <button
              type="submit"
              className="rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
              disabled={loading}
            >
              {loading ? "Loading..." : "Apply Filters"}
            </button>
            <button
              type="button"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
              onClick={handleResetFilters}
              disabled={loading}
            >
              Reset
            </button>
            <button
              type="button"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
              onClick={() =>
                loadReport(activeTab, {
                  nextFilters: filters,
                  nextPagination: paginationByTab[activeTab],
                })
              }
              disabled={loading}
            >
              Refresh
            </button>
            <button
              type="button"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
              onClick={handleExportCsv}
              disabled={loading || activeRows.length === 0}
            >
              Export CSV
            </button>
          </div>
        </form>
      </section>

      {renderSummaryCards()}

      {activeTab === REPORT_TABS.EXCHANGE_HISTORY
        ? renderExchangeHistoryTable()
        : null}
      {activeTab === REPORT_TABS.FOREIGN_BALANCES
        ? renderForeignBalancesTable()
        : null}
      {activeTab === REPORT_TABS.REVALUATION_RUNS
        ? renderRevaluationRunsTable()
        : null}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-700">
          <div>
            Rows: {activeRows.length} | Total: {activeTotal} | Page: {activePage}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded border border-slate-300 px-3 py-1.5 font-semibold text-slate-700 disabled:opacity-60"
              onClick={() => handleChangePage(-1)}
              disabled={loading || !hasPrevPage}
            >
              Previous
            </button>
            <button
              type="button"
              className="rounded border border-slate-300 px-3 py-1.5 font-semibold text-slate-700 disabled:opacity-60"
              onClick={() => handleChangePage(1)}
              disabled={loading || !hasNextPage}
            >
              Next
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
