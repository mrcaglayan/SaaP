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
import { listCycleItems } from "./close.cycle-items.service.js";
import { loadMergedCloseTaskTemplates } from "./close.task-templates.service.js";
import { resolveCloseTaskAlerts } from "./close.alerts-persistence.service.js";

const SUBMITTABLE_STATUSES = new Set(["NOT_STARTED", "IN_PROGRESS", "RETURNED"]);
const WAIVABLE_STATUSES = new Set(["NOT_STARTED", "IN_PROGRESS", "SUBMITTED", "RETURNED"]);
const CANCELLABLE_STATUSES = new Set(["NOT_STARTED", "IN_PROGRESS", "SUBMITTED", "RETURNED"]);
const REOPENABLE_STATUSES = new Set(["APPROVED", "WAIVED", "CANCELLED"]);
const MATERIALIZATION_TEMPLATE_STATUSES = Object.freeze(["ACTIVE", "PAUSED", "DISABLED"]);
const MATERIALIZATION_CYCLE_STATUSES = new Set(["PLANNED", "OPEN"]);
const TASK_SOURCE_CHECK_FAILED_STATUSES = new Set(["FAILED", "ERROR", "BLOCKED"]);

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

function readValue(row, ...keys) {
  if (!row) {
    return null;
  }
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") {
      return row[key];
    }
  }
  return null;
}

function readPositiveInt(row, ...keys) {
  return parsePositiveInt(readValue(row, ...keys));
}

function readUpperText(row, ...keys) {
  return String(readValue(row, ...keys) || "")
    .trim()
    .toUpperCase();
}

function normalizeTemplateCode(template) {
  return String(template?.taskCode ?? template?.task_code ?? "")
    .trim()
    .toUpperCase();
}

function toMysqlDateTime(value) {
  if (!value) {
    return null;
  }
  const parsed = value instanceof Date ? value : new Date(String(value).replace(" ", "T") + "Z");
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString().slice(0, 19).replace("T", " ");
}

function addDaysToDateTime(value, offsetDays = 0) {
  const base = value instanceof Date ? new Date(value.getTime()) : new Date(String(value).replace(" ", "T") + "Z");
  if (!value || Number.isNaN(base.getTime())) {
    return null;
  }
  base.setUTCDate(base.getUTCDate() + Number(offsetDays || 0));
  return toMysqlDateTime(base);
}

function collectMaterializationLegalEntityIds(cycle, cycleItems = []) {
  const ids = new Set();
  const cycleLegalEntityId = readPositiveInt(cycle, "legal_entity_id", "legalEntityId");
  if (cycleLegalEntityId) {
    ids.add(cycleLegalEntityId);
  }
  for (const item of cycleItems || []) {
    const legalEntityId = readPositiveInt(item, "legal_entity_id", "legalEntityId");
    if (legalEntityId) {
      ids.add(legalEntityId);
    }
  }
  return Array.from(ids);
}

function collectMaterializationLocalClosePackIds(cycleItems = []) {
  const ids = new Set();
  for (const item of cycleItems || []) {
    if (readUpperText(item, "current_source_target_type", "currentSourceTargetType") !== "LOCAL_CLOSE_PACK") {
      continue;
    }
    const localClosePackId = readPositiveInt(
      item,
      "current_source_target_id",
      "currentSourceTargetId",
    );
    if (localClosePackId) {
      ids.add(localClosePackId);
    }
  }
  return Array.from(ids);
}

async function loadLegalEntityContextById({ tenantId, legalEntityIds = [], runQuery = query }) {
  const ids = Array.from(new Set((legalEntityIds || []).map(parsePositiveInt).filter(Boolean)));
  if (ids.length === 0) {
    return new Map();
  }
  const result = await runQuery(
    `SELECT id, country_id, group_company_id
     FROM legal_entities
     WHERE tenant_id = ?
       AND id IN (${ids.map(() => "?").join(", ")})`,
    [parsePositiveInt(tenantId), ...ids],
  );
  const byId = new Map();
  for (const row of result.rows || []) {
    const id = parsePositiveInt(row.id);
    if (!id) {
      continue;
    }
    byId.set(id, {
      legalEntityId: id,
      countryId: parsePositiveInt(row.country_id),
      groupCompanyId: parsePositiveInt(row.group_company_id),
    });
  }
  return byId;
}

