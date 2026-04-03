import { query, withTransaction } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import { assertPayrollPeriodActionAllowed } from "./payroll.close.service.js";
import { evaluateApprovalNeed, submitApprovalRequest } from "./approvalPolicies.service.js";
import { executeRequest, recordDecision } from "./approval.engine.service.js";
import { assertSoD } from "./sod.service.js";

const EPSILON = 0.000001;

function normalizeUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function toAmount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Number(parsed.toFixed(6));
}

function amountString(value) {
  return toAmount(value).toFixed(6);
}

function safeJson(value) {
  return JSON.stringify(value ?? null);
}

function buildApprovalRequestSummary(row, prefix = "approval_") {
  const approvalRequestId = parsePositiveInt(row?.[`${prefix}request_id`]);
  if (!approvalRequestId) {
    return null;
  }
  return {
    id: approvalRequestId,
    requestCode: row?.[`${prefix}request_code`] || null,
    requestStatus: normalizeUpperText(row?.[`${prefix}request_status`]) || null,
    executionStatus: normalizeUpperText(row?.[`${prefix}execution_status`]) || null,
    currentStepNo: Number(row?.[`${prefix}current_step_no`] || 1),
    scopeType: normalizeUpperText(row?.[`${prefix}scope_type`]) || null,
    scopeId: parsePositiveInt(row?.[`${prefix}scope_id`]),
    submittedByUserId: parsePositiveInt(row?.[`${prefix}submitted_by_user_id`]),
    executedByUserId: parsePositiveInt(row?.[`${prefix}executed_by_user_id`]),
    submittedAt: row?.[`${prefix}submitted_at`] || null,
    approvedAt: row?.[`${prefix}approved_at`] || null,
    rejectedAt: row?.[`${prefix}rejected_at`] || null,
    withdrawnAt: row?.[`${prefix}withdrawn_at`] || null,
    executedAt: row?.[`${prefix}executed_at`] || null,
    executionErrorText: row?.[`${prefix}execution_error_text`] || null,
  };
}

function toDateTimeString(value) {
  if (!value) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)) {
      return trimmed;
    }
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 19).replace("T", " ");
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 19).replace("T", " ");
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 19).replace("T", " ");
}

function makeNotFound(message) {
  const err = new Error(message);
  err.status = 404;
  return err;
}

function makeConflict(message) {
  const err = new Error(message);
  err.status = 409;
  return err;
}

function normalizeOwnershipScope(value) {
  const normalized = normalizeUpperText(value);
  return normalized === "CENTRAL" || normalized === "OPERATING_UNIT" ? normalized : null;
}

function formatOwnerContextLabel(row) {
  const ownershipScope = normalizeOwnershipScope(row?.ownership_scope);
  if (ownershipScope === "CENTRAL") {
    return "CENTRAL";
  }
  if (ownershipScope === "OPERATING_UNIT") {
    return (
      String(row?.operating_unit_code || "").trim() ||
      String(row?.operating_unit_name || "").trim() ||
      `OU#${parsePositiveInt(row?.operating_unit_id) || "?"}`
    );
  }
  return "UNRESOLVED";
}

function buildOwnerContext(row) {
  return {
    ownership_scope: normalizeOwnershipScope(row?.ownership_scope),
    operating_unit_id: parsePositiveInt(row?.operating_unit_id) || null,
    operating_unit_code: String(row?.operating_unit_code || "").trim() || null,
    operating_unit_name: String(row?.operating_unit_name || "").trim() || null,
    owner_context_label: formatOwnerContextLabel(row),
  };
}

function mapManualSettlementLiabilityRow(row) {
  if (!row) return null;
  const ownerContext = buildOwnerContext(row);
  return {
    id: parsePositiveInt(row.id),
    run_id: parsePositiveInt(row.run_id),
    legal_entity_id: parsePositiveInt(row.legal_entity_id),
    liability_type: row.liability_type || null,
    liability_group: row.liability_group || null,
    ownership_scope: ownerContext.ownership_scope,
    operating_unit_id: ownerContext.operating_unit_id,
    operating_unit_code: ownerContext.operating_unit_code,
    operating_unit_name: ownerContext.operating_unit_name,
    owner_context_label: ownerContext.owner_context_label,
    owner_context: ownerContext,
    employee_code: row.employee_code || null,
    employee_name: row.employee_name || null,
    beneficiary_name: row.beneficiary_name || null,
    amount: toAmount(row.amount),
    currency_code: normalizeUpperText(row.currency_code),
    status: normalizeUpperText(row.status),
    settled_amount: toAmount(row.settled_amount),
    outstanding_amount: toAmount(
      row.outstanding_amount ?? toAmount(row.amount) - toAmount(row.settled_amount)
    ),
    payment_link_id: parsePositiveInt(row.link_id),
    payment_batch_id: parsePositiveInt(row.payment_batch_id),
    payment_batch_line_id: parsePositiveInt(row.payment_batch_line_id),
    allocated_amount: toAmount(row.allocated_amount),
    link_status: row.link_status || null,
    link_settled_amount: toAmount(row.link_settled_amount),
  };
}

function mapManualSettlementRequestRow(row, fallbackLiabilityRow = null) {
  if (!row) return null;
  const ownerContextSource =
    normalizeOwnershipScope(row?.ownership_scope) || parsePositiveInt(row?.operating_unit_id)
      ? row
      : fallbackLiabilityRow;
  const ownerContext = buildOwnerContext(ownerContextSource || {});
  return {
    id: parsePositiveInt(row.id),
    tenant_id: parsePositiveInt(row.tenant_id),
    legal_entity_id: parsePositiveInt(row.legal_entity_id),
    run_id: parsePositiveInt(row.run_id),
    payroll_liability_id: parsePositiveInt(row.payroll_liability_id),
    payroll_liability_payment_link_id: parsePositiveInt(row.payroll_liability_payment_link_id),
    request_type: row.request_type || null,
    requested_amount: toAmount(row.requested_amount),
    currency_code: normalizeUpperText(row.currency_code),
    settled_at: row.settled_at || null,
    reason: row.reason || null,
    external_ref: row.external_ref || null,
    status: normalizeUpperText(row.status),
    idempotency_key: row.idempotency_key || null,
    requested_by_user_id: parsePositiveInt(row.requested_by_user_id),
    requested_at: row.requested_at || null,
    approved_by_user_id: parsePositiveInt(row.approved_by_user_id),
    approved_at: row.approved_at || null,
    rejected_by_user_id: parsePositiveInt(row.rejected_by_user_id),
    rejected_at: row.rejected_at || null,
    decision_note: row.decision_note || null,
    applied_settlement_id: parsePositiveInt(row.applied_settlement_id),
    approval_request_id: parsePositiveInt(row.approval_request_id),
    approvalRequestId: parsePositiveInt(row.approval_request_id),
    approvalRequest: buildApprovalRequestSummary(row),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    liability_type: row.liability_type || null,
    liability_group: row.liability_group || null,
    ownership_scope: ownerContext.ownership_scope,
    operating_unit_id: ownerContext.operating_unit_id,
    operating_unit_code: ownerContext.operating_unit_code,
    operating_unit_name: ownerContext.operating_unit_name,
    owner_context_label: ownerContext.owner_context_label,
    owner_context: ownerContext,
    employee_code: row.employee_code || null,
    employee_name: row.employee_name || null,
    beneficiary_name: row.beneficiary_name || null,
  };
}

