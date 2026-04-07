
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  getOperationalCoverageWorkspace,
  listApprovalDelegations,
  revokeApprovalDelegation,
  revokeOperationalCoverage,
} from "../../api/approvalDelegations.js";
import {
  createRoleAssignment,
  createSecurityInvite,
  deleteRoleAssignment,
  listCountries,
  listGroupCompanies,
  listLegalEntities,
  listOperatingUnits,
  listRoleAssignments,
  listRoles,
  listUsers,
} from "../../api/rbacAdmin.js";
import PermissionAccessNotice from "../../auth/PermissionAccessNotice.jsx";
import { useAuth } from "../../auth/useAuth.js";
import DelegationStateBadge from "../../components/security/DelegationStateBadge.jsx";
import { useI18n } from "../../i18n/useI18n.js";
import {
  formatDelegationScopeLabel,
  formatDelegationWindow,
} from "../../utils/delegationUi.js";
import SecurityWarningList from "./SecurityWarningList.jsx";
import {
  BOOTSTRAP_HANDOFF_PRESET_CATALOG,
  buildScopeLabel,
  getBootstrapHandoffPresetEntry,
  getRoleCatalogEntry,
  groupRolesForManagement,
} from "./roleCatalog.js";
const SCOPE_TYPES = ["TENANT", "GROUP", "COUNTRY", "LEGAL_ENTITY", "OPERATING_UNIT"];
const EFFECT_OPTIONS = ["ALLOW", "DENY"];
const USER_STATUS_FILTERS = ["ALL", "ACTIVE", "INVITED", "DISABLED"];
const ASSIGNMENT_STATUS_FILTERS = ["ALL", "ACTIVE", "UPCOMING", "EXPIRED", "CUSTOM"];
const ACCESS_MATRIX_ACTIONS = [
  { key: "view", label: "View", shortLabel: "V" },
  { key: "create", label: "Create", shortLabel: "C" },
  { key: "edit", label: "Edit", shortLabel: "E" },
  { key: "post", label: "Post", shortLabel: "P" },
  { key: "approve", label: "Approve", shortLabel: "Ap" },
  { key: "reverse", label: "Reverse", shortLabel: "Rv" },
  { key: "export", label: "Export", shortLabel: "Ex" },
  { key: "assign", label: "Assign", shortLabel: "As" },
];
const ACCESS_MATRIX_GROUPS = Object.freeze([
  Object.freeze({
    key: "security",
    title: "Organization & Security",
    rows: Object.freeze([
      Object.freeze({
        key: "users-access",
        module: "Users & access",
        actions: Object.freeze({
          view: Object.freeze(["LocalUserAdmin", "SecurityAdmin"]),
          assign: Object.freeze(["LocalUserAdmin", "SecurityAdmin"]),
        }),
      }),
      Object.freeze({
        key: "delegation",
        module: "Delegation & coverage",
        actions: Object.freeze({
          view: Object.freeze(["LocalUserAdmin", "SecurityAdmin"]),
          assign: Object.freeze(["LocalUserAdmin", "SecurityAdmin"]),
        }),
      }),
    ]),
  }),
  Object.freeze({
    key: "organization",
    title: "Organization Setup",
    rows: Object.freeze([
      Object.freeze({
        key: "organization-master",
        module: "Org structure & master data",
        actions: Object.freeze({
          view: Object.freeze(["MasterDataSteward"]),
          create: Object.freeze(["MasterDataSteward"]),
          edit: Object.freeze(["MasterDataSteward"]),
          assign: Object.freeze(["MasterDataSteward"]),
        }),
      }),
      Object.freeze({
        key: "shareholder-equity",
        module: "Shareholder & equity",
        actions: Object.freeze({
          view: Object.freeze(["ShareholderCapitalOperator"]),
          create: Object.freeze(["ShareholderCapitalOperator"]),
          edit: Object.freeze(["ShareholderCapitalOperator"]),
          post: Object.freeze(["ShareholderCapitalOperator"]),
          reverse: Object.freeze(["ShareholderCapitalOperator"]),
        }),
      }),
    ]),
  }),
  Object.freeze({
    key: "finance",
    title: "Finance Core",
    rows: Object.freeze([
      Object.freeze({
        key: "general-ledger",
        module: "General Ledger",
        actions: Object.freeze({
          view: Object.freeze(["GLOperator"]),
          create: Object.freeze(["GLOperator"]),
          edit: Object.freeze(["GLOperator"]),
          post: Object.freeze(["GLPostingAuthority"]),
          reverse: Object.freeze(["GLPostingAuthority"]),
          export: Object.freeze(["GLOperator"]),
        }),
      }),
      Object.freeze({
        key: "treasury",
        module: "Cash & Bank",
        actions: Object.freeze({
          view: Object.freeze(["TreasuryOperator", "TreasuryApprover"]),
          create: Object.freeze(["TreasuryOperator"]),
          edit: Object.freeze(["TreasuryOperator"]),
          approve: Object.freeze(["TreasuryApprover"]),
          export: Object.freeze(["TreasuryApprover"]),
        }),
      }),
      Object.freeze({
        key: "payroll",
        module: "Payroll",
        actions: Object.freeze({
          view: Object.freeze(["PayrollOperator", "PayrollApprover"]),
          create: Object.freeze(["PayrollOperator"]),
          edit: Object.freeze(["PayrollOperator"]),
          approve: Object.freeze(["PayrollApprover"]),
          export: Object.freeze(["PayrollApprover"]),
        }),
      }),
    ]),
  }),
  Object.freeze({
    key: "governance",
    title: "Governance",
    rows: Object.freeze([
      Object.freeze({
        key: "local-close",
        module: "Local close",
        actions: Object.freeze({
          view: Object.freeze(["LocalClosePreparer", "LocalCloseReviewer"]),
          create: Object.freeze(["LocalClosePreparer"]),
          approve: Object.freeze(["LocalCloseReviewer"]),
          reverse: Object.freeze(["LocalCloseReviewer"]),
          export: Object.freeze(["LocalCloseReviewer"]),
        }),
      }),
      Object.freeze({
        key: "audit-reporting",
        module: "Reporting & audit",
        actions: Object.freeze({
          view: Object.freeze([
            "AuditorReadOnly",
            "GLOperator",
            "TreasuryApprover",
            "PayrollApprover",
            "LocalCloseReviewer",
          ]),
          export: Object.freeze([
            "AuditorReadOnly",
            "GLOperator",
            "TreasuryApprover",
            "PayrollApprover",
            "LocalCloseReviewer",
          ]),
        }),
      }),
    ]),
  }),
]);
function normalizeText(value) {
  return String(value || "").trim();
}
function getErrorMessage(error, fallback) {
  return (
    error?.response?.data?.message ||
    error?.message ||
    fallback
  );
}
function formatDate(value) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }
  return parsed.toLocaleDateString();
}
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
function getInitials(name) {
  const parts = normalizeText(name).split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) {
    return "U";
  }
  return parts.map((part) => part[0].toUpperCase()).join("");
}
function getToneClasses(tone) {
  if (tone === "blue") {
    return "border-sky-200 bg-sky-50 text-sky-800";
  }
  if (tone === "green") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  if (tone === "amber") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  if (tone === "rose") {
    return "border-rose-200 bg-rose-50 text-rose-800";
  }
  if (tone === "violet") {
    return "border-violet-200 bg-violet-50 text-violet-800";
  }
  return "border-slate-200 bg-slate-100 text-slate-700";
}
function getUserStatusMeta(status) {
  const normalized = normalizeText(status).toUpperCase();
  if (normalized === "ACTIVE") {
    return { label: "Active", tone: "green" };
  }
  if (normalized === "INVITED" || normalized === "PENDING") {
    return { label: "Pending invite", tone: "amber" };
  }
  if (normalized === "DISABLED" || normalized === "SUSPENDED") {
    return { label: "Disabled", tone: "slate" };
  }
  return { label: normalized || "Unknown", tone: "slate" };
}
function getBundleStatusMeta(status) {
  const normalized = normalizeText(status).toUpperCase();
  if (normalized === "ACTIVE") {
    return { label: "Active", tone: "green" };
  }
  if (normalized === "UPCOMING") {
    return { label: "Scheduled", tone: "blue" };
  }
  if (normalized === "EXPIRED") {
    return { label: "Expired", tone: "slate" };
  }
  return { label: "Custom", tone: "amber" };
}
function getCoverageReviewMeta(reviewStatus) {
  const normalized = normalizeText(reviewStatus).toUpperCase();
  if (normalized === "APPROVED") {
    return { label: "Approved", tone: "green" };
  }
  if (normalized === "PENDING_REVIEW" || normalized === "ESCALATED") {
    return { label: "Pending review", tone: "amber" };
  }
  if (normalized === "REJECTED") {
    return { label: "Rejected", tone: "rose" };
  }
  if (normalized === "RETURNED") {
    return { label: "Returned", tone: "slate" };
  }
  return { label: normalized || "Not set", tone: "slate" };
}
function buildScopeOptions(scopeType, lookups, tenantScopeId) {
  const normalizedScopeType = normalizeText(scopeType).toUpperCase();
  if (normalizedScopeType === "TENANT") {
    return tenantScopeId
      ? [{ id: tenantScopeId, label: `Tenant #${tenantScopeId}` }]
      : [];
  }
  if (normalizedScopeType === "GROUP") {
    return (lookups.groups || []).map((row) => ({
      id: Number(row.id),
      label: `${row.code} - ${row.name}`,
    }));
  }
  if (normalizedScopeType === "COUNTRY") {
    return (lookups.countries || []).map((row) => ({
      id: Number(row.id),
      label: `${row.iso2} - ${row.name}`,
    }));
  }
  if (normalizedScopeType === "LEGAL_ENTITY") {
    return (lookups.legalEntities || []).map((row) => ({
      id: Number(row.id),
      label: `${row.code} - ${row.name}`,
    }));
  }
  if (normalizedScopeType === "OPERATING_UNIT") {
    return (lookups.operatingUnits || []).map((row) => ({
      id: Number(row.id),
      label: `${row.code} - ${row.name}`,
    }));
  }
  return [];
}
function buildTemplateRoleCodes(presetCode, includeOptionalRoles = false) {
  const preset = getBootstrapHandoffPresetEntry(presetCode);
  const requiredRoleCodes = Array.isArray(preset.roleCodes) ? [...preset.roleCodes] : [];
  if (includeOptionalRoles) {
    requiredRoleCodes.push(...(preset.optionalRoleCodes || []));
  }
  return Array.from(
    new Set(requiredRoleCodes.map((roleCode) => normalizeText(roleCode)).filter(Boolean))
  );
}
function buildTemplateMatrix(roleCodes) {
  const roleCodeSet = new Set((Array.isArray(roleCodes) ? roleCodes : []).map(String));
  return ACCESS_MATRIX_GROUPS.map((group) => ({
    ...group,
    rows: group.rows.map((row) => ({
      ...row,
      enabledActions: ACCESS_MATRIX_ACTIONS.reduce((acc, action) => {
        const requiredRoleCodes = row.actions?.[action.key] || [];
        acc[action.key] = requiredRoleCodes.some((roleCode) => roleCodeSet.has(roleCode));
        return acc;
      }, {}),
    })),
  }));
}
function collectVisibleModules(matrixGroups) {
  return matrixGroups
    .flatMap((group) =>
      group.rows
        .filter((row) => Object.values(row.enabledActions || {}).some(Boolean))
        .map((row) => row.module)
    )
    .filter(Boolean);
}
function findPresetMatch(roleCodes) {
  const normalizedRoleCodes = Array.from(
    new Set((Array.isArray(roleCodes) ? roleCodes : []).map((roleCode) => normalizeText(roleCode)).filter(Boolean))
  );
  const roleCodeSet = new Set(normalizedRoleCodes);
  let bestMatch = null;
  for (const presetCode of Object.keys(BOOTSTRAP_HANDOFF_PRESET_CATALOG)) {
    const preset = getBootstrapHandoffPresetEntry(presetCode);
    const requiredRoleCodes = preset.roleCodes || [];
    if (requiredRoleCodes.length === 0 || !requiredRoleCodes.every((roleCode) => roleCodeSet.has(roleCode))) {
      continue;
    }
    const optionalRoleCodes = preset.optionalRoleCodes || [];
    const allowedRoleCodes = new Set([...requiredRoleCodes, ...optionalRoleCodes]);
    if (normalizedRoleCodes.some((roleCode) => !allowedRoleCodes.has(roleCode))) {
      continue;
    }
    const matchedOptionalRoleCodes = optionalRoleCodes.filter((roleCode) => roleCodeSet.has(roleCode));
    const score = requiredRoleCodes.length * 100 + matchedOptionalRoleCodes.length;
    if (!bestMatch || score > bestMatch.score) {
      bestMatch = {
        presetCode,
        preset,
        matchedOptionalRoleCodes,
        score,
      };
    }
  }
  return bestMatch;
}
function resolveAssignmentLifecycle(rows) {
  const now = Date.now();
  const normalizedRows = Array.isArray(rows) ? rows : [];
  if (normalizedRows.length === 0) {
    return "CUSTOM";
  }
  const active = normalizedRows.some((row) => {
    const effectiveFrom = row.effective_from ? new Date(row.effective_from).getTime() : null;
    const effectiveTo = row.effective_to ? new Date(row.effective_to).getTime() : null;
    const afterStart = effectiveFrom === null || Number.isNaN(effectiveFrom) || effectiveFrom <= now;
    const beforeEnd = effectiveTo === null || Number.isNaN(effectiveTo) || effectiveTo >= now;
    return afterStart && beforeEnd;
  });
  if (active) {
    return "ACTIVE";
  }
  const upcoming = normalizedRows.every((row) => {
    const effectiveFrom = row.effective_from ? new Date(row.effective_from).getTime() : null;
    return effectiveFrom !== null && !Number.isNaN(effectiveFrom) && effectiveFrom > now;
  });
  if (upcoming) {
    return "UPCOMING";
  }
  const expired = normalizedRows.every((row) => {
    const effectiveTo = row.effective_to ? new Date(row.effective_to).getTime() : null;
    return effectiveTo !== null && !Number.isNaN(effectiveTo) && effectiveTo < now;
  });
  if (expired) {
    return "EXPIRED";
  }
  return "CUSTOM";
}
function buildAssignmentBundles(assignments, usersById, lookups, tenantScopeId) {
  const grouped = new Map();
  for (const assignment of Array.isArray(assignments) ? assignments : []) {
    const key = [
      Number(assignment.user_id || 0),
      normalizeText(assignment.scope_type).toUpperCase(),
      Number(assignment.scope_id || 0),
      normalizeText(assignment.effect).toUpperCase() || "ALLOW",
      normalizeText(assignment.effective_from),
      normalizeText(assignment.effective_to),
    ].join("|");
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(assignment);
  }
  return Array.from(grouped.entries())
    .map(([key, rows]) => {
      const first = rows[0] || {};
      const userId = Number(first.user_id || 0);
      const user = usersById.get(userId) || null;
      const roleCodes = Array.from(
        new Set(rows.map((row) => normalizeText(row.role_code)).filter(Boolean))
      ).sort();
      const presetMatch = findPresetMatch(roleCodes);
      const status = resolveAssignmentLifecycle(rows);
      return {
        id: key,
        assignmentIds: rows.map((row) => Number(row.id)).filter(Boolean),
        userId,
        userName: normalizeText(user?.name || first.user_name || `User #${userId}`),
        userEmail: normalizeText(user?.email || first.user_email),
        scopeType: normalizeText(first.scope_type).toUpperCase(),
        scopeId: Number(first.scope_id || 0),
        scopeLabel: buildScopeLabel(first.scope_type, first.scope_id, lookups, tenantScopeId),
        effect: normalizeText(first.effect).toUpperCase() || "ALLOW",
        effectiveFrom: first.effective_from || "",
        effectiveTo: first.effective_to || "",
        roleCodes,
        status,
        presetCode: presetMatch?.presetCode || "",
        presetSummary: presetMatch?.preset?.summary || "",
        optionalRoleCodes: presetMatch?.matchedOptionalRoleCodes || [],
        isPresetBundle: Boolean(presetMatch),
        rows,
      };
    })
    .sort((left, right) => {
      const leftActive = left.status === "ACTIVE" ? 0 : left.status === "UPCOMING" ? 1 : 2;
      const rightActive = right.status === "ACTIVE" ? 0 : right.status === "UPCOMING" ? 1 : 2;
      if (leftActive !== rightActive) {
        return leftActive - rightActive;
      }
      return left.userName.localeCompare(right.userName);
    });
}
function buildUserDirectoryRows(users, bundles, approvalRows, coverageRows) {
  const bundleMap = new Map();
  for (const bundle of Array.isArray(bundles) ? bundles : []) {
    const userId = Number(bundle.userId || 0);
    if (!bundleMap.has(userId)) {
      bundleMap.set(userId, []);
    }
    bundleMap.get(userId).push(bundle);
  }
  return (Array.isArray(users) ? users : []).map((user) => {
    const userId = Number(user.id || 0);
    const userBundles = bundleMap.get(userId) || [];
    const roleCodes = Array.from(
      new Set(userBundles.flatMap((bundle) => bundle.roleCodes))
    );
    const scopes = Array.from(
      new Set(userBundles.map((bundle) => `${bundle.scopeType}:${bundle.scopeId}`))
    );
    const activeApprovalDelegations = (approvalRows || []).filter((row) => {
      const state = normalizeText(row.state).toUpperCase();
      return (
        (Number(row.delegatorUserId || row.delegator_user_id || 0) === userId ||
          Number(row.delegateUserId || row.delegate_user_id || 0) === userId) &&
        (state === "ACTIVE" || state === "UPCOMING")
      );
    });
    const activeCoverage = (coverageRows || []).filter((row) => {
      const state = normalizeText(row.state).toUpperCase();
      return (
        (Number(row.requesterUserId || row.requester_user_id || 0) === userId ||
          Number(row.delegateUserId || row.delegate_user_id || 0) === userId) &&
        (state === "ACTIVE" || state === "APPROVED" || state === "REQUESTED")
      );
    });
    return {
      ...user,
      assignmentCount: userBundles.length,
      presetCount: userBundles.filter((bundle) => bundle.isPresetBundle).length,
      scopeCount: scopes.length,
      topRoleCodes: roleCodes.slice(0, 4),
      topScopeLabels: userBundles.slice(0, 2).map((bundle) => bundle.scopeLabel),
      activeDelegationCount: activeApprovalDelegations.length + activeCoverage.length,
      currentPresetCodes: Array.from(
        new Set(userBundles.map((bundle) => bundle.presetCode).filter(Boolean))
      ),
    };
  });
}
function buildAssignmentSearchText(bundle) {
  return [
    bundle.userName,
    bundle.userEmail,
    bundle.presetCode,
    bundle.scopeLabel,
    bundle.scopeType,
    bundle.roleCodes.join(" "),
  ]
    .join(" ")
    .toLowerCase();
}
function buildUserSearchText(row) {
  return [
    row.name,
    row.email,
    row.status,
    row.topRoleCodes.join(" "),
    row.currentPresetCodes.join(" "),
    row.topScopeLabels.join(" "),
  ]
    .join(" ")
    .toLowerCase();
}

