import crypto from "node:crypto";
import { query, withTransaction } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import {
  checkUserHasPermissionAtScope,
  findUsersWithPermissionAtScope,
  resolveRowScope,
} from "./authz.scope.service.js";
import {
  isApprovalScopeWithinBound,
  normalizeApprovalPolicyAssignmentScope,
} from "./approval.policy.validation.service.js";
import { resolveApprovalDelegation } from "./approval.delegation.service.js";
import { assertSoD } from "./sod.service.js";

const executionResolvers = new Map();

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function toUpper(value) {
  return String(value || "").trim().toUpperCase();
}

function toAmount(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(6)) : null;
}

function toDbBoolean(value) {
  return value === true || value === 1 || value === "1";
}

function safeJson(value) {
  return JSON.stringify(value ?? null);
}

function parseJson(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function notFound(message) {
  const err = new Error(message);
  err.status = 404;
  return err;
}

function conflict(message) {
  const err = new Error(message);
  err.status = 409;
  return err;
}

function forbidden(message) {
  const err = new Error(message);
  err.status = 403;
  return err;
}

function isDuplicateKeyError(err) {
  return Number(err?.errno) === 1062 || toUpper(err?.code) === "ER_DUP_ENTRY";
}

function randomRequestCode() {
  return `APR-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

function parseDateOnly(value) {
  if (!value) return null;
  const dateOnlyMatch = String(value).match(/\d{4}-\d{2}-\d{2}/);
  if (dateOnlyMatch) return dateOnlyMatch[0];
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function scopeRank(scopeType) {
  if (scopeType === "OPERATING_UNIT") return 5;
  if (scopeType === "LEGAL_ENTITY") return 4;
  if (scopeType === "COUNTRY") return 3;
  if (scopeType === "GROUP") return 2;
  if (scopeType === "TENANT") return 1;
  return 0;
}

function mapPolicyRow(row) {
  if (!row) return null;
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    moduleCode: toUpper(row.module_code),
    policyCode: String(row.policy_code || ""),
    policyName: String(row.policy_name || ""),
    targetType: toUpper(row.target_type),
    actionType: toUpper(row.action_type),
    versionNo: Number(row.version_no || 1),
    scopeType: row.scope_type ? toUpper(row.scope_type) : null,
    scopeId: parsePositiveInt(row.scope_id),
    effectiveFrom: parseDateOnly(row.effective_from),
    effectiveTo: parseDateOnly(row.effective_to),
    stepCount: Number(row.step_count || 1),
    minApprovals: Number(row.min_approvals || 1),
    makerCheckerRequired: toDbBoolean(row.maker_checker_required),
    allowSelfApprove: toDbBoolean(row.allow_self_approve),
    autoExecuteOnFinalApproval: toDbBoolean(row.auto_execute_on_final_approval),
    escalationAfterHours: parsePositiveInt(row.escalation_after_hours),
    minAmount: toAmount(row.min_amount),
    maxAmount: toAmount(row.max_amount),
    currencyCode: toUpper(row.currency_code || "") || null,
    approverPermissionCode: String(row.approver_permission_code || "").trim(),
    isActive: toDbBoolean(row.is_active),
    createdByUserId: parsePositiveInt(row.created_by_user_id),
    updatedByUserId: parsePositiveInt(row.updated_by_user_id),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function mapAssignmentRow(row) {
  if (!row) return null;
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    policyId: parsePositiveInt(row.policy_id),
    scopeType: toUpper(row.scope_type),
    scopeId: parsePositiveInt(row.scope_id),
    effectiveFrom: parseDateOnly(row.effective_from),
    effectiveTo: parseDateOnly(row.effective_to),
    isActive: toDbBoolean(row.is_active),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function mapStepRow(row) {
  if (!row) return null;
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    policyId: parsePositiveInt(row.policy_id),
    stepNo: Number(row.step_no || 1),
    requiredPermissionCode: String(row.required_permission_code || "").trim(),
    scopeResolutionMode: toUpper(row.scope_resolution_mode || "REQUEST_SCOPE"),
    customScopeResolverKey: row.custom_scope_resolver_key || null,
    minApprovals: Number(row.min_approvals || 1),
    allowSelfApprove: toDbBoolean(row.allow_self_approve),
    escalationAfterHours: parsePositiveInt(row.escalation_after_hours),
    escalationTargetScopeMode: row.escalation_target_scope_mode
      ? toUpper(row.escalation_target_scope_mode)
      : null,
    escalationMaxCount: parsePositiveInt(row.escalation_max_count),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function mapRequestRow(row) {
  if (!row) return null;
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    requestCode: String(row.request_code || ""),
    idempotencyKey: row.idempotency_key || null,
    policyId: parsePositiveInt(row.policy_id),
    policyVersionNo: Number(row.policy_version_no || 1),
    moduleCode: toUpper(row.module_code),
    targetType: toUpper(row.target_type),
    targetId: parsePositiveInt(row.target_id),
    scopeType: toUpper(row.scope_type),
    scopeId: parsePositiveInt(row.scope_id),
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    operatingUnitId: parsePositiveInt(row.operating_unit_id),
    requestStatus: toUpper(row.request_status),
    currentStepNo: Number(row.current_step_no || 1),
    executionStatus: toUpper(row.execution_status),
    submittedByUserId: parsePositiveInt(row.submitted_by_user_id),
    submittedAt: row.submitted_at || null,
    approvedAt: row.approved_at || null,
    rejectedAt: row.rejected_at || null,
    withdrawnAt: row.withdrawn_at || null,
    executedAt: row.executed_at || null,
    executedByUserId: parsePositiveInt(row.executed_by_user_id),
    lastActivityAt: row.last_activity_at || null,
    policySnapshot: parseJson(row.policy_snapshot_json, {}),
    targetSnapshot: parseJson(row.target_snapshot_json, null),
    actionPayload: parseJson(row.action_payload_json, null),
    executionResult: parseJson(row.execution_result_json, null),
    executionErrorText: row.execution_error_text || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function mapDecisionRow(row) {
  if (!row) return null;
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    requestId: parsePositiveInt(row.request_id),
    stepNo: Number(row.step_no || 1),
    decision: toUpper(row.decision),
    decidedByUserId: parsePositiveInt(row.decided_by_user_id),
    actingUserId: parsePositiveInt(row.acting_user_id),
    delegatorUserId: parsePositiveInt(row.delegator_user_id),
    delegationId: parsePositiveInt(row.delegation_id),
    reviewerAuthorityUserId: parsePositiveInt(row.reviewer_authority_user_id),
    comment: row.comment || null,
    decidedAt: row.decided_at || null,
  };
}

function getDecisionActingUserId(decisionRow) {
  return (
    parsePositiveInt(decisionRow?.actingUserId) ||
    parsePositiveInt(decisionRow?.acting_user_id) ||
    parsePositiveInt(decisionRow?.decidedByUserId) ||
    parsePositiveInt(decisionRow?.decided_by_user_id)
  );
}

function getDecisionAuthorityUserId(decisionRow) {
  return (
    parsePositiveInt(decisionRow?.reviewerAuthorityUserId) ||
    parsePositiveInt(decisionRow?.reviewer_authority_user_id) ||
    parsePositiveInt(decisionRow?.delegatorUserId) ||
    parsePositiveInt(decisionRow?.delegator_user_id) ||
    getDecisionActingUserId(decisionRow)
  );
}

function assertRequesterNotDecisionActor({
  requestRow,
  actorUserId,
  normalizedDecision,
  allowSelfApprove,
  label,
}) {
  if (
    requestRow.policySnapshot?.maker_checker_required &&
    parsePositiveInt(requestRow.submittedByUserId) === actorUserId
  ) {
    throw forbidden(`Maker-checker violation: ${label} cannot approve own request`);
  }

  if (
    normalizedDecision === "APPROVE" &&
    !allowSelfApprove &&
    parsePositiveInt(requestRow.submittedByUserId) === actorUserId
  ) {
    throw forbidden(`Step self-approval is not allowed for the ${label}`);
  }
}

function policyMatchesAmount(policy, amount) {
  const thresholdAmount = toAmount(amount);
  if (policy.minAmount === null && policy.maxAmount === null) return true;
  if (thresholdAmount === null) return false;
  if (policy.minAmount !== null && thresholdAmount < policy.minAmount) return false;
  if (policy.maxAmount !== null && thresholdAmount > policy.maxAmount) return false;
  return true;
}

function policyMatchesCurrency(policy, currencyCode) {
  if (!policy.currencyCode) return true;
  return policy.currencyCode === toUpper(currencyCode);
}

function fitsEffectiveWindow(startDate, endDate, effectiveOn) {
  if (startDate && effectiveOn < startDate) return false;
  if (endDate && effectiveOn > endDate) return false;
  return true;
}

async function getApprovalPolicyById(policyId, runQuery = query) {
  const normalizedPolicyId = parsePositiveInt(policyId);
  if (!normalizedPolicyId) return null;
  const res = await runQuery(
    `SELECT *
     FROM approval_policies
     WHERE id = ?
     LIMIT 1`,
    [normalizedPolicyId]
  );
  return mapPolicyRow(res.rows?.[0] || null);
}

async function listApprovalPolicyAssignments(policyId, runQuery = query) {
  const res = await runQuery(
    `SELECT *
     FROM approval_policy_assignments
     WHERE policy_id = ?
     ORDER BY id ASC`,
    [policyId]
  );
  return (res.rows || []).map(mapAssignmentRow);
}

async function listApprovalPolicySteps(policyId, runQuery = query) {
  const res = await runQuery(
    `SELECT *
     FROM approval_policy_steps
     WHERE policy_id = ?
     ORDER BY step_no ASC, id ASC`,
    [policyId]
  );
  return (res.rows || []).map(mapStepRow);
}

async function getApprovalRequestRowById(requestId, runQuery = query, { forUpdate = false } = {}) {
  const normalizedRequestId = parsePositiveInt(requestId);
  if (!normalizedRequestId) return null;
  const res = await runQuery(
    `SELECT *
     FROM approval_requests
     WHERE id = ?
     LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [normalizedRequestId]
  );
  return mapRequestRow(res.rows?.[0] || null);
}

