import { query } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import { buildReadyToStartConsolidationAlertPayload } from "./close.alerts.service.js";

const CLOSE_TASK_ALERT_SUBJECT_TYPE = "CLOSE_TASK_INSTANCE";
const CLOSE_READINESS_ALERT_SUBJECT_TYPE = "CLOSE_CYCLE_ITEM";
const CLOSE_READINESS_ALERT_CODE = "READY_TO_START_CONSOLIDATION";
const CLOSE_TASK_TERMINAL_STATUSES = new Set(["APPROVED", "WAIVED", "CANCELLED"]);
const TASK_SOURCE_CHECK_FAILED_STATUSES = new Set(["FAILED", "ERROR", "BLOCKED"]);

function toUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function resolveActorTenantId(actorCtx = {}) {
  return parsePositiveInt(actorCtx?.tenantId);
}

function resolveActorUserId(actorCtx = {}) {
  return parsePositiveInt(actorCtx?.userId);
}

function resolveActorRunQuery(actorCtx = {}) {
  return typeof actorCtx?.runQuery === "function" ? actorCtx.runQuery : query;
}

function serializeJson(value) {
  if (value === undefined || value === null) {
    return null;
  }
  return JSON.stringify(value);
}

function truncateText(value, maxLength) {
  const text = String(value || "").trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function parseDateTime(value) {
  if (!value) {
    return null;
  }
  const parsed = value instanceof Date ? value : new Date(String(value).replace(" ", "T"));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function roundHours(value) {
  return Number(Number(value || 0).toFixed(1));
}

function mapCloseAlertRow(row) {
  if (!row) {
    return null;
  }
  let payload = null;
  if (row.payload_json) {
    try {
      payload =
        typeof row.payload_json === "object"
          ? row.payload_json
          : JSON.parse(String(row.payload_json));
    } catch {
      payload = null;
    }
  }
  const subjectType = row.subject_type || null;
  const payloadSourceKind = toUpperText(payload?.sourceKind ?? payload?.source_kind);
  const sourceKind =
    payloadSourceKind ||
    (toUpperText(row.alert_code) === CLOSE_READINESS_ALERT_CODE
      ? "READINESS"
      : toUpperText(subjectType) === CLOSE_TASK_ALERT_SUBJECT_TYPE
        ? "TASK"
        : toUpperText(subjectType) === CLOSE_READINESS_ALERT_SUBJECT_TYPE
          ? "CLOSE_CYCLE_ITEM"
          : subjectType || "ALERT");
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    alertKey: row.alert_key || "",
    alertCode: row.alert_code || "",
    alertType: row.alert_type || "",
    severity: row.severity || "MEDIUM",
    alertState: row.alert_state || "ACTIVE",
    title: row.title || "",
    message: row.message || "",
    closeCycleId: parsePositiveInt(row.close_cycle_id),
    closeCycleItemId: parsePositiveInt(row.close_cycle_item_id),
    subjectType,
    subjectId: parsePositiveInt(row.subject_id),
    owner: parsePositiveInt(row.owner_user_id)
      ? { userId: parsePositiveInt(row.owner_user_id) }
      : null,
    dueDate: row.due_at || null,
    firstTriggeredAt: row.first_triggered_at || null,
    lastTriggeredAt: row.last_triggered_at || null,
    resolvedAt: row.resolved_at || null,
    payload,
    sourceKind,
    drillPath: payload?.drillPath || null,
  };
}

function buildTaskDrillPath(taskId) {
  const normalizedTaskId = parsePositiveInt(taskId);
  return normalizedTaskId
    ? `/app/donem-sonu-islemler/yillik/kapanis-gorevleri?taskId=${normalizedTaskId}`
    : "/app/donem-sonu-islemler/yillik/kapanis-gorevleri";
}

function buildTaskLabel(row = {}) {
  return String(row.task_name || row.taskName || row.task_code || row.taskCode || "Close task");
}

function buildTaskAlertBase(row = {}) {
  return {
    closeCycleId: parsePositiveInt(row.close_cycle_id ?? row.closeCycleId),
    closeCycleItemId: parsePositiveInt(row.close_cycle_item_id ?? row.closeCycleItemId),
    subjectType: CLOSE_TASK_ALERT_SUBJECT_TYPE,
    subjectId: parsePositiveInt(row.id),
    ownerUserId: parsePositiveInt(row.owner_user_id ?? row.ownerUserId),
    dueAt: row.due_at ?? row.dueAt ?? null,
    drillPath: buildTaskDrillPath(row.id),
    payload: {
      taskId: parsePositiveInt(row.id),
      taskCode: row.task_code ?? row.taskCode ?? null,
      taskFamily: row.task_family ?? row.taskFamily ?? null,
      status: row.status ?? null,
      drillPath: buildTaskDrillPath(row.id),
    },
  };
}

function taskEvidenceMissing(row = {}) {
  const status = toUpperText(row.status);
  return (
    Boolean(Number(row.evidence_required ?? row.evidenceRequired ?? 0)) &&
    Number(row.evidence_count ?? row.evidenceCount ?? 0) <= 0 &&
    !["WAIVED", "CANCELLED"].includes(status)
  );
}

function taskSourceCheckFailed(row = {}) {
  const status = toUpperText(row.status);
  const sourceCheckStatus = toUpperText(row.source_check_status ?? row.sourceCheckStatus);
  return (
    !["WAIVED", "CANCELLED"].includes(status) &&
    TASK_SOURCE_CHECK_FAILED_STATUSES.has(sourceCheckStatus)
  );
}

function taskBlocksCycleLock(row = {}) {
  const status = toUpperText(row.status);
  if (!Boolean(Number(row.required_for_cycle_lock ?? row.requiredForCycleLock ?? 0))) {
    return false;
  }
  if (["WAIVED", "CANCELLED"].includes(status)) {
    return false;
  }
  if (taskSourceCheckFailed(row)) {
    return true;
  }
  if (status !== "APPROVED") {
    return true;
  }
  return taskEvidenceMissing(row);
}

/**
 * Build durable close-alert payloads for task due/overdue/blocking states.
 */
export function buildCloseTaskAlertPayloadsFromRows(
  rows = [],
  { now = new Date(), dueSoonLeadHours = 48 } = {},
) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const payloads = [];
  for (const row of rows || []) {
    const status = toUpperText(row.status);
    const taskId = parsePositiveInt(row.id);
    if (!taskId || ["WAIVED", "CANCELLED"].includes(status)) {
      continue;
    }

    const base = buildTaskAlertBase(row);
    const dueDate = parseDateTime(base.dueAt);
    if (dueDate && !CLOSE_TASK_TERMINAL_STATUSES.has(status)) {
      const diffHours = roundHours((dueDate.getTime() - nowDate.getTime()) / 3600000);
      if (diffHours < 0) {
        payloads.push({
          ...base,
          alertKey: `TASK:${taskId}:OVERDUE`,
          alertCode: "CLOSE_TASK_OVERDUE",
          alertType: "OVERDUE",
          severity: "HIGH",
          title: "Close task overdue",
          message: `${buildTaskLabel(row)} is overdue by ${Math.abs(diffHours)} hours.`,
          payload: {
            ...base.payload,
            dueState: "OVERDUE",
            overdueHours: Math.abs(diffHours),
          },
        });
      } else if (diffHours <= Number(dueSoonLeadHours || 0)) {
        payloads.push({
          ...base,
          alertKey: `TASK:${taskId}:DUE_SOON`,
          alertCode: "CLOSE_TASK_DUE_SOON",
          alertType: "DUE_SOON",
          severity: diffHours <= 12 ? "HIGH" : "MEDIUM",
          title: "Close task due soon",
          message: `${buildTaskLabel(row)} is due in ${diffHours} hours.`,
          payload: {
            ...base.payload,
            dueState: "DUE_SOON",
            remainingHours: diffHours,
          },
        });
      }
    }

    if (taskSourceCheckFailed(row)) {
      payloads.push({
        ...base,
        alertKey: `TASK:${taskId}:SOURCE_CHECK_FAILED`,
        alertCode: "CLOSE_TASK_SOURCE_CHECK_FAILED",
        alertType: "BLOCKED",
        severity: "HIGH",
        title: "Close task source check failed",
        message: `${buildTaskLabel(row)} has a failed source check.`,
        payload: {
          ...base.payload,
          blockingAction: "REFRESH_SOURCE_CHECK",
          sourceCheckStatus: toUpperText(row.source_check_status ?? row.sourceCheckStatus),
        },
      });
    } else if (taskBlocksCycleLock(row)) {
      payloads.push({
        ...base,
        alertKey: `TASK:${taskId}:BLOCKED`,
        alertCode: "CLOSE_TASK_LOCK_BLOCKING",
        alertType: "BLOCKED",
        severity: "HIGH",
        title: "Close task blocks cycle lock",
        message: `${buildTaskLabel(row)} must be resolved before cycle lock.`,
        payload: {
          ...base.payload,
          blockingAction: taskEvidenceMissing(row) ? "ATTACH_EVIDENCE" : "RESOLVE_TASK",
          evidenceMissing: taskEvidenceMissing(row),
        },
      });
    }
  }
  return payloads;
}

