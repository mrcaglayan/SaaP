import { query } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import {
  AP_DOCUMENT_WORKFLOW_PROCESS_TYPE,
  CARI_DOCUMENT_WORKFLOW_TARGET_TYPE,
  isDocClassWorkflowGoverned,
} from "../../../shared/cariDocumentWorkflowGovernance.js";

const POSTING_COMPLETED_DOCUMENT_STATUSES = new Set([
  "POSTED",
  "PARTIALLY_SETTLED",
  "SETTLED",
  "REVERSED",
  "CANCELLED",
]);

function toUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function conflict(message, code = "") {
  const err = new Error(message);
  err.status = 409;
  if (code) {
    err.code = code;
  }
  return err;
}

function notFound(message) {
  const err = new Error(message);
  err.status = 404;
  return err;
}

function resolveLatestDecisionComment(decisionRows = [], fallback = null) {
  const rows = Array.isArray(decisionRows) ? decisionRows : [];
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index] || {};
    const comment =
      String(row.comment ?? row.decisionNote ?? row.decision_note ?? "").trim() || null;
    if (comment) {
      return comment;
    }
  }
  return String(fallback || "").trim() || null;
}

async function loadCariDocumentWorkflowRow({
  tenantId,
  documentId,
  runQuery = query,
  forUpdate = false,
}) {
  const result = await runQuery(
    `SELECT
        d.id,
        d.tenant_id,
        d.status,
        d.direction,
        d.document_type,
        d.return_reason,
        d.returned_at,
        d.row_version,
        dcm.is_workflow_governed
     FROM cari_documents d
     LEFT JOIN cari_document_class_metadata dcm
       ON dcm.tenant_id = d.tenant_id
      AND dcm.direction = d.direction
      AND dcm.document_type = d.document_type
     WHERE d.tenant_id = ?
       AND d.id = ?
     LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [tenantId, documentId]
  );
  return result.rows?.[0] || null;
}

function assertGovernedApTarget(documentRow) {
  const workflowGoverned = isDocClassWorkflowGoverned({
    direction: documentRow?.direction,
    documentType: documentRow?.document_type ?? documentRow?.documentType,
    is_workflow_governed: documentRow?.is_workflow_governed ?? documentRow?.isWorkflowGoverned,
  });
  if (toUpperText(documentRow?.direction) !== "AP" || !workflowGoverned) {
    throw conflict(
      "Workflow target is not a governed AP document",
      "AP_WORKFLOW_TARGET_INVALID"
    );
  }
}

/**
 * Sync one unified workflow request outcome back into the governed AP business
 * document when the legacy workflow target is a CARI document.
 */
export async function syncCariDocumentFromWorkflowRequestTx({
  tenantId,
  requestRow,
  legacyInstanceRow = null,
  decisionRows = [],
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const targetType = toUpperText(requestRow?.target_type ?? requestRow?.targetType);
  const targetId = parsePositiveInt(requestRow?.target_id ?? requestRow?.targetId);
  const processType = toUpperText(
    legacyInstanceRow?.process_type ??
      legacyInstanceRow?.processType ??
      requestRow?.targetSnapshot?.process_type ??
      requestRow?.targetSnapshot?.processType
  );
  if (!normalizedTenantId) {
    throw badRequest("tenantId is required");
  }
  if (
    targetType !== CARI_DOCUMENT_WORKFLOW_TARGET_TYPE ||
    processType !== AP_DOCUMENT_WORKFLOW_PROCESS_TYPE ||
    !targetId
  ) {
    return null;
  }

  const documentRow = await loadCariDocumentWorkflowRow({
    tenantId: normalizedTenantId,
    documentId: targetId,
    runQuery,
    forUpdate: true,
  });
  if (!documentRow) {
    throw notFound("Workflow target CARI document not found");
  }
  assertGovernedApTarget(documentRow);

  const currentStatus = toUpperText(documentRow.status ?? documentRow.status);

  const requestStatus = toUpperText(
    requestRow?.request_status ?? requestRow?.requestStatus
  );
  if (requestStatus === "APPROVED") {
    // Late-arriving workflow sync must not overwrite a document that has already
    // reached a terminal state (POSTED, REVERSED, CANCELLED). The posting action
    // is the authoritative terminal step — the workflow approval that preceded it
    // is implicitly satisfied.
    if (POSTING_COMPLETED_DOCUMENT_STATUSES.has(currentStatus)) {
      return { documentId: targetId, status: currentStatus, returnReason: null };
    }
    await runQuery(
      `UPDATE cari_documents
          SET status = 'APPROVED',
              return_reason = NULL,
              returned_at = NULL,
              row_version = row_version + 1
        WHERE tenant_id = ?
          AND id = ?`,
      [normalizedTenantId, targetId]
    );
    return {
      documentId: targetId,
      status: "APPROVED",
      returnReason: null,
    };
  }

  if (!["RETURNED", "REJECTED"].includes(requestStatus)) {
    return null;
  }

  // A RETURNED/REJECTED sync on an already-terminal document is a no-op.
  // A document cannot be returned after it has been posted, reversed, or cancelled.
  if (POSTING_COMPLETED_DOCUMENT_STATUSES.has(currentStatus)) {
    return { documentId: targetId, status: currentStatus, returnReason: null };
  }

  const returnReason = resolveLatestDecisionComment(
    decisionRows,
    legacyInstanceRow?.resolution_note ?? legacyInstanceRow?.resolutionNote
  );
  if (!returnReason) {
    throw badRequest("decisionNote is required when returning a governed AP document");
  }

  await runQuery(
    `UPDATE cari_documents
        SET status = 'RETURNED',
            return_reason = ?,
            returned_at = CURRENT_TIMESTAMP,
            row_version = row_version + 1
      WHERE tenant_id = ?
        AND id = ?`,
    [returnReason, normalizedTenantId, targetId]
  );

  return {
    documentId: targetId,
    status: "RETURNED",
    returnReason,
  };
}

/**
 * Void one already-approved governed AP workflow instance when the approved
 * document is returned for correction. The generic approval request remains
 * APPROVED because that schema has no SUPERSEDED state, so the legacy workflow
 * row becomes the durable supersede marker.
 */
export async function supersedeApprovedCariDocumentWorkflowInstanceTx({
  tenantId,
  instanceRow,
  decisionNote,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedInstanceId = parsePositiveInt(instanceRow?.id);
  const normalizedTargetId = parsePositiveInt(
    instanceRow?.target_id ?? instanceRow?.targetId
  );
  const normalizedNote = String(decisionNote || "").trim();
  if (!normalizedTenantId) {
    throw badRequest("tenantId is required");
  }
  if (!normalizedInstanceId) {
    throw badRequest("instanceId is required");
  }
  if (!normalizedTargetId) {
    throw badRequest("targetId is required");
  }
  if (!normalizedNote) {
    throw badRequest("decisionNote is required");
  }
  if (
    toUpperText(instanceRow?.process_type ?? instanceRow?.processType) !==
      AP_DOCUMENT_WORKFLOW_PROCESS_TYPE ||
    toUpperText(instanceRow?.target_type ?? instanceRow?.targetType) !==
      CARI_DOCUMENT_WORKFLOW_TARGET_TYPE
  ) {
    throw conflict(
      "Only AP document workflow instances can be superseded from APPROVED",
      "AP_WORKFLOW_TARGET_INVALID"
    );
  }

  const documentRow = await loadCariDocumentWorkflowRow({
    tenantId: normalizedTenantId,
    documentId: normalizedTargetId,
    runQuery,
    forUpdate: true,
  });
  if (!documentRow) {
    throw notFound("Workflow target CARI document not found");
  }
  assertGovernedApTarget(documentRow);
  if (toUpperText(documentRow.status) !== "APPROVED") {
    throw conflict(
      "Only APPROVED governed AP documents can be returned from the approved state",
      "AP_DOCUMENT_STATUS_CONFLICT"
    );
  }

  await runQuery(
    `UPDATE cari_documents
        SET status = 'RETURNED',
            return_reason = ?,
            returned_at = CURRENT_TIMESTAMP,
            row_version = row_version + 1
      WHERE tenant_id = ?
        AND id = ?`,
    [normalizedNote, normalizedTenantId, normalizedTargetId]
  );

  await runQuery(
    `UPDATE workflow_instances
        SET status = 'SUPERSEDED',
            resolved_at = CURRENT_TIMESTAMP,
            resolution_note = ?,
            updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ?
        AND id = ?`,
    [normalizedNote, normalizedTenantId, normalizedInstanceId]
  );

  return {
    documentId: normalizedTargetId,
    workflowInstanceId: normalizedInstanceId,
    status: "RETURNED",
    returnReason: normalizedNote,
  };
}

export default {
  supersedeApprovedCariDocumentWorkflowInstanceTx,
  syncCariDocumentFromWorkflowRequestTx,
};
