import { badRequest } from "./_utils.js";
import {
  normalizeCode,
  normalizeText,
  optionalPositiveInt,
  parseBooleanFlag,
  parseDateTime,
  parsePagination,
  requirePositiveInt,
  requireTenantId,
  requireUserId,
} from "./cash.validators.common.js";
import {
  CLOSE_TASK_ANCHOR_ITEM_TYPES,
  CLOSE_TASK_COMPLETION_MODES,
  CLOSE_TASK_CYCLE_SCOPE_KINDS,
  CLOSE_TASK_FAMILIES,
  CLOSE_TASK_MATERIALIZATION_MODES,
  CLOSE_TASK_OWNER_STRATEGIES,
  CLOSE_TASK_RBAC_SCOPE_TYPES,
  CLOSE_TASK_REVIEWER_STRATEGIES,
  CLOSE_TASK_STATUS_VALUES,
  CLOSE_TASK_TEMPLATE_STATUS_VALUES,
  CLOSE_TASK_WORK_SCOPE_TYPES,
  normalizeCloseTaskAnchorItemType,
  normalizeCloseTaskCompletionMode,
  normalizeCloseTaskCycleScopeKind,
  normalizeCloseTaskFamily,
  normalizeCloseTaskMaterializationMode,
  normalizeCloseTaskOwnerStrategy,
  normalizeCloseTaskRbacScopeType,
  normalizeCloseTaskReviewerStrategy,
  normalizeCloseTaskStatus,
  normalizeCloseTaskTemplateStatus,
  normalizeCloseTaskWorkScopeType,
} from "../services/close.task-scope.service.js";

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function optionalEnum(value, label, allowedValues, normalizer) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const normalized = normalizer(value);
  if (!allowedValues.includes(normalized)) {
    throw badRequest(`${label} must be one of ${allowedValues.join(", ")}`);
  }
  return normalized;
}

function optionalDateTime(value, label) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return parseDateTime(value, label);
}

function optionalInteger(value, label, fallback = null) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw badRequest(`${label} must be an integer`);
  }
  return parsed;
}

function optionalJsonObject(value, label) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  throw badRequest(`${label} must be an object`);
}

function normalizeOptionalReason(req, { required = false } = {}) {
  return normalizeText(req.body?.reason ?? req.body?.note, "reason", 1000, { required });
}

/** Parse the template id route parameter for template mutations. */
export function parseCloseTaskTemplateIdParam(req) {
  return requirePositiveInt(req.params?.templateId, "templateId");
}

/** Parse the task id route parameter for task reads and lifecycle actions. */
export function parseCloseTaskIdParam(req) {
  return requirePositiveInt(req.params?.taskId, "taskId");
}

/** Parse the close cycle id route parameter for cycle-scoped task routes. */
export function parseCloseCycleIdParam(req) {
  return requirePositiveInt(req.params?.cycleId ?? req.params?.id, "cycleId");
}

/** Parse the evidence id route parameter for task evidence mutations. */
export function parseCloseTaskEvidenceIdParam(req) {
  return requirePositiveInt(req.params?.evidenceId, "evidenceId");
}

/** Parse the comment id route parameter for task comment mutations. */
export function parseCloseTaskCommentIdParam(req) {
  return requirePositiveInt(req.params?.commentId, "commentId");
}

/** Parse query filters for the close task template catalog. */
export function parseCloseTaskTemplateListInput(req) {
  const pagination = parsePagination(req.query, { limit: 100, offset: 0, maxLimit: 500 });
  return {
    tenantId: requireTenantId(req),
    status: optionalEnum(
      req.query?.status,
      "status",
      CLOSE_TASK_TEMPLATE_STATUS_VALUES,
      normalizeCloseTaskTemplateStatus,
    ),
    includeGlobal: parseBooleanFlag(req.query?.includeGlobal, true),
    taskFamily: optionalEnum(
      req.query?.taskFamily ?? req.query?.task_family,
      "taskFamily",
      CLOSE_TASK_FAMILIES,
      normalizeCloseTaskFamily,
    ),
    cycleScopeKind: optionalEnum(
      req.query?.cycleScopeKind ?? req.query?.cycle_scope_kind,
      "cycleScopeKind",
      CLOSE_TASK_CYCLE_SCOPE_KINDS,
      normalizeCloseTaskCycleScopeKind,
    ),
    q: normalizeText(req.query?.q, "q", 120),
    ...pagination,
  };
}

