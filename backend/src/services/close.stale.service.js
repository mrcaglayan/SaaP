import { query } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import {
  findCurrentCycleItemsBySource,
  listCycleItems,
  setItemStaleStatus,
} from "./close.cycle-items.service.js";
import { listCycleDependencies } from "./close.dependencies.service.js";
import { CLOSE_CYCLE_ITEM_STALE_STATUS_VALUES } from "./close.cycles.shared.js";

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

function buildIdPlaceholders(ids = []) {
  return ids.map(() => "?").join(", ");
}

function normalizeTargetStaleStatus(status) {
  const normalized = toUpperText(status);
  if (!CLOSE_CYCLE_ITEM_STALE_STATUS_VALUES.includes(normalized)) {
    throw badRequest(`Unsupported stale status: ${status}`);
  }
  return normalized;
}

function mapCloseStaleEventRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: parsePositiveInt(row.id),
    closeCycleId: parsePositiveInt(row.close_cycle_id),
    closeCycleItemId: parsePositiveInt(row.close_cycle_item_id),
    sourceTargetType: row.source_target_type ? toUpperText(row.source_target_type) : null,
    sourceTargetId: parsePositiveInt(row.source_target_id),
    eventCode: String(row.event_code || "").trim().toUpperCase() || null,
    targetStaleStatus: toUpperText(row.target_stale_status),
    payload: row.payload_json ?? null,
    createdByUserId: parsePositiveInt(row.created_by_user_id),
    createdAt: row.created_at || null,
  };
}

function stalePriority(status) {
  const normalized = toUpperText(status);
  if (normalized === "FINALIZED_BUT_OUTDATED") {
    return 3;
  }
  if (normalized === "STALE_REVIEW_REQUIRED") {
    return 2;
  }
  if (normalized === "STALE") {
    return 1;
  }
  return 0;
}

function chooseMoreSevereStaleStatus(currentStatus, nextStatus) {
  return stalePriority(nextStatus) > stalePriority(currentStatus)
    ? normalizeTargetStaleStatus(nextStatus)
    : normalizeTargetStaleStatus(currentStatus || "FRESH");
}

function derivePropagatedStaleStatus(item) {
  const itemType = toUpperText(item?.itemType);
  const businessStatus = toUpperText(item?.businessStatus);

  // Locked consolidation is the most finalized downstream surface in the
  // current rollout, so reopen-driven drift gets the strongest stale signal.
  if (itemType === "CONSOLIDATION_RUN" && businessStatus === "LOCKED") {
    return "FINALIZED_BUT_OUTDATED";
  }

  if (["LOCKED", "APPROVED", "COMPLETED", "READY_FOR_REVIEW"].includes(businessStatus)) {
    return "STALE_REVIEW_REQUIRED";
  }

  return "STALE";
}

/**
 * Persist one stale-event foundation row. PR-02a records the schema and write
 * seam only; actual stale propagation hooks arrive later in the rollout.
 */
export async function recordCloseStaleEvent(input, actorCtx = {}) {
  const tenantId = resolveActorTenantId(actorCtx);
  const userId = resolveActorUserId(actorCtx);
  const runQuery = resolveActorRunQuery(actorCtx);
  const closeCycleId = parsePositiveInt(input?.closeCycleId);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  if (!closeCycleId) {
    throw badRequest("closeCycleId is required");
  }

  const insertResult = await runQuery(
    `INSERT INTO close_stale_events (
        close_cycle_id,
        close_cycle_item_id,
        source_target_type,
        source_target_id,
        event_code,
        target_stale_status,
        payload_json,
        created_by_user_id
     )
     SELECT
       ?,
       ?,
       ?,
       ?,
       ?,
       ?,
       ?,
       ?
     FROM close_cycles cc
     WHERE cc.id = ?
       AND cc.tenant_id = ?`,
    [
      closeCycleId,
      parsePositiveInt(input?.closeCycleItemId) || null,
      input?.sourceTargetType ? toUpperText(input.sourceTargetType) : null,
      parsePositiveInt(input?.sourceTargetId) || null,
      String(input?.eventCode || "").trim().toUpperCase() || "STALE_EVENT",
      normalizeTargetStaleStatus(input?.targetStaleStatus),
      input?.payload === undefined ? null : JSON.stringify(input.payload),
      userId || null,
      closeCycleId,
      tenantId,
    ]
  );

  const insertedId = parsePositiveInt(insertResult.rows?.insertId);
  if (!insertedId) {
    throw badRequest("Close cycle not found for stale event");
  }

  const result = await runQuery(
    `SELECT *
     FROM close_stale_events
     WHERE id = ?
     LIMIT 1`,
    [insertedId]
  );
  return mapCloseStaleEventRow(result.rows?.[0] || null);
}

