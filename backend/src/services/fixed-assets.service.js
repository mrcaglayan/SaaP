/**
 * Fixed-assets core service.
 *
 * Owns asset CRUD, lifecycle workflows (activation, capitalization,
 * move, transfer, disposal), and asset-level query logic.
 *
 * Later STEP-FA steps add real asset implementations here.
 */

import { query } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";

// ── Local helpers ─────────────────────────────────────────────────

function normalizeUpperText(value) {
  if (value === undefined || value === null) return null;
  return String(value).trim().toUpperCase();
}

// ── Account-type expectations per default-account field ───────────
const ACCOUNT_TYPE_RULES = [
  { field: "defaultAssetAccountId",        column: "default_asset_account_id",         expectedType: "ASSET",   label: "default asset account" },
  { field: "defaultAccumDeprAccountId",    column: "default_accum_depr_account_id",    expectedType: "ASSET",   label: "default accumulated depreciation account" },
  { field: "defaultDeprExpenseAccountId",  column: "default_depr_expense_account_id",  expectedType: "EXPENSE", label: "default depreciation expense account" },
  { field: "defaultDisposalGainAccountId", column: "default_disposal_gain_account_id", expectedType: "REVENUE", label: "default disposal gain account" },
  { field: "defaultDisposalLossAccountId", column: "default_disposal_loss_account_id", expectedType: "EXPENSE", label: "default disposal loss account" },
];

/**
 * Validate that `accountId` belongs to a LEGAL_ENTITY-scoped chart
 * matching `legalEntityId`, has the expected `account_type`, is active,
 * and allows posting.
 */
async function validateAccountForCategory(accountId, legalEntityId, tenantId, expectedType, label) {
  if (!accountId) return;

  const result = await query(
    `SELECT a.account_type,
            a.is_active,
            a.allow_posting,
            c.scope       AS coa_scope,
            c.legal_entity_id AS coa_legal_entity_id
       FROM accounts a
       JOIN charts_of_accounts c ON c.id = a.coa_id
      WHERE a.id = ?
        AND c.tenant_id = ?
      LIMIT 1`,
    [accountId, tenantId]
  );

  const row = result.rows?.[0];
  if (!row) {
    throw badRequest(`${label} (id=${accountId}) not found for tenant`);
  }

  if (normalizeUpperText(row.coa_scope) !== "LEGAL_ENTITY") {
    throw badRequest(`${label} must belong to a LEGAL_ENTITY chart of accounts`);
  }

  if (parsePositiveInt(row.coa_legal_entity_id) !== parsePositiveInt(legalEntityId)) {
    throw badRequest(`${label} must belong to the same legal entity (legalEntityId=${legalEntityId})`);
  }

  if (normalizeUpperText(row.account_type) !== normalizeUpperText(expectedType)) {
    throw badRequest(`${label} must be an ${expectedType} account, got ${normalizeUpperText(row.account_type)}`);
  }

  const isActive = row.is_active === 1 || row.is_active === true || row.is_active === "1";
  if (!isActive) {
    throw badRequest(`${label} must reference an active account`);
  }

  const allowPosting = row.allow_posting === 1 || row.allow_posting === true || row.allow_posting === "1";
  if (!allowPosting) {
    throw badRequest(`${label} must reference a postable account`);
  }
}

/**
 * Validate all supplied account fields against expected types and
 * legal-entity ownership.
 */
async function validateCategoryAccounts(payload, legalEntityId, tenantId) {
  for (const rule of ACCOUNT_TYPE_RULES) {
    const accountId = payload[rule.field];
    if (accountId) {
      await validateAccountForCategory(
        accountId,
        legalEntityId,
        tenantId,
        rule.expectedType,
        rule.label
      );
    }
  }
}

/**
 * Validate that depreciation profile belongs to the same legal entity.
 */
async function validateDepreciationProfileOwnership(profileId, legalEntityId, tenantId) {
  if (!profileId) return;

  const result = await query(
    `SELECT legal_entity_id
       FROM fixed_asset_depreciation_profiles
      WHERE id = ? AND tenant_id = ?
      LIMIT 1`,
    [profileId, tenantId]
  );

  const row = result.rows?.[0];
  if (!row) {
    throw badRequest(`Depreciation profile (id=${profileId}) not found for tenant`);
  }

  if (parsePositiveInt(row.legal_entity_id) !== parsePositiveInt(legalEntityId)) {
    throw badRequest(`Depreciation profile must belong to the same legal entity (legalEntityId=${legalEntityId})`);
  }
}

/**
 * Enforce salvage-rule consistency after merging updates.
 */