/** Parse the create payload for tenant close task template rows. */
export function parseCloseTaskTemplateCreateInput(req) {
  const tenantId = requireTenantId(req);
  const userId = requireUserId(req);
  const body = req.body || {};
  return {
    tenantId,
    userId,
    taskCode: normalizeCode(body.taskCode ?? body.task_code, "taskCode", 96),
    taskName: normalizeText(body.taskName ?? body.task_name, "taskName", 191, {
      required: true,
    }),
    taskDescription: normalizeText(
      body.taskDescription ?? body.task_description,
      "taskDescription",
      1000,
    ),
    taskFamily: normalizeCloseTaskFamily(body.taskFamily ?? body.task_family, "MANUAL"),
    cycleScopeKind: normalizeCloseTaskCycleScopeKind(
      body.cycleScopeKind ?? body.cycle_scope_kind,
      "ANY",
    ),
    defaultRbacScopeType: normalizeCloseTaskRbacScopeType(
      body.defaultRbacScopeType ?? body.default_rbac_scope_type,
      "LEGAL_ENTITY",
    ),
    defaultWorkScopeType: normalizeCloseTaskWorkScopeType(
      body.defaultWorkScopeType ?? body.default_work_scope_type,
      "CYCLE",
    ),
    anchorItemType: normalizeCloseTaskAnchorItemType(
      body.anchorItemType ?? body.anchor_item_type,
      "ANY",
    ),
    materializationMode: normalizeCloseTaskMaterializationMode(
      body.materializationMode ?? body.materialization_mode,
      "MANUAL_ONLY",
    ),
    completionMode: normalizeCloseTaskCompletionMode(
      body.completionMode ?? body.completion_mode,
      "MANUAL",
    ),
    sourceCheckCode: normalizeText(
      body.sourceCheckCode ?? body.source_check_code,
      "sourceCheckCode",
      96,
    ),
    sourceRefType: normalizeText(body.sourceRefType ?? body.source_ref_type, "sourceRefType", 80),
    sourceRefIdStrategy: normalizeText(
      body.sourceRefIdStrategy ?? body.source_ref_id_strategy,
      "sourceRefIdStrategy",
      96,
    ),
    autoCompleteAllowed: parseBooleanFlag(
      body.autoCompleteAllowed ?? body.auto_complete_allowed,
      false,
    ),
    defaultDueOffsetDays: optionalInteger(
      body.defaultDueOffsetDays ?? body.default_due_offset_days,
      "defaultDueOffsetDays",
      0,
    ),
    evidenceRequired: parseBooleanFlag(body.evidenceRequired ?? body.evidence_required, false),
    requiredForCycleLock: parseBooleanFlag(
      body.requiredForCycleLock ?? body.required_for_cycle_lock,
      false,
    ),
    defaultOwnerStrategy: normalizeCloseTaskOwnerStrategy(
      body.defaultOwnerStrategy ?? body.default_owner_strategy,
      "MANUAL",
    ),
    defaultReviewerStrategy: normalizeCloseTaskReviewerStrategy(
      body.defaultReviewerStrategy ?? body.default_reviewer_strategy,
      "MANUAL",
    ),
    blockerClass: normalizeText(body.blockerClass ?? body.blocker_class, "blockerClass", 80),
    sortOrder: optionalInteger(body.sortOrder ?? body.sort_order, "sortOrder", 1000),
    status: normalizeCloseTaskTemplateStatus(body.status, "ACTIVE"),
    config: optionalJsonObject(body.config ?? body.config_json, "config"),
  };
}