/**
 * Upsert one durable close alert row by stable `alert_key`.
 */
export async function upsertCloseAlert(alertPayload = {}, actorCtx = {}) {
  const tenantId = resolveActorTenantId(actorCtx);
  const userId = resolveActorUserId(actorCtx);
  const runQuery = resolveActorRunQuery(actorCtx);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  if (!alertPayload.alertKey) {
    throw badRequest("alertKey is required");
  }

  await runQuery(
    `INSERT INTO close_alerts (
       tenant_id,
       alert_key,
       close_cycle_id,
       close_cycle_item_id,
       subject_type,
       subject_id,
       alert_code,
       alert_type,
       severity,
       alert_state,
       title,
       message,
       owner_user_id,
       due_at,
       first_triggered_at,
       last_triggered_at,
       resolved_at,
       payload_json,
       created_by_user_id,
       updated_by_user_id
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP, NULL, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       close_cycle_id = VALUES(close_cycle_id),
       close_cycle_item_id = VALUES(close_cycle_item_id),
       subject_type = VALUES(subject_type),
       subject_id = VALUES(subject_id),
       alert_code = VALUES(alert_code),
       alert_type = VALUES(alert_type),
       severity = VALUES(severity),
       alert_state = 'ACTIVE',
       title = VALUES(title),
       message = VALUES(message),
       owner_user_id = VALUES(owner_user_id),
       due_at = VALUES(due_at),
       last_triggered_at = CURRENT_TIMESTAMP,
       resolved_at = NULL,
       payload_json = VALUES(payload_json),
       updated_by_user_id = VALUES(updated_by_user_id)`,
    [
      tenantId,
      alertPayload.alertKey,
      parsePositiveInt(alertPayload.closeCycleId),
      parsePositiveInt(alertPayload.closeCycleItemId),
      alertPayload.subjectType || null,
      parsePositiveInt(alertPayload.subjectId),
      truncateText(alertPayload.alertCode || "CLOSE_ALERT", 96).toUpperCase(),
      toUpperText(alertPayload.alertType),
      toUpperText(alertPayload.severity) || "MEDIUM",
      truncateText(alertPayload.title || "Close alert", 191),
      truncateText(alertPayload.message || "Close alert is active", 512),
      parsePositiveInt(alertPayload.ownerUserId),
      alertPayload.dueAt || null,
      alertPayload.firstTriggeredAt || null,
      serializeJson(alertPayload.payload || null),
      userId || null,
      userId || null,
    ],
  );
}

