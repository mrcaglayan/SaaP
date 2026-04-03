import { useEffect, useMemo, useState } from "react";
import {
  listCountries,
  listGroupCompanies,
  listLegalEntities,
  listOperatingUnits,
  listUsers,
  runRbacAccessCheck,
} from "../../api/rbacAdmin.js";
import AccessDebuggerResults from "../../components/security/AccessDebuggerResults.jsx";
import { useAuth } from "../../auth/useAuth.js";
import { useI18n } from "../../i18n/useI18n.js";

const SCOPE_TYPES = ["", "TENANT", "GROUP", "COUNTRY", "LEGAL_ENTITY", "OPERATING_UNIT"];

function getScopeOptions(scopeType, lookups, tenantScopeId) {
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

/**
 * Admin-facing page for explainable access checks across capability, scope,
 * visibility, SoD, workflow, and field-level restrictions.
 */
export default function AccessDebuggerPage() {
  const { hasPermission, user } = useAuth();
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [users, setUsers] = useState([]);
  const [lookups, setLookups] = useState({
    groups: [],
    countries: [],
    legalEntities: [],
    operatingUnits: [],
  });
  const [result, setResult] = useState(null);
  const [form, setForm] = useState({
    targetUserId: "",
    permissionCode: "",
    scopeType: "",
    scopeId: "",
    moduleCode: "",
    objectType: "",
    fieldName: "",
    actionCode: "",
    recordType: "",
    recordId: "",
    workflowRequestId: "",
  });

  const tenantScopeId = Number(user?.tenant_id || 0);
  const canReadOrgTree = hasPermission("org.tree.read");
  const scopeOptions = useMemo(
    () => getScopeOptions(form.scopeType, lookups, tenantScopeId),
    [form.scopeType, lookups, tenantScopeId]
  );
  const selectedUser = useMemo(
    () => users.find((row) => Number(row.id) === Number(form.targetUserId || 0)) || null,
    [form.targetUserId, users]
  );

  async function loadLookups() {
    setLoading(true);
    setError("");
    try {
      const [usersRes, groupsRes, countriesRes, entitiesRes, unitsRes] =
        await Promise.all([
          listUsers(),
          canReadOrgTree ? listGroupCompanies() : Promise.resolve({ rows: [] }),
          canReadOrgTree ? listCountries() : Promise.resolve({ rows: [] }),
          canReadOrgTree ? listLegalEntities() : Promise.resolve({ rows: [] }),
          canReadOrgTree ? listOperatingUnits() : Promise.resolve({ rows: [] }),
        ]);

      const nextUsers = usersRes?.rows || [];
      setUsers(nextUsers);
      setLookups({
        groups: groupsRes?.rows || [],
        countries: countriesRes?.rows || [],
        legalEntities: entitiesRes?.rows || [],
        operatingUnits: unitsRes?.rows || [],
      });

      setForm((prev) => ({
        ...prev,
        targetUserId:
          prev.targetUserId || String(user?.id || nextUsers[0]?.id || ""),
      }));
    } catch (err) {
      setError(err?.response?.data?.message || t("accessDebugger.errors.loadLookupsFailed"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadLookups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setForm((prev) => {
      if (!prev.scopeType) {
        if (prev.scopeId) {
          return { ...prev, scopeId: "" };
        }
        return prev;
      }

      const currentScopeId = Number(prev.scopeId || 0);
      if (
        currentScopeId &&
        scopeOptions.some((option) => Number(option.id) === currentScopeId)
      ) {
        return prev;
      }

      return {
        ...prev,
        scopeId: String(scopeOptions[0]?.id || ""),
      };
    });
  }, [scopeOptions]);

  async function handleRun(event) {
    event.preventDefault();
    if (!form.targetUserId) {
      setError(t("accessDebugger.errors.targetUserRequired"));
      return;
    }

    setRunning(true);
    setError("");
    try {
      const payload = {
        targetUserId: Number(form.targetUserId),
        permissionCode: form.permissionCode.trim() || undefined,
        scopeType: form.scopeType || undefined,
        scopeId: form.scopeId ? Number(form.scopeId) : undefined,
        moduleCode: form.moduleCode.trim() || undefined,
        objectType: form.objectType.trim() || undefined,
        fieldName: form.fieldName.trim() || undefined,
        actionCode: form.actionCode.trim() || undefined,
        recordType: form.recordType.trim() || undefined,
        recordId: form.recordId ? Number(form.recordId) : undefined,
        workflowRequestId: form.workflowRequestId ? Number(form.workflowRequestId) : undefined,
      };
      const response = await runRbacAccessCheck(payload);
      setResult(response || null);
    } catch (err) {
      setError(err?.response?.data?.message || t("accessDebugger.errors.runFailed"));
    } finally {
      setRunning(false);
    }
  }

  function handleReset() {
    setForm({
      targetUserId: String(user?.id || users[0]?.id || ""),
      permissionCode: "",
      scopeType: "",
      scopeId: "",
      moduleCode: "",
      objectType: "",
      fieldName: "",
      actionCode: "",
      recordType: "",
      recordId: "",
      workflowRequestId: "",
    });
    setResult(null);
    setError("");
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">
          {t("accessDebugger.page.title")}
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          {t("accessDebugger.page.subtitle")}
        </p>
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-3 text-sm text-cyan-900">
          <div className="font-semibold">{t("accessDebugger.page.noteTitle")}</div>
          <div className="mt-1">{t("accessDebugger.page.noteBody")}</div>
        </div>

        <form onSubmit={handleRun} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <select
            value={form.targetUserId}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, targetUserId: event.target.value }))
            }
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            required
          >
            <option value="">{t("accessDebugger.form.userPlaceholder")}</option>
            {users.map((userRow) => (
              <option key={userRow.id} value={userRow.id}>
                {userRow.name} ({userRow.email})
              </option>
            ))}
          </select>

          <input
            value={form.permissionCode}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, permissionCode: event.target.value }))
            }
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder={t("accessDebugger.form.permissionPlaceholder")}
          />

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
          >
            {SCOPE_TYPES.map((scopeType) => (
              <option key={scopeType || "NONE"} value={scopeType}>
                {scopeType || t("accessDebugger.form.noScope")}
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
            >
              <option value="">{t("accessDebugger.form.scopePlaceholder")}</option>
              {scopeOptions.map((option) => (
                <option key={option.id} value={option.id}>
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
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={t("accessDebugger.form.scopeId")}
            />
          )}

          <details className="md:col-span-2 xl:col-span-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <summary className="cursor-pointer text-sm font-semibold text-slate-800">
              {t("accessDebugger.form.advanced")}
            </summary>
            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <input
                value={form.moduleCode}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, moduleCode: event.target.value }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={t("accessDebugger.form.moduleCode")}
              />
              <input
                value={form.objectType}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, objectType: event.target.value }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={t("accessDebugger.form.objectType")}
              />
              <input
                value={form.fieldName}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, fieldName: event.target.value }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={t("accessDebugger.form.fieldName")}
              />
              <input
                value={form.workflowRequestId}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, workflowRequestId: event.target.value }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={t("accessDebugger.form.workflowRequestId")}
              />
              <input
                value={form.actionCode}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, actionCode: event.target.value }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={t("accessDebugger.form.actionCode")}
              />
              <input
                value={form.recordType}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, recordType: event.target.value }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={t("accessDebugger.form.recordType")}
              />
              <input
                type="number"
                min={1}
                value={form.recordId}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, recordId: event.target.value }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={t("accessDebugger.form.recordId")}
              />
            </div>
          </details>

          <div className="md:col-span-2 xl:col-span-4 flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={loading || running}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {running
                ? t("accessDebugger.actions.running")
                : t("accessDebugger.actions.run")}
            </button>
            <button
              type="button"
              onClick={handleReset}
              disabled={running}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {t("accessDebugger.actions.reset")}
            </button>
          </div>
        </form>
      </section>

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-600">
          {t("accessDebugger.loading")}
        </div>
      ) : result ? (
        <AccessDebuggerResults
          result={result}
          targetUserLabel={
            selectedUser ? `${selectedUser.name} (${selectedUser.email})` : ""
          }
        />
      ) : (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-600">
          {t("accessDebugger.empty")}
        </div>
      )}
    </div>
  );
}
