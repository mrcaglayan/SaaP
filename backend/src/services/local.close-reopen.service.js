import { query, withTransaction } from "../db.js";
import { assertSecondaryPermission } from "../middleware/rbac.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import { getEntityCloseReadiness } from "./entity.close-readiness.service.js";
import {
  assertLocalClosePackJournalActionAllowed,
  findBlockingLocalClosePackForJournalAction,
} from "./local.close-enforcement.service.js";
import {
  isEvidenceOnlyLocalClosePackReopenAction,
  isFinancialLocalClosePackReopenAction,
  resolveLocalClosePackRowScope,
} from "./local.close-packs.shared.js";
import { submitApprovalRequest } from "./approvalPolicies.service.js";
import { executeRequest, recordDecision } from "./approval.engine.service.js";
import { assertSoD } from "./sod.service.js";

const FINANCIALLY_REOPENABLE_PACK_STATUSES = new Set(["APPROVED", "LOCKED"]);

function toUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function toDateTime(value) {
  return value || null;
}

function isMissingTableError(err) {
  return Number(err?.errno) === 1146;
}

function notFound(message) {
  const err = new Error(message);
  err.status = 404;
  return err;
}

function conflict(message, details = null, code = "") {
  const err = new Error(message);
  err.status = 409;
  if (details !== null && details !== undefined) {
    err.details = details;
  }
  if (code) {
    err.code = code;
  }
  return err;
}

function mapLocalClosePackReopenRequestRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    localClosePackId: parsePositiveInt(row.local_close_pack_id),
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    bookId: parsePositiveInt(row.book_id),
    fiscalPeriodId: parsePositiveInt(row.fiscal_period_id),
    closeScopeType: toUpperText(row.close_scope_type),
    operatingUnitId: parsePositiveInt(row.operating_unit_id),
    scopeKey: String(row.scope_key || ""),
    requestStatus: toUpperText(row.request_status),
    reasonCode: String(row.reason_code || ""),
    requestedActionType: toUpperText(row.requested_action_type),
    explanation: row.explanation || null,
    materialityLevel: toUpperText(row.materiality_level),
    estimatedImpactNote: row.estimated_impact_note || null,
    downstreamStage: toUpperText(row.downstream_stage),
    requiresHighGovernance: Boolean(Number(row.requires_high_governance || 0)),
    requestedByUserId: parsePositiveInt(row.requested_by_user_id),
    requestedByUserName: row.requested_by_user_name || null,
    reviewedByUserId: parsePositiveInt(row.reviewed_by_user_id),
    reviewedByUserName: row.reviewed_by_user_name || null,
    requestedAt: toDateTime(row.requested_at),
    reviewedAt: toDateTime(row.reviewed_at),
    decisionNote: row.decision_note || null,
    approvalRequestId: parsePositiveInt(row.approval_request_id),
    approvalRequest: buildApprovalRequestSummary(row),
    createdAt: toDateTime(row.created_at),
    updatedAt: toDateTime(row.updated_at),
  };
}

function buildApprovalRequestSummary(row, prefix = "approval_") {
  const approvalRequestId = parsePositiveInt(row?.[`${prefix}request_id`]);
  if (!approvalRequestId) {
    return null;
  }
  return {
    id: approvalRequestId,
    requestCode: row?.[`${prefix}request_code`] || null,
    requestStatus: toUpperText(row?.[`${prefix}request_status`]) || null,
    executionStatus: toUpperText(row?.[`${prefix}execution_status`]) || null,
    currentStepNo: Number(row?.[`${prefix}current_step_no`] || 1),
    scopeType: toUpperText(row?.[`${prefix}scope_type`]) || null,
    scopeId: parsePositiveInt(row?.[`${prefix}scope_id`]),
    submittedByUserId: parsePositiveInt(row?.[`${prefix}submitted_by_user_id`]),
    executedByUserId: parsePositiveInt(row?.[`${prefix}executed_by_user_id`]),
    submittedAt: toDateTime(row?.[`${prefix}submitted_at`]),
    approvedAt: toDateTime(row?.[`${prefix}approved_at`]),
    rejectedAt: toDateTime(row?.[`${prefix}rejected_at`]),
    withdrawnAt: toDateTime(row?.[`${prefix}withdrawn_at`]),
    executedAt: toDateTime(row?.[`${prefix}executed_at`]),
    executionErrorText: row?.[`${prefix}execution_error_text`] || null,
  };
}

