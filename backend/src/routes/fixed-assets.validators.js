/**
 * Fixed-assets request validators.
 *
 * Owns parse/validate functions for fixed-assets route inputs.
 */

import { resolveTenantId, parsePositiveInt, badRequest } from "./_utils.js";

// ── Shared helpers ────────────────────────────────────────────────

const VALID_SALVAGE_RULE_TYPES = new Set([
  "NONE",
  "FIXED_BASE_AMOUNT",
  "PERCENT_OF_COST",
]);

const VALID_CATEGORY_STATUSES = new Set(["ACTIVE", "INACTIVE"]);

const VALID_PROFILE_STATUSES = new Set(["ACTIVE", "INACTIVE"]);

const VALID_DEPRECIATION_METHODS = new Set([
  "STRAIGHT_LINE",
  "DECLINING_BALANCE",
  "NONE",
]);

const VALID_DEPRECIATION_RUN_STATUSES = new Set([
  "DRAFT",
  "POSTED",
  "REVERSED",
]);

function normalizeUpperText(value) {
  if (value === undefined || value === null) return null;
  return String(value).trim().toUpperCase();
}

function normalizeDateOnlyOptional(value, label) {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw badRequest(`${label} must be YYYY-MM-DD`);
  }
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw badRequest(`${label} must be a valid date`);
  }
  return text;
}

function normalizeDateOnlyRequired(value, label) {
  const normalized = normalizeDateOnlyOptional(value, label);
  if (!normalized) {
    throw badRequest(`${label} is required`);
  }
  return normalized;
}

function hasOwn(body, key) {
  return Object.prototype.hasOwnProperty.call(body || {}, key);
}

function pickBodyValue(body, camelKey, snakeKey = camelKey) {
  if (hasOwn(body, camelKey)) {
    return { present: true, value: body[camelKey] };
  }
  if (snakeKey !== camelKey && hasOwn(body, snakeKey)) {
    return { present: true, value: body[snakeKey] };
  }
  return { present: false, value: undefined };
}

function normalizeOptionalNonNegativeNumber(value, label) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) {
    throw badRequest(`${label} must be a non-negative number`);
  }
  return normalized;
}

function normalizeOptionalNonNegativeInteger(value, label) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 0) {
    throw badRequest(`${label} must be a non-negative integer`);
  }
  return normalized;
}

function normalizeOptionalPositiveInteger(value, label) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw badRequest(`${label} must be a positive integer`);
  }
  return normalized;
}

/**
 * Shared list-filter parser for fixed-assets endpoints that accept
 * legalEntityId in query. Used by categories, profiles, custodians,
 * and the asset register list.
 */
export function parseFixedAssetsListFilters(req) {
  const tenantId = resolveTenantId(req);
  const legalEntityId = parsePositiveInt(req.query?.legalEntityId);
  return { tenantId, legalEntityId };
}

// ═══════════════════════════════════════════════════════════════════
// Asset detail validators
// ═══════════════════════════════════════════════════════════════════

export function parseAssetDetailParams(req) {
  const tenantId = resolveTenantId(req);
  if (!tenantId) throw badRequest("tenantId is required");

  const assetId = parsePositiveInt(req.params?.assetId);
  if (!assetId) throw badRequest("assetId is required");

  return { tenantId, assetId };
}

export function parseAssetDepreciationScheduleInput(req) {
  return parseAssetDetailParams(req);
}

function parseDepreciationRunScopeInput(req) {
  const tenantId = resolveTenantId(req);
  if (!tenantId) throw badRequest("tenantId is required");

  const body = req.body || {};

  const legalEntityId = parsePositiveInt(
    body.legalEntityId ?? body.legal_entity_id
  );
  if (!legalEntityId) {
    throw badRequest("legalEntityId is required");
  }

  const fiscalPeriodId = parsePositiveInt(
    body.fiscalPeriodId ?? body.fiscal_period_id
  );
  if (!fiscalPeriodId) {
    throw badRequest("fiscalPeriodId is required");
  }

  const bookId = normalizeOptionalPositiveInteger(
    body.bookId ?? body.book_id,
    "bookId"
  );

  const postingDate = normalizeDateOnlyOptional(
    body.postingDate ?? body.posting_date,
    "postingDate"
  );

  return {
    tenantId,
    legalEntityId,
    fiscalPeriodId,
    bookId,
    postingDate,
  };
}

export function parseDepreciationRunPreviewInput(req) {
  return parseDepreciationRunScopeInput(req);
}

export function parseDepreciationRunCreateInput(req) {
  return {
    ...parseDepreciationRunScopeInput(req),
    userId: req.user?.userId || null,
  };
}

export function parseDepreciationRunListInput(req) {
  const tenantId = resolveTenantId(req);
  if (!tenantId) throw badRequest("tenantId is required");

  const legalEntityId = parsePositiveInt(
    req.query?.legalEntityId ?? req.query?.legal_entity_id
  );
  if (!legalEntityId) {
    throw badRequest("legalEntityId is required");
  }

  const bookId = normalizeOptionalPositiveInteger(
    req.query?.bookId ?? req.query?.book_id,
    "bookId"
  );
  const fiscalPeriodId = normalizeOptionalPositiveInteger(
    req.query?.fiscalPeriodId ?? req.query?.fiscal_period_id,
    "fiscalPeriodId"
  );
  const status = normalizeUpperText(req.query?.status);
  if (status && !VALID_DEPRECIATION_RUN_STATUSES.has(status)) {
    throw badRequest(
      `status must be one of: ${[...VALID_DEPRECIATION_RUN_STATUSES].join(", ")}`
    );
  }

  return {
    tenantId,
    legalEntityId,
    bookId,
    fiscalPeriodId,
    status,
  };
}

