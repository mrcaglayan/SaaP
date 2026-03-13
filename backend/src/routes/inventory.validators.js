import { badRequest, parsePositiveInt, resolveTenantId } from "./_utils.js";
import { requireUserId } from "./cash.validators.common.js";

const WAREHOUSE_STATUS_VALUES = ["ACTIVE", "INACTIVE"];
const WAREHOUSE_OWNERSHIP_SCOPE_VALUES = ["CENTRAL", "OPERATING_UNIT"];
const STOCK_LINK_STATUS_VALUES = ["PENDING", "LINKED", "VOID"];
const STOCK_IMPACT_MODE_VALUES = ["RECEIPT_PENDING", "ISSUE_PENDING"];
const MOVEMENT_TYPE_VALUES = ["RECEIPT", "ISSUE", "ADJUSTMENT_IN", "ADJUSTMENT_OUT"];
const VALUATION_STATUS_VALUES = ["NOT_REQUIRED", "PENDING", "VALUED"];
const LAYER_STATUS_VALUES = ["OPEN", "CLOSED"];

function requireTenantId(req) {
  const tenantId = resolveTenantId(req);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  return tenantId;
}

function normalizeShortText(value, fieldName, maxLength, { required = false } = {}) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    if (required) {
      throw badRequest(`${fieldName} is required`);
    }
    return null;
  }
  if (normalized.length > maxLength) {
    throw badRequest(`${fieldName} cannot exceed ${maxLength} characters`);
  }
  return normalized;
}

function normalizeEnum(value, fieldName, allowedValues, { required = false } = {}) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  if (!normalized) {
    if (required) {
      throw badRequest(`${fieldName} is required`);
    }
    return null;
  }
  if (!allowedValues.includes(normalized)) {
    throw badRequest(`${fieldName} is invalid`);
  }
  return normalized;
}

function normalizeOptionalPositiveInt(value, fieldName) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = parsePositiveInt(value);
  if (!parsed) {
    throw badRequest(`${fieldName} must be a positive integer`);
  }
  return parsed;
}

function parseLimit(value, fallback = 100) {
  const parsed = parsePositiveInt(value);
  return parsed ? Math.min(parsed, 500) : fallback;
}

function parseOffset(value) {
  if (value === undefined || value === null || value === "") {
    return 0;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw badRequest("offset must be a non-negative integer");
  }
  return parsed;
}

function parseOptionalDate(value, fieldName) {
  if (value === undefined) {
    return null;
  }
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw badRequest(`${fieldName} is required`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw badRequest(`${fieldName} must be YYYY-MM-DD`);
  }
  return normalized;
}

export function parseInventoryWarehouseListFilters(req) {
  return {
    tenantId: requireTenantId(req),
    legalEntityId: normalizeOptionalPositiveInt(req.query?.legalEntityId, "legalEntityId"),
    ownershipScope:
      normalizeEnum(
        req.query?.ownershipScope,
        "ownershipScope",
        WAREHOUSE_OWNERSHIP_SCOPE_VALUES
      ) || null,
    operatingUnitId: normalizeOptionalPositiveInt(req.query?.operatingUnitId, "operatingUnitId"),
    status: normalizeEnum(req.query?.status, "status", WAREHOUSE_STATUS_VALUES) || null,
    q: normalizeShortText(req.query?.q, "q", 120) || "",
    limit: parseLimit(req.query?.limit, 200),
    offset: parseOffset(req.query?.offset),
  };
}

export function parseInventoryWarehouseCreateInput(req) {
  const ownershipScope =
    normalizeEnum(
      req.body?.ownershipScope ?? "CENTRAL",
      "ownershipScope",
      WAREHOUSE_OWNERSHIP_SCOPE_VALUES,
      { required: true }
    ) || "CENTRAL";
  const operatingUnitId = normalizeOptionalPositiveInt(
    req.body?.operatingUnitId,
    "operatingUnitId"
  );
  if (ownershipScope === "CENTRAL" && operatingUnitId) {
    throw badRequest("operatingUnitId must be empty when ownershipScope=CENTRAL");
  }
  if (ownershipScope === "OPERATING_UNIT" && !operatingUnitId) {
    throw badRequest("operatingUnitId is required when ownershipScope=OPERATING_UNIT");
  }
  return {
    tenantId: requireTenantId(req),
    userId: requireUserId(req),
    legalEntityId: normalizeOptionalPositiveInt(req.body?.legalEntityId, "legalEntityId"),
    ownershipScope,
    operatingUnitId,
    code: normalizeShortText(req.body?.code, "code", 80, { required: true }).toUpperCase(),
    name: normalizeShortText(req.body?.name, "name", 200, { required: true }),
    status:
      normalizeEnum(req.body?.status ?? "ACTIVE", "status", WAREHOUSE_STATUS_VALUES, {
        required: true,
      }) || "ACTIVE",
    notes: normalizeShortText(req.body?.notes, "notes", 255) || null,
  };
}

