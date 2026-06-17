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

export const CLOSE_TASK_DEFAULT_TEMPLATE_DEFINITIONS = Object.freeze([
  Object.freeze({
    taskCode: "BANK_RECON_COMPLETED",
    taskName: "Bank reconciliation completed",
    taskDescription: "Confirm bank reconciliation readiness for the local close pack.",
    taskFamily: "RECONCILIATION",
    cycleScopeKind: "ANY",
    defaultRbacScopeType: "LEGAL_ENTITY",
    defaultWorkScopeType: "LOCAL_CLOSE_PACK",
    anchorItemType: "LOCAL_CLOSE_PACK",
    materializationMode: "ITEM",
    completionMode: "HYBRID_REVIEW",
    sourceCheckCode: "BANK_RECON_COMPLETED",
    sourceRefType: "LOCAL_CLOSE_PACK",
    sourceRefIdStrategy: "CURRENT_ITEM_SOURCE_TARGET",
    autoCompleteAllowed: false,
    defaultDueOffsetDays: 0,
    evidenceRequired: false,
    requiredForCycleLock: false,
    defaultOwnerStrategy: "LOCAL_CLOSE_PACK_OWNER",
    defaultReviewerStrategy: "CYCLE_OWNER",
    blockerClass: "BANK_RECONCILIATION",
    sortOrder: 100,
    status: "ACTIVE",
  }),
  Object.freeze({
    taskCode: "CASH_RECON_COMPLETED",
    taskName: "Cash reconciliation completed",
    taskDescription: "Confirm cash reconciliation readiness for the local close pack.",
    taskFamily: "RECONCILIATION",
    cycleScopeKind: "ANY",
    defaultRbacScopeType: "LEGAL_ENTITY",
    defaultWorkScopeType: "LOCAL_CLOSE_PACK",
    anchorItemType: "LOCAL_CLOSE_PACK",
    materializationMode: "ITEM",
    completionMode: "HYBRID_REVIEW",
    sourceCheckCode: "CASH_RECON_COMPLETED",
    sourceRefType: "LOCAL_CLOSE_PACK",
    sourceRefIdStrategy: "CURRENT_ITEM_SOURCE_TARGET",
    autoCompleteAllowed: false,
    defaultDueOffsetDays: 0,
    evidenceRequired: false,
    requiredForCycleLock: false,
    defaultOwnerStrategy: "LOCAL_CLOSE_PACK_OWNER",
    defaultReviewerStrategy: "CYCLE_OWNER",
    blockerClass: "CASH_RECONCILIATION",
    sortOrder: 110,
    status: "ACTIVE",
  }),
  Object.freeze({
    taskCode: "INVENTORY_NEGATIVE_STOCK_CHECK",
    taskName: "Inventory negative stock check passed",
    taskDescription: "Confirm that negative inventory stock checks are cleared.",
    taskFamily: "INVENTORY",
    cycleScopeKind: "ANY",
    defaultRbacScopeType: "OPERATING_UNIT",
    defaultWorkScopeType: "OPERATING_UNIT",
    anchorItemType: "LOCAL_CLOSE_PACK",
    materializationMode: "ITEM",
    completionMode: "SYSTEM_CHECK",
    sourceCheckCode: "INVENTORY_NEGATIVE_STOCK_CHECK",
    sourceRefType: "LOCAL_CLOSE_PACK",
    sourceRefIdStrategy: "CURRENT_ITEM_SOURCE_TARGET",
    autoCompleteAllowed: false,
    defaultDueOffsetDays: 0,
    evidenceRequired: false,
    requiredForCycleLock: false,
    defaultOwnerStrategy: "ITEM_OWNER",
    defaultReviewerStrategy: "CYCLE_OWNER",
    blockerClass: "INVENTORY",
    sortOrder: 120,
    status: "ACTIVE",
  }),
  Object.freeze({
    taskCode: "AP_UNPOSTED_CLEARED",
    taskName: "AP unposted documents cleared",
    taskDescription: "Confirm that AP unposted documents have been cleared.",
    taskFamily: "SUBLEDGER",
    cycleScopeKind: "ANY",
    defaultRbacScopeType: "LEGAL_ENTITY",
    defaultWorkScopeType: "BOOK",
    anchorItemType: "PERIOD_CLOSE_RUN",
    materializationMode: "ITEM",
    completionMode: "HYBRID_REVIEW",
    sourceCheckCode: "AP_UNPOSTED_CLEARED",
    sourceRefType: null,
    sourceRefIdStrategy: null,
    autoCompleteAllowed: false,
    defaultDueOffsetDays: 0,
    evidenceRequired: false,
    requiredForCycleLock: false,
    defaultOwnerStrategy: "ITEM_OWNER",
    defaultReviewerStrategy: "CYCLE_OWNER",
    blockerClass: "AP",
    sortOrder: 130,
    status: "ACTIVE",
  }),
  Object.freeze({
    taskCode: "AR_AGING_REVIEWED",
    taskName: "AR aging reviewed",
    taskDescription: "Confirm that AR aging has been reviewed for the close book.",
    taskFamily: "SUBLEDGER",
    cycleScopeKind: "ANY",
    defaultRbacScopeType: "LEGAL_ENTITY",
    defaultWorkScopeType: "BOOK",
    anchorItemType: "PERIOD_CLOSE_RUN",
    materializationMode: "ITEM",
    completionMode: "HYBRID_REVIEW",
    sourceCheckCode: "AR_AGING_REVIEWED",
    sourceRefType: null,
    sourceRefIdStrategy: null,
    autoCompleteAllowed: false,
    defaultDueOffsetDays: 0,
    evidenceRequired: false,
    requiredForCycleLock: false,
    defaultOwnerStrategy: "ITEM_OWNER",
    defaultReviewerStrategy: "CYCLE_OWNER",
    blockerClass: "AR",
    sortOrder: 140,
    status: "ACTIVE",
  }),
  Object.freeze({
    taskCode: "PAYROLL_POSTED",
    taskName: "Payroll posted",
    taskDescription: "Confirm that payroll postings are completed for the close book.",
    taskFamily: "PAYROLL",
    cycleScopeKind: "ANY",
    defaultRbacScopeType: "LEGAL_ENTITY",
    defaultWorkScopeType: "BOOK",
    anchorItemType: "PERIOD_CLOSE_RUN",
    materializationMode: "ITEM",
    completionMode: "HYBRID_REVIEW",
    sourceCheckCode: "PAYROLL_POSTED",
    sourceRefType: null,
    sourceRefIdStrategy: null,
    autoCompleteAllowed: false,
    defaultDueOffsetDays: 0,
    evidenceRequired: false,
    requiredForCycleLock: false,
    defaultOwnerStrategy: "ITEM_OWNER",
    defaultReviewerStrategy: "CYCLE_OWNER",
    blockerClass: "PAYROLL",
    sortOrder: 150,
    status: "ACTIVE",
  }),
  Object.freeze({
    taskCode: "IC_133_333_MATCHED",
    taskName: "Intercompany 133/333 matched",
    taskDescription: "Confirm that intercompany 133/333 balances are matched.",
    taskFamily: "INTERCOMPANY",
    cycleScopeKind: "CONSOLIDATION_GROUP",
    defaultRbacScopeType: "GROUP",
    defaultWorkScopeType: "CONSOLIDATION_GROUP",
    anchorItemType: "ANY",
    materializationMode: "CYCLE",
    completionMode: "HYBRID_REVIEW",
    sourceCheckCode: "IC_133_333_MATCHED",
    sourceRefType: null,
    sourceRefIdStrategy: null,
    autoCompleteAllowed: false,
    defaultDueOffsetDays: 0,
    evidenceRequired: false,
    requiredForCycleLock: false,
    defaultOwnerStrategy: "CYCLE_OWNER",
    defaultReviewerStrategy: "CYCLE_OWNER",
    blockerClass: "INTERCOMPANY",
    sortOrder: 160,
    status: "ACTIVE",
  }),
  Object.freeze({
    taskCode: "FX_RATES_ENTERED",
    taskName: "FX rates entered",
    taskDescription: "Confirm that required FX rates are entered for the close cycle.",
    taskFamily: "FX",
    cycleScopeKind: "ANY",
    defaultRbacScopeType: "GROUP",
    defaultWorkScopeType: "CYCLE",
    anchorItemType: "ANY",
    materializationMode: "CYCLE",
    completionMode: "HYBRID_REVIEW",
    sourceCheckCode: "FX_RATES_ENTERED",
    sourceRefType: null,
    sourceRefIdStrategy: null,
    autoCompleteAllowed: false,
    defaultDueOffsetDays: 0,
    evidenceRequired: false,
    requiredForCycleLock: false,
    defaultOwnerStrategy: "CYCLE_OWNER",
    defaultReviewerStrategy: "CYCLE_OWNER",
    blockerClass: "FX",
    sortOrder: 170,
    status: "ACTIVE",
  }),
  Object.freeze({
    taskCode: "DEPRECIATION_POSTED",
    taskName: "Depreciation posted",
    taskDescription: "Confirm that depreciation postings are completed for the close book.",
    taskFamily: "FIXED_ASSET",
    cycleScopeKind: "ANY",
    defaultRbacScopeType: "LEGAL_ENTITY",
    defaultWorkScopeType: "BOOK",
    anchorItemType: "PERIOD_CLOSE_RUN",
    materializationMode: "ITEM",
    completionMode: "HYBRID_REVIEW",
    sourceCheckCode: "DEPRECIATION_POSTED",
    sourceRefType: null,
    sourceRefIdStrategy: null,
    autoCompleteAllowed: false,
    defaultDueOffsetDays: 0,
    evidenceRequired: false,
    requiredForCycleLock: false,
    defaultOwnerStrategy: "ITEM_OWNER",
    defaultReviewerStrategy: "CYCLE_OWNER",
    blockerClass: "FIXED_ASSET",
    sortOrder: 180,
    status: "ACTIVE",
  }),
  Object.freeze({
    taskCode: "TRIAL_BALANCE_REVIEWED",
    taskName: "Trial balance reviewed",
    taskDescription: "Confirm that the close book trial balance has been reviewed.",
    taskFamily: "REPORTING",
    cycleScopeKind: "ANY",
    defaultRbacScopeType: "LEGAL_ENTITY",
    defaultWorkScopeType: "BOOK",
    anchorItemType: "PERIOD_CLOSE_RUN",
    materializationMode: "ITEM",
    completionMode: "HYBRID_REVIEW",
    sourceCheckCode: "TRIAL_BALANCE_REVIEWED",
    sourceRefType: null,
    sourceRefIdStrategy: null,
    autoCompleteAllowed: false,
    defaultDueOffsetDays: 0,
    evidenceRequired: false,
    requiredForCycleLock: false,
    defaultOwnerStrategy: "ITEM_OWNER",
    defaultReviewerStrategy: "CYCLE_OWNER",
    blockerClass: "TRIAL_BALANCE",
    sortOrder: 190,
    status: "ACTIVE",
  }),
  Object.freeze({
    taskCode: "ENTITY_CLOSE_CERTIFIED",
    taskName: "Entity close certified",
    taskDescription: "Capture entity close certification evidence for the cycle.",
    taskFamily: "CERTIFICATION",
    cycleScopeKind: "LEGAL_ENTITY",
    defaultRbacScopeType: "LEGAL_ENTITY",
    defaultWorkScopeType: "CENTRAL",
    anchorItemType: "ANY",
    materializationMode: "CYCLE",
    completionMode: "MANUAL_WITH_EVIDENCE",
    sourceCheckCode: null,
    sourceRefType: null,
    sourceRefIdStrategy: null,
    autoCompleteAllowed: false,
    defaultDueOffsetDays: 0,
    evidenceRequired: true,
    requiredForCycleLock: false,
    defaultOwnerStrategy: "CYCLE_OWNER",
    defaultReviewerStrategy: "CYCLE_OWNER",
    blockerClass: "CERTIFICATION",
    sortOrder: 200,
    status: "ACTIVE",
  }),
]);

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
 * Merge template rows by `task_code`, keeping tenant rows over global rows so
 * tenant PAUSED/DISABLED overrides suppress shipped defaults during provisioning.
 */
