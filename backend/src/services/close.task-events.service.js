import { query } from "../db.js";
import { parsePositiveInt } from "../routes/_utils.js";
import { mapCloseTaskEventRow } from "./close.task-scope.service.js";

export const CLOSE_TASK_EVENT_TYPES = Object.freeze([
  "CREATED",
  "ASSIGNED",
  "STARTED",
  "SUBMITTED",
  "RETURNED",
  "APPROVED",
  "WAIVED",
  "CANCELLED",
  "REOPENED",
  "EVIDENCE_ATTACHED",
  "EVIDENCE_REMOVED",
  "COMMENT_ADDED",
]);

export const CLOSE_TASK_AUDITED_EVENT_TYPES = Object.freeze([
  "SUBMITTED",
  "RETURNED",
  "APPROVED",
  "WAIVED",
  "CANCELLED",
  "REOPENED",
  "EVIDENCE_ATTACHED",
  "EVIDENCE_REMOVED",
  "ASSIGNED",
]);

const CLOSE_TASK_EVENT_TYPE_SET = new Set(CLOSE_TASK_EVENT_TYPES);
const CLOSE_TASK_AUDITED_EVENT_TYPE_SET = new Set(CLOSE_TASK_AUDITED_EVENT_TYPES);

function normalizeEventType(eventType) {
  const normalized = String(eventType || "")
    .trim()
    .toUpperCase();
  if (!CLOSE_TASK_EVENT_TYPE_SET.has(normalized)) {
    throw new Error(`Unsupported close task event type: ${eventType}`);
  }
  return normalized;
}

function serializePayload(payload) {
  if (payload === undefined || payload === null) {
    return null;
  }
  return JSON.stringify(payload);
}

function resolveForwardedIp(req) {
  const forwardedFor = req?.headers?.["x-forwarded-for"];
  const forwardedIp = Array.isArray(forwardedFor)
    ? forwardedFor[0]
    : String(forwardedFor || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)[0];
  return forwardedIp || req?.ip || req?.socket?.remoteAddress || null;
}

/**
 * Append one immutable close task lifecycle/event row.
 */
export async function writeCloseTaskEvent({
  runQuery = query,
  tenantId,
  taskId,
  eventType,
  fromStatus = null,
  toStatus = null,
  actorUserId = null,
  note = null,
  payload = null,
}) {
  const normalizedEventType = normalizeEventType(eventType);
  await runQuery(
    `INSERT INTO close_task_events (
       tenant_id,
       close_task_instance_id,
       event_type,
       from_status,
       to_status,
       actor_user_id,
       note,
       payload_json
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      parsePositiveInt(tenantId),
      parsePositiveInt(taskId),
      normalizedEventType,
      fromStatus || null,
      toStatus || null,
      parsePositiveInt(actorUserId),
      note || null,
      serializePayload(payload),
    ],
  );
}

/**
 * Write the central audit row for sensitive close task lifecycle activity.
 */
export async function writeCloseTaskAuditLog({
  runQuery = query,
  req = null,
  tenantId,
  userId = null,
  taskRow,
  action,
  payload = null,
}) {
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
      parsePositiveInt(userId),
      String(action || "close.task.action"),
      "close_task_instance",
      String(taskRow?.id || ""),
      taskRow?.rbac_scope_type || null,
      parsePositiveInt(taskRow?.rbac_scope_id),
      req?.requestId || req?.headers?.["x-request-id"] || null,
      resolveForwardedIp(req),
      req?.headers?.["user-agent"] ? String(req.headers["user-agent"]).slice(0, 255) : null,
      serializePayload(payload),
    ],
  );
}

/**
 * Append a task event and, for sensitive task events, the central audit row.
 */
export async function writeCloseTaskLifecycleEvent({
  runQuery = query,
  req = null,
  tenantId,
  taskRow,
  eventType,
  fromStatus = null,
  toStatus = null,
  actorUserId = null,
  note = null,
  payload = null,
}) {
  const normalizedEventType = normalizeEventType(eventType);
  await writeCloseTaskEvent({
    runQuery,
    tenantId,
    taskId: taskRow?.id,
    eventType: normalizedEventType,
    fromStatus,
    toStatus,
    actorUserId,
    note,
    payload,
  });

  if (!CLOSE_TASK_AUDITED_EVENT_TYPE_SET.has(normalizedEventType)) {
    return;
  }

  await writeCloseTaskAuditLog({
    runQuery,
    req,
    tenantId,
    userId: actorUserId,
    taskRow,
    action: `close.task.${normalizedEventType.toLowerCase()}`,
    payload: {
      ...(payload || {}),
      fromStatus: fromStatus || null,
      toStatus: toStatus || null,
      note: note || null,
    },
  });
}

/**
 * List the immutable event stream for one close task.
 */
export async function listCloseTaskEvents({
  tenantId,
  taskId,
  limit = 100,
  offset = 0,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT *
     FROM close_task_events
     WHERE tenant_id = ?
       AND close_task_instance_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT ? OFFSET ?`,
    [
      parsePositiveInt(tenantId),
      parsePositiveInt(taskId),
      Number(limit || 100),
      Number(offset || 0),
    ],
  );
  return {
    rows: (result.rows || []).map(mapCloseTaskEventRow),
    limit: Number(limit || 100),
    offset: Number(offset || 0),
  };
}
