import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import {
  buildVisibilityScopeWhereClause,
  getVisibilityScopeContext,
  isCloseTaskScopeAllowed,
  normalizeCloseTaskRbacScope,
} from "./authz.scope.service.js";

export const CLOSE_TASK_STATUS_VALUES = Object.freeze([
  "NOT_STARTED",
  "IN_PROGRESS",
  "SUBMITTED",
  "RETURNED",
  "APPROVED",
  "WAIVED",
  "CANCELLED",
]);

export const CLOSE_TASK_TERMINAL_STATUS_VALUES = Object.freeze([
  "APPROVED",
  "WAIVED",
  "CANCELLED",
]);

export const CLOSE_TASK_TEMPLATE_STATUS_VALUES = Object.freeze([
  "ACTIVE",
  "PAUSED",
  "DISABLED",
]);

export const CLOSE_TASK_COMPLETION_MODES = Object.freeze([
  "MANUAL",
  "MANUAL_WITH_EVIDENCE",
  "SYSTEM_CHECK",
  "SOURCE_STATUS",
  "HYBRID_REVIEW",
]);

export const CLOSE_TASK_SOURCE_CHECK_COMPLETION_MODES = Object.freeze([
  "SYSTEM_CHECK",
  "SOURCE_STATUS",
  "HYBRID_REVIEW",
]);

export const CLOSE_TASK_RBAC_SCOPE_TYPES = Object.freeze([
  "OPERATING_UNIT",
  "LEGAL_ENTITY",
  "COUNTRY",
  "GROUP",
]);

export const CLOSE_TASK_WORK_SCOPE_TYPES = Object.freeze([
  "CYCLE",
  "BOOK",
  "CENTRAL",
  "OPERATING_UNIT",
  "LOCAL_CLOSE_PACK",
  "PERIOD_CLOSE_RUN",
  "CONSOLIDATION_GROUP",
]);

export const CLOSE_TASK_FAMILIES = Object.freeze([
  "RECONCILIATION",
  "SUBLEDGER",
  "PAYROLL",
  "INVENTORY",
  "FIXED_ASSET",
  "TAX",
  "FX",
  "INTERCOMPANY",
  "REPORTING",
  "CERTIFICATION",
  "MANUAL",
]);

export const CLOSE_TASK_CYCLE_SCOPE_KINDS = Object.freeze([
  "ANY",
  "LEGAL_ENTITY",
  "CONSOLIDATION_GROUP",
]);

export const CLOSE_TASK_MATERIALIZATION_MODES = Object.freeze([
  "CYCLE",
  "ITEM",
  "MANUAL_ONLY",
]);

export const CLOSE_TASK_ANCHOR_ITEM_TYPES = Object.freeze([
  "ANY",
  "LOCAL_CLOSE_PACK",
  "PERIOD_CLOSE_RUN",
  "CONSOLIDATION_RUN",
]);

export const CLOSE_TASK_OWNER_STRATEGIES = Object.freeze([
  "CYCLE_OWNER",
  "ITEM_OWNER",
  "LOCAL_CLOSE_PACK_OWNER",
  "MANUAL",
]);

export const CLOSE_TASK_REVIEWER_STRATEGIES = Object.freeze([
  "CYCLE_OWNER",
  "LOCAL_CLOSE_PACK_REVIEWER",
  "MANUAL",
]);

export const CLOSE_TASK_EDITABLE_CYCLE_STATUSES = Object.freeze(["OPEN"]);

const CLOSE_TASK_TERMINAL_STATUS_SET = new Set(CLOSE_TASK_TERMINAL_STATUS_VALUES);

function toUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function parseStoredJson(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value === "object") {
    return value;
  }
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

function normalizeEnum(value, label, allowedValues, fallback = null) {
  const normalized = toUpperText(value ?? fallback);
  if (!normalized) {
    throw badRequest(`${label} is required`);
  }
  if (!allowedValues.includes(normalized)) {
    throw badRequest(`${label} must be one of ${allowedValues.join(", ")}`);
  }
  return normalized;
}