export function parseInventoryStockLinkListFilters(req) {
  const linkedRaw = String(req.query?.warehouseLinked ?? "").trim().toLowerCase();
  return {
    tenantId: requireTenantId(req),
    legalEntityId: normalizeOptionalPositiveInt(req.query?.legalEntityId, "legalEntityId"),
    linkStatus:
      normalizeEnum(
        req.query?.linkStatus ?? req.query?.status ?? "PENDING",
        "linkStatus",
        STOCK_LINK_STATUS_VALUES,
        { required: true }
      ) || "PENDING",
    stockImpactMode:
      normalizeEnum(
        req.query?.stockImpactMode ?? req.query?.stock_impact_mode,
        "stockImpactMode",
        STOCK_IMPACT_MODE_VALUES
      ) || null,
    warehouseLinked:
      linkedRaw === "true" ? true : linkedRaw === "false" ? false : undefined,
    limit: parseLimit(req.query?.limit, 200),
    offset: parseOffset(req.query?.offset),
  };
}

export function parseInventoryMovementListFilters(req) {
  return {
    tenantId: requireTenantId(req),
    legalEntityId: normalizeOptionalPositiveInt(req.query?.legalEntityId, "legalEntityId"),
    warehouseId: normalizeOptionalPositiveInt(req.query?.warehouseId, "warehouseId"),
    movementType:
      normalizeEnum(req.query?.movementType, "movementType", MOVEMENT_TYPE_VALUES) || null,
    valuationStatus:
      normalizeEnum(
        req.query?.valuationStatus,
        "valuationStatus",
        VALUATION_STATUS_VALUES
      ) || null,
    limit: parseLimit(req.query?.limit, 200),
    offset: parseOffset(req.query?.offset),
  };
}

export function parseInventoryMovementCreateInput(req) {
  return {
    tenantId: requireTenantId(req),
    userId: requireUserId(req),
    legalEntityId: normalizeOptionalPositiveInt(req.body?.legalEntityId, "legalEntityId"),
    warehouseId: normalizeOptionalPositiveInt(req.body?.warehouseId, "warehouseId"),
    sourceStockLinkId: normalizeOptionalPositiveInt(
      req.body?.sourceStockLinkId,
      "sourceStockLinkId"
    ),
    movementDate: parseOptionalDate(req.body?.movementDate, "movementDate"),
    note: normalizeShortText(req.body?.note, "note", 255) || null,
  };
}

export function parseInventoryMovementReverseInput(req) {
  return {
    tenantId: requireTenantId(req),
    userId: requireUserId(req),
    movementId: normalizeOptionalPositiveInt(req.params?.movementId, "movementId"),
    reversalDate: parseOptionalDate(req.body?.reversalDate, "reversalDate"),
    reason: normalizeShortText(req.body?.reason, "reason", 255) || null,
  };
}

export function parseInventoryCostLayerListFilters(req) {
  return {
    tenantId: requireTenantId(req),
    legalEntityId: normalizeOptionalPositiveInt(req.query?.legalEntityId, "legalEntityId"),
    warehouseId: normalizeOptionalPositiveInt(req.query?.warehouseId, "warehouseId"),
    itemCardId: normalizeOptionalPositiveInt(req.query?.itemCardId, "itemCardId"),
    layerStatus:
      normalizeEnum(req.query?.layerStatus, "layerStatus", LAYER_STATUS_VALUES) || null,
    limit: parseLimit(req.query?.limit, 200),
    offset: parseOffset(req.query?.offset),
  };
}
