
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
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
  listAuditLogs,
  listCountries,
  listGroupCompanies,
  listLegalEntities,
  listOperatingUnits,
  listRoleAssignments,
  listRoles,
  listUsers,
  replaceUserDataScopes,
  replaceRoleAssignmentScope,
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
  buildAssignmentAuditSummary,
  buildCandidateRoleConflictWarnings,
} from "./userAssignmentAuditSummary.js";
import UserAssignmentWorkbench from "./UserAssignmentWorkbench.jsx";
import { SecurityWorkbenchLoadingState } from "./components/SecurityWorkbenchStates.jsx";
import { buildEffectiveAuthorityPreview } from "./userAssignmentAuthorityPreview.js";
import {
  BOOTSTRAP_HANDOFF_PRESET_CATALOG,
  buildScopeLabel,
  getBootstrapHandoffPresetEntry,
  getBootstrapHandoffPresetDisplayLabel,
  getRoleCatalogEntry,
  groupRolesForManagement,
} from "./roleCatalog.js";
import SecurityAdminWorkspaceShell from "./SecurityAdminWorkspaceShell.jsx";
const SCOPE_TYPES = ["TENANT", "GROUP", "COUNTRY", "LEGAL_ENTITY", "OPERATING_UNIT"];
const EFFECT_OPTIONS = ["ALLOW", "DENY"];
const USER_STATUS_FILTERS = ["ALL", "ACTIVE", "INVITED", "DISABLED"];
const ASSIGNMENT_STATUS_FILTERS = ["ALL", "ACTIVE", "UPCOMING", "EXPIRED", "CUSTOM"];
const USER_ASSIGNMENT_CANONICAL_TABS = ["users", "assignments"];
const DELEGATION_TAB_ORDER = ["coverage", "approval"];
const DEFAULT_ENTITY_ACCOUNTANT_PRESET_CODE = "EntityAPController";
function normalizeText(value) {
  return String(value || "").trim();
}

function updateSearchParams(searchParams, changes) {
  const nextParams = new URLSearchParams(searchParams);
  Object.entries(changes).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      nextParams.delete(key);
      return;
    }
    nextParams.set(key, String(value));
  });
  return nextParams;
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

function resolveCoverageTemporalState(row) {
  const normalizedState = normalizeText(row?.state).toUpperCase();
  if (normalizedState === "REVOKED") {
    return "REVOKED";
  }
  if (normalizedState === "EXPIRED") {
    return "EXPIRED";
  }
  if (normalizedState === "ACTIVE") {
    return "ACTIVE";
  }

  const now = Date.now();
  const startTimestamp = row?.startDate ? new Date(row.startDate).getTime() : Number.NaN;
  if (!Number.isNaN(startTimestamp) && startTimestamp > now) {
    return "UPCOMING";
  }
  const endTimestamp = row?.endDate ? new Date(row.endDate).getTime() : Number.NaN;
  if (!Number.isNaN(endTimestamp) && endTimestamp < now) {
    return "EXPIRED";
  }
  return "ACTIVE";
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

function resolvePreferredScopeId(scopeType, requestedScopeId, lookups, tenantScopeId) {
  const normalizedScopeType = normalizeText(scopeType).toUpperCase();
  const scopeOptions = buildScopeOptions(normalizedScopeType, lookups, tenantScopeId);
  if (normalizedScopeType === "TENANT") {
    return String(tenantScopeId || scopeOptions[0]?.id || "");
  }
  const normalizedRequestedScopeId = Number(requestedScopeId || 0);
  if (
    normalizedRequestedScopeId > 0 &&
    scopeOptions.some((option) => Number(option.id) === normalizedRequestedScopeId)
  ) {
    return String(normalizedRequestedScopeId);
  }
  return String(scopeOptions[0]?.id || "");
}
function buildTemplateRoleCodes(presetCode, includeOptionalRoles = false) {
  const preset = getBootstrapHandoffPresetEntry(presetCode);
  const requiredRoleCodes = Array.isArray(preset.assignmentRoleCodes)
    ? [...preset.assignmentRoleCodes]
    : Array.isArray(preset.roleCodes)
      ? [...preset.roleCodes]
      : [];
  if (includeOptionalRoles) {
    requiredRoleCodes.push(...(preset.optionalRoleCodes || []));
  }
  return Array.from(
    new Set(requiredRoleCodes.map((roleCode) => normalizeText(roleCode)).filter(Boolean))
  );
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
      const roleEntries = roleCodes.map((roleCode) => getRoleCatalogEntry(roleCode));
      const presetMatch = findPresetMatch(roleCodes);
      const status = resolveAssignmentLifecycle(rows);
      const assignmentRows = rows
        .map((row) => {
          const roleEntry = getRoleCatalogEntry(row.role_code);
          return {
            assignmentId: Number(row.id || 0),
            userId,
            roleId: Number(row.role_id || 0),
            roleCode: normalizeText(row.role_code),
            roleLabel: roleEntry.code,
            scopeType: normalizeText(row.scope_type).toUpperCase(),
            scopeId: Number(row.scope_id || 0),
            scopeLabel: buildScopeLabel(
              row.scope_type,
              row.scope_id,
              lookups,
              tenantScopeId
            ),
            effect: normalizeText(row.effect).toUpperCase() || "ALLOW",
            effectiveFrom: row.effective_from || "",
            effectiveTo: row.effective_to || "",
            status: resolveAssignmentLifecycle([row]),
            recommendedScopes: Array.isArray(roleEntry.recommendedScopes)
              ? roleEntry.recommendedScopes
              : [],
          };
        })
        .sort((left, right) => {
          const roleLabelCompare = left.roleLabel.localeCompare(right.roleLabel);
          if (roleLabelCompare !== 0) {
            return roleLabelCompare;
          }
          return left.assignmentId - right.assignmentId;
        });
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
        roleLabels: roleEntries.map((entry) => entry.code),
        status,
        presetCode: presetMatch?.presetCode || "",
        presetDisplayName: presetMatch?.preset?.displayName || "",
        presetSummary: presetMatch?.preset?.summary || "",
        optionalRoleCodes: presetMatch?.matchedOptionalRoleCodes || [],
        isPresetBundle: Boolean(presetMatch),
        sourceType: presetMatch ? "PRESET_DERIVED" : "DIRECT",
        sourceTypeLabel: presetMatch ? "Preset-derived" : "Direct / custom",
        scopeKey: `${normalizeText(first.scope_type).toUpperCase()}:${Number(first.scope_id || 0)}`,
        rows: assignmentRows,
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
function buildUserDirectoryRows(
  users,
  bundles,
  approvalRows,
  coverageRows
) {
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
    const derivedAssignmentCount = userBundles.filter(
      (bundle) => bundle.isPresetBundle
    ).length;
    const directAssignmentCount = userBundles.filter(
      (bundle) => !bundle.isPresetBundle
    ).length;
    const roleCodes = Array.from(
      new Set(userBundles.flatMap((bundle) => bundle.roleCodes))
    );
    const listedRuntimeRoleCodes = roleCodes;
    const scopes = Array.from(
      new Set([
        ...userBundles.map((bundle) => `${bundle.scopeType}:${bundle.scopeId}`),
      ])
    );
    const topScopeLabels = Array.from(
      new Set([
        ...userBundles.map((bundle) => bundle.scopeLabel),
      ].filter(Boolean))
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
      derivedAssignmentCount,
      directAssignmentCount,
      presetCount: derivedAssignmentCount,
      directBundleCount: directAssignmentCount,
      scopeCount: scopes.length,
      topRoleCodes: listedRuntimeRoleCodes.slice(0, 4),
      topScopeLabels: topScopeLabels.slice(0, 3),
      activeDelegationCount: activeApprovalDelegations.length + activeCoverage.length,
      currentPresetCodes: Array.from(
        new Set(userBundles.map((bundle) => bundle.presetCode).filter(Boolean))
      ),
      scopeKeys: scopes,
    };
  });
}
function buildAssignmentSearchText(bundle) {
  return [
    bundle.userName,
    bundle.userEmail,
    bundle.presetCode,
    bundle.presetDisplayName,
    bundle.scopeLabel,
    bundle.scopeType,
    bundle.sourceTypeLabel,
    bundle.roleCodes.join(" "),
    bundle.roleCodes.map((roleCode) => getRoleDisplayCode(roleCode)).join(" "),
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
    row.topRoleCodes.map((roleCode) => getRoleDisplayCode(roleCode)).join(" "),
    row.currentPresetCodes.join(" "),
    row.currentPresetCodes.map((presetCode) => getBootstrapHandoffPresetDisplayLabel(presetCode)).join(" "),
    row.topScopeLabels.join(" "),
    row.scopeKeys.join(" "),
  ]
    .join(" ")
    .toLowerCase();
}

function getRoleDisplayCode(roleOrCode) {
  return getRoleCatalogEntry(roleOrCode).code;
}

function getPresetDisplayLabel(presetCode) {
  return getBootstrapHandoffPresetDisplayLabel(presetCode);
}

