import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import { composeCloseBlockers } from "./close.blocker-composer.service.js";
import { findCurrentCycleItemsBySource } from "./close.cycle-items.service.js";
import {
  listUnresolvedDependenciesForCycle,
  listUnresolvedDependenciesForCycleAction,
  listUnresolvedDependenciesForItemAction,
} from "./close.dependencies.service.js";

function toUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function buildLocalCloseWorkspacePath({
  legalEntityId,
  bookId = null,
  fiscalPeriodId = null,
}) {
  const searchParams = new URLSearchParams();
  if (parsePositiveInt(legalEntityId)) {
    searchParams.set("legalEntityId", String(parsePositiveInt(legalEntityId)));
  }
  if (parsePositiveInt(bookId)) {
    searchParams.set("bookId", String(parsePositiveInt(bookId)));
  }
  if (parsePositiveInt(fiscalPeriodId)) {
    searchParams.set("fiscalPeriodId", String(parsePositiveInt(fiscalPeriodId)));
  }
  const queryString = searchParams.toString();
  return `/app/donem-sonu-islemler/yillik/yerel-kapanis-paketleri${
    queryString ? `?${queryString}` : ""
  }`;
}

function buildLocalClosePackPath(packId) {
  return `/app/donem-sonu-islemler/yillik/yerel-kapanis-paketleri/${packId}`;
}

function buildPeriodClosePath({
  legalEntityId,
  bookId = null,
  fiscalPeriodId = null,
}) {
  const searchParams = new URLSearchParams();
  if (parsePositiveInt(legalEntityId)) {
    searchParams.set("legalEntityId", String(parsePositiveInt(legalEntityId)));
  }
  if (parsePositiveInt(bookId)) {
    searchParams.set("bookId", String(parsePositiveInt(bookId)));
  }
  if (parsePositiveInt(fiscalPeriodId)) {
    searchParams.set("fiscalPeriodId", String(parsePositiveInt(fiscalPeriodId)));
  }
  const queryString = searchParams.toString();
  return `/app/donem-sonu-islemler/yillik/kapanis-islemleri${
    queryString ? `?${queryString}` : ""
  }`;
}

function buildConsolidationRunPath({
  consolidationGroupId,
  runId = null,
}) {
  const searchParams = new URLSearchParams();
  if (parsePositiveInt(consolidationGroupId)) {
    searchParams.set("consolidationGroupId", String(parsePositiveInt(consolidationGroupId)));
  }
  if (parsePositiveInt(runId)) {
    searchParams.set("runId", String(parsePositiveInt(runId)));
  }
  const queryString = searchParams.toString();
  return `/app/donem-sonu-islemler/yillik/konsolidasyon-raporlari${
    queryString ? `?${queryString}` : ""
  }`;
}

function formatBlockingAction(requiredBlockingStatus) {
  const normalizedStatus = toUpperText(requiredBlockingStatus);
  if (normalizedStatus === "COMPLETED") {
    return "COMPLETE";
  }
  if (normalizedStatus === "LOCKED") {
    return "LOCK";
  }
  if (normalizedStatus === "APPROVED") {
    return "APPROVE";
  }
  return normalizedStatus || null;
}

function buildDependencyMessage(row) {
  const dependentAction = String(row?.dependentAction || "").trim().toLowerCase() || "continue";
  const requiredBlockingStatus = toUpperText(row?.requiredBlockingStatus);
  const blockingItemType = toUpperText(row?.blockingItemType);

  if (blockingItemType === "PERIOD_CLOSE_RUN") {
    return `Period close must be ${requiredBlockingStatus} before the dependent close step can ${dependentAction}`;
  }
  if (blockingItemType === "LOCAL_CLOSE_PACK") {
    return `Local close pack must be ${requiredBlockingStatus} before the dependent close step can ${dependentAction}`;
  }
  if (blockingItemType === "CONSOLIDATION_RUN") {
    return `Consolidation run must be ${requiredBlockingStatus} before the close cycle can ${dependentAction}`;
  }
  return `Close dependency remains unresolved because the blocking item is ${toUpperText(
    row?.blockingItemBusinessStatus
  )} instead of ${requiredBlockingStatus}`;
}

function buildDependencyDrillPath(row) {
  const blockingItemType = toUpperText(row?.blockingItemType);
  if (blockingItemType === "LOCAL_CLOSE_PACK") {
    if (parsePositiveInt(row?.blockingItemCurrentSourceTargetId)) {
      return buildLocalClosePackPath(row.blockingItemCurrentSourceTargetId);
    }
    return buildLocalCloseWorkspacePath({
      legalEntityId: row?.blockingItemLegalEntityId,
      bookId: row?.blockingItemBookId,
      fiscalPeriodId: row?.closeCycleFiscalPeriodId,
    });
  }
  if (blockingItemType === "PERIOD_CLOSE_RUN") {
    return buildPeriodClosePath({
      legalEntityId: row?.blockingItemLegalEntityId,
      bookId: row?.blockingItemBookId,
      fiscalPeriodId: row?.closeCycleFiscalPeriodId,
    });
  }
  if (blockingItemType === "CONSOLIDATION_RUN") {
    return buildConsolidationRunPath({
      consolidationGroupId: row?.blockingItemConsolidationGroupId,
      runId: row?.blockingItemCurrentSourceTargetId,
    });
  }
  return null;
}