/** Normalize a close task lifecycle status value. */
export function normalizeCloseTaskStatus(value, fallback = null) {
  return normalizeEnum(value, "status", CLOSE_TASK_STATUS_VALUES, fallback);
}

/** Normalize a close task template status value. */
export function normalizeCloseTaskTemplateStatus(value, fallback = null) {
  return normalizeEnum(value, "template status", CLOSE_TASK_TEMPLATE_STATUS_VALUES, fallback);
}

/** Normalize the task completion-mode contract stored on templates/instances. */
export function normalizeCloseTaskCompletionMode(value, fallback = null) {
  return normalizeEnum(value, "completionMode", CLOSE_TASK_COMPLETION_MODES, fallback);
}

/** Normalize a close task RBAC scope type. */
export function normalizeCloseTaskRbacScopeType(value, fallback = null) {
  return normalizeEnum(value, "rbacScopeType", CLOSE_TASK_RBAC_SCOPE_TYPES, fallback);
}

/** Normalize a close task work-scope type. */
export function normalizeCloseTaskWorkScopeType(value, fallback = null) {
  return normalizeEnum(value, "workScopeType", CLOSE_TASK_WORK_SCOPE_TYPES, fallback);
}

/** Normalize the task family used for grouping and reporting. */
export function normalizeCloseTaskFamily(value, fallback = "MANUAL") {
  return normalizeEnum(value, "taskFamily", CLOSE_TASK_FAMILIES, fallback);
}

/** Normalize the close-cycle scope kind a template applies to. */
export function normalizeCloseTaskCycleScopeKind(value, fallback = "ANY") {
  return normalizeEnum(value, "cycleScopeKind", CLOSE_TASK_CYCLE_SCOPE_KINDS, fallback);
}

/** Normalize how a template should materialize into task instances. */
export function normalizeCloseTaskMaterializationMode(value, fallback = "MANUAL_ONLY") {
  return normalizeEnum(
    value,
    "materializationMode",
    CLOSE_TASK_MATERIALIZATION_MODES,
    fallback,
  );
}

/** Normalize the close-cycle item anchor used during materialization. */
export function normalizeCloseTaskAnchorItemType(value, fallback = "ANY") {
  return normalizeEnum(value, "anchorItemType", CLOSE_TASK_ANCHOR_ITEM_TYPES, fallback);
}

/** Normalize the default owner assignment strategy for a task template. */
export function normalizeCloseTaskOwnerStrategy(value, fallback = "MANUAL") {
  return normalizeEnum(value, "defaultOwnerStrategy", CLOSE_TASK_OWNER_STRATEGIES, fallback);
}

/** Normalize the default reviewer assignment strategy for a task template. */
export function normalizeCloseTaskReviewerStrategy(value, fallback = "MANUAL") {
  return normalizeEnum(
    value,
    "defaultReviewerStrategy",
    CLOSE_TASK_REVIEWER_STRATEGIES,
    fallback,
  );
}

/** Return whether a task status is terminal/resolved for queues and lock gates. */
export function isCloseTaskTerminalStatus(status) {
  return CLOSE_TASK_TERMINAL_STATUS_SET.has(toUpperText(status));
}

/** Return whether a completion mode supports source-check refresh. */
export function isCloseTaskSourceCheckMode(completionMode) {
  return CLOSE_TASK_SOURCE_CHECK_COMPLETION_MODES.includes(toUpperText(completionMode));
}

/** Build the stable `TYPE:id` key for a close task RBAC scope. */
export function buildCloseTaskScopeKey(scopeType, scopeId) {
  const normalizedScopeType = toUpperText(scopeType);
  const normalizedScopeId = parsePositiveInt(scopeId);
  if (!normalizedScopeType || !normalizedScopeId) {
    throw badRequest("scopeType and scopeId are required");
  }
  return `${normalizedScopeType}:${normalizedScopeId}`;
}

/** Build the stable work-scope key stored on task instances. */
export function buildCloseTaskWorkScopeKey(workScopeType, workScopeId, fallbackId = null) {
  const normalizedScopeType = normalizeCloseTaskWorkScopeType(workScopeType, "CYCLE");
  const normalizedScopeId = parsePositiveInt(workScopeId) || parsePositiveInt(fallbackId);
  if (!normalizedScopeId) {
    return normalizedScopeType;
  }
  return `${normalizedScopeType}:${normalizedScopeId}`;
}