async function loadLocalClosePackReviewerById({
  tenantId,
  localClosePackIds = [],
  runQuery = query,
}) {
  const ids = Array.from(new Set((localClosePackIds || []).map(parsePositiveInt).filter(Boolean)));
  if (ids.length === 0) {
    return new Map();
  }
  const result = await runQuery(
    `SELECT id, reviewer_user_id
     FROM local_close_packs
     WHERE tenant_id = ?
       AND id IN (${ids.map(() => "?").join(", ")})`,
    [parsePositiveInt(tenantId), ...ids],
  );
  const byId = new Map();
  for (const row of result.rows || []) {
    const id = parsePositiveInt(row.id);
    if (!id) {
      continue;
    }
    byId.set(id, parsePositiveInt(row.reviewer_user_id));
  }
  return byId;
}

function buildMaterializationContext({
  cycle,
  item = null,
  legalEntityContextById = new Map(),
  localClosePackReviewerById = new Map(),
}) {
  const legalEntityId =
    readPositiveInt(item, "legal_entity_id", "legalEntityId") ||
    readPositiveInt(cycle, "legal_entity_id", "legalEntityId");
  const entityContext = legalEntityId ? legalEntityContextById.get(legalEntityId) || {} : {};
  const currentSourceTargetType = readUpperText(
    item,
    "current_source_target_type",
    "currentSourceTargetType",
  );
  const currentSourceTargetId = readPositiveInt(
    item,
    "current_source_target_id",
    "currentSourceTargetId",
  );
  return {
    cycleId: readPositiveInt(cycle, "id"),
    fiscalPeriodId: readPositiveInt(cycle, "fiscal_period_id", "fiscalPeriodId"),
    cycleScopeKind: readUpperText(cycle, "scope_kind", "scopeKind"),
    legalEntityId,
    bookId: readPositiveInt(item, "book_id", "bookId"),
    operatingUnitId: readPositiveInt(item, "operating_unit_id", "operatingUnitId"),
    countryId:
      readPositiveInt(item, "country_id", "countryId") ||
      readPositiveInt(cycle, "country_id", "countryId") ||
      parsePositiveInt(entityContext.countryId),
    groupCompanyId:
      readPositiveInt(item, "group_company_id", "groupCompanyId") ||
      readPositiveInt(cycle, "group_company_id", "groupCompanyId") ||
      parsePositiveInt(entityContext.groupCompanyId),
    consolidationGroupId:
      readPositiveInt(item, "consolidation_group_id", "consolidationGroupId") ||
      readPositiveInt(cycle, "consolidation_group_id", "consolidationGroupId"),
    closeCycleItemId: readPositiveInt(item, "id"),
    itemType: readUpperText(item, "item_type", "itemType"),
    itemOwnerUserId: readPositiveInt(item, "owner_user_id", "ownerUserId"),
    currentSourceTargetType,
    currentSourceTargetId,
    localClosePackReviewerUserId:
      currentSourceTargetType === "LOCAL_CLOSE_PACK"
        ? parsePositiveInt(localClosePackReviewerById.get(currentSourceTargetId))
        : null,
  };
}

function resolveRbacScopeForMaterializedTask(template, context) {
  const requestedScopeType = String(template.defaultRbacScopeType || "LEGAL_ENTITY")
    .trim()
    .toUpperCase();
  const requestedScopeId =
    requestedScopeType === "OPERATING_UNIT"
      ? context.operatingUnitId
      : requestedScopeType === "COUNTRY"
        ? context.countryId
        : requestedScopeType === "GROUP"
          ? context.groupCompanyId
          : context.legalEntityId;
  if (!requestedScopeId) {
    return null;
  }
  const scopeType = normalizeCloseTaskRbacScope(
    {
      scopeType: requestedScopeType,
      scopeId: requestedScopeId,
    },
    null,
  );
  return {
    rbacScopeType: scopeType.scopeType,
    rbacScopeId: scopeType.scopeId,
    rbacScopeKey: buildCloseTaskScopeKey(scopeType.scopeType, scopeType.scopeId),
  };
}