function mapManualSettlementSettlementRow(row, ownerContextRow = null) {
  if (!row) return null;
  const ownerContext = buildOwnerContext(ownerContextRow || {});
  return {
    ...row,
    ownership_scope: ownerContext.ownership_scope,
    operating_unit_id: ownerContext.operating_unit_id,
    operating_unit_code: ownerContext.operating_unit_code,
    operating_unit_name: ownerContext.operating_unit_name,
    owner_context_label: ownerContext.owner_context_label,
    owner_context: ownerContext,
  };
}

function noopScopeAccess() {
  return true;
}

async function writeLiabilityAudit({
  tenantId,
  legalEntityId,
  runId,
  liabilityId = null,
  action,
  payload = null,
  userId = null,
  runQuery = query,
}) {
  await runQuery(
    `INSERT INTO payroll_liability_audit (
        tenant_id, legal_entity_id, run_id, payroll_liability_id, action, payload_json, acted_by_user_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [tenantId, legalEntityId, runId, liabilityId, action, safeJson(payload), userId]
  );
}

async function getLiabilityScopeRow({ tenantId, liabilityId, runQuery = query }) {
  const result = await runQuery(
    `SELECT id, tenant_id, legal_entity_id
     FROM payroll_run_liabilities
     WHERE tenant_id = ? AND id = ?
     LIMIT 1`,
    [tenantId, liabilityId]
  );
  return result.rows?.[0] || null;
}

async function getOverrideRequestScopeRow({ tenantId, requestId, runQuery = query }) {
  const result = await runQuery(
    `SELECT id, tenant_id, legal_entity_id
     FROM payroll_liability_override_requests
     WHERE tenant_id = ? AND id = ?
     LIMIT 1`,
    [tenantId, requestId]
  );
  return result.rows?.[0] || null;
}

async function getLiabilityWithLatestActiveLink({
  tenantId,
  liabilityId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
        l.id,
        l.tenant_id,
        l.legal_entity_id,
        l.run_id,
        l.liability_type,
        l.liability_group,
        l.ownership_scope,
        l.operating_unit_id,
        ou.code AS operating_unit_code,
        ou.name AS operating_unit_name,
        l.employee_code,
        l.employee_name,
        l.beneficiary_name,
        l.amount,
        l.currency_code,
        l.status,
        l.reserved_payment_batch_id,
        l.settled_amount,
        l.outstanding_amount,
        l.paid_payment_batch_id,
        l.paid_payment_batch_line_id,
        l.paid_bank_statement_line_id,
        pl.id AS link_id,
        pl.payment_batch_id,
        pl.payment_batch_line_id,
        pl.allocated_amount,
        pl.settled_amount AS link_settled_amount,
        pl.status AS link_status,
        pl.settled_at AS link_settled_at
     FROM payroll_run_liabilities l
     LEFT JOIN payroll_liability_payment_links pl
       ON pl.tenant_id = l.tenant_id
      AND pl.legal_entity_id = l.legal_entity_id
      AND pl.run_id = l.run_id
      AND pl.payroll_liability_id = l.id
      AND pl.id = (
        SELECT pl2.id
        FROM payroll_liability_payment_links pl2
        WHERE pl2.tenant_id = l.tenant_id
          AND pl2.legal_entity_id = l.legal_entity_id
          AND pl2.run_id = l.run_id
          AND pl2.payroll_liability_id = l.id
          AND pl2.status IN ('LINKED','PARTIALLY_PAID','PAID')
        ORDER BY pl2.id DESC
        LIMIT 1
      )
     LEFT JOIN operating_units ou
       ON ou.id = l.operating_unit_id
      AND ou.tenant_id = l.tenant_id
     WHERE l.tenant_id = ? AND l.id = ?
     LIMIT 1`,
    [tenantId, liabilityId]
  );
  return result.rows?.[0] || null;
}

async function getOverrideRequestById({ tenantId, requestId, runQuery = query }) {
  const result = await runQuery(
    `SELECT
        r.*,
        ar.id AS approval_request_id,
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
        ar.execution_error_text AS approval_execution_error_text,
        l.run_id,
        l.legal_entity_id,
        l.liability_type,
        l.liability_group,
        l.ownership_scope,
        l.operating_unit_id,
        ou.code AS operating_unit_code,
        ou.name AS operating_unit_name,
        l.employee_code,
        l.employee_name,
        l.beneficiary_name
     FROM payroll_liability_override_requests r
     JOIN payroll_run_liabilities l
       ON l.tenant_id = r.tenant_id
      AND l.legal_entity_id = r.legal_entity_id
      AND l.id = r.payroll_liability_id
     LEFT JOIN approval_requests ar
       ON ar.tenant_id = r.tenant_id
      AND ar.id = r.approval_request_id
     LEFT JOIN operating_units ou
       ON ou.id = l.operating_unit_id
      AND ou.tenant_id = l.tenant_id
     WHERE r.tenant_id = ? AND r.id = ?
     LIMIT 1`,
    [tenantId, requestId]
  );
  return result.rows?.[0] || null;
}

