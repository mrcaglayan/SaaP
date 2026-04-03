import { query } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import { SOD_RULES } from "../constants/sod-rules.js";

function toUpper(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeActorUserIds(actorUserIds = {}) {
  return {
    createdByUserId: parsePositiveInt(actorUserIds.createdByUserId),
    requestedByUserId: parsePositiveInt(actorUserIds.requestedByUserId),
    initiatedByUserId: parsePositiveInt(actorUserIds.initiatedByUserId),
    approvedByUserId: parsePositiveInt(actorUserIds.approvedByUserId),
    reviewedByUserId: parsePositiveInt(actorUserIds.reviewedByUserId),
    postedByUserId: parsePositiveInt(actorUserIds.postedByUserId),
  };
}

async function loadGlJournalActorUserIds({ tenantId, recordId, runQuery = query }) {
  const result = await runQuery(
    `SELECT created_by_user_id, posted_by_user_id
     FROM journal_entries
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, recordId]
  );
  const row = result.rows?.[0] || null;
  return normalizeActorUserIds({
    createdByUserId: row?.created_by_user_id,
    postedByUserId: row?.posted_by_user_id,
  });
}

async function loadPaymentBatchActorUserIds({ tenantId, recordId, runQuery = query }) {
  const result = await runQuery(
    `SELECT created_by_user_id, approved_by_user_id, posted_by_user_id
     FROM payment_batches
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, recordId]
  );
  const row = result.rows?.[0] || null;
  return normalizeActorUserIds({
    createdByUserId: row?.created_by_user_id,
    approvedByUserId: row?.approved_by_user_id,
    postedByUserId: row?.posted_by_user_id,
  });
}

async function loadPayrollOverrideActorUserIds({ tenantId, recordId, runQuery = query }) {
  const result = await runQuery(
    `SELECT requested_by_user_id, approved_by_user_id
     FROM payroll_liability_override_requests
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, recordId]
  );
  const row = result.rows?.[0] || null;
  return normalizeActorUserIds({
    requestedByUserId: row?.requested_by_user_id,
    approvedByUserId: row?.approved_by_user_id,
  });
}

async function loadPayrollPeriodCloseActorUserIds({
  tenantId,
  recordId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT requested_by_user_id, approved_by_user_id
     FROM payroll_period_closes
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, recordId]
  );
  const row = result.rows?.[0] || null;
  return normalizeActorUserIds({
    requestedByUserId: row?.requested_by_user_id,
    approvedByUserId: row?.approved_by_user_id,
  });
}

async function loadWorkflowInstanceActorUserIds({ tenantId, recordId, runQuery = query }) {
  const result = await runQuery(
    `SELECT requested_by_user_id
     FROM workflow_instances
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, recordId]
  );
  const row = result.rows?.[0] || null;
  return normalizeActorUserIds({
    requestedByUserId: row?.requested_by_user_id,
  });
}

async function loadCounterpartyRequestActorUserIds({
  tenantId,
  recordId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT requested_by_user_id
     FROM counterparty_requests
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, recordId]
  );
  const row = result.rows?.[0] || null;
  return normalizeActorUserIds({
    requestedByUserId: row?.requested_by_user_id,
  });
}

async function loadLocalCloseReopenActorUserIds({
  tenantId,
  recordId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT requested_by_user_id, reviewed_by_user_id
     FROM local_close_pack_reopen_requests
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, recordId]
  );
  const row = result.rows?.[0] || null;
  return normalizeActorUserIds({
    requestedByUserId: row?.requested_by_user_id,
    reviewedByUserId: row?.reviewed_by_user_id,
  });
}