export function parseDepreciationRunParams(req) {
  const tenantId = resolveTenantId(req);
  if (!tenantId) throw badRequest("tenantId is required");

  const runId = parsePositiveInt(req.params?.runId);
  if (!runId) throw badRequest("runId is required");

  return {
    tenantId,
    runId,
  };
}

// ═══════════════════════════════════════════════════════════════════
// FA06 eligible CARI AP-line read validators
// ═══════════════════════════════════════════════════════════════════

export function parseCariEligibleApLineReadInput(req) {
  const tenantId = resolveTenantId(req);
  if (!tenantId) throw badRequest("tenantId is required");

  const sourceCariDocumentId = parsePositiveInt(
    req.query?.sourceCariDocumentId
    ?? req.query?.source_cari_document_id
    ?? req.query?.cariDocumentId
    ?? req.query?.documentId
  );
  if (!sourceCariDocumentId) {
    throw badRequest("sourceCariDocumentId is required");
  }

  const unitCount = normalizeOptionalPositiveInteger(
    req.query?.unitCount ?? req.query?.unit_count,
    "unitCount"
  );

  return {
    tenantId,
    sourceCariDocumentId,
    unitCount,
  };
}

export function parseCariDocumentLineCapitalizationInput(req) {
  const tenantId = resolveTenantId(req);
  if (!tenantId) throw badRequest("tenantId is required");

  const body = req.body || {};

  const sourceCariDocumentId = parsePositiveInt(
    body.sourceCariDocumentId
    ?? body.source_cari_document_id
    ?? body.cariDocumentId
    ?? body.documentId
  );
  if (!sourceCariDocumentId) {
    throw badRequest("sourceCariDocumentId is required");
  }

  const sourceCariDocumentLineId = parsePositiveInt(
    body.sourceCariDocumentLineId
    ?? body.source_cari_document_line_id
    ?? body.cariDocumentLineId
    ?? body.lineId
  );
  if (!sourceCariDocumentLineId) {
    throw badRequest("sourceCariDocumentLineId is required");
  }

  const unitCount = normalizeOptionalPositiveInteger(
    body.unitCount ?? body.unit_count,
    "unitCount"
  );
  if (!unitCount) {
    throw badRequest("unitCount is required");
  }

  const categoryId = parsePositiveInt(body.categoryId ?? body.category_id);
  if (!categoryId) {
    throw badRequest("categoryId is required");
  }

  const ownerOperatingUnitId = parsePositiveInt(
    body.ownerOperatingUnitId ?? body.owner_operating_unit_id
  );
  if (!ownerOperatingUnitId) {
    throw badRequest("ownerOperatingUnitId is required");
  }

  const locationOperatingUnitId = parsePositiveInt(
    body.locationOperatingUnitId ?? body.location_operating_unit_id
  );
  if (!locationOperatingUnitId) {
    throw badRequest("locationOperatingUnitId is required");
  }

  const capitalizationDate = normalizeDateOnlyRequired(
    body.capitalizationDate ?? body.capitalization_date,
    "capitalizationDate"
  );

  const inServiceDate = normalizeDateOnlyRequired(
    body.inServiceDate ?? body.in_service_date,
    "inServiceDate"
  );

  const userId = req.user?.userId || null;

  return {
    tenantId,
    sourceCariDocumentId,
    sourceCariDocumentLineId,
    unitCount,
    categoryId,
    ownerOperatingUnitId,
    locationOperatingUnitId,
    capitalizationDate,
    inServiceDate,
    userId,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Asset activation validators
// ═══════════════════════════════════════════════════════════════════

export function parseActivateAssetInput(req) {
  const tenantId = resolveTenantId(req);
  if (!tenantId) throw badRequest("tenantId is required");

  const assetId = parsePositiveInt(req.params?.assetId);
  if (!assetId) throw badRequest("assetId is required");

  const body = req.body || {};

  const postingDate = normalizeDateOnlyRequired(
    body.postingDate ?? body.posting_date,
    "postingDate"
  );

  const capitalizationDate = normalizeDateOnlyOptional(
    body.capitalizationDate ?? body.capitalization_date,
    "capitalizationDate"
  );

  const inServiceDate = normalizeDateOnlyOptional(
    body.inServiceDate ?? body.in_service_date,
    "inServiceDate"
  );

  const userId = req.user?.userId || null;

  return { tenantId, assetId, postingDate, capitalizationDate, inServiceDate, userId };
}

// ═══════════════════════════════════════════════════════════════════
// Asset create validators
// ═══════════════════════════════════════════════════════════════════

export function parseAssetCreateInput(req) {
  const tenantId = resolveTenantId(req);
  if (!tenantId) throw badRequest("tenantId is required");
  const body = req.body || {};

  const legalEntityId = parsePositiveInt(body?.legalEntityId);
  if (!legalEntityId) throw badRequest("legalEntityId is required");

  const name = String(body?.name ?? "").trim();
  if (!name) throw badRequest("name is required");

  const categoryId = parsePositiveInt(body?.categoryId);
  if (!categoryId) throw badRequest("categoryId is required");

  const acquisitionDate = String(body?.acquisitionDate ?? "").trim();
  if (!acquisitionDate) throw badRequest("acquisitionDate is required");

  const currencyCode = String(body?.currencyCode ?? "").trim().toUpperCase();
  if (!currencyCode) throw badRequest("currencyCode is required");

  const description = body?.description != null
    ? String(body.description).trim() || null
    : null;

  const assetTag = body?.assetTag != null
    ? String(body.assetTag).trim() || null
    : null;

  const serialNo = body?.serialNo != null
    ? String(body.serialNo).trim() || null
    : null;

  const ownerOperatingUnitId = parsePositiveInt(body?.ownerOperatingUnitId);
  const locationOperatingUnitId = parsePositiveInt(body?.locationOperatingUnitId);

  const departmentCode = body?.departmentCode != null
    ? String(body.departmentCode).trim() || null
    : null;
  const costCenterCode = body?.costCenterCode != null
    ? String(body.costCenterCode).trim() || null
    : null;

  const custodianEmployeeId = parsePositiveInt(body?.custodianEmployeeId);
  const counterpartyId = parsePositiveInt(body?.counterpartyId);

  const originalCostTxn = body?.originalCostTxn != null
    ? Number(body.originalCostTxn) : 0;
  if (isNaN(originalCostTxn) || originalCostTxn < 0) {
    throw badRequest("originalCostTxn must be a non-negative number");
  }

  const originalCostBase = body?.originalCostBase != null
    ? Number(body.originalCostBase) : 0;
  if (isNaN(originalCostBase) || originalCostBase < 0) {
    throw badRequest("originalCostBase must be a non-negative number");
  }

  // Optional overrides — if not supplied, will be prefilled from category defaults
  const depreciationProfileId = parsePositiveInt(body?.depreciationProfileId);
  const usefulLifeMonths = parsePositiveInt(body?.usefulLifeMonths);

  const salvageRuleType = body?.salvageRuleType != null
    ? normalizeUpperText(body.salvageRuleType) : undefined;
  if (salvageRuleType !== undefined && !VALID_SALVAGE_RULE_TYPES.has(salvageRuleType)) {
    throw badRequest(`salvageRuleType must be one of: ${[...VALID_SALVAGE_RULE_TYPES].join(", ")}`);
  }

  const salvagePercent = body?.salvagePercent != null
    ? Number(body.salvagePercent) : undefined;
  if (salvagePercent !== undefined && (isNaN(salvagePercent) || salvagePercent < 0 || salvagePercent > 100)) {
    throw badRequest("salvagePercent must be between 0 and 100");
  }

  const salvageAmountBaseRule = body?.salvageAmountBaseRule != null
    ? Number(body.salvageAmountBaseRule) : undefined;
  if (salvageAmountBaseRule !== undefined && (isNaN(salvageAmountBaseRule) || salvageAmountBaseRule < 0)) {
    throw badRequest("salvageAmountBaseRule must be a non-negative number");
  }

  const remainingUsefulLifeMonths = normalizeOptionalNonNegativeInteger(
    pickBodyValue(body, "remainingUsefulLifeMonths", "remaining_useful_life_months").value,
    "remainingUsefulLifeMonths"
  );
  const legacyAccumDeprTxn = normalizeOptionalNonNegativeNumber(
    pickBodyValue(body, "legacyAccumDeprTxn", "legacy_accum_depr_txn").value,
    "legacyAccumDeprTxn"
  );
  const legacyAccumDeprBase = normalizeOptionalNonNegativeNumber(
    pickBodyValue(body, "legacyAccumDeprBase", "legacy_accum_depr_base").value,
    "legacyAccumDeprBase"
  );
  const legacyNbvTxn = normalizeOptionalNonNegativeNumber(
    pickBodyValue(body, "legacyNbvTxn", "legacy_nbv_txn").value,
    "legacyNbvTxn"
  );
  const legacyNbvBase = normalizeOptionalNonNegativeNumber(
    pickBodyValue(body, "legacyNbvBase", "legacy_nbv_base").value,
    "legacyNbvBase"
  );

  const userId = req.user?.userId || null;

  return {
    tenantId, legalEntityId, name, categoryId, acquisitionDate, currencyCode,
    description, assetTag, serialNo,
    ownerOperatingUnitId, locationOperatingUnitId,
    departmentCode, costCenterCode,
    custodianEmployeeId, counterpartyId,
    originalCostTxn, originalCostBase,
    depreciationProfileId, usefulLifeMonths, remainingUsefulLifeMonths,
    salvageRuleType, salvagePercent, salvageAmountBaseRule,
    legacyAccumDeprTxn, legacyAccumDeprBase, legacyNbvTxn, legacyNbvBase,
    userId,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Asset DRAFT update validators
// ═══════════════════════════════════════════════════════════════════

export function parseAssetDraftUpdateInput(req) {
  const tenantId = resolveTenantId(req);
  if (!tenantId) throw badRequest("tenantId is required");

  const assetId = parsePositiveInt(req.params?.assetId);
  if (!assetId) throw badRequest("assetId is required");

  const updates = {};
  const body = req.body || {};

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) throw badRequest("name cannot be empty");
    updates.name = name;
  }

  if (body.description !== undefined) {
    updates.description = body.description != null
      ? String(body.description).trim() || null : null;
  }

  if (body.assetTag !== undefined) {
    updates.assetTag = body.assetTag != null
      ? String(body.assetTag).trim() || null : null;
  }

  if (body.serialNo !== undefined) {
    updates.serialNo = body.serialNo != null
      ? String(body.serialNo).trim() || null : null;
  }

  if (body.categoryId !== undefined) {
    const v = parsePositiveInt(body.categoryId);
    if (!v) throw badRequest("categoryId must be a positive integer");
    updates.categoryId = v;
  }

  if (body.ownerOperatingUnitId !== undefined) {
    updates.ownerOperatingUnitId = body.ownerOperatingUnitId != null
      ? parsePositiveInt(body.ownerOperatingUnitId) : null;
  }

  if (body.locationOperatingUnitId !== undefined) {
    updates.locationOperatingUnitId = body.locationOperatingUnitId != null
      ? parsePositiveInt(body.locationOperatingUnitId) : null;
  }

  if (body.departmentCode !== undefined) {
    updates.departmentCode = body.departmentCode != null
      ? String(body.departmentCode).trim() || null : null;
  }

  if (body.costCenterCode !== undefined) {
    updates.costCenterCode = body.costCenterCode != null
      ? String(body.costCenterCode).trim() || null : null;
  }

  if (body.custodianEmployeeId !== undefined) {
    updates.custodianEmployeeId = body.custodianEmployeeId != null
      ? parsePositiveInt(body.custodianEmployeeId) : null;
  }

  if (body.counterpartyId !== undefined) {
    updates.counterpartyId = body.counterpartyId != null
      ? parsePositiveInt(body.counterpartyId) : null;
  }

  if (body.acquisitionDate !== undefined) {
    const v = String(body.acquisitionDate ?? "").trim();
    if (!v) throw badRequest("acquisitionDate cannot be empty");
    updates.acquisitionDate = v;
  }

  if (body.currencyCode !== undefined) {
    const v = String(body.currencyCode ?? "").trim().toUpperCase();
    if (!v) throw badRequest("currencyCode cannot be empty");
    updates.currencyCode = v;
  }

  if (body.originalCostTxn !== undefined) {
    const v = Number(body.originalCostTxn);
    if (isNaN(v) || v < 0) throw badRequest("originalCostTxn must be a non-negative number");
    updates.originalCostTxn = v;
  }

  if (body.originalCostBase !== undefined) {
    const v = Number(body.originalCostBase);
    if (isNaN(v) || v < 0) throw badRequest("originalCostBase must be a non-negative number");
    updates.originalCostBase = v;
  }

  if (body.depreciationProfileId !== undefined) {
    updates.depreciationProfileId = body.depreciationProfileId != null
      ? parsePositiveInt(body.depreciationProfileId) : null;
  }

  if (body.usefulLifeMonths !== undefined) {
    updates.usefulLifeMonths = body.usefulLifeMonths != null
      ? parsePositiveInt(body.usefulLifeMonths) : null;
  }

  const remainingUsefulLifeMonthsInput = pickBodyValue(
    body,
    "remainingUsefulLifeMonths",
    "remaining_useful_life_months"
  );
  if (remainingUsefulLifeMonthsInput.present) {
    updates.remainingUsefulLifeMonths = normalizeOptionalNonNegativeInteger(
      remainingUsefulLifeMonthsInput.value,
      "remainingUsefulLifeMonths"
    );
  }

  if (body.salvageRuleType !== undefined) {
    const v = normalizeUpperText(body.salvageRuleType) || "NONE";
    if (!VALID_SALVAGE_RULE_TYPES.has(v)) {
      throw badRequest(`salvageRuleType must be one of: ${[...VALID_SALVAGE_RULE_TYPES].join(", ")}`);
    }
    updates.salvageRuleType = v;
  }

  if (body.salvagePercent !== undefined) {
    const v = body.salvagePercent != null ? Number(body.salvagePercent) : null;
    if (v !== null && (isNaN(v) || v < 0 || v > 100)) {
      throw badRequest("salvagePercent must be between 0 and 100");
    }
    updates.salvagePercent = v;
  }

  if (body.salvageAmountBaseRule !== undefined) {
    const v = body.salvageAmountBaseRule != null ? Number(body.salvageAmountBaseRule) : null;
    if (v !== null && (isNaN(v) || v < 0)) {
      throw badRequest("salvageAmountBaseRule must be a non-negative number");
    }
    updates.salvageAmountBaseRule = v;
  }

  const legacyAccumDeprTxnInput = pickBodyValue(
    body,
    "legacyAccumDeprTxn",
    "legacy_accum_depr_txn"
  );
  if (legacyAccumDeprTxnInput.present) {
    updates.legacyAccumDeprTxn = normalizeOptionalNonNegativeNumber(
      legacyAccumDeprTxnInput.value,
      "legacyAccumDeprTxn"
    );
  }

  const legacyAccumDeprBaseInput = pickBodyValue(
    body,
    "legacyAccumDeprBase",
    "legacy_accum_depr_base"
  );
  if (legacyAccumDeprBaseInput.present) {
    updates.legacyAccumDeprBase = normalizeOptionalNonNegativeNumber(
      legacyAccumDeprBaseInput.value,
      "legacyAccumDeprBase"
    );
  }

  const legacyNbvTxnInput = pickBodyValue(
    body,
    "legacyNbvTxn",
    "legacy_nbv_txn"
  );
  if (legacyNbvTxnInput.present) {
    updates.legacyNbvTxn = normalizeOptionalNonNegativeNumber(
      legacyNbvTxnInput.value,
      "legacyNbvTxn"
    );
  }

  const legacyNbvBaseInput = pickBodyValue(
    body,
    "legacyNbvBase",
    "legacy_nbv_base"
  );
  if (legacyNbvBaseInput.present) {
    updates.legacyNbvBase = normalizeOptionalNonNegativeNumber(
      legacyNbvBaseInput.value,
      "legacyNbvBase"
    );
  }

  const userId = req.user?.userId || null;

  return { tenantId, assetId, updates, userId };
}

// ═══════════════════════════════════════════════════════════════════
// Asset register list validators
// ═══════════════════════════════════════════════════════════════════

const VALID_ASSET_STATUSES = new Set([
  "DRAFT",
  "ACTIVE",
  "SUSPENDED",
  "FULLY_DEPRECIATED",
  "DISPOSED",
]);

export function parseRegisterListFilters(req) {
  const tenantId = resolveTenantId(req);
  if (!tenantId) throw badRequest("tenantId is required");

  const legalEntityId = parsePositiveInt(req.query?.legalEntityId);
  const ownerOperatingUnitId = parsePositiveInt(req.query?.ownerOperatingUnitId);
  const locationOperatingUnitId = parsePositiveInt(req.query?.locationOperatingUnitId);
  const categoryId = parsePositiveInt(req.query?.categoryId);
  const custodianId = parsePositiveInt(req.query?.custodianId);

  const status = normalizeUpperText(req.query?.status);
  if (status && !VALID_ASSET_STATUSES.has(status)) {
    throw badRequest(`status must be one of: ${[...VALID_ASSET_STATUSES].join(", ")}`);
  }

  const acquisitionDateFrom = req.query?.acquisitionDateFrom
    ? String(req.query.acquisitionDateFrom).trim() || null
    : null;
  const acquisitionDateTo = req.query?.acquisitionDateTo
    ? String(req.query.acquisitionDateTo).trim() || null
    : null;
  const inServiceDateFrom = req.query?.inServiceDateFrom
    ? String(req.query.inServiceDateFrom).trim() || null
    : null;
  const inServiceDateTo = req.query?.inServiceDateTo
    ? String(req.query.inServiceDateTo).trim() || null
    : null;

  const departmentCode = req.query?.departmentCode
    ? String(req.query.departmentCode).trim() || null
    : null;
  const costCenterCode = req.query?.costCenterCode
    ? String(req.query.costCenterCode).trim() || null
    : null;

  // disposed=true → only DISPOSED; disposed=false → exclude DISPOSED; omitted → no filter
  let disposed = undefined;
  if (req.query?.disposed !== undefined && req.query.disposed !== "") {
    const raw = String(req.query.disposed).toLowerCase();
    if (raw === "true" || raw === "1") disposed = true;
    else if (raw === "false" || raw === "0") disposed = false;
  }

  return {
    tenantId,
    legalEntityId,
    ownerOperatingUnitId,
    locationOperatingUnitId,
    categoryId,
    custodianId,
    status,
    acquisitionDateFrom,
    acquisitionDateTo,
    inServiceDateFrom,
    inServiceDateTo,
    departmentCode,
    costCenterCode,
    disposed,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Category validators
// ═══════════════════════════════════════════════════════════════════

export function parseCategoryListFilters(req) {
  const tenantId = resolveTenantId(req);
  const legalEntityId = parsePositiveInt(req.query?.legalEntityId);
  const status = normalizeUpperText(req.query?.status);
  return { tenantId, legalEntityId, status };
}

export function parseCategoryCreateInput(req) {
  const tenantId = resolveTenantId(req);
  if (!tenantId) throw badRequest("tenantId is required");

  const legalEntityId = parsePositiveInt(req.body?.legalEntityId);
  if (!legalEntityId) throw badRequest("legalEntityId is required");

  const code = String(req.body?.code ?? "").trim();
  if (!code) throw badRequest("code is required");

  const name = String(req.body?.name ?? "").trim();
  if (!name) throw badRequest("name is required");

  const status = normalizeUpperText(req.body?.status) || "ACTIVE";
  if (!VALID_CATEGORY_STATUSES.has(status)) {
    throw badRequest(`status must be one of: ${[...VALID_CATEGORY_STATUSES].join(", ")}`);
  }

  const description = req.body?.description != null
    ? String(req.body.description).trim() || null
    : null;

  const capitalizationThresholdBase = req.body?.capitalizationThresholdBase != null
    ? Number(req.body.capitalizationThresholdBase)
    : null;
  if (capitalizationThresholdBase !== null && (isNaN(capitalizationThresholdBase) || capitalizationThresholdBase < 0)) {
    throw badRequest("capitalizationThresholdBase must be a non-negative number");
  }

  const defaultUsefulLifeMonths = parsePositiveInt(req.body?.defaultUsefulLifeMonths);

  const defaultSalvageRuleType = normalizeUpperText(req.body?.defaultSalvageRuleType) || "NONE";
  if (!VALID_SALVAGE_RULE_TYPES.has(defaultSalvageRuleType)) {
    throw badRequest(`defaultSalvageRuleType must be one of: ${[...VALID_SALVAGE_RULE_TYPES].join(", ")}`);
  }

  const defaultSalvagePercent = req.body?.defaultSalvagePercent != null
    ? Number(req.body.defaultSalvagePercent)
    : null;
  if (defaultSalvagePercent !== null && (isNaN(defaultSalvagePercent) || defaultSalvagePercent < 0 || defaultSalvagePercent > 100)) {
    throw badRequest("defaultSalvagePercent must be between 0 and 100");
  }

  const defaultSalvageAmountBase = req.body?.defaultSalvageAmountBase != null
    ? Number(req.body.defaultSalvageAmountBase)
    : null;
  if (defaultSalvageAmountBase !== null && (isNaN(defaultSalvageAmountBase) || defaultSalvageAmountBase < 0)) {
    throw badRequest("defaultSalvageAmountBase must be a non-negative number");
  }

  // Salvage rule consistency
  if (defaultSalvageRuleType === "PERCENT_OF_COST" && defaultSalvagePercent === null) {
    throw badRequest("defaultSalvagePercent is required when defaultSalvageRuleType is PERCENT_OF_COST");
  }
  if (defaultSalvageRuleType === "FIXED_BASE_AMOUNT" && defaultSalvageAmountBase === null) {
    throw badRequest("defaultSalvageAmountBase is required when defaultSalvageRuleType is FIXED_BASE_AMOUNT");
  }
  if (defaultSalvageRuleType === "NONE" && defaultSalvagePercent !== null) {
    throw badRequest("defaultSalvagePercent must be null when defaultSalvageRuleType is NONE");
  }
  if (defaultSalvageRuleType === "NONE" && defaultSalvageAmountBase !== null) {
    throw badRequest("defaultSalvageAmountBase must be null when defaultSalvageRuleType is NONE");
  }
  if (defaultSalvageRuleType === "PERCENT_OF_COST" && defaultSalvageAmountBase !== null) {
    throw badRequest("defaultSalvageAmountBase must be null when defaultSalvageRuleType is PERCENT_OF_COST");
  }
  if (defaultSalvageRuleType === "FIXED_BASE_AMOUNT" && defaultSalvagePercent !== null) {
    throw badRequest("defaultSalvagePercent must be null when defaultSalvageRuleType is FIXED_BASE_AMOUNT");
  }

  const defaultDepreciationProfileId = parsePositiveInt(req.body?.defaultDepreciationProfileId);
  const defaultAssetAccountId = parsePositiveInt(req.body?.defaultAssetAccountId);
  const defaultAccumDeprAccountId = parsePositiveInt(req.body?.defaultAccumDeprAccountId);
  const defaultDeprExpenseAccountId = parsePositiveInt(req.body?.defaultDeprExpenseAccountId);
  const defaultDisposalGainAccountId = parsePositiveInt(req.body?.defaultDisposalGainAccountId);
  const defaultDisposalLossAccountId = parsePositiveInt(req.body?.defaultDisposalLossAccountId);

  return {
    tenantId,
    legalEntityId,
    code,
    name,
    status,
    description,
    capitalizationThresholdBase,
    defaultUsefulLifeMonths,
    defaultSalvageRuleType,
    defaultSalvagePercent,
    defaultSalvageAmountBase,
    defaultDepreciationProfileId,
    defaultAssetAccountId,
    defaultAccumDeprAccountId,
    defaultDeprExpenseAccountId,
    defaultDisposalGainAccountId,
    defaultDisposalLossAccountId,
  };
}

export function parseCategoryUpdateInput(req) {
  const tenantId = resolveTenantId(req);
  if (!tenantId) throw badRequest("tenantId is required");

  const categoryId = parsePositiveInt(req.params?.categoryId);
  if (!categoryId) throw badRequest("categoryId is required");

  const updates = {};
  const body = req.body || {};

  if (body.code !== undefined) {
    const code = String(body.code).trim();
    if (!code) throw badRequest("code cannot be empty");
    updates.code = code;
  }

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) throw badRequest("name cannot be empty");
    updates.name = name;
  }

  if (body.status !== undefined) {
    const status = normalizeUpperText(body.status);
    if (!VALID_CATEGORY_STATUSES.has(status)) {
      throw badRequest(`status must be one of: ${[...VALID_CATEGORY_STATUSES].join(", ")}`);
    }
    updates.status = status;
  }

  if (body.description !== undefined) {
    updates.description = body.description != null
      ? String(body.description).trim() || null
      : null;
  }

  if (body.capitalizationThresholdBase !== undefined) {
    const v = body.capitalizationThresholdBase != null
      ? Number(body.capitalizationThresholdBase)
      : null;
    if (v !== null && (isNaN(v) || v < 0)) {
      throw badRequest("capitalizationThresholdBase must be a non-negative number");
    }
    updates.capitalizationThresholdBase = v;
  }

  if (body.defaultUsefulLifeMonths !== undefined) {
    updates.defaultUsefulLifeMonths = body.defaultUsefulLifeMonths != null
      ? parsePositiveInt(body.defaultUsefulLifeMonths)
      : null;
  }

  if (body.defaultSalvageRuleType !== undefined) {
    const srt = normalizeUpperText(body.defaultSalvageRuleType) || "NONE";
    if (!VALID_SALVAGE_RULE_TYPES.has(srt)) {
      throw badRequest(`defaultSalvageRuleType must be one of: ${[...VALID_SALVAGE_RULE_TYPES].join(", ")}`);
    }
    updates.defaultSalvageRuleType = srt;
  }

  if (body.defaultSalvagePercent !== undefined) {
    const v = body.defaultSalvagePercent != null
      ? Number(body.defaultSalvagePercent)
      : null;
    if (v !== null && (isNaN(v) || v < 0 || v > 100)) {
      throw badRequest("defaultSalvagePercent must be between 0 and 100");
    }
    updates.defaultSalvagePercent = v;
  }

  if (body.defaultSalvageAmountBase !== undefined) {
    const v = body.defaultSalvageAmountBase != null
      ? Number(body.defaultSalvageAmountBase)
      : null;
    if (v !== null && (isNaN(v) || v < 0)) {
      throw badRequest("defaultSalvageAmountBase must be a non-negative number");
    }
    updates.defaultSalvageAmountBase = v;
  }

  if (body.defaultDepreciationProfileId !== undefined) {
    updates.defaultDepreciationProfileId = body.defaultDepreciationProfileId != null
      ? parsePositiveInt(body.defaultDepreciationProfileId)
      : null;
  }

  if (body.defaultAssetAccountId !== undefined) {
    updates.defaultAssetAccountId = body.defaultAssetAccountId != null
      ? parsePositiveInt(body.defaultAssetAccountId)
      : null;
  }

  if (body.defaultAccumDeprAccountId !== undefined) {
    updates.defaultAccumDeprAccountId = body.defaultAccumDeprAccountId != null
      ? parsePositiveInt(body.defaultAccumDeprAccountId)
      : null;
  }

  if (body.defaultDeprExpenseAccountId !== undefined) {
    updates.defaultDeprExpenseAccountId = body.defaultDeprExpenseAccountId != null
      ? parsePositiveInt(body.defaultDeprExpenseAccountId)
      : null;
  }

  if (body.defaultDisposalGainAccountId !== undefined) {
    updates.defaultDisposalGainAccountId = body.defaultDisposalGainAccountId != null
      ? parsePositiveInt(body.defaultDisposalGainAccountId)
      : null;
  }

  if (body.defaultDisposalLossAccountId !== undefined) {
    updates.defaultDisposalLossAccountId = body.defaultDisposalLossAccountId != null
      ? parsePositiveInt(body.defaultDisposalLossAccountId)
      : null;
  }

  return { tenantId, categoryId, updates };
}

// ═══════════════════════════════════════════════════════════════════
// Depreciation profile validators
// ═══════════════════════════════════════════════════════════════════

export function parseProfileListFilters(req) {
  const tenantId = resolveTenantId(req);
  const legalEntityId = parsePositiveInt(req.query?.legalEntityId);
  const status = normalizeUpperText(req.query?.status);
  return { tenantId, legalEntityId, status };
}

export function parseProfileCreateInput(req) {
  const tenantId = resolveTenantId(req);
  if (!tenantId) throw badRequest("tenantId is required");

  const legalEntityId = parsePositiveInt(req.body?.legalEntityId);
  if (!legalEntityId) throw badRequest("legalEntityId is required");

  const code = String(req.body?.code ?? "").trim();
  if (!code) throw badRequest("code is required");

  const name = String(req.body?.name ?? "").trim();
  if (!name) throw badRequest("name is required");

  const status = normalizeUpperText(req.body?.status) || "ACTIVE";
  if (!VALID_PROFILE_STATUSES.has(status)) {
    throw badRequest(`status must be one of: ${[...VALID_PROFILE_STATUSES].join(", ")}`);
  }

  const method = normalizeUpperText(req.body?.method);
  if (!method) throw badRequest("method is required");
  if (!VALID_DEPRECIATION_METHODS.has(method)) {
    throw badRequest(`method must be one of: ${[...VALID_DEPRECIATION_METHODS].join(", ")}`);
  }

  const decliningBalanceRatePercent = req.body?.decliningBalanceRatePercent != null
    ? Number(req.body.decliningBalanceRatePercent)
    : null;
  if (decliningBalanceRatePercent !== null && (isNaN(decliningBalanceRatePercent) || decliningBalanceRatePercent <= 0 || decliningBalanceRatePercent > 100)) {
    throw badRequest("decliningBalanceRatePercent must be between 0 (exclusive) and 100");
  }

  // Method/rate compatibility
  if (method === "DECLINING_BALANCE" && decliningBalanceRatePercent === null) {
    throw badRequest("decliningBalanceRatePercent is required when method is DECLINING_BALANCE");
  }
  if (method !== "DECLINING_BALANCE" && decliningBalanceRatePercent !== null) {
    throw badRequest("decliningBalanceRatePercent must be null when method is not DECLINING_BALANCE");
  }

  const switchToStraightLine = req.body?.switchToStraightLine === true
    || req.body?.switchToStraightLine === 1
    || req.body?.switchToStraightLine === "1";

  const description = req.body?.description != null
    ? String(req.body.description).trim() || null
    : null;

  return {
    tenantId,
    legalEntityId,
    code,
    name,
    status,
    method,
    decliningBalanceRatePercent,
    switchToStraightLine,
    description,
  };
}

export function parseProfileUpdateInput(req) {
  const tenantId = resolveTenantId(req);
  if (!tenantId) throw badRequest("tenantId is required");

  const profileId = parsePositiveInt(req.params?.profileId);
  if (!profileId) throw badRequest("profileId is required");

  const updates = {};
  const body = req.body || {};

  if (body.code !== undefined) {
    const code = String(body.code).trim();
    if (!code) throw badRequest("code cannot be empty");
    updates.code = code;
  }

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) throw badRequest("name cannot be empty");
    updates.name = name;
  }

  if (body.status !== undefined) {
    const status = normalizeUpperText(body.status);
    if (!VALID_PROFILE_STATUSES.has(status)) {
      throw badRequest(`status must be one of: ${[...VALID_PROFILE_STATUSES].join(", ")}`);
    }
    updates.status = status;
  }

  if (body.method !== undefined) {
    const method = normalizeUpperText(body.method);
    if (!VALID_DEPRECIATION_METHODS.has(method)) {
      throw badRequest(`method must be one of: ${[...VALID_DEPRECIATION_METHODS].join(", ")}`);
    }
    updates.method = method;
  }

  if (body.decliningBalanceRatePercent !== undefined) {
    const v = body.decliningBalanceRatePercent != null
      ? Number(body.decliningBalanceRatePercent)
      : null;
    if (v !== null && (isNaN(v) || v <= 0 || v > 100)) {
      throw badRequest("decliningBalanceRatePercent must be between 0 (exclusive) and 100");
    }
    updates.decliningBalanceRatePercent = v;
  }

  if (body.switchToStraightLine !== undefined) {
    updates.switchToStraightLine = body.switchToStraightLine === true
      || body.switchToStraightLine === 1
      || body.switchToStraightLine === "1";
  }

  if (body.description !== undefined) {
    updates.description = body.description != null
      ? String(body.description).trim() || null
      : null;
  }

  return { tenantId, profileId, updates };
}