async function getOverrideRequestByApprovalRequestId({
  tenantId,
  approvalRequestId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT id
       FROM payroll_liability_override_requests
      WHERE tenant_id = ?
        AND approval_request_id = ?
      LIMIT 1`,
    [tenantId, approvalRequestId]
  );
  const requestId = parsePositiveInt(result.rows?.[0]?.id);
  if (!requestId) {
    return null;
  }
  return getOverrideRequestById({
    tenantId,
    requestId,
    runQuery,
  });
}

async function getPayrollRunPeriodRow({ tenantId, legalEntityId, runId, runQuery = query }) {
  const result = await runQuery(
    `SELECT id, tenant_id, legal_entity_id, payroll_period
     FROM payroll_runs
     WHERE tenant_id = ? AND legal_entity_id = ? AND id = ?
     LIMIT 1`,
    [tenantId, legalEntityId, runId]
  );
  return result.rows?.[0] || null;
}

async function listOverrideRequestsForLiability({
  tenantId,
  legalEntityId,
  liabilityId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
        r.id,
        r.tenant_id,
        r.legal_entity_id,
        r.run_id,
        r.payroll_liability_id,
        r.payroll_liability_payment_link_id,
        r.request_type,
        r.requested_amount,
        r.currency_code,
        r.settled_at,
        r.reason,
        r.external_ref,
        r.status,
        r.idempotency_key,
        r.requested_by_user_id,
        r.requested_at,
        r.approved_by_user_id,
        r.approved_at,
        r.rejected_by_user_id,
        r.rejected_at,
        r.decision_note,
        r.applied_settlement_id,
        r.approval_request_id,
        r.created_at,
        r.updated_at,
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
        ar.execution_error_text AS approval_execution_error_text,
        l.liability_type,
        l.liability_group,
        l.ownership_scope,
        l.operating_unit_id,
        ou.code AS operating_unit_code,
        ou.name AS operating_unit_name,
        l.employee_code,
        l.employee_name,
        l.beneficiary_name
     FROM payroll_liability_override_requests r
     JOIN payroll_run_liabilities l
       ON l.tenant_id = r.tenant_id
      AND l.legal_entity_id = r.legal_entity_id
      AND l.id = r.payroll_liability_id
     LEFT JOIN approval_requests ar
       ON ar.tenant_id = r.tenant_id
      AND ar.id = r.approval_request_id
     LEFT JOIN operating_units ou
       ON ou.id = l.operating_unit_id
      AND ou.tenant_id = l.tenant_id
     WHERE r.tenant_id = ? AND r.legal_entity_id = ? AND r.payroll_liability_id = ?
     ORDER BY r.id DESC`,
    [tenantId, legalEntityId, liabilityId]
  );
  return result.rows || [];
}

function derivePartialSettlementState({
  liabilityAmount,
  currentLiabilitySettled,
  linkAllocatedAmount,
  currentLinkSettled,
  deltaAmount,
}) {
  const liabilityAmt = toAmount(liabilityAmount);
  const liabSettled = toAmount(currentLiabilitySettled);
  const linkAllocated = toAmount(linkAllocatedAmount || liabilityAmount);
  const linkSettled = toAmount(currentLinkSettled);
  const delta = toAmount(deltaAmount);

  const newLinkSettled = toAmount(linkSettled + delta);
  const newLiabilitySettled = toAmount(liabSettled + delta);

  if (delta <= 0) {
    throw badRequest("Settlement delta must be > 0");
  }
  if (newLinkSettled > linkAllocated + EPSILON) {
    throw makeConflict(
      `Manual settlement would over-settle payment link (allocated ${linkAllocated}, target ${newLinkSettled})`
    );
  }
  if (newLiabilitySettled > liabilityAmt + EPSILON) {
    throw makeConflict(
      `Manual settlement would over-settle payroll liability (amount ${liabilityAmt}, target ${newLiabilitySettled})`
    );
  }

  const linkOutstanding = toAmount(Math.max(0, linkAllocated - newLinkSettled));
  const liabilityOutstanding = toAmount(Math.max(0, liabilityAmt - newLiabilitySettled));

  let linkStatus = "PARTIALLY_PAID";
  if (newLinkSettled <= EPSILON) {
    linkStatus = "LINKED";
  } else if (linkOutstanding <= EPSILON) {
    linkStatus = "PAID";
  }

  let liabilityStatus = "PARTIALLY_PAID";
  if (newLiabilitySettled <= EPSILON) {
    liabilityStatus = "IN_BATCH";
  } else if (liabilityOutstanding <= EPSILON) {
    liabilityStatus = "PAID";
  }

  return {
    deltaAmount: delta,
    linkAllocated,
    newLinkSettled,
    linkOutstanding,
    linkStatus,
    newLiabilitySettled,
    liabilityOutstanding,
    liabilityStatus,
  };
}

function validateManualOverrideEligibility(liabilityRow) {
  if (!liabilityRow) {
    throw makeNotFound("Payroll liability not found");
  }
  if (!parsePositiveInt(liabilityRow.link_id)) {
    throw badRequest(
      "Manual settlement override requires liability to be linked to a payment batch"
    );
  }

  const liabilityStatus = normalizeUpperText(liabilityRow.status);
  if (!["IN_BATCH", "PARTIALLY_PAID"].includes(liabilityStatus)) {
    throw badRequest(
      "Manual settlement override is allowed only for IN_BATCH or PARTIALLY_PAID liabilities"
    );
  }

  const linkStatus = normalizeUpperText(liabilityRow.link_status);
  if (!["LINKED", "PARTIALLY_PAID", "PAID"].includes(linkStatus)) {
    throw badRequest("Manual settlement override requires an active payroll payment link");
  }
}

function computeRemainingAmounts(liabilityRow) {
  const liabilityAmount = toAmount(liabilityRow.amount);
  const liabilitySettled = toAmount(liabilityRow.settled_amount);
  const liabilityOutstanding = toAmount(
    liabilityRow.outstanding_amount ?? Math.max(0, liabilityAmount - liabilitySettled)
  );

  const linkAllocated = toAmount(liabilityRow.allocated_amount || liabilityAmount);
  const linkSettled = toAmount(liabilityRow.link_settled_amount);
  const linkOutstanding = toAmount(Math.max(0, linkAllocated - linkSettled));

  return {
    liabilityAmount,
    liabilitySettled,
    liabilityOutstanding,
    linkAllocated,
    linkSettled,
    linkOutstanding,
    effectiveRemaining: toAmount(Math.min(liabilityOutstanding, linkOutstanding)),
  };
}