async function loadInventoryTransferActorUserIds({ tenantId, recordId, runQuery = query }) {
  const result = await runQuery(
    `SELECT initiated_by_user_id, approved_by_user_id
     FROM inventory_transfers
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, recordId]
  );
  const row = result.rows?.[0] || null;
  return normalizeActorUserIds({
    initiatedByUserId: row?.initiated_by_user_id,
    approvedByUserId: row?.approved_by_user_id,
  });
}

const RECORD_ACTOR_LOADERS = Object.freeze({
  GL_JOURNAL: loadGlJournalActorUserIds,
  PAYMENT_BATCH: loadPaymentBatchActorUserIds,
  PAYROLL_MANUAL_SETTLEMENT_OVERRIDE: loadPayrollOverrideActorUserIds,
  PAYROLL_PERIOD_CLOSE: loadPayrollPeriodCloseActorUserIds,
  WORKFLOW_INSTANCE: loadWorkflowInstanceActorUserIds,
  COUNTERPARTY_REQUEST: loadCounterpartyRequestActorUserIds,
  LOCAL_CLOSE_PACK_REOPEN_REQUEST: loadLocalCloseReopenActorUserIds,
  INVENTORY_TRANSFER: loadInventoryTransferActorUserIds,
});

async function resolveActorUserIds({
  tenantId,
  recordType,
  recordId,
  context = {},
}) {
  const providedActorUserIds = normalizeActorUserIds(context.actorUserIds);
  if (Object.values(providedActorUserIds).some(Boolean)) {
    return providedActorUserIds;
  }

  const loader = RECORD_ACTOR_LOADERS[recordType];
  if (!loader || !tenantId || !recordId) {
    return providedActorUserIds;
  }

  return loader({
    tenantId,
    recordId,
    runQuery: typeof context.runQuery === "function" ? context.runQuery : query,
  });
}

function buildFinding({
  rule,
  userId,
  recordType,
  recordId,
  conflictingUserId,
}) {
  let outcome = "SKIPPED";
  if (conflictingUserId) {
    outcome = conflictingUserId === userId ? "FAIL" : "PASS";
  }

  return {
    ruleCode: rule.code,
    recordType,
    recordId,
    actionA: rule.action_a,
    actionB: rule.action_b,
    actorUserField: rule.actorUserField,
    conflictingUserId: conflictingUserId || null,
    scope: rule.scope,
    enforcement: rule.enforcement,
    outcome,
    reason: rule.reason,
    message:
      outcome === "FAIL"
        ? `${rule.reason} User ${userId} already performed ${rule.action_a} on ${recordType} ${recordId}.`
        : rule.reason,
  };
}

/**
 * Evaluate same-record segregation-of-duties rules for one business action.
 */
export async function evaluateSoD({
  tenantId,
  userId,
  actionCode,
  recordType,
  recordId,
  context = {},
}) {
  const normalizedTenantId = parsePositiveInt(tenantId ?? context.tenantId ?? context.tenant_id);
  const normalizedUserId = parsePositiveInt(userId);
  const normalizedRecordId = parsePositiveInt(recordId);
  const normalizedActionCode = String(actionCode || "").trim();
  const normalizedRecordType = toUpper(recordType);

  if (!normalizedUserId) {
    throw badRequest("userId is required");
  }
  if (!normalizedActionCode) {
    throw badRequest("actionCode is required");
  }
  if (!normalizedRecordType) {
    throw badRequest("recordType is required");
  }
  if (!normalizedRecordId) {
    throw badRequest("recordId is required");
  }

  const matchingRules = SOD_RULES.filter(
    (rule) =>
      rule.recordType === normalizedRecordType && rule.action_b === normalizedActionCode
  );
  const actorUserIds = await resolveActorUserIds({
    tenantId: normalizedTenantId,
    recordType: normalizedRecordType,
    recordId: normalizedRecordId,
    context,
  });
  const findings = matchingRules.map((rule) =>
    buildFinding({
      rule,
      userId: normalizedUserId,
      recordType: normalizedRecordType,
      recordId: normalizedRecordId,
      conflictingUserId: parsePositiveInt(actorUserIds[rule.actorUserField]),
    })
  );

  return {
    tenantId: normalizedTenantId || null,
    userId: normalizedUserId,
    actionCode: normalizedActionCode,
    recordType: normalizedRecordType,
    recordId: normalizedRecordId,
    actorUserIds,
    findings,
    blockingFindings: findings.filter(
      (finding) => finding.outcome === "FAIL" && finding.enforcement === "block"
    ),
    warningFindings: findings.filter(
      (finding) => finding.outcome === "FAIL" && finding.enforcement === "warn"
    ),
  };
}

/**
 * Enforce block-level same-record segregation-of-duties rules for one action.
 */
export async function assertSoD(input) {
  const evaluation = await evaluateSoD(input);
  if (evaluation.blockingFindings.length > 0) {
    const err = new Error(
      evaluation.blockingFindings.map((finding) => finding.message).join(" ")
    );
    err.code = "SOD_VIOLATION";
    err.status = 403;
    err.details = evaluation;
    throw err;
  }
  return evaluation;
}
