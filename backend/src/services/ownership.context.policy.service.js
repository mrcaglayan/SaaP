import { badRequest, parsePositiveInt } from "../routes/_utils.js";

export const OWNERSHIP_CONTEXT_VALUES = Object.freeze([
  "CENTRAL",
  "OPERATING_UNIT",
]);

const OWNERSHIP_CONTEXT_SET = new Set(OWNERSHIP_CONTEXT_VALUES);

export const STOCK_IMPACT_MODE_NONE = "NONE";
export const STOCK_AFFECTING_LINE_MODE_VALUES = Object.freeze([
  "RECEIPT_PENDING",
  "ISSUE_PENDING",
]);
const STOCK_AFFECTING_LINE_MODE_SET = new Set(STOCK_AFFECTING_LINE_MODE_VALUES);

export const STOCK_IMPACT_MODE_VALUES = Object.freeze([
  STOCK_IMPACT_MODE_NONE,
  ...STOCK_AFFECTING_LINE_MODE_VALUES,
]);

export const TRANSFER_REQUIRED_QUEUE_STATE = "TRANSFER_REQUIRED";
export const TRANSFER_REQUIRED_QUEUE_STATE_DEFINITION =
  "TRANSFER_REQUIRED is an advisory queueState derived from a cross-context availability probe; it is not a persisted transfer relation on stock links.";

function toTrimmedText(value, maxLength = 255) {
  const normalized = String(value || "").trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

export function normalizeOwnershipContextScope(value, { fallback = null } = {}) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  if (!normalized) {
    return fallback;
  }
  return OWNERSHIP_CONTEXT_SET.has(normalized) ? normalized : null;
}

export function parseOwnershipContextOperatingUnitId(
  value,
  fieldName = "operatingUnitId"
) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = parsePositiveInt(value);
  if (!parsed) {
    throw badRequest(`${fieldName} must be a positive integer`);
  }
  return parsed;
}

export function normalizeOwnershipContextInput({
  ownershipScope,
  operatingUnitId,
  scopeFieldName = "ownershipScope",
  operatingUnitFieldName = "operatingUnitId",
  defaultOwnershipScope = "CENTRAL",
} = {}) {
  const normalizedOwnershipScope =
    normalizeOwnershipContextScope(ownershipScope, {
      fallback: defaultOwnershipScope,
    }) || null;
  if (!normalizedOwnershipScope) {
    throw badRequest(`${scopeFieldName} is invalid`);
  }
  const normalizedOperatingUnitId = parseOwnershipContextOperatingUnitId(
    operatingUnitId,
    operatingUnitFieldName
  );
  if (
    normalizedOwnershipScope === "CENTRAL" &&
    normalizedOperatingUnitId
  ) {
    throw badRequest(
      `${operatingUnitFieldName} must be empty when ${scopeFieldName}=CENTRAL`
    );
  }
  if (
    normalizedOwnershipScope === "OPERATING_UNIT" &&
    !normalizedOperatingUnitId
  ) {
    throw badRequest(
      `${operatingUnitFieldName} is required when ${scopeFieldName}=OPERATING_UNIT`
    );
  }
  return {
    ownershipScope: normalizedOwnershipScope,
    operatingUnitId:
      normalizedOwnershipScope === "OPERATING_UNIT"
        ? normalizedOperatingUnitId
        : null,
  };
}