/**
 * Resolve every active durable task alert for one task.
 */
export async function resolveCloseTaskAlerts(taskId, actorCtx = {}) {
  const tenantId = resolveActorTenantId(actorCtx);
  const userId = resolveActorUserId(actorCtx);
  const runQuery = resolveActorRunQuery(actorCtx);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  const result = await runQuery(
    `UPDATE close_alerts
     SET alert_state = 'RESOLVED',
         resolved_at = CURRENT_TIMESTAMP,
         updated_by_user_id = ?
     WHERE tenant_id = ?
       AND subject_type = ?
       AND subject_id = ?
       AND alert_state = 'ACTIVE'`,
    [userId || null, tenantId, CLOSE_TASK_ALERT_SUBJECT_TYPE, parsePositiveInt(taskId)],
  );
  return {
    resolvedCount: Number(result.rows?.affectedRows || 0),
  };
}

/**
 * Resolve active task alerts for a cycle that were not produced by the latest sync.
 */
export async function resolveStaleTaskAlertsForCycle(
  cycleId,
  activeAlertKeys = [],
  actorCtx = {},
) {
  const tenantId = resolveActorTenantId(actorCtx);
  const userId = resolveActorUserId(actorCtx);
  const runQuery = resolveActorRunQuery(actorCtx);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  const normalizedKeys = [...new Set((activeAlertKeys || []).filter(Boolean))];
  const params = [userId || null, tenantId, parsePositiveInt(cycleId), CLOSE_TASK_ALERT_SUBJECT_TYPE];
  let keyGuard = "";
  if (normalizedKeys.length > 0) {
    keyGuard = ` AND alert_key NOT IN (${normalizedKeys.map(() => "?").join(", ")})`;
    params.push(...normalizedKeys);
  }
  const result = await runQuery(
    `UPDATE close_alerts
     SET alert_state = 'RESOLVED',
         resolved_at = CURRENT_TIMESTAMP,
         updated_by_user_id = ?
     WHERE tenant_id = ?
       AND close_cycle_id = ?
       AND subject_type = ?
       AND alert_state = 'ACTIVE'
       ${keyGuard}`,
    params,
  );
  return {
    resolvedCount: Number(result.rows?.affectedRows || 0),
  };
}

