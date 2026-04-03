import crypto from "node:crypto";
import { query, withTransaction } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import { evaluateBankApprovalNeed, snapshotBankApprovalPolicy } from "./bank.governance.service.js";
import {
  executeRequest as executeUnifiedApprovalRequest,
  recordDecision,
  registerApprovalExecutionResolver,
  submitRequest,
} from "./approval.engine.service.js";
import { ensureGenericPolicyForBankApprovalPolicy } from "./bank.approvalPolicies.service.js";

function u(value) {
  return String(value || "").trim().toUpperCase();
}

function safeJson(value) {
  return JSON.stringify(value ?? null);
}

function parseJson(value, fallback = null) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function toAmount(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(6)) : null;
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
  return Number(err?.errno) === 1062 || u(err?.code) === "ER_DUP_ENTRY";
}

function randomRequestCode() {
  return `BAR-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

function buildSyntheticTargetId(seed) {
  const hash = crypto
    .createHash("sha256")
    .update(String(seed || "BANK"))
    .digest("hex")
    .slice(0, 12);
  const parsed = Number.parseInt(hash, 16);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

function resolveUnifiedBankTargetId({
  requestInput = null,
  requestRow = null,
  targetSnapshot = null,
  actionPayload = null,
}) {
  const explicitTargetId =
    parsePositiveInt(requestInput?.targetId) ||
    parsePositiveInt(requestRow?.target_id ?? requestRow?.targetId) ||
    parsePositiveInt(targetSnapshot?.target_id) ||
    parsePositiveInt(targetSnapshot?.targetId);
  if (explicitTargetId) {
    return explicitTargetId;
  }

  // Some bank approval requests gate target-less operational actions such as
  // manual returns. The unified engine still requires a stable target id, so
  // these actions derive one deterministically from their request identity.
  return buildSyntheticTargetId(
    JSON.stringify({
      legacyRequestId:
        parsePositiveInt(requestRow?.id) || parsePositiveInt(requestRow?.requestId) || null,
      requestKey:
        String(requestInput?.requestKey || requestRow?.request_key || requestRow?.requestKey || "")
          .trim() || null,
      moduleCode: u(requestInput?.moduleCode || requestRow?.module_code || "BANK"),
      targetType: u(requestInput?.targetType || requestRow?.target_type || ""),
      actionType: u(requestInput?.actionType || requestRow?.action_type || ""),
      legalEntityId:
        parsePositiveInt(requestInput?.legalEntityId) ||
        parsePositiveInt(requestRow?.legal_entity_id) ||
        null,
      bankAccountId:
        parsePositiveInt(requestInput?.bankAccountId) ||
        parsePositiveInt(requestRow?.bank_account_id) ||
        null,
      targetSnapshot: targetSnapshot || null,
      actionPayload: actionPayload || null,
    })
  );
}

function resolveUnifiedBankRequestScope(requestRow) {
  const legalEntityId = parsePositiveInt(
    requestRow?.legal_entity_id ?? requestRow?.legalEntityId
  );
  if (legalEntityId) {
    return {
      scopeType: "LEGAL_ENTITY",
      scopeId: legalEntityId,
      legalEntityId,
    };
  }
  return {
    scopeType: "TENANT",
    scopeId:
      parsePositiveInt(requestRow?.tenant_id ?? requestRow?.tenantId) || null,
    legalEntityId: null,
  };
}

function mapLegacyLifecycleToUnifiedStatus(requestRow) {
  const legacyRequestStatus = u(requestRow?.request_status ?? requestRow?.requestStatus);
  const legacyExecutionStatus = u(
    requestRow?.execution_status ?? requestRow?.executionStatus ?? "NOT_EXECUTED"
  );

  let requestStatus = "PENDING_REVIEW";
  if (legacyRequestStatus === "REJECTED") {
    requestStatus = "REJECTED";
  } else if (["CANCELLED", "WITHDRAWN"].includes(legacyRequestStatus)) {
    requestStatus = "WITHDRAWN";
  } else if (
    ["APPROVED", "EXECUTED", "FAILED", "REVERSED"].includes(legacyRequestStatus)
  ) {
    requestStatus = "APPROVED";
  }

  let executionStatus = "NOT_EXECUTED";
  if (["EXECUTED", "FAILED", "REVERSED"].includes(legacyExecutionStatus)) {
    executionStatus = legacyExecutionStatus;
  } else if (legacyRequestStatus === "EXECUTED") {
    executionStatus = "EXECUTED";
  } else if (legacyRequestStatus === "FAILED") {
    executionStatus = "FAILED";
  } else if (legacyRequestStatus === "REVERSED") {
    executionStatus = "REVERSED";
  }

  return {
    requestStatus,
    executionStatus,
  };
}

function buildApprovalExecutionResolverKey(moduleCode, targetType, actionType) {
  return [u(moduleCode || "BANK"), u(targetType), u(actionType)].join(":");
}

let approvalExecutionResolversRegistered = false;

function buildUnifiedApprovalRequestSummary(row) {
  const approvalRequestId = parsePositiveInt(row?.generic_request_id);
  if (!approvalRequestId) {
    return null;
  }
  return {
    id: approvalRequestId,
    requestCode: row.approval_request_code || null,
    requestStatus: u(row.approval_request_status) || null,
    executionStatus: u(row.approval_execution_status || "NOT_EXECUTED"),
    currentStepNo: Number(row.approval_current_step_no || 1),
    scopeType: u(row.approval_scope_type) || null,
    scopeId: parsePositiveInt(row.approval_scope_id),
    submittedByUserId: parsePositiveInt(row.approval_submitted_by_user_id),
    executedByUserId: parsePositiveInt(row.approval_executed_by_user_id),
    submittedAt: row.approval_submitted_at || null,
    approvedAt: row.approval_approved_at || null,
    rejectedAt: row.approval_rejected_at || null,
    withdrawnAt: row.approval_withdrawn_at || null,
    executedAt: row.approval_executed_at || null,
    lastActivityAt: row.approval_last_activity_at || null,
    updatedAt: row.approval_updated_at || null,
    executionErrorText: row.approval_execution_error_text || null,
    escalationCount: Number(row.approval_escalation_count || 0),
    lastEscalatedAt: row.approval_last_escalated_at || null,
  };
}

function hydrateApprovalRequestRow(row) {
  if (!row) return null;
  const approvalRequest = buildUnifiedApprovalRequestSummary(row);
  return {
    ...row,
    module_code: u(row.module_code || "BANK"),
    threshold_amount: toAmount(row.threshold_amount),
    target_snapshot_json: parseJson(row.target_snapshot_json, {}),
    action_payload_json: parseJson(row.action_payload_json, null),
    policy_snapshot_json: parseJson(row.policy_snapshot_json, {}),
    execution_result_json: parseJson(row.execution_result_json, null),
    approvalRequest,
  };
}

function normalizeGenericApprovalRequestRow(row) {
  if (!row) return null;
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    requestCode: row.request_code || null,
    idempotencyKey: row.idempotency_key || null,
    policyId: parsePositiveInt(row.policy_id),
    policyVersionNo: Number(row.policy_version_no || 1),
    moduleCode: u(row.module_code),
    targetType: u(row.target_type),
    targetId: parsePositiveInt(row.target_id),
    scopeType: u(row.scope_type),
    scopeId: parsePositiveInt(row.scope_id),
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    operatingUnitId: parsePositiveInt(row.operating_unit_id),
    requestStatus: u(row.request_status),
    currentStepNo: Number(row.current_step_no || 1),
    executionStatus: u(row.execution_status || "NOT_EXECUTED"),
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

function normalizeGenericDecisionRow(row) {
  if (!row) return null;
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    requestId: parsePositiveInt(row.request_id),
    stepNo: Number(row.step_no || 1),
    decision: u(row.decision),
    decidedByUserId: parsePositiveInt(row.decided_by_user_id),
    comment: row.comment || null,
    decidedAt: row.decided_at || null,
  };
}

function mapGenericLifecycleToLegacyStatus(genericItem) {
  const requestStatus = u(genericItem?.requestStatus);
  const executionStatus = u(genericItem?.executionStatus || "NOT_EXECUTED");

  let legacyRequestStatus = "PENDING";
  if (requestStatus === "REJECTED") {
    legacyRequestStatus = "REJECTED";
  } else if (requestStatus === "WITHDRAWN") {
    legacyRequestStatus = "CANCELLED";
  } else if (executionStatus === "EXECUTED") {
    legacyRequestStatus = "EXECUTED";
  } else if (executionStatus === "FAILED") {
    legacyRequestStatus = "FAILED";
  } else if (executionStatus === "REVERSED") {
    legacyRequestStatus = "REVERSED";
  } else if (requestStatus === "APPROVED") {
    legacyRequestStatus = "APPROVED";
  }

  return {
    requestStatus: legacyRequestStatus,
    executionStatus: executionStatus || "NOT_EXECUTED",
  };
}

function resolveGenericApproverPermissionCode(row) {
  const moduleCode = u(row?.module_code || "BANK");
  const configured = String(row?.approver_permission_code || "").trim();
  if (configured) {
    return configured;
  }
  return moduleCode === "PAYROLL"
    ? "approvals.requests.approve"
    : "bank.approvals.requests.approve";
}

async function getGenericApprovalRequestRowById({
  tenantId,
  requestId,
  runQuery = query,
  forUpdate = false,
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
     LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [tenantId, normalizedRequestId]
  );
  return normalizeGenericApprovalRequestRow(res.rows?.[0] || null);
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
    [tenantId, normalizedRequestId]
  );
  return (res.rows || []).map(normalizeGenericDecisionRow);
}

async function getLegacyApprovalRequestByGenericRequestId({
  tenantId,
  genericRequestId,
  runQuery = query,
}) {
  const normalizedGenericRequestId = parsePositiveInt(genericRequestId);
  if (!normalizedGenericRequestId) {
    return null;
  }
  const res = await runQuery(
    `SELECT
        r.*,
        p.policy_code,
        p.policy_name,
        ar.request_code AS approval_request_code,
        ar.request_status AS approval_request_status,
        ar.current_step_no AS approval_current_step_no,
        ar.execution_status AS approval_execution_status,
        ar.scope_type AS approval_scope_type,
        ar.scope_id AS approval_scope_id,
        ar.submitted_by_user_id AS approval_submitted_by_user_id,
        ar.executed_by_user_id AS approval_executed_by_user_id,
        ar.submitted_at AS approval_submitted_at,
        ar.approved_at AS approval_approved_at,
        ar.rejected_at AS approval_rejected_at,
        ar.withdrawn_at AS approval_withdrawn_at,
        ar.executed_at AS approval_executed_at,
        ar.last_activity_at AS approval_last_activity_at,
        ar.updated_at AS approval_updated_at,
        ar.execution_error_text AS approval_execution_error_text,
        (
          SELECT COUNT(*)
          FROM approval_escalation_events ev
          WHERE ev.tenant_id = r.tenant_id
            AND ev.request_id = r.generic_request_id
        ) AS approval_escalation_count,
        (
          SELECT MAX(ev.created_at)
          FROM approval_escalation_events ev
          WHERE ev.tenant_id = r.tenant_id
            AND ev.request_id = r.generic_request_id
        ) AS approval_last_escalated_at
     FROM bank_approval_requests r
     JOIN bank_approval_policies p
       ON p.id = r.policy_id
     LEFT JOIN approval_requests ar
       ON ar.tenant_id = r.tenant_id
      AND ar.id = r.generic_request_id
     WHERE r.tenant_id = ?
       AND r.generic_request_id = ?
     LIMIT 1`,
    [tenantId, normalizedGenericRequestId]
  );
  return hydrateApprovalRequestRow(res.rows?.[0] || null);
}

function normalizeRequestScopeFields({
  legalEntityId = null,
  bankAccountId = null,
  thresholdAmount = null,
  currencyCode = null,
} = {}) {
  return {
    legalEntityId: parsePositiveInt(legalEntityId) || null,
    bankAccountId: parsePositiveInt(bankAccountId) || null,
    thresholdAmount: toAmount(thresholdAmount),
    currencyCode: u(currencyCode || "") || null,
  };
}

async function getBankAccountScopeInfo({ tenantId, bankAccountId, runQuery = query }) {
  const parsedId = parsePositiveInt(bankAccountId);
  if (!parsedId) return null;
  const res = await runQuery(
    `SELECT id, tenant_id, legal_entity_id
     FROM bank_accounts
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, parsedId]
  );
  return res.rows?.[0] || null;
}