// ═══════════════════════════════════════════════════════════════════
// Custodian validators
// ═══════════════════════════════════════════════════════════════════

const VALID_CUSTODIAN_STATUSES = new Set(["ACTIVE", "INACTIVE"]);

export function parseCustodianListFilters(req) {
  const tenantId = resolveTenantId(req);
  const legalEntityId = parsePositiveInt(req.query?.legalEntityId);
  const operatingUnitId = parsePositiveInt(req.query?.operatingUnitId);
  const status = normalizeUpperText(req.query?.status);
  return { tenantId, legalEntityId, operatingUnitId, status };
}

export function parseCustodianCreateInput(req) {
  const tenantId = resolveTenantId(req);
  if (!tenantId) throw badRequest("tenantId is required");

  const legalEntityId = parsePositiveInt(req.body?.legalEntityId);
  if (!legalEntityId) throw badRequest("legalEntityId is required");

  const employeeCode = String(req.body?.employeeCode ?? "").trim();
  if (!employeeCode) throw badRequest("employeeCode is required");

  const displayName = String(req.body?.displayName ?? "").trim();
  if (!displayName) throw badRequest("displayName is required");

  const operatingUnitId = parsePositiveInt(req.body?.operatingUnitId);

  const status = normalizeUpperText(req.body?.status) || "ACTIVE";
  if (!VALID_CUSTODIAN_STATUSES.has(status)) {
    throw badRequest(`status must be one of: ${[...VALID_CUSTODIAN_STATUSES].join(", ")}`);
  }

  const notes = req.body?.notes != null
    ? String(req.body.notes).trim() || null
    : null;

  return {
    tenantId,
    legalEntityId,
    employeeCode,
    displayName,
    operatingUnitId,
    status,
    notes,
  };
}