async function getApprovalRequestByIdempotencyKey(tenantId, idempotencyKey, runQuery = query) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedKey = String(idempotencyKey || "").trim();
  if (!normalizedTenantId || !normalizedKey) return null;
  const res = await runQuery(
    `SELECT *
     FROM approval_requests
     WHERE tenant_id = ?
       AND idempotency_key = ?
     LIMIT 1`,
    [normalizedTenantId, normalizedKey]
  );
  return mapRequestRow(res.rows?.[0] || null);
}

async function listApprovalDecisions(requestId, runQuery = query) {
  const res = await runQuery(
    `SELECT *
     FROM approval_decisions
     WHERE request_id = ?
     ORDER BY step_no ASC, id ASC`,
    [requestId]
  );
  return (res.rows || []).map(mapDecisionRow);
}

async function countApprovalDecisions({ requestId, stepNo, decision, runQuery = query }) {
  const res = await runQuery(
    `SELECT COUNT(
        DISTINCT COALESCE(
          reviewer_authority_user_id,
          delegator_user_id,
          acting_user_id,
          decided_by_user_id
        )
      ) AS total
     FROM approval_decisions
     WHERE request_id = ?
       AND step_no = ?
       AND decision = ?`,
    [requestId, stepNo, toUpper(decision)]
  );
  return Number(res.rows?.[0]?.total || 0);
}

function normalizeSubmitter(submitter) {
  const tenantId = parsePositiveInt(submitter?.tenantId ?? submitter?.tenant_id);
  const userId = parsePositiveInt(
    submitter?.userId ?? submitter?.user_id ?? submitter?.id
  );
  if (!tenantId) throw badRequest("submitter.tenantId is required");
  if (!userId) throw badRequest("submitter.userId is required");
  return { tenantId, userId };
}

function normalizeDecision(decision) {
  const normalized = toUpper(decision);
  if (!["APPROVE", "REJECT", "RETURN"].includes(normalized)) {
    throw badRequest("decision must be APPROVE, REJECT, or RETURN");
  }
  return normalized;
}

function resolveExplicitStepPermissionCode(rawStep = {}) {
  if (hasOwn(rawStep, "required_permission_code")) {
    return String(rawStep.required_permission_code ?? "").trim();
  }
  if (hasOwn(rawStep, "requiredPermissionCode")) {
    return String(rawStep.requiredPermissionCode ?? "").trim();
  }
  return null;
}

function requiresDecisionComment(decision) {
  return ["REJECT", "RETURN"].includes(toUpper(decision));
}

function normalizeDecisionComment(decision, comment) {
  const normalizedComment = String(comment || "").trim() || null;
  if (requiresDecisionComment(decision) && !normalizedComment) {
    throw badRequest("decisionNote is required for RETURN or REJECT");
  }
  return normalizedComment;
}

function normalizeEvaluationContext(context = {}) {
  const tenantId = parsePositiveInt(context.tenantId ?? context.tenant_id);
  if (!tenantId) throw badRequest("context.tenantId is required");
  return {
    tenantId,
    scopeType: context.scopeType ?? context.scope_type ?? null,
    scopeId: context.scopeId ?? context.scope_id ?? null,
    groupId: context.groupId ?? context.group_id ?? null,
    countryId: context.countryId ?? context.country_id ?? null,
    legalEntityId: context.legalEntityId ?? context.legal_entity_id ?? null,
    operatingUnitId: context.operatingUnitId ?? context.operating_unit_id ?? null,
    thresholdAmount: context.thresholdAmount ?? context.threshold_amount ?? null,
    currencyCode: context.currencyCode ?? context.currency_code ?? null,
    effectiveOn:
      parseDateOnly(context.effectiveOn ?? context.effective_on) ||
      new Date().toISOString().slice(0, 10),
  };
}

function deriveScopeFromContext(context) {
  if (context.scopeType || context.scopeId) {
    return normalizeApprovalPolicyAssignmentScope({
      scopeType: context.scopeType,
      scopeId: context.scopeId,
    });
  }
  const resolved = resolveRowScope({
    tenantId: context.tenantId,
    groupId: context.groupId,
    countryId: context.countryId,
    legalEntityId: context.legalEntityId,
    operatingUnitId: context.operatingUnitId,
    allowTenantScope: true,
  });
  if (!resolved) {
    throw badRequest("A request scope could not be derived from the approval context");
  }
  return {
    scopeType: resolved.scopeType,
    scopeId: resolved.scopeId,
  };
}