/** Build a SQL visibility clause for task RBAC scope columns. */
export function buildCloseTaskVisibilityWhere(actorCtx = {}, params = [], alias = "cti") {
  const req = actorCtx?.req;
  if (!req) {
    return "1 = 1";
  }
  const scopeContext = getVisibilityScopeContext(req) || req?.rbac?.permissionScopeContext;
  return buildVisibilityScopeWhereClause(scopeContext, params, {
    GROUP: { typeColumn: `${alias}.rbac_scope_type`, idColumn: `${alias}.rbac_scope_id` },
    COUNTRY: { typeColumn: `${alias}.rbac_scope_type`, idColumn: `${alias}.rbac_scope_id` },
    LEGAL_ENTITY: { typeColumn: `${alias}.rbac_scope_type`, idColumn: `${alias}.rbac_scope_id` },
    OPERATING_UNIT: {
      typeColumn: `${alias}.rbac_scope_type`,
      idColumn: `${alias}.rbac_scope_id`,
    },
  });
}

/** Assert that the request visibility scope can see one task row. */
export function assertCloseTaskVisibleToActor(actorCtx = {}, taskRow) {
  const req = actorCtx?.req;
  if (!req || !taskRow) {
    return;
  }
  const scopeContext = getVisibilityScopeContext(req) || req?.rbac?.permissionScopeContext;
  const allowed = isCloseTaskScopeAllowed(
    scopeContext,
    taskRow.rbac_scope_type,
    taskRow.rbac_scope_id,
    taskRow.tenant_id,
  );
  if (!allowed) {
    const err = new Error("Close task is outside your data scope");
    err.status = 403;
    throw err;
  }
}

/** Assert that routine task mutations are allowed for the task's close cycle. */
export function assertCloseTaskCycleEditable(cycleRow, actionLabel = "task mutation") {
  const status = toUpperText(cycleRow?.cycle_status ?? cycleRow?.cycleStatus ?? cycleRow?.status);
  if (!CLOSE_TASK_EDITABLE_CYCLE_STATUSES.includes(status)) {
    const err = new Error(`${actionLabel} requires an OPEN close cycle`);
    err.status = 409;
    err.code = "CLOSE_TASK_CYCLE_NOT_EDITABLE";
    err.details = { cycleStatus: status || null };
    throw err;
  }
}

/** Map a close task template database row to the API shape. */
export function mapCloseTaskTemplateRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    tenantScopeKey: row.tenant_scope_key || null,
    taskCode: row.task_code || "",
    taskName: row.task_name || "",
    taskDescription: row.task_description || null,
    taskFamily: row.task_family || "MANUAL",
    cycleScopeKind: row.cycle_scope_kind || "ANY",
    defaultRbacScopeType: row.default_rbac_scope_type || "LEGAL_ENTITY",
    defaultWorkScopeType: row.default_work_scope_type || "CYCLE",
    anchorItemType: row.anchor_item_type || "ANY",
    materializationMode: row.materialization_mode || "MANUAL_ONLY",
    completionMode: row.completion_mode || "MANUAL",
    sourceCheckCode: row.source_check_code || null,
    sourceRefType: row.source_ref_type || null,
    sourceRefIdStrategy: row.source_ref_id_strategy || null,
    autoCompleteAllowed: Boolean(row.auto_complete_allowed),
    defaultDueOffsetDays: Number(row.default_due_offset_days || 0),
    evidenceRequired: Boolean(row.evidence_required),
    requiredForCycleLock: Boolean(row.required_for_cycle_lock),
    defaultOwnerStrategy: row.default_owner_strategy || "MANUAL",
    defaultReviewerStrategy: row.default_reviewer_strategy || "MANUAL",
    blockerClass: row.blocker_class || null,
    sortOrder: Number(row.sort_order || 1000),
    status: row.status || "ACTIVE",
    config: parseStoredJson(row.config_json),
    createdByUserId: parsePositiveInt(row.created_by_user_id),
    updatedByUserId: parsePositiveInt(row.updated_by_user_id),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