function getLocalClosePackReopenApprovalActionType(requestedActionType) {
  return isFinancialLocalClosePackReopenAction(requestedActionType) ? "REOPEN" : "APPROVE";
}

function noopScopeAccess() {
  return true;
}

function buildLocalClosePackReopenRequestBaseSelect(whereSql) {
  return `SELECT
      lcrr.*,
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
      requester.name AS requested_by_user_name,
      reviewer.name AS reviewed_by_user_name
    FROM local_close_pack_reopen_requests lcrr
    LEFT JOIN approval_requests ar
      ON ar.tenant_id = lcrr.tenant_id
     AND ar.id = lcrr.approval_request_id
    LEFT JOIN users requester ON requester.id = lcrr.requested_by_user_id
    LEFT JOIN users reviewer ON reviewer.id = lcrr.reviewed_by_user_id
    WHERE ${whereSql}`;
}

async function loadLocalClosePackHeader({
  tenantId,
  packId,
  runQuery = query,
  forUpdate = false,
}) {
  const result = await runQuery(
    `SELECT
       lcp.id,
       lcp.tenant_id,
       lcp.legal_entity_id,
       lcp.book_id,
       lcp.fiscal_period_id,
       lcp.close_scope_type,
       lcp.scope_key,
       lcp.operating_unit_id,
       lcp.status,
       lcp.note,
       lcp.reopened_at
     FROM local_close_packs lcp
     WHERE lcp.tenant_id = ?
       AND lcp.id = ?
     LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [tenantId, packId]
  );
  return result.rows?.[0] || null;
}

async function loadLocalClosePackReopenRequestRow({
  tenantId,
  packId,
  requestId,
  runQuery = query,
  forUpdate = false,
}) {
  const result = await runQuery(
    `${buildLocalClosePackReopenRequestBaseSelect(
      "lcrr.tenant_id = ? AND lcrr.local_close_pack_id = ? AND lcrr.id = ?"
    )}
     LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [tenantId, packId, requestId]
  );
  return result.rows?.[0] || null;
}

async function loadPendingReopenRequestRow({
  tenantId,
  packId,
  requestedActionType = null,
  runQuery = query,
}) {
  const where = ["lcrr.tenant_id = ?", "lcrr.local_close_pack_id = ?", "lcrr.request_status = 'REQUESTED'"];
  const params = [tenantId, packId];
  if (requestedActionType) {
    where.push("lcrr.requested_action_type = ?");
    params.push(toUpperText(requestedActionType));
  }
  try {
    const result = await runQuery(
      `${buildLocalClosePackReopenRequestBaseSelect(where.join(" AND "))}
       ORDER BY lcrr.id DESC
       LIMIT 1`,
      params
    );
    return result.rows?.[0] || null;
  } catch (err) {
    if (isMissingTableError(err)) {
      return null;
    }
    throw err;
  }
}

async function loadLocalClosePackReopenRequestByApprovalRequestId({
  tenantId,
  approvalRequestId,
  runQuery = query,
}) {
  const result = await runQuery(
    `${buildLocalClosePackReopenRequestBaseSelect(
      "lcrr.tenant_id = ? AND lcrr.approval_request_id = ?"
    )}
     LIMIT 1`,
    [tenantId, approvalRequestId]
  );
  return result.rows?.[0] || null;
}

function assertLocalClosePackScopeAccess(req, packRow, assertScopeAccess) {
  const scope = resolveLocalClosePackRowScope(packRow);
  if (!scope) {
    return;
  }
  assertScopeAccess(req, scope.scopeKind, scope.scopeId, "localClosePack");
}

