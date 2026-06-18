import { query, withTransaction } from "../db.js";
import { parsePositiveInt } from "../routes/_utils.js";
import { CLOSE_TASK_INSTANCE } from "../utils/source-ref-types.js";
import {
  writeCloseTaskAuditLog,
  writeCloseTaskLifecycleEvent,
} from "./close.task-events.service.js";
import { loadCloseTaskForDependentService } from "./close.tasks.service.js";

function mapCommentRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    scopeType: row.scope_type || null,
    scopeId: parsePositiveInt(row.scope_id),
    scopeKey: row.scope_key || null,
    sourceRefType: row.source_ref_type || null,
    sourceRefId: parsePositiveInt(row.source_ref_id),
    body: row.body || "",
    status: row.status || "ACTIVE",
    createdByUserId: parsePositiveInt(row.created_by_user_id),
    updatedByUserId: parsePositiveInt(row.updated_by_user_id),
    deletedByUserId: parsePositiveInt(row.deleted_by_user_id),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    deletedAt: row.deleted_at || null,
  };
}

function notFound(message) {
  const err = new Error(message);
  err.status = 404;
  return err;
}

/**
 * List active comments attached to a close task through generic comment scope.
 */
export async function listCloseTaskComments({ tenantId, taskId }, actorCtx = {}) {
  const runQuery = actorCtx.runQuery || query;
  await loadCloseTaskForDependentService({ tenantId, taskId, actorCtx, runQuery });
  const result = await runQuery(
    `SELECT *
     FROM internal_comments
     WHERE tenant_id = ?
       AND source_ref_type = ?
       AND source_ref_id = ?
       AND status = 'ACTIVE'
     ORDER BY id DESC`,
    [parsePositiveInt(tenantId), CLOSE_TASK_INSTANCE, parsePositiveInt(taskId)],
  );
  return { rows: (result.rows || []).map(mapCommentRow) };
}

/**
 * Create one task comment and append a `COMMENT_ADDED` task event.
 */
export async function createCloseTaskComment(input = {}, actorCtx = {}) {
  const tenantId = parsePositiveInt(input.tenantId || actorCtx.tenantId);
  const taskId = parsePositiveInt(input.taskId);
  const userId = parsePositiveInt(input.userId || actorCtx.userId);
  return withTransaction(async (tx) => {
    const task = await loadCloseTaskForDependentService({
      tenantId,
      taskId,
      actorCtx,
      runQuery: tx.query,
    });
    await tx.query(
      `INSERT INTO internal_comments (
         tenant_id,
         legal_entity_id,
         scope_type,
         scope_id,
         scope_key,
         source_ref_type,
         source_ref_id,
         body,
         status,
         created_by_user_id,
         updated_by_user_id
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`,
      [
        tenantId,
        parsePositiveInt(task.legal_entity_id),
        task.rbac_scope_type,
        task.rbac_scope_id,
        task.rbac_scope_key,
        CLOSE_TASK_INSTANCE,
        taskId,
        input.body,
        userId,
        userId,
      ],
    );
    await writeCloseTaskLifecycleEvent({
      runQuery: tx.query,
      req: actorCtx.req,
      tenantId,
      taskRow: task,
      eventType: "COMMENT_ADDED",
      fromStatus: task.status,
      toStatus: task.status,
      actorUserId: userId,
      payload: { sourceRefType: CLOSE_TASK_INSTANCE, sourceRefId: taskId },
    });
    return listCloseTaskComments({ tenantId, taskId }, { ...actorCtx, runQuery: tx.query });
  });
}

/**
 * Soft-delete one task comment in the generic internal comments table.
 */
export async function deleteCloseTaskComment(input = {}, actorCtx = {}) {
  const tenantId = parsePositiveInt(input.tenantId || actorCtx.tenantId);
  const taskId = parsePositiveInt(input.taskId);
  const userId = parsePositiveInt(input.userId || actorCtx.userId);
  return withTransaction(async (tx) => {
    const task = await loadCloseTaskForDependentService({
      tenantId,
      taskId,
      actorCtx,
      runQuery: tx.query,
    });
    const updateResult = await tx.query(
      `UPDATE internal_comments
       SET status = 'DELETED',
           deleted_by_user_id = ?,
           deleted_at = CURRENT_TIMESTAMP,
           updated_by_user_id = ?
       WHERE tenant_id = ?
         AND source_ref_type = ?
         AND source_ref_id = ?
         AND id = ?
         AND status = 'ACTIVE'`,
      [
        userId,
        userId,
        tenantId,
        CLOSE_TASK_INSTANCE,
        taskId,
        parsePositiveInt(input.commentId),
      ],
    );
    if (Number(updateResult.rows?.affectedRows || 0) < 1) {
      throw notFound("Task comment not found");
    }
    // `close_task_events` does not have COMMENT_DELETED yet; keep central audit
    // coverage without changing the PR-CTM-01 event enum midstream.
    await writeCloseTaskAuditLog({
      runQuery: tx.query,
      req: actorCtx.req,
      tenantId,
      userId,
      taskRow: task,
      action: "close.task.comment_deleted",
      payload: {
        commentId: parsePositiveInt(input.commentId),
        sourceRefType: CLOSE_TASK_INSTANCE,
        sourceRefId: taskId,
      },
    });
    return listCloseTaskComments({ tenantId, taskId }, { ...actorCtx, runQuery: tx.query });
  });
}
