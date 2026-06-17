import { query, withTransaction } from "../db.js";
import { parsePositiveInt } from "../routes/_utils.js";
import {
  mapCloseTaskTemplateRow,
  normalizeCloseTaskTemplateStatus,
} from "./close.task-scope.service.js";

function notFound(message) {
  const err = new Error(message);
  err.status = 404;
  return err;
}

function serializeConfig(config) {
  if (config === undefined || config === null) {
    return null;
  }
  return JSON.stringify(config);
}

function buildTenantScopeKey(tenantId) {
  return `TENANT:${parsePositiveInt(tenantId)}`;
}

function appendTemplateFilters(filters = {}, params = [], alias = "ctt") {
  const clauses = [`(${alias}.tenant_id IS NULL OR ${alias}.tenant_id = ?)`];
  params.push(parsePositiveInt(filters.tenantId));

  if (!filters.includeGlobal) {
    clauses[0] = `${alias}.tenant_id = ?`;
  }
  if (filters.status) {
    clauses.push(`${alias}.status = ?`);
    params.push(normalizeCloseTaskTemplateStatus(filters.status));
  }
  if (filters.taskFamily) {
    clauses.push(`${alias}.task_family = ?`);
    params.push(filters.taskFamily);
  }
  if (filters.cycleScopeKind) {
    clauses.push(`${alias}.cycle_scope_kind = ?`);
    params.push(filters.cycleScopeKind);
  }
  if (filters.q) {
    clauses.push(`(${alias}.task_code LIKE ? OR ${alias}.task_name LIKE ?)`);
    params.push(`%${filters.q}%`, `%${filters.q}%`);
  }
  return clauses.join(" AND ");
}

/**
 * List close task templates visible to one tenant.
 */
export async function listCloseTaskTemplates(filters = {}, actorCtx = {}) {
  const tenantId = parsePositiveInt(filters.tenantId || actorCtx.tenantId);
  const limit = Number(filters.limit || 100);
  const offset = Number(filters.offset || 0);
  const params = [];
  const where = appendTemplateFilters(
    {
      ...filters,
      tenantId,
      includeGlobal: filters.includeGlobal !== false,
    },
    params,
  );
  const result = await query(
    `SELECT ctt.*
     FROM close_task_templates ctt
     WHERE ${where}
     ORDER BY ctt.tenant_id IS NULL DESC, ctt.sort_order ASC, ctt.task_code ASC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return {
    rows: (result.rows || []).map(mapCloseTaskTemplateRow),
    limit,
    offset,
  };
}

/**
 * Load global and tenant templates, merging by task code with tenant rows
 * overriding global rows. `DISABLED` tenant rows are retained so callers can
 * suppress matching global defaults before filtering to active materialization.
 */
export async function loadMergedCloseTaskTemplates(
  { tenantId, statuses = null } = {},
  { runQuery = query } = {},
) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const params = [normalizedTenantId];
  const statusClause =
    Array.isArray(statuses) && statuses.length > 0
      ? ` AND ctt.status IN (${statuses.map(() => "?").join(", ")})`
      : "";
  if (Array.isArray(statuses) && statuses.length > 0) {
    params.push(...statuses.map((status) => normalizeCloseTaskTemplateStatus(status)));
  }
  const result = await runQuery(
    `SELECT ctt.*
     FROM close_task_templates ctt
     WHERE (ctt.tenant_id IS NULL OR ctt.tenant_id = ?)
       ${statusClause}
     ORDER BY ctt.task_code ASC, ctt.tenant_id IS NULL DESC`,
    params,
  );
  const byCode = new Map();
  for (const row of result.rows || []) {
    const code = String(row.task_code || "").trim().toUpperCase();
    if (!code) {
      continue;
    }
    const current = byCode.get(code);
    if (!current || (!row.tenant_id && current.tenant_id) || row.tenant_id) {
      byCode.set(code, row);
    }
  }
  return Array.from(byCode.values()).map(mapCloseTaskTemplateRow);
}

/**
 * Fetch one close task template by id within the tenant/global boundary.
 */
export async function getCloseTaskTemplateById(templateId, actorCtx = {}) {
  const tenantId = parsePositiveInt(actorCtx.tenantId);
  const result = await query(
    `SELECT *
     FROM close_task_templates
     WHERE id = ?
       AND (tenant_id IS NULL OR tenant_id = ?)
     LIMIT 1`,
    [parsePositiveInt(templateId), tenantId],
  );
  const row = result.rows?.[0] || null;
  if (!row) {
    throw notFound("Close task template not found");
  }
  return { row: mapCloseTaskTemplateRow(row) };
}

/**
 * Create a tenant-scoped close task template override/catalog row.
 */
export async function createCloseTaskTemplate(input = {}, actorCtx = {}) {
  const tenantId = parsePositiveInt(input.tenantId || actorCtx.tenantId);
  const userId = parsePositiveInt(input.userId || actorCtx.userId);
  return withTransaction(async (tx) => {
    await tx.query(
      `INSERT INTO close_task_templates (
         tenant_id,
         tenant_scope_key,
         task_code,
         task_name,
         task_description,
         task_family,
         cycle_scope_kind,
         default_rbac_scope_type,
         default_work_scope_type,
         anchor_item_type,
         materialization_mode,
         completion_mode,
         source_check_code,
         source_ref_type,
         source_ref_id_strategy,
         auto_complete_allowed,
         default_due_offset_days,
         evidence_required,
         required_for_cycle_lock,
         default_owner_strategy,
         default_reviewer_strategy,
         blocker_class,
         sort_order,
         status,
         config_json,
         created_by_user_id,
         updated_by_user_id
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        buildTenantScopeKey(tenantId),
        input.taskCode,
        input.taskName,
        input.taskDescription || null,
        input.taskFamily,
        input.cycleScopeKind,
        input.defaultRbacScopeType,
        input.defaultWorkScopeType,
        input.anchorItemType,
        input.materializationMode,
        input.completionMode,
        input.sourceCheckCode || null,
        input.sourceRefType || null,
        input.sourceRefIdStrategy || null,
        Boolean(input.autoCompleteAllowed),
        Number(input.defaultDueOffsetDays || 0),
        Boolean(input.evidenceRequired),
        Boolean(input.requiredForCycleLock),
        input.defaultOwnerStrategy,
        input.defaultReviewerStrategy,
        input.blockerClass || null,
        Number(input.sortOrder || 1000),
        input.status,
        serializeConfig(input.config),
        userId || null,
        userId || null,
      ],
    );
    const created = await tx.query(
      `SELECT *
       FROM close_task_templates
       WHERE tenant_scope_key = ?
         AND task_code = ?
       LIMIT 1`,
      [buildTenantScopeKey(tenantId), input.taskCode],
    );
    return { row: mapCloseTaskTemplateRow(created.rows?.[0]) };
  });
}

