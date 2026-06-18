import { query } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import {
  evaluateBankApprovalNeed,
  snapshotBankApprovalPolicy,
} from "./bank.governance.service.js";
import {
  approveBankApprovalRequest,
  ensureApprovalExecutionResolversRegistered,
  executeBankApprovalRequest,
  getBankApprovalRequestById,
  listBankApprovalRequestRows,
  rejectBankApprovalRequest,
  resolveBankApprovalRequestScope,
  submitBankApprovalRequest,
  submitBankApprovalRequestFromRoute,
  syncLegacyBankApprovalRequestBridge,
} from "./bank.approvals.service.js";
import {
  createBankApprovalPolicy,
  getBankApprovalPolicyById,
  listBankApprovalPolicies,
  resolveBankApprovalPolicyScope,
  updateBankApprovalPolicy,
} from "./bank.approvalPolicies.service.js";
import {
  evaluateApprovalNeed as evaluateGenericApprovalNeed,
  executeRequest as executeUnifiedApprovalRequest,
  getApprovalRequestDelegationPreview as getUnifiedApprovalRequestDelegationPreview,
  getApprovalRequestRoutingSummary,
  recordDecision,
  submitRequest,
} from "./approval.engine.service.js";
import {
  ensureOperationalCoverageExecutionResolverRegistered,
  syncOperationalCoverageApprovalBridge,
} from "./operationalCoverage.service.js";
import { ensureCounterpartyApprovalResolverRegistered } from "./cari.counterparty-request.service.js";

function normalizeModuleCode(moduleCode, fallback = "BANK") {
  return String(moduleCode || fallback)
    .trim()
    .toUpperCase();
}

function ensureUnifiedApprovalExecutionResolversRegistered() {
  ensureApprovalExecutionResolversRegistered();
  ensureOperationalCoverageExecutionResolverRegistered();
  ensureCounterpartyApprovalResolverRegistered();
}

function getUnifiedRequestField(request, ...fieldNames) {
  for (const fieldName of fieldNames) {
    if (request?.[fieldName] !== undefined) {
      return request[fieldName];
    }
  }
  return undefined;
}

function getUnifiedRequestActionType(request) {
  return normalizeModuleCode(
    getUnifiedRequestField(request, "actionType", "action_type") ??
      request?.policySnapshot?.actionType ??
      request?.policySnapshot?.action_type ??
      request?.policy_snapshot_json?.action_type,
    "",
  );
}

function shouldForceExecuteApprovedRequest(request) {
  const moduleCode = normalizeModuleCode(
    getUnifiedRequestField(request, "moduleCode", "module_code"),
    "",
  );
  const targetType = normalizeModuleCode(
    getUnifiedRequestField(request, "targetType", "target_type"),
    "",
  );
  const actionType = getUnifiedRequestActionType(request);

  if (
    moduleCode === "PAYMENTS" &&
    targetType === "PAYMENT_BATCH" &&
    actionType === "APPROVE"
  ) {
    return true;
  }
  if (
    moduleCode === "INVENTORY" &&
    targetType === "INVENTORY_TRANSFER" &&
    actionType === "APPROVE"
  ) {
    return true;
  }
  if (
    moduleCode === "PAYROLL" &&
    targetType === "PAYROLL_MANUAL_SETTLEMENT_OVERRIDE" &&
    actionType === "APPLY"
  ) {
    return true;
  }
  if (
    moduleCode === "LOCAL_CLOSE" &&
    targetType === "LOCAL_CLOSE_PACK_REOPEN_REQUEST" &&
    actionType === "REOPEN"
  ) {
    return true;
  }
  return false;
}

function conflict(message) {
  const err = new Error(message);
  err.status = 409;
  return err;
}

