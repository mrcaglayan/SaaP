import { Link } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import {
  approveApprovalRequest,
  createOperationalCoverage,
  getOperationalCoverageWorkspace,
  rejectApprovalRequest,
  revokeOperationalCoverage,
} from "../../api/approvalDelegations.js";
import { useAuth } from "../../auth/useAuth.js";
import { useI18n } from "../../i18n/useI18n.js";
import SecurityUsersWorkbenchTabs from "./components/users/SecurityUsersWorkbenchTabs.jsx";
import SecurityAdminWorkspaceShell from "./SecurityAdminWorkspaceShell.jsx";

const STATE_BADGE_CLASS_NAMES = {
  REQUESTED: "border-amber-200 bg-amber-50 text-amber-800",
  APPROVED: "border-sky-200 bg-sky-50 text-sky-700",
  ACTIVE: "border-emerald-200 bg-emerald-50 text-emerald-700",
  REVOKED: "border-slate-200 bg-slate-100 text-slate-700",
  EXPIRED: "border-slate-200 bg-slate-100 text-slate-700",
};

const REVIEW_BADGE_CLASS_NAMES = {
  PENDING_REVIEW: "border-amber-200 bg-amber-50 text-amber-800",
  ESCALATED: "border-amber-200 bg-amber-50 text-amber-800",
  APPROVED: "border-emerald-200 bg-emerald-50 text-emerald-700",
  REJECTED: "border-rose-200 bg-rose-50 text-rose-700",
  RETURNED: "border-slate-200 bg-slate-100 text-slate-700",
};

