import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  getCashFxOpsDashboard,
  overrideCashFxOpsException,
  rerunCashFxOpsExceptionJob,
} from "../../api/cashAdmin.js";
import { useAuth } from "../../auth/useAuth.js";

const SECTION_CONFIG = Object.freeze([
  {
    key: "missingRates",
    label: "Missing FX Rates",
    description: "FX rate dependencies that block revaluation or posting workflows.",
  },
  {
    key: "revaluationJobs",
    label: "Revaluation Jobs",
    description: "Failed/active cash FX revaluation jobs and linked exceptions.",
  },
  {
    key: "outOfPolicyBalances",
    label: "Out-of-Policy Balances",
    description: "Foreign cash balances violating configured policy thresholds.",
  },
  {
    key: "settlementCurrencyMismatch",
    label: "Settlement Currency Mismatch",
    description: "CARI settlement rows where settlement and register currencies diverge.",
  },
]);

const INITIAL_FILTERS = Object.freeze({
  legalEntityId: "",
  dateFrom: "",
  dateTo: "",
  days: "45",
  asOfDate: new Date().toISOString().slice(0, 10),
  abnormalBaseThreshold: "1000000",
  includeResolved: false,
  refresh: true,
  limit: "50",
});

const EMPTY_SECTION = Object.freeze({ total: 0, rows: [] });

const EMPTY_DASHBOARD = Object.freeze({
  window: {
    dateFrom: null,
    dateTo: null,
    days: 0,
  },
  summary: {
    total: 0,
    missingRates: 0,
    revaluationJobs: 0,
    outOfPolicyBalances: 0,
    settlementCurrencyMismatch: 0,
  },
  sections: {
    missingRates: EMPTY_SECTION,
    revaluationJobs: EMPTY_SECTION,
    outOfPolicyBalances: EMPTY_SECTION,
    settlementCurrencyMismatch: EMPTY_SECTION,
  },
  refresh: null,
});

const OPEN_STATUSES = new Set(["OPEN", "IN_REVIEW"]);

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function toOptionalNonNegativeInt(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : Number.NaN;
}

function toOptionalNonNegativeNumber(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : Number.NaN;
}

function toUpper(value) {
  return String(value || "").trim().toUpperCase();
}

function sectionOrEmpty(section) {
  return {
    total: Number(section?.total || 0),
    rows: Array.isArray(section?.rows) ? section.rows : [],
  };
}

function normalizeDashboard(payload) {
  return {
    window: {
      dateFrom: payload?.window?.dateFrom || null,
      dateTo: payload?.window?.dateTo || null,
      days: Number(payload?.window?.days || 0),
    },
    summary: {
      total: Number(payload?.summary?.total || 0),
      missingRates: Number(payload?.summary?.missingRates || 0),
      revaluationJobs: Number(payload?.summary?.revaluationJobs || 0),
      outOfPolicyBalances: Number(payload?.summary?.outOfPolicyBalances || 0),
      settlementCurrencyMismatch: Number(payload?.summary?.settlementCurrencyMismatch || 0),
    },
    sections: {
      missingRates: sectionOrEmpty(payload?.sections?.missingRates),
      revaluationJobs: sectionOrEmpty(payload?.sections?.revaluationJobs),
      outOfPolicyBalances: sectionOrEmpty(payload?.sections?.outOfPolicyBalances),
      settlementCurrencyMismatch: sectionOrEmpty(payload?.sections?.settlementCurrencyMismatch),
    },
    refresh: payload?.refresh || null,
  };
}

function statusClassName(status) {
  const normalized = toUpper(status);
  if (normalized === "OPEN") {
    return "bg-rose-100 text-rose-700";
  }
  if (normalized === "IN_REVIEW") {
    return "bg-amber-100 text-amber-800";
  }
  if (normalized === "RESOLVED") {
    return "bg-emerald-100 text-emerald-700";
  }
  if (normalized === "IGNORED") {
    return "bg-slate-200 text-slate-700";
  }
  return "bg-slate-200 text-slate-700";
}