function resolveWorkScopeForMaterializedTask(template, context) {
  const workScopeType = normalizeCloseTaskWorkScopeType(
    template.defaultWorkScopeType || "CYCLE",
    "CYCLE",
  );
  let workScopeId = null;
  if (workScopeType === "CYCLE") {
    workScopeId = context.cycleId;
  } else if (workScopeType === "BOOK") {
    workScopeId = context.bookId;
  } else if (workScopeType === "CENTRAL") {
    workScopeId = context.legalEntityId;
  } else if (workScopeType === "OPERATING_UNIT") {
    workScopeId = context.operatingUnitId;
  } else if (workScopeType === "LOCAL_CLOSE_PACK") {
    workScopeId =
      context.itemType === "LOCAL_CLOSE_PACK"
        ? context.currentSourceTargetId || context.closeCycleItemId
        : null;
  } else if (workScopeType === "PERIOD_CLOSE_RUN") {
    workScopeId =
      context.itemType === "PERIOD_CLOSE_RUN"
        ? context.currentSourceTargetId || context.closeCycleItemId
        : null;
  } else if (workScopeType === "CONSOLIDATION_GROUP") {
    workScopeId = context.consolidationGroupId;
  }
  if (!workScopeId) {
    return null;
  }
  return {
    workScopeType,
    workScopeId,
    workScopeKey: buildCloseTaskWorkScopeKey(workScopeType, workScopeId, context.cycleId),
  };
}

function resolveTaskIdentityKey(template, context, workScope) {
  const taskCode = normalizeTemplateCode(template);
  let identityType = workScope.workScopeType;
  let identityId = workScope.workScopeId;
  if (workScope.workScopeType === "CENTRAL") {
    identityType = "LEGAL_ENTITY";
    identityId = context.legalEntityId;
  }
  return `${taskCode}:${identityType}:${identityId}`;
}

function resolveMaterializedTaskAssignment(strategy, cycle, context) {
  const normalized = String(strategy || "MANUAL")
    .trim()
    .toUpperCase();
  if (normalized === "CYCLE_OWNER") {
    return readPositiveInt(cycle, "owner_user_id", "ownerUserId");
  }
  if (normalized === "ITEM_OWNER" || normalized === "LOCAL_CLOSE_PACK_OWNER") {
    return context.itemOwnerUserId || readPositiveInt(cycle, "owner_user_id", "ownerUserId");
  }
  if (normalized === "LOCAL_CLOSE_PACK_REVIEWER") {
    return (
      context.localClosePackReviewerUserId ||
      readPositiveInt(cycle, "owner_user_id", "ownerUserId")
    );
  }
  return null;
}

function resolveSourceRefForMaterializedTask(template, context) {
  const sourceRefType = template.sourceRefType || null;
  const strategy = String(template.sourceRefIdStrategy || "")
    .trim()
    .toUpperCase();
  if (!sourceRefType || !strategy) {
    return { sourceRefType: null, sourceRefId: null };
  }
  if (
    strategy === "CURRENT_ITEM_SOURCE_TARGET" &&
    context.currentSourceTargetId &&
    context.currentSourceTargetType === sourceRefType
  ) {
    return {
      sourceRefType,
      sourceRefId: context.currentSourceTargetId,
    };
  }
  if (strategy === "CLOSE_CYCLE_ITEM" && context.closeCycleItemId) {
    return {
      sourceRefType,
      sourceRefId: context.closeCycleItemId,
    };
  }
  if (strategy === "CLOSE_CYCLE" && context.cycleId) {
    return {
      sourceRefType,
      sourceRefId: context.cycleId,
    };
  }
  return { sourceRefType: null, sourceRefId: null };
}

function templateAppliesToCycle(template, cycleScopeKind) {
  const templateScopeKind = String(template.cycleScopeKind || "ANY")
    .trim()
    .toUpperCase();
  return templateScopeKind === "ANY" || templateScopeKind === cycleScopeKind;
}

function templateAppliesToItem(template, item) {
  const materializationMode = String(template.materializationMode || "MANUAL_ONLY")
    .trim()
    .toUpperCase();
  const anchorItemType = String(template.anchorItemType || "ANY")
    .trim()
    .toUpperCase();
  if (materializationMode === "CYCLE") {
    return anchorItemType === "ANY";
  }
  if (materializationMode !== "ITEM" || !item) {
    return false;
  }
  const itemType = readUpperText(item, "item_type", "itemType");
  return anchorItemType === "ANY" || anchorItemType === itemType;
}