export function mergeCloseTaskTemplatesByCode(rows = []) {
  const byCode = new Map();
  for (const row of rows || []) {
    const code = String(row?.task_code ?? row?.taskCode ?? "")
      .trim()
      .toUpperCase();
    if (!code) {
      continue;
    }
    const tenantId = parsePositiveInt(row?.tenant_id ?? row?.tenantId);
    const current = byCode.get(code);
    if (!current || tenantId) {
      byCode.set(code, row);
    }
  }
  return Array.from(byCode.values());
}

/**
 * Seed or refresh the global close checklist templates shipped with SAAP.
 * Tenant-specific rows remain untouched and can override or disable any code.
 */
export async function upsertDefaultCloseTaskTemplates({ runQuery = query } = {}) {
  let upsertedCount = 0;
  for (const definition of CLOSE_TASK_DEFAULT_TEMPLATE_DEFINITIONS) {
    // Keep shipped templates centrally managed; tenants customize by creating
    // tenant-scope overrides with the same task_code.
    // eslint-disable-next-line no-await-in-loop
    await runQuery(
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
       VALUES (
         NULL, 'GLOBAL', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL
       )
       ON DUPLICATE KEY UPDATE
         task_name = VALUES(task_name),
         task_description = VALUES(task_description),
         task_family = VALUES(task_family),
         cycle_scope_kind = VALUES(cycle_scope_kind),
         default_rbac_scope_type = VALUES(default_rbac_scope_type),
         default_work_scope_type = VALUES(default_work_scope_type),
         anchor_item_type = VALUES(anchor_item_type),
         materialization_mode = VALUES(materialization_mode),
         completion_mode = VALUES(completion_mode),
         source_check_code = VALUES(source_check_code),
         source_ref_type = VALUES(source_ref_type),
         source_ref_id_strategy = VALUES(source_ref_id_strategy),
         auto_complete_allowed = VALUES(auto_complete_allowed),
         default_due_offset_days = VALUES(default_due_offset_days),
         evidence_required = VALUES(evidence_required),
         required_for_cycle_lock = VALUES(required_for_cycle_lock),
         default_owner_strategy = VALUES(default_owner_strategy),
         default_reviewer_strategy = VALUES(default_reviewer_strategy),
         blocker_class = VALUES(blocker_class),
         sort_order = VALUES(sort_order),
         status = VALUES(status),
         config_json = VALUES(config_json),
         updated_by_user_id = NULL`,
      [
        definition.taskCode,
        definition.taskName,
        definition.taskDescription || null,
        definition.taskFamily,
        definition.cycleScopeKind,
        definition.defaultRbacScopeType,
        definition.defaultWorkScopeType,
        definition.anchorItemType,
        definition.materializationMode,
        definition.completionMode,
        definition.sourceCheckCode || null,
        definition.sourceRefType || null,
        definition.sourceRefIdStrategy || null,
        Boolean(definition.autoCompleteAllowed),
        Number(definition.defaultDueOffsetDays || 0),
        Boolean(definition.evidenceRequired),
        Boolean(definition.requiredForCycleLock),
        definition.defaultOwnerStrategy,
        definition.defaultReviewerStrategy,
        definition.blockerClass || null,
        Number(definition.sortOrder || 1000),
        definition.status || "ACTIVE",
        serializeConfig({ shippedDefault: true }),
      ],
    );
    upsertedCount += 1;
  }

  return {
    upsertedCount,
    taskCodes: CLOSE_TASK_DEFAULT_TEMPLATE_DEFINITIONS.map((definition) => definition.taskCode),
  };
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
  return mergeCloseTaskTemplatesByCode(result.rows || []).map(mapCloseTaskTemplateRow);
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