function enforceSalvageRuleConsistency(salvageRuleType, salvagePercent, salvageAmountBase) {
  if (salvageRuleType === "NONE") {
    if (salvagePercent !== null && salvagePercent !== undefined) {
      throw badRequest("defaultSalvagePercent must be null when defaultSalvageRuleType is NONE");
    }
    if (salvageAmountBase !== null && salvageAmountBase !== undefined) {
      throw badRequest("defaultSalvageAmountBase must be null when defaultSalvageRuleType is NONE");
    }
  }
  if (salvageRuleType === "PERCENT_OF_COST") {
    if (salvagePercent === null || salvagePercent === undefined) {
      throw badRequest("defaultSalvagePercent is required when defaultSalvageRuleType is PERCENT_OF_COST");
    }
    if (salvageAmountBase !== null && salvageAmountBase !== undefined) {
      throw badRequest("defaultSalvageAmountBase must be null when defaultSalvageRuleType is PERCENT_OF_COST");
    }
  }
  if (salvageRuleType === "FIXED_BASE_AMOUNT") {
    if (salvageAmountBase === null || salvageAmountBase === undefined) {
      throw badRequest("defaultSalvageAmountBase is required when defaultSalvageRuleType is FIXED_BASE_AMOUNT");
    }
    if (salvagePercent !== null && salvagePercent !== undefined) {
      throw badRequest("defaultSalvagePercent must be null when defaultSalvageRuleType is FIXED_BASE_AMOUNT");
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// Category CRUD
// ═══════════════════════════════════════════════════════════════════

function mapCategoryRow(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    legalEntityId: row.legal_entity_id,
    code: row.code,
    name: row.name,
    status: row.status,
    description: row.description || null,
    capitalizationThresholdBase: row.capitalization_threshold_base != null
      ? Number(row.capitalization_threshold_base)
      : null,
    defaultUsefulLifeMonths: row.default_useful_life_months != null
      ? Number(row.default_useful_life_months)
      : null,
    defaultSalvageRuleType: row.default_salvage_rule_type,
    defaultSalvagePercent: row.default_salvage_percent != null
      ? Number(row.default_salvage_percent)
      : null,
    defaultSalvageAmountBase: row.default_salvage_amount_base != null
      ? Number(row.default_salvage_amount_base)
      : null,
    defaultDepreciationProfileId: row.default_depreciation_profile_id != null
      ? Number(row.default_depreciation_profile_id)
      : null,
    defaultAssetAccountId: row.default_asset_account_id != null
      ? Number(row.default_asset_account_id)
      : null,
    defaultAccumDeprAccountId: row.default_accum_depr_account_id != null
      ? Number(row.default_accum_depr_account_id)
      : null,
    defaultDeprExpenseAccountId: row.default_depr_expense_account_id != null
      ? Number(row.default_depr_expense_account_id)
      : null,
    defaultDisposalGainAccountId: row.default_disposal_gain_account_id != null
      ? Number(row.default_disposal_gain_account_id)
      : null,
    defaultDisposalLossAccountId: row.default_disposal_loss_account_id != null
      ? Number(row.default_disposal_loss_account_id)
      : null,
    createdByUserId: row.created_by_user_id,
    updatedByUserId: row.updated_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listCategories({ tenantId, legalEntityId, status }) {
  if (!tenantId) throw badRequest("tenantId is required");

  const conditions = ["tenant_id = ?"];
  const params = [tenantId];

  if (legalEntityId) {
    conditions.push("legal_entity_id = ?");
    params.push(legalEntityId);
  }
  if (status) {
    conditions.push("status = ?");
    params.push(status);
  }

  const result = await query(
    `SELECT * FROM fixed_asset_categories
      WHERE ${conditions.join(" AND ")}
      ORDER BY code ASC`,
    params
  );

  return {
    rows: (result.rows || []).map(mapCategoryRow),
    total: result.rows?.length || 0,
  };
}

export async function createCategory({ payload }) {
  const {
    tenantId, legalEntityId, code, name, status, description,
    capitalizationThresholdBase, defaultUsefulLifeMonths,
    defaultSalvageRuleType, defaultSalvagePercent, defaultSalvageAmountBase,
    defaultDepreciationProfileId,
    defaultAssetAccountId, defaultAccumDeprAccountId,
    defaultDeprExpenseAccountId, defaultDisposalGainAccountId,
    defaultDisposalLossAccountId,
  } = payload;

  // Code uniqueness within (tenant_id, legal_entity_id)
  const existing = await query(
    `SELECT id FROM fixed_asset_categories
      WHERE tenant_id = ? AND legal_entity_id = ? AND code = ?
      LIMIT 1`,
    [tenantId, legalEntityId, code]
  );
  if (existing.rows?.length > 0) {
    throw badRequest(`A category with code '${code}' already exists in this legal entity`);
  }

  // Validate depreciation profile ownership
  await validateDepreciationProfileOwnership(
    defaultDepreciationProfileId, legalEntityId, tenantId
  );

  // Validate account types and legal-entity ownership
  await validateCategoryAccounts(payload, legalEntityId, tenantId);

  const userId = payload.userId || null;

  const insertResult = await query(
    `INSERT INTO fixed_asset_categories (
       tenant_id, legal_entity_id, code, name, status, description,
       capitalization_threshold_base, default_useful_life_months,
       default_salvage_rule_type, default_salvage_percent, default_salvage_amount_base,
       default_depreciation_profile_id,
       default_asset_account_id, default_accum_depr_account_id,
       default_depr_expense_account_id, default_disposal_gain_account_id,
       default_disposal_loss_account_id,
       created_by_user_id, updated_by_user_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tenantId, legalEntityId, code, name, status, description,
      capitalizationThresholdBase, defaultUsefulLifeMonths,
      defaultSalvageRuleType, defaultSalvagePercent, defaultSalvageAmountBase,
      defaultDepreciationProfileId,
      defaultAssetAccountId, defaultAccumDeprAccountId,
      defaultDeprExpenseAccountId, defaultDisposalGainAccountId,
      defaultDisposalLossAccountId,
      userId, userId,
    ]
  );

  const newId = insertResult.rows?.insertId;

  const readResult = await query(
    `SELECT * FROM fixed_asset_categories WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [newId, tenantId]
  );

  return mapCategoryRow(readResult.rows[0]);
}

export async function updateCategory({ tenantId, categoryId, updates, userId }) {
  if (!tenantId) throw badRequest("tenantId is required");
  if (!categoryId) throw badRequest("categoryId is required");

  // Load existing
  const existingResult = await query(
    `SELECT * FROM fixed_asset_categories WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [categoryId, tenantId]
  );
  const existing = existingResult.rows?.[0];
  if (!existing) {
    throw badRequest(`Category (id=${categoryId}) not found for tenant`);
  }

  const legalEntityId = existing.legal_entity_id;

  // Code uniqueness check if code is being changed
  if (updates.code !== undefined && updates.code !== existing.code) {
    const dup = await query(
      `SELECT id FROM fixed_asset_categories
        WHERE tenant_id = ? AND legal_entity_id = ? AND code = ? AND id != ?
        LIMIT 1`,
      [tenantId, legalEntityId, updates.code, categoryId]
    );
    if (dup.rows?.length > 0) {
      throw badRequest(`A category with code '${updates.code}' already exists in this legal entity`);
    }
  }

  // Validate depreciation profile ownership if changed
  if (updates.defaultDepreciationProfileId !== undefined) {
    await validateDepreciationProfileOwnership(
      updates.defaultDepreciationProfileId, legalEntityId, tenantId
    );
  }

  // Validate account types and legal-entity ownership for changed accounts
  for (const rule of ACCOUNT_TYPE_RULES) {
    if (updates[rule.field] !== undefined && updates[rule.field] !== null) {
      await validateAccountForCategory(
        updates[rule.field],
        legalEntityId,
        tenantId,
        rule.expectedType,
        rule.label
      );
    }
  }

  // Build merged salvage state for consistency check when any salvage field changes
  if (
    updates.defaultSalvageRuleType !== undefined ||
    updates.defaultSalvagePercent !== undefined ||
    updates.defaultSalvageAmountBase !== undefined
  ) {
    const mergedRuleType = updates.defaultSalvageRuleType !== undefined
      ? updates.defaultSalvageRuleType
      : existing.default_salvage_rule_type;
    const mergedPercent = updates.defaultSalvagePercent !== undefined
      ? updates.defaultSalvagePercent
      : (existing.default_salvage_percent != null ? Number(existing.default_salvage_percent) : null);
    const mergedAmountBase = updates.defaultSalvageAmountBase !== undefined
      ? updates.defaultSalvageAmountBase
      : (existing.default_salvage_amount_base != null ? Number(existing.default_salvage_amount_base) : null);

    enforceSalvageRuleConsistency(mergedRuleType, mergedPercent, mergedAmountBase);
  }

  // Build SET clause
  const setClauses = [];
  const setParams = [];

  const columnMap = {
    code: "code",
    name: "name",
    status: "status",
    description: "description",
    capitalizationThresholdBase: "capitalization_threshold_base",
    defaultUsefulLifeMonths: "default_useful_life_months",
    defaultSalvageRuleType: "default_salvage_rule_type",
    defaultSalvagePercent: "default_salvage_percent",
    defaultSalvageAmountBase: "default_salvage_amount_base",
    defaultDepreciationProfileId: "default_depreciation_profile_id",
    defaultAssetAccountId: "default_asset_account_id",
    defaultAccumDeprAccountId: "default_accum_depr_account_id",
    defaultDeprExpenseAccountId: "default_depr_expense_account_id",
    defaultDisposalGainAccountId: "default_disposal_gain_account_id",
    defaultDisposalLossAccountId: "default_disposal_loss_account_id",
  };

  for (const [jsField, dbColumn] of Object.entries(columnMap)) {
    if (updates[jsField] !== undefined) {
      setClauses.push(`${dbColumn} = ?`);
      setParams.push(updates[jsField]);
    }
  }

  if (userId) {
    setClauses.push("updated_by_user_id = ?");
    setParams.push(userId);
  }

  if (setClauses.length === 0) {
    return mapCategoryRow(existing);
  }

  setParams.push(categoryId, tenantId);

  await query(
    `UPDATE fixed_asset_categories
        SET ${setClauses.join(", ")}
      WHERE id = ? AND tenant_id = ?`,
    setParams
  );

  const readResult = await query(
    `SELECT * FROM fixed_asset_categories WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [categoryId, tenantId]
  );

  return mapCategoryRow(readResult.rows[0]);
}
