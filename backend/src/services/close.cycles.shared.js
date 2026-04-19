const CLOSE_CYCLE_TYPES = Object.freeze([
  "MONTH_END",
  "QUARTER_END",
  "YEAR_END",
]);

const CLOSE_CYCLE_SCOPE_KINDS = Object.freeze([
  "LEGAL_ENTITY",
  "CONSOLIDATION_GROUP",
]);

const CLOSE_CYCLE_STATUS_VALUES = Object.freeze([
  "PLANNED",
  "OPEN",
  "LOCKED",
  "IN_REVIEW",
  "CLOSED",
  "REOPENED",
]);

const CLOSE_CYCLE_ITEM_TYPES = Object.freeze([
  "PERIOD_CLOSE_RUN",
  "LOCAL_CLOSE_PACK",
  "CONSOLIDATION_RUN",
]);

const CLOSE_CYCLE_ITEM_SCOPE_TYPES = Object.freeze([
  "BOOK",
  "CENTRAL",
  "OPERATING_UNIT",
  "CONSOLIDATION_GROUP",
]);

const CLOSE_CYCLE_ITEM_BUSINESS_STATUS_VALUES = Object.freeze([
  "NOT_STARTED",
  "NOT_OPENED",
  "OPEN",
  "IN_PROGRESS",
  "READY_FOR_REVIEW",
  "RETURNED",
  "APPROVED",
  "LOCKED",
  "REOPENED",
  "SUPERSEDED",
  "DRAFT",
  "COMPLETED",
  "FAILED",
]);

const CLOSE_CYCLE_ITEM_STALE_STATUS_VALUES = Object.freeze([
  "FRESH",
  "STALE",
  "STALE_REVIEW_REQUIRED",
  "FINALIZED_BUT_OUTDATED",
]);

const CLOSE_CYCLE_SOURCE_TARGET_TYPES = Object.freeze([
  "LOCAL_CLOSE_PACK",
  "PERIOD_CLOSE_RUN",
  "CONSOLIDATION_RUN",
]);

export const OFFICIAL_CONSOLIDATION_RUN_NAME = "OFFICIAL";

function toUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

/**
 * Build the canonical scope key persisted on close_cycles rows.
 */
export function buildCloseCycleScopeKey({
  scopeKind,
  legalEntityId = null,
  consolidationGroupId = null,
}) {
  const normalizedScopeKind = toUpperText(scopeKind);
  if (normalizedScopeKind === "LEGAL_ENTITY") {
    return `LEGAL_ENTITY:${Number(legalEntityId || 0)}`;
  }
  if (normalizedScopeKind === "CONSOLIDATION_GROUP") {
    return `CONSOLIDATION_GROUP:${Number(consolidationGroupId || 0)}`;
  }
  return "";
}

/**
 * Build the canonical close-cycle item identity persisted on close_cycle_items.
 */
export function buildCloseCycleItemKey({
  itemType,
  scopeType = null,
  bookId = null,
  operatingUnitId = null,
  consolidationGroupId = null,
  runName = null,
}) {
  const normalizedItemType = toUpperText(itemType);
  const normalizedScopeType = toUpperText(scopeType);
  if (normalizedItemType === "PERIOD_CLOSE_RUN") {
    return `PERIOD_CLOSE_RUN:BOOK:${Number(bookId || 0)}`;
  }
  if (normalizedItemType === "LOCAL_CLOSE_PACK") {
    if (normalizedScopeType === "CENTRAL") {
      return `LOCAL_CLOSE_PACK:BOOK:${Number(bookId || 0)}:CENTRAL`;
    }
    if (normalizedScopeType === "OPERATING_UNIT") {
      return `LOCAL_CLOSE_PACK:BOOK:${Number(bookId || 0)}:OPERATING_UNIT:${Number(
        operatingUnitId || 0
      )}`;
    }
  }
  if (normalizedItemType === "CONSOLIDATION_RUN") {
    return `CONSOLIDATION_RUN:CONSOLIDATION_GROUP:${Number(
      consolidationGroupId || 0
    )}:RUN_NAME:${toUpperText(runName)}`;
  }
  return "";
}

/**
 * Derive the scope_id persisted on close_cycle_items from the item dimensions.
 */
export function buildCloseCycleItemScopeId({
  scopeType,
  bookId = null,
  legalEntityId = null,
  operatingUnitId = null,
  consolidationGroupId = null,
}) {
  const normalizedScopeType = toUpperText(scopeType);
  if (normalizedScopeType === "BOOK") {
    return Number(bookId || 0) || null;
  }
  if (normalizedScopeType === "CENTRAL") {
    return Number(legalEntityId || 0) || null;
  }
  if (normalizedScopeType === "OPERATING_UNIT") {
    return Number(operatingUnitId || 0) || null;
  }
  if (normalizedScopeType === "CONSOLIDATION_GROUP") {
    return Number(consolidationGroupId || 0) || null;
  }
  return null;
}

/**
 * Resolve the native RBAC scope represented by one close-cycle row.
 */
export function resolveCloseCycleRowScope(row) {
  const scopeKind = toUpperText(row?.scope_kind ?? row?.scopeKind);
  const legalEntityId = Number(row?.legal_entity_id ?? row?.legalEntityId ?? 0);
  const groupCompanyId = Number(row?.group_company_id ?? row?.groupCompanyId ?? 0);

  if (scopeKind === "LEGAL_ENTITY" && legalEntityId > 0) {
    return {
      scopeType: "LEGAL_ENTITY",
      scopeId: legalEntityId,
      scopeKind: "legal_entity",
    };
  }
  if (scopeKind === "CONSOLIDATION_GROUP" && groupCompanyId > 0) {
    return {
      scopeType: "GROUP",
      scopeId: groupCompanyId,
      scopeKind: "group",
    };
  }
  return null;
}

export {
  CLOSE_CYCLE_TYPES,
  CLOSE_CYCLE_SCOPE_KINDS,
  CLOSE_CYCLE_STATUS_VALUES,
  CLOSE_CYCLE_ITEM_TYPES,
  CLOSE_CYCLE_ITEM_SCOPE_TYPES,
  CLOSE_CYCLE_ITEM_BUSINESS_STATUS_VALUES,
  CLOSE_CYCLE_ITEM_STALE_STATUS_VALUES,
  CLOSE_CYCLE_SOURCE_TARGET_TYPES,
};
