import { useCallback, useEffect, useMemo, useState } from "react";
import {
  downloadOpsAuditExportCsv,
  downloadOpsUsageExportCsv,
  getOpsBankPaymentBatchesHealth,
  getOpsBankReconciliationSummary,
  getOpsJobsHealth,
  getOpsPayrollCloseStatus,
  getOpsPayrollImportHealth,
} from "../api/opsDashboard.js";
import {
  cancelJobAdmin,
  getJobAdmin,
  listJobsAdmin,
  requeueJobAdmin,
  runOneJobAdmin,
} from "../api/jobsAdmin.js";
import { useAuth } from "../auth/useAuth.js";
import { useWorkingContextDefaults } from "../context/useWorkingContextDefaults.js";
import { usePersistedFilters } from "../hooks/usePersistedFilters.js";
import { useI18n } from "../i18n/useI18n.js";

function pretty(value) {
  return JSON.stringify(value ?? {}, null, 2);
}

const OPS_DASHBOARD_CONTEXT_MAPPINGS = [
  { stateKey: "legalEntityId" },
  { stateKey: "dateFrom" },
  { stateKey: "dateTo" },
];
const OPS_DASHBOARD_FILTERS_STORAGE_SCOPE = "ops-dashboard.filters";
const OPS_DASHBOARD_DEFAULT_FILTERS = {
  legalEntityId: "",
  bankAccountId: "",
  dateFrom: "",
  dateTo: "",
  days: "30",
  moduleCode: "",
  queueName: "",
  jobsStatus: "",
  jobsJobType: "",
  jobsLimit: "25",
  jobsOffset: "0",
};

