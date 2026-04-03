import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { listMeApprovalDelegations } from "../../api/approvalDelegations.js";
import DelegationStateBadge from "../../components/security/DelegationStateBadge.jsx";
import {
  formatDelegationScopeLabel,
  formatDelegationWindow,
} from "../../utils/delegationUi.js";
import { useAuth } from "../../auth/useAuth.js";

function sortDelegations(rows = []) {
  return [...rows].sort((left, right) => Number(right.id || 0) - Number(left.id || 0));
}

function DelegationCard({ row, direction = "incoming" }) {
  const counterpartName =
    direction === "incoming"
      ? row?.delegatorUserName || row?.delegatorUserEmail || `User #${row?.delegatorUserId || "-"}`
      : row?.delegateUserName || row?.delegateUserEmail || `User #${row?.delegateUserId || "-"}`;
  const counterpartLabel =
    direction === "incoming" ? "Authority source" : "Delegated to";

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start gap-2">
        <div>
          <div className="text-sm font-semibold text-slate-900">
            {row?.moduleCode || "All modules"}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {counterpartLabel}: {counterpartName}
          </div>
        </div>
        <div className="ml-auto">
          <DelegationStateBadge state={row?.state} />
        </div>
      </div>

      <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Scope</dt>
          <dd className="mt-1 text-slate-900">{formatDelegationScopeLabel(row)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Window</dt>
          <dd className="mt-1 text-slate-900">{formatDelegationWindow(row)}</dd>
        </div>
      </dl>

      {row?.note ? (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          {row.note}
        </div>
      ) : null}

      {row?.revokedReason ? (
        <div className="mt-3 text-xs text-rose-700">
          Revoked reason: {row.revokedReason}
        </div>
      ) : null}
    </article>
  );
}

/**
 * Show the current user's incoming and outgoing approval delegations in one
 * self-service settings surface.
 */
export default function MyDelegationsPage() {
  const { hasPermission } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [moduleCode, setModuleCode] = useState("");
  const [incoming, setIncoming] = useState([]);
  const [outgoing, setOutgoing] = useState([]);

  const canManageDelegations = hasPermission("approvals.policies.read");
  const incomingRows = useMemo(() => sortDelegations(incoming), [incoming]);
  const outgoingRows = useMemo(() => sortDelegations(outgoing), [outgoing]);

  async function loadData(nextModuleCode = moduleCode) {
    setLoading(true);
    setError("");
    try {
      const response = await listMeApprovalDelegations({
        moduleCode: String(nextModuleCode || "").trim().toUpperCase() || undefined,
      });
      setIncoming(Array.isArray(response?.incoming) ? response.incoming : []);
      setOutgoing(Array.isArray(response?.outgoing) ? response.outgoing : []);
    } catch (err) {
      setError(err?.response?.data?.message || "Delegations could not be loaded.");
      setIncoming([]);
      setOutgoing([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">My Delegations</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Review incoming approval authority and the authority you have delegated to others.
          </p>
        </div>
        {canManageDelegations ? (
          <Link
            to="/app/ayarlar/rbac/delegations"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Open admin delegation management
          </Link>
        ) : null}
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Module filter
            </span>
            <input
              type="text"
              value={moduleCode}
              onChange={(event) => setModuleCode(event.target.value)}
              placeholder="All modules"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={() => loadData(moduleCode)}
            disabled={loading}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Active, revoked, and expired delegations all stay visible here so approval authority
          changes remain auditable.
        </p>
      </section>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-900">Incoming Delegations</h2>
            <span className="text-xs text-slate-500">{incomingRows.length} rows</span>
          </div>
          <p className="mt-1 text-sm text-slate-600">
            These delegations let you approve on behalf of another authority holder when the
            approval request scope matches.
          </p>
          <div className="mt-4 space-y-3">
            {loading ? (
              <div className="rounded-xl border border-slate-200 bg-white px-3 py-4 text-sm text-slate-500">
                Loading incoming delegations...
              </div>
            ) : incomingRows.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white px-3 py-4 text-sm text-slate-500">
                No incoming approval delegation is currently recorded for you.
              </div>
            ) : (
              incomingRows.map((row) => (
                <DelegationCard key={`incoming-${row.id}`} row={row} direction="incoming" />
              ))
            )}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-900">Outgoing Delegations</h2>
            <span className="text-xs text-slate-500">{outgoingRows.length} rows</span>
          </div>
          <p className="mt-1 text-sm text-slate-600">
            These delegations show where your approval authority has been assigned to another user.
          </p>
          <div className="mt-4 space-y-3">
            {loading ? (
              <div className="rounded-xl border border-slate-200 bg-white px-3 py-4 text-sm text-slate-500">
                Loading outgoing delegations...
              </div>
            ) : outgoingRows.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white px-3 py-4 text-sm text-slate-500">
                You have not delegated approval authority to another user yet.
              </div>
            ) : (
              outgoingRows.map((row) => (
                <DelegationCard key={`outgoing-${row.id}`} row={row} direction="outgoing" />
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
