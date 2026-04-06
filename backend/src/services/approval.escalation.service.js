import { query, withTransaction } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import { findUsersWithPermissionAtScope } from "./authz.scope.service.js";
import {
  getApprovalRequestCurrentStepContext,
  resolveApprovalDecisionScopeForStep,
} from "./approval.engine.service.js";

const REVIEWABLE_REQUEST_STATUSES = new Set(["PENDING_REVIEW", "ESCALATED"]);
const NOTIFICATION_STATUS_UNREAD = "UNREAD";
const NOTIFICATION_TYPE_APPROVAL_REQUEST_ESCALATED = "APPROVAL_REQUEST_ESCALATED";
const APPROVAL_REQUEST_SOURCE_REF_TYPE = "APPROVAL_REQUEST";

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function toUpper(value) {
  return String(value || "").trim().toUpperCase();
}

function safeJson(value) {
  return JSON.stringify(value ?? null);
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

function toDate(value, label = "datetime") {
  const parsed = value ? new Date(value) : new Date();
  if (Number.isNaN(parsed.getTime())) {
    throw badRequest(`${label} is invalid`);
  }
  return parsed;
}

function normalizeLimit(value, fallback = 100, max = 1000) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    return fallback;
  }
  return Math.min(n, max);
}

function truncate(value, maxLength) {
  const text = String(value ?? "");
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function mapApprovalRequestRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    requestCode: String(row.request_code || ""),
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
    lastActivityAt: row.last_activity_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    policySnapshot: parseJson(row.policy_snapshot_json, {}),
    targetSnapshot: parseJson(row.target_snapshot_json, null),
    actionPayload: parseJson(row.action_payload_json, null),
  };
}

function mapApprovalStepRow(row) {
  if (!row) {
    return null;
  }
  return {
    stepNo: Number(row.step_no || 1),
    requiredPermissionCode: String(row.required_permission_code || "").trim(),
    scopeResolutionMode: toUpper(row.scope_resolution_mode || "REQUEST_SCOPE"),
    customScopeResolverKey: row.custom_scope_resolver_key || null,
    minApprovals: Math.max(1, Number(row.min_approvals || 1)),
    allowSelfApprove: row.allow_self_approve === true || row.allow_self_approve === 1 || row.allow_self_approve === "1",
    escalationAfterHours: parsePositiveInt(row.escalation_after_hours),
    escalationTargetScopeMode: row.escalation_target_scope_mode
      ? toUpper(row.escalation_target_scope_mode)
      : null,
    escalationMaxCount: parsePositiveInt(row.escalation_max_count),
  };
}

function resolveEscalationBaseTime(requestRow) {
  return (
    requestRow?.lastActivityAt ||
    requestRow?.submittedAt ||
    requestRow?.createdAt ||
    null
  );
}

function addHours(baseDate, hours) {
  return new Date(baseDate.getTime() + Math.max(0, Number(hours) || 0) * 3600000);
}

function resolveEffectiveEscalationStep(snapshotStep, liveStep) {
  const snapshotPermissionExplicit =
    hasOwn(snapshotStep, "requiredPermissionCode") ||
    hasOwn(snapshotStep, "required_permission_code");
  const livePermissionExplicit =
    hasOwn(liveStep, "requiredPermissionCode") ||
    hasOwn(liveStep, "required_permission_code");
  return {
    stepNo: Number(snapshotStep?.stepNo ?? liveStep?.stepNo ?? 1),
    requiredPermissionCode: snapshotPermissionExplicit
      ? String(
          snapshotStep?.requiredPermissionCode ??
            snapshotStep?.required_permission_code ??
            ""
        ).trim()
      : livePermissionExplicit
        ? String(
            liveStep?.requiredPermissionCode ??
              liveStep?.required_permission_code ??
              ""
          ).trim()
        : "approvals.requests.approve",
    scopeResolutionMode:
      toUpper(snapshotStep?.scopeResolutionMode || liveStep?.scopeResolutionMode || "REQUEST_SCOPE"),
    customScopeResolverKey:
      snapshotStep?.customScopeResolverKey ?? liveStep?.customScopeResolverKey ?? null,
    minApprovals: Math.max(
      1,
      Number(snapshotStep?.minApprovals ?? liveStep?.minApprovals ?? 1)
    ),
    allowSelfApprove:
      snapshotStep?.allowSelfApprove ?? liveStep?.allowSelfApprove ?? true,
    // Requests submitted before PR-5C will not have the new fields in their
    // snapshot yet, so live step columns backfill only the missing escalation
    // config while the rest of the request stays snapshot-driven.
    escalationAfterHours: parsePositiveInt(
      snapshotStep?.escalationAfterHours ?? liveStep?.escalationAfterHours
    ),
    escalationTargetScopeMode: snapshotStep?.escalationTargetScopeMode
      ? toUpper(snapshotStep.escalationTargetScopeMode)
      : liveStep?.escalationTargetScopeMode
        ? toUpper(liveStep.escalationTargetScopeMode)
        : null,
    escalationMaxCount: parsePositiveInt(
      snapshotStep?.escalationMaxCount ?? liveStep?.escalationMaxCount
    ),
  };
}