async function getApprovalPolicyRow({ tenantId, policyId, runQuery = query }) {
  const res = await runQuery(
    `SELECT *
     FROM bank_approval_policies
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, policyId]
  );
  return res.rows?.[0] || null;
}

async function getApprovalPolicyByCode({ tenantId, policyCode, runQuery = query }) {
  if (!String(policyCode || "").trim()) return null;
  const res = await runQuery(
    `SELECT *
     FROM bank_approval_policies
     WHERE tenant_id = ?
       AND policy_code = ?
     LIMIT 1`,
    [tenantId, String(policyCode).trim().toUpperCase()]
  );
  return res.rows?.[0] || null;
}

async function getApprovalRequestRowById({ tenantId, requestId, runQuery = query, forUpdate = false }) {
  const res = await runQuery(
    `SELECT
        r.*,
        p.policy_code,
        p.policy_name,
        ar.request_code AS approval_request_code,
        ar.request_status AS approval_request_status,
        ar.current_step_no AS approval_current_step_no,
        ar.execution_status AS approval_execution_status,
        ar.scope_type AS approval_scope_type,
        ar.scope_id AS approval_scope_id,
        ar.submitted_by_user_id AS approval_submitted_by_user_id,
        ar.executed_by_user_id AS approval_executed_by_user_id,
        ar.submitted_at AS approval_submitted_at,
        ar.approved_at AS approval_approved_at,
        ar.rejected_at AS approval_rejected_at,
        ar.withdrawn_at AS approval_withdrawn_at,
        ar.executed_at AS approval_executed_at,
        ar.last_activity_at AS approval_last_activity_at,
        ar.updated_at AS approval_updated_at,
        ar.execution_error_text AS approval_execution_error_text,
        (
          SELECT COUNT(*)
          FROM approval_escalation_events ev
          WHERE ev.tenant_id = r.tenant_id
            AND ev.request_id = r.generic_request_id
        ) AS approval_escalation_count,
        (
          SELECT MAX(ev.created_at)
          FROM approval_escalation_events ev
          WHERE ev.tenant_id = r.tenant_id
            AND ev.request_id = r.generic_request_id
        ) AS approval_last_escalated_at
     FROM bank_approval_requests r
     JOIN bank_approval_policies p
       ON p.id = r.policy_id
     LEFT JOIN approval_requests ar
       ON ar.tenant_id = r.tenant_id
      AND ar.id = r.generic_request_id
     WHERE r.tenant_id = ?
       AND r.id = ?
     LIMIT 1
     ${forUpdate ? "FOR UPDATE" : ""}`,
    [tenantId, requestId]
  );
  return hydrateApprovalRequestRow(res.rows?.[0] || null);
}

async function getApprovalRequestByKey({ tenantId, requestKey, runQuery = query }) {
  if (!String(requestKey || "").trim()) return null;
  const res = await runQuery(
    `SELECT
        r.*,
        p.policy_code,
        p.policy_name,
        ar.request_code AS approval_request_code,
        ar.request_status AS approval_request_status,
        ar.current_step_no AS approval_current_step_no,
        ar.execution_status AS approval_execution_status,
        ar.scope_type AS approval_scope_type,
        ar.scope_id AS approval_scope_id,
        ar.submitted_by_user_id AS approval_submitted_by_user_id,
        ar.executed_by_user_id AS approval_executed_by_user_id,
        ar.submitted_at AS approval_submitted_at,
        ar.approved_at AS approval_approved_at,
        ar.rejected_at AS approval_rejected_at,
        ar.withdrawn_at AS approval_withdrawn_at,
        ar.executed_at AS approval_executed_at,
        ar.last_activity_at AS approval_last_activity_at,
        ar.updated_at AS approval_updated_at,
        ar.execution_error_text AS approval_execution_error_text,
        (
          SELECT COUNT(*)
          FROM approval_escalation_events ev
          WHERE ev.tenant_id = r.tenant_id
            AND ev.request_id = r.generic_request_id
        ) AS approval_escalation_count,
        (
          SELECT MAX(ev.created_at)
          FROM approval_escalation_events ev
          WHERE ev.tenant_id = r.tenant_id
            AND ev.request_id = r.generic_request_id
        ) AS approval_last_escalated_at
     FROM bank_approval_requests r
     JOIN bank_approval_policies p
       ON p.id = r.policy_id
     LEFT JOIN approval_requests ar
       ON ar.tenant_id = r.tenant_id
      AND ar.id = r.generic_request_id
     WHERE r.tenant_id = ?
       AND r.request_key = ?
     LIMIT 1`,
    [tenantId, String(requestKey).trim()]
  );
  return hydrateApprovalRequestRow(res.rows?.[0] || null);
}

async function listApprovalRequestDecisions({ tenantId, requestId, runQuery = query }) {
  const res = await runQuery(
    `SELECT *
     FROM bank_approval_request_decisions
     WHERE tenant_id = ?
       AND bank_approval_request_id = ?
     ORDER BY id ASC`,
    [tenantId, requestId]
  );
  return res.rows || [];
}

async function hydrateRequestForResponse({ tenantId, requestId, runQuery = query }) {
  const row = await getApprovalRequestRowById({ tenantId, requestId, runQuery });
  if (!row) return null;
  const decisions = await listApprovalRequestDecisions({ tenantId, requestId, runQuery });
  return {
    ...row,
    decisions,
    approvals_granted: decisions.filter((d) => u(d.decision) === "APPROVE").length,
    rejections_granted: decisions.filter((d) => u(d.decision) === "REJECT").length,
  };
}

async function executeApprovalAction({
  moduleCode,
  targetType,
  actionType,
  payload = {},
  tenantId,
  approvalRequestId,
  approvedByUserId,
}) {
  const normalizedModuleCode = u(moduleCode || "BANK");
  const normalizedTargetType = u(targetType);
  const normalizedActionType = u(actionType);
  const normalizedPayload = payload || {};

  if (normalizedTargetType === "PAYMENT_BATCH" && normalizedActionType === "SUBMIT_EXPORT") {
    const mod = await import("./bank.paymentFiles.service.js");
    return mod.executeApprovedPaymentBatchExportFile({
      tenantId,
      batchId: parsePositiveInt(
        normalizedPayload.batchId ?? normalizedPayload.batch_id ?? approvalRequestId
      ),
      approvalRequestId,
      approvedByUserId,
      payload: normalizedPayload,
    });
  }

  if (normalizedTargetType === "RECON_RULE" && ["CREATE", "UPDATE"].includes(normalizedActionType)) {
    const mod = await import("./bank.reconciliationRules.service.js");
    return mod.activateApprovedRuleChange({
      tenantId,
      ruleId: parsePositiveInt(normalizedPayload.ruleId ?? normalizedPayload.rule_id),
      approvalRequestId,
      approvedByUserId,
    });
  }

  if (
    normalizedTargetType === "POST_TEMPLATE" &&
    ["CREATE", "UPDATE"].includes(normalizedActionType)
  ) {
    const mod = await import("./bank.reconciliationPostingTemplates.service.js");
    return mod.activateApprovedPostingTemplateChange({
      tenantId,
      templateId: parsePositiveInt(
        normalizedPayload.templateId ?? normalizedPayload.template_id
      ),
      approvalRequestId,
      approvedByUserId,
    });
  }

  if (
    normalizedTargetType === "DIFF_PROFILE" &&
    ["CREATE", "UPDATE"].includes(normalizedActionType)
  ) {
    const mod = await import("./bank.reconciliationDifferenceProfiles.service.js");
    return mod.activateApprovedDifferenceProfileChange({
      tenantId,
      profileId: parsePositiveInt(
        normalizedPayload.profileId ?? normalizedPayload.profile_id
      ),
      approvalRequestId,
      approvedByUserId,
    });
  }

  if (normalizedTargetType === "MANUAL_RETURN" && normalizedActionType === "CREATE") {
    const mod = await import("./bank.paymentReturns.service.js");
    return mod.executeApprovedManualReturn({
      tenantId,
      approvalRequestId,
      approvedByUserId,
      payload: normalizedPayload,
    });
  }

  if (
    normalizedTargetType === "RECON_EXCEPTION_OVERRIDE" &&
    ["RESOLVE", "IGNORE"].includes(normalizedActionType)
  ) {
    const mod = await import("./bank.reconciliationExceptions.service.js");
    return mod.executeApprovedExceptionOverride({
      tenantId,
      approvalRequestId,
      approvedByUserId,
      payload: normalizedPayload,
    });
  }

  if (
    normalizedModuleCode === "PAYMENTS" &&
    normalizedTargetType === "PAYMENT_BATCH" &&
    normalizedActionType === "APPROVE"
  ) {
    const mod = await import("./payments.service.js");
    return mod.executeApprovedPaymentBatchApproval({
      tenantId,
      approvalRequestId,
      approvedByUserId,
      payload: normalizedPayload,
    });
  }

  if (
    normalizedModuleCode === "INVENTORY" &&
    normalizedTargetType === "INVENTORY_TRANSFER" &&
    normalizedActionType === "APPROVE"
  ) {
    const mod = await import("./inventory.transfer.service.js");
    return mod.executeApprovedInventoryTransferApproval({
      tenantId,
      approvalRequestId,
      approvedByUserId,
      payload: normalizedPayload,
    });
  }

  if (
    normalizedModuleCode === "PAYROLL" &&
    normalizedTargetType === "PAYROLL_MANUAL_SETTLEMENT_OVERRIDE" &&
    normalizedActionType === "APPLY"
  ) {
    const mod = await import("./payroll.settlementOverrides.service.js");
    return mod.executeApprovedPayrollManualSettlementOverride({
      tenantId,
      approvalRequestId,
      approvedByUserId,
      payload: normalizedPayload,
    });
  }

  if (
    normalizedModuleCode === "PAYROLL" &&
    normalizedTargetType === "PAYROLL_PERIOD_CLOSE" &&
    normalizedActionType === "APPROVE_CLOSE"
  ) {
    const mod = await import("./payroll.close.service.js");
    return mod.executeApprovedPayrollPeriodClose({
      tenantId,
      approvalRequestId,
      approvedByUserId,
      payload: normalizedPayload,
    });
  }

  if (
    normalizedModuleCode === "PAYROLL" &&
    normalizedTargetType === "PAYROLL_PERIOD_CLOSE" &&
    normalizedActionType === "REOPEN"
  ) {
    const mod = await import("./payroll.close.service.js");
    return mod.executeApprovedPayrollPeriodReopen({
      tenantId,
      approvalRequestId,
      approvedByUserId,
      payload: normalizedPayload,
    });
  }

  if (
    normalizedModuleCode === "LOCAL_CLOSE" &&
    normalizedTargetType === "LOCAL_CLOSE_PACK_REOPEN_REQUEST" &&
    normalizedActionType === "REOPEN"
  ) {
    const mod = await import("./local.close-reopen.service.js");
    return mod.executeApprovedLocalClosePackReopenRequest({
      tenantId,
      approvalRequestId,
      approvedByUserId,
      payload: normalizedPayload,
    });
  }

  if (
    normalizedModuleCode === "PAYROLL" &&
    normalizedTargetType === "PAYROLL_PROVIDER_IMPORT" &&
    normalizedActionType === "APPLY"
  ) {
    const mod = await import("./payroll.providers.service.js");
    return mod.executeApprovedPayrollProviderImportApply({
      tenantId,
      approvalRequestId,
      approvedByUserId,
      payload: normalizedPayload,
    });
  }

  throw conflict(
    `No approval execution resolver for ${normalizedModuleCode}/${normalizedTargetType}/${normalizedActionType}`
  );
}

/**
 * Register the bank/payroll execution resolvers used by the unified approval engine.
 */
export function ensureApprovalExecutionResolversRegistered() {
  if (approvalExecutionResolversRegistered) {
    return;
  }

  const registerResolver = (moduleCode, targetType, actionType) => {
    const resolverKey = buildApprovalExecutionResolverKey(moduleCode, targetType, actionType);
    registerApprovalExecutionResolver(resolverKey, {
      execute: async ({ request, actionPayload, executedByUserId }) =>
        executeApprovalAction({
          moduleCode,
          targetType,
          actionType,
          payload: actionPayload || {},
          tenantId: parsePositiveInt(request?.tenantId),
          approvalRequestId: parsePositiveInt(request?.id),
          approvedByUserId: executedByUserId,
        }),
    });
  };

  registerResolver("BANK", "PAYMENT_BATCH", "SUBMIT_EXPORT");
  registerResolver("PAYMENTS", "PAYMENT_BATCH", "APPROVE");
  registerResolver("INVENTORY", "INVENTORY_TRANSFER", "APPROVE");
  registerResolver("BANK", "RECON_RULE", "CREATE");
  registerResolver("BANK", "RECON_RULE", "UPDATE");
  registerResolver("BANK", "POST_TEMPLATE", "CREATE");
  registerResolver("BANK", "POST_TEMPLATE", "UPDATE");
  registerResolver("BANK", "DIFF_PROFILE", "CREATE");
  registerResolver("BANK", "DIFF_PROFILE", "UPDATE");
  registerResolver("BANK", "MANUAL_RETURN", "CREATE");
  registerResolver("BANK", "RECON_EXCEPTION_OVERRIDE", "RESOLVE");
  registerResolver("BANK", "RECON_EXCEPTION_OVERRIDE", "IGNORE");
  registerResolver("PAYROLL", "PAYROLL_MANUAL_SETTLEMENT_OVERRIDE", "APPLY");
  registerResolver("PAYROLL", "PAYROLL_PERIOD_CLOSE", "APPROVE_CLOSE");
  registerResolver("PAYROLL", "PAYROLL_PERIOD_CLOSE", "REOPEN");
  registerResolver("PAYROLL", "PAYROLL_PROVIDER_IMPORT", "APPLY");
  registerResolver("LOCAL_CLOSE", "LOCAL_CLOSE_PACK_REOPEN_REQUEST", "REOPEN");
  approvalExecutionResolversRegistered = true;
}

function inferRequestScopeFromInput({ legalEntityId = null, bankAccountId = null } = {}) {
  if (parsePositiveInt(legalEntityId)) return { legalEntityId: parsePositiveInt(legalEntityId) };
  return { legalEntityId: null };
}

async function resolvePolicyForSubmission({
  tenantId,
  moduleCode = "BANK",
  policyCode = null,
  targetType,
  actionType,
  legalEntityId = null,
  bankAccountId = null,
  thresholdAmount = null,
  currencyCode = null,
  runQuery = query,
}) {
  if (policyCode) {
    const policy = await getApprovalPolicyByCode({ tenantId, policyCode, runQuery });
    if (!policy) throw badRequest("policyCode not found");
    if (u(policy.status) !== "ACTIVE") {
      throw badRequest("policyCode must reference an ACTIVE bank approval policy");
    }
    return {
      approvalRequired: true,
      approval_required: true,
      policy,
      policySnapshot: snapshotBankApprovalPolicy(policy),
    };
  }
  return evaluateBankApprovalNeed({
    tenantId,
    moduleCode,
    targetType,
    actionType,
    legalEntityId,
    bankAccountId,
    thresholdAmount,
    currencyCode,
    runQuery,
  });
}

async function getLegacyApprovalPolicyByGenericPolicyId({
  tenantId,
  genericPolicyId,
  runQuery = query,
}) {
  const normalizedGenericPolicyId = parsePositiveInt(genericPolicyId);
  if (!normalizedGenericPolicyId) {
    return null;
  }
  const res = await runQuery(
    `SELECT *
     FROM bank_approval_policies
     WHERE tenant_id = ?
       AND generic_policy_id = ?
     LIMIT 1`,
    [tenantId, normalizedGenericPolicyId]
  );
  return res.rows?.[0] || null;
}

function buildUnifiedTargetSnapshot({
  requestInput,
  targetSnapshot,
  legalEntityId,
  bankAccountId,
  legacyPolicy,
}) {
  const moduleCode = u(requestInput?.moduleCode || legacyPolicy?.module_code || "BANK");
  const normalizedTargetSnapshot =
    targetSnapshot && typeof targetSnapshot === "object" ? { ...targetSnapshot } : {};
  return {
    ...normalizedTargetSnapshot,
    module_code: moduleCode,
    target_type: u(requestInput?.targetType),
    target_id:
      parsePositiveInt(requestInput?.targetId) ||
      parsePositiveInt(normalizedTargetSnapshot.target_id) ||
      parsePositiveInt(normalizedTargetSnapshot.targetId),
    legal_entity_id:
      parsePositiveInt(legalEntityId) ||
      parsePositiveInt(normalizedTargetSnapshot.legal_entity_id) ||
      parsePositiveInt(normalizedTargetSnapshot.legalEntityId) ||
      null,
    bank_account_id:
      parsePositiveInt(bankAccountId) ||
      parsePositiveInt(normalizedTargetSnapshot.bank_account_id) ||
      parsePositiveInt(normalizedTargetSnapshot.bankAccountId) ||
      null,
    execution_resolver_key: buildApprovalExecutionResolverKey(
      moduleCode,
      requestInput?.targetType,
      requestInput?.actionType
    ),
    legacy_bank_approval_policy_id: parsePositiveInt(legacyPolicy?.id) || null,
    legacy_bank_scope_type: u(legacyPolicy?.scope_type || "") || null,
    legacy_bank_account_id: parsePositiveInt(legacyPolicy?.bank_account_id) || null,
  };
}

async function syncLegacyDecisionRowsFromGeneric({
  tenantId,
  legacyRequestId,
  genericDecisions,
  runQuery = query,
}) {
  await runQuery(
    `DELETE FROM bank_approval_request_decisions
     WHERE tenant_id = ?
       AND bank_approval_request_id = ?`,
    [tenantId, legacyRequestId]
  );

  for (const decision of genericDecisions || []) {
    await runQuery(
      `INSERT INTO bank_approval_request_decisions (
         tenant_id,
         bank_approval_request_id,
         decided_by_user_id,
         decision,
         decision_comment,
         created_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        legacyRequestId,
        parsePositiveInt(decision.decidedByUserId),
        u(decision.decision),
        decision.comment || null,
        decision.decidedAt || new Date(),
      ]
    );
  }
}

