import { query } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import { listCycleItems } from "./close.cycle-items.service.js";

const CLOSE_DEPENDENT_TARGET_TYPES = Object.freeze([
  "ITEM_ACTION",
  "CYCLE_ACTION",
]);

const CLOSE_DEPENDENT_ACTIONS = Object.freeze([
  "APPROVE",
  "LOCK",
  "FINALIZE",
]);

const DEPENDENCY_RULE_PERIOD_CLOSE_BEFORE_APPROVE =
  "PERIOD_CLOSE_COMPLETE_BEFORE_LOCAL_CLOSE_APPROVE";
const DEPENDENCY_RULE_PERIOD_CLOSE_BEFORE_LOCK =
  "PERIOD_CLOSE_COMPLETE_BEFORE_LOCAL_CLOSE_LOCK";
const DEPENDENCY_RULE_PERIOD_CLOSE_BEFORE_CYCLE_LOCK =
  "PERIOD_CLOSE_COMPLETE_BEFORE_CYCLE_LOCK";
const DEPENDENCY_RULE_LOCAL_CLOSE_BEFORE_CYCLE_LOCK =
  "LOCAL_CLOSE_LOCKED_BEFORE_CYCLE_LOCK";
const DEPENDENCY_RULE_LOCAL_CLOSE_BEFORE_CONSOLIDATION_FINALIZE =
  "LOCAL_CLOSE_LOCKED_BEFORE_CONSOLIDATION_FINALIZE";
const DEPENDENCY_RULE_LOCAL_CLOSE_BEFORE_CONSOLIDATION_LOCK =
  "LOCAL_CLOSE_LOCKED_BEFORE_CONSOLIDATION_LOCK";
const DEPENDENCY_RULE_CONSOLIDATION_BEFORE_CYCLE_LOCK =
  "CONSOLIDATION_LOCKED_BEFORE_CYCLE_LOCK";

function toUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function notFound(message) {
  const err = new Error(message);
  err.status = 404;
  return err;
}

function conflict(message, details = null, code = "CLOSE_CYCLE_CONFLICT") {
  const err = new Error(message);
  err.status = 409;
  err.code = code;
  if (details !== null && details !== undefined) {
    err.details = details;
  }
  return err;
}

function resolveActorTenantId(actorCtx = {}) {
  return parsePositiveInt(actorCtx?.tenantId);
}

function resolveActorRunQuery(actorCtx = {}) {
  return typeof actorCtx?.runQuery === "function" ? actorCtx.runQuery : query;
}

function normalizeDependentTargetType(value) {
  const normalized = toUpperText(value);
  if (!CLOSE_DEPENDENT_TARGET_TYPES.includes(normalized)) {
    throw badRequest(`Unsupported close dependency target type: ${value}`);
  }
  return normalized;
}

function normalizeDependentAction(value) {
  const normalized = toUpperText(value);
  if (!CLOSE_DEPENDENT_ACTIONS.includes(normalized)) {
    throw badRequest(`Unsupported close dependency action: ${value}`);
  }
  return normalized;
}

function mapDependencyRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: parsePositiveInt(row.id),
    closeCycleId: parsePositiveInt(row.close_cycle_id),
    blockingItemId: parsePositiveInt(row.blocking_item_id),
    dependentTargetType: toUpperText(row.dependent_target_type),
    dependentTargetKey: String(row.dependent_target_key || "").trim() || null,
    dependentItemId: parsePositiveInt(row.dependent_item_id),
    dependentAction: toUpperText(row.dependent_action),
    requiredBlockingStatus: toUpperText(row.required_blocking_status),
    dependencyCode: String(row.dependency_code || "").trim().toUpperCase() || null,
    createdAt: row.created_at || null,
    closeCycleFiscalPeriodId: parsePositiveInt(row.close_cycle_fiscal_period_id),
    blockingItemType: row.blocking_item_type ? toUpperText(row.blocking_item_type) : null,
    blockingItemKey: row.blocking_item_key || null,
    blockingItemBusinessStatus: row.blocking_item_business_status
      ? toUpperText(row.blocking_item_business_status)
      : null,
    blockingItemScopeType: row.blocking_item_scope_type
      ? toUpperText(row.blocking_item_scope_type)
      : null,
    blockingItemScopeId: parsePositiveInt(row.blocking_item_scope_id),
    blockingItemLegalEntityId: parsePositiveInt(row.blocking_item_legal_entity_id),
    blockingItemOperatingUnitId: parsePositiveInt(row.blocking_item_operating_unit_id),
    blockingItemBookId: parsePositiveInt(row.blocking_item_book_id),
    blockingItemConsolidationGroupId: parsePositiveInt(row.blocking_item_consolidation_group_id),
    blockingItemRunName: row.blocking_item_run_name
      ? toUpperText(row.blocking_item_run_name)
      : null,
    blockingItemOwnerUserId: parsePositiveInt(row.blocking_item_owner_user_id),
    blockingItemDueAt: row.blocking_item_due_at || null,
    blockingItemCurrentSourceTargetType: row.blocking_item_current_source_target_type
      ? toUpperText(row.blocking_item_current_source_target_type)
      : null,
    blockingItemCurrentSourceTargetId: parsePositiveInt(row.blocking_item_current_source_target_id),
    dependentItemType: row.dependent_item_type ? toUpperText(row.dependent_item_type) : null,
    dependentItemKey: row.dependent_item_key || null,
    dependentItemScopeType: row.dependent_item_scope_type
      ? toUpperText(row.dependent_item_scope_type)
      : null,
  };
}