function buildSyntheticPolicyStep(policy) {
  return {
    id: null,
    tenantId: policy.tenantId,
    policyId: policy.id,
    stepNo: 1,
    requiredPermissionCode:
      String(policy.approverPermissionCode || "").trim() || "approvals.requests.approve",
    scopeResolutionMode: "REQUEST_SCOPE",
    customScopeResolverKey: null,
    minApprovals: Math.max(1, Number(policy.minApprovals || 1)),
    allowSelfApprove: Boolean(policy.allowSelfApprove),
    escalationAfterHours: policy.escalationAfterHours || null,
    escalationTargetScopeMode: null,
    escalationMaxCount: null,
    createdAt: null,
    updatedAt: null,
  };
}

function buildPolicySnapshot(policy, steps, matchedAssignment = null) {
  const effectiveSteps =
    Array.isArray(steps) && steps.length > 0 ? steps : [buildSyntheticPolicyStep(policy)];
  return {
    id: policy.id,
    tenant_id: policy.tenantId,
    module_code: policy.moduleCode,
    policy_code: policy.policyCode,
    policy_name: policy.policyName,
    target_type: policy.targetType,
    action_type: policy.actionType,
    version_no: policy.versionNo,
    scope_type: policy.scopeType || null,
    scope_id: policy.scopeId || null,
    effective_from: policy.effectiveFrom,
    effective_to: policy.effectiveTo,
    step_count: effectiveSteps.length,
    min_approvals: Math.max(1, Number(policy.minApprovals || 1)),
    maker_checker_required: Boolean(policy.makerCheckerRequired),
    allow_self_approve: Boolean(policy.allowSelfApprove),
    auto_execute_on_final_approval: Boolean(policy.autoExecuteOnFinalApproval),
    escalation_after_hours: policy.escalationAfterHours || null,
    min_amount: policy.minAmount,
    max_amount: policy.maxAmount,
    currency_code: policy.currencyCode || null,
    approver_permission_code: policy.approverPermissionCode || null,
    matched_assignment: matchedAssignment
      ? {
          id: matchedAssignment.id,
          scope_type: matchedAssignment.scopeType,
          scope_id: matchedAssignment.scopeId,
          effective_from: matchedAssignment.effectiveFrom,
          effective_to: matchedAssignment.effectiveTo,
        }
      : null,
    steps: effectiveSteps.map((step) => ({
      step_no: Number(step.stepNo || 1),
      required_permission_code: String(step.requiredPermissionCode || "").trim(),
      scope_resolution_mode: toUpper(step.scopeResolutionMode || "REQUEST_SCOPE"),
      custom_scope_resolver_key: step.customScopeResolverKey || null,
      min_approvals: Math.max(1, Number(step.minApprovals || 1)),
      allow_self_approve: Boolean(step.allowSelfApprove),
      escalation_after_hours: step.escalationAfterHours || null,
      escalation_target_scope_mode: step.escalationTargetScopeMode || null,
      escalation_max_count: step.escalationMaxCount || null,
    })),
  };
}

function getPolicySnapshotSteps(policySnapshot) {
  const rawSteps = Array.isArray(policySnapshot?.steps) ? policySnapshot.steps : [];
  if (rawSteps.length === 0) {
    return [
      {
        stepNo: 1,
        requiredPermissionCode:
          String(policySnapshot?.approver_permission_code || "").trim() ||
          "approvals.requests.approve",
        scopeResolutionMode: "REQUEST_SCOPE",
        customScopeResolverKey: null,
        minApprovals: Math.max(1, Number(policySnapshot?.min_approvals || 1)),
        allowSelfApprove: Boolean(policySnapshot?.allow_self_approve),
        escalationAfterHours: parsePositiveInt(policySnapshot?.escalation_after_hours),
        escalationTargetScopeMode: policySnapshot?.escalation_target_scope_mode
          ? toUpper(policySnapshot.escalation_target_scope_mode)
          : null,
        escalationMaxCount: parsePositiveInt(policySnapshot?.escalation_max_count),
      },
    ];
  }
  return rawSteps
    .map((step) => {
      const explicitPermissionCode = resolveExplicitStepPermissionCode(step);
      return {
        stepNo: Number(step.step_no || step.stepNo || 1),
        requiredPermissionCode:
          explicitPermissionCode !== null
            ? explicitPermissionCode
            : String(policySnapshot?.approver_permission_code || "").trim() ||
              "approvals.requests.approve",
        scopeResolutionMode: toUpper(
          step.scope_resolution_mode ?? step.scopeResolutionMode ?? "REQUEST_SCOPE"
        ),
        customScopeResolverKey:
          step.custom_scope_resolver_key ?? step.customScopeResolverKey ?? null,
        minApprovals: Math.max(1, Number(step.min_approvals ?? step.minApprovals ?? 1)),
        allowSelfApprove: Boolean(step.allow_self_approve ?? step.allowSelfApprove),
        escalationAfterHours: parsePositiveInt(
          step.escalation_after_hours ?? step.escalationAfterHours
        ),
        escalationTargetScopeMode: step.escalation_target_scope_mode
          ? toUpper(step.escalation_target_scope_mode)
          : step.escalationTargetScopeMode
            ? toUpper(step.escalationTargetScopeMode)
            : null,
        escalationMaxCount: parsePositiveInt(
          step.escalation_max_count ?? step.escalationMaxCount
        ),
      };
    })
    .sort((left, right) => left.stepNo - right.stepNo);
}

function getCurrentStepFromRequest(requestRow) {
  const steps = getPolicySnapshotSteps(requestRow.policySnapshot);
  const currentStep = steps.find(
    (step) => Number(step.stepNo) === Number(requestRow.currentStepNo || 1)
  );
  return { steps, currentStep: currentStep || null };
}

/**
 * Return the parsed current-step context for one approval request snapshot.
 */
export function getApprovalRequestCurrentStepContext(requestRow) {
  return getCurrentStepFromRequest(requestRow);
}

function resolveCustomDecisionScope(step, requestRow) {
  const expectedKey = String(step.customScopeResolverKey || "").trim();
  const actionPayload = requestRow.actionPayload || {};
  const targetSnapshot = requestRow.targetSnapshot || {};
  const customScope =
    actionPayload.customDecisionScope ||
    actionPayload.custom_decision_scope ||
    targetSnapshot.customDecisionScope ||
    targetSnapshot.custom_decision_scope ||
    null;

  if (
    customScope &&
    String(customScope.resolverKey || customScope.resolver_key || "").trim() === expectedKey
  ) {
    try {
      return normalizeApprovalPolicyAssignmentScope(customScope);
    } catch {
      return null;
    }
  }
  return null;
}

