import { badRequest, parsePositiveInt, resolveTenantId } from "./_utils.js";

const ITEM_TYPE_VALUES = ["SERVICE", "NON_STOCK_GOOD", "STOCK_ITEM"];
const STATUS_VALUES = ["ACTIVE", "INACTIVE"];

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

function requireTenantId(req) {
  const tenantId = resolveTenantId(req);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  return tenantId;
}

export function parseItemCardIdParam(req) {
  const itemCardId = parsePositiveInt(req.params?.itemCardId);
  if (!itemCardId) {
    throw badRequest("itemCardId must be a positive integer");
  }
  return itemCardId;
}

export function parseItemCardListFilters(req) {
  return {
    tenantId: requireTenantId(req),
    legalEntityId: normalizeOptionalPositiveInt(
      req.query?.legalEntityId ?? req.query?.legal_entity_id,
      "legalEntityId"
    ),
    status: normalizeEnum(req.query?.status, "status", STATUS_VALUES) || null,
    itemType:
      normalizeEnum(
        req.query?.itemType ?? req.query?.item_type,
        "itemType",
        ITEM_TYPE_VALUES
      ) || null,
    q: normalizeShortText(req.query?.q, "q", 120) || "",
    limit: parseLimit(req.query?.limit, 100),
    offset: parseOffset(req.query?.offset),
  };
}

export function parseItemCardCreateInput(req) {
  const body = req.body || {};
  return {
    tenantId: requireTenantId(req),
    legalEntityId: normalizeOptionalPositiveInt(
      body.legalEntityId ?? body.legal_entity_id,
      "legalEntityId"
    ),
    code: normalizeShortText(body.code, "code", 80, { required: true }).toUpperCase(),
    name: normalizeShortText(body.name, "name", 200, { required: true }),
    itemType: normalizeEnum(
      body.itemType ?? body.item_type,
      "itemType",
      ITEM_TYPE_VALUES,
      { required: true }
    ),
    defaultSalesAccountId: normalizeOptionalPositiveInt(
      body.defaultSalesAccountId ?? body.default_sales_account_id,
      "defaultSalesAccountId"
    ),
    defaultPurchaseAccountId: normalizeOptionalPositiveInt(
      body.defaultPurchaseAccountId ?? body.default_purchase_account_id,
      "defaultPurchaseAccountId"
    ),
    inventoryAssetAccountId: normalizeOptionalPositiveInt(
      body.inventoryAssetAccountId ?? body.inventory_asset_account_id,
      "inventoryAssetAccountId"
    ),
    defaultCogsAccountId: normalizeOptionalPositiveInt(
      body.defaultCogsAccountId ?? body.default_cogs_account_id,
      "defaultCogsAccountId"
    ),
    taxCategoryCode:
      normalizeShortText(
        body.taxCategoryCode ?? body.tax_category_code,
        "taxCategoryCode",
        60
      )?.toUpperCase() || null,
    status:
      normalizeEnum(body.status ?? "ACTIVE", "status", STATUS_VALUES, {
        required: true,
      }) || "ACTIVE",
  };
}

export function parseItemCardUpdateInput(req) {
  const body = req.body || {};
  return {
    tenantId: requireTenantId(req),
    itemCardId: parseItemCardIdParam(req),
    legalEntityId: normalizeOptionalPositiveInt(
      body.legalEntityId ?? body.legal_entity_id,
      "legalEntityId"
    ),
    code: normalizeShortText(body.code, "code", 80, { required: true }).toUpperCase(),
    name: normalizeShortText(body.name, "name", 200, { required: true }),
    itemType: normalizeEnum(
      body.itemType ?? body.item_type,
      "itemType",
      ITEM_TYPE_VALUES,
      { required: true }
    ),
    defaultSalesAccountId: normalizeOptionalPositiveInt(
      body.defaultSalesAccountId ?? body.default_sales_account_id,
      "defaultSalesAccountId"
    ),
    defaultPurchaseAccountId: normalizeOptionalPositiveInt(
      body.defaultPurchaseAccountId ?? body.default_purchase_account_id,
      "defaultPurchaseAccountId"
    ),
    inventoryAssetAccountId: normalizeOptionalPositiveInt(
      body.inventoryAssetAccountId ?? body.inventory_asset_account_id,
      "inventoryAssetAccountId"
    ),
    defaultCogsAccountId: normalizeOptionalPositiveInt(
      body.defaultCogsAccountId ?? body.default_cogs_account_id,
      "defaultCogsAccountId"
    ),
    taxCategoryCode:
      normalizeShortText(
        body.taxCategoryCode ?? body.tax_category_code,
        "taxCategoryCode",
        60
      )?.toUpperCase() || null,
    status:
      normalizeEnum(body.status ?? "ACTIVE", "status", STATUS_VALUES, {
        required: true,
      }) || "ACTIVE",
  };
}

export const ITEM_CARD_ITEM_TYPES = ITEM_TYPE_VALUES;
export const ITEM_CARD_STATUS_VALUES = STATUS_VALUES;