function resolveMaxEscalationCount(step) {
  return Math.max(1, parsePositiveInt(step?.escalationMaxCount) || 1);
}

function buildEscalationTargetStep(step) {
  return {
    ...step,
    scopeResolutionMode:
      toUpper(step?.escalationTargetScopeMode || step?.scopeResolutionMode || "REQUEST_SCOPE"),
  };
}

function buildEscalationNotificationTitle(requestRow) {
  const requestCode = String(requestRow?.requestCode || "").trim();
  if (requestCode) {
    return `Approval request ${requestCode} escalated`;
  }
  return `Approval request #${parsePositiveInt(requestRow?.id) || "?"} escalated`;
}

function buildEscalationNotificationBody(requestRow, stepNo) {
  const moduleCode = toUpper(requestRow?.moduleCode || "APPROVAL");
  const targetType = toUpper(requestRow?.targetType || "REQUEST");
  const targetId = parsePositiveInt(requestRow?.targetId) || "?";
  return truncate(
    `Review needed for ${moduleCode} ${targetType} #${targetId} at approval step ${Number(stepNo || 1)}.`,
    1000
  );
}

async function getApprovalRequestRowById({
  requestId,
  runQuery = query,
  forUpdate = false,
}) {
  const normalizedRequestId = parsePositiveInt(requestId);
  if (!normalizedRequestId) {
    return null;
  }
  const result = await runQuery(
    `SELECT *
       FROM approval_requests
      WHERE id = ?
      LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [normalizedRequestId]
  );
  return mapApprovalRequestRow(result.rows?.[0] || null);
}

async function getApprovalPolicyStepByNo({
  tenantId,
  policyId,
  stepNo,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedPolicyId = parsePositiveInt(policyId);
  const normalizedStepNo = Number(stepNo || 0);
  if (!normalizedTenantId || !normalizedPolicyId || normalizedStepNo <= 0) {
    return null;
  }
  const result = await runQuery(
    `SELECT *
       FROM approval_policy_steps
      WHERE tenant_id = ?
        AND policy_id = ?
        AND step_no = ?
      LIMIT 1`,
    [normalizedTenantId, normalizedPolicyId, normalizedStepNo]
  );
  return mapApprovalStepRow(result.rows?.[0] || null);
}

async function countEscalationEvents({
  tenantId,
  requestId,
  stepNo,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT COUNT(*) AS total
       FROM approval_escalation_events
      WHERE tenant_id = ?
        AND request_id = ?
        AND step_no = ?`,
    [tenantId, requestId, stepNo]
  );
  return Number(result.rows?.[0]?.total || 0);
}