async function findOverrideRequestByIdempotency({
  tenantId,
  legalEntityId,
  idempotencyKey,
  runQuery = query,
}) {
  if (!idempotencyKey) return null;
  const result = await runQuery(
    `SELECT id
     FROM payroll_liability_override_requests
     WHERE tenant_id = ? AND legal_entity_id = ? AND idempotency_key = ?
     LIMIT 1`,
    [tenantId, legalEntityId, idempotencyKey]
  );
  return result.rows?.[0] || null;
}

async function getLiabilityForUpdateTx({ tenantId, liabilityId, runQuery }) {
  const result = await runQuery(
    `SELECT *
     FROM payroll_run_liabilities
     WHERE tenant_id = ? AND id = ?
     LIMIT 1
     FOR UPDATE`,
    [tenantId, liabilityId]
  );
  return result.rows?.[0] || null;
}

async function getPaymentLinkForUpdateTx({
  tenantId,
  legalEntityId,
  runId,
  liabilityId,
  linkId,
  runQuery,
}) {
  const result = await runQuery(
    `SELECT *
     FROM payroll_liability_payment_links
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND run_id = ?
       AND payroll_liability_id = ?
       AND id = ?
     LIMIT 1
     FOR UPDATE`,
    [tenantId, legalEntityId, runId, liabilityId, linkId]
  );
  return result.rows?.[0] || null;
}

async function getOverrideRequestForUpdateTx({ tenantId, requestId, runQuery }) {
  const result = await runQuery(
    `SELECT *
     FROM payroll_liability_override_requests
     WHERE tenant_id = ? AND id = ?
     LIMIT 1
     FOR UPDATE`,
    [tenantId, requestId]
  );
  return result.rows?.[0] || null;
}

async function getSettlementById({ tenantId, legalEntityId, settlementId, runQuery = query }) {
  if (!settlementId) return null;
  const result = await runQuery(
    `SELECT *
     FROM payroll_liability_settlements
     WHERE tenant_id = ? AND legal_entity_id = ? AND id = ?
     LIMIT 1`,
    [tenantId, legalEntityId, settlementId]
  );
  return result.rows?.[0] || null;
}

async function getSettlementByKey({ tenantId, legalEntityId, settlementKey, runQuery = query }) {
  const result = await runQuery(
    `SELECT *
     FROM payroll_liability_settlements
     WHERE tenant_id = ? AND legal_entity_id = ? AND settlement_key = ?
     LIMIT 1`,
    [tenantId, legalEntityId, settlementKey]
  );
  return result.rows?.[0] || null;
}

async function getApprovalRequestBridgeRow({
  tenantId,
  approvalRequestId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
        id,
        request_status,
        execution_status,
        approved_at,
        rejected_at,
        executed_at,
        executed_by_user_id
     FROM approval_requests
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, approvalRequestId]
  );
  return result.rows?.[0] || null;
}

