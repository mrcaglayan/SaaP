import { randomUUID } from "node:crypto";
import { query, withTransaction } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import {
  checkUserCanAdministerCloseTaskAtScope,
  checkUserCanAssignCloseTaskAtScope,
  checkUserCanCreateCloseTaskAtScope,
  checkUserCanReviewCloseTask,
  checkUserCanWaiveCloseTask,
  checkUserCanWorkCloseTask,
  normalizeCloseTaskRbacScope,
} from "./authz.scope.service.js";
import {
  assertCloseTaskCycleEditable,
  assertCloseTaskVisibleToActor,
  buildCloseTaskScopeKey,
  buildCloseTaskVisibilityWhere,
  buildCloseTaskWorkScopeKey,
  isCloseTaskTerminalStatus,
  mapCloseTaskRow,
  normalizeCloseTaskCompletionMode,
  normalizeCloseTaskFamily,
  normalizeCloseTaskRbacScopePayload,
  normalizeCloseTaskWorkScopeType,
} from "./close.task-scope.service.js";
import { writeCloseTaskLifecycleEvent } from "./close.task-events.service.js";
import { evaluateCloseTaskSourceCheck } from "./close.task-source-checks.service.js";
import { resolveCloseCycleRowScope } from "./close.cycles.shared.js";

const SUBMITTABLE_STATUSES = new Set(["NOT_STARTED", "IN_PROGRESS", "RETURNED"]);
const WAIVABLE_STATUSES = new Set(["NOT_STARTED", "IN_PROGRESS", "SUBMITTED", "RETURNED"]);
const CANCELLABLE_STATUSES = new Set(["NOT_STARTED", "IN_PROGRESS", "SUBMITTED", "RETURNED"]);
const REOPENABLE_STATUSES = new Set(["APPROVED", "WAIVED", "CANCELLED"]);

function notFound(message) {
  const err = new Error(message);
  err.status = 404;
  return err;
}

function forbidden(message) {
  const err = new Error(message);
  err.status = 403;
  return err;
}

function conflict(message, details = null, code = "CLOSE_TASK_CONFLICT") {
  const err = new Error(message);
  err.status = 409;
  err.code = code;
  if (details !== null && details !== undefined) {
    err.details = details;
  }
  return err;
}

function serializeJson(value) {
  if (value === undefined || value === null) {
    return null;
  }
  return JSON.stringify(value);
}

function ensureUserId(actorCtx = {}) {
  const userId = parsePositiveInt(actorCtx.userId);
  if (!userId) {
    throw badRequest("Authenticated user is required");
  }
  return userId;
}

function buildTaskKey(input = {}) {
  const code = String(input.taskCode || "MANUAL_CLOSE_TASK")
    .trim()
    .toUpperCase();
  return `MANUAL:${code}:${randomUUID().slice(0, 12).toUpperCase()}`;
}

function hasAssignmentPatch(input = {}) {
  return (
    Object.prototype.hasOwnProperty.call(input, "ownerUserId") ||
    Object.prototype.hasOwnProperty.call(input, "reviewerUserId")
  );
}

async function assertUserBelongsToTenantIfPresent(userId, tenantId, label, runQuery) {
  const normalizedUserId = parsePositiveInt(userId);
  if (!normalizedUserId) {
    return;
  }
  const result = await runQuery(
    `SELECT id
     FROM users
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [parsePositiveInt(tenantId), normalizedUserId],
  );
  if (!result.rows?.[0]) {
    throw badRequest(`${label} must belong to the tenant`);
  }
}

async function loadCloseCycleForTenant({
  tenantId,
  cycleId,
  runQuery = query,
  forUpdate = false,
}) {
  const result = await runQuery(
    `SELECT *
     FROM close_cycles
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [parsePositiveInt(tenantId), parsePositiveInt(cycleId)],
  );
  return result.rows?.[0] || null;
}

