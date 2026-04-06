import { query } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";

export const APPROVAL_POLICY_SCOPE_TYPES = Object.freeze([
  "TENANT",
  "GROUP",
  "COUNTRY",
  "LEGAL_ENTITY",
  "OPERATING_UNIT",
]);

function normalizeScopeType(rawValue, label) {
  const normalized = String(rawValue || "")
    .trim()
    .toUpperCase();
  if (!APPROVAL_POLICY_SCOPE_TYPES.includes(normalized)) {
    throw badRequest(`${label} scopeType is invalid`);
  }
  return normalized;
}

function normalizePermissionCode(rawValue, label) {
  const normalized = String(rawValue || "").trim();
  if (!normalized) {
    throw badRequest(`${label} requiredPermissionCode is required`);
  }
  if (normalized.length > 120) {
    throw badRequest(`${label} requiredPermissionCode cannot exceed 120 characters`);
  }
  return normalized;
}

function normalizeScopeLike(input, label, { allowNull = false } = {}) {
  const scopeTypeRaw = input?.scopeType ?? input?.scope_type ?? null;
  const scopeIdRaw = input?.scopeId ?? input?.scope_id ?? null;

  if (
    (scopeTypeRaw === undefined || scopeTypeRaw === null || scopeTypeRaw === "") &&
    (scopeIdRaw === undefined || scopeIdRaw === null || scopeIdRaw === "")
  ) {
    if (allowNull) {
      return null;
    }
    throw badRequest(`${label} scopeType and scopeId are required`);
  }

  const scopeType = normalizeScopeType(scopeTypeRaw, label);
  const scopeId = parsePositiveInt(scopeIdRaw);
  if (!scopeId) {
    throw badRequest(`${label} scopeId must be a positive integer`);
  }

  return { scopeType, scopeId };
}

async function resolveScopeLineage({ tenantId, scope, runQuery = query }) {
  if (!scope) {
    return null;
  }

  if (scope.scopeType === "TENANT") {
    if (scope.scopeId !== tenantId) {
      throw badRequest("TENANT scopeId must match tenantId");
    }
    return {
      scopeType: "TENANT",
      scopeId: tenantId,
      groupId: null,
      countryId: null,
      legalEntityId: null,
      operatingUnitId: null,
    };
  }

  if (scope.scopeType === "GROUP") {
    const res = await runQuery(
      `SELECT id
       FROM group_companies
       WHERE tenant_id = ?
         AND id = ?
       LIMIT 1`,
      [tenantId, scope.scopeId]
    );
    if (!res.rows?.[0]) {
      throw badRequest("Approval policy group scope was not found");
    }
    return {
      scopeType: "GROUP",
      scopeId: scope.scopeId,
      groupId: scope.scopeId,
      countryId: null,
      legalEntityId: null,
      operatingUnitId: null,
    };
  }

  if (scope.scopeType === "COUNTRY") {
    const res = await runQuery(
      `SELECT id
       FROM countries
       WHERE id = ?
       LIMIT 1`,
      [scope.scopeId]
    );
    if (!res.rows?.[0]) {
      throw badRequest("Approval policy country scope was not found");
    }
    return {
      scopeType: "COUNTRY",
      scopeId: scope.scopeId,
      groupId: null,
      countryId: scope.scopeId,
      legalEntityId: null,
      operatingUnitId: null,
    };
  }

  if (scope.scopeType === "LEGAL_ENTITY") {
    const res = await runQuery(
      `SELECT id, group_company_id, country_id
       FROM legal_entities
       WHERE tenant_id = ?
         AND id = ?
       LIMIT 1`,
      [tenantId, scope.scopeId]
    );
    const row = res.rows?.[0];
    if (!row) {
      throw badRequest("Approval policy legalEntity scope was not found");
    }
    return {
      scopeType: "LEGAL_ENTITY",
      scopeId: scope.scopeId,
      groupId: parsePositiveInt(row.group_company_id),
      countryId: parsePositiveInt(row.country_id),
      legalEntityId: parsePositiveInt(row.id),
      operatingUnitId: null,
    };
  }

  const res = await runQuery(
    `SELECT ou.id, ou.legal_entity_id, le.group_company_id, le.country_id
     FROM operating_units ou
     JOIN legal_entities le
       ON le.tenant_id = ou.tenant_id
      AND le.id = ou.legal_entity_id
     WHERE ou.tenant_id = ?
       AND ou.id = ?
     LIMIT 1`,
    [tenantId, scope.scopeId]
  );
  const row = res.rows?.[0];
  if (!row) {
    throw badRequest("Approval policy operatingUnit scope was not found");
  }
  return {
    scopeType: "OPERATING_UNIT",
    scopeId: scope.scopeId,
    groupId: parsePositiveInt(row.group_company_id),
    countryId: parsePositiveInt(row.country_id),
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    operatingUnitId: parsePositiveInt(row.id),
  };
}