/** Map a close task instance database row to the API shape. */
export function mapCloseTaskRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    closeCycleId: parsePositiveInt(row.close_cycle_id),
    closeCycleItemId: parsePositiveInt(row.close_cycle_item_id),
    closeTaskTemplateId: parsePositiveInt(row.close_task_template_id),
    fiscalPeriodId: parsePositiveInt(row.fiscal_period_id),
    taskKey: row.task_key || "",
    taskCode: row.task_code || "",
    taskName: row.task_name || "",
    taskDescription: row.task_description || null,
    taskFamily: row.task_family || "MANUAL",
    completionMode: row.completion_mode || "MANUAL",
    rbacScopeType: row.rbac_scope_type || null,
    rbacScopeId: parsePositiveInt(row.rbac_scope_id),
    rbacScopeKey: row.rbac_scope_key || null,
    workScopeType: row.work_scope_type || null,
    workScopeId: parsePositiveInt(row.work_scope_id),
    workScopeKey: row.work_scope_key || null,
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    bookId: parsePositiveInt(row.book_id),
    operatingUnitId: parsePositiveInt(row.operating_unit_id),
    countryId: parsePositiveInt(row.country_id),
    groupCompanyId: parsePositiveInt(row.group_company_id),
    consolidationGroupId: parsePositiveInt(row.consolidation_group_id),
    ownerUserId: parsePositiveInt(row.owner_user_id),
    reviewerUserId: parsePositiveInt(row.reviewer_user_id),
    dueAt: row.due_at || null,
    status: row.status || "NOT_STARTED",
    evidenceRequired: Boolean(row.evidence_required),
    requiredForCycleLock: Boolean(row.required_for_cycle_lock),
    blockerClass: row.blocker_class || null,
    sourceCheckCode: row.source_check_code || null,
    sourceRefType: row.source_ref_type || null,
    sourceRefId: parsePositiveInt(row.source_ref_id),
    sourceCheckStatus: row.source_check_status || null,
    sourceCheckedAt: row.source_checked_at || null,
    sourceCheckPayload: parseStoredJson(row.source_check_payload_json),
    submittedByUserId: parsePositiveInt(row.submitted_by_user_id),
    submittedAt: row.submitted_at || null,
    reviewedByUserId: parsePositiveInt(row.reviewed_by_user_id),
    reviewedAt: row.reviewed_at || null,
    returnReason: row.return_reason || null,
    waiverReason: row.waiver_reason || null,
    waivedByUserId: parsePositiveInt(row.waived_by_user_id),
    waivedAt: row.waived_at || null,
    cancelReason: row.cancel_reason || null,
    cancelledByUserId: parsePositiveInt(row.cancelled_by_user_id),
    cancelledAt: row.cancelled_at || null,
    createdByUserId: parsePositiveInt(row.created_by_user_id),
    updatedByUserId: parsePositiveInt(row.updated_by_user_id),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    cycleStatus: row.cycle_status || null,
  };
}

/** Map a close task event database row to the API shape. */
export function mapCloseTaskEventRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    closeTaskInstanceId: parsePositiveInt(row.close_task_instance_id),
    eventType: row.event_type || "",
    fromStatus: row.from_status || null,
    toStatus: row.to_status || null,
    actorUserId: parsePositiveInt(row.actor_user_id),
    note: row.note || null,
    payload: parseStoredJson(row.payload_json),
    createdAt: row.created_at || null,
  };
}

/** Normalize a route payload into the close task RBAC scope contract. */
export function normalizeCloseTaskRbacScopePayload(payload, tenantId) {
  return normalizeCloseTaskRbacScope(
    {
      scopeType:
        payload?.rbacScopeType ??
        payload?.rbac_scope_type ??
        payload?.scopeType ??
        payload?.scope_type,
      scopeId:
        payload?.rbacScopeId ??
        payload?.rbac_scope_id ??
        payload?.scopeId ??
        payload?.scope_id,
    },
    tenantId,
  );
}