export function buildOwnershipContext({
  ownershipScope,
  operatingUnitId,
  operatingUnitCode,
  operatingUnitName,
} = {}) {
  const normalizedOperatingUnitId = parsePositiveInt(operatingUnitId) || null;
  const normalizedOwnershipScope =
    normalizeOwnershipContextScope(ownershipScope) === "OPERATING_UNIT" &&
    normalizedOperatingUnitId
      ? "OPERATING_UNIT"
      : normalizedOperatingUnitId
        ? "OPERATING_UNIT"
        : "CENTRAL";
  return {
    ownershipScope: normalizedOwnershipScope,
    operatingUnitId:
      normalizedOwnershipScope === "OPERATING_UNIT"
        ? normalizedOperatingUnitId
        : null,
    operatingUnitCode:
      normalizedOwnershipScope === "OPERATING_UNIT"
        ? toTrimmedText(operatingUnitCode, 80)
        : null,
    operatingUnitName:
      normalizedOwnershipScope === "OPERATING_UNIT"
        ? toTrimmedText(operatingUnitName, 200)
        : null,
  };
}

export function deriveOwnershipContextFromOperatingUnitId(
  operatingUnitId,
  options = {}
) {
  return buildOwnershipContext({
    ownershipScope: operatingUnitId ? "OPERATING_UNIT" : "CENTRAL",
    operatingUnitId,
    operatingUnitCode: options.operatingUnitCode,
    operatingUnitName: options.operatingUnitName,
  });
}

export function deriveWarehouseOwnershipContext(row, options = {}) {
  return buildOwnershipContext({
    ownershipScope:
      row?.[options.ownershipScopeField || "ownership_scope"] ??
      row?.ownershipScope,
    operatingUnitId:
      row?.[options.operatingUnitIdField || "operating_unit_id"] ??
      row?.operatingUnitId,
    operatingUnitCode:
      row?.[options.operatingUnitCodeField || "operating_unit_code"] ??
      row?.operatingUnitCode,
    operatingUnitName:
      row?.[options.operatingUnitNameField || "operating_unit_name"] ??
      row?.operatingUnitName,
  });
}

export function deriveDocumentOwnershipContext(row, options = {}) {
  const operatingUnitId =
    row?.[options.operatingUnitIdField || "document_operating_unit_id"] ??
    row?.operatingUnitId;
  return deriveOwnershipContextFromOperatingUnitId(operatingUnitId, {
    operatingUnitCode:
      row?.[options.operatingUnitCodeField || "document_operating_unit_code"] ??
      row?.operatingUnitCode,
    operatingUnitName:
      row?.[options.operatingUnitNameField || "document_operating_unit_name"] ??
      row?.operatingUnitName,
  });
}

export function formatOwnershipContextLabel(context) {
  const normalizedContext = buildOwnershipContext(context);
  if (normalizedContext.ownershipScope !== "OPERATING_UNIT") {
    return "CENTRAL";
  }
  return `OPERATING_UNIT ${
    normalizedContext.operatingUnitCode ||
    normalizedContext.operatingUnitName ||
    `#${normalizedContext.operatingUnitId || "?"}`
  }`;
}

export function sameOwnershipContext(left, right) {
  const normalizedLeft = buildOwnershipContext(left);
  const normalizedRight = buildOwnershipContext(right);
  return (
    normalizedLeft.ownershipScope === normalizedRight.ownershipScope &&
    normalizedLeft.operatingUnitId === normalizedRight.operatingUnitId
  );
}

export function normalizeStockImpactMode(
  value,
  fallback = STOCK_IMPACT_MODE_NONE
) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  if (!normalized) {
    return fallback;
  }
  return STOCK_IMPACT_MODE_VALUES.includes(normalized) ? normalized : fallback;
}

export function isStockAffectingLineMode(value) {
  return STOCK_AFFECTING_LINE_MODE_SET.has(normalizeStockImpactMode(value));
}

export function isStockAffectingLine(line) {
  return isStockAffectingLineMode(
    line?.stockImpactMode ?? line?.stock_impact_mode
  );
}

export function isInventoryEnabledOwnershipContext({ lines } = {}) {
  return (Array.isArray(lines) ? lines : []).some((line) =>
    isStockAffectingLine(line)
  );
}

export function buildNoActiveWarehouseForOwnershipContextMessage(
  ownershipContext
) {
  return `No active warehouse exists for ownership context ${formatOwnershipContextLabel(
    ownershipContext
  )}.`;
}

export function buildWarehouseDoesNotBelongToOwnershipContextMessage({
  warehouseContext,
  ownershipContext,
  ownerLabel = "document",
} = {}) {
  const expectedLabel = formatOwnershipContextLabel(ownershipContext);
  const actualLabel = formatOwnershipContextLabel(warehouseContext);
  return `Warehouse does not belong to ownership context ${expectedLabel}. Warehouse context ${actualLabel} does not match ${ownerLabel} context ${expectedLabel}.`;
}

export function buildInsufficientAvailableStockInBoundWarehouseMessage({
  warehouseCode,
  warehouseName,
  warehouseId,
  itemCardCode,
  itemCardName,
  itemCardId,
  requestedQuantity,
  availableQuantity,
} = {}) {
  const warehouseLabel =
    toTrimmedText(warehouseCode, 80) ||
    toTrimmedText(warehouseName, 200) ||
    (parsePositiveInt(warehouseId) ? `#${parsePositiveInt(warehouseId)}` : "selected warehouse");
  const itemLabel =
    toTrimmedText(itemCardCode, 80) ||
    toTrimmedText(itemCardName, 200) ||
    (parsePositiveInt(itemCardId) ? `#${parsePositiveInt(itemCardId)}` : "selected item");
  return `Insufficient available stock in bound warehouse ${warehouseLabel} for item ${itemLabel}. Requested ${Number(
    requestedQuantity || 0
  )}, available ${Number(availableQuantity || 0)}.`;
}