function mapDependencyBlockerRow(row) {
  return {
    code: String(row?.dependencyCode || "").trim().toUpperCase() || "CLOSE_DEPENDENCY_UNRESOLVED",
    message: buildDependencyMessage(row),
    severity: "HIGH",
    blockingItemType: row?.blockingItemType || null,
    blockingItemId: parsePositiveInt(row?.blockingItemId),
    blockingAction: formatBlockingAction(row?.requiredBlockingStatus),
    owner: parsePositiveInt(row?.blockingItemOwnerUserId)
      ? { userId: parsePositiveInt(row.blockingItemOwnerUserId) }
      : null,
    dueDate: row?.blockingItemDueAt || null,
    firstBlockedAt: row?.createdAt || null,
    drillPath: buildDependencyDrillPath(row),
    dependency: {
      closeCycleId: parsePositiveInt(row?.closeCycleId),
      dependentTargetType: row?.dependentTargetType || null,
      dependentItemId: parsePositiveInt(row?.dependentItemId),
      dependentAction: row?.dependentAction || null,
      requiredBlockingStatus: row?.requiredBlockingStatus || null,
      blockingItemBusinessStatus: row?.blockingItemBusinessStatus || null,
    },
  };
}

/**
 * Read unresolved dependency blockers for one close-cycle item action using the
 * standard blocker payload shape defined for cockpit and future enforcement.
 */
export async function listItemActionDependencyBlockers(
  {
    closeCycleItemId,
    action,
  },
  actorCtx = {}
) {
  if (!parsePositiveInt(closeCycleItemId)) {
    throw badRequest("closeCycleItemId must be a positive integer");
  }
  const rows = await listUnresolvedDependenciesForItemAction(
    {
      closeCycleItemId,
      action,
    },
    actorCtx
  );
  return rows.map(mapDependencyBlockerRow);
}

/**
 * Read unresolved dependency blockers for one cycle-level action such as the
 * later cycle lock path.
 */
export async function listCycleActionDependencyBlockers(
  {
    closeCycleId,
    action,
  },
  actorCtx = {}
) {
  if (!parsePositiveInt(closeCycleId)) {
    throw badRequest("closeCycleId must be a positive integer");
  }
  const rows = await listUnresolvedDependenciesForCycleAction(
    {
      closeCycleId,
      action,
    },
    actorCtx
  );
  return rows.map(mapDependencyBlockerRow);
}

/**
 * Read every unresolved dependency blocker for one cycle so PR-03 cockpit work
 * can reuse the same standard dependency payload.
 */
export async function listCycleDependencyBlockers(cycleId, actorCtx = {}) {
  if (!parsePositiveInt(cycleId)) {
    throw badRequest("cycleId must be a positive integer");
  }
  const result = await listUnresolvedDependenciesForCycle(cycleId, actorCtx);
  return {
    rows: (result.rows || []).map(mapDependencyBlockerRow),
  };
}

/**
 * Read unresolved dependency blockers for one live source action across every
 * current close-cycle item that shares the same source object.
 */
export async function listSourceActionDependencyBlockers(
  {
    sourceTargetType,
    sourceTargetId,
    action,
  },
  actorCtx = {}
) {
  const normalizedSourceTargetId = parsePositiveInt(sourceTargetId);
  if (!normalizedSourceTargetId) {
    throw badRequest("sourceTargetId must be a positive integer");
  }

  const currentItems = await findCurrentCycleItemsBySource(
    sourceTargetType,
    normalizedSourceTargetId,
    actorCtx
  );
  const blockerRows = [];

  for (const item of currentItems) {
    // One official source row can participate in multiple active cycles, so
    // PR-02b must enforce every linked dependency graph, not just the first.
    // eslint-disable-next-line no-await-in-loop
    const itemRows = await listItemActionDependencyBlockers(
      {
        closeCycleItemId: item.id,
        action,
      },
      actorCtx
    );
    blockerRows.push(...itemRows);
  }

  return {
    closeCycleItemCount: currentItems.length,
    closeCycleIds: [...new Set(currentItems.map((item) => item.closeCycleId).filter(Boolean))],
    rows: composeCloseBlockers({
      dependencyBlockers: blockerRows,
    }),
  };
}

export default {
  listItemActionDependencyBlockers,
  listCycleActionDependencyBlockers,
  listCycleDependencyBlockers,
  listSourceActionDependencyBlockers,
};