async function writeLocalClosePackAuditLog({
  runQuery,
  req,
  tenantId,
  userId,
  packRow,
  action,
  resourceId,
  payload,
}) {
  if (typeof runQuery !== "function") {
    return;
  }
  const scope = resolveLocalClosePackRowScope(packRow);
  const forwardedFor = req?.headers?.["x-forwarded-for"];
  const forwardedIp = Array.isArray(forwardedFor)
    ? forwardedFor[0]
    : String(forwardedFor || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)[0];

  await runQuery(
    `INSERT INTO audit_logs (
        tenant_id,
        user_id,
        action,
        resource_type,
        resource_id,
        scope_type,
        scope_id,
        request_id,
        ip_address,
        user_agent,
        payload_json
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      parsePositiveInt(tenantId),
      parsePositiveInt(userId) || null,
      String(action || "ouclose.reopen"),
      "local_close_pack",
      resourceId ? String(resourceId) : String(packRow?.id || ""),
      scope?.scopeType || null,
      parsePositiveInt(scope?.scopeId) || null,
      req?.headers?.["x-request-id"] ? String(req.headers["x-request-id"]) : null,
      forwardedIp || req?.ip || req?.socket?.remoteAddress || null,
      req?.headers?.["user-agent"] ? String(req.headers["user-agent"]).slice(0, 255) : null,
      payload ? JSON.stringify(payload) : null,
    ]
  );
}

async function assertPublishedPeriodGovernanceIfNeeded(req, packRow, requestRow) {
  if (toUpperText(requestRow?.downstream_stage) !== "GROUP_PUBLISHED") {
    return;
  }
  const scope = resolveLocalClosePackRowScope(packRow);
  await assertSecondaryPermission(req, "ouclose.admin", {
    resolveScope: async () =>
      scope
        ? {
            scopeType: scope.scopeType,
            scopeId: scope.scopeId,
          }
        : null,
  });
}

async function loadApprovalRequestBridgeRow({
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

async function loadLatestApprovalDecisionRow({
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

async function syncLocalClosePackReopenApprovalRequestBridgeTx({
  tenantId,
  approvalRequestId,
  runQuery = query,
}) {
  const localRow = await loadLocalClosePackReopenRequestByApprovalRequestId({
    tenantId,
    approvalRequestId,
    runQuery,
  });
  if (!localRow) {
    return null;
  }

  const approvalRow = await loadApprovalRequestBridgeRow({
    tenantId,
    approvalRequestId,
    runQuery,
  });
  if (!approvalRow) {
    return localRow;
  }

  const latestDecision = await loadLatestApprovalDecisionRow({
    approvalRequestId,
    runQuery,
  });
  let nextRequestStatus = "REQUESTED";
  if (toUpperText(approvalRow.execution_status) === "EXECUTED") {
    nextRequestStatus = "EXECUTED";
  } else if (toUpperText(approvalRow.request_status) === "REJECTED") {
    nextRequestStatus = "REJECTED";
  } else if (toUpperText(approvalRow.request_status) === "APPROVED") {
    nextRequestStatus = "APPROVED";
  }

  await runQuery(
    `UPDATE local_close_pack_reopen_requests
        SET request_status = ?,
            reviewed_by_user_id = ?,
            reviewed_at = ?,
            decision_note = COALESCE(?, decision_note),
            approval_request_id = COALESCE(?, approval_request_id),
            updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ?
        AND id = ?`,
    [
      nextRequestStatus,
      parsePositiveInt(latestDecision?.decided_by_user_id) ||
        parsePositiveInt(approvalRow.executed_by_user_id) ||
        null,
      approvalRow.executed_at ||
        approvalRow.rejected_at ||
        approvalRow.approved_at ||
        latestDecision?.decided_at ||
        null,
      latestDecision?.comment || null,
      approvalRequestId,
      tenantId,
      parsePositiveInt(localRow.id),
    ]
  );

  return loadLocalClosePackReopenRequestRow({
    tenantId,
    packId: parsePositiveInt(localRow.local_close_pack_id),
    requestId: parsePositiveInt(localRow.id),
    runQuery,
  });
}

/**
 * List reopen requests for one local close pack.
 */
export async function listLocalClosePackReopenRequests({
  req,
  tenantId,
  packId,
  requestStatus = null,
  assertScopeAccess,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedPackId = parsePositiveInt(packId);
  if (!normalizedTenantId) {
    throw badRequest("tenantId is required");
  }
  if (!normalizedPackId) {
    throw badRequest("packId is required");
  }

  const packRow = await loadLocalClosePackHeader({
    tenantId: normalizedTenantId,
    packId: normalizedPackId,
    runQuery,
  });
  if (!packRow) {
    throw notFound("Local close pack not found");
  }
  assertLocalClosePackScopeAccess(req, packRow, assertScopeAccess);

  const where = ["lcrr.tenant_id = ?", "lcrr.local_close_pack_id = ?"];
  const params = [normalizedTenantId, normalizedPackId];
  if (requestStatus) {
    where.push("lcrr.request_status = ?");
    params.push(toUpperText(requestStatus));
  }

  const result = await runQuery(
    `${buildLocalClosePackReopenRequestBaseSelect(where.join(" AND "))}
     ORDER BY lcrr.id DESC`,
    params
  );

  return {
    rows: (result.rows || []).map(mapLocalClosePackReopenRequestRow),
  };
}

/**
 * Create a governed reopen request for one local close pack.
 */
export async function createLocalClosePackReopenRequest({
  req,
  input,
  assertScopeAccess,
  runQuery = query,
}) {
  const packRow = await loadLocalClosePackHeader({
    tenantId: input.tenantId,
    packId: input.packId,
    runQuery,
  });
  if (!packRow) {
    throw notFound("Local close pack not found");
  }
  assertLocalClosePackScopeAccess(req, packRow, assertScopeAccess);

  const currentStatus = toUpperText(packRow.status);
  if (
    isFinancialLocalClosePackReopenAction(input.requestedActionType) &&
    !FINANCIALLY_REOPENABLE_PACK_STATUSES.has(currentStatus)
  ) {
    throw conflict(
      `Financial reopen requests require APPROVED or LOCKED local close packs (current: ${currentStatus})`
    );
  }
  if (
    isFinancialLocalClosePackReopenAction(input.requestedActionType) &&
    currentStatus === "REOPENED"
  ) {
    throw conflict("Local close pack is already REOPENED");
  }

  const existingRequest = await loadPendingReopenRequestRow({
    tenantId: input.tenantId,
    packId: input.packId,
    requestedActionType: input.requestedActionType,
    runQuery,
  });
  if (existingRequest) {
    throw conflict("A matching reopen request is already pending for this local close pack", {
      existingRequestId: parsePositiveInt(existingRequest.id),
      existingRequestStatus: toUpperText(existingRequest.request_status),
    });
  }

  const requiresHighGovernance = input.downstreamStage === "GROUP_PUBLISHED";
  const insertResult = await runQuery(
    `INSERT INTO local_close_pack_reopen_requests (
        tenant_id,
        local_close_pack_id,
        legal_entity_id,
        book_id,
        fiscal_period_id,
        close_scope_type,
        scope_key,
        operating_unit_id,
        request_status,
        reason_code,
        requested_action_type,
        explanation,
        materiality_level,
        estimated_impact_note,
        downstream_stage,
        requires_high_governance,
        requested_by_user_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'REQUESTED', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.tenantId,
      input.packId,
      parsePositiveInt(packRow.legal_entity_id),
      parsePositiveInt(packRow.book_id),
      parsePositiveInt(packRow.fiscal_period_id),
      toUpperText(packRow.close_scope_type),
      String(packRow.scope_key || ""),
      parsePositiveInt(packRow.operating_unit_id) || null,
      input.reasonCode,
      input.requestedActionType,
      input.explanation,
      input.materialityLevel,
      input.estimatedImpactNote || null,
      input.downstreamStage,
      requiresHighGovernance ? 1 : 0,
      input.userId,
    ]
  );

  const requestRow = await loadLocalClosePackReopenRequestRow({
    tenantId: input.tenantId,
    packId: input.packId,
    requestId: parsePositiveInt(insertResult.rows?.insertId),
    runQuery,
  });

  let approvalRequestId = null;
  if (requestRow) {
    const approvalActionType = getLocalClosePackReopenApprovalActionType(
      input.requestedActionType
    );
    const submission = await submitApprovalRequest({
      tenantId: input.tenantId,
      userId: input.userId,
      requestInput: {
        moduleCode: "LOCAL_CLOSE",
        targetType: "LOCAL_CLOSE_PACK_REOPEN_REQUEST",
        targetId: parsePositiveInt(requestRow.id),
        actionType: approvalActionType,
        legalEntityId: parsePositiveInt(packRow.legal_entity_id),
        operatingUnitId: parsePositiveInt(packRow.operating_unit_id) || null,
        actionPayload: {
          requestId: parsePositiveInt(requestRow.id),
          packId: input.packId,
          requestedActionType: toUpperText(input.requestedActionType),
        },
        targetSnapshot: {
          module_code: "LOCAL_CLOSE",
          target_type: "LOCAL_CLOSE_PACK_REOPEN_REQUEST",
          target_id: parsePositiveInt(requestRow.id),
          local_close_pack_id: input.packId,
          legal_entity_id: parsePositiveInt(packRow.legal_entity_id),
          operating_unit_id: parsePositiveInt(packRow.operating_unit_id) || null,
          requested_action_type: toUpperText(input.requestedActionType),
          downstream_stage: toUpperText(input.downstreamStage),
          requires_high_governance: Boolean(requiresHighGovernance),
          execution_resolver_key:
            approvalActionType === "REOPEN"
              ? "LOCAL_CLOSE:LOCAL_CLOSE_PACK_REOPEN_REQUEST:REOPEN"
              : null,
        },
      },
      runQuery,
    });

    if (submission?.approval_required && parsePositiveInt(submission?.item?.id)) {
      approvalRequestId = parsePositiveInt(submission.item.id);
      await runQuery(
        `UPDATE local_close_pack_reopen_requests
            SET approval_request_id = ?,
                updated_at = CURRENT_TIMESTAMP
          WHERE tenant_id = ?
            AND local_close_pack_id = ?
            AND id = ?`,
        [approvalRequestId, input.tenantId, input.packId, parsePositiveInt(requestRow.id)]
      );
    }
  }

  const refreshedRequestRow = await loadLocalClosePackReopenRequestRow({
    tenantId: input.tenantId,
    packId: input.packId,
    requestId: parsePositiveInt(requestRow?.id),
    runQuery,
  });

  await writeLocalClosePackAuditLog({
    runQuery,
    req,
    tenantId: input.tenantId,
    userId: input.userId,
    packRow,
    action: "ouclose.reopen.request",
    resourceId: parsePositiveInt(requestRow?.id),
    payload: {
      requestId: parsePositiveInt(requestRow?.id),
      localClosePackId: input.packId,
      reasonCode: input.reasonCode,
      requestedActionType: input.requestedActionType,
      downstreamStage: input.downstreamStage,
      requiresHighGovernance,
      approvalRequestId,
    },
  });

  return {
    row: mapLocalClosePackReopenRequestRow(refreshedRequestRow || requestRow),
    entityReadiness: await getEntityCloseReadiness({
      tenantId: input.tenantId,
      legalEntityId: parsePositiveInt(packRow.legal_entity_id),
      bookId: parsePositiveInt(packRow.book_id),
      fiscalPeriodId: parsePositiveInt(packRow.fiscal_period_id),
      runQuery,
    }),
  };
}