function resolveDecisionScopeForStep(requestRow, step) {
  const requestScope = {
    scopeType: requestRow.scopeType,
    scopeId: requestRow.scopeId,
  };
  const policyScope =
    requestRow.policySnapshot?.scope_type && requestRow.policySnapshot?.scope_id
      ? {
          scopeType: requestRow.policySnapshot.scope_type,
          scopeId: requestRow.policySnapshot.scope_id,
        }
      : null;

  if (step.scopeResolutionMode === "POLICY_SCOPE" && policyScope) {
    return normalizeApprovalPolicyAssignmentScope(policyScope);
  }
  if (step.scopeResolutionMode === "TARGET_GROUP") {
    const scopeId =
      parsePositiveInt(
        requestRow.targetSnapshot?.group_company_id ??
          requestRow.targetSnapshot?.groupCompanyId ??
          requestRow.actionPayload?.group_company_id ??
          requestRow.actionPayload?.groupCompanyId
      ) ||
      (requestScope.scopeType === "GROUP" ? requestScope.scopeId : null);
    if (scopeId) {
      return {
        scopeType: "GROUP",
        scopeId,
      };
    }
  }
  if (step.scopeResolutionMode === "TARGET_COUNTRY") {
    const scopeId =
      parsePositiveInt(
        requestRow.targetSnapshot?.country_id ??
          requestRow.targetSnapshot?.countryId ??
          requestRow.actionPayload?.country_id ??
          requestRow.actionPayload?.countryId
      ) ||
      (requestScope.scopeType === "COUNTRY" ? requestScope.scopeId : null);
    if (scopeId) {
      return {
        scopeType: "COUNTRY",
        scopeId,
      };
    }
  }
  if (
    step.scopeResolutionMode === "TARGET_LEGAL_ENTITY" &&
    parsePositiveInt(requestRow.legalEntityId)
  ) {
    return {
      scopeType: "LEGAL_ENTITY",
      scopeId: parsePositiveInt(requestRow.legalEntityId),
    };
  }
  if (
    step.scopeResolutionMode === "TARGET_OPERATING_UNIT" &&
    parsePositiveInt(requestRow.operatingUnitId)
  ) {
    return {
      scopeType: "OPERATING_UNIT",
      scopeId: parsePositiveInt(requestRow.operatingUnitId),
    };
  }
  if (step.scopeResolutionMode === "CUSTOM") {
    return resolveCustomDecisionScope(step, requestRow) || requestScope;
  }
  return requestScope;
}

/**
 * Resolve the authoritative permission-check scope for one approval step.
 */
export function resolveApprovalDecisionScopeForStep(requestRow, step) {
  return resolveDecisionScopeForStep(requestRow, step);
}

function shouldEvaluateWorkflowDecisionSoD(decision, currentStep) {
  const normalizedDecision = toUpper(decision);
  if (normalizedDecision !== "APPROVE") {
    return false;
  }
  return !Boolean(currentStep?.allowSelfApprove);
}

function resolveSoDTargetForApprovalRequest(requestRow, currentStep, decision) {
  const moduleCode = toUpper(requestRow.moduleCode);
  const targetType = toUpper(requestRow.targetType);
  const actionType = toUpper(
    requestRow.policySnapshot?.action_type ?? requestRow.policySnapshot?.actionType
  );
  const actionPayload = requestRow.actionPayload || {};

  if (targetType === "PAYMENT_BATCH") {
    return {
      recordType: "PAYMENT_BATCH",
      recordId: requestRow.targetId,
      actionCode: "payments.batch.approve",
    };
  }
  if (targetType === "PAYROLL_MANUAL_SETTLEMENT_OVERRIDE") {
    return {
      recordType: "PAYROLL_MANUAL_SETTLEMENT_OVERRIDE",
      recordId: requestRow.targetId,
      actionCode: "payroll.settlement.override.approve",
    };
  }
  if (targetType === "PAYROLL_PERIOD_CLOSE" || actionType === "APPROVE_CLOSE") {
    return {
      recordType: "PAYROLL_PERIOD_CLOSE",
      recordId: requestRow.targetId,
      actionCode: "payroll.close.approve",
    };
  }
  if (targetType === "COUNTERPARTY_REQUEST") {
    return {
      recordType: "COUNTERPARTY_REQUEST",
      recordId: requestRow.targetId,
      actionCode: "cari.request.review",
    };
  }
  if (targetType === "LOCAL_CLOSE_PACK_REOPEN_REQUEST") {
    return {
      recordType: "LOCAL_CLOSE_PACK_REOPEN_REQUEST",
      recordId: requestRow.targetId,
      actionCode: "local.close.reopen.review",
    };
  }
  if (targetType === "INVENTORY_TRANSFER") {
    return {
      recordType: "INVENTORY_TRANSFER",
      recordId: requestRow.targetId,
      actionCode: "inventory.transfer.approve",
    };
  }
  if (moduleCode === "WORKFLOW" && shouldEvaluateWorkflowDecisionSoD(decision, currentStep)) {
    const workflowInstanceId = parsePositiveInt(
      actionPayload.legacy_workflow_instance_id ?? actionPayload.legacyWorkflowInstanceId
    );
    if (workflowInstanceId) {
      return {
        recordType: "WORKFLOW_INSTANCE",
        recordId: workflowInstanceId,
        actionCode: "workflow.instance.approve",
      };
    }
  }

  return null;
}

async function loadApplicableAssignmentRowsForPolicy({
  tenantId,
  policyId,
  requestScope,
  effectiveOn,
  runQuery = query,
}) {
  const assignments = (await listApprovalPolicyAssignments(policyId, runQuery)).filter(
    (assignment) =>
      assignment.isActive &&
      fitsEffectiveWindow(assignment.effectiveFrom, assignment.effectiveTo, effectiveOn)
  );

  const matches = [];
  for (const assignment of assignments) {
    const fits = await isApprovalScopeWithinBound({
      tenantId,
      boundScope: {
        scopeType: assignment.scopeType,
        scopeId: assignment.scopeId,
      },
      childScope: requestScope,
      runQuery,
    });
    if (fits) {
      matches.push(assignment);
    }
  }

  return matches.sort(
    (left, right) =>
      scopeRank(right.scopeType) - scopeRank(left.scopeType) ||
      Number(right.id || 0) - Number(left.id || 0)
  );
}

async function assertRequestFitsPolicyApplicability({
  policy,
  requestScope,
  effectiveOn,
  runQuery = query,
}) {
  const matchedAssignments = await loadApplicableAssignmentRowsForPolicy({
    tenantId: policy.tenantId,
    policyId: policy.id,
    requestScope,
    effectiveOn,
    runQuery,
  });

  if (matchedAssignments.length > 0) {
    return matchedAssignments[0];
  }

  // Transitional compatibility: until every migrated module writes explicit
  // assignments, a policy's own bound scope can still act as the applicability
  // fallback instead of making the policy unusable.
  if (policy.scopeType && policy.scopeId) {
    const policyFits = await isApprovalScopeWithinBound({
      tenantId: policy.tenantId,
      boundScope: {
        scopeType: policy.scopeType,
        scopeId: policy.scopeId,
      },
      childScope: requestScope,
      runQuery,
    });
    if (!policyFits) {
      throw badRequest("Request scope does not fit the approval policy applicability");
    }
    return null;
  }

  return null;
}

async function hydrateRequestWithDecisions(requestId, runQuery = query) {
  const requestRow = await getApprovalRequestRowById(requestId, runQuery);
  if (!requestRow) return null;
  const decisions = await listApprovalDecisions(requestId, runQuery);
  return {
    ...requestRow,
    decisions,
  };
}