async function syncUnifiedApprovalBridge({ tenantId, request }) {
  const requestId = parsePositiveInt(
    getUnifiedRequestField(request, "id", "requestId", "request_id"),
  );
  if (!requestId) {
    return;
  }

  const moduleCode = normalizeModuleCode(
    getUnifiedRequestField(request, "moduleCode", "module_code"),
    "",
  );
  const targetType = normalizeModuleCode(
    getUnifiedRequestField(request, "targetType", "target_type"),
    "",
  );

  if (moduleCode === "BANK") {
    await syncLegacyBankApprovalRequestBridge({
      tenantId,
      genericRequestId: requestId,
    });
    return;
  }

  if (moduleCode === "PAYMENTS" && targetType === "PAYMENT_BATCH") {
    const mod = await import("./payments.service.js");
    await mod.syncPaymentBatchApprovalRequestBridge({
      tenantId,
      approvalRequestId: requestId,
    });
    return;
  }

  if (
    moduleCode === "PAYROLL" &&
    targetType === "PAYROLL_MANUAL_SETTLEMENT_OVERRIDE"
  ) {
    const mod = await import("./payroll.settlementOverrides.service.js");
    await mod.syncPayrollManualSettlementApprovalRequestBridge({
      tenantId,
      approvalRequestId: requestId,
    });
    return;
  }

  if (moduleCode === "INVENTORY" && targetType === "INVENTORY_TRANSFER") {
    const mod = await import("./inventory.transfer.service.js");
    await mod.syncInventoryTransferApprovalRequestBridge({
      tenantId,
      approvalRequestId: requestId,
    });
    return;
  }

  if (
    moduleCode === "LOCAL_CLOSE" &&
    targetType === "LOCAL_CLOSE_PACK_REOPEN_REQUEST"
  ) {
    const mod = await import("./local.close-reopen.service.js");
    await mod.syncLocalClosePackReopenApprovalRequestBridge({
      tenantId,
      approvalRequestId: requestId,
    });
    return;
  }

  if (moduleCode === "SECURITY" && targetType === "OPERATIONAL_ROLE_COVERAGE") {
    await syncOperationalCoverageApprovalBridge({
      tenantId,
      approvalRequestId: requestId,
    });
  }
}

function toAmount(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(6)) : null;
}

function parseJson(value, fallback = null) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value === "object") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function mapGenericApprovalRequestRow(row) {
  if (!row) {
    return null;
  }
  const policySnapshot = parseJson(row.policy_snapshot_json, {});
  const targetSnapshot = parseJson(row.target_snapshot_json, null);
  return {
    id: parsePositiveInt(row.id),
    tenant_id: parsePositiveInt(row.tenant_id),
    request_code: row.request_code || null,
    idempotency_key: row.idempotency_key || null,
    policy_id: parsePositiveInt(row.policy_id),
    policy_version_no: Number(row.policy_version_no || 1),
    module_code: normalizeModuleCode(row.module_code),
    target_type: normalizeModuleCode(row.target_type, ""),
    target_id: parsePositiveInt(row.target_id),
    scope_type: normalizeModuleCode(row.scope_type, ""),
    scope_id: parsePositiveInt(row.scope_id),
    legal_entity_id: parsePositiveInt(row.legal_entity_id),
    operating_unit_id: parsePositiveInt(row.operating_unit_id),
    request_status: normalizeGenericRequestStatusForCompatibility(
      row.request_status,
      row.execution_status,
    ),
    current_step_no: Number(row.current_step_no || 1),
    execution_status: normalizeModuleCode(
      row.execution_status || "NOT_EXECUTED",
    ),
    submitted_by_user_id: parsePositiveInt(row.submitted_by_user_id),
    submitted_at: row.submitted_at || null,
    approved_at: row.approved_at || null,
    rejected_at: row.rejected_at || null,
    withdrawn_at: row.withdrawn_at || null,
    executed_at: row.executed_at || null,
    executed_by_user_id: parsePositiveInt(row.executed_by_user_id),
    last_activity_at: row.last_activity_at || null,
    policy_snapshot_json: policySnapshot,
    target_snapshot_json: targetSnapshot,
    routing_summary: getApprovalRequestRoutingSummary({
      policySnapshot,
      targetSnapshot,
    }),
    action_payload_json: parseJson(row.action_payload_json, null),
    execution_result_json: parseJson(row.execution_result_json, null),
    execution_error_text: row.execution_error_text || null,
    decisions: Array.isArray(row.decisions) ? row.decisions : [],
    approvals_granted:
      row.approvals_granted !== undefined
        ? Number(row.approvals_granted || 0)
        : Array.isArray(row.decisions)
          ? row.decisions.filter(
              (decision) =>
                normalizeModuleCode(decision.decision) === "APPROVE",
            ).length
          : 0,
    rejections_granted:
      row.rejections_granted !== undefined
        ? Number(row.rejections_granted || 0)
        : Array.isArray(row.decisions)
          ? row.decisions.filter(
              (decision) => normalizeModuleCode(decision.decision) === "REJECT",
            ).length
          : 0,
  };
}

function mapGenericApprovalDecisionRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: parsePositiveInt(row.id),
    tenant_id: parsePositiveInt(row.tenant_id),
    request_id: parsePositiveInt(row.request_id),
    step_no: Number(row.step_no || 1),
    decision: normalizeModuleCode(row.decision, ""),
    comment: row.comment || null,
    decided_by_user_id: parsePositiveInt(row.decided_by_user_id),
    acting_user_id: parsePositiveInt(row.acting_user_id),
    delegator_user_id: parsePositiveInt(row.delegator_user_id),
    delegation_id: parsePositiveInt(row.delegation_id),
    reviewer_authority_user_id: parsePositiveInt(
      row.reviewer_authority_user_id,
    ),
    decided_at: row.decided_at || null,
  };
}

function buildApprovalExecutionResolverKey(moduleCode, targetType, actionType) {
  return [
    normalizeModuleCode(moduleCode),
    normalizeModuleCode(targetType, ""),
    normalizeModuleCode(actionType, ""),
  ].join(":");
}

function buildUnifiedSubmitSnapshot(requestInput, targetSnapshot) {
  const normalizedTargetSnapshot =
    targetSnapshot && typeof targetSnapshot === "object"
      ? { ...targetSnapshot }
      : {};
  return {
    ...normalizedTargetSnapshot,
    module_code: normalizeModuleCode(requestInput?.moduleCode),
    target_type: normalizeModuleCode(requestInput?.targetType, ""),
    target_id:
      parsePositiveInt(requestInput?.targetId) ||
      parsePositiveInt(normalizedTargetSnapshot.target_id) ||
      parsePositiveInt(normalizedTargetSnapshot.targetId),
    legal_entity_id:
      parsePositiveInt(requestInput?.legalEntityId) ||
      parsePositiveInt(normalizedTargetSnapshot.legal_entity_id) ||
      parsePositiveInt(normalizedTargetSnapshot.legalEntityId) ||
      null,
    bank_account_id:
      parsePositiveInt(requestInput?.bankAccountId) ||
      parsePositiveInt(normalizedTargetSnapshot.bank_account_id) ||
      parsePositiveInt(normalizedTargetSnapshot.bankAccountId) ||
      null,
    execution_resolver_key: buildApprovalExecutionResolverKey(
      requestInput?.moduleCode,
      requestInput?.targetType,
      requestInput?.actionType,
    ),
  };
}

function assertGenericRequestScopeAccess(
  req,
  genericRequest,
  assertScopeAccess,
  label = "requestId",
) {
  if (typeof assertScopeAccess !== "function") {
    return;
  }

  const scopeType = normalizeModuleCode(
    getUnifiedRequestField(genericRequest, "scope_type", "scopeType"),
    "",
  );
  const scopeId = parsePositiveInt(
    getUnifiedRequestField(genericRequest, "scope_id", "scopeId"),
  );
  if (scopeType === "OPERATING_UNIT" && scopeId) {
    assertScopeAccess(req, "operating_unit", scopeId, label);
    return;
  }
  if (scopeType === "LEGAL_ENTITY" && scopeId) {
    assertScopeAccess(req, "legal_entity", scopeId, label);
    return;
  }
  if (parsePositiveInt(genericRequest?.legal_entity_id)) {
    assertScopeAccess(
      req,
      "legal_entity",
      genericRequest.legal_entity_id,
      label,
    );
  }
}