export function buildTransferRequiredMessage({
  warehouseCode,
  warehouseName,
  warehouseId,
  itemCardCode,
  itemCardName,
  itemCardId,
  ownershipContext,
} = {}) {
  const warehouseLabel =
    toTrimmedText(warehouseCode, 80) ||
    toTrimmedText(warehouseName, 200) ||
    (parsePositiveInt(warehouseId) ? `#${parsePositiveInt(warehouseId)}` : "selected warehouse");
  const itemLabel =
    toTrimmedText(itemCardCode, 80) ||
    toTrimmedText(itemCardName, 200) ||
    (parsePositiveInt(itemCardId) ? `#${parsePositiveInt(itemCardId)}` : "selected item");
  return `Stock exists in another ownership context and transfer is required. Bound warehouse ${warehouseLabel} in ownership context ${formatOwnershipContextLabel(
    ownershipContext
  )} cannot satisfy item ${itemLabel}.`;
}

export function buildTransferWarehousesMustDifferMessage({
  sourceContext,
  targetContext,
} = {}) {
  const sourceLabel = formatOwnershipContextLabel(sourceContext);
  const targetLabel = formatOwnershipContextLabel(targetContext);
  if (sourceLabel === targetLabel) {
    return `sourceWarehouseId and targetWarehouseId must belong to different ownership contexts. Both warehouses resolve to ${sourceLabel}.`;
  }
  return `sourceWarehouseId and targetWarehouseId must belong to different ownership contexts. Source ${sourceLabel}, target ${targetLabel}.`;
}

export function assertWarehouseBelongsToOwnershipContext({
  warehouseRow,
  ownershipContext,
  ownershipContextRow,
  ownerLabel = "document",
} = {}) {
  const warehouseContext = deriveWarehouseOwnershipContext(warehouseRow);
  const expectedContext =
    ownershipContext || deriveDocumentOwnershipContext(ownershipContextRow);
  if (sameOwnershipContext(warehouseContext, expectedContext)) {
    return {
      warehouseContext,
      ownershipContext: expectedContext,
    };
  }
  throw badRequest(
    `${buildWarehouseDoesNotBelongToOwnershipContextMessage({
      warehouseContext,
      ownershipContext: expectedContext,
      ownerLabel,
    })} Cross-context stock movement must use inventory transfer workflow.`
  );
}
