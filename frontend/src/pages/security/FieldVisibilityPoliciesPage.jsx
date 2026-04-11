import { useEffect, useMemo, useState } from "react";
import {
  createFieldVisibilityPolicy,
  deleteFieldVisibilityPolicy,
  listCountries,
  listFieldVisibilityPolicies,
  listGroupCompanies,
  listLegalEntities,
  listOperatingUnits,
  updateFieldVisibilityPolicy,
} from "../../api/rbacAdmin.js";
import { useAuth } from "../../auth/useAuth.js";
import { buildScopeLabel } from "./roleCatalog.js";
import SecurityAdminWorkspaceShell from "./SecurityAdminWorkspaceShell.jsx";
import SecurityCatalogWorkbenchTabs from "./components/catalog/SecurityCatalogWorkbenchTabs.jsx";

const VISIBILITY_RULE_OPTIONS = ["FULL", "MASKED", "HIDDEN", "LAST_4"];
const POLICY_SCOPE_OPTIONS = [
  "GLOBAL",
  "TENANT",
  "GROUP",
  "COUNTRY",
  "LEGAL_ENTITY",
  "OPERATING_UNIT",
];
const SUGGESTED_POLICY_TEMPLATES = Object.freeze([
  {
    label: "Bank account IBAN",
    moduleCode: "BANK",
    objectType: "BANK_ACCOUNT",
    fieldName: "iban",
    visibilityRule: "MASKED",
    requiredPermissionCode: "security.sensitive_data.audit.read",
  },
  {
    label: "Bank account number",
    moduleCode: "BANK",
    objectType: "BANK_ACCOUNT",
    fieldName: "account_no",
    visibilityRule: "MASKED",
    requiredPermissionCode: "security.sensitive_data.audit.read",
  },
  {
    label: "Payroll salary",
    moduleCode: "PAYROLL",
    objectType: "PAYROLL_RUN_LINE",
    fieldName: "base_salary",
    visibilityRule: "MASKED",
    requiredPermissionCode: "payroll.sensitive.read",
  },
  {
    label: "Beneficiary IBAN",
    moduleCode: "PAYROLL",
    objectType: "BENEFICIARY",
    fieldName: "iban",
    visibilityRule: "MASKED",
    requiredPermissionCode: "payroll.sensitive.read",
  },
]);

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

function resolvePolicyScopeLabel(policy, lookups, tenantScopeId) {
  const scopeType = String(policy?.appliesToScopeType || "").trim().toUpperCase();
  const scopeId = Number(policy?.appliesToScopeId || 0);
  if (!scopeType || !scopeId) {
    return "Global (tenant-managed)";
  }
  return buildScopeLabel(scopeType, scopeId, lookups, tenantScopeId);
}

function buildScopeOptions(scopeType, lookups, tenantScopeId) {
  if (scopeType === "TENANT") {
    return tenantScopeId
      ? [{ id: tenantScopeId, label: `Tenant #${tenantScopeId}` }]
      : [];
  }
  if (scopeType === "GROUP") {
    return lookups.groups.map((row) => ({
      id: Number(row.id),
      label: `${row.code} - ${row.name}`,
    }));
  }
  if (scopeType === "COUNTRY") {
    return lookups.countries.map((row) => ({
      id: Number(row.id),
      label: `${row.iso2} - ${row.name}`,
    }));
  }
  if (scopeType === "LEGAL_ENTITY") {
    return lookups.legalEntities.map((row) => ({
      id: Number(row.id),
      label: `${row.code} - ${row.name}`,
    }));
  }
  if (scopeType === "OPERATING_UNIT") {
    return lookups.operatingUnits.map((row) => ({
      id: Number(row.id),
      label: `${row.code} - ${row.name}`,
    }));
  }
  return [];
}

function buildEmptyForm(tenantScopeId) {
  return {
    id: null,
    moduleCode: "",
    objectType: "",
    fieldName: "",
    visibilityRule: "MASKED",
    appliesToScopeType: "TENANT",
    appliesToScopeId: tenantScopeId ? String(tenantScopeId) : "",
    requiredPermissionCode: "",
    isActive: true,
  };
}

