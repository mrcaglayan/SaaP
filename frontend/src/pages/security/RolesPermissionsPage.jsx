import { Search, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createOrUpdateRole, listRoles } from "../../api/rbacAdmin.js";
import { useAuth } from "../../auth/useAuth.js";
import { useI18n } from "../../i18n/useI18n.js";
import RoleListTable from "./RoleListTable.jsx";
import { buildRoleDetailPath } from "./rolesPermissions.helpers.js";
import { getRoleCatalogEntry, groupRolesForManagement } from "./roleCatalog.js";

const FILTER_ALL = "ALL";
const FILTER_PACKAGE_BACKED = "PACKAGE_BACKED";
const ROLE_MEANING_FILTERS = Object.freeze([
  Object.freeze({
    key: FILTER_ALL,
    label: "All role list entries",
    description:
      "Browse the full role list, then narrow it to the runtime authority model you need.",
  }),
  Object.freeze({
    key: FILTER_PACKAGE_BACKED,
    label: "Package-backed roles",
    description:
      "Package-backed runtime roles aligned to workflow-package definitions.",
  }),
]);

function normalizeText(value) {
  return String(value || "").trim();
}

function getRoleMeaningKey(entry) {
  if (entry?.managedPackageRole) {
    return FILTER_PACKAGE_BACKED;
  }
  return "OTHER_RUNTIME";
}

function matchesRoleMeaningFilter(entry, filterKey) {
  return filterKey === FILTER_ALL || getRoleMeaningKey(entry) === filterKey;
}