async function syncUnifiedBankApprovalRequestFromLegacyTx({
  tenantId,
  requestRow,
  genericRequestId,
  genericPolicyId,
  runQuery = query,
}) {
  const normalizedRequestId = parsePositiveInt(genericRequestId);
  const normalizedPolicyId = parsePositiveInt(genericPolicyId);
  if (!normalizedRequestId || !normalizedPolicyId) {
    throw badRequest("Unified bank bridge sync requires generic request and policy ids");
  }

  const requestScope = resolveUnifiedBankRequestScope(requestRow);
  const targetSnapshot =
    requestRow?.target_snapshot_json && typeof requestRow.target_snapshot_json === "object"
      ? requestRow.target_snapshot_json
      : parseJson(requestRow?.target_snapshot_json, {});
  const actionPayload =
    requestRow?.action_payload_json && typeof requestRow.action_payload_json === "object"
      ? requestRow.action_payload_json
      : parseJson(requestRow?.action_payload_json, null);
  const targetId = resolveUnifiedBankTargetId({
    requestRow,
    targetSnapshot,
    actionPayload,
  });
  const lifecycle = mapLegacyLifecycleToUnifiedStatus(requestRow);
  const policySnapshot =
    requestRow?.policy_snapshot_json && typeof requestRow.policy_snapshot_json === "object"
      ? requestRow.policy_snapshot_json
      : parseJson(requestRow?.policy_snapshot_json, {});

  await runQuery(
    `UPDATE approval_requests
        SET policy_id = ?,
            policy_version_no = ?,
            module_code = ?,
            target_type = ?,
            target_id = ?,
            scope_type = ?,
            scope_id = ?,
            legal_entity_id = ?,
            operating_unit_id = NULL,
            request_status = ?,
            current_step_no = 1,
            execution_status = ?,
            submitted_by_user_id = ?,
            submitted_at = COALESCE(?, submitted_at),
            approved_at = ?,
            rejected_at = ?,
            withdrawn_at = ?,
            executed_at = ?,
            executed_by_user_id = ?,
            last_activity_at = CURRENT_TIMESTAMP,
            policy_snapshot_json = ?,
            target_snapshot_json = ?,
            action_payload_json = ?,
            execution_result_json = ?,
            execution_error_text = ?
      WHERE tenant_id = ?
        AND id = ?`,
    [
      normalizedPolicyId,
      Number(policySnapshot.version_no || policySnapshot.versionNo || 1),
      u(requestRow?.module_code || "BANK"),
      u(requestRow?.target_type),
      targetId,
      requestScope.scopeType,
      requestScope.scopeId,
      requestScope.legalEntityId || null,
      lifecycle.requestStatus,
      lifecycle.executionStatus,
      parsePositiveInt(requestRow?.requested_by_user_id),
      requestRow?.submitted_at || null,
      lifecycle.requestStatus === "APPROVED" ? requestRow?.approved_at || null : null,
      lifecycle.requestStatus === "REJECTED" ? requestRow?.rejected_at || null : null,
      lifecycle.requestStatus === "WITHDRAWN" ? requestRow?.updated_at || null : null,
      lifecycle.executionStatus === "EXECUTED" ? requestRow?.executed_at || null : null,
      lifecycle.executionStatus === "EXECUTED"
        ? parsePositiveInt(requestRow?.executed_by_user_id) || null
        : null,
      safeJson(policySnapshot || {}),
      safeJson(targetSnapshot || {}),
      safeJson(actionPayload),
      safeJson(
        requestRow?.execution_result_json && typeof requestRow.execution_result_json === "object"
          ? requestRow.execution_result_json
          : parseJson(requestRow?.execution_result_json, null)
      ),
      requestRow?.execution_error_text || null,
      tenantId,
      normalizedRequestId,
    ]
  );

  await runQuery(
    `DELETE FROM approval_decisions
      WHERE tenant_id = ?
        AND request_id = ?`,
    [tenantId, normalizedRequestId]
  );

  const legacyDecisions = await listApprovalRequestDecisions({
    tenantId,
    requestId: parsePositiveInt(requestRow?.id),
    runQuery,
  });
  for (const decisionRow of legacyDecisions) {
    // eslint-disable-next-line no-await-in-loop
    await runQuery(
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
         comment,
         decided_at
       ) VALUES (?, ?, 1, ?, ?, ?, NULL, NULL, ?, ?, ?)`,
      [
        tenantId,
        normalizedRequestId,
        u(decisionRow?.decision),
        parsePositiveInt(decisionRow?.decided_by_user_id),
        parsePositiveInt(decisionRow?.decided_by_user_id),
        parsePositiveInt(decisionRow?.decided_by_user_id),
        decisionRow?.decision_comment || null,
        decisionRow?.created_at || null,
      ]
    );
  }
}

async function ensureUnifiedBankApprovalRequestBridge({
  tenantId,
  requestId,
  runQuery = query,
}) {
  const requestRow = await getApprovalRequestRowById({
    tenantId,
    requestId,
    runQuery,
    forUpdate: true,
  });
  if (!requestRow) {
    throw notFound("Approval request not found");
  }
  if (parsePositiveInt(requestRow.generic_request_id)) {
    return requestRow;
  }

  const { genericPolicyId } = await ensureGenericPolicyForBankApprovalPolicy({
    tenantId,
    policyId: parsePositiveInt(requestRow.policy_id),
    runQuery,
  });
  const requestScope = resolveUnifiedBankRequestScope(requestRow);
  const targetSnapshot =
    requestRow?.target_snapshot_json && typeof requestRow.target_snapshot_json === "object"
      ? requestRow.target_snapshot_json
      : parseJson(requestRow?.target_snapshot_json, {});
  const actionPayload =
    requestRow?.action_payload_json && typeof requestRow.action_payload_json === "object"
      ? requestRow.action_payload_json
      : parseJson(requestRow?.action_payload_json, null);
  const targetId = resolveUnifiedBankTargetId({
    requestRow,
    targetSnapshot,
    actionPayload,
  });
  const submitResult = await submitRequest(
    genericPolicyId,
    u(requestRow.target_type),
    targetId,
    {
      tenantId,
      userId: parsePositiveInt(requestRow.requested_by_user_id),
    },
    {
      idempotencyKey:
        String(requestRow.request_key || "").trim() ||
        `BANK-LEGACY:${tenantId}:${parsePositiveInt(requestRow.id)}`,
      legalEntityId: requestScope.legalEntityId || null,
      targetSnapshot: buildUnifiedTargetSnapshot({
        requestInput: {
          moduleCode: requestRow.module_code,
          requestKey: requestRow.request_key,
          targetType: requestRow.target_type,
          targetId,
          actionType: requestRow.action_type,
        },
        targetSnapshot,
        legalEntityId: requestScope.legalEntityId,
        bankAccountId: parsePositiveInt(requestRow.bank_account_id) || null,
        legacyPolicy: {
          id: parsePositiveInt(requestRow.policy_id),
          module_code: requestRow.module_code,
          scope_type: requestRow.scope_type,
          bank_account_id: requestRow.bank_account_id,
        },
      }),
      actionPayload,
    },
    { runQuery }
  );
  const genericRequestId = parsePositiveInt(submitResult?.item?.id);
  if (!genericRequestId) {
    throw conflict("Failed to bridge bank approval request into approval_requests");
  }

  await runQuery(
    `UPDATE bank_approval_requests
        SET generic_request_id = ?
      WHERE tenant_id = ?
        AND id = ?`,
    [genericRequestId, tenantId, parsePositiveInt(requestRow.id)]
  );

  const bridgedRow = {
    ...requestRow,
    generic_request_id: genericRequestId,
  };
  await syncUnifiedBankApprovalRequestFromLegacyTx({
    tenantId,
    requestRow: bridgedRow,
    genericRequestId,
    genericPolicyId,
    runQuery,
  });

  return getApprovalRequestRowById({
    tenantId,
    requestId: parsePositiveInt(requestRow.id),
    runQuery,
  });
}

async function upsertLegacyRequestBridgeFromGeneric({
  tenantId,
  legacyPolicy,
  genericItem,
  requestKey,
  bankAccountId = null,
  thresholdAmount = null,
  currencyCode = null,
  targetSnapshot = null,
  actionPayload = null,
  policySnapshot = null,
  runQuery = query,
}) {
  const genericRequestId = parsePositiveInt(genericItem?.id);
  if (!genericRequestId) {
    throw badRequest("Generic approval request id is required");
  }
  const existing =
    (await getLegacyApprovalRequestByGenericRequestId({
      tenantId,
      genericRequestId,
      runQuery,
    })) ||
    (requestKey
      ? await getApprovalRequestByKey({
          tenantId,
          requestKey,
          runQuery,
        })
      : null);

  const lifecycle = mapGenericLifecycleToLegacyStatus(genericItem);
  const effectivePolicySnapshot = policySnapshot || genericItem?.policySnapshot || {};
  const requiredApprovals = Math.max(
    1,
    Number(
      effectivePolicySnapshot.min_approvals ||
        effectivePolicySnapshot.minApprovals ||
        effectivePolicySnapshot?.steps?.[0]?.min_approvals ||
        legacyPolicy?.required_approvals ||
        1
    )
  );
  const makerCheckerRequired = Boolean(
    effectivePolicySnapshot.maker_checker_required ?? legacyPolicy?.maker_checker_required
  );
  const approverPermissionCode =
    String(
      effectivePolicySnapshot.approver_permission_code ||
        effectivePolicySnapshot?.steps?.[0]?.required_permission_code ||
        legacyPolicy?.approver_permission_code ||
        ""
    ).trim() || resolveGenericApproverPermissionCode(legacyPolicy);
  const autoExecuteOnFinalApproval = Boolean(
    effectivePolicySnapshot.auto_execute_on_final_approval ??
      legacyPolicy?.auto_execute_on_final_approval
  );
  const effectiveBankAccountId =
    parsePositiveInt(bankAccountId) ||
    parsePositiveInt(existing?.bank_account_id) ||
    parsePositiveInt(genericItem?.targetSnapshot?.bank_account_id) ||
    parsePositiveInt(genericItem?.targetSnapshot?.bankAccountId) ||
    null;
  const effectiveThresholdAmount =
    toAmount(thresholdAmount) ??
    toAmount(existing?.threshold_amount) ??
    toAmount(genericItem?.actionPayload?.threshold_amount) ??
    toAmount(genericItem?.actionPayload?.thresholdAmount) ??
    null;
  const effectiveCurrencyCode =
    u(currencyCode || "") ||
    u(existing?.currency_code || "") ||
    u(genericItem?.actionPayload?.currency_code || "") ||
    u(genericItem?.actionPayload?.currencyCode || "") ||
    null;

  const params = [
    tenantId,
    u(genericItem.moduleCode || legacyPolicy?.module_code || "BANK"),
    genericItem.requestCode || randomRequestCode(),
    requestKey || genericItem.idempotencyKey || null,
    parsePositiveInt(legacyPolicy?.id),
    genericRequestId,
    u(genericItem.targetType),
    parsePositiveInt(genericItem.targetId),
    u(genericItem.policySnapshot?.action_type || legacyPolicy?.action_type || ""),
    lifecycle.requestStatus,
    lifecycle.executionStatus,
    parsePositiveInt(genericItem.legalEntityId) || null,
    effectiveBankAccountId,
    effectiveThresholdAmount,
    effectiveCurrencyCode,
    requiredApprovals,
    makerCheckerRequired ? 1 : 0,
    approverPermissionCode,
    autoExecuteOnFinalApproval ? 1 : 0,
    parsePositiveInt(genericItem.submittedByUserId) || null,
    genericItem.submittedAt || null,
    genericItem.approvedAt || null,
    genericItem.rejectedAt || null,
    genericItem.executedAt || null,
    parsePositiveInt(genericItem.executedByUserId) || null,
    safeJson(targetSnapshot || genericItem.targetSnapshot || null),
    safeJson(actionPayload || genericItem.actionPayload || null),
    safeJson(effectivePolicySnapshot),
    safeJson(genericItem.executionResult || null),
    genericItem.executionErrorText || null,
  ];

  let legacyRequestId = parsePositiveInt(existing?.id);
  if (legacyRequestId) {
    await runQuery(
      `UPDATE bank_approval_requests
       SET module_code = ?,
           request_code = ?,
           request_key = ?,
           policy_id = ?,
           generic_request_id = ?,
           target_type = ?,
           target_id = ?,
           action_type = ?,
           request_status = ?,
           execution_status = ?,
           legal_entity_id = ?,
           bank_account_id = ?,
           threshold_amount = ?,
           currency_code = ?,
           required_approvals = ?,
           maker_checker_required = ?,
           approver_permission_code = ?,
           auto_execute_on_final_approval = ?,
           requested_by_user_id = ?,
           submitted_at = COALESCE(?, submitted_at),
           approved_at = ?,
           rejected_at = ?,
           executed_at = ?,
           executed_by_user_id = ?,
           target_snapshot_json = ?,
           action_payload_json = ?,
           policy_snapshot_json = ?,
           execution_result_json = ?,
           execution_error_text = ?
       WHERE tenant_id = ?
         AND id = ?`,
      [...params.slice(1), tenantId, legacyRequestId]
    );
  } else {
    const insertRes = await runQuery(
      `INSERT INTO bank_approval_requests (
         tenant_id,
         module_code,
         request_code,
         request_key,
         policy_id,
         generic_request_id,
         target_type,
         target_id,
         action_type,
         request_status,
         execution_status,
         legal_entity_id,
         bank_account_id,
         threshold_amount,
         currency_code,
         required_approvals,
         maker_checker_required,
         approver_permission_code,
         auto_execute_on_final_approval,
         requested_by_user_id,
         submitted_at,
         approved_at,
         rejected_at,
         executed_at,
         executed_by_user_id,
         target_snapshot_json,
         action_payload_json,
         policy_snapshot_json,
         execution_result_json,
         execution_error_text
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params
    );
    legacyRequestId = parsePositiveInt(insertRes.rows?.insertId);
  }

  await syncLegacyDecisionRowsFromGeneric({
    tenantId,
    legacyRequestId,
    genericDecisions: genericItem?.decisions || [],
    runQuery,
  });
  return legacyRequestId;
}