function assignmentFitsPolicyScope(policyLineage, assignmentLineage) {
  if (!policyLineage) {
    return true;
  }

  if (policyLineage.scopeType === "TENANT") {
    return true;
  }

  if (policyLineage.scopeType === "GROUP") {
    return (
      ["GROUP", "LEGAL_ENTITY", "OPERATING_UNIT"].includes(assignmentLineage.scopeType) &&
      assignmentLineage.groupId === policyLineage.scopeId
    );
  }

  if (policyLineage.scopeType === "COUNTRY") {
    return (
      ["COUNTRY", "LEGAL_ENTITY", "OPERATING_UNIT"].includes(assignmentLineage.scopeType) &&
      assignmentLineage.countryId === policyLineage.scopeId
    );
  }

  if (policyLineage.scopeType === "LEGAL_ENTITY") {
    return (
      ["LEGAL_ENTITY", "OPERATING_UNIT"].includes(assignmentLineage.scopeType) &&
      assignmentLineage.legalEntityId === policyLineage.scopeId
    );
  }

  return (
    assignmentLineage.scopeType === "OPERATING_UNIT" &&
    assignmentLineage.operatingUnitId === policyLineage.scopeId
  );
}

function normalizeStep(step, index) {
  const label = `approvalPolicySteps[${index}]`;
  const stepNo = parsePositiveInt(step?.stepNo ?? step?.step_no);
  if (!stepNo) {
    throw badRequest(`${label} stepNo must be a positive integer`);
  }

  const minApprovalsRaw = step?.minApprovals ?? step?.min_approvals ?? 1;
  const minApprovals = parsePositiveInt(minApprovalsRaw);
  if (!minApprovals) {
    throw badRequest(`${label} minApprovals must be a positive integer`);
  }

  const scopeResolutionMode = String(
    step?.scopeResolutionMode ?? step?.scope_resolution_mode ?? "REQUEST_SCOPE"
  )
    .trim()
    .toUpperCase();
  if (
    ![
      "REQUEST_SCOPE",
      "POLICY_SCOPE",
      "TARGET_GROUP",
      "TARGET_COUNTRY",
      "TARGET_LEGAL_ENTITY",
      "TARGET_OPERATING_UNIT",
      "CUSTOM",
    ].includes(scopeResolutionMode)
  ) {
    throw badRequest(`${label} scopeResolutionMode is invalid`);
  }

  const customScopeResolverKey = String(
    step?.customScopeResolverKey ?? step?.custom_scope_resolver_key ?? ""
  ).trim();
  if (scopeResolutionMode === "CUSTOM" && !customScopeResolverKey) {
    throw badRequest(`${label} customScopeResolverKey is required for CUSTOM mode`);
  }
  if (scopeResolutionMode !== "CUSTOM" && customScopeResolverKey) {
    throw badRequest(`${label} customScopeResolverKey is only valid for CUSTOM mode`);
  }

  const escalationAfterHoursRaw =
    step?.escalationAfterHours ?? step?.escalation_after_hours ?? null;
  const escalationAfterHours =
    escalationAfterHoursRaw === undefined ||
    escalationAfterHoursRaw === null ||
    escalationAfterHoursRaw === ""
      ? null
      : parsePositiveInt(escalationAfterHoursRaw);
  if (escalationAfterHoursRaw !== null && escalationAfterHoursRaw !== undefined && escalationAfterHoursRaw !== "" && !escalationAfterHours) {
    throw badRequest(`${label} escalationAfterHours must be a positive integer`);
  }

  const escalationTargetScopeModeRaw =
    step?.escalationTargetScopeMode ?? step?.escalation_target_scope_mode ?? null;
  const escalationTargetScopeMode =
    escalationTargetScopeModeRaw === undefined ||
    escalationTargetScopeModeRaw === null ||
    escalationTargetScopeModeRaw === ""
      ? null
      : String(escalationTargetScopeModeRaw).trim().toUpperCase();
  if (
    escalationTargetScopeMode &&
    ![
      "REQUEST_SCOPE",
      "POLICY_SCOPE",
      "TARGET_GROUP",
      "TARGET_COUNTRY",
      "TARGET_LEGAL_ENTITY",
      "TARGET_OPERATING_UNIT",
      "CUSTOM",
    ].includes(escalationTargetScopeMode)
  ) {
    throw badRequest(`${label} escalationTargetScopeMode is invalid`);
  }
  if (escalationTargetScopeMode === "CUSTOM" && !customScopeResolverKey) {
    throw badRequest(
      `${label} escalationTargetScopeMode CUSTOM requires customScopeResolverKey`
    );
  }

  const escalationMaxCountRaw =
    step?.escalationMaxCount ?? step?.escalation_max_count ?? null;
  const escalationMaxCount =
    escalationMaxCountRaw === undefined ||
    escalationMaxCountRaw === null ||
    escalationMaxCountRaw === ""
      ? null
      : parsePositiveInt(escalationMaxCountRaw);
  if (escalationMaxCountRaw !== null && escalationMaxCountRaw !== undefined && escalationMaxCountRaw !== "" && !escalationMaxCount) {
    throw badRequest(`${label} escalationMaxCount must be a positive integer`);
  }

  return {
    stepNo,
    requiredPermissionCode: normalizePermissionCode(step?.requiredPermissionCode ?? step?.required_permission_code, label),
    scopeResolutionMode,
    customScopeResolverKey: customScopeResolverKey || null,
    minApprovals,
    allowSelfApprove:
      step?.allowSelfApprove ?? step?.allow_self_approve ?? true,
    escalationAfterHours,
    escalationTargetScopeMode,
    escalationMaxCount,
  };
}