async function getLatestApprovalDecisionRow({
  approvalRequestId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT decided_by_user_id, comment, decided_at
       FROM approval_decisions
      WHERE request_id = ?
      ORDER BY id DESC
      LIMIT 1`,
    [approvalRequestId]
  );
  return result.rows?.[0] || null;
}

async function syncPayrollManualSettlementApprovalRequestBridgeTx({
  tenantId,
  approvalRequestId,
  runQuery = query,
}) {
  const requestRow = await getOverrideRequestByApprovalRequestId({
    tenantId,
    approvalRequestId,
    runQuery,
  });
  if (!requestRow) {
    return null;
  }

  const approvalRow = await getApprovalRequestBridgeRow({
    tenantId,
    approvalRequestId,
    runQuery,
  });
  if (!approvalRow) {
    return requestRow;
  }

  const latestDecision = await getLatestApprovalDecisionRow({
    approvalRequestId,
    runQuery,
  });
  let nextStatus = "REQUESTED";
  if (normalizeUpperText(approvalRow.execution_status) === "EXECUTED") {
    nextStatus = "APPLIED";
  } else if (normalizeUpperText(approvalRow.request_status) === "REJECTED") {
    nextStatus = "REJECTED";
  }

  await runQuery(
    `UPDATE payroll_liability_override_requests
        SET status = ?,
            approved_by_user_id = CASE
              WHEN ? = 'APPLIED' THEN COALESCE(approved_by_user_id, ?)
              ELSE approved_by_user_id
            END,
            approved_at = CASE
              WHEN ? = 'APPLIED' THEN COALESCE(approved_at, ?)
              ELSE approved_at
            END,
            rejected_by_user_id = CASE
              WHEN ? = 'REJECTED' THEN COALESCE(rejected_by_user_id, ?)
              ELSE rejected_by_user_id
            END,
            rejected_at = CASE
              WHEN ? = 'REJECTED' THEN COALESCE(rejected_at, ?)
              ELSE rejected_at
            END,
            decision_note = COALESCE(?, decision_note),
            approval_request_id = COALESCE(?, approval_request_id),
            updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ?
        AND id = ?`,
    [
      nextStatus,
      nextStatus,
      parsePositiveInt(approvalRow.executed_by_user_id) ||
        parsePositiveInt(latestDecision?.decided_by_user_id) ||
        null,
      nextStatus,
      approvalRow.executed_at || approvalRow.approved_at || latestDecision?.decided_at || null,
      nextStatus,
      parsePositiveInt(latestDecision?.decided_by_user_id) || null,
      nextStatus,
      approvalRow.rejected_at || latestDecision?.decided_at || null,
      latestDecision?.comment || null,
      approvalRequestId,
      tenantId,
      parsePositiveInt(requestRow.id),
    ]
  );

  return getOverrideRequestById({
    tenantId,
    requestId: parsePositiveInt(requestRow.id),
    runQuery,
  });
}

export async function resolvePayrollLiabilityScope(liabilityId, tenantId) {
  const parsedTenantId = parsePositiveInt(tenantId);
  const parsedLiabilityId = parsePositiveInt(liabilityId);
  if (!parsedTenantId || !parsedLiabilityId) return null;
  const row = await getLiabilityScopeRow({
    tenantId: parsedTenantId,
    liabilityId: parsedLiabilityId,
  });
  if (!row) return null;
  return {
    scopeType: "LEGAL_ENTITY",
    scopeId: parsePositiveInt(row.legal_entity_id),
  };
}

export async function resolvePayrollSettlementOverrideRequestScope(requestId, tenantId) {
  const parsedTenantId = parsePositiveInt(tenantId);
  const parsedRequestId = parsePositiveInt(requestId);
  if (!parsedTenantId || !parsedRequestId) return null;
  const row = await getOverrideRequestScopeRow({
    tenantId: parsedTenantId,
    requestId: parsedRequestId,
  });
  if (!row) return null;
  return {
    scopeType: "LEGAL_ENTITY",
    scopeId: parsePositiveInt(row.legal_entity_id),
  };
}

export async function listPayrollManualSettlementRequests({
  req,
  tenantId,
  liabilityId,
  assertScopeAccess,
}) {
  const liability = await getLiabilityWithLatestActiveLink({ tenantId, liabilityId });
  if (!liability) throw makeNotFound("Payroll liability not found");

  const legalEntityId = parsePositiveInt(liability.legal_entity_id);
  assertScopeAccess(req, "legal_entity", legalEntityId, "liabilityId");

  const items = await listOverrideRequestsForLiability({
    tenantId,
    legalEntityId,
    liabilityId,
  });

  return {
    liability: mapManualSettlementLiabilityRow(liability),
    items: items.map((row) => mapManualSettlementRequestRow(row, liability)),
  };
}

export async function createPayrollManualSettlementRequest({
  req,
  tenantId,
  liabilityId,
  userId,
  input,
  assertScopeAccess,
}) {
  const liability = await getLiabilityWithLatestActiveLink({ tenantId, liabilityId });
  if (!liability) throw makeNotFound("Payroll liability not found");

  const legalEntityId = parsePositiveInt(liability.legal_entity_id);
  assertScopeAccess(req, "legal_entity", legalEntityId, "liabilityId");
  validateManualOverrideEligibility(liability);

  const runPeriodRow = await getPayrollRunPeriodRow({
    tenantId,
    legalEntityId,
    runId: parsePositiveInt(liability.run_id),
  });
  await assertPayrollPeriodActionAllowed({
    tenantId,
    legalEntityId,
    payrollPeriod: runPeriodRow?.payroll_period,
    actionType: "MANUAL_SETTLEMENT_REQUEST",
  });

  const remaining = computeRemainingAmounts(liability);
  const requestedAmount = toAmount(input.amount);
  if (requestedAmount > remaining.effectiveRemaining + EPSILON) {
    throw makeConflict(
      `Requested amount exceeds remaining settleable amount (${remaining.effectiveRemaining})`
    );
  }

  if (input.idempotencyKey) {
    const existing = await findOverrideRequestByIdempotency({
      tenantId,
      legalEntityId,
      idempotencyKey: input.idempotencyKey,
    });
    if (existing?.id) {
      const existingRow = await getOverrideRequestById({
        tenantId,
        requestId: parsePositiveInt(existing.id),
      });
      return {
        request: mapManualSettlementRequestRow(existingRow, liability),
        idempotent: true,
      };
    }
  }

  const ins = await query(
    `INSERT INTO payroll_liability_override_requests (
        tenant_id, legal_entity_id, run_id,
        payroll_liability_id, payroll_liability_payment_link_id,
        requested_amount, currency_code, settled_at, reason, external_ref,
        status, idempotency_key, requested_by_user_id
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'REQUESTED', ?, ?)`,
    [
      tenantId,
      legalEntityId,
      parsePositiveInt(liability.run_id),
      liabilityId,
      parsePositiveInt(liability.link_id),
      amountString(requestedAmount),
      normalizeUpperText(liability.currency_code),
      input.settledAt,
      input.reason,
      input.externalRef || null,
      input.idempotencyKey || null,
      userId,
    ]
  );
  const requestId = parsePositiveInt(ins.rows?.insertId);
  if (!requestId) throw new Error("Failed to create manual settlement override request");

  await writeLiabilityAudit({
    tenantId,
    legalEntityId,
    runId: parsePositiveInt(liability.run_id),
    liabilityId,
    action: "MANUAL_SETTLEMENT_REQUESTED",
    payload: {
      requestId,
      requestedAmount,
      settledAt: input.settledAt,
      reason: input.reason,
      externalRef: input.externalRef || null,
      ownerContext: buildOwnerContext(liability),
    },
    userId,
  });

  const request = await getOverrideRequestById({ tenantId, requestId });
  const governance = await evaluateApprovalNeed({
    moduleCode: "PAYROLL",
    tenantId,
    targetType: "PAYROLL_MANUAL_SETTLEMENT_OVERRIDE",
    actionType: "APPLY",
    legalEntityId,
    thresholdAmount: requestedAmount,
    currencyCode: normalizeUpperText(liability.currency_code),
  });

  let refreshedRequest = request;
  if (governance?.approval_required && parsePositiveInt(governance?.policy?.id)) {
    const approvalOwnerContext = buildOwnerContext(liability);
    const submitRes = await submitApprovalRequest({
      tenantId,
      userId,
      requestInput: {
        moduleCode: "PAYROLL",
        targetType: "PAYROLL_MANUAL_SETTLEMENT_OVERRIDE",
        targetId: requestId,
        actionType: "APPLY",
        legalEntityId,
        thresholdAmount: requestedAmount,
        currencyCode: normalizeUpperText(liability.currency_code),
        actionPayload: {
          requestId,
        },
        targetSnapshot: {
          module_code: "PAYROLL",
          target_type: "PAYROLL_MANUAL_SETTLEMENT_OVERRIDE",
          target_id: requestId,
          legal_entity_id: legalEntityId,
          run_id: parsePositiveInt(liability.run_id) || null,
          payroll_liability_id: liabilityId,
          requested_amount: requestedAmount,
          currency_code: normalizeUpperText(liability.currency_code),
          status: "REQUESTED",
          ownership_scope: approvalOwnerContext.ownership_scope,
          operating_unit_id: approvalOwnerContext.operating_unit_id,
          operating_unit_code: approvalOwnerContext.operating_unit_code,
          operating_unit_name: approvalOwnerContext.operating_unit_name,
          owner_context_label: approvalOwnerContext.owner_context_label,
          owner_context: approvalOwnerContext,
        },
      },
    });

    if (submitRes?.approval_required && parsePositiveInt(submitRes?.item?.id)) {
      await query(
        `UPDATE payroll_liability_override_requests
            SET approval_request_id = ?,
                updated_at = CURRENT_TIMESTAMP
          WHERE tenant_id = ?
            AND legal_entity_id = ?
            AND id = ?`,
        [parsePositiveInt(submitRes.item.id), tenantId, legalEntityId, requestId]
      );
      refreshedRequest = await getOverrideRequestById({ tenantId, requestId });
    }
  }

  return {
    request: mapManualSettlementRequestRow(refreshedRequest, liability),
    idempotent: false,
  };
}

export async function approveApplyPayrollManualSettlementRequest({
  req,
  tenantId,
  requestId,
  userId,
  decisionNote = null,
  assertScopeAccess,
  skipUnifiedApprovalGate = false,
  approvalRequestId = null,
}) {
  if (!skipUnifiedApprovalGate) {
    const previewRequestRow = await getOverrideRequestById({ tenantId, requestId });
    if (!previewRequestRow) throw makeNotFound("Manual settlement override request not found");

    const legalEntityId = parsePositiveInt(previewRequestRow.legal_entity_id);
    assertScopeAccess(req, "legal_entity", legalEntityId, "requestId");

    const bridgedApprovalRequestId = parsePositiveInt(previewRequestRow.approval_request_id);
    if (bridgedApprovalRequestId) {
      let decisionResult = await recordDecision(
        bridgedApprovalRequestId,
        userId,
        "APPROVE",
        decisionNote || null
      );
      let approvalItem = decisionResult.item || null;
      if (
        normalizeUpperText(approvalItem?.requestStatus) === "APPROVED" &&
        normalizeUpperText(approvalItem?.executionStatus) !== "EXECUTED"
      ) {
        const executionResult = await executeRequest(bridgedApprovalRequestId, {
          executedByUserId: userId,
        });
        approvalItem = executionResult.item || approvalItem;
        decisionResult = {
          ...decisionResult,
          item: approvalItem,
          execution_result:
            executionResult.execution_result || decisionResult.execution_result || null,
        };
      }

      const syncedRequest = await syncPayrollManualSettlementApprovalRequestBridgeTx({
        tenantId,
        approvalRequestId: bridgedApprovalRequestId,
      });
      const request = mapManualSettlementRequestRow(syncedRequest || previewRequestRow);
      const settlement = await getSettlementById({
        tenantId,
        legalEntityId,
        settlementId: parsePositiveInt(
          syncedRequest?.applied_settlement_id ?? previewRequestRow.applied_settlement_id
        ),
      });
      return {
        request,
        settlement: settlement ? mapManualSettlementSettlementRow(settlement, request) : null,
        approval_request: approvalItem,
        execution_result: decisionResult.execution_result || null,
        idempotent: Boolean(decisionResult.idempotent),
      };
    }

    const requestStatus = normalizeUpperText(previewRequestRow.status);
    if (requestStatus === "REQUESTED") {
      const gov = await evaluateApprovalNeed({
        moduleCode: "PAYROLL",
        tenantId,
        targetType: "PAYROLL_MANUAL_SETTLEMENT_OVERRIDE",
        actionType: "APPLY",
        legalEntityId,
        thresholdAmount: toAmount(previewRequestRow.requested_amount),
        currencyCode: normalizeUpperText(previewRequestRow.currency_code),
      });

      if (gov?.approval_required || gov?.approvalRequired) {
        const previewOwnerContext = buildOwnerContext(previewRequestRow);
        const submitRes = await submitApprovalRequest({
          tenantId,
          userId,
          requestInput: {
            moduleCode: "PAYROLL",
            requestKey: `PRP06:OVERRIDE_APPLY:${tenantId}:${requestId}`,
            targetType: "PAYROLL_MANUAL_SETTLEMENT_OVERRIDE",
            targetId: requestId,
            actionType: "APPLY",
            legalEntityId,
            thresholdAmount: toAmount(previewRequestRow.requested_amount),
            currencyCode: normalizeUpperText(previewRequestRow.currency_code),
            actionPayload: {
              requestId,
              decisionNote: decisionNote || null,
            },
            targetSnapshot: {
              module_code: "PAYROLL",
              target_type: "PAYROLL_MANUAL_SETTLEMENT_OVERRIDE",
              target_id: requestId,
              legal_entity_id: legalEntityId,
              run_id: parsePositiveInt(previewRequestRow.run_id) || null,
              payroll_liability_id: parsePositiveInt(previewRequestRow.payroll_liability_id) || null,
              requested_amount: toAmount(previewRequestRow.requested_amount),
              currency_code: normalizeUpperText(previewRequestRow.currency_code),
              status: requestStatus,
              ownership_scope: previewOwnerContext.ownership_scope,
              operating_unit_id: previewOwnerContext.operating_unit_id,
              operating_unit_code: previewOwnerContext.operating_unit_code,
              operating_unit_name: previewOwnerContext.operating_unit_name,
              owner_context_label: previewOwnerContext.owner_context_label,
              owner_context: previewOwnerContext,
            },
          },
        });

        if (parsePositiveInt(submitRes?.item?.id)) {
          await query(
            `UPDATE payroll_liability_override_requests
                SET approval_request_id = ?,
                    updated_at = CURRENT_TIMESTAMP
              WHERE tenant_id = ?
                AND legal_entity_id = ?
                AND id = ?`,
            [parsePositiveInt(submitRes.item.id), tenantId, legalEntityId, requestId]
          );
        }

        const refreshedPreviewRow = await getOverrideRequestById({ tenantId, requestId });

        return {
          request: mapManualSettlementRequestRow(refreshedPreviewRow || previewRequestRow),
          approval_required: true,
          approval_request: submitRes?.item || null,
          idempotent: Boolean(submitRes?.idempotent),
        };
      }
    }
  }

  return withTransaction(async (tx) => {
    const requestRow = await getOverrideRequestForUpdateTx({
      tenantId,
      requestId,
      runQuery: tx.query,
    });
    if (!requestRow) throw makeNotFound("Manual settlement override request not found");

    const legalEntityId = parsePositiveInt(requestRow.legal_entity_id);
    assertScopeAccess(req, "legal_entity", legalEntityId, "requestId");

    const requestStatus = normalizeUpperText(requestRow.status);
    if (requestStatus === "APPLIED") {
      const request = mapManualSettlementRequestRow(
        await getOverrideRequestById({ tenantId, requestId, runQuery: tx.query })
      );
      const settlement = await getSettlementById({
        tenantId,
        legalEntityId,
        settlementId: parsePositiveInt(requestRow.applied_settlement_id),
        runQuery: tx.query,
      });
      return {
        request,
        settlement: mapManualSettlementSettlementRow(settlement, request),
        idempotent: true,
      };
    }
    if (requestStatus !== "REQUESTED") {
      throw badRequest(`Request status ${requestStatus} cannot be approved/applied`);
    }
    await assertSoD({
      tenantId,
      userId,
      actionCode: "payroll.settlement.override.approve",
      recordType: "PAYROLL_MANUAL_SETTLEMENT_OVERRIDE",
      recordId: requestId,
      context: {
        actorUserIds: {
          requestedByUserId: requestRow.requested_by_user_id,
          approvedByUserId: requestRow.approved_by_user_id,
        },
      },
    });

    const liability = await getLiabilityForUpdateTx({
      tenantId,
      liabilityId: parsePositiveInt(requestRow.payroll_liability_id),
      runQuery: tx.query,
    });
    if (!liability) throw makeNotFound("Payroll liability not found");
    if (parsePositiveInt(liability.legal_entity_id) !== legalEntityId) {
      throw makeConflict("Override request liability entity mismatch");
    }

    const runPeriodRow = await getPayrollRunPeriodRow({
      tenantId,
      legalEntityId,
      runId: parsePositiveInt(liability.run_id),
      runQuery: tx.query,
    });
    await assertPayrollPeriodActionAllowed({
      tenantId,
      legalEntityId,
      payrollPeriod: runPeriodRow?.payroll_period,
      actionType: "MANUAL_SETTLEMENT_APPROVE",
      runQuery: tx.query,
    });

    const link = await getPaymentLinkForUpdateTx({
      tenantId,
      legalEntityId,
      runId: parsePositiveInt(liability.run_id),
      liabilityId: parsePositiveInt(liability.id),
      linkId: parsePositiveInt(requestRow.payroll_liability_payment_link_id),
      runQuery: tx.query,
    });
    if (!link) throw makeNotFound("Payroll liability payment link not found");

    validateManualOverrideEligibility({
      ...liability,
      link_id: link.id,
      link_status: link.status,
    });

    const state = derivePartialSettlementState({
      liabilityAmount: liability.amount,
      currentLiabilitySettled: liability.settled_amount,
      linkAllocatedAmount: link.allocated_amount,
      currentLinkSettled: link.settled_amount,
      deltaAmount: requestRow.requested_amount,
    });

    const settlementKey = `PRMANSET|T:${tenantId}|LE:${legalEntityId}|REQ:${requestId}`;
    const settledAt =
      toDateTimeString(requestRow.settled_at) ||
      new Date().toISOString().slice(0, 19).replace("T", " ");

    await tx.query(
      `INSERT INTO payroll_liability_settlements (
          tenant_id, legal_entity_id, settlement_key, run_id,
          payroll_liability_id, payroll_liability_payment_link_id,
          payment_batch_id, payment_batch_line_id, bank_statement_line_id,
          settlement_source, settled_amount, currency_code, settled_at,
          payload_json, created_by_user_id
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'MANUAL_OVERRIDE', ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         settled_amount = GREATEST(settled_amount, VALUES(settled_amount)),
         settled_at = VALUES(settled_at),
         payload_json = VALUES(payload_json)`,
      [
        tenantId,
        legalEntityId,
        settlementKey,
        parsePositiveInt(liability.run_id),
        parsePositiveInt(liability.id),
        parsePositiveInt(link.id),
        parsePositiveInt(link.payment_batch_id),
        parsePositiveInt(link.payment_batch_line_id),
        amountString(state.newLinkSettled),
        normalizeUpperText(requestRow.currency_code || liability.currency_code),
        settledAt,
        safeJson({
          reason: requestRow.reason || null,
          externalRef: requestRow.external_ref || null,
          requestId,
          approvalRequestId: parsePositiveInt(approvalRequestId) || null,
          deltaAmount: state.deltaAmount,
          decisionNote: decisionNote || null,
          ownerContext: buildOwnerContext(liability),
        }),
        userId,
      ]
    );

    const settlement = await getSettlementByKey({
      tenantId,
      legalEntityId,
      settlementKey,
      runQuery: tx.query,
    });

    await tx.query(
      `UPDATE payroll_liability_payment_links
       SET status = ?,
           settled_amount = ?,
           settled_at = ?,
           last_sync_at = CURRENT_TIMESTAMP,
           sync_note = ?
       WHERE tenant_id = ? AND legal_entity_id = ? AND id = ?`,
      [
        state.linkStatus,
        amountString(state.newLinkSettled),
        settledAt,
        "manual_override",
        tenantId,
        legalEntityId,
        parsePositiveInt(link.id),
      ]
    );

    await tx.query(
      `UPDATE payroll_run_liabilities
       SET status = ?,
           settled_amount = ?,
           outstanding_amount = ?,
           paid_at = CASE WHEN ? = 'PAID' THEN ? ELSE paid_at END,
           paid_payment_batch_id = CASE WHEN ? = 'PAID' THEN ? ELSE paid_payment_batch_id END,
           paid_payment_batch_line_id = CASE WHEN ? = 'PAID' THEN ? ELSE paid_payment_batch_line_id END,
           paid_bank_statement_line_id = CASE WHEN ? = 'PAID' THEN NULL ELSE paid_bank_statement_line_id END,
           updated_at = CURRENT_TIMESTAMP
       WHERE tenant_id = ? AND legal_entity_id = ? AND id = ?`,
      [
        state.liabilityStatus,
        amountString(state.newLiabilitySettled),
        amountString(state.liabilityOutstanding),
        state.liabilityStatus,
        settledAt,
        state.liabilityStatus,
        parsePositiveInt(link.payment_batch_id),
        state.liabilityStatus,
        parsePositiveInt(link.payment_batch_line_id),
        state.liabilityStatus,
        tenantId,
        legalEntityId,
        parsePositiveInt(liability.id),
      ]
    );

    await tx.query(
      `UPDATE payroll_liability_override_requests
       SET status = 'APPLIED',
           approved_by_user_id = ?,
           approved_at = CURRENT_TIMESTAMP,
           decision_note = ?,
           applied_settlement_id = COALESCE(applied_settlement_id, ?),
           approval_request_id = COALESCE(?, approval_request_id)
       WHERE tenant_id = ? AND legal_entity_id = ? AND id = ?`,
      [
        userId,
        decisionNote || null,
        parsePositiveInt(settlement?.id),
        parsePositiveInt(approvalRequestId) || null,
        tenantId,
        legalEntityId,
        requestId,
      ]
    );

    await writeLiabilityAudit({
      tenantId,
      legalEntityId,
      runId: parsePositiveInt(liability.run_id),
      liabilityId: parsePositiveInt(liability.id),
      action: "MANUAL_SETTLEMENT_APPLIED",
      payload: {
        requestId,
        settlementId: parsePositiveInt(settlement?.id) || null,
        approvalRequestId: parsePositiveInt(approvalRequestId) || null,
        deltaAmount: state.deltaAmount,
        totalSettled: state.newLiabilitySettled,
        outstandingAmount: state.liabilityOutstanding,
        liabilityStatus: state.liabilityStatus,
        linkStatus: state.linkStatus,
        ownerContext: buildOwnerContext(liability),
      },
      userId,
      runQuery: tx.query,
    });

    const request = mapManualSettlementRequestRow(
      await getOverrideRequestById({ tenantId, requestId, runQuery: tx.query })
    );
    return {
      request,
      settlement: mapManualSettlementSettlementRow(settlement, request),
      idempotent: false,
    };
  });
}

export async function executeApprovedPayrollManualSettlementOverride({
  tenantId,
  approvalRequestId,
  approvedByUserId,
  payload = {},
}) {
  const requestId = parsePositiveInt(payload?.requestId ?? payload?.request_id);
  if (!requestId) {
    throw badRequest("Approved payroll manual settlement override payload is missing requestId");
  }
  return approveApplyPayrollManualSettlementRequest({
    req: null,
    tenantId,
    requestId,
    userId: parsePositiveInt(approvedByUserId) || null,
    decisionNote:
      String((payload?.decisionNote ?? payload?.decision_note) || "").trim() ||
      "Approved via unified approval engine",
    assertScopeAccess: noopScopeAccess,
    skipUnifiedApprovalGate: true,
    approvalRequestId,
  });
}

/**
 * Sync one unified approval request back to its bridged payroll override request.
 */
export async function syncPayrollManualSettlementApprovalRequestBridge({
  tenantId,
  approvalRequestId,
  runQuery = query,
}) {
  return syncPayrollManualSettlementApprovalRequestBridgeTx({
    tenantId,
    approvalRequestId,
    runQuery,
  });
}

export async function rejectPayrollManualSettlementRequest({
  req,
  tenantId,
  requestId,
  userId,
  decisionNote = "Rejected",
  assertScopeAccess,
}) {
  return withTransaction(async (tx) => {
    const requestRow = await getOverrideRequestForUpdateTx({
      tenantId,
      requestId,
      runQuery: tx.query,
    });
    if (!requestRow) throw makeNotFound("Manual settlement override request not found");

    const legalEntityId = parsePositiveInt(requestRow.legal_entity_id);
    assertScopeAccess(req, "legal_entity", legalEntityId, "requestId");

    const bridgedApprovalRequestId = parsePositiveInt(requestRow.approval_request_id);
    if (bridgedApprovalRequestId) {
      const decisionResult = await recordDecision(
        bridgedApprovalRequestId,
        userId,
        "REJECT",
        decisionNote || null
      );
      const syncedRequestRow = await syncPayrollManualSettlementApprovalRequestBridgeTx({
        tenantId,
        approvalRequestId: bridgedApprovalRequestId,
        runQuery: tx.query,
      });
      return {
        request: mapManualSettlementRequestRow(syncedRequestRow || requestRow),
        approval_request: decisionResult.item || null,
        idempotent: Boolean(decisionResult.idempotent),
      };
    }

    const requestStatus = normalizeUpperText(requestRow.status);
    if (requestStatus === "REJECTED") {
      const request = mapManualSettlementRequestRow(
        await getOverrideRequestById({ tenantId, requestId, runQuery: tx.query })
      );
      return { request, idempotent: true };
    }
    if (requestStatus === "APPLIED") {
      throw makeConflict("Applied manual settlement override request cannot be rejected");
    }
    await assertSoD({
      tenantId,
      userId,
      actionCode: "payroll.settlement.override.approve",
      recordType: "PAYROLL_MANUAL_SETTLEMENT_OVERRIDE",
      recordId: requestId,
      context: {
        actorUserIds: {
          requestedByUserId: requestRow.requested_by_user_id,
          approvedByUserId: requestRow.approved_by_user_id,
        },
      },
    });

    const runPeriodRow = await getPayrollRunPeriodRow({
      tenantId,
      legalEntityId,
      runId: parsePositiveInt(requestRow.run_id),
      runQuery: tx.query,
    });
    await assertPayrollPeriodActionAllowed({
      tenantId,
      legalEntityId,
      payrollPeriod: runPeriodRow?.payroll_period,
      actionType: "MANUAL_SETTLEMENT_REJECT",
      runQuery: tx.query,
    });

    await tx.query(
      `UPDATE payroll_liability_override_requests
       SET status = 'REJECTED',
           rejected_by_user_id = ?,
           rejected_at = CURRENT_TIMESTAMP,
           decision_note = ?,
           approval_request_id = COALESCE(?, approval_request_id)
       WHERE tenant_id = ? AND legal_entity_id = ? AND id = ?`,
      [
        userId,
        decisionNote || "Rejected",
        parsePositiveInt(requestRow.approval_request_id) || null,
        tenantId,
        legalEntityId,
        requestId,
      ]
    );

    const request = mapManualSettlementRequestRow(
      await getOverrideRequestById({ tenantId, requestId, runQuery: tx.query })
    );
    const runId = parsePositiveInt(request?.run_id);
    if (runId) {
      await writeLiabilityAudit({
        tenantId,
        legalEntityId,
        runId,
        liabilityId: parsePositiveInt(requestRow.payroll_liability_id),
        action: "MANUAL_SETTLEMENT_REJECTED",
        payload: {
          requestId,
          decisionNote: decisionNote || "Rejected",
          ownerContext: request?.owner_context || buildOwnerContext(request),
        },
        userId,
        runQuery: tx.query,
      });
    }
    return { request, idempotent: false };
  });
}
