import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getOpsBankPaymentBatchesHealth,
  getOpsBankReconciliationSummary,
  getOpsJobsHealth,
  getOpsPayrollCloseStatus,
  getOpsPayrollImportHealth,
} from "../api/opsDashboard.js";

function pretty(value) {
  return JSON.stringify(value ?? {}, null, 2);
}

export default function OpsDashboardPage() {
  const [filters, setFilters] = useState({
    legalEntityId: "",
    bankAccountId: "",
    dateFrom: "",
    dateTo: "",
    days: "30",
    moduleCode: "",
    queueName: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState({
    bankReconciliation: null,
    bankPayments: null,
    payrollImports: null,
    payrollClose: null,
    jobs: null,
  });

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

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
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
      setError(err?.response?.data?.message || "Ops dashboard data could not be loaded");
    } finally {
      setLoading(false);
    }
  }, [jobQueryParams, queryParams]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="rounded border bg-white p-4">
        <h1 className="mb-3 text-lg font-semibold">Ops Dashboard (H05)</h1>
        <div className="grid gap-3 md:grid-cols-4">
          <label className="text-sm">
            <div className="mb-1 text-slate-600">Legal entity ID</div>
            <input
              className="w-full rounded border px-2 py-1"
              value={filters.legalEntityId}
              onChange={(e) => setFilters((s) => ({ ...s, legalEntityId: e.target.value }))}
              placeholder="optional"
            />
          </label>
          <label className="text-sm">
            <div className="mb-1 text-slate-600">Bank account ID</div>
            <input
              className="w-full rounded border px-2 py-1"
              value={filters.bankAccountId}
              onChange={(e) => setFilters((s) => ({ ...s, bankAccountId: e.target.value }))}
              placeholder="optional"
            />
          </label>
          <label className="text-sm">
            <div className="mb-1 text-slate-600">Date from</div>
            <input
              type="date"
              className="w-full rounded border px-2 py-1"
              value={filters.dateFrom}
              onChange={(e) => setFilters((s) => ({ ...s, dateFrom: e.target.value }))}
            />
          </label>
          <label className="text-sm">
            <div className="mb-1 text-slate-600">Date to</div>
            <input
              type="date"
              className="w-full rounded border px-2 py-1"
              value={filters.dateTo}
              onChange={(e) => setFilters((s) => ({ ...s, dateTo: e.target.value }))}
            />
          </label>
          <label className="text-sm">
            <div className="mb-1 text-slate-600">Days fallback</div>
            <input
              className="w-full rounded border px-2 py-1"
              value={filters.days}
              onChange={(e) => setFilters((s) => ({ ...s, days: e.target.value }))}
              placeholder="30"
            />
          </label>
          <label className="text-sm">
            <div className="mb-1 text-slate-600">Jobs module code</div>
            <input
              className="w-full rounded border px-2 py-1"
              value={filters.moduleCode}
              onChange={(e) => setFilters((s) => ({ ...s, moduleCode: e.target.value }))}
              placeholder="optional"
            />
          </label>
          <label className="text-sm">
            <div className="mb-1 text-slate-600">Jobs queue name</div>
            <input
              className="w-full rounded border px-2 py-1"
              value={filters.queueName}
              onChange={(e) => setFilters((s) => ({ ...s, queueName: e.target.value }))}
              placeholder="optional"
            />
          </label>
          <div className="flex items-end">
            <button
              type="button"
              className="rounded border px-3 py-1 text-sm"
              onClick={load}
              disabled={loading}
            >
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>
        {error ? <div className="mt-3 text-sm text-red-600">{error}</div> : null}
      </div>

      <section className="rounded border bg-white p-4">
        <h2 className="mb-2 font-medium">Bank Reconciliation Summary</h2>
        <pre className="overflow-auto rounded bg-slate-50 p-3 text-xs">{pretty(data.bankReconciliation)}</pre>
      </section>

      <section className="rounded border bg-white p-4">
        <h2 className="mb-2 font-medium">Bank Payment Batches Health</h2>
        <pre className="overflow-auto rounded bg-slate-50 p-3 text-xs">{pretty(data.bankPayments)}</pre>
      </section>

      <section className="rounded border bg-white p-4">
        <h2 className="mb-2 font-medium">Payroll Import Health</h2>
        <pre className="overflow-auto rounded bg-slate-50 p-3 text-xs">{pretty(data.payrollImports)}</pre>
      </section>

      <section className="rounded border bg-white p-4">
        <h2 className="mb-2 font-medium">Payroll Close Status</h2>
        <pre className="overflow-auto rounded bg-slate-50 p-3 text-xs">{pretty(data.payrollClose)}</pre>
      </section>

      <section className="rounded border bg-white p-4">
        <h2 className="mb-2 font-medium">Jobs Health</h2>
        <pre className="overflow-auto rounded bg-slate-50 p-3 text-xs">{pretty(data.jobs)}</pre>
      </section>
    </div>
  );
}