function getRoleDisplayCode(roleOrCode) {
  return getRoleCatalogEntry(roleOrCode).code;
}
function WorkspaceStatCard({ title, value, subtitle, tone = "slate" }) {
  const toneClasses =
    tone === "blue"
      ? "border-sky-200 bg-sky-50"
      : tone === "green"
        ? "border-emerald-200 bg-emerald-50"
        : tone === "amber"
          ? "border-amber-200 bg-amber-50"
          : "border-slate-200 bg-white";
  return (
    <article className={`rounded-[24px] border px-5 py-4 shadow-sm ${toneClasses}`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        {title}
      </div>
      <div className="mt-3 text-3xl font-semibold text-slate-950">{value}</div>
      <div className="mt-2 text-sm leading-6 text-slate-600">{subtitle}</div>
    </article>
  );
}
function WorkspaceTabButton({ active, count, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${
        active
          ? "border-sky-200 bg-sky-50 text-sky-800"
          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
      }`}
    >
      <span>{label}</span>
      <span className="rounded-full bg-white px-2 py-0.5 text-xs text-slate-500">{count}</span>
    </button>
  );
}
function StatusPill({ label, tone = "slate", className = "" }) {
  return (
    <span
      className={[
        "inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold",
        getToneClasses(tone),
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {label}
    </span>
  );
}
function MatrixCell({ enabled }) {
  return (
    <span
      className={`mx-auto inline-flex h-5 w-5 items-center justify-center rounded-md border text-[10px] font-bold ${
        enabled
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-200 bg-white text-slate-300"
      }`}
    >
      {enabled ? "x" : ""}
    </span>
  );
}
function AccessMatrix({ matrixGroups, l }) {
  return (
    <div className="space-y-3">
      {matrixGroups.map((group) => (
        <div key={group.key} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-semibold uppercase tracking-[0.16em] text-slate-700">
            {group.title}
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[34rem] table-fixed divide-y divide-slate-200">
              <colgroup>
                <col className="w-[11rem]" />
                {ACCESS_MATRIX_ACTIONS.map((action) => (
                  <col key={`${group.key}-${action.key}-col`} className="w-10" />
                ))}
              </colgroup>
              <thead className="bg-white">
                <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-slate-500">
                  <th className="px-3 py-2.5">{l("Module", "Modul")}</th>
                  {ACCESS_MATRIX_ACTIONS.map((action) => (
                    <th
                      key={`${group.key}-${action.key}`}
                      title={action.label}
                      className="px-1 py-2.5 text-center"
                    >
                      <span aria-hidden="true">{action.shortLabel || action.label}</span>
                      <span className="sr-only">{action.label}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {group.rows.map((row) => (
                  <tr key={row.key}>
                    <td className="px-3 py-2.5 text-xs font-medium text-slate-900">
                      <div className="truncate" title={row.module}>
                        {row.module}
                      </div>
                    </td>
                    {ACCESS_MATRIX_ACTIONS.map((action) => (
                      <td key={`${row.key}-${action.key}`} className="px-1 py-2 text-center">
                        <MatrixCell enabled={Boolean(row.enabledActions?.[action.key])} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
function AssignmentBundleCard({
  bundle,
  expanded,
  l,
  onSelect,
  onOpenUser,
  onRevoke,
  revoking,
}) {
  const statusMeta = getBundleStatusMeta(bundle.status);
  return (
    <button
      type="button"
      onClick={() => onSelect(bundle.id)}
      className={`w-full rounded-[22px] border px-4 py-4 text-left transition ${
        expanded
          ? "border-sky-300 bg-sky-50 shadow-sm"
          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-base font-semibold text-slate-950">
              {bundle.presetCode || l("Custom assignment bundle", "Ozel atama paketi")}
            </div>
            <StatusPill label={statusMeta.label} tone={statusMeta.tone} />
            {bundle.effect !== "ALLOW" ? (
              <StatusPill label={bundle.effect} tone="rose" />
            ) : null}
          </div>
          <div className="mt-2 text-sm text-slate-700">
            {bundle.userName} - {bundle.scopeLabel}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {l("Effective", "Yururluk")} {formatDate(bundle.effectiveFrom)} to{" "}
            {formatDate(bundle.effectiveTo)}
          </div>
        </div>
        <div className="text-right text-xs text-slate-500">
          <div>{bundle.roleCodes.length} {l("underlying roles", "alttaki rol")}</div>
          <div className="mt-1">{bundle.scopeType}</div>
        </div>
      </div>
      {expanded ? (
        <div className="mt-4 grid gap-4 border-t border-sky-200 pt-4 lg:grid-cols-[minmax(0,1fr)_220px]">
          <div>
            {bundle.presetSummary ? (
              <p className="text-sm leading-6 text-slate-600">{bundle.presetSummary}</p>
            ) : (
              <p className="text-sm leading-6 text-slate-600">
                {l(
                  "This bundle does not match a shipped preset exactly, so it is shown as a custom access package.",
                  "Bu paket yayinlanan bir preset ile tam eslesmiyor; bu nedenle ozel erisim paketi olarak gosterilir."
                )}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {bundle.roleCodes.map((roleCode) => {
                const roleEntry = getRoleCatalogEntry(roleCode);
                return (
                  <span
                    key={`${bundle.id}-${roleCode}`}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold ${getToneClasses(
                      roleEntry.category === "readonly"
                        ? "slate"
                        : roleEntry.category === "scoped"
                          ? "green"
                          : roleEntry.category === "system"
                            ? "blue"
                            : roleEntry.category === "legacy"
                              ? "amber"
                              : "violet"
                    )}`}
                  >
                    {roleEntry.code}
                  </span>
                );
              })}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              {l("Actions", "Aksiyonlar")}
            </div>
            <div className="mt-3 space-y-2">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenUser(bundle.userId);
                }}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
              >
                {l("Open user editor", "Kullanici editorunu ac")}
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onRevoke(bundle);
                }}
                disabled={revoking}
                className="w-full rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {revoking ? l("Revoking...", "Geri aliniyor...") : l("Revoke bundle", "Paketi geri al")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </button>
  );
}
function UserAccessModal({
  open,
  mode,
  form,
  onChange,
  onClose,
  onSubmit,
  saving,
  l,
  permissionAccess,
  currentUserRoleCodes,
  currentUserBundles,
  modalScopeOptions,
  matrixGroups,
  visibleModules,
  missingRoleCodes,
  inviteLink,
}) {
  if (!open) {
    return null;
  }
  const isInvite = mode === "invite";
  const isPresetSelected = Boolean(normalizeText(form.presetCode));
  const sectionClassName =
    "space-y-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4";
  const fieldClassName =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm shadow-slate-950/5 focus:border-slate-400 focus:outline-none disabled:bg-slate-100 disabled:text-slate-500";
  const readOnlyFieldClassName =
    "rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700";
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/45 px-4 py-4 backdrop-blur-sm sm:px-6 sm:py-6">
      <div className="flex min-h-full items-start justify-center">
        <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-6xl flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl sm:max-h-[calc(100vh-3rem)]">
          <div className="shrink-0 flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                {l("User editor", "Kullanici editoru")}
              </div>
              <h2 className="mt-2 text-2xl font-semibold text-slate-950">
                {isInvite
                  ? l("Invite user", "Kullanici davet et")
                  : l("Edit user access", "Kullanici erisimini duzenle")}
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                {l(
                  "Use a template-first editor for real user admin work: general info at the top, scoped assignment in the middle, and a permission matrix preview before save.",
                  "Gercek kullanici yonetimi icin template-oncelikli bir editor kullanin: ustte genel bilgi, ortada kapsamli atama ve kaydetmeden once izin matrisi onizlemesi."
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
            >
              {l("Close", "Kapat")}
            </button>
          </div>
          <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="grid gap-0 xl:min-h-full xl:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
                <div className="space-y-5 border-b border-slate-200 px-5 py-5 xl:border-b-0 xl:border-r xl:px-6 xl:py-6">
              <section className={sectionClassName}>
                <div>
                  <h3 className="text-lg font-semibold text-slate-950">{l("General Info", "Genel Bilgi")}</h3>
                  <p className="mt-1 text-sm text-slate-600">
                    {l(
                      "Keep this section calm and factual: who the user is, how they sign in, and whether the current flow can still edit those fields.",
                      "Bu bolumu sakin ve olgusal tutun: kullanicinin kim oldugu, nasil giris yaptigi ve mevcut akisin bu alanlari hala duzenleyip duzenleyemedigi."
                    )}
                  </p>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700">{l("Full name", "Ad soyad")}</label>
                    <input
                      type="text"
                      value={form.name}
                      onChange={(event) => onChange("name", event.target.value)}
                      disabled={!isInvite}
                      className={fieldClassName}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700">{l("Email", "E-posta")}</label>
                    <input
                      type="email"
                      value={form.email}
                      onChange={(event) => onChange("email", event.target.value)}
                      disabled={!isInvite}
                      className={fieldClassName}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700">{l("Status", "Durum")}</label>
                    <div className={readOnlyFieldClassName}>
                      {isInvite
                        ? l("Pending invite", "Bekleyen davet")
                        : getUserStatusMeta(form.status).label}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700">{l("Directory mode", "Dizin modu")}</label>
                    <div className={readOnlyFieldClassName}>
                      {isInvite
                        ? l("Invite and assign", "Davet et ve ata")
                        : l("Review existing user and add access", "Mevcut kullaniciyi incele ve erisim ekle")}
                    </div>
                  </div>
                </div>
                {!isInvite ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-600">
                    {l(
                      "This live surface can apply or review access, but it does not currently persist direct profile edits for existing users because the backend user-update seam is not part of this page's API.",
                      "Bu canli yuzey erisimi uygulayabilir veya inceleyebilir; ancak mevcut kullanicilar icin dogrudan profil degisikliklerini kalici yapmaz, cunku backend user-update seam'i bu sayfanin API kapsaminda degildir."
                    )}
                  </div>
                ) : null}
              </section>
              <section className={sectionClassName}>
                <div>
                  <h3 className="text-lg font-semibold text-slate-950">{l("Role & Access", "Rol ve Erisim")}</h3>
                  <p className="mt-1 text-sm text-slate-600">
                    {l(
                      "Choose the business template first, then choose the scope once. The matrix below shows what that template opens in the ERP.",
                      "Once is template'ini secin, sonra kapsami bir kez secin. Alttaki matris bu template'in ERP'de neleri actigini gosterir."
                    )}
                  </p>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700">{l("Role template", "Rol template'i")}</label>
                    <select
                      value={form.presetCode}
                      onChange={(event) => onChange("presetCode", event.target.value)}
                      className={fieldClassName}
                    >
                      <option value="">{l("Invite without immediate assignment", "Anlik atama olmadan davet et")}</option>
                      {Object.keys(BOOTSTRAP_HANDOFF_PRESET_CATALOG).map((presetCode) => (
                        <option key={presetCode} value={presetCode}>
                          {presetCode}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700">{l("Scope", "Kapsam")}</label>
                    <select
                      value={form.scopeId}
                      onChange={(event) => onChange("scopeId", event.target.value)}
                      disabled={!isPresetSelected}
                      className={fieldClassName}
                    >
                      {modalScopeOptions.length === 0 ? (
                        <option value="">{l("No scope available", "Kapsam yok")}</option>
                      ) : null}
                      {modalScopeOptions.map((option) => (
                        <option key={option.id} value={String(option.id)}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700">{l("Effective from", "Baslangic tarihi")}</label>
                    <input
                      type="date"
                      value={form.effectiveFrom}
                      onChange={(event) => onChange("effectiveFrom", event.target.value)}
                      className={fieldClassName}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700">{l("Effective to", "Bitis tarihi")}</label>
                    <input
                      type="date"
                      value={form.effectiveTo}
                      onChange={(event) => onChange("effectiveTo", event.target.value)}
                      className={fieldClassName}
                    />
                  </div>
                </div>
                <label className="flex items-start gap-3 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-4">
                  <input
                    type="checkbox"
                    checked={Boolean(form.includePostingAuthority)}
                    onChange={(event) => onChange("includePostingAuthority", event.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-violet-600"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-violet-950">
                      {l("Include GL posting authority", "GL posting authority dahil et")}
                    </span>
                    <span className="mt-1 block text-sm leading-6 text-violet-900">
                      {l(
                        "Keep elevated posting power visible as a deliberate add-on, not as a hidden side effect of the template.",
                        "Yuksek posting yetkisini template'in gizli yan etkisi olarak degil, bilincli bir eklenti olarak gorunur tutun."
                      )}
                    </span>
                  </span>
                </label>
                <PermissionAccessNotice
                  access={permissionAccess}
                  permissionCode="security.role_assignment.upsert"
                />
                {inviteLink ? (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-900">
                    <div className="font-semibold">{l("Invite link ready", "Davet baglantisi hazir")}</div>
                    <div className="mt-2 break-all">{inviteLink}</div>
                  </div>
                ) : null}
              </section>
            </div>
            <div className="space-y-5 bg-slate-50/40 px-5 py-5 xl:px-6 xl:py-6">
              <section className={sectionClassName}>
                <div>
                  <h3 className="text-lg font-semibold text-slate-950">{l("Permission matrix", "Izin matrisi")}</h3>
                  <p className="mt-1 text-sm text-slate-600">
                    {l(
                      "Separate module visibility, business actions, and scope in one preview. Templates stay primary. Overrides stay rare.",
                      "Modul gorunurlugunu, is aksiyonlarini ve kapsami tek bir onizlemede ayirin. Template'ler birincil kalsin. Override'lar nadir kalsin."
                    )}
                  </p>
                </div>
                {isPresetSelected ? (
                  <AccessMatrix matrixGroups={matrixGroups} l={l} />
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">
                    {l(
                      "Choose a template to preview module visibility and business actions.",
                      "Modul gorunurlugunu ve is aksiyonlarini onizlemek icin bir template secin."
                    )}
                  </div>
                )}
              </section>
              <section className={sectionClassName}>
                <div>
                  <h3 className="text-lg font-semibold text-slate-950">{l("Navigation preview", "Navigasyon onizlemesi")}</h3>
                  <p className="mt-1 text-sm text-slate-600">
                    {l(
                      "Admins should understand immediately which modules the user will see once the template is applied.",
                      "Yoneticiler template uygulandiginda kullanicinin hangi modulleri gorecegini hemen anlamalidir."
                    )}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    {l("Visible modules", "Gorunen moduller")}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {visibleModules.length > 0 ? (
                      visibleModules.map((moduleLabel) => (
                        <span
                          key={moduleLabel}
                          className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-800"
                        >
                          {moduleLabel}
                        </span>
                      ))
                    ) : (
                      <span className="text-sm text-slate-500">
                        {l("No modules selected yet.", "Henuz modul secilmedi.")}
                      </span>
                    )}
                  </div>
                </div>
              </section>
              <section className={sectionClassName}>
                <div>
                  <h3 className="text-lg font-semibold text-slate-950">{l("Current access snapshot", "Mevcut erisim ozeti")}</h3>
                  <p className="mt-1 text-sm text-slate-600">
                    {l(
                      "Keep the current storage model honest: composable RBAC roles still exist underneath, but the editor shows them as grouped business access.",
                      "Mevcut saklama modelini durust tutun: altta birlesik RBAC rolleri hala vardir, ancak editor bunlari gruplanmis is erisimi olarak gosterir."
                    )}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    {l("Current bundles", "Mevcut paketler")}
                  </div>
                  <div className="mt-3 space-y-2">
                    {currentUserBundles.length > 0 ? (
                      currentUserBundles.map((bundle) => (
                        <div
                          key={`modal-bundle-${bundle.id}`}
                          className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-sm font-semibold text-slate-900">
                              {bundle.presetCode || l("Custom bundle", "Ozel paket")}
                            </div>
                            <StatusPill
                              label={getBundleStatusMeta(bundle.status).label}
                              tone={getBundleStatusMeta(bundle.status).tone}
                            />
                          </div>
                          <div className="mt-1 text-xs text-slate-500">{bundle.scopeLabel}</div>
                        </div>
                      ))
                    ) : (
                      <div className="text-sm text-slate-500">
                        {l("No current business assignments.", "Mevcut is atamasi yok.")}
                      </div>
                    )}
                  </div>
                  <div className="mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    {l("Underlying role rows", "Alttaki rol satirlari")}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {currentUserRoleCodes.length > 0 ? (
                      currentUserRoleCodes.map((roleCode) => (
                        <span
                          key={`modal-current-role-${roleCode}`}
                          className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700"
                        >
                          {getRoleDisplayCode(roleCode)}
                        </span>
                      ))
                    ) : (
                      <span className="text-sm text-slate-500">
                        {l("No raw role rows yet.", "Henuz ham rol satiri yok.")}
                      </span>
                    )}
                  </div>
                </div>
              </section>
              {missingRoleCodes.length > 0 ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-800">
                  {l(
                    "Preset roles missing from tenant catalog: {{roles}}",
                    "Tenant katalogunda eksik preset rolleri: {{roles}}",
                    { roles: missingRoleCodes.join(", ") }
                  )}
                </div>
              ) : null}
            </div>
          </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-6 py-4">
            <div className="text-sm text-slate-500">
              {l(
                "Save applies the access decision. Existing profile editing remains outside this page's current API seam.",
                "Kaydetme, erisim kararini uygular. Mevcut profil duzenleme bu sayfanin mevcut API seam'inin disindadir."
              )}
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700"
              >
                {l("Cancel", "Iptal")}
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving
                  ? l("Saving...", "Kaydediliyor...")
                  : isInvite
                    ? l("Invite and apply access", "Davet et ve erisim uygula")
                    : l("Apply access", "Erisim uygula")}
              </button>
            </div>
          </div>
        </form>
      </div>
      </div>
    </div>
  );
}
/**
 * Live merged workspace for user directory, business assignments, and
 * delegation operations. The backend still persists raw RBAC rows one at a
 * time, but this page groups them into calmer business-first admin flows.
 */
export default function UserAssignmentsPage() {
  const {
    getPermissionAccess,
    hasPermission,
    user,
    securityAdminUiState,
    securityAdminUiStateLoaded,
  } = useAuth();
  const { l } = useI18n();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actingRowId, setActingRowId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [warningMessages, setWarningMessages] = useState([]);
  const [delegationLoadError, setDelegationLoadError] = useState("");
  const [activeTab, setActiveTab] = useState("users");
  const [delegationTab, setDelegationTab] = useState("coverage");
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [groups, setGroups] = useState([]);
  const [countries, setCountries] = useState([]);
  const [legalEntities, setLegalEntities] = useState([]);
  const [operatingUnits, setOperatingUnits] = useState([]);
  const [approvalDelegations, setApprovalDelegations] = useState([]);
  const [coverageRows, setCoverageRows] = useState([]);
  const [lastInviteLink, setLastInviteLink] = useState("");
  const [userFilters, setUserFilters] = useState({
    search: "",
    scopeType: "",
    roleCode: "",
    status: "ALL",
    delegationState: "",
  });
  const [assignmentFilters, setAssignmentFilters] = useState({
    search: "",
    presetCode: "",
    status: "ALL",
  });
  const [selectedBundleId, setSelectedBundleId] = useState("");
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [userModalMode, setUserModalMode] = useState("invite");
  const [userModalForm, setUserModalForm] = useState({
    userId: "",
    name: "",
    email: "",
    status: "",
    presetCode: "",
    scopeId: "",
    effectiveFrom: "",
    effectiveTo: "",
    includePostingAuthority: true,
  });
  const [assignmentForm, setAssignmentForm] = useState({
    userId: "",
    presetCode: "EntityAPController",
    scopeId: "",
    effectiveFrom: "",
    effectiveTo: "",
    includePostingAuthority: true,
  });
  const [rawAssignmentForm, setRawAssignmentForm] = useState({
    userId: "",
    roleId: "",
    scopeType: "TENANT",
    scopeId: "",
    effect: "ALLOW",
    effectiveFrom: "",
    effectiveTo: "",
  });
  const tenantScopeId = Number(user?.tenant_id || 0);
  const canReadOrgTree = hasPermission("org.tree.read");
  const roleAssignmentReadAccess = getPermissionAccess("security.role_assignment.read");
  const showFreshTenantAdminNote =
    securityAdminUiStateLoaded &&
    Boolean(securityAdminUiState?.roleMigrations?.simplifiedFreshTenantView);
  const lookups = useMemo(
    () => ({
      groups,
      countries,
      legalEntities,
      operatingUnits,
    }),
    [countries, groups, legalEntities, operatingUnits]
  );
  const usersById = useMemo(
    () => new Map(users.map((row) => [Number(row.id), row])),
    [users]
  );
  const rolesByCode = useMemo(
    () => new Map(roles.map((row) => [normalizeText(row.code), row])),
    [roles]
  );
  const roleGroups = useMemo(() => groupRolesForManagement(roles), [roles]);
  const assignableRoleGroups = useMemo(
    () =>
      roleGroups
        .map((group) => ({
          ...group,
          roles: group.roles.filter((role) => !getRoleCatalogEntry(role).legacy),
        }))
        .filter((group) => group.roles.length > 0),
    [roleGroups]
  );
  const assignmentBundles = useMemo(
    () => buildAssignmentBundles(assignments, usersById, lookups, tenantScopeId),
    [assignments, lookups, tenantScopeId, usersById]
  );
  const userDirectoryRows = useMemo(
    () => buildUserDirectoryRows(users, assignmentBundles, approvalDelegations, coverageRows),
    [approvalDelegations, assignmentBundles, coverageRows, users]
  );
  const filteredUsers = useMemo(() => {
    const searchText = normalizeText(userFilters.search).toLowerCase();
    return userDirectoryRows.filter((row) => {
      if (searchText && !buildUserSearchText(row).includes(searchText)) {
        return false;
      }
      if (
        userFilters.scopeType &&
        !assignmentBundles.some(
          (bundle) =>
            Number(bundle.userId) === Number(row.id) &&
            bundle.scopeType === userFilters.scopeType
        )
      ) {
        return false;
      }
      if (
        userFilters.roleCode &&
        !row.topRoleCodes.includes(userFilters.roleCode) &&
        !assignmentBundles.some(
          (bundle) =>
            Number(bundle.userId) === Number(row.id) &&
            bundle.roleCodes.includes(userFilters.roleCode)
        )
      ) {
        return false;
      }
      if (userFilters.status !== "ALL") {
        const normalizedStatus = normalizeText(row.status).toUpperCase();
        if (userFilters.status === "INVITED") {
          if (!(normalizedStatus === "INVITED" || normalizedStatus === "PENDING")) {
            return false;
          }
        } else if (normalizedStatus !== userFilters.status) {
          return false;
        }
      }
      if (userFilters.delegationState === "HAS_DELEGATION" && row.activeDelegationCount === 0) {
        return false;
      }
      if (userFilters.delegationState === "NO_DELEGATION" && row.activeDelegationCount > 0) {
        return false;
      }
      return true;
    });
  }, [assignmentBundles, userDirectoryRows, userFilters]);
  const filteredBundles = useMemo(() => {
    const searchText = normalizeText(assignmentFilters.search).toLowerCase();
    return assignmentBundles.filter((bundle) => {
      if (searchText && !buildAssignmentSearchText(bundle).includes(searchText)) {
        return false;
      }
      if (assignmentFilters.presetCode) {
        const normalizedPresetCode = assignmentFilters.presetCode;
        if (normalizedPresetCode === "__custom__") {
          if (bundle.isPresetBundle) {
            return false;
          }
        } else if (bundle.presetCode !== normalizedPresetCode) {
          return false;
        }
      }
      if (assignmentFilters.status !== "ALL" && bundle.status !== assignmentFilters.status) {
        return false;
      }
      return true;
    });
  }, [assignmentBundles, assignmentFilters]);
  const selectedBundle =
    filteredBundles.find((bundle) => bundle.id === selectedBundleId) ||
    filteredBundles[0] ||
    null;
  const pendingInviteRows = useMemo(
    () =>
      users.filter((row) => {
        const normalizedStatus = normalizeText(row.status).toUpperCase();
        return normalizedStatus === "INVITED" || normalizedStatus === "PENDING";
      }),
    [users]
  );
  const totalDelegationCount = useMemo(() => {
    const approvalCount = approvalDelegations.filter((row) => {
      const state = normalizeText(row.state).toUpperCase();
      return state === "ACTIVE" || state === "UPCOMING";
    }).length;
    const coverageCount = coverageRows.filter((row) => {
      const state = normalizeText(row.state).toUpperCase();
      return state === "ACTIVE" || state === "APPROVED" || state === "REQUESTED";
    }).length;
    return approvalCount + coverageCount;
  }, [approvalDelegations, coverageRows]);
  const userModalPreset = useMemo(
    () => getBootstrapHandoffPresetEntry(userModalForm.presetCode),
    [userModalForm.presetCode]
  );
  const userModalScopeOptions = useMemo(
    () => buildScopeOptions(userModalPreset.scopeType, lookups, tenantScopeId),
    [lookups, tenantScopeId, userModalPreset.scopeType]
  );
  const userModalRoleCodes = useMemo(
    () =>
      buildTemplateRoleCodes(
        userModalForm.presetCode,
        Boolean(userModalForm.includePostingAuthority)
      ),
    [userModalForm.includePostingAuthority, userModalForm.presetCode]
  );
  const userModalMatrix = useMemo(
    () => buildTemplateMatrix(userModalRoleCodes),
    [userModalRoleCodes]
  );
  const userModalVisibleModules = useMemo(
    () => collectVisibleModules(userModalMatrix),
    [userModalMatrix]
  );
  const userModalMissingRoleCodes = useMemo(
    () => userModalRoleCodes.filter((roleCode) => !rolesByCode.get(roleCode)),
    [rolesByCode, userModalRoleCodes]
  );
  const selectedUserModalScopeId = Number(userModalForm.scopeId || 0);
  const userModalAccess = getPermissionAccess(
    "security.role_assignment.upsert",
    selectedUserModalScopeId && userModalPreset.scopeType
      ? {
          scope: {
            scopeType: userModalPreset.scopeType,
            scopeId: selectedUserModalScopeId,
          },
        }
      : undefined
  );
  const currentModalUserRoleCodes = useMemo(() => {
    const userId = Number(userModalForm.userId || 0);
    return Array.from(
      new Set(
        assignmentBundles
          .filter((bundle) => Number(bundle.userId) === userId)
          .flatMap((bundle) => bundle.roleCodes)
      )
    );
  }, [assignmentBundles, userModalForm.userId]);
  const currentModalUserBundles = useMemo(() => {
    const userId = Number(userModalForm.userId || 0);
    return assignmentBundles.filter((bundle) => Number(bundle.userId) === userId);
  }, [assignmentBundles, userModalForm.userId]);
  const assignmentPreset = useMemo(
    () => getBootstrapHandoffPresetEntry(assignmentForm.presetCode),
    [assignmentForm.presetCode]
  );
  const assignmentScopeOptions = useMemo(
    () => buildScopeOptions(assignmentPreset.scopeType, lookups, tenantScopeId),
    [assignmentPreset.scopeType, lookups, tenantScopeId]
  );
  const assignmentRoleCodes = useMemo(
    () =>
      buildTemplateRoleCodes(
        assignmentForm.presetCode,
        Boolean(assignmentForm.includePostingAuthority)
      ),
    [assignmentForm.includePostingAuthority, assignmentForm.presetCode]
  );
  const assignmentRoleEntries = useMemo(
    () => assignmentRoleCodes.map((roleCode) => getRoleCatalogEntry(roleCode)),
    [assignmentRoleCodes]
  );
  const selectedAssignmentScopeId = Number(assignmentForm.scopeId || 0);
  const assignmentWriteAccess = getPermissionAccess(
    "security.role_assignment.upsert",
    selectedAssignmentScopeId && assignmentPreset.scopeType
      ? {
          scope: {
            scopeType: assignmentPreset.scopeType,
            scopeId: selectedAssignmentScopeId,
          },
        }
      : undefined
  );
  const rawScopeOptions = useMemo(
    () => buildScopeOptions(rawAssignmentForm.scopeType, lookups, tenantScopeId),
    [lookups, rawAssignmentForm.scopeType, tenantScopeId]
  );
  const selectedRawScopeId =
    rawAssignmentForm.scopeType === "TENANT"
      ? tenantScopeId
      : Number(rawAssignmentForm.scopeId || 0);
  const rawAssignmentWriteAccess = getPermissionAccess(
    "security.role_assignment.upsert",
    selectedRawScopeId
      ? {
          scope: {
            scopeType: rawAssignmentForm.scopeType,
            scopeId: selectedRawScopeId,
          },
        }
      : undefined
  );
  useEffect(() => {
    if (filteredBundles.length === 0) {
      setSelectedBundleId("");
      return;
    }
    if (!filteredBundles.some((bundle) => bundle.id === selectedBundleId)) {
      setSelectedBundleId(filteredBundles[0].id);
    }
  }, [filteredBundles, selectedBundleId]);
  useEffect(() => {
    if (!assignmentForm.userId && users.length > 0) {
      setAssignmentForm((prev) => ({ ...prev, userId: String(users[0].id) }));
    }
  }, [assignmentForm.userId, users]);
  useEffect(() => {
    if (!rawAssignmentForm.userId && users.length > 0) {
      setRawAssignmentForm((prev) => ({ ...prev, userId: String(users[0].id) }));
    }
  }, [rawAssignmentForm.userId, users]);
  useEffect(() => {
    setAssignmentForm((prev) => {
      const currentScopeId = Number(prev.scopeId || 0);
      if (
        currentScopeId &&
        assignmentScopeOptions.some((option) => Number(option.id) === currentScopeId)
      ) {
        return prev;
      }
      return {
        ...prev,
        scopeId: String(assignmentScopeOptions[0]?.id || ""),
      };
    });
  }, [assignmentScopeOptions]);
  useEffect(() => {
    setUserModalForm((prev) => {
      if (!userModalOpen) {
        return prev;
      }
      if (!prev.presetCode) {
        return prev;
      }
      const currentScopeId = Number(prev.scopeId || 0);
      if (
        currentScopeId &&
        userModalScopeOptions.some((option) => Number(option.id) === currentScopeId)
      ) {
        return prev;
      }
      return {
        ...prev,
        scopeId: String(userModalScopeOptions[0]?.id || ""),
      };
    });
  }, [userModalOpen, userModalScopeOptions]);
  useEffect(() => {
    setRawAssignmentForm((prev) => {
      const currentScopeId = Number(prev.scopeId || 0);
      if (prev.scopeType === "TENANT") {
        return {
          ...prev,
          scopeId: String(tenantScopeId || ""),
        };
      }
      if (
        currentScopeId &&
        rawScopeOptions.some((option) => Number(option.id) === currentScopeId)
      ) {
        return prev;
      }
      return {
        ...prev,
        scopeId: String(rawScopeOptions[0]?.id || ""),
      };
    });
  }, [rawScopeOptions, tenantScopeId]);
  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [
        usersResponse,
        rolesResponse,
        assignmentsResponse,
        groupsResponse,
        countriesResponse,
        legalEntitiesResponse,
        operatingUnitsResponse,
      ] = await Promise.all([
        listUsers(),
        listRoles({ includePermissions: true }),
        listRoleAssignments(),
        canReadOrgTree ? listGroupCompanies() : Promise.resolve({ rows: [] }),
        canReadOrgTree ? listCountries() : Promise.resolve({ rows: [] }),
        canReadOrgTree ? listLegalEntities() : Promise.resolve({ rows: [] }),
        canReadOrgTree ? listOperatingUnits() : Promise.resolve({ rows: [] }),
      ]);
      setUsers(Array.isArray(usersResponse?.rows) ? usersResponse.rows : []);
      setRoles(Array.isArray(rolesResponse?.rows) ? rolesResponse.rows : []);
      setAssignments(Array.isArray(assignmentsResponse?.rows) ? assignmentsResponse.rows : []);
      setGroups(Array.isArray(groupsResponse?.rows) ? groupsResponse.rows : []);
      setCountries(Array.isArray(countriesResponse?.rows) ? countriesResponse.rows : []);
      setLegalEntities(Array.isArray(legalEntitiesResponse?.rows) ? legalEntitiesResponse.rows : []);
      setOperatingUnits(Array.isArray(operatingUnitsResponse?.rows) ? operatingUnitsResponse.rows : []);
      const [approvalResult, coverageResult] = await Promise.allSettled([
        listApprovalDelegations(),
        getOperationalCoverageWorkspace(),
      ]);
      const delegationErrors = [];
      if (approvalResult.status === "fulfilled") {
        setApprovalDelegations(Array.isArray(approvalResult.value?.rows) ? approvalResult.value.rows : []);
      } else {
        setApprovalDelegations([]);
        delegationErrors.push(
          getErrorMessage(
            approvalResult.reason,
            l(
              "Approval delegation data is not available for this workspace.",
              "Approval delegation verisi bu calisma alaninda kullanilamiyor."
            )
          )
        );
      }
      if (coverageResult.status === "fulfilled") {
        setCoverageRows(Array.isArray(coverageResult.value?.rows) ? coverageResult.value.rows : []);
      } else {
        setCoverageRows([]);
        delegationErrors.push(
          getErrorMessage(
            coverageResult.reason,
            l(
              "Temporary coverage data is not available for this workspace.",
              "Temporary coverage verisi bu calisma alaninda kullanilamiyor."
            )
          )
        );
      }
      setDelegationLoadError(delegationErrors.join(" "));
    } catch (requestError) {
      setError(
        getErrorMessage(
          requestError,
          l(
            "User, role, and assignment data could not be loaded.",
            "Kullanici, rol ve atama verileri yuklenemedi."
          )
        )
      );
    } finally {
      setLoading(false);
    }
  }, [canReadOrgTree, l]);

  useEffect(() => {
    loadData();
  }, [loadData]);
  function openInviteModal() {
    setUserModalMode("invite");
    setUserModalForm({
      userId: "",
      name: "",
      email: "",
      status: "INVITED",
      presetCode: "",
      scopeId: "",
      effectiveFrom: "",
      effectiveTo: "",
      includePostingAuthority: true,
    });
    setUserModalOpen(true);
  }
  function openExistingUserModal(userRow) {
    const userId = Number(userRow?.id || 0);
    const firstBundle = assignmentBundles.find((bundle) => Number(bundle.userId) === userId) || null;
    setUserModalMode("existing");
    setUserModalForm({
      userId: String(userId),
      name: normalizeText(userRow?.name),
      email: normalizeText(userRow?.email),
      status: normalizeText(userRow?.status),
      presetCode: firstBundle?.presetCode || "",
      scopeId: firstBundle ? String(firstBundle.scopeId) : "",
      effectiveFrom: firstBundle?.effectiveFrom || "",
      effectiveTo: firstBundle?.effectiveTo || "",
      includePostingAuthority: Boolean(firstBundle?.optionalRoleCodes?.includes("GLPostingAuthority")),
    });
    setUserModalOpen(true);
  }
  function updateUserModalField(field, value) {
    setUserModalForm((prev) => ({ ...prev, [field]: value }));
  }
  function updateAssignmentField(field, value) {
    setAssignmentForm((prev) => ({ ...prev, [field]: value }));
  }
  function updateRawAssignmentField(field, value) {
    setRawAssignmentForm((prev) => ({ ...prev, [field]: value }));
  }
  async function copyInviteLink() {
    if (!lastInviteLink) {
      return;
    }
    try {
      await navigator.clipboard.writeText(lastInviteLink);
      setMessage(l("Invite link copied.", "Davet baglantisi kopyalandi."));
    } catch {
      setError(l("Invite link could not be copied.", "Davet baglantisi kopyalanamadi."));
    }
  }
  async function applyPresetAssignments({
    targetUserId,
    presetCode,
    scopeId,
    includePostingAuthority,
    effectiveFrom,
    effectiveTo,
  }) {
    const roleCodes = buildTemplateRoleCodes(presetCode, includePostingAuthority);
    const missingRoleCodes = roleCodes.filter((roleCode) => !rolesByCode.get(roleCode));
    if (missingRoleCodes.length > 0) {
      throw new Error(
        l(
          "Preset roles missing from tenant catalog: {{roles}}",
          "Tenant katalogunda eksik preset rolleri: {{roles}}",
          { roles: missingRoleCodes.join(", ") }
        )
      );
    }
    const preset = getBootstrapHandoffPresetEntry(presetCode);
    const collectedWarnings = [];
    // The backend persists one role assignment row at a time. This fan-out keeps
    // the existing RBAC validation and audit logic intact while the UI presents
    // one calm business assignment instead of many scattered raw rows.
    for (const roleCode of roleCodes) {
      const role = rolesByCode.get(roleCode);
      const response = await createRoleAssignment({
        userId: targetUserId,
        roleId: Number(role.id),
        scopeType: preset.scopeType,
        scopeId: Number(scopeId),
        effect: "ALLOW",
        effectiveFrom: effectiveFrom || undefined,
        effectiveTo: effectiveTo || undefined,
      });
      for (const warning of response?.assignmentWarnings || []) {
        const text =
          typeof warning === "string"
            ? warning
            : normalizeText(warning?.message || warning?.reason);
        if (text) {
          collectedWarnings.push(text);
        }
      }
    }
    return Array.from(new Set(collectedWarnings));
  }
  async function handleSaveUserModal(event) {
    event.preventDefault();
    const isInvite = userModalMode === "invite";
    const hasPreset = Boolean(normalizeText(userModalForm.presetCode));
    if (isInvite) {
      if (!normalizeText(userModalForm.name) || !normalizeText(userModalForm.email)) {
        setError(
          l(
            "Full name and email are required before sending an invite.",
            "Davet gondermeden once ad soyad ve e-posta zorunludur."
          )
        );
        return;
      }
    } else if (!normalizeText(userModalForm.userId)) {
      setError(l("Select a user first.", "Once bir kullanici secin."));
      return;
    }
    if (hasPreset) {
      const numericScopeId = Number(userModalForm.scopeId || 0);
      if (!numericScopeId) {
        setError(l("Choose a scope for the selected template.", "Secilen template icin bir kapsam secin."));
        return;
      }
      if (!userModalAccess.allowed) {
        setError(l("You do not have permission to apply this access scope.", "Bu erisim kapsamını uygulama yetkiniz yok."));
        return;
      }
    } else if (!isInvite) {
      setError(
        l(
          "Choose a role template to add access for this user.",
          "Bu kullaniciya erisim eklemek icin bir rol template'i secin."
        )
      );
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    setWarningMessages([]);
    let targetUserId = Number(userModalForm.userId || 0);
    let inviteUrl = "";
    try {
      if (isInvite) {
        const inviteResponse = await createSecurityInvite({
          name: normalizeText(userModalForm.name),
          email: normalizeText(userModalForm.email),
        });
        targetUserId = Number(inviteResponse?.invite?.userId || 0);
        inviteUrl = normalizeText(inviteResponse?.invite?.inviteUrl);
        setLastInviteLink(inviteUrl);
      }
      if (!targetUserId) {
        throw new Error(
          l(
            "The target user could not be resolved for this save action.",
            "Bu kaydetme aksiyonu icin hedef kullanici cozulemedi."
          )
        );
      }
      let warnings = [];
      if (hasPreset) {
        warnings = await applyPresetAssignments({
          targetUserId,
          presetCode: userModalForm.presetCode,
          scopeId: Number(userModalForm.scopeId),
          includePostingAuthority: Boolean(userModalForm.includePostingAuthority),
          effectiveFrom: userModalForm.effectiveFrom,
          effectiveTo: userModalForm.effectiveTo,
        });
      }
      setWarningMessages(warnings);
      setMessage(
        isInvite
          ? hasPreset
            ? l("Invite created and access template applied.", "Davet olusturuldu ve erisim template'i uygulandi.")
            : l("Invite created.", "Davet olusturuldu.")
          : l("Access template applied.", "Erisim template'i uygulandi.")
      );
      setUserModalOpen(false);
      await loadData();
    } catch (requestError) {
      if (inviteUrl) {
        setLastInviteLink(inviteUrl);
      }
      setError(
        getErrorMessage(
          requestError,
          l("The user workspace action could not be completed.", "Kullanici calisma alani aksiyonu tamamlanamadi.")
        )
      );
    } finally {
      setSaving(false);
    }
  }
  async function handleCreatePresetAssignment(event) {
    event.preventDefault();
    if (!normalizeText(assignmentForm.userId)) {
      setError(l("Choose an assignee first.", "Once bir atanan kisi secin."));
      return;
    }
    if (!normalizeText(assignmentForm.presetCode)) {
      setError(l("Choose a business preset first.", "Once bir is preset'i secin."));
      return;
    }
    if (!Number(assignmentForm.scopeId || 0)) {
      setError(l("Choose a scope before saving.", "Kaydetmeden once bir kapsam secin."));
      return;
    }
    if (!assignmentWriteAccess.allowed) {
      setError(l("You do not have permission to save this assignment scope.", "Bu atama kapsamını kaydetme yetkiniz yok."));
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    setWarningMessages([]);
    try {
      const warnings = await applyPresetAssignments({
        targetUserId: Number(assignmentForm.userId),
        presetCode: assignmentForm.presetCode,
        scopeId: Number(assignmentForm.scopeId),
        includePostingAuthority: Boolean(assignmentForm.includePostingAuthority),
        effectiveFrom: assignmentForm.effectiveFrom,
        effectiveTo: assignmentForm.effectiveTo,
      });
      setWarningMessages(warnings);
      setMessage(l("Business assignment created.", "Is atamasi olusturuldu."));
      await loadData();
    } catch (requestError) {
      setError(
        getErrorMessage(
          requestError,
          l("The business assignment could not be created.", "Is atamasi olusturulamadi.")
        )
      );
    } finally {
      setSaving(false);
    }
  }
  async function handleCreateRawAssignment(event) {
    event.preventDefault();
    if (!normalizeText(rawAssignmentForm.userId) || !normalizeText(rawAssignmentForm.roleId)) {
      setError(l("Choose both a user and a role for the raw assignment.", "Ham atama icin hem kullanici hem de rol secin."));
      return;
    }
    if (!selectedRawScopeId) {
      setError(l("Choose a valid raw-assignment scope.", "Gecerli bir ham atama kapsami secin."));
      return;
    }
    if (!rawAssignmentWriteAccess.allowed) {
      setError(l("You do not have permission to create this raw role row.", "Bu ham rol satirini olusturma yetkiniz yok."));
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    setWarningMessages([]);
    try {
      const response = await createRoleAssignment({
        userId: Number(rawAssignmentForm.userId),
        roleId: Number(rawAssignmentForm.roleId),
        scopeType: rawAssignmentForm.scopeType,
        scopeId: selectedRawScopeId,
        effect: rawAssignmentForm.effect,
        effectiveFrom: rawAssignmentForm.effectiveFrom || undefined,
        effectiveTo: rawAssignmentForm.effectiveTo || undefined,
      });
      setWarningMessages(response?.assignmentWarnings || []);
      setMessage(l("Raw role row created.", "Ham rol satiri olusturuldu."));
      await loadData();
    } catch (requestError) {
      setError(
        getErrorMessage(
          requestError,
          l("The raw role row could not be created.", "Ham rol satiri olusturulamadi.")
        )
      );
    } finally {
      setSaving(false);
    }
  }
  async function handleRevokeBundle(bundle) {
    if (!bundle) {
      return;
    }
    const revokeAccess = getPermissionAccess(
      "security.role_assignment.upsert",
      bundle.scopeId
        ? {
            scope: {
              scopeType: bundle.scopeType,
              scopeId: bundle.scopeId,
            },
          }
        : undefined
    );
    if (!revokeAccess.allowed) {
      setError(l("You do not have permission to revoke this assignment bundle.", "Bu atama paketini geri alma yetkiniz yok."));
      return;
    }
    const confirmed = window.confirm(
      l(
        "Revoke the whole business assignment bundle for this user and scope?",
        "Bu kullanici ve kapsam icin tum is atama paketini geri almak istiyor musunuz?"
      )
    );
    if (!confirmed) {
      return;
    }
    setActingRowId(bundle.id);
    setSaving(true);
    setError("");
    setMessage("");
    setWarningMessages([]);
    try {
      for (const assignmentId of bundle.assignmentIds) {
        await deleteRoleAssignment(assignmentId);
      }
      setMessage(l("Business assignment revoked.", "Is atamasi geri alindi."));
      await loadData();
    } catch (requestError) {
      setError(
        getErrorMessage(
          requestError,
          l("The business assignment bundle could not be revoked.", "Is atama paketi geri alinamadi.")
        )
      );
    } finally {
      setActingRowId("");
      setSaving(false);
    }
  }
  async function handleRevokeApproval(row) {
    const delegationId = Number(row?.id || 0);
    if (!delegationId) {
      return;
    }
    const confirmed = window.confirm(
      l(
        "Revoke this approval delegation?",
        "Bu approval delegation kaydini geri almak istiyor musunuz?"
      )
    );
    if (!confirmed) {
      return;
    }
    setActingRowId(`approval-${delegationId}`);
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await revokeApprovalDelegation(delegationId);
      setMessage(l("Approval delegation revoked.", "Approval delegation geri alindi."));
      await loadData();
    } catch (requestError) {
      setError(
        getErrorMessage(
          requestError,
          l("Approval delegation could not be revoked.", "Approval delegation geri alinamadi.")
        )
      );
    } finally {
      setActingRowId("");
      setSaving(false);
    }
  }
  async function handleRevokeCoverage(row) {
    const coverageId = Number(row?.id || 0);
    if (!coverageId) {
      return;
    }
    const confirmed = window.confirm(
      l(
        "Revoke this temporary coverage request?",
        "Bu temporary coverage kaydini geri almak istiyor musunuz?"
      )
    );
    if (!confirmed) {
      return;
    }
    setActingRowId(`coverage-${coverageId}`);
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await revokeOperationalCoverage(coverageId);
      setMessage(l("Temporary coverage revoked.", "Temporary coverage geri alindi."));
      await loadData();
    } catch (requestError) {
      setError(
        getErrorMessage(
          requestError,
          l("Temporary coverage could not be revoked.", "Temporary coverage geri alinamadi.")
        )
      );
    } finally {
      setActingRowId("");
      setSaving(false);
    }
  }
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-4xl">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
            {l("User, Assignment & Delegation Management", "Kullanici, Atama ve Delegation Yonetimi")}
          </h1>
          <p className="mt-2 text-sm leading-7 text-slate-600">
            {l(
              "Merged admin workspace: keep the people directory, preset-based business assignments, and delegation operations in one calm shell instead of scattering them across unrelated settings screens.",
              "Birlesik yonetim calisma alani: kisi dizinini, preset tabanli is atamalarini ve delegation operasyonlarini ilgisiz ayarlar ekranlarina dagitmak yerine tek bir sakin kabukta toplayin."
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            to="/app/ayarlar/rbac/delegations"
            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700"
          >
            {l("Open approval delegations", "Approval delegation sayfasini ac")}
          </Link>
          <button
            type="button"
            onClick={openInviteModal}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700"
          >
            {l("Invite user", "Kullanici davet et")}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("assignments")}
            className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white"
          >
            {l("Assign setup owner", "Setup sahibi ata")}
          </button>
        </div>
      </div>
      <section className="grid gap-4 xl:grid-cols-4">
        <WorkspaceStatCard
          title={l("Total users", "Toplam kullanici")}
          value={users.length}
          subtitle={l("All active, invited, and disabled users inside this tenant.", "Bu tenant icindeki tum aktif, davetli ve devre disi kullanicilar.")}
          tone="blue"
        />
        <WorkspaceStatCard
          title={l("Business assignments", "Is atamalari")}
          value={assignmentBundles.length}
          subtitle={l("Grouped business-first bundles instead of one row per raw RBAC role.", "Ham RBAC rol basina bir satir yerine gruplanmis is-oncelikli paketler.")}
          tone="green"
        />
        <WorkspaceStatCard
          title={l("Pending invites", "Bekleyen davetler")}
          value={pendingInviteRows.length}
          subtitle={l("Invite flows that still need acceptance before the user becomes active.", "Kullanici aktif olmadan once hala kabul bekleyen davet akisleri.")}
          tone="amber"
        />
        <WorkspaceStatCard
          title={l("Delegation workflows", "Delegation akislari")}
          value={totalDelegationCount}
          subtitle={l("Approval delegation and temporary coverage items still in motion.", "Hareket halindeki approval delegation ve temporary coverage kayitlari.")}
        />
      </section>
      {showFreshTenantAdminNote ? (
        <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          {l(
            "Fresh-tenant role admin mode is active. Keep template assignment primary and use raw role rows only for deliberate exceptions.",
            "Fresh-tenant rol yonetimi modu aktif. Template atamasini birincil tutun; ham rol satirlarini yalnizca bilincli istisnalar icin kullanin."
          )}
        </div>
      ) : null}
      {!roleAssignmentReadAccess.allowed ? (
        <PermissionAccessNotice
          access={roleAssignmentReadAccess}
          permissionCode="security.role_assignment.read"
        />
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
      {lastInviteLink ? (
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-900">
          <div className="min-w-0 flex-1">
            <div className="font-semibold">{l("Latest invite link", "Son davet baglantisi")}</div>
            <div className="mt-2 break-all">{lastInviteLink}</div>
          </div>
          <button
            type="button"
            onClick={copyInviteLink}
            className="rounded-xl border border-emerald-300 bg-white px-4 py-2 text-sm font-semibold text-emerald-900"
          >
            {l("Copy link", "Baglantiyi kopyala")}
          </button>
        </div>
      ) : null}
      <SecurityWarningList warnings={warningMessages} />
      <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap gap-3">
          <WorkspaceTabButton
            active={activeTab === "users"}
            count={userDirectoryRows.length}
            label={l("Users", "Kullanicilar")}
            onClick={() => setActiveTab("users")}
          />
          <WorkspaceTabButton
            active={activeTab === "assignments"}
            count={assignmentBundles.length}
            label={l("Business Assignments", "Is Atamalari")}
            onClick={() => setActiveTab("assignments")}
          />
          <WorkspaceTabButton
            active={activeTab === "delegations"}
            count={totalDelegationCount}
            label={l("Delegations", "Delegation")}
            onClick={() => setActiveTab("delegations")}
          />
        </div>
      </section>
      {loading ? (
        <div className="rounded-[28px] border border-slate-200 bg-white px-5 py-12 text-sm text-slate-500 shadow-sm">
          {l("Loading workspace...", "Calisma alani yukleniyor...")}
        </div>
      ) : null}
      {!loading && activeTab === "users" ? (
        <section className="space-y-5">
          <div className="grid gap-3 rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm xl:grid-cols-[1.3fr_repeat(4,minmax(0,0.8fr))]">
            <input
              type="text"
              value={userFilters.search}
              onChange={(event) =>
                setUserFilters((prev) => ({ ...prev, search: event.target.value }))
              }
              placeholder={l(
                "Search by name, email, entity, branch, or preset",
                "Ad, e-posta, entity, sube veya presete gore ara"
              )}
              className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
            />
            <select
              value={userFilters.scopeType}
              onChange={(event) =>
                setUserFilters((prev) => ({ ...prev, scopeType: event.target.value }))
              }
              className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
            >
              <option value="">{l("All scopes", "Tum kapsamlar")}</option>
              {SCOPE_TYPES.map((scopeType) => (
                <option key={`user-scope-${scopeType}`} value={scopeType}>
                  {scopeType}
                </option>
              ))}
            </select>
            <select
              value={userFilters.roleCode}
              onChange={(event) =>
                setUserFilters((prev) => ({ ...prev, roleCode: event.target.value }))
              }
              className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
            >
              <option value="">{l("All roles", "Tum roller")}</option>
              {roles.map((role) => (
                <option key={`user-role-filter-${role.id}`} value={role.code}>
                  {getRoleDisplayCode(role)}
                </option>
              ))}
            </select>
            <select
              value={userFilters.status}
              onChange={(event) =>
                setUserFilters((prev) => ({ ...prev, status: event.target.value }))
              }
              className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
            >
              {USER_STATUS_FILTERS.map((status) => (
                <option key={`user-status-${status}`} value={status}>
                  {status === "ALL"
                    ? l("All statuses", "Tum durumlar")
                    : status === "INVITED"
                      ? l("Pending invite", "Bekleyen davet")
                      : status}
                </option>
              ))}
            </select>
            <select
              value={userFilters.delegationState}
              onChange={(event) =>
                setUserFilters((prev) => ({ ...prev, delegationState: event.target.value }))
              }
              className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
            >
              <option value="">{l("All delegation states", "Tum delegation durumlari")}</option>
              <option value="HAS_DELEGATION">{l("Has delegation", "Delegation var")}</option>
              <option value="NO_DELEGATION">{l("No delegation", "Delegation yok")}</option>
            </select>
          </div>
          <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 bg-slate-50 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">
                  {l("People directory", "Kisi dizini")}
                </h2>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
                  {l(
                    "Use this surface for full user admin work: invite, review scope coverage, inspect current access, and jump directly into assignment or delegation follow-up.",
                    "Bu yuzeyi tam kullanici yonetimi icin kullanin: davet etme, kapsam kapsamasi inceleme, mevcut erisimi denetleme ve dogrudan atama veya delegation takibine gecme."
                  )}
                </p>
              </div>
              <StatusPill label={l("Directory view", "Dizin gorunumu")} />
            </div>
            {filteredUsers.length === 0 ? (
              <div className="px-5 py-10 text-sm text-slate-500">
                {l("No users match the current filters.", "Mevcut filtrelere uyan kullanici yok.")}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200">
                  <thead className="bg-white">
                    <tr className="text-left text-[11px] uppercase tracking-[0.16em] text-slate-500">
                      <th className="px-5 py-3">{l("User", "Kullanici")}</th>
                      <th className="px-5 py-3">{l("Role", "Rol")}</th>
                      <th className="px-5 py-3">{l("Scope", "Kapsam")}</th>
                      <th className="px-5 py-3">{l("Access", "Erisim")}</th>
                      <th className="px-5 py-3">{l("Status", "Durum")}</th>
                      <th className="px-5 py-3">{l("Delegation", "Delegation")}</th>
                      <th className="px-5 py-3">{l("Last created", "Son olusum")}</th>
                      <th className="px-5 py-3">{l("Actions", "Aksiyonlar")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {filteredUsers.map((row) => {
                      const statusMeta = getUserStatusMeta(row.status);
                      return (
                        <tr key={`user-row-${row.id}`}>
                          <td className="px-5 py-4">
                            <div className="flex items-start gap-3">
                              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-100 text-sm font-bold text-sky-800">
                                {getInitials(row.name)}
                              </div>
                              <div>
                                <div className="font-semibold text-slate-950">{row.name}</div>
                                <div className="mt-1 text-sm text-slate-500">{row.email}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-4">
                            <div className="space-y-2">
                              {row.currentPresetCodes.length > 0 ? (
                                row.currentPresetCodes.map((presetCode) => (
                                  <StatusPill
                                    key={`user-preset-${row.id}-${presetCode}`}
                                    label={presetCode}
                                    tone="blue"
                                  />
                                ))
                              ) : row.topRoleCodes.length > 0 ? (
                                row.topRoleCodes.map((roleCode) => (
                                  <StatusPill
                                    key={`user-role-${row.id}-${roleCode}`}
                                    label={getRoleDisplayCode(roleCode)}
                                  />
                                ))
                              ) : (
                                <span className="text-sm text-slate-500">
                                  {l("No assigned roles", "Atanmis rol yok")}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-5 py-4">
                            <div className="space-y-1 text-sm text-slate-700">
                              {row.topScopeLabels.length > 0 ? (
                                row.topScopeLabels.map((scopeLabel) => (
                                  <div key={`user-scope-${row.id}-${scopeLabel}`}>{scopeLabel}</div>
                                ))
                              ) : (
                                <div className="text-slate-500">{l("No active scope", "Aktif kapsam yok")}</div>
                              )}
                            </div>
                          </td>
                          <td className="px-5 py-4 text-sm text-slate-700">
                            <div>{row.assignmentCount} {l("assignment bundles", "atama paketi")}</div>
                            <div className="mt-1 text-slate-500">
                              {row.scopeCount} {l("scopes covered", "kapsam")}
                            </div>
                          </td>
                          <td className="px-5 py-4">
                            <StatusPill label={statusMeta.label} tone={statusMeta.tone} />
                          </td>
                          <td className="px-5 py-4 text-sm text-slate-700">
                            {row.activeDelegationCount > 0 ? (
                              <StatusPill
                                label={l("{{count}} active", "{{count}} aktif", {
                                  count: row.activeDelegationCount,
                                })}
                                tone="violet"
                              />
                            ) : (
                              <span className="text-slate-500">{l("None", "Yok")}</span>
                            )}
                          </td>
                          <td className="px-5 py-4 text-sm text-slate-500">
                            {formatDateTime(row.created_at)}
                          </td>
                          <td className="px-5 py-4">
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => openExistingUserModal(row)}
                                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700"
                              >
                                {l("Edit access", "Erisimi duzenle")}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setAssignmentForm((prev) => ({
                                    ...prev,
                                    userId: String(row.id),
                                  }));
                                  setActiveTab("assignments");
                                }}
                                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700"
                              >
                                {l("Assignments", "Atamalar")}
                              </button>
                              <button
                                type="button"
                                onClick={() => setActiveTab("delegations")}
                                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700"
                              >
                                {l("Delegations", "Delegation")}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      ) : null}
      {!loading && activeTab === "assignments" ? (
        <section className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_400px]">
            <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 bg-slate-50 px-5 py-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">
                    {l("Business assignments", "Is atamalari")}
                  </h2>
                  <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
                    {l(
                      "Review one row per business responsibility, not one row per underlying RBAC role. Drill into the row only when you need the raw role detail.",
                      "Alttaki her RBAC rol satiri yerine her is sorumlulugu icin tek satir inceleyin. Ham rol detayina sadece ihtiyaciniz oldugunda derine inin."
                    )}
                  </p>
                </div>
                <StatusPill label={l("Preset-based", "Preset tabanli")} tone="blue" />
              </div>
              <div className="grid gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4 md:grid-cols-[minmax(0,1fr)_180px_180px]">
                <input
                  type="text"
                  value={assignmentFilters.search}
                  onChange={(event) =>
                    setAssignmentFilters((prev) => ({ ...prev, search: event.target.value }))
                  }
                  placeholder={l("Search by assignee, preset, or scope", "Atanan kisi, preset veya kapsama gore ara")}
                  className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
                />
                <select
                  value={assignmentFilters.presetCode}
                  onChange={(event) =>
                    setAssignmentFilters((prev) => ({ ...prev, presetCode: event.target.value }))
                  }
                  className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
                >
                  <option value="">{l("All presets", "Tum presetler")}</option>
                  {Object.keys(BOOTSTRAP_HANDOFF_PRESET_CATALOG).map((presetCode) => (
                    <option key={`assignment-preset-${presetCode}`} value={presetCode}>
                      {presetCode}
                    </option>
                  ))}
                  <option value="__custom__">{l("Custom bundle", "Ozel paket")}</option>
                </select>
                <select
                  value={assignmentFilters.status}
                  onChange={(event) =>
                    setAssignmentFilters((prev) => ({ ...prev, status: event.target.value }))
                  }
                  className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
                >
                  {ASSIGNMENT_STATUS_FILTERS.map((status) => (
                    <option key={`assignment-status-${status}`} value={status}>
                      {status === "ALL"
                        ? l("All statuses", "Tum durumlar")
                        : status === "UPCOMING"
                          ? l("Scheduled", "Planlandi")
                          : status === "CUSTOM"
                            ? l("Custom", "Ozel")
                            : status}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-3 px-5 py-5">
                {filteredBundles.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">
                    {l("No assignment bundles match the current filters.", "Mevcut filtrelere uyan atama paketi yok.")}
                  </div>
                ) : (
                  filteredBundles.map((bundle) => (
                    <AssignmentBundleCard
                      key={bundle.id}
                      bundle={bundle}
                      expanded={selectedBundle?.id === bundle.id}
                      l={l}
                      onSelect={setSelectedBundleId}
                      onOpenUser={(userId) => {
                        const userRow = usersById.get(Number(userId));
                        if (userRow) {
                          openExistingUserModal(userRow);
                        }
                      }}
                      onRevoke={handleRevokeBundle}
                      revoking={saving && actingRowId === bundle.id}
                    />
                  ))
                )}
              </div>
            </div>
            <aside className="xl:sticky xl:top-20 xl:self-start">
              <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 px-5 py-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    {l("Assignment drawer", "Atama cekmecesi")}
                  </div>
                  <h2 className="mt-2 text-xl font-semibold text-slate-950">
                    {l("Assign setup owner", "Setup sahibi ata")}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {l(
                      "Capture the business decision once: who owns which setup responsibility, at which scope, plus any explicit posting add-on.",
                      "Is kararini bir kez yakalayin: hangi setup sorumlulugu kimde, hangi kapsamda ve acik bir posting eklentisi var mi."
                    )}
                  </p>
                </div>
                <form onSubmit={handleCreatePresetAssignment} className="space-y-5 px-5 py-5">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700">{l("Preset", "Preset")}</label>
                    <select
                      value={assignmentForm.presetCode}
                      onChange={(event) => updateAssignmentField("presetCode", event.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
                    >
                      {Object.keys(BOOTSTRAP_HANDOFF_PRESET_CATALOG).map((presetCode) => (
                        <option key={`drawer-preset-${presetCode}`} value={presetCode}>
                          {presetCode}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700">{l("Assignee", "Atanan kisi")}</label>
                    <select
                      value={assignmentForm.userId}
                      onChange={(event) => updateAssignmentField("userId", event.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
                    >
                      {users.map((row) => (
                        <option key={`drawer-user-${row.id}`} value={String(row.id)}>
                          {row.name} - {row.email}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700">
                      {l("Scope", "Kapsam")} ({assignmentPreset.scopeType})
                    </label>
                    <select
                      value={assignmentForm.scopeId}
                      onChange={(event) => updateAssignmentField("scopeId", event.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
                    >
                      {assignmentScopeOptions.map((option) => (
                        <option key={`drawer-scope-${option.id}`} value={String(option.id)}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-slate-700">{l("Effective from", "Baslangic tarihi")}</label>
                      <input
                        type="date"
                        value={assignmentForm.effectiveFrom}
                        onChange={(event) => updateAssignmentField("effectiveFrom", event.target.value)}
                        className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-slate-700">{l("Effective to", "Bitis tarihi")}</label>
                      <input
                        type="date"
                        value={assignmentForm.effectiveTo}
                        onChange={(event) => updateAssignmentField("effectiveTo", event.target.value)}
                        className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
                      />
                    </div>
                  </div>
                  <label className="flex items-start gap-3 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-4">
                    <input
                      type="checkbox"
                      checked={Boolean(assignmentForm.includePostingAuthority)}
                      onChange={(event) =>
                        updateAssignmentField("includePostingAuthority", event.target.checked)
                      }
                      className="mt-1 h-4 w-4 rounded border-slate-300 text-violet-600"
                    />
                    <span>
                      <span className="block text-sm font-semibold text-violet-950">
                        {l("Include GL posting authority", "GL posting authority dahil et")}
                      </span>
                      <span className="mt-1 block text-sm leading-6 text-violet-900">
                        {l(
                          "Keep posting authority explicit instead of hiding it as an automatic side effect of the preset.",
                          "Posting yetkisini preset'in otomatik bir yan etkisi olarak gizlemek yerine acik tutun."
                        )}
                      </span>
                    </span>
                  </label>
                  <PermissionAccessNotice
                    access={assignmentWriteAccess}
                    permissionCode="security.role_assignment.upsert"
                  />
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      {l("Review before save", "Kaydetmeden once incele")}
                    </div>
                    <div className="mt-3 space-y-3 text-sm text-slate-700">
                      <div className="flex items-start justify-between gap-3">
                        <span>{l("Preset", "Preset")}</span>
                        <strong className="text-right text-slate-950">{assignmentForm.presetCode}</strong>
                      </div>
                      <div className="flex items-start justify-between gap-3">
                        <span>{l("Assignee", "Atanan kisi")}</span>
                        <strong className="text-right text-slate-950">
                          {usersById.get(Number(assignmentForm.userId || 0))?.name || "-"}
                        </strong>
                      </div>
                      <div className="flex items-start justify-between gap-3">
                        <span>{l("Scope", "Kapsam")}</span>
                        <strong className="text-right text-slate-950">
                          {assignmentScopeOptions.find(
                            (option) => Number(option.id) === Number(assignmentForm.scopeId || 0)
                          )?.label || "-"}
                        </strong>
                      </div>
                      <div className="flex items-start justify-between gap-3">
                        <span>{l("Underlying role rows", "Alttaki rol satirlari")}</span>
                        <strong className="text-right text-slate-950">{assignmentRoleCodes.length}</strong>
                      </div>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      {l("Included roles", "Dahil roller")}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {assignmentRoleEntries.map((entry) => (
                        <span
                          key={`drawer-role-${entry.code}`}
                          className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700"
                        >
                          {entry.code}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="submit"
                      disabled={saving}
                      className="flex-1 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {saving
                        ? l("Saving...", "Kaydediliyor...")
                        : l("Create preset assignment", "Preset atamasi olustur")}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setAssignmentForm((prev) => ({
                          ...prev,
                          effectiveFrom: "",
                          effectiveTo: "",
                        }))
                      }
                      className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700"
                    >
                      {l("Clear dates", "Tarihleri temizle")}
                    </button>
                  </div>
                </form>
                <details className="border-t border-slate-200 px-5 py-5">
                  <summary className="cursor-pointer text-sm font-semibold text-slate-900">
                    {l("Advanced raw role row", "Gelismis ham rol satiri")}
                  </summary>
                  <form onSubmit={handleCreateRawAssignment} className="mt-4 space-y-4">
                    <p className="text-sm leading-6 text-slate-600">
                      {l(
                        "Use this only for deliberate exceptions. The business-first preset flow above should remain the normal admin path.",
                        "Bunu yalnizca bilincli istisnalar icin kullanin. Yukaridaki is-oncelikli preset akisi normal yonetici yolu olarak kalmalidir."
                      )}
                    </p>
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-slate-700">{l("User", "Kullanici")}</label>
                      <select
                        value={rawAssignmentForm.userId}
                        onChange={(event) => updateRawAssignmentField("userId", event.target.value)}
                        className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
                      >
                        {users.map((row) => (
                          <option key={`raw-user-${row.id}`} value={String(row.id)}>
                            {row.name} - {row.email}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-slate-700">{l("Role", "Rol")}</label>
                      <select
                        value={rawAssignmentForm.roleId}
                        onChange={(event) => updateRawAssignmentField("roleId", event.target.value)}
                        className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
                      >
                        <option value="">{l("Choose role", "Rol secin")}</option>
                        {assignableRoleGroups.map((group) => (
                          <optgroup key={`raw-role-group-${group.key}`} label={group.label}>
                            {group.roles.map((role) => (
                              <option key={`raw-role-${role.id}`} value={String(role.id)}>
                                {getRoleDisplayCode(role)}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                      <p className="text-xs leading-5 text-slate-500">
                        {l(
                          "Retired compatibility roles are hidden here for new assignments. Existing legacy assignments still remain visible for review and cleanup.",
                          "Yeni atamalar icin kullanimi birakilan uyumluluk rolleri burada gizlenir. Mevcut legacy atamalar ise inceleme ve temizlik icin gorunur kalir."
                        )}
                      </p>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <label className="text-sm font-semibold text-slate-700">{l("Scope type", "Kapsam tipi")}</label>
                        <select
                          value={rawAssignmentForm.scopeType}
                          onChange={(event) => updateRawAssignmentField("scopeType", event.target.value)}
                          className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
                        >
                          {SCOPE_TYPES.map((scopeType) => (
                            <option key={`raw-scope-type-${scopeType}`} value={scopeType}>
                              {scopeType}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-semibold text-slate-700">{l("Effect", "Etki")}</label>
                        <select
                          value={rawAssignmentForm.effect}
                          onChange={(event) => updateRawAssignmentField("effect", event.target.value)}
                          className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
                        >
                          {EFFECT_OPTIONS.map((effect) => (
                            <option key={`raw-effect-${effect}`} value={effect}>
                              {effect}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-slate-700">{l("Scope", "Kapsam")}</label>
                      <select
                        value={rawAssignmentForm.scopeId}
                        onChange={(event) => updateRawAssignmentField("scopeId", event.target.value)}
                        className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
                      >
                        {rawScopeOptions.map((option) => (
                          <option key={`raw-scope-${option.id}`} value={String(option.id)}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <PermissionAccessNotice
                      access={rawAssignmentWriteAccess}
                      permissionCode="security.role_assignment.upsert"
                    />
                    <button
                      type="submit"
                      disabled={saving}
                      className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {saving
                        ? l("Saving...", "Kaydediliyor...")
                        : l("Create raw role row", "Ham rol satiri olustur")}
                    </button>
                  </form>
                </details>
              </div>
            </aside>
          </div>
          <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 bg-slate-50 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">
                  {l("Pending invites", "Bekleyen davetler")}
                </h2>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
                  {l(
                    "Invites stay separate from live assignments, but still point to the same user onboarding and setup-owner flows.",
                    "Davetler canli atamalardan ayri kalir; ancak yine de ayni kullanici onboarding ve setup sahibi akislerine isaret eder."
                  )}
                </p>
              </div>
              <StatusPill
                label={String(pendingInviteRows.length)}
                tone={pendingInviteRows.length > 0 ? "amber" : "slate"}
              />
            </div>
            <div className="space-y-3 px-5 py-5">
              {pendingInviteRows.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">
                  {l("No pending invites.", "Bekleyen davet yok.")}
                </div>
              ) : (
                pendingInviteRows.map((row) => (
                  <div
                    key={`pending-invite-${row.id}`}
                    className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4"
                  >
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{row.name}</div>
                      <div className="mt-1 text-xs text-slate-500">{row.email}</div>
                      <div className="mt-2 text-xs text-slate-600">
                        {l("Created", "Olusturuldu")} {formatDateTime(row.created_at)}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => openExistingUserModal(row)}
                        className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
                      >
                        {l("Open user editor", "Kullanici editorunu ac")}
                      </button>
                      {lastInviteLink ? (
                        <button
                          type="button"
                          onClick={copyInviteLink}
                          className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800"
                        >
                          {l("Copy latest link", "Son baglantiyi kopyala")}
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      ) : null}
      {!loading && activeTab === "delegations" ? (
        <section className="space-y-5">
          <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 bg-slate-50 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">
                  {l("Delegations", "Delegation")}
                </h2>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
                  {l(
                    "Keep approval delegation and temporary coverage visible as separate admin-controlled objects with dates, scope, and revocation actions.",
                    "Approval delegation ve temporary coverage kayitlarini tarih, kapsam ve geri alma aksiyonlariyla ayrik yonetici nesneleri olarak gorunur tutun."
                  )}
                </p>
              </div>
              <StatusPill label={l("Coverage + approval", "Coverage + approval")} tone="violet" />
            </div>
            <div className="flex flex-wrap gap-3 px-5 pt-5">
              <WorkspaceTabButton
                active={delegationTab === "coverage"}
                count={coverageRows.length}
                label={l("Temporary coverage", "Temporary coverage")}
                onClick={() => setDelegationTab("coverage")}
              />
              <WorkspaceTabButton
                active={delegationTab === "approval"}
                count={approvalDelegations.length}
                label={l("Approval delegation", "Approval delegation")}
                onClick={() => setDelegationTab("approval")}
              />
            </div>
            {delegationLoadError ? (
              <div className="px-5 pt-5 text-sm text-amber-700">{delegationLoadError}</div>
            ) : null}
            <div className="space-y-3 px-5 py-5">
              {delegationTab === "coverage" ? (
                coverageRows.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">
                    {l("No temporary coverage items.", "Temporary coverage kaydi yok.")}
                  </div>
                ) : (
                  coverageRows.map((row) => {
                    const reviewMeta = getCoverageReviewMeta(row.reviewStatus);
                    const revokeAccess = getPermissionAccess(
                      "approvals.policies.write",
                      row?.scopeType && Number(row?.scopeId || 0)
                        ? {
                            scope: {
                              scopeType: row.scopeType,
                              scopeId: Number(row.scopeId),
                            },
                          }
                        : undefined
                    );
                    return (
                      <div
                        key={`coverage-row-${row.id}`}
                        className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-4"
                      >
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-sm font-semibold text-slate-950">
                              {row.roleCode || row.role_code || l("Coverage request", "Coverage talebi")}
                            </div>
                            <StatusPill label={reviewMeta.label} tone={reviewMeta.tone} />
                            <StatusPill
                              label={normalizeText(row.state) || l("Unknown", "Bilinmiyor")}
                              tone={
                                normalizeText(row.state).toUpperCase() === "ACTIVE"
                                  ? "green"
                                  : normalizeText(row.state).toUpperCase() === "REQUESTED"
                                    ? "amber"
                                    : normalizeText(row.state).toUpperCase() === "APPROVED"
                                      ? "blue"
                                      : "slate"
                              }
                            />
                          </div>
                          <div className="text-sm text-slate-700">
                            {normalizeText(row.delegateUserName || row.delegateUserEmail || row.delegateEmail) ||
                              l("Pending delegate resolution", "Bekleyen delege cozumleme")}
                          </div>
                          <div className="text-xs text-slate-500">
                            {l("Requester", "Talep eden")}{" "}
                            {normalizeText(row.requesterUserName || row.requesterUserEmail) || "-"}
                          </div>
                          <div className="text-xs text-slate-500">
                            {formatDate(row.startDate)} to {formatDate(row.endDate)} -{" "}
                            {row.scopeType === "OPERATING_UNIT"
                              ? `${row.legalEntityCode || "LE"} / ${row.operatingUnitCode || "OU"}`
                              : row.legalEntityCode || `LEGAL_ENTITY #${row.scopeId || "?"}`}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Link
                            to="/app/ayarlar/rbac/temporary-coverage"
                            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
                          >
                            {l("Open workspace", "Calisma alanini ac")}
                          </Link>
                          <button
                            type="button"
                            onClick={() => handleRevokeCoverage(row)}
                            disabled={saving || !revokeAccess.allowed}
                            className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {actingRowId === `coverage-${row.id}`
                              ? l("Revoking...", "Geri aliniyor...")
                              : l("Revoke", "Geri al")}
                          </button>
                        </div>
                      </div>
                    );
                  })
                )
              ) : approvalDelegations.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">
                  {l("No approval delegations.", "Approval delegation kaydi yok.")}
                </div>
              ) : (
                approvalDelegations.map((row) => {
                  const revokeAccess = getPermissionAccess(
                    "approvals.policies.write",
                    row?.scopeType && Number(row?.scopeId || 0)
                      ? {
                          scope: {
                            scopeType: row.scopeType,
                            scopeId: Number(row.scopeId),
                          },
                        }
                      : undefined
                  );
                  return (
                    <div
                      key={`approval-row-${row.id}`}
                      className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-4"
                    >
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm font-semibold text-slate-950">
                            {normalizeText(row.moduleCode) || l("Approval delegation", "Approval delegation")}
                          </div>
                          <DelegationStateBadge state={row.state} />
                        </div>
                        <div className="text-sm text-slate-700">
                          {normalizeText(row.delegatorUserName || row.delegatorUserEmail) || "-"} {" to "}
                          {normalizeText(row.delegateUserName || row.delegateUserEmail) || "-"}
                        </div>
                        <div className="text-xs text-slate-500">
                          {formatDelegationScopeLabel(row)} - {formatDelegationWindow(row)}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Link
                          to="/app/ayarlar/rbac/delegations"
                          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
                        >
                          {l("Open page", "Sayfayi ac")}
                        </Link>
                        <button
                          type="button"
                          onClick={() => handleRevokeApproval(row)}
                          disabled={saving || !revokeAccess.allowed}
                          className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {actingRowId === `approval-${row.id}`
                            ? l("Revoking...", "Geri aliniyor...")
                            : l("Revoke", "Geri al")}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </section>
      ) : null}
      <UserAccessModal
        open={userModalOpen}
        mode={userModalMode}
        form={userModalForm}
        onChange={updateUserModalField}
        onClose={() => setUserModalOpen(false)}
        onSubmit={handleSaveUserModal}
        saving={saving}
        l={l}
        permissionAccess={userModalAccess}
        currentUserRoleCodes={currentModalUserRoleCodes}
        currentUserBundles={currentModalUserBundles}
        modalScopeOptions={userModalScopeOptions}
        matrixGroups={userModalMatrix}
        visibleModules={userModalVisibleModules}
        missingRoleCodes={userModalMissingRoleCodes}
        inviteLink={lastInviteLink}
      />
    </div>
  );
}