/** Parse the patch payload for tenant-owned close task templates. */
export function parseCloseTaskTemplatePatchInput(req) {
  const body = req.body || {};
  const patch = {
    tenantId: requireTenantId(req),
    userId: requireUserId(req),
    templateId: parseCloseTaskTemplateIdParam(req),
  };

  if (hasOwn(body, "taskName") || hasOwn(body, "task_name")) {
    patch.taskName = normalizeText(body.taskName ?? body.task_name, "taskName", 191, {
      required: true,
    });
  }
  if (hasOwn(body, "taskDescription") || hasOwn(body, "task_description")) {
    patch.taskDescription = normalizeText(
      body.taskDescription ?? body.task_description,
      "taskDescription",
      1000,
    );
  }
  if (hasOwn(body, "taskFamily") || hasOwn(body, "task_family")) {
    patch.taskFamily = normalizeCloseTaskFamily(body.taskFamily ?? body.task_family);
  }
  if (hasOwn(body, "cycleScopeKind") || hasOwn(body, "cycle_scope_kind")) {
    patch.cycleScopeKind = normalizeCloseTaskCycleScopeKind(
      body.cycleScopeKind ?? body.cycle_scope_kind,
    );
  }
  if (hasOwn(body, "defaultRbacScopeType") || hasOwn(body, "default_rbac_scope_type")) {
    patch.defaultRbacScopeType = normalizeCloseTaskRbacScopeType(
      body.defaultRbacScopeType ?? body.default_rbac_scope_type,
    );
  }
  if (hasOwn(body, "defaultWorkScopeType") || hasOwn(body, "default_work_scope_type")) {
    patch.defaultWorkScopeType = normalizeCloseTaskWorkScopeType(
      body.defaultWorkScopeType ?? body.default_work_scope_type,
    );
  }
  if (hasOwn(body, "anchorItemType") || hasOwn(body, "anchor_item_type")) {
    patch.anchorItemType = normalizeCloseTaskAnchorItemType(
      body.anchorItemType ?? body.anchor_item_type,
    );
  }
  if (hasOwn(body, "materializationMode") || hasOwn(body, "materialization_mode")) {
    patch.materializationMode = normalizeCloseTaskMaterializationMode(
      body.materializationMode ?? body.materialization_mode,
    );
  }
  if (hasOwn(body, "completionMode") || hasOwn(body, "completion_mode")) {
    patch.completionMode = normalizeCloseTaskCompletionMode(
      body.completionMode ?? body.completion_mode,
    );
  }
  if (hasOwn(body, "sourceCheckCode") || hasOwn(body, "source_check_code")) {
    patch.sourceCheckCode = normalizeText(
      body.sourceCheckCode ?? body.source_check_code,
      "sourceCheckCode",
      96,
    );
  }
  if (hasOwn(body, "sourceRefType") || hasOwn(body, "source_ref_type")) {
    patch.sourceRefType = normalizeText(
      body.sourceRefType ?? body.source_ref_type,
      "sourceRefType",
      80,
    );
  }
  if (hasOwn(body, "sourceRefIdStrategy") || hasOwn(body, "source_ref_id_strategy")) {
    patch.sourceRefIdStrategy = normalizeText(
      body.sourceRefIdStrategy ?? body.source_ref_id_strategy,
      "sourceRefIdStrategy",
      96,
    );
  }
  if (hasOwn(body, "autoCompleteAllowed") || hasOwn(body, "auto_complete_allowed")) {
    patch.autoCompleteAllowed = parseBooleanFlag(
      body.autoCompleteAllowed ?? body.auto_complete_allowed,
      false,
    );
  }
  if (hasOwn(body, "defaultDueOffsetDays") || hasOwn(body, "default_due_offset_days")) {
    patch.defaultDueOffsetDays = optionalInteger(
      body.defaultDueOffsetDays ?? body.default_due_offset_days,
      "defaultDueOffsetDays",
      0,
    );
  }
  if (hasOwn(body, "evidenceRequired") || hasOwn(body, "evidence_required")) {
    patch.evidenceRequired = parseBooleanFlag(
      body.evidenceRequired ?? body.evidence_required,
      false,
    );
  }
  if (hasOwn(body, "requiredForCycleLock") || hasOwn(body, "required_for_cycle_lock")) {
    patch.requiredForCycleLock = parseBooleanFlag(
      body.requiredForCycleLock ?? body.required_for_cycle_lock,
      false,
    );
  }
  if (hasOwn(body, "defaultOwnerStrategy") || hasOwn(body, "default_owner_strategy")) {
    patch.defaultOwnerStrategy = normalizeCloseTaskOwnerStrategy(
      body.defaultOwnerStrategy ?? body.default_owner_strategy,
    );
  }
  if (hasOwn(body, "defaultReviewerStrategy") || hasOwn(body, "default_reviewer_strategy")) {
    patch.defaultReviewerStrategy = normalizeCloseTaskReviewerStrategy(
      body.defaultReviewerStrategy ?? body.default_reviewer_strategy,
    );
  }
  if (hasOwn(body, "blockerClass") || hasOwn(body, "blocker_class")) {
    patch.blockerClass = normalizeText(body.blockerClass ?? body.blocker_class, "blockerClass", 80);
  }
  if (hasOwn(body, "sortOrder") || hasOwn(body, "sort_order")) {
    patch.sortOrder = optionalInteger(body.sortOrder ?? body.sort_order, "sortOrder", 1000);
  }
  if (hasOwn(body, "status")) {
    patch.status = normalizeCloseTaskTemplateStatus(body.status);
  }
  if (hasOwn(body, "config") || hasOwn(body, "config_json")) {
    patch.config = optionalJsonObject(body.config ?? body.config_json, "config");
  }

  return patch;
}

