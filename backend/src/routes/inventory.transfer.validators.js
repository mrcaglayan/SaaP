import {
  badRequest,
  parseIdempotencyKey,
  parsePositiveInt,
  resolveTenantId,
} from "./_utils.js";
import { requireUserId } from "./cash.validators.common.js";

const TRANSFER_STATUS_VALUES = [
  "INITIATED",
  "APPROVED",
  "IN_TRANSIT",
  "RECEIVED",
  "CANCELED",
  "REVERSED",
];

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

function normalizeQuantity(value, fieldName) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw badRequest(`${fieldName} is required`);
  }
  if (!/^\d+(\.\d{1,6})?$/.test(normalized)) {
    throw badRequest(`${fieldName} must be a positive decimal with up to 6 decimals`);
  }
  if (Number(normalized) <= 0) {
    throw badRequest(`${fieldName} must be greater than zero`);
  }
  return normalized;
}

function parseLimit(value, fallback = 100) {
  const parsed = parsePositiveInt(value);
  return parsed ? Math.min(parsed, 200) : fallback;
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

export function parseInventoryTransferIdParam(req) {
  const transferId = parsePositiveInt(req.params?.transferId);
  if (!transferId) {
    throw badRequest("transferId must be a positive integer");
  }
  return transferId;
}

export function parseInventoryTransferListFilters(req) {
  return {
    tenantId: requireTenantId(req),
    legalEntityId: normalizeOptionalPositiveInt(req.query?.legalEntityId, "legalEntityId"),
    sourceWarehouseId: normalizeOptionalPositiveInt(
      req.query?.sourceWarehouseId,
      "sourceWarehouseId"
    ),
    targetWarehouseId: normalizeOptionalPositiveInt(
      req.query?.targetWarehouseId,
      "targetWarehouseId"
    ),
    status: normalizeEnum(req.query?.status, "status", TRANSFER_STATUS_VALUES) || null,
    q: normalizeShortText(req.query?.q, "q", 120) || "",
    limit: parseLimit(req.query?.limit, 100),
    offset: parseOffset(req.query?.offset),
  };
}

export function parseInventoryTransferCreateInput(req) {
  const body = req.body || {};
  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (lines.length === 0) {
    throw badRequest("lines must contain at least one transfer line");
  }

  return {
    tenantId: requireTenantId(req),
    userId: requireUserId(req),
    legalEntityId: normalizeOptionalPositiveInt(body.legalEntityId, "legalEntityId"),
    transferDate: normalizeShortText(body.transferDate, "transferDate", 20, { required: true }),
    sourceWarehouseId: normalizeOptionalPositiveInt(body.sourceWarehouseId, "sourceWarehouseId"),
    targetWarehouseId: normalizeOptionalPositiveInt(body.targetWarehouseId, "targetWarehouseId"),
    sourceModule:
      normalizeShortText(body.sourceModule, "sourceModule", 40)?.toUpperCase() || "INVENTORY",
    sourceEntityType: normalizeShortText(body.sourceEntityType, "sourceEntityType", 60) || null,
    sourceEntityId: normalizeOptionalPositiveInt(body.sourceEntityId, "sourceEntityId"),
    integrationEventUid:
      normalizeShortText(body.integrationEventUid, "integrationEventUid", 100) || null,
    idempotencyKey: parseIdempotencyKey(req),
    note: normalizeShortText(body.note, "note", 500) || null,
    lines: lines.map((line, index) => ({
      itemCardId: normalizeOptionalPositiveInt(line?.itemCardId, `lines[${index}].itemCardId`),
      quantityRequested: normalizeQuantity(
        line?.quantityRequested,
        `lines[${index}].quantityRequested`
      ),
      note: normalizeShortText(line?.note, `lines[${index}].note`, 255) || null,
    })),
  };
}

function parseTransferActionBase(req) {
  return {
    tenantId: requireTenantId(req),
    userId: requireUserId(req),
    transferId: parseInventoryTransferIdParam(req),
  };
}

export function parseInventoryTransferApproveInput(req) {
  return parseTransferActionBase(req);
}

export function parseInventoryTransferShipInput(req) {
  return parseTransferActionBase(req);
}

export function parseInventoryTransferReceiveInput(req) {
  return parseTransferActionBase(req);
}

export function parseInventoryTransferCancelInput(req) {
  return {
    ...parseTransferActionBase(req),
    cancelReason: normalizeShortText(req.body?.cancelReason, "cancelReason", 255) || null,
  };
}

export function parseInventoryTransferReverseInput(req) {
  return {
    ...parseTransferActionBase(req),
    reverseReason: normalizeShortText(req.body?.reverseReason, "reverseReason", 255) || null,
  };
}
