
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
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
const FILTER_ALL = "ALL";const ROLE_MEANING_FILTERS = Object.freeze([
  Object.freeze({
    key: FILTER_ALL,
    label: "All editor roles",
    description:
      "Browse the whole role editor surface, then narrow by meaning before touching permission rows.",
  }),
  Object.freeze({
    key: "COMPOSABLE_RUNTIME",
    label: "Composable runtime roles",
    description:
      "Direct-authority runtime roles, including package-backed and companion patterns that drive real permission authority.",
  }),
  Object.freeze({
    key: "LABEL_ONLY_BUSINESS",
    label: "Label-only business roles",
    description:
      "Business-facing labels stay visible here but remain non-authoritative and locked to zero permissions.",
  }),
  Object.freeze({
    key: "LEGACY_COMPATIBILITY",
    label: "Legacy compatibility roles",
    description:
      "Migration and rollback-facing runtime roles that should stay recognizable before anyone edits them.",
  }),
]);const ROLE_SCOPE_LEVEL_ORDER = Object.freeze([
  "TENANT",
  "GROUP",
  "COUNTRY",
  "LEGAL_ENTITY",
  "OPERATING_UNIT",
]);
+function normalizeText(value) {
  return String(value || "").trim();
}
function getRoleMeaningKey(entry) {
  if (entry?.legacy) {
    return "LEGACY_COMPATIBILITY";
  }
  if (entry?.businessLabelOnly) {
    return "LABEL_ONLY_BUSINESS";
  }
  return "COMPOSABLE_RUNTIME";
}
function matchesRoleMeaningFilter(entry, filterKey) {
  return filterKey === FILTER_ALL || getRoleMeaningKey(entry) === filterKey;
}function getRoleMeaningLabel(entry) {
  return (
    ROLE_MEANING_FILTERS.find((item) => item.key === getRoleMeaningKey(entry))?.label ||
    ROLE_MEANING_FILTERS[0].label
  );
}function getRoleTheme(entry) {
  if (entry?.legacy) {
    return {
      panel: "border-amber-200 bg-[linear-gradient(135deg,rgba(255,251,235,0.96),rgba(255,255,255,0.98))]",
      softPanel: "border-amber-200 bg-amber-50/70",
      chip: "border-amber-200 bg-amber-50 text-amber-900",
      metricTone: "text-amber-900",
    };
  }
  if (entry?.businessLabelOnly) {
    return {
      panel: "border-sky-200 bg-[linear-gradient(135deg,rgba(240,249,255,0.96),rgba(255,255,255,0.98))]",
      softPanel: "border-sky-200 bg-sky-50/70",
      chip: "border-sky-200 bg-sky-50 text-sky-800",
      metricTone: "text-sky-800",
    };
  }
  if (entry?.companionOnly) {
    return {
      panel: "border-violet-200 bg-[linear-gradient(135deg,rgba(245,243,255,0.96),rgba(255,255,255,0.98))]",
      softPanel: "border-violet-200 bg-violet-50/70",
      chip: "border-violet-200 bg-violet-50 text-violet-800",
      metricTone: "text-violet-800",
    };
  }
  if (entry?.category === "system") {
    return {
      panel: "border-rose-200 bg-[linear-gradient(135deg,rgba(255,241,242,0.96),rgba(255,255,255,0.98))]",
      softPanel: "border-rose-200 bg-rose-50/70",
      chip: "border-rose-200 bg-rose-50 text-rose-800",
      metricTone: "text-rose-800",
    };
  }
  return {
    panel: "border-slate-200 bg-white",
    softPanel: "border-slate-200 bg-slate-50/80",
    chip: "border-slate-200 bg-slate-50 text-slate-700",
    metricTone: "text-slate-900",
  };
}function getRoleAuthorityLabel(entry) {
  if (entry?.businessLabelOnly) {
    return "Label only";
  }
  if (entry?.legacy) {
    return "Legacy compatibility";
  }
  if (entry?.managedPackageRole) {
    return "Package-backed authority";
  }
  if (entry?.companionOnly) {
    return "Companion authority";
  }
  if (entry?.category === "system") {
    return "Broad administration";
  }
  return "Composable runtime";
}function buildRoleSearchText(role, entry) {
  return [
    role?.code,
    role?.name,
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
}function getRoleSecondaryText(role, entry, l) {
  const runtimeRoleCode = normalizeText(role?.code);
  const runtimeRoleName = normalizeText(role?.name);
  if (entry?.technicalCode) {
    return l(
      "Runtime code: {{code}}",
      "Runtime kodu: {{code}}",
      { code: entry.technicalCode }
    );
  }
  if (
    runtimeRoleName &&
    runtimeRoleName !== entry?.code &&
    runtimeRoleName !== runtimeRoleCode
  ) {
    return runtimeRoleName;
  }
  return "";
}function buildRoleAttentionItems(entry, role, l) {
  const items = [];
  if (entry?.legacy && entry?.replacementLabel) {
    items.push(
      l(
        "Legacy compatibility role. Prefer {{replacement}} for new assignments.",
        "Legacy uyumluluk rolu. Yeni atamalarda {{replacement}} tercih edilmelidir.",
        { replacement: entry.replacementLabel }
      )
    );
  }
  if (role?.legacyDisabled) {
    items.push(
      l(
        "Hidden for new assignments. Keep it only for migration, rollback, or historical review.",
        "Yeni atamalarda gizlidir. Yalnizca gecis, rollback veya tarihsel inceleme icin saklayin."
      )
    );
  }
  if (entry?.businessLabelOnly) {
    items.push(
      l(
        "Business role label only. It does not grant package or permission authority by itself.",
        "Yalnizca is rol etiketi. Tek basina paket veya yetki otoritesi vermez."
      )
    );
  }
  if (entry?.managedPackageRole) {
    items.push(
      l(
        "Managed through the workflow package UX so the runtime permission set stays aligned to the package definition.",
        "Runtime yetki seti paket tanimiyla uyumlu kalsin diye workflow package UX uzerinden yonetilir."
      )
    );
  }
  if (entry?.companionOnly && entry?.companionNote) {
    items.push(entry.companionNote);
  }
  if (entry?.category === "system") {
    items.push(
      l(
        "Broad administrative authority. Review least-privilege impact before replacing permissions.",
        "Genis yonetsel yetki. Yetkileri degistirmeden once en az yetki etkisini gozden gecirin."
      )
    );
  }
  return items;
}function getRecommendedScopeSet(entry) {
  return new Set(
    [
      ...(Array.isArray(entry?.recommendedScopes) ? entry.recommendedScopes : []),
      entry?.defaultScope,
    ]
      .map((value) => normalizeText(value).toUpperCase())
      .filter(Boolean)
  );
}function formatScopeLabel(scopeType) {
  return normalizeText(scopeType).replaceAll("_", " ");
}function getPermissionModuleKey(permissionCode) {
  const parts = normalizeText(permissionCode).split(".").filter(Boolean);
  if (parts.length <= 1) {
    return normalizeText(permissionCode);
  }
  return parts.slice(0, -1).join(".");
}function formatPermissionModuleLabel(moduleKey) {
  return normalizeText(moduleKey)
    .split(".")
    .filter(Boolean)
    .map((part) => part.replaceAll("_", " "))
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" / ");
}function formatPermissionActionLabel(permissionCode) {
  const action = normalizeText(permissionCode).split(".").filter(Boolean).pop() || "";
  return action ? action.replaceAll("_", " ").toUpperCase() : permissionCode;
}function buildPermissionModuleGroups(permissionRows, selectedPermissionCodes) {
  const selectedCodeSet = new Set(
    (Array.isArray(selectedPermissionCodes) ? selectedPermissionCodes : [])
      .map((value) => normalizeText(value))
      .filter(Boolean)
  );
  const byModule = new Map();
  (Array.isArray(permissionRows) ? permissionRows : []).forEach((permission) => {
    const code = normalizeText(permission?.code);
    if (!code) {
      return;
    }
    const moduleKey = getPermissionModuleKey(code);
    if (!byModule.has(moduleKey)) {
      byModule.set(moduleKey, []);
    }
    byModule.get(moduleKey).push({
      id: permission?.id || code,
      code,
      description: normalizeText(permission?.description),
      selected: selectedCodeSet.has(code),
    });
  });
  return Array.from(byModule.entries())
    .map(([moduleKey, permissions]) => {
      const codeSet = new Set(permissions.map((permission) => permission.code));
      return {
        moduleKey,
        moduleLabel: formatPermissionModuleLabel(moduleKey),
        selectedCount: permissions.filter((permission) => permission.selected).length,
        permissions: [...permissions]
          .sort((left, right) => left.code.localeCompare(right.code))
          .map((permission) => ({
            ...permission,
            actionLabel: formatPermissionActionLabel(permission.code),
            requiresRead:
              !permission.code.endsWith(".read") &&
              codeSet.has(`${moduleKey}.read`),
          })),
      };
    })
    .sort((left, right) => left.moduleLabel.localeCompare(right.moduleLabel));
}function RoleMetric({ label, value, note, valueTone = "text-slate-900" }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </div>
      <div className={`mt-2 text-lg font-semibold ${valueTone}`}>{value}</div>
      {note ? <div className="mt-1 text-xs leading-5 text-slate-500">{note}</div> : null}
    </div>
  );
}function RoleScopeCoveragePills({ entry, compact = false }) {
  const activeScopes = getRecommendedScopeSet(entry);
  return (
    <div className={`flex flex-wrap gap-2 ${compact ? "" : "mt-4"}`}>
      {ROLE_SCOPE_LEVEL_ORDER.map((scopeType) => {
        const active = activeScopes.has(scopeType);
        return (
          <span
            key={`${entry?.code || "role"}-${scopeType}`}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${
              active
                ? "border-slate-300 bg-slate-900 text-white"
                : "border-slate-200 bg-slate-50 text-slate-300"
            }`}
          >
            {formatScopeLabel(scopeType)}
          </span>
        );
      })}
    </div>
  );
}function RoleMeaningFilterRail({ counts, selectedFilter, onSelect }) {
  return (
    <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-4">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
        Browse by role meaning
      </div>
      <div className="mt-2 text-sm leading-6 text-slate-600">
        Separate composable runtime roles, label-only business roles, and legacy compatibility
        roles before editing permission modules.
      </div>
      <div className="mt-4 space-y-2">
        {ROLE_MEANING_FILTERS.map((filter) => {
          const active = selectedFilter === filter.key;
          return (
            <button
              key={filter.key}
              type="button"
              onClick={() => onSelect(filter.key)}
              className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
                active
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-100"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold">{filter.label}</div>
                <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs">
                  {counts[filter.key] || 0}
                </span>
              </div>
              <div className={`mt-2 text-xs leading-5 ${active ? "text-slate-200" : "text-slate-500"}`}>
                {filter.description}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}function RoleSelectionCard({ active, entry, role, l, onSelect }) {
  const theme = getRoleTheme(entry);
  const secondaryText = getRoleSecondaryText(role, entry, l);
  const attentionItems = buildRoleAttentionItems(entry, role, l);
  const permissionCount = Array.isArray(role?.permissionCodes) ? role.permissionCodes.length : 0;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-[28px] border px-4 py-4 text-left transition ${
        active
          ? "border-slate-900 bg-slate-900 text-white shadow-lg shadow-slate-300/50"
          : `${theme.panel} text-slate-900 hover:border-slate-300`
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={`text-xs font-semibold uppercase tracking-[0.18em] ${active ? "text-slate-300" : "text-slate-500"}`}>
            {entry.categoryLabel}
          </div>
          <div className="mt-2 text-base font-semibold leading-tight">{entry.displayName}</div>
          {secondaryText ? (
            <div className={`mt-1 text-xs leading-5 ${active ? "text-slate-300" : "text-slate-500"}`}>
              {secondaryText}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <span
            className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
              active ? "border-white/20 bg-white/10 text-white" : theme.chip
            }`}
          >
            {getRoleMeaningLabel(entry)}
          </span>
          {entry.businessLabelOnly ? (
            <span
              className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                active ? "border-white/20 bg-white/10 text-white" : "border-sky-200 bg-sky-50 text-sky-800"
              }`}
            >
              Label only
            </span>
          ) : null}
          {entry.companionOnly ? (
            <span
              className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                active ? "border-white/20 bg-white/10 text-white" : "border-violet-200 bg-violet-50 text-violet-800"
              }`}
            >
              Companion role
            </span>
          ) : null}
          {role?.legacyDisabled ? (
            <span
              className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                active ? "border-white/20 bg-white/10 text-white" : "border-rose-200 bg-rose-50 text-rose-800"
              }`}
            >
              Hidden
            </span>
          ) : null}
          {entry.legacy ? (
            <span
              className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                active ? "border-white/20 bg-white/10 text-white" : "border-amber-200 bg-amber-50 text-amber-900"
              }`}
            >
              Legacy
            </span>
          ) : null}
        </div>
      </div>
      <div className={`mt-3 text-sm leading-6 ${active ? "text-slate-100" : "text-slate-600"}`}>
        {entry.description}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <span
          className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
            active ? "border-white/20 bg-white/10 text-white" : "border-slate-200 bg-white text-slate-700"
          }`}
        >
          {entry.workflowFamilyLabel}
        </span>
        <span
          className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
            active ? "border-white/20 bg-white/10 text-white" : "border-slate-200 bg-white text-slate-700"
          }`}
        >
          {getRoleAuthorityLabel(entry)}
        </span>
      </div>
      <RoleScopeCoveragePills entry={entry} compact />
      <div className={`mt-4 grid gap-3 md:grid-cols-2 ${active ? "text-slate-100" : "text-slate-600"}`}>
        <div>
          <div className={`text-[11px] font-semibold uppercase tracking-[0.16em] ${active ? "text-slate-300" : "text-slate-500"}`}>
            Permission count
          </div>
          <div className="mt-1 text-sm font-semibold">{permissionCount}</div>
        </div>
        <div>
          <div className={`text-[11px] font-semibold uppercase tracking-[0.16em] ${active ? "text-slate-300" : "text-slate-500"}`}>
            Recommended scope
          </div>
          <div className="mt-1 text-sm font-semibold">
            {Array.isArray(entry.recommendedScopes) && entry.recommendedScopes.length > 0
              ? entry.recommendedScopes.join(", ")
              : entry.defaultScope || "-"}
          </div>
        </div>
      </div>
      {attentionItems.length > 0 ? (
        <div
          className={`mt-4 flex items-start gap-2 rounded-2xl border px-3 py-3 text-xs leading-5 ${
            active
              ? "border-white/20 bg-white/10 text-slate-100"
              : "border-amber-200 bg-white/80 text-amber-900"
          }`}
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{attentionItems[0]}</span>
        </div>
      ) : null}
      <div
        className={`mt-4 flex items-center justify-between text-xs ${
          active ? "text-slate-300" : "text-slate-500"
        }`}
      >
        <span>{entry.code}</span>
        <span className="inline-flex items-center gap-1 font-semibold">
          Inspect role
          <ChevronRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </button>
  );
}function PermissionModuleEditor({
  canReplaceRolePermissions,
  groups,
  l,
  loading,
  onTogglePermission,
  onReplacePermissions,
  saving,
  selectedRole,
  selectedRoleLocksPermissions,
}) {
  return (
    <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Permission modules
          </div>
          <h3 className="mt-2 text-xl font-semibold text-slate-950">
            Permission editing stays secondary to role meaning
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Review grouped modules, dependency badges, and role guidance before replacing the
            saved permission set.
          </p>
        </div>
        <button
          type="button"
          disabled={
            !selectedRole || saving || !canReplaceRolePermissions || selectedRoleLocksPermissions
          }
          onClick={onReplacePermissions}
          className="rounded-2xl bg-cyan-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {saving ? l("Saving...", "Kaydediliyor...") : l("Replace permissions", "Yetkileri degistir")}
        </button>
      </div>
      {selectedRoleLocksPermissions ? (
        <div className="mt-5 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-4 text-sm leading-6 text-sky-900">
          Business role label roles are locked to zero permissions. Assign workflow packages or
          runtime roles separately from the user-assignment workbench.
        </div>
      ) : null}
      {loading ? (
        <div className="mt-5 text-sm text-slate-500">
          {l("Loading permissions...", "Yetkiler yukleniyor...")}
        </div>
      ) : null}
      {!loading && !selectedRole ? (
        <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
          {l("Select a role to review grouped permission modules.", "Gruplanmis yetki modullerini incelemek icin bir rol secin.")}
        </div>
      ) : null}
      {!loading && selectedRole && !selectedRoleLocksPermissions ? (
        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          {groups.map((group) => (
            <section
              key={group.moduleKey}
              className="overflow-hidden rounded-[24px] border border-slate-200 bg-slate-50"
            >
              <div className="border-b border-slate-200 bg-white px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      {group.moduleLabel}
                    </div>
                    <div className="mt-1 text-sm text-slate-600">
                      {group.selectedCount} / {group.permissions.length} selected
                    </div>
                  </div>
                  {group.selectedCount > 0 ? (
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
                      Active module
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="divide-y divide-slate-200">
                {group.permissions.map((permission) => (
                  <label
                    key={permission.id}
                    className="flex items-start gap-3 bg-white px-4 py-3 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={permission.selected}
                      onChange={() => onTogglePermission(permission.code)}
                      disabled={!canReplaceRolePermissions}
                      className="mt-1"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium text-slate-900">{permission.code}</span>
                      <span className="mt-1 block text-xs leading-5 text-slate-500">
                        {permission.description ||
                          l(
                            "{{action}} access for {{module}}.",
                            "{{module}} icin {{action}} erisimi.",
                            {
                              action: permission.actionLabel,
                              module: group.moduleLabel,
                            }
                          )}
                      </span>
                      <span className="mt-2 flex flex-wrap gap-2">
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                          {permission.actionLabel}
                        </span>
                        {permission.requiresRead ? (
                          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
                            Requires READ
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : null}
    </section>
  );
}/**
+ * Lets security admins review composable-role intent, permission sets, and
+ * permission-rule warnings from one place.
+ */
export default function RolesPermissionsPage() {
  const { hasPermission, securityAdminUiState, securityAdminUiStateLoaded } = useAuth();
  const { l, t } = useI18n();
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
  const [roleSearchValue, setRoleSearchValue] = useState("");
  const [roleMeaningFilter, setRoleMeaningFilter] = useState(FILTER_ALL);
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
      COMPOSABLE_RUNTIME: 0,
      LABEL_ONLY_BUSINESS: 0,
      LEGACY_COMPATIBILITY: 0,
    };
    roles.forEach((role) => {
      const roleEntry = getRoleCatalogEntry(role);
      counts[getRoleMeaningKey(roleEntry)] += 1;
    });
    return counts;
  }, [roles]);
  const permissionModuleGroups = useMemo(
    () => buildPermissionModuleGroups(permissions, selectedPermissionCodes),
    [permissions, selectedPermissionCodes]
  );
  const selectedRoleDisplayCode = selectedRole
    ? selectedRoleEntry?.code || selectedRole.code
    : l("No role selected", "Rol secilmedi");
  const selectedRoleAttentionItems = useMemo(
    () => buildRoleAttentionItems(selectedRoleEntry, selectedRole, l),
    [l, selectedRole, selectedRoleEntry]
  );
  const canUpsertRole = hasPermission("security.role.upsert");
  const canReplaceRolePermissions = hasPermission("security.role_permissions.assign");
  const selectedRoleLocksPermissions = Boolean(selectedRoleEntry?.businessLabelOnly);
  const showFreshTenantAdminNote =
    securityAdminUiStateLoaded &&
    Boolean(securityAdminUiState?.roleMigrations?.simplifiedFreshTenantView);
  const filteredRoleCount = filteredRoleGroups.reduce(
    (total, group) => total + group.roles.length,
    0
  );
  const runtimeRoleCount = roleMeaningCounts.COMPOSABLE_RUNTIME;
  const businessLabelCount = roleMeaningCounts.LABEL_ONLY_BUSINESS;
  const legacyRoleCount = roleMeaningCounts.LEGACY_COMPATIBILITY;
  const currentActionLink = selectedRoleEntry?.legacy
    ? {
        to: "/app/ayarlar/rbac/role-migrations",
        label: l("Open migration workspace", "Rol gecis alanini ac"),
      }
    : selectedRoleLocksPermissions
      ? {
          to: "/app/ayarlar/rbac/user-assignments",
          label: l("Open user assignments", "Kullanici atamalarini ac"),
        }
      : {
          to: "/app/ayarlar/rbac/access-model",
          label: l("Open access model", "Erisim modelini ac"),
        };
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
      workspaceSectionKey="catalog"
      sectionKey="roles-permissions"
      eyebrow="Security / Roles & permissions"
      title={t("rolesPermissions.title")}
      description={t("rolesPermissions.subtitle")}
      actions={[
        {
          to: currentActionLink.to,
          label: currentActionLink.label,
          tone: "primary",
        },
      ]}
      stats={[
        {
          title: "Managed roles",
          value: roles.length,
          description: "Runtime roles available in the current editor surface.",
          tone: "blue",
        },
        {
          title: "Composable runtime roles",
          value: runtimeRoleCount,
          description: "Direct-authority runtime roles that can carry real permission authority.",
          tone: "green",
        },
        {
          title: "Label-only business roles",
          value: businessLabelCount,
          description: "Business labels remain visible but locked to zero permissions.",
          tone: "blue",
        },
        {
          title: "Legacy compatibility roles",
          value: legacyRoleCount,
          description: "Migration and rollback-facing runtime roles kept recognizable in the editor.",
          tone: "amber",
        },
      ]}
      toolbar={
        <>
          <section className="rounded-[28px] border border-sky-200 bg-[linear-gradient(135deg,rgba(240,249,255,0.96),rgba(255,255,255,0.98))] px-5 py-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-3xl">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">
                  Role editor guidance
                </div>
                <h2 className="mt-2 text-xl font-semibold text-slate-950">
                  Start from role meaning, not from raw permission rows
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Composable runtime roles carry authority. Label-only business roles stay
                  non-authoritative, and legacy compatibility roles remain visible so brownfield
                  cleanup and rollback review are still possible without hiding risk.
                </p>
              </div>
              <div className="max-w-sm rounded-2xl border border-sky-200 bg-white/85 px-4 py-3 text-sm leading-6 text-sky-900">
                Permission editing stays secondary to role meaning. Review the selected role&apos;s
                workflow family, scope posture, and warnings before replacing the saved permission
                set.
              </div>
            </div>
          </section>
          <section className="rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-3xl">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Create runtime role
                </div>
                <h2 className="mt-2 text-xl font-semibold text-slate-950">
                  Keep new roles deliberate and composable
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Prefer bounded runtime roles with clear workflow-family intent. Business role
                  labels stay separate from direct permission authority, and legacy compatibility
                  roles should not be cloned forward into new tenant design.
                </p>
              </div>
              <Link
                to="/app/ayarlar/rbac/access-model"
                className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
              >
                Open access model
              </Link>
            </div>
            <form onSubmit={handleCreateRole} className="mt-5 grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)_auto]">
              <input
                value={roleForm.code}
                onChange={(event) =>
                  setRoleForm((prev) => ({ ...prev, code: event.target.value }))
                }
                className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
                placeholder={t("rolesPermissions.placeholders.roleCode")}
                required
              />
              <input
                value={roleForm.name}
                onChange={(event) =>
                  setRoleForm((prev) => ({ ...prev, name: event.target.value }))
                }
                className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
                placeholder={t("rolesPermissions.placeholders.roleName")}
                required
              />
              <button
                type="submit"
                disabled={saving || !canUpsertRole}
                className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
              >
                {saving ? t("rolesPermissions.actions.saving") : t("rolesPermissions.actions.saveRole")}
              </button>
            </form>
          </section>
        </>
      }
    >
      {showFreshTenantAdminNote ? (
        <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          This tenant has no legacy runtime role assignments, so migration-only admin surfaces stay
          out of the normal navigation. Use the composable role catalog as the steady-state model.
        </div>
      ) : null}
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
      <div className="grid gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
        <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Role selection
              </div>
              <h2 className="mt-2 text-xl font-semibold text-slate-950">
                Cleaner role selection surface
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Browse grouped roles before dropping into module-level editing. Dangerous or legacy
                roles stay visible through tinted cards and attention badges before selection.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
              {filteredRoleCount} visible
            </div>
          </div>
          <input
            value={roleSearchValue}
            onChange={(event) => setRoleSearchValue(event.target.value)}
            placeholder={l(
              "Search by label, runtime code, workflow family, capability, or replacement",
              "Etiket, runtime kodu, workflow family, yetenek veya replacement ile ara"
            )}
            className="mt-5 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-900"
          />
          <div className="mt-4">
            <RoleMeaningFilterRail
              counts={roleMeaningCounts}
              selectedFilter={roleMeaningFilter}
              onSelect={setRoleMeaningFilter}
            />
          </div>
          {loading ? (
            <div className="mt-5 text-sm text-slate-500">
              {t("rolesPermissions.sections.loadingRoles")}
            </div>
          ) : null}
          {!loading && filteredRoleGroups.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
              {l("No roles match the current filters.", "Mevcut filtrelerle eslesen rol yok.")}
            </div>
          ) : null}
          {!loading && filteredRoleGroups.length > 0 ? (
            <div className="mt-5 space-y-5">
              {filteredRoleGroups.map((group) => (
                <div key={group.key}>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      {group.label}
                    </div>
                    <div className="text-xs font-semibold text-slate-400">{group.roles.length}</div>
                  </div>
                  <div className="space-y-3">
                    {group.roles.map((role) => {
                      const roleEntry = getRoleCatalogEntry(role);
                      return (
                        <RoleSelectionCard
                          key={role.id}
                          active={Number(role.id) === Number(selectedRoleId)}
                          entry={roleEntry}
                          role={role}
                          l={l}
                          onSelect={() => {
                            setSelectedRoleId(role.id);
                            setSelectedPermissionCodes(role.permissionCodes || []);
                            setValidationWarnings([]);
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </section>
        <div className="space-y-5">
          {selectedRole && selectedRoleEntry ? (
            <>
              <section
                className={`rounded-[28px] border px-5 py-5 shadow-sm ${getRoleTheme(
                  selectedRoleEntry
                ).panel}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="max-w-3xl">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Role meaning
                    </div>
                    <h2 className="mt-2 text-2xl font-semibold text-slate-950">
                      {selectedRoleDisplayCode}
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      {selectedRoleEntry.description}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${getRoleTheme(selectedRoleEntry).chip}`}>
                      {getRoleAuthorityLabel(selectedRoleEntry)}
                    </span>
                    <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">
                      {selectedRoleEntry.workflowFamilyLabel}
                    </span>
                    <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">
                      {selectedRoleEntry.categoryLabel}
                    </span>
                    {selectedRoleEntry.legacy ? (
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900">
                        Legacy compatibility
                      </span>
                    ) : null}
                    {selectedRoleEntry.businessLabelOnly ? (
                      <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-800">
                        Label only
                      </span>
                    ) : null}
                    {selectedRole.legacyDisabled ? (
                      <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-800">
                        Hidden for new assignments
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <RoleMetric
                    label="Authority model"
                    value={getRoleAuthorityLabel(selectedRoleEntry)}
                    note={getRoleMeaningLabel(selectedRoleEntry)}
                    valueTone={getRoleTheme(selectedRoleEntry).metricTone}
                  />
                  <RoleMetric
                    label="Saved permission count"
                    value={Array.isArray(selectedRole.permissionCodes) ? selectedRole.permissionCodes.length : 0}
                    note="Current saved permission set on the runtime role."
                    valueTone={getRoleTheme(selectedRoleEntry).metricTone}
                  />
                  <RoleMetric
                    label="Staged selection"
                    value={selectedPermissionCodes.length}
                    note="Checked permission rows in the editor below."
                    valueTone={getRoleTheme(selectedRoleEntry).metricTone}
                  />
                  <RoleMetric
                    label="Workflow family"
                    value={selectedRoleEntry.workflowFamilyLabel}
                    note={selectedRoleEntry.modelTypeLabel}
                    valueTone={getRoleTheme(selectedRoleEntry).metricTone}
                  />
                </div>
                <div className="mt-5 rounded-[24px] border border-white/80 bg-white/80 px-4 py-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Recommended scope coverage
                  </div>
                  <div className="mt-2 text-sm leading-6 text-slate-600">
                    Scope level pills keep the intended assignment posture visible before any
                    permission editing.
                  </div>
                  <RoleScopeCoveragePills entry={selectedRoleEntry} />
                </div>
                <div className="mt-5 flex flex-wrap gap-3">
                  {selectedRoleEntry.legacy ? (
                    <Link
                      to="/app/ayarlar/rbac/role-migrations"
                      className="rounded-2xl border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-950"
                    >
                      Open migration workspace
                    </Link>
                  ) : null}
                  {selectedRoleLocksPermissions ? (
                    <Link
                      to="/app/ayarlar/rbac/user-assignments"
                      className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                    >
                      Open user assignments
                    </Link>
                  ) : null}
                  <Link
                    to="/app/ayarlar/rbac/access-model"
                    className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                  >
                    Open access model
                  </Link>
                </div>
              </section>
              <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="max-w-3xl">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Role guidance
                    </div>
                    <h3 className="mt-2 text-xl font-semibold text-slate-950">
                      What to watch before editing
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      Make role meaning and warnings explicit before switching into the secondary
                      permission editor.
                    </p>
                  </div>
                  {selectedRoleAttentionItems.length > 0 ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {selectedRoleAttentionItems.length} review points
                    </span>
                  ) : (
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
                      Standard runtime role
                    </span>
                  )}
                </div>
                <div className="mt-5 grid gap-3">
                  {selectedRoleAttentionItems.length > 0 ? (
                    selectedRoleAttentionItems.map((item) => (
                      <div
                        key={item}
                        className={`rounded-2xl border px-4 py-3 text-sm leading-6 ${
                          getRoleTheme(selectedRoleEntry).softPanel
                        }`}
                      >
                        {item}
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-900">
                      This role follows the composable runtime model without legacy or label-only
                      constraints.
                    </div>
                  )}
                </div>
              </section>
              <RoleSummaryCard role={selectedRole} className="rounded-[28px] shadow-sm" />
              <SecurityWarningList
                title="Permission rule warnings"
                warnings={validationWarnings}
                className="rounded-[28px] shadow-sm"
              />
              <PermissionModuleEditor
                canReplaceRolePermissions={canReplaceRolePermissions}
                groups={permissionModuleGroups}
                l={l}
                loading={loading}
                onReplacePermissions={handleReplacePermissions}
                onTogglePermission={togglePermission}
                saving={saving}
                selectedRole={selectedRole}
                selectedRoleLocksPermissions={selectedRoleLocksPermissions}
              />
            </>
          ) : (
            <section className="rounded-[28px] border border-dashed border-slate-300 bg-slate-50 px-6 py-16 text-center text-sm text-slate-500 shadow-sm">
              Select a role to review role meaning, warnings, and grouped permission modules.
            </section>
          )}
        </div>
      </div>
    </SecurityAdminWorkspaceShell>
  );
}