/** Parse list filters for close task board/read APIs. */
export function parseCloseTaskListInput(req) {
  const pagination = parsePagination(req.query, { limit: 100, offset: 0, maxLimit: 500 });
  return {
    tenantId: requireTenantId(req),
    closeCycleId: optionalPositiveInt(
      req.query?.closeCycleId ?? req.query?.close_cycle_id,
      "closeCycleId",
    ),
    closeCycleItemId: optionalPositiveInt(
      req.query?.closeCycleItemId ?? req.query?.close_cycle_item_id,
      "closeCycleItemId",
    ),
    status: optionalEnum(req.query?.status, "status", CLOSE_TASK_STATUS_VALUES, normalizeCloseTaskStatus),
    taskFamily: optionalEnum(
      req.query?.taskFamily ?? req.query?.task_family,
      "taskFamily",
      CLOSE_TASK_FAMILIES,
      normalizeCloseTaskFamily,
    ),
    rbacScopeType: optionalEnum(
      req.query?.rbacScopeType ?? req.query?.rbac_scope_type,
      "rbacScopeType",
      CLOSE_TASK_RBAC_SCOPE_TYPES,
      normalizeCloseTaskRbacScopeType,
    ),
    rbacScopeId: optionalPositiveInt(
      req.query?.rbacScopeId ?? req.query?.rbac_scope_id,
      "rbacScopeId",
    ),
    workScopeType: optionalEnum(
      req.query?.workScopeType ?? req.query?.work_scope_type,
      "workScopeType",
      CLOSE_TASK_WORK_SCOPE_TYPES,
      normalizeCloseTaskWorkScopeType,
    ),
    workScopeId: optionalPositiveInt(
      req.query?.workScopeId ?? req.query?.work_scope_id,
      "workScopeId",
    ),
    ownerUserId: optionalPositiveInt(req.query?.ownerUserId ?? req.query?.owner_user_id, "ownerUserId"),
    reviewerUserId: optionalPositiveInt(
      req.query?.reviewerUserId ?? req.query?.reviewer_user_id,
      "reviewerUserId",
    ),
    evidenceMissing: req.query?.evidenceMissing
      ? parseBooleanFlag(req.query.evidenceMissing, false)
      : null,
    dueState: normalizeText(req.query?.dueState ?? req.query?.due_state, "dueState", 30),
    q: normalizeText(req.query?.q, "q", 120),
    ...pagination,
  };
}