/**
 * Approve and, when financially relevant, execute a local close-pack reopen request.
 */
export async function approveLocalClosePackReopenRequest({
  req,
  input,
  assertScopeAccess,
  skipUnifiedApprovalGate = false,
  approvalRequestId = null,
}) {
  return withTransaction(async (tx) => {
    const packRow = await loadLocalClosePackHeader({
      tenantId: input.tenantId,
      packId: input.packId,
      runQuery: tx.query,
      forUpdate: true,
    });
    if (!packRow) {
      throw notFound("Local close pack not found");
    }
    assertLocalClosePackScopeAccess(req, packRow, assertScopeAccess);

    const requestRow = await loadLocalClosePackReopenRequestRow({
      tenantId: input.tenantId,
      packId: input.packId,
      requestId: input.requestId,
      runQuery: tx.query,
      forUpdate: true,
    });
    if (!requestRow) {
      throw notFound("Local close-pack reopen request not found");
    }
    if (toUpperText(requestRow.request_status) !== "REQUESTED") {
      throw conflict(
        `Only REQUESTED reopen requests can be approved (current: ${toUpperText(requestRow.request_status)})`
      );
    }

    if (!skipUnifiedApprovalGate) {
      await assertPublishedPeriodGovernanceIfNeeded(req, packRow, requestRow);
    }

    const bridgedApprovalRequestId =
      parsePositiveInt(approvalRequestId) || parsePositiveInt(requestRow.approval_request_id);
    if (!skipUnifiedApprovalGate && bridgedApprovalRequestId) {
      let decisionResult = await recordDecision(
        bridgedApprovalRequestId,
        input.userId,
        "APPROVE",
        input.decisionNote || null
      );
      let approvalItem = decisionResult.item || null;
      if (
        toUpperText(approvalItem?.requestStatus) === "APPROVED" &&
        toUpperText(approvalItem?.executionStatus) !== "EXECUTED" &&
        getLocalClosePackReopenApprovalActionType(requestRow.requested_action_type) === "REOPEN"
      ) {
        const executionResult = await executeRequest(bridgedApprovalRequestId, {
          executedByUserId: input.userId,
        });
        approvalItem = executionResult.item || approvalItem;
        decisionResult = {
          ...decisionResult,
          item: approvalItem,
          execution_result:
            executionResult.execution_result || decisionResult.execution_result || null,
        };
      }

      const syncedRequestRow = await syncLocalClosePackReopenApprovalRequestBridgeTx({
        tenantId: input.tenantId,
        approvalRequestId: bridgedApprovalRequestId,
        runQuery: tx.query,
      });
      return {
        row: mapLocalClosePackReopenRequestRow(syncedRequestRow || requestRow),
        approvalRequest: approvalItem,
        executionResult: decisionResult.execution_result || null,
        entityReadiness: await getEntityCloseReadiness({
          tenantId: input.tenantId,
          legalEntityId: parsePositiveInt(packRow.legal_entity_id),
          bookId: parsePositiveInt(packRow.book_id),
          fiscalPeriodId: parsePositiveInt(packRow.fiscal_period_id),
          runQuery: tx.query,
        }),
      };
    }

    await assertSoD({
      tenantId: input.tenantId,
      userId: input.userId,
      actionCode: "local.close.reopen.review",
      recordType: "LOCAL_CLOSE_PACK_REOPEN_REQUEST",
      recordId: input.requestId,
      context: {
        actorUserIds: {
          requestedByUserId: requestRow.requested_by_user_id,
          reviewedByUserId: requestRow.reviewed_by_user_id,
        },
      },
    });

    const requestActionType = toUpperText(requestRow.requested_action_type);
    let requestStatus = "APPROVED";
    if (isFinancialLocalClosePackReopenAction(requestActionType)) {
      const currentStatus = toUpperText(packRow.status);
      if (!FINANCIALLY_REOPENABLE_PACK_STATUSES.has(currentStatus)) {
        throw conflict(
          `Financial reopen approval requires APPROVED or LOCKED local close pack state (current: ${currentStatus})`
        );
      }

      await tx.query(
        `UPDATE local_close_packs
         SET status = 'REOPENED',
             reopened_at = CURRENT_TIMESTAMP,
             updated_by_user_id = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE tenant_id = ?
           AND id = ?`,
        [input.userId, input.tenantId, input.packId]
      );
      requestStatus = "EXECUTED";
    } else if (!isEvidenceOnlyLocalClosePackReopenAction(requestActionType)) {
      throw badRequest(`Unsupported requestedActionType: ${requestActionType}`);
    }

    await tx.query(
      `UPDATE local_close_pack_reopen_requests
       SET request_status = ?,
           reviewed_by_user_id = ?,
           reviewed_at = CURRENT_TIMESTAMP,
           decision_note = ?,
           approval_request_id = COALESCE(?, approval_request_id)
       WHERE tenant_id = ?
         AND local_close_pack_id = ?
         AND id = ?`,
      [
        requestStatus,
        input.userId,
        input.decisionNote || null,
        bridgedApprovalRequestId || null,
        input.tenantId,
        input.packId,
        input.requestId,
      ]
    );

    const updatedRequestRow = await loadLocalClosePackReopenRequestRow({
      tenantId: input.tenantId,
      packId: input.packId,
      requestId: input.requestId,
      runQuery: tx.query,
    });
    const updatedPackRow = await loadLocalClosePackHeader({
      tenantId: input.tenantId,
      packId: input.packId,
      runQuery: tx.query,
    });

    await writeLocalClosePackAuditLog({
      runQuery: tx.query,
      req,
      tenantId: input.tenantId,
      userId: input.userId,
      packRow: updatedPackRow || packRow,
      action:
        requestStatus === "EXECUTED"
          ? "ouclose.reopen.execute"
          : "ouclose.reopen.approve_evidence_only",
      resourceId: input.requestId,
      payload: {
        requestId: input.requestId,
        localClosePackId: input.packId,
        requestedActionType: requestActionType,
        requestStatus,
        decisionNote: input.decisionNote || null,
      },
    });

    return {
      row: mapLocalClosePackReopenRequestRow(updatedRequestRow),
      entityReadiness: await getEntityCloseReadiness({
        tenantId: input.tenantId,
        legalEntityId: parsePositiveInt(packRow.legal_entity_id),
        bookId: parsePositiveInt(packRow.book_id),
        fiscalPeriodId: parsePositiveInt(packRow.fiscal_period_id),
        runQuery: tx.query,
      }),
    };
  });
}

