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

  const [bankAccounts, setBankAccounts] = useState([]);
  const [filters, setFilters] = useState({
    bankAccountId: "",
    reconStatus: "",
    q: "",
  });
  const [queueRows, setQueueRows] = useState([]);
  const [queueTotal, setQueueTotal] = useState(0);
  const [selectedLineId, setSelectedLineId] = useState("");
  const [selectedLine, setSelectedLine] = useState(null);
  const [selectedMatches, setSelectedMatches] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [auditRows, setAuditRows] = useState([]);
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
    </div>
  );
}