async function loadCloseTaskWithCycle({
  tenantId,
  taskId,
  runQuery = query,
  forUpdate = false,
}) {
  const result = await runQuery(
    `SELECT
       cti.*,
       cc.status AS cycle_status,
       cc.scope_kind AS cycle_scope_kind,
       cc.group_company_id AS cycle_group_company_id
     FROM close_task_instances cti
     JOIN close_cycles cc
       ON cc.id = cti.close_cycle_id
      AND cc.tenant_id = cti.tenant_id
     WHERE cti.tenant_id = ?
       AND cti.id = ?
     LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [parsePositiveInt(tenantId), parsePositiveInt(taskId)],
  );
  return result.rows?.[0] || null;
}

async function reloadTaskWithCycle(tenantId, taskId, runQuery = query) {
  const row = await loadCloseTaskWithCycle({ tenantId, taskId, runQuery });
  if (!row) {
    throw notFound("Close task not found");
  }
  return row;
}

async function countActiveEvidenceForTask({ tenantId, taskId, runQuery = query }) {
  const result = await runQuery(
    `SELECT COUNT(*) AS evidence_count
     FROM close_task_evidence cte
     JOIN evidence_objects eo
       ON eo.id = cte.evidence_object_id
      AND eo.tenant_id = cte.tenant_id
     WHERE cte.tenant_id = ?
       AND cte.close_task_instance_id = ?
       AND cte.status = 'ACTIVE'
       AND eo.status = 'ACTIVE'`,
    [parsePositiveInt(tenantId), parsePositiveInt(taskId)],
  );
  return Number(result.rows?.[0]?.evidence_count || 0);
}

async function userCanAdminTask(userId, tenantId, taskRow, runQuery) {
  return checkUserCanAdministerCloseTaskAtScope(
    userId,
    tenantId,
    taskRow.rbac_scope_type,
    taskRow.rbac_scope_id,
    { runQuery },
  );
}

async function assertOwnerOrAdmin(userId, tenantId, taskRow, runQuery) {
  if (parsePositiveInt(taskRow.owner_user_id) === parsePositiveInt(userId)) {
    return;
  }
  if (await userCanAdminTask(userId, tenantId, taskRow, runQuery)) {
    return;
  }
  const canWork = await checkUserCanWorkCloseTask(userId, tenantId, taskRow, { runQuery });
  if (canWork && !parsePositiveInt(taskRow.owner_user_id)) {
    return;
  }
  throw forbidden("Only the task owner or close task admin can work this task");
}

async function assertReviewerOrAdmin(userId, tenantId, taskRow, runQuery) {
  if (await checkUserCanReviewCloseTask(userId, tenantId, taskRow, { runQuery })) {
    return;
  }
  throw forbidden("Only the task reviewer or close task admin can review this task");
}

async function assertCanAssignTask(userId, tenantId, taskRow, runQuery) {
  const canAssign = await checkUserCanAssignCloseTaskAtScope(
    userId,
    tenantId,
    taskRow.rbac_scope_type,
    taskRow.rbac_scope_id,
    { runQuery },
  );
  if (canAssign || (await userCanAdminTask(userId, tenantId, taskRow, runQuery))) {
    return;
  }
  throw forbidden("Missing close task assignment authority");
}

function buildTaskListWhere(filters = {}, actorCtx = {}) {
  const params = [parsePositiveInt(filters.tenantId || actorCtx.tenantId)];
  const clauses = ["cti.tenant_id = ?"];
  clauses.push(buildCloseTaskVisibilityWhere(actorCtx, params, "cti"));

  if (filters.closeCycleId) {
    clauses.push("cti.close_cycle_id = ?");
    params.push(parsePositiveInt(filters.closeCycleId));
  }
  if (filters.closeCycleItemId) {
    clauses.push("cti.close_cycle_item_id = ?");
    params.push(parsePositiveInt(filters.closeCycleItemId));
  }
  if (filters.status) {
    clauses.push("cti.status = ?");
    params.push(filters.status);
  }
  if (filters.taskFamily) {
    clauses.push("cti.task_family = ?");
    params.push(normalizeCloseTaskFamily(filters.taskFamily));
  }
  if (filters.rbacScopeType) {
    clauses.push("cti.rbac_scope_type = ?");
    params.push(filters.rbacScopeType);
  }
  if (filters.rbacScopeId) {
    clauses.push("cti.rbac_scope_id = ?");
    params.push(parsePositiveInt(filters.rbacScopeId));
  }
  if (filters.workScopeType) {
    clauses.push("cti.work_scope_type = ?");
    params.push(normalizeCloseTaskWorkScopeType(filters.workScopeType));
  }
  if (filters.workScopeId) {
    clauses.push("cti.work_scope_id = ?");
    params.push(parsePositiveInt(filters.workScopeId));
  }
  if (filters.ownerUserId) {
    clauses.push("cti.owner_user_id = ?");
    params.push(parsePositiveInt(filters.ownerUserId));
  }
  if (filters.reviewerUserId) {
    clauses.push("cti.reviewer_user_id = ?");
    params.push(parsePositiveInt(filters.reviewerUserId));
  }
  if (filters.evidenceMissing === true) {
    clauses.push(`cti.evidence_required = TRUE
      AND NOT EXISTS (
        SELECT 1
        FROM close_task_evidence cte
        JOIN evidence_objects eo
          ON eo.id = cte.evidence_object_id
         AND eo.tenant_id = cte.tenant_id
        WHERE cte.tenant_id = cti.tenant_id
          AND cte.close_task_instance_id = cti.id
          AND cte.status = 'ACTIVE'
          AND eo.status = 'ACTIVE'
      )`);
  }
  if (String(filters.dueState || "").toUpperCase() === "OVERDUE") {
    clauses.push("cti.due_at IS NOT NULL AND cti.due_at < CURRENT_TIMESTAMP");
    clauses.push("cti.status NOT IN ('APPROVED', 'WAIVED', 'CANCELLED')");
  }
  if (filters.q) {
    clauses.push("(cti.task_code LIKE ? OR cti.task_name LIKE ?)");
    params.push(`%${filters.q}%`, `%${filters.q}%`);
  }

  return { where: clauses.join(" AND "), params };
}

/**
 * Resolve a close task row scope for route-level RBAC checks.
 */
export async function resolveCloseTaskRouteScope(taskId, tenantId, runQuery = query) {
  const row = await loadCloseTaskWithCycle({ tenantId, taskId, runQuery });
  if (!row) {
    throw notFound("Close task not found");
  }
  return {
    scopeType: row.rbac_scope_type,
    scopeId: parsePositiveInt(row.rbac_scope_id),
  };
}

/**
 * Resolve a close cycle scope for routes that operate below one close cycle.
 */
export async function resolveCloseCycleTaskRouteScope(cycleId, tenantId, runQuery = query) {
  const row = await loadCloseCycleForTenant({ tenantId, cycleId, runQuery });
  if (!row) {
    throw notFound("Close cycle not found");
  }
  const scope = resolveCloseCycleRowScope(row);
  if (!scope) {
    throw badRequest("Close cycle scope could not be resolved");
  }
  return {
    scopeType: scope.scopeType,
    scopeId: scope.scopeId,
  };
}

/**
 * Resolve task create scope from the request payload.
 */
export function resolveCloseTaskCreatePayloadScope(payload = {}, tenantId) {
  return normalizeCloseTaskRbacScopePayload(payload, tenantId);
}

/**
 * List close task instances visible to the current actor.
 */
export async function listCloseTasks(filters = {}, actorCtx = {}) {
  const limit = Number(filters.limit || 100);
  const offset = Number(filters.offset || 0);
  const { where, params } = buildTaskListWhere(filters, actorCtx);
  const result = await query(
    `SELECT
       cti.*,
       cc.status AS cycle_status
     FROM close_task_instances cti
     JOIN close_cycles cc
       ON cc.id = cti.close_cycle_id
      AND cc.tenant_id = cti.tenant_id
     WHERE ${where}
     ORDER BY cti.due_at IS NULL ASC, cti.due_at ASC, cti.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return {
    rows: (result.rows || []).map(mapCloseTaskRow),
    limit,
    offset,
  };
}

/**
 * Read one close task instance with data-scope enforcement.
 */
export async function getCloseTaskById(taskId, actorCtx = {}, options = {}) {
  const tenantId = parsePositiveInt(actorCtx.tenantId);
  const row = await loadCloseTaskWithCycle({
    tenantId,
    taskId,
    runQuery: options.runQuery || query,
    forUpdate: Boolean(options.forUpdate),
  });
  if (!row) {
    throw notFound("Close task not found");
  }
  assertCloseTaskVisibleToActor(actorCtx, row);
  return { row: mapCloseTaskRow(row), rawRow: row };
}

/**
 * Create a manual close checklist task inside an OPEN close cycle.
 */
export async function createManualCloseTask(input = {}, actorCtx = {}) {
  const tenantId = parsePositiveInt(input.tenantId || actorCtx.tenantId);
  const userId = parsePositiveInt(input.userId || actorCtx.userId);
  const taskScope = normalizeCloseTaskRbacScope(
    { scopeType: input.rbacScopeType, scopeId: input.rbacScopeId },
    tenantId,
  );

  return withTransaction(async (tx) => {
    const cycle = await loadCloseCycleForTenant({
      tenantId,
      cycleId: input.closeCycleId,
      runQuery: tx.query,
      forUpdate: true,
    });
    if (!cycle) {
      throw notFound("Close cycle not found");
    }
    assertCloseTaskCycleEditable(cycle, "Create close task");

    const canCreate = await checkUserCanCreateCloseTaskAtScope(
      userId,
      tenantId,
      taskScope.scopeType,
      taskScope.scopeId,
      { runQuery: tx.query },
    );
    if (!canCreate) {
      throw forbidden("Missing close task create permission at the task scope");
    }

    await assertUserBelongsToTenantIfPresent(input.ownerUserId, tenantId, "ownerUserId", tx.query);
    await assertUserBelongsToTenantIfPresent(
      input.reviewerUserId,
      tenantId,
      "reviewerUserId",
      tx.query,
    );

    const taskKey = buildTaskKey(input);
    const workScopeType = normalizeCloseTaskWorkScopeType(input.workScopeType, "CYCLE");
    const workScopeId = parsePositiveInt(input.workScopeId) || parsePositiveInt(input.closeCycleId);
    const rbacScopeKey = buildCloseTaskScopeKey(taskScope.scopeType, taskScope.scopeId);
    const workScopeKey = buildCloseTaskWorkScopeKey(workScopeType, workScopeId, input.closeCycleId);

    await tx.query(
      `INSERT INTO close_task_instances (
         tenant_id,
         close_cycle_id,
         fiscal_period_id,
         task_key,
         task_code,
         task_name,
         task_description,
         task_family,
         completion_mode,
         rbac_scope_type,
         rbac_scope_id,
         rbac_scope_key,
         work_scope_type,
         work_scope_id,
         work_scope_key,
         legal_entity_id,
         book_id,
         operating_unit_id,
         country_id,
         group_company_id,
         consolidation_group_id,
         owner_user_id,
         reviewer_user_id,
         due_at,
         evidence_required,
         required_for_cycle_lock,
         blocker_class,
         source_check_code,
         source_ref_type,
         source_ref_id,
         created_by_user_id,
         updated_by_user_id
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        parsePositiveInt(input.closeCycleId),
        parsePositiveInt(cycle.fiscal_period_id),
        taskKey,
        String(input.taskCode || "MANUAL_CLOSE_TASK").trim().toUpperCase(),
        input.taskName,
        input.taskDescription || null,
        normalizeCloseTaskFamily(input.taskFamily, "MANUAL"),
        normalizeCloseTaskCompletionMode(input.completionMode, "MANUAL"),
        taskScope.scopeType,
        taskScope.scopeId,
        rbacScopeKey,
        workScopeType,
        workScopeId,
        workScopeKey,
        parsePositiveInt(input.legalEntityId) || parsePositiveInt(cycle.legal_entity_id),
        parsePositiveInt(input.bookId),
        parsePositiveInt(input.operatingUnitId),
        parsePositiveInt(input.countryId),
        parsePositiveInt(input.groupCompanyId) || parsePositiveInt(cycle.group_company_id),
        parsePositiveInt(input.consolidationGroupId) ||
          parsePositiveInt(cycle.consolidation_group_id),
        parsePositiveInt(input.ownerUserId) || userId || null,
        parsePositiveInt(input.reviewerUserId),
        input.dueAt || null,
        Boolean(input.evidenceRequired),
        Boolean(input.requiredForCycleLock),
        input.blockerClass || null,
        input.sourceCheckCode || null,
        input.sourceRefType || null,
        parsePositiveInt(input.sourceRefId),
        userId || null,
        userId || null,
      ],
    );

    const createdResult = await tx.query(
      `SELECT *
       FROM close_task_instances
       WHERE tenant_id = ?
         AND close_cycle_id = ?
         AND task_key = ?
       LIMIT 1`,
      [tenantId, parsePositiveInt(input.closeCycleId), taskKey],
    );
    const created = createdResult.rows?.[0];
    await writeCloseTaskLifecycleEvent({
      runQuery: tx.query,
      req: actorCtx.req,
      tenantId,
      taskRow: created,
      eventType: "CREATED",
      fromStatus: null,
      toStatus: "NOT_STARTED",
      actorUserId: userId,
      payload: { manual: true },
    });
    return { row: mapCloseTaskRow(created) };
  });
}

/**
 * Patch mutable task metadata and owner/reviewer assignment.
 */
export async function updateCloseTask(input = {}, actorCtx = {}) {
  const tenantId = parsePositiveInt(input.tenantId || actorCtx.tenantId);
  const userId = ensureUserId({ ...actorCtx, userId: input.userId || actorCtx.userId });
  return withTransaction(async (tx) => {
    const current = await loadCloseTaskWithCycle({
      tenantId,
      taskId: input.taskId,
      runQuery: tx.query,
      forUpdate: true,
    });
    if (!current) {
      throw notFound("Close task not found");
    }
    assertCloseTaskVisibleToActor(actorCtx, current);
    assertCloseTaskCycleEditable(current, "Update close task");

    if (isCloseTaskTerminalStatus(current.status) && hasAssignmentPatch(input)) {
      throw conflict("Reassignment after task resolution requires admin reopen first");
    }
    await assertCanAssignTask(userId, tenantId, current, tx.query);
    await assertUserBelongsToTenantIfPresent(input.ownerUserId, tenantId, "ownerUserId", tx.query);
    await assertUserBelongsToTenantIfPresent(
      input.reviewerUserId,
      tenantId,
      "reviewerUserId",
      tx.query,
    );

    const columnMap = {
      taskName: "task_name",
      taskDescription: "task_description",
      ownerUserId: "owner_user_id",
      reviewerUserId: "reviewer_user_id",
      dueAt: "due_at",
      blockerClass: "blocker_class",
      evidenceRequired: "evidence_required",
      requiredForCycleLock: "required_for_cycle_lock",
    };
    const assignments = [];
    const params = [];
    for (const [key, column] of Object.entries(columnMap)) {
      if (!Object.prototype.hasOwnProperty.call(input, key)) {
        continue;
      }
      assignments.push(`${column} = ?`);
      params.push(input[key]);
    }
    if (assignments.length === 0) {
      return { row: mapCloseTaskRow(current) };
    }
    assignments.push("updated_by_user_id = ?");
    params.push(userId, parsePositiveInt(input.taskId), tenantId);
    await tx.query(
      `UPDATE close_task_instances
       SET ${assignments.join(", ")}
       WHERE id = ?
         AND tenant_id = ?`,
      params,
    );
    const updated = await reloadTaskWithCycle(tenantId, input.taskId, tx.query);
    await writeCloseTaskLifecycleEvent({
      runQuery: tx.query,
      req: actorCtx.req,
      tenantId,
      taskRow: updated,
      eventType: "ASSIGNED",
      fromStatus: current.status,
      toStatus: updated.status,
      actorUserId: userId,
      payload: {
        ownerUserId: parsePositiveInt(updated.owner_user_id),
        reviewerUserId: parsePositiveInt(updated.reviewer_user_id),
      },
    });
    return { row: mapCloseTaskRow(updated) };
  });
}

async function updateTaskStatus({
  tenantId,
  taskId,
  actorCtx,
  eventType,
  nextStatus,
  reason = null,
  validate,
  updateColumns = {},
}) {
  const userId = ensureUserId(actorCtx);
  return withTransaction(async (tx) => {
    const current = await loadCloseTaskWithCycle({
      tenantId,
      taskId,
      runQuery: tx.query,
      forUpdate: true,
    });
    if (!current) {
      throw notFound("Close task not found");
    }
    assertCloseTaskVisibleToActor(actorCtx, current);
    assertCloseTaskCycleEditable(current, eventType);
    await validate({ current, tx, userId });

    const assignments = ["status = ?", "updated_by_user_id = ?"];
    const params = [nextStatus, userId];
    for (const [column, value] of Object.entries(updateColumns)) {
      assignments.push(`${column} = ?`);
      params.push(value);
    }
    params.push(parsePositiveInt(taskId), tenantId);
    await tx.query(
      `UPDATE close_task_instances
       SET ${assignments.join(", ")}
       WHERE id = ?
         AND tenant_id = ?`,
      params,
    );
    const updated = await reloadTaskWithCycle(tenantId, taskId, tx.query);
    await writeCloseTaskLifecycleEvent({
      runQuery: tx.query,
      req: actorCtx.req,
      tenantId,
      taskRow: updated,
      eventType,
      fromStatus: current.status,
      toStatus: nextStatus,
      actorUserId: userId,
      note: reason || null,
      payload: { reason: reason || null },
    });
    return { row: mapCloseTaskRow(updated) };
  });
}

/**
 * Move a task into work state.
 */
export async function startCloseTask(input = {}, actorCtx = {}) {
  return updateTaskStatus({
    tenantId: parsePositiveInt(input.tenantId || actorCtx.tenantId),
    taskId: input.taskId,
    actorCtx: { ...actorCtx, userId: input.userId || actorCtx.userId },
    eventType: "STARTED",
    nextStatus: "IN_PROGRESS",
    validate: async ({ current, tx, userId }) => {
      if (!["NOT_STARTED", "RETURNED"].includes(current.status)) {
        throw conflict("Only NOT_STARTED or RETURNED tasks can be started");
      }
      await assertOwnerOrAdmin(userId, current.tenant_id, current, tx.query);
    },
  });
}

/**
 * Submit a task for reviewer action, enforcing required evidence.
 */
export async function submitCloseTask(input = {}, actorCtx = {}) {
  return updateTaskStatus({
    tenantId: parsePositiveInt(input.tenantId || actorCtx.tenantId),
    taskId: input.taskId,
    actorCtx: { ...actorCtx, userId: input.userId || actorCtx.userId },
    eventType: "SUBMITTED",
    nextStatus: "SUBMITTED",
    validate: async ({ current, tx, userId }) => {
      if (!SUBMITTABLE_STATUSES.has(current.status)) {
        throw conflict("Task cannot be submitted from its current status");
      }
      await assertOwnerOrAdmin(userId, current.tenant_id, current, tx.query);
      if (current.evidence_required) {
        const evidenceCount = await countActiveEvidenceForTask({
          tenantId: current.tenant_id,
          taskId: current.id,
          runQuery: tx.query,
        });
        if (evidenceCount < 1) {
          throw conflict("Evidence is required before this task can be submitted", {
            evidenceRequired: true,
          });
        }
      }
    },
    updateColumns: {
      submitted_by_user_id: parsePositiveInt(input.userId || actorCtx.userId),
      submitted_at: new Date(),
      return_reason: null,
    },
  });
}

/**
 * Return a submitted task to its owner with a mandatory reason.
 */
export async function returnCloseTask(input = {}, actorCtx = {}) {
  return updateTaskStatus({
    tenantId: parsePositiveInt(input.tenantId || actorCtx.tenantId),
    taskId: input.taskId,
    actorCtx: { ...actorCtx, userId: input.userId || actorCtx.userId },
    eventType: "RETURNED",
    nextStatus: "RETURNED",
    reason: input.reason,
    validate: async ({ current, tx, userId }) => {
      if (current.status !== "SUBMITTED") {
        throw conflict("Only SUBMITTED tasks can be returned");
      }
      if (!input.reason) {
        throw badRequest("return reason is required");
      }
      await assertReviewerOrAdmin(userId, current.tenant_id, current, tx.query);
    },
    updateColumns: {
      reviewed_by_user_id: parsePositiveInt(input.userId || actorCtx.userId),
      reviewed_at: new Date(),
      return_reason: input.reason,
    },
  });
}

/**
 * Approve a submitted task.
 */
export async function approveCloseTask(input = {}, actorCtx = {}) {
  return updateTaskStatus({
    tenantId: parsePositiveInt(input.tenantId || actorCtx.tenantId),
    taskId: input.taskId,
    actorCtx: { ...actorCtx, userId: input.userId || actorCtx.userId },
    eventType: "APPROVED",
    nextStatus: "APPROVED",
    validate: async ({ current, tx, userId }) => {
      if (current.status !== "SUBMITTED") {
        throw conflict("Only SUBMITTED tasks can be approved");
      }
      await assertReviewerOrAdmin(userId, current.tenant_id, current, tx.query);
      if (
        parsePositiveInt(current.submitted_by_user_id) &&
        parsePositiveInt(current.submitted_by_user_id) === parsePositiveInt(userId)
      ) {
        const admin = await userCanAdminTask(userId, current.tenant_id, current, tx.query);
        if (!admin) {
          throw forbidden("Reviewer cannot approve their own submitted task");
        }
      }
    },
    updateColumns: {
      reviewed_by_user_id: parsePositiveInt(input.userId || actorCtx.userId),
      reviewed_at: new Date(),
      return_reason: null,
    },
  });
}

/**
 * Waive an unresolved task with a mandatory reason.
 */
export async function waiveCloseTask(input = {}, actorCtx = {}) {
  return updateTaskStatus({
    tenantId: parsePositiveInt(input.tenantId || actorCtx.tenantId),
    taskId: input.taskId,
    actorCtx: { ...actorCtx, userId: input.userId || actorCtx.userId },
    eventType: "WAIVED",
    nextStatus: "WAIVED",
    reason: input.reason,
    validate: async ({ current, tx, userId }) => {
      if (!WAIVABLE_STATUSES.has(current.status)) {
        throw conflict("Task cannot be waived from its current status");
      }
      if (!input.reason) {
        throw badRequest("waive reason is required");
      }
      const canWaive = await checkUserCanWaiveCloseTask(userId, current.tenant_id, current, {
        runQuery: tx.query,
      });
      if (!canWaive) {
        throw forbidden("Missing close task waiver authority");
      }
    },
    updateColumns: {
      waiver_reason: input.reason,
      waived_by_user_id: parsePositiveInt(input.userId || actorCtx.userId),
      waived_at: new Date(),
    },
  });
}

/**
 * Cancel a mistaken unresolved task without treating it as a waiver.
 */
export async function cancelCloseTask(input = {}, actorCtx = {}) {
  return updateTaskStatus({
    tenantId: parsePositiveInt(input.tenantId || actorCtx.tenantId),
    taskId: input.taskId,
    actorCtx: { ...actorCtx, userId: input.userId || actorCtx.userId },
    eventType: "CANCELLED",
    nextStatus: "CANCELLED",
    reason: input.reason,
    validate: async ({ current, tx, userId }) => {
      if (!CANCELLABLE_STATUSES.has(current.status)) {
        throw conflict("Task cannot be cancelled from its current status");
      }
      if (!input.reason) {
        throw badRequest("cancel reason is required");
      }
      const admin = await userCanAdminTask(userId, current.tenant_id, current, tx.query);
      const creatorShortcutAllowed =
        !current.required_for_cycle_lock &&
        !current.close_task_template_id &&
        ["NOT_STARTED", "IN_PROGRESS"].includes(current.status) &&
        parsePositiveInt(current.created_by_user_id) === parsePositiveInt(userId);
      if (!admin && !creatorShortcutAllowed) {
        throw forbidden("Cancelling this task requires close task admin authority");
      }
    },
    updateColumns: {
      cancel_reason: input.reason,
      cancelled_by_user_id: parsePositiveInt(input.userId || actorCtx.userId),
      cancelled_at: new Date(),
    },
  });
}

/**
 * Reopen a terminal task into work state. This is the only supported path back
 * from APPROVED, WAIVED, or CANCELLED.
 */
export async function reopenCloseTask(input = {}, actorCtx = {}) {
  return updateTaskStatus({
    tenantId: parsePositiveInt(input.tenantId || actorCtx.tenantId),
    taskId: input.taskId,
    actorCtx: { ...actorCtx, userId: input.userId || actorCtx.userId },
    eventType: "REOPENED",
    nextStatus: "IN_PROGRESS",
    reason: input.reason,
    validate: async ({ current, tx, userId }) => {
      if (!REOPENABLE_STATUSES.has(current.status)) {
        throw conflict("Only terminal tasks can be reopened");
      }
      const admin = await userCanAdminTask(userId, current.tenant_id, current, tx.query);
      if (!admin) {
        throw forbidden("Reopening a close task requires close task admin authority");
      }
    },
    updateColumns: {
      reviewed_by_user_id: null,
      reviewed_at: null,
      waived_by_user_id: null,
      waived_at: null,
      cancelled_by_user_id: null,
      cancelled_at: null,
      waiver_reason: null,
      cancel_reason: null,
    },
  });
}

/**
 * Refresh and persist the source/system check result stored on a task instance.
 */
export async function refreshCloseTaskSourceCheck(input = {}, actorCtx = {}) {
  const tenantId = parsePositiveInt(input.tenantId || actorCtx.tenantId);
  const userId = ensureUserId({ ...actorCtx, userId: input.userId || actorCtx.userId });
  return withTransaction(async (tx) => {
    const current = await loadCloseTaskWithCycle({
      tenantId,
      taskId: input.taskId,
      runQuery: tx.query,
      forUpdate: true,
    });
    if (!current) {
      throw notFound("Close task not found");
    }
    assertCloseTaskVisibleToActor(actorCtx, current);
    assertCloseTaskCycleEditable(current, "Refresh source check");
    await assertOwnerOrAdmin(userId, tenantId, current, tx.query);

    const result = await evaluateCloseTaskSourceCheck(current);
    await tx.query(
      `UPDATE close_task_instances
       SET source_check_status = ?,
           source_checked_at = CURRENT_TIMESTAMP,
           source_check_payload_json = ?,
           updated_by_user_id = ?
       WHERE tenant_id = ?
         AND id = ?`,
      [
        result.status,
        serializeJson(result.payload),
        userId,
        tenantId,
        parsePositiveInt(input.taskId),
      ],
    );
    const updated = await reloadTaskWithCycle(tenantId, input.taskId, tx.query);
    return { row: mapCloseTaskRow(updated), sourceCheck: result };
  });
}

/**
 * Load a raw task row for dependent task evidence/comment services.
 */
export async function loadCloseTaskForDependentService({
  tenantId,
  taskId,
  actorCtx = {},
  runQuery = query,
  forUpdate = false,
}) {
  const row = await loadCloseTaskWithCycle({ tenantId, taskId, runQuery, forUpdate });
  if (!row) {
    throw notFound("Close task not found");
  }
  assertCloseTaskVisibleToActor(actorCtx, row);
  return row;
}
