import { badRequest, parsePositiveInt, resolveTenantId } from "./_utils.js";
import { requireUserId } from "./cash.validators.common.js";
import {
  normalizeOwnershipContextInput,
  OWNERSHIP_CONTEXT_VALUES,
} from "../services/ownership.context.policy.service.js";

const WAREHOUSE_STATUS_VALUES = ["ACTIVE", "INACTIVE"];
const STOCK_LINK_STATUS_VALUES = ["PENDING", "LINKED", "VOID"];
const STOCK_LINK_QUEUE_SCOPE_VALUES = ["ACTIONABLE", "COMPLETED", "VOID", "ALL"];
const STOCK_IMPACT_MODE_VALUES = ["RECEIPT_PENDING", "ISSUE_PENDING"];
const MOVEMENT_TYPE_VALUES = ["RECEIPT", "ISSUE", "ADJUSTMENT_IN", "ADJUSTMENT_OUT"];
const INVENTORY_RECEIPT_POLICY_VALUES = [
  "ALLOW_INVOICE_BEFORE_RECEIPT",
  "REQUIRE_RECEIPT_BEFORE_INVOICE",
];
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
        OWNERSHIP_CONTEXT_VALUES
      ) || null,
    operatingUnitId: normalizeOptionalPositiveInt(req.query?.operatingUnitId, "operatingUnitId"),
    status: normalizeEnum(req.query?.status, "status", WAREHOUSE_STATUS_VALUES) || null,
    q: normalizeShortText(req.query?.q, "q", 120) || "",
    limit: parseLimit(req.query?.limit, 200),
    offset: parseOffset(req.query?.offset),
  };
}

export function parseInventoryWarehouseUpsertInput(req) {
  const id = normalizeOptionalPositiveInt(req.body?.id, "id");
  const normalizedOwnershipScope =
    normalizeEnum(
      req.body?.ownershipScope ?? "CENTRAL",
      "ownershipScope",
      OWNERSHIP_CONTEXT_VALUES,
      { required: true }
    ) || "CENTRAL";
  const normalizedOperatingUnitId = normalizeOptionalPositiveInt(
    req.body?.operatingUnitId,
    "operatingUnitId"
  );
  const { ownershipScope, operatingUnitId } = normalizeOwnershipContextInput({
    ownershipScope: normalizedOwnershipScope,
    operatingUnitId: normalizedOperatingUnitId,
  });
  const normalizedCode = normalizeShortText(req.body?.code, "code", 80, {
    required: !id,
  });
  const normalizedName = normalizeShortText(req.body?.name, "name", 200, {
    required: !id,
  });
  const defaultStatus = id ? null : "ACTIVE";
  return {
    id,
    tenantId: requireTenantId(req),
    userId: requireUserId(req),
    legalEntityId: normalizeOptionalPositiveInt(req.body?.legalEntityId, "legalEntityId"),
    ownershipScope,
    operatingUnitId,
    code: normalizedCode ? normalizedCode.toUpperCase() : null,
    name: normalizedName || null,
    status:
      normalizeEnum(req.body?.status ?? defaultStatus, "status", WAREHOUSE_STATUS_VALUES, {
        required: !id,
      }) || defaultStatus,
    inventoryReceiptPolicy:
      normalizeEnum(
        req.body?.inventoryReceiptPolicy,
        "inventoryReceiptPolicy",
        INVENTORY_RECEIPT_POLICY_VALUES
      ) || null,
    notes: normalizeShortText(req.body?.notes, "notes", 255) || null,
  };
}

export function parseInventoryWarehouseCreateInput(req) {
  return parseInventoryWarehouseUpsertInput(req);
}

/**
 * Parse stock-link list filters, including optional OU scoping for branch reads.
 */
export function parseInventoryStockLinkListFilters(req) {
  const linkedRaw = String(req.query?.warehouseLinked ?? "").trim().toLowerCase();
  const linkStatusRaw = String(req.query?.linkStatus ?? req.query?.status ?? "").trim();
  const queueScopeRaw = String(req.query?.queueScope ?? req.query?.scope ?? "").trim();
  return {
    tenantId: requireTenantId(req),
    legalEntityId: normalizeOptionalPositiveInt(req.query?.legalEntityId, "legalEntityId"),
    operatingUnitId: normalizeOptionalPositiveInt(req.query?.operatingUnitId, "operatingUnitId"),
    queueScope: queueScopeRaw
      ? normalizeEnum(queueScopeRaw, "queueScope", STOCK_LINK_QUEUE_SCOPE_VALUES, {
        required: true,
      })
      : linkStatusRaw
        ? null
        : "ACTIONABLE",
    linkStatus: linkStatusRaw
      ? normalizeEnum(linkStatusRaw, "linkStatus", STOCK_LINK_STATUS_VALUES, {
        required: true,
      })
      : null,
    stockImpactMode:
      normalizeEnum(
        req.query?.stockImpactMode ?? req.query?.stock_impact_mode,
        "stockImpactMode",
        STOCK_IMPACT_MODE_VALUES
      ) || null,
    warehouseId: normalizeOptionalPositiveInt(
      req.query?.warehouseId ?? req.query?.boundWarehouseId,
      "warehouseId"
    ),
    warehouseLinked:
      linkedRaw === "true" ? true : linkedRaw === "false" ? false : undefined,
    limit: parseLimit(req.query?.limit, 200),
    offset: parseOffset(req.query?.offset),
  };
}

/**
 * Parse inventory movement list filters, including optional warehouse ownership scope.
 */
export function parseInventoryMovementListFilters(req) {
  return {
    tenantId: requireTenantId(req),
    legalEntityId: normalizeOptionalPositiveInt(req.query?.legalEntityId, "legalEntityId"),
    operatingUnitId: normalizeOptionalPositiveInt(req.query?.operatingUnitId, "operatingUnitId"),
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

export function parseInventoryStockLinkMaterializeInput(req) {
  return {
    tenantId: requireTenantId(req),
    userId: requireUserId(req),
    legalEntityId: normalizeOptionalPositiveInt(req.body?.legalEntityId, "legalEntityId"),
    stockLinkId: normalizeOptionalPositiveInt(req.params?.stockLinkId, "stockLinkId"),
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

/**
 * Parse inventory cost-layer list filters, including optional OU scoping.
 */
export function parseInventoryCostLayerListFilters(req) {
  return {
    tenantId: requireTenantId(req),
    legalEntityId: normalizeOptionalPositiveInt(req.query?.legalEntityId, "legalEntityId"),
    operatingUnitId: normalizeOptionalPositiveInt(req.query?.operatingUnitId, "operatingUnitId"),
    warehouseId: normalizeOptionalPositiveInt(req.query?.warehouseId, "warehouseId"),
    itemCardId: normalizeOptionalPositiveInt(req.query?.itemCardId, "itemCardId"),
    layerStatus:
      normalizeEnum(req.query?.layerStatus, "layerStatus", LAYER_STATUS_VALUES) || null,
    limit: parseLimit(req.query?.limit, 200),
    offset: parseOffset(req.query?.offset),
  };
}
