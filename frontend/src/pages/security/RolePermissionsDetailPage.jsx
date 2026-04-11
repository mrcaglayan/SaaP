import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  listPermissions,
  listRoles,
  replaceRolePermissions,
} from "../../api/rbacAdmin.js";
import { useAuth } from "../../auth/useAuth.js";
import { useI18n } from "../../i18n/useI18n.js";
import SecurityWarningList from "./SecurityWarningList.jsx";
import RolePermissionsTab from "./RolePermissionsTab.jsx";
import {
  buildPermissionModuleGroups,
  ROLE_LIST_PATH,
} from "./rolesPermissions.helpers.js";
import { getRoleCatalogEntry } from "./roleCatalog.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function formatScopeLabel(scopeType) {
  return normalizeText(scopeType)
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildRoleMetadataLine(role, entry) {
  return [
    normalizeText(role?.code || entry?.technicalCode || entry?.code),
    normalizeText(entry?.workflowFamilyLabel),
    formatScopeLabel(entry?.defaultScope || entry?.recommendedScopes?.[0]) ||
      normalizeText(entry?.categoryLabel),
  ]
    .filter(Boolean)
    .join(" / ");
}

function countPermissionDifferences(savedCodes, stagedCodes) {
  const savedSet = new Set(Array.isArray(savedCodes) ? savedCodes : []);
  const stagedSet = new Set(Array.isArray(stagedCodes) ? stagedCodes : []);
  let differenceCount = 0;

  savedSet.forEach((code) => {
    if (!stagedSet.has(code)) {
      differenceCount += 1;
    }
  });
  stagedSet.forEach((code) => {
    if (!savedSet.has(code)) {
      differenceCount += 1;
    }
  });

  return differenceCount;
}

function DetailMetric({ label, value }) {
  return (
    <div className="min-w-[110px] border-r border-slate-200 px-3 py-2 last:border-r-0">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-slate-950">{value}</div>
    </div>
  );
}

/**
 * Loads one role by URL and keeps the page focused on a single task: reviewing
 * and replacing that role's saved permission set.
 */