function buildRoleSearchText(role, entry) {
  return [
    role?.code,
    role?.name,
    ...(role?.permissionCodes || []),
    entry?.code,
    entry?.displayName,
    entry?.description,
    entry?.categoryLabel,
    entry?.workflowFamilyLabel,
    entry?.technicalCode,
    entry?.replacementLabel,
    ...(entry?.capabilities || []),
    ...(entry?.recommendedScopes || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function RoleMeaningFilterRail({ counts, selectedFilter, onSelect }) {
  const activeFilter =
    ROLE_MEANING_FILTERS.find((item) => item.key === selectedFilter) ||
    ROLE_MEANING_FILTERS[0];
  return (
    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
      <div className="flex flex-wrap gap-2">
        {ROLE_MEANING_FILTERS.map((filter) => {
          const active = selectedFilter === filter.key;
          return (
            <button
              key={filter.key}
              type="button"
              onClick={() => onSelect(filter.key)}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium transition ${active
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
            >
              {filter.label} ({counts[filter.key] || 0})
            </button>
          );
        })}
      </div>
      <div className="text-sm leading-6 text-slate-500">{activeFilter.description}</div>
    </div>
  );
}

function PageMetric({ label, value }) {
  return (
    <div className="border-r border-slate-200 px-4 py-3 last:border-r-0">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold text-slate-950">{value}</div>
    </div>
  );
}

/**
 * Lists roles in a plain ERP-style catalog view so the sidebar remains the
 * primary navigation and each role opens into a separate permission page.
 */
export default function RolesPermissionsPage() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const { l, t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [roles, setRoles] = useState([]);
  const [roleForm, setRoleForm] = useState({ code: "", name: "" });
  const [roleSearchValue, setRoleSearchValue] = useState("");
  const [roleMeaningFilter, setRoleMeaningFilter] = useState(FILTER_ALL);
  const [showCreateRoleForm, setShowCreateRoleForm] = useState(false);

  async function loadRolesData() {
    setLoading(true);
    setError("");
    try {
      const rolesRes = await listRoles({ includePermissions: true });
      setRoles(rolesRes?.rows || []);
    } catch (err) {
      setError(err?.response?.data?.message || t("rolesPermissions.errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRolesData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groupedRoles = useMemo(() => groupRolesForManagement(roles), [roles]);
  const filteredRoleGroups = useMemo(() => {
    const normalizedQuery = normalizeText(roleSearchValue).toLowerCase();
    return groupedRoles
      .map((group) => ({
        ...group,
        roles: group.roles.filter((role) => {
          const roleEntry = getRoleCatalogEntry(role);
          const matchesMeaning = matchesRoleMeaningFilter(roleEntry, roleMeaningFilter);
          const matchesQuery =
            !normalizedQuery || buildRoleSearchText(role, roleEntry).includes(normalizedQuery);
          return matchesMeaning && matchesQuery;
        }),
      }))
      .filter((group) => group.roles.length > 0);
  }, [groupedRoles, roleMeaningFilter, roleSearchValue]);
  const roleMeaningCounts = useMemo(() => {
    const counts = {
      [FILTER_ALL]: roles.length,
      [FILTER_PACKAGE_BACKED]: 0,
    };
    roles.forEach((role) => {
      const roleEntry = getRoleCatalogEntry(role);
      if (getRoleMeaningKey(roleEntry) === FILTER_PACKAGE_BACKED) {
        counts[FILTER_PACKAGE_BACKED] += 1;
      }
    });
    return counts;
  }, [roles]);

  const canUpsertRole = hasPermission("security.role.upsert");
  const filteredRoleCount = filteredRoleGroups.reduce(
    (total, group) => total + group.roles.length,
    0
  );
  const packageBackedRoleCount = roleMeaningCounts[FILTER_PACKAGE_BACKED];

  async function handleCreateRole(event) {
    event.preventDefault();
    if (!canUpsertRole) {
      setError(t("rolesPermissions.errors.missingUpsertPermission"));
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await createOrUpdateRole({
        code: roleForm.code.trim(),
        name: roleForm.name.trim(),
      });
      setRoleForm({ code: "", name: "" });
      setShowCreateRoleForm(false);
      setMessage(t("rolesPermissions.messages.roleSaved"));
      await loadRolesData();
    } catch (err) {
      setError(err?.response?.data?.message || t("rolesPermissions.errors.saveRoleFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-md border border-slate-300 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-200 px-4 py-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h1 className="mt-1 text-2xl font-semibold text-slate-950">
              {l("Roles & permissions", "Roller ve yetkiler")}
            </h1>
          </div>
          {canUpsertRole ? (
            <button
              type="button"
              onClick={() => setShowCreateRoleForm((prev) => !prev)}
              className="inline-flex items-center gap-2 rounded-md border border-slate-900 bg-slate-900 px-3 py-2 text-sm font-medium text-white"
            >
              <Plus className="h-4 w-4" />
              {showCreateRoleForm
                ? l("Close role form", "Rol formunu kapat")
                : l("Create role", "Rol olustur")}
            </button>
          ) : null}
        </div>

        <div className="grid gap-0 md:grid-cols-3">
          <PageMetric label={l("Managed roles", "Yonetilen roller")} value={roles.length} />
          <PageMetric
            label={l("Package-backed roles", "Paket destekli roller")}
            value={packageBackedRoleCount}
          />
          <PageMetric
            label={l("Visible results", "Gorunen sonuclar")}
            value={filteredRoleCount}
          />
        </div>

        {showCreateRoleForm ? (
          <div className="border-t border-slate-200 px-4 py-4">
            <form
              onSubmit={handleCreateRole}
              className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)_auto]"
            >
              <input
                value={roleForm.code}
                onChange={(event) =>
                  setRoleForm((prev) => ({ ...prev, code: event.target.value }))
                }
                className="rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm"
                placeholder={t("rolesPermissions.placeholders.roleCode")}
                required
              />
              <input
                value={roleForm.name}
                onChange={(event) =>
                  setRoleForm((prev) => ({ ...prev, name: event.target.value }))
                }
                className="rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm"
                placeholder={t("rolesPermissions.placeholders.roleName")}
                required
              />
              <button
                type="submit"
                disabled={saving || !canUpsertRole}
                className="rounded-md bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
              >
                {saving
                  ? t("rolesPermissions.actions.saving")
                  : t("rolesPermissions.actions.saveRole")}
              </button>
            </form>
          </div>
        ) : null}
      </section>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {message}
        </div>
      ) : null}

      <section className="rounded-md border border-slate-300 bg-white shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="px-4 py-4">
            <h2 className="mt-1 text-lg font-semibold text-slate-950">
              {l("Role list", "Rol listesi")}
            </h2>
          </div>
          <div className="m-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
            {filteredRoleCount} visible roles
          </div>
        </div>

        <div className="border-y border-slate-200 px-4 py-3">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <div className="relative xl:w-105">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={roleSearchValue}
                  onChange={(event) => setRoleSearchValue(event.target.value)}
                  placeholder={l(
                    "Search role, permission code, workflow family, or scope",
                    "Rol, yetki kodu, workflow ailesi veya kapsam ara"
                  )}
                  className="w-full rounded-md border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900"
                />
              </div>
              <RoleMeaningFilterRail
                counts={roleMeaningCounts}
                selectedFilter={roleMeaningFilter}
                onSelect={setRoleMeaningFilter}
              />
            </div>
          </div>
        </div>

        {loading ? (
          <div className="px-4 py-6 text-sm text-slate-500">
            {t("rolesPermissions.sections.loadingRoles")}
          </div>
        ) : null}

        {!loading && filteredRoleGroups.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-slate-500">
            {l(
              "No roles match the current role list filters.",
              "Mevcut rol listesi filtreleriyle eslesen rol yok."
            )}
          </div>
        ) : null}

        {!loading && filteredRoleGroups.length > 0 ? (
          <div className="overflow-x-auto px-4 py-4">
            <div className="min-w-280 max-h-190 space-y-5 overflow-auto pr-1">
              {filteredRoleGroups.map((group) => (
                <RoleListTable
                  key={group.key}
                  group={group}
                  l={l}
                  onOpenRole={(roleId) => navigate(buildRoleDetailPath(roleId))}
                />
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