async function getGenericApprovalRequestRowById({
  tenantId,
  requestId,
  runQuery = query,
}) {
  const normalizedRequestId = parsePositiveInt(requestId);
  if (!normalizedRequestId) {
    return null;
  }
  const res = await runQuery(
    `SELECT *
     FROM approval_requests
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, normalizedRequestId],
  );
  return mapGenericApprovalRequestRow(res.rows?.[0] || null);
}

async function listGenericApprovalDecisions({
  tenantId,
  requestId,
  runQuery = query,
}) {
  const normalizedRequestId = parsePositiveInt(requestId);
  if (!normalizedRequestId) {
    return [];
  }
  const res = await runQuery(
    `SELECT *
     FROM approval_decisions
     WHERE tenant_id = ?
       AND request_id = ?
     ORDER BY step_no ASC, id ASC`,
    [tenantId, normalizedRequestId],
  );
  return (res.rows || []).map(mapGenericApprovalDecisionRow);
}

async function hydrateGenericApprovalRequest({
  tenantId,
  requestId,
  runQuery = query,
}) {
  const row = await getGenericApprovalRequestRowById({
    tenantId,
    requestId,
    runQuery,
  });
  if (!row) {
    return null;
  }
  const decisions = await listGenericApprovalDecisions({
    tenantId,
    requestId,
    runQuery,
  });
  return mapGenericApprovalRequestRow({
    ...row,
    decisions,
  });
}

async function listGenericApprovalRequestRows({
  req,
  tenantId,
  filters,
  buildScopeFilter,
}) {
  const params = [tenantId];
  const where = ["r.tenant_id = ?"];
  if (typeof buildScopeFilter === "function") {
    where.push(
      buildScopeFilter(req, "legal_entity", "r.legal_entity_id", params),
    );
  }
  if (filters.requestStatus) {
    where.push("r.request_status = ?");
    params.push(filters.requestStatus);
  }
  if (filters.moduleCode) {
    where.push("r.module_code = ?");
    params.push(normalizeModuleCode(filters.moduleCode));
  }
  if (filters.targetType) {
    where.push("r.target_type = ?");
    params.push(normalizeModuleCode(filters.targetType, ""));
  }
  if (filters.actionType) {
    where.push(
      "JSON_UNQUOTE(JSON_EXTRACT(r.policy_snapshot_json, '$.action_type')) = ?",
    );
    params.push(normalizeModuleCode(filters.actionType, ""));
  }
  if (filters.mineOnly) {
    where.push("r.submitted_by_user_id = ?");
    params.push(parsePositiveInt(req?.user?.userId) || -1);
  }

  const whereSql = where.join(" AND ");
  const countRes = await query(
    `SELECT COUNT(*) AS total
     FROM approval_requests r
     WHERE ${whereSql}`,
    params,
  );
  const total = Number(countRes.rows?.[0]?.total || 0);

  const safeLimit =
    Number.isInteger(filters.limit) && filters.limit > 0 ? filters.limit : 100;
  const safeOffset =
    Number.isInteger(filters.offset) && filters.offset >= 0
      ? filters.offset
      : 0;
  const listRes = await query(
    `SELECT
        r.*,
        (
          SELECT COUNT(*)
          FROM approval_decisions d
          WHERE d.tenant_id = r.tenant_id
            AND d.request_id = r.id
            AND d.decision = 'APPROVE'
        ) AS approve_count,
        (
          SELECT COUNT(*)
          FROM approval_decisions d
          WHERE d.tenant_id = r.tenant_id
            AND d.request_id = r.id
            AND d.decision = 'REJECT'
        ) AS reject_count
     FROM approval_requests r
     WHERE ${whereSql}
     ORDER BY
       CASE r.request_status
         WHEN 'PENDING_REVIEW' THEN 0
         WHEN 'ESCALATED' THEN 1
         WHEN 'RETURNED' THEN 2
         WHEN 'APPROVED' THEN 3
         ELSE 4
       END,
       r.id DESC
     LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    params,
  );

  return {
    rows: (listRes.rows || []).map((row) =>
      mapGenericApprovalRequestRow({
        ...row,
        approvals_granted: Number(row.approve_count || 0),
        rejections_granted: Number(row.reject_count || 0),
      }),
    ),
    total,
    limit: filters.limit,
    offset: filters.offset,
  };
}

/**
 * Keep legacy policy snapshots available for compatibility surfaces.
 */
export function snapshotApprovalPolicy(policy) {
  return snapshotBankApprovalPolicy(policy);
}

function addGenericPolicyCompatibilityAliases(policy) {
  if (!policy) {
    return null;
  }
  return {
    ...policy,
    tenant_id: parsePositiveInt(policy.tenantId),
    module_code: normalizeModuleCode(policy.moduleCode),
    policy_code: policy.policyCode || null,
    policy_name: policy.policyName || null,
    target_type: normalizeModuleCode(policy.targetType, ""),
    action_type: normalizeModuleCode(policy.actionType, ""),
    version_no: Number(policy.versionNo || 1),
    scope_type: normalizeModuleCode(policy.scopeType, "") || null,
    scope_id: parsePositiveInt(policy.scopeId),
    effective_from: policy.effectiveFrom || null,
    effective_to: policy.effectiveTo || null,
    step_count: Number(policy.stepCount || 1),
    min_approvals: Number(policy.minApprovals || 1),
    required_approvals: Number(policy.minApprovals || 1),
    maker_checker_required: Boolean(policy.makerCheckerRequired),
    allow_self_approve: Boolean(policy.allowSelfApprove),
    auto_execute_on_final_approval: Boolean(policy.autoExecuteOnFinalApproval),
    escalation_after_hours: parsePositiveInt(policy.escalationAfterHours),
    min_amount: toAmount(policy.minAmount),
    max_amount: toAmount(policy.maxAmount),
    currency_code: normalizeModuleCode(policy.currencyCode, "") || null,
    approver_permission_code:
      String(policy.approverPermissionCode || "").trim() || null,
    is_active: Boolean(policy.isActive),
    created_by_user_id: parsePositiveInt(policy.createdByUserId),
    updated_by_user_id: parsePositiveInt(policy.updatedByUserId),
    created_at: policy.createdAt || null,
    updated_at: policy.updatedAt || null,
  };
}