/** Parse list filters for tasks under one close cycle. */
export function parseCloseCycleTaskListInput(req) {
  return {
    ...parseCloseTaskListInput(req),
    closeCycleId: parseCloseCycleIdParam(req),
  };
}

/** Parse the manual close task create payload. */
export function parseCloseTaskCreateInput(req) {
  const tenantId = requireTenantId(req);
  const body = req.body || {};
  return {
    tenantId,
    userId: requireUserId(req),
    closeCycleId: parseCloseCycleIdParam(req),
    taskCode: normalizeCode(body.taskCode ?? body.task_code ?? "MANUAL_CLOSE_TASK", "taskCode", 96),
    taskName: normalizeText(body.taskName ?? body.task_name, "taskName", 191, { required: true }),
    taskDescription: normalizeText(
      body.taskDescription ?? body.task_description,
      "taskDescription",
      1000,
    ),
    taskFamily: normalizeCloseTaskFamily(body.taskFamily ?? body.task_family, "MANUAL"),
    completionMode: normalizeCloseTaskCompletionMode(
      body.completionMode ?? body.completion_mode,
      "MANUAL",
    ),
    rbacScopeType: normalizeCloseTaskRbacScopeType(
      body.rbacScopeType ?? body.rbac_scope_type ?? body.scopeType ?? body.scope_type,
    ),
    rbacScopeId: requirePositiveInt(
      body.rbacScopeId ?? body.rbac_scope_id ?? body.scopeId ?? body.scope_id,
      "rbacScopeId",
    ),
    workScopeType: normalizeCloseTaskWorkScopeType(
      body.workScopeType ?? body.work_scope_type,
      "CYCLE",
    ),
    workScopeId: optionalPositiveInt(body.workScopeId ?? body.work_scope_id, "workScopeId"),
    ownerUserId: optionalPositiveInt(body.ownerUserId ?? body.owner_user_id, "ownerUserId"),
    reviewerUserId: optionalPositiveInt(
      body.reviewerUserId ?? body.reviewer_user_id,
      "reviewerUserId",
    ),
    dueAt: optionalDateTime(body.dueAt ?? body.due_at, "dueAt"),
    evidenceRequired: parseBooleanFlag(body.evidenceRequired ?? body.evidence_required, false),
    requiredForCycleLock: parseBooleanFlag(
      body.requiredForCycleLock ?? body.required_for_cycle_lock,
      false,
    ),
    blockerClass: normalizeText(body.blockerClass ?? body.blocker_class, "blockerClass", 80),
    bookId: optionalPositiveInt(body.bookId ?? body.book_id, "bookId"),
    operatingUnitId: optionalPositiveInt(
      body.operatingUnitId ?? body.operating_unit_id,
      "operatingUnitId",
    ),
    countryId: optionalPositiveInt(body.countryId ?? body.country_id, "countryId"),
    groupCompanyId: optionalPositiveInt(
      body.groupCompanyId ?? body.group_company_id,
      "groupCompanyId",
    ),
    consolidationGroupId: optionalPositiveInt(
      body.consolidationGroupId ?? body.consolidation_group_id,
      "consolidationGroupId",
    ),
    sourceCheckCode: normalizeText(
      body.sourceCheckCode ?? body.source_check_code,
      "sourceCheckCode",
      96,
    ),
    sourceRefType: normalizeText(body.sourceRefType ?? body.source_ref_type, "sourceRefType", 80),
    sourceRefId: optionalPositiveInt(body.sourceRefId ?? body.source_ref_id, "sourceRefId"),
  };
}