/**
 * Sync one bridged generic BANK approval request back into the legacy bank audit tables.
 */
export async function syncLegacyBankApprovalRequestBridge({
  tenantId,
  genericRequestId,
  runQuery = query,
}) {
  const genericItem = await getGenericApprovalRequestRowById({
    tenantId,
    requestId: genericRequestId,
    runQuery,
  });
  if (!genericItem || u(genericItem.moduleCode) !== "BANK") {
    return null;
  }
  const genericDecisions = await listGenericApprovalDecisions({
    tenantId,
    requestId: genericRequestId,
    runQuery,
  });
  genericItem.decisions = genericDecisions;

  const legacyPolicy =
    (await getLegacyApprovalPolicyByGenericPolicyId({
      tenantId,
      genericPolicyId: genericItem.policyId,
      runQuery,
    })) ||
    (parsePositiveInt(genericItem?.targetSnapshot?.legacy_bank_approval_policy_id)
      ? await getApprovalPolicyRow({
          tenantId,
          policyId: genericItem.targetSnapshot.legacy_bank_approval_policy_id,
          runQuery,
        })
      : null);
  if (!legacyPolicy) {
    return null;
  }

  const legacyRequestId = await upsertLegacyRequestBridgeFromGeneric({
    tenantId,
    legacyPolicy,
    genericItem,
    requestKey: genericItem.idempotencyKey || null,
    bankAccountId:
      parsePositiveInt(genericItem?.targetSnapshot?.bank_account_id) ||
      parsePositiveInt(genericItem?.targetSnapshot?.bankAccountId) ||
      null,
    thresholdAmount:
      genericItem.policySnapshot?.min_amount ??
      genericItem.actionPayload?.thresholdAmount ??
      null,
    currencyCode:
      genericItem.policySnapshot?.currency_code ||
      genericItem.actionPayload?.currencyCode ||
      null,
    targetSnapshot: genericItem.targetSnapshot || null,
    actionPayload: genericItem.actionPayload || null,
    policySnapshot: legacyPolicy ? snapshotBankApprovalPolicy(legacyPolicy) : null,
    runQuery,
  });

  return hydrateRequestForResponse({
    tenantId,
    requestId: legacyRequestId,
    runQuery,
  });
}