function buildMaterializedTaskCandidate({
  template,
  cycle,
  item = null,
  legalEntityContextById,
  localClosePackReviewerById,
}) {
  const context = buildMaterializationContext({
    cycle,
    item,
    legalEntityContextById,
    localClosePackReviewerById,
  });
  const rbacScope = resolveRbacScopeForMaterializedTask(template, context);
  const workScope = resolveWorkScopeForMaterializedTask(template, context);
  if (!rbacScope || !workScope) {
    return null;
  }
  const sourceRef = resolveSourceRefForMaterializedTask(template, context);
  const dueAt = addDaysToDateTime(
    readValue(cycle, "due_at", "dueAt"),
    Number(template.defaultDueOffsetDays || 0),
  );
  return {
    closeCycleId: context.cycleId,
    closeCycleItemId: context.closeCycleItemId,
    closeTaskTemplateId: parsePositiveInt(template.id),
    fiscalPeriodId: context.fiscalPeriodId,
    taskKey: resolveTaskIdentityKey(template, context, workScope),
    taskCode: normalizeTemplateCode(template),
    taskName: template.taskName || template.task_name,
    taskDescription: template.taskDescription || template.task_description || null,
    taskFamily: normalizeCloseTaskFamily(template.taskFamily || template.task_family, "MANUAL"),
    completionMode: normalizeCloseTaskCompletionMode(
      template.completionMode || template.completion_mode,
      "MANUAL",
    ),
    ...rbacScope,
    ...workScope,
    legalEntityId: context.legalEntityId,
    bookId: context.bookId,
    operatingUnitId: context.operatingUnitId,
    countryId: context.countryId,
    groupCompanyId: context.groupCompanyId,
    consolidationGroupId: context.consolidationGroupId,
    ownerUserId: resolveMaterializedTaskAssignment(
      template.defaultOwnerStrategy,
      cycle,
      context,
    ),
    reviewerUserId: resolveMaterializedTaskAssignment(
      template.defaultReviewerStrategy,
      cycle,
      context,
    ),
    dueAt,
    evidenceRequired: Boolean(template.evidenceRequired),
    requiredForCycleLock: Boolean(template.requiredForCycleLock),
    blockerClass: template.blockerClass || null,
    sourceCheckCode: template.sourceCheckCode || null,
    ...sourceRef,
  };
}

/**
 * Resolve active template definitions into deterministic close-task instances
 * for a close cycle and its already-provisioned close-cycle items.
 */