function resolveExecutionResolverKey(requestRow) {
  const payload = requestRow.actionPayload || {};
  const targetSnapshot = requestRow.targetSnapshot || {};
  const policySnapshot = requestRow.policySnapshot || {};
  return (
    String(
      payload.executionResolverKey ||
        payload.execution_resolver_key ||
        targetSnapshot.executionResolverKey ||
        targetSnapshot.execution_resolver_key ||
        policySnapshot.execution_resolver_key ||
        ""
    ).trim() || null
  );
}

async function runExecuteResolver(requestRow, options = {}) {
  const resolverKey = resolveExecutionResolverKey(requestRow);
  if (!resolverKey) return null;
  const resolver = executionResolvers.get(resolverKey);
  if (!resolver?.execute) {
    throw conflict(`No approval execution resolver registered for ${resolverKey}`);
  }
  return resolver.execute({
    request: requestRow,
    policySnapshot: requestRow.policySnapshot || {},
    targetSnapshot: requestRow.targetSnapshot || {},
    actionPayload: requestRow.actionPayload || {},
    executedByUserId: parsePositiveInt(
      options?.executedByUserId ?? options?.executed_by_user_id
    ),
  });
}

async function runReverseResolver(requestRow) {
  const resolverKey = resolveExecutionResolverKey(requestRow);
  if (!resolverKey) return null;
  const resolver = executionResolvers.get(resolverKey);
  if (!resolver?.reverse) {
    throw conflict(`No approval reverse resolver registered for ${resolverKey}`);
  }
  return resolver.reverse({
    request: requestRow,
    policySnapshot: requestRow.policySnapshot || {},
    targetSnapshot: requestRow.targetSnapshot || {},
    actionPayload: requestRow.actionPayload || {},
  });
}

function summarizeStepDiagnostics(steps, decisions, currentStepNo) {
  return steps.map((step) => {
    const stepDecisions = decisions.filter((decision) => decision.stepNo === step.stepNo);
    return {
      stepNo: step.stepNo,
      requiredPermissionCode: step.requiredPermissionCode,
      scopeResolutionMode: step.scopeResolutionMode,
      minApprovals: step.minApprovals,
      allowSelfApprove: Boolean(step.allowSelfApprove),
      escalationAfterHours: step.escalationAfterHours || null,
      escalationTargetScopeMode: step.escalationTargetScopeMode || null,
      escalationMaxCount: step.escalationMaxCount || null,
      approveCount: stepDecisions.filter((decision) => decision.decision === "APPROVE").length,
      rejectCount: stepDecisions.filter((decision) => decision.decision === "REJECT").length,
      returnCount: stepDecisions.filter((decision) => decision.decision === "RETURN").length,
      isCurrent: Number(step.stepNo) === Number(currentStepNo || 1),
      decisions: stepDecisions,
    };
  });
}

/**
 * Register one module-specific execution resolver for the generic approval engine.
 */
export function registerApprovalExecutionResolver(key, resolver) {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) {
    throw badRequest("Approval execution resolver key is required");
  }
  if (!resolver || typeof resolver.execute !== "function") {
    throw badRequest("Approval execution resolver must provide an execute function");
  }
  executionResolvers.set(normalizedKey, resolver);
  return normalizedKey;
}

/**
 * Remove one registered execution resolver.
 */
export function unregisterApprovalExecutionResolver(key) {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) {
    return false;
  }
  return executionResolvers.delete(normalizedKey);
}

/**
 * Test helper for isolated approval-engine verification.
 */
export function clearApprovalExecutionResolversForTests() {
  executionResolvers.clear();
}

/**
 * Evaluate whether a generic approval policy applies to one target/action/scope context.
 */
export async function evaluateApprovalNeed(moduleCode, targetType, actionType, context = {}) {
  const normalizedContext = normalizeEvaluationContext(context);
  const requestScope = deriveScopeFromContext(normalizedContext);

  const res = await query(
    `SELECT *
     FROM approval_policies
     WHERE tenant_id = ?
       AND module_code = ?
       AND target_type = ?
       AND action_type = ?
       AND is_active = 1
       AND (effective_from IS NULL OR effective_from <= ?)
       AND (effective_to IS NULL OR effective_to >= ?)`,
    [
      normalizedContext.tenantId,
      toUpper(moduleCode),
      toUpper(targetType),
      toUpper(actionType),
      normalizedContext.effectiveOn,
      normalizedContext.effectiveOn,
    ]
  );

  const candidates = [];
  for (const rawRow of res.rows || []) {
    const policy = mapPolicyRow(rawRow);
    if (!policyMatchesCurrency(policy, normalizedContext.currencyCode)) {
      continue;
    }
    if (!policyMatchesAmount(policy, normalizedContext.thresholdAmount)) {
      continue;
    }

    const matchedAssignments = await loadApplicableAssignmentRowsForPolicy({
      tenantId: normalizedContext.tenantId,
      policyId: policy.id,
      requestScope,
      effectiveOn: normalizedContext.effectiveOn,
    });

    let matchedAssignment = matchedAssignments[0] || null;
    if (!matchedAssignment && policy.scopeType && policy.scopeId) {
      const fitsPolicyBound = await isApprovalScopeWithinBound({
        tenantId: normalizedContext.tenantId,
        boundScope: {
          scopeType: policy.scopeType,
          scopeId: policy.scopeId,
        },
        childScope: requestScope,
      });
      if (!fitsPolicyBound) {
        continue;
      }
    } else if (!matchedAssignment) {
      matchedAssignment = null;
    }

    const steps = await listApprovalPolicySteps(policy.id);
    candidates.push({
      policy,
      matchedAssignment,
      steps,
      policySnapshot: buildPolicySnapshot(policy, steps, matchedAssignment),
    });
  }

  candidates.sort((left, right) => {
    const assignmentRankDiff =
      scopeRank(right.matchedAssignment?.scopeType || null) -
      scopeRank(left.matchedAssignment?.scopeType || null);
    if (assignmentRankDiff !== 0) {
      return assignmentRankDiff;
    }
    const policyRankDiff = scopeRank(right.policy.scopeType) - scopeRank(left.policy.scopeType);
    if (policyRankDiff !== 0) {
      return policyRankDiff;
    }
    const rightMin = right.policy.minAmount ?? -1;
    const leftMin = left.policy.minAmount ?? -1;
    if (rightMin !== leftMin) {
      return rightMin - leftMin;
    }
    if (Number(right.policy.versionNo || 1) !== Number(left.policy.versionNo || 1)) {
      return Number(right.policy.versionNo || 1) - Number(left.policy.versionNo || 1);
    }
    return Number(right.policy.id || 0) - Number(left.policy.id || 0);
  });

  const matched = candidates[0] || null;
  if (!matched) {
    return {
      approvalRequired: false,
      approval_required: false,
      requestScope,
      policy: null,
      assignment: null,
      policySnapshot: null,
    };
  }

  return {
    approvalRequired: true,
    approval_required: true,
    requestScope,
    policy: matched.policy,
    assignment: matched.matchedAssignment,
    policySnapshot: matched.policySnapshot,
  };
}

/**
 * Submit one generic approval request against a selected policy.
 */
