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