function normalizeGenericRequestStatusForCompatibility(status, executionStatus = null) {
  const normalized = normalizeModuleCode(status, "");
  if (normalizeModuleCode(executionStatus, "") === "EXECUTED") {
    return "EXECUTED";
  }
  if (normalized === "PENDING_REVIEW" || normalized === "ESCALATED") {
    return "PENDING";
  }
  if (normalized === "APPROVED") {
    return "APPROVED";
  }
  return normalized;
}

function countGenericDecisions(request, decisionType) {
  const normalizedDecisionType = normalizeModuleCode(decisionType, "");
  return Array.isArray(request?.decisions)
    ? request.decisions.filter(
        (decision) =>
          normalizeModuleCode(
            getUnifiedRequestField(decision, "decision"),
            "",
          ) === normalizedDecisionType,
      ).length
    : 0;
}

function getGenericRequestPolicySnapshot(request) {
  return (
    request?.policySnapshot ||
    request?.policy_snapshot_json ||
    request?.policy_snapshot ||
    {}
  );
}

function getGenericRequestTargetSnapshot(request) {
  return (
    request?.targetSnapshot ||
    request?.target_snapshot_json ||
    request?.target_snapshot ||
    null
  );
}

function addGenericRequestCompatibilityAliases(request) {
  if (!request) {
    return null;
  }
  const policySnapshot = getGenericRequestPolicySnapshot(request);
  const targetSnapshot = getGenericRequestTargetSnapshot(request);
  const executionStatus = normalizeModuleCode(
    getUnifiedRequestField(request, "executionStatus", "execution_status") ||
      "NOT_EXECUTED",
    "",
  );
  const requiredApprovals = Math.max(
    1,
    Number(
      policySnapshot?.min_approvals ||
        policySnapshot?.required_approvals ||
        policySnapshot?.steps?.[0]?.min_approvals ||
        1,
    ),
  );
  return {
    ...request,
    tenant_id: parsePositiveInt(
      getUnifiedRequestField(request, "tenantId", "tenant_id"),
    ),
    request_code: getUnifiedRequestField(request, "requestCode", "request_code") || null,
    idempotency_key:
      getUnifiedRequestField(request, "idempotencyKey", "idempotency_key") || null,
    policy_id: parsePositiveInt(
      getUnifiedRequestField(request, "policyId", "policy_id"),
    ),
    policy_version_no: Number(
      getUnifiedRequestField(request, "policyVersionNo", "policy_version_no") ||
        1,
    ),
    module_code: normalizeModuleCode(
      getUnifiedRequestField(request, "moduleCode", "module_code"),
    ),
    target_type: normalizeModuleCode(
      getUnifiedRequestField(request, "targetType", "target_type"),
      "",
    ),
    target_id: parsePositiveInt(
      getUnifiedRequestField(request, "targetId", "target_id"),
    ),
    scope_type: normalizeModuleCode(
      getUnifiedRequestField(request, "scopeType", "scope_type"),
      "",
    ),
    scope_id: parsePositiveInt(
      getUnifiedRequestField(request, "scopeId", "scope_id"),
    ),
    legal_entity_id: parsePositiveInt(
      getUnifiedRequestField(request, "legalEntityId", "legal_entity_id"),
    ),
    operating_unit_id: parsePositiveInt(
      getUnifiedRequestField(request, "operatingUnitId", "operating_unit_id"),
    ),
    request_status: normalizeGenericRequestStatusForCompatibility(
      getUnifiedRequestField(request, "requestStatus", "request_status"),
      executionStatus,
    ),
    current_step_no: Number(
      getUnifiedRequestField(request, "currentStepNo", "current_step_no") || 1,
    ),
    execution_status: executionStatus,
    submitted_by_user_id: parsePositiveInt(
      getUnifiedRequestField(
        request,
        "submittedByUserId",
        "submitted_by_user_id",
      ),
    ),
    submitted_at:
      getUnifiedRequestField(request, "submittedAt", "submitted_at") || null,
    approved_at:
      getUnifiedRequestField(request, "approvedAt", "approved_at") || null,
    rejected_at:
      getUnifiedRequestField(request, "rejectedAt", "rejected_at") || null,
    withdrawn_at:
      getUnifiedRequestField(request, "withdrawnAt", "withdrawn_at") || null,
    executed_at:
      getUnifiedRequestField(request, "executedAt", "executed_at") || null,
    executed_by_user_id: parsePositiveInt(
      getUnifiedRequestField(request, "executedByUserId", "executed_by_user_id"),
    ),
    last_activity_at:
      getUnifiedRequestField(request, "lastActivityAt", "last_activity_at") ||
      null,
    policy_snapshot_json: policySnapshot,
    target_snapshot_json: targetSnapshot,
    routing_summary:
      request?.routing_summary ||
      request?.routingSummary ||
      getApprovalRequestRoutingSummary({ policySnapshot, targetSnapshot }),
    action_payload_json:
      getUnifiedRequestField(request, "actionPayload", "action_payload_json") ||
      null,
    execution_result_json:
      getUnifiedRequestField(
        request,
        "executionResult",
        "execution_result_json",
      ) || null,
    execution_error_text:
      getUnifiedRequestField(
        request,
        "executionErrorText",
        "execution_error_text",
      ) || null,
    required_approvals: requiredApprovals,
    min_approvals: requiredApprovals,
    approvals_granted:
      request.approvals_granted !== undefined
        ? Number(request.approvals_granted || 0)
        : countGenericDecisions(request, "APPROVE"),
    rejections_granted:
      request.rejections_granted !== undefined
        ? Number(request.rejections_granted || 0)
        : countGenericDecisions(request, "REJECT"),
  };
}