/**
 * Resolve active ready-to-start readiness alerts for a cycle that were not
 * produced by the latest readiness sync.
 */
export async function resolveStaleReadinessAlertsForCycle(
  cycleId,
  activeAlertKeys = [],
  actorCtx = {},
) {
  const tenantId = resolveActorTenantId(actorCtx);
  const userId = resolveActorUserId(actorCtx);
  const runQuery = resolveActorRunQuery(actorCtx);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  const normalizedKeys = [...new Set((activeAlertKeys || []).filter(Boolean))];
  const params = [userId || null, tenantId, parsePositiveInt(cycleId), CLOSE_READINESS_ALERT_CODE];
  let keyGuard = "";
  if (normalizedKeys.length > 0) {
    keyGuard = ` AND alert_key NOT IN (${normalizedKeys.map(() => "?").join(", ")})`;
    params.push(...normalizedKeys);
  }
  const result = await runQuery(
    `UPDATE close_alerts
     SET alert_state = 'RESOLVED',
         resolved_at = CURRENT_TIMESTAMP,
         updated_by_user_id = ?
     WHERE tenant_id = ?
       AND close_cycle_id = ?
       AND alert_code = ?
       AND alert_state = 'ACTIVE'
       ${keyGuard}`,
    params,
  );
  return {
    resolvedCount: Number(result.rows?.affectedRows || 0),
  };
}

async function listActiveTaskAlertsForCycle(cycleId, actorCtx = {}) {
  const tenantId = resolveActorTenantId(actorCtx);
  const runQuery = resolveActorRunQuery(actorCtx);
  const result = await runQuery(
    `SELECT *
     FROM close_alerts
     WHERE tenant_id = ?
       AND close_cycle_id = ?
       AND subject_type = ?
       AND alert_state = 'ACTIVE'
     ORDER BY severity DESC, due_at ASC, alert_key ASC`,
    [tenantId, parsePositiveInt(cycleId), CLOSE_TASK_ALERT_SUBJECT_TYPE],
  );
  return (result.rows || []).map(mapCloseAlertRow).filter(Boolean);
}

async function listActiveReadinessAlertsForCycle(cycleId, actorCtx = {}) {
  const tenantId = resolveActorTenantId(actorCtx);
  const runQuery = resolveActorRunQuery(actorCtx);
  const result = await runQuery(
    `SELECT *
     FROM close_alerts
     WHERE tenant_id = ?
       AND close_cycle_id = ?
       AND alert_code = ?
       AND alert_state = 'ACTIVE'
     ORDER BY severity DESC, due_at ASC, alert_key ASC`,
    [tenantId, parsePositiveInt(cycleId), CLOSE_READINESS_ALERT_CODE],
  );
  return (result.rows || []).map(mapCloseAlertRow).filter(Boolean);
}

