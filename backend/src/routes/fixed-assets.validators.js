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

function normalizeUpperText(value) {
  if (value === undefined || value === null) return null;
  return String(value).trim().toUpperCase();
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