/**
 * Evaluate whether an approval is required for one target/action submission.
 */
export async function evaluateApprovalNeed({
  moduleCode = "BANK",
  tenantId,
  targetType,
  actionType,
  legalEntityId = null,
  bankAccountId = null,
  thresholdAmount = null,
  currencyCode = null,
  asOfDate = null,
  runQuery = query,
}) {
  const normalizedModuleCode = normalizeModuleCode(moduleCode);
  if (normalizedModuleCode === "BANK") {
    return evaluateBankApprovalNeed({
      moduleCode: normalizedModuleCode,
      tenantId,
      targetType,
      actionType,
      legalEntityId,
      bankAccountId,
      thresholdAmount,
      currencyCode,
      asOfDate,
      runQuery,
    });
  }

  const result = await evaluateGenericApprovalNeed(
    normalizedModuleCode,
    targetType,
    actionType,
    {
      tenantId,
      legalEntityId,
      thresholdAmount,
      currencyCode,
      effectiveOn: asOfDate,
    },
  );
  return {
    ...result,
    policy: addGenericPolicyCompatibilityAliases(result?.policy),
  };
}

/**
 * Submit one approval request through the generic approval engine.
 */
export async function submitApprovalRequest({
  tenantId,
  userId,
  requestInput,
  snapshotBuilder = null,
  policyOverride = null,
  runQuery = query,
}) {
  const normalizedModuleCode = normalizeModuleCode(requestInput?.moduleCode);
  if (normalizedModuleCode === "BANK") {
    return submitBankApprovalRequest({
      tenantId,
      userId,
      requestInput: {
        ...requestInput,
        moduleCode: normalizedModuleCode,
      },
      snapshotBuilder,
      policyOverride,
      runQuery,
    });
  }

  ensureUnifiedApprovalExecutionResolversRegistered();
  const targetType = normalizeModuleCode(requestInput?.targetType, "");
  const actionType = normalizeModuleCode(requestInput?.actionType, "");
  const targetId = parsePositiveInt(requestInput?.targetId);
  if (!targetId) {
    throw badRequest("targetId is required");
  }

  const governance =
    policyOverride ||
    (await evaluateGenericApprovalNeed(
      normalizedModuleCode,
      targetType,
      actionType,
      {
        tenantId,
        legalEntityId: parsePositiveInt(requestInput?.legalEntityId) || null,
        thresholdAmount: requestInput?.thresholdAmount ?? null,
        currencyCode: requestInput?.currencyCode || null,
      },
    ));

  if (!governance?.approvalRequired && !governance?.approval_required) {
    return { approval_required: false, approvalRequired: false, item: null };
  }

  if (!parsePositiveInt(governance?.policy?.id)) {
    throw badRequest("Applicable approval policy not found");
  }

  const rawTargetSnapshot =
    typeof snapshotBuilder === "function"
      ? (await snapshotBuilder()) || {}
      : requestInput?.targetSnapshot || requestInput?.target_snapshot || {};
  const targetSnapshot = buildUnifiedSubmitSnapshot(
    requestInput,
    rawTargetSnapshot,
  );
  const submitRes = await submitRequest(
    parsePositiveInt(governance.policy.id),
    targetType,
    targetId,
    { tenantId, userId },
    {
      idempotencyKey: String(requestInput?.requestKey || "").trim() || null,
      legalEntityId: parsePositiveInt(requestInput?.legalEntityId) || null,
      operatingUnitId: parsePositiveInt(requestInput?.operatingUnitId) || null,
      targetSnapshot,
      actionPayload:
        requestInput?.actionPayload ?? requestInput?.action_payload ?? null,
    },
    { runQuery },
  );

  return {
    approval_required: true,
    approvalRequired: true,
    item: addGenericRequestCompatibilityAliases(submitRes?.item),
    idempotent: Boolean(submitRes?.idempotent),
  };
}