/**
 * Read recorded stale-event foundation rows for one tenant and, optionally,
 * one close cycle or item.
 */
export async function listCloseStaleEvents(filters = {}, actorCtx = {}) {
  const tenantId = resolveActorTenantId(actorCtx);
  const runQuery = resolveActorRunQuery(actorCtx);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }

  const where = ["cc.tenant_id = ?"];
  const params = [tenantId];
  if (filters?.closeCycleId) {
    where.push("cse.close_cycle_id = ?");
    params.push(parsePositiveInt(filters.closeCycleId));
  }
  if (filters?.closeCycleItemId) {
    where.push("cse.close_cycle_item_id = ?");
    params.push(parsePositiveInt(filters.closeCycleItemId));
  }
  if (filters?.sourceTargetType) {
    where.push("cse.source_target_type = ?");
    params.push(toUpperText(filters.sourceTargetType));
  }
  if (filters?.sourceTargetId) {
    where.push("cse.source_target_id = ?");
    params.push(parsePositiveInt(filters.sourceTargetId));
  }
  if (filters?.eventCode) {
    where.push("cse.event_code = ?");
    params.push(String(filters.eventCode).trim().toUpperCase());
  }

  const result = await runQuery(
    `SELECT cse.*
     FROM close_stale_events cse
     JOIN close_cycles cc ON cc.id = cse.close_cycle_id
     WHERE ${where.join(" AND ")}
     ORDER BY cse.created_at DESC, cse.id DESC`,
    params
  );

  return {
    rows: (result.rows || []).map(mapCloseStaleEventRow),
  };
}

/**
 * Read the latest stale-event row per close-cycle item so PR-05 can show one
 * current stale explanation beside each affected work item.
 */
export async function listLatestCloseStaleEvents(filters = {}, actorCtx = {}) {
  const tenantId = resolveActorTenantId(actorCtx);
  const runQuery = resolveActorRunQuery(actorCtx);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }

  const where = ["cc.tenant_id = ?", "cse.close_cycle_item_id IS NOT NULL"];
  const params = [tenantId];
  if (filters?.closeCycleId) {
    where.push("cse.close_cycle_id = ?");
    params.push(parsePositiveInt(filters.closeCycleId));
  }
  const closeCycleItemIds = Array.isArray(filters?.closeCycleItemIds)
    ? filters.closeCycleItemIds.map((value) => parsePositiveInt(value)).filter(Boolean)
    : [];
  if (closeCycleItemIds.length > 0) {
    where.push(
      `cse.close_cycle_item_id IN (${buildIdPlaceholders(closeCycleItemIds)})`
    );
    params.push(...closeCycleItemIds);
  }

  const result = await runQuery(
    `SELECT cse.*
     FROM close_stale_events cse
     JOIN close_cycles cc ON cc.id = cse.close_cycle_id
     WHERE ${where.join(" AND ")}
     ORDER BY cse.created_at DESC, cse.id DESC`,
    params
  );

  const latestRowsByItemId = new Map();
  for (const row of result.rows || []) {
    const mappedRow = mapCloseStaleEventRow(row);
    const closeCycleItemId = parsePositiveInt(mappedRow?.closeCycleItemId);
    if (!closeCycleItemId || latestRowsByItemId.has(closeCycleItemId)) {
      continue;
    }
    latestRowsByItemId.set(closeCycleItemId, mappedRow);
  }

  return {
    rows: [...latestRowsByItemId.values()],
  };
}

/**
 * Propagate downstream stale flags through the registered close dependency
 * graph after an upstream official source row is reopened or otherwise
 * invalidated. PR-02b records the history row and updates stale_status, but it
 * does not yet hard-block downstream actions on stale alone.
 */