async function submitBankApprovalRequestUnified({
  tenantId,
  userId,
  requestInput,
  snapshotBuilder = null,
  policyOverride = null,
  runQuery = query,
}) {
  ensureApprovalExecutionResolversRegistered();
  const normalized = normalizeRequestScopeFields({
    legalEntityId: requestInput.legalEntityId,
    bankAccountId: requestInput.bankAccountId,
    thresholdAmount: requestInput.thresholdAmount,
    currencyCode: requestInput.currencyCode,
  });

  let legalEntityId = normalized.legalEntityId;
  if (!legalEntityId && normalized.bankAccountId) {
    const bankAccount = await getBankAccountScopeInfo({
      tenantId,
      bankAccountId: normalized.bankAccountId,
      runQuery,
    });
    legalEntityId = parsePositiveInt(bankAccount?.legal_entity_id) || null;
  }

  const governance =
    policyOverride ||
    (await resolvePolicyForSubmission({
      tenantId,
      moduleCode: requestInput.moduleCode || "BANK",
      policyCode: requestInput.policyCode || null,
      targetType: requestInput.targetType,
      actionType: requestInput.actionType,
      legalEntityId,
      bankAccountId: normalized.bankAccountId,
      thresholdAmount: normalized.thresholdAmount,
      currencyCode: normalized.currencyCode,
      runQuery,
    }));

  if (!governance?.approvalRequired && !governance?.approval_required) {
    return { approval_required: false, approvalRequired: false, item: null };
  }

  const legacyPolicy = governance.policy;
  if (!legacyPolicy) {
    throw badRequest("Applicable approval policy not found");
  }

  const { genericPolicyId } = await ensureGenericPolicyForBankApprovalPolicy({
    tenantId,
    policyId: parsePositiveInt(legacyPolicy.id),
    runQuery,
  });
  const legacyPolicySnapshot =
    governance.policySnapshot || snapshotBankApprovalPolicy(legacyPolicy);
  const rawTargetSnapshot =
    typeof snapshotBuilder === "function"
      ? (await snapshotBuilder()) || {}
      : requestInput.targetSnapshot || requestInput.target_snapshot || {};
  const targetSnapshot = buildUnifiedTargetSnapshot({
    requestInput,
    targetSnapshot: rawTargetSnapshot,
    legalEntityId,
    bankAccountId: normalized.bankAccountId,
    legacyPolicy,
  });
  const targetId = resolveUnifiedBankTargetId({
    requestInput,
    targetSnapshot,
    actionPayload: requestInput.actionPayload ?? requestInput.action_payload ?? null,
  });
  const submitRes = await submitRequest(
    genericPolicyId,
    requestInput.targetType,
    targetId,
    { tenantId, userId },
    {
      idempotencyKey: String(requestInput.requestKey || "").trim() || null,
      legalEntityId,
      targetSnapshot,
      actionPayload: requestInput.actionPayload ?? requestInput.action_payload ?? null,
    },
    { runQuery }
  );
  const genericItem = {
    ...(submitRes.item || {}),
    decisions: Array.isArray(submitRes.item?.decisions) ? submitRes.item.decisions : [],
  };
  const legacyRequestId = await upsertLegacyRequestBridgeFromGeneric({
    tenantId,
    legacyPolicy,
    genericItem,
    requestKey: String(requestInput.requestKey || "").trim() || null,
    bankAccountId: normalized.bankAccountId,
    thresholdAmount: normalized.thresholdAmount,
    currencyCode: normalized.currencyCode,
    targetSnapshot,
    actionPayload: requestInput.actionPayload ?? requestInput.action_payload ?? null,
    policySnapshot: legacyPolicySnapshot,
    runQuery,
  });

  return {
    approval_required: true,
    approvalRequired: true,
    idempotent: Boolean(submitRes.idempotent),
    item: await getApprovalRequestRowById({
      tenantId,
      requestId: legacyRequestId,
      runQuery,
    }),
  };
}