function formatDate(value) {
  if (!value) {
    return "Not set";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleDateString();
}

function formatWindow(row) {
  return `${formatDate(row?.startDate)} - ${formatDate(row?.endDate)}`;
}

function formatScopeLabel(row) {
  if (row?.scopeType === "OPERATING_UNIT") {
    return `${row?.legalEntityCode || "LE"} / ${row?.operatingUnitCode || "OU"}`;
  }
  return row?.legalEntityCode || `LEGAL_ENTITY #${row?.scopeId || "?"}`;
}

function getRowScope(row) {
  return {
    scopeType: row?.scopeType,
    scopeId: Number(row?.scopeId || 0),
  };
}

function getBadgeClassName(map, value) {
  return (
    map[
      String(value || "")
        .trim()
        .toUpperCase()
    ] || "border-slate-200 bg-slate-100 text-slate-700"
  );
}

/**
 * Dedicated PR-7D UI for temporary operational coverage. This stays separate
 * from approval delegation because coverage grants runtime role authority,
 * while delegation only proxies approval actions.
 */
export default function TemporaryOperationalCoveragePage() {
  const { getPermissionAccess } = useAuth();
  const { l } = useI18n();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actingRowId, setActingRowId] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [workspace, setWorkspace] = useState({
    roles: [],
    legalEntities: [],
    operatingUnits: [],
    rows: [],
  });
  const [stateFilter, setStateFilter] = useState("ALL");
  const [form, setForm] = useState({
    delegateEmail: "",
    roleCode: "",
    scopeType: "",
    scopeId: "",
    startDate: "",
    endDate: "",
    note: "",
  });

  const selectedRole = useMemo(
    () => workspace.roles.find((row) => row.code === form.roleCode) || null,
    [form.roleCode, workspace.roles],
  );

  const scopeOptions = useMemo(() => {
    if (form.scopeType === "LEGAL_ENTITY") {
      return workspace.legalEntities.map((row) => ({
        id: Number(row.id),
        label: `${row.code} - ${row.name}`,
      }));
    }
    if (form.scopeType === "OPERATING_UNIT") {
      return workspace.operatingUnits.map((row) => ({
        id: Number(row.id),
        label: `${row.legal_entity_code} / ${row.code} - ${row.name}`,
      }));
    }
    return [];
  }, [form.scopeType, workspace.legalEntities, workspace.operatingUnits]);

  const filteredRows = useMemo(() => {
    if (stateFilter === "ALL") {
      return workspace.rows;
    }
    if (stateFilter === "REJECTED") {
      return workspace.rows.filter((row) => row.isRejected);
    }
    return workspace.rows.filter((row) => row.state === stateFilter);
  }, [stateFilter, workspace.rows]);

  useEffect(() => {
    if (!selectedRole) {
      return;
    }
    const nextScopeType = selectedRole.allowedScopeTypes?.[0] || "";
    if (
      form.scopeType &&
      Array.isArray(selectedRole.allowedScopeTypes) &&
      selectedRole.allowedScopeTypes.includes(form.scopeType)
    ) {
      return;
    }
    setForm((prev) => ({
      ...prev,
      scopeType: nextScopeType,
      scopeId: "",
    }));
  }, [form.scopeType, selectedRole]);

  async function loadWorkspace() {
    setLoading(true);
    setError("");
    try {
      const response = await getOperationalCoverageWorkspace();
      setWorkspace({
        roles: Array.isArray(response?.roles) ? response.roles : [],
        legalEntities: Array.isArray(response?.legalEntities)
          ? response.legalEntities
          : [],
        operatingUnits: Array.isArray(response?.operatingUnits)
          ? response.operatingUnits
          : [],
        rows: Array.isArray(response?.rows) ? response.rows : [],
      });
    } catch (err) {
      setWorkspace({
        roles: [],
        legalEntities: [],
        operatingUnits: [],
        rows: [],
      });
      setError(
        err?.response?.data?.message ||
          "Temporary operational coverage workspace could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadWorkspace();
  }, []);

  async function handleCreate(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await createOperationalCoverage({
        delegateEmail: form.delegateEmail,
        roleCode: form.roleCode,
        scopeType: form.scopeType,
        scopeId: Number(form.scopeId || 0),
        startDate: form.startDate,
        endDate: form.endDate,
        note: String(form.note || "").trim() || null,
      });
      setMessage("Temporary operational coverage request created.");
      setForm({
        delegateEmail: "",
        roleCode: "",
        scopeType: "",
        scopeId: "",
        startDate: "",
        endDate: "",
        note: "",
      });
      await loadWorkspace();
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          "Temporary operational coverage request could not be created.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleApprove(row) {
    if (!row?.approvalRequest?.id) {
      return;
    }
    setActingRowId(Number(row.id));
    setError("");
    setMessage("");
    try {
      await approveApprovalRequest(row.approvalRequest.id, {
        decisionComment:
          "Approved from temporary operational coverage workspace",
      });
      setMessage(`Coverage request #${row.id} approved.`);
      await loadWorkspace();
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          "Coverage request could not be approved.",
      );
    } finally {
      setActingRowId(0);
    }
  }

  async function handleReject(row) {
    if (!row?.approvalRequest?.id) {
      return;
    }
    setActingRowId(Number(row.id));
    setError("");
    setMessage("");
    try {
      await rejectApprovalRequest(row.approvalRequest.id, {
        decisionComment:
          "Rejected from temporary operational coverage workspace",
      });
      setMessage(`Coverage request #${row.id} rejected.`);
      await loadWorkspace();
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          "Coverage request could not be rejected.",
      );
    } finally {
      setActingRowId(0);
    }
  }

  async function handleRevoke(row) {
    if (!row?.id) {
      return;
    }
    const confirmed = window.confirm(
      `Revoke temporary coverage #${row.id}? Runtime authority will be removed immediately.`,
    );
    if (!confirmed) {
      return;
    }
    setActingRowId(Number(row.id));
    setError("");
    setMessage("");
    try {
      await revokeOperationalCoverage(row.id, {
        revokedReason: "Revoked from temporary operational coverage workspace",
      });
      setMessage(`Coverage request #${row.id} revoked.`);
      await loadWorkspace();
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          "Coverage request could not be revoked.",
      );
    } finally {
      setActingRowId(0);
    }
  }

  function canReviewRow(row) {
    const scope = getRowScope(row);
    return (
      Boolean(row?.approvalRequest?.id) &&
      ["PENDING_REVIEW", "ESCALATED"].includes(
        String(row?.reviewStatus || ""),
      ) &&
      getPermissionAccess("security.operational_coverage.review", { scope })
        .allowed &&
      getPermissionAccess("approvals.requests.read", { scope }).allowed
    );
  }

  function canRevokeRow(row) {
    const scope = getRowScope(row);
    return (
      ["APPROVED", "ACTIVE"].includes(String(row?.state || "")) &&
      getPermissionAccess("security.operational_coverage.revoke", { scope })
        .allowed
    );
  }

  return (
    <SecurityAdminWorkspaceShell
      workspaceSectionKey="users"
      sectionKey="user-assignments"
      eyebrow={l("Users & Assignments Workbench", "Kullanicilar ve Atamalar Workbench'i")}
      title={l("Temporary Coverage", "Gecici kapsama")}
      description={l(
        "Request, review, and revoke time-bounded runtime authority without leaving the users workbench family.",
        "Tarihle sinirli runtime yetkisini users workbench ailesinden cikmadan isteyin, inceleyin ve geri alin."
      )}
      stats={[
        {
          title: l("Coverage rows", "Kapsama satirlari"),
          value: filteredRows.length,
          description: l(
            "Rows visible after the current state filter is applied.",
            "Mevcut durum filtresi uygulandiktan sonra gorunen satirlar."
          ),
          tone: "blue",
        },
        {
          title: l("Runtime roles", "Runtime roller"),
          value: workspace.roles.length,
          description: l(
            "Local roles that can be granted temporarily through this workspace.",
            "Bu workbench uzerinden gecici olarak verilebilen yerel roller."
          ),
          tone: "green",
        },
      ]}
      hiddenPrimarySurfaceKeys={["roles-permissions"]}
      toolbar={<SecurityUsersWorkbenchTabs activeTab="coverage" counts={{ coverage: filteredRows.length }} />}
    >
      <div className="space-y-4">
      <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
        <div className="font-semibold">Separate From Approval Delegation</div>
        <p className="mt-1">
          Approval delegation proxies review actions. Temporary operational
          coverage grants temporary runtime authority to another local operator.
        </p>
        <Link
          to="/app/ayarlar/security-admin/users?tab=delegations"
          className="mt-3 inline-flex rounded-lg border border-sky-300 bg-white px-3 py-2 font-medium text-sky-800 hover:bg-sky-100"
        >
          Open Approval Delegations
        </Link>
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {message}
        </div>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Request Coverage
            </h2>
            <p className="text-sm text-slate-500">
              Create one bounded local-role coverage request for an existing
              tenant user.
            </p>
          </div>
          <button
            type="button"
            onClick={loadWorkspace}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Refresh
          </button>
        </div>

        <form
          onSubmit={handleCreate}
          className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"
        >
          <input
            type="email"
            value={form.delegateEmail}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                delegateEmail: event.target.value,
              }))
            }
            placeholder="Delegate user email"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            required
          />
          <select
            value={form.roleCode}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, roleCode: event.target.value }))
            }
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            required
          >
            <option value="">Select local role</option>
            {workspace.roles.map((row) => (
              <option key={row.code} value={row.code}>
                {row.code} - {row.name}
              </option>
            ))}
          </select>
          <select
            value={form.scopeType}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                scopeType: event.target.value,
                scopeId: "",
              }))
            }
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            required
            disabled={!selectedRole}
          >
            <option value="">Select scope type</option>
            {(selectedRole?.allowedScopeTypes || []).map((scopeType) => (
              <option key={scopeType} value={scopeType}>
                {scopeType}
              </option>
            ))}
          </select>
          <select
            value={form.scopeId}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, scopeId: event.target.value }))
            }
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            required
            disabled={!form.scopeType}
          >
            <option value="">Select scope</option>
            {scopeOptions.map((row) => (
              <option key={`${form.scopeType}-${row.id}`} value={row.id}>
                {row.label}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={form.startDate}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, startDate: event.target.value }))
            }
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            required
          />
          <input
            type="date"
            value={form.endDate}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, endDate: event.target.value }))
            }
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            required
          />
          <textarea
            value={form.note}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, note: event.target.value }))
            }
            placeholder="Note for reviewers"
            className="min-h-24 rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2 xl:col-span-3"
          />
          <div className="md:col-span-2 xl:col-span-3">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Creating..." : "Create Coverage Request"}
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Coverage Queue
            </h2>
            <p className="text-sm text-slate-500">
              Requested, approved, active, revoked, expired, and rejected
              coverage rows visible at your scoped workspace.
            </p>
          </div>
          <select
            value={stateFilter}
            onChange={(event) => setStateFilter(event.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            {[
              "ALL",
              "REQUESTED",
              "APPROVED",
              "ACTIVE",
              "REVOKED",
              "EXPIRED",
              "REJECTED",
            ].map((state) => (
              <option key={state} value={state}>
                {state}
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">
            Loading temporary operational coverage workspace...
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 px-3 py-6 text-center text-sm text-slate-500">
            No temporary operational coverage rows matched the current filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">
                    State
                  </th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">
                    Delegate
                  </th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">
                    Role / Scope
                  </th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">
                    Window
                  </th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">
                    Requester
                  </th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRows.map((row) => {
                  const busy = actingRowId === Number(row.id);
                  return (
                    <tr key={row.id}>
                      <td className="space-y-2 px-3 py-3 align-top">
                        <div
                          className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${getBadgeClassName(
                            STATE_BADGE_CLASS_NAMES,
                            row.state,
                          )}`}
                        >
                          {row.state}
                        </div>
                        <div
                          className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${getBadgeClassName(
                            REVIEW_BADGE_CLASS_NAMES,
                            row.reviewStatus,
                          )}`}
                        >
                          Review: {row.reviewStatus}
                        </div>
                        {row.approvalRequest?.executionErrorText ? (
                          <div className="max-w-xs rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-700">
                            {row.approvalRequest.executionErrorText}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 align-top text-slate-700">
                        <div className="font-medium text-slate-900">
                          {row.delegateUserName}
                        </div>
                        <div className="text-xs text-slate-500">
                          {row.delegateUserEmail}
                        </div>
                      </td>
                      <td className="px-3 py-3 align-top text-slate-700">
                        <div className="font-medium text-slate-900">
                          {row.roleCode}
                        </div>
                        <div className="text-xs text-slate-500">
                          {formatScopeLabel(row)}
                        </div>
                      </td>
                      <td className="px-3 py-3 align-top text-slate-700">
                        <div>{formatWindow(row)}</div>
                        <div className="text-xs text-slate-500">
                          Requested {formatDate(row.requestedAt)}
                        </div>
                      </td>
                      <td className="px-3 py-3 align-top text-slate-700">
                        <div className="font-medium text-slate-900">
                          {row.requesterUserName}
                        </div>
                        <div className="text-xs text-slate-500">
                          {row.requesterUserEmail}
                        </div>
                      </td>
                      <td className="space-y-2 px-3 py-3 align-top">
                        {canReviewRow(row) ? (
                          <>
                            <button
                              type="button"
                              onClick={() => handleApprove(row)}
                              disabled={busy}
                              className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {busy ? "Working..." : "Approve"}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleReject(row)}
                              disabled={busy}
                              className="w-full rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {busy ? "Working..." : "Reject"}
                            </button>
                          </>
                        ) : null}
                        {canRevokeRow(row) ? (
                          <button
                            type="button"
                            onClick={() => handleRevoke(row)}
                            disabled={busy}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {busy ? "Working..." : "Revoke"}
                          </button>
                        ) : null}
                        {!canReviewRow(row) && !canRevokeRow(row) ? (
                          <span className="text-xs text-slate-400">
                            No action available
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      </div>
    </SecurityAdminWorkspaceShell>
  );
}
