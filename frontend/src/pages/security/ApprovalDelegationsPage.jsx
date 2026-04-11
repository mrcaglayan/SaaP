import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  createApprovalDelegation,
  listApprovalDelegations,
  revokeApprovalDelegation,
} from "../../api/approvalDelegations.js";
import {
  listCountries,
  listGroupCompanies,
  listLegalEntities,
  listOperatingUnits,
  listUsers,
} from "../../api/rbacAdmin.js";
import { useAuth } from "../../auth/useAuth.js";
import DelegationStateBadge from "../../components/security/DelegationStateBadge.jsx";
import { useI18n } from "../../i18n/useI18n.js";
import {
  formatDelegationScopeLabel,
  formatDelegationWindow,
} from "../../utils/delegationUi.js";
import SecurityUsersWorkbenchTabs from "./components/users/SecurityUsersWorkbenchTabs.jsx";
import SecurityAdminWorkspaceShell from "./SecurityAdminWorkspaceShell.jsx";

const SCOPE_TYPES = [
  "TENANT",
  "GROUP",
  "COUNTRY",
  "LEGAL_ENTITY",
  "OPERATING_UNIT",
];
const STATE_FILTERS = ["ALL", "ACTIVE", "UPCOMING", "REVOKED", "EXPIRED"];

function applyStateFilter(rows, stateFilter) {
  const normalized = String(stateFilter || "ALL")
    .trim()
    .toUpperCase();
  if (normalized === "ALL") {
    return rows;
  }
  return rows.filter(
    (row) =>
      String(row?.state || "")
        .trim()
        .toUpperCase() === normalized,
  );
}

/**
 * Admin-facing approval delegation list/create/revoke surface for PR-5D/UI-5D.
 */