function formatScopeTypeLabel(scopeType) {
  return normalizeText(scopeType)
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildPresetRoleSummary(presetEntry, l) {
  const requiredRoleLabels = Array.isArray(presetEntry?.roleLabels)
    ? presetEntry.roleLabels.filter(Boolean)
    : [];
  const optionalRoleLabels = Array.isArray(presetEntry?.optionalRoleLabels)
    ? presetEntry.optionalRoleLabels.filter(Boolean)
    : [];
  const previewLabels = requiredRoleLabels.slice(0, 3);
  const baseSummary = previewLabels.join(", ");
  const remainingRequiredCount = Math.max(
    requiredRoleLabels.length - previewLabels.length,
    0
  );
  let summary = baseSummary;
  if (remainingRequiredCount > 0) {
    summary = baseSummary
      ? l("{{base}} +{{count}} more", "{{base}} +{{count}} daha", {
          base: baseSummary,
          count: remainingRequiredCount,
        })
      : l("{{count}} roles", "{{count}} rol", {
          count: requiredRoleLabels.length,
        });
  }
  if (!summary) {
    summary = l("No required roles", "Zorunlu rol yok");
  }
  if (optionalRoleLabels.length === 0) {
    return summary;
  }
  const optionalPreview = optionalRoleLabels.slice(0, 2).join(", ");
  const remainingOptionalCount = Math.max(
    optionalRoleLabels.length - Math.min(optionalRoleLabels.length, 2),
    0
  );
  return `${summary} ${l("Optional", "Opsiyonel")}: ${optionalPreview}${
    remainingOptionalCount > 0 ? ` +${remainingOptionalCount}` : ""
  }`;
}

function buildScopeTargetOptions(bundles) {
  const byScopeKey = new Map();
  for (const bundle of Array.isArray(bundles) ? bundles : []) {
    if (!bundle?.scopeKey || !bundle?.scopeLabel) {
      continue;
    }
    if (!byScopeKey.has(bundle.scopeKey)) {
      byScopeKey.set(bundle.scopeKey, {
        value: bundle.scopeKey,
        label: bundle.scopeLabel,
      });
    }
  }
  return Array.from(byScopeKey.values()).sort((left, right) =>
    left.label.localeCompare(right.label)
  );
}
function WorkspaceTabButton({ active, count, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${active
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
/*
function SummaryMetricCard({ description, title, tone = "slate", value }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
      <StatusPill label={title} tone={tone} />
      <div className="mt-3 text-2xl font-semibold text-slate-950">{value}</div>
      <div className="mt-2 text-sm leading-6 text-slate-600">{description}</div>
    </div>
  );
}
function getSodSeverityMeta(l, severity) {
  const normalizedSeverity = normalizeText(severity).toLowerCase();
  if (normalizedSeverity === "block") {
    return {
      label: l("BLOCK", "BLOCK"),
      tone: "rose",
      panelClassName: "border-rose-200 bg-rose-50/70",
    };
  }
  return {
    label: l("WARN", "WARN"),
    tone: "amber",
    panelClassName: "border-amber-200 bg-amber-50/70",
  };
}
function SummaryRouteLink({ disabled = false, label, permissionNote = "", to }) {
  if (disabled) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-500">
        <div className="font-semibold text-slate-700">{label}</div>
        <div className="mt-1 text-xs leading-5">{permissionNote}</div>
      </div>
    );
  }
  return (
    <Link
      to={to}
      className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
    >
      {label}
    </Link>
  );
}
function TenantSodConflictCard({ conflict, l, selectedUserId }) {
  const severityMeta = getSodSeverityMeta(l, conflict?.conflictRule?.severity);
  const isSelectedUser = Number(conflict?.userId || 0) === Number(selectedUserId || 0);
  return (
    <div className={`rounded-2xl border px-4 py-4 ${severityMeta.panelClassName}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap gap-2">
            <StatusPill label={severityMeta.label} tone={severityMeta.tone} />
            {isSelectedUser ? (
              <StatusPill label={l("Selected user", "Secili kullanici")} tone="blue" />
            ) : null}
          </div>
          <div className="mt-3 text-sm font-semibold text-slate-950">
            {conflict?.userName || l("Unknown user", "Bilinmeyen kullanici")}
          </div>
          <div className="mt-1 text-xs text-slate-500">{conflict?.email || "-"}</div>
        </div>
        <div className="text-right text-xs text-slate-500">
          <div>{conflict?.conflictRule?.code || "-"}</div>
          <div className="mt-1">
            {conflict?.conflictRule?.actionA || "-"} / {conflict?.conflictRule?.actionB || "-"}
          </div>
        </div>
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-700">
        {conflict?.conflictRule?.reason ||
          l(
            "Tenant-wide SoD overlap detected for the current scope mix.",
            "Mevcut kapsam karisimi icin tenant-geneli SoD cakismasi tespit edildi."
          )}
      </p>
      {(conflict?.overlappingScopes || []).length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {conflict.overlappingScopes.map((scope) => (
            <StatusPill
              key={`${conflict.userId}-${conflict.conflictRule?.code}-${scope.type}-${scope.id}`}
              label={`${scope.type}:${scope.id}${scope.name ? ` (${scope.name})` : ""}`}
              tone="blue"
            />
          ))}
        </div>
      ) : null}
      <div className="mt-3 grid gap-3 text-sm text-slate-700 md:grid-cols-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            {l("Affected role set A", "Etkilenen rol kumesi A")}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {(conflict?.roleCodesA || []).length > 0 ? (
              conflict.roleCodesA.map((roleCode) => (
                <StatusPill
                  key={`${conflict.userId}-${conflict.conflictRule?.code}-role-a-${roleCode}`}
                  label={roleCode}
                  tone="slate"
                />
              ))
            ) : (
              <span className="text-xs text-slate-500">{l("Not returned", "Donmedi")}</span>
            )}
          </div>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            {l("Affected role set B", "Etkilenen rol kumesi B")}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {(conflict?.roleCodesB || []).length > 0 ? (
              conflict.roleCodesB.map((roleCode) => (
                <StatusPill
                  key={`${conflict.userId}-${conflict.conflictRule?.code}-role-b-${roleCode}`}
                  label={roleCode}
                  tone="violet"
                />
              ))
            ) : (
              <span className="text-xs text-slate-500">{l("Not returned", "Donmedi")}</span>
            )}
          </div>
        </div>
      </div>
      {(conflict?.mitigatingControls || []).length > 0 ? (
        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-900">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-800">
            {l("Mitigating controls", "Azaltici kontroller")}
          </div>
          <div className="mt-2 space-y-1">
            {conflict.mitigatingControls.map((control) => (
              <div key={`${conflict.userId}-${conflict.conflictRule?.code}-${control}`}>
                {control}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
function SelectedUserWarningCard({ l, warning }) {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4">
      <div className="flex flex-wrap gap-2">
        <StatusPill
          label={getSodSeverityMeta(l, warning?.severity).label}
          tone={getSodSeverityMeta(l, warning?.severity).tone}
        />
        <StatusPill label={warning.title} tone="amber" />
        {warning.scopeLabel ? <StatusPill label={warning.scopeLabel} tone="blue" /> : null}
        {(warning.sourceLabels || []).map((sourceLabel) => (
          <StatusPill
            key={`${warning.id}-${sourceLabel}`}
            label={sourceLabel}
            tone="slate"
          />
        ))}
      </div>
      <p className="mt-3 text-sm leading-6 text-amber-900">{warning.description}</p>
      {(warning.roleLabels || []).length > 0 ? (
        <div className="mt-3">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-800">
            {l("Affected roles", "Etkilenen roller")}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {warning.roleLabels.map((roleLabel) => (
              <StatusPill key={`${warning.id}-${roleLabel}`} label={roleLabel} tone="violet" />
            ))}
          </div>
        </div>
      ) : null}
      {(warning.permissionFamilyLabels || []).length > 0 ? (
        <div className="mt-3">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-800">
            {l("Overlapping authorities", "Cakisan yetki alanlari")}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {warning.permissionFamilyLabels.map((familyLabel) => (
              <StatusPill key={`${warning.id}-${familyLabel}`} label={familyLabel} tone="green" />
            ))}
          </div>
        </div>
      ) : null}
      {(warning.candidateRoleLabels || []).length > 0 ? (
        <div className="mt-3">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-800">
            {l("Candidate blocked roles", "Bloklanmasi gereken aday roller")}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {warning.candidateRoleLabels.map((roleLabel) => (
              <StatusPill key={`${warning.id}-candidate-${roleLabel}`} label={roleLabel} tone="rose" />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
function AuditSodSummarySurface({
  assignmentAuditSummary,
  canOpenAccessDebugger,
  canOpenAuditLogs,
  canOpenComplianceReports,
  canPreviewComplianceAudit,
  l,
  selectedUser,
  selectedUserAssignmentAuditReadable,
  selectedUserAuditError,
  selectedUserAuditLoading,
  tenantSodError,
  tenantSodLoading,
  tenantSodReport,
}) {
  const tenantConflicts = Array.isArray(tenantSodReport?.conflicts) ? tenantSodReport.conflicts : [];
  const tenantSummary = tenantSodReport?.summary || {};
  const blockConflicts = tenantConflicts.filter(
    (conflict) => normalizeText(conflict?.conflictRule?.severity).toLowerCase() === "block"
  );
  const warnConflicts = tenantConflicts.filter(
    (conflict) => normalizeText(conflict?.conflictRule?.severity).toLowerCase() !== "block"
  );
  const selectedUserTenantConflicts = selectedUser
    ? tenantConflicts.filter(
        (conflict) => Number(conflict.userId || 0) === Number(selectedUser.id || 0)
      )
    : [];
  const selectedUserWarnings = Array.isArray(assignmentAuditSummary?.sodWarnings)
    ? assignmentAuditSummary.sodWarnings
    : [];
  const auditItems = Array.isArray(assignmentAuditSummary?.auditItems)
    ? assignmentAuditSummary.auditItems
    : [];

  return (
    <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-3xl">
            <h2 className="text-sm font-semibold text-slate-950">
              {l("Audit & SoD summary", "Audit ve SoD ozeti")}
            </h2>
          </div>
          <StatusPill
            label={
              tenantSodLoading
                ? l("Loading tenant SoD snapshot", "Tenant SoD ozeti yukleniyor")
                : canPreviewComplianceAudit
                  ? l("Tenant SoD snapshot ready", "Tenant SoD ozeti hazir")
                  : l("Preview permission required", "Onizleme izni gerekli")
            }
            tone={tenantSodLoading ? "blue" : canPreviewComplianceAudit ? "green" : "amber"}
          />
        </div>
      </div>
      <div className="space-y-5 px-5 py-5">
        <div className="grid gap-4 xl:grid-cols-4">
          <SummaryMetricCard
            title={l("Users with conflicts", "Cakismanin oldugu kullanicilar")}
            value={Number(tenantSummary.usersWithConflicts || 0)}
            description={l(
              "Distinct users returned by the current tenant-wide SoD snapshot.",
              "Mevcut tenant-geneli SoD ozetinde donen farkli kullanicilar."
            )}
            tone="violet"
          />
          <SummaryMetricCard
            title={l("BLOCK conflicts", "BLOCK cakismalari")}
            value={Number(tenantSummary.blockLevelConflicts || 0)}
            description={l(
              "Blocking maker-checker overlaps that should move quickly to action.",
              "Hizla aksiyona donmesi gereken bloklayici maker-checker cakismalari."
            )}
            tone="rose"
          />
          <SummaryMetricCard
            title={l("WARN conflicts", "WARN cakismalari")}
            value={Number(tenantSummary.warnLevelConflicts || 0)}
            description={l(
              "Advisory conflicts that still need cleanup or compensating control review.",
              "Hala temizlik veya telafi edici kontrol incelemesi gerektiren danismanlik seviyesindeki cakismalar."
            )}
            tone="amber"
          />
          <SummaryMetricCard
            title={l("Current audit items", "Guncel audit ogeleri")}
            value={auditItems.length}
            description={
              selectedUser
                ? l(
                    "{{user}} icin mevcut paket ve bundle audit satirlari.",
                    "{{user}} icin mevcut paket ve bundle audit satirlari.",
                    { user: selectedUser.name || selectedUser.email || "#" }
                  )
                : l(
                    "Select one user to preview current assignment audit items.",
                    "Guncel atama audit ogelerini onizlemek icin bir kullanici secin."
                  )
            }
            tone="blue"
          />
        </div>

        {tenantSodLoading ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            {l(
              "Loading the tenant-wide SoD snapshot from compliance reports...",
              "Uyum raporlarindan tenant-geneli SoD ozeti yukleniyor..."
            )}
          </div>
        ) : null}
        {!tenantSodLoading && tenantSodError ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
            {tenantSodError}
          </div>
        ) : null}
        {!tenantSodLoading && !tenantSodError && !canPreviewComplianceAudit ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
            {l(
              "Tenant-wide SoD preview needs security.audit.report.generate. The detailed compliance and audit routes remain linked below.",
              "Tenant-geneli SoD onizlemesi icin security.audit.report.generate gerekir. Ayrintili uyum ve audit rotalari asagida bagli kalir."
            )}
          </div>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-2">
          <div className="space-y-3 rounded-2xl border border-rose-200 bg-rose-50/50 px-4 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-700">
                  {l("BLOCK conflicts", "BLOCK cakismalari")}
                </div>
              </div>
              <StatusPill label={String(blockConflicts.length)} tone="rose" />
            </div>
            {blockConflicts.length === 0 ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                {l(
                  "No BLOCK conflicts are currently returned by the tenant-wide SoD snapshot.",
                  "Tenant-geneli SoD ozetinde su anda BLOCK cakismasi donmuyor."
                )}
              </div>
            ) : (
              blockConflicts.slice(0, SOD_PREVIEW_LIMIT).map((conflict) => (
                <TenantSodConflictCard
                  key={`${conflict.userId}-${conflict.conflictRule?.code}`}
                  conflict={conflict}
                  l={l}
                  selectedUserId={selectedUser?.id}
                />
              ))
            )}
            {blockConflicts.length > SOD_PREVIEW_LIMIT ? (
              <div className="text-xs text-rose-700">
                {l(
                  "+{{count}} more BLOCK conflicts in compliance reports.",
                  "Uyum raporlarinda +{{count}} BLOCK cakismasi daha var.",
                  { count: blockConflicts.length - SOD_PREVIEW_LIMIT }
                )}
              </div>
            ) : null}
          </div>

          <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50/40 px-4 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">
                  {l("WARN conflicts", "WARN cakismalari")}
                </div>
              </div>
              <StatusPill label={String(warnConflicts.length)} tone="amber" />
            </div>
            {warnConflicts.length === 0 ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                {l(
                  "No WARN-level conflicts are currently returned by the tenant-wide SoD snapshot.",
                  "Tenant-geneli SoD ozetinde su anda WARN seviyesinde cakisma donmuyor."
                )}
              </div>
            ) : (
              warnConflicts.slice(0, SOD_PREVIEW_LIMIT).map((conflict) => (
                <TenantSodConflictCard
                  key={`${conflict.userId}-${conflict.conflictRule?.code}`}
                  conflict={conflict}
                  l={l}
                  selectedUserId={selectedUser?.id}
                />
              ))
            )}
            {warnConflicts.length > SOD_PREVIEW_LIMIT ? (
              <div className="text-xs text-amber-700">
                {l(
                  "+{{count}} more WARN conflicts in compliance reports.",
                  "Uyum raporlarinda +{{count}} WARN cakismasi daha var.",
                  { count: warnConflicts.length - SOD_PREVIEW_LIMIT }
                )}
              </div>
            ) : null}
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <div className="space-y-3 rounded-2xl border border-slate-200 bg-white px-4 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                {l("Selected user risk context", "Secili kullanici risk baglami")}
              </div>
              {selectedUser ? (
                <StatusPill
                  label={selectedUser.name || selectedUser.email || `#${selectedUser.id}`}
                  tone="blue"
                />
              ) : null}
            </div>
            {!selectedUser ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">
                {l(
                  "Selected-user risk context appears here after you choose one user from the user list.",
                  "Kullanici listesinden bir kullanici secildikten sonra secili-kullanici risk baglami burada gorunur."
                )}
              </div>
            ) : selectedUserTenantConflicts.length === 0 && selectedUserWarnings.length === 0 ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                {l(
                  "No tenant-wide or local UI-level SoD warnings are currently visible for the selected user.",
                  "Secili kullanici icin su anda tenant-geneli veya yerel UI-seviyesi SoD uyarisi gorunmuyor."
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {selectedUserTenantConflicts.map((conflict) => (
                  <TenantSodConflictCard
                    key={`selected-user-${conflict.userId}-${conflict.conflictRule?.code}`}
                    conflict={conflict}
                    l={l}
                    selectedUserId={selectedUser?.id}
                  />
                ))}
                {selectedUserWarnings.map((warning) => (
                  <SelectedUserWarningCard key={warning.id} l={l} warning={warning} />
                ))}
              </div>
            )}
          </div>

          <div className="space-y-3 rounded-2xl border border-slate-200 bg-white px-4 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  {l("Recent assignment audit", "Son atama auditi")}
                </div>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  {l(
                    "A compact audit summary keeps recent grants and scope changes visible before you drill into the full history below.",
                    "Tam gecmise inmeden once son yetki verilislerini ve kapsam degisikliklerini gorunur tutan kompakt bir audit ozeti."
                  )}
                </p>
              </div>
              <StatusPill
                label={
                  selectedUserAssignmentAuditReadable
                    ? l("Audit read enabled", "Audit okuma acik")
                    : l("Audit read required", "Audit okuma gerekli")
                }
                tone={selectedUserAssignmentAuditReadable ? "blue" : "amber"}
              />
            </div>
            {selectedUserAuditLoading ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-8 text-sm text-slate-500">
                {l(
                  "Loading recent assignment audit items for the selected user...",
                  "Secili kullanici icin son atama audit ogeleri yukleniyor..."
                )}
              </div>
            ) : null}
            {!selectedUserAuditLoading && selectedUserAuditError ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
                {selectedUserAuditError}
              </div>
            ) : null}
            {!selectedUserAuditLoading && !selectedUserAssignmentAuditReadable ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
                {l(
                  "Granted-by attribution uses RBAC audit logs and appears only when security.audit.read is available. Current assignment rows still provide granted-at and effective dates.",
                  "Kim tarafindan verildigi bilgisi RBAC audit loglarini kullanir ve yalnizca security.audit.read mevcutsa gorunur. Verilis zamani ve yururluk tarihleri ise mevcut atama satirlarindan gelmeye devam eder."
                )}
              </div>
            ) : null}
            {auditItems.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">
                  {l(
                    "No current role assignments are available for the compact audit summary yet.",
                    "Kompakt audit ozeti icin gosterilecek mevcut rol atamasi henuz bulunmuyor."
                  )}
                </div>
            ) : (
              <div className="space-y-3">
                {auditItems.slice(0, SOD_PREVIEW_LIMIT).map((item) => (
                  <div
                    key={`audit-summary-${item.id}`}
                    className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap gap-2">
                          <StatusPill label={item.kindLabel} tone="violet" />
                          <StatusPill label={item.statusLabel} tone={item.statusTone} />
                        </div>
                        <div className="mt-3 text-sm font-semibold text-slate-950">
                          {item.title}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">{item.scopeLabel}</div>
                      </div>
                      <div className="text-right text-xs text-slate-500">
                        <div>{formatDateTime(item.grantedAt)}</div>
                        <div className="mt-1">{item.grantedByLabel}</div>
                      </div>
                    </div>
                  </div>
                ))}
                {auditItems.length > SOD_PREVIEW_LIMIT ? (
                  <div className="text-xs text-slate-500">
                    {l(
                      "+{{count}} more audit items remain in the detailed assignment history below.",
                      "Ayrintili atama gecmisinde +{{count}} audit ogesi daha var.",
                      { count: auditItems.length - SOD_PREVIEW_LIMIT }
                    )}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <SummaryRouteLink
            disabled={!canOpenComplianceReports}
            label={l("Open compliance reports", "Uyum raporlarini ac")}
            permissionNote={l(
              "Permission required: security.audit.report.generate or security.audit.report.export",
              "Izin gerekli: security.audit.report.generate veya security.audit.report.export"
            )}
            to="/app/ayarlar/rbac/compliance-reports"
          />
          <SummaryRouteLink
            disabled={!canOpenAuditLogs}
            label={l("Open RBAC audit logs", "RBAC audit loglarini ac")}
            permissionNote={l(
              "Permission required: security.audit.read",
              "Izin gerekli: security.audit.read"
            )}
            to="/app/ayarlar/rbac/audit-logs"
          />
          <SummaryRouteLink
            disabled={!canOpenAccessDebugger}
            label={l("Open access debugger", "Erisim tanilarini ac")}
            permissionNote={l(
              "Permission required: security.role_assignment.read",
              "Izin gerekli: security.role_assignment.read"
            )}
            to="/app/ayarlar/rbac/access-debugger"
          />
        </div>
      </div>
    </section>
  );
}
*/
function AssignmentBundleRow({
  bundle,
  selected,
  l,
  onSelect,
  onOpenUser,
  onRevoke,
  revoking,
}) {
  const statusMeta = getBundleStatusMeta(bundle.status);
  const roleLabels = Array.isArray(bundle.roleLabels) ? bundle.roleLabels.filter(Boolean) : [];
  const roleSummary =
    roleLabels.length === 0
      ? l("No role labels", "Rol etiketi yok")
      : roleLabels.length === 1
        ? roleLabels[0]
        : l("{{first}} +{{count}} more", "{{first}} +{{count}} daha", {
            first: roleLabels[0],
            count: roleLabels.length - 1,
          });
  return (
    <tr
      onClick={() => onSelect(bundle.id)}
      className={`cursor-pointer border-b border-slate-100 align-top transition-colors ${
        selected ? "bg-sky-50" : "hover:bg-slate-50"
      }`}
    >
      <td className="px-4 py-3">
        <div className="min-w-0">
          <div className="font-semibold text-slate-950">
            {bundle.presetDisplayName ||
              bundle.presetCode ||
              l("Custom assignment bundle", "Ozel atama paketi")}
          </div>
          <div className="mt-1 text-xs text-slate-500">{bundle.sourceTypeLabel}</div>
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="text-sm text-slate-900">{bundle.userName}</div>
      </td>
      <td className="px-4 py-3">
        <div className="text-sm text-slate-900">{bundle.scopeLabel}</div>
        <div className="mt-1 text-xs text-slate-500">{bundle.scopeType}</div>
      </td>
      <td className="px-4 py-3">
        <div className="text-sm text-slate-900">
          {l("{{count}} roles", "{{count}} rol", {
            count: bundle.roleCodes.length,
          })}
        </div>
        <div className="mt-1 text-xs text-slate-500">{roleSummary}</div>
      </td>
      <td className="px-4 py-3">
        <div className="text-sm text-slate-900">
          {formatDate(bundle.effectiveFrom)}
        </div>
        <div className="mt-1 text-xs text-slate-500">
          {formatDate(bundle.effectiveTo)}
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-col items-start gap-1">
          <StatusPill label={statusMeta.label} tone={statusMeta.tone} />
          {bundle.effect !== "ALLOW" ? (
            <StatusPill label={bundle.effect} tone="rose" />
          ) : null}
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpenUser(bundle.userId);
            }}
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700"
          >
            {l("Open", "Ac")}
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onRevoke(bundle);
            }}
            disabled={revoking}
            className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {revoking ? l("Revoking...", "Geri aliniyor...") : l("Revoke", "Geri al")}
          </button>
        </div>
      </td>
    </tr>
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
  modalScopeOptions,
  missingRoleCodes,
  inviteLink,
  visibilityRules,
  visibilityDraft,
  visibilityDraftScopeOptions,
  visibilityWriteAccess,
  onUpdateVisibilityDraftField,
  onAddVisibilityRule,
  onRemoveVisibilityRule,
  lookups,
  tenantScopeId,
}) {
  const isInvite = mode === "invite";
  const hasVisibilityRules = visibilityRules.length > 0;
  const inviteRequiresVisibilityRules = isInvite && !hasVisibilityRules;
  const isPresetSelected = Boolean(normalizeText(form.presetCode));
  const selectedPresetEntry = useMemo(
    () => (isPresetSelected ? getBootstrapHandoffPresetEntry(form.presetCode) : null),
    [form.presetCode, isPresetSelected]
  );
  const presetCatalogEntries = useMemo(
    () =>
      Object.keys(BOOTSTRAP_HANDOFF_PRESET_CATALOG)
        .map((presetCode) => getBootstrapHandoffPresetEntry(presetCode))
        .sort((left, right) => {
          const leftOrder = Number(left?.sortOrder || 9999);
          const rightOrder = Number(right?.sortOrder || 9999);
          if (leftOrder !== rightOrder) {
            return leftOrder - rightOrder;
          }
          return normalizeText(left?.displayName).localeCompare(
            normalizeText(right?.displayName)
          );
        }),
    []
  );
  const accessTemplateRows = useMemo(
    () => [
      {
        code: "",
        displayName: l("Invite only", "Sadece davet et"),
        summary: l(
          "Create the invite now and leave access empty for later review.",
          "Daveti simdi olusturun ve erisimi daha sonra incelemek uzere bos birakin."
        ),
        scopeTypeLabel: l("No scope", "Kapsam yok"),
        includedRoles: l("No immediate access", "Anlik erisim yok"),
      },
      ...presetCatalogEntries.map((presetEntry) => ({
        code: presetEntry.code,
        displayName: presetEntry.displayName,
        summary: presetEntry.summary,
        scopeTypeLabel: formatScopeTypeLabel(presetEntry.scopeType),
        includedRoles: buildPresetRoleSummary(presetEntry, l),
      })),
    ],
    [l, presetCatalogEntries]
  );
  const sectionClassName =
    "space-y-4 rounded-xl border border-slate-200 bg-white p-4";
  const fieldClassName =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm shadow-slate-950/5 focus:border-slate-400 focus:outline-none disabled:bg-slate-100 disabled:text-slate-500";
  const readOnlyFieldClassName =
    "rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700";
  if (!open) {
    return null;
  }
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/45 px-4 py-4 backdrop-blur-sm sm:px-6 sm:py-6">
      <div className="flex min-h-full items-start justify-center">
        <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-[1380px] flex-col overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-2xl sm:max-h-[calc(100vh-3rem)]">
          <div className="shrink-0 flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                {l("User editor", "Kullanici editoru")}
              </div>
              <h2 className="mt-2 text-xl font-semibold text-slate-950">
                {isInvite
                  ? l("Invite user", "Kullanici davet et")
                  : l("Edit user access", "Kullanici erisimini duzenle")}
              </h2>
              <p className="mt-2 max-w-2xl text-sm text-slate-600">
                {l(
                  "Use a compact admin form: identity first, then one access template and one scope.",
                  "Kompakt yonetici formunu kullanin: once kimlik bilgisi, sonra tek erisim template'i ve tek kapsam."
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
              <div className="space-y-5 px-5 py-5 xl:px-8 xl:py-6">
                <div className="space-y-5">
                  <section className={sectionClassName}>
                    <div>
                      <h3 className="text-base font-semibold text-slate-950">
                        {l("General Info", "Genel Bilgi")}
                      </h3>
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
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">
                        {l(
                          "This form applies access only. Direct profile updates for existing users are outside this page.",
                          "Bu form yalnizca erisim uygular. Mevcut kullanicilar icin dogrudan profil guncellemesi bu sayfanin disindadir."
                        )}
                      </div>
                    ) : null}
                  </section>
                  <section className={sectionClassName}>
                    <div>
                      <h3 className="text-base font-semibold text-slate-950">
                        {l("Role & Access", "Rol ve Erisim")}
                      </h3>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-slate-700">
                        {l("Access template", "Erisim template'i")}
                      </label>
                      <div className="border-y border-slate-200 bg-white">
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[980px] table-fixed border-collapse text-sm">
                            <thead>
                              <tr className="border-b border-slate-200 bg-white">
                                <th className="w-12 px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                                  {l("Pick", "Sec")}
                                </th>
                                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                                  {l("Role bundle", "Rol paketi")}
                                </th>
                                <th className="w-32 px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                                  {l("Scope type", "Kapsam tipi")}
                                </th>
                                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                                  {l("Included roles", "Dahil roller")}
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {accessTemplateRows.map((row) => {
                                const selected =
                                  normalizeText(form.presetCode) ===
                                  normalizeText(row.code);
                                return (
                                  <tr
                                    key={`modal-preset-row-${row.code || "invite-only"}`}
                                    onClick={() => onChange("presetCode", row.code)}
                                    className={`cursor-pointer border-b border-slate-200 align-top transition-colors ${
                                      selected ? "bg-slate-100" : "bg-white hover:bg-slate-50/60"
                                    }`}
                                  >
                                    <td className="px-3 py-2.5">
                                      <input
                                        type="radio"
                                        name="user-access-template"
                                        checked={selected}
                                        onChange={() => onChange("presetCode", row.code)}
                                        className="mt-0.5 h-4 w-4 border-slate-300 text-slate-900"
                                      />
                                    </td>
                                    <td className="px-3 py-2.5">
                                      <div className="font-semibold text-slate-950">
                                        {row.displayName}
                                      </div>
                                    </td>
                                    <td className="px-3 py-2.5 text-sm text-slate-700">
                                      {row.scopeTypeLabel}
                                    </td>
                                    <td className="px-3 py-2.5 text-sm text-slate-700">
                                      <div className="truncate whitespace-nowrap" title={row.includedRoles}>
                                        {row.includedRoles}
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                      <div className="text-xs leading-5 text-slate-500">
                        {l(
                          "Select one default bundle from the list, or keep the invite without access for later review.",
                          "Listeden bir varsayilan paket secin veya daha sonraki inceleme icin daveti erisimsiz birakin."
                        )}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-slate-700">
                        {l("Scope", "Kapsam")}
                        {isPresetSelected && selectedPresetEntry?.scopeType
                          ? ` (${formatScopeTypeLabel(selectedPresetEntry.scopeType)})`
                          : ""}
                      </label>
                      {isPresetSelected ? (
                        <select
                          value={form.scopeId}
                          onChange={(event) =>
                            onChange("scopeId", event.target.value)
                          }
                          className={fieldClassName}
                        >
                          <option value="">
                            {modalScopeOptions.length === 0
                              ? l("No scope available", "Kullanilabilir kapsam yok")
                              : l("Choose scope target", "Kapsam hedefi secin")}
                          </option>
                          {modalScopeOptions.map((option) => (
                            <option
                              key={`modal-scope-${option.id}`}
                              value={String(option.id)}
                            >
                              {option.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div className={readOnlyFieldClassName}>
                          {l("No scope needed", "Kapsam gerekmiyor")}
                        </div>
                      )}
                      <div className="text-xs leading-5 text-slate-500">
                        {isPresetSelected
                          ? l(
                              "Apply the selected template at one explicit scope boundary.",
                              "Secilen template'i tek ve acik bir kapsam sinirinda uygulayin."
                            )
                          : l(
                              "Leave access blank when the assignment decision is not final yet.",
                              "Atama karari henuz net degilse erisimi bos birakin."
                            )}
                      </div>
                    </div>
                    {isInvite ? (
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-slate-900">
                              {l(
                                "Organizational visibility rules",
                                "Organizasyon gorunurluk kurallari"
                              )}
                            </div>
                            <div className="mt-1 text-xs text-slate-500">
                              {l(
                                "Required before sending the invite. Choose which organizational records the invited user can see after activation.",
                                "Daveti gondermeden once zorunludur. Davet edilen kullanicinin aktivasyondan sonra gorecegi organizasyon kayitlarini secin."
                              )}
                            </div>
                          </div>
                          <div className="text-xs font-semibold text-slate-500">
                            {l("{{count}} rules", "{{count}} kural", {
                              count: visibilityRules.length,
                            })}
                          </div>
                        </div>
                        <div className="grid gap-3 lg:grid-cols-[170px_minmax(0,1fr)_140px_96px]">
                          <select
                            value={visibilityDraft.scopeType}
                            onChange={(event) =>
                              onUpdateVisibilityDraftField("scopeType", event.target.value)
                            }
                            disabled={!visibilityWriteAccess.allowed}
                            className={fieldClassName}
                          >
                            {SCOPE_TYPES.map((scopeType) => (
                              <option
                                key={`invite-visibility-scope-type-${scopeType}`}
                                value={scopeType}
                              >
                                {scopeType}
                              </option>
                            ))}
                          </select>
                          <select
                            value={visibilityDraft.scopeId}
                            onChange={(event) =>
                              onUpdateVisibilityDraftField("scopeId", event.target.value)
                            }
                            disabled={
                              !visibilityWriteAccess.allowed ||
                              (visibilityDraft.scopeType !== "TENANT" &&
                                visibilityDraftScopeOptions.length === 0)
                            }
                            className={fieldClassName}
                          >
                            <option value="">
                              {visibilityDraft.scopeType === "TENANT"
                                ? l("Tenant", "Tenant")
                                : l("Choose target", "Hedef secin")}
                            </option>
                            {visibilityDraftScopeOptions.map((option) => (
                              <option
                                key={`invite-visibility-scope-${option.id}`}
                                value={String(option.id)}
                              >
                                {option.label}
                              </option>
                            ))}
                          </select>
                          <select
                            value={visibilityDraft.effect}
                            onChange={(event) =>
                              onUpdateVisibilityDraftField("effect", event.target.value)
                            }
                            disabled={!visibilityWriteAccess.allowed}
                            className={fieldClassName}
                          >
                            {EFFECT_OPTIONS.map((effect) => (
                              <option key={`invite-visibility-effect-${effect}`} value={effect}>
                                {effect}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={onAddVisibilityRule}
                            disabled={
                              !visibilityWriteAccess.allowed ||
                              (!visibilityDraft.scopeId &&
                                visibilityDraft.scopeType !== "TENANT")
                            }
                            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
                          >
                            {l("Add", "Ekle")}
                          </button>
                        </div>
                        <div className="border-y border-slate-200 bg-white">
                          {visibilityRules.length === 0 ? (
                            <div className="px-3 py-3 text-sm text-slate-500">
                              {l(
                                "No organizational visibility rules added yet. Add at least one rule before sending the invite.",
                                "Henuz organizasyon gorunurluk kurali eklenmedi. Daveti gondermeden once en az bir kural ekleyin."
                              )}
                            </div>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="w-full min-w-[760px] table-fixed border-collapse text-sm">
                                <thead>
                                  <tr className="border-b border-slate-200 bg-white">
                                    <th className="w-36 px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                                      {l("Scope type", "Kapsam tipi")}
                                    </th>
                                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                                      {l("Target", "Hedef")}
                                    </th>
                                    <th className="w-28 px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                                      {l("Effect", "Etki")}
                                    </th>
                                    <th className="w-24 px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                                      {l("Remove", "Kaldir")}
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {visibilityRules.map((row) => (
                                    <tr
                                      key={`invite-visibility-row-${row.scopeType}-${row.scopeId}`}
                                      className="border-b border-slate-100"
                                    >
                                      <td className="px-3 py-2.5 text-slate-700">
                                        {row.scopeType}
                                      </td>
                                      <td className="px-3 py-2.5 text-slate-700">
                                        {buildScopeLabel(
                                          row.scopeType,
                                          row.scopeId,
                                          lookups || {},
                                          tenantScopeId || null
                                        )}
                                      </td>
                                      <td className="px-3 py-2.5 text-slate-700">
                                        {row.effect}
                                      </td>
                                      <td className="px-3 py-2.5 text-right">
                                        <button
                                          type="button"
                                          onClick={() =>
                                            onRemoveVisibilityRule(row.scopeType, row.scopeId)
                                          }
                                          disabled={!visibilityWriteAccess.allowed}
                                          className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 disabled:opacity-50"
                                        >
                                          {l("Remove", "Kaldir")}
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                        <PermissionAccessNotice
                          access={visibilityWriteAccess}
                          permissionCode="security.data_scope.upsert"
                        />
                      </div>
                    ) : null}
                    {isPresetSelected ? (
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_140px_160px]">
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                              {l("Included roles", "Dahil roller")}
                            </div>
                            <div className="mt-1 text-sm leading-6 text-slate-700">
                              {(selectedPresetEntry?.roleLabels || []).join(", ")}
                              {(selectedPresetEntry?.optionalRoleLabels || []).length > 0
                                ? ` ${l("Optional add-on", "Opsiyonel eklenti")}: ${selectedPresetEntry.optionalRoleLabels.join(", ")}`
                                : ""}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                              {l("Scope type", "Kapsam tipi")}
                            </div>
                            <div className="mt-1 text-sm text-slate-900">
                              {formatScopeTypeLabel(selectedPresetEntry?.scopeType)}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                              {l("Role rows", "Rol satiri")}
                            </div>
                            <div className="mt-1 text-sm text-slate-900">
                              {(selectedPresetEntry?.roleLabels || []).length +
                                (selectedPresetEntry?.optionalRoleLabels || []).length}
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-sm text-slate-600">
                        {l(
                          "This invite will create the onboarding link without applying access yet.",
                          "Bu davet, erisimi henuz uygulamadan onboarding baglantisini olusturur."
                        )}
                      </div>
                    )}
                    <div className="grid gap-4 md:grid-cols-2">
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
                    <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                      <input
                        type="checkbox"
                        checked={Boolean(form.includePostingAuthority)}
                        onChange={(event) => onChange("includePostingAuthority", event.target.checked)}
                        disabled={
                          !isPresetSelected ||
                          (selectedPresetEntry?.optionalRoleCodes || []).length === 0
                        }
                        className="mt-1 h-4 w-4 rounded border-slate-300 text-slate-900"
                      />
                      <span>
                        <span className="block text-sm font-semibold text-slate-900">
                          {l(
                            "Add manual GL posting authority",
                            "Manuel GL posting authority ekle"
                          )}
                        </span>
                        <span className="mt-1 block text-xs leading-5 text-slate-500">
                          {l(
                            "Optional explicit add-on for manual GL journal posting and reversal. Period close stays separate.",
                            "Manuel GL fis postlama ve ters kayit icin opsiyonel ve acik eklenti. Donem kapatma ayri kalir."
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
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-6 py-4">
              <div className="text-sm text-slate-500">
                {inviteRequiresVisibilityRules
                  ? l(
                      "Add at least one organizational visibility rule before sending the invite.",
                      "Daveti gondermeden once en az bir organizasyon gorunurluk kurali ekleyin."
                    )
                  : l(
                      "Save creates the invite and applies the selected access.",
                      "Kaydetme, daveti olusturur ve secilen erisimi uygular."
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
                  disabled={saving || inviteRequiresVisibilityRules}
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
 * Combined security workspace for user access, business assignment bundles,
 * and delegation administration in the role-first RBAC model.
 */
export default function UserAssignmentsPage() {
  const {
    getPermissionAccess,
    hasPermission,
    user,
  } = useAuth();
  const { l } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actingRowId, setActingRowId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [warningMessages, setWarningMessages] = useState([]);
  const [delegationLoadError, setDelegationLoadError] = useState("");
  const requestedWorkbenchTab = String(searchParams.get("tab") || "").trim();
  const workbenchTab = USER_ASSIGNMENT_CANONICAL_TABS.includes(requestedWorkbenchTab)
    ? requestedWorkbenchTab
    : requestedWorkbenchTab === "people" || requestedWorkbenchTab === "authority"
      ? "users"
      : USER_ASSIGNMENT_CANONICAL_TABS[0];
  const activeTab = workbenchTab === "assignments" ? "assignments" : "users";
  const delegationTab = DELEGATION_TAB_ORDER.includes(searchParams.get("delegationTab"))
    ? searchParams.get("delegationTab")
    : DELEGATION_TAB_ORDER[0];
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [groups, setGroups] = useState([]);
  const [countries, setCountries] = useState([]);
  const [legalEntities, setLegalEntities] = useState([]);
  const [operatingUnits, setOperatingUnits] = useState([]);
  const [approvalDelegations, setApprovalDelegations] = useState([]);
  const [coverageRows, setCoverageRows] = useState([]);
  const [selectedWorkbenchAuditRows, setSelectedWorkbenchAuditRows] = useState([]);
  const [selectedWorkbenchAuditLoading, setSelectedWorkbenchAuditLoading] = useState(false);
  const [selectedWorkbenchAuditError, setSelectedWorkbenchAuditError] = useState("");
  const [lastInviteLink, setLastInviteLink] = useState("");
  // Keep the modal's current invite link separate so a new invite session
  // cannot display a stale link from the previous user.
  const [userModalInviteLink, setUserModalInviteLink] = useState("");
  const [userFilters, setUserFilters] = useState({
    search: "",
    status: "ALL",
    scopeType: "",
    scopeTarget: "",
    sourceType: "",
  });
  const [assignmentFilters, setAssignmentFilters] = useState({
    search: "",
    presetCode: "",
    status: "ALL",
  });
  const [selectedWorkbenchUserId, setSelectedWorkbenchUserId] = useState("");
  const [selectedWorkbenchBundleId, setSelectedWorkbenchBundleId] = useState("");
  const [selectedBundleId, setSelectedBundleId] = useState("");
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [userModalVersion, setUserModalVersion] = useState(0);
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
    includePostingAuthority: false,
  });
  const [userModalVisibilityRules, setUserModalVisibilityRules] = useState([]);
  const [userModalVisibilityDraft, setUserModalVisibilityDraft] = useState({
    scopeType: "LEGAL_ENTITY",
    scopeId: "",
    effect: "ALLOW",
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
  const setWorkspaceDelegationTab = useCallback(
    (nextTab) => {
      setSearchParams(
        updateSearchParams(searchParams, {
          tab: "delegations",
          delegationTab: nextTab,
        })
      );
    },
    [searchParams, setSearchParams]
  );
  const tenantScopeId = Number(user?.tenant_id || 0);
  const canReadOrgTree = hasPermission("org.tree.read");
  const canReadAudit = hasPermission("security.audit.read");
  const roleAssignmentReadAccess = getPermissionAccess("security.role_assignment.read");
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
  const assignableRoleGroups = roleGroups;
  const assignmentBundles = useMemo(
    () => buildAssignmentBundles(assignments, usersById, lookups, tenantScopeId),
    [assignments, lookups, tenantScopeId, usersById]
  );
  const userDirectoryRows = useMemo(
    () =>
      buildUserDirectoryRows(
        users,
        assignmentBundles,
        approvalDelegations,
        coverageRows
      ),
    [
      approvalDelegations,
      assignmentBundles,
      coverageRows,
      users,
    ]
  );
  const scopeTargetOptions = useMemo(
    () => buildScopeTargetOptions(assignmentBundles),
    [assignmentBundles]
  );
  const filteredUsers = useMemo(() => {
    const searchText = normalizeText(userFilters.search).toLowerCase();
    return userDirectoryRows.filter((row) => {
      if (searchText && !buildUserSearchText(row).includes(searchText)) {
        return false;
      }
      if (
        userFilters.scopeType &&
        !row.scopeKeys.some((scopeKey) => scopeKey.startsWith(`${userFilters.scopeType}:`))
      ) {
        return false;
      }
      if (userFilters.scopeTarget && !row.scopeKeys.includes(userFilters.scopeTarget)) {
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
      if (
        (userFilters.sourceType === "DERIVED" ||
          userFilters.sourceType === "PRESET_DERIVED") &&
        row.derivedAssignmentCount === 0
      ) {
        return false;
      }
      if (userFilters.sourceType === "DIRECT" && row.directAssignmentCount === 0) {
        return false;
      }
      return true;
    });
  }, [userDirectoryRows, userFilters]);
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
  const selectedWorkbenchUser = useMemo(() => {
    const normalizedSelectedUserId = Number(selectedWorkbenchUserId || 0);
    if (normalizedSelectedUserId) {
      return (
        userDirectoryRows.find((row) => Number(row.id) === normalizedSelectedUserId) || null
      );
    }
    return filteredUsers[0] || userDirectoryRows[0] || null;
  }, [filteredUsers, selectedWorkbenchUserId, userDirectoryRows]);
  const selectedWorkbenchUserBundles = useMemo(
    () =>
      assignmentBundles.filter(
        (bundle) => Number(bundle.userId) === Number(selectedWorkbenchUser?.id || 0)
      ),
    [assignmentBundles, selectedWorkbenchUser?.id]
  );
  const selectedWorkbenchBundle =
    selectedWorkbenchUserBundles.find((bundle) => bundle.id === selectedWorkbenchBundleId) ||
    selectedWorkbenchUserBundles[0] ||
    null;
  const selectedWorkbenchActiveRoleEntries = useMemo(
    () => {
      const activeRoleCodes = [
        ...selectedWorkbenchUserBundles
          .filter(
            (bundle) =>
              normalizeText(bundle.status).toUpperCase() === "ACTIVE" &&
              normalizeText(bundle.effect).toUpperCase() !== "DENY"
          )
          .flatMap((bundle) => bundle.roleCodes),
      ];

      return Array.from(
        new Map(
          activeRoleCodes
            .map((roleCode) => normalizeText(roleCode))
            .filter(Boolean)
            .map((roleCode) => {
              const liveRole = rolesByCode.get(roleCode) || null;
              const catalogRole = getRoleCatalogEntry(roleCode);
              const permissionCodes = Array.isArray(liveRole?.permissionCodes)
                ? liveRole.permissionCodes
                : Array.isArray(catalogRole?.permissionCodes)
                  ? catalogRole.permissionCodes
                  : [];

              return [
                roleCode,
                {
                  ...catalogRole,
                  ...(liveRole || {}),
                  code:
                    normalizeText(liveRole?.code || catalogRole?.code || roleCode) ||
                    roleCode,
                  displayName:
                    normalizeText(
                      liveRole?.displayName ||
                      catalogRole?.displayName ||
                      catalogRole?.code ||
                      roleCode
                    ) || roleCode,
                  permissionCodes: Array.from(
                    new Set(
                      permissionCodes
                        .map((permissionCode) => normalizeText(permissionCode))
                        .filter(Boolean)
                    )
                  ).sort(),
                },
              ];
            })
        ).values()
      );
    },
    [
      rolesByCode,
      selectedWorkbenchUserBundles,
    ]
  );
  const selectedWorkbenchEffectiveAuthorityPreview = useMemo(
    () =>
      buildEffectiveAuthorityPreview({
        userBundles: selectedWorkbenchUserBundles,
        rolesByCode,
        l,
      }),
    [l, rolesByCode, selectedWorkbenchUserBundles]
  );
  useEffect(() => {
    if (activeTab !== "users" || !selectedWorkbenchUser?.id || !canReadAudit) {
      setSelectedWorkbenchAuditRows([]);
      setSelectedWorkbenchAuditLoading(false);
      setSelectedWorkbenchAuditError("");
      return;
    }

    let cancelled = false;
    setSelectedWorkbenchAuditLoading(true);
    setSelectedWorkbenchAuditError("");

    listAuditLogs({
      page: 1,
      pageSize: 200,
      targetUserId: selectedWorkbenchUser.id,
      resourceType: "user_role_scope",
    })
      .then((result) => {
        if (cancelled) {
          return;
        }
        setSelectedWorkbenchAuditRows(Array.isArray(result?.rows) ? result.rows : []);
      })
      .catch((requestError) => {
        if (cancelled) {
          return;
        }
        setSelectedWorkbenchAuditRows([]);
        setSelectedWorkbenchAuditError(
          getErrorMessage(
            requestError,
            l(
              "Assignment audit history is not available for the selected user.",
              "Secili kullanici icin atama audit gecmisi kullanilamiyor."
            )
          )
        );
      })
      .finally(() => {
        if (cancelled) {
          return;
        }
        setSelectedWorkbenchAuditLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab, canReadAudit, l, selectedWorkbenchUser?.id]);
  const selectedWorkbenchAssignmentAuditSummary = useMemo(
    () =>
      buildAssignmentAuditSummary({
        userBundles: selectedWorkbenchUserBundles,
        auditRows: selectedWorkbenchAuditRows,
        auditReadable: canReadAudit && !selectedWorkbenchAuditError,
        l,
        rolesByCode,
      }),
    [
      canReadAudit,
      l,
      rolesByCode,
      selectedWorkbenchAuditError,
      selectedWorkbenchAuditRows,
      selectedWorkbenchUserBundles,
    ]
  );
  const pendingInviteRows = useMemo(
    () =>
      users.filter((row) => {
        const normalizedStatus = normalizeText(row.status).toUpperCase();
        const normalizedInviteStatus = normalizeText(row.invite_status).toUpperCase();
        return normalizedStatus === "INVITED" || normalizedInviteStatus === "PENDING";
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
  const userModalVisibilityDraftScopeOptions = useMemo(
    () =>
      buildScopeOptions(
        userModalVisibilityDraft.scopeType,
        lookups,
        tenantScopeId
      ),
    [lookups, tenantScopeId, userModalVisibilityDraft.scopeType]
  );
  const userModalRoleCodes = useMemo(
    () =>
      buildTemplateRoleCodes(
        userModalForm.presetCode,
        Boolean(userModalForm.includePostingAuthority)
      ),
    [userModalForm.includePostingAuthority, userModalForm.presetCode]
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
  const userModalVisibilityWriteAccess = getPermissionAccess(
    "security.data_scope.upsert"
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
  const selectedRawAssignmentUserBundles = useMemo(
    () =>
      assignmentBundles.filter(
        (bundle) => Number(bundle.userId || 0) === Number(rawAssignmentForm.userId || 0)
      ),
    [assignmentBundles, rawAssignmentForm.userId]
  );
  const rawAssignmentConflictWarnings = useMemo(() => {
    if (normalizeText(rawAssignmentForm.effect).toUpperCase() === "DENY") {
      return [];
    }
    const selectedRole = roles.find(
      (role) => Number(role.id || 0) === Number(rawAssignmentForm.roleId || 0)
    );
    const roleCode = normalizeText(selectedRole?.code);
    if (!roleCode || !selectedRawScopeId) {
      return [];
    }
    return buildCandidateRoleConflictWarnings({
      candidateRoleCode: roleCode,
      scopeType: rawAssignmentForm.scopeType,
      scopeId: selectedRawScopeId,
      scopeLabel: buildScopeLabel(
        rawAssignmentForm.scopeType,
        selectedRawScopeId,
        lookups,
        tenantScopeId
      ),
      userBundles: selectedRawAssignmentUserBundles,
      rolesByCode,
      l,
    });
  }, [
    l,
    lookups,
    rawAssignmentForm.effect,
    rawAssignmentForm.roleId,
    rawAssignmentForm.scopeType,
    roles,
    rolesByCode,
    selectedRawAssignmentUserBundles,
    selectedRawScopeId,
    tenantScopeId,
  ]);
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
    if (userDirectoryRows.length === 0) {
      setSelectedWorkbenchUserId("");
      return;
    }
    if (!selectedWorkbenchUserId) {
      const fallbackUser = filteredUsers[0] || userDirectoryRows[0] || null;
      setSelectedWorkbenchUserId(fallbackUser ? String(fallbackUser.id) : "");
      return;
    }
    if (
      !userDirectoryRows.some(
        (row) => Number(row.id) === Number(selectedWorkbenchUserId)
      )
    ) {
      const fallbackUser = filteredUsers[0] || userDirectoryRows[0] || null;
      setSelectedWorkbenchUserId(fallbackUser ? String(fallbackUser.id) : "");
    }
  }, [filteredUsers, selectedWorkbenchUserId, userDirectoryRows]);
  useEffect(() => {
    if (selectedWorkbenchUserBundles.length === 0) {
      setSelectedWorkbenchBundleId("");
      return;
    }
    if (!selectedWorkbenchUserBundles.some((bundle) => bundle.id === selectedWorkbenchBundleId)) {
      setSelectedWorkbenchBundleId(selectedWorkbenchUserBundles[0].id);
    }
  }, [selectedWorkbenchBundleId, selectedWorkbenchUserBundles]);
  useEffect(() => {
    if (!rawAssignmentForm.userId && users.length > 0) {
      setRawAssignmentForm((prev) => ({ ...prev, userId: String(users[0].id) }));
    }
  }, [rawAssignmentForm.userId, users]);
  useEffect(() => {
    const selectedUserId = String(selectedWorkbenchUser?.id || "");
    if (!selectedUserId) {
      return;
    }
    setRawAssignmentForm((prev) =>
      prev.userId === selectedUserId ? prev : { ...prev, userId: selectedUserId }
    );
  }, [selectedWorkbenchUser?.id]);
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
    setUserModalVisibilityDraft((prev) => {
      if (!userModalOpen || userModalMode !== "invite" || !userModalPreset?.scopeType) {
        return prev;
      }
      const recommendedScopeType =
        normalizeText(userModalPreset.scopeType).toUpperCase() || "LEGAL_ENTITY";
      const recommendedScopeId = resolvePreferredScopeId(
        recommendedScopeType,
        userModalForm.scopeId,
        lookups,
        tenantScopeId
      );
      if (
        prev.scopeType === recommendedScopeType &&
        prev.scopeId === recommendedScopeId
      ) {
        return prev;
      }
      return {
        ...prev,
        scopeType: recommendedScopeType,
        scopeId: recommendedScopeId,
      };
    });
  }, [
    lookups,
    tenantScopeId,
    userModalForm.scopeId,
    userModalMode,
    userModalOpen,
    userModalPreset?.scopeType,
  ]);
  useEffect(() => {
    setUserModalVisibilityDraft((prev) => {
      if (!userModalOpen) {
        return prev;
      }
      const nextScopeId = resolvePreferredScopeId(
        prev.scopeType,
        prev.scopeId,
        lookups,
        tenantScopeId
      );
      return prev.scopeId === nextScopeId ? prev : { ...prev, scopeId: nextScopeId };
    });
  }, [lookups, tenantScopeId, userModalOpen, userModalVisibilityDraftScopeOptions]);
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
  const loadData = useCallback(async (options = {}) => {
    const showLoadingState = options.showLoadingState !== false;
    if (showLoadingState) {
      setLoading(true);
    }
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
      if (showLoadingState) {
        setLoading(false);
      }
    }
  }, [canReadOrgTree, l]);

  useEffect(() => {
    loadData();
  }, [loadData]);
  function createUserModalVisibilityDraft(scopeType = "LEGAL_ENTITY", preferredScopeId = "") {
    const normalizedScopeType = normalizeText(scopeType).toUpperCase() || "LEGAL_ENTITY";
    return {
      scopeType: normalizedScopeType,
      scopeId: resolvePreferredScopeId(
        normalizedScopeType,
        preferredScopeId,
        lookups,
        tenantScopeId
      ),
      effect: "ALLOW",
    };
  }
  function openInviteModal() {
    setUserModalVersion((prev) => prev + 1);
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
      includePostingAuthority: false,
    });
    setUserModalInviteLink("");
    setUserModalVisibilityRules([]);
    setUserModalVisibilityDraft(createUserModalVisibilityDraft());
    setUserModalOpen(true);
  }
  function openExistingUserModal(userRow) {
    const userId = Number(userRow?.id || 0);
    const firstBundle = assignmentBundles.find((bundle) => Number(bundle.userId) === userId) || null;
    setUserModalVersion((prev) => prev + 1);
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
    setUserModalInviteLink("");
    setUserModalVisibilityRules([]);
    setUserModalVisibilityDraft(createUserModalVisibilityDraft());
    setUserModalOpen(true);
  }
  function closeUserModal() {
    setUserModalInviteLink("");
    setUserModalOpen(false);
  }
  function updateUserModalField(field, value) {
    setUserModalForm((prev) => {
      if (field === "presetCode") {
        return {
          ...prev,
          presetCode: value,
          scopeId: "",
          includePostingAuthority: value
            ? prev.includePostingAuthority
            : false,
        };
      }
      return { ...prev, [field]: value };
    });
  }
  function updateUserModalVisibilityDraftField(field, value) {
    setUserModalVisibilityDraft((prev) => {
      if (field === "scopeType") {
        const normalizedScopeType =
          normalizeText(value).toUpperCase() || "LEGAL_ENTITY";
        return {
          ...prev,
          scopeType: normalizedScopeType,
          scopeId: resolvePreferredScopeId(
            normalizedScopeType,
            "",
            lookups,
            tenantScopeId
          ),
        };
      }
      return { ...prev, [field]: value };
    });
  }
  function addUserModalVisibilityRule() {
    const normalizedScopeType = normalizeText(userModalVisibilityDraft.scopeType).toUpperCase();
    const scopeId =
      normalizedScopeType === "TENANT"
        ? Number(tenantScopeId || userModalVisibilityDraft.scopeId || 0)
        : Number(userModalVisibilityDraft.scopeId || 0);
    if (!scopeId) {
      setError(
        l(
          "Choose a valid organizational visibility target first.",
          "Once gecerli bir organizasyon gorunurluk hedefi secin."
        )
      );
      return;
    }
    setError("");
    setUserModalVisibilityRules((prev) => {
      const nextRow = {
        scopeType: normalizedScopeType,
        scopeId,
        effect: normalizeText(userModalVisibilityDraft.effect).toUpperCase() || "ALLOW",
      };
      const withoutMatch = prev.filter(
        (row) =>
          !(
            normalizeText(row.scopeType).toUpperCase() === nextRow.scopeType &&
            Number(row.scopeId || 0) === nextRow.scopeId
          )
      );
      return [...withoutMatch, nextRow];
    });
  }
  function removeUserModalVisibilityRule(scopeType, scopeId) {
    setUserModalVisibilityRules((prev) =>
      prev.filter(
        (row) =>
          !(
            normalizeText(row.scopeType).toUpperCase() ===
              normalizeText(scopeType).toUpperCase() &&
            Number(row.scopeId || 0) === Number(scopeId || 0)
          )
      )
    );
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
  async function handleAssignDefaultEntityAccountantRoles({
    targetUserId,
    scopeId,
  }) {
    const normalizedUserId = Number(targetUserId || 0);
    const normalizedScopeId = Number(scopeId || 0);
    const preset = getBootstrapHandoffPresetEntry(
      DEFAULT_ENTITY_ACCOUNTANT_PRESET_CODE
    );
    if (!normalizedUserId) {
      setError(
        l(
          "Choose a user before assigning the default entity accountant roles.",
          "Varsayilan entity accountant rollerini atamadan once bir kullanici secin."
        )
      );
      return;
    }
    if (!normalizedScopeId || !preset?.scopeType) {
      setError(
        l(
          "Choose a legal entity before assigning the default entity accountant roles.",
          "Varsayilan entity accountant rollerini atamadan once bir legal entity secin."
        )
      );
      return;
    }
    const assignmentAccess = getPermissionAccess(
      "security.role_assignment.upsert",
      {
        scope: {
          scopeType: preset.scopeType,
          scopeId: normalizedScopeId,
        },
      }
    );
    if (!assignmentAccess.allowed) {
      setError(
        l(
          "You do not have permission to assign the default entity accountant roles at this legal entity.",
          "Bu legal entity kapsaminda varsayilan entity accountant rollerini atama yetkiniz yok."
        )
      );
      return;
    }

    setActingRowId(`default-entity-accountant-${normalizedUserId}`);
    setSaving(true);
    setError("");
    setMessage("");
    setWarningMessages([]);
    try {
      const warnings = await applyPresetAssignments({
        targetUserId: normalizedUserId,
        presetCode: DEFAULT_ENTITY_ACCOUNTANT_PRESET_CODE,
        scopeId: normalizedScopeId,
        includePostingAuthority: false,
        effectiveFrom: "",
        effectiveTo: "",
      });
      setWarningMessages(warnings);
      setMessage(
        l(
          "Default entity accountant roles assigned.",
          "Varsayilan entity accountant rolleri atandi."
        )
      );
      await loadData({ showLoadingState: false });
    } catch (requestError) {
      setError(
        getErrorMessage(
          requestError,
          l(
            "The default entity accountant roles could not be assigned.",
            "Varsayilan entity accountant rolleri atanamadi."
          )
        )
      );
    } finally {
      setActingRowId("");
      setSaving(false);
    }
  }
  async function handleSaveUserModal(event) {
    event.preventDefault();
    const isInvite = userModalMode === "invite";
    const hasPreset = Boolean(normalizeText(userModalForm.presetCode));
    const hasVisibilityRules = userModalVisibilityRules.length > 0;
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
      if (!hasVisibilityRules) {
        setError(
          l(
            "Add at least one organizational visibility rule before sending the invite.",
            "Daveti gondermeden once en az bir organizasyon gorunurluk kurali ekleyin."
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
    if (
      isInvite &&
      hasVisibilityRules &&
      !userModalVisibilityWriteAccess.allowed
    ) {
      setError(
        l(
          "You do not have permission to save organizational visibility rules.",
          "Organizasyon gorunurluk kurallarini kaydetme yetkiniz yok."
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
        setUserModalInviteLink(inviteUrl);
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
      if (isInvite && hasVisibilityRules) {
        await replaceUserDataScopes(targetUserId, userModalVisibilityRules);
      }
      setWarningMessages(warnings);
      setMessage(
        isInvite
          ? hasPreset
            ? hasVisibilityRules
              ? l(
                  "Invite created, access template applied, and organizational visibility rules saved.",
                  "Davet olusturuldu, erisim template'i uygulandi ve organizasyon gorunurluk kurallari kaydedildi."
                )
              : l("Invite created and access template applied.", "Davet olusturuldu ve erisim template'i uygulandi.")
            : hasVisibilityRules
              ? l(
                  "Invite created and organizational visibility rules saved.",
                  "Davet olusturuldu ve organizasyon gorunurluk kurallari kaydedildi."
                )
              : l("Invite created.", "Davet olusturuldu.")
          : l("Access template applied.", "Erisim template'i uygulandi.")
      );
      closeUserModal();
      await loadData({ showLoadingState: false });
    } catch (requestError) {
      if (inviteUrl) {
        setLastInviteLink(inviteUrl);
        setUserModalInviteLink(inviteUrl);
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
  /*
    async function handleCreatePresetAssignment() {
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
        await loadData({ showLoadingState: false });
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
  */
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
      await loadData({ showLoadingState: false });
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
  async function handleUpdateBundleRoleRow(assignmentRow, nextRowState) {
    if (!assignmentRow?.assignmentId) {
      return false;
    }
    const nextScopeType = String(nextRowState?.scopeType || assignmentRow.scopeType || "TENANT")
      .trim()
      .toUpperCase();
    const nextScopeId =
      nextScopeType === "TENANT"
        ? Number(tenantScopeId || nextRowState?.scopeId || assignmentRow.scopeId || 0)
        : Number(nextRowState?.scopeId || 0);
    const nextEffect = String(nextRowState?.effect || assignmentRow.effect || "ALLOW")
      .trim()
      .toUpperCase();
    if (!nextScopeId) {
      setError(l("Choose a valid scope before saving this role row.", "Bu rol satirini kaydetmeden once gecerli bir kapsam secin."));
      return false;
    }
    const currentScopeAccess = getPermissionAccess(
      "security.role_assignment.upsert",
      assignmentRow.scopeId
        ? {
            scope: {
              scopeType: assignmentRow.scopeType,
              scopeId: assignmentRow.scopeId,
            },
          }
        : undefined
    );
    if (!currentScopeAccess.allowed) {
      setError(
        l(
          "You do not have permission to modify this role row from its current scope.",
          "Bu rol satirini mevcut kapsamindan duzenleme yetkiniz yok."
        )
      );
      return false;
    }
    const nextScopeAccess = getPermissionAccess(
      "security.role_assignment.upsert",
      {
        scope: {
          scopeType: nextScopeType,
          scopeId: nextScopeId,
        },
      }
    );
    if (!nextScopeAccess.allowed) {
      setError(
        l(
          "You do not have permission to save this role row at the selected scope.",
          "Bu rol satirini secilen kapsamda kaydetme yetkiniz yok."
        )
      );
      return false;
    }

    setActingRowId(`bundle-role-${assignmentRow.assignmentId}`);
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await replaceRoleAssignmentScope(assignmentRow.assignmentId, {
        scopeType: nextScopeType,
        scopeId: nextScopeId,
        effect: nextEffect,
        effectiveFrom: nextRowState?.effectiveFrom || undefined,
        effectiveTo: nextRowState?.effectiveTo || undefined,
      });
      setWarningMessages(response?.assignmentWarnings || []);
      setMessage(
        l(
          "Role row updated. Bundle grouping may change if scope or dates changed.",
          "Rol satiri guncellendi. Kapsam veya tarihler degistiyse paket gruplamasi da degisebilir."
        )
      );
      await loadData({ showLoadingState: false });
      return true;
    } catch (requestError) {
      setError(
        getErrorMessage(
          requestError,
          l(
            "The role row scope could not be updated.",
            "Rol satirinin kapsami guncellenemedi."
          )
        )
      );
      return false;
    } finally {
      setActingRowId("");
      setSaving(false);
    }
  }
  async function handleRemoveBundleRoleRow(assignmentRow) {
    if (!assignmentRow?.assignmentId) {
      return;
    }
    const revokeAccess = getPermissionAccess(
      "security.role_assignment.upsert",
      assignmentRow.scopeId
        ? {
            scope: {
              scopeType: assignmentRow.scopeType,
              scopeId: assignmentRow.scopeId,
            },
          }
        : undefined
    );
    if (!revokeAccess.allowed) {
      setError(
        l(
          "You do not have permission to remove this role row.",
          "Bu rol satirini kaldirma yetkiniz yok."
        )
      );
      return;
    }
    const confirmed = window.confirm(
      l(
        "Remove only {{role}} from this bundle? The other role rows will stay unchanged.",
        "Yalnizca {{role}} rolunu bu paketten kaldirmak istiyor musunuz? Diger rol satirlari degismeden kalir.",
        {
          role: assignmentRow.roleLabel || assignmentRow.roleCode || l("this role", "bu rol"),
        }
      )
    );
    if (!confirmed) {
      return;
    }

    setActingRowId(`bundle-role-${assignmentRow.assignmentId}`);
    setSaving(true);
    setError("");
    setMessage("");
    setWarningMessages([]);
    try {
      await deleteRoleAssignment(assignmentRow.assignmentId);
      setMessage(
        l(
          "Role row removed. Other bundle roles stayed unchanged.",
          "Rol satiri kaldirildi. Diger paket rolleri degismeden kaldi."
        )
      );
      await loadData({ showLoadingState: false });
    } catch (requestError) {
      setError(
        getErrorMessage(
          requestError,
          l("The role row could not be removed.", "Rol satiri kaldirilamadi.")
        )
      );
    } finally {
      setActingRowId("");
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
      await loadData({ showLoadingState: false });
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
      await loadData({ showLoadingState: false });
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
      await loadData({ showLoadingState: false });
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
    <SecurityAdminWorkspaceShell
      workspaceSectionKey="users"
      sectionKey="user-assignments"
      eyebrow={l("Security / Assignment Workspace", "Guvenlik / atama calisma alani")}
      title={l(
        "Users & Assignments Workbench",
        "Kullanicilar ve Atamalar Workbench'i"
      )}
      description={l(
        "Keep user selection, business assignment bundles, and authority review inside one canonical users workbench while scope access, delegations, and temporary coverage live beside it as sibling surfaces.",
        "Kullanici secimini, is atama paketlerini ve yetki incelemesini tek bir canonical users workbench icinde tutarken kapsam erisimi, delegasyonlar ve gecici kapsama kayitlarini kardes yuzeylerde yasatin."
      )}
      actions={[
        {
          to: "/app/ayarlar/rbac/delegations",
          label: l("Open delegations page", "Delegasyon sayfasini ac"),
        },
        {
          onClick: openInviteModal,
          label: l("Invite user", "Kullanici davet et"),
        },
      ]}
      stats={[
        {
          title: l("Total users", "Toplam kullanici"),
          value: users.length,
          description: l(
            "All active, invited, and disabled users inside this tenant.",
            "Bu tenant icindeki tum aktif, davetli ve devre disi kullanicilar."
          ),
          tone: "blue",
        },
        {
          title: l("Business assignments", "Is atamalari"),
          value: assignmentBundles.length,
          description: l(
            "Grouped business-first bundles instead of one row per raw RBAC role.",
            "Ham RBAC rol basina bir satir yerine gruplanmis is-oncelikli paketler."
          ),
          tone: "green",
        },
        {
          title: l("Pending invites", "Bekleyen davetler"),
          value: pendingInviteRows.length,
          description: l(
            "Invite flows that still need acceptance before the user becomes active.",
            "Kullanici aktif olmadan once hala kabul bekleyen davet akisleri."
          ),
          tone: "amber",
        },
        {
          title: l("Delegation workflows", "Delegation akislari"),
          value: totalDelegationCount,
          description: l(
            "Approval delegation and temporary coverage items still in motion.",
            "Hareket halindeki approval delegation ve temporary coverage kayitlari."
          ),
        },
      ]}
      showHeader={false}
      showStats={false}
      showGuidancePanel={false}
      hiddenPrimarySurfaceKeys={["roles-permissions"]}
    >
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
      {loading ? (
        <SecurityWorkbenchLoadingState
          title={l("Users workspace", "Kullanici calisma alani")}
          description={l("Loading workspace...", "Calisma alani yukleniyor...")}
        />
      ) : null}
      {!loading && activeTab === "users" ? (
        <section className="space-y-5">
          <UserAssignmentWorkbench
            onInviteUser={openInviteModal}
            actingRowId={actingRowId}
            filteredUsers={filteredUsers}
            l={l}
            onClearFilters={() =>
              setUserFilters({
                search: "",
                status: "ALL",
                scopeType: "",
                scopeTarget: "",
                sourceType: "",
              })
            }
            onSelectBundle={setSelectedWorkbenchBundleId}
            onSelectUser={setSelectedWorkbenchUserId}
            onUpdateBundleRoleRow={handleUpdateBundleRoleRow}
            onRemoveBundleRoleRow={handleRemoveBundleRoleRow}
            saving={saving}
            selectedUserAssignmentAuditReadable={canReadAudit}
            selectedUserAssignmentAuditSummary={
              selectedWorkbenchAssignmentAuditSummary
            }
            selectedUserAuditError={selectedWorkbenchAuditError}
            selectedUserAuditLoading={selectedWorkbenchAuditLoading}
            selectedUserEffectiveAuthorityPreview={
              selectedWorkbenchEffectiveAuthorityPreview
            }
            rawAssignmentForm={rawAssignmentForm}
            onAssignDefaultEntityAccountantRoles={
              handleAssignDefaultEntityAccountantRoles
            }
            onUpdateRawAssignmentField={updateRawAssignmentField}
            onCreateRawAssignment={handleCreateRawAssignment}
            rawAssignmentWriteAccess={rawAssignmentWriteAccess}
            rawAssignmentConflictWarnings={rawAssignmentConflictWarnings}
            rawScopeOptions={rawScopeOptions}
            assignableRoleGroups={assignableRoleGroups}
            lookups={lookups}
            tenantScopeId={tenantScopeId}
            scopeTargetOptions={scopeTargetOptions}
            selectedBundle={selectedWorkbenchBundle}
            selectedUser={selectedWorkbenchUser}
            selectedUserBundles={selectedWorkbenchUserBundles}
            selectedUserRoleEntries={selectedWorkbenchActiveRoleEntries}
            setUserFilters={setUserFilters}
            userFilters={userFilters}
          />
        </section>
      ) : null}
      {!loading && activeTab === "assignments" ? (
        <section className="space-y-5">
          <div className="space-y-5">
            <div className="overflow-hidden rounded-[18px] border border-slate-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-slate-50 px-5 py-4">
                <div>
                  <h2 className="text-sm font-semibold text-slate-950">
                    {l("Business assignments", "Is atamalari")}
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    {l(
                      "Compact assignment registry by assignee, template, scope, and date.",
                      "Atanan kisi, template, kapsam ve tarihe gore kompakt atama kaydi."
                    )}
                  </p>
                </div>
                <div className="text-sm text-slate-500">
                  {l("{{count}} rows", "{{count}} satir", {
                    count: filteredBundles.length,
                  })}
                </div>
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
                      {getPresetDisplayLabel(presetCode)}
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
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[980px] border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50/70">
                          <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                            {l("Assignment", "Atama")}
                          </th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                            {l("Assignee", "Atanan")}
                          </th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                            {l("Scope", "Kapsam")}
                          </th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                            {l("Composition", "Icerik")}
                          </th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                            {l("Effective", "Yururluk")}
                          </th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                            {l("Status", "Durum")}
                          </th>
                          <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                            {l("Actions", "Aksiyonlar")}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredBundles.map((bundle) => (
                          <AssignmentBundleRow
                            key={bundle.id}
                            bundle={bundle}
                            selected={selectedBundle?.id === bundle.id}
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
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
            {/*
            {false ? <aside className="xl:sticky xl:top-20 xl:self-start">
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
                          {getPresetDisplayLabel(presetCode)}
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
                        {l(
                          "Include manual GL posting authority",
                          "Manuel GL posting authority dahil et"
                        )}
                      </span>
                      <span className="mt-1 block text-sm leading-6 text-violet-900">
                        {l(
                          "Keep manual GL journal posting explicit instead of hiding it as an automatic side effect of the preset. Period close stays separate.",
                          "Manuel GL fis postlama yetkisini preset'in otomatik bir yan etkisi olarak gizlemek yerine acik tutun. Donem kapatma ayri kalir."
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
                        <strong className="text-right text-slate-950">
                          {getPresetDisplayLabel(assignmentForm.presetCode)}
                        </strong>
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
                          "Use direct runtime roles here only when you need an exact exception at the selected scope.",
                          "Burada dogrudan runtime rolleri yalnizca secili kapsamda tam bir istisna gerektiginde kullanin."
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
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <label className="text-sm font-semibold text-slate-700">
                          {l("Effective from", "Baslangic tarihi")}
                        </label>
                        <input
                          type="date"
                          value={rawAssignmentForm.effectiveFrom}
                          onChange={(event) =>
                            updateRawAssignmentField("effectiveFrom", event.target.value)
                          }
                          className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-semibold text-slate-700">
                          {l("Effective to", "Bitis tarihi")}
                        </label>
                        <input
                          type="date"
                          value={rawAssignmentForm.effectiveTo}
                          onChange={(event) =>
                            updateRawAssignmentField("effectiveTo", event.target.value)
                          }
                          className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
                        />
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">
                      {l(
                        "Set dates when this exception should stay temporary. Leave both blank for a standing exception row.",
                        "Bu istisnanin gecici kalmasi gerekiyorsa tarih verin. Kalici istisna satiri icin ikisini de bos birakin."
                      )}
                    </div>
                    <PermissionAccessNotice
                      access={rawAssignmentWriteAccess}
                      permissionCode="security.role_assignment.upsert"
                    />
                    <div className="flex flex-wrap gap-3">
                      <button
                        type="submit"
                        disabled={saving}
                        className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {saving
                          ? l("Saving...", "Kaydediliyor...")
                          : l("Create raw role row", "Ham rol satiri olustur")}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setRawAssignmentForm((prev) => ({
                            ...prev,
                            effectiveFrom: "",
                            effectiveTo: "",
                          }))
                        }
                        className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700"
                      >
                        {l("Clear dates", "Tarihleri temizle")}
                      </button>
                    </div>
                  </form>
                </details>
              </div>
            </aside> : null}
            */}
          </div>
          <div className="overflow-hidden rounded-[18px] border border-slate-200 bg-white">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 bg-slate-50 px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-950">
                  {l("Pending invites", "Bekleyen davetler")}
                </h2>
                <p className="mt-1 max-w-3xl text-xs text-slate-500">
                  {l(
                    "Open invite records without mixing them into live user assignments.",
                    "Davet kayitlarini canli kullanici atamalarina karistirmadan acin."
                  )}
                </p>
              </div>
              <div className="text-sm text-slate-500">
                {l("{{count}} rows", "{{count}} satir", {
                  count: pendingInviteRows.length,
                })}
              </div>
            </div>
            <div className="px-5 py-5">
              {pendingInviteRows.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">
                  {l("No pending invites.", "Bekleyen davet yok.")}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[780px] border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/70">
                        <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                          {l("Invitee", "Davetli")}
                        </th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                          {l("Email", "E-posta")}
                        </th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                          {l("Created", "Olusturuldu")}
                        </th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                          {l("Expires", "Bitis")}
                        </th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                          {l("Status", "Durum")}
                        </th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                          {l("Actions", "Aksiyonlar")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {pendingInviteRows.map((row) => (
                        <tr
                          key={`pending-invite-${row.id}`}
                          className="border-b border-slate-100 align-top"
                        >
                          <td className="px-4 py-3 font-semibold text-slate-900">
                            {row.name}
                          </td>
                          <td className="px-4 py-3 text-slate-700">{row.email}</td>
                          <td className="px-4 py-3 text-slate-700">
                            {formatDateTime(row.created_at)}
                          </td>
                          <td className="px-4 py-3 text-slate-700">
                            {row.invite_expires_at
                              ? formatDateTime(row.invite_expires_at)
                              : "-"}
                          </td>
                          <td className="px-4 py-3">
                            <StatusPill
                              label={l("Pending invite", "Bekleyen davet")}
                              tone="amber"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => openExistingUserModal(row)}
                                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700"
                              >
                                {l("Open", "Ac")}
                              </button>
                              {lastInviteLink ? (
                                <button
                                  type="button"
                                  onClick={copyInviteLink}
                                  className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-800"
                                >
                                  {l("Copy link", "Baglantiyi kopyala")}
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
                onClick={() => setWorkspaceDelegationTab("coverage")}
              />
              <WorkspaceTabButton
                active={delegationTab === "approval"}
                count={approvalDelegations.length}
                label={l("Approval delegation", "Approval delegation")}
                onClick={() => setWorkspaceDelegationTab("approval")}
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
                            <DelegationStateBadge state={resolveCoverageTemporalState(row)} />
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
                            {l("Coverage window", "Coverage penceresi")}{" "}
                            {formatDate(row.startDate)}
                            {" -> "}
                            {formatDate(row.endDate)} -{" "}
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
        key={userModalVersion}
        open={userModalOpen}
        mode={userModalMode}
        form={userModalForm}
        onChange={updateUserModalField}
        onClose={closeUserModal}
        onSubmit={handleSaveUserModal}
        saving={saving}
        l={l}
        permissionAccess={userModalAccess}
        modalScopeOptions={userModalScopeOptions}
        missingRoleCodes={userModalMissingRoleCodes}
        inviteLink={userModalInviteLink}
        visibilityRules={userModalVisibilityRules}
        visibilityDraft={userModalVisibilityDraft}
        visibilityDraftScopeOptions={userModalVisibilityDraftScopeOptions}
        visibilityWriteAccess={userModalVisibilityWriteAccess}
        onUpdateVisibilityDraftField={updateUserModalVisibilityDraftField}
        onAddVisibilityRule={addUserModalVisibilityRule}
        onRemoveVisibilityRule={removeUserModalVisibilityRule}
        lookups={lookups}
        tenantScopeId={tenantScopeId}
      />
    </SecurityAdminWorkspaceShell>
  );
}