function buildDependencySelect(whereSql = "1 = 1") {
  return `SELECT
      ccd.*,
      cc.fiscal_period_id AS close_cycle_fiscal_period_id,
      bi.item_type AS blocking_item_type,
      bi.item_key AS blocking_item_key,
      bi.business_status AS blocking_item_business_status,
      bi.scope_type AS blocking_item_scope_type,
      bi.scope_id AS blocking_item_scope_id,
      bi.legal_entity_id AS blocking_item_legal_entity_id,
      bi.operating_unit_id AS blocking_item_operating_unit_id,
      bi.book_id AS blocking_item_book_id,
      bi.consolidation_group_id AS blocking_item_consolidation_group_id,
      bi.run_name AS blocking_item_run_name,
      bi.owner_user_id AS blocking_item_owner_user_id,
      bi.due_at AS blocking_item_due_at,
      bil.source_target_type AS blocking_item_current_source_target_type,
      bil.source_target_id AS blocking_item_current_source_target_id,
      di.item_type AS dependent_item_type,
      di.item_key AS dependent_item_key,
      di.scope_type AS dependent_item_scope_type
    FROM close_cycle_dependencies ccd
    JOIN close_cycles cc ON cc.id = ccd.close_cycle_id
    JOIN close_cycle_items bi ON bi.id = ccd.blocking_item_id
    LEFT JOIN close_cycle_item_links bil
      ON bil.close_cycle_item_id = bi.id
     AND bil.is_current = TRUE
    LEFT JOIN close_cycle_items di ON di.id = ccd.dependent_item_id
    WHERE ${whereSql}`;
}

async function loadCloseCycleRow({
  tenantId,
  cycleId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT id, tenant_id, scope_kind, status
     FROM close_cycles
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, cycleId]
  );
  return result.rows?.[0] || null;
}

function buildDependencyInput({
  closeCycleId,
  blockingItemId,
  dependentTargetType,
  dependentItemId = null,
  dependentAction,
  requiredBlockingStatus,
  dependencyCode,
}) {
  const normalizedDependentTargetType = normalizeDependentTargetType(dependentTargetType);
  const normalizedDependentItemId = parsePositiveInt(dependentItemId) || null;
  const normalizedDependentAction = normalizeDependentAction(dependentAction);
  return {
    closeCycleId: parsePositiveInt(closeCycleId),
    blockingItemId: parsePositiveInt(blockingItemId),
    dependentTargetType: normalizedDependentTargetType,
    dependentTargetKey:
      normalizedDependentTargetType === "ITEM_ACTION"
        ? `ITEM_ACTION:${Number(normalizedDependentItemId || 0)}:${normalizedDependentAction}`
        : `CYCLE_ACTION:${normalizedDependentAction}`,
    dependentItemId: normalizedDependentItemId,
    dependentAction: normalizedDependentAction,
    requiredBlockingStatus: toUpperText(requiredBlockingStatus),
    dependencyCode: toUpperText(dependencyCode),
  };
}