/**
 * Reject a governed local close-pack reopen request.
 */
export async function rejectLocalClosePackReopenRequest({
  req,
  input,
  assertScopeAccess,
  skipUnifiedApprovalGate = false,
  approvalRequestId = null,
}) {
  return withTransaction(async (tx) => {
    const packRow = await loadLocalClosePackHeader({
      tenantId: input.tenantId,
      packId: input.packId,
      runQuery: tx.query,
      forUpdate: true,
    });
    if (!packRow) {
      throw notFound("Local close pack not found");
    }
    assertLocalClosePackScopeAccess(req, packRow, assertScopeAccess);

    const requestRow = await loadLocalClosePackReopenRequestRow({
      tenantId: input.tenantId,
      packId: input.packId,
      requestId: input.requestId,
      runQuery: tx.query,
      forUpdate: true,
    });
    if (!requestRow) {
      throw notFound("Local close-pack reopen request not found");
    }
    if (toUpperText(requestRow.request_status) !== "REQUESTED") {
      throw conflict(
        `Only REQUESTED reopen requests can be rejected (current: ${toUpperText(requestRow.request_status)})`
      );
    }

    if (!skipUnifiedApprovalGate) {
      await assertPublishedPeriodGovernanceIfNeeded(req, packRow, requestRow);
    }

    const bridgedApprovalRequestId =
      parsePositiveInt(approvalRequestId) || parsePositiveInt(requestRow.approval_request_id);
    if (!skipUnifiedApprovalGate && bridgedApprovalRequestId) {
      const decisionResult = await recordDecision(
        bridgedApprovalRequestId,
        input.userId,
        "REJECT",
        input.decisionNote || null
      );
      const syncedRequestRow = await syncLocalClosePackReopenApprovalRequestBridgeTx({
        tenantId: input.tenantId,
        approvalRequestId: bridgedApprovalRequestId,
        runQuery: tx.query,
      });

      return {
        row: mapLocalClosePackReopenRequestRow(syncedRequestRow || requestRow),
        approvalRequest: decisionResult.item || null,
        entityReadiness: await getEntityCloseReadiness({
          tenantId: input.tenantId,
          legalEntityId: parsePositiveInt(packRow.legal_entity_id),
          bookId: parsePositiveInt(packRow.book_id),
          fiscalPeriodId: parsePositiveInt(packRow.fiscal_period_id),
          runQuery: tx.query,
        }),
      };
    }

    await assertSoD({
      tenantId: input.tenantId,
      userId: input.userId,
      actionCode: "local.close.reopen.review",
      recordType: "LOCAL_CLOSE_PACK_REOPEN_REQUEST",
      recordId: input.requestId,
      context: {
        actorUserIds: {
          requestedByUserId: requestRow.requested_by_user_id,
          reviewedByUserId: requestRow.reviewed_by_user_id,
        },
      },
    });

    await tx.query(
      `UPDATE local_close_pack_reopen_requests
       SET request_status = 'REJECTED',
           reviewed_by_user_id = ?,
           reviewed_at = CURRENT_TIMESTAMP,
           decision_note = ?,
           approval_request_id = COALESCE(?, approval_request_id)
       WHERE tenant_id = ?
         AND local_close_pack_id = ?
         AND id = ?`,
      [
        input.userId,
        input.decisionNote || null,
        bridgedApprovalRequestId || null,
        input.tenantId,
        input.packId,
        input.requestId,
      ]
    );

    const updatedRequestRow = await loadLocalClosePackReopenRequestRow({
      tenantId: input.tenantId,
      packId: input.packId,
      requestId: input.requestId,
      runQuery: tx.query,
    });

    await writeLocalClosePackAuditLog({
      runQuery: tx.query,
      req,
      tenantId: input.tenantId,
      userId: input.userId,
      packRow,
      action: "ouclose.reopen.reject",
      resourceId: input.requestId,
      payload: {
        requestId: input.requestId,
        localClosePackId: input.packId,
        decisionNote: input.decisionNote || null,
      },
    });

    return {
      row: mapLocalClosePackReopenRequestRow(updatedRequestRow),
      entityReadiness: await getEntityCloseReadiness({
        tenantId: input.tenantId,
        legalEntityId: parsePositiveInt(packRow.legal_entity_id),
        bookId: parsePositiveInt(packRow.book_id),
        fiscalPeriodId: parsePositiveInt(packRow.fiscal_period_id),
        runQuery: tx.query,
      }),
    };
  });
}

