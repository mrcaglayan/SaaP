import { useEffect, useState } from "react";
import {
  createRoleAssignment,
  deleteRoleAssignment,
  listRoleAssignments,
  listRoles,
  listUsers,
} from "../../api/rbacAdmin.js";
import { useAuth } from "../../auth/useAuth.js";

const SCOPE_TYPES = ["TENANT", "GROUP", "COUNTRY", "LEGAL_ENTITY", "OPERATING_UNIT"];
const EFFECTS = ["ALLOW", "DENY"];

export default function UserAssignmentsPage() {
  const { hasPermission } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [form, setForm] = useState({
    userId: "",
    roleId: "",
    scopeType: "TENANT",
    scopeId: "",
    effect: "ALLOW",
  });
  const canUpsertAssignments = hasPermission("security.role_assignment.upsert");

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const [usersRes, rolesRes, assignmentsRes] = await Promise.all([
        listUsers(),
        listRoles(),
        listRoleAssignments(),
      ]);
      setUsers(usersRes?.rows || []);
      setRoles(rolesRes?.rows || []);
      setAssignments(assignmentsRes?.rows || []);
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to load assignment data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleCreate(event) {
    event.preventDefault();
    if (!canUpsertAssignments) {
      setError("Missing permission: security.role_assignment.upsert");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await createRoleAssignment({
        userId: Number(form.userId),
        roleId: Number(form.roleId),
        scopeType: form.scopeType,
        scopeId: Number(form.scopeId),
        effect: form.effect,
      });
      setMessage("Role assignment saved.");
      await loadData();
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to save role assignment");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(assignmentId) {
    if (!canUpsertAssignments) {
      setError("Missing permission: security.role_assignment.upsert");
      return;
    }
    const confirmed = window.confirm("Delete this role assignment?");
    if (!confirmed) {
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    try {
      await deleteRoleAssignment(assignmentId);
      setMessage("Assignment deleted.");
      await loadData();
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to delete assignment");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">
          User Assignment Management
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Assign roles to users with scoped access.
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

      <form
        onSubmit={handleCreate}
        className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-5"
      >
        <select
          value={form.userId}
          onChange={(event) =>
            setForm((prev) => ({ ...prev, userId: event.target.value }))
          }
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          required
        >
          <option value="">Select user</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name} ({user.email})
            </option>
          ))}
        </select>

        <select
          value={form.roleId}
          onChange={(event) =>
            setForm((prev) => ({ ...prev, roleId: event.target.value }))
          }
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          required
        >
          <option value="">Select role</option>
          {roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.code}
            </option>
          ))}
        </select>

        <select
          value={form.scopeType}
          onChange={(event) =>
            setForm((prev) => ({ ...prev, scopeType: event.target.value }))
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
          value={form.scopeId}
          onChange={(event) =>
            setForm((prev) => ({ ...prev, scopeId: event.target.value }))
          }
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="Scope ID"
          required
        />

        <div className="flex gap-2">
          <select
            value={form.effect}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, effect: event.target.value }))
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
            disabled={saving || !canUpsertAssignments}
            className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {saving ? "Saving..." : "Assign"}
          </button>
        </div>
      </form>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">
          Current Role Assignments
        </div>
        {loading ? (
          <p className="px-4 py-3 text-sm text-slate-500">Loading assignments...</p>
        ) : assignments.length === 0 ? (
          <p className="px-4 py-3 text-sm text-slate-500">No assignments found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-4 py-2">User</th>
                  <th className="px-4 py-2">Role</th>
                  <th className="px-4 py-2">Scope</th>
                  <th className="px-4 py-2">Effect</th>
                  <th className="px-4 py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {assignments.map((assignment) => (
                  <tr key={assignment.id} className="border-t border-slate-100">
                    <td className="px-4 py-2">
                      <div className="font-medium text-slate-800">
                        {assignment.user_name}
                      </div>
                      <div className="text-xs text-slate-500">{assignment.user_email}</div>
                    </td>
                    <td className="px-4 py-2">
                      <div className="font-medium text-slate-800">
                        {assignment.role_code}
                      </div>
                      <div className="text-xs text-slate-500">{assignment.role_name}</div>
                    </td>
                    <td className="px-4 py-2">
                      {assignment.scope_type} #{assignment.scope_id}
                    </td>
                    <td className="px-4 py-2">{assignment.effect}</td>
                    <td className="px-4 py-2">
                      <button
                        type="button"
                        disabled={saving || !canUpsertAssignments}
                        onClick={() => handleDelete(assignment.id)}
                        className="rounded-lg border border-rose-200 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