function severityClassName(severity) {
  const normalized = toUpper(severity);
  if (normalized === "CRITICAL") {
    return "bg-rose-100 text-rose-700";
  }
  if (normalized === "HIGH") {
    return "bg-orange-100 text-orange-700";
  }
  if (normalized === "MEDIUM") {
    return "bg-amber-100 text-amber-800";
  }
  return "bg-sky-100 text-sky-700";
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

function stringifyPayload(value) {
  if (value === undefined || value === null || value === "") {
    return "-";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function normalizeErrorMessage(err, fallback) {
  return String(err?.response?.data?.message || err?.message || fallback);
}

function extractRequestId(err) {
  return (
    err?.response?.data?.requestId ||
    err?.response?.headers?.["x-request-id"] ||
    null
  );
}

function validateFilters(filters) {
  if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) {
    return "dateFrom cannot be greater than dateTo.";
  }
  const days = toOptionalNonNegativeInt(filters.days);
  if (Number.isNaN(days) || days === 0) {
    return "days must be a positive integer.";
  }
  const threshold = toOptionalNonNegativeNumber(filters.abnormalBaseThreshold);
  if (Number.isNaN(threshold)) {
    return "abnormalBaseThreshold must be a non-negative number.";
  }
  const limit = toOptionalNonNegativeInt(filters.limit);
  if (Number.isNaN(limit) || limit === 0) {
    return "limit must be a positive integer.";
  }
  if (limit !== null && limit > 500) {
    return "limit cannot exceed 500.";
  }
  return "";
}

function buildDashboardQuery(filters, options = {}) {
  const threshold = toOptionalNonNegativeNumber(filters.abnormalBaseThreshold);
  const limit = toOptionalNonNegativeInt(filters.limit);
  const query = {
    legalEntityId: toPositiveInt(filters.legalEntityId) || undefined,
    dateFrom: filters.dateFrom || undefined,
    dateTo: filters.dateTo || undefined,
    days: toPositiveInt(filters.days) || undefined,
    asOfDate: filters.asOfDate || undefined,
    abnormalBaseThreshold: threshold === null ? undefined : Number(threshold),
    includeResolved: Boolean(filters.includeResolved),
    refresh:
      options.forceRefresh === true
        ? true
        : options.forceRefresh === false
          ? false
          : Boolean(filters.refresh),
    limit: limit || 50,
  };
  return query;
}

function canRunActionsForStatus(status) {
  return OPEN_STATUSES.has(toUpper(status));
}

function buildWorkbenchLink(exceptionId) {
  const id = toPositiveInt(exceptionId);
  if (!id) {
    return "/app/ayarlar/exception-workbench?moduleCode=CASH";
  }
  return `/app/ayarlar/exception-workbench?moduleCode=CASH&exceptionId=${id}`;
}

export default function CashFxOpsDashboardPage() {
  const { hasPermission } = useAuth();

  const canRead = hasPermission("cash.report.read");
  const canRerunJobs = hasPermission("ops.jobs.manage");
  const canOverride = hasPermission("ops.exceptions.manage");

  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [loading, setLoading] = useState(false);
  const [actionBusyKey, setActionBusyKey] = useState("");
  const [dashboard, setDashboard] = useState(EMPTY_DASHBOARD);
  const [error, setError] = useState("");
  const [errorRequestId, setErrorRequestId] = useState(null);
  const [message, setMessage] = useState("");

  const [rerunDelaySeconds, setRerunDelaySeconds] = useState("0");
  const [rerunMaxAttempts, setRerunMaxAttempts] = useState("");
  const [rerunResolutionNote, setRerunResolutionNote] = useState("");
  const [overrideReason, setOverrideReason] = useState("");

  const summaryCards = useMemo(
    () => [
      { label: "Total Exceptions", value: dashboard.summary.total },
      { label: "Missing Rates", value: dashboard.summary.missingRates },
      { label: "Revaluation Jobs", value: dashboard.summary.revaluationJobs },
      { label: "Out-of-Policy Balances", value: dashboard.summary.outOfPolicyBalances },
      {
        label: "Settlement Currency Mismatch",
        value: dashboard.summary.settlementCurrencyMismatch,
      },
    ],
    [dashboard.summary]
  );

  const loadDashboard = useCallback(
    async (nextFilters, options = {}) => {
      if (!canRead) {
        setDashboard(EMPTY_DASHBOARD);
        return;
      }
      setLoading(true);
      setError("");
      setErrorRequestId(null);
      setMessage("");
      try {
        const query = buildDashboardQuery(nextFilters, options);
        const payload = await getCashFxOpsDashboard(query);
        setDashboard(normalizeDashboard(payload));
      } catch (err) {
        setDashboard(EMPTY_DASHBOARD);
        setError(normalizeErrorMessage(err, "FX ops dashboard could not be loaded."));
        setErrorRequestId(extractRequestId(err));
      } finally {
        setLoading(false);
      }
    },
    [canRead]
  );

  useEffect(() => {
    if (!canRead) {
      setDashboard(EMPTY_DASHBOARD);
      return;
    }
    void loadDashboard(INITIAL_FILTERS);
  }, [canRead, loadDashboard]);

  async function handleRerunJob(exceptionId) {
    if (!canRerunJobs) {
      setError("Missing permission: ops.jobs.manage");
      setErrorRequestId(null);
      return;
    }
    const normalizedExceptionId = toPositiveInt(exceptionId);
    if (!normalizedExceptionId) {
      setError("Exception id is required for rerun.");
      setErrorRequestId(null);
      return;
    }

    const delaySeconds = toOptionalNonNegativeInt(rerunDelaySeconds);
    if (Number.isNaN(delaySeconds)) {
      setError("delaySeconds must be a non-negative integer.");
      setErrorRequestId(null);
      return;
    }
    const maxAttempts = toOptionalNonNegativeInt(rerunMaxAttempts);
    if (Number.isNaN(maxAttempts) || maxAttempts === 0) {
      setError("maxAttempts must be empty or a positive integer.");
      setErrorRequestId(null);
      return;
    }

    setActionBusyKey(`rerun-${normalizedExceptionId}`);
    setError("");
    setErrorRequestId(null);
    setMessage("");
    try {
      const payload = {
        delaySeconds: delaySeconds || 0,
        maxAttempts: maxAttempts || undefined,
        resolutionNote: String(rerunResolutionNote || "").trim() || undefined,
      };
      const result = await rerunCashFxOpsExceptionJob(normalizedExceptionId, payload);
      const jobId = toPositiveInt(result?.job?.id);
      setMessage(
        jobId
          ? `Exception #${normalizedExceptionId} rerun queued on job #${jobId}.`
          : `Exception #${normalizedExceptionId} rerun action completed.`
      );
      await loadDashboard(filters, { forceRefresh: false });
    } catch (err) {
      setError(normalizeErrorMessage(err, "Rerun action failed."));
      setErrorRequestId(extractRequestId(err));
    } finally {
      setActionBusyKey("");
    }
  }

  async function handleOverride(exceptionId) {
    if (!canOverride) {
      setError("Missing permission: ops.exceptions.manage");
      setErrorRequestId(null);
      return;
    }
    const normalizedExceptionId = toPositiveInt(exceptionId);
    if (!normalizedExceptionId) {
      setError("Exception id is required for override.");
      setErrorRequestId(null);
      return;
    }
    const reason = String(overrideReason || "").trim();
    if (!reason) {
      setError("Override reason is required.");
      setErrorRequestId(null);
      return;
    }

    setActionBusyKey(`override-${normalizedExceptionId}`);
    setError("");
    setErrorRequestId(null);
    setMessage("");
    try {
      await overrideCashFxOpsException(normalizedExceptionId, { reason });
      setMessage(`Exception #${normalizedExceptionId} overridden as IGNORED.`);
      await loadDashboard(filters, { forceRefresh: false });
    } catch (err) {
      setError(normalizeErrorMessage(err, "Override action failed."));
      setErrorRequestId(extractRequestId(err));
    } finally {
      setActionBusyKey("");
    }
  }

  function handleApplyFilters(event) {
    event.preventDefault();
    const validationError = validateFilters(filters);
    if (validationError) {
      setError(validationError);
      setErrorRequestId(null);
      return;
    }
    void loadDashboard(filters);
  }

  function handleResetFilters() {
    setFilters(INITIAL_FILTERS);
    void loadDashboard(INITIAL_FILTERS);
  }

  function renderSection(sectionKey) {
    const config = SECTION_CONFIG.find((item) => item.key === sectionKey);
    const section = dashboard.sections[sectionKey] || EMPTY_SECTION;
    const rows = Array.isArray(section.rows) ? section.rows : [];
    return (
      <section
        key={`cash-fx-ops-section-${sectionKey}`}
        className="rounded-xl border border-slate-200 bg-white p-4"
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {config?.label || sectionKey}
            </h2>
            <p className="mt-1 text-sm text-slate-600">{config?.description || "-"}</p>
            <p className="mt-1 text-xs text-slate-500">Total: {Number(section.total || 0)}</p>
          </div>
        </div>

        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-3 py-2">Exception</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Last Seen</th>
                <th className="px-3 py-2">Resolution</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => {
                const exceptionId = toPositiveInt(row?.exceptionId);
                const canAction = canRunActionsForStatus(row?.status);
                const rerunBusy = actionBusyKey === `rerun-${exceptionId}`;
                const overrideBusy = actionBusyKey === `override-${exceptionId}`;
                return (
                  <tr
                    key={`cash-fx-ops-row-${sectionKey}-${row?.exceptionId || rowIndex}`}
                    className="border-t border-slate-100 align-top"
                  >
                    <td className="px-3 py-2">
                      <div className="font-semibold">#{row?.exceptionId || "-"}</div>
                      <div className="text-xs text-slate-600">{row?.title || "-"}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {row?.legalEntityCode || row?.legalEntityId || "-"} -{" "}
                        {row?.legalEntityName || "-"}
                      </div>
                      <Link
                        className="mt-1 inline-flex text-xs font-semibold text-cyan-700 underline"
                        to={buildWorkbenchLink(row?.exceptionId)}
                      >
                        Open in Exceptions Workbench
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-xs">{row?.sourceType || "-"}</div>
                      <div className="text-xs text-slate-500">{row?.exceptionType || "-"}</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-1">
                        <span
                          className={`inline-flex w-fit rounded-full px-2 py-0.5 text-xs font-semibold ${statusClassName(
                            row?.status
                          )}`}
                        >
                          {row?.status || "-"}
                        </span>
                        <span
                          className={`inline-flex w-fit rounded-full px-2 py-0.5 text-xs font-semibold ${severityClassName(
                            row?.severity
                          )}`}
                        >
                          {row?.severity || "-"}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-xs">key: {row?.sourceKey || "-"}</div>
                      <div className="text-xs">ref: {row?.sourceRef || "-"}</div>
                      <div className="text-xs">refId: {row?.sourceRefId || "-"}</div>
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs font-semibold text-slate-600">
                          payload
                        </summary>
                        <pre className="mt-1 overflow-auto rounded bg-slate-50 p-2 text-[11px] text-slate-700">
                          {stringifyPayload(row?.payload)}
                        </pre>
                      </details>
                    </td>
                    <td className="px-3 py-2">
                      <div>{formatDateTime(row?.lastSeenAt)}</div>
                      <div className="text-xs text-slate-500">
                        first: {formatDateTime(row?.firstSeenAt)}
                      </div>
                      <div className="text-xs text-slate-500">
                        updated: {formatDateTime(row?.updatedAt)}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-xs">{row?.resolutionAction || "-"}</div>
                      <div className="text-xs text-slate-500">
                        by: {row?.resolvedByUserId || "-"}
                      </div>
                      <div className="text-xs text-slate-500">
                        at: {formatDateTime(row?.resolvedAt)}
                      </div>
                      {row?.resolutionNote ? (
                        <div className="mt-1 rounded bg-slate-50 p-2 text-xs text-slate-600">
                          {row.resolutionNote}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-2">
                        <button
                          type="button"
                          className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 disabled:opacity-60"
                          onClick={() => handleRerunJob(row?.exceptionId)}
                          disabled={
                            !canRerunJobs ||
                            !canAction ||
                            toUpper(row?.sourceType) !== "CASH_FX_REVAL_JOB" ||
                            rerunBusy ||
                            overrideBusy
                          }
                        >
                          {rerunBusy ? "Rerunning..." : "Rerun Job"}
                        </button>
                        <button
                          type="button"
                          className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 disabled:opacity-60"
                          onClick={() => handleOverride(row?.exceptionId)}
                          disabled={!canOverride || !canAction || rerunBusy || overrideBusy}
                        >
                          {overrideBusy ? "Overriding..." : "Override"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-3 text-slate-500">
                    No section rows.
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
        <h1 className="text-xl font-semibold text-slate-900">Cash FX Ops Dashboard</h1>
        <p className="mt-1 text-sm text-slate-600">
          Monitor FX exceptions and trigger rerun/override actions for CASH operations.
        </p>

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

        <form className="mt-4 grid gap-2 md:grid-cols-5" onSubmit={handleApplyFilters}>
          <label className="text-sm">
            <div className="mb-1 text-slate-600">Legal Entity ID</div>
            <input
              className="w-full rounded border px-2 py-1"
              value={filters.legalEntityId}
              onChange={(event) =>
                setFilters((state) => ({ ...state, legalEntityId: event.target.value }))
              }
              placeholder="optional"
            />
          </label>
          <label className="text-sm">
            <div className="mb-1 text-slate-600">Date From</div>
            <input
              type="date"
              className="w-full rounded border px-2 py-1"
              value={filters.dateFrom}
              onChange={(event) =>
                setFilters((state) => ({ ...state, dateFrom: event.target.value }))
              }
            />
          </label>
          <label className="text-sm">
            <div className="mb-1 text-slate-600">Date To</div>
            <input
              type="date"
              className="w-full rounded border px-2 py-1"
              value={filters.dateTo}
              onChange={(event) =>
                setFilters((state) => ({ ...state, dateTo: event.target.value }))
              }
            />
          </label>
          <label className="text-sm">
            <div className="mb-1 text-slate-600">As Of Date</div>
            <input
              type="date"
              className="w-full rounded border px-2 py-1"
              value={filters.asOfDate}
              onChange={(event) =>
                setFilters((state) => ({ ...state, asOfDate: event.target.value }))
              }
            />
          </label>
          <label className="text-sm">
            <div className="mb-1 text-slate-600">Days</div>
            <input
              className="w-full rounded border px-2 py-1"
              value={filters.days}
              onChange={(event) =>
                setFilters((state) => ({ ...state, days: event.target.value }))
              }
            />
          </label>
          <label className="text-sm">
            <div className="mb-1 text-slate-600">Abnormal Base Threshold</div>
            <input
              className="w-full rounded border px-2 py-1"
              value={filters.abnormalBaseThreshold}
              onChange={(event) =>
                setFilters((state) => ({
                  ...state,
                  abnormalBaseThreshold: event.target.value,
                }))
              }
            />
          </label>
          <label className="text-sm">
            <div className="mb-1 text-slate-600">Section Limit</div>
            <input
              className="w-full rounded border px-2 py-1"
              value={filters.limit}
              onChange={(event) =>
                setFilters((state) => ({ ...state, limit: event.target.value }))
              }
            />
          </label>
          <label className="flex items-center gap-2 text-sm md:col-span-1">
            <input
              type="checkbox"
              checked={Boolean(filters.includeResolved)}
              onChange={(event) =>
                setFilters((state) => ({
                  ...state,
                  includeResolved: event.target.checked,
                }))
              }
            />
            Include resolved
          </label>
          <label className="flex items-center gap-2 text-sm md:col-span-1">
            <input
              type="checkbox"
              checked={Boolean(filters.refresh)}
              onChange={(event) =>
                setFilters((state) => ({
                  ...state,
                  refresh: event.target.checked,
                }))
              }
            />
            Refresh sources
          </label>
          <div className="md:col-span-5 flex flex-wrap items-end gap-2">
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
              onClick={() => loadDashboard(filters, { forceRefresh: false })}
              disabled={loading}
            >
              Refresh View
            </button>
          </div>
        </form>
      </section>

      <section className="grid gap-3 md:grid-cols-5">
        {summaryCards.map((card) => (
          <article
            key={`cash-fx-ops-summary-${card.label}`}
            className="rounded-xl border border-slate-200 bg-white p-4"
          >
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {card.label}
            </h2>
            <p className="mt-2 text-2xl font-semibold text-slate-900">
              {Number(card.value || 0).toLocaleString()}
            </p>
          </article>
        ))}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-700">Action Inputs</h2>
        <p className="mt-1 text-xs text-slate-500">
          Rerun uses `ops.jobs.manage`; override uses `ops.exceptions.manage` and requires
          reason.
        </p>
        <div className="mt-3 grid gap-2 md:grid-cols-4">
          <label className="text-sm">
            <div className="mb-1 text-slate-600">Rerun delay (seconds)</div>
            <input
              className="w-full rounded border px-2 py-1"
              value={rerunDelaySeconds}
              onChange={(event) => setRerunDelaySeconds(event.target.value)}
            />
          </label>
          <label className="text-sm">
            <div className="mb-1 text-slate-600">Rerun max attempts (optional)</div>
            <input
              className="w-full rounded border px-2 py-1"
              value={rerunMaxAttempts}
              onChange={(event) => setRerunMaxAttempts(event.target.value)}
            />
          </label>
          <label className="text-sm md:col-span-2">
            <div className="mb-1 text-slate-600">Rerun resolution note (optional)</div>
            <input
              className="w-full rounded border px-2 py-1"
              value={rerunResolutionNote}
              onChange={(event) => setRerunResolutionNote(event.target.value)}
            />
          </label>
          <label className="text-sm md:col-span-4">
            <div className="mb-1 text-slate-600">Override reason (required for override)</div>
            <input
              className="w-full rounded border px-2 py-1"
              value={overrideReason}
              onChange={(event) => setOverrideReason(event.target.value)}
              placeholder="Manual override reason for audit trail"
            />
          </label>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-700">Dashboard Window</h2>
        <p className="mt-1 text-sm text-slate-600">
          {formatDate(dashboard.window.dateFrom)} to {formatDate(dashboard.window.dateTo)} (
          {Number(dashboard.window.days || 0)} days)
        </p>
        {dashboard.refresh ? (
          <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            refresh processed={Number(dashboard.refresh.processed || 0)} | jobs scanned=
            {Number(dashboard.refresh.scanned?.jobs || 0)} | balances scanned=
            {Number(dashboard.refresh.scanned?.balances || 0)}
          </div>
        ) : null}
      </section>

      {SECTION_CONFIG.map((section) => renderSection(section.key))}
    </div>
  );
}