/**
 * Execute one approved financial local close-pack reopen request.
 */
export async function executeApprovedLocalClosePackReopenRequest({
  tenantId,
  approvalRequestId,
  approvedByUserId,
  payload = {},
}) {
  const requestId = parsePositiveInt(payload?.requestId ?? payload?.request_id);
  let requestRow =
    requestId &&
    (await loadLocalClosePackReopenRequestRow({
      tenantId,
      packId: parsePositiveInt(payload?.packId ?? payload?.pack_id),
      requestId,
      runQuery: query,
    }));

  if (!requestRow) {
    requestRow = await loadLocalClosePackReopenRequestByApprovalRequestId({
      tenantId,
      approvalRequestId,
      runQuery: query,
    });
  }
  if (!requestRow) {
    throw badRequest("Approved local close-pack reopen payload is missing request identity");
  }

  return approveLocalClosePackReopenRequest({
    req: null,
    input: {
      tenantId,
      packId: parsePositiveInt(requestRow.local_close_pack_id),
      requestId: parsePositiveInt(requestRow.id),
      userId: parsePositiveInt(approvedByUserId) || null,
      decisionNote:
        String(payload?.decisionNote ?? payload?.decision_note ?? "").trim() ||
        "Approved via unified approval engine",
    },
    assertScopeAccess: noopScopeAccess,
    skipUnifiedApprovalGate: true,
    approvalRequestId,
  });
}