async function listCurrentStepDecisionUserIds({
  tenantId,
  requestId,
  stepNo,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT decided_by_user_id
       FROM approval_decisions
      WHERE tenant_id = ?
        AND request_id = ?
        AND step_no = ?`,
    [tenantId, requestId, stepNo]
  );
  return Array.from(
    new Set(
      (result.rows || [])
        .map((row) => parsePositiveInt(row.decided_by_user_id))
        .filter(Boolean)
    )
  );
}

async function filterActiveUserIds({
  tenantId,
  userIds,
  runQuery = query,
}) {
  const ids = Array.from(new Set((userIds || []).map((id) => parsePositiveInt(id)).filter(Boolean)));
  if (ids.length === 0) {
    return [];
  }
  const result = await runQuery(
    `SELECT id
       FROM users
      WHERE tenant_id = ?
        AND status = 'ACTIVE'
        AND id IN (${ids.map(() => "?").join(", ")})
      ORDER BY id ASC`,
    [tenantId, ...ids]
  );
  return (result.rows || []).map((row) => parsePositiveInt(row.id)).filter(Boolean);
}

async function buildEscalationRecipientUserIds({
  requestRow,
  step,
  targetScope,
  runQuery = query,
}) {
  if (!String(step?.requiredPermissionCode || "").trim()) {
    return [];
  }
  const candidateUserIds = await findUsersWithPermissionAtScope(
    requestRow.tenantId,
    step.requiredPermissionCode,
    targetScope.scopeType,
    targetScope.scopeId,
    { runQuery }
  );
  const decidedUserIds = await listCurrentStepDecisionUserIds({
    tenantId: requestRow.tenantId,
    requestId: requestRow.id,
    stepNo: step.stepNo,
    runQuery,
  });
  const excludedUserIds = new Set([
    parsePositiveInt(requestRow.submittedByUserId),
    ...decidedUserIds,
  ]);
  const activeUserIds = await filterActiveUserIds({
    tenantId: requestRow.tenantId,
    userIds: candidateUserIds,
    runQuery,
  });
  return activeUserIds.filter((userId) => !excludedUserIds.has(userId));
}

function buildEscalationEventPayload({
  requestRow,
  step,
  targetScope,
  escalationNo,
  dueAt,
  recipientUserIds,
}) {
  return {
    version: 1,
    requestId: requestRow.id,
    requestCode: requestRow.requestCode || null,
    moduleCode: requestRow.moduleCode,
    targetType: requestRow.targetType,
    targetId: requestRow.targetId,
    stepNo: step.stepNo,
    escalationNo,
    escalationAfterHours: step.escalationAfterHours || null,
    escalationTargetScopeMode: step.escalationTargetScopeMode || null,
    targetScope,
    recipientUserIds,
    dueAt: dueAt.toISOString(),
    baseActivityAt: resolveEscalationBaseTime(requestRow),
  };
}

async function insertEscalationNotifications({
  tenantId,
  requestRow,
  step,
  targetScope,
  escalationEventId,
  recipientUserIds,
  runQuery = query,
}) {
  let insertedCount = 0;
  const title = buildEscalationNotificationTitle(requestRow);
  const body = buildEscalationNotificationBody(requestRow, step.stepNo);

  for (const userId of recipientUserIds) {
    const payload = {
      version: 1,
      approvalRequestId: requestRow.id,
      approvalRequestCode: requestRow.requestCode || null,
      escalationEventId,
      moduleCode: requestRow.moduleCode,
      targetType: requestRow.targetType,
      targetId: requestRow.targetId,
      stepNo: step.stepNo,
      scopeType: targetScope.scopeType,
      scopeId: targetScope.scopeId,
    };

    // eslint-disable-next-line no-await-in-loop
    await runQuery(
      `INSERT INTO in_app_notifications (
         tenant_id,
         user_id,
         notification_type,
         title,
         body,
         status,
         source_ref_type,
         source_ref_id,
         source_event_id,
         payload_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON))`,
      [
        tenantId,
        userId,
        NOTIFICATION_TYPE_APPROVAL_REQUEST_ESCALATED,
        title,
        body,
        NOTIFICATION_STATUS_UNREAD,
        APPROVAL_REQUEST_SOURCE_REF_TYPE,
        requestRow.id,
        escalationEventId,
        safeJson(payload),
      ]
    );
    insertedCount += 1;
  }

  return insertedCount;
}

function buildDueCandidatesWhere({ tenantId, params, asOf }) {
  const conditions = [
    `r.request_status IN ('PENDING_REVIEW', 'ESCALATED')`,
    `COALESCE(s.escalation_after_hours, 0) > 0`,
    `TIMESTAMPADD(
       HOUR,
       s.escalation_after_hours,
       COALESCE(r.last_activity_at, r.submitted_at, r.created_at)
     ) <= ?`,
    `COALESCE(ev.escalation_count, 0) < COALESCE(s.escalation_max_count, 1)`,
  ];
  params.push(asOf);
  if (parsePositiveInt(tenantId)) {
    conditions.push("r.tenant_id = ?");
    params.push(parsePositiveInt(tenantId));
  }
  return conditions;
}

/**
 * List tenants that currently have at least one overdue approval escalation candidate.
 */
export async function listTenantIdsWithOverdueApprovalEscalations({
  tenantId = null,
  asOf = null,
  limit = 200,
  runQuery = query,
} = {}) {
  const normalizedAsOf = toDate(asOf, "asOf");
  const params = [];
  const where = buildDueCandidatesWhere({
    tenantId,
    params,
    asOf: normalizedAsOf,
  });
  const result = await runQuery(
    `SELECT DISTINCT r.tenant_id
       FROM approval_requests r
       JOIN approval_policy_steps s
         ON s.tenant_id = r.tenant_id
        AND s.policy_id = r.policy_id
        AND s.step_no = r.current_step_no
       LEFT JOIN (
         SELECT tenant_id, request_id, step_no, COUNT(*) AS escalation_count
           FROM approval_escalation_events
          GROUP BY tenant_id, request_id, step_no
       ) ev
         ON ev.tenant_id = r.tenant_id
        AND ev.request_id = r.id
        AND ev.step_no = r.current_step_no
      WHERE ${where.join(" AND ")}
      ORDER BY r.tenant_id ASC
      LIMIT ${normalizeLimit(limit, 200, 2000)}`,
    params
  );
  return (result.rows || [])
    .map((row) => parsePositiveInt(row.tenant_id))
    .filter(Boolean);
}

/**
 * Process one overdue approval request escalation inside a transaction.
 */
export async function processApprovalEscalationByRequestId({
  requestId,
  now = null,
  triggerSource = "SCHEDULE_SWEEP",
} = {}) {
  const normalizedRequestId = parsePositiveInt(requestId);
  if (!normalizedRequestId) {
    throw badRequest("requestId is required");
  }
  const sweepNow = toDate(now, "now");
  const normalizedTriggerSource = truncate(
    String(triggerSource || "SCHEDULE_SWEEP").trim().toUpperCase() || "SCHEDULE_SWEEP",
    40
  );

  return withTransaction(async (tx) => {
    const requestRow = await getApprovalRequestRowById({
      requestId: normalizedRequestId,
      runQuery: tx.query,
      forUpdate: true,
    });
    if (!requestRow) {
      return {
        requestId: normalizedRequestId,
        outcome: "SKIPPED",
        reason: "NOT_FOUND",
      };
    }

    if (!REVIEWABLE_REQUEST_STATUSES.has(requestRow.requestStatus)) {
      return {
        requestId: requestRow.id,
        outcome: "SKIPPED",
        reason: "NOT_REVIEWABLE",
      };
    }

    const { currentStep } = getApprovalRequestCurrentStepContext(requestRow);
    if (!currentStep) {
      return {
        requestId: requestRow.id,
        outcome: "SKIPPED",
        reason: "NO_CURRENT_STEP",
      };
    }

    const liveStep = await getApprovalPolicyStepByNo({
      tenantId: requestRow.tenantId,
      policyId: requestRow.policyId,
      stepNo: requestRow.currentStepNo,
      runQuery: tx.query,
    });
    const step = resolveEffectiveEscalationStep(currentStep, liveStep);
    const escalationAfterHours = parsePositiveInt(step.escalationAfterHours);
    if (!escalationAfterHours) {
      return {
        requestId: requestRow.id,
        outcome: "SKIPPED",
        reason: "NO_ESCALATION_CONFIG",
      };
    }

    const baseTime = resolveEscalationBaseTime(requestRow);
    if (!baseTime) {
      return {
        requestId: requestRow.id,
        outcome: "SKIPPED",
        reason: "NO_ACTIVITY_BASELINE",
      };
    }

    const dueAt = addHours(toDate(baseTime, "approval request activity"), escalationAfterHours);
    if (dueAt.getTime() > sweepNow.getTime()) {
      return {
        requestId: requestRow.id,
        outcome: "SKIPPED",
        reason: "NOT_DUE",
        dueAt: dueAt.toISOString(),
      };
    }

    const escalationCount = await countEscalationEvents({
      tenantId: requestRow.tenantId,
      requestId: requestRow.id,
      stepNo: step.stepNo,
      runQuery: tx.query,
    });
    const maxEscalationCount = resolveMaxEscalationCount(step);
    if (escalationCount >= maxEscalationCount) {
      return {
        requestId: requestRow.id,
        outcome: "SKIPPED",
        reason: "MAX_ESCALATIONS_REACHED",
        escalationCount,
        maxEscalationCount,
      };
    }

    const targetScope = resolveApprovalDecisionScopeForStep(
      requestRow,
      buildEscalationTargetStep(step)
    );
    const recipientUserIds = await buildEscalationRecipientUserIds({
      requestRow,
      step,
      targetScope,
      runQuery: tx.query,
    });
    const escalationNo = escalationCount + 1;
    const eventPayload = buildEscalationEventPayload({
      requestRow,
      step,
      targetScope,
      escalationNo,
      dueAt,
      recipientUserIds,
    });
    const insertEventResult = await tx.query(
      `INSERT INTO approval_escalation_events (
         tenant_id,
         request_id,
         step_no,
         escalation_no,
         event_type,
         target_permission_code,
         target_scope_type,
         target_scope_id,
         notified_user_count,
         trigger_source,
         payload_json
       ) VALUES (?, ?, ?, ?, 'ESCALATED', ?, ?, ?, ?, ?, CAST(? AS JSON))`,
      [
        requestRow.tenantId,
        requestRow.id,
        step.stepNo,
        escalationNo,
        step.requiredPermissionCode,
        targetScope.scopeType,
        targetScope.scopeId,
        recipientUserIds.length,
        normalizedTriggerSource,
        safeJson(eventPayload),
      ]
    );
    const escalationEventId = parsePositiveInt(insertEventResult.rows?.insertId);
    if (!escalationEventId) {
      throw new Error("Approval escalation event could not be created");
    }

    await insertEscalationNotifications({
      tenantId: requestRow.tenantId,
      requestRow,
      step,
      targetScope,
      escalationEventId,
      recipientUserIds,
      runQuery: tx.query,
    });

    await tx.query(
      `UPDATE approval_requests
          SET request_status = 'ESCALATED',
              last_activity_at = ?,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [sweepNow, requestRow.id]
    );

    return {
      requestId: requestRow.id,
      tenantId: requestRow.tenantId,
      outcome: "ESCALATED",
      escalationEventId,
      escalationNo,
      stepNo: step.stepNo,
      requestStatus: "ESCALATED",
      targetScope,
      recipientUserIds,
      dueAt: dueAt.toISOString(),
    };
  });
}