export async function submitRequest(
  policyId,
  targetType,
  targetId,
  submitter,
  snapshot = {},
  options = {}
) {
  const runQuery = typeof options?.runQuery === "function" ? options.runQuery : query;
  const normalizedSubmitter = normalizeSubmitter(submitter);
  const policy = await getApprovalPolicyById(policyId, runQuery);
  if (!policy || policy.tenantId !== normalizedSubmitter.tenantId) {
    throw notFound("Approval policy not found");
  }
  if (!policy.isActive) {
    throw badRequest("Approval policy must be active");
  }

  const effectiveOn =
    parseDateOnly(snapshot.effectiveOn ?? snapshot.effective_on) ||
    new Date().toISOString().slice(0, 10);
  if (!fitsEffectiveWindow(policy.effectiveFrom, policy.effectiveTo, effectiveOn)) {
    throw badRequest("Approval policy is not effective on the requested date");
  }

  const resolvedTargetType = toUpper(targetType);
  if (policy.targetType !== resolvedTargetType) {
    throw badRequest("targetType does not match the approval policy target");
  }

  const requestScope = deriveScopeFromContext({
    tenantId: normalizedSubmitter.tenantId,
    scopeType: snapshot.scopeType ?? snapshot.scope_type ?? null,
    scopeId: snapshot.scopeId ?? snapshot.scope_id ?? null,
    groupId: snapshot.groupId ?? snapshot.group_id ?? null,
    countryId: snapshot.countryId ?? snapshot.country_id ?? null,
    legalEntityId: snapshot.legalEntityId ?? snapshot.legal_entity_id ?? null,
    operatingUnitId: snapshot.operatingUnitId ?? snapshot.operating_unit_id ?? null,
  });

  const matchedAssignment = await assertRequestFitsPolicyApplicability({
    policy,
    requestScope,
    effectiveOn,
    runQuery,
  });
  const steps = await listApprovalPolicySteps(policy.id, runQuery);
  const policySnapshot = buildPolicySnapshot(policy, steps, matchedAssignment);
  const idempotencyKey = String(
    snapshot.idempotencyKey ?? snapshot.idempotency_key ?? ""
  ).trim();

  if (idempotencyKey) {
    const existing = await getApprovalRequestByIdempotencyKey(
      normalizedSubmitter.tenantId,
      idempotencyKey,
      runQuery
    );
    if (existing) {
      return {
        idempotent: true,
        item: await hydrateRequestWithDecisions(existing.id, runQuery),
      };
    }
  }

  const targetSnapshot = snapshot.targetSnapshot ?? snapshot.target_snapshot ?? null;
  const actionPayload = snapshot.actionPayload ?? snapshot.action_payload ?? null;
  const legalEntityId =
    parsePositiveInt(snapshot.legalEntityId ?? snapshot.legal_entity_id) ||
    (requestScope.scopeType === "LEGAL_ENTITY" ? requestScope.scopeId : null);
  const operatingUnitId =
    parsePositiveInt(snapshot.operatingUnitId ?? snapshot.operating_unit_id) ||
    (requestScope.scopeType === "OPERATING_UNIT" ? requestScope.scopeId : null);
  const requestCode = randomRequestCode();

  try {
    const insertRes = await runQuery(
      `INSERT INTO approval_requests (
         tenant_id,
         request_code,
         idempotency_key,
         policy_id,
         policy_version_no,
         module_code,
         target_type,
         target_id,
         scope_type,
         scope_id,
         legal_entity_id,
         operating_unit_id,
         request_status,
         current_step_no,
         execution_status,
         submitted_by_user_id,
         submitted_at,
         last_activity_at,
         policy_snapshot_json,
         target_snapshot_json,
         action_payload_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_REVIEW', 1, 'NOT_EXECUTED', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?, ?)`,
      [
        normalizedSubmitter.tenantId,
        requestCode,
        idempotencyKey || null,
        policy.id,
        policy.versionNo,
        policy.moduleCode,
        resolvedTargetType,
        parsePositiveInt(targetId),
        requestScope.scopeType,
        requestScope.scopeId,
        legalEntityId || null,
        operatingUnitId || null,
        normalizedSubmitter.userId,
        safeJson(policySnapshot),
        safeJson(targetSnapshot),
        safeJson(actionPayload),
      ]
    );
    const requestId = parsePositiveInt(insertRes.rows?.insertId);
    return {
      idempotent: false,
      item: await hydrateRequestWithDecisions(requestId, runQuery),
    };
  } catch (err) {
    if (idempotencyKey && isDuplicateKeyError(err)) {
      const existing = await getApprovalRequestByIdempotencyKey(
        normalizedSubmitter.tenantId,
        idempotencyKey,
        runQuery
      );
      if (existing) {
        return {
          idempotent: true,
          item: await hydrateRequestWithDecisions(existing.id, runQuery),
        };
      }
    }
    throw err;
  }
}

/**
 * Record one approval-engine decision and advance, resolve, or execute as needed.
 */
