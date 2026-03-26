import { badRequest, parsePositiveInt, resolveTenantId } from "./_utils.js";
import { requireUserId } from "./cash.validators.common.js";
import { normalizeOwnershipContextInput } from "../services/ownership.context.policy.service.js";

const ALLOCATION_METHOD_VALUES = ["EQUAL", "BY_AMOUNT", "BY_QTY", "MANUAL"];
const VOUCHER_STATUS_VALUES = ["DRAFT", "POSTED", "REVERSED", "CANCELED"];

function requireTenantId(req) {
  const tenantId = resolveTenantId(req);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  return tenantId;
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

function normalizeRequiredPositiveInt(value, fieldName) {
  const parsed = normalizeOptionalPositiveInt(value, fieldName);
  if (!parsed) {
    throw badRequest(`${fieldName} is required`);
  }
  return parsed;
}

function normalizeUpperEnum(value, fieldName, allowedValues) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  if (!normalized) {
    throw badRequest(`${fieldName} is required`);
  }
  if (!allowedValues.includes(normalized)) {
    throw badRequest(`${fieldName} is invalid`);
  }
  return normalized;
}

function normalizeOptionalUpperEnum(value, fieldName, allowedValues) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return normalizeUpperEnum(value, fieldName, allowedValues);
}

function normalizeDateOnly(value, fieldName, { required = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) {
      throw badRequest(`${fieldName} is required`);
    }
    return null;
  }
  const normalized = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw badRequest(`${fieldName} must be YYYY-MM-DD`);
  }
  return normalized;
}

function normalizeOptionalNonNegativeDecimal(value, fieldName) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw badRequest(`${fieldName} must be a numeric value greater than or equal to 0`);
  }
  return Number(parsed.toFixed(6));
}

function normalizeOptionalPositiveDecimal(value, fieldName) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw badRequest(`${fieldName} must be a numeric value greater than 0`);
  }
  return Number(parsed.toFixed(6));
}

function normalizeOptionalBoolean(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  throw badRequest("boolean query value is invalid");
}

function normalizeOptionalText(value, fieldName, maxLength = 255) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const normalized = String(value).trim();
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, maxLength);
}

function normalizeOptionalLimit(value, fieldName, { defaultValue = 100, max = 200 } = {}) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }
  const parsed = parsePositiveInt(value);
  if (!parsed) {
    throw badRequest(`${fieldName} must be a positive integer`);
  }
  return Math.min(parsed, max);
}

function normalizeOptionalOwnershipContext(req, { required = false, allowScopeOnly = false } = {}) {
  const rawScope = req.query?.ownershipScope;
  const rawOperatingUnitId = req.query?.operatingUnitId;
  const hasScope =
    rawScope !== undefined && rawScope !== null && String(rawScope).trim() !== "";
  const hasOperatingUnitId =
    rawOperatingUnitId !== undefined
    && rawOperatingUnitId !== null
    && String(rawOperatingUnitId).trim() !== "";
  if (!hasScope && !hasOperatingUnitId) {
    if (required) {
      throw badRequest("ownershipScope is required");
    }
    return {
      ownershipScope: null,
      operatingUnitId: null,
    };
  }
  if (allowScopeOnly && hasScope && !hasOperatingUnitId) {
    const normalizedScope = String(rawScope || "").trim().toUpperCase();
    if (normalizedScope === "CENTRAL" || normalizedScope === "OPERATING_UNIT") {
      return {
        ownershipScope: normalizedScope,
        operatingUnitId: null,
      };
    }
  }
  return normalizeOwnershipContextInput({
    ownershipScope: rawScope,
    operatingUnitId: rawOperatingUnitId,
    defaultOwnershipScope: "CENTRAL",
  });
}

function ensureArray(value, fieldName) {
  if (!Array.isArray(value) || value.length === 0) {
    throw badRequest(`${fieldName} must be a non-empty array`);
  }
  return value;
}

export function parseInventoryLandedCostVoucherPreviewInput(req) {
  const allocationMethod = normalizeUpperEnum(
    req.body?.allocationMethod,
    "allocationMethod",
    ALLOCATION_METHOD_VALUES
  );
  const ownershipContext = normalizeOwnershipContextInput({
    ownershipScope: req.body?.ownershipScope,
    operatingUnitId: req.body?.operatingUnitId,
    defaultOwnershipScope: null,
  });

  const sourceLines = ensureArray(req.body?.sourceLines, "sourceLines").map(
    (entry, index) => ({
      sourceCariDocumentLineId: normalizeRequiredPositiveInt(
        entry?.sourceCariDocumentLineId,
        `sourceLines[${index}].sourceCariDocumentLineId`
      ),
      appliedAmountBase: normalizeOptionalPositiveDecimal(
        entry?.appliedAmountBase,
        `sourceLines[${index}].appliedAmountBase`
      ),
    })
  );

  const targets = ensureArray(req.body?.targets, "targets").map((entry, index) => ({
    sourceStockLinkId: normalizeRequiredPositiveInt(
      entry?.sourceStockLinkId,
      `targets[${index}].sourceStockLinkId`
    ),
    allocatedAmountBase: normalizeOptionalNonNegativeDecimal(
      entry?.allocatedAmountBase,
      `targets[${index}].allocatedAmountBase`
    ),
  }));

  return {
    tenantId: requireTenantId(req),
    legalEntityId: normalizeRequiredPositiveInt(req.body?.legalEntityId, "legalEntityId"),
    postingDate: normalizeDateOnly(req.body?.postingDate, "postingDate"),
    allocationMethod,
    ownershipScope: ownershipContext.ownershipScope,
    operatingUnitId: ownershipContext.operatingUnitId,
    sourceLines,
    targets,
  };
}

