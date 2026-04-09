import { useEffect, useMemo, useState } from "react";
import {
  createOrUpdateRole,
  listPermissions,
  listRoles,
  replaceRolePermissions,
} from "../../api/rbacAdmin.js";
import { useAuth } from "../../auth/useAuth.js";
import { useI18n } from "../../i18n/useI18n.js";
import RoleSummaryCard from "./RoleSummaryCard.jsx";
import SecurityAdminWorkspaceShell from "./SecurityAdminWorkspaceShell.jsx";
import SecurityWarningList from "./SecurityWarningList.jsx";
import { getRoleCatalogEntry, groupRolesForManagement } from "./roleCatalog.js";

/**
 * Lets security admins review composable-role intent, permission sets, and
 * permission-rule warnings from one place.
 */
export default function RolesPermissionsPage() {
  const { hasPermission, securityAdminUiState, securityAdminUiStateLoaded } = useAuth();
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [validationWarnings, setValidationWarnings] = useState([]);
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [selectedRoleId, setSelectedRoleId] = useState(null);
  const [selectedPermissionCodes, setSelectedPermissionCodes] = useState([]);
  const [roleForm, setRoleForm] = useState({ code: "", name: "" });

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const [rolesRes, permissionsRes] = await Promise.all([
        listRoles({ includePermissions: true }),
        listPermissions(),
      ]);
      const roleRows = rolesRes?.rows || [];
      setRoles(roleRows);
      setPermissions(permissionsRes?.rows || []);

      const selected = selectedRoleId
        ? roleRows.find((row) => Number(row.id) === Number(selectedRoleId))
        : roleRows[0];

      if (selected) {
        setSelectedRoleId(selected.id);
        setSelectedPermissionCodes(selected.permissionCodes || []);
      } else {
        setSelectedRoleId(null);
        setSelectedPermissionCodes([]);
      }
    } catch (err) {
      setError(err?.response?.data?.message || t("rolesPermissions.errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedRole = useMemo(
    () => roles.find((row) => Number(row.id) === Number(selectedRoleId)) || null,
    [roles, selectedRoleId]
  );
  const selectedRoleEntry = useMemo(
    () => (selectedRole ? getRoleCatalogEntry(selectedRole) : null),
    [selectedRole]
  );
  const groupedRoles = useMemo(() => groupRolesForManagement(roles), [roles]);
  const canUpsertRole = hasPermission("security.role.upsert");
  const canReplaceRolePermissions = hasPermission(
    "security.role_permissions.assign"
  );
  const selectedRoleLocksPermissions = Boolean(selectedRoleEntry?.businessLabelOnly);
  const showFreshTenantAdminNote =
    securityAdminUiStateLoaded &&
    Boolean(securityAdminUiState?.roleMigrations?.simplifiedFreshTenantView);

  function togglePermission(permissionCode) {
    setSelectedPermissionCodes((prev) => {
      if (prev.includes(permissionCode)) {
        return prev.filter((code) => code !== permissionCode);
      }
      return [...prev, permissionCode];
    });
  }

  async function handleCreateRole(event) {
    event.preventDefault();
    if (!canUpsertRole) {
      setError(t("rolesPermissions.errors.missingUpsertPermission"));
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    setValidationWarnings([]);
    try {
      await createOrUpdateRole({
        code: roleForm.code.trim(),
        name: roleForm.name.trim(),
      });
      setRoleForm({ code: "", name: "" });
      setMessage(t("rolesPermissions.messages.roleSaved"));
      await loadData();
    } catch (err) {
      setError(err?.response?.data?.message || t("rolesPermissions.errors.saveRoleFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function handleReplacePermissions() {
    if (!selectedRoleId) {
      return;
    }
    if (selectedRoleLocksPermissions) {
      setError(
        "Business role label roles stay non-authoritative and cannot receive permissions."
      );
      return;
    }
    if (!canReplaceRolePermissions) {
      setError(t("rolesPermissions.errors.missingAssignPermission"));
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    setValidationWarnings([]);
    try {
      const response = await replaceRolePermissions(selectedRoleId, selectedPermissionCodes);
      setValidationWarnings(response?.validationWarnings || []);
      setMessage(t("rolesPermissions.messages.permissionsReplaced"));
      await loadData();
    } catch (err) {
      setError(
        err?.response?.data?.message || t("rolesPermissions.errors.replacePermissionsFailed")
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <SecurityAdminWorkspaceShell
      sectionKey="roles-permissions"
      eyebrow="Security / Roles & permissions"
      title={t("rolesPermissions.title")}
      description={t("rolesPermissions.subtitle")}
      stats={[
        {
          title: "Managed roles",
          value: roles.length,
          description: "Runtime roles available in the current editor surface.",
          tone: "blue",
        },
        {
          title: "Permission catalog",
          value: permissions.length,
          description: "Permission codes that can be reviewed or assigned here.",
        },
        {
          title: "Selected role",
          value: selectedRoleEntry?.code || "No role selected",
          description: selectedRoleLocksPermissions
            ? "This selection is label-only and cannot receive direct permissions."
            : "Use the detail panel below to review meaning before replacing permissions.",
          tone: selectedRoleLocksPermissions ? "amber" : "green",
        },
        {
          title: "Staged selection",
          value: selectedPermissionCodes.length,
          description: "Permission rows currently checked for the active role.",
        },
      ]}
    >
      {showFreshTenantAdminNote ? (
        <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
          This tenant has no legacy runtime role assignments, so migration-only admin surfaces stay
          out of the normal navigation. Use the composable role catalog as the steady-state model.
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

      <form
        onSubmit={handleCreateRole}
        className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-4"
      >
        <div className="md:col-span-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
          Prefer bounded composable roles for new assignments. Legacy runtime roles now stay
          outside the normal admin catalog and survive only through migration or rollback seams,
          while companion roles like
          <span className="font-semibold text-slate-900"> GLPostingAuthority </span>
          should be paired with a read-bearing accounting role.
        </div>
        <input
          value={roleForm.code}
          onChange={(event) =>
            setRoleForm((prev) => ({ ...prev, code: event.target.value }))
          }
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder={t("rolesPermissions.placeholders.roleCode")}
          required
        />
        <input
          value={roleForm.name}
          onChange={(event) =>
            setRoleForm((prev) => ({ ...prev, name: event.target.value }))
          }
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
          placeholder={t("rolesPermissions.placeholders.roleName")}
          required
        />
        <button
          type="submit"
          disabled={saving || !canUpsertRole}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {saving ? t("rolesPermissions.actions.saving") : t("rolesPermissions.actions.saveRole")}
        </button>
      </form>

      <div className="grid gap-4 md:grid-cols-[300px_1fr]">
        <section className="rounded-xl border border-slate-200 bg-white p-3">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">
            {t("rolesPermissions.sections.roles")}
          </h2>
          {loading ? (
            <p className="text-sm text-slate-500">{t("rolesPermissions.sections.loadingRoles")}</p>
          ) : (
            <div className="space-y-4">
              {groupedRoles.map((group) => (
                <div key={group.key}>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {group.label}
                  </div>
                  <div className="space-y-1">
                    {group.roles.map((role) => {
                      const roleEntry = getRoleCatalogEntry(role);
                      const runtimeRoleCode = String(role?.code || "").trim();
                      const runtimeRoleName = String(role?.name || "").trim();
                      const secondaryText = roleEntry.technicalCode
                        ? `Runtime code: ${roleEntry.technicalCode}`
                        : runtimeRoleName &&
                            runtimeRoleName !== roleEntry.code &&
                            runtimeRoleName !== runtimeRoleCode
                          ? runtimeRoleName
                          : "";
                      return (
                      <button
                        key={role.id}
                        type="button"
                        onClick={() => {
                          setSelectedRoleId(role.id);
                          setSelectedPermissionCodes(role.permissionCodes || []);
                          setValidationWarnings([]);
                        }}
                        className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                          Number(role.id) === Number(selectedRoleId)
                            ? "border-slate-900 bg-slate-900 text-white"
                            : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-semibold">{roleEntry.code}</div>
                          {roleEntry.legacy ? (
                            <span className="rounded-full border border-current/20 px-2 py-0.5 text-[11px] font-semibold">
                              Legacy
                            </span>
                          ) : null}
                          {role.legacyDisabled ? (
                            <span className="rounded-full border border-current/20 px-2 py-0.5 text-[11px] font-semibold">
                              Hidden
                            </span>
                          ) : null}
                        </div>
                        {secondaryText ? (
                          <div className="text-xs opacity-80">{secondaryText}</div>
                        ) : null}
                      </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-700">
                {selectedRole
                  ? t("rolesPermissions.sections.permissionsFor", {
                      code: selectedRoleEntry?.code || selectedRole.code,
                    })
                  : t("rolesPermissions.sections.permissions")}
              </h2>
              {selectedRoleLocksPermissions ? (
                <p className="mt-1 text-xs leading-5 text-amber-700">
                  Business role label roles are locked to zero permissions. Assign workflow
                  packages or runtime roles separately from the user-assignment workbench.
                </p>
              ) : null}
            </div>
            <button
              type="button"
              disabled={
                !selectedRoleId ||
                saving ||
                !canReplaceRolePermissions ||
                selectedRoleLocksPermissions
              }
              onClick={handleReplacePermissions}
              className="rounded-lg bg-cyan-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
            >
              {saving
                ? t("rolesPermissions.actions.saving")
                : t("rolesPermissions.actions.replacePermissions")}
            </button>
          </div>
          {selectedRole ? (
            <div className="mb-3 space-y-3">
              <RoleSummaryCard role={selectedRole} />
              <SecurityWarningList
                title="Permission rule warnings"
                warnings={validationWarnings}
              />
            </div>
          ) : null}
          {loading ? (
            <p className="text-sm text-slate-500">
              {t("rolesPermissions.sections.loadingPermissions")}
            </p>
          ) : (
            <div className="grid gap-2 md:grid-cols-2">
              {permissions.map((permission) => {
                const checked = selectedPermissionCodes.includes(permission.code);
                return (
                  <label
                    key={permission.id}
                    className="flex items-start gap-2 rounded-lg border border-slate-200 p-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => togglePermission(permission.code)}
                      disabled={
                        !selectedRoleId ||
                        !canReplaceRolePermissions ||
                        selectedRoleLocksPermissions
                      }
                      className="mt-0.5"
                    />
                    <span>
                      <span className="font-medium text-slate-800">
                        {permission.code}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {permission.description}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </SecurityAdminWorkspaceShell>
  );
}