/**
 * Submit one approval request from the shared `/approvals` route surface.
 */
export async function submitApprovalRequestFromRoute({
  req,
  tenantId,
  userId,
  input,
  assertScopeAccess,
}) {
  const normalizedModuleCode = normalizeModuleCode(input?.moduleCode);
  if (normalizedModuleCode === "BANK") {
    return submitBankApprovalRequestFromRoute({
      req,
      tenantId,
      userId,
      input: {
        ...input,
        moduleCode: normalizedModuleCode,
      },
      assertScopeAccess,
    });
  }

  if (
    parsePositiveInt(input?.legalEntityId) &&
    typeof assertScopeAccess === "function"
  ) {
    assertScopeAccess(
      req,
      "legal_entity",
      input.legalEntityId,
      "legalEntityId",
    );
  }

  const result = await submitApprovalRequest({
    tenantId,
    userId,
    requestInput: {
      ...input,
      moduleCode: normalizedModuleCode,
    },
  });

  if (!result.approval_required) {
    throw badRequest(
      "No active approval policy matched for the submitted request",
    );
  }
  return result;
}

export {
  resolveBankApprovalPolicyScope as resolveApprovalPolicyScope,
  listBankApprovalPolicies as listApprovalPolicies,
  getBankApprovalPolicyById as getApprovalPolicyById,
  createBankApprovalPolicy as createApprovalPolicy,
  updateBankApprovalPolicy as updateApprovalPolicy,
};

/**
 * Resolve one approval request id to its RBAC scope for generic approval routes.
 */
export async function resolveApprovalRequestScope(requestId, tenantId) {
  const genericRequest = await getGenericApprovalRequestRowById({
    tenantId,
    requestId,
  });
  if (genericRequest) {
    return {
      scopeType: genericRequest.scope_type,
      scopeId: genericRequest.scope_id,
    };
  }
  return resolveBankApprovalRequestScope(requestId, tenantId);
}

/**
 * List approval requests from the unified approval engine, with the BANK
 * compatibility surface reading from mirrored audit rows when needed.
 */
export async function listApprovalRequestRows({
  req,
  tenantId,
  filters,
  buildScopeFilter,
  assertScopeAccess,
}) {
  const normalizedModuleCode = filters?.moduleCode
    ? normalizeModuleCode(filters.moduleCode)
    : null;
  if (normalizedModuleCode === "BANK") {
    return listBankApprovalRequestRows({
      req,
      tenantId,
      filters,
      buildScopeFilter,
      assertScopeAccess,
    });
  }
  return listGenericApprovalRequestRows({
    req,
    tenantId,
    filters,
    buildScopeFilter,
  });
}

/**
 * Read one approval request from the generic approval engine, with the BANK
 * compatibility surface resolving mirrored audit rows when needed.
 */
export async function getApprovalRequestById({
  req,
  tenantId,
  requestId,
  assertScopeAccess,
}) {
  const genericRequest = await hydrateGenericApprovalRequest({
    tenantId,
    requestId,
  });
  if (genericRequest) {
    assertGenericRequestScopeAccess(
      req,
      genericRequest,
      assertScopeAccess,
      "requestId",
    );
    return genericRequest;
  }
  return getBankApprovalRequestById({
    req,
    tenantId,
    requestId,
    assertScopeAccess,
  });
}

/**
 * Resolve the direct-vs-delegated review context for one unified approval
 * request so UI surfaces can explain how the next decision would be recorded.
 */
export async function getApprovalRequestDelegationPreview(requestId, userId) {
  return getUnifiedApprovalRequestDelegationPreview(requestId, userId);
}

/**
 * Record one approve decision on the unified approval engine, including the
 * BANK compatibility surface that now delegates through bridged requests.
 */