const TEMPLATE_PATCH_COLUMN_MAP = Object.freeze({
  taskName: "task_name",
  taskDescription: "task_description",
  taskFamily: "task_family",
  cycleScopeKind: "cycle_scope_kind",
  defaultRbacScopeType: "default_rbac_scope_type",
  defaultWorkScopeType: "default_work_scope_type",
  anchorItemType: "anchor_item_type",
  materializationMode: "materialization_mode",
  completionMode: "completion_mode",
  sourceCheckCode: "source_check_code",
  sourceRefType: "source_ref_type",
  sourceRefIdStrategy: "source_ref_id_strategy",
  autoCompleteAllowed: "auto_complete_allowed",
  defaultDueOffsetDays: "default_due_offset_days",
  evidenceRequired: "evidence_required",
  requiredForCycleLock: "required_for_cycle_lock",
  defaultOwnerStrategy: "default_owner_strategy",
  defaultReviewerStrategy: "default_reviewer_strategy",
  blockerClass: "blocker_class",
  sortOrder: "sort_order",
  status: "status",
  config: "config_json",
});

/**
 * Patch a tenant-owned close task template. Global shipped templates must be
 * overridden by tenant rows instead of being edited through this route.
 */
export async function updateCloseTaskTemplate(input = {}, actorCtx = {}) {
  const tenantId = parsePositiveInt(input.tenantId || actorCtx.tenantId);
  const userId = parsePositiveInt(input.userId || actorCtx.userId);
  const templateId = parsePositiveInt(input.templateId);
  return withTransaction(async (tx) => {
    const current = await tx.query(
      `SELECT *
       FROM close_task_templates
       WHERE id = ?
         AND tenant_id = ?
       LIMIT 1
       FOR UPDATE`,
      [templateId, tenantId],
    );
    if (!current.rows?.[0]) {
      throw notFound("Tenant close task template not found");
    }

    const assignments = [];
    const params = [];
    for (const [key, column] of Object.entries(TEMPLATE_PATCH_COLUMN_MAP)) {
      if (!Object.prototype.hasOwnProperty.call(input, key)) {
        continue;
      }
      assignments.push(`${column} = ?`);
      params.push(key === "config" ? serializeConfig(input[key]) : input[key]);
    }
    if (assignments.length === 0) {
      return { row: mapCloseTaskTemplateRow(current.rows[0]) };
    }
    assignments.push("updated_by_user_id = ?");
    params.push(userId || null, templateId, tenantId);
    await tx.query(
      `UPDATE close_task_templates
       SET ${assignments.join(", ")}
       WHERE id = ?
         AND tenant_id = ?`,
      params,
    );
    const updated = await tx.query(
      `SELECT *
       FROM close_task_templates
       WHERE id = ?
         AND tenant_id = ?
       LIMIT 1`,
      [templateId, tenantId],
    );
    return { row: mapCloseTaskTemplateRow(updated.rows?.[0]) };
  });
}

/**
 * Disable a tenant close task template so future materialization skips it.
 */
export async function disableCloseTaskTemplate(input = {}, actorCtx = {}) {
  return updateCloseTaskTemplate(
    {
      tenantId: input.tenantId,
      userId: input.userId,
      templateId: input.templateId,
      status: "DISABLED",
    },
    actorCtx,
  );
}