export default function RolePermissionsDetailPage() {
  const { roleId } = useParams();
  const { hasPermission } = useAuth();
  const { l, t } = useI18n();
  const canReplaceRolePermissions = hasPermission("security.role_permissions.assign");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [validationWarnings, setValidationWarnings] = useState([]);
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [selectedPermissionCodes, setSelectedPermissionCodes] = useState([]);

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const [rolesRes, permissionsRes] = await Promise.all([
        listRoles({ includePermissions: true }),
        listPermissions(),
      ]);
      setRoles(rolesRes?.rows || []);
      setPermissions(permissionsRes?.rows || []);
    } catch (err) {
      setError(err?.response?.data?.message || t("rolesPermissions.errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleId]);

  useEffect(() => {
    setSelectedPermissionCodes([]);
    setValidationWarnings([]);
    setMessage("");
  }, [roleId]);

  const selectedRole = useMemo(
    () => roles.find((row) => Number(row.id) === Number(roleId)) || null,
    [roleId, roles]
  );
  const selectedRoleEntry = useMemo(
    () => (selectedRole ? getRoleCatalogEntry(selectedRole) : null),
    [selectedRole]
  );

  useEffect(() => {
    if (!selectedRole) {
      return;
    }
    // Keep staged checkbox state tied to the currently opened role so edits
    // never leak across route changes.
    setSelectedPermissionCodes(selectedRole.permissionCodes || []);
  }, [selectedRole]);

  const selectedRoleLocksPermissions = Boolean(selectedRoleEntry?.businessLabelOnly);
  const selectedRoleHeading =
    normalizeText(selectedRoleEntry?.displayName) ||
    normalizeText(selectedRole?.name) ||
    normalizeText(selectedRole?.code) ||
    l("Role detail", "Rol detayi");
  const selectedRoleMetadataLine = buildRoleMetadataLine(selectedRole, selectedRoleEntry);
  const permissionModuleGroups = useMemo(
    () => buildPermissionModuleGroups(permissions, selectedPermissionCodes),
    [permissions, selectedPermissionCodes]
  );
  const savedPermissionCount = Array.isArray(selectedRole?.permissionCodes)
    ? selectedRole.permissionCodes.length
    : 0;
  const stagedChangeCount = useMemo(
    () => countPermissionDifferences(selectedRole?.permissionCodes, selectedPermissionCodes),
    [selectedPermissionCodes, selectedRole]
  );

  function togglePermission(permissionCode) {
    setSelectedPermissionCodes((prev) => {
      if (prev.includes(permissionCode)) {
        return prev.filter((code) => code !== permissionCode);
      }
      return [...prev, permissionCode];
    });
  }

  function handleResetPermissions() {
    setSelectedPermissionCodes(selectedRole?.permissionCodes || []);
    setError("");
  }

  async function handleReplacePermissions() {
    if (!selectedRole?.id) {
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
      const response = await replaceRolePermissions(selectedRole.id, selectedPermissionCodes);
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
    <div className="space-y-4">
      {error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {message}
        </div>
      ) : null}

      {loading ? (
        <section className="rounded-md border border-slate-300 bg-white px-4 py-12 text-center text-sm text-slate-500 shadow-sm">
          {l("Loading role detail...", "Rol detayi yukleniyor...")}
        </section>
      ) : null}

      {!loading && selectedRole && selectedRoleEntry ? (
        <>
          <section className="rounded-md border border-slate-300 bg-white shadow-sm">
            <div className="flex flex-col gap-4 border-b border-slate-200 px-4 py-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="min-w-0">
                <Link
                  to={ROLE_LIST_PATH}
                  className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  {l("Back to role list", "Rol listesine don")}
                </Link>
                <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  {l("Role detail", "Rol detayi")}
                </div>
                <h1 className="mt-2 text-2xl font-semibold text-slate-950">
                  {selectedRoleHeading}
                </h1>
                <div className="mt-1 text-sm text-slate-500">
                  {selectedRoleMetadataLine}
                </div>
              </div>
              <div className="grid gap-0 border border-slate-200 md:grid-cols-3">
                <DetailMetric
                  label={l("Permissions", "Yetkiler")}
                  value={selectedRoleLocksPermissions ? l("Locked", "Kilitli") : savedPermissionCount}
                />
                <DetailMetric
                  label={l("Warnings", "Uyarilar")}
                  value={validationWarnings.length}
                />
                <DetailMetric
                  label={l("Staged", "Bekleyen")}
                  value={selectedRoleLocksPermissions ? 0 : stagedChangeCount}
                />
              </div>
            </div>
          </section>

          {validationWarnings.length > 0 ? (
            <SecurityWarningList
              title={l("Review before saving", "Kaydetmeden once inceleyin")}
              warnings={validationWarnings}
              className="rounded-md shadow-sm"
            />
          ) : null}

          <RolePermissionsTab
            canReplaceRolePermissions={canReplaceRolePermissions}
            groups={permissionModuleGroups}
            l={l}
            loading={loading}
            onResetPermissions={handleResetPermissions}
            onReplacePermissions={handleReplacePermissions}
            onTogglePermission={togglePermission}
            savedPermissionCount={savedPermissionCount}
            saving={saving}
            stagedChangeCount={stagedChangeCount}
            selectedRole={selectedRole}
            selectedRoleLocksPermissions={selectedRoleLocksPermissions}
          />
        </>
      ) : null}

      {!loading && (!selectedRole || !selectedRoleEntry) ? (
        <section className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-6 py-16 text-center text-sm text-slate-500 shadow-sm">
          <div>
            {l(
              "The requested role could not be found in the current role list.",
              "Istenen rol mevcut rol listesinde bulunamadi."
            )}
          </div>
          <div className="mt-2">
            {l("Requested role id", "Istenen rol id")}: {normalizeText(roleId) || "-"}
          </div>
          <div className="mt-5">
            <Link
              to={ROLE_LIST_PATH}
              className="inline-flex rounded-md border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700"
            >
              {l("Back to role list", "Rol listesine don")}
            </Link>
          </div>
        </section>
      ) : null}
    </div>
  );
}
