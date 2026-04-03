import { useEffect, useMemo, useState } from "react";
import {
  listCountries,
  listGroupCompanies,
  listLegalEntities,
  listOperatingUnits,
  createSecurityInvite,
  createRoleAssignment,
  deleteRoleAssignment,
  listRoleAssignments,
  listRoles,
  listUsers,
} from "../../api/rbacAdmin.js";
import PermissionAccessNotice from "../../auth/PermissionAccessNotice.jsx";
import { useAuth } from "../../auth/useAuth.js";
import { useI18n } from "../../i18n/useI18n.js";
import RoleSummaryCard from "./RoleSummaryCard.jsx";
import SecurityWarningList from "./SecurityWarningList.jsx";
import {
  buildScopeLabel,
  groupRolesForManagement,
} from "./roleCatalog.js";

const SCOPE_TYPES = ["TENANT", "GROUP", "COUNTRY", "LEGAL_ENTITY", "OPERATING_UNIT"];
const EFFECTS = ["ALLOW", "DENY"];

/**
 * Assigns composable roles to users while exposing the role meaning, scope fit,
 * and combined-role warnings before the admin saves the assignment.
 */
export default function UserAssignmentsPage() {
  const {
    getPermissionAccess,
    hasPermission,
    user,
    securityAdminUiState,
    securityAdminUiStateLoaded,
  } = useAuth();
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [groups, setGroups] = useState([]);
  const [countries, setCountries] = useState([]);
  const [legalEntities, setLegalEntities] = useState([]);
  const [operatingUnits, setOperatingUnits] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [assignmentWarnings, setAssignmentWarnings] = useState([]);
  const [userForm, setUserForm] = useState({
    name: "",
    email: "",
  });
  const [inviteLink, setInviteLink] = useState("");
  const [form, setForm] = useState({
    userId: "",
    roleId: "",
    scopeType: "TENANT",
    scopeId: "",
    effect: "ALLOW",
  });
  const tenantScopeId = Number(user?.tenant_id || 0);
  const inviteAccess = getPermissionAccess("security.role_assignment.upsert");
  const canInviteUsers = inviteAccess.allowed;
  const selectedScopeId =
    form.scopeType === "TENANT" ? tenantScopeId : Number(form.scopeId || 0);
  const assignmentWriteAccess = getPermissionAccess(
    "security.role_assignment.upsert",
    selectedScopeId
      ? {
          scope: {
            scopeType: form.scopeType,
            scopeId: selectedScopeId,
          },
        }
      : undefined
  );
  const canUpsertAssignments = assignmentWriteAccess.allowed;
  const canReadOrgTree = hasPermission("org.tree.read");
  const lookups = useMemo(
    () => ({
      groups,
      countries,
      legalEntities,
      operatingUnits,
    }),
    [countries, groups, legalEntities, operatingUnits]
  );
  const roleGroups = useMemo(() => groupRolesForManagement(roles), [roles]);
  const showFreshTenantAdminNote =
    securityAdminUiStateLoaded &&
    Boolean(securityAdminUiState?.roleMigrations?.simplifiedFreshTenantView);
  const selectedRole = useMemo(
    () => roles.find((role) => Number(role.id) === Number(form.roleId)) || null,
    [form.roleId, roles]
  );
  const selectedAssignmentUser = useMemo(
    () => users.find((row) => Number(row.id) === Number(form.userId)) || null,
    [form.userId, users]
  );
  const selectedUserAssignments = useMemo(
    () =>
      assignments.filter(
        (assignment) => Number(assignment.user_id) === Number(form.userId || 0)
      ),
    [assignments, form.userId]
  );

  const scopeOptions = useMemo(() => {
    if (form.scopeType === "TENANT") {
      return tenantScopeId
        ? [{ id: tenantScopeId, label: `Tenant #${tenantScopeId}` }]
        : [];
    }
    if (form.scopeType === "GROUP") {
      return groups.map((row) => ({
        id: Number(row.id),
        label: `${row.code} - ${row.name}`,
      }));
    }
    if (form.scopeType === "COUNTRY") {
      return countries.map((row) => ({
        id: Number(row.id),
        label: `${row.iso2} - ${row.name}`,
      }));
    }
    if (form.scopeType === "LEGAL_ENTITY") {
      return legalEntities.map((row) => ({
        id: Number(row.id),
        label: `${row.code} - ${row.name}`,
      }));
    }
    if (form.scopeType === "OPERATING_UNIT") {
      return operatingUnits.map((row) => ({
        id: Number(row.id),
        label: `${row.code} - ${row.name}`,
      }));
    }
    return [];
  }, [
    form.scopeType,
    tenantScopeId,
    groups,
    countries,
    legalEntities,
    operatingUnits,
  ]);

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const [
        usersRes,
        rolesRes,
        assignmentsRes,
        groupsRes,
        countriesRes,
        legalEntitiesRes,
        unitsRes,
      ] = await Promise.all([
        listUsers(),
        listRoles({ includePermissions: true }),
        listRoleAssignments(),
        canReadOrgTree ? listGroupCompanies() : Promise.resolve({ rows: [] }),
        canReadOrgTree ? listCountries() : Promise.resolve({ rows: [] }),
        canReadOrgTree ? listLegalEntities() : Promise.resolve({ rows: [] }),
        canReadOrgTree ? listOperatingUnits() : Promise.resolve({ rows: [] }),
      ]);
      setUsers(usersRes?.rows || []);
      setRoles(rolesRes?.rows || []);
      setAssignments(assignmentsRes?.rows || []);
      setGroups(groupsRes?.rows || []);
      setCountries(countriesRes?.rows || []);
      setLegalEntities(legalEntitiesRes?.rows || []);
      setOperatingUnits(unitsRes?.rows || []);
    } catch (err) {
      setError(err?.response?.data?.message || t("userAssignments.loadFailed"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setForm((prev) => {
      const currentScopeId = Number(prev.scopeId);
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

  async function handleCreateUser(event) {
    event.preventDefault();
    if (!canInviteUsers) {
      setError(t("userAssignments.missingPermission"));
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    setAssignmentWarnings([]);
    setInviteLink("");
    try {
      const response = await createSecurityInvite({
        name: userForm.name.trim(),
        email: userForm.email.trim(),
      });

      const createdUserId = Number(response?.invite?.userId || 0);
      if (createdUserId > 0) {
        setForm((prev) => ({ ...prev, userId: String(createdUserId) }));
      }
      setUserForm({
        name: "",
        email: "",
      });
      const createdInviteLink = String(response?.invite?.inviteUrl || "");
      setInviteLink(createdInviteLink);
      setMessage(t("userAssignments.userCreateSuccess"));
      await loadData();
    } catch (err) {
      setError(err?.response?.data?.message || t("userAssignments.userCreateFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function handleCreate(event) {
    event.preventDefault();
    if (!canUpsertAssignments) {
      setError(t("userAssignments.missingPermission"));
      return;
    }
    const scopeId = Number(form.scopeId);
    if (!Number.isInteger(scopeId) || scopeId <= 0) {
      setError(t("userAssignments.scopeInvalid"));
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    setAssignmentWarnings([]);
    try {
      const response = await createRoleAssignment({
        userId: Number(form.userId),
        roleId: Number(form.roleId),
        scopeType: form.scopeType,
        scopeId,
        effect: form.effect,
      });
      setAssignmentWarnings(response?.assignmentWarnings || []);
      setMessage(t("userAssignments.saveSuccess"));
      await loadData();
    } catch (err) {
      setError(err?.response?.data?.message || t("userAssignments.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(assignmentId) {
    if (!canUpsertAssignments) {
      setError(t("userAssignments.missingPermission"));
      return;
    }
    const confirmed = window.confirm(t("userAssignments.deleteConfirm"));
    if (!confirmed) {
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    setAssignmentWarnings([]);
    try {
      await deleteRoleAssignment(assignmentId);
      setMessage(t("userAssignments.deleteSuccess"));
      await loadData();
    } catch (err) {
      setError(err?.response?.data?.message || t("userAssignments.deleteFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">
          {t("userAssignments.title")}
        </h1>
        <p className="mt-1 text-sm text-slate-600">{t("userAssignments.subtitle")}</p>
      </div>

      {showFreshTenantAdminNote ? (
        <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
          Fresh-tenant mode is active for role admin. Retired legacy roles are already outside the
          normal assignment catalog, so assign only the bounded composable roles shown here.
        </div>
      ) : null}

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

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">
          {t("userAssignments.createUser.title")}
        </h2>
        <PermissionAccessNotice
          access={inviteAccess}
          permissionCode="security.role_assignment.upsert"
          className="mb-3"
        />
        <form onSubmit={handleCreateUser} className="grid gap-3 md:grid-cols-3">
          <input
            type="text"
            value={userForm.name}
            onChange={(event) =>
              setUserForm((prev) => ({ ...prev, name: event.target.value }))
            }
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder={t("userAssignments.createUser.name")}
            required
          />
          <input
            type="email"
            value={userForm.email}
            onChange={(event) =>
              setUserForm((prev) => ({ ...prev, email: event.target.value }))
            }
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder={t("userAssignments.createUser.email")}
            required
          />
          <button
            type="submit"
            disabled={saving || !canInviteUsers}
            className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {saving
              ? t("userAssignments.createUser.submitting")
              : t("userAssignments.createUser.submit")}
          </button>
        </form>
        {inviteLink ? (
          <div className="mt-3 grid gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3">
            <div className="text-xs font-semibold text-sky-800">
              {t("userAssignments.createUser.inviteLinkReady")}
            </div>
            <div className="break-all rounded-md border border-sky-200 bg-white px-2 py-1 text-xs text-slate-700">
              {inviteLink}
            </div>
            <button
              type="button"
              className="w-fit rounded-md border border-sky-300 px-3 py-1 text-xs font-semibold text-sky-800 hover:bg-sky-100"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(inviteLink);
                  setMessage(t("userAssignments.createUser.inviteCopied"));
                } catch {
                  setError(t("userAssignments.createUser.inviteCopyFailed"));
                }
              }}
            >
              {t("userAssignments.createUser.copyInviteLink")}
            </button>
          </div>
        ) : null}
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <form
          onSubmit={handleCreate}
          className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-5"
        >
          <div className="md:col-span-5">
            <PermissionAccessNotice
              access={assignmentWriteAccess}
              permissionCode="security.role_assignment.upsert"
            />
          </div>
          <div className="md:col-span-5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
            Assign composable roles at the smallest deliberate scope. Companion roles like
            <span className="font-semibold text-slate-900"> GLPostingAuthority </span>
            should travel with a read-bearing accounting role, not by themselves.
          </div>
          <select
            value={form.userId}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, userId: event.target.value }))
            }
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            required
          >
            <option value="">{t("userAssignments.placeholders.user")}</option>
            {users.map((userRow) => (
              <option key={userRow.id} value={userRow.id}>
                {userRow.name} ({userRow.email})
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
            <option value="">{t("userAssignments.placeholders.role")}</option>
            {roleGroups.map((group) => (
              <optgroup key={group.key} label={group.label}>
                {group.roles.map((role) => (
                  <option
                    key={role.id}
                    value={role.id}
                    disabled={role.legacyDisabled}
                  >
                    {role.code}
                    {role.legacyDisabled ? " (retired)" : ""}
                  </option>
                ))}
              </optgroup>
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
          >
            {SCOPE_TYPES.map((scopeType) => (
              <option key={scopeType} value={scopeType}>
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
              <option value="">{t("userAssignments.placeholders.scope")}</option>
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
              placeholder={t("userAssignments.placeholders.scopeId")}
              required
            />
          )}

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
              {saving
                ? t("userAssignments.actions.assigning")
                : t("userAssignments.actions.assign")}
            </button>
          </div>

          {selectedRole?.legacyDisabled ? (
            <div className="md:col-span-5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              This legacy role is retired for new assignments. Use the migration flow or assign the
              replacement composable roles instead.
            </div>
          ) : null}

          <div className="md:col-span-5">
            <SecurityWarningList
              title="Assignment warnings"
              warnings={assignmentWarnings}
            />
          </div>
        </form>

        <div className="space-y-4">
          {selectedRole ? (
            <RoleSummaryCard
              role={selectedRole}
              scopeType={form.scopeType}
              scopeId={selectedScopeId}
              lookups={lookups}
              tenantScopeId={tenantScopeId}
            />
          ) : (
            <section className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
              Select a role to review its capability summary, recommended scope, and companion-role
              guidance before saving.
            </section>
          )}

          {selectedAssignmentUser ? (
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-slate-800">
                Current access for {selectedAssignmentUser.name}
              </h2>
              <p className="mt-1 text-xs text-slate-500">{selectedAssignmentUser.email}</p>
              {selectedUserAssignments.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">
                  This user does not have any existing role assignments yet.
                </p>
              ) : (
                <div className="mt-3 space-y-3">
                  {selectedUserAssignments.map((assignment) => (
                    <RoleSummaryCard
                      key={assignment.id}
                      role={{
                        code: assignment.role_code,
                        name: assignment.role_name,
                      }}
                      scopeType={assignment.scope_type}
                      scopeId={assignment.scope_id}
                      lookups={lookups}
                      tenantScopeId={tenantScopeId}
                      className="bg-slate-50"
                    />
                  ))}
                </div>
              )}
            </section>
          ) : null}
        </div>
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">
          {t("userAssignments.list.title")}
        </div>
        {loading ? (
          <p className="px-4 py-3 text-sm text-slate-500">
            {t("userAssignments.list.loading")}
          </p>
        ) : assignments.length === 0 ? (
          <p className="px-4 py-3 text-sm text-slate-500">
            {t("userAssignments.list.empty")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-4 py-2">{t("userAssignments.list.user")}</th>
                  <th className="px-4 py-2">{t("userAssignments.list.role")}</th>
                  <th className="px-4 py-2">{t("userAssignments.list.scope")}</th>
                  <th className="px-4 py-2">{t("userAssignments.list.effect")}</th>
                  <th className="px-4 py-2">{t("userAssignments.list.action")}</th>
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
                      <div className="font-medium text-slate-800">
                        {buildScopeLabel(
                          assignment.scope_type,
                          assignment.scope_id,
                          lookups,
                          tenantScopeId
                        )}
                      </div>
                      <div className="text-xs text-slate-500">
                        {assignment.scope_type} #{assignment.scope_id}
                      </div>
                    </td>
                    <td className="px-4 py-2">{assignment.effect}</td>
                    <td className="px-4 py-2">
                      <button
                        type="button"
                        disabled={saving || !canUpsertAssignments}
                        onClick={() => handleDelete(assignment.id)}
                        className="rounded-lg border border-rose-200 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                      >
                        {t("userAssignments.actions.delete")}
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