export function parseCustodianUpdateInput(req) {
  const tenantId = resolveTenantId(req);
  if (!tenantId) throw badRequest("tenantId is required");

  const custodianId = parsePositiveInt(req.params?.custodianId);
  if (!custodianId) throw badRequest("custodianId is required");

  const updates = {};
  const body = req.body || {};

  if (body.employeeCode !== undefined) {
    const employeeCode = String(body.employeeCode).trim();
    if (!employeeCode) throw badRequest("employeeCode cannot be empty");
    updates.employeeCode = employeeCode;
  }

  if (body.displayName !== undefined) {
    const displayName = String(body.displayName).trim();
    if (!displayName) throw badRequest("displayName cannot be empty");
    updates.displayName = displayName;
  }

  if (body.operatingUnitId !== undefined) {
    updates.operatingUnitId = body.operatingUnitId != null
      ? parsePositiveInt(body.operatingUnitId)
      : null;
  }

  if (body.status !== undefined) {
    const status = normalizeUpperText(body.status);
    if (!VALID_CUSTODIAN_STATUSES.has(status)) {
      throw badRequest(`status must be one of: ${[...VALID_CUSTODIAN_STATUSES].join(", ")}`);
    }
    updates.status = status;
  }

  if (body.notes !== undefined) {
    updates.notes = body.notes != null
      ? String(body.notes).trim() || null
      : null;
  }

  return { tenantId, custodianId, updates };
}