/**
 * Normalize one optional approval policy bound scope.
 */
export function normalizeApprovalPolicyScope(scope) {
  return normalizeScopeLike(scope, "approvalPolicy", { allowNull: true });
}

/**
 * Normalize one required approval policy assignment scope.
 */
export function normalizeApprovalPolicyAssignmentScope(scope) {
  return normalizeScopeLike(scope, "approvalPolicyAssignment");
}

/**
 * Check whether one concrete approval scope fits inside a broader bound.
 *
 * The first scope is treated as the bound/parent scope. The second scope is
 * treated as the requested or assigned child scope.
 */
export async function isApprovalScopeWithinBound({
  tenantId,
  boundScope,
  childScope,
  runQuery = query,
}) {
  const normalizedBoundScope = normalizeApprovalPolicyScope(boundScope);
  const normalizedChildScope = normalizeApprovalPolicyAssignmentScope(childScope);
  const boundLineage = await resolveScopeLineage({
    tenantId,
    scope: normalizedBoundScope,
    runQuery,
  });
  const childLineage = await resolveScopeLineage({
    tenantId,
    scope: normalizedChildScope,
    runQuery,
  });
  return assignmentFitsPolicyScope(boundLineage, childLineage);
}

/**
 * Assert that an assignment scope stays within the policy's declared bound.
 *
 * This is the intended generic policy create/update validation seam for the
 * "assignment may narrow but not broaden" rule from roadmap 55.
 */
export async function assertApprovalAssignmentNarrowsPolicyScope({
  tenantId,
  policyScope,
  assignmentScope,
  runQuery = query,
}) {
  const normalizedPolicyScope = normalizeApprovalPolicyScope(policyScope);
  const normalizedAssignmentScope = normalizeApprovalPolicyAssignmentScope(assignmentScope);
  const isWithinBound = await isApprovalScopeWithinBound({
    tenantId,
    boundScope: normalizedPolicyScope,
    childScope: normalizedAssignmentScope,
    runQuery,
  });

  if (!isWithinBound) {
    throw badRequest(
      "Approval policy assignment scope must narrow or match the policy scope; broader or cross-axis assignments are not allowed."
    );
  }

  return {
    policyScope: normalizedPolicyScope,
    assignmentScope: normalizedAssignmentScope,
  };
}

/**
 * Validate a generic approval policy draft before persistence.
 *
 * This stays separate from the existing bank/workflow runtime services in
 * PR-3A so the new generic schema lands in parallel rather than silently
 * rewriting current approval behavior.
 */
export async function validateApprovalPolicyDraft({
  tenantId,
  policy = {},
  assignments = [],
  steps = [],
  runQuery = query,
}) {
  const normalizedPolicyScope = normalizeApprovalPolicyScope(policy);
  const normalizedAssignments = [];
  for (const assignment of assignments || []) {
    const result = await assertApprovalAssignmentNarrowsPolicyScope({
      tenantId,
      policyScope: normalizedPolicyScope,
      assignmentScope: assignment,
      runQuery,
    });
    normalizedAssignments.push(result.assignmentScope);
  }

  const stepSet = new Set();
  const normalizedSteps = (steps || []).map((step, index) => normalizeStep(step, index));
  for (const step of normalizedSteps) {
    if (stepSet.has(step.stepNo)) {
      throw badRequest("approvalPolicySteps stepNo values must be unique");
    }
    stepSet.add(step.stepNo);
  }

  const declaredStepCount = parsePositiveInt(policy?.stepCount ?? policy?.step_count ?? null);
  if (declaredStepCount && normalizedSteps.length > 0 && declaredStepCount !== normalizedSteps.length) {
    throw badRequest("approvalPolicy stepCount must match the supplied approvalPolicySteps length");
  }

  const declaredMinApprovals = parsePositiveInt(
    policy?.minApprovals ?? policy?.min_approvals ?? 1
  );
  if (!declaredMinApprovals) {
    throw badRequest("approvalPolicy minApprovals must be a positive integer");
  }

  return {
    policyScope: normalizedPolicyScope,
    assignments: normalizedAssignments,
    steps: normalizedSteps,
    minApprovals: declaredMinApprovals,
    stepCount: declaredStepCount || normalizedSteps.length || 1,
  };
}

export default {
  APPROVAL_POLICY_SCOPE_TYPES,
  normalizeApprovalPolicyScope,
  normalizeApprovalPolicyAssignmentScope,
  isApprovalScopeWithinBound,
  assertApprovalAssignmentNarrowsPolicyScope,
  validateApprovalPolicyDraft,
};