/**
 * Sync one unified approval request back to its bridged local close-pack reopen request.
 */
export async function syncLocalClosePackReopenApprovalRequestBridge({
  tenantId,
  approvalRequestId,
  runQuery = query,
}) {
  return syncLocalClosePackReopenApprovalRequestBridgeTx({
    tenantId,
    approvalRequestId,
    runQuery,
  });
}

/**
 * Load the derived entity readiness for the entity/book/period behind one local close pack.
 */
export async function getLocalClosePackEntityReadinessByPackId({
  req,
  tenantId,
  packId,
  assertScopeAccess,
  runQuery = query,
}) {
  const packRow = await loadLocalClosePackHeader({
    tenantId,
    packId,
    runQuery,
  });
  if (!packRow) {
    throw notFound("Local close pack not found");
  }
  assertLocalClosePackScopeAccess(req, packRow, assertScopeAccess);

  return getEntityCloseReadiness({
    tenantId,
    legalEntityId: parsePositiveInt(packRow.legal_entity_id),
    bookId: parsePositiveInt(packRow.book_id),
    fiscalPeriodId: parsePositiveInt(packRow.fiscal_period_id),
    runQuery,
  });
}

export default {
  listLocalClosePackReopenRequests,
  createLocalClosePackReopenRequest,
  approveLocalClosePackReopenRequest,
  rejectLocalClosePackReopenRequest,
  executeApprovedLocalClosePackReopenRequest,
  syncLocalClosePackReopenApprovalRequestBridge,
  getLocalClosePackEntityReadinessByPackId,
  findBlockingLocalClosePackForJournalAction,
  assertLocalClosePackJournalActionAllowed,
};