/**
 * Sweep overdue approval requests and escalate the ones that are currently due.
 */
export async function sweepDueApprovalEscalations({
  tenantId = null,
  limit = 100,
  now = null,
  triggerSource = "SCHEDULE_SWEEP",
  runQuery = query,
} = {}) {
  const sweepNow = toDate(now, "now");
  const safeLimit = normalizeLimit(limit, 100, 1000);
  const params = [];
  const where = buildDueCandidatesWhere({
    tenantId,
    params,
    asOf: sweepNow,
  });

  const result = await runQuery(
    `SELECT r.id,
            r.tenant_id,
            TIMESTAMPADD(
              HOUR,
              s.escalation_after_hours,
              COALESCE(r.last_activity_at, r.submitted_at, r.created_at)
            ) AS due_at
       FROM approval_requests r
       JOIN approval_policy_steps s
         ON s.tenant_id = r.tenant_id
        AND s.policy_id = r.policy_id
        AND s.step_no = r.current_step_no
       LEFT JOIN (
         SELECT tenant_id, request_id, step_no, COUNT(*) AS escalation_count
           FROM approval_escalation_events
          GROUP BY tenant_id, request_id, step_no
       ) ev
         ON ev.tenant_id = r.tenant_id
        AND ev.request_id = r.id
        AND ev.step_no = r.current_step_no
      WHERE ${where.join(" AND ")}
      ORDER BY due_at ASC, r.id ASC
      LIMIT ${safeLimit}`,
    params
  );

  const rows = [];
  let escalatedRequests = 0;
  let notificationCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const candidate of result.rows || []) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const item = await processApprovalEscalationByRequestId({
        requestId: candidate.id,
        now: sweepNow,
        triggerSource,
      });
      rows.push(item);
      if (item?.outcome === "ESCALATED") {
        escalatedRequests += 1;
        notificationCount += Array.isArray(item.recipientUserIds)
          ? item.recipientUserIds.length
          : 0;
      } else {
        skippedCount += 1;
      }
    } catch (err) {
      rows.push({
        requestId: parsePositiveInt(candidate.id),
        tenantId: parsePositiveInt(candidate.tenant_id),
        outcome: "ERROR",
        message: String(err?.message || err),
      });
      errorCount += 1;
    }
  }

  return {
    now: sweepNow.toISOString(),
    tenantId: parsePositiveInt(tenantId),
    scannedRequests: Number((result.rows || []).length),
    escalatedRequests,
    notificationCount,
    skippedCount,
    errorCount,
    rows,
  };
}

export default {
  listTenantIdsWithOverdueApprovalEscalations,
  processApprovalEscalationByRequestId,
  sweepDueApprovalEscalations,
};
