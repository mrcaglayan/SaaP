import { useEffect, useMemo, useState } from "react";
import { listBankAccounts } from "../../api/bankAccounts.js";
import {
  getReconciliationSuggestions,
  ignoreReconciliationLine,
  listReconciliationAudit,
  listReconciliationQueue,
  matchReconciliationLine,
  unmatchReconciliationLine,
} from "../../api/bankReconciliation.js";
import {
  applyReconciliationAutoRun,
  assignReconciliationException,
  ignoreReconciliationExceptionItem,
  listReconciliationExceptions,
  previewReconciliationAutoRun,
  resolveReconciliationException,
  retryReconciliationException,
} from "../../api/bankReconciliationAutomation.js";
import { useAuth } from "../../auth/useAuth.js";

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function formatDate(value) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }
  return parsed.toLocaleDateString();
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

function formatAmount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return "-";
  }
  return parsed.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

export default function BankReconciliationPage() {
  const { hasPermission } = useAuth();
  const canRead = hasPermission("bank.reconcile.read");
  const canWrite = hasPermission("bank.reconcile.write");
  const canReadBanks = hasPermission("bank.accounts.read");
  const canAutoRun = hasPermission("bank.reconcile.auto.run");
  const canReadExceptions = hasPermission("bank.reconcile.exceptions.read");
  const canWriteExceptions = hasPermission("bank.reconcile.exceptions.write");

  const [bankAccounts, setBankAccounts] = useState([]);
  const [filters, setFilters] = useState({
    bankAccountId: "",
    reconStatus: "",
    q: "",
  });
  const [autoFilters, setAutoFilters] = useState({
    dateFrom: "",
    dateTo: "",
  });
  const [queueRows, setQueueRows] = useState([]);
  const [queueTotal, setQueueTotal] = useState(0);
  const [selectedLineId, setSelectedLineId] = useState("");
  const [selectedLine, setSelectedLine] = useState(null);
  const [selectedMatches, setSelectedMatches] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [auditRows, setAuditRows] = useState([]);
  const [autoPreviewRows, setAutoPreviewRows] = useState([]);
  const [autoPreviewSummary, setAutoPreviewSummary] = useState(null);
  const [autoRunBusy, setAutoRunBusy] = useState(false);
  const [exceptions, setExceptions] = useState([]);
  const [exceptionsTotal, setExceptionsTotal] = useState(0);
  const [loadingExceptions, setLoadingExceptions] = useState(false);
  const [exceptionStatusFilter, setExceptionStatusFilter] = useState("OPEN");
  const [loadingQueue, setLoadingQueue] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [lookupWarning, setLookupWarning] = useState("");

  const bankOptions = useMemo(
    () =>
      [...(bankAccounts || [])].sort((a, b) =>
        String(a?.code || "").localeCompare(String(b?.code || ""))
      ),
    [bankAccounts]
  );

  async function loadBankLookups() {
    if (!canReadBanks) {
      setBankAccounts([]);
      setLookupWarning("Missing permission: bank.accounts.read (bank filter optional)");
      return;
    }
    setLookupWarning("");
    try {
      const res = await listBankAccounts({ limit: 300, offset: 0 });
      setBankAccounts(res?.rows || []);
    } catch (err) {
      setBankAccounts([]);
      setLookupWarning(err?.response?.data?.message || "Bank account list could not be loaded");
    }
  }

  async function loadQueue({ preserveSelection = true } = {}) {
    if (!canRead) {
      setQueueRows([]);
      setQueueTotal(0);
      return [];
    }
    setLoadingQueue(true);
    setError("");
    try {
      const res = await listReconciliationQueue({
        limit: 200,
        offset: 0,
        bankAccountId: toPositiveInt(filters.bankAccountId) || undefined,
        reconStatus: filters.reconStatus || undefined,
        q: filters.q || undefined,
      });
      const rows = res?.rows || [];
      setQueueRows(rows);
      setQueueTotal(Number(res?.total || 0));
      if (!preserveSelection) {
        const nextId = rows[0]?.id ? String(rows[0].id) : "";
        setSelectedLineId(nextId);
      } else if (
        selectedLineId &&
        !rows.some((row) => String(row?.id || "") === String(selectedLineId))
      ) {
        setSelectedLineId(rows[0]?.id ? String(rows[0].id) : "");
      }
      return rows;
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to load reconciliation queue");
      setQueueRows([]);
      setQueueTotal(0);
      return [];
    } finally {
      setLoadingQueue(false);
    }
  }

  async function loadExceptions() {
    if (!canReadExceptions) {
      setExceptions([]);
      setExceptionsTotal(0);
      return [];
    }
    setLoadingExceptions(true);
    try {
      const res = await listReconciliationExceptions({
        limit: 100,
        offset: 0,
        bankAccountId: toPositiveInt(filters.bankAccountId) || undefined,
        status: exceptionStatusFilter || undefined,
      });
      const rows = res?.rows || [];
      setExceptions(rows);
      setExceptionsTotal(Number(res?.total || 0));
      return rows;
    } catch (err) {
      setExceptions([]);
      setExceptionsTotal(0);
      setError(err?.response?.data?.message || "Failed to load B07 exception queue");
      return [];
    } finally {
      setLoadingExceptions(false);
    }
  }

  async function loadLineDetails(lineId, queueLineFallback = null) {
    const parsedLineId = toPositiveInt(lineId);
    if (!parsedLineId || !canRead) {
      setSelectedLine(null);
      setSelectedMatches([]);
      setSuggestions([]);
      setAuditRows([]);
      return;
    }

    setLoadingDetails(true);
    setError("");
    try {
      const [suggestRes, auditRes] = await Promise.all([
        getReconciliationSuggestions(parsedLineId),
        listReconciliationAudit({ statementLineId: parsedLineId, limit: 100, offset: 0 }),
      ]);

      setSelectedLine(suggestRes?.line || queueLineFallback || null);
      setSelectedMatches(suggestRes?.matches || []);
      setSuggestions(suggestRes?.suggestions || []);
      setAuditRows(auditRes?.rows || []);
    } catch (err) {
      setSelectedLine(queueLineFallback || null);
      setSelectedMatches([]);
      setSuggestions([]);
      setAuditRows([]);
      setError(err?.response?.data?.message || "Failed to load reconciliation details");
    } finally {
      setLoadingDetails(false);
    }
  }

  async function refreshAfterAction(lineId) {
    const rows = await loadQueue({ preserveSelection: true });
    const updatedQueueLine =
      rows.find((row) => String(row?.id || "") === String(lineId || "")) || null;
    await loadLineDetails(lineId, updatedQueueLine);
    await loadExceptions();
  }

  async function handleAutoPreview() {
    if (!canAutoRun || autoRunBusy) return;
    setAutoRunBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await previewReconciliationAutoRun({
        bankAccountId: toPositiveInt(filters.bankAccountId) || undefined,
        dateFrom: autoFilters.dateFrom || undefined,
        dateTo: autoFilters.dateTo || undefined,
        limit: 100,
      });
      setAutoPreviewRows(res?.rows || []);
      setAutoPreviewSummary(res?.summary || null);
      setMessage("B07 automation preview generated");
    } catch (err) {
      setError(err?.response?.data?.message || "B07 auto-preview failed");
    } finally {
      setAutoRunBusy(false);
    }
  }

  async function handleAutoApply() {
    if (!canAutoRun || autoRunBusy) return;
    if (!window.confirm("Run B07 auto-apply on current filters?")) return;
    setAutoRunBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await applyReconciliationAutoRun({
        bankAccountId: toPositiveInt(filters.bankAccountId) || undefined,
        dateFrom: autoFilters.dateFrom || undefined,
        dateTo: autoFilters.dateTo || undefined,
        limit: 100,
        runRequestId: `b07-${Date.now()}`,
      });
      setAutoPreviewRows(res?.rows || []);
      setAutoPreviewSummary(res?.summary || null);
        const refreshedQueue = await loadQueue({ preserveSelection: true });
        await loadExceptions();
        if (selectedLineId) {
          const queueLine =
            refreshedQueue.find((row) => String(row?.id || "") === String(selectedLineId || "")) ||
            null;
          await loadLineDetails(selectedLineId, queueLine);
        }
      setMessage(
        `B07 auto-apply completed${res?.replay ? " (replay)" : ""}: reconciled ${
          res?.summary?.reconciledCount ?? 0
        }, exceptions ${res?.summary?.exceptionCount ?? 0}`
      );
    } catch (err) {
      setError(err?.response?.data?.message || "B07 auto-apply failed");
    } finally {
      setAutoRunBusy(false);
    }
  }

  async function handleAssignExceptionToMe(exceptionId) {
    if (!canWriteExceptions) return;
    setActionBusy(true);
    setError("");
    try {
      await assignReconciliationException(exceptionId, {});
      await loadExceptions();
      setMessage("Exception assigned");
    } catch (err) {
      setError(err?.response?.data?.message || "Exception assign failed");
    } finally {
      setActionBusy(false);
    }
  }

  async function handleResolveException(exceptionId) {
    if (!canWriteExceptions) return;
    const resolutionNote = window.prompt("Resolution note (optional):", "") || "";
    setActionBusy(true);
    setError("");
    try {
      await resolveReconciliationException(exceptionId, {
        resolutionCode: "RESOLVED_MANUALLY",
        resolutionNote,
      });
      await loadExceptions();
      setMessage("Exception resolved");
    } catch (err) {
      setError(err?.response?.data?.message || "Exception resolve failed");
    } finally {
      setActionBusy(false);
    }
  }

  async function handleIgnoreExceptionItem(exceptionId) {
    if (!canWriteExceptions) return;
    const resolutionNote = window.prompt("Ignore note (optional):", "") || "";
    setActionBusy(true);
    setError("");
    try {
      await ignoreReconciliationExceptionItem(exceptionId, { resolutionNote });
      await loadExceptions();
      setMessage("Exception ignored");
    } catch (err) {
      setError(err?.response?.data?.message || "Exception ignore failed");
    } finally {
      setActionBusy(false);
    }
  }

  async function handleRetryExceptionItem(exceptionId) {
    if (!canWriteExceptions) return;
    setActionBusy(true);
    setError("");
    try {
      await retryReconciliationException(exceptionId, {});
      await loadExceptions();
      setMessage("Exception reopened for retry");
    } catch (err) {
      setError(err?.response?.data?.message || "Exception retry failed");
    } finally {
      setActionBusy(false);
    }
  }

  async function handleMatchSuggestion(suggestion) {
    if (!selectedLine || !canWrite || actionBusy) {
      return;
    }
    const matchedAmount = Number(suggestion?.suggestedAmount || 0);
    if (!(matchedAmount > 0)) {
      setError("No remaining amount to match");
      return;
    }

    setActionBusy(true);
    setError("");
    setMessage("");
    try {
      await matchReconciliationLine(selectedLine.id, {
        matchType: "MANUAL",
        matchedEntityType: suggestion.matchedEntityType,
        matchedEntityId: suggestion.matchedEntityId,
        matchedAmount,
        notes: "Matched from suggestion",
      });
      setMessage("Reconciliation match created");
      await refreshAfterAction(selectedLine.id);
    } catch (err) {
      setError(err?.response?.data?.message || "Match failed");
    } finally {
      setActionBusy(false);
    }
  }

  async function handleUnmatchAll() {
    if (!selectedLine || !canWrite || actionBusy) {
      return;
    }
    setActionBusy(true);
    setError("");
    setMessage("");
    try {
      await unmatchReconciliationLine(selectedLine.id, {});
      setMessage("Active match(es) reversed");
      await refreshAfterAction(selectedLine.id);
    } catch (err) {
      setError(err?.response?.data?.message || "Unmatch failed");
    } finally {
      setActionBusy(false);
    }
  }

  async function handleIgnore() {
    if (!selectedLine || !canWrite || actionBusy) {
      return;
    }
    const reason = window.prompt("Ignore reason (optional):", "") || "";
    setActionBusy(true);
    setError("");
    setMessage("");
    try {
      await ignoreReconciliationLine(selectedLine.id, { reason });
      setMessage("Line marked as IGNORED");
      await refreshAfterAction(selectedLine.id);
    } catch (err) {
      setError(err?.response?.data?.message || "Ignore failed");
    } finally {
      setActionBusy(false);
    }
  }

  useEffect(() => {
    if (!canRead) {
      return;
    }
    loadQueue({ preserveSelection: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead]);

  useEffect(() => {
    loadExceptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canReadExceptions, exceptionStatusFilter, filters.bankAccountId]);

  useEffect(() => {
    loadBankLookups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canReadBanks]);

  useEffect(() => {
    const queueLine =
      queueRows.find((row) => String(row?.id || "") === String(selectedLineId || "")) || null;
    if (!selectedLineId) {
      setSelectedLine(null);
      setSelectedMatches([]);
      setSuggestions([]);
      setAuditRows([]);
      return;
    }
    loadLineDetails(selectedLineId, queueLine);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLineId]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Banka Mutabakat</h1>
        <p className="mt-1 text-sm text-slate-600">
          PR-B03 manual reconciliation queue (suggestions, match/unmatch/ignore, audit).
        </p>
      </div>

      {!canRead ? (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Missing permission: <code>bank.reconcile.read</code>
        </div>
      ) : null}
      {!canWrite ? (
        <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          Read-only mode: <code>bank.reconcile.write</code> missing.
        </div>
      ) : null}
      {lookupWarning ? (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {lookupWarning}
        </div>
      ) : null}
      {error ? (
        <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {message}
        </div>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            loadQueue({ preserveSelection: false });
            loadExceptions();
          }}
          className="grid gap-3 lg:grid-cols-[2fr_1fr_1fr_auto]"
        >
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Bank Account</label>
            {canReadBanks ? (
              <select
                value={filters.bankAccountId}
                onChange={(e) => setFilters((p) => ({ ...p, bankAccountId: e.target.value }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
              >
                <option value="">Tum banka hesaplari</option>
                {bankOptions.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.code} - {row.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={filters.bankAccountId}
                onChange={(e) => setFilters((p) => ({ ...p, bankAccountId: e.target.value }))}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                placeholder="bankAccountId"
              />
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Status</label>
            <select
              value={filters.reconStatus}
              onChange={(e) => setFilters((p) => ({ ...p, reconStatus: e.target.value }))}
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="">Queue default</option>
              <option value="UNMATCHED">UNMATCHED</option>
              <option value="PARTIAL">PARTIAL</option>
              <option value="MATCHED">MATCHED</option>
              <option value="IGNORED">IGNORED</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Search</label>
            <input
              value={filters.q}
              onChange={(e) => setFilters((p) => ({ ...p, q: e.target.value }))}
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
              placeholder="Description / ref"
            />
          </div>
          <div className="flex items-end gap-2">
            <button
              type="submit"
              className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white"
              disabled={!canRead || loadingQueue}
            >
              {loadingQueue ? "Yukleniyor..." : "Filtrele"}
            </button>
            <button
              type="button"
              onClick={() => loadQueue({ preserveSelection: true })}
              className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700"
              disabled={!canRead || loadingQueue}
            >
              Yenile
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">B07 Automation</h2>
            <p className="text-xs text-slate-500">
              Deterministic rule preview/apply on top of B03 reconciliation core.
            </p>
          </div>
          {!canAutoRun ? (
            <span className="text-xs text-slate-500">Missing: bank.reconcile.auto.run</span>
          ) : null}
        </div>
        <div className="grid gap-3 lg:grid-cols-[1fr_1fr_auto]">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Date From</label>
            <input
              type="date"
              value={autoFilters.dateFrom}
              onChange={(e) => setAutoFilters((p) => ({ ...p, dateFrom: e.target.value }))}
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Date To</label>
            <input
              type="date"
              value={autoFilters.dateTo}
              onChange={(e) => setAutoFilters((p) => ({ ...p, dateTo: e.target.value }))}
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={handleAutoPreview}
              disabled={!canAutoRun || autoRunBusy}
              className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 disabled:opacity-50"
            >
              {autoRunBusy ? "..." : "Preview"}
            </button>
            <button
              type="button"
              onClick={handleAutoApply}
              disabled={!canAutoRun || autoRunBusy}
              className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {autoRunBusy ? "..." : "Apply"}
            </button>
          </div>
        </div>
        {autoPreviewSummary ? (
          <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
            scanned {autoPreviewSummary.scannedCount || 0} | matched{" "}
            {autoPreviewSummary.matchedCount || 0} | reconciled{" "}
            {autoPreviewSummary.reconciledCount || 0} | exceptions{" "}
            {autoPreviewSummary.exceptionCount || 0} | rules{" "}
            {autoPreviewSummary.rulesEvaluated || 0}
          </div>
        ) : null}
        <div className="mt-3 max-h-48 overflow-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-2 py-2">Line</th>
                <th className="px-2 py-2">Outcome</th>
                <th className="px-2 py-2">Rule</th>
                <th className="px-2 py-2">Target</th>
              </tr>
            </thead>
            <tbody>
              {autoPreviewRows.length === 0 ? (
                <tr>
                  <td className="px-2 py-2 text-slate-500" colSpan={4}>
                    No B07 preview rows yet.
                  </td>
                </tr>
              ) : (
                autoPreviewRows.slice(0, 50).map((row) => (
                  <tr key={`b07-preview-${row.statementLineId}`} className="border-t">
                    <td className="px-2 py-2">
                      #{row.statementLineId} {formatDate(row.txnDate)}
                    </td>
                    <td className="px-2 py-2">{row.outcome}</td>
                    <td className="px-2 py-2">{row.rule?.ruleCode || "-"}</td>
                    <td className="px-2 py-2">
                      {row.target?.entityType ? `${row.target.entityType}/${row.target.entityId}` : "-"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)]">
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Queue</h2>
            <span className="text-xs text-slate-500">
              {loadingQueue ? "Yukleniyor..." : `${queueRows.length} / ${queueTotal}`}
            </span>
          </div>
          <div className="max-h-[620px] overflow-auto">
            <table className="min-w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-2 py-2">Date</th>
                  <th className="px-2 py-2">Desc</th>
                  <th className="px-2 py-2">Amount</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2">Matched</th>
                </tr>
              </thead>
              <tbody>
                {queueRows.length === 0 ? (
                  <tr>
                    <td className="px-2 py-3 text-slate-500" colSpan={5}>
                      No reconciliation items.
                    </td>
                  </tr>
                ) : (
                  queueRows.map((row) => {
                    const active = String(row?.id || "") === String(selectedLineId || "");
                    return (
                      <tr
                        key={row.id}
                        className={`cursor-pointer border-t ${
                          active ? "bg-slate-100" : "hover:bg-slate-50"
                        }`}
                        onClick={() => setSelectedLineId(String(row.id))}
                      >
                        <td className="px-2 py-2">
                          <div>{formatDate(row.txn_date)}</div>
                          <div className="text-[11px] text-slate-500">{row.bank_account_code}</div>
                        </td>
                        <td className="px-2 py-2">
                          <div className="max-w-[240px] truncate" title={row.description}>
                            {row.description}
                          </div>
                          <div className="text-[11px] text-slate-500">{row.reference_no || "-"}</div>
                        </td>
                        <td className="px-2 py-2">
                          {formatAmount(row.amount)} {row.currency_code}
                        </td>
                        <td className="px-2 py-2">{row.recon_status}</td>
                        <td className="px-2 py-2">
                          {formatAmount(row.active_matched_total)} ({row.active_match_count || 0})
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Line Details</h2>
            {loadingDetails ? <span className="text-xs text-slate-500">Yukleniyor...</span> : null}
          </div>

          {!selectedLine ? (
            <div className="text-sm text-slate-600">Queue satiri secin.</div>
          ) : (
            <div className="space-y-4 text-sm">
              <div className="rounded border border-slate-200 bg-slate-50 p-3">
                <div>
                  <strong>Date:</strong> {formatDate(selectedLine.txn_date)}
                </div>
                <div>
                  <strong>Description:</strong> {selectedLine.description}
                </div>
                <div>
                  <strong>Reference:</strong> {selectedLine.reference_no || "-"}
                </div>
                <div>
                  <strong>Amount:</strong> {formatAmount(selectedLine.amount)}{" "}
                  {selectedLine.currency_code}
                </div>
                <div>
                  <strong>Status:</strong> {selectedLine.recon_status}
                </div>
                <div>
                  <strong>B07 Meta:</strong>{" "}
                  {selectedLine.reconciliation_method || selectedLine.reconciliation_rule_id
                    ? `${selectedLine.reconciliation_method || "-"} / rule ${
                        selectedLine.reconciliation_rule_id || "-"
                      } / conf ${selectedLine.reconciliation_confidence ?? "-"}`
                    : "-"}
                </div>
                <div>
                  <strong>Bank:</strong> {selectedLine.bank_account_code || "-"}
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <div className="font-medium text-slate-900">Active Matches</div>
                  <button
                    type="button"
                    onClick={handleUnmatchAll}
                    disabled={!canWrite || actionBusy || selectedMatches.length === 0}
                    className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:opacity-50"
                  >
                    {actionBusy ? "..." : "Unmatch all"}
                  </button>
                </div>
                {selectedMatches.length === 0 ? (
                  <div className="text-xs text-slate-500">No active matches.</div>
                ) : (
                  <div className="space-y-2">
                    {selectedMatches.map((row) => (
                      <div key={row.id} className="rounded border border-slate-200 p-2 text-xs">
                        <div>
                          <strong>#{row.id}</strong> {row.matched_entity_type} / {row.matched_entity_id}
                        </div>
                        <div>
                          Amount: {formatAmount(row.matched_amount)} | Type: {row.match_type}
                        </div>
                        {(row.reconciliation_rule_id ||
                          (row.reconciliation_confidence !== undefined &&
                            row.reconciliation_confidence !== null)) && (
                          <div className="text-slate-500">
                            Rule: {row.reconciliation_rule_id || "-"} | Confidence:{" "}
                            {row.reconciliation_confidence ?? "-"}
                          </div>
                        )}
                        <div className="text-slate-500">
                          {row.notes || "-"} | {formatDateTime(row.matched_at)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <div className="font-medium text-slate-900">Suggestions (Journal v1)</div>
                  <button
                    type="button"
                    onClick={handleIgnore}
                    disabled={!canWrite || actionBusy || selectedLine.recon_status === "IGNORED"}
                    className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:opacity-50"
                  >
                    {actionBusy ? "..." : "Ignore line"}
                  </button>
                </div>
                {suggestions.length === 0 ? (
                  <div className="text-xs text-slate-500">No suggestions.</div>
                ) : (
                  <div className="space-y-2">
                    {suggestions.map((s) => (
                      <div
                        key={`${s.matchedEntityType}-${s.matchedEntityId}`}
                        className="rounded border border-slate-200 p-2 text-xs"
                      >
                        <div className="font-medium text-slate-900">
                          {s.displayRef || `${s.matchedEntityType}#${s.matchedEntityId}`}
                        </div>
                        <div className="text-slate-600">{s.displayText || "-"}</div>
                        <div className="mt-1 text-slate-600">
                          Score {s.score} | JE amount {formatAmount(s.bankGlAmount)} | Suggest{" "}
                          {formatAmount(s.suggestedAmount)}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleMatchSuggestion(s)}
                          disabled={!canWrite || actionBusy || !(Number(s.suggestedAmount) > 0)}
                          className="mt-2 rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:opacity-50"
                        >
                          Match suggested amount
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="mb-2 font-medium text-slate-900">Audit</div>
                <div className="max-h-64 space-y-2 overflow-auto">
                  {auditRows.length === 0 ? (
                    <div className="text-xs text-slate-500">No audit rows yet.</div>
                  ) : (
                    auditRows.map((row) => (
                      <div key={row.id} className="rounded border border-slate-200 p-2 text-xs">
                        <div className="font-medium text-slate-900">
                          {row.action} - {formatDateTime(row.acted_at)}
                        </div>
                        <div className="text-slate-500">
                          {row.bank_account_code || "-"} | {row.statement_recon_status || "-"}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">B07 Exception Queue</h2>
            <p className="text-xs text-slate-500">
              Unmatched / ambiguous / policy-blocked automation results.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={exceptionStatusFilter}
              onChange={(e) => setExceptionStatusFilter(e.target.value)}
              className="rounded border border-slate-300 px-2 py-1 text-xs"
              disabled={!canReadExceptions}
            >
              <option value="">ALL</option>
              <option value="OPEN">OPEN</option>
              <option value="ASSIGNED">ASSIGNED</option>
              <option value="RESOLVED">RESOLVED</option>
              <option value="IGNORED">IGNORED</option>
            </select>
            <button
              type="button"
              onClick={() => loadExceptions()}
              className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700"
              disabled={!canReadExceptions || loadingExceptions}
            >
              {loadingExceptions ? "..." : "Refresh"}
            </button>
          </div>
        </div>
        {!canReadExceptions ? (
          <div className="text-xs text-slate-500">Missing permission: bank.reconcile.exceptions.read</div>
        ) : (
          <div className="max-h-72 overflow-auto">
            <table className="min-w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-2 py-2">ID</th>
                  <th className="px-2 py-2">Line</th>
                  <th className="px-2 py-2">Reason</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2">Rule</th>
                  <th className="px-2 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {exceptions.length === 0 ? (
                  <tr>
                    <td className="px-2 py-2 text-slate-500" colSpan={6}>
                      {loadingExceptions
                        ? "Loading exceptions..."
                        : `No exception rows (${exceptionsTotal} total).`}
                    </td>
                  </tr>
                ) : (
                  exceptions.map((row) => (
                    <tr key={row.id} className="border-t">
                      <td className="px-2 py-2">#{row.id}</td>
                      <td className="px-2 py-2">
                        <button
                          type="button"
                          onClick={() => setSelectedLineId(String(row.statement_line_id))}
                          className="text-left text-slate-700 underline-offset-2 hover:underline"
                        >
                          #{row.statement_line_id}
                        </button>
                        <div className="text-[11px] text-slate-500">
                          {formatDate(row.txn_date)} | {formatAmount(row.statement_amount)}
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        <div>{row.reason_code}</div>
                        <div className="max-w-[260px] truncate text-[11px] text-slate-500" title={row.reason_message}>
                          {row.reason_message || "-"}
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        <div>{row.status}</div>
                        <div className="text-[11px] text-slate-500">{row.severity}</div>
                      </td>
                      <td className="px-2 py-2">{row.matched_rule_id || "-"}</td>
                      <td className="px-2 py-2">
                        <div className="flex flex-wrap gap-1">
                          <button
                            type="button"
                            onClick={() => handleAssignExceptionToMe(row.id)}
                            disabled={!canWriteExceptions || actionBusy}
                            className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-700 disabled:opacity-50"
                          >
                            Assign
                          </button>
                          <button
                            type="button"
                            onClick={() => handleResolveException(row.id)}
                            disabled={!canWriteExceptions || actionBusy}
                            className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-700 disabled:opacity-50"
                          >
                            Resolve
                          </button>
                          <button
                            type="button"
                            onClick={() => handleIgnoreExceptionItem(row.id)}
                            disabled={!canWriteExceptions || actionBusy}
                            className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-700 disabled:opacity-50"
                          >
                            Ignore
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRetryExceptionItem(row.id)}
                            disabled={!canWriteExceptions || actionBusy}
                            className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-700 disabled:opacity-50"
                          >
                            Retry
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
