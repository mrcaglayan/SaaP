
import { query } from "../db.js";
import { SOD_RULES } from "../constants/sod-rules.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import {
  checkUserHasPermissionAtScope,
  doesScopeIncludeScope,
  getUserRoleScopeEffectiveDateGuard,
  loadUserEntitlements,
  normalizeAuthzScope,
} from "./authz.scope.service.js";
import { buildCsv } from "../utils/tabularExport.js";
const REPORT_TYPES = new Set([
  "ACCESS_MATRIX",
  "SOD_ANALYSIS",
  "APPROVAL_COVERAGE",
  "DELEGATION_LOG",
  "FULL",
]);
const REPORT_FORMATS = new Set(["JSON", "CSV"]);
const APPROVAL_COVERAGE_ACTION_CATALOG = Object.freeze([
  Object.freeze({
    moduleCode: "PAYMENTS",
    targetType: "PAYMENT_BATCH",
    actionType: "APPROVE",
    label: "Payment batch approval",
    uncoveredNote: "Payment batches have no unified approval policy configured.",
  }),
  Object.freeze({
    moduleCode: "PAYROLL",
    targetType: "PAYROLL_MANUAL_SETTLEMENT_OVERRIDE",
    actionType: "APPLY",
    label: "Payroll manual settlement override apply",
    uncoveredNote: "Payroll manual settlement overrides have no approval policy configured.",
  }),
  Object.freeze({
    moduleCode: "PAYROLL",
    targetType: "PAYROLL_PERIOD_CLOSE",
    actionType: "APPROVE_CLOSE",
    label: "Payroll period close approval",
    uncoveredNote: "Payroll period close approvals have no policy configured.",
  }),
  Object.freeze({
    moduleCode: "PAYROLL",
    targetType: "PAYROLL_PERIOD_CLOSE",
    actionType: "REOPEN",
    label: "Payroll period reopen approval",
    uncoveredNote: "Payroll period reopen approvals have no policy configured.",
  }),
  Object.freeze({
    moduleCode: "CARI",
    targetType: "COUNTERPARTY_REQUEST",
    actionType: "CREATE",
    label: "Counterparty request review",
    uncoveredNote: "Counterparty request creation/review has no approval policy configured.",
  }),
  Object.freeze({
    moduleCode: "INVENTORY",
    targetType: "INVENTORY_TRANSFER",
    actionType: "APPROVE",
    label: "Inventory transfer approval",
    uncoveredNote: "Inventory transfers have no approval policy configured.",
  }),
  Object.freeze({
    moduleCode: "LOCAL_CLOSE",
    targetType: "LOCAL_CLOSE_PACK_REOPEN_REQUEST",
    actionType: "REOPEN",
    label: "Local close pack reopen approval",
    uncoveredNote: "Local close pack reopen requests have no approval policy configured.",
  }),
]);
const SOD_RULE_MITIGATION_ACTION_MAP = Object.freeze({
  "payments.batch.create-approve.same-record": {
    moduleCode: "PAYMENTS",
    targetType: "PAYMENT_BATCH",
    actionType: "APPROVE",
  },
  "payroll.override.request-approve.same-record": {
    moduleCode: "PAYROLL",
    targetType: "PAYROLL_MANUAL_SETTLEMENT_OVERRIDE",
    actionType: "APPLY",
  },
  "payroll.close.request-approve.same-record": {
    moduleCode: "PAYROLL",
    targetType: "PAYROLL_PERIOD_CLOSE",
    actionType: "APPROVE_CLOSE",
  },
  "cari.request-review.same-record": {
    moduleCode: "CARI",
    targetType: "COUNTERPARTY_REQUEST",
    actionType: "CREATE",
  },
  "inventory.transfer.initiate-approve.same-record": {
    moduleCode: "INVENTORY",
    targetType: "INVENTORY_TRANSFER",
    actionType: "APPROVE",
  },
});
function normalizeUpperText(value) {
  return String(value || "").trim().toUpperCase();
}
function parseDateOnly(value) {
  if (!value) {
    return null;
  }
  const dateOnlyMatch = String(value).match(/\d{4}-\d{2}-\d{2}/);
  if (dateOnlyMatch) {
    return dateOnlyMatch[0];
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString().slice(0, 10);
}
function parseDateTime(value) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}
function toEndOfDayIso(value) {
  const dateOnly = parseDateOnly(value);
  return dateOnly ? `${dateOnly} 23:59:59` : null;
}
function toNumberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function toBoolean(value) {
  return value === true || value === 1 || value === "1";
}
function scopeRank(scopeType) {
  if (scopeType === "OPERATING_UNIT") return 5;
  if (scopeType === "LEGAL_ENTITY") return 4;
  if (scopeType === "COUNTRY") return 3;
  if (scopeType === "GROUP") return 2;
  if (scopeType === "TENANT") return 1;
  return 0;
}
function scopeKey(scopeType, scopeId) {
  const normalizedScopeType = normalizeUpperText(scopeType);
  const normalizedScopeId = parsePositiveInt(scopeId);
  if (!normalizedScopeType || !normalizedScopeId) {
    return null;
  }
  return `${normalizedScopeType}:${normalizedScopeId}`;
}
function normalizeScopeOrNull(scope, tenantId) {
  if (!scope) {
    return null;
  }
  const scopeType = scope.scopeType ?? scope.scope_type;
  const scopeId = scope.scopeId ?? scope.scope_id;
  if (scopeType === undefined && scopeId === undefined) {
    return null;
  }
  return normalizeAuthzScope({ scopeType, scopeId }, tenantId);
}
function normalizeScopeFilter(input) {
  const tenantId = parsePositiveInt(input?.tenantId ?? input?.tenant_id);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  const reportType = normalizeUpperText(
    (input?.reportType ?? input?.report_type) || "FULL"
  );
  if (!REPORT_TYPES.has(reportType)) {
    throw badRequest(
      "reportType must be ACCESS_MATRIX, SOD_ANALYSIS, APPROVAL_COVERAGE, DELEGATION_LOG, or FULL"
    );
  }
  const format = normalizeUpperText(input?.format || "JSON");
  if (!REPORT_FORMATS.has(format)) {
    throw badRequest("format must be JSON or CSV");
  }
  const asOfDate = parseDateOnly(input?.asOfDate ?? input?.as_of_date);
  if ((input?.asOfDate || input?.as_of_date) && !asOfDate) {
    throw badRequest("asOfDate must be a valid YYYY-MM-DD date");
  }
  const scopeType = input?.scopeType ?? input?.scope_type;
  const scopeId = input?.scopeId ?? input?.scope_id;
  if ((scopeType && !scopeId) || (!scopeType && scopeId)) {
    throw badRequest("scopeType and scopeId must be provided together");
  }
  return {
    tenantId,
    reportType,
    format,
    asOfDate: asOfDate || new Date().toISOString().slice(0, 10),
    scopeFilter: normalizeScopeOrNull(
      scopeType || scopeId ? { scopeType, scopeId } : null,
      tenantId
    ),
  };
}
async function loadScopeReferences(tenantId, runQuery = query) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const [tenantResult, groupResult, countryResult, legalEntityResult, operatingUnitResult] =
    await Promise.all([
      runQuery(
        `SELECT id, code, name
         FROM tenants
         WHERE id = ?
         LIMIT 1`,
        [normalizedTenantId]
      ),
      runQuery(
        `SELECT id, code, name
         FROM group_companies
         WHERE tenant_id = ?`,
        [normalizedTenantId]
      ),
      runQuery(
        `SELECT id, iso2 AS code, name
         FROM countries`,
        []
      ),
      runQuery(
        `SELECT id, code, name
         FROM legal_entities
         WHERE tenant_id = ?`,
        [normalizedTenantId]
      ),
      runQuery(
        `SELECT id, code, name
         FROM operating_units
         WHERE tenant_id = ?`,
        [normalizedTenantId]
      ),
    ]);
  function mapRows(rows = []) {
    return new Map(
      rows
        .map((row) => [
          parsePositiveInt(row?.id),
          {
            id: parsePositiveInt(row?.id),
            code: String(row?.code || "").trim() || null,
            name: String(row?.name || "").trim() || null,
          },
        ])
        .filter(([id]) => id)
    );
  }
  return {
    TENANT: mapRows(tenantResult.rows || []),
    GROUP: mapRows(groupResult.rows || []),
    COUNTRY: mapRows(countryResult.rows || []),
    LEGAL_ENTITY: mapRows(legalEntityResult.rows || []),
    OPERATING_UNIT: mapRows(operatingUnitResult.rows || []),
  };
}
function resolveScopeName(scopeReferences, scopeType, scopeId) {
  const normalizedScopeType = normalizeUpperText(scopeType);
  const normalizedScopeId = parsePositiveInt(scopeId);
  if (!normalizedScopeType || !normalizedScopeId) {
    return null;
  }
  const byType = scopeReferences?.[normalizedScopeType];
  const match = byType instanceof Map ? byType.get(normalizedScopeId) : null;
  if (!match) {
    return `${normalizedScopeType} ${normalizedScopeId}`;
  }
  return match.name || match.code || `${normalizedScopeType} ${normalizedScopeId}`;
}
function formatScopeLabel(scopeReferences, scopeType, scopeId) {
  const normalizedScopeType = normalizeUpperText(scopeType);
  const normalizedScopeId = parsePositiveInt(scopeId);
  if (!normalizedScopeType || !normalizedScopeId) {
    return "";
  }
  return `${normalizedScopeType}:${normalizedScopeId} (${resolveScopeName(
    scopeReferences,
    normalizedScopeType,
    normalizedScopeId
  )})`;
}
function mapScopeWithName(scopeReferences, scopeType, scopeId) {
  const normalizedScopeType = normalizeUpperText(scopeType);
  const normalizedScopeId = parsePositiveInt(scopeId);
  if (!normalizedScopeType || !normalizedScopeId) {
    return null;
  }
  return {
    type: normalizedScopeType,
    id: normalizedScopeId,
    name: resolveScopeName(scopeReferences, normalizedScopeType, normalizedScopeId),
  };
}
function withinDateWindow(startDate, endDate, asOfDate) {
  if (startDate && asOfDate < startDate) {
    return false;
  }
  if (endDate && asOfDate > endDate) {
    return false;
  }
  return true;
}
function resolveDelegationState(row, asOfDate) {
  const revokedAtDate = parseDateOnly(row?.revoked_at ?? row?.revokedAt);
  if ((revokedAtDate && revokedAtDate <= asOfDate) || row?.is_active === 0 || row?.isActive === false) {
    return "REVOKED";
  }
  const effectiveFrom = parseDateOnly(row?.effective_from ?? row?.effectiveFrom);
  const effectiveTo = parseDateOnly(row?.effective_to ?? row?.effectiveTo);
  if (effectiveFrom && asOfDate < effectiveFrom) {
    return "UPCOMING";
  }
  if (effectiveTo && asOfDate > effectiveTo) {
    return "EXPIRED";
  }
  return "ACTIVE";
}
async function scopesIntersect(
  tenantId,
  leftScope,
  rightScope,
  runQuery = query,
  cache = null
) {
  if (!rightScope) {
    return true;
  }
  const normalizedLeftScope = normalizeScopeOrNull(leftScope, tenantId);
  const normalizedRightScope = normalizeScopeOrNull(rightScope, tenantId);
  if (!normalizedLeftScope || !normalizedRightScope) {
    return false;
  }
  const cacheKey = cache
    ? `${scopeKey(normalizedLeftScope.scopeType, normalizedLeftScope.scopeId)}|${scopeKey(
        normalizedRightScope.scopeType,
        normalizedRightScope.scopeId
      )}`
    : null;
  if (cacheKey && cache?.has(cacheKey)) {
    return cache.get(cacheKey);
  }
  let intersects =
    normalizedLeftScope.scopeType === normalizedRightScope.scopeType &&
    normalizedLeftScope.scopeId === normalizedRightScope.scopeId;
  if (!intersects) {
    intersects = await doesScopeIncludeScope(
      tenantId,
      normalizedLeftScope,
      normalizedRightScope,
      runQuery
    );
  }
  if (!intersects) {
    intersects = await doesScopeIncludeScope(
      tenantId,
      normalizedRightScope,
      normalizedLeftScope,
      runQuery
    );
  }
  if (cacheKey) {
    cache.set(cacheKey, intersects);
  }
  return intersects;
}
async function resolveOverlapScope(
  tenantId,
  leftScope,
  rightScope,
  runQuery = query,
  cache = null
) {
  const normalizedLeftScope = normalizeScopeOrNull(leftScope, tenantId);
  const normalizedRightScope = normalizeScopeOrNull(rightScope, tenantId);
  if (!normalizedLeftScope || !normalizedRightScope) {
    return null;
  }
  if (
    normalizedLeftScope.scopeType === normalizedRightScope.scopeType &&
    normalizedLeftScope.scopeId === normalizedRightScope.scopeId
  ) {
    return normalizedLeftScope;
  }
  if (
    await scopesIntersect(
      tenantId,
      normalizedLeftScope,
      normalizedRightScope,
      runQuery,
      cache
    )
  ) {
    return scopeRank(normalizedLeftScope.scopeType) >= scopeRank(normalizedRightScope.scopeType)
      ? normalizedLeftScope
      : normalizedRightScope;
  }
  return null;
}
async function loadTenantUsers(tenantId, runQuery = query) {
  const result = await runQuery(
    `SELECT id, email, name, status, created_at
     FROM users
     WHERE tenant_id = ?
     ORDER BY name ASC, email ASC, id ASC`,
    [tenantId]
  );
  return (result.rows || []).map((row) => ({
    id: parsePositiveInt(row?.id),
    email: String(row?.email || "").trim() || null,
    name: String(row?.name || "").trim() || null,
    status: String(row?.status || "").trim() || null,
    createdAt: parseDateTime(row?.created_at),
  }));
}
async function loadRoleAssignmentsAsOf(tenantId, asOfDate, runQuery = query) {
  const effectiveGuard = await getUserRoleScopeEffectiveDateGuard(runQuery, asOfDate);
  const result = await runQuery(
    `SELECT
        urs.id,
        urs.user_id,
        urs.role_id,
        urs.scope_type,
        urs.scope_id,
        urs.effect,
        urs.effective_from,
        urs.effective_to,
        urs.created_at,
        r.code AS role_code,
        r.name AS role_name
       FROM user_role_scopes urs
       JOIN roles r
         ON r.id = urs.role_id
        AND r.tenant_id = urs.tenant_id
      WHERE urs.tenant_id = ?${effectiveGuard.sql}
      ORDER BY urs.user_id ASC, urs.id ASC`,
    [tenantId, ...effectiveGuard.params]
  );
  return (result.rows || []).map((row) => ({
    id: parsePositiveInt(row?.id),
    userId: parsePositiveInt(row?.user_id),
    roleId: parsePositiveInt(row?.role_id),
    roleCode: String(row?.role_code || "").trim() || null,
    roleName: String(row?.role_name || "").trim() || null,
    scopeType: normalizeUpperText(row?.scope_type),
    scopeId: parsePositiveInt(row?.scope_id),
    effect: normalizeUpperText(row?.effect),
    effectiveFrom: parseDateOnly(row?.effective_from),
    effectiveTo: parseDateOnly(row?.effective_to),
    createdAt: parseDateTime(row?.created_at),
  }));
}
async function loadRolePermissions(roleIds, runQuery = query) {
  const normalizedRoleIds = Array.from(
    new Set((Array.isArray(roleIds) ? roleIds : []).map(parsePositiveInt).filter(Boolean))
  );
  if (normalizedRoleIds.length === 0) {
    return new Map();
  }
  const result = await runQuery(
    `SELECT rp.role_id, p.code
     FROM role_permissions rp
     JOIN permissions p ON p.id = rp.permission_id
     WHERE rp.role_id IN (${normalizedRoleIds.map(() => "?").join(", ")})
     ORDER BY rp.role_id ASC, p.code ASC`,
    normalizedRoleIds
  );
  const permissionsByRoleId = new Map();
  for (const row of result.rows || []) {
    const roleId = parsePositiveInt(row?.role_id);
    const permissionCode = String(row?.code || "").trim();
    if (!roleId || !permissionCode) {
      continue;
    }
    if (!permissionsByRoleId.has(roleId)) {
      permissionsByRoleId.set(roleId, new Set());
    }
    permissionsByRoleId.get(roleId).add(permissionCode);
  }
  return permissionsByRoleId;
}
async function loadDataScopes(tenantId, runQuery = query) {
  const result = await runQuery(
    `SELECT id, user_id, scope_type, scope_id, effect, created_at
     FROM data_scopes
     WHERE tenant_id = ?
     ORDER BY user_id ASC, id ASC`,
    [tenantId]
  );
  return (result.rows || []).map((row) => ({
    id: parsePositiveInt(row?.id),
    userId: parsePositiveInt(row?.user_id),
    scopeType: normalizeUpperText(row?.scope_type),
    scopeId: parsePositiveInt(row?.scope_id),
    effect: normalizeUpperText(row?.effect),
    createdAt: parseDateTime(row?.created_at),
  }));
}
async function loadDelegations(tenantId, asOfDate, runQuery = query) {
  const asOfEnd = toEndOfDayIso(asOfDate);
  const result = await runQuery(
    `SELECT
        d.*,
        delegator.name AS delegator_user_name,
        delegator.email AS delegator_user_email,
        delegate_user.name AS delegate_user_name,
        delegate_user.email AS delegate_user_email
       FROM approval_delegations d
       LEFT JOIN users delegator
         ON delegator.tenant_id = d.tenant_id
        AND delegator.id = d.delegator_user_id
       LEFT JOIN users delegate_user
         ON delegate_user.tenant_id = d.tenant_id
        AND delegate_user.id = d.delegate_user_id
      WHERE d.tenant_id = ?
        AND d.created_at <= ?
      ORDER BY d.id DESC`,
    [tenantId, asOfEnd]
  );
  return (result.rows || []).map((row) => ({
    id: parsePositiveInt(row?.id),
    tenantId: parsePositiveInt(row?.tenant_id),
    delegatorUserId: parsePositiveInt(row?.delegator_user_id),
    delegatorUserName: String(row?.delegator_user_name || "").trim() || null,
    delegatorUserEmail: String(row?.delegator_user_email || "").trim() || null,
    delegateUserId: parsePositiveInt(row?.delegate_user_id),
    delegateUserName: String(row?.delegate_user_name || "").trim() || null,
    delegateUserEmail: String(row?.delegate_user_email || "").trim() || null,
    moduleCode: normalizeUpperText(row?.module_code) || null,
    scopeType: normalizeUpperText(row?.scope_type),
    scopeId: parsePositiveInt(row?.scope_id),
    effectiveFrom: parseDateOnly(row?.effective_from),
    effectiveTo: parseDateOnly(row?.effective_to),
    note: String(row?.note || "").trim() || null,
    isActive: toBoolean(row?.is_active),
    revokedAt: parseDateTime(row?.revoked_at),
    revokedReason: String(row?.revoked_reason || "").trim() || null,
    createdAt: parseDateTime(row?.created_at),
    state: resolveDelegationState(row, asOfDate),
  }));
}
async function loadDelegationDecisionDetails(
  tenantId,
  asOfDate,
  delegationIds,
  runQuery = query
) {
  const normalizedDelegationIds = Array.from(
    new Set((Array.isArray(delegationIds) ? delegationIds : []).map(parsePositiveInt).filter(Boolean))
  );
  if (normalizedDelegationIds.length === 0) {
    return [];
  }
  const asOfEnd = toEndOfDayIso(asOfDate);
  const result = await runQuery(
    `SELECT
        d.delegation_id,
        d.request_id,
        d.decision,
        d.decided_at,
        r.request_code,
        r.module_code,
        r.target_type
       FROM approval_decisions d
       JOIN approval_requests r
         ON r.tenant_id = d.tenant_id
        AND r.id = d.request_id
      WHERE d.tenant_id = ?
        AND d.delegation_id IN (${normalizedDelegationIds.map(() => "?").join(", ")})
        AND d.decided_at <= ?
      ORDER BY d.delegation_id ASC, d.decided_at ASC, d.id ASC`,
    [tenantId, ...normalizedDelegationIds, asOfEnd]
  );
  return (result.rows || []).map((row) => ({
    delegationId: parsePositiveInt(row?.delegation_id),
    requestId: parsePositiveInt(row?.request_id),
    requestCode: String(row?.request_code || "").trim() || null,
    action: normalizeUpperText(row?.decision),
    moduleCode: normalizeUpperText(row?.module_code),
    targetType: normalizeUpperText(row?.target_type),
    decidedAt: parseDateTime(row?.decided_at),
  }));
}
async function loadApprovalPoliciesAsOf(tenantId, asOfDate, runQuery = query) {
  const policyResult = await runQuery(
    `SELECT *
     FROM approval_policies
     WHERE tenant_id = ?
       AND is_active = 1
       AND (effective_from IS NULL OR effective_from <= ?)
       AND (effective_to IS NULL OR effective_to >= ?)
     ORDER BY module_code ASC, target_type ASC, action_type ASC, id ASC`,
    [tenantId, asOfDate, asOfDate]
  );
  const policies = (policyResult.rows || []).map((row) => ({
    id: parsePositiveInt(row?.id),
    moduleCode: normalizeUpperText(row?.module_code),
    policyCode: String(row?.policy_code || "").trim() || null,
    policyName: String(row?.policy_name || "").trim() || null,
    targetType: normalizeUpperText(row?.target_type),
    actionType: normalizeUpperText(row?.action_type),
    versionNo: Number(row?.version_no || 1),
    scopeType: normalizeUpperText(row?.scope_type) || null,
    scopeId: parsePositiveInt(row?.scope_id),
    effectiveFrom: parseDateOnly(row?.effective_from),
    effectiveTo: parseDateOnly(row?.effective_to),
    minApprovals: Number(row?.min_approvals || 1),
    makerCheckerRequired: toBoolean(row?.maker_checker_required),
    autoExecuteOnFinalApproval: toBoolean(row?.auto_execute_on_final_approval),
    minAmount: toNumberOrNull(row?.min_amount),
    maxAmount: toNumberOrNull(row?.max_amount),
    currencyCode: String(row?.currency_code || "").trim() || null,
    approverPermissionCode: String(row?.approver_permission_code || "").trim() || null,
  }));
  const policyIds = policies.map((policy) => policy.id).filter(Boolean);
  if (policyIds.length === 0) {
    return [];
  }
  const [assignmentResult, stepResult] = await Promise.all([
    runQuery(
      `SELECT *
       FROM approval_policy_assignments
       WHERE tenant_id = ?
         AND policy_id IN (${policyIds.map(() => "?").join(", ")})
         AND is_active = 1
         AND (effective_from IS NULL OR effective_from <= ?)
         AND (effective_to IS NULL OR effective_to >= ?)
       ORDER BY policy_id ASC, scope_type ASC, scope_id ASC, id ASC`,
      [tenantId, ...policyIds, asOfDate, asOfDate]
    ),
    runQuery(
      `SELECT policy_id, COUNT(*) AS step_count
       FROM approval_policy_steps
       WHERE tenant_id = ?
         AND policy_id IN (${policyIds.map(() => "?").join(", ")})
       GROUP BY policy_id`,
      [tenantId, ...policyIds]
    ),
  ]);
  const assignmentsByPolicyId = new Map();
  for (const row of assignmentResult.rows || []) {
    const policyId = parsePositiveInt(row?.policy_id);
    if (!policyId) {
      continue;
    }
    if (!assignmentsByPolicyId.has(policyId)) {
      assignmentsByPolicyId.set(policyId, []);
    }
    assignmentsByPolicyId.get(policyId).push({
      scopeType: normalizeUpperText(row?.scope_type),
      scopeId: parsePositiveInt(row?.scope_id),
      effectiveFrom: parseDateOnly(row?.effective_from),
      effectiveTo: parseDateOnly(row?.effective_to),
    });
  }
  const stepCountByPolicyId = new Map();
  for (const row of stepResult.rows || []) {
    const policyId = parsePositiveInt(row?.policy_id);
    if (!policyId) {
      continue;
    }
    stepCountByPolicyId.set(policyId, Number(row?.step_count || 0));
  }
  return policies.map((policy) => {
    const assignments = assignmentsByPolicyId.get(policy.id) || [];
    const applicabilityScopes =
      assignments.length > 0
        ? assignments.map((assignment) => ({
            scopeType: assignment.scopeType,
            scopeId: assignment.scopeId,
          }))
        : policy.scopeType && policy.scopeId
          ? [{ scopeType: policy.scopeType, scopeId: policy.scopeId }]
          : [{ scopeType: "TENANT", scopeId: tenantId }];
    return {
      ...policy,
      assignments,
      applicabilityScopes,
      stepCount: Math.max(1, Number(stepCountByPolicyId.get(policy.id) || 0)),
    };
  });
}
async function loadActiveApprovalCoverage(tenantId, asOfDate, scopeFilter, runQuery = query) {
  const policies = await loadApprovalPoliciesAsOf(tenantId, asOfDate, runQuery);
  const scopeIntersectionCache = new Map();
  const filteredPolicies = [];
  for (const policy of policies) {
    const relevantScopes = [];
    for (const scope of policy.applicabilityScopes) {
      if (
        await scopesIntersect(
          tenantId,
          scope,
          scopeFilter,
          runQuery,
          scopeIntersectionCache
        )
      ) {
        relevantScopes.push(scope);
      }
    }
    if (relevantScopes.length === 0 && scopeFilter) {
      continue;
    }
    filteredPolicies.push({
      ...policy,
      relevantScopes: relevantScopes.length > 0 ? relevantScopes : [...policy.applicabilityScopes],
    });
  }
  const grouped = new Map();
  for (const policy of filteredPolicies) {
    const key = `${policy.moduleCode}|${policy.targetType}|${policy.actionType}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        moduleCode: policy.moduleCode,
        targetType: policy.targetType,
        actionType: policy.actionType,
        policyCount: 0,
        policies: [],
        relevantScopes: [],
      });
    }
    const entry = grouped.get(key);
    entry.policyCount += 1;
    entry.policies.push(policy);
    for (const scope of policy.relevantScopes) {
      const token = scopeKey(scope.scopeType, scope.scopeId);
      if (!token) {
        continue;
      }
      if (!entry.relevantScopes.some((candidate) => scopeKey(candidate.scopeType, candidate.scopeId) === token)) {
        entry.relevantScopes.push(scope);
      }
    }
  }
  return {
    policies: filteredPolicies,
    groups: Array.from(grouped.values()),
  };
}
function groupEffectivePermissions(entitlements, scopeReferences) {
  const grouped = new Map();
  for (const entry of entitlements?.permissions || []) {
    const permissionCode = String(entry?.code || "").trim();
    const scopeType = normalizeUpperText(entry?.scopeType);
    const scopeIds = Array.isArray(entry?.scopeIds) ? entry.scopeIds : [];
    if (!permissionCode || !scopeType || scopeIds.length === 0) {
      continue;
    }
    if (!grouped.has(permissionCode)) {
      grouped.set(permissionCode, {
        code: permissionCode,
        visibilityNarrowed: Boolean(entry?.visibilityNarrowed),
        scopes: [],
      });
    }
    const permissionEntry = grouped.get(permissionCode);
    for (const scopeId of scopeIds) {
      const normalizedScopeId = parsePositiveInt(scopeId);
      const token = scopeKey(scopeType, normalizedScopeId);
      if (!token) {
        continue;
      }
      if (permissionEntry.scopes.some((scope) => scopeKey(scope.type, scope.id) === token)) {
        continue;
      }
      permissionEntry.scopes.push({
        type: scopeType,
        id: normalizedScopeId,
        name: resolveScopeName(scopeReferences, scopeType, normalizedScopeId),
      });
    }
  }
  return Array.from(grouped.values()).sort((left, right) => left.code.localeCompare(right.code));
}
async function buildAccessMatrixReport(input, options = {}) {
  const { tenantId, asOfDate, scopeFilter } = input;
  const runQuery = typeof options?.runQuery === "function" ? options.runQuery : query;
  const [users, assignments, dataScopes, entitlementsByUser, delegations, scopeReferences] =
    await Promise.all([
      loadTenantUsers(tenantId, runQuery),
      loadRoleAssignmentsAsOf(tenantId, asOfDate, runQuery),
      loadDataScopes(tenantId, runQuery),
      Promise.resolve(null),
      loadDelegations(tenantId, asOfDate, runQuery),
      loadScopeReferences(tenantId, runQuery),
    ]);
  const entitlementsMap = new Map();
  await Promise.all(
    users.map(async (user) => {
      const entitlements = await loadUserEntitlements({
        tenantId,
        userId: user.id,
        runQuery,
        asOfDate,
      });
      entitlementsMap.set(user.id, entitlements);
    })
  );
  const assignmentsByUserId = new Map();
  for (const assignment of assignments) {
    if (!assignmentsByUserId.has(assignment.userId)) {
      assignmentsByUserId.set(assignment.userId, []);
    }
    assignmentsByUserId.get(assignment.userId).push(assignment);
  }
  const dataScopesByUserId = new Map();
  for (const dataScope of dataScopes) {
    if (!dataScopesByUserId.has(dataScope.userId)) {
      dataScopesByUserId.set(dataScope.userId, []);
    }
    dataScopesByUserId.get(dataScope.userId).push(dataScope);
  }
  const delegationsByUserId = new Map();
  for (const delegation of delegations) {
    if (delegation.state !== "ACTIVE") {
      continue;
    }
    const outgoingEntry = {
      relation: "OUTGOING",
      id: delegation.id,
      moduleCode: delegation.moduleCode,
      scopeType: delegation.scopeType,
      scopeId: delegation.scopeId,
      scopeName: resolveScopeName(scopeReferences, delegation.scopeType, delegation.scopeId),
      effectiveFrom: delegation.effectiveFrom,
      effectiveTo: delegation.effectiveTo,
      note: delegation.note,
      counterpartyUserId: delegation.delegateUserId,
      counterpartyName: delegation.delegateUserName,
      counterpartyEmail: delegation.delegateUserEmail,
    };
    const incomingEntry = {
      relation: "INCOMING",
      id: delegation.id,
      moduleCode: delegation.moduleCode,
      scopeType: delegation.scopeType,
      scopeId: delegation.scopeId,
      scopeName: resolveScopeName(scopeReferences, delegation.scopeType, delegation.scopeId),
      effectiveFrom: delegation.effectiveFrom,
      effectiveTo: delegation.effectiveTo,
      note: delegation.note,
      counterpartyUserId: delegation.delegatorUserId,
      counterpartyName: delegation.delegatorUserName,
      counterpartyEmail: delegation.delegatorUserEmail,
    };
    if (!delegationsByUserId.has(delegation.delegatorUserId)) {
      delegationsByUserId.set(delegation.delegatorUserId, []);
    }
    delegationsByUserId.get(delegation.delegatorUserId).push(outgoingEntry);
    if (!delegationsByUserId.has(delegation.delegateUserId)) {
      delegationsByUserId.set(delegation.delegateUserId, []);
    }
    delegationsByUserId.get(delegation.delegateUserId).push(incomingEntry);
  }
  const scopeIntersectionCache = new Map();
  const matrix = [];
  for (const user of users) {
    const rawRoles = assignmentsByUserId.get(user.id) || [];
    const roles = [];
    for (const assignment of rawRoles) {
      const relevant = await scopesIntersect(
        tenantId,
        {
          scopeType: assignment.scopeType,
          scopeId: assignment.scopeId,
        },
        scopeFilter,
        runQuery,
        scopeIntersectionCache
      );
      if (!relevant) {
        continue;
      }
      roles.push({
        assignmentId: assignment.id,
        roleCode: assignment.roleCode,
        roleName: assignment.roleName,
        scopeType: assignment.scopeType,
        scopeId: assignment.scopeId,
        scopeName: resolveScopeName(scopeReferences, assignment.scopeType, assignment.scopeId),
        effect: assignment.effect,
        assignedAt: assignment.createdAt,
        effectiveFrom: assignment.effectiveFrom,
        effectiveTo: assignment.effectiveTo,
      });
    }
    const entitlements = entitlementsMap.get(user.id) || null;
    const effectivePermissions = [];
    for (const permission of groupEffectivePermissions(entitlements, scopeReferences)) {
      const scopes = [];
      for (const scope of permission.scopes) {
        const relevant = await scopesIntersect(
          tenantId,
          {
            scopeType: scope.type,
            scopeId: scope.id,
          },
          scopeFilter,
          runQuery,
          scopeIntersectionCache
        );
        if (relevant) {
          scopes.push(scope);
        }
      }
      if (scopes.length === 0 && scopeFilter) {
        continue;
      }
      effectivePermissions.push({
        code: permission.code,
        visibilityNarrowed: permission.visibilityNarrowed,
        scopes: scopes.length > 0 ? scopes : permission.scopes,
      });
    }
    const visibilityOverrides = entitlements?.visibilityOverrides || [];
    const dataScopeEntries = [];
    for (const visibilityOverride of visibilityOverrides) {
      const relevant = await scopesIntersect(
        tenantId,
        {
          scopeType: visibilityOverride.scopeType,
          scopeId: visibilityOverride.scopeId,
        },
        scopeFilter,
        runQuery,
        scopeIntersectionCache
      );
      if (!relevant) {
        continue;
      }
      dataScopeEntries.push({
        scopeType: visibilityOverride.scopeType,
        scopeId: visibilityOverride.scopeId,
        scopeName: resolveScopeName(
          scopeReferences,
          visibilityOverride.scopeType,
          visibilityOverride.scopeId
        ),
        effect: visibilityOverride.effect,
      });
    }
    const rawDelegations = delegationsByUserId.get(user.id) || [];
    const activeDelegations = [];
    for (const delegation of rawDelegations) {
      const relevant = await scopesIntersect(
        tenantId,
        {
          scopeType: delegation.scopeType,
          scopeId: delegation.scopeId,
        },
        scopeFilter,
        runQuery,
        scopeIntersectionCache
      );
      if (relevant) {
        activeDelegations.push(delegation);
      }
    }
    if (
      scopeFilter &&
      roles.length === 0 &&
      effectivePermissions.length === 0 &&
      dataScopeEntries.length === 0 &&
      activeDelegations.length === 0
    ) {
      continue;
    }
    matrix.push({
      userId: user.id,
      userName: user.name,
      email: user.email,
      status: user.status,
      roles,
      effectivePermissions,
      dataScopes: dataScopeEntries,
      activeDelegations,
      scopeSummary: entitlements?.scopeSummary || null,
      isVisibilityNarrowed: Boolean(entitlements?.isVisibilityNarrowed),
    });
  }
  return {
    reportType: "ACCESS_MATRIX",
    asOfDate,
    matrix,
    summary: {
      totalUsers: matrix.length,
      usersWithRoles: matrix.filter((row) => row.roles.length > 0).length,
      usersWithEffectivePermissions: matrix.filter((row) => row.effectivePermissions.length > 0)
        .length,
      usersWithDataScopes: matrix.filter((row) => row.dataScopes.length > 0).length,
      usersWithActiveDelegations: matrix.filter((row) => row.activeDelegations.length > 0).length,
    },
  };
}
async function buildSodAnalysisReport(input, options = {}) {
  const { tenantId, asOfDate, scopeFilter } = input;
  const runQuery = typeof options?.runQuery === "function" ? options.runQuery : query;
  const [users, assignments, rolePermissions, scopeReferences, coverage] = await Promise.all([
    loadTenantUsers(tenantId, runQuery),
    loadRoleAssignmentsAsOf(tenantId, asOfDate, runQuery),
    Promise.resolve(null),
    loadScopeReferences(tenantId, runQuery),
    loadActiveApprovalCoverage(tenantId, asOfDate, scopeFilter, runQuery),
  ]);
  const permissionsByRoleId = await loadRolePermissions(
    assignments.map((assignment) => assignment.roleId),
    runQuery
  );
  const usersById = new Map(users.map((user) => [user.id, user]));
  const assignmentsByUserId = new Map();
  for (const assignment of assignments) {
    if (assignment.effect !== "ALLOW") {
      continue;
    }
    const permissionCodes = permissionsByRoleId.get(assignment.roleId) || new Set();
    if (!assignmentsByUserId.has(assignment.userId)) {
      assignmentsByUserId.set(assignment.userId, []);
    }
    assignmentsByUserId.get(assignment.userId).push({
      ...assignment,
      permissionCodes,
    });
  }
  const scopeIntersectionCache = new Map();
  const permissionCheckCache = new Map();
  async function hasPermissionAtScope(userId, permissionCode, scope) {
    const cacheKey = `${userId}|${permissionCode}|${scopeKey(scope.scopeType, scope.scopeId)}`;
    if (permissionCheckCache.has(cacheKey)) {
      return permissionCheckCache.get(cacheKey);
    }
    const result = await checkUserHasPermissionAtScope(
      userId,
      tenantId,
      permissionCode,
      scope.scopeType,
      scope.scopeId,
      { runQuery, asOfDate }
    );
    permissionCheckCache.set(cacheKey, result);
    return result;
  }
  const conflictsByKey = new Map();
  for (const rule of SOD_RULES) {
    for (const [userId, userAssignments] of assignmentsByUserId.entries()) {
      const assignmentsA = userAssignments.filter((assignment) =>
        assignment.permissionCodes.has(rule.action_a)
      );
      const assignmentsB = userAssignments.filter((assignment) =>
        assignment.permissionCodes.has(rule.action_b)
      );
      if (assignmentsA.length === 0 || assignmentsB.length === 0) {
        continue;
      }
      for (const assignmentA of assignmentsA) {
        for (const assignmentB of assignmentsB) {
          const overlapScope = await resolveOverlapScope(
            tenantId,
            {
              scopeType: assignmentA.scopeType,
              scopeId: assignmentA.scopeId,
            },
            {
              scopeType: assignmentB.scopeType,
              scopeId: assignmentB.scopeId,
            },
            runQuery,
            scopeIntersectionCache
          );
          if (!overlapScope) {
            continue;
          }
          if (
            !(await scopesIntersect(
              tenantId,
              overlapScope,
              scopeFilter,
              runQuery,
              scopeIntersectionCache
            ))
          ) {
            continue;
          }
          const [hasActionA, hasActionB] = await Promise.all([
            hasPermissionAtScope(userId, rule.action_a, overlapScope),
            hasPermissionAtScope(userId, rule.action_b, overlapScope),
          ]);
          if (!hasActionA || !hasActionB) {
            continue;
          }
          const key = `${userId}|${rule.code}`;
          if (!conflictsByKey.has(key)) {
            const user = usersById.get(userId) || {};
            conflictsByKey.set(key, {
              userId,
              userName: user.name || null,
              email: user.email || null,
              conflictRule: {
                code: rule.code,
                actionA: rule.action_a,
                actionB: rule.action_b,
                severity: rule.enforcement,
                scope: rule.scope,
                reason: rule.reason,
              },
              roleA: assignmentA.roleCode,
              roleB: assignmentB.roleCode,
              roleCodesA: new Set(),
              roleCodesB: new Set(),
              overlappingScopes: [],
              mitigatingControls: [],
            });
          }
          const conflict = conflictsByKey.get(key);
          conflict.roleCodesA.add(assignmentA.roleCode);
          conflict.roleCodesB.add(assignmentB.roleCode);
          const overlapToken = scopeKey(overlapScope.scopeType, overlapScope.scopeId);
          if (
            overlapToken &&
            !conflict.overlappingScopes.some(
              (scope) => scopeKey(scope.type, scope.id) === overlapToken
            )
          ) {
            conflict.overlappingScopes.push(
              mapScopeWithName(scopeReferences, overlapScope.scopeType, overlapScope.scopeId)
            );
          }
        }
      }
    }
  }
  for (const conflict of conflictsByKey.values()) {
    const mitigationTarget = SOD_RULE_MITIGATION_ACTION_MAP[conflict.conflictRule.code];
    if (!mitigationTarget) {
      continue;
    }
    for (const scope of conflict.overlappingScopes) {
      const relevantCoverage = coverage.groups.find(
        (group) =>
          group.moduleCode === mitigationTarget.moduleCode &&
          group.targetType === mitigationTarget.targetType &&
          group.actionType === mitigationTarget.actionType &&
          group.relevantScopes.some(
            (candidate) =>
              candidate.scopeType === scope.type && candidate.scopeId === scope.id
          )
      );
      if (!relevantCoverage) {
        continue;
      }
      const mitigationLabel = `Approval policy configured for ${mitigationTarget.moduleCode}/${mitigationTarget.targetType}/${mitigationTarget.actionType} at ${formatScopeLabel(
        scopeReferences,
        scope.type,
        scope.id
      )}`;
      if (!conflict.mitigatingControls.includes(mitigationLabel)) {
        conflict.mitigatingControls.push(mitigationLabel);
      }
    }
  }
  const conflicts = Array.from(conflictsByKey.values())
    .map((conflict) => ({
      ...conflict,
      roleCodesA: Array.from(conflict.roleCodesA).filter(Boolean).sort(),
      roleCodesB: Array.from(conflict.roleCodesB).filter(Boolean).sort(),
      mitigatingControls: [...conflict.mitigatingControls],
    }))
    .sort((left, right) => {
      if (left.userName && right.userName && left.userName !== right.userName) {
        return left.userName.localeCompare(right.userName);
      }
      return left.userId - right.userId;
    });
  return {
    reportType: "SOD_ANALYSIS",
    asOfDate,
    conflicts,
    summary: {
      totalUsers: users.length,
      usersWithConflicts: new Set(conflicts.map((conflict) => conflict.userId)).size,
      blockLevelConflicts: conflicts.filter(
        (conflict) => conflict.conflictRule.severity === "block"
      ).length,
      warnLevelConflicts: conflicts.filter(
        (conflict) => conflict.conflictRule.severity === "warn"
      ).length,
      mitigatedConflicts: conflicts.filter((conflict) => conflict.mitigatingControls.length > 0)
        .length,
      unmitigatedConflicts: conflicts.filter(
        (conflict) => conflict.mitigatingControls.length === 0
      ).length,
    },
  };
}
async function buildApprovalCoverageReport(input, options = {}) {
  const { tenantId, asOfDate, scopeFilter } = input;
  const runQuery = typeof options?.runQuery === "function" ? options.runQuery : query;
  const [coverage, scopeReferences] = await Promise.all([
    loadActiveApprovalCoverage(tenantId, asOfDate, scopeFilter, runQuery),
    loadScopeReferences(tenantId, runQuery),
  ]);
  const coveredActions = coverage.groups
    .map((group) => ({
      moduleCode: group.moduleCode,
      targetType: group.targetType,
      actionType: group.actionType,
      policyCount: group.policyCount,
      policies: group.policies.map((policy) => ({
        id: policy.id,
        policyCode: policy.policyCode,
        policyName: policy.policyName,
        versionNo: policy.versionNo,
        minAmount: policy.minAmount,
        maxAmount: policy.maxAmount,
        currencyCode: policy.currencyCode,
        requiredApprovals: policy.minApprovals,
        makerCheckerRequired: policy.makerCheckerRequired,
        autoExecuteOnFinalApproval: policy.autoExecuteOnFinalApproval,
        steps: policy.stepCount,
        approverPermissionCode: policy.approverPermissionCode,
        applicabilityScopes: policy.relevantScopes.map((scope) =>
          mapScopeWithName(scopeReferences, scope.scopeType, scope.scopeId)
        ),
      })),
    }))
    .sort((left, right) => {
      if (left.moduleCode !== right.moduleCode) {
        return left.moduleCode.localeCompare(right.moduleCode);
      }
      if (left.targetType !== right.targetType) {
        return left.targetType.localeCompare(right.targetType);
      }
      return left.actionType.localeCompare(right.actionType);
    });
  const coveredActionKeys = new Set(
    coveredActions.map(
      (action) => `${action.moduleCode}|${action.targetType}|${action.actionType}`
    )
  );
  const uncoveredActions = APPROVAL_COVERAGE_ACTION_CATALOG.filter((entry) => {
    const key = `${entry.moduleCode}|${entry.targetType}|${entry.actionType}`;
    return !coveredActionKeys.has(key);
  }).map((entry) => ({
    moduleCode: entry.moduleCode,
    targetType: entry.targetType,
    actionType: entry.actionType,
    note: entry.uncoveredNote,
  }));
  return {
    reportType: "APPROVAL_COVERAGE",
    asOfDate,
    coveredActions,
    uncoveredActions,
    summary: {
      coveredActionCount: coveredActions.length,
      uncoveredActionCount: uncoveredActions.length,
      policyCount: coverage.policies.length,
    },
  };
}
async function buildDelegationLogReport(input, options = {}) {
  const { tenantId, asOfDate, scopeFilter } = input;
  const runQuery = typeof options?.runQuery === "function" ? options.runQuery : query;
  const [delegations, scopeReferences] = await Promise.all([
    loadDelegations(tenantId, asOfDate, runQuery),
    loadScopeReferences(tenantId, runQuery),
  ]);
  const scopeIntersectionCache = new Map();
  const filteredDelegations = [];
  for (const delegation of delegations) {
    const relevant = await scopesIntersect(
      tenantId,
      {
        scopeType: delegation.scopeType,
        scopeId: delegation.scopeId,
      },
      scopeFilter,
      runQuery,
      scopeIntersectionCache
    );
    if (!relevant) {
      continue;
    }
    filteredDelegations.push(delegation);
  }
  const decisionDetails = await loadDelegationDecisionDetails(
    tenantId,
    asOfDate,
    filteredDelegations.map((delegation) => delegation.id),
    runQuery
  );
  const detailsByDelegationId = new Map();
  for (const detail of decisionDetails) {
    if (!detailsByDelegationId.has(detail.delegationId)) {
      detailsByDelegationId.set(detail.delegationId, []);
    }
    detailsByDelegationId.get(detail.delegationId).push(detail);
  }
  const delegationsReportRows = filteredDelegations.map((delegation) => {
    const details = detailsByDelegationId.get(delegation.id) || [];
    return {
      id: delegation.id,
      delegatorUserId: delegation.delegatorUserId,
      delegatorName: delegation.delegatorUserName,
      delegateUserId: delegation.delegateUserId,
      delegateName: delegation.delegateUserName,
      moduleCode: delegation.moduleCode,
      scopeType: delegation.scopeType,
      scopeId: delegation.scopeId,
      scopeName: resolveScopeName(scopeReferences, delegation.scopeType, delegation.scopeId),
      effectiveFrom: delegation.effectiveFrom,
      effectiveTo: delegation.effectiveTo,
      reason: delegation.note,
      status: delegation.state,
      revokedAt: delegation.revokedAt,
      revokedReason: delegation.revokedReason,
      decisionsActedOn: details.length,
      decisionDetails: details,
    };
  });
  return {
    reportType: "DELEGATION_LOG",
    asOfDate,
    delegations: delegationsReportRows,
    summary: {
      totalDelegations: delegationsReportRows.length,
      activeDelegations: delegationsReportRows.filter((row) => row.status === "ACTIVE").length,
      revokedDelegations: delegationsReportRows.filter((row) => row.status === "REVOKED").length,
      expiredDelegations: delegationsReportRows.filter((row) => row.status === "EXPIRED").length,
      delegatedDecisionCount: delegationsReportRows.reduce(
        (total, row) => total + row.decisionsActedOn,
        0
      ),
    },
  };
}
function flattenAccessMatrixCsvRows(report) {
  const rows = [];
  for (const entry of report.matrix || []) {
    const roleSummary = (entry.roles || [])
      .map((role) => `${role.roleCode}@${role.scopeType}:${role.scopeId}`)
      .join("; ");
    const dataScopeSummary = (entry.dataScopes || [])
      .map((scope) => `${scope.scopeType}:${scope.scopeId}:${scope.effect}`)
      .join("; ");
    const delegationSummary = (entry.activeDelegations || [])
      .map(
        (delegation) =>
          `${delegation.relation}:${delegation.counterpartyName || delegation.counterpartyUserId}@${delegation.scopeType}:${delegation.scopeId}`
      )
      .join("; ");
    if ((entry.effectivePermissions || []).length === 0) {
      rows.push({
        tenantId: null,
        asOfDate: report.asOfDate,
        userId: entry.userId,
        userName: entry.userName,
        email: entry.email,
        permissionCode: "",
        permissionScopeType: "",
        permissionScopeId: "",
        permissionScopeName: "",
        assignedRoles: roleSummary,
        dataScopes: dataScopeSummary,
        activeDelegations: delegationSummary,
      });
      continue;
    }
    for (const permission of entry.effectivePermissions || []) {
      for (const scope of permission.scopes || []) {
        rows.push({
          tenantId: null,
          asOfDate: report.asOfDate,
          userId: entry.userId,
          userName: entry.userName,
          email: entry.email,
          permissionCode: permission.code,
          permissionScopeType: scope.type,
          permissionScopeId: scope.id,
          permissionScopeName: scope.name,
          assignedRoles: roleSummary,
          dataScopes: dataScopeSummary,
          activeDelegations: delegationSummary,
        });
      }
    }
  }
  return rows;
}
function flattenSodCsvRows(report, scopeReferences) {
  return (report.conflicts || []).map((conflict) => ({
    asOfDate: report.asOfDate,
    userId: conflict.userId,
    userName: conflict.userName,
    email: conflict.email,
    ruleCode: conflict.conflictRule.code,
    actionA: conflict.conflictRule.actionA,
    actionB: conflict.conflictRule.actionB,
    severity: conflict.conflictRule.severity,
    roleCodesA: (conflict.roleCodesA || []).join("; "),
    roleCodesB: (conflict.roleCodesB || []).join("; "),
    overlappingScopes: (conflict.overlappingScopes || [])
      .map((scope) => formatScopeLabel(scopeReferences, scope.type, scope.id))
      .join("; "),
    mitigatingControls: (conflict.mitigatingControls || []).join("; "),
  }));
}
function flattenApprovalCoverageCsvRows(report, scopeReferences) {
  const rows = [];
  for (const coveredAction of report.coveredActions || []) {
    for (const policy of coveredAction.policies || []) {
      rows.push({
        asOfDate: report.asOfDate,
        coverageStatus: "COVERED",
        moduleCode: coveredAction.moduleCode,
        targetType: coveredAction.targetType,
        actionType: coveredAction.actionType,
        policyId: policy.id,
        policyCode: policy.policyCode,
        requiredApprovals: policy.requiredApprovals,
        steps: policy.steps,
        makerCheckerRequired: policy.makerCheckerRequired ? "true" : "false",
        applicabilityScopes: (policy.applicabilityScopes || [])
          .map((scope) => formatScopeLabel(scopeReferences, scope.type, scope.id))
          .join("; "),
        note: "",
      });
    }
  }
  for (const uncoveredAction of report.uncoveredActions || []) {
    rows.push({
      asOfDate: report.asOfDate,
      coverageStatus: "UNCOVERED",
      moduleCode: uncoveredAction.moduleCode,
      targetType: uncoveredAction.targetType,
      actionType: uncoveredAction.actionType,
      policyId: "",
      policyCode: "",
      requiredApprovals: "",
      steps: "",
      makerCheckerRequired: "",
      applicabilityScopes: "",
      note: uncoveredAction.note,
    });
  }
  return rows;
}
function flattenDelegationLogCsvRows(report, scopeReferences) {
  const rows = [];
  for (const delegation of report.delegations || []) {
    const decisionDetails = Array.isArray(delegation.decisionDetails)
      ? delegation.decisionDetails
      : [];
    if (decisionDetails.length === 0) {
      rows.push({
        asOfDate: report.asOfDate,
        delegationId: delegation.id,
        delegatorName: delegation.delegatorName,
        delegateName: delegation.delegateName,
        moduleCode: delegation.moduleCode,
        scope: formatScopeLabel(scopeReferences, delegation.scopeType, delegation.scopeId),
        effectiveFrom: delegation.effectiveFrom,
        effectiveTo: delegation.effectiveTo,
        status: delegation.status,
        reason: delegation.reason,
        requestId: "",
        requestCode: "",
        decisionAction: "",
        decisionModule: "",
        decidedAt: "",
      });
      continue;
    }
    for (const detail of decisionDetails) {
      rows.push({
        asOfDate: report.asOfDate,
        delegationId: delegation.id,
        delegatorName: delegation.delegatorName,
        delegateName: delegation.delegateName,
        moduleCode: delegation.moduleCode,
        scope: formatScopeLabel(scopeReferences, delegation.scopeType, delegation.scopeId),
        effectiveFrom: delegation.effectiveFrom,
        effectiveTo: delegation.effectiveTo,
        status: delegation.status,
        reason: delegation.reason,
        requestId: detail.requestId,
        requestCode: detail.requestCode,
        decisionAction: detail.action,
        decisionModule: detail.moduleCode,
        decidedAt: detail.decidedAt,
      });
    }
  }
  return rows;
}
function buildCsvPayload(report, scopeReferences, tenantId) {
  if (report.reportType === "ACCESS_MATRIX") {
    const rows = flattenAccessMatrixCsvRows(report);
    const csv = buildCsv(
      [
        { header: "as_of_date", value: (row) => row.asOfDate },
        { header: "user_id", value: (row) => row.userId },
        { header: "user_name", value: (row) => row.userName },
        { header: "email", value: (row) => row.email },
        { header: "permission_code", value: (row) => row.permissionCode },
        { header: "permission_scope_type", value: (row) => row.permissionScopeType },
        { header: "permission_scope_id", value: (row) => row.permissionScopeId },
        { header: "permission_scope_name", value: (row) => row.permissionScopeName },
        { header: "assigned_roles", value: (row) => row.assignedRoles },
        { header: "data_scopes", value: (row) => row.dataScopes },
        { header: "active_delegations", value: (row) => row.activeDelegations },
      ],
      rows
    );
    return {
      csv,
      fileName: `rbac-access-matrix-${tenantId}-${report.asOfDate}.csv`,
      rowCount: rows.length,
    };
  }
  if (report.reportType === "SOD_ANALYSIS") {
    const rows = flattenSodCsvRows(report, scopeReferences);
    const csv = buildCsv(
      [
        { header: "as_of_date", value: (row) => row.asOfDate },
        { header: "user_id", value: (row) => row.userId },
        { header: "user_name", value: (row) => row.userName },
        { header: "email", value: (row) => row.email },
        { header: "rule_code", value: (row) => row.ruleCode },
        { header: "action_a", value: (row) => row.actionA },
        { header: "action_b", value: (row) => row.actionB },
        { header: "severity", value: (row) => row.severity },
        { header: "role_codes_a", value: (row) => row.roleCodesA },
        { header: "role_codes_b", value: (row) => row.roleCodesB },
        { header: "overlapping_scopes", value: (row) => row.overlappingScopes },
        { header: "mitigating_controls", value: (row) => row.mitigatingControls },
      ],
      rows
    );
    return {
      csv,
      fileName: `rbac-sod-analysis-${tenantId}-${report.asOfDate}.csv`,
      rowCount: rows.length,
    };
  }
  if (report.reportType === "APPROVAL_COVERAGE") {
    const rows = flattenApprovalCoverageCsvRows(report, scopeReferences);
    const csv = buildCsv(
      [
        { header: "as_of_date", value: (row) => row.asOfDate },
        { header: "coverage_status", value: (row) => row.coverageStatus },
        { header: "module_code", value: (row) => row.moduleCode },
        { header: "target_type", value: (row) => row.targetType },
        { header: "action_type", value: (row) => row.actionType },
        { header: "policy_id", value: (row) => row.policyId },
        { header: "policy_code", value: (row) => row.policyCode },
        { header: "required_approvals", value: (row) => row.requiredApprovals },
        { header: "steps", value: (row) => row.steps },
        { header: "maker_checker_required", value: (row) => row.makerCheckerRequired },
        { header: "applicability_scopes", value: (row) => row.applicabilityScopes },
        { header: "note", value: (row) => row.note },
      ],
      rows
    );
    return {
      csv,
      fileName: `rbac-approval-coverage-${tenantId}-${report.asOfDate}.csv`,
      rowCount: rows.length,
    };
  }
  if (report.reportType === "DELEGATION_LOG") {
    const rows = flattenDelegationLogCsvRows(report, scopeReferences);
    const csv = buildCsv(
      [
        { header: "as_of_date", value: (row) => row.asOfDate },
        { header: "delegation_id", value: (row) => row.delegationId },
        { header: "delegator_name", value: (row) => row.delegatorName },
        { header: "delegate_name", value: (row) => row.delegateName },
        { header: "module_code", value: (row) => row.moduleCode },
        { header: "scope", value: (row) => row.scope },
        { header: "effective_from", value: (row) => row.effectiveFrom },
        { header: "effective_to", value: (row) => row.effectiveTo },
        { header: "status", value: (row) => row.status },
        { header: "reason", value: (row) => row.reason },
        { header: "request_id", value: (row) => row.requestId },
        { header: "request_code", value: (row) => row.requestCode },
        { header: "decision_action", value: (row) => row.decisionAction },
        { header: "decision_module", value: (row) => row.decisionModule },
        { header: "decided_at", value: (row) => row.decidedAt },
      ],
      rows
    );
    return {
      csv,
      fileName: `rbac-delegation-log-${tenantId}-${report.asOfDate}.csv`,
      rowCount: rows.length,
    };
}
throw badRequest("CSV export is only supported for individual report families");
}

/**
 * Build one point-in-time compliance audit report from the current RBAC,
 * approval, and delegation seams without duplicating entitlement logic.
 */
export async function buildComplianceAuditReport(input, options = {}) {
  const normalizedInput = normalizeScopeFilter(input);
  const runQuery = typeof options?.runQuery === "function" ? options.runQuery : query;
  const reportBuilders = {
    ACCESS_MATRIX: buildAccessMatrixReport,
    SOD_ANALYSIS: buildSodAnalysisReport,
    APPROVAL_COVERAGE: buildApprovalCoverageReport,
    DELEGATION_LOG: buildDelegationLogReport,
  };
  if (normalizedInput.reportType === "FULL") {
    const [accessMatrix, sodAnalysis, approvalCoverage, delegationLog] = await Promise.all([
      buildAccessMatrixReport(normalizedInput, { runQuery }),
      buildSodAnalysisReport(normalizedInput, { runQuery }),
      buildApprovalCoverageReport(normalizedInput, { runQuery }),
      buildDelegationLogReport(normalizedInput, { runQuery }),
    ]);
    return {
      tenantId: normalizedInput.tenantId,
      reportType: "FULL",
      asOfDate: normalizedInput.asOfDate,
      generatedAt: new Date().toISOString(),
      scopeFilter: normalizedInput.scopeFilter,
      reports: {
        accessMatrix,
        sodAnalysis,
        approvalCoverage,
        delegationLog,
      },
    };
  }
  const report = await reportBuilders[normalizedInput.reportType](normalizedInput, {
    runQuery,
  });
  return {
    tenantId: normalizedInput.tenantId,
    reportType: normalizedInput.reportType,
    asOfDate: normalizedInput.asOfDate,
    generatedAt: new Date().toISOString(),
    scopeFilter: normalizedInput.scopeFilter,
    report,
  };
}

/**
 * Build one CSV export for an individual compliance audit report family.
 */
export async function buildComplianceAuditReportCsv(input, options = {}) {
  const normalizedInput = normalizeScopeFilter({
    ...input,
    format: "CSV",
  });
  if (normalizedInput.reportType === "FULL") {
    throw badRequest("CSV export is only supported for a single reportType, not FULL");
  }
  const runQuery = typeof options?.runQuery === "function" ? options.runQuery : query;
  const [wrappedReport, scopeReferences] = await Promise.all([
    buildComplianceAuditReport(normalizedInput, { runQuery }),
    loadScopeReferences(normalizedInput.tenantId, runQuery),
  ]);
  return buildCsvPayload(
    wrappedReport.report,
    scopeReferences,
    normalizedInput.tenantId
  );
}
export default {
  buildComplianceAuditReport,
  buildComplianceAuditReportCsv,
};