export default function ApprovalDelegationsPage() {
  const { getPermissionAccess, user } = useAuth();
  const { l } = useI18n();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [rows, setRows] = useState([]);
  const [users, setUsers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [countries, setCountries] = useState([]);
  const [legalEntities, setLegalEntities] = useState([]);
  const [operatingUnits, setOperatingUnits] = useState([]);
  const [filters, setFilters] = useState({
    delegatorUserId: "",
    delegateUserId: "",
    moduleCode: "",
    scopeType: "",
    scopeId: "",
    state: "ALL",
  });
  const [form, setForm] = useState({
    delegatorUserId: "",
    delegateUserId: "",
    moduleCode: "",
    scopeType: "TENANT",
    scopeId: "",
    effectiveFrom: "",
    effectiveTo: "",
    note: "",
  });

  const tenantScopeId = Number(user?.tenant_id || 0);
  const selectedFilterScopeId =
    filters.scopeType === "TENANT"
      ? tenantScopeId
      : Number(filters.scopeId || 0);
  const selectedCreateScopeId =
    form.scopeType === "TENANT" ? tenantScopeId : Number(form.scopeId || 0);
  const readAccess = getPermissionAccess(
    "approvals.policies.read",
    selectedFilterScopeId
      ? {
          scope: {
            scopeType: filters.scopeType || "TENANT",
            scopeId: selectedFilterScopeId,
          },
        }
      : undefined,
  );
  const writeAccess = getPermissionAccess(
    "approvals.policies.write",
    selectedCreateScopeId
      ? {
          scope: {
            scopeType: form.scopeType,
            scopeId: selectedCreateScopeId,
          },
        }
      : undefined,
  );

  const scopeOptions = useMemo(() => {
    const scopeType = form.scopeType;
    if (scopeType === "TENANT") {
      return tenantScopeId
        ? [{ id: tenantScopeId, label: `Tenant #${tenantScopeId}` }]
        : [];
    }
    if (scopeType === "GROUP") {
      return groups.map((row) => ({
        id: Number(row.id),
        label: `${row.code} - ${row.name}`,
      }));
    }
    if (scopeType === "COUNTRY") {
      return countries.map((row) => ({
        id: Number(row.id),
        label: `${row.iso2} - ${row.name}`,
      }));
    }
    if (scopeType === "LEGAL_ENTITY") {
      return legalEntities.map((row) => ({
        id: Number(row.id),
        label: `${row.code} - ${row.name}`,
      }));
    }
    if (scopeType === "OPERATING_UNIT") {
      return operatingUnits.map((row) => ({
        id: Number(row.id),
        label: `${row.code} - ${row.name}`,
      }));
    }
    return [];
  }, [
    countries,
    form.scopeType,
    groups,
    legalEntities,
    operatingUnits,
    tenantScopeId,
  ]);

  const filterScopeOptions = useMemo(() => {
    const scopeType = filters.scopeType;
    if (scopeType === "TENANT") {
      return tenantScopeId
        ? [{ id: tenantScopeId, label: `Tenant #${tenantScopeId}` }]
        : [];
    }
    if (scopeType === "GROUP") {
      return groups.map((row) => ({
        id: Number(row.id),
        label: `${row.code} - ${row.name}`,
      }));
    }
    if (scopeType === "COUNTRY") {
      return countries.map((row) => ({
        id: Number(row.id),
        label: `${row.iso2} - ${row.name}`,
      }));
    }
    if (scopeType === "LEGAL_ENTITY") {
      return legalEntities.map((row) => ({
        id: Number(row.id),
        label: `${row.code} - ${row.name}`,
      }));
    }
    if (scopeType === "OPERATING_UNIT") {
      return operatingUnits.map((row) => ({
        id: Number(row.id),
        label: `${row.code} - ${row.name}`,
      }));
    }
    return [];
  }, [
    countries,
    filters.scopeType,
    groups,
    legalEntities,
    operatingUnits,
    tenantScopeId,
  ]);

  const filteredRows = useMemo(
    () => applyStateFilter(rows, filters.state),
    [filters.state, rows],
  );

  useEffect(() => {
    if (form.scopeType !== "TENANT") {
      return;
    }
    setForm((prev) => ({ ...prev, scopeId: String(tenantScopeId || "") }));
  }, [form.scopeType, tenantScopeId]);

  useEffect(() => {
    if (filters.scopeType !== "TENANT") {
      return;
    }
    setFilters((prev) => ({ ...prev, scopeId: String(tenantScopeId || "") }));
  }, [filters.scopeType, tenantScopeId]);

  async function loadData(nextFilters = filters) {
    setLoading(true);
    setError("");
    try {
      const delegationParams = {
        delegatorUserId: nextFilters.delegatorUserId || undefined,
        delegateUserId: nextFilters.delegateUserId || undefined,
        moduleCode:
          String(nextFilters.moduleCode || "")
            .trim()
            .toUpperCase() || undefined,
      };
      if (nextFilters.scopeType && nextFilters.scopeId) {
        delegationParams.scopeType = nextFilters.scopeType;
        delegationParams.scopeId = nextFilters.scopeId;
      }

      const [
        usersRes,
        groupsRes,
        countriesRes,
        legalEntitiesRes,
        operatingUnitsRes,
        rowsRes,
      ] = await Promise.all([
        listUsers(),
        listGroupCompanies(),
        listCountries(),
        listLegalEntities(),
        listOperatingUnits(),
        listApprovalDelegations(delegationParams),
      ]);

      setUsers(Array.isArray(usersRes?.rows) ? usersRes.rows : []);
      setGroups(Array.isArray(groupsRes?.rows) ? groupsRes.rows : []);
      setCountries(Array.isArray(countriesRes?.rows) ? countriesRes.rows : []);
      setLegalEntities(
        Array.isArray(legalEntitiesRes?.rows) ? legalEntitiesRes.rows : [],
      );
      setOperatingUnits(
        Array.isArray(operatingUnitsRes?.rows) ? operatingUnitsRes.rows : [],
      );
      setRows(Array.isArray(rowsRes?.rows) ? rowsRes.rows : []);
    } catch (err) {
      setRows([]);
      if (
        String(err?.response?.data?.message || "").includes(
          "Scoped delegation list requests must include scopeType and scopeId",
        )
      ) {
        setError(
          "Your delegation read access is scoped. Choose a scope filter, then refresh the list.",
        );
      } else {
        setError(
          err?.response?.data?.message ||
            "Approval delegations could not be loaded.",
        );
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(event) {
    event.preventDefault();
    if (!writeAccess.allowed) {
      setError("Missing permission: approvals.policies.write");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    try {
      await createApprovalDelegation({
        delegatorUserId: Number(form.delegatorUserId),
        delegateUserId: Number(form.delegateUserId),
        moduleCode:
          String(form.moduleCode || "")
            .trim()
            .toUpperCase() || null,
        scopeType: form.scopeType,
        scopeId:
          form.scopeType === "TENANT"
            ? tenantScopeId
            : Number(form.scopeId || 0),
        effectiveFrom: form.effectiveFrom || null,
        effectiveTo: form.effectiveTo || null,
        note: String(form.note || "").trim() || null,
      });
      setMessage("Approval delegation created.");
      setForm((prev) => ({
        ...prev,
        delegateUserId: "",
        moduleCode: "",
        effectiveFrom: "",
        effectiveTo: "",
        note: "",
      }));
      await loadData(filters);
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          "Approval delegation could not be created.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleRevoke(row) {
    const delegationId = Number(row?.id || 0);
    if (!delegationId) {
      return;
    }
    const confirmed = window.confirm(
      `Revoke approval delegation #${delegationId}? The audit row will remain visible.`,
    );
    if (!confirmed) {
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await revokeApprovalDelegation(delegationId, {
        revokedReason: "Revoked from admin UI",
      });
      setMessage(`Approval delegation #${delegationId} revoked.`);
      await loadData(filters);
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          "Approval delegation could not be revoked.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <SecurityAdminWorkspaceShell
      workspaceSectionKey="users"
      sectionKey="user-assignments"
      eyebrow={l("Users & Assignments Workbench", "Kullanicilar ve Atamalar Workbench'i")}
      title={l("Delegations", "Delegasyonlar")}
      description={l(
        "Create, filter, and revoke scoped approval delegations from the same users workbench family as assignments and coverage.",
        "Atamalar ve kapsama kayitlariyla ayni users workbench ailesi icinde kapsamli approval delegasyonlari olusturun, filtreleyin ve geri alin."
      )}
      stats={[
        {
          title: l("Visible delegations", "Gorunen delegasyonlar"),
          value: filteredRows.length,
          description: l(
            "Rows that match the current delegation filters.",
            "Mevcut delegasyon filtrelerine uyan satirlar."
          ),
          tone: "blue",
        },
        {
          title: l("Delegation directory", "Delegasyon dizini"),
          value: rows.length,
          description: l(
            "Total delegation rows loaded in this workspace snapshot.",
            "Bu calisma alani gorunumunde yuklenen toplam delegasyon satirlari."
          ),
          tone: "green",
        },
      ]}
      hiddenPrimarySurfaceKeys={["roles-permissions"]}
      toolbar={<SecurityUsersWorkbenchTabs activeTab="delegations" counts={{ delegations: filteredRows.length }} />}
    >
      <div className="space-y-4">
      <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
        <div className="font-semibold">
          Need Temporary Runtime Authority Instead?
        </div>
        <p className="mt-1">
          Approval delegation only proxies review actions. Temporary operational
          coverage is the separate workflow for time-bounded local role
          authority.
        </p>
        <Link
          to="/app/ayarlar/security-admin/users?tab=coverage"
          className="mt-3 inline-flex rounded-lg border border-sky-300 bg-white px-3 py-2 font-medium text-sky-800 hover:bg-sky-100"
        >
          Open Temporary Operational Coverage
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
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <select
            value={filters.delegatorUserId}
            onChange={(event) =>
              setFilters((prev) => ({
                ...prev,
                delegatorUserId: event.target.value,
              }))
            }
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">All delegators</option>
            {users.map((row) => (
              <option key={`delegator-${row.id}`} value={row.id}>
                {row.name} ({row.email})
              </option>
            ))}
          </select>
          <select
            value={filters.delegateUserId}
            onChange={(event) =>
              setFilters((prev) => ({
                ...prev,
                delegateUserId: event.target.value,
              }))
            }
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">All delegates</option>
            {users.map((row) => (
              <option key={`delegate-${row.id}`} value={row.id}>
                {row.name} ({row.email})
              </option>
            ))}
          </select>
          <input
            type="text"
            value={filters.moduleCode}
            onChange={(event) =>
              setFilters((prev) => ({
                ...prev,
                moduleCode: event.target.value,
              }))
            }
            placeholder="Module code"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <select
            value={filters.scopeType}
            onChange={(event) =>
              setFilters((prev) => ({
                ...prev,
                scopeType: event.target.value,
                scopeId:
                  event.target.value === "TENANT"
                    ? String(tenantScopeId || "")
                    : "",
              }))
            }
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">All scopes</option>
            {SCOPE_TYPES.map((scopeType) => (
              <option key={`filter-${scopeType}`} value={scopeType}>
                {scopeType}
              </option>
            ))}
          </select>
          {filters.scopeType ? (
            filterScopeOptions.length > 0 ? (
              <select
                value={filters.scopeId}
                onChange={(event) =>
                  setFilters((prev) => ({
                    ...prev,
                    scopeId: event.target.value,
                  }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">Scope target</option>
                {filterScopeOptions.map((option) => (
                  <option key={`filter-scope-${option.id}`} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="number"
                min={1}
                value={filters.scopeId}
                onChange={(event) =>
                  setFilters((prev) => ({
                    ...prev,
                    scopeId: event.target.value,
                  }))
                }
                placeholder="Scope id"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            )
          ) : (
            <div className="rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-500">
              Optional scope filter
            </div>
          )}
          <select
            value={filters.state}
            onChange={(event) =>
              setFilters((prev) => ({ ...prev, state: event.target.value }))
            }
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            {STATE_FILTERS.map((state) => (
              <option key={state} value={state}>
                {state}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => loadData(filters)}
            disabled={loading}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {loading ? "Refreshing..." : "Refresh list"}
          </button>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Read access:{" "}
            {readAccess.allowed ? "available" : "scope or capability missing"}
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Write access:{" "}
            {writeAccess.allowed ? "available" : "scope or capability missing"}
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
        <form
          onSubmit={handleCreate}
          className="rounded-xl border border-slate-200 bg-white p-4"
        >
          <h2 className="text-base font-semibold text-slate-900">
            Create delegation
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Create a scoped approval-acting delegation. Approval actions will
            still be validated against the real request scope at decision time.
          </p>
          <div className="mt-4 grid gap-3">
            <select
              value={form.delegatorUserId}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  delegatorUserId: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
            >
              <option value="">Delegator</option>
              {users.map((row) => (
                <option key={`create-delegator-${row.id}`} value={row.id}>
                  {row.name} ({row.email})
                </option>
              ))}
            </select>
            <select
              value={form.delegateUserId}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  delegateUserId: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
            >
              <option value="">Delegate</option>
              {users.map((row) => (
                <option key={`create-delegate-${row.id}`} value={row.id}>
                  {row.name} ({row.email})
                </option>
              ))}
            </select>
            <input
              type="text"
              value={form.moduleCode}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, moduleCode: event.target.value }))
              }
              placeholder="Module code (optional)"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <select
              value={form.scopeType}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  scopeType: event.target.value,
                  scopeId:
                    event.target.value === "TENANT"
                      ? String(tenantScopeId || "")
                      : "",
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
            >
              {SCOPE_TYPES.map((scopeType) => (
                <option key={`create-${scopeType}`} value={scopeType}>
                  {scopeType}
                </option>
              ))}
            </select>
            {scopeOptions.length > 0 ? (
              <select
                value={form.scopeId}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, scopeId: event.target.value }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                required
              >
                <option value="">Scope target</option>
                {scopeOptions.map((option) => (
                  <option key={`create-scope-${option.id}`} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="number"
                min={1}
                value={form.scopeId}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, scopeId: event.target.value }))
                }
                placeholder="Scope id"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                required
              />
            )}
            <div className="grid gap-3 md:grid-cols-2">
              <input
                type="date"
                value={form.effectiveFrom}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    effectiveFrom: event.target.value,
                  }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                type="date"
                value={form.effectiveTo}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    effectiveTo: event.target.value,
                  }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <textarea
              rows={3}
              value={form.note}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, note: event.target.value }))
              }
              placeholder="Optional note"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={saving || !writeAccess.allowed}
              className="rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving ? "Saving..." : "Create delegation"}
            </button>
          </div>
        </form>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-700">
              Delegation rows
            </h2>
            <span className="text-xs text-slate-500">
              {filteredRows.length} rows
            </span>
          </div>
          {loading ? (
            <p className="px-4 py-3 text-sm text-slate-500">
              Loading approval delegations...
            </p>
          ) : filteredRows.length === 0 ? (
            <p className="px-4 py-3 text-sm text-slate-500">
              No approval delegation matched the current filters.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-slate-600">
                  <tr>
                    <th className="px-4 py-2">State</th>
                    <th className="px-4 py-2">Delegator</th>
                    <th className="px-4 py-2">Delegate</th>
                    <th className="px-4 py-2">Module</th>
                    <th className="px-4 py-2">Scope</th>
                    <th className="px-4 py-2">Window</th>
                    <th className="px-4 py-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <tr
                      key={row.id}
                      className="border-t border-slate-100 align-top"
                    >
                      <td className="px-4 py-3">
                        <DelegationStateBadge state={row.state} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">
                          {row.delegatorUserName ||
                            `User #${row.delegatorUserId || "-"}`}
                        </div>
                        <div className="text-xs text-slate-500">
                          {row.delegatorUserEmail || "-"}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">
                          {row.delegateUserName ||
                            `User #${row.delegateUserId || "-"}`}
                        </div>
                        <div className="text-xs text-slate-500">
                          {row.delegateUserEmail || "-"}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">
                          {row.moduleCode || "All modules"}
                        </div>
                        {row.note ? (
                          <div className="mt-1 text-xs text-slate-500">
                            {row.note}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {formatDelegationScopeLabel(row)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-slate-700">
                          {formatDelegationWindow(row)}
                        </div>
                        {row.revokedReason ? (
                          <div className="mt-1 text-xs text-rose-700">
                            {row.revokedReason}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        {row.state === "ACTIVE" || row.state === "UPCOMING" ? (
                          <button
                            type="button"
                            onClick={() => handleRevoke(row)}
                            disabled={saving || !writeAccess.allowed}
                            className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                          >
                            Revoke
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400">
                            No action
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
      </div>
    </SecurityAdminWorkspaceShell>
  );
}