export async function propagateStaleFromSourceEvent(input, actorCtx = {}) {
  const tenantId = resolveActorTenantId(actorCtx);
  const runQuery = resolveActorRunQuery(actorCtx);
  const normalizedSourceTargetId = parsePositiveInt(input?.sourceTargetId);
  const eventCode = String(input?.eventCode || "").trim().toUpperCase() || "STALE_EVENT";
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  if (!normalizedSourceTargetId) {
    throw badRequest("sourceTargetId is required");
  }

  const sourceItems = await findCurrentCycleItemsBySource(
    input?.sourceTargetType,
    normalizedSourceTargetId,
    {
      ...actorCtx,
      runQuery,
    }
  );
  if (!sourceItems.length) {
    return {
      sourceTargetType: input?.sourceTargetType || null,
      sourceTargetId: normalizedSourceTargetId,
      affectedItemCount: 0,
      eventCount: 0,
      rows: [],
    };
  }

  const itemsByCycleId = new Map();
  for (const sourceItem of sourceItems) {
    const cycleId = parsePositiveInt(sourceItem.closeCycleId);
    if (!cycleId || itemsByCycleId.has(cycleId)) {
      continue;
    }
    // Reuse the existing item/dependency seams so stale propagation follows
    // the same explicit graph the cycle already registered.
    // eslint-disable-next-line no-await-in-loop
    const [dependencyResult, itemResult] = await Promise.all([
      listCycleDependencies(cycleId, {}, { ...actorCtx, tenantId, runQuery }),
      listCycleItems(cycleId, {}, { ...actorCtx, tenantId, runQuery }),
    ]);
    itemsByCycleId.set(cycleId, {
      dependencyRows: dependencyResult.rows || [],
      itemRows: itemResult.rows || [],
    });
  }

  const touchedItemIds = new Set();
  const eventRows = [];

  for (const sourceItem of sourceItems) {
    const cycleId = parsePositiveInt(sourceItem.closeCycleId);
    const cycleState = itemsByCycleId.get(cycleId);
    if (!cycleState) {
      continue;
    }

    const itemById = new Map(
      (cycleState.itemRows || []).map((row) => [parsePositiveInt(row.id), row])
    );
    const dependencyRowsByBlockingItemId = new Map();
    for (const dependencyRow of cycleState.dependencyRows || []) {
      const blockingItemId = parsePositiveInt(dependencyRow.blockingItemId);
      const dependentItemId = parsePositiveInt(dependencyRow.dependentItemId);
      if (!blockingItemId || !dependentItemId) {
        continue;
      }
      const existing = dependencyRowsByBlockingItemId.get(blockingItemId) || [];
      existing.push(dependentItemId);
      dependencyRowsByBlockingItemId.set(blockingItemId, existing);
    }

    const visitedItemIds = new Set([parsePositiveInt(sourceItem.id)]);
    const queue = [parsePositiveInt(sourceItem.id)];
    while (queue.length > 0) {
      const blockingItemId = queue.shift();
      for (const dependentItemId of dependencyRowsByBlockingItemId.get(blockingItemId) || []) {
        if (!dependentItemId || visitedItemIds.has(dependentItemId)) {
          continue;
        }
        visitedItemIds.add(dependentItemId);
        queue.push(dependentItemId);

        const dependentItem = itemById.get(dependentItemId);
        if (!dependentItem) {
          continue;
        }

        const propagatedStatus = derivePropagatedStaleStatus(dependentItem);
        const nextStaleStatus = chooseMoreSevereStaleStatus(
          dependentItem.staleStatus,
          propagatedStatus
        );
        // eslint-disable-next-line no-await-in-loop
        const updatedItem = await setItemStaleStatus(dependentItemId, nextStaleStatus, {
          ...actorCtx,
          tenantId,
          runQuery,
        });
        // eslint-disable-next-line no-await-in-loop
        const eventRow = await recordCloseStaleEvent(
          {
            closeCycleId: cycleId,
            closeCycleItemId: dependentItemId,
            sourceTargetType: input?.sourceTargetType,
            sourceTargetId: normalizedSourceTargetId,
            eventCode,
            targetStaleStatus: nextStaleStatus,
            payload: {
              sourceCloseCycleItemId: parsePositiveInt(sourceItem.id),
              previousStaleStatus: dependentItem.staleStatus || "FRESH",
              appliedStaleStatus: nextStaleStatus,
              itemType: dependentItem.itemType || null,
              businessStatus: dependentItem.businessStatus || null,
              triggerPayload: input?.payload ?? null,
            },
          },
          {
            ...actorCtx,
            tenantId,
            runQuery,
          }
        );
        if (!touchedItemIds.has(dependentItemId)) {
          touchedItemIds.add(dependentItemId);
        }
        eventRows.push({
          event: eventRow,
          item: updatedItem,
        });
      }
    }
  }

  return {
    sourceTargetType: input?.sourceTargetType || null,
    sourceTargetId: normalizedSourceTargetId,
    affectedItemCount: touchedItemIds.size,
    eventCount: eventRows.length,
    rows: eventRows,
  };
}

export default {
  recordCloseStaleEvent,
  listCloseStaleEvents,
  listLatestCloseStaleEvents,
  propagateStaleFromSourceEvent,
};