export async function approveApprovalRequest({
  req,
  tenantId,
  requestId,
  userId,
  decisionComment = null,
  assertScopeAccess,
}) {
  const genericRequest = await getGenericApprovalRequestRowById({
    tenantId,
    requestId,
  });
  if (!genericRequest) {
    return approveBankApprovalRequest({
      req,
      tenantId,
      requestId,
      userId,
      decisionComment,
      assertScopeAccess,
    });
  }
  if (
    normalizeModuleCode(
      getUnifiedRequestField(genericRequest, "requestStatus", "request_status"),
      "",
    ) === "REJECTED"
  ) {
    throw conflict("Rejected approval request cannot be approved");
  }

  ensureUnifiedApprovalExecutionResolversRegistered();
  assertGenericRequestScopeAccess(
    req,
    genericRequest,
    assertScopeAccess,
    "requestId",
  );
  let result = await recordDecision(
    requestId,
    userId,
    "APPROVE",
    decisionComment,
  );
  let approvalItem = result.item || genericRequest;

  if (
    normalizeModuleCode(
      getUnifiedRequestField(approvalItem, "requestStatus", "request_status"),
      "",
    ) === "APPROVED" &&
    normalizeModuleCode(
      getUnifiedRequestField(
        approvalItem,
        "executionStatus",
        "execution_status",
      ),
      "NOT_EXECUTED",
    ) !== "EXECUTED" &&
    shouldForceExecuteApprovedRequest(approvalItem)
  ) {
    const execution = await executeUnifiedApprovalRequest(requestId, {
      executedByUserId: userId,
    });
    approvalItem = execution.item || approvalItem;
    result = {
      ...result,
      item: approvalItem,
      execution_result:
        execution.execution_result || result.execution_result || null,
      idempotent: Boolean(result.idempotent && execution.idempotent),
    };
  }
  await syncUnifiedApprovalBridge({ tenantId, request: approvalItem });
  return {
    ...result,
    item: addGenericRequestCompatibilityAliases(result.item || approvalItem),
  };
}

/**
 * Record one reject decision on the unified approval engine, including the
 * BANK compatibility surface that now delegates through bridged requests.
 */
export async function rejectApprovalRequest({
  req,
  tenantId,
  requestId,
  userId,
  decisionComment = null,
  assertScopeAccess,
}) {
  const genericRequest = await getGenericApprovalRequestRowById({
    tenantId,
    requestId,
  });
  if (!genericRequest) {
    return rejectBankApprovalRequest({
      req,
      tenantId,
      requestId,
      userId,
      decisionComment,
      assertScopeAccess,
    });
  }

  ensureUnifiedApprovalExecutionResolversRegistered();
  assertGenericRequestScopeAccess(
    req,
    genericRequest,
    assertScopeAccess,
    "requestId",
  );
  const result = await recordDecision(
    requestId,
    userId,
    "REJECT",
    decisionComment,
  );
  await syncUnifiedApprovalBridge({
    tenantId,
    request: result.item || genericRequest,
  });
  return {
    ...result,
    item: addGenericRequestCompatibilityAliases(result.item || genericRequest),
  };
}

/**
 * Execute one final-approved approval request from the unified engine.
 */
export async function executeApprovalRequest({ tenantId, requestId, userId }) {
  const genericRequest = await getGenericApprovalRequestRowById({
    tenantId,
    requestId,
  });
  if (!genericRequest) {
    return executeBankApprovalRequest({ tenantId, requestId, userId });
  }
  ensureUnifiedApprovalExecutionResolversRegistered();
  const result = await executeUnifiedApprovalRequest(requestId, {
    executedByUserId: userId,
  });
  await syncUnifiedApprovalBridge({
    tenantId,
    request: result.item || genericRequest,
  });
  return {
    ...result,
    item: addGenericRequestCompatibilityAliases(result.item || genericRequest),
  };
}

export default {
  snapshotApprovalPolicy,
  evaluateApprovalNeed,
  submitApprovalRequest,
  submitApprovalRequestFromRoute,
  resolveApprovalPolicyScope: resolveBankApprovalPolicyScope,
  listApprovalPolicies: listBankApprovalPolicies,
  getApprovalPolicyById: getBankApprovalPolicyById,
  createApprovalPolicy: createBankApprovalPolicy,
  updateApprovalPolicy: updateBankApprovalPolicy,
  resolveApprovalRequestScope,
  listApprovalRequestRows,
  getApprovalRequestById,
  getApprovalRequestDelegationPreview,
  approveApprovalRequest,
  rejectApprovalRequest,
  executeApprovalRequest,
};