/**
 * Security-admin UI for field visibility policy CRUD without changing the
 * runtime masking engine or the sensitive-data audit seam.
 */
export default function FieldVisibilityPoliciesPage() {
  const { getPermissionAccess, hasPermission, user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({
    moduleCode: "",
    objectType: "",
    fieldName: "",
    includeInactive: true,
  });
  const tenantScopeId = Number(user?.tenant_id || 0);
  const [lookups, setLookups] = useState({
    groups: [],
    countries: [],
    legalEntities: [],
    operatingUnits: [],
  });
  const [form, setForm] = useState(() => buildEmptyForm(tenantScopeId));

  const canReadOrgTree = hasPermission("org.tree.read");
  const lookupsWithTenant = useMemo(
    () => ({
      ...lookups,
      tenantScopeId,
    }),
    [lookups, tenantScopeId]
  );
  const formScopeOptions = useMemo(
    () => buildScopeOptions(form.appliesToScopeType, lookups, tenantScopeId),
    [form.appliesToScopeType, lookups, tenantScopeId]
  );
  const effectiveFormScope = useMemo(() => {
    if (form.appliesToScopeType === "GLOBAL") {
      return { scopeType: "TENANT", scopeId: tenantScopeId };
    }
    if (form.appliesToScopeType === "TENANT") {
      return { scopeType: "TENANT", scopeId: tenantScopeId };
    }
    return {
      scopeType: form.appliesToScopeType,
      scopeId: Number(form.appliesToScopeId || 0),
    };
  }, [form.appliesToScopeId, form.appliesToScopeType, tenantScopeId]);
  const writeAccess = getPermissionAccess(
    "security.field_visibility.write",
    effectiveFormScope.scopeId
      ? {
          scope: {
            scopeType: effectiveFormScope.scopeType,
            scopeId: effectiveFormScope.scopeId,
          },
        }
      : undefined
  );
  const activePolicyCount = useMemo(
    () => rows.filter((row) => Boolean(row?.isActive)).length,
    [rows]
  );
  const scopedPolicyCount = useMemo(
    () =>
      rows.filter((row) => {
        const scopeType = String(row?.appliesToScopeType || "").trim().toUpperCase();
        return scopeType && !["GLOBAL", "TENANT"].includes(scopeType);
      }).length,
    [rows]
  );

  useEffect(() => {
    if (form.appliesToScopeType === "TENANT") {
      setForm((prev) => ({ ...prev, appliesToScopeId: String(tenantScopeId || "") }));
    }
  }, [form.appliesToScopeType, tenantScopeId]);

  useEffect(() => {
    if (
      ["GLOBAL", "TENANT"].includes(form.appliesToScopeType) ||
      formScopeOptions.some((option) => Number(option.id) === Number(form.appliesToScopeId || 0))
    ) {
      return;
    }
    setForm((prev) => ({
      ...prev,
      appliesToScopeId: String(formScopeOptions[0]?.id || ""),
    }));
  }, [form.appliesToScopeId, form.appliesToScopeType, formScopeOptions]);

  async function loadData(nextFilters = filters) {
    setLoading(true);
    setError("");
    try {
      const [policyResponse, groupsResponse, countriesResponse, entitiesResponse, unitsResponse] =
        await Promise.all([
          listFieldVisibilityPolicies({
            includeInactive: nextFilters.includeInactive ? "true" : "false",
            moduleCode: nextFilters.moduleCode || undefined,
            objectType: nextFilters.objectType || undefined,
            fieldName: nextFilters.fieldName || undefined,
          }),
          canReadOrgTree ? listGroupCompanies() : Promise.resolve({ rows: [] }),
          canReadOrgTree ? listCountries() : Promise.resolve({ rows: [] }),
          canReadOrgTree ? listLegalEntities() : Promise.resolve({ rows: [] }),
          canReadOrgTree ? listOperatingUnits() : Promise.resolve({ rows: [] }),
        ]);
      setRows(Array.isArray(policyResponse?.rows) ? policyResponse.rows : []);
      setLookups({
        groups: Array.isArray(groupsResponse?.rows) ? groupsResponse.rows : [],
        countries: Array.isArray(countriesResponse?.rows) ? countriesResponse.rows : [],
        legalEntities: Array.isArray(entitiesResponse?.rows) ? entitiesResponse.rows : [],
        operatingUnits: Array.isArray(unitsResponse?.rows) ? unitsResponse.rows : [],
      });
    } catch (err) {
      setRows([]);
      setError(err?.response?.data?.message || "Field visibility policies could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleEditRow(row) {
    setError("");
    setMessage("");
    setForm({
      id: Number(row?.id || 0) || null,
      moduleCode: String(row?.moduleCode || ""),
      objectType: String(row?.objectType || ""),
      fieldName: String(row?.fieldName || ""),
      visibilityRule: String(row?.visibilityRule || "MASKED"),
      appliesToScopeType: String(row?.appliesToScopeType || "GLOBAL") || "GLOBAL",
      appliesToScopeId: row?.appliesToScopeId ? String(row.appliesToScopeId) : "",
      requiredPermissionCode: String(row?.requiredPermissionCode || ""),
      isActive: Boolean(row?.isActive),
    });
  }

  function handleResetForm() {
    setForm(buildEmptyForm(tenantScopeId));
    setError("");
    setMessage("");
  }

  function applyTemplate(template) {
    setForm((prev) => ({
      ...prev,
      moduleCode: template.moduleCode,
      objectType: template.objectType,
      fieldName: template.fieldName,
      visibilityRule: template.visibilityRule,
      requiredPermissionCode: template.requiredPermissionCode,
    }));
  }

  async function handleSave(event) {
    event.preventDefault();
    if (!writeAccess.allowed) {
      setError("Missing permission: security.field_visibility.write at the selected scope.");
      return;
    }

    const payload = {
      moduleCode: String(form.moduleCode || "").trim().toUpperCase(),
      objectType: String(form.objectType || "").trim().toUpperCase(),
      fieldName: String(form.fieldName || "").trim(),
      visibilityRule: String(form.visibilityRule || "FULL").trim().toUpperCase(),
      appliesToScopeType: form.appliesToScopeType,
      appliesToScopeId:
        form.appliesToScopeType === "GLOBAL"
          ? null
          : form.appliesToScopeType === "TENANT"
            ? tenantScopeId
            : Number(form.appliesToScopeId || 0),
      requiredPermissionCode: String(form.requiredPermissionCode || "").trim() || null,
      isActive: Boolean(form.isActive),
    };

    setSaving(true);
    setError("");
    setMessage("");
    try {
      if (form.id) {
        await updateFieldVisibilityPolicy(form.id, payload);
        setMessage(`Field visibility policy #${form.id} updated.`);
      } else {
        await createFieldVisibilityPolicy(payload);
        setMessage("Field visibility policy created.");
      }
      handleResetForm();
      await loadData(filters);
    } catch (err) {
      setError(err?.response?.data?.message || "Field visibility policy could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(row) {
    const policyId = Number(row?.id || 0);
    if (!policyId) {
      return;
    }
    const confirmed = window.confirm(
      `Deactivate field visibility policy #${policyId}? Runtime masking will stop using it immediately.`
    );
    if (!confirmed) {
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await deleteFieldVisibilityPolicy(policyId);
      if (Number(form.id) === policyId) {
        handleResetForm();
      }
      setMessage(`Field visibility policy #${policyId} deactivated.`);
      await loadData(filters);
    } catch (err) {
      setError(err?.response?.data?.message || "Field visibility policy could not be deactivated.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SecurityAdminWorkspaceShell
      workspaceSectionKey="catalog"
      sectionKey="access-model"
      eyebrow="Security / Field visibility"
      title="Field Visibility"
      description="Manage scope-aware masking and hiding rules without changing the runtime masking engine. These policies stay tied to the shared sensitive-data audit seam while the catalog workbench becomes the canonical admin surface."
      actions={[
        {
          to: "/app/ayarlar/security-admin/diagnostics?tab=sensitive-data",
          label: "Open sensitive-data audit",
          tone: "primary",
        },
        {
          to: "/app/ayarlar/security-admin/catalog?tab=access-model",
          label: "Open access model",
        },
      ]}
      stats={[
        {
          title: "Policies",
          value: rows.length,
          description: "Field visibility policy rows currently loaded from the masking catalog.",
          tone: "blue",
        },
        {
          title: "Active posture",
          value: `${activePolicyCount} active / ${Math.max(rows.length - activePolicyCount, 0)} inactive`,
          description: "Inactive rows stay visible here so masking rollback and audit context remain reviewable.",
          tone: "green",
        },
        {
          title: "Scoped overrides",
          value: scopedPolicyCount,
          description: "Policies pinned below tenant scope where masking posture diverges by group, country, entity, or OU.",
          tone: "amber",
        },
      ]}
      toolbar={
        <SecurityCatalogWorkbenchTabs
          activeTab="field-visibility"
          counts={{ "field-visibility": rows.length }}
        />
      }
    >
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

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.95fr)]">
        <section className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-3 text-sm text-sky-900">
              Read and write checks stay scope-aware. A policy scoped to one legal entity or OU
              still requires `security.field_visibility.read` or `security.field_visibility.write`
              at that same scope.
            </div>
            <div className="grid gap-3 md:grid-cols-4">
              <input
                value={filters.moduleCode}
                onChange={(event) =>
                  setFilters((prev) => ({ ...prev, moduleCode: event.target.value }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="MODULE"
              />
              <input
                value={filters.objectType}
                onChange={(event) =>
                  setFilters((prev) => ({ ...prev, objectType: event.target.value }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="OBJECT_TYPE"
              />
              <input
                value={filters.fieldName}
                onChange={(event) =>
                  setFilters((prev) => ({ ...prev, fieldName: event.target.value }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="field_name"
              />
              <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={Boolean(filters.includeInactive)}
                  onChange={(event) =>
                    setFilters((prev) => ({
                      ...prev,
                      includeInactive: event.target.checked,
                    }))
                  }
                />
                Include inactive
              </label>
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => loadData(filters)}
                disabled={loading}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {loading ? "Loading..." : "Refresh Policies"}
              </button>
            </div>
          </div>

          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            {loading ? (
              <div className="px-4 py-3 text-sm text-slate-500">Loading policies...</div>
            ) : rows.length === 0 ? (
              <div className="px-4 py-3 text-sm text-slate-500">
                No visible field visibility policies match the current filter.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-slate-600">
                    <tr>
                      <th className="px-3 py-2">Module / Object</th>
                      <th className="px-3 py-2">Field</th>
                      <th className="px-3 py-2">Rule</th>
                      <th className="px-3 py-2">Scope</th>
                      <th className="px-3 py-2">Override permission</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Updated</th>
                      <th className="px-3 py-2">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id} className="border-t border-slate-100 align-top">
                        <td className="px-3 py-2">
                          <div className="font-medium text-slate-900">{row.moduleCode}</div>
                          <div className="text-xs text-slate-500">{row.objectType}</div>
                        </td>
                        <td className="px-3 py-2">
                          <code className="text-xs text-slate-700">{row.fieldName}</code>
                        </td>
                        <td className="px-3 py-2">
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700">
                            {row.visibilityRule}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-700">
                          {resolvePolicyScopeLabel(row, lookupsWithTenant, tenantScopeId)}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-700">
                          {row.requiredPermissionCode || "-"}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`rounded-full border px-2 py-1 text-xs font-semibold ${
                              row.isActive
                                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                : "border-slate-200 bg-slate-50 text-slate-600"
                            }`}
                          >
                            {row.isActive ? "ACTIVE" : "INACTIVE"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-500">
                          {formatDateTime(row.updatedAt)}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => handleEditRow(row)}
                              className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            >
                              Edit
                            </button>
                            {row.isActive ? (
                              <button
                                type="button"
                                onClick={() => handleDeactivate(row)}
                                disabled={saving}
                                className="rounded-lg border border-rose-300 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                              >
                                Deactivate
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                {form.id ? `Edit Policy #${form.id}` : "New Field Visibility Policy"}
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Choose the target module/object/field, the masking rule, and the exact scope that
                owns the policy.
              </p>
            </div>
            {form.id ? (
              <button
                type="button"
                onClick={handleResetForm}
                className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                New policy
              </button>
            ) : null}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {SUGGESTED_POLICY_TEMPLATES.map((template) => (
              <button
                key={template.label}
                type="button"
                onClick={() => applyTemplate(template)}
                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-white"
              >
                {template.label}
              </button>
            ))}
          </div>

          <form onSubmit={handleSave} className="mt-4 space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <input
                value={form.moduleCode}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, moduleCode: event.target.value }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="MODULE_CODE"
                required
              />
              <input
                value={form.objectType}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, objectType: event.target.value }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="OBJECT_TYPE"
                required
              />
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <input
                value={form.fieldName}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, fieldName: event.target.value }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="field_name"
                required
              />
              <select
                value={form.visibilityRule}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, visibilityRule: event.target.value }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                {VISIBILITY_RULE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <select
                value={form.appliesToScopeType}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    appliesToScopeType: event.target.value,
                    appliesToScopeId: "",
                  }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                {POLICY_SCOPE_OPTIONS.map((scopeType) => (
                  <option key={scopeType} value={scopeType}>
                    {scopeType}
                  </option>
                ))}
              </select>

              {["GLOBAL", "TENANT"].includes(form.appliesToScopeType) ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  {form.appliesToScopeType === "GLOBAL"
                    ? "Global policy. Management permission is still checked at tenant scope."
                    : `Tenant scope: #${tenantScopeId || "-"}`}
                </div>
              ) : formScopeOptions.length > 0 ? (
                <select
                  value={form.appliesToScopeId}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, appliesToScopeId: event.target.value }))
                  }
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">Select scope target</option>
                  {formScopeOptions.map((option) => (
                    <option key={`${form.appliesToScopeType}-${option.id}`} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="number"
                  min={1}
                  value={form.appliesToScopeId}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, appliesToScopeId: event.target.value }))
                  }
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Scope ID"
                />
              )}
            </div>

            <input
              value={form.requiredPermissionCode}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  requiredPermissionCode: event.target.value,
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="required_permission_code (optional override permission)"
            />

            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={Boolean(form.isActive)}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, isActive: event.target.checked }))
                }
              />
              Policy active
            </label>

            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
              <div className="font-semibold text-slate-900">Selected management scope</div>
              <div className="mt-1">
                {effectiveFormScope.scopeType && effectiveFormScope.scopeId
                  ? `${effectiveFormScope.scopeType} #${effectiveFormScope.scopeId}`
                  : "Choose a concrete scope target."}
              </div>
              <div className="mt-2 text-xs text-slate-600">
                Save requires <code>security.field_visibility.write</code> at that scope.
              </div>
            </div>

            {!writeAccess.allowed ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Missing permission at the selected scope: <code>security.field_visibility.write</code>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={saving || !writeAccess.allowed}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {saving
                  ? form.id
                    ? "Saving..."
                    : "Creating..."
                  : form.id
                    ? "Save Policy"
                    : "Create Policy"}
              </button>
              <button
                type="button"
                onClick={handleResetForm}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Reset
              </button>
            </div>
          </form>
        </section>
      </div>
    </SecurityAdminWorkspaceShell>
  );
}