async function listTaskAlertSourceRows(cycleId, actorCtx = {}) {
  const tenantId = resolveActorTenantId(actorCtx);
  const runQuery = resolveActorRunQuery(actorCtx);
  const result = await runQuery(
    `SELECT
       cti.*,
       COALESCE(evidence.evidence_count, 0) AS evidence_count
     FROM close_task_instances cti
     LEFT JOIN (
       SELECT
         cte.tenant_id,
         cte.close_task_instance_id,
         COUNT(*) AS evidence_count
       FROM close_task_evidence cte
       JOIN evidence_objects eo
         ON eo.id = cte.evidence_object_id
        AND eo.tenant_id = cte.tenant_id
       WHERE cte.status = 'ACTIVE'
         AND eo.status = 'ACTIVE'
       GROUP BY cte.tenant_id, cte.close_task_instance_id
     ) evidence
       ON evidence.tenant_id = cti.tenant_id
      AND evidence.close_task_instance_id = cti.id
     WHERE cti.tenant_id = ?
       AND cti.close_cycle_id = ?`,
    [tenantId, parsePositiveInt(cycleId)],
  );
  return result.rows || [];
}

/**
 * Sync durable task alerts for one cycle and resolve stale task alert rows.
 */
export async function syncCloseTaskAlertsForCycle(cycleId, actorCtx = {}) {
  const tenantId = resolveActorTenantId(actorCtx);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  const sourceRows = await listTaskAlertSourceRows(cycleId, actorCtx);
  const alertPayloads = buildCloseTaskAlertPayloadsFromRows(sourceRows);
  for (const payload of alertPayloads) {
    // eslint-disable-next-line no-await-in-loop
    await upsertCloseAlert(payload, actorCtx);
  }
  const staleResult = await resolveStaleTaskAlertsForCycle(
    cycleId,
    alertPayloads.map((payload) => payload.alertKey),
    actorCtx,
  );
  const rows = await listActiveTaskAlertsForCycle(cycleId, actorCtx);
  return {
    rows,
    activeAlertKeys: alertPayloads.map((payload) => payload.alertKey),
    upsertedCount: alertPayloads.length,
    resolvedCount: staleResult.resolvedCount,
  };
}

/**
 * Sync the durable ready-to-start consolidation prompt for one close cycle.
 * The alert is active only while the derived readiness status is
 * `READY_TO_START`; any official-run creation moves the derived state and
 * resolves this prompt on the next cockpit read.
 */
export async function syncCloseReadinessAlertsForCycle(
  { cycle, consolidationReadiness } = {},
  actorCtx = {},
) {
  const tenantId = resolveActorTenantId(actorCtx);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  const cycleId = parsePositiveInt(cycle?.id ?? consolidationReadiness?.closeCycleId);
  if (!cycleId) {
    throw badRequest("cycleId is required");
  }

  const alertPayload = buildReadyToStartConsolidationAlertPayload({
    cycle,
    consolidationReadiness,
  });
  const alertPayloads = alertPayload ? [alertPayload] : [];
  for (const payload of alertPayloads) {
    // eslint-disable-next-line no-await-in-loop
    await upsertCloseAlert(payload, actorCtx);
  }
  const staleResult = await resolveStaleReadinessAlertsForCycle(
    cycleId,
    alertPayloads.map((payload) => payload.alertKey),
    actorCtx,
  );
  const rows = await listActiveReadinessAlertsForCycle(cycleId, actorCtx);
  return {
    rows,
    activeAlertKeys: alertPayloads.map((payload) => payload.alertKey),
    upsertedCount: alertPayloads.length,
    resolvedCount: staleResult.resolvedCount,
  };
}

export default {
  buildCloseTaskAlertPayloadsFromRows,
  upsertCloseAlert,
  syncCloseReadinessAlertsForCycle,
  syncCloseTaskAlertsForCycle,
  resolveCloseTaskAlerts,
  resolveStaleReadinessAlertsForCycle,
  resolveStaleTaskAlertsForCycle,
};