export async function resolveBankApprovalRequestScope(requestId, tenantId) {
  const parsedRequestId = parsePositiveInt(requestId);
  const parsedTenantId = parsePositiveInt(tenantId);
  if (!parsedRequestId || !parsedTenantId) return null;
  const row = await getApprovalRequestRowById({ tenantId: parsedTenantId, requestId: parsedRequestId });
  if (!row) return null;
  if (parsePositiveInt(row.legal_entity_id)) {
    return { scopeType: "LEGAL_ENTITY", scopeId: parsePositiveInt(row.legal_entity_id) };
  }
  return null;
}

/**
 * List one tenant's compatibility bank approval requests, including the bridged
 * unified approval summary when a generic request exists.
 */
export async function listBankApprovalRequestRows({
  req,
  tenantId,
  filters,
  buildScopeFilter,
  assertScopeAccess,
}) {
  const params = [tenantId];
  const where = ["r.tenant_id = ?"];
  if (typeof buildScopeFilter === "function") {
    where.push(buildScopeFilter(req, "legal_entity", "r.legal_entity_id", params));
  }
  if (filters.requestStatus) {
    where.push("r.request_status = ?");
    params.push(filters.requestStatus);
  }
  if (filters.moduleCode) {
    where.push("COALESCE(r.module_code, 'BANK') = ?");
    params.push(u(filters.moduleCode));
  }
  if (filters.targetType) {
    where.push("r.target_type = ?");
    params.push(filters.targetType);
  }
  if (filters.actionType) {
    where.push("r.action_type = ?");
    params.push(filters.actionType);
  }
  if (filters.mineOnly) {
    where.push("r.requested_by_user_id = ?");
    params.push(parsePositiveInt(req?.user?.userId) || -1);
  }

  const whereSql = where.join(" AND ");
  const countRes = await query(
    `SELECT COUNT(*) AS total
     FROM bank_approval_requests r
     WHERE ${whereSql}`,
    params
  );
  const total = Number(countRes.rows?.[0]?.total || 0);
  const safeLimit = Number.isInteger(filters.limit) && filters.limit > 0 ? filters.limit : 100;
  const safeOffset = Number.isInteger(filters.offset) && filters.offset >= 0 ? filters.offset : 0;
  const listRes = await query(
    `SELECT
        r.*,
        p.policy_code,
        p.policy_name,
        ar.request_code AS approval_request_code,
        ar.request_status AS approval_request_status,
        ar.current_step_no AS approval_current_step_no,
        ar.execution_status AS approval_execution_status,
        ar.scope_type AS approval_scope_type,
        ar.scope_id AS approval_scope_id,
        ar.submitted_by_user_id AS approval_submitted_by_user_id,
        ar.executed_by_user_id AS approval_executed_by_user_id,
        ar.submitted_at AS approval_submitted_at,
        ar.approved_at AS approval_approved_at,
        ar.rejected_at AS approval_rejected_at,
        ar.withdrawn_at AS approval_withdrawn_at,
        ar.executed_at AS approval_executed_at,
        ar.last_activity_at AS approval_last_activity_at,
        ar.updated_at AS approval_updated_at,
        ar.execution_error_text AS approval_execution_error_text,
        (
          SELECT COUNT(*)
          FROM bank_approval_request_decisions d
          WHERE d.tenant_id = r.tenant_id
            AND d.bank_approval_request_id = r.id
            AND d.decision = 'APPROVE'
        ) AS approve_count,
        (
          SELECT COUNT(*)
          FROM bank_approval_request_decisions d
          WHERE d.tenant_id = r.tenant_id
            AND d.bank_approval_request_id = r.id
            AND d.decision = 'REJECT'
        ) AS reject_count,
        (
          SELECT COUNT(*)
          FROM approval_escalation_events ev
          WHERE ev.tenant_id = r.tenant_id
            AND ev.request_id = r.generic_request_id
        ) AS approval_escalation_count,
        (
          SELECT MAX(ev.created_at)
          FROM approval_escalation_events ev
          WHERE ev.tenant_id = r.tenant_id
            AND ev.request_id = r.generic_request_id
        ) AS approval_last_escalated_at
     FROM bank_approval_requests r
     JOIN bank_approval_policies p
       ON p.id = r.policy_id
     LEFT JOIN approval_requests ar
       ON ar.tenant_id = r.tenant_id
      AND ar.id = r.generic_request_id
     WHERE ${whereSql}
     ORDER BY
       CASE r.request_status WHEN 'PENDING' THEN 0 WHEN 'APPROVED' THEN 1 ELSE 2 END,
       r.id DESC
     LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    params
  );

  return {
    rows: (listRes.rows || []).map((row) => ({
      ...hydrateApprovalRequestRow(row),
      approve_count: Number(row.approve_count || 0),
      reject_count: Number(row.reject_count || 0),
    })),
    total,
    limit: filters.limit,
    offset: filters.offset,
  };
}

/**
 * Read one compatibility bank approval request with its bridged unified
 * approval summary when available.
 */
export async function getBankApprovalRequestById({
  req,
  tenantId,
  requestId,
  assertScopeAccess,
}) {
  const row = await getApprovalRequestRowById({ tenantId, requestId });
  if (!row) throw badRequest("Approval request not found");
  if (parsePositiveInt(row.legal_entity_id)) {
    assertScopeAccess(req, "legal_entity", row.legal_entity_id, "requestId");
  }
  const decisions = await listApprovalRequestDecisions({ tenantId, requestId });
  return {
    ...row,
    decisions,
    approvals_granted: decisions.filter((d) => u(d.decision) === "APPROVE").length,
    rejections_granted: decisions.filter((d) => u(d.decision) === "REJECT").length,
  };
}

/**
 * Submit one bank approval request through the unified engine and mirror it into
 * the legacy bank audit tables.
 */
export async function submitBankApprovalRequest({
  tenantId,
  userId,
  requestInput,
  snapshotBuilder = null,
  policyOverride = null,
  runQuery = query,
}) {
  return submitBankApprovalRequestUnified({
    tenantId,
    userId,
    requestInput,
    snapshotBuilder,
    policyOverride,
    runQuery,
  });
}

/**
 * Submit one bank approval request from the bank route surface with scope assertions.
 */
export async function submitBankApprovalRequestFromRoute({
  req,
  tenantId,
  userId,
  input,
  assertScopeAccess,
}) {
  const bankAccount = input.bankAccountId
    ? await getBankAccountScopeInfo({ tenantId, bankAccountId: input.bankAccountId })
    : null;
  const legalEntityId = parsePositiveInt(input.legalEntityId) || parsePositiveInt(bankAccount?.legal_entity_id) || null;
  if (legalEntityId && typeof assertScopeAccess === "function") {
    assertScopeAccess(req, "legal_entity", legalEntityId, input.bankAccountId ? "bankAccountId" : "legalEntityId");
  }
  const result = await submitBankApprovalRequest({
    tenantId,
    userId,
    requestInput: {
      ...input,
      moduleCode: input.moduleCode || "BANK",
      legalEntityId,
      bankAccountId: input.bankAccountId || null,
      thresholdAmount: input.thresholdAmount ?? null,
      currencyCode: input.currencyCode || null,
      targetSnapshot: input.targetSnapshot || {
        module_code: input.moduleCode || "BANK",
        target_type: input.targetType,
        target_id: input.targetId || null,
      },
    },
    snapshotBuilder: async () =>
      input.targetSnapshot || {
        module_code: input.moduleCode || "BANK",
        target_type: input.targetType,
        target_id: input.targetId || null,
      },
  });

  if (!result.approval_required) {
    throw badRequest("No active approval policy matched for the submitted request");
  }
  return result;
}

/**
 * Execute one bank approval request through its unified approval-request bridge.
 */
export async function executeBankApprovalRequest({
  tenantId,
  requestId,
  userId,
}) {
  const bridged = await withTransaction(async (tx) =>
    ensureUnifiedBankApprovalRequestBridge({
      tenantId,
      requestId,
      runQuery: tx.query,
    })
  );
  if (!parsePositiveInt(bridged?.generic_request_id)) {
    throw conflict("Bank approval request is missing its unified approval bridge");
  }

  ensureApprovalExecutionResolversRegistered();
  const execution = await executeUnifiedApprovalRequest(
    parsePositiveInt(bridged.generic_request_id),
    { executedByUserId: userId }
  );
  const item = await syncLegacyBankApprovalRequestBridge({
    tenantId,
    genericRequestId: parsePositiveInt(bridged.generic_request_id),
  });
  return {
    item,
    execution_result: execution?.execution_result || item?.execution_result_json || null,
    idempotent: Boolean(execution?.idempotent),
  };
}

/**
 * Approve one bank approval request through its unified approval-request bridge.
 */
export async function approveBankApprovalRequest({
  req,
  tenantId,
  requestId,
  userId,
  decisionComment = null,
  assertScopeAccess,
}) {
  const bridgedRow = await withTransaction(async (tx) =>
    ensureUnifiedBankApprovalRequestBridge({
      tenantId,
      requestId,
      runQuery: tx.query,
    })
  );
  if (parsePositiveInt(bridgedRow?.legal_entity_id)) {
    assertScopeAccess(req, "legal_entity", bridgedRow.legal_entity_id, "requestId");
  }
  if (!parsePositiveInt(bridgedRow?.generic_request_id)) {
    throw conflict("Bank approval request is missing its unified approval bridge");
  }

  ensureApprovalExecutionResolversRegistered();
  const genericRequest = await getGenericApprovalRequestRowById({
    tenantId,
    requestId: bridgedRow.generic_request_id,
  });
  if (!genericRequest) {
    throw notFound("Unified approval request not found");
  }
  if (genericRequest.requestStatus === "REJECTED") {
    throw conflict("Rejected approval request cannot be approved");
  }
  if (genericRequest.requestStatus === "WITHDRAWN") {
    throw conflict("Cancelled approval request cannot be approved");
  }
  if (
    genericRequest.executionStatus === "EXECUTED" ||
    genericRequest.requestStatus === "APPROVED"
  ) {
    const item = await syncLegacyBankApprovalRequestBridge({
      tenantId,
      genericRequestId: parsePositiveInt(bridgedRow.generic_request_id),
    });
    return {
      item,
      execution_result: item?.execution_result_json || null,
      idempotent: true,
    };
  }

  const result = await recordDecision(
    parsePositiveInt(bridgedRow.generic_request_id),
    userId,
    "APPROVE",
    decisionComment
  );
  const item = await syncLegacyBankApprovalRequestBridge({
    tenantId,
    genericRequestId: parsePositiveInt(bridgedRow.generic_request_id),
  });
  return {
    item,
    execution_result: result?.execution_result || item?.execution_result_json || null,
    idempotent: Boolean(result?.idempotent),
  };
}

/**
 * Reject one bank approval request through its unified approval-request bridge.
 */
export async function rejectBankApprovalRequest({
  req,
  tenantId,
  requestId,
  userId,
  decisionComment = null,
  assertScopeAccess,
}) {
  const bridgedRow = await withTransaction(async (tx) =>
    ensureUnifiedBankApprovalRequestBridge({
      tenantId,
      requestId,
      runQuery: tx.query,
    })
  );
  if (parsePositiveInt(bridgedRow?.legal_entity_id)) {
    assertScopeAccess(req, "legal_entity", bridgedRow.legal_entity_id, "requestId");
  }
  if (!parsePositiveInt(bridgedRow?.generic_request_id)) {
    throw conflict("Bank approval request is missing its unified approval bridge");
  }

  ensureApprovalExecutionResolversRegistered();
  const genericRequest = await getGenericApprovalRequestRowById({
    tenantId,
    requestId: bridgedRow.generic_request_id,
  });
  if (!genericRequest) {
    throw notFound("Unified approval request not found");
  }
  if (
    genericRequest.executionStatus === "EXECUTED" ||
    genericRequest.requestStatus === "APPROVED"
  ) {
    throw conflict("Executed or finally approved approval request cannot be rejected");
  }
  if (genericRequest.requestStatus === "REJECTED") {
    const item = await syncLegacyBankApprovalRequestBridge({
      tenantId,
      genericRequestId: parsePositiveInt(bridgedRow.generic_request_id),
    });
    return {
      item,
      idempotent: true,
    };
  }

  const result = await recordDecision(
    parsePositiveInt(bridgedRow.generic_request_id),
    userId,
    "REJECT",
    decisionComment
  );
  const item = await syncLegacyBankApprovalRequestBridge({
    tenantId,
    genericRequestId: parsePositiveInt(bridgedRow.generic_request_id),
  });
  return {
    item,
    idempotent: Boolean(result?.idempotent),
  };
}

export default {
  ensureApprovalExecutionResolversRegistered,
  syncLegacyBankApprovalRequestBridge,
  resolveBankApprovalRequestScope,
  listBankApprovalRequestRows,
  getBankApprovalRequestById,
  submitBankApprovalRequest,
  submitBankApprovalRequestFromRoute,
  approveBankApprovalRequest,
  rejectBankApprovalRequest,
  executeBankApprovalRequest,
};
