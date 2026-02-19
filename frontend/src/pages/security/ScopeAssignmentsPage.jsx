import { useEffect, useMemo, useState } from "react";
import {
  listCountries,
  listDataScopes,
  listGroupCompanies,
  listLegalEntities,
  listOperatingUnits,
  listRoleAssignments,
  listUsers,
  replaceRoleAssignmentScope,
  replaceUserDataScopes,
} from "../../api/rbacAdmin.js";
import { useAuth } from "../../auth/useAuth.js";

const SCOPE_TYPES = ["TENANT", "GROUP", "COUNTRY", "LEGAL_ENTITY", "OPERATING_UNIT"];
const EFFECTS = ["ALLOW", "DENY"];

function normalizeDataScopeRow(row) {
  return {
    scopeType: String(row.scope_type || "").toUpperCase(),
    scopeId: Number(row.scope_id || 0),
    effect: String(row.effect || "ALLOW").toUpperCase(),
  };
}

export default function ScopeAssignmentsPage() {
  const { hasPermission } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [users, setUsers] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [dataScopes, setDataScopes] = useState([]);
  const [draftScope, setDraftScope] = useState({
    scopeType: "GROUP",
    scopeId: "",
    effect: "ALLOW",
  });
  const [assignments, setAssignments] = useState([]);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState("");
  const [assignmentForm, setAssignmentForm] = useState({
    scopeType: "GROUP",
    scopeId: "",
    effect: "ALLOW",
  });
  const [lookups, setLookups] = useState({
    groups: [],
    countries: [],
    legalEntities: [],
    operatingUnits: [],
  });
  const canReplaceDataScopes = hasPermission("security.data_scope.upsert");
  const canReplaceRoleAssignmentScope = hasPermission(
    "security.role_assignment.upsert"
  );

  async function loadUserListAndLookups() {
    setLoading(true);
    setError("");
    try {
      const [usersRes, groupsRes, countriesRes, entitiesRes, unitsRes] =
        await Promise.all([
          listUsers(),
          listGroupCompanies(),
          listCountries(),
          listLegalEntities(),
          listOperatingUnits(),
        ]);

      const userRows = usersRes?.rows || [];
      setUsers(userRows);
      setLookups({
        groups: groupsRes?.rows || [],
        countries: countriesRes?.rows || [],
        legalEntities: entitiesRes?.rows || [],
        operatingUnits: unitsRes?.rows || [],
      });

      if (userRows[0] && !selectedUserId) {
        setSelectedUserId(String(userRows[0].id));
      }
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to load scope lookups");
    } finally {
      setLoading(false);
    }
  }

  async function loadUserScopeData(userId) {
    if (!userId) {
      setDataScopes([]);
      setAssignments([]);
      return;
    }
    try {
      const [dataScopesRes, assignmentsRes] = await Promise.all([
        listDataScopes({ userId }),
        listRoleAssignments({ userId }),
      ]);
      setDataScopes((dataScopesRes?.rows || []).map(normalizeDataScopeRow));
      setAssignments(assignmentsRes?.rows || []);
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to load user scope data");
    }
  }

  useEffect(() => {
    loadUserListAndLookups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadUserScopeData(selectedUserId);
  }, [selectedUserId]);

  const scopeOptions = useMemo(() => {
    if (draftScope.scopeType === "GROUP") {
      return lookups.groups.map((row) => ({
        id: row.id,
        label: `${row.code} - ${row.name}`,
      }));
    }
    if (draftScope.scopeType === "COUNTRY") {
      return lookups.countries.map((row) => ({
        id: row.id,
        label: `${row.iso2} - ${row.name}`,
      }));
    }
    if (draftScope.scopeType === "LEGAL_ENTITY") {
      return lookups.legalEntities.map((row) => ({
        id: row.id,
        label: `${row.code} - ${row.name}`,
      }));
    }
    if (draftScope.scopeType === "OPERATING_UNIT") {
      return lookups.operatingUnits.map((row) => ({
        id: row.id,
        label: `${row.code} - ${row.name}`,
      }));
    }
    return [];
  }, [draftScope.scopeType, lookups]);

  function addDataScope() {
    const scopeId = Number(draftScope.scopeId);
    if (!scopeId) {
      setError("Scope ID is required.");
      return;
    }

    const nextScope = {
      scopeType: draftScope.scopeType,
      scopeId,
      effect: draftScope.effect,
    };

    setDataScopes((prev) => {
      const withoutDuplicate = prev.filter(
        (row) =>
          !(
            row.scopeType === nextScope.scopeType &&
            row.scopeId === nextScope.scopeId
          )
      );
      return [...withoutDuplicate, nextScope];
    });
  }

  function removeDataScope(scopeType, scopeId) {
    setDataScopes((prev) =>
      prev.filter(
        (row) => !(row.scopeType === scopeType && Number(row.scopeId) === Number(scopeId))
      )
    );
  }

  async function handleReplaceDataScopes() {
    if (!selectedUserId) {
      return;
    }
    if (!canReplaceDataScopes) {
      setError("Missing permission: security.data_scope.upsert");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await replaceUserDataScopes(Number(selectedUserId), dataScopes);
      setMessage("User data scopes replaced.");
      await loadUserScopeData(selectedUserId);
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to replace user data scopes");
    } finally {
      setSaving(false);
    }
  }

  async function handleReplaceAssignmentScope(event) {
    event.preventDefault();
    if (!selectedAssignmentId) {
      return;
    }
    if (!canReplaceRoleAssignmentScope) {
      setError("Missing permission: security.role_assignment.upsert");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await replaceRoleAssignmentScope(Number(selectedAssignmentId), {
        scopeType: assignmentForm.scopeType,
        scopeId: Number(assignmentForm.scopeId),
        effect: assignmentForm.effect,
      });
      setMessage("Role assignment scope replaced.");
      await loadUserScopeData(selectedUserId);
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to replace assignment scope");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">
          Scope Assignment Management
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Replace user data scopes and replace existing assignment scopes.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {message}
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <label className="mb-2 block text-sm font-medium text-slate-700">
          User
        </label>
        <select
          value={selectedUserId}
          onChange={(event) => setSelectedUserId(event.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm md:w-[420px]"
        >
          <option value="">Select user</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name} ({user.email})
            </option>
          ))}
        </select>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Data Scopes</h2>
        <div className="grid gap-2 md:grid-cols-5">
          <select
            value={draftScope.scopeType}
            onChange={(event) =>
              setDraftScope((prev) => ({
                ...prev,
                scopeType: event.target.value,
                scopeId: "",
              }))
            }
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            {SCOPE_TYPES.map((scopeType) => (
              <option key={scopeType} value={scopeType}>
                {scopeType}
              </option>
            ))}
          </select>

          <select
            value={draftScope.scopeId}
            onChange={(event) =>
              setDraftScope((prev) => ({ ...prev, scopeId: event.target.value }))
            }
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
          >
            <option value="">Select scope</option>
            {scopeOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>

          <select
            value={draftScope.effect}
            onChange={(event) =>
              setDraftScope((prev) => ({ ...prev, effect: event.target.value }))
            }
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            {EFFECTS.map((effect) => (
              <option key={effect} value={effect}>
                {effect}
              </option>
            ))}
          </select>

        <button
          type="button"
          onClick={addDataScope}
          disabled={!canReplaceDataScopes}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Add Scope
          </button>
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-3 py-2">Scope Type</th>
                <th className="px-3 py-2">Scope ID</th>
                <th className="px-3 py-2">Effect</th>
                <th className="px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {dataScopes.map((scope) => (
                <tr
                  key={`${scope.scopeType}-${scope.scopeId}`}
                  className="border-t border-slate-100"
                >
                  <td className="px-3 py-2">{scope.scopeType}</td>
                  <td className="px-3 py-2">{scope.scopeId}</td>
                  <td className="px-3 py-2">{scope.effect}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => removeDataScope(scope.scopeType, scope.scopeId)}
                      disabled={!canReplaceDataScopes}
                      className="rounded-lg border border-rose-200 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              {dataScopes.length === 0 && (
                <tr>
                  <td className="px-3 py-3 text-slate-500" colSpan={4}>
                    No scopes configured for this user.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <button
          type="button"
          disabled={!selectedUserId || saving || !canReplaceDataScopes}
          onClick={handleReplaceDataScopes}
          className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {saving ? "Saving..." : "Replace User Data Scopes"}
        </button>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">
          Replace Existing Role Assignment Scope
        </h2>
        <form onSubmit={handleReplaceAssignmentScope} className="grid gap-2 md:grid-cols-5">
          <select
            value={selectedAssignmentId}
            onChange={(event) => {
              const assignmentId = event.target.value;
              setSelectedAssignmentId(assignmentId);
              const selected = assignments.find(
                (row) => Number(row.id) === Number(assignmentId)
              );
              if (selected) {
                setAssignmentForm({
                  scopeType: String(selected.scope_type || "GROUP"),
                  scopeId: String(selected.scope_id || ""),
                  effect: String(selected.effect || "ALLOW"),
                });
              }
            }}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
            required
          >
            <option value="">Select assignment</option>
            {assignments.map((assignment) => (
              <option key={assignment.id} value={assignment.id}>
                #{assignment.id} {assignment.user_email} {"->"} {assignment.role_code} (
                {assignment.scope_type}:{assignment.scope_id})
              </option>
            ))}
          </select>

          <select
            value={assignmentForm.scopeType}
            onChange={(event) =>
              setAssignmentForm((prev) => ({ ...prev, scopeType: event.target.value }))
            }
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            required
          >
            {SCOPE_TYPES.map((scopeType) => (
              <option key={scopeType} value={scopeType}>
                {scopeType}
              </option>
            ))}
          </select>

          <input
            type="number"
            min={1}
            value={assignmentForm.scopeId}
            onChange={(event) =>
              setAssignmentForm((prev) => ({ ...prev, scopeId: event.target.value }))
            }
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Scope ID"
            required
          />

          <div className="flex gap-2">
            <select
              value={assignmentForm.effect}
              onChange={(event) =>
                setAssignmentForm((prev) => ({ ...prev, effect: event.target.value }))
              }
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
            >
              {EFFECTS.map((effect) => (
                <option key={effect} value={effect}>
                  {effect}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={
                saving ||
                !selectedAssignmentId ||
                !canReplaceRoleAssignmentScope
              }
              className="rounded-lg bg-cyan-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              Replace
            </button>
          </div>
        </form>
      </section>

      {loading && (
        <p className="text-sm text-slate-500">Loading users and scope lookups...</p>
      )}
    </div>
  );
}