/** Parse mutable task metadata and assignment patch payloads. */
export function parseCloseTaskPatchInput(req) {
  const body = req.body || {};
  const patch = {
    tenantId: requireTenantId(req),
    userId: requireUserId(req),
    taskId: parseCloseTaskIdParam(req),
  };
  if (hasOwn(body, "taskName") || hasOwn(body, "task_name")) {
    patch.taskName = normalizeText(body.taskName ?? body.task_name, "taskName", 191, {
      required: true,
    });
  }
  if (hasOwn(body, "taskDescription") || hasOwn(body, "task_description")) {
    patch.taskDescription = normalizeText(
      body.taskDescription ?? body.task_description,
      "taskDescription",
      1000,
    );
  }
  if (hasOwn(body, "ownerUserId") || hasOwn(body, "owner_user_id")) {
    patch.ownerUserId = optionalPositiveInt(body.ownerUserId ?? body.owner_user_id, "ownerUserId");
  }
  if (hasOwn(body, "reviewerUserId") || hasOwn(body, "reviewer_user_id")) {
    patch.reviewerUserId = optionalPositiveInt(
      body.reviewerUserId ?? body.reviewer_user_id,
      "reviewerUserId",
    );
  }
  if (hasOwn(body, "dueAt") || hasOwn(body, "due_at")) {
    patch.dueAt = optionalDateTime(body.dueAt ?? body.due_at, "dueAt");
  }
  if (hasOwn(body, "blockerClass") || hasOwn(body, "blocker_class")) {
    patch.blockerClass = normalizeText(body.blockerClass ?? body.blocker_class, "blockerClass", 80);
  }
  if (hasOwn(body, "evidenceRequired") || hasOwn(body, "evidence_required")) {
    patch.evidenceRequired = parseBooleanFlag(
      body.evidenceRequired ?? body.evidence_required,
      false,
    );
  }
  if (hasOwn(body, "requiredForCycleLock") || hasOwn(body, "required_for_cycle_lock")) {
    patch.requiredForCycleLock = parseBooleanFlag(
      body.requiredForCycleLock ?? body.required_for_cycle_lock,
      false,
    );
  }
  return patch;
}

/** Parse common task lifecycle action payloads, including mandatory reasons. */
export function parseCloseTaskActionInput(req, options = {}) {
  return {
    tenantId: requireTenantId(req),
    userId: requireUserId(req),
    taskId: parseCloseTaskIdParam(req),
    reason: normalizeOptionalReason(req, { required: Boolean(options.requireReason) }),
  };
}

/** Parse an existing evidence-object attach payload for a close task. */
export function parseCloseTaskEvidenceAttachInput(req) {
  return {
    tenantId: requireTenantId(req),
    userId: requireUserId(req),
    taskId: parseCloseTaskIdParam(req),
    evidenceObjectId: requirePositiveInt(
      req.body?.evidenceObjectId ?? req.body?.evidence_object_id,
      "evidenceObjectId",
    ),
  };
}

/** Parse task evidence remove/download/content mutation parameters. */
export function parseCloseTaskEvidenceMutationInput(req) {
  return {
    tenantId: requireTenantId(req),
    userId: requireUserId(req),
    taskId: parseCloseTaskIdParam(req),
    evidenceId: parseCloseTaskEvidenceIdParam(req),
    reason: normalizeOptionalReason(req),
  };
}

/** Parse a generic internal comment create payload for a close task. */
export function parseCloseTaskCommentCreateInput(req) {
  return {
    tenantId: requireTenantId(req),
    userId: requireUserId(req),
    taskId: parseCloseTaskIdParam(req),
    body: normalizeText(req.body?.body ?? req.body?.comment ?? req.body?.commentBody, "body", 2000, {
      required: true,
    }),
  };
}

/** Parse a generic internal comment delete payload for a close task. */
export function parseCloseTaskCommentDeleteInput(req) {
  return {
    tenantId: requireTenantId(req),
    userId: requireUserId(req),
    taskId: parseCloseTaskIdParam(req),
    commentId: parseCloseTaskCommentIdParam(req),
  };
}