export function buildCloseTaskMaterializationCandidates({
  cycle,
  cycleItems = [],
  templates = [],
  legalEntityContextById = new Map(),
  localClosePackReviewerById = new Map(),
} = {}) {
  const cycleScopeKind = readUpperText(cycle, "scope_kind", "scopeKind");
  const byTaskKey = new Map();
  for (const template of templates || []) {
    const taskCode = normalizeTemplateCode(template);
    const status = String(template?.status || "")
      .trim()
      .toUpperCase();
    if (!taskCode || status !== "ACTIVE" || !templateAppliesToCycle(template, cycleScopeKind)) {
      continue;
    }

    const materializationMode = String(template.materializationMode || "MANUAL_ONLY")
      .trim()
      .toUpperCase();
    if (materializationMode === "CYCLE" && templateAppliesToItem(template, null)) {
      const candidate = buildMaterializedTaskCandidate({
        template,
        cycle,
        legalEntityContextById,
        localClosePackReviewerById,
      });
      if (candidate && !byTaskKey.has(candidate.taskKey)) {
        byTaskKey.set(candidate.taskKey, candidate);
      }
      continue;
    }

    if (materializationMode !== "ITEM") {
      continue;
    }
    for (const item of cycleItems || []) {
      if (!templateAppliesToItem(template, item)) {
        continue;
      }
      const candidate = buildMaterializedTaskCandidate({
        template,
        cycle,
        item,
        legalEntityContextById,
        localClosePackReviewerById,
      });
      if (candidate && !byTaskKey.has(candidate.taskKey)) {
        byTaskKey.set(candidate.taskKey, candidate);
      }
    }
  }
  return Array.from(byTaskKey.values());
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

async function loadCloseTaskByCycleKey({
  tenantId,
  closeCycleId,
  taskKey,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT *
     FROM close_task_instances
     WHERE tenant_id = ?
       AND close_cycle_id = ?
       AND task_key = ?
     LIMIT 1`,
    [parsePositiveInt(tenantId), parsePositiveInt(closeCycleId), taskKey],
  );
  return result.rows?.[0] || null;
}

async function loadExistingCloseTaskKeysForCycle({ tenantId, closeCycleId, runQuery = query }) {
  const result = await runQuery(
    `SELECT task_key
     FROM close_task_instances
     WHERE tenant_id = ?
       AND close_cycle_id = ?`,
    [parsePositiveInt(tenantId), parsePositiveInt(closeCycleId)],
  );
  return new Set((result.rows || []).map((row) => row.task_key).filter(Boolean));
}

async function insertMaterializedCloseTaskCandidate({
  tenantId,
  userId = null,
  candidate,
  runQuery = query,
}) {
  return runQuery(
    `INSERT INTO close_task_instances (
       tenant_id,
       close_cycle_id,
       close_cycle_item_id,
       close_task_template_id,
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
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
    [
      parsePositiveInt(tenantId),
      parsePositiveInt(candidate.closeCycleId),
      parsePositiveInt(candidate.closeCycleItemId),
      parsePositiveInt(candidate.closeTaskTemplateId),
      parsePositiveInt(candidate.fiscalPeriodId),
      candidate.taskKey,
      candidate.taskCode,
      candidate.taskName,
      candidate.taskDescription || null,
      candidate.taskFamily,
      candidate.completionMode,
      candidate.rbacScopeType,
      parsePositiveInt(candidate.rbacScopeId),
      candidate.rbacScopeKey,
      candidate.workScopeType,
      parsePositiveInt(candidate.workScopeId),
      candidate.workScopeKey,
      parsePositiveInt(candidate.legalEntityId),
      parsePositiveInt(candidate.bookId),
      parsePositiveInt(candidate.operatingUnitId),
      parsePositiveInt(candidate.countryId),
      parsePositiveInt(candidate.groupCompanyId),
      parsePositiveInt(candidate.consolidationGroupId),
      parsePositiveInt(candidate.ownerUserId),
      parsePositiveInt(candidate.reviewerUserId),
      candidate.dueAt || null,
      Boolean(candidate.evidenceRequired),
      Boolean(candidate.requiredForCycleLock),
      candidate.blockerClass || null,
      candidate.sourceCheckCode || null,
      candidate.sourceRefType || null,
      parsePositiveInt(candidate.sourceRefId),
      parsePositiveInt(userId),
      parsePositiveInt(userId),
    ],
  );
}

/**
 * Materialize active close-task templates into deterministic task instances for
 * an already-provisioned cycle. Existing task_key rows are reused unchanged.
 */
export async function materializeCloseTasksForCycle(cycleId, actorCtx = {}) {
  if (typeof actorCtx?.runQuery !== "function") {
    return withTransaction((tx) =>
      materializeCloseTasksForCycle(cycleId, {
        ...actorCtx,
        runQuery: tx.query,
        lockCycleForMaterialization: true,
      }),
    );
  }

  const tenantId = parsePositiveInt(actorCtx.tenantId);
  const userId = parsePositiveInt(actorCtx.userId);
  const runQuery = actorCtx.runQuery;
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }

  const cycle = await loadCloseCycleForTenant({
    tenantId,
    cycleId,
    runQuery,
    forUpdate: Boolean(actorCtx.lockCycleForMaterialization),
  });
  if (!cycle) {
    throw notFound("Close cycle not found");
  }

  const cycleStatus = readUpperText(cycle, "status");
  if (!MATERIALIZATION_CYCLE_STATUSES.has(cycleStatus)) {
    throw conflict(
      `Close task materialization requires a PLANNED or OPEN close cycle, not ${cycleStatus}`,
      {
        cycleId: parsePositiveInt(cycleId),
        status: cycleStatus,
      },
      "CLOSE_TASK_MATERIALIZATION_STATUS_CONFLICT",
    );
  }

  const itemResult = await listCycleItems(cycle.id, {}, { tenantId, userId, runQuery });
  const cycleItems = itemResult.rows || [];
  const mergedTemplates = await loadMergedCloseTaskTemplates(
    {
      tenantId,
      statuses: MATERIALIZATION_TEMPLATE_STATUSES,
    },
    { runQuery },
  );
  const activeTemplates = mergedTemplates.filter(
    (template) => String(template.status || "").toUpperCase() === "ACTIVE",
  );
  const legalEntityContextById = await loadLegalEntityContextById({
    tenantId,
    legalEntityIds: collectMaterializationLegalEntityIds(cycle, cycleItems),
    runQuery,
  });
  const localClosePackReviewerById = await loadLocalClosePackReviewerById({
    tenantId,
    localClosePackIds: collectMaterializationLocalClosePackIds(cycleItems),
    runQuery,
  });
  const candidates = buildCloseTaskMaterializationCandidates({
    cycle,
    cycleItems,
    templates: activeTemplates,
    legalEntityContextById,
    localClosePackReviewerById,
  });
  const existingKeys = await loadExistingCloseTaskKeysForCycle({
    tenantId,
    closeCycleId: cycle.id,
    runQuery,
  });

  let createdCount = 0;
  let reusedCount = 0;
  for (const candidate of candidates) {
    if (existingKeys.has(candidate.taskKey)) {
      reusedCount += 1;
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const insertResult = await insertMaterializedCloseTaskCandidate({
      tenantId,
      userId,
      candidate,
      runQuery,
    });
    existingKeys.add(candidate.taskKey);
    if (Number(insertResult.rows?.affectedRows || 0) !== 1) {
      reusedCount += 1;
      continue;
    }

    createdCount += 1;
    // eslint-disable-next-line no-await-in-loop
    const created = await loadCloseTaskByCycleKey({
      tenantId,
      closeCycleId: cycle.id,
      taskKey: candidate.taskKey,
      runQuery,
    });
    if (created) {
      // eslint-disable-next-line no-await-in-loop
      await writeCloseTaskLifecycleEvent({
        runQuery,
        req: actorCtx.req,
        tenantId,
        taskRow: created,
        eventType: "CREATED",
        fromStatus: null,
        toStatus: "NOT_STARTED",
        actorUserId: userId || null,
        payload: {
          materialized: true,
          closeTaskTemplateId: candidate.closeTaskTemplateId || null,
        },
      });
    }
  }

  return {
    mergedTemplateCount: mergedTemplates.length,
    activeTemplateCount: activeTemplates.length,
    suppressedTemplateCount: mergedTemplates.length - activeTemplates.length,
    plannedTaskCount: candidates.length,
    createdTaskCount: createdCount,
    reusedTaskCount: reusedCount,
  };
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

function parseDateTimeMs(value) {
  if (!value) {
    return null;
  }
  const parsed = value instanceof Date ? value : new Date(String(value).replace(" ", "T"));
  const timestamp = parsed.getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function buildCloseTaskDrillPath(taskId) {
  const normalizedTaskId = parsePositiveInt(taskId);
  return normalizedTaskId
    ? `/app/donem-sonu-islemler/yillik/kapanis-gorevleri?taskId=${normalizedTaskId}`
    : "/app/donem-sonu-islemler/yillik/kapanis-gorevleri";
}

function mapCloseTaskCockpitRow(row = {}, now = new Date()) {
  const status = String(row.status || "").trim().toUpperCase();
  const dueAt = row.due_at || row.dueAt || null;
  const dueTimestamp = parseDateTimeMs(dueAt);
  const isTerminal = isCloseTaskTerminalStatus(status);
  const evidenceRequired = Boolean(Number(row.evidence_required ?? row.evidenceRequired ?? 0));
  const evidenceCount = Number(row.evidence_count ?? row.evidenceCount ?? 0);
  const evidenceMissing =
    evidenceRequired && evidenceCount <= 0 && !["WAIVED", "CANCELLED"].includes(status);
  const sourceCheckStatus = String(row.source_check_status ?? row.sourceCheckStatus ?? "")
    .trim()
    .toUpperCase();
  const sourceCheckFailed =
    !isTerminal && TASK_SOURCE_CHECK_FAILED_STATUSES.has(sourceCheckStatus);
  const overdue =
    !isTerminal &&
    dueTimestamp !== null &&
    dueTimestamp < (now instanceof Date ? now.getTime() : new Date(now).getTime());

  return {
    id: parsePositiveInt(row.id),
    closeCycleId: parsePositiveInt(row.close_cycle_id ?? row.closeCycleId),
    closeCycleItemId: parsePositiveInt(row.close_cycle_item_id ?? row.closeCycleItemId),
    taskKey: row.task_key ?? row.taskKey ?? "",
    taskCode: row.task_code ?? row.taskCode ?? "",
    taskName: row.task_name ?? row.taskName ?? "",
    taskFamily: row.task_family ?? row.taskFamily ?? "MANUAL",
    completionMode: row.completion_mode ?? row.completionMode ?? "MANUAL",
    status,
    rbacScopeType: row.rbac_scope_type ?? row.rbacScopeType ?? null,
    rbacScopeId: parsePositiveInt(row.rbac_scope_id ?? row.rbacScopeId),
    workScopeType: row.work_scope_type ?? row.workScopeType ?? null,
    workScopeId: parsePositiveInt(row.work_scope_id ?? row.workScopeId),
    legalEntityId: parsePositiveInt(row.legal_entity_id ?? row.legalEntityId),
    bookId: parsePositiveInt(row.book_id ?? row.bookId),
    operatingUnitId: parsePositiveInt(row.operating_unit_id ?? row.operatingUnitId),
    countryId: parsePositiveInt(row.country_id ?? row.countryId),
    groupCompanyId: parsePositiveInt(row.group_company_id ?? row.groupCompanyId),
    consolidationGroupId: parsePositiveInt(
      row.consolidation_group_id ?? row.consolidationGroupId,
    ),
    ownerUserId: parsePositiveInt(row.owner_user_id ?? row.ownerUserId),
    reviewerUserId: parsePositiveInt(row.reviewer_user_id ?? row.reviewerUserId),
    dueAt,
    evidenceRequired,
    evidenceCount,
    evidenceMissing,
    requiredForCycleLock: Boolean(
      Number(row.required_for_cycle_lock ?? row.requiredForCycleLock ?? 0),
    ),
    sourceCheckStatus: sourceCheckStatus || null,
    sourceCheckFailed,
    overdue,
    lockBlocking: false,
    drillPath: buildCloseTaskDrillPath(row.id),
  };
}

function isCloseTaskLockBlocking(row = {}) {
  if (!row.requiredForCycleLock) {
    return false;
  }
  if (["WAIVED", "CANCELLED"].includes(row.status)) {
    return false;
  }
  if (row.status !== "APPROVED") {
    return true;
  }
  // Approved evidence-required tasks can become blocking again if their active
  // evidence link is removed after approval; waiver/cancel remain explicit exits.
  return Boolean(row.evidenceMissing);
}

function buildCloseTaskLockBlocker(row = {}) {
  const evidenceOnly = row.status === "APPROVED" && row.evidenceMissing;
  return {
    code: evidenceOnly ? "CLOSE_TASK_EVIDENCE_MISSING" : "CLOSE_TASK_UNRESOLVED",
    message: evidenceOnly
      ? `${row.taskName || row.taskCode || "Close task"} requires active evidence before cycle lock.`
      : `${row.taskName || row.taskCode || "Close task"} must be resolved before cycle lock.`,
    severity: evidenceOnly || row.overdue ? "HIGH" : "MEDIUM",
    blockingItemType: "CLOSE_TASK_INSTANCE",
    blockingItemId: parsePositiveInt(row.id),
    blockingAction: evidenceOnly ? "ATTACH_EVIDENCE" : "RESOLVE_TASK",
    owner: row.ownerUserId ? { userId: row.ownerUserId } : null,
    dueDate: row.dueAt || null,
    firstBlockedAt: null,
    drillPath: row.drillPath || buildCloseTaskDrillPath(row.id),
    task: {
      taskCode: row.taskCode || null,
      taskFamily: row.taskFamily || null,
      status: row.status || null,
      evidenceRequired: Boolean(row.evidenceRequired),
      evidenceCount: Number(row.evidenceCount || 0),
    },
  };
}

function summarizeTaskFamily(rows = []) {
  const byFamily = new Map();
  for (const row of rows) {
    const key = row.taskFamily || "MANUAL";
    const current = byFamily.get(key) || {
      taskFamily: key,
      total: 0,
      open: 0,
      approved: 0,
      waived: 0,
      cancelled: 0,
      overdue: 0,
      lockBlocking: 0,
    };
    current.total += 1;
    current.open += isCloseTaskTerminalStatus(row.status) ? 0 : 1;
    current.approved += row.status === "APPROVED" ? 1 : 0;
    current.waived += row.status === "WAIVED" ? 1 : 0;
    current.cancelled += row.status === "CANCELLED" ? 1 : 0;
    current.overdue += row.overdue ? 1 : 0;
    current.lockBlocking += row.lockBlocking ? 1 : 0;
    byFamily.set(key, current);
  }
  return [...byFamily.values()].sort((left, right) =>
    String(left.taskFamily || "").localeCompare(String(right.taskFamily || "")),
  );
}

/**
 * Build the task cockpit section from preloaded task rows.
 */
export function buildCloseTaskCockpitSummaryFromRows(
  rows = [],
  { userId = null, now = new Date() } = {},
) {
  const normalizedRows = rows.map((row) => {
    const mapped = mapCloseTaskCockpitRow(row, now);
    return {
      ...mapped,
      lockBlocking: isCloseTaskLockBlocking(mapped),
    };
  });
  const normalizedUserId = parsePositiveInt(userId);
  const counts = {
    notStarted: normalizedRows.filter((row) => row.status === "NOT_STARTED").length,
    inProgress: normalizedRows.filter((row) => row.status === "IN_PROGRESS").length,
    submitted: normalizedRows.filter((row) => row.status === "SUBMITTED").length,
    returned: normalizedRows.filter((row) => row.status === "RETURNED").length,
    approved: normalizedRows.filter((row) => row.status === "APPROVED").length,
    waived: normalizedRows.filter((row) => row.status === "WAIVED").length,
    cancelled: normalizedRows.filter((row) => row.status === "CANCELLED").length,
    overdue: normalizedRows.filter((row) => row.overdue).length,
    evidenceMissing: normalizedRows.filter((row) => row.evidenceMissing).length,
    sourceCheckFailed: normalizedRows.filter((row) => row.sourceCheckFailed).length,
    lockBlocking: normalizedRows.filter((row) => row.lockBlocking).length,
  };
  return {
    total: normalizedRows.length,
    counts,
    byFamily: summarizeTaskFamily(normalizedRows),
    myOpenTasks: normalizedRows
      .filter(
        (row) =>
          normalizedUserId &&
          row.ownerUserId === normalizedUserId &&
          !isCloseTaskTerminalStatus(row.status),
      )
      .sort((left, right) => {
        const leftDue = parseDateTimeMs(left.dueAt) ?? Number.MAX_SAFE_INTEGER;
        const rightDue = parseDateTimeMs(right.dueAt) ?? Number.MAX_SAFE_INTEGER;
        return leftDue - rightDue || Number(left.id || 0) - Number(right.id || 0);
      })
      .slice(0, 10),
    rows: normalizedRows.sort((left, right) => {
      const leftDue = parseDateTimeMs(left.dueAt) ?? Number.MAX_SAFE_INTEGER;
      const rightDue = parseDateTimeMs(right.dueAt) ?? Number.MAX_SAFE_INTEGER;
      return leftDue - rightDue || Number(left.id || 0) - Number(right.id || 0);
    }),
  };
}

/**
 * Build standard close blocker rows for lock-required tasks.
 */
export function buildCloseTaskLockBlockersFromRows(rows = [], options = {}) {
  const summary = buildCloseTaskCockpitSummaryFromRows(rows, options);
  return summary.rows
    .filter((row) => row.lockBlocking)
    .map((row) => buildCloseTaskLockBlocker(row));
}

async function listCloseTaskRowsForCycle(cycleId, actorCtx = {}, options = {}) {
  const tenantId = parsePositiveInt(actorCtx.tenantId);
  const runQuery = typeof actorCtx.runQuery === "function" ? actorCtx.runQuery : query;
  const params = [tenantId, parsePositiveInt(cycleId)];
  const clauses = ["cti.tenant_id = ?", "cti.close_cycle_id = ?"];
  if (options.respectVisibility) {
    clauses.push(buildCloseTaskVisibilityWhere(actorCtx, params, "cti"));
  }

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
     WHERE ${clauses.join(" AND ")}
     ORDER BY cti.due_at IS NULL ASC, cti.due_at ASC, cti.id ASC`,
    params,
  );
  return result.rows || [];
}

/**
 * Read the close-cockpit task summary for one cycle.
 */
export async function buildCloseTaskCockpitSummary(cycleId, actorCtx = {}) {
  const tenantId = parsePositiveInt(actorCtx.tenantId);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  const rows = await listCloseTaskRowsForCycle(cycleId, actorCtx, {
    respectVisibility: false,
  });
  return buildCloseTaskCockpitSummaryFromRows(rows, {
    userId: actorCtx.userId,
  });
}

/**
 * Read task-derived cycle-lock blockers for one close cycle.
 */
export async function listCloseTaskLockBlockers(cycleId, actorCtx = {}) {
  const tenantId = parsePositiveInt(actorCtx.tenantId);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  const rows = await listCloseTaskRowsForCycle(cycleId, actorCtx, {
    respectVisibility: false,
  });
  return buildCloseTaskLockBlockersFromRows(rows);
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
    if (isCloseTaskTerminalStatus(nextStatus)) {
      await resolveCloseTaskAlerts(taskId, {
        ...actorCtx,
        tenantId,
        userId,
        runQuery: tx.query,
      });
    }
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