async function insertDependencyRow(input, runQuery = query) {
  const dependency = buildDependencyInput(input);
  const result = await runQuery(
    `INSERT IGNORE INTO close_cycle_dependencies (
        close_cycle_id,
        blocking_item_id,
        dependent_target_type,
        dependent_target_key,
        dependent_item_id,
        dependent_action,
        required_blocking_status,
        dependency_code
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      dependency.closeCycleId,
      dependency.blockingItemId,
      dependency.dependentTargetType,
      dependency.dependentTargetKey,
      dependency.dependentItemId,
      dependency.dependentAction,
      dependency.requiredBlockingStatus,
      dependency.dependencyCode,
    ]
  );
  return Number(result.rows?.affectedRows || 0);
}

function indexCycleItems(items = []) {
  const periodCloseByBookId = new Map();
  const localCloseItems = [];
  const consolidationItems = [];

  for (const item of items) {
    if (item.itemType === "PERIOD_CLOSE_RUN" && item.bookId) {
      periodCloseByBookId.set(item.bookId, item);
      continue;
    }
    if (item.itemType === "LOCAL_CLOSE_PACK") {
      localCloseItems.push(item);
      continue;
    }
    if (item.itemType === "CONSOLIDATION_RUN") {
      consolidationItems.push(item);
    }
  }

  return {
    periodCloseByBookId,
    localCloseItems,
    consolidationItems,
  };
}

function buildCycleDependencyPlan(cycle, items = []) {
  const indexedItems = indexCycleItems(items);
  const plannedRows = [];

  for (const localCloseItem of indexedItems.localCloseItems) {
    const periodCloseItem = indexedItems.periodCloseByBookId.get(
      parsePositiveInt(localCloseItem.bookId)
    );
    if (!periodCloseItem) {
      throw conflict(
        "Local close pack dependency wiring failed because its expected period-close item is missing",
        {
          closeCycleId: parsePositiveInt(cycle?.id),
          closeCycleItemId: parsePositiveInt(localCloseItem.id),
          bookId: parsePositiveInt(localCloseItem.bookId),
        },
        "CLOSE_CYCLE_DEPENDENCY_WIRING_CONFLICT"
      );
    }

    plannedRows.push(
      buildDependencyInput({
        closeCycleId: cycle.id,
        blockingItemId: periodCloseItem.id,
        dependentTargetType: "ITEM_ACTION",
        dependentItemId: localCloseItem.id,
        dependentAction: "APPROVE",
        requiredBlockingStatus: "COMPLETED",
        dependencyCode: DEPENDENCY_RULE_PERIOD_CLOSE_BEFORE_APPROVE,
      }),
      buildDependencyInput({
        closeCycleId: cycle.id,
        blockingItemId: periodCloseItem.id,
        dependentTargetType: "ITEM_ACTION",
        dependentItemId: localCloseItem.id,
        dependentAction: "LOCK",
        requiredBlockingStatus: "COMPLETED",
        dependencyCode: DEPENDENCY_RULE_PERIOD_CLOSE_BEFORE_LOCK,
      })
    );
  }

  for (const periodCloseItem of indexedItems.periodCloseByBookId.values()) {
    plannedRows.push(
      buildDependencyInput({
        closeCycleId: cycle.id,
        blockingItemId: periodCloseItem.id,
        dependentTargetType: "CYCLE_ACTION",
        dependentItemId: null,
        dependentAction: "LOCK",
        requiredBlockingStatus: "COMPLETED",
        dependencyCode: DEPENDENCY_RULE_PERIOD_CLOSE_BEFORE_CYCLE_LOCK,
      })
    );
  }

  for (const localCloseItem of indexedItems.localCloseItems) {
    plannedRows.push(
      buildDependencyInput({
        closeCycleId: cycle.id,
        blockingItemId: localCloseItem.id,
        dependentTargetType: "CYCLE_ACTION",
        dependentItemId: null,
        dependentAction: "LOCK",
        requiredBlockingStatus: "LOCKED",
        dependencyCode: DEPENDENCY_RULE_LOCAL_CLOSE_BEFORE_CYCLE_LOCK,
      })
    );
  }

  if (cycle?.scope_kind === "CONSOLIDATION_GROUP") {
    if (indexedItems.consolidationItems.length !== 1) {
      throw conflict(
        "Consolidation-group cycle dependency wiring requires exactly one provisioned consolidation item",
        {
          closeCycleId: parsePositiveInt(cycle?.id),
          consolidationItemCount: indexedItems.consolidationItems.length,
        },
        "CLOSE_CYCLE_DEPENDENCY_WIRING_CONFLICT"
      );
    }

    const consolidationItem = indexedItems.consolidationItems[0];
    for (const localCloseItem of indexedItems.localCloseItems) {
      // Dependencies stay item-to-item so multi-book group close later enforces
      // the exact provisioned participant graph instead of rediscovering it.
      plannedRows.push(
        buildDependencyInput({
          closeCycleId: cycle.id,
          blockingItemId: localCloseItem.id,
          dependentTargetType: "ITEM_ACTION",
          dependentItemId: consolidationItem.id,
          dependentAction: "FINALIZE",
          requiredBlockingStatus: "LOCKED",
          dependencyCode: DEPENDENCY_RULE_LOCAL_CLOSE_BEFORE_CONSOLIDATION_FINALIZE,
        }),
        buildDependencyInput({
          closeCycleId: cycle.id,
          blockingItemId: localCloseItem.id,
          dependentTargetType: "ITEM_ACTION",
          dependentItemId: consolidationItem.id,
          dependentAction: "LOCK",
          requiredBlockingStatus: "LOCKED",
          dependencyCode: DEPENDENCY_RULE_LOCAL_CLOSE_BEFORE_CONSOLIDATION_LOCK,
        })
      );
    }

    plannedRows.push(
      buildDependencyInput({
        closeCycleId: cycle.id,
        blockingItemId: consolidationItem.id,
        dependentTargetType: "CYCLE_ACTION",
        dependentItemId: null,
        dependentAction: "LOCK",
        requiredBlockingStatus: "LOCKED",
        dependencyCode: DEPENDENCY_RULE_CONSOLIDATION_BEFORE_CYCLE_LOCK,
      })
    );
  }

  return plannedRows;
}

/**
 * Read all registered dependency rows for one close cycle, including the
 * blocking-item context used later for cockpit and hard-enforcement payloads.
 */
export async function listCycleDependencies(cycleId, filters = {}, actorCtx = {}) {
  const tenantId = resolveActorTenantId(actorCtx);
  const runQuery = resolveActorRunQuery(actorCtx);
  const normalizedCycleId = parsePositiveInt(cycleId);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  if (!normalizedCycleId) {
    throw badRequest("cycleId must be a positive integer");
  }

  const where = ["cc.tenant_id = ?", "ccd.close_cycle_id = ?"];
  const params = [tenantId, normalizedCycleId];
  if (filters?.dependentTargetType) {
    where.push("ccd.dependent_target_type = ?");
    params.push(normalizeDependentTargetType(filters.dependentTargetType));
  }
  if (filters?.dependentAction) {
    where.push("ccd.dependent_action = ?");
    params.push(normalizeDependentAction(filters.dependentAction));
  }
  if (filters?.dependentItemId) {
    where.push("ccd.dependent_item_id = ?");
    params.push(parsePositiveInt(filters.dependentItemId));
  }

  const result = await runQuery(
    `${buildDependencySelect(where.join(" AND "))}
     ORDER BY ccd.id ASC`,
    params
  );
  return {
    rows: (result.rows || []).map(mapDependencyRow),
  };
}

/**
 * Register the initial explicit dependency graph for a provisioned close cycle.
 * The insert path is idempotent so it can safely run after provision and repair.
 */
export async function registerCycleDependencies(cycleId, actorCtx = {}) {
  const tenantId = resolveActorTenantId(actorCtx);
  const runQuery = resolveActorRunQuery(actorCtx);
  const normalizedCycleId = parsePositiveInt(cycleId);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  if (!normalizedCycleId) {
    throw badRequest("cycleId must be a positive integer");
  }

  const cycle = await loadCloseCycleRow({
    tenantId,
    cycleId: normalizedCycleId,
    runQuery,
  });
  if (!cycle) {
    throw notFound("Close cycle not found");
  }

  const itemResult = await listCycleItems(normalizedCycleId, {}, {
    tenantId,
    runQuery,
  });
  const items = itemResult.rows || [];
  const plannedRows = buildCycleDependencyPlan(cycle, items);
  const createdByCode = {};
  let createdCount = 0;

  for (const dependency of plannedRows) {
    // eslint-disable-next-line no-await-in-loop
    const affectedRows = await insertDependencyRow(dependency, runQuery);
    createdCount += affectedRows;
    if (affectedRows > 0) {
      const dependencyCode = String(dependency.dependencyCode || "").trim().toUpperCase();
      createdByCode[dependencyCode] = Number(createdByCode[dependencyCode] || 0) + affectedRows;
    }
  }

  return {
    closeCycleId: normalizedCycleId,
    createdCount,
    totalCount: plannedRows.length,
    createdByCode,
  };
}

/**
 * Re-run dependency wiring for an already-provisioned cycle without inventing
 * new rules. PR-02a uses the same idempotent registration path for sync.
 */
export async function syncCycleDependencies(cycleId, actorCtx = {}) {
  return registerCycleDependencies(cycleId, actorCtx);
}

/**
 * Read unresolved dependency rows for one item action. These are evaluation
 * rows only in PR-02a and do not hard-block writes until PR-02b.
 */
export async function listUnresolvedDependenciesForItemAction(
  {
    closeCycleItemId,
    action,
  },
  actorCtx = {}
) {
  const tenantId = resolveActorTenantId(actorCtx);
  const runQuery = resolveActorRunQuery(actorCtx);
  const normalizedCloseCycleItemId = parsePositiveInt(closeCycleItemId);
  const normalizedAction = normalizeDependentAction(action);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  if (!normalizedCloseCycleItemId) {
    throw badRequest("closeCycleItemId must be a positive integer");
  }

  const result = await runQuery(
    `${buildDependencySelect(
      `cc.tenant_id = ?
       AND ccd.dependent_target_type = 'ITEM_ACTION'
       AND ccd.dependent_item_id = ?
       AND ccd.dependent_action = ?
       AND UPPER(COALESCE(bi.business_status, '')) <> ccd.required_blocking_status`
    )}
     ORDER BY ccd.id ASC`,
    [tenantId, normalizedCloseCycleItemId, normalizedAction]
  );

  return (result.rows || []).map(mapDependencyRow);
}

/**
 * Read unresolved dependency rows for one cycle-level action such as the
 * future cycle lock operation.
 */
export async function listUnresolvedDependenciesForCycleAction(
  {
    closeCycleId,
    action,
  },
  actorCtx = {}
) {
  const tenantId = resolveActorTenantId(actorCtx);
  const runQuery = resolveActorRunQuery(actorCtx);
  const normalizedCloseCycleId = parsePositiveInt(closeCycleId);
  const normalizedAction = normalizeDependentAction(action);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  if (!normalizedCloseCycleId) {
    throw badRequest("closeCycleId must be a positive integer");
  }

  const result = await runQuery(
    `${buildDependencySelect(
      `cc.tenant_id = ?
       AND ccd.close_cycle_id = ?
       AND ccd.dependent_target_type = 'CYCLE_ACTION'
       AND ccd.dependent_action = ?
       AND UPPER(COALESCE(bi.business_status, '')) <> ccd.required_blocking_status`
    )}
     ORDER BY ccd.id ASC`,
    [tenantId, normalizedCloseCycleId, normalizedAction]
  );

  return (result.rows || []).map(mapDependencyRow);
}

/**
 * Read every unresolved dependency row for one cycle so cockpit pages can show
 * visibility before hard enforcement goes live.
 */
export async function listUnresolvedDependenciesForCycle(cycleId, actorCtx = {}) {
  const tenantId = resolveActorTenantId(actorCtx);
  const runQuery = resolveActorRunQuery(actorCtx);
  const normalizedCycleId = parsePositiveInt(cycleId);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  if (!normalizedCycleId) {
    throw badRequest("cycleId must be a positive integer");
  }

  const result = await runQuery(
    `${buildDependencySelect(
      `cc.tenant_id = ?
       AND ccd.close_cycle_id = ?
       AND UPPER(COALESCE(bi.business_status, '')) <> ccd.required_blocking_status`
    )}
     ORDER BY ccd.dependent_target_type ASC, ccd.dependent_action ASC, ccd.id ASC`,
    [tenantId, normalizedCycleId]
  );

  return {
    rows: (result.rows || []).map(mapDependencyRow),
  };
}

export {
  CLOSE_DEPENDENT_TARGET_TYPES,
  CLOSE_DEPENDENT_ACTIONS,
  DEPENDENCY_RULE_PERIOD_CLOSE_BEFORE_APPROVE,
  DEPENDENCY_RULE_PERIOD_CLOSE_BEFORE_LOCK,
  DEPENDENCY_RULE_PERIOD_CLOSE_BEFORE_CYCLE_LOCK,
  DEPENDENCY_RULE_LOCAL_CLOSE_BEFORE_CYCLE_LOCK,
  DEPENDENCY_RULE_LOCAL_CLOSE_BEFORE_CONSOLIDATION_FINALIZE,
  DEPENDENCY_RULE_LOCAL_CLOSE_BEFORE_CONSOLIDATION_LOCK,
  DEPENDENCY_RULE_CONSOLIDATION_BEFORE_CYCLE_LOCK,
};

export default {
  listCycleDependencies,
  registerCycleDependencies,
  syncCycleDependencies,
  listUnresolvedDependenciesForItemAction,
  listUnresolvedDependenciesForCycleAction,
  listUnresolvedDependenciesForCycle,
};