export default function OpsDashboardPage() {
  const { hasPermission } = useAuth();
  const { t } = useI18n();
  const [filters, setFilters, resetFilters] = usePersistedFilters(
    OPS_DASHBOARD_FILTERS_STORAGE_SCOPE,
    () => ({ ...OPS_DASHBOARD_DEFAULT_FILTERS })
  );
  const [loading, setLoading] = useState(false);
  const [usageExporting, setUsageExporting] = useState(false);
  const [auditExporting, setAuditExporting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [data, setData] = useState({
    bankReconciliation: null,
    bankPayments: null,
    payrollImports: null,
    payrollClose: null,
    jobs: null,
  });
  const [jobsListLoading, setJobsListLoading] = useState(false);
  const [jobsListError, setJobsListError] = useState("");
  const [jobsListMessage, setJobsListMessage] = useState("");
  const [jobsListData, setJobsListData] = useState({
    items: [],
    total: 0,
    limit: 25,
    offset: 0,
  });
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [jobDetail, setJobDetail] = useState(null);
  const [jobDetailLoading, setJobDetailLoading] = useState(false);
  const [jobsActionLoading, setJobsActionLoading] = useState(false);
  const [requeueDelaySeconds, setRequeueDelaySeconds] = useState("0");
  const [requeueMaxAttempts, setRequeueMaxAttempts] = useState("");

  const canReadJobs = hasPermission("ops.jobs.read");
  const canManageJobs = hasPermission("ops.jobs.manage");
  const canRunJobs = hasPermission("ops.jobs.run");

  useWorkingContextDefaults(setFilters, OPS_DASHBOARD_CONTEXT_MAPPINGS, [
    filters.legalEntityId,
    filters.dateFrom,
    filters.dateTo,
  ]);

  const queryParams = useMemo(() => {
    const params = {};
    if (String(filters.legalEntityId || "").trim()) {
      params.legalEntityId = Number(filters.legalEntityId);
    }
    if (String(filters.bankAccountId || "").trim()) {
      params.bankAccountId = Number(filters.bankAccountId);
    }
    if (String(filters.dateFrom || "").trim()) {
      params.dateFrom = String(filters.dateFrom).trim();
    }
    if (String(filters.dateTo || "").trim()) {
      params.dateTo = String(filters.dateTo).trim();
    }
    if (String(filters.days || "").trim()) {
      params.days = Number(filters.days);
    }
    return params;
  }, [filters.bankAccountId, filters.dateFrom, filters.dateTo, filters.days, filters.legalEntityId]);

  const jobQueryParams = useMemo(() => {
    const params = { ...queryParams };
    if (String(filters.moduleCode || "").trim()) {
      params.moduleCode = String(filters.moduleCode).trim().toUpperCase();
    }
    if (String(filters.queueName || "").trim()) {
      params.queueName = String(filters.queueName).trim();
    }
    return params;
  }, [filters.moduleCode, filters.queueName, queryParams]);

  const jobsListQueryParams = useMemo(() => {
    const params = {
      limit: Number(filters.jobsLimit || 25) || 25,
      offset: Number(filters.jobsOffset || 0) || 0,
    };
    if (String(filters.jobsStatus || "").trim()) {
      params.status = String(filters.jobsStatus).trim().toUpperCase();
    }
    if (String(filters.moduleCode || "").trim()) {
      params.moduleCode = String(filters.moduleCode).trim().toUpperCase();
    }
    if (String(filters.jobsJobType || "").trim()) {
      params.jobType = String(filters.jobsJobType).trim().toUpperCase();
    }
    if (String(filters.queueName || "").trim()) {
      params.queueName = String(filters.queueName).trim();
    }
    return params;
  }, [
    filters.jobsLimit,
    filters.jobsOffset,
    filters.jobsStatus,
    filters.moduleCode,
    filters.jobsJobType,
    filters.queueName,
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const [bankReconciliation, bankPayments, payrollImports, payrollClose, jobs] =
        await Promise.all([
          getOpsBankReconciliationSummary(queryParams),
          getOpsBankPaymentBatchesHealth(queryParams),
          getOpsPayrollImportHealth(queryParams),
          getOpsPayrollCloseStatus(queryParams),
          getOpsJobsHealth(jobQueryParams),
        ]);

      setData({
        bankReconciliation,
        bankPayments,
        payrollImports,
        payrollClose,
        jobs,
      });
    } catch (err) {
      setError(
        err?.response?.data?.message || t("opsDashboard.messages.loadFailed", "Ops dashboard data could not be loaded")
      );
    } finally {
      setLoading(false);
    }
  }, [jobQueryParams, queryParams, t]);

  useEffect(() => {
    load();
  }, [load]);

  const loadJobsList = useCallback(async () => {
    if (!canReadJobs) {
      setJobsListData({ items: [], total: 0, limit: 25, offset: 0 });
      setJobsListError("");
      return;
    }
    setJobsListLoading(true);
    setJobsListError("");
    try {
      const result = await listJobsAdmin(jobsListQueryParams);
      setJobsListData({
        items: Array.isArray(result?.items) ? result.items : [],
        total: Number(result?.total || 0),
        limit: Number(result?.limit || jobsListQueryParams.limit || 25),
        offset: Number(result?.offset || jobsListQueryParams.offset || 0),
      });
    } catch (err) {
      setJobsListError(
        err?.response?.data?.message || "Jobs queue could not be loaded."
      );
    } finally {
      setJobsListLoading(false);
    }
  }, [canReadJobs, jobsListQueryParams]);

  const loadSelectedJobDetail = useCallback(async () => {
    if (!canReadJobs || !selectedJobId) {
      setJobDetail(null);
      return;
    }
    setJobDetailLoading(true);
    try {
      const result = await getJobAdmin(selectedJobId);
      setJobDetail(result || null);
    } catch (err) {
      setJobDetail(null);
      setJobsListError(
        err?.response?.data?.message || "Job detail could not be loaded."
      );
    } finally {
      setJobDetailLoading(false);
    }
  }, [canReadJobs, selectedJobId]);

  useEffect(() => {
    loadJobsList();
  }, [loadJobsList]);

  useEffect(() => {
    loadSelectedJobDetail();
  }, [loadSelectedJobDetail]);

  function normalizeApiError(err, fallback) {
    const message = String(
      err?.response?.data?.message || err?.message || fallback
    ).trim();
    const requestId = String(err?.response?.data?.requestId || "").trim();
    return requestId ? `${message} (requestId: ${requestId})` : message;
  }

  function formatDateTime(value) {
    if (!value) {
      return "-";
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return String(value);
    }
    return parsed.toLocaleString();
  }

  async function handleRunOneJob() {
    if (!canRunJobs || jobsActionLoading) {
      return;
    }
    setJobsActionLoading(true);
    setJobsListError("");
    setJobsListMessage("");
    try {
      const queueNames = String(filters.queueName || "")
        .split(",")
        .map((row) => row.trim())
        .filter(Boolean);
      const result = await runOneJobAdmin({
        queueNames,
      });
      if (result?.idle) {
        setJobsListMessage("No available job to run right now.");
      } else {
        const status = String(result?.status || "UNKNOWN");
        const jobId = Number(result?.job_id || 0);
        setJobsListMessage(
          jobId > 0
            ? `Run-once processed job #${jobId} with status ${status}.`
            : `Run-once completed with status ${status}.`
        );
      }
      await Promise.all([loadJobsList(), load()]);
      if (selectedJobId) {
        await loadSelectedJobDetail();
      }
    } catch (err) {
      setJobsListError(normalizeApiError(err, "Run-once failed."));
    } finally {
      setJobsActionLoading(false);
    }
  }

  async function handleCancelJob(jobId) {
    if (!canManageJobs || jobsActionLoading) {
      return;
    }
    setJobsActionLoading(true);
    setJobsListError("");
    setJobsListMessage("");
    try {
      const result = await cancelJobAdmin(jobId);
      setJobsListMessage(`Job #${result?.item?.id || jobId} cancelled.`);
      await Promise.all([loadJobsList(), load()]);
      if (Number(selectedJobId) === Number(jobId)) {
        await loadSelectedJobDetail();
      }
    } catch (err) {
      setJobsListError(normalizeApiError(err, "Cancel failed."));
    } finally {
      setJobsActionLoading(false);
    }
  }

  async function handleRequeueJob(jobId) {
    if (!canManageJobs || jobsActionLoading) {
      return;
    }
    const delaySeconds = Number(requeueDelaySeconds || 0);
    const maxAttempts =
      String(requeueMaxAttempts || "").trim() === ""
        ? null
        : Number(requeueMaxAttempts);
    if (!Number.isFinite(delaySeconds) || delaySeconds < 0) {
      setJobsListError("delaySeconds must be a positive number.");
      return;
    }
    if (maxAttempts !== null && (!Number.isInteger(maxAttempts) || maxAttempts <= 0)) {
      setJobsListError("maxAttempts must be a positive integer.");
      return;
    }

    setJobsActionLoading(true);
    setJobsListError("");
    setJobsListMessage("");
    try {
      const result = await requeueJobAdmin(jobId, {
        delaySeconds: Math.trunc(delaySeconds),
        maxAttempts: maxAttempts === null ? undefined : maxAttempts,
      });
      setJobsListMessage(
        `Job #${result?.item?.id || jobId} requeued for ${formatDateTime(
          result?.item?.run_after_at
        )}.`
      );
      await Promise.all([loadJobsList(), load()]);
      if (Number(selectedJobId) === Number(jobId)) {
        await loadSelectedJobDetail();
      }
    } catch (err) {
      setJobsListError(normalizeApiError(err, "Requeue failed."));
    } finally {
      setJobsActionLoading(false);
    }
  }

  function setJobsPaginationOffset(nextOffset) {
    const safeOffset = Math.max(0, Number(nextOffset || 0));
    setFilters((prev) => ({ ...prev, jobsOffset: String(safeOffset) }));
  }

  const jobsLimit = Number(jobsListData.limit || jobsListQueryParams.limit || 25);
  const jobsOffset = Number(jobsListData.offset || jobsListQueryParams.offset || 0);
  const jobsTotal = Number(jobsListData.total || 0);
  const jobsHasPrev = jobsOffset > 0;
  const jobsHasNext = jobsOffset + jobsLimit < jobsTotal;

  function downloadBlob({ blob, fileName }) {
    if (typeof window === "undefined" || !blob) {
      return false;
    }
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName || "export.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
    return true;
  }

  async function handleUsageExport() {
    setUsageExporting(true);
    setError("");
    setMessage("");
    try {
      const payload = await downloadOpsUsageExportCsv(queryParams);
      const ok = downloadBlob(payload);
      if (!ok) {
        setError(t("opsDashboard.messages.exportUnavailable", "Export is only available in browser sessions."));
        return;
      }
      setMessage(
        t("opsDashboard.messages.usageExportReady", "Usage CSV export downloaded: {{fileName}}", {
          fileName: payload.fileName,
        })
      );
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          t("opsDashboard.messages.usageExportFailed", "Usage CSV export failed")
      );
    } finally {
      setUsageExporting(false);
    }
  }

  async function handleAuditExport() {
    setAuditExporting(true);
    setError("");
    setMessage("");
    try {
      const payload = await downloadOpsAuditExportCsv({
        ...queryParams,
        limit: 5000,
      });
      const ok = downloadBlob(payload);
      if (!ok) {
        setError(t("opsDashboard.messages.exportUnavailable", "Export is only available in browser sessions."));
        return;
      }
      setMessage(
        t("opsDashboard.messages.auditExportReady", "Audit CSV export downloaded: {{fileName}}", {
          fileName: payload.fileName,
        })
      );
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          t("opsDashboard.messages.auditExportFailed", "Audit CSV export failed")
      );
    } finally {
      setAuditExporting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded border bg-white p-4">
        <h1 className="mb-3 text-lg font-semibold">{t("opsDashboard.title", "Ops Dashboard (H05)")}</h1>
        <div className="grid gap-3 md:grid-cols-4">
          <label className="text-sm">
            <div className="mb-1 text-slate-600">{t("opsDashboard.filters.legalEntityId", "Legal entity ID")}</div>
            <input
              className="w-full rounded border px-2 py-1"
              value={filters.legalEntityId}
              onChange={(e) => setFilters((s) => ({ ...s, legalEntityId: e.target.value }))}
              placeholder={t("opsDashboard.placeholders.optional", "optional")}
            />
          </label>
          <label className="text-sm">
            <div className="mb-1 text-slate-600">{t("opsDashboard.filters.bankAccountId", "Bank account ID")}</div>
            <input
              className="w-full rounded border px-2 py-1"
              value={filters.bankAccountId}
              onChange={(e) => setFilters((s) => ({ ...s, bankAccountId: e.target.value }))}
              placeholder={t("opsDashboard.placeholders.optional", "optional")}
            />
          </label>
          <label className="text-sm">
            <div className="mb-1 text-slate-600">{t("opsDashboard.filters.dateFrom", "Date from")}</div>
            <input
              type="date"
              className="w-full rounded border px-2 py-1"
              value={filters.dateFrom}
              onChange={(e) => setFilters((s) => ({ ...s, dateFrom: e.target.value }))}
            />
          </label>
          <label className="text-sm">
            <div className="mb-1 text-slate-600">{t("opsDashboard.filters.dateTo", "Date to")}</div>
            <input
              type="date"
              className="w-full rounded border px-2 py-1"
              value={filters.dateTo}
              onChange={(e) => setFilters((s) => ({ ...s, dateTo: e.target.value }))}
            />
          </label>
          <label className="text-sm">
            <div className="mb-1 text-slate-600">{t("opsDashboard.filters.daysFallback", "Days fallback")}</div>
            <input
              className="w-full rounded border px-2 py-1"
              value={filters.days}
              onChange={(e) => setFilters((s) => ({ ...s, days: e.target.value }))}
              placeholder={t("opsDashboard.placeholders.days", "30")}
            />
          </label>
          <label className="text-sm">
            <div className="mb-1 text-slate-600">{t("opsDashboard.filters.jobsModuleCode", "Jobs module code")}</div>
            <input
              className="w-full rounded border px-2 py-1"
              value={filters.moduleCode}
              onChange={(e) => setFilters((s) => ({ ...s, moduleCode: e.target.value }))}
              placeholder={t("opsDashboard.placeholders.optional", "optional")}
            />
          </label>
          <label className="text-sm">
            <div className="mb-1 text-slate-600">{t("opsDashboard.filters.jobsQueueName", "Jobs queue name")}</div>
            <input
              className="w-full rounded border px-2 py-1"
              value={filters.queueName}
              onChange={(e) => setFilters((s) => ({ ...s, queueName: e.target.value }))}
              placeholder={t("opsDashboard.placeholders.optional", "optional")}
            />
          </label>
          <div className="flex items-end">
            <button
              type="button"
              className="rounded border px-3 py-1 text-sm"
              onClick={load}
              disabled={loading}
            >
              {loading
                ? t("opsDashboard.actions.refreshing", "Refreshing...")
                : t("opsDashboard.actions.refresh", "Refresh")}
            </button>
            <button
              type="button"
              className="ml-2 rounded border px-3 py-1 text-sm"
              onClick={resetFilters}
              disabled={loading}
            >
              {t("opsDashboard.actions.reset", "Reset")}
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded border px-3 py-1 text-sm"
            onClick={handleUsageExport}
            disabled={loading || usageExporting || auditExporting}
          >
            {usageExporting
              ? t("opsDashboard.actions.exportingUsage", "Exporting usage...")
              : t("opsDashboard.actions.exportUsageCsv", "Export Usage CSV")}
          </button>
          <button
            type="button"
            className="rounded border px-3 py-1 text-sm"
            onClick={handleAuditExport}
            disabled={loading || usageExporting || auditExporting}
          >
            {auditExporting
              ? t("opsDashboard.actions.exportingAudit", "Exporting audit...")
              : t("opsDashboard.actions.exportAuditCsv", "Export Audit CSV")}
          </button>
        </div>
        {error ? <div className="mt-3 text-sm text-red-600">{error}</div> : null}
        {message ? <div className="mt-3 text-sm text-emerald-700">{message}</div> : null}
      </div>

      <section className="rounded border bg-white p-4">
        <h2 className="mb-2 font-medium">{t("opsDashboard.sections.bankReconciliation", "Bank Reconciliation Summary")}</h2>
        <pre className="overflow-auto rounded bg-slate-50 p-3 text-xs">{pretty(data.bankReconciliation)}</pre>
      </section>

      <section className="rounded border bg-white p-4">
        <h2 className="mb-2 font-medium">{t("opsDashboard.sections.bankPayments", "Bank Payment Batches Health")}</h2>
        <pre className="overflow-auto rounded bg-slate-50 p-3 text-xs">{pretty(data.bankPayments)}</pre>
      </section>

      <section className="rounded border bg-white p-4">
        <h2 className="mb-2 font-medium">{t("opsDashboard.sections.payrollImports", "Payroll Import Health")}</h2>
        <pre className="overflow-auto rounded bg-slate-50 p-3 text-xs">{pretty(data.payrollImports)}</pre>
      </section>

      <section className="rounded border bg-white p-4">
        <h2 className="mb-2 font-medium">{t("opsDashboard.sections.payrollClose", "Payroll Close Status")}</h2>
        <pre className="overflow-auto rounded bg-slate-50 p-3 text-xs">{pretty(data.payrollClose)}</pre>
      </section>

      <section className="rounded border bg-white p-4">
        <h2 className="mb-2 font-medium">{t("opsDashboard.sections.jobs", "Jobs Health")}</h2>
        <pre className="overflow-auto rounded bg-slate-50 p-3 text-xs">{pretty(data.jobs)}</pre>
      </section>

      <section className="rounded border bg-white p-4">
        <h2 className="mb-3 font-medium">Jobs Queue (Progress + Retry)</h2>
        {!canReadJobs ? (
          <p className="text-sm text-slate-500">Missing permission: ops.jobs.read</p>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-5">
              <label className="text-sm">
                <div className="mb-1 text-slate-600">Status</div>
                <select
                  className="w-full rounded border px-2 py-1"
                  value={filters.jobsStatus}
                  onChange={(e) =>
                    setFilters((s) => ({
                      ...s,
                      jobsStatus: e.target.value,
                      jobsOffset: "0",
                    }))
                  }
                >
                  <option value="">All</option>
                  <option value="QUEUED">QUEUED</option>
                  <option value="RUNNING">RUNNING</option>
                  <option value="FAILED_RETRYABLE">FAILED_RETRYABLE</option>
                  <option value="FAILED_FINAL">FAILED_FINAL</option>
                  <option value="SUCCEEDED">SUCCEEDED</option>
                  <option value="CANCELLED">CANCELLED</option>
                </select>
              </label>
              <label className="text-sm">
                <div className="mb-1 text-slate-600">Job Type</div>
                <input
                  className="w-full rounded border px-2 py-1"
                  value={filters.jobsJobType}
                  onChange={(e) =>
                    setFilters((s) => ({
                      ...s,
                      jobsJobType: e.target.value,
                      jobsOffset: "0",
                    }))
                  }
                  placeholder="optional"
                />
              </label>
              <label className="text-sm">
                <div className="mb-1 text-slate-600">Rows</div>
                <select
                  className="w-full rounded border px-2 py-1"
                  value={filters.jobsLimit}
                  onChange={(e) =>
                    setFilters((s) => ({
                      ...s,
                      jobsLimit: e.target.value,
                      jobsOffset: "0",
                    }))
                  }
                >
                  <option value="10">10</option>
                  <option value="25">25</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                </select>
              </label>
              <div className="flex items-end gap-2">
                <button
                  type="button"
                  className="rounded border px-3 py-1 text-sm"
                  onClick={loadJobsList}
                  disabled={jobsListLoading || jobsActionLoading}
                >
                  {jobsListLoading ? "Refreshing..." : "Refresh Queue"}
                </button>
                <button
                  type="button"
                  className="rounded border px-3 py-1 text-sm"
                  onClick={handleRunOneJob}
                  disabled={!canRunJobs || jobsActionLoading}
                >
                  {jobsActionLoading ? "Running..." : "Run One"}
                </button>
              </div>
              <div />
            </div>

            {jobsListError ? (
              <p className="mt-2 text-sm text-red-600">{jobsListError}</p>
            ) : null}
            {jobsListMessage ? (
              <p className="mt-2 text-sm text-emerald-700">{jobsListMessage}</p>
            ) : null}

            <div className="mt-3 overflow-auto rounded border">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left">
                  <tr>
                    <th className="px-2 py-1">ID</th>
                    <th className="px-2 py-1">Type</th>
                    <th className="px-2 py-1">Status</th>
                    <th className="px-2 py-1">Progress</th>
                    <th className="px-2 py-1">Run After</th>
                    <th className="px-2 py-1">Updated</th>
                    <th className="px-2 py-1">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(jobsListData.items || []).map((row) => {
                    const attemptCount = Number(row?.attempt_count || 0);
                    const maxAttempts = Number(row?.max_attempts || 0);
                    const progressPct =
                      maxAttempts > 0
                        ? Math.min(100, Math.round((attemptCount / maxAttempts) * 100))
                        : 0;
                    const isSelected = Number(selectedJobId) === Number(row?.id);
                    return (
                      <tr
                        key={`job-row-${row?.id}`}
                        className={isSelected ? "bg-slate-50" : ""}
                      >
                        <td className="px-2 py-1">
                          <button
                            type="button"
                            className="font-semibold text-slate-700 underline"
                            onClick={() => setSelectedJobId(Number(row?.id) || null)}
                          >
                            #{row?.id}
                          </button>
                        </td>
                        <td className="px-2 py-1">{row?.job_type || "-"}</td>
                        <td className="px-2 py-1">{row?.status || "-"}</td>
                        <td className="px-2 py-1">
                          <div className="w-40 rounded bg-slate-200">
                            <div
                              className="h-2 rounded bg-slate-700"
                              style={{ width: `${progressPct}%` }}
                            />
                          </div>
                          <div className="text-xs text-slate-600">
                            {attemptCount}/{maxAttempts || 0}
                          </div>
                        </td>
                        <td className="px-2 py-1">{formatDateTime(row?.run_after_at)}</td>
                        <td className="px-2 py-1">{formatDateTime(row?.updated_at)}</td>
                        <td className="px-2 py-1">
                          <div className="flex gap-1">
                            <button
                              type="button"
                              className="rounded border px-2 py-0.5 text-xs"
                              onClick={() => handleRequeueJob(row?.id)}
                              disabled={!canManageJobs || jobsActionLoading}
                            >
                              Requeue
                            </button>
                            <button
                              type="button"
                              className="rounded border px-2 py-0.5 text-xs"
                              onClick={() => handleCancelJob(row?.id)}
                              disabled={!canManageJobs || jobsActionLoading}
                            >
                              Cancel
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {(!jobsListData.items || jobsListData.items.length === 0) && !jobsListLoading ? (
                    <tr>
                      <td colSpan={7} className="px-2 py-3 text-center text-slate-500">
                        No jobs found.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div className="mt-2 flex items-center gap-2 text-sm">
              <button
                type="button"
                className="rounded border px-2 py-1"
                onClick={() => setJobsPaginationOffset(jobsOffset - jobsLimit)}
                disabled={!jobsHasPrev || jobsListLoading}
              >
                Prev
              </button>
              <button
                type="button"
                className="rounded border px-2 py-1"
                onClick={() => setJobsPaginationOffset(jobsOffset + jobsLimit)}
                disabled={!jobsHasNext || jobsListLoading}
              >
                Next
              </button>
              <span className="text-slate-600">
                offset={jobsOffset} limit={jobsLimit} total={jobsTotal}
              </span>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <label className="text-sm">
                <div className="mb-1 text-slate-600">Requeue delay (seconds)</div>
                <input
                  className="w-full rounded border px-2 py-1"
                  value={requeueDelaySeconds}
                  onChange={(e) => setRequeueDelaySeconds(e.target.value)}
                />
              </label>
              <label className="text-sm">
                <div className="mb-1 text-slate-600">Requeue max attempts (optional)</div>
                <input
                  className="w-full rounded border px-2 py-1"
                  value={requeueMaxAttempts}
                  onChange={(e) => setRequeueMaxAttempts(e.target.value)}
                />
              </label>
              <div className="flex items-end">
                <button
                  type="button"
                  className="rounded border px-3 py-1 text-sm"
                  onClick={() => {
                    if (!selectedJobId) {
                      setJobsListError("Select a job first.");
                      return;
                    }
                    handleRequeueJob(selectedJobId);
                  }}
                  disabled={!canManageJobs || jobsActionLoading}
                >
                  Requeue Selected
                </button>
              </div>
            </div>

            <div className="mt-3 rounded border bg-slate-50 p-3">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-medium">Selected Job Detail</h3>
                <button
                  type="button"
                  className="rounded border px-2 py-1 text-xs"
                  onClick={loadSelectedJobDetail}
                  disabled={!selectedJobId || jobDetailLoading}
                >
                  {jobDetailLoading ? "Loading..." : "Refresh Detail"}
                </button>
              </div>
              {!selectedJobId ? (
                <p className="text-sm text-slate-600">Select a job row to inspect attempts and payload.</p>
              ) : (
                <>
                  <pre className="overflow-auto rounded bg-white p-2 text-xs">
                    {pretty(jobDetail?.item || null)}
                  </pre>
                  <div className="mt-2">
                    <p className="mb-1 text-sm font-semibold">Attempts</p>
                    <pre className="overflow-auto rounded bg-white p-2 text-xs">
                      {pretty(jobDetail?.attempts || [])}
                    </pre>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