export function parseInventoryLandedCostVoucherCreateInput(req) {
  const payload = parseInventoryLandedCostVoucherPreviewInput(req);
  return {
    ...payload,
    userId: requireUserId(req),
    postingDate: normalizeDateOnly(req.body?.postingDate, "postingDate", { required: true }),
    note:
      String(req.body?.note || "").trim().slice(0, 500)
      || null,
  };
}

export function parseInventoryLandedCostVoucherIdParam(req) {
  const voucherId = parsePositiveInt(req.params?.voucherId);
  if (!voucherId) {
    throw badRequest("voucherId must be a positive integer");
  }
  return voucherId;
}

export function parseInventoryLandedCostVoucherListInput(req) {
  const ownershipContext = normalizeOptionalOwnershipContext(req, {
    allowScopeOnly: true,
  });
  return {
    tenantId: requireTenantId(req),
    legalEntityId: normalizeOptionalPositiveInt(req.query?.legalEntityId, "legalEntityId"),
    ownershipScope: ownershipContext.ownershipScope,
    operatingUnitId: ownershipContext.operatingUnitId,
    status: normalizeOptionalUpperEnum(req.query?.status, "status", VOUCHER_STATUS_VALUES),
    postingDateFrom: normalizeDateOnly(req.query?.postingDateFrom, "postingDateFrom"),
    postingDateTo: normalizeDateOnly(req.query?.postingDateTo, "postingDateTo"),
    vendor: normalizeOptionalText(req.query?.vendor, "vendor", 255),
    search: normalizeOptionalText(req.query?.search, "search", 255),
    limit: normalizeOptionalLimit(req.query?.limit, "limit"),
  };
}

export function parseInventoryLandedCostVoucherDetailInput(req) {
  return {
    tenantId: requireTenantId(req),
    voucherId: parseInventoryLandedCostVoucherIdParam(req),
  };
}

export function parseInventoryLandedCostVoucherSourceLookupInput(req) {
  return {
    tenantId: requireTenantId(req),
    legalEntityId: normalizeRequiredPositiveInt(req.query?.legalEntityId, "legalEntityId"),
    postingDateFrom: normalizeDateOnly(req.query?.postingDateFrom, "postingDateFrom"),
    postingDateTo: normalizeDateOnly(req.query?.postingDateTo, "postingDateTo"),
    vendor: normalizeOptionalText(req.query?.vendor, "vendor", 255),
    currencyCode: normalizeOptionalText(req.query?.currencyCode, "currencyCode", 3),
    search: normalizeOptionalText(req.query?.search, "search", 255),
    onlyRemainingUnapplied:
      normalizeOptionalBoolean(req.query?.onlyRemainingUnapplied) ?? false,
    limit: normalizeOptionalLimit(req.query?.limit, "limit"),
  };
}

export function parseInventoryLandedCostVoucherTargetLookupInput(req) {
  const ownershipContext = normalizeOptionalOwnershipContext(req);
  return {
    tenantId: requireTenantId(req),
    legalEntityId: normalizeRequiredPositiveInt(req.query?.legalEntityId, "legalEntityId"),
    ownershipScope: ownershipContext.ownershipScope,
    operatingUnitId: ownershipContext.operatingUnitId,
    receiptDateFrom: normalizeDateOnly(req.query?.receiptDateFrom, "receiptDateFrom"),
    receiptDateTo: normalizeDateOnly(req.query?.receiptDateTo, "receiptDateTo"),
    itemCardId: normalizeOptionalPositiveInt(req.query?.itemCardId, "itemCardId"),
    warehouseId: normalizeOptionalPositiveInt(req.query?.warehouseId, "warehouseId"),
    search: normalizeOptionalText(req.query?.search, "search", 255),
    matchSelectedContextOnly:
      normalizeOptionalBoolean(req.query?.matchSelectedContextOnly) ?? false,
    limit: normalizeOptionalLimit(req.query?.limit, "limit"),
  };
}

export function parseInventoryLandedCostVoucherReverseInput(req) {
  return {
    tenantId: requireTenantId(req),
    userId: requireUserId(req),
    voucherId: parseInventoryLandedCostVoucherIdParam(req),
    reversalDate: normalizeDateOnly(req.body?.reversalDate, "reversalDate"),
    reverseReason:
      String(req.body?.reverseReason || "").trim().slice(0, 255)
      || null,
  };
}
