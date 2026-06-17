import { query, withTransaction } from "../db.js";
import { parsePositiveInt } from "../routes/_utils.js";
import { CLOSE_TASK_INSTANCE } from "../utils/source-ref-types.js";
import { assertCloseTaskCycleEditable } from "./close.task-scope.service.js";
import { writeCloseTaskLifecycleEvent } from "./close.task-events.service.js";
import { loadCloseTaskForDependentService } from "./close.tasks.service.js";

function notImplemented(message) {
  const err = new Error(message);
  err.status = 501;
  err.code = "NOT_IMPLEMENTED";
  return err;
}

function notFound(message) {
  const err = new Error(message);
  err.status = 404;
  return err;
}

function mapEvidenceRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    closeTaskInstanceId: parsePositiveInt(row.close_task_instance_id),
    evidenceObjectId: parsePositiveInt(row.evidence_object_id),
    status: row.status || "ACTIVE",
    attachedByUserId: parsePositiveInt(row.attached_by_user_id),
    attachedAt: row.attached_at || null,
    removedByUserId: parsePositiveInt(row.removed_by_user_id),
    removedAt: row.removed_at || null,
    removeReason: row.remove_reason || null,
    evidence: {
      status: row.evidence_status || null,
      displayName: row.display_name || null,
      fileName: row.file_name || null,
      contentType: row.content_type || null,
      fileSizeBytes: row.file_size_bytes === null ? null : Number(row.file_size_bytes || 0),
      uploadedAt: row.uploaded_at || null,
      sourceRefType: row.source_ref_type || null,
      sourceRefId: parsePositiveInt(row.source_ref_id),
    },
  };
}

async function loadEvidenceObject({ tenantId, evidenceObjectId, runQuery = query }) {
  const result = await runQuery(
    `SELECT *
     FROM evidence_objects
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [parsePositiveInt(tenantId), parsePositiveInt(evidenceObjectId)],
  );
  return result.rows?.[0] || null;
}

/**
 * List active and removed evidence links for a close task.
 */
export async function listCloseTaskEvidence({ tenantId, taskId }, actorCtx = {}) {
  const runQuery = actorCtx.runQuery || query;
  await loadCloseTaskForDependentService({ tenantId, taskId, actorCtx, runQuery });
  const result = await runQuery(
    `SELECT
       cte.*,
       eo.status AS evidence_status,
       eo.display_name,
       eo.file_name,
       eo.content_type,
       eo.file_size_bytes,
       eo.uploaded_at,
       eo.source_ref_type,
       eo.source_ref_id
     FROM close_task_evidence cte
     JOIN evidence_objects eo
       ON eo.id = cte.evidence_object_id
      AND eo.tenant_id = cte.tenant_id
     WHERE cte.tenant_id = ?
       AND cte.close_task_instance_id = ?
     ORDER BY cte.attached_at DESC, cte.id DESC`,
    [parsePositiveInt(tenantId), parsePositiveInt(taskId)],
  );
  return { rows: (result.rows || []).map(mapEvidenceRow) };
}

/**
 * Attach an existing evidence object to a close task, reactivating removed links.
 */
export async function attachCloseTaskEvidence(input = {}, actorCtx = {}) {
  const tenantId = parsePositiveInt(input.tenantId || actorCtx.tenantId);
  const taskId = parsePositiveInt(input.taskId);
  const userId = parsePositiveInt(input.userId || actorCtx.userId);
  return withTransaction(async (tx) => {
    const task = await loadCloseTaskForDependentService({
      tenantId,
      taskId,
      actorCtx,
      runQuery: tx.query,
      forUpdate: true,
    });
    assertCloseTaskCycleEditable(task, "Attach task evidence");

    const evidenceObject = await loadEvidenceObject({
      tenantId,
      evidenceObjectId: input.evidenceObjectId,
      runQuery: tx.query,
    });
    if (!evidenceObject) {
      throw notFound("Evidence object not found");
    }

    await tx.query(
      `UPDATE evidence_objects
       SET source_ref_type = ?,
           source_ref_id = ?,
           scope_type = ?,
           scope_id = ?,
           scope_key = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE tenant_id = ?
         AND id = ?`,
      [
        CLOSE_TASK_INSTANCE,
        taskId,
        task.rbac_scope_type,
        task.rbac_scope_id,
        task.rbac_scope_key,
        tenantId,
        parsePositiveInt(input.evidenceObjectId),
      ],
    );

    await tx.query(
      `INSERT INTO close_task_evidence (
         tenant_id,
         close_task_instance_id,
         evidence_object_id,
         status,
         attached_by_user_id,
         attached_at
       )
       VALUES (?, ?, ?, 'ACTIVE', ?, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE
         status = 'ACTIVE',
         attached_by_user_id = VALUES(attached_by_user_id),
         attached_at = CURRENT_TIMESTAMP,
         removed_by_user_id = NULL,
         removed_at = NULL,
         remove_reason = NULL`,
      [tenantId, taskId, parsePositiveInt(input.evidenceObjectId), userId || null],
    );

    await writeCloseTaskLifecycleEvent({
      runQuery: tx.query,
      req: actorCtx.req,
      tenantId,
      taskRow: task,
      eventType: "EVIDENCE_ATTACHED",
      fromStatus: task.status,
      toStatus: task.status,
      actorUserId: userId,
      payload: { evidenceObjectId: parsePositiveInt(input.evidenceObjectId) },
    });

    return listCloseTaskEvidence({ tenantId, taskId }, { ...actorCtx, runQuery: tx.query });
  });
}

/**
 * Soft-remove one evidence link from a close task.
 */
export async function removeCloseTaskEvidence(input = {}, actorCtx = {}) {
  const tenantId = parsePositiveInt(input.tenantId || actorCtx.tenantId);
  const taskId = parsePositiveInt(input.taskId);
  const evidenceObjectId = parsePositiveInt(input.evidenceId);
  const userId = parsePositiveInt(input.userId || actorCtx.userId);
  return withTransaction(async (tx) => {
    const task = await loadCloseTaskForDependentService({
      tenantId,
      taskId,
      actorCtx,
      runQuery: tx.query,
      forUpdate: true,
    });
    assertCloseTaskCycleEditable(task, "Remove task evidence");

    await tx.query(
      `UPDATE close_task_evidence
       SET status = 'REMOVED',
           removed_by_user_id = ?,
           removed_at = CURRENT_TIMESTAMP,
           remove_reason = ?
       WHERE tenant_id = ?
         AND close_task_instance_id = ?
         AND evidence_object_id = ?`,
      [userId || null, input.reason || null, tenantId, taskId, evidenceObjectId],
    );

    await writeCloseTaskLifecycleEvent({
      runQuery: tx.query,
      req: actorCtx.req,
      tenantId,
      taskRow: task,
      eventType: "EVIDENCE_REMOVED",
      fromStatus: task.status,
      toStatus: task.status,
      actorUserId: userId,
      note: input.reason || null,
      payload: { evidenceObjectId },
    });

    return listCloseTaskEvidence({ tenantId, taskId }, { ...actorCtx, runQuery: tx.query });
  });
}

/**
 * Placeholder for PR-CTM-07 storage adapter content upload.
 */
export async function uploadCloseTaskEvidenceContent() {
  throw notImplemented("Close task evidence content upload is implemented in PR-CTM-07");
}

/**
 * Placeholder for PR-CTM-07 storage adapter download.
 */
export async function downloadCloseTaskEvidence() {
  throw notImplemented("Close task evidence download is implemented in PR-CTM-07");
}
