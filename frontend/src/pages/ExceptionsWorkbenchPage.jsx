import { useCallback, useEffect, useMemo, useState } from "react";
import {
  claimExceptionWorkbench,
  getExceptionWorkbenchById,
  ignoreExceptionWorkbench,
  listExceptionWorkbench,
  refreshExceptionWorkbench,
  reopenExceptionWorkbench,
  resolveExceptionWorkbench,
} from "../api/exceptionsWorkbench.js";
import { useAuth } from "../auth/useAuth.js";
import { useI18n } from "../i18n/useI18n.js";

function formatDateTime(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString();
}

function normalizeText(value, fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
}

export default function ExceptionsWorkbenchPage() {
  const { hasPermission } = useAuth();
  const { t } = useI18n();
  const canRead = hasPermission("ops.exceptions.read");
  const canManage = hasPermission("ops.exceptions.manage");

  const [filters, setFilters] = useState({
    moduleCode: "",
    status: "OPEN",
    severity: "",
    legalEntityId: "",
    q: "",
    refresh: true,
    days: "180",
  });
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({ by_status: {}, by_module: {}, by_severity: {} });
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState(null);
  const [selectedAudit, setSelectedAudit] = useState([]);
  const [resolutionNote, setResolutionNote] = useState("");

  const queryParams = useMemo(() => {
    const params = {
      limit: 100,
      offset: 0,
      refresh: filters.refresh ? 1 : 0,
    };
    if (normalizeText(filters.moduleCode)) params.moduleCode = normalizeText(filters.moduleCode).toUpperCase();
    if (normalizeText(filters.status)) params.status = normalizeText(filters.status).toUpperCase();
    if (normalizeText(filters.severity)) params.severity = normalizeText(filters.severity).toUpperCase();
    if (normalizeText(filters.legalEntityId)) params.legalEntityId = Number(filters.legalEntityId);
    if (normalizeText(filters.q)) params.q = normalizeText(filters.q);
    if (normalizeText(filters.days)) params.days = Number(filters.days);
    return params;
  }, [filters]);

  const load = useCallback(async () => {
    if (!canRead) {
      setRows([]);
      setSummary({ by_status: {}, by_module: {}, by_severity: {} });
      setTotal(0);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await listExceptionWorkbench(queryParams);
      setRows(Array.isArray(res?.rows) ? res.rows : []);
      setSummary(res?.summary || { by_status: {}, by_module: {}, by_severity: {} });
      setTotal(Number(res?.total || 0));
      if (selected?.id) {
        const exists = (res?.rows || []).some((r) => Number(r.id) === Number(selected.id));
        if (!exists) {
          setSelected(null);
          setSelectedAudit([]);
        }
      }
    } catch (err) {
      setError(
        err?.response?.data?.message || t("exceptionsWorkbench.messages.loadFailed", "Exception workbench could not be loaded")
      );
      setRows([]);
      setSummary({ by_status: {}, by_module: {}, by_severity: {} });
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [canRead, queryParams, selected?.id, t]);

  useEffect(() => {
    load();
  }, [load]);

  async function loadDetail(exceptionId) {
    if (!canRead || !exceptionId) return;
    setBusy(`detail-${exceptionId}`);
    setError("");
    try {
      const res = await getExceptionWorkbenchById(exceptionId);
      setSelected(res?.row || null);
      setSelectedAudit(Array.isArray(res?.audit) ? res.audit : []);
    } catch (err) {
      setError(
        err?.response?.data?.message || t("exceptionsWorkbench.messages.detailLoadFailed", "Exception detail could not be loaded")
      );
    } finally {
      setBusy("");
    }
  }

  async function handleManualRefresh() {
    if (!canRead) return;
    setBusy("manual-refresh");
    setError("");
    setMessage("");
    try {
      const payload = {};
      if (normalizeText(filters.legalEntityId)) payload.legalEntityId = Number(filters.legalEntityId);
      if (normalizeText(filters.days)) payload.days = Number(filters.days);
      await refreshExceptionWorkbench(payload);
      setMessage(t("exceptionsWorkbench.messages.workbenchRefreshed", "Workbench refreshed."));
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || t("exceptionsWorkbench.messages.refreshFailed", "Refresh failed"));
    } finally {
      setBusy("");
    }
  }

  async function runAction(action, exceptionId) {
    if (!canManage || !exceptionId) return;
    setBusy(`${action}-${exceptionId}`);
    setError("");
    setMessage("");
    try {
      if (action === "claim") {
        await claimExceptionWorkbench(exceptionId, {});
      } else if (action === "resolve") {
        await resolveExceptionWorkbench(exceptionId, {
          resolutionAction: "MANUAL_RESOLVE",
          resolutionNote: normalizeText(resolutionNote) || null,
        });
      } else if (action === "ignore") {
        await ignoreExceptionWorkbench(exceptionId, {
          resolutionAction: "MANUAL_IGNORE",
          resolutionNote: normalizeText(resolutionNote) || null,
        });
      } else if (action === "reopen") {
        await reopenExceptionWorkbench(exceptionId, {
          resolutionNote: normalizeText(resolutionNote) || null,
        });
      }
      setResolutionNote("");
      await load();
      if (selected?.id && Number(selected.id) === Number(exceptionId)) {
        await loadDetail(exceptionId);
      }
      setMessage(t("exceptionsWorkbench.messages.actionApplied", "Action {{action}} applied.", { action: action.toUpperCase() }));
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          t("exceptionsWorkbench.messages.actionFailed", "Action {{action}} failed", { action })
      );
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded border bg-white p-4">
        <div className="mb-2 flex items-center gap-2">
          <h1 className="text-lg font-semibold">{t("exceptionsWorkbench.title", "Unified Exception Workbench (H06)")}</h1>
          <span className="rounded border px-2 py-0.5 text-xs text-slate-600">
            {t("exceptionsWorkbench.total", "Total: {{total}}", { total })}
          </span>
        </div>
        {!canRead ? (
          <div className="text-sm text-slate-500">
            {t("exceptionsWorkbench.messages.missingReadPermission", "Missing permission:")} <code>ops.exceptions.read</code>
          </div>
        ) : (
          <>
            <div className="grid gap-2 md:grid-cols-4">
              <label className="text-sm">
                <div className="mb-1 text-slate-600">{t("exceptionsWorkbench.filters.module", "Module")}</div>
                <select
                  className="w-full rounded border px-2 py-1"
                  value={filters.moduleCode}
                  onChange={(e) => setFilters((s) => ({ ...s, moduleCode: e.target.value }))}
                >
                  <option value="">{t("exceptionsWorkbench.filters.all", "All")}</option>
                  <option value="BANK">BANK</option>
                  <option value="PAYROLL">PAYROLL</option>
                </select>
              </label>
              <label className="text-sm">
                <div className="mb-1 text-slate-600">{t("exceptionsWorkbench.filters.status", "Status")}</div>
                <select
                  className="w-full rounded border px-2 py-1"
                  value={filters.status}
                  onChange={(e) => setFilters((s) => ({ ...s, status: e.target.value }))}
                >
                  <option value="">{t("exceptionsWorkbench.filters.all", "All")}</option>
                  <option value="OPEN">OPEN</option>
                  <option value="IN_REVIEW">IN_REVIEW</option>
                  <option value="RESOLVED">RESOLVED</option>
                  <option value="IGNORED">IGNORED</option>
                </select>
              </label>
              <label className="text-sm">
                <div className="mb-1 text-slate-600">{t("exceptionsWorkbench.filters.severity", "Severity")}</div>
                <select
                  className="w-full rounded border px-2 py-1"
                  value={filters.severity}
                  onChange={(e) => setFilters((s) => ({ ...s, severity: e.target.value }))}
                >
                  <option value="">{t("exceptionsWorkbench.filters.all", "All")}</option>
                  <option value="CRITICAL">CRITICAL</option>
                  <option value="HIGH">HIGH</option>
                  <option value="MEDIUM">MEDIUM</option>
                  <option value="LOW">LOW</option>
                </select>
              </label>
              <label className="text-sm">
                <div className="mb-1 text-slate-600">{t("exceptionsWorkbench.filters.legalEntityId", "Legal entity ID")}</div>
                <input
                  className="w-full rounded border px-2 py-1"
                  value={filters.legalEntityId}
                  onChange={(e) => setFilters((s) => ({ ...s, legalEntityId: e.target.value }))}
                  placeholder={t("exceptionsWorkbench.placeholders.optional", "optional")}
                />
              </label>
              <label className="text-sm">
                <div className="mb-1 text-slate-600">{t("exceptionsWorkbench.filters.search", "Search")}</div>
                <input
                  className="w-full rounded border px-2 py-1"
                  value={filters.q}
                  onChange={(e) => setFilters((s) => ({ ...s, q: e.target.value }))}
                  placeholder={t("exceptionsWorkbench.placeholders.search", "title/source/note")}
                />
              </label>
              <label className="text-sm">
                <div className="mb-1 text-slate-600">{t("exceptionsWorkbench.filters.days", "Days")}</div>
                <input
                  className="w-full rounded border px-2 py-1"
                  value={filters.days}
                  onChange={(e) => setFilters((s) => ({ ...s, days: e.target.value }))}
                  placeholder={t("exceptionsWorkbench.placeholders.days", "180")}
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(filters.refresh)}
                  onChange={(e) => setFilters((s) => ({ ...s, refresh: e.target.checked }))}
                />
                {t("exceptionsWorkbench.filters.autoRefresh", "Auto-refresh sources on list")}
              </label>
              <div className="flex items-end gap-2">
                <button type="button" className="rounded border px-3 py-1 text-sm" onClick={load} disabled={loading}>
                  {loading ? t("exceptionsWorkbench.actions.loading", "Loading...") : t("exceptionsWorkbench.actions.applyFilters", "Apply Filters")}
                </button>
                <button
                  type="button"
                  className="rounded border px-3 py-1 text-sm"
                  onClick={handleManualRefresh}
                  disabled={busy === "manual-refresh"}
                >
                  {busy === "manual-refresh"
                    ? t("exceptionsWorkbench.actions.refreshing", "Refreshing...")
                    : t("exceptionsWorkbench.actions.manualRefresh", "Manual Refresh")}
                </button>
              </div>
            </div>
            <div className="mt-3 grid gap-2 text-xs md:grid-cols-3">
              <div className="rounded border bg-slate-50 p-2">
                <div className="font-medium">{t("exceptionsWorkbench.summary.byStatus", "By Status")}</div>
                <pre className="mt-1 overflow-auto">{JSON.stringify(summary.by_status || {}, null, 2)}</pre>
              </div>
              <div className="rounded border bg-slate-50 p-2">
                <div className="font-medium">{t("exceptionsWorkbench.summary.byModule", "By Module")}</div>
                <pre className="mt-1 overflow-auto">{JSON.stringify(summary.by_module || {}, null, 2)}</pre>
              </div>
              <div className="rounded border bg-slate-50 p-2">
                <div className="font-medium">{t("exceptionsWorkbench.summary.bySeverity", "By Severity")}</div>
                <pre className="mt-1 overflow-auto">{JSON.stringify(summary.by_severity || {}, null, 2)}</pre>
              </div>
            </div>
          </>
        )}
      </section>

      {error ? <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      {message ? <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{message}</div> : null}

      <section className="rounded border bg-white p-4">
        <h2 className="mb-2 font-medium">{t("exceptionsWorkbench.sections.exceptions", "Exceptions")}</h2>
        {!canRead ? null : loading ? (
          <div className="text-sm text-slate-500">{t("exceptionsWorkbench.actions.loading", "Loading...")}</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-slate-500">{t("exceptionsWorkbench.messages.empty", "No exceptions found for current filters.")}</div>
        ) : (
          <div className="space-y-2">
            {rows.map((row) => (
              <div key={row.id} className="rounded border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded border px-1 text-xs">{row.module_code}</span>
                  <span className="rounded border px-1 text-xs">{row.severity}</span>
                  <span className="rounded border px-1 text-xs">{row.status}</span>
                  <span className="rounded border px-1 text-xs">{row.exception_type}</span>
                  <div className="ml-auto text-xs text-slate-500">
                    {t("exceptionsWorkbench.labels.lastSeen", "last seen:")} {formatDateTime(row.last_seen_at)}
                  </div>
                </div>
                <div className="mt-1 font-medium">{row.title}</div>
                <div className="text-xs text-slate-600">
                  {t("exceptionsWorkbench.labels.source", "source:")} {row.source_type} / {row.source_key}
                </div>
                {row.description ? <div className="mt-1 text-xs text-slate-600">{row.description}</div> : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded border px-2 py-1 text-xs"
                    onClick={() => loadDetail(row.id)}
                    disabled={busy === `detail-${row.id}`}
                  >
                    {busy === `detail-${row.id}` ? t("exceptionsWorkbench.actions.loading", "Loading...") : t("exceptionsWorkbench.actions.details", "Details")}
                  </button>
                  {canManage ? (
                    <>
                      <button
                        type="button"
                        className="rounded border px-2 py-1 text-xs"
                        onClick={() => runAction("claim", row.id)}
                        disabled={busy === `claim-${row.id}`}
                      >
                        {busy === `claim-${row.id}` ? "..." : t("exceptionsWorkbench.actions.claim", "Claim")}
                      </button>
                      <button
                        type="button"
                        className="rounded border px-2 py-1 text-xs"
                        onClick={() => runAction("resolve", row.id)}
                        disabled={busy === `resolve-${row.id}`}
                      >
                        {busy === `resolve-${row.id}` ? "..." : t("exceptionsWorkbench.actions.resolve", "Resolve")}
                      </button>
                      <button
                        type="button"
                        className="rounded border px-2 py-1 text-xs"
                        onClick={() => runAction("ignore", row.id)}
                        disabled={busy === `ignore-${row.id}`}
                      >
                        {busy === `ignore-${row.id}` ? "..." : t("exceptionsWorkbench.actions.ignore", "Ignore")}
                      </button>
                      <button
                        type="button"
                        className="rounded border px-2 py-1 text-xs"
                        onClick={() => runAction("reopen", row.id)}
                        disabled={busy === `reopen-${row.id}`}
                      >
                        {busy === `reopen-${row.id}` ? "..." : t("exceptionsWorkbench.actions.reopen", "Reopen")}
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded border bg-white p-4">
        <h2 className="mb-2 font-medium">{t("exceptionsWorkbench.sections.resolutionNote", "Resolution Note")}</h2>
        <textarea
          className="min-h-[80px] w-full rounded border px-2 py-1 text-sm"
          value={resolutionNote}
          onChange={(e) => setResolutionNote(e.target.value)}
          placeholder={t("exceptionsWorkbench.placeholders.resolutionNote", "Used by resolve/ignore/reopen actions")}
        />
      </section>

      <section className="rounded border bg-white p-4">
        <h2 className="mb-2 font-medium">{t("exceptionsWorkbench.sections.selectedException", "Selected Exception")}</h2>
        {!selected ? (
          <div className="text-sm text-slate-500">{t("exceptionsWorkbench.messages.selectRow", "Select an exception row and click Details.")}</div>
        ) : (
          <pre className="overflow-auto rounded bg-slate-50 p-3 text-xs">{JSON.stringify(selected, null, 2)}</pre>
        )}
        <h3 className="mt-3 font-medium">{t("exceptionsWorkbench.sections.auditTrail", "Audit Trail")}</h3>
        {selectedAudit.length === 0 ? (
          <div className="text-sm text-slate-500">{t("exceptionsWorkbench.messages.noAudit", "No audit entries.")}</div>
        ) : (
          <pre className="overflow-auto rounded bg-slate-50 p-3 text-xs">{JSON.stringify(selectedAudit, null, 2)}</pre>
        )}
      </section>
    </div>
  );
}
