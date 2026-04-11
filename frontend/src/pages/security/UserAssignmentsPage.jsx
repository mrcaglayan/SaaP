
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  getOperationalCoverageWorkspace,
  listApprovalDelegations,
  revokeApprovalDelegation,
  revokeOperationalCoverage,
} from "../../api/approvalDelegations.js";
import {
  createOrUpdateRole,
  createRoleAssignment,
  createSecurityInvite,
  deleteRoleAssignment,
  generateComplianceAuditReport,
  listAuditLogs,
  listCountries,
  listGroupCompanies,
  listLegalEntities,
  listOperatingUnits,
  listRoleAssignments,
  listRoles,
  listUsers,
  replaceRolePermissions,
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
import { buildAssignmentAuditSummary } from "./userAssignmentAuditSummary.js";
import UserAssignmentWorkbench from "./UserAssignmentWorkbench.jsx";
import { SecurityWorkbenchLoadingState } from "./components/SecurityWorkbenchStates.jsx";
import { buildEffectiveAuthorityPreview } from "./userAssignmentAuthorityPreview.js";
import {
  BOOTSTRAP_HANDOFF_PRESET_CATALOG,
  buildScopeLabel,
  getBusinessRoleCatalogEntry,
  getBusinessRoleAssignmentRoleDefinition,
  getBootstrapHandoffPresetEntry,
  getBootstrapHandoffPresetDisplayLabel,
  getRoleCatalogEntry,
  getWorkflowPackageAssignmentRoleDefinition,
  groupRolesForManagement,
  isBusinessRoleAssignmentRoleCode,
  isWorkflowPackageAssignmentRoleCode,
  listBusinessRoleCatalogEntries,
  listWorkflowPresetCatalogEntries,
  listWorkflowPackageCatalogEntries,
  resolveWorkflowPackagesForRuntimeRoles,
} from "./roleCatalog.js";
import SecurityUsersWorkbenchTabs from "./components/users/SecurityUsersWorkbenchTabs.jsx";
import SecurityAdminWorkspaceShell from "./SecurityAdminWorkspaceShell.jsx";
const SCOPE_TYPES = ["TENANT", "GROUP", "COUNTRY", "LEGAL_ENTITY", "OPERATING_UNIT"];
const EFFECT_OPTIONS = ["ALLOW", "DENY"];
const USER_STATUS_FILTERS = ["ALL", "ACTIVE", "INVITED", "DISABLED"];
const ASSIGNMENT_STATUS_FILTERS = ["ALL", "ACTIVE", "UPCOMING", "EXPIRED", "CUSTOM"];
const USER_ASSIGNMENT_CANONICAL_TABS = ["people", "assignments", "authority"];
const DELEGATION_TAB_ORDER = ["coverage", "approval"];
const SOD_PREVIEW_LIMIT = 3;
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
function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}
function hasExactPermissionCodes(currentCodes, expectedCodes) {
  const current = Array.from(
    new Set((Array.isArray(currentCodes) ? currentCodes : []).map((code) => normalizeText(code)).filter(Boolean))
  ).sort();
  const expected = Array.from(
    new Set((Array.isArray(expectedCodes) ? expectedCodes : []).map((code) => normalizeText(code)).filter(Boolean))
  ).sort();
  if (current.length !== expected.length) {
    return false;
  }
  return current.every((code, index) => code === expected[index]);
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

function buildBusinessRoleLabelAssignments(assignments, usersById, lookups, tenantScopeId) {
  return (Array.isArray(assignments) ? assignments : [])
    .filter((assignment) => isBusinessRoleAssignmentRoleCode(assignment?.role_code))
    .map((assignment) => {
      const userId = Number(assignment.user_id || 0);
      const user = usersById.get(userId) || null;
      const roleEntry = getRoleCatalogEntry(assignment.role_code);
      return {
        assignmentId: Number(assignment.id || 0),
        userId,
        userName: normalizeText(user?.name || assignment.user_name || `User #${userId}`),
        userEmail: normalizeText(user?.email || assignment.user_email),
        roleId: Number(assignment.role_id || 0),
        businessRoleCode: roleEntry.businessRoleCode || "",
        businessRoleLabel: roleEntry.code,
        roleCode: normalizeText(assignment.role_code),
        scopeType: normalizeText(assignment.scope_type).toUpperCase(),
        scopeId: Number(assignment.scope_id || 0),
        scopeLabel: buildScopeLabel(
          assignment.scope_type,
          assignment.scope_id,
          lookups,
          tenantScopeId
        ),
        effect: normalizeText(assignment.effect).toUpperCase() || "ALLOW",
        effectiveFrom: assignment.effective_from || "",
        effectiveTo: assignment.effective_to || "",
        createdAt: assignment.created_at || "",
        status: resolveAssignmentLifecycle([assignment]),
      };
    })
    .sort((left, right) => {
      if (left.userId !== right.userId) {
        return left.userId - right.userId;
      }
      return left.businessRoleLabel.localeCompare(right.businessRoleLabel);
    });
}

function buildWorkflowPackageAssignments(assignments, usersById, lookups, tenantScopeId) {
  return (Array.isArray(assignments) ? assignments : [])
    .filter((assignment) => isWorkflowPackageAssignmentRoleCode(assignment?.role_code))
    .map((assignment) => {
      const userId = Number(assignment.user_id || 0);
      const user = usersById.get(userId) || null;
      const roleEntry = getRoleCatalogEntry(assignment.role_code);
      return {
        assignmentId: Number(assignment.id || 0),
        userId,
        userName: normalizeText(user?.name || assignment.user_name || `User #${userId}`),
        userEmail: normalizeText(user?.email || assignment.user_email),
        roleId: Number(assignment.role_id || 0),
        packageCode: roleEntry.workflowPackageCode || "",
        packageLabel: roleEntry.code,
        roleCode: normalizeText(assignment.role_code),
        scopeType: normalizeText(assignment.scope_type).toUpperCase(),
        scopeId: Number(assignment.scope_id || 0),
        scopeLabel: buildScopeLabel(
          assignment.scope_type,
          assignment.scope_id,
          lookups,
          tenantScopeId
        ),
        effect: normalizeText(assignment.effect).toUpperCase() || "ALLOW",
        effectiveFrom: assignment.effective_from || "",
        effectiveTo: assignment.effective_to || "",
        createdAt: assignment.created_at || "",
        status: resolveAssignmentLifecycle([assignment]),
        workflowFamilyLabel: roleEntry.workflowFamilyLabel || "",
        allowedScopes: Array.isArray(roleEntry.allowedScopes) ? roleEntry.allowedScopes : [],
        permissionCodes: Array.isArray(roleEntry.permissionCodes) ? roleEntry.permissionCodes : [],
        permissionCount: Array.isArray(roleEntry.permissionCodes)
          ? roleEntry.permissionCodes.length
          : 0,
        packageSummary: roleEntry.summary || roleEntry.description || "",
      };
    })
    .sort((left, right) => {
      if (left.userId !== right.userId) {
        return left.userId - right.userId;
      }
      if (left.scopeType !== right.scopeType) {
        return left.scopeType.localeCompare(right.scopeType);
      }
      if (left.scopeId !== right.scopeId) {
        return left.scopeId - right.scopeId;
      }
      return left.packageLabel.localeCompare(right.packageLabel);
    });
}

function findStarterBundleSourceMatch(packageCodes, businessRoleAssignments) {
  const normalizedPackageCodes = Array.from(
    new Set((Array.isArray(packageCodes) ? packageCodes : []).map((code) => normalizeText(code)).filter(Boolean))
  );
  if (normalizedPackageCodes.length === 0) {
    return null;
  }

  const matches = (Array.isArray(businessRoleAssignments) ? businessRoleAssignments : [])
    .map((assignment) => {
      const businessRoleEntry = getBusinessRoleCatalogEntry(assignment.businessRoleCode);
      const candidatePackageCodes = Array.from(
        new Set([
          ...(businessRoleEntry.starterPackageCodes || []),
          ...(businessRoleEntry.optionalPackageCodes || []),
        ])
      );
      if (
        candidatePackageCodes.length === 0 ||
        !normalizedPackageCodes.every((packageCode) => candidatePackageCodes.includes(packageCode))
      ) {
        return null;
      }
      return {
        sourceType: "STARTER_DERIVED",
        sourceTypeLabel: "Starter-derived",
        sourceDetail: `${businessRoleEntry.displayName} starter bundle`,
        sourceBusinessRoleCode: businessRoleEntry.code,
        sourceBusinessRoleLabel: businessRoleEntry.displayName,
        sortOrder: Number(businessRoleEntry.sortOrder || 9999),
        packageCount: candidatePackageCodes.length,
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (left.sortOrder !== right.sortOrder) {
        return left.sortOrder - right.sortOrder;
      }
      return left.packageCount - right.packageCount;
    });

  return matches[0] || null;
}

function findWorkflowPresetSourceMatch(packageCodes, workflowPresetCatalogEntries) {
  const normalizedPackageCodes = Array.from(
    new Set((Array.isArray(packageCodes) ? packageCodes : []).map((code) => normalizeText(code)).filter(Boolean))
  );
  if (normalizedPackageCodes.length === 0) {
    return null;
  }

  const matches = (Array.isArray(workflowPresetCatalogEntries)
    ? workflowPresetCatalogEntries
    : []
  ).filter(
    (entry) =>
      Array.isArray(entry.requiredPackageCodes) &&
      normalizedPackageCodes.every((packageCode) =>
        entry.requiredPackageCodes.includes(packageCode)
      )
  );
  if (matches.length === 0) {
    return null;
  }

  if (matches.length === 1) {
    return {
      sourceType: "PRESET_DERIVED",
      sourceTypeLabel: "Preset-derived",
      sourceDetail: matches[0].displayName,
      sourcePresetCodes: [matches[0].code],
      sourcePresetLabels: [matches[0].displayName],
    };
  }

  const previewLabels = matches.slice(0, 2).map((entry) => entry.displayName);
  const suffix = matches.length > 2 ? ` +${matches.length - 2}` : "";
  return {
    sourceType: "PRESET_DERIVED",
    sourceTypeLabel: "Preset-derived",
    sourceDetail: `${previewLabels.join(", ")}${suffix}`,
    sourcePresetCodes: matches.map((entry) => entry.code),
    sourcePresetLabels: matches.map((entry) => entry.displayName),
  };
}

function buildWorkflowPackageAssignmentSourceMap(
  workflowPackageAssignments,
  businessRoleLabelAssignments,
  workflowPresetCatalogEntries
) {
  const byGroupKey = new Map();
  for (const assignment of Array.isArray(workflowPackageAssignments)
    ? workflowPackageAssignments
    : []) {
    const groupKey = [
      Number(assignment.userId || 0),
      normalizeText(assignment.scopeType).toUpperCase(),
      Number(assignment.scopeId || 0),
      normalizeText(assignment.effect).toUpperCase() || "ALLOW",
      normalizeText(assignment.effectiveFrom),
      normalizeText(assignment.effectiveTo),
    ].join("|");
    if (!byGroupKey.has(groupKey)) {
      byGroupKey.set(groupKey, []);
    }
    byGroupKey.get(groupKey).push(assignment);
  }

  const byAssignmentId = new Map();
  for (const assignmentsAtScope of byGroupKey.values()) {
    const first = assignmentsAtScope[0] || null;
    if (!first) {
      continue;
    }
    const packageCodes = assignmentsAtScope.map((assignment) => assignment.packageCode);
    const sameScopeBusinessRoles = (Array.isArray(businessRoleLabelAssignments)
      ? businessRoleLabelAssignments
      : []
    ).filter(
      (assignment) =>
        Number(assignment.userId) === Number(first.userId) &&
        assignment.scopeType === first.scopeType &&
        Number(assignment.scopeId) === Number(first.scopeId)
    );
    const starterMatch = findStarterBundleSourceMatch(
      packageCodes,
      sameScopeBusinessRoles
    );
    const presetMatch = starterMatch
      ? null
      : findWorkflowPresetSourceMatch(packageCodes, workflowPresetCatalogEntries);
    const sourceInfo =
      starterMatch ||
      presetMatch || {
        sourceType: "DIRECT",
        sourceTypeLabel: "Direct / custom",
        sourceDetail: "Direct workflow package grant",
      };
    for (const assignment of assignmentsAtScope) {
      byAssignmentId.set(Number(assignment.assignmentId || 0), sourceInfo);
    }
  }
  return byAssignmentId;
}

function buildAssignmentBundles(assignments, usersById, lookups, tenantScopeId) {
  const grouped = new Map();
  for (const assignment of Array.isArray(assignments) ? assignments : []) {
    // Label-only business roles stay outside bundle/package explainability so
    // UI-2B does not blur non-authoritative titles with effective authority.
    // UI-2C direct workflow-package grants also stay outside these grouped
    // business bundles so one package can be removed independently later.
    if (
      isBusinessRoleAssignmentRoleCode(assignment?.role_code) ||
      isWorkflowPackageAssignmentRoleCode(assignment?.role_code)
    ) {
      continue;
    }
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
      const packageEntries = resolveWorkflowPackagesForRuntimeRoles(roleCodes);
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
        roleLabels: roleEntries.map((entry) => entry.code),
        packageCodes: packageEntries.map((entry) => entry.code),
        packageLabels: packageEntries.map((entry) => entry.displayName),
        workflowFamilyLabels: Array.from(
          new Set(packageEntries.map((entry) => entry.workflowFamilyLabel).filter(Boolean))
        ),
        status,
        presetCode: presetMatch?.presetCode || "",
        presetDisplayName: presetMatch?.preset?.displayName || "",
        presetSummary: presetMatch?.preset?.summary || "",
        optionalRoleCodes: presetMatch?.matchedOptionalRoleCodes || [],
        isPresetBundle: Boolean(presetMatch),
        sourceType: presetMatch ? "PRESET_DERIVED" : "DIRECT",
        sourceTypeLabel: presetMatch ? "Preset-derived" : "Direct / custom",
        scopeKey: `${normalizeText(first.scope_type).toUpperCase()}:${Number(first.scope_id || 0)}`,
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
function buildUserDirectoryRows(
  users,
  bundles,
  workflowPackageAssignments,
  workflowPackageAssignmentSourceMap,
  approvalRows,
  coverageRows,
  businessRoleLabelAssignments,
) {
  const bundleMap = new Map();
  for (const bundle of Array.isArray(bundles) ? bundles : []) {
    const userId = Number(bundle.userId || 0);
    if (!bundleMap.has(userId)) {
      bundleMap.set(userId, []);
    }
    bundleMap.get(userId).push(bundle);
  }
  const businessRoleMap = new Map();
  for (const assignment of Array.isArray(businessRoleLabelAssignments)
    ? businessRoleLabelAssignments
    : []) {
    const userId = Number(assignment.userId || 0);
    if (!businessRoleMap.has(userId)) {
      businessRoleMap.set(userId, []);
    }
    businessRoleMap.get(userId).push(assignment);
  }
  const packageAssignmentMap = new Map();
  for (const assignment of Array.isArray(workflowPackageAssignments)
    ? workflowPackageAssignments
    : []) {
    const userId = Number(assignment.userId || 0);
    if (!packageAssignmentMap.has(userId)) {
      packageAssignmentMap.set(userId, []);
    }
    packageAssignmentMap.get(userId).push(assignment);
  }
  return (Array.isArray(users) ? users : []).map((user) => {
    const userId = Number(user.id || 0);
    const userBundles = bundleMap.get(userId) || [];
    const userBusinessRoles = businessRoleMap.get(userId) || [];
    const userPackageAssignments = packageAssignmentMap.get(userId) || [];
    const derivedPackageAssignments = userPackageAssignments.filter((assignment) => {
      const sourceInfo = workflowPackageAssignmentSourceMap.get(
        Number(assignment.assignmentId || 0)
      );
      return sourceInfo?.sourceType && sourceInfo.sourceType !== "DIRECT";
    });
    const directPackageAssignments = userPackageAssignments.filter((assignment) => {
      const sourceInfo = workflowPackageAssignmentSourceMap.get(
        Number(assignment.assignmentId || 0)
      );
      return !sourceInfo?.sourceType || sourceInfo.sourceType === "DIRECT";
    });
    const derivedAssignmentCount =
      userBundles.filter((bundle) => bundle.isPresetBundle).length +
      derivedPackageAssignments.length;
    const directAssignmentCount =
      userBundles.filter((bundle) => !bundle.isPresetBundle).length +
      directPackageAssignments.length;
    const roleCodes = Array.from(
      new Set(userBundles.flatMap((bundle) => bundle.roleCodes))
    );
    const listedRuntimeRoleCodes = roleCodes.filter(
      (roleCode) => !isWorkflowPackageAssignmentRoleCode(roleCode)
    );
    const packageCodes = Array.from(
      new Set([
        ...userBundles.flatMap((bundle) => bundle.packageCodes || []),
        ...userPackageAssignments.map((assignment) => assignment.packageCode),
      ])
    );
    const packageLabels = Array.from(
      new Set([
        ...userBundles.flatMap((bundle) => bundle.packageLabels || []),
        ...userPackageAssignments.map((assignment) => assignment.packageLabel),
      ])
    );
    const scopes = Array.from(
      new Set([
        ...userBundles.map((bundle) => `${bundle.scopeType}:${bundle.scopeId}`),
        ...userPackageAssignments.map(
          (assignment) => `${assignment.scopeType}:${assignment.scopeId}`
        ),
        ...userBusinessRoles.map(
          (assignment) => `${assignment.scopeType}:${assignment.scopeId}`
        ),
      ])
    );
    const topScopeLabels = Array.from(
      new Set([
        ...userPackageAssignments.map((assignment) => assignment.scopeLabel),
        ...userBusinessRoles.map((assignment) => assignment.scopeLabel),
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
      businessRoleCount: userBusinessRoles.length,
      businessRoleCodes: Array.from(
        new Set(userBusinessRoles.map((assignment) => assignment.businessRoleCode).filter(Boolean))
      ),
      businessRoleLabels: Array.from(
        new Set(userBusinessRoles.map((assignment) => assignment.businessRoleLabel).filter(Boolean))
      ),
      assignmentCount: userBundles.length,
      derivedAssignmentCount,
      directAssignmentCount,
      presetCount: derivedAssignmentCount,
      directBundleCount: directAssignmentCount,
      scopeCount: scopes.length,
      topRoleCodes: listedRuntimeRoleCodes.slice(0, 4),
      topPackageLabels: packageLabels.slice(0, 3),
      topScopeLabels: topScopeLabels.slice(0, 3),
      activeDelegationCount: activeApprovalDelegations.length + activeCoverage.length,
      currentPresetCodes: Array.from(
        new Set(userBundles.map((bundle) => bundle.presetCode).filter(Boolean))
      ),
      currentPackageCodes: packageCodes,
      currentPackageLabels: packageLabels,
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
    bundle.packageCodes.join(" "),
    bundle.packageLabels.join(" "),
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
    row.businessRoleCodes.join(" "),
    row.businessRoleLabels.join(" "),
    row.topRoleCodes.join(" "),
    row.topRoleCodes.map((roleCode) => getRoleDisplayCode(roleCode)).join(" "),
    row.currentPresetCodes.join(" "),
    row.currentPresetCodes.map((presetCode) => getBootstrapHandoffPresetDisplayLabel(presetCode)).join(" "),
    row.currentPackageCodes.join(" "),
    row.currentPackageLabels.join(" "),
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

function buildScopeTargetOptions(
  bundles,
  workflowPackageAssignments,
  businessRoleLabelAssignments
) {
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
  for (const assignment of Array.isArray(workflowPackageAssignments)
    ? workflowPackageAssignments
    : []) {
    const scopeKey = `${assignment.scopeType}:${assignment.scopeId}`;
    if (!scopeKey || !assignment?.scopeLabel || byScopeKey.has(scopeKey)) {
      continue;
    }
    byScopeKey.set(scopeKey, {
      value: scopeKey,
      label: assignment.scopeLabel,
    });
  }
  for (const assignment of Array.isArray(businessRoleLabelAssignments)
    ? businessRoleLabelAssignments
    : []) {
    const scopeKey = `${assignment.scopeType}:${assignment.scopeId}`;
    if (!scopeKey || !assignment?.scopeLabel || byScopeKey.has(scopeKey)) {
      continue;
    }
    byScopeKey.set(scopeKey, {
      value: scopeKey,
      label: assignment.scopeLabel,
    });
  }
  return Array.from(byScopeKey.values()).sort((left, right) =>
    left.label.localeCompare(right.label)
  );
}

function buildPackageFilterOptions(bundles, workflowPackageAssignments) {
  const byPackageCode = new Map();
  for (const bundle of Array.isArray(bundles) ? bundles : []) {
    for (const packageEntry of resolveWorkflowPackagesForRuntimeRoles(bundle.roleCodes)) {
      if (!byPackageCode.has(packageEntry.code)) {
        byPackageCode.set(packageEntry.code, {
          value: packageEntry.code,
          label: packageEntry.displayName,
        });
      }
    }
  }
  for (const assignment of Array.isArray(workflowPackageAssignments)
    ? workflowPackageAssignments
    : []) {
    if (!assignment?.packageCode || byPackageCode.has(assignment.packageCode)) {
      continue;
    }
    byPackageCode.set(assignment.packageCode, {
      value: assignment.packageCode,
      label: assignment.packageLabel,
    });
  }
  return Array.from(byPackageCode.values()).sort((left, right) =>
    left.label.localeCompare(right.label)
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
function WorkspaceLaneCard({ badgeLabel, description, title, tone = "slate" }) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-white px-4 py-4 shadow-sm">
      <StatusPill label={badgeLabel} tone={tone} />
      <h3 className="mt-3 text-base font-semibold text-slate-950">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
    </div>
  );
}
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
      {(warning.packageLabels || []).length > 0 ? (
        <div className="mt-3">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-800">
            {l("Affected packages", "Etkilenen paketler")}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {warning.packageLabels.map((packageLabel) => (
              <StatusPill key={`${warning.id}-${packageLabel}`} label={packageLabel} tone="green" />
            ))}
          </div>
        </div>
      ) : null}
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
            <h2 className="text-lg font-semibold text-slate-950">
              {l("Audit & SoD summary", "Audit ve SoD ozeti")}
            </h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              {l(
                "Review tenant-wide BLOCK and WARN conflicts, then inspect the selected user's affected packages, roles, and recent assignment audit trail before changing authority.",
                "Tenant-geneli BLOCK ve WARN cakismalarini gozden gecirin; sonra yetki degistirmeden once secili kullanicinin etkilenen paketlerini, rollerini ve son atama audit izini inceleyin."
              )}
            </p>
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
                    "{{user}} icin mevcut etiket, paket ve bundle audit satirlari.",
                    "{{user}} icin mevcut etiket, paket ve bundle audit satirlari.",
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
                <p className="mt-1 text-sm leading-6 text-slate-700">
                  {l(
                    "Blocking conflicts should move from warning to action without hunting through the compliance page first.",
                    "Bloklayici cakismalar, once uyum sayfasinda arastirma yapmadan uyaridan aksiyona gecmelidir."
                  )}
                </p>
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
                <p className="mt-1 text-sm leading-6 text-slate-700">
                  {l(
                    "Warnings stay visible here so package cleanup and delegated coverage review remain operational, not buried.",
                    "Uyarilar burada gorunur kalir; boylece paket temizligi ve delegation kapsam incelemesi operasyonel kalir, gizlenmez."
                  )}
                </p>
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
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  {l("Selected user risk context", "Secili kullanici risk baglami")}
                </div>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  {selectedUser
                    ? l(
                        "Combine tenant-wide SoD conflicts with the selected user's current package coverage and runtime roles before changing assignments.",
                        "Atama degistirmeden once tenant-geneli SoD cakismalarini secili kullanicinin mevcut paket kapsami ve runtime rolleriyle birlestirin."
                      )
                    : l(
                        "Select one user to see affected packages, roles, and conflict context here.",
                        "Burada etkilenen paketleri, rolleri ve cakisma baglamini gormek icin bir kullanici secin."
                      )}
                </p>
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
                  "Selected-user risk context appears here after you choose one assignee from the people directory.",
                  "Kisi dizininden bir atanan secildikten sonra secili-kullanici risk baglami burada gorunur."
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
                  "No current labels, package grants, or runtime bundles are available for the compact audit summary yet.",
                  "Kompakt audit ozeti icin gosterilecek mevcut etiket, paket yetkisi veya runtime paketi henuz bulunmuyor."
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
              {bundle.presetDisplayName || bundle.presetCode || l("Custom assignment bundle", "Ozel atama paketi")}
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
              <StatusPill
                label={bundle.sourceTypeLabel}
                tone={bundle.isPresetBundle ? "blue" : "slate"}
              />
              {bundle.workflowFamilyLabels.map((familyLabel) => (
                <StatusPill key={`${bundle.id}-${familyLabel}`} label={familyLabel} tone="violet" />
              ))}
            </div>
            {bundle.packageLabels.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {bundle.packageLabels.map((packageLabel) => (
                  <span
                    key={`${bundle.id}-${packageLabel}`}
                    className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800"
                  >
                    {packageLabel}
                  </span>
                ))}
              </div>
            ) : null}
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
                          {getPresetDisplayLabel(presetCode)}
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
                              {bundle.presetDisplayName || bundle.presetCode || l("Custom bundle", "Ozel paket")}
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
 * Combined security workspace for user access, business assignment bundles,
 * and delegation administration while the package-first admin model rolls out.
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
  const workbenchTab = USER_ASSIGNMENT_CANONICAL_TABS.includes(searchParams.get("tab"))
    ? searchParams.get("tab")
    : searchParams.get("tab") === "users"
      ? "people"
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
  const [tenantSodReport, setTenantSodReport] = useState(null);
  const [tenantSodLoading, setTenantSodLoading] = useState(false);
  const [tenantSodError, setTenantSodError] = useState("");
  const [lastInviteLink, setLastInviteLink] = useState("");
  const [userFilters, setUserFilters] = useState({
    search: "",
    status: "ALL",
    roleCode: "",
    packageCode: "",
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
  const [businessRoleAssignmentForm, setBusinessRoleAssignmentForm] = useState({
    userId: "",
    businessRoleCode: "BRANCH_ACCOUNTANT",
    scopeType: "OPERATING_UNIT",
    scopeId: "",
  });
  const [workflowPackageAssignmentForm, setWorkflowPackageAssignmentForm] = useState({
    userId: "",
    packageCode: "PKG-AP-DRAFT-SUBMIT",
    scopeType: "OPERATING_UNIT",
    scopeId: "",
  });
  const [packageSourceApplyForm, setPackageSourceApplyForm] = useState({
    userId: "",
    sourceKind: "STARTER",
    businessRoleCode: "BRANCH_ACCOUNTANT",
    presetCode: "AP_STANDARD_ENTITY",
    scopeType: "OPERATING_UNIT",
    scopeId: "",
    selectedPackageCodes: [],
    assignBusinessRoleLabel: true,
  });
  const setWorkspaceTab = useCallback(
    (nextTab) => {
      setSearchParams(
        updateSearchParams(searchParams, {
          tab: nextTab,
          delegationTab: nextTab === "delegations" ? delegationTab : "",
        })
      );
    },
    [delegationTab, searchParams, setSearchParams]
  );
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
  const canPreviewComplianceAudit = hasPermission("security.audit.report.generate");
  const canOpenComplianceReports =
    canPreviewComplianceAudit || hasPermission("security.audit.report.export");
  const canUpsertRole = hasPermission("security.role.upsert");
  const canAssignRolePermissions = hasPermission("security.role_permissions.assign");
  const roleAssignmentReadAccess = getPermissionAccess("security.role_assignment.read");
  const canOpenAuditLogs = canReadAudit;
  const canOpenAccessDebugger = roleAssignmentReadAccess.allowed;
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
  const businessRoleCatalogEntries = useMemo(
    () => listBusinessRoleCatalogEntries(),
    []
  );
  const workflowPackageCatalogEntries = useMemo(
    () =>
      listWorkflowPackageCatalogEntries().filter(
        (entry) => !entry.plannedExtension && entry.permissionCount > 0
      ),
    []
  );
  const workflowPackageCatalogByCode = useMemo(
    () =>
      new Map(
        workflowPackageCatalogEntries.map((entry) => [normalizeText(entry.code), entry])
      ),
    [workflowPackageCatalogEntries]
  );
  const workflowPresetCatalogEntries = useMemo(
    () => listWorkflowPresetCatalogEntries(),
    []
  );
  const roleFilterOptions = useMemo(
    () =>
      businessRoleCatalogEntries
        .map((entry) => ({
          value: normalizeText(entry.code),
          label: entry.displayName,
        }))
        .sort((left, right) => left.label.localeCompare(right.label)),
    [businessRoleCatalogEntries]
  );
  const assignableRoleGroups = roleGroups;
  const assignmentBundles = useMemo(
    () => buildAssignmentBundles(assignments, usersById, lookups, tenantScopeId),
    [assignments, lookups, tenantScopeId, usersById]
  );
  const businessRoleLabelAssignments = useMemo(
    () =>
      buildBusinessRoleLabelAssignments(assignments, usersById, lookups, tenantScopeId),
    [assignments, lookups, tenantScopeId, usersById]
  );
  const workflowPackageAssignments = useMemo(
    () =>
      buildWorkflowPackageAssignments(assignments, usersById, lookups, tenantScopeId),
    [assignments, lookups, tenantScopeId, usersById]
  );
  const workflowPackageAssignmentSourceMap = useMemo(
    () =>
      buildWorkflowPackageAssignmentSourceMap(
        workflowPackageAssignments,
        businessRoleLabelAssignments,
        workflowPresetCatalogEntries
      ),
    [
      businessRoleLabelAssignments,
      workflowPackageAssignments,
      workflowPresetCatalogEntries,
    ]
  );
  const userDirectoryRows = useMemo(
    () =>
      buildUserDirectoryRows(
        users,
        assignmentBundles,
        workflowPackageAssignments,
        workflowPackageAssignmentSourceMap,
        approvalDelegations,
        coverageRows,
        businessRoleLabelAssignments
      ),
    [
      approvalDelegations,
      assignmentBundles,
      businessRoleLabelAssignments,
      coverageRows,
      workflowPackageAssignmentSourceMap,
      workflowPackageAssignments,
      users,
    ]
  );
  const scopeTargetOptions = useMemo(
    () =>
      buildScopeTargetOptions(
        assignmentBundles,
        workflowPackageAssignments,
        businessRoleLabelAssignments
      ),
    [assignmentBundles, businessRoleLabelAssignments, workflowPackageAssignments]
  );
  const packageFilterOptions = useMemo(
    () => buildPackageFilterOptions(assignmentBundles, workflowPackageAssignments),
    [assignmentBundles, workflowPackageAssignments]
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
      if (userFilters.roleCode && !row.businessRoleCodes.includes(userFilters.roleCode)) {
        return false;
      }
      if (userFilters.packageCode && !row.currentPackageCodes.includes(userFilters.packageCode)) {
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
  const selectedWorkbenchUser =
    filteredUsers.find((row) => Number(row.id) === Number(selectedWorkbenchUserId)) ||
    filteredUsers[0] ||
    null;
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
  const selectedWorkbenchBusinessRoleAssignments = useMemo(
    () =>
      businessRoleLabelAssignments.filter(
        (assignment) => Number(assignment.userId) === Number(selectedWorkbenchUser?.id || 0)
      ),
    [businessRoleLabelAssignments, selectedWorkbenchUser?.id]
  );
  const selectedWorkbenchWorkflowPackageAssignments = useMemo(
    () =>
      workflowPackageAssignments.filter(
        (assignment) => Number(assignment.userId) === Number(selectedWorkbenchUser?.id || 0)
      ).map((assignment) => {
        const sourceInfo =
          workflowPackageAssignmentSourceMap.get(Number(assignment.assignmentId || 0)) || null;
        return {
          ...assignment,
          sourceType: sourceInfo?.sourceType || "DIRECT",
          sourceTypeLabel: sourceInfo?.sourceTypeLabel || "Direct / custom",
          sourceDetail: sourceInfo?.sourceDetail || "Direct workflow package grant",
          sourceBusinessRoleCode: sourceInfo?.sourceBusinessRoleCode || "",
          sourceBusinessRoleLabel: sourceInfo?.sourceBusinessRoleLabel || "",
          sourcePresetCodes: Array.isArray(sourceInfo?.sourcePresetCodes)
            ? sourceInfo.sourcePresetCodes
            : [],
          sourcePresetLabels: Array.isArray(sourceInfo?.sourcePresetLabels)
            ? sourceInfo.sourcePresetLabels
            : [],
        };
      }),
    [
      selectedWorkbenchUser?.id,
      workflowPackageAssignmentSourceMap,
      workflowPackageAssignments,
    ]
  );
  const selectedWorkbenchRoleEntries = useMemo(
    () =>
      Array.from(
        new Map(
          [
            ...selectedWorkbenchUserBundles.flatMap((bundle) => bundle.roleCodes),
            ...selectedWorkbenchWorkflowPackageAssignments.map(
              (assignment) => assignment.roleCode
            ),
          ]
            .map((roleCode) => [roleCode, getRoleCatalogEntry(roleCode)])
        ).values()
      ),
    [selectedWorkbenchUserBundles, selectedWorkbenchWorkflowPackageAssignments]
  );
  const selectedWorkbenchPackageLabels = useMemo(
    () =>
      Array.from(
        new Set([
          ...selectedWorkbenchUserBundles.flatMap((bundle) => bundle.packageLabels || []),
          ...selectedWorkbenchWorkflowPackageAssignments.map(
            (assignment) => assignment.packageLabel
          ),
        ])
      ),
    [selectedWorkbenchUserBundles, selectedWorkbenchWorkflowPackageAssignments]
  );
  const selectedWorkbenchScopeLabels = useMemo(
    () =>
      Array.from(
        new Set(
          [
            ...selectedWorkbenchUserBundles.map((bundle) => bundle.scopeLabel),
            ...selectedWorkbenchWorkflowPackageAssignments.map(
              (assignment) => assignment.scopeLabel
            ),
            ...selectedWorkbenchBusinessRoleAssignments.map(
              (assignment) => assignment.scopeLabel
            ),
          ].filter(Boolean)
        )
      ),
    [
      selectedWorkbenchBusinessRoleAssignments,
      selectedWorkbenchUserBundles,
      selectedWorkbenchWorkflowPackageAssignments,
    ]
  );
  const selectedWorkbenchEffectiveAuthorityPreview = useMemo(
    () =>
      buildEffectiveAuthorityPreview({
        businessRoleAssignments: selectedWorkbenchBusinessRoleAssignments,
        workflowPackageAssignments: selectedWorkbenchWorkflowPackageAssignments,
        userBundles: selectedWorkbenchUserBundles,
        l,
      }),
    [
      l,
      selectedWorkbenchBusinessRoleAssignments,
      selectedWorkbenchUserBundles,
      selectedWorkbenchWorkflowPackageAssignments,
    ]
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
  useEffect(() => {
    if (activeTab !== "users" || !canPreviewComplianceAudit) {
      setTenantSodReport(null);
      setTenantSodLoading(false);
      setTenantSodError("");
      return;
    }

    let cancelled = false;
    setTenantSodLoading(true);
    setTenantSodError("");

    generateComplianceAuditReport({
      reportType: "SOD_ANALYSIS",
      asOfDate: todayIsoDate(),
      ...(tenantScopeId
        ? {
            scopeType: "TENANT",
            scopeId: tenantScopeId,
          }
        : {}),
    })
      .then((result) => {
        if (cancelled) {
          return;
        }
        setTenantSodReport(result?.report || null);
      })
      .catch((requestError) => {
        if (cancelled) {
          return;
        }
        setTenantSodReport(null);
        setTenantSodError(
          getErrorMessage(
            requestError,
            l(
              "Tenant-wide SoD preview is not available right now.",
              "Tenant-geneli SoD onizlemesi su anda kullanilamiyor."
            )
          )
        );
      })
      .finally(() => {
        if (cancelled) {
          return;
        }
        setTenantSodLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab, canPreviewComplianceAudit, l, tenantScopeId]);
  const selectedWorkbenchAssignmentAuditSummary = useMemo(
    () =>
      buildAssignmentAuditSummary({
        businessRoleAssignments: selectedWorkbenchBusinessRoleAssignments,
        workflowPackageAssignments: selectedWorkbenchWorkflowPackageAssignments,
        userBundles: selectedWorkbenchUserBundles,
        auditRows: selectedWorkbenchAuditRows,
        auditReadable: canReadAudit && !selectedWorkbenchAuditError,
        l,
      }),
    [
      canReadAudit,
      l,
      selectedWorkbenchAuditError,
      selectedWorkbenchAuditRows,
      selectedWorkbenchBusinessRoleAssignments,
      selectedWorkbenchUserBundles,
      selectedWorkbenchWorkflowPackageAssignments,
    ]
  );
  const selectedBusinessRoleCatalogEntry = useMemo(
    () =>
      businessRoleCatalogEntries.find(
        (entry) => entry.code === normalizeText(businessRoleAssignmentForm.businessRoleCode)
      ) || businessRoleCatalogEntries[0] || null,
    [businessRoleAssignmentForm.businessRoleCode, businessRoleCatalogEntries]
  );
  const selectedBusinessRoleDefinition = useMemo(
    () =>
      getBusinessRoleAssignmentRoleDefinition(businessRoleAssignmentForm.businessRoleCode),
    [businessRoleAssignmentForm.businessRoleCode]
  );
  const selectedBusinessRoleRuntimeRoleExists = Boolean(
    rolesByCode.get(selectedBusinessRoleDefinition?.roleCode || "")
  );
  const selectedWorkflowPackageCatalogEntry = useMemo(
    () =>
      workflowPackageCatalogEntries.find(
        (entry) => entry.code === normalizeText(workflowPackageAssignmentForm.packageCode)
      ) || workflowPackageCatalogEntries[0] || null,
    [workflowPackageAssignmentForm.packageCode, workflowPackageCatalogEntries]
  );
  const selectedWorkflowPackageDefinition = useMemo(
    () =>
      getWorkflowPackageAssignmentRoleDefinition(
        workflowPackageAssignmentForm.packageCode
      ),
    [workflowPackageAssignmentForm.packageCode]
  );
  const selectedWorkflowPackageRuntimeRole =
    rolesByCode.get(selectedWorkflowPackageDefinition?.roleCode || "") || null;
  const selectedWorkflowPackageRoleAligned = hasExactPermissionCodes(
    selectedWorkflowPackageRuntimeRole?.permissionCodes,
    selectedWorkflowPackageDefinition?.permissionCodes
  );
  const selectedWorkflowPackageRoleStatus = !selectedWorkflowPackageDefinition
    ? "missing"
    : !selectedWorkflowPackageRuntimeRole
      ? "missing"
      : selectedWorkflowPackageRoleAligned
        ? "aligned"
        : "out_of_sync";
  const workflowPackageScopeTypeOptions = useMemo(
    () => selectedWorkflowPackageCatalogEntry?.allowedScopes || [],
    [selectedWorkflowPackageCatalogEntry?.allowedScopes]
  );
  const businessRoleScopeOptions = useMemo(
    () =>
      buildScopeOptions(
        businessRoleAssignmentForm.scopeType || selectedBusinessRoleCatalogEntry?.defaultScope,
        lookups,
        tenantScopeId
      ),
    [
      businessRoleAssignmentForm.scopeType,
      lookups,
      selectedBusinessRoleCatalogEntry?.defaultScope,
      tenantScopeId,
    ]
  );
  const workflowPackageScopeOptions = useMemo(
    () =>
      buildScopeOptions(
        workflowPackageAssignmentForm.scopeType || selectedWorkflowPackageCatalogEntry?.defaultScope,
        lookups,
        tenantScopeId
      ),
    [
      workflowPackageAssignmentForm.scopeType,
      lookups,
      selectedWorkflowPackageCatalogEntry?.defaultScope,
      tenantScopeId,
    ]
  );
  const selectedPackageSourceBusinessRoleEntry = useMemo(
    () =>
      businessRoleCatalogEntries.find(
        (entry) => entry.code === normalizeText(packageSourceApplyForm.businessRoleCode)
      ) || businessRoleCatalogEntries[0] || null,
    [businessRoleCatalogEntries, packageSourceApplyForm.businessRoleCode]
  );
  const selectedPackageSourcePresetEntry = useMemo(
    () =>
      workflowPresetCatalogEntries.find(
        (entry) => entry.code === normalizeText(packageSourceApplyForm.presetCode)
      ) || workflowPresetCatalogEntries[0] || null,
    [packageSourceApplyForm.presetCode, workflowPresetCatalogEntries]
  );
  const packageSourceCatalogEntries = useMemo(() => {
    if (packageSourceApplyForm.sourceKind === "PRESET") {
      return (selectedPackageSourcePresetEntry?.requiredPackageCodes || [])
        .map((packageCode) => {
          const packageEntry = workflowPackageCatalogByCode.get(normalizeText(packageCode));
          if (!packageEntry) {
            return null;
          }
          const stepLabels = (selectedPackageSourcePresetEntry?.steps || [])
            .filter((step) => step.requiredPackageCode === packageCode)
            .map((step) => step.actionLabel)
            .filter(Boolean);
          return {
            ...packageEntry,
            recommendationType: "preset",
            previewStepLabels: stepLabels,
            recommendationSourceName: selectedPackageSourcePresetEntry?.displayName || "",
          };
        })
        .filter(Boolean);
    }

    const starterCodes = selectedPackageSourceBusinessRoleEntry?.starterPackageCodes || [];
    const optionalCodes = selectedPackageSourceBusinessRoleEntry?.optionalPackageCodes || [];
    const orderedCodes = [
      ...starterCodes.map((packageCode) => ({ packageCode, recommendationType: "starter" })),
      ...optionalCodes.map((packageCode) => ({ packageCode, recommendationType: "optional" })),
    ];
    return Array.from(
      new Map(
        orderedCodes
          .map(({ packageCode, recommendationType }) => {
            const packageEntry = workflowPackageCatalogByCode.get(normalizeText(packageCode));
            if (!packageEntry) {
              return null;
            }
            return [
              packageCode,
              {
                ...packageEntry,
                recommendationType,
                previewStepLabels: [],
                recommendationSourceName:
                  selectedPackageSourceBusinessRoleEntry?.displayName || "",
              },
            ];
          })
          .filter(Boolean)
      ).values()
    );
  }, [
    packageSourceApplyForm.sourceKind,
    selectedPackageSourceBusinessRoleEntry,
    selectedPackageSourcePresetEntry,
    workflowPackageCatalogByCode,
  ]);
  const packageSourceScopeTypeOptions = useMemo(() => {
    const orderedScopeTypes = ["TENANT", "GROUP", "COUNTRY", "LEGAL_ENTITY", "OPERATING_UNIT"];
    const sourceDefaultScope =
      packageSourceApplyForm.sourceKind === "PRESET"
        ? selectedPackageSourcePresetEntry?.defaultScope
        : selectedPackageSourceBusinessRoleEntry?.defaultScope;
    const availableScopeTypes = Array.from(
      new Set(
        packageSourceCatalogEntries.flatMap((entry) => entry.allowedScopes || []).filter(Boolean)
      )
    ).sort((left, right) => orderedScopeTypes.indexOf(left) - orderedScopeTypes.indexOf(right));
    if (!sourceDefaultScope || !availableScopeTypes.includes(sourceDefaultScope)) {
      return availableScopeTypes;
    }
    return [
      sourceDefaultScope,
      ...availableScopeTypes.filter((scopeType) => scopeType !== sourceDefaultScope),
    ];
  }, [
    packageSourceApplyForm.sourceKind,
    packageSourceCatalogEntries,
    selectedPackageSourceBusinessRoleEntry?.defaultScope,
    selectedPackageSourcePresetEntry?.defaultScope,
  ]);
  const packageSourceScopeOptions = useMemo(
    () =>
      buildScopeOptions(
        packageSourceApplyForm.scopeType,
        lookups,
        tenantScopeId
      ),
    [lookups, packageSourceApplyForm.scopeType, tenantScopeId]
  );
  const selectedPackageSourceScopeId =
    packageSourceApplyForm.scopeType === "TENANT"
      ? tenantScopeId
      : Number(packageSourceApplyForm.scopeId || 0);
  const packageSourceApplyWriteAccess = getPermissionAccess(
    "security.role_assignment.upsert",
    selectedPackageSourceScopeId
      ? {
          scope: {
            scopeType: packageSourceApplyForm.scopeType,
            scopeId: selectedPackageSourceScopeId,
          },
        }
      : undefined
  );
  const selectedUserWorkflowPackagesAtSourceScope = useMemo(
    () =>
      workflowPackageAssignments.filter(
        (assignment) =>
          Number(assignment.userId) === Number(packageSourceApplyForm.userId || 0) &&
          assignment.scopeType === packageSourceApplyForm.scopeType &&
          Number(assignment.scopeId) === Number(selectedPackageSourceScopeId || 0)
      ),
    [
      packageSourceApplyForm.scopeType,
      packageSourceApplyForm.userId,
      selectedPackageSourceScopeId,
      workflowPackageAssignments,
    ]
  );
  const selectedPackageSourceBusinessRoleAssigned = useMemo(
    () =>
      selectedWorkbenchBusinessRoleAssignments.some(
        (assignment) =>
          assignment.businessRoleCode === selectedPackageSourceBusinessRoleEntry?.code &&
          assignment.scopeType === packageSourceApplyForm.scopeType &&
          Number(assignment.scopeId) === Number(selectedPackageSourceScopeId || 0)
      ),
    [
      packageSourceApplyForm.scopeType,
      selectedPackageSourceBusinessRoleEntry?.code,
      selectedPackageSourceScopeId,
      selectedWorkbenchBusinessRoleAssignments,
    ]
  );
  const packageSourcePreviewEntries = useMemo(
    () =>
      packageSourceCatalogEntries.map((entry) => {
        const alreadyAssigned = selectedUserWorkflowPackagesAtSourceScope.some(
          (assignment) => assignment.packageCode === entry.code
        );
        const allowedAtScope = (entry.allowedScopes || []).includes(
          packageSourceApplyForm.scopeType
        );
        const assignmentBlockedByExtension =
          Boolean(entry.plannedExtension) || Number(entry.permissionCount || 0) === 0;
        return {
          ...entry,
          allowedAtScope,
          alreadyAssigned,
          assignmentBlockedByExtension,
          assignable:
            allowedAtScope &&
            !alreadyAssigned &&
            !assignmentBlockedByExtension,
          selected: packageSourceApplyForm.selectedPackageCodes.includes(entry.code),
        };
      }),
    [
      packageSourceApplyForm.scopeType,
      packageSourceApplyForm.selectedPackageCodes,
      packageSourceCatalogEntries,
      selectedUserWorkflowPackagesAtSourceScope,
    ]
  );
  const selectedPackageSourcePackageCodes = useMemo(
    () =>
      packageSourcePreviewEntries
        .filter((entry) => entry.selected && entry.assignable)
        .map((entry) => entry.code),
    [packageSourcePreviewEntries]
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
  const selectedBusinessRoleScopeId =
    businessRoleAssignmentForm.scopeType === "TENANT"
      ? tenantScopeId
      : Number(businessRoleAssignmentForm.scopeId || 0);
  const businessRoleAssignmentWriteAccess = getPermissionAccess(
    "security.role_assignment.upsert",
    selectedBusinessRoleScopeId
      ? {
          scope: {
            scopeType: businessRoleAssignmentForm.scopeType,
            scopeId: selectedBusinessRoleScopeId,
          },
        }
      : undefined
  );
  const selectedWorkflowPackageScopeId =
    workflowPackageAssignmentForm.scopeType === "TENANT"
      ? tenantScopeId
      : Number(workflowPackageAssignmentForm.scopeId || 0);
  const workflowPackageAssignmentWriteAccess = getPermissionAccess(
    "security.role_assignment.upsert",
    selectedWorkflowPackageScopeId
      ? {
          scope: {
            scopeType: workflowPackageAssignmentForm.scopeType,
            scopeId: selectedWorkflowPackageScopeId,
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
    if (filteredUsers.length === 0) {
      setSelectedWorkbenchUserId("");
      return;
    }
    if (!filteredUsers.some((row) => Number(row.id) === Number(selectedWorkbenchUserId))) {
      setSelectedWorkbenchUserId(String(filteredUsers[0].id));
    }
  }, [filteredUsers, selectedWorkbenchUserId]);
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
    if (!businessRoleAssignmentForm.userId && users.length > 0) {
      setBusinessRoleAssignmentForm((prev) => ({
        ...prev,
        userId: String(users[0].id),
      }));
    }
  }, [businessRoleAssignmentForm.userId, users]);
  useEffect(() => {
    if (!workflowPackageAssignmentForm.userId && users.length > 0) {
      setWorkflowPackageAssignmentForm((prev) => ({
        ...prev,
        userId: String(users[0].id),
      }));
    }
  }, [workflowPackageAssignmentForm.userId, users]);
  useEffect(() => {
    if (!packageSourceApplyForm.userId && users.length > 0) {
      setPackageSourceApplyForm((prev) => ({
        ...prev,
        userId: String(users[0].id),
      }));
    }
  }, [packageSourceApplyForm.userId, users]);
  useEffect(() => {
    const selectedUserId = String(selectedWorkbenchUser?.id || "");
    if (!selectedUserId) {
      return;
    }
    setAssignmentForm((prev) =>
      prev.userId === selectedUserId ? prev : { ...prev, userId: selectedUserId }
    );
    setRawAssignmentForm((prev) =>
      prev.userId === selectedUserId ? prev : { ...prev, userId: selectedUserId }
    );
    setBusinessRoleAssignmentForm((prev) =>
      prev.userId === selectedUserId ? prev : { ...prev, userId: selectedUserId }
    );
    setWorkflowPackageAssignmentForm((prev) =>
      prev.userId === selectedUserId ? prev : { ...prev, userId: selectedUserId }
    );
    setPackageSourceApplyForm((prev) =>
      prev.userId === selectedUserId ? prev : { ...prev, userId: selectedUserId }
    );
  }, [selectedWorkbenchUser?.id]);
  useEffect(() => {
    setBusinessRoleAssignmentForm((prev) => {
      const nextScopeId =
        prev.scopeType === "TENANT"
          ? String(tenantScopeId || "")
          : String(businessRoleScopeOptions[0]?.id || "");
      if (prev.scopeType === "TENANT") {
        return prev.scopeId === nextScopeId ? prev : { ...prev, scopeId: nextScopeId };
      }
      const currentScopeId = Number(prev.scopeId || 0);
      if (
        currentScopeId &&
        businessRoleScopeOptions.some((option) => Number(option.id) === currentScopeId)
      ) {
        return prev;
      }
      return { ...prev, scopeId: nextScopeId };
    });
  }, [businessRoleScopeOptions, tenantScopeId]);
  useEffect(() => {
    setPackageSourceApplyForm((prev) => {
      const nextScopeType = packageSourceScopeTypeOptions.includes(prev.scopeType)
        ? prev.scopeType
        : packageSourceScopeTypeOptions[0] || "";
      if (!nextScopeType || nextScopeType === prev.scopeType) {
        return prev;
      }
      return {
        ...prev,
        scopeType: nextScopeType,
        scopeId: "",
      };
    });
  }, [packageSourceScopeTypeOptions]);
  useEffect(() => {
    setPackageSourceApplyForm((prev) => {
      if (!prev.scopeType) {
        return prev;
      }
      const nextScopeId =
        prev.scopeType === "TENANT"
          ? String(tenantScopeId || "")
          : String(packageSourceScopeOptions[0]?.id || "");
      if (prev.scopeType === "TENANT") {
        return prev.scopeId === nextScopeId ? prev : { ...prev, scopeId: nextScopeId };
      }
      const currentScopeId = Number(prev.scopeId || 0);
      if (
        currentScopeId &&
        packageSourceScopeOptions.some((option) => Number(option.id) === currentScopeId)
      ) {
        return prev;
      }
      return { ...prev, scopeId: nextScopeId };
    });
  }, [packageSourceScopeOptions, tenantScopeId]);
  useEffect(() => {
    setPackageSourceApplyForm((prev) => {
      const selectablePackageCodes = packageSourcePreviewEntries
        .filter((entry) => entry.assignable)
        .map((entry) => entry.code);
      const filteredSelectedCodes = prev.selectedPackageCodes.filter((packageCode) =>
        selectablePackageCodes.includes(packageCode)
      );
      if (filteredSelectedCodes.length === 0 && selectablePackageCodes.length > 0) {
        return {
          ...prev,
          selectedPackageCodes: selectablePackageCodes,
        };
      }
      if (filteredSelectedCodes.length !== prev.selectedPackageCodes.length) {
        return {
          ...prev,
          selectedPackageCodes: filteredSelectedCodes,
        };
      }
      return prev;
    });
  }, [packageSourcePreviewEntries]);
  useEffect(() => {
    setWorkflowPackageAssignmentForm((prev) => {
      const allowedScopeTypes = workflowPackageScopeTypeOptions;
      const nextScopeType = allowedScopeTypes.includes(prev.scopeType)
        ? prev.scopeType
        : selectedWorkflowPackageCatalogEntry?.defaultScope || allowedScopeTypes[0] || "";
      if (!nextScopeType) {
        return prev;
      }
      if (nextScopeType !== prev.scopeType) {
        return {
          ...prev,
          scopeType: nextScopeType,
          scopeId: "",
        };
      }
      const nextScopeId =
        nextScopeType === "TENANT"
          ? String(tenantScopeId || "")
          : String(workflowPackageScopeOptions[0]?.id || "");
      if (nextScopeType === "TENANT") {
        return prev.scopeId === nextScopeId ? prev : { ...prev, scopeId: nextScopeId };
      }
      const currentScopeId = Number(prev.scopeId || 0);
      if (
        currentScopeId &&
        workflowPackageScopeOptions.some((option) => Number(option.id) === currentScopeId)
      ) {
        return prev;
      }
      return { ...prev, scopeId: nextScopeId };
    });
  }, [
    selectedWorkflowPackageCatalogEntry?.defaultScope,
    tenantScopeId,
    workflowPackageScopeOptions,
    workflowPackageScopeTypeOptions,
  ]);
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
  function updateBusinessRoleAssignmentField(field, value) {
    setBusinessRoleAssignmentForm((prev) => {
      if (field === "businessRoleCode") {
        const nextRoleDefinition = getBusinessRoleAssignmentRoleDefinition(value);
        return {
          ...prev,
          businessRoleCode: value,
          scopeType: nextRoleDefinition?.defaultScope || prev.scopeType,
          scopeId: "",
        };
      }
      if (field === "scopeType") {
        return {
          ...prev,
          scopeType: value,
          scopeId: "",
        };
      }
      return { ...prev, [field]: value };
    });
  }
  function updateWorkflowPackageAssignmentField(field, value) {
    setWorkflowPackageAssignmentForm((prev) => {
      if (field === "packageCode") {
        const nextPackageDefinition = getWorkflowPackageAssignmentRoleDefinition(value);
        return {
          ...prev,
          packageCode: value,
          scopeType: nextPackageDefinition?.defaultScope || prev.scopeType,
          scopeId: "",
        };
      }
      if (field === "scopeType") {
        return {
          ...prev,
          scopeType: value,
          scopeId: "",
        };
      }
      return { ...prev, [field]: value };
    });
  }
  function updatePackageSourceApplyField(field, value) {
    setPackageSourceApplyForm((prev) => {
      if (field === "sourceKind") {
        return {
          ...prev,
          sourceKind: value,
          scopeType: "",
          scopeId: "",
          selectedPackageCodes: [],
        };
      }
      if (field === "businessRoleCode" || field === "presetCode") {
        return {
          ...prev,
          [field]: value,
          scopeType: "",
          scopeId: "",
          selectedPackageCodes: [],
        };
      }
      if (field === "scopeType") {
        return {
          ...prev,
          scopeType: value,
          scopeId: "",
          selectedPackageCodes: [],
        };
      }
      if (field === "selectedPackageCodes") {
        return {
          ...prev,
          selectedPackageCodes: Array.isArray(value) ? value : [],
        };
      }
      return { ...prev, [field]: value };
    });
  }
  function togglePackageSourcePreviewPackage(packageCode) {
    setPackageSourceApplyForm((prev) => {
      const nextSelected = prev.selectedPackageCodes.includes(packageCode)
        ? prev.selectedPackageCodes.filter((code) => code !== packageCode)
        : [...prev.selectedPackageCodes, packageCode];
      return {
        ...prev,
        selectedPackageCodes: Array.from(new Set(nextSelected)),
      };
    });
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
  async function ensureBusinessRoleLabelAssignment({
    userId,
    businessRoleCode,
    scopeType,
    scopeId,
  }) {
    const roleDefinition = getBusinessRoleAssignmentRoleDefinition(businessRoleCode);
    if (!roleDefinition) {
      throw new Error(
        l(
          "The selected business role label could not be resolved.",
          "Secilen is rol etiketi cozulemedi."
        )
      );
    }
    let runtimeRole = rolesByCode.get(roleDefinition.roleCode) || null;
    if (!runtimeRole) {
      if (!canUpsertRole) {
        throw new Error(
          l(
            "Creating the label-only runtime role requires security.role.upsert first.",
            "Etiket-yalniz runtime rolunu olusturmak icin once security.role.upsert gerekir."
          )
        );
      }
      const createRoleResponse = await createOrUpdateRole({
        code: roleDefinition.roleCode,
        name: roleDefinition.roleName,
      });
      runtimeRole = {
        id: Number(createRoleResponse?.id || 0),
        code: roleDefinition.roleCode,
        name: roleDefinition.roleName,
        permissionCodes: [],
      };
    }
    return createRoleAssignment({
      userId: Number(userId),
      roleId: Number(runtimeRole.id),
      scopeType,
      scopeId,
      effect: "ALLOW",
    });
  }
  async function ensureWorkflowPackageRuntimeRole(packageCode) {
    const packageDefinition = getWorkflowPackageAssignmentRoleDefinition(packageCode);
    if (!packageDefinition) {
      throw new Error(
        l(
          "The selected workflow package could not be resolved.",
          "Secilen workflow paketi cozulemedi."
        )
      );
    }
    if (packageDefinition.plannedExtension || packageDefinition.permissionCodes.length === 0) {
      throw new Error(
        l(
          "This workflow package is still an extension placeholder and cannot be assigned directly yet.",
          "Bu workflow paketi henuz bir extension taslagi oldugu icin dogrudan atanamaz."
        )
      );
    }

    let runtimeRole = rolesByCode.get(packageDefinition.roleCode) || null;
    const roleNeedsCreate = !runtimeRole;
    const roleNeedsPermissionSync =
      !runtimeRole ||
      !hasExactPermissionCodes(
        runtimeRole.permissionCodes,
        packageDefinition.permissionCodes
      );
    if (roleNeedsCreate && !canUpsertRole) {
      throw new Error(
        l(
          "The managed package role does not exist yet. First assignment needs security.role.upsert.",
          "Yonetilen paket rolu henuz yok. Ilk atama icin security.role.upsert gerekir."
        )
      );
    }
    if (roleNeedsPermissionSync && !canAssignRolePermissions) {
      throw new Error(
        l(
          "The managed package role must be aligned first. This requires security.role_permissions.assign.",
          "Yonetilen paket rolunun once hizalanmasi gerekir. Bunun icin security.role_permissions.assign gerekir."
        )
      );
    }
    if (!runtimeRole) {
      // UI-2C persists direct package authority through one managed runtime
      // role per clean package so admins can remove a single package grant
      // later without reopening broader package coverage.
      const createRoleResponse = await createOrUpdateRole({
        code: packageDefinition.roleCode,
        name: packageDefinition.roleName,
      });
      runtimeRole = {
        id: Number(createRoleResponse?.id || 0),
        code: packageDefinition.roleCode,
        name: packageDefinition.roleName,
        permissionCodes: [],
      };
    }
    if (
      runtimeRole?.id &&
      !hasExactPermissionCodes(
        runtimeRole.permissionCodes,
        packageDefinition.permissionCodes
      )
    ) {
      await replaceRolePermissions(
        Number(runtimeRole.id),
        packageDefinition.permissionCodes
      );
    }
    return {
      packageDefinition,
      runtimeRole,
    };
  }
  async function assignWorkflowPackageByCode({
    userId,
    packageCode,
    scopeType,
    scopeId,
  }) {
    const { packageDefinition, runtimeRole } = await ensureWorkflowPackageRuntimeRole(
      packageCode
    );
    return {
      packageDefinition,
      response: await createRoleAssignment({
        userId: Number(userId),
        roleId: Number(runtimeRole?.id || 0),
        scopeType,
        scopeId,
        effect: "ALLOW",
      }),
    };
  }
  async function handleAssignBusinessRoleLabel(event) {
    event.preventDefault();
    const roleDefinition = getBusinessRoleAssignmentRoleDefinition(
      businessRoleAssignmentForm.businessRoleCode
    );
    if (!normalizeText(businessRoleAssignmentForm.userId) || !roleDefinition) {
      setError(
        l(
          "Choose both a user and a business role label first.",
          "Once hem kullanici hem de is rol etiketi secin."
        )
      );
      return;
    }
    if (!selectedBusinessRoleScopeId) {
      setError(
        l(
          "Choose a valid scope for the business role label.",
          "Is rol etiketi icin gecerli bir kapsam secin."
        )
      );
      return;
    }
    if (!businessRoleAssignmentWriteAccess.allowed) {
      setError(
        l(
          "You do not have permission to assign this business role label at the selected scope.",
          "Secilen kapsamda bu is rol etiketini atama yetkiniz yok."
        )
      );
      return;
    }
    const duplicateAssignment = selectedWorkbenchBusinessRoleAssignments.some(
      (assignment) =>
        assignment.businessRoleCode === roleDefinition.businessRoleCode &&
        assignment.scopeType === businessRoleAssignmentForm.scopeType &&
        Number(assignment.scopeId) === Number(selectedBusinessRoleScopeId)
    );
    if (duplicateAssignment) {
      setError(
        l(
          "This business role label is already assigned at the selected scope.",
          "Bu is rol etiketi secilen kapsamda zaten atanmis."
        )
      );
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    setWarningMessages([]);
    try {
      await ensureBusinessRoleLabelAssignment({
        userId: Number(businessRoleAssignmentForm.userId),
        businessRoleCode: businessRoleAssignmentForm.businessRoleCode,
        scopeType: businessRoleAssignmentForm.scopeType,
        scopeId: selectedBusinessRoleScopeId,
      });
      setMessage(
        l(
          "Business role label assigned. Workflow packages still need their own assignment.",
          "Is rol etiketi atandi. Workflow paketleri icin ayri atama hala gerekir."
        )
      );
      await loadData();
    } catch (requestError) {
      setError(
        getErrorMessage(
          requestError,
          l(
            "The business role label could not be assigned.",
            "Is rol etiketi atanamadi."
          )
        )
      );
    } finally {
      setSaving(false);
    }
  }
  async function handleRemoveBusinessRoleLabel(assignment) {
    if (!assignment?.assignmentId) {
      return;
    }
    const revokeAccess = getPermissionAccess(
      "security.role_assignment.upsert",
      assignment.scopeId
        ? {
            scope: {
              scopeType: assignment.scopeType,
              scopeId: assignment.scopeId,
            },
          }
        : undefined
    );
    if (!revokeAccess.allowed) {
      setError(
        l(
          "You do not have permission to remove this business role label.",
          "Bu is rol etiketini kaldirma yetkiniz yok."
        )
      );
      return;
    }
    const confirmed = window.confirm(
      l(
        "Remove this business role label only? Workflow package and runtime-role assignments will stay unchanged.",
        "Yalnizca bu is rol etiketini kaldirmak istiyor musunuz? Workflow paketleri ve runtime rol atamalari degismeden kalir."
      )
    );
    if (!confirmed) {
      return;
    }

    setActingRowId(`business-role-${assignment.assignmentId}`);
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await deleteRoleAssignment(assignment.assignmentId);
      setMessage(
        l(
          "Business role label removed. Workflow package authority stayed unchanged.",
          "Is rol etiketi kaldirildi. Workflow paket yetkisi degismeden kaldi."
        )
      );
      await loadData();
    } catch (requestError) {
      setError(
        getErrorMessage(
          requestError,
          l(
            "The business role label could not be removed.",
            "Is rol etiketi kaldirilamadi."
          )
        )
      );
    } finally {
      setActingRowId("");
      setSaving(false);
    }
  }
  async function handleAssignWorkflowPackage(event) {
    event.preventDefault();
    const packageDefinition = getWorkflowPackageAssignmentRoleDefinition(
      workflowPackageAssignmentForm.packageCode
    );
    if (!normalizeText(workflowPackageAssignmentForm.userId) || !packageDefinition) {
      setError(
        l(
          "Choose both a user and a workflow package first.",
          "Once hem kullanici hem de workflow paketi secin."
        )
      );
      return;
    }
    if (packageDefinition.plannedExtension || packageDefinition.permissionCodes.length === 0) {
      setError(
        l(
          "This workflow package is still an extension placeholder and cannot be assigned directly yet.",
          "Bu workflow paketi henuz bir extension taslagi oldugu icin dogrudan atanamaz."
        )
      );
      return;
    }
    if (
      !packageDefinition.allowedScopes.includes(workflowPackageAssignmentForm.scopeType)
    ) {
      setError(
        l(
          "The selected scope type is not allowed for this workflow package.",
          "Secilen kapsam tipi bu workflow paketi icin uygun degil."
        )
      );
      return;
    }
    if (!selectedWorkflowPackageScopeId) {
      setError(
        l(
          "Choose a valid scope for the workflow package.",
          "Workflow paketi icin gecerli bir kapsam secin."
        )
      );
      return;
    }
    if (!workflowPackageAssignmentWriteAccess.allowed) {
      setError(
        l(
          "You do not have permission to assign this workflow package at the selected scope.",
          "Secilen kapsamda bu workflow paketini atama yetkiniz yok."
        )
      );
      return;
    }
    const duplicateAssignment = selectedWorkbenchWorkflowPackageAssignments.some(
      (assignment) =>
        assignment.packageCode === packageDefinition.packageCode &&
        assignment.scopeType === workflowPackageAssignmentForm.scopeType &&
        Number(assignment.scopeId) === Number(selectedWorkflowPackageScopeId)
    );
    if (duplicateAssignment) {
      setError(
        l(
          "This workflow package is already assigned at the selected scope.",
          "Bu workflow paketi secilen kapsamda zaten atanmis."
        )
      );
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    setWarningMessages([]);
    try {
      const { response } = await assignWorkflowPackageByCode({
        userId: Number(workflowPackageAssignmentForm.userId),
        packageCode: workflowPackageAssignmentForm.packageCode,
        scopeType: workflowPackageAssignmentForm.scopeType,
        scopeId: selectedWorkflowPackageScopeId,
      });
      setWarningMessages(response?.assignmentWarnings || []);
      setMessage(
        l(
          "Workflow package assigned at the selected scope.",
          "Workflow paketi secilen kapsamda atandi."
        )
      );
      await loadData();
    } catch (requestError) {
      setError(
        getErrorMessage(
          requestError,
          l(
            "The workflow package could not be assigned.",
            "Workflow paketi atanamadi."
          )
        )
      );
    } finally {
      setSaving(false);
    }
  }
  async function handleApplyPackageSource(event) {
    event.preventDefault();
    if (!normalizeText(packageSourceApplyForm.userId)) {
      setError(l("Choose an assignee first.", "Once bir atanan kisi secin."));
      return;
    }
    if (!selectedPackageSourceScopeId) {
      setError(
        l(
          "Choose a valid scope before applying starter or preset packages.",
          "Starter veya preset paketlerini uygulamadan once gecerli bir kapsam secin."
        )
      );
      return;
    }
    if (!packageSourceApplyWriteAccess.allowed) {
      setError(
        l(
          "You do not have permission to apply package suggestions at the selected scope.",
          "Secilen kapsamda paket onerilerini uygulama yetkiniz yok."
        )
      );
      return;
    }
    if (selectedPackageSourcePackageCodes.length === 0) {
      setError(
        l(
          "Choose at least one workflow package from the preview first.",
          "Once onizlemeden en az bir workflow paketi secin."
        )
      );
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    setWarningMessages([]);
    try {
      const collectedWarnings = [];
      if (
        packageSourceApplyForm.sourceKind === "STARTER" &&
        packageSourceApplyForm.assignBusinessRoleLabel &&
        selectedPackageSourceBusinessRoleEntry &&
        !selectedPackageSourceBusinessRoleAssigned
      ) {
        await ensureBusinessRoleLabelAssignment({
          userId: Number(packageSourceApplyForm.userId),
          businessRoleCode: selectedPackageSourceBusinessRoleEntry.code,
          scopeType: packageSourceApplyForm.scopeType,
          scopeId: selectedPackageSourceScopeId,
        });
      }

      for (const packageCode of selectedPackageSourcePackageCodes) {
        // Package suggestions fan out into direct package grants so admins can
        // later remove one derived package without tearing down every other
        // recommendation that came from the same starter or preset preview.
        const { response } = await assignWorkflowPackageByCode({
          userId: Number(packageSourceApplyForm.userId),
          packageCode,
          scopeType: packageSourceApplyForm.scopeType,
          scopeId: selectedPackageSourceScopeId,
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
      setWarningMessages(Array.from(new Set(collectedWarnings)));
      const sourceLabel =
        packageSourceApplyForm.sourceKind === "PRESET"
          ? selectedPackageSourcePresetEntry?.displayName || l("workflow preset", "workflow preset")
          : `${selectedPackageSourceBusinessRoleEntry?.displayName || l("business role", "is rolu")} ${l("starter bundle", "starter paketi")}`;
      setMessage(
        l(
          "{{count}} workflow packages applied from {{source}}.",
          "{{count}} workflow paketi {{source}} kaynagindan uygulandi.",
          {
            count: selectedPackageSourcePackageCodes.length,
            source: sourceLabel,
          }
        )
      );
      await loadData();
    } catch (requestError) {
      setError(
        getErrorMessage(
          requestError,
          l(
            "The starter or preset package selection could not be applied.",
            "Starter veya preset paket secimi uygulanamadi."
          )
        )
      );
    } finally {
      setSaving(false);
    }
  }
  async function handleRemoveWorkflowPackage(assignment) {
    if (!assignment?.assignmentId) {
      return;
    }
    const revokeAccess = getPermissionAccess(
      "security.role_assignment.upsert",
      assignment.scopeId
        ? {
            scope: {
              scopeType: assignment.scopeType,
              scopeId: assignment.scopeId,
            },
          }
        : undefined
    );
    if (!revokeAccess.allowed) {
      setError(
        l(
          "You do not have permission to remove this workflow package assignment.",
          "Bu workflow paket atamasini kaldirma yetkiniz yok."
        )
      );
      return;
    }
    const confirmed = window.confirm(
      l(
        "Remove this direct workflow package grant only? Business role labels and other package grants will stay unchanged.",
        "Yalnizca bu dogrudan workflow paket yetkisini kaldirmak istiyor musunuz? Is rol etiketleri ve diger paket yetkileri degismeden kalir."
      )
    );
    if (!confirmed) {
      return;
    }

    setActingRowId(`workflow-package-${assignment.assignmentId}`);
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await deleteRoleAssignment(assignment.assignmentId);
      setMessage(
        l(
          "Workflow package assignment removed.",
          "Workflow paket atamasi kaldirildi."
        )
      );
      await loadData();
    } catch (requestError) {
      setError(
        getErrorMessage(
          requestError,
          l(
            "The workflow package assignment could not be removed.",
            "Workflow paket atamasi kaldirilamadi."
          )
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
    <SecurityAdminWorkspaceShell
      workspaceSectionKey="users"
      sectionKey="user-assignments"
      eyebrow={l("Security / Assignment Workspace", "Guvenlik / atama calisma alani")}
      title={l(
        "Users & Assignments Workbench",
        "Kullanicilar ve Atamalar Workbench'i"
      )}
      description={l(
        "Keep people selection, business assignment bundles, and effective authority review inside one canonical users workbench while scope access, delegations, and temporary coverage live beside it as sibling tabs.",
        "Kisi secimini, is atama paketlerini ve etkili yetki incelemesini tek bir canonical users workbench icinde tutarken kapsam erisimi, delegasyonlar ve gecici kapsama kayitlarini kardes sekmelerde yasatin."
      )}
      actions={[
        {
          to: "/app/ayarlar/security-admin/users?tab=delegations",
          label: l("Open delegations tab", "Delegasyon sekmesini ac"),
        },
        {
          onClick: openInviteModal,
          label: l("Invite user", "Kullanici davet et"),
        },
        {
          onClick: () => setWorkspaceTab("assignments"),
          label: l("Assign setup owner", "Setup sahibi ata"),
          tone: "primary",
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
      toolbar={
        <SecurityUsersWorkbenchTabs
          activeTab={workbenchTab}
          counts={{
            people: userDirectoryRows.length,
            assignments: assignmentBundles.length,
            delegations: totalDelegationCount,
            coverage: coverageRows.length,
          }}
        />
      }
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
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <WorkspaceLaneCard
          badgeLabel={l("People directory", "Kisi dizini")}
          description={l(
            "Filter one assignee list by role, package, source, and scope, then keep pending invite expiry and current authority visible without leaving the workspace.",
            "Tek bir atanan kisi listesini rol, paket, kaynak ve kapsama gore filtreleyin; sonra bekleyen davet suresini ve mevcut yetkiyi calisma alanindan ayrilmadan gorunur tutun."
          )}
          title={l("People directory", "Kisi dizini")}
          tone="blue"
        />
        <WorkspaceLaneCard
          badgeLabel={l("Primary path", "Birincil yol")}
          description={l(
            "Use preset-based setup-owner bundles as the normal admin path. Business-first bundles stay grouped by assignee, scope, and effective window.",
            "Normal yonetici yolu olarak preset tabanli setup owner paketlerini kullanin. Is-oncelikli paketler atanan kisi, kapsam ve yururluk penceresine gore gruplanmis kalir."
          )}
          title={l("Business assignment bundles", "Is atama paketleri")}
          tone="green"
        />
        <WorkspaceLaneCard
          badgeLabel={l("Secondary / advanced", "Ikincil / gelismis")}
          description={l(
            "Direct business labels, exact workflow packages, and raw role rows stay available for deliberate exceptions, but they no longer dominate the page.",
            "Dogrudan is etiketleri, tam workflow paketleri ve ham rol satirlari bilincli istisnalar icin kullanilabilir kalir; ancak artik sayfaya hakim olmaz."
          )}
          title={l("Raw role & package tools", "Ham rol ve paket araclari")}
          tone="amber"
        />
        <WorkspaceLaneCard
          badgeLabel={l("Date-bounded controls", "Tarihle sinirli kontroller")}
          description={l(
            "Keep approval delegation and temporary coverage as explicit, revocable objects with lifecycle badges and date ranges instead of burying them in side screens.",
            "Approval delegation ve temporary coverage kayitlarini yan ekranlara gommek yerine yasam dongusu etiketleri ve tarih araliklariyla acik, geri alinabilir nesneler olarak tutun."
          )}
          title={l(
            "Delegation & temporary coverage",
            "Delegation ve temporary coverage"
          )}
          tone="violet"
        />
      </section>
      {loading ? (
        <SecurityWorkbenchLoadingState
          title={l("Users workspace", "Kullanici calisma alani")}
          description={l("Loading workspace...", "Calisma alani yukleniyor...")}
        />
      ) : null}
      {!loading && activeTab === "users" ? (
        <section className="space-y-5">
          {workbenchTab === "authority" ? (
            <div className="rounded-[28px] border border-sky-200 bg-sky-50 px-5 py-4 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">
                {l("Authority-first view", "Yetki odakli gorunum")}
              </div>
              <p className="mt-2 text-sm leading-6 text-sky-900">
                {l(
                  "Effective authority stays in focus here: keep one user selected and review package sources, runtime roles, audit items, and scope-backed authority without leaving the users workbench.",
                  "Etkili yetki burada odakta kalir: users workbench'ten cikmadan tek bir kullaniciyi secili tutup paket kaynaklarini, runtime rolleri, denetim ogelerini ve kapsama dayali yetkiyi inceleyin."
                )}
              </p>
            </div>
          ) : null}
          <AuditSodSummarySurface
            assignmentAuditSummary={selectedWorkbenchAssignmentAuditSummary}
            canOpenAccessDebugger={canOpenAccessDebugger}
            canOpenAuditLogs={canOpenAuditLogs}
            canOpenComplianceReports={canOpenComplianceReports}
            canPreviewComplianceAudit={canPreviewComplianceAudit}
            l={l}
            selectedUser={selectedWorkbenchUser}
            selectedUserAssignmentAuditReadable={canReadAudit}
            selectedUserAuditError={selectedWorkbenchAuditError}
            selectedUserAuditLoading={selectedWorkbenchAuditLoading}
            tenantSodError={tenantSodError}
            tenantSodLoading={tenantSodLoading}
            tenantSodReport={tenantSodReport}
          />
          <UserAssignmentWorkbench
            actingRowId={actingRowId}
            businessRoleAssignmentForm={businessRoleAssignmentForm}
            businessRoleAssignmentWriteAccess={businessRoleAssignmentWriteAccess}
            businessRoleScopeOptions={businessRoleScopeOptions}
            canAssignRolePermissions={canAssignRolePermissions}
            canUpsertRole={canUpsertRole}
            filteredUsers={filteredUsers}
            l={l}
            onAssignBusinessRoleLabel={handleAssignBusinessRoleLabel}
            onApplyPackageSource={handleApplyPackageSource}
            onAssignWorkflowPackage={handleAssignWorkflowPackage}
            onClearFilters={() =>
              setUserFilters({
                search: "",
                status: "ALL",
                roleCode: "",
                packageCode: "",
                scopeType: "",
                scopeTarget: "",
                sourceType: "",
              })
            }
            onOpenBulkAssignments={() => setWorkspaceTab("assignments")}
            onOpenUserEditor={(userOrId) => {
              if (typeof userOrId === "object" && userOrId) {
                openExistingUserModal(userOrId);
                return;
              }
              const userRow = usersById.get(Number(userOrId || 0));
              if (userRow) {
                openExistingUserModal(userRow);
              }
            }}
            onRemoveBusinessRoleLabel={handleRemoveBusinessRoleLabel}
            onRemoveWorkflowPackage={handleRemoveWorkflowPackage}
            onRevokeBundle={handleRevokeBundle}
            onSelectBundle={setSelectedWorkbenchBundleId}
            onSelectUser={setSelectedWorkbenchUserId}
            onUpdateBusinessRoleAssignmentField={updateBusinessRoleAssignmentField}
            onUpdatePackageSourceApplyField={updatePackageSourceApplyField}
            onUpdateWorkflowPackageAssignmentField={updateWorkflowPackageAssignmentField}
            onTogglePackageSourcePreviewPackage={togglePackageSourcePreviewPackage}
            packageSourceApplyForm={packageSourceApplyForm}
            packageSourceApplyWriteAccess={packageSourceApplyWriteAccess}
            packageSourcePreviewEntries={packageSourcePreviewEntries}
            packageSourceScopeOptions={packageSourceScopeOptions}
            packageSourceScopeTypeOptions={packageSourceScopeTypeOptions}
            packageFilterOptions={packageFilterOptions}
            roleFilterOptions={roleFilterOptions}
            saving={saving}
            selectedBusinessRoleAssignments={selectedWorkbenchBusinessRoleAssignments}
            selectedBusinessRoleCatalogEntry={selectedBusinessRoleCatalogEntry}
            selectedBusinessRoleRuntimeRoleExists={selectedBusinessRoleRuntimeRoleExists}
            selectedPackageSourceBusinessRoleAssigned={
              selectedPackageSourceBusinessRoleAssigned
            }
            selectedPackageSourceBusinessRoleEntry={
              selectedPackageSourceBusinessRoleEntry
            }
            selectedUserAssignmentAuditReadable={canReadAudit}
            selectedUserAssignmentAuditSummary={
              selectedWorkbenchAssignmentAuditSummary
            }
            selectedUserAuditError={selectedWorkbenchAuditError}
            selectedUserAuditLoading={selectedWorkbenchAuditLoading}
            selectedPackageSourcePackageCodes={selectedPackageSourcePackageCodes}
            selectedPackageSourcePresetEntry={selectedPackageSourcePresetEntry}
            selectedUserEffectiveAuthorityPreview={
              selectedWorkbenchEffectiveAuthorityPreview
            }
            selectedWorkflowPackageAssignmentRoleStatus={selectedWorkflowPackageRoleStatus}
            selectedWorkflowPackageAssignments={selectedWorkbenchWorkflowPackageAssignments}
            selectedWorkflowPackageCatalogEntry={selectedWorkflowPackageCatalogEntry}
            selectedWorkflowPackageRuntimeRoleExists={Boolean(
              selectedWorkflowPackageRuntimeRole
            )}
            workflowPackageAssignmentForm={workflowPackageAssignmentForm}
            workflowPackageAssignmentWriteAccess={workflowPackageAssignmentWriteAccess}
            workflowPackageCatalogEntries={workflowPackageCatalogEntries}
            workflowPackageScopeOptions={workflowPackageScopeOptions}
            workflowPackageScopeTypeOptions={workflowPackageScopeTypeOptions}
            workflowPresetCatalogEntries={workflowPresetCatalogEntries}
            scopeTargetOptions={scopeTargetOptions}
            selectedBundle={selectedWorkbenchBundle}
            selectedUser={selectedWorkbenchUser}
            selectedUserBundles={selectedWorkbenchUserBundles}
            selectedUserPackageLabels={selectedWorkbenchPackageLabels}
            selectedUserRoleEntries={selectedWorkbenchRoleEntries}
            selectedUserScopeLabels={selectedWorkbenchScopeLabels}
            setUserFilters={setUserFilters}
            userFilters={userFilters}
          />
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
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-semibold text-slate-900">{row.name}</div>
                        <StatusPill label={l("Pending invite", "Bekleyen davet")} tone="amber" />
                      </div>
                      <div className="mt-1 text-xs text-slate-500">{row.email}</div>
                      <div className="mt-2 text-xs text-slate-600">
                        {l("Created", "Olusturuldu")} {formatDateTime(row.created_at)}
                      </div>
                      {row.invite_expires_at ? (
                        <div className="mt-1 text-xs font-medium text-amber-800">
                          {l("Invite expires", "Davet suresi dolar")}{" "}
                          {formatDateTime(row.invite_expires_at)}
                        </div>
                      ) : null}
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
    </SecurityAdminWorkspaceShell>
  );
}