export async function recordDecision(requestId, userId, decision, comment = null) {
  const normalizedUserId = parsePositiveInt(userId);
  const normalizedDecision = normalizeDecision(decision);
  const normalizedComment = normalizeDecisionComment(normalizedDecision, comment);
  if (!normalizedUserId) {
    throw badRequest("userId is required");
  }

  const phase1 = await withTransaction(async (tx) => {
    const requestRow = await getApprovalRequestRowById(requestId, tx.query, {
      forUpdate: true,
    });
    if (!requestRow) {
      throw notFound("Approval request not found");
    }

    if (!["PENDING_REVIEW", "ESCALATED"].includes(requestRow.requestStatus)) {
      throw conflict(`Approval request status ${requestRow.requestStatus} is not decisionable`);
    }

    const { steps, currentStep } = getCurrentStepFromRequest(requestRow);
    if (!currentStep) {
      throw conflict("Approval request has no current step definition");
    }

    // Request scope stays authoritative for decision checks. Step scope modes
    // may narrow that to explicit policy/target scopes, but they do not invent
    // a separate caller-controlled scope for the review action.
    const decisionScope = resolveDecisionScopeForStep(requestRow, currentStep);
    const requiredPermissionCode = String(
      currentStep.requiredPermissionCode || ""
    ).trim();
    // Some bridged workflow families intentionally leave the step permission
    // blank so review authority is scope-driven rather than permission-driven.
    const hasDirectPermission = requiredPermissionCode
      ? await checkUserHasPermissionAtScope(
          normalizedUserId,
          requestRow.tenantId,
          requiredPermissionCode,
          decisionScope.scopeType,
          decisionScope.scopeId,
          { runQuery: tx.query }
        )
      : true;
    const delegation =
      !requiredPermissionCode || hasDirectPermission
        ? null
        : await resolveApprovalDelegation({
            tenantId: requestRow.tenantId,
            actingUserId: normalizedUserId,
            moduleCode: requestRow.moduleCode,
            permissionCode: requiredPermissionCode,
            requestScope: decisionScope,
            runQuery: tx.query,
          });

    if (!hasDirectPermission && !delegation) {
      throw forbidden(`Missing permission: ${requiredPermissionCode}`);
    }

    const delegatorUserId = parsePositiveInt(delegation?.delegatorUserId);
    const reviewerAuthorityUserId = delegatorUserId || normalizedUserId;

    assertRequesterNotDecisionActor({
      requestRow,
      actorUserId: normalizedUserId,
      normalizedDecision,
      allowSelfApprove: currentStep.allowSelfApprove,
      label: "acting reviewer",
    });
    if (delegatorUserId) {
      assertRequesterNotDecisionActor({
        requestRow,
        actorUserId: delegatorUserId,
        normalizedDecision,
        allowSelfApprove: currentStep.allowSelfApprove,
        label: "delegated authority source",
      });
    }

    const sodTarget = resolveSoDTargetForApprovalRequest(
      requestRow,
      currentStep,
      normalizedDecision
    );
    if (sodTarget?.recordType && sodTarget?.recordId && sodTarget?.actionCode) {
      await assertSoD({
        tenantId: requestRow.tenantId,
        userId: normalizedUserId,
        actionCode: sodTarget.actionCode,
        recordType: sodTarget.recordType,
        recordId: sodTarget.recordId,
        context: {
          runQuery: tx.query,
        },
      });
      if (delegatorUserId && delegatorUserId !== normalizedUserId) {
        await assertSoD({
          tenantId: requestRow.tenantId,
          userId: delegatorUserId,
          actionCode: sodTarget.actionCode,
          recordType: sodTarget.recordType,
          recordId: sodTarget.recordId,
          context: {
            runQuery: tx.query,
          },
        });
      }
    }

    const existingDecisions = (await listApprovalDecisions(requestRow.id, tx.query)).filter(
      (row) => Number(row.stepNo || 1) === Number(currentStep.stepNo)
    );
    if (
      existingDecisions.some(
        (existingDecision) => getDecisionActingUserId(existingDecision) === normalizedUserId
      )
    ) {
      throw conflict("Decision already exists for this user at the current step");
    }
    if (
      existingDecisions.some(
        (existingDecision) =>
          getDecisionAuthorityUserId(existingDecision) === reviewerAuthorityUserId
      )
    ) {
      throw conflict(
        "Decision already exists for this delegated authority at the current step"
      );
    }

    try {
      await tx.query(
        `INSERT INTO approval_decisions (
           tenant_id,
           request_id,
           step_no,
           decision,
           decided_by_user_id,
           acting_user_id,
           delegator_user_id,
           delegation_id,
           reviewer_authority_user_id,
           comment
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          requestRow.tenantId,
          requestRow.id,
          currentStep.stepNo,
          normalizedDecision,
          normalizedUserId,
          normalizedUserId,
          delegatorUserId || null,
          parsePositiveInt(delegation?.id) || null,
          reviewerAuthorityUserId,
          normalizedComment,
        ]
      );
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        throw conflict(
          "Decision already exists for this user or delegated authority at the current step"
        );
      }
      throw err;
    }

    if (normalizedDecision === "REJECT") {
      await tx.query(
        `UPDATE approval_requests
         SET request_status = 'REJECTED',
             rejected_at = CURRENT_TIMESTAMP,
             last_activity_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [requestRow.id]
      );
      return { requestId: requestRow.id, shouldExecute: false, idempotent: false };
    }

    if (normalizedDecision === "RETURN") {
      await tx.query(
        `UPDATE approval_requests
         SET request_status = 'RETURNED',
             last_activity_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [requestRow.id]
      );
      return { requestId: requestRow.id, shouldExecute: false, idempotent: false };
    }

    const approveCount = await countApprovalDecisions({
      requestId: requestRow.id,
      stepNo: currentStep.stepNo,
      decision: "APPROVE",
      runQuery: tx.query,
    });
    const minApprovals = Math.max(1, Number(currentStep.minApprovals || 1));
    if (approveCount < minApprovals) {
      await tx.query(
        `UPDATE approval_requests
         SET last_activity_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [requestRow.id]
      );
      return { requestId: requestRow.id, shouldExecute: false, idempotent: false };
    }

    const maxStepNo = steps.reduce(
      (highest, step) => Math.max(highest, Number(step.stepNo || 1)),
      1
    );
    if (currentStep.stepNo >= maxStepNo) {
      await tx.query(
        `UPDATE approval_requests
         SET request_status = 'APPROVED',
             approved_at = CURRENT_TIMESTAMP,
             last_activity_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [requestRow.id]
      );
      return {
        requestId: requestRow.id,
        shouldExecute: Boolean(
          requestRow.policySnapshot?.auto_execute_on_final_approval
        ),
        idempotent: false,
      };
    }

    await tx.query(
      `UPDATE approval_requests
       SET current_step_no = ?,
           request_status = 'PENDING_REVIEW',
           last_activity_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [currentStep.stepNo + 1, requestRow.id]
    );
    return { requestId: requestRow.id, shouldExecute: false, idempotent: false };
  });

  let execution = null;
  if (phase1.shouldExecute) {
    execution = await executeRequest(phase1.requestId, {
      executedByUserId: normalizedUserId,
    });
  }

  return {
    ...phase1,
    item: await hydrateRequestWithDecisions(phase1.requestId),
    execution_result: execution?.execution_result || null,
  };
}

/**
 * Withdraw one not-yet-finalized approval request as the original submitter.
 */
export async function withdrawRequest(requestId, userId) {
  const normalizedUserId = parsePositiveInt(userId);
  if (!normalizedUserId) {
    throw badRequest("userId is required");
  }

  await withTransaction(async (tx) => {
    const requestRow = await getApprovalRequestRowById(requestId, tx.query, {
      forUpdate: true,
    });
    if (!requestRow) {
      throw notFound("Approval request not found");
    }
    if (parsePositiveInt(requestRow.submittedByUserId) !== normalizedUserId) {
      throw forbidden("Only the original submitter can withdraw this approval request");
    }
    if (
      !["PENDING_REVIEW", "ESCALATED", "RETURNED", "SUBMITTED", "DRAFT"].includes(
        requestRow.requestStatus
      )
    ) {
      throw conflict(`Approval request status ${requestRow.requestStatus} cannot be withdrawn`);
    }
    await tx.query(
      `UPDATE approval_requests
       SET request_status = 'WITHDRAWN',
           withdrawn_at = CURRENT_TIMESTAMP,
           last_activity_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [requestRow.id]
    );
  });

  return {
    item: await hydrateRequestWithDecisions(requestId),
    idempotent: false,
  };
}

/**
 * Mark one reviewable request as escalated while keeping it actionable.
 */
export async function escalateRequest(requestId) {
  await withTransaction(async (tx) => {
    const requestRow = await getApprovalRequestRowById(requestId, tx.query, {
      forUpdate: true,
    });
    if (!requestRow) {
      throw notFound("Approval request not found");
    }
    if (!["PENDING_REVIEW", "ESCALATED"].includes(requestRow.requestStatus)) {
      throw conflict(`Approval request status ${requestRow.requestStatus} cannot be escalated`);
    }
    await tx.query(
      `UPDATE approval_requests
       SET request_status = 'ESCALATED',
           last_activity_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [requestRow.id]
    );
  });

  return {
    item: await hydrateRequestWithDecisions(requestId),
    idempotent: false,
  };
}

/**
 * Execute one approved approval request through the registered module resolver.
 */
export async function executeRequest(requestId, options = {}) {
  const executedByUserId = parsePositiveInt(
    options?.executedByUserId ?? options?.executed_by_user_id
  );
  const locked = await withTransaction(async (tx) => {
    const requestRow = await getApprovalRequestRowById(requestId, tx.query, {
      forUpdate: true,
    });
    if (!requestRow) {
      throw notFound("Approval request not found");
    }
    if (requestRow.executionStatus === "EXECUTED") {
      return { requestRow, alreadyExecuted: true };
    }
    if (requestRow.requestStatus !== "APPROVED") {
      throw conflict(`Approval request status ${requestRow.requestStatus} is not executable`);
    }
    return { requestRow, alreadyExecuted: false };
  });

  if (locked.alreadyExecuted) {
    return {
      item: await hydrateRequestWithDecisions(locked.requestRow.id),
      execution_result: locked.requestRow.executionResult || null,
      idempotent: true,
    };
  }

  try {
    const executionResult = await runExecuteResolver(locked.requestRow, {
      executedByUserId,
    });
    await query(
      `UPDATE approval_requests
       SET execution_status = 'EXECUTED',
           executed_at = CURRENT_TIMESTAMP,
           executed_by_user_id = COALESCE(?, executed_by_user_id),
           execution_result_json = ?,
           execution_error_text = NULL,
           last_activity_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [executedByUserId || null, safeJson(executionResult), locked.requestRow.id]
    );
    return {
      item: await hydrateRequestWithDecisions(locked.requestRow.id),
      execution_result: executionResult || null,
      idempotent: false,
    };
  } catch (err) {
    await query(
      `UPDATE approval_requests
       SET execution_status = 'FAILED',
           execution_error_text = ?,
           last_activity_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [String(err?.message || err), locked.requestRow.id]
    );
    throw err;
  }
}

/**
 * Reverse one previously executed approval request through the registered module resolver.
 */
export async function reverseExecution(requestId) {
  const locked = await withTransaction(async (tx) => {
    const requestRow = await getApprovalRequestRowById(requestId, tx.query, {
      forUpdate: true,
    });
    if (!requestRow) {
      throw notFound("Approval request not found");
    }
    if (requestRow.executionStatus === "REVERSED") {
      return { requestRow, alreadyReversed: true };
    }
    if (requestRow.executionStatus !== "EXECUTED") {
      throw conflict(
        `Approval request execution status ${requestRow.executionStatus} is not reversible`
      );
    }
    return { requestRow, alreadyReversed: false };
  });

  if (locked.alreadyReversed) {
    return {
      item: await hydrateRequestWithDecisions(locked.requestRow.id),
      reverse_result: locked.requestRow.executionResult || null,
      idempotent: true,
    };
  }

  const reverseResult = await runReverseResolver(locked.requestRow);
  await query(
    `UPDATE approval_requests
     SET execution_status = 'REVERSED',
         execution_result_json = ?,
         execution_error_text = NULL,
         last_activity_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [safeJson(reverseResult), locked.requestRow.id]
  );
  return {
    item: await hydrateRequestWithDecisions(locked.requestRow.id),
    reverse_result: reverseResult || null,
    idempotent: false,
  };
}

/**
 * Return one reviewable diagnostics payload for explainability and audit.
 */
export async function getRequestDiagnostics(requestId) {
  const requestRow = await getApprovalRequestRowById(requestId);
  if (!requestRow) {
    throw notFound("Approval request not found");
  }
  const decisions = await listApprovalDecisions(requestId);
  const { steps, currentStep } = getCurrentStepFromRequest(requestRow);
  const currentDecisionScope = currentStep
    ? resolveDecisionScopeForStep(requestRow, currentStep)
    : {
        scopeType: requestRow.scopeType,
        scopeId: requestRow.scopeId,
      };
  const availableApproverUserIds = currentStep
    ? String(currentStep.requiredPermissionCode || "").trim()
      ? await findUsersWithPermissionAtScope(
          requestRow.tenantId,
          currentStep.requiredPermissionCode,
          currentDecisionScope.scopeType,
          currentDecisionScope.scopeId
        )
      : []
    : [];

  return {
    request: requestRow,
    currentStep: currentStep
      ? {
          ...currentStep,
          decisionScope: currentDecisionScope,
        }
      : null,
    steps: summarizeStepDiagnostics(steps, decisions, requestRow.currentStepNo),
    decisions,
    availableApproverUserIds,
    requestScope: {
      scopeType: requestRow.scopeType,
      scopeId: requestRow.scopeId,
    },
  };
}

/**
 * Resolve how one user would review the current step of one approval request.
 *
 * This mirrors the engine's real direct-vs-delegated decision check so UI
 * surfaces can explain whether a review action will use the user's own
 * authority or a scoped delegation.
 */
export async function getApprovalRequestDelegationPreview(requestId, userId) {
  const normalizedUserId = parsePositiveInt(userId);
  if (!normalizedUserId) {
    throw badRequest("userId is required");
  }

  const requestRow = await getApprovalRequestRowById(requestId);
  if (!requestRow) {
    throw notFound("Approval request not found");
  }

  const { currentStep } = getCurrentStepFromRequest(requestRow);
  if (!currentStep) {
    throw conflict("Approval request has no current step definition");
  }

  const decisionScope = resolveDecisionScopeForStep(requestRow, currentStep);
  const isDecisionable = ["PENDING_REVIEW", "ESCALATED"].includes(requestRow.requestStatus);
  const requiredPermissionCode = String(
    currentStep.requiredPermissionCode || ""
  ).trim();
  const hasDirectPermission = requiredPermissionCode
    ? await checkUserHasPermissionAtScope(
        normalizedUserId,
        requestRow.tenantId,
        requiredPermissionCode,
        decisionScope.scopeType,
        decisionScope.scopeId
      )
    : true;

  let delegation = null;
  if (requiredPermissionCode && !hasDirectPermission && isDecisionable) {
    delegation = await resolveApprovalDelegation({
      tenantId: requestRow.tenantId,
      actingUserId: normalizedUserId,
      moduleCode: requestRow.moduleCode,
      permissionCode: requiredPermissionCode,
      requestScope: decisionScope,
    });
  }

  const authorityMode = hasDirectPermission
    ? "DIRECT"
    : delegation
      ? "DELEGATED"
      : "NONE";

  return {
    requestId: requestRow.id,
    requestCode: requestRow.requestCode,
    requestStatus: requestRow.requestStatus,
    currentStepNo: currentStep.stepNo,
    isDecisionable,
    authorityMode,
    permissionCode: requiredPermissionCode || null,
    decisionScope,
    actingUserId: normalizedUserId,
    reviewerAuthorityUserId:
      parsePositiveInt(delegation?.delegatorUserId) || normalizedUserId,
    delegation: delegation
      ? {
          id: delegation.id,
          state: delegation.state,
          moduleCode: delegation.moduleCode,
          scopeType: delegation.scopeType,
          scopeId: delegation.scopeId,
          effectiveFrom: delegation.effectiveFrom,
          effectiveTo: delegation.effectiveTo,
          delegatorUserId: delegation.delegatorUserId,
          delegatorUserName: delegation.delegatorUserName,
          delegatorUserEmail: delegation.delegatorUserEmail,
          delegateUserId: delegation.delegateUserId,
          delegateUserName: delegation.delegateUserName,
          delegateUserEmail: delegation.delegateUserEmail,
        }
      : null,
  };
}

export default {
  registerApprovalExecutionResolver,
  unregisterApprovalExecutionResolver,
  clearApprovalExecutionResolversForTests,
  evaluateApprovalNeed,
  submitRequest,
  recordDecision,
  withdrawRequest,
  escalateRequest,
  executeRequest,
  reverseExecution,
  getRequestDiagnostics,
  getApprovalRequestDelegationPreview,
};
