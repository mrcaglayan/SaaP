/**
 * Fixed-assets core service.
 *
 * Owns asset CRUD, lifecycle workflows (activation, capitalization,
 * move, transfer, disposal), and asset-level query logic.
 *
 * Later STEP-FA steps add real asset implementations here.
 */

import { query, withTransaction } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import {
  buildCariDirectionalJournalLine,
  getCariDocumentByIdForTenant,
  insertPostedJournalWithLinesTx,
  resolveCariControlAccountTx,
} from "./cari.document.service.js";
import { upsertJournalSourceLinkTx } from "./journal.source-link.service.js";
import { resolveOuSelfBalancingAccountsTx } from "./ou.self-balancing.service.js";

// ── Local helpers ─────────────────────────────────────────────────

function normalizeUpperText(value) {
  if (value === undefined || value === null) return null;
  return String(value).trim().toUpperCase();
}

function formatDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function parseDateOnlyStrict(dateText, label) {
  const text = String(dateText || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw badRequest(`${label} must be YYYY-MM-DD`);
  }
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw badRequest(`${label} must be a valid date`);
  }
  return parsed;
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
async function validateAccountForCategory(accountId, legalEntityId, tenantId, expectedType, label, queryFn = query) {
  if (!accountId) return;

  const result = await queryFn(
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

async function validatePostableAccount(accountId, legalEntityId, tenantId, label, queryFn = query) {
  if (!accountId) {
    throw badRequest(`${label} is required`);
  }

  const result = await queryFn(
    `SELECT a.is_active,
            a.allow_posting,
            c.scope AS coa_scope,
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

  const isActive = row.is_active === 1 || row.is_active === true || row.is_active === "1";
  if (!isActive) {
    throw badRequest(`${label} must reference an active account`);
  }

  const allowPosting = row.allow_posting === 1 || row.allow_posting === true || row.allow_posting === "1";
  if (!allowPosting) {
    throw badRequest(`${label} must reference a postable account`);
  }
}

async function validateOperatingUnitBelongsToLegalEntity(
  operatingUnitId,
  legalEntityId,
  tenantId,
  label,
  queryFn = query
) {
  const normalizedOperatingUnitId = parsePositiveInt(operatingUnitId);
  if (!normalizedOperatingUnitId) {
    throw badRequest(`${label} is required`);
  }

  const result = await queryFn(
    `SELECT id, legal_entity_id
       FROM operating_units
      WHERE tenant_id = ?
        AND id = ?
      LIMIT 1`,
    [tenantId, normalizedOperatingUnitId]
  );
  const row = result.rows?.[0];
  if (!row) {
    throw badRequest(`${label} must belong to tenant`);
  }
  if (parsePositiveInt(row.legal_entity_id) !== parsePositiveInt(legalEntityId)) {
    throw badRequest(`${label} must belong to legalEntityId=${legalEntityId}`);
  }

  return normalizedOperatingUnitId;
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
// Asset register list
// ═══════════════════════════════════════════════════════════════════

function mapAssetRow(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    legalEntityId: row.legal_entity_id,
    assetNo: row.asset_no,
    sequenceNo: row.sequence_no != null ? Number(row.sequence_no) : null,
    assetTag: row.asset_tag || null,
    name: row.name,
    description: row.description || null,
    categoryId: row.category_id != null ? Number(row.category_id) : null,
    categoryCode: row.category_code || null,
    categoryName: row.category_name || null,
    status: row.status,
    ownerOperatingUnitId: row.owner_operating_unit_id != null
      ? Number(row.owner_operating_unit_id) : null,
    locationOperatingUnitId: row.location_operating_unit_id != null
      ? Number(row.location_operating_unit_id) : null,
    departmentCode: row.department_code || null,
    costCenterCode: row.cost_center_code || null,
    custodianEmployeeId: row.custodian_employee_id != null
      ? Number(row.custodian_employee_id) : null,
    custodianDisplayName: row.custodian_display_name || null,
    counterpartyId: row.counterparty_id != null
      ? Number(row.counterparty_id) : null,
    serialNo: row.serial_no || null,
    acquisitionDate: row.acquisition_date,
    capitalizationDate: row.capitalization_date || null,
    inServiceDate: row.in_service_date || null,
    disposalDate: row.disposal_date || null,
    currencyCode: row.currency_code,
    originalCostTxn: row.original_cost_txn != null
      ? Number(row.original_cost_txn) : 0,
    originalCostBase: row.original_cost_base != null
      ? Number(row.original_cost_base) : 0,
    salvageValueBase: row.salvage_value_base != null
      ? Number(row.salvage_value_base) : 0,
    usefulLifeMonths: row.useful_life_months != null
      ? Number(row.useful_life_months) : null,
    remainingUsefulLifeMonths: row.remaining_useful_life_months != null
      ? Number(row.remaining_useful_life_months) : null,
    depreciationMethod: row.depreciation_method || null,
    lastDepreciationPeriod: row.last_depreciation_period || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listAssets(filters) {
  const {
    tenantId, legalEntityId, ownerOperatingUnitId, locationOperatingUnitId,
    categoryId, custodianId, status,
    acquisitionDateFrom, acquisitionDateTo,
    inServiceDateFrom, inServiceDateTo,
    departmentCode, costCenterCode, disposed,
  } = filters;

  if (!tenantId) throw badRequest("tenantId is required");

  const conditions = ["fa.tenant_id = ?"];
  const params = [tenantId];

  if (legalEntityId) {
    conditions.push("fa.legal_entity_id = ?");
    params.push(legalEntityId);
  }
  if (ownerOperatingUnitId) {
    conditions.push("fa.owner_operating_unit_id = ?");
    params.push(ownerOperatingUnitId);
  }
  if (locationOperatingUnitId) {
    conditions.push("fa.location_operating_unit_id = ?");
    params.push(locationOperatingUnitId);
  }
  if (categoryId) {
    conditions.push("fa.category_id = ?");
    params.push(categoryId);
  }
  if (custodianId) {
    conditions.push("fa.custodian_employee_id = ?");
    params.push(custodianId);
  }
  if (status) {
    conditions.push("fa.status = ?");
    params.push(status);
  }
  if (acquisitionDateFrom) {
    conditions.push("fa.acquisition_date >= ?");
    params.push(acquisitionDateFrom);
  }
  if (acquisitionDateTo) {
    conditions.push("fa.acquisition_date <= ?");
    params.push(acquisitionDateTo);
  }
  if (inServiceDateFrom) {
    conditions.push("fa.in_service_date >= ?");
    params.push(inServiceDateFrom);
  }
  if (inServiceDateTo) {
    conditions.push("fa.in_service_date <= ?");
    params.push(inServiceDateTo);
  }
  if (departmentCode) {
    conditions.push("fa.department_code = ?");
    params.push(departmentCode);
  }
  if (costCenterCode) {
    conditions.push("fa.cost_center_code = ?");
    params.push(costCenterCode);
  }

  // disposed filtering based on lifecycle state
  if (disposed === true) {
    conditions.push("fa.status = 'DISPOSED'");
  } else if (disposed === false) {
    conditions.push("fa.status != 'DISPOSED'");
  }

  const result = await query(
    `SELECT fa.*,
            cat.code   AS category_code,
            cat.name   AS category_name,
            cust.display_name AS custodian_display_name
       FROM fixed_assets fa
       LEFT JOIN fixed_asset_categories cat ON cat.id = fa.category_id
       LEFT JOIN fixed_asset_custodian_employees cust ON cust.id = fa.custodian_employee_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY fa.asset_no ASC`,
    params
  );

  return {
    rows: (result.rows || []).map(mapAssetRow),
    total: result.rows?.length || 0,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Asset detail
// ═══════════════════════════════════════════════════════════════════

export async function getAssetDetail({ tenantId, assetId }) {
  if (!tenantId) throw badRequest("tenantId is required");
  if (!assetId) throw badRequest("assetId is required");

  // ── Main asset row with joined lookups ──────────────────────────
  const result = await query(
    `SELECT fa.*,
            cat.code                  AS category_code,
            cat.name                  AS category_name,
            cust.display_name         AS custodian_display_name,
            cust.employee_code        AS custodian_employee_code,
            dp.code                   AS profile_code,
            dp.name                   AS profile_name
       FROM fixed_assets fa
       LEFT JOIN fixed_asset_categories cat    ON cat.id  = fa.category_id
       LEFT JOIN fixed_asset_custodian_employees cust ON cust.id = fa.custodian_employee_id
       LEFT JOIN fixed_asset_depreciation_profiles dp ON dp.id = fa.depreciation_profile_id
      WHERE fa.tenant_id = ? AND fa.id = ?
      LIMIT 1`,
    [tenantId, assetId]
  );

  const row = result.rows?.[0];
  if (!row) {
    throw badRequest(`Asset (id=${assetId}) not found for tenant`);
  }

  // ── Transaction summary ─────────────────────────────────────────
  const txnSummary = await query(
    `SELECT COUNT(*)        AS total_count,
            SUM(CASE WHEN status = 'POSTED' THEN 1 ELSE 0 END)   AS posted_count,
            SUM(CASE WHEN status = 'REVERSED' THEN 1 ELSE 0 END) AS reversed_count,
            MAX(effective_date) AS latest_effective_date,
            MAX(posting_date)   AS latest_posting_date
       FROM fixed_asset_transactions
      WHERE tenant_id = ? AND asset_id = ?`,
    [tenantId, assetId]
  );
  const txnRow = txnSummary.rows?.[0];

  // ── Build detail payload ────────────────────────────────────────
  return {
    // ── Identity ──────────────────────────────────────────────────
    id: row.id,
    tenantId: row.tenant_id,
    legalEntityId: row.legal_entity_id,
    assetNo: row.asset_no,
    sequenceNo: row.sequence_no != null ? Number(row.sequence_no) : null,
    assetTag: row.asset_tag || null,
    name: row.name,
    description: row.description || null,
    serialNo: row.serial_no || null,

    // ── Lifecycle status ──────────────────────────────────────────
    status: row.status,

    // ── Category (lineage) ────────────────────────────────────────
    categoryId: row.category_id != null ? Number(row.category_id) : null,
    categoryCode: row.category_code || null,
    categoryName: row.category_name || null,

    // ── Owner / Location / Custodian (separate & independent) ────
    ownerOperatingUnitId: row.owner_operating_unit_id != null
      ? Number(row.owner_operating_unit_id) : null,
    locationOperatingUnitId: row.location_operating_unit_id != null
      ? Number(row.location_operating_unit_id) : null,
    departmentCode: row.department_code || null,
    costCenterCode: row.cost_center_code || null,
    custodianEmployeeId: row.custodian_employee_id != null
      ? Number(row.custodian_employee_id) : null,
    custodianEmployeeCode: row.custodian_employee_code || null,
    custodianDisplayName: row.custodian_display_name || null,
    counterpartyId: row.counterparty_id != null
      ? Number(row.counterparty_id) : null,

    // ── Source CARI linkage ───────────────────────────────────────
    sourceCariDocumentId: row.source_cari_document_id != null
      ? Number(row.source_cari_document_id) : null,
    sourceCariDocumentLineId: row.source_cari_document_line_id != null
      ? Number(row.source_cari_document_line_id) : null,
    sourceCariDocumentLineUnitNo: row.source_cari_document_line_unit_no != null
      ? Number(row.source_cari_document_line_unit_no) : null,

    // ── Key dates ─────────────────────────────────────────────────
    acquisitionDate: row.acquisition_date,
    capitalizationDate: row.capitalization_date || null,
    inServiceDate: row.in_service_date || null,
    disposalDate: row.disposal_date || null,

    // ── Cost ──────────────────────────────────────────────────────
    currencyCode: row.currency_code,
    originalCostTxn: row.original_cost_txn != null
      ? Number(row.original_cost_txn) : 0,
    originalCostBase: row.original_cost_base != null
      ? Number(row.original_cost_base) : 0,

    // ── Salvage snapshot inputs (frozen at asset level) ───────────
    salvageRuleType: row.salvage_rule_type,
    salvagePercent: row.salvage_percent != null
      ? Number(row.salvage_percent) : null,
    salvageAmountBaseRule: row.salvage_amount_base_rule != null
      ? Number(row.salvage_amount_base_rule) : null,

    // ── Resolved salvage values ──────────────────────────────────
    salvageValueTxn: row.salvage_value_txn != null
      ? Number(row.salvage_value_txn) : 0,
    salvageValueBase: row.salvage_value_base != null
      ? Number(row.salvage_value_base) : 0,

    // ── Depreciation profile linkage (lineage) ───────────────────
    depreciationProfileId: row.depreciation_profile_id != null
      ? Number(row.depreciation_profile_id) : null,
    profileCode: row.profile_code || null,
    profileName: row.profile_name || null,

    // ── Snapped depreciation runtime fields (frozen at asset) ────
    depreciationMethod: row.depreciation_method || null,
    decliningBalanceRatePercent: row.declining_balance_rate_percent != null
      ? Number(row.declining_balance_rate_percent) : null,
    switchToStraightLine: row.switch_to_straight_line === 1
      || row.switch_to_straight_line === true
      || row.switch_to_straight_line === "1",
    usefulLifeMonths: row.useful_life_months != null
      ? Number(row.useful_life_months) : null,
    remainingUsefulLifeMonths: row.remaining_useful_life_months != null
      ? Number(row.remaining_useful_life_months) : null,
    lastDepreciationPeriod: row.last_depreciation_period || null,

    // ── Account mappings ─────────────────────────────────────────
    assetAccountId: row.asset_account_id != null
      ? Number(row.asset_account_id) : null,
    accumDeprAccountId: row.accum_depr_account_id != null
      ? Number(row.accum_depr_account_id) : null,
    deprExpenseAccountId: row.depr_expense_account_id != null
      ? Number(row.depr_expense_account_id) : null,
    disposalGainAccountId: row.disposal_gain_account_id != null
      ? Number(row.disposal_gain_account_id) : null,
    disposalLossAccountId: row.disposal_loss_account_id != null
      ? Number(row.disposal_loss_account_id) : null,

    // ── Legacy onboarding fields ─────────────────────────────────
    legacyAccumDeprTxn: row.legacy_accum_depr_txn != null
      ? Number(row.legacy_accum_depr_txn) : null,
    legacyAccumDeprBase: row.legacy_accum_depr_base != null
      ? Number(row.legacy_accum_depr_base) : null,
    legacyNbvTxn: row.legacy_nbv_txn != null
      ? Number(row.legacy_nbv_txn) : null,
    legacyNbvBase: row.legacy_nbv_base != null
      ? Number(row.legacy_nbv_base) : null,

    // ── Transaction history summary (foundation) ─────────────────
    transactionSummary: {
      totalCount: Number(txnRow?.total_count ?? 0),
      postedCount: Number(txnRow?.posted_count ?? 0),
      reversedCount: Number(txnRow?.reversed_count ?? 0),
      latestEffectiveDate: txnRow?.latest_effective_date || null,
      latestPostingDate: txnRow?.latest_posting_date || null,
    },

    // ── Evidence summary (foundation — table not yet created) ────
    evidenceSummary: {
      totalCount: 0,
    },

    // ── Audit trail ──────────────────────────────────────────────
    createdByUserId: row.created_by_user_id,
    updatedByUserId: row.updated_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAssetDepreciationSnapshotRow(row) {
  return {
    id: Number(row.id),
    tenantId: Number(row.tenant_id),
    legalEntityId: Number(row.legal_entity_id),
    assetNo: row.asset_no || null,
    name: row.name || null,
    status: row.status || null,
    ownerOperatingUnitId: row.owner_operating_unit_id != null
      ? Number(row.owner_operating_unit_id)
      : null,
    inServiceDate: row.in_service_date || null,
    capitalizationDate: row.capitalization_date || null,
    acquisitionDate: row.acquisition_date || null,
    disposalDate: row.disposal_date || null,
    currencyCode: row.currency_code || null,
    originalCostTxn: row.original_cost_txn != null ? Number(row.original_cost_txn) : 0,
    originalCostBase: row.original_cost_base != null ? Number(row.original_cost_base) : 0,
    salvageValueTxn: row.salvage_value_txn != null ? Number(row.salvage_value_txn) : 0,
    salvageValueBase: row.salvage_value_base != null ? Number(row.salvage_value_base) : 0,
    depreciationMethod: row.depreciation_method || null,
    decliningBalanceRatePercent: row.declining_balance_rate_percent != null
      ? Number(row.declining_balance_rate_percent)
      : null,
    switchToStraightLine: row.switch_to_straight_line === 1
      || row.switch_to_straight_line === true
      || row.switch_to_straight_line === "1",
    usefulLifeMonths: row.useful_life_months != null ? Number(row.useful_life_months) : null,
    remainingUsefulLifeMonths: row.remaining_useful_life_months != null
      ? Number(row.remaining_useful_life_months)
      : null,
    depreciationProfileId: row.depreciation_profile_id != null
      ? Number(row.depreciation_profile_id)
      : null,
    lastDepreciationPeriod: row.last_depreciation_period || null,
    legacyAccumDeprTxn: row.legacy_accum_depr_txn != null ? Number(row.legacy_accum_depr_txn) : null,
    legacyAccumDeprBase: row.legacy_accum_depr_base != null ? Number(row.legacy_accum_depr_base) : null,
    legacyNbvTxn: row.legacy_nbv_txn != null ? Number(row.legacy_nbv_txn) : null,
    legacyNbvBase: row.legacy_nbv_base != null ? Number(row.legacy_nbv_base) : null,
  };
}

export async function loadAssetDepreciationSnapshot({ tenantId, assetId, queryFn = query }) {
  if (!tenantId) throw badRequest("tenantId is required");
  if (!assetId) throw badRequest("assetId is required");

  const result = await queryFn(
    `SELECT id,
            tenant_id,
            legal_entity_id,
            status,
            owner_operating_unit_id,
            acquisition_date,
            capitalization_date,
            in_service_date,
            disposal_date,
            currency_code,
            original_cost_txn,
            original_cost_base,
            salvage_value_txn,
            salvage_value_base,
            useful_life_months,
            remaining_useful_life_months,
            depreciation_profile_id,
            depreciation_method,
            declining_balance_rate_percent,
            switch_to_straight_line,
            legacy_accum_depr_txn,
            legacy_accum_depr_base,
            legacy_nbv_txn,
            legacy_nbv_base,
            last_depreciation_period
       FROM fixed_assets
      WHERE tenant_id = ?
        AND id = ?
      LIMIT 1`,
    [tenantId, assetId]
  );

  const row = result.rows?.[0];
  if (!row) {
    throw badRequest(`Asset (id=${assetId}) not found for tenant`);
  }

  return mapAssetDepreciationSnapshotRow(row);
}

export async function listDepreciationRunAssetSnapshots({
  tenantId,
  legalEntityId,
  queryFn = query,
}) {
  if (!tenantId) throw badRequest("tenantId is required");
  if (!legalEntityId) throw badRequest("legalEntityId is required");

  const result = await queryFn(
    `SELECT id,
            tenant_id,
            legal_entity_id,
            asset_no,
            name,
            status,
            owner_operating_unit_id,
            acquisition_date,
            capitalization_date,
            in_service_date,
            disposal_date,
            currency_code,
            original_cost_txn,
            original_cost_base,
            salvage_value_txn,
            salvage_value_base,
            useful_life_months,
            remaining_useful_life_months,
            depreciation_profile_id,
            depreciation_method,
            declining_balance_rate_percent,
            switch_to_straight_line,
            legacy_accum_depr_txn,
            legacy_accum_depr_base,
            legacy_nbv_txn,
            legacy_nbv_base,
            last_depreciation_period
       FROM fixed_assets
      WHERE tenant_id = ?
        AND legal_entity_id = ?
        AND status <> 'DRAFT'
      ORDER BY asset_no ASC, id ASC`,
    [tenantId, legalEntityId]
  );

  return (result.rows || []).map(mapAssetDepreciationSnapshotRow);
}

// ═══════════════════════════════════════════════════════════════════
function mapAssetDepreciationLifecycleRow(row) {
  return {
    transactionId: Number(row.id),
    transactionType: row.transaction_type || null,
    status: row.status || null,
    effectiveDate: row.effective_date ? String(row.effective_date).slice(0, 10) : null,
    depreciationKind: row.depreciation_kind || null,
    fromOwnerOperatingUnitId: row.from_owner_operating_unit_id != null
      ? Number(row.from_owner_operating_unit_id)
      : null,
    toOwnerOperatingUnitId: row.to_owner_operating_unit_id != null
      ? Number(row.to_owner_operating_unit_id)
      : null,
  };
}

export async function loadAssetDepreciationLifecycleHistory({
  tenantId,
  assetId,
  queryFn = query,
}) {
  if (!tenantId) throw badRequest("tenantId is required");
  if (!assetId) throw badRequest("assetId is required");

  const result = await queryFn(
    `SELECT fat.id,
            fat.transaction_type,
            fat.status,
            fat.effective_date,
            fat.depreciation_kind,
            transfer.from_owner_operating_unit_id,
            transfer.to_owner_operating_unit_id
       FROM fixed_asset_transactions fat
       LEFT JOIN fixed_asset_ownership_transfer_details transfer
         ON transfer.transaction_id = fat.id
      WHERE fat.tenant_id = ?
        AND fat.asset_id = ?
        AND fat.status = 'POSTED'
        AND fat.transaction_type <> 'REVERSAL'
        AND fat.reversal_transaction_id IS NULL
        AND NOT EXISTS (
          SELECT 1
            FROM fixed_asset_transactions rev
           WHERE rev.reversed_transaction_id = fat.id
             AND rev.status = 'POSTED'
        )
      ORDER BY fat.effective_date ASC, fat.id ASC`,
    [tenantId, assetId]
  );

  return (result.rows || []).map(mapAssetDepreciationLifecycleRow);
}

const FA06_REQUIRED_DOCUMENT_DIRECTION = "AP";
const FA06_REQUIRED_DOCUMENT_STATUS = "POSTED";
const FA06_REQUIRED_LINE_KIND = "STANDARD";
const FA06_SPLIT_AMOUNT_SCALE = 10000;

function isPositiveWholeUnitQuantity(quantity) {
  const normalized = Number(quantity);
  return Number.isInteger(normalized) && normalized > 0;
}

function isEvenlySplittableAmount(amount, unitQuantity) {
  if (!Number.isInteger(unitQuantity) || unitQuantity <= 0) {
    return false;
  }

  const normalized = Number(amount);
  if (!Number.isFinite(normalized)) {
    return false;
  }

  const scaledAmount = Math.round(normalized * FA06_SPLIT_AMOUNT_SCALE);
  return scaledAmount % unitQuantity === 0;
}

function isEqualPerUnitSplitValidForMvp(line, unitQuantity) {
  if (!Number.isInteger(unitQuantity) || unitQuantity <= 0) {
    return false;
  }

  return [
    line?.lineNetAmountTxn,
    line?.lineGrossAmountTxn,
    line?.lineNetAmountBase,
    line?.lineGrossAmountBase,
  ].every((amount) => isEvenlySplittableAmount(amount, unitQuantity));
}

async function loadCariLineReservedUnitNumbers({
  tenantId,
  sourceCariDocumentId,
  queryFn = query,
}) {
  const result = await queryFn(
    `SELECT source_cari_document_line_id,
            source_cari_document_line_unit_no
       FROM fixed_assets
      WHERE tenant_id = ?
        AND source_cari_document_id = ?
        AND source_cari_document_line_id IS NOT NULL
        AND source_cari_document_line_unit_no IS NOT NULL`,
    [tenantId, sourceCariDocumentId]
  );

  const reservedUnitNumbersByLineId = new Map();

  for (const row of result.rows || []) {
    const lineId = parsePositiveInt(row.source_cari_document_line_id);
    const unitNo = parsePositiveInt(row.source_cari_document_line_unit_no);
    if (!lineId || !unitNo) {
      continue;
    }

    let reserved = reservedUnitNumbersByLineId.get(lineId);
    if (!reserved) {
      reserved = new Set();
      reservedUnitNumbersByLineId.set(lineId, reserved);
    }
    reserved.add(unitNo);
  }

  return reservedUnitNumbersByLineId;
}

function buildCariEligibleApLineRow({
  document,
  line,
  reservedUnitNumbers,
  requestedUnitCount,
}) {
  const normalizedDirection = normalizeUpperText(document?.direction);
  const normalizedStatus = normalizeUpperText(document?.status);
  const normalizedLineKind = normalizeUpperText(line?.lineKind || FA06_REQUIRED_LINE_KIND);

  const positiveWholeUnitQuantityValid = isPositiveWholeUnitQuantity(line?.quantity);
  const totalUnitQuantity = positiveWholeUnitQuantityValid ? Number(line.quantity) : 0;
  const consumedUnitNumbers = Array.from(reservedUnitNumbers || [])
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0)
    .sort((a, b) => a - b);
  const consumedUnitCount = positiveWholeUnitQuantityValid
    ? Math.min(consumedUnitNumbers.length, totalUnitQuantity)
    : 0;
  const currentRemainingUnits = positiveWholeUnitQuantityValid
    ? Math.max(totalUnitQuantity - consumedUnitCount, 0)
    : 0;
  const equalSplitValidForMvp = positiveWholeUnitQuantityValid
    ? isEqualPerUnitSplitValidForMvp(line, totalUnitQuantity)
    : false;

  const ineligibleReasons = [];
  if (normalizedDirection !== FA06_REQUIRED_DOCUMENT_DIRECTION) {
    ineligibleReasons.push("DOCUMENT_DIRECTION_MUST_BE_AP");
  }
  if (normalizedStatus !== FA06_REQUIRED_DOCUMENT_STATUS) {
    ineligibleReasons.push("DOCUMENT_STATUS_MUST_BE_POSTED");
  }
  if (normalizedLineKind !== FA06_REQUIRED_LINE_KIND) {
    ineligibleReasons.push("LINE_KIND_MUST_BE_STANDARD");
  }
  if (!positiveWholeUnitQuantityValid) {
    ineligibleReasons.push("QUANTITY_MUST_BE_POSITIVE_WHOLE_UNITS");
  }
  if (positiveWholeUnitQuantityValid && !equalSplitValidForMvp) {
    ineligibleReasons.push("EQUAL_PER_UNIT_SPLIT_NOT_SUPPORTED_FOR_MVP");
  }
  if (positiveWholeUnitQuantityValid && currentRemainingUnits <= 0) {
    ineligibleReasons.push("NO_REMAINING_UNCONSUMED_UNITS");
  }
  if (
    requestedUnitCount != null
    && positiveWholeUnitQuantityValid
    && requestedUnitCount > currentRemainingUnits
  ) {
    ineligibleReasons.push("REQUESTED_UNIT_COUNT_EXCEEDS_REMAINING_UNITS");
  }

  return {
    lineId: line?.id != null ? Number(line.id) : null,
    lineNo: line?.lineNo != null ? Number(line.lineNo) : null,
    lineKind: line?.lineKind || null,
    description: line?.description || null,
    quantity: line?.quantity != null ? Number(line.quantity) : null,
    unitPriceTxn: line?.unitPriceTxn != null ? Number(line.unitPriceTxn) : null,
    lineNetAmountTxn: line?.lineNetAmountTxn != null ? Number(line.lineNetAmountTxn) : null,
    lineGrossAmountTxn: line?.lineGrossAmountTxn != null ? Number(line.lineGrossAmountTxn) : null,
    lineNetAmountBase: line?.lineNetAmountBase != null ? Number(line.lineNetAmountBase) : null,
    lineGrossAmountBase: line?.lineGrossAmountBase != null ? Number(line.lineGrossAmountBase) : null,
    postingAccountId: line?.postingAccountId != null ? Number(line.postingAccountId) : null,
    totalUnitQuantity,
    consumedUnitCount,
    consumedUnitNumbers,
    currentRemainingUnits,
    positiveWholeUnitQuantityValid,
    equalSplitValidForMvp,
    requestedUnitCount: requestedUnitCount ?? null,
    requestedUnitCountValid: requestedUnitCount == null
      ? true
      : requestedUnitCount <= currentRemainingUnits,
    eligibleForFa06: ineligibleReasons.length === 0,
    ineligibleReasons,
  };
}

export async function listCariEligibleApLinesForFa06({
  req,
  tenantId,
  sourceCariDocumentId,
  unitCount,
  assertScopeAccess,
}) {
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  if (!sourceCariDocumentId) {
    throw badRequest("sourceCariDocumentId is required");
  }

  const document = await getCariDocumentByIdForTenant({
    req,
    tenantId,
    documentId: sourceCariDocumentId,
    assertScopeAccess,
  });

  const reservedUnitNumbersByLineId = await loadCariLineReservedUnitNumbers({
    tenantId,
    sourceCariDocumentId,
  });

  const rows = (Array.isArray(document?.lines) ? document.lines : []).map((line) =>
    buildCariEligibleApLineRow({
      document,
      line,
      reservedUnitNumbers: reservedUnitNumbersByLineId.get(Number(line?.id)) || [],
      requestedUnitCount: unitCount ?? null,
    })
  );

  return {
    tenantId,
    sourceCariDocumentId,
    requestedUnitCount: unitCount ?? null,
    document: {
      id: document.id,
      legalEntityId: document.legalEntityId,
      operatingUnitId: document.operatingUnitId,
      status: document.status,
      direction: document.direction,
      documentType: document.documentType,
      currencyCode: document.currencyCode,
      grossAmountTxn: document.grossAmountTxn,
      grossAmountBase: document.grossAmountBase,
    },
    rows,
    total: rows.length,
    eligibleTotal: rows.filter((row) => row.eligibleForFa06).length,
  };
}

function formatFa06IneligibleReasons(reasons) {
  return (Array.isArray(reasons) ? reasons : [])
    .filter(Boolean)
    .join(", ");
}

function allocateLowestAvailableUnitNumbers(totalUnitQuantity, consumedUnitNumbers, requestedUnitCount) {
  const reserved = new Set(
    (Array.isArray(consumedUnitNumbers) ? consumedUnitNumbers : [])
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0)
  );

  const allocated = [];
  for (let unitNo = 1; unitNo <= Number(totalUnitQuantity || 0); unitNo += 1) {
    if (reserved.has(unitNo)) {
      continue;
    }
    allocated.push(unitNo);
    if (allocated.length >= requestedUnitCount) {
      break;
    }
  }
  return allocated;
}

function computeFa06PerUnitAmounts(line, totalUnitQuantity) {
  if (!Number.isInteger(totalUnitQuantity) || totalUnitQuantity <= 0) {
    throw badRequest("Source line quantity must be positive whole units for FA06 capitalization");
  }

  const sourceCostTxn = Number(line?.lineNetAmountTxn);
  const sourceCostBase = Number(line?.lineNetAmountBase);
  if (!Number.isFinite(sourceCostTxn) || !Number.isFinite(sourceCostBase)) {
    throw badRequest("Source line net amounts must be present for FA06 capitalization");
  }

  const originalCostTxn = roundActivationAmount(sourceCostTxn / totalUnitQuantity);
  const originalCostBase = roundActivationAmount(sourceCostBase / totalUnitQuantity);
  if (originalCostTxn <= 0 || originalCostBase <= 0) {
    throw badRequest("Per-unit source amounts must be greater than 0 for FA06 capitalization");
  }

  return {
    originalCostTxn,
    originalCostBase,
  };
}

function buildFa06AssetName({ line, category, unitNo, totalUnitQuantity }) {
  const baseName = String(
    line?.description
    || category?.name
    || `CARI line ${Number(line?.lineNo || 0)}`
  ).trim();

  if (Number(totalUnitQuantity || 0) > 1) {
    return `${baseName} (Unit ${unitNo})`.slice(0, 255);
  }
  return baseName.slice(0, 255);
}

function buildFa06AssetDescription({ document, line, unitNo, totalUnitQuantity }) {
  const baseDescription = String(
    line?.description
    || `Capitalized from CARI document ${document?.documentNo || document?.id}`
  ).trim();
  const suffix = Number(totalUnitQuantity || 0) > 1
    ? ` | Source unit ${unitNo}`
    : "";
  return `${baseDescription}${suffix}`.slice(0, 255);
}

function buildFa06JournalNo(assetId) {
  return `FA-CAP-${parsePositiveInt(assetId)}-${Date.now().toString(36).toUpperCase()}`.slice(0, 40);
}

function buildFa06LowValueJournalNo(assetId) {
  return `FA-LV-${parsePositiveInt(assetId)}-${Date.now().toString(36).toUpperCase()}`.slice(0, 40);
}

function buildFa06ReferenceNo({ document, line, unitNo }) {
  return `CARI:${document?.documentNo || document?.id}:L${Number(line?.lineNo || 0)}:U${unitNo}`.slice(0, 100);
}

function assertFa06CrossOuSelfBalancingSetup({
  selfBalancingAccounts,
  sourceOperatingUnitId,
  targetOperatingUnitId,
}) {
  const normalizedSourceOperatingUnitId = parsePositiveInt(sourceOperatingUnitId);
  const normalizedTargetOperatingUnitId = parsePositiveInt(targetOperatingUnitId);
  const resolvedSourceOperatingUnitId = parsePositiveInt(
    selfBalancingAccounts?.sourceContext?.operatingUnitId
  );
  const resolvedTargetOperatingUnitId = parsePositiveInt(
    selfBalancingAccounts?.targetContext?.operatingUnitId
  );

  if (selfBalancingAccounts?.routeType !== "OU_TO_OU") {
    throw badRequest(
      "Cross-OU FA06 capitalization requires a direct OU_TO_OU self-balancing route"
    );
  }
  if (resolvedSourceOperatingUnitId !== normalizedSourceOperatingUnitId) {
    throw badRequest(
      `Cross-OU FA06 capitalization resolved the wrong source direction (expected sourceOperatingUnitId=${normalizedSourceOperatingUnitId}, got ${resolvedSourceOperatingUnitId || "null"})`
    );
  }
  if (resolvedTargetOperatingUnitId !== normalizedTargetOperatingUnitId) {
    throw badRequest(
      `Cross-OU FA06 capitalization resolved the wrong target direction (expected targetOperatingUnitId=${normalizedTargetOperatingUnitId}, got ${resolvedTargetOperatingUnitId || "null"})`
    );
  }
  if (!selfBalancingAccounts?.sourceDueFromAccount?.id) {
    throw badRequest("Cross-OU FA06 capitalization self-balancing source due-from account is missing");
  }
  if (!selfBalancingAccounts?.sourceDueToAccount?.id) {
    throw badRequest("Cross-OU FA06 capitalization self-balancing source due-to account is missing");
  }
  if (!selfBalancingAccounts?.targetDueFromAccount?.id) {
    throw badRequest("Cross-OU FA06 capitalization self-balancing target due-from account is missing");
  }
  if (!selfBalancingAccounts?.targetDueToAccount?.id) {
    throw badRequest("Cross-OU FA06 capitalization self-balancing target due-to account is missing");
  }
}

function buildFa06CapitalizationJournalLines({
  assetAccountId,
  sourceLinePostingAccountId,
  sourceApControlAccountId = null,
  isCrossOuCapitalization,
  originalCostTxn,
  originalCostBase,
  currencyCode,
  assetNo,
  ownerOperatingUnitId,
  sourceOperatingUnitId,
  selfBalancingAccounts = null,
}) {
  const ownerAssetDescription = `FA capitalization ${assetNo}`.slice(0, 255);

  if (!isCrossOuCapitalization) {
    return [
      buildCariDirectionalJournalLine({
        accountId: assetAccountId,
        side: "DEBIT",
        amountTxn: originalCostTxn,
        amountBase: originalCostBase,
        lineDescription: ownerAssetDescription,
        subledgerReferenceNo: assetNo,
        currencyCode,
        operatingUnitId: ownerOperatingUnitId,
      }),
      buildCariDirectionalJournalLine({
        accountId: sourceLinePostingAccountId,
        side: "CREDIT",
        amountTxn: originalCostTxn,
        amountBase: originalCostBase,
        lineDescription: `Reverse AP capitalization source ${assetNo}`.slice(0, 255),
        subledgerReferenceNo: assetNo,
        currencyCode,
        operatingUnitId: ownerOperatingUnitId,
      }),
    ];
  }

  return [
    buildCariDirectionalJournalLine({
      accountId: assetAccountId,
      side: "DEBIT",
      amountTxn: originalCostTxn,
      amountBase: originalCostBase,
      lineDescription: ownerAssetDescription,
      subledgerReferenceNo: assetNo,
      currencyCode,
      operatingUnitId: ownerOperatingUnitId,
    }),
    buildCariDirectionalJournalLine({
      accountId: parsePositiveInt(selfBalancingAccounts?.targetDueToAccount?.id),
      side: "CREDIT",
      amountTxn: originalCostTxn,
      amountBase: originalCostBase,
      lineDescription: `FA cross-OU capitalization due to ${assetNo}`.slice(0, 255),
      subledgerReferenceNo: assetNo,
      currencyCode,
      operatingUnitId: ownerOperatingUnitId,
    }),
    buildCariDirectionalJournalLine({
      accountId: parsePositiveInt(selfBalancingAccounts?.sourceDueFromAccount?.id),
      side: "DEBIT",
      amountTxn: originalCostTxn,
      amountBase: originalCostBase,
      lineDescription: `FA cross-OU capitalization due from ${assetNo}`.slice(0, 255),
      subledgerReferenceNo: assetNo,
      currencyCode,
      operatingUnitId: sourceOperatingUnitId,
    }),
    buildCariDirectionalJournalLine({
      accountId: sourceApControlAccountId,
      side: "CREDIT",
      amountTxn: originalCostTxn,
      amountBase: originalCostBase,
      lineDescription: `FA cross-OU capitalization AP source ${assetNo}`.slice(0, 255),
      subledgerReferenceNo: assetNo,
      currencyCode,
      operatingUnitId: sourceOperatingUnitId,
    }),
  ];
}

// Asset draft create
// ═══════════════════════════════════════════════════════════════════

/**
 * Generate FA-###### asset number from a sequence number.
 */
function formatAssetNo(sequenceNo) {
  return `FA-${String(sequenceNo).padStart(6, "0")}`;
}

/**
 * Load category defaults for prefilling draft-side values.
 */
async function loadCategoryDefaults(categoryId, legalEntityId, tenantId, queryFn = query) {
  const result = await queryFn(
    `SELECT * FROM fixed_asset_categories
      WHERE id = ? AND tenant_id = ? AND legal_entity_id = ?
      LIMIT 1`,
    [categoryId, tenantId, legalEntityId]
  );
  const row = result.rows?.[0];
  if (!row) {
    throw badRequest(`Category (id=${categoryId}) not found for this legal entity`);
  }
  if (normalizeUpperText(row.status) !== "ACTIVE") {
    throw badRequest(`Category (id=${categoryId}) is not ACTIVE`);
  }
  return row;
}

/**
 * Load and snapshot depreciation profile fields.
 */
async function loadProfileSnapshot(profileId, legalEntityId, tenantId, queryFn = query) {
  if (!profileId) return null;

  const result = await queryFn(
    `SELECT * FROM fixed_asset_depreciation_profiles
      WHERE id = ? AND tenant_id = ? AND legal_entity_id = ?
      LIMIT 1`,
    [profileId, tenantId, legalEntityId]
  );
  const row = result.rows?.[0];
  if (!row) {
    throw badRequest(`Depreciation profile (id=${profileId}) not found for this legal entity`);
  }
  return {
    depreciationMethod: row.method || null,
    decliningBalanceRatePercent: row.declining_balance_rate_percent != null
      ? Number(row.declining_balance_rate_percent) : null,
    switchToStraightLine: row.switch_to_straight_line === 1
      || row.switch_to_straight_line === true
      || row.switch_to_straight_line === "1",
    status: normalizeUpperText(row.status),
  };
}

/**
 * Compute resolved salvage values from snapshot inputs and cost.
 */
function computeSalvageValues(salvageRuleType, salvagePercent, salvageAmountBaseRule, originalCostTxn, originalCostBase) {
  if (salvageRuleType === "PERCENT_OF_COST" && salvagePercent != null) {
    const pct = Number(salvagePercent) / 100;
    return {
      salvageValueTxn: Math.round(Number(originalCostTxn) * pct * 10000) / 10000,
      salvageValueBase: Math.round(Number(originalCostBase) * pct * 10000) / 10000,
    };
  }
  if (salvageRuleType === "FIXED_BASE_AMOUNT" && salvageAmountBaseRule != null) {
    return {
      salvageValueTxn: Number(salvageAmountBaseRule),
      salvageValueBase: Number(salvageAmountBaseRule),
    };
  }
  return { salvageValueTxn: 0, salvageValueBase: 0 };
}

export async function createAssetDraft(input) {
  const {
    tenantId, legalEntityId, name, categoryId, acquisitionDate, currencyCode,
    description, assetTag, serialNo,
    ownerOperatingUnitId, locationOperatingUnitId,
    departmentCode, costCenterCode,
    custodianEmployeeId, counterpartyId,
    originalCostTxn, originalCostBase,
    depreciationProfileId: inputProfileId,
    usefulLifeMonths: inputUsefulLife,
    remainingUsefulLifeMonths: inputRemainingUsefulLifeMonths,
    salvageRuleType: inputSalvageRuleType,
    salvagePercent: inputSalvagePercent,
    salvageAmountBaseRule: inputSalvageAmountBaseRule,
    legacyAccumDeprTxn,
    legacyAccumDeprBase,
    legacyNbvTxn,
    legacyNbvBase,
    userId,
  } = input;

  return withTransaction(async (tx) => {
    // ── Load category defaults ──────────────────────────────────
    const cat = await loadCategoryDefaults(categoryId, legalEntityId, tenantId, tx.query);

    // ── Resolve profile: input override → category default ──────
    const profileId = inputProfileId != null
      ? inputProfileId
      : (cat.default_depreciation_profile_id != null
        ? Number(cat.default_depreciation_profile_id) : null);

    const profileSnapshot = await loadProfileSnapshot(
      profileId, legalEntityId, tenantId, tx.query
    );

    // ── Resolve salvage: input overrides → category defaults ────
    const salvageRuleType = inputSalvageRuleType !== undefined
      ? inputSalvageRuleType
      : (cat.default_salvage_rule_type || "NONE");

    const salvagePercent = inputSalvagePercent !== undefined
      ? inputSalvagePercent
      : (cat.default_salvage_percent != null ? Number(cat.default_salvage_percent) : null);

    const salvageAmountBaseRule = inputSalvageAmountBaseRule !== undefined
      ? inputSalvageAmountBaseRule
      : (cat.default_salvage_amount_base != null ? Number(cat.default_salvage_amount_base) : null);

    // ── Resolve useful life: input override → category default ──
    const usefulLifeMonths = inputUsefulLife != null
      ? inputUsefulLife
      : (cat.default_useful_life_months != null ? Number(cat.default_useful_life_months) : null);

    const hasInputLegacyOnboardingValues = legacyAccumDeprTxn != null
      || legacyAccumDeprBase != null
      || legacyNbvTxn != null
      || legacyNbvBase != null;
    const remainingUsefulLifeMonths = inputRemainingUsefulLifeMonths !== undefined
      ? inputRemainingUsefulLifeMonths
      : (hasInputLegacyOnboardingValues ? null : usefulLifeMonths);

    // ── Resolve default accounts from category ──────────────────
    const assetAccountId = cat.default_asset_account_id != null
      ? Number(cat.default_asset_account_id) : null;
    const accumDeprAccountId = cat.default_accum_depr_account_id != null
      ? Number(cat.default_accum_depr_account_id) : null;
    const deprExpenseAccountId = cat.default_depr_expense_account_id != null
      ? Number(cat.default_depr_expense_account_id) : null;
    const disposalGainAccountId = cat.default_disposal_gain_account_id != null
      ? Number(cat.default_disposal_gain_account_id) : null;
    const disposalLossAccountId = cat.default_disposal_loss_account_id != null
      ? Number(cat.default_disposal_loss_account_id) : null;

    // ── Compute salvage values ──────────────────────────────────
    const { salvageValueTxn, salvageValueBase } = computeSalvageValues(
      salvageRuleType, salvagePercent, salvageAmountBaseRule,
      originalCostTxn, originalCostBase
    );

    // ── Reserve sequence_no (MAX+1 within tenant+LE, locked) ────
    const seqResult = await tx.query(
      `SELECT COALESCE(MAX(sequence_no), 0) + 1 AS next_seq
         FROM fixed_assets
        WHERE tenant_id = ? AND legal_entity_id = ?
        FOR UPDATE`,
      [tenantId, legalEntityId]
    );
    const sequenceNo = Number(seqResult.rows[0].next_seq);
    const assetNo = formatAssetNo(sequenceNo);

    // ── INSERT ──────────────────────────────────────────────────
    const insertResult = await tx.query(
      `INSERT INTO fixed_assets (
         tenant_id, legal_entity_id, asset_no, sequence_no,
         asset_tag, name, description, category_id, status,
         owner_operating_unit_id, location_operating_unit_id,
         department_code, cost_center_code,
         custodian_employee_id, counterparty_id,
         serial_no, acquisition_date, currency_code,
         original_cost_txn, original_cost_base,
         salvage_rule_type, salvage_percent, salvage_amount_base_rule,
         salvage_value_txn, salvage_value_base,
         useful_life_months, remaining_useful_life_months,
         legacy_accum_depr_txn, legacy_accum_depr_base,
         legacy_nbv_txn, legacy_nbv_base,
         depreciation_profile_id, depreciation_method,
         declining_balance_rate_percent, switch_to_straight_line,
         asset_account_id, accum_depr_account_id,
         depr_expense_account_id, disposal_gain_account_id,
         disposal_loss_account_id,
         created_by_user_id, updated_by_user_id
       ) VALUES (
         ?, ?, ?, ?,
         ?, ?, ?, ?, 'DRAFT',
         ?, ?,
         ?, ?,
         ?, ?,
         ?, ?, ?,
         ?, ?,
         ?, ?, ?,
         ?, ?,
         ?, ?,
         ?, ?,
         ?, ?,
         ?, ?,
         ?, ?,
         ?, ?,
         ?, ?,
         ?,
         ?, ?
       )`,
      [
        tenantId, legalEntityId, assetNo, sequenceNo,
        assetTag, name, description, categoryId,
        ownerOperatingUnitId || null, locationOperatingUnitId || null,
        departmentCode, costCenterCode,
        custodianEmployeeId || null, counterpartyId || null,
        serialNo, acquisitionDate, currencyCode,
        originalCostTxn, originalCostBase,
        salvageRuleType, salvagePercent ?? null, salvageAmountBaseRule ?? null,
        salvageValueTxn, salvageValueBase,
        usefulLifeMonths, remainingUsefulLifeMonths,
        legacyAccumDeprTxn ?? null, legacyAccumDeprBase ?? null,
        legacyNbvTxn ?? null, legacyNbvBase ?? null,
        profileId || null, profileSnapshot?.depreciationMethod || null,
        profileSnapshot?.decliningBalanceRatePercent ?? null,
        profileSnapshot?.switchToStraightLine ? 1 : 0,
        assetAccountId, accumDeprAccountId,
        deprExpenseAccountId, disposalGainAccountId,
        disposalLossAccountId,
        userId, userId,
      ]
    );

    const newId = insertResult.rows?.insertId;
    return newId;
  }).then(async (newId) => {
    // Re-read via getAssetDetail for consistent response shape
    return getAssetDetail({ tenantId, assetId: newId });
  });
}

// ═══════════════════════════════════════════════════════════════════
// Asset draft update
// ═══════════════════════════════════════════════════════════════════

export async function updateAssetDraft({ tenantId, assetId, updates, userId }) {
  if (!tenantId) throw badRequest("tenantId is required");
  if (!assetId) throw badRequest("assetId is required");

  // ── Load existing row ─────────────────────────────────────────
  const existingResult = await query(
    `SELECT * FROM fixed_assets WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [assetId, tenantId]
  );
  const existing = existingResult.rows?.[0];
  if (!existing) {
    throw badRequest(`Asset (id=${assetId}) not found for tenant`);
  }

  // ── Enforce DRAFT-only mutability ─────────────────────────────
  if (existing.status !== "DRAFT") {
    throw badRequest(`Asset (id=${assetId}) is not in DRAFT status — edits are only allowed while DRAFT`);
  }

  const legalEntityId = existing.legal_entity_id;
  const mergedLegacyValues = {
    legacy_accum_depr_txn: updates.legacyAccumDeprTxn !== undefined
      ? updates.legacyAccumDeprTxn
      : (existing.legacy_accum_depr_txn != null ? Number(existing.legacy_accum_depr_txn) : null),
    legacy_accum_depr_base: updates.legacyAccumDeprBase !== undefined
      ? updates.legacyAccumDeprBase
      : (existing.legacy_accum_depr_base != null ? Number(existing.legacy_accum_depr_base) : null),
    legacy_nbv_txn: updates.legacyNbvTxn !== undefined
      ? updates.legacyNbvTxn
      : (existing.legacy_nbv_txn != null ? Number(existing.legacy_nbv_txn) : null),
    legacy_nbv_base: updates.legacyNbvBase !== undefined
      ? updates.legacyNbvBase
      : (existing.legacy_nbv_base != null ? Number(existing.legacy_nbv_base) : null),
  };
  const mergedHasLegacyOnboardingValues = hasLegacyOnboardingValues(mergedLegacyValues);

  if (mergedHasLegacyOnboardingValues && hasSourceLinkage(existing)) {
    throw badRequest("Legacy onboarding values are not allowed for source-linked/CARI assets");
  }

  // ── If category is changing, validate and re-snapshot defaults ─
  let categoryChanged = false;
  let cat = null;
  if (updates.categoryId !== undefined && updates.categoryId !== Number(existing.category_id)) {
    categoryChanged = true;
    cat = await loadCategoryDefaults(updates.categoryId, legalEntityId, tenantId);
  }

  // ── If profile is changing, re-snapshot ────────────────────────
  let profileChanged = false;
  let profileSnapshot = null;
  const resolvedProfileId = updates.depreciationProfileId !== undefined
    ? updates.depreciationProfileId
    : (existing.depreciation_profile_id != null ? Number(existing.depreciation_profile_id) : null);

  if (updates.depreciationProfileId !== undefined &&
      updates.depreciationProfileId !== (existing.depreciation_profile_id != null ? Number(existing.depreciation_profile_id) : null)) {
    profileChanged = true;
    profileSnapshot = await loadProfileSnapshot(resolvedProfileId, legalEntityId, tenantId);
  }

  // ── Build column map ──────────────────────────────────────────
  const setClauses = [];
  const setParams = [];

  const directColumnMap = {
    name: "name",
    description: "description",
    assetTag: "asset_tag",
    serialNo: "serial_no",
    categoryId: "category_id",
    ownerOperatingUnitId: "owner_operating_unit_id",
    locationOperatingUnitId: "location_operating_unit_id",
    departmentCode: "department_code",
    costCenterCode: "cost_center_code",
    custodianEmployeeId: "custodian_employee_id",
    counterpartyId: "counterparty_id",
    acquisitionDate: "acquisition_date",
    currencyCode: "currency_code",
    originalCostTxn: "original_cost_txn",
    originalCostBase: "original_cost_base",
    usefulLifeMonths: "useful_life_months",
    remainingUsefulLifeMonths: "remaining_useful_life_months",
    salvageRuleType: "salvage_rule_type",
    salvagePercent: "salvage_percent",
    salvageAmountBaseRule: "salvage_amount_base_rule",
    legacyAccumDeprTxn: "legacy_accum_depr_txn",
    legacyAccumDeprBase: "legacy_accum_depr_base",
    legacyNbvTxn: "legacy_nbv_txn",
    legacyNbvBase: "legacy_nbv_base",
  };

  for (const [jsField, dbColumn] of Object.entries(directColumnMap)) {
    if (updates[jsField] !== undefined) {
      setClauses.push(`${dbColumn} = ?`);
      setParams.push(updates[jsField]);
    }
  }

  // Standard drafts keep remaining life mirrored to useful life until activation.
  if (
    updates.usefulLifeMonths !== undefined &&
    updates.remainingUsefulLifeMonths === undefined &&
    !mergedHasLegacyOnboardingValues
  ) {
    setClauses.push("remaining_useful_life_months = ?");
    setParams.push(updates.usefulLifeMonths);
  }

  // ── Re-snapshot profile fields if profile changed ─────────────
  if (profileChanged) {
    setClauses.push("depreciation_profile_id = ?");
    setParams.push(resolvedProfileId);
    setClauses.push("depreciation_method = ?");
    setParams.push(profileSnapshot?.depreciationMethod || null);
    setClauses.push("declining_balance_rate_percent = ?");
    setParams.push(profileSnapshot?.decliningBalanceRatePercent ?? null);
    setClauses.push("switch_to_straight_line = ?");
    setParams.push(profileSnapshot?.switchToStraightLine ? 1 : 0);
  }

  // ── Re-snapshot account defaults if category changed ──────────
  if (categoryChanged && cat) {
    setClauses.push("asset_account_id = ?");
    setParams.push(cat.default_asset_account_id != null ? Number(cat.default_asset_account_id) : null);
    setClauses.push("accum_depr_account_id = ?");
    setParams.push(cat.default_accum_depr_account_id != null ? Number(cat.default_accum_depr_account_id) : null);
    setClauses.push("depr_expense_account_id = ?");
    setParams.push(cat.default_depr_expense_account_id != null ? Number(cat.default_depr_expense_account_id) : null);
    setClauses.push("disposal_gain_account_id = ?");
    setParams.push(cat.default_disposal_gain_account_id != null ? Number(cat.default_disposal_gain_account_id) : null);
    setClauses.push("disposal_loss_account_id = ?");
    setParams.push(cat.default_disposal_loss_account_id != null ? Number(cat.default_disposal_loss_account_id) : null);
  }

  // ── Recompute salvage values if any salvage/cost input changed ─
  const needsSalvageRecompute =
    updates.salvageRuleType !== undefined ||
    updates.salvagePercent !== undefined ||
    updates.salvageAmountBaseRule !== undefined ||
    updates.originalCostTxn !== undefined ||
    updates.originalCostBase !== undefined;

  if (needsSalvageRecompute) {
    const mergedRuleType = updates.salvageRuleType !== undefined
      ? updates.salvageRuleType : existing.salvage_rule_type;
    const mergedPercent = updates.salvagePercent !== undefined
      ? updates.salvagePercent
      : (existing.salvage_percent != null ? Number(existing.salvage_percent) : null);
    const mergedAmountBaseRule = updates.salvageAmountBaseRule !== undefined
      ? updates.salvageAmountBaseRule
      : (existing.salvage_amount_base_rule != null ? Number(existing.salvage_amount_base_rule) : null);
    const mergedCostTxn = updates.originalCostTxn !== undefined
      ? updates.originalCostTxn : Number(existing.original_cost_txn);
    const mergedCostBase = updates.originalCostBase !== undefined
      ? updates.originalCostBase : Number(existing.original_cost_base);

    const { salvageValueTxn, salvageValueBase } = computeSalvageValues(
      mergedRuleType, mergedPercent, mergedAmountBaseRule,
      mergedCostTxn, mergedCostBase
    );
    setClauses.push("salvage_value_txn = ?");
    setParams.push(salvageValueTxn);
    setClauses.push("salvage_value_base = ?");
    setParams.push(salvageValueBase);
  }

  if (userId) {
    setClauses.push("updated_by_user_id = ?");
    setParams.push(userId);
  }

  if (setClauses.length === 0) {
    return getAssetDetail({ tenantId, assetId });
  }

  setParams.push(assetId, tenantId);

  await query(
    `UPDATE fixed_assets
        SET ${setClauses.join(", ")}
      WHERE id = ? AND tenant_id = ?`,
    setParams
  );

  return getAssetDetail({ tenantId, assetId });
}

// ═══════════════════════════════════════════════════════════════════
// Asset activation — standard manual path
// ═══════════════════════════════════════════════════════════════════

/** Asset-level account type rules for activation validation. */
const ASSET_ACCOUNT_TYPE_RULES = [
  { column: "asset_account_id",          expectedType: "ASSET",   label: "asset account" },
  { column: "accum_depr_account_id",     expectedType: "ASSET",   label: "accumulated depreciation account" },
  { column: "depr_expense_account_id",   expectedType: "EXPENSE", label: "depreciation expense account" },
  { column: "disposal_gain_account_id",  expectedType: "REVENUE", label: "disposal gain account" },
  { column: "disposal_loss_account_id",  expectedType: "EXPENSE", label: "disposal loss account" },
];

const ACTIVATION_SALVAGE_RULE_TYPES = new Set([
  "NONE",
  "FIXED_BASE_AMOUNT",
  "PERCENT_OF_COST",
]);

function hasLegacyOnboardingValues(asset) {
  return asset.legacy_accum_depr_txn != null
    || asset.legacy_accum_depr_base != null
    || asset.legacy_nbv_txn != null
    || asset.legacy_nbv_base != null;
}

function hasSourceLinkage(asset) {
  return asset.source_cari_document_id != null
    || asset.source_cari_document_line_id != null
    || asset.source_cari_document_line_unit_no != null;
}

/**
 * FA27 — Revalidate a source-linked (CARI) draft asset's source document/line
 * at activation time. Detects source drift, auto-refreshes safe source-derived
 * fields, and blocks when unsafe drift is detected.
 *
 * Source-derived fields (auto-refreshable):
 *   original_cost_txn, original_cost_base, currency_code
 *
 * Hard-blocking conditions:
 *   - source document no longer POSTED
 *   - reserved unit slot no longer valid (quantity shrank or slot taken)
 *   - quantity / equal-split assumptions no longer hold
 *   - threshold-path changed (low-value ↔ standard) due to amount drift
 *
 * User-owned fields (never overwritten):
 *   category_id, owner_operating_unit_id, location_operating_unit_id,
 *   capitalization_date, in_service_date
 */
async function revalidateSourceLinkageForActivation({
  asset,
  category,
  tenantId,
  req,
  assertScopeAccess,
  queryFn,
}) {
  const sourceCariDocumentId = parsePositiveInt(asset.source_cari_document_id);
  const sourceCariDocumentLineId = parsePositiveInt(asset.source_cari_document_line_id);
  const reservedUnitNo = parsePositiveInt(asset.source_cari_document_line_unit_no);

  if (!sourceCariDocumentId || !sourceCariDocumentLineId || !reservedUnitNo) {
    throw badRequest(
      "Source-linked asset is missing complete source linkage " +
      "(source_cari_document_id, source_cari_document_line_id, source_cari_document_line_unit_no)"
    );
  }

  // ── Reload current source document/line under transaction ─────
  const document = await getCariDocumentByIdForTenant({
    req: req || {
      requestId: "fa27-revalidation",
      headers: {},
      ip: "127.0.0.1",
      user: { tenantId },
    },
    tenantId,
    documentId: sourceCariDocumentId,
    assertScopeAccess: assertScopeAccess || (() => {}),
    runQuery: queryFn,
  });

  // ── Validate document is still POSTED ─────────────────────────
  const docStatus = normalizeUpperText(document?.status);
  if (docStatus !== FA06_REQUIRED_DOCUMENT_STATUS) {
    throw badRequest(
      `Source CARI document (id=${sourceCariDocumentId}) is no longer POSTED (status=${docStatus}). ` +
      "Activation of source-linked assets requires the source document to remain in POSTED status."
    );
  }

  const docDirection = normalizeUpperText(document?.direction);
  if (docDirection !== FA06_REQUIRED_DOCUMENT_DIRECTION) {
    throw badRequest(
      `Source CARI document (id=${sourceCariDocumentId}) direction is ${docDirection}, expected AP`
    );
  }

  // ── Find the source line ──────────────────────────────────────
  const line = (Array.isArray(document?.lines) ? document.lines : []).find(
    (candidate) => parsePositiveInt(candidate?.id) === sourceCariDocumentLineId
  );
  if (!line) {
    throw badRequest(
      `Source line (id=${sourceCariDocumentLineId}) no longer exists on document (id=${sourceCariDocumentId})`
    );
  }

  // ── Validate quantity/equal-split assumptions ─────────────────
  if (!isPositiveWholeUnitQuantity(line.quantity)) {
    throw badRequest(
      `Source line (id=${sourceCariDocumentLineId}) quantity is no longer positive whole units ` +
      `(quantity=${line.quantity}). Cannot proceed with activation.`
    );
  }
  const totalUnitQuantity = Number(line.quantity);

  if (!isEqualPerUnitSplitValidForMvp(line, totalUnitQuantity)) {
    throw badRequest(
      `Source line (id=${sourceCariDocumentLineId}) amounts no longer support equal per-unit split. ` +
      "Cannot proceed with activation."
    );
  }

  // ── Validate reserved unit slot is still valid ────────────────
  if (reservedUnitNo > totalUnitQuantity) {
    throw badRequest(
      `Reserved unit slot ${reservedUnitNo} exceeds current source line quantity (${totalUnitQuantity}). ` +
      "Source quantity may have decreased. Cannot proceed with activation."
    );
  }

  // The slot must either belong to this asset or be free.
  // Check if another asset holds the same slot:
  const slotOwnerResult = await queryFn(
    `SELECT id FROM fixed_assets
      WHERE tenant_id = ?
        AND source_cari_document_id = ?
        AND source_cari_document_line_id = ?
        AND source_cari_document_line_unit_no = ?
        AND id != ?
      LIMIT 1`,
    [tenantId, sourceCariDocumentId, sourceCariDocumentLineId, reservedUnitNo, asset.id]
  );
  if (slotOwnerResult.rows?.[0]) {
    throw badRequest(
      `Reserved unit slot ${reservedUnitNo} on source line (id=${sourceCariDocumentLineId}) ` +
      `is now held by another asset (id=${slotOwnerResult.rows[0].id}). ` +
      "Cannot proceed with activation."
    );
  }

  // ── Recompute per-unit amounts from current source ────────────
  const { originalCostTxn: currentCostTxn, originalCostBase: currentCostBase } =
    computeFa06PerUnitAmounts(line, totalUnitQuantity);

  const currentCurrencyCode = document.currencyCode || null;
  const draftCostTxn = Number(asset.original_cost_txn);
  const draftCostBase = Number(asset.original_cost_base);
  const draftCurrencyCode = asset.currency_code || null;

  // ── Detect threshold-path change ──────────────────────────────
  const capitalizationThresholdBase = category.capitalization_threshold_base != null
    ? Number(category.capitalization_threshold_base)
    : null;

  const draftWasLowValue = capitalizationThresholdBase != null && draftCostBase < capitalizationThresholdBase;
  const currentIsLowValue = capitalizationThresholdBase != null && currentCostBase < capitalizationThresholdBase;

  if (draftWasLowValue !== currentIsLowValue) {
    const draftPath = draftWasLowValue ? "low-value full-expense" : "standard depreciable";
    const currentPath = currentIsLowValue ? "low-value full-expense" : "standard depreciable";
    throw badRequest(
      `Source amount drift changed the activation path from "${draftPath}" to "${currentPath}". ` +
      `Draft cost base was ${draftCostBase}, current per-unit cost base is ${currentCostBase}, ` +
      `threshold is ${capitalizationThresholdBase}. ` +
      "This requires user review — delete the draft and re-create from the current source."
    );
  }

  // ── Currency drift check ──────────────────────────────────────
  if (currentCurrencyCode && draftCurrencyCode && currentCurrencyCode !== draftCurrencyCode) {
    throw badRequest(
      `Source document currency changed from ${draftCurrencyCode} to ${currentCurrencyCode}. ` +
      "Cannot auto-refresh — delete the draft and re-create from the current source."
    );
  }

  // ── Build auto-refresh set ────────────────────────────────────
  const refreshedFields = {};
  let costDrifted = false;

  if (!amountsEqualForActivation(draftCostTxn, currentCostTxn)
      || !amountsEqualForActivation(draftCostBase, currentCostBase)) {
    costDrifted = true;
    refreshedFields.original_cost_txn = currentCostTxn;
    refreshedFields.original_cost_base = currentCostBase;
  }

  if (currentCurrencyCode && currentCurrencyCode !== draftCurrencyCode) {
    refreshedFields.currency_code = currentCurrencyCode;
  }

  return {
    document,
    line,
    totalUnitQuantity,
    currentCostTxn,
    currentCostBase,
    costDrifted,
    refreshedFields,
    useLowValueSamePeriodPath: currentIsLowValue,
  };
}

function validateSalvageSnapshotForActivation({
  salvageRuleType,
  salvagePercent,
  salvageAmountBaseRule,
  salvageValueTxn,
  salvageValueBase,
  originalCostTxn,
  originalCostBase,
}) {
  if (!ACTIVATION_SALVAGE_RULE_TYPES.has(salvageRuleType)) {
    throw badRequest(`salvageRuleType must be one of: ${[...ACTIVATION_SALVAGE_RULE_TYPES].join(", ")}`);
  }

  if (salvageRuleType === "NONE") {
    if (salvagePercent != null) {
      throw badRequest("salvagePercent must be null when salvageRuleType is NONE");
    }
    if (salvageAmountBaseRule != null) {
      throw badRequest("salvageAmountBaseRule must be null when salvageRuleType is NONE");
    }
  }

  if (salvageRuleType === "PERCENT_OF_COST") {
    if (salvagePercent == null) {
      throw badRequest("salvagePercent is required when salvageRuleType is PERCENT_OF_COST");
    }
    if (!Number.isFinite(Number(salvagePercent))) {
      throw badRequest("salvagePercent must be a valid number");
    }
    if (Number(salvagePercent) < 0 || Number(salvagePercent) > 100) {
      throw badRequest("salvagePercent must be between 0 and 100");
    }
    if (salvageAmountBaseRule != null) {
      throw badRequest("salvageAmountBaseRule must be null when salvageRuleType is PERCENT_OF_COST");
    }
  }

  if (salvageRuleType === "FIXED_BASE_AMOUNT") {
    if (salvageAmountBaseRule == null) {
      throw badRequest("salvageAmountBaseRule is required when salvageRuleType is FIXED_BASE_AMOUNT");
    }
    if (!Number.isFinite(Number(salvageAmountBaseRule))) {
      throw badRequest("salvageAmountBaseRule must be a valid number");
    }
    if (Number(salvageAmountBaseRule) < 0) {
      throw badRequest("salvageAmountBaseRule must be a non-negative number");
    }
    if (salvagePercent != null) {
      throw badRequest("salvagePercent must be null when salvageRuleType is FIXED_BASE_AMOUNT");
    }
  }

  if (!Number.isFinite(salvageValueTxn) || salvageValueTxn < 0) {
    throw badRequest("resolved salvageValueTxn must be a non-negative number");
  }
  if (!Number.isFinite(salvageValueBase) || salvageValueBase < 0) {
    throw badRequest("resolved salvageValueBase must be a non-negative number");
  }
  if (salvageValueTxn > originalCostTxn) {
    throw badRequest("resolved salvageValueTxn cannot exceed originalCostTxn");
  }
  if (salvageValueBase > originalCostBase) {
    throw badRequest("resolved salvageValueBase cannot exceed originalCostBase");
  }
}

/**
 * Resolve the LOCAL book for a legal entity.
 */
export async function resolveBookForLegalEntity(tenantId, legalEntityId, queryFn = query) {
  const result = await queryFn(
    `SELECT id, calendar_id, base_currency_code, code, name, book_type
       FROM books
      WHERE tenant_id = ?
        AND legal_entity_id = ?
      ORDER BY CASE WHEN book_type = 'LOCAL' THEN 0 ELSE 1 END, id ASC
      LIMIT 1`,
    [tenantId, legalEntityId]
  );
  const row = result.rows?.[0];
  if (!row) {
    throw badRequest(`No book found for legal entity (legalEntityId=${legalEntityId})`);
  }
  const bookId = parsePositiveInt(row.id);
  const calendarId = parsePositiveInt(row.calendar_id);
  if (!bookId || !calendarId) {
    throw badRequest(`Book configuration is invalid for legal entity (legalEntityId=${legalEntityId})`);
  }
  return row;
}

export async function resolveSupportedFixedAssetFiscalPeriod(
  calendarId,
  fiscalPeriodId,
  queryFn = query
) {
  const normalizedCalendarId = parsePositiveInt(calendarId);
  const normalizedFiscalPeriodId = parsePositiveInt(fiscalPeriodId);
  if (!normalizedCalendarId) throw badRequest("calendarId is required");
  if (!normalizedFiscalPeriodId) throw badRequest("fiscalPeriodId is required");

  const result = await queryFn(
    `SELECT id,
            fiscal_year,
            period_no,
            period_name,
            start_date,
            end_date,
            is_adjustment
       FROM fiscal_periods
      WHERE calendar_id = ?
        AND id = ?
      LIMIT 1`,
    [normalizedCalendarId, normalizedFiscalPeriodId]
  );
  const row = result.rows?.[0];
  if (!row) {
    throw badRequest(
      `Fiscal period (id=${normalizedFiscalPeriodId}) does not belong to calendarId=${normalizedCalendarId}`
    );
  }

  const isAdjustment = row.is_adjustment === 1
    || row.is_adjustment === true
    || row.is_adjustment === "1";
  if (isAdjustment) {
    throw badRequest(
      `Fixed-assets depreciation runs do not support adjustment fiscal periods (fiscalPeriodId=${normalizedFiscalPeriodId})`
    );
  }

  const startDate = String(row.start_date || "").slice(0, 10);
  const endDate = String(row.end_date || "").slice(0, 10);
  const start = parseDateOnlyStrict(startDate, "fiscalPeriod.startDate");
  const expectedMonthStart = new Date(Date.UTC(
    start.getUTCFullYear(),
    start.getUTCMonth(),
    1
  ));
  const expectedMonthEnd = new Date(Date.UTC(
    start.getUTCFullYear(),
    start.getUTCMonth() + 1,
    0
  ));
  const expectedStartText = formatDateOnly(expectedMonthStart);
  const expectedEndText = formatDateOnly(expectedMonthEnd);

  if (startDate !== expectedStartText || endDate !== expectedEndText) {
    throw badRequest(
      `Fixed-assets depreciation runs require month-aligned non-adjustment fiscal periods; ` +
      `fiscalPeriodId=${normalizedFiscalPeriodId} is not aligned to a single calendar YYYY-MM bucket`
    );
  }

  return {
    id: Number(row.id),
    fiscalYear: row.fiscal_year != null ? Number(row.fiscal_year) : null,
    periodNo: row.period_no != null ? Number(row.period_no) : null,
    periodName: row.period_name || null,
    startDate,
    endDate,
    periodKey: startDate.slice(0, 7),
  };
}

/**
 * Resolve a non-adjustment fiscal period for a posting date within a calendar.
 */
async function resolveFiscalPeriodForDate(calendarId, postingDate, queryFn = query) {
  const result = await queryFn(
    `SELECT id, fiscal_year, period_no, period_name, is_adjustment
       FROM fiscal_periods
      WHERE calendar_id = ?
        AND ? BETWEEN start_date AND end_date
      ORDER BY is_adjustment ASC, id ASC
      LIMIT 1`,
    [calendarId, postingDate]
  );
  const row = result.rows?.[0];
  if (!row) {
    throw badRequest(`No fiscal period found for posting date ${postingDate}`);
  }
  if (row.is_adjustment === 1 || row.is_adjustment === true || row.is_adjustment === "1") {
    throw badRequest(`Posting date ${postingDate} resolves only to an adjustment fiscal period`);
  }
  return row;
}

/**
 * Validate that the fiscal period is OPEN for posting.
 */
async function ensurePeriodOpen(bookId, fiscalPeriodId, queryFn = query) {
  const result = await queryFn(
    `SELECT status
       FROM period_statuses
      WHERE book_id = ?
        AND fiscal_period_id = ?
      LIMIT 1`,
    [bookId, fiscalPeriodId]
  );
  const status = String(result.rows?.[0]?.status || "OPEN").toUpperCase();
  if (status !== "OPEN") {
    throw badRequest(`Fiscal period is ${status}; cannot post activation`);
  }
}

export async function ensurePeriodOpenForFixedAssets(
  bookId,
  fiscalPeriodId,
  actionLabel,
  queryFn = query
) {
  const result = await queryFn(
    `SELECT status
       FROM period_statuses
      WHERE book_id = ?
        AND fiscal_period_id = ?
      LIMIT 1`,
    [bookId, fiscalPeriodId]
  );
  const status = String(result.rows?.[0]?.status || "OPEN").toUpperCase();
  if (status !== "OPEN") {
    const normalizedActionLabel = String(actionLabel || "run depreciation").trim() || "run depreciation";
    throw badRequest(`Fiscal period is ${status}; cannot ${normalizedActionLabel}`);
  }
}

const ACTIVATION_AMOUNT_EPSILON = 0.0001;

function roundActivationAmount(value) {
  return Math.round(Number(value) * 10000) / 10000;
}

function amountsEqualForActivation(left, right) {
  return Math.abs(Number(left) - Number(right)) <= ACTIVATION_AMOUNT_EPSILON;
}

function normalizeLegacyActivationField(asset, column, label) {
  if (asset[column] == null) {
    throw badRequest(`${label} is required for legacy onboarding activation`);
  }
  const normalized = Number(asset[column]);
  if (!Number.isFinite(normalized) || normalized < 0) {
    throw badRequest(`${label} must be a non-negative number`);
  }
  return normalized;
}

function validateLegacyOnboardingForActivation({
  asset,
  originalCostTxn,
  originalCostBase,
  salvageValueTxn,
  salvageValueBase,
}) {
  const legacyAccumDeprTxn = normalizeLegacyActivationField(
    asset,
    "legacy_accum_depr_txn",
    "legacyAccumDeprTxn"
  );
  const legacyAccumDeprBase = normalizeLegacyActivationField(
    asset,
    "legacy_accum_depr_base",
    "legacyAccumDeprBase"
  );
  const legacyNbvTxn = normalizeLegacyActivationField(
    asset,
    "legacy_nbv_txn",
    "legacyNbvTxn"
  );
  const legacyNbvBase = normalizeLegacyActivationField(
    asset,
    "legacy_nbv_base",
    "legacyNbvBase"
  );

  if (legacyAccumDeprTxn > originalCostTxn + ACTIVATION_AMOUNT_EPSILON) {
    throw badRequest("legacyAccumDeprTxn cannot exceed originalCostTxn");
  }
  if (legacyAccumDeprBase > originalCostBase + ACTIVATION_AMOUNT_EPSILON) {
    throw badRequest("legacyAccumDeprBase cannot exceed originalCostBase");
  }

  const expectedLegacyNbvTxn = roundActivationAmount(originalCostTxn - legacyAccumDeprTxn);
  const expectedLegacyNbvBase = roundActivationAmount(originalCostBase - legacyAccumDeprBase);
  if (!amountsEqualForActivation(legacyNbvTxn, expectedLegacyNbvTxn)) {
    throw badRequest(`legacyNbvTxn must equal originalCostTxn - legacyAccumDeprTxn (${expectedLegacyNbvTxn})`);
  }
  if (!amountsEqualForActivation(legacyNbvBase, expectedLegacyNbvBase)) {
    throw badRequest(`legacyNbvBase must equal originalCostBase - legacyAccumDeprBase (${expectedLegacyNbvBase})`);
  }

  if (legacyNbvTxn + ACTIVATION_AMOUNT_EPSILON < salvageValueTxn) {
    throw badRequest("legacyNbvTxn cannot be below salvageValueTxn");
  }
  if (legacyNbvBase + ACTIVATION_AMOUNT_EPSILON < salvageValueBase) {
    throw badRequest("legacyNbvBase cannot be below salvageValueBase");
  }

  const remainingDepreciableTxn = Math.max(
    0,
    roundActivationAmount(legacyNbvTxn - salvageValueTxn)
  );
  const remainingDepreciableBase = Math.max(
    0,
    roundActivationAmount(legacyNbvBase - salvageValueBase)
  );
  const hasRemainingDepreciableAmount =
    remainingDepreciableTxn > ACTIVATION_AMOUNT_EPSILON
    || remainingDepreciableBase > ACTIVATION_AMOUNT_EPSILON;

  const remainingUsefulLifeMonths = asset.remaining_useful_life_months != null
    ? Number(asset.remaining_useful_life_months)
    : null;
  if (
    hasRemainingDepreciableAmount
    && (!Number.isInteger(remainingUsefulLifeMonths) || remainingUsefulLifeMonths <= 0)
  ) {
    throw badRequest(
      "remainingUsefulLifeMonths is required for legacy onboarding activation when remaining depreciable amount exists"
    );
  }

  return {
    legacyAccumDeprTxn,
    legacyAccumDeprBase,
    legacyNbvTxn,
    legacyNbvBase,
    activatedStatus: hasRemainingDepreciableAmount ? "ACTIVE" : "FULLY_DEPRECIATED",
    remainingUsefulLifeMonths: hasRemainingDepreciableAmount ? remainingUsefulLifeMonths : 0,
    hasRemainingDepreciableAmount,
  };
}

async function insertFixedAssetTransaction(tx, {
  tenantId,
  legalEntityId,
  assetId,
  transactionType,
  effectiveDate,
  postingDate,
  bookId,
  fiscalPeriodId,
  currencyCode,
  depreciationKind = null,
  journalEntryId = null,
  sourceRefType = null,
  sourceRefId = null,
  sourceRefLineId = null,
  grossAmountTxn = null,
  grossAmountBase = null,
  accumDeprAmountTxn = null,
  accumDeprAmountBase = null,
  nbvAmountTxn = null,
  nbvAmountBase = null,
  note = null,
  createdByUserId = null,
}) {
  const result = await tx.query(
    `INSERT INTO fixed_asset_transactions (
       tenant_id, legal_entity_id, asset_id,
       transaction_type, status, effective_date, posting_date,
       book_id, fiscal_period_id, currency_code,
       depreciation_kind,
       journal_entry_id,
       source_ref_type, source_ref_id, source_ref_line_id,
       gross_amount_txn, gross_amount_base,
       accum_depr_amount_txn, accum_depr_amount_base,
       nbv_amount_txn, nbv_amount_base,
       note, created_by_user_id
     ) VALUES (
       ?, ?, ?,
       ?, 'POSTED', ?, ?,
       ?, ?, ?,
       ?,
       ?,
       ?, ?, ?,
       ?, ?,
       ?, ?,
       ?, ?,
       ?, ?
     )`,
    [
      tenantId,
      legalEntityId,
      assetId,
      transactionType,
      effectiveDate,
      postingDate,
      bookId,
      fiscalPeriodId,
      currencyCode,
      depreciationKind,
      journalEntryId,
      sourceRefType,
      sourceRefId,
      sourceRefLineId,
      grossAmountTxn,
      grossAmountBase,
      accumDeprAmountTxn,
      accumDeprAmountBase,
      nbvAmountTxn,
      nbvAmountBase,
      note,
      createdByUserId,
    ]
  );

  return parsePositiveInt(result.rows?.insertId) || null;
}

export async function createAssetsFromCariDocumentLineFa06(input) {
  const {
    req,
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
    assertScopeAccess,
  } = input;

  return withTransaction(async (tx) => {
    const document = await getCariDocumentByIdForTenant({
      req,
      tenantId,
      documentId: sourceCariDocumentId,
      assertScopeAccess,
      runQuery: tx.query,
    });

    const legalEntityId = parsePositiveInt(document?.legalEntityId);
    if (!legalEntityId) {
      throw badRequest("Source document legalEntityId is required for FA06 capitalization");
    }
    if (!document?.currencyCode) {
      throw badRequest("Source document currencyCode is required for FA06 capitalization");
    }

    const acquisitionDate = String(document?.documentDate || "").slice(0, 10);
    if (!acquisitionDate) {
      throw badRequest("Source document date is required for FA06 capitalization");
    }
    if (capitalizationDate < acquisitionDate) {
      throw badRequest(
        `capitalizationDate (${capitalizationDate}) cannot precede source documentDate (${acquisitionDate})`
      );
    }
    if (inServiceDate < acquisitionDate) {
      throw badRequest(
        `inServiceDate (${inServiceDate}) cannot precede source documentDate (${acquisitionDate})`
      );
    }

    const sourceOperatingUnitId = parsePositiveInt(document?.operatingUnitId);
    if (!sourceOperatingUnitId) {
      throw badRequest("FA06 capitalization requires the source document to have an operatingUnitId");
    }

    const normalizedOwnerOperatingUnitId = await validateOperatingUnitBelongsToLegalEntity(
      ownerOperatingUnitId,
      legalEntityId,
      tenantId,
      "ownerOperatingUnitId",
      tx.query
    );
    const normalizedLocationOperatingUnitId = await validateOperatingUnitBelongsToLegalEntity(
      locationOperatingUnitId,
      legalEntityId,
      tenantId,
      "locationOperatingUnitId",
      tx.query
    );
    const line = (Array.isArray(document?.lines) ? document.lines : []).find(
      (candidate) => parsePositiveInt(candidate?.id) === parsePositiveInt(sourceCariDocumentLineId)
    );
    if (!line) {
      throw badRequest(
        `Source line (id=${sourceCariDocumentLineId}) not found on sourceCariDocumentId=${sourceCariDocumentId}`
      );
    }
    const isCrossOuCapitalization = normalizedOwnerOperatingUnitId !== sourceOperatingUnitId;

    const reservedUnitNumbersByLineId = await loadCariLineReservedUnitNumbers({
      tenantId,
      sourceCariDocumentId,
      queryFn: tx.query,
    });
    const eligibilityRow = buildCariEligibleApLineRow({
      document,
      line,
      reservedUnitNumbers: reservedUnitNumbersByLineId.get(parsePositiveInt(sourceCariDocumentLineId)) || [],
      requestedUnitCount: unitCount,
    });
    if (!eligibilityRow.eligibleForFa06) {
      throw badRequest(
        `Source line is not currently eligible for FA06 capitalization: ${formatFa06IneligibleReasons(eligibilityRow.ineligibleReasons)}`
      );
    }

    const allocatedUnitNumbers = allocateLowestAvailableUnitNumbers(
      eligibilityRow.totalUnitQuantity,
      eligibilityRow.consumedUnitNumbers,
      unitCount
    );
    if (allocatedUnitNumbers.length !== unitCount) {
      throw badRequest("Requested unitCount exceeds currently available source units");
    }

    const category = await loadCategoryDefaults(categoryId, legalEntityId, tenantId, tx.query);
    const { originalCostTxn, originalCostBase } = computeFa06PerUnitAmounts(
      line,
      eligibilityRow.totalUnitQuantity
    );

    const capitalizationThresholdBase = category.capitalization_threshold_base != null
      ? Number(category.capitalization_threshold_base)
      : null;
    const useLowValueSamePeriodPath =
      capitalizationThresholdBase != null && originalCostBase < capitalizationThresholdBase;

    const assetAccountId = category.default_asset_account_id != null
      ? Number(category.default_asset_account_id)
      : null;
    const accumDeprAccountId = category.default_accum_depr_account_id != null
      ? Number(category.default_accum_depr_account_id)
      : null;
    const deprExpenseAccountId = category.default_depr_expense_account_id != null
      ? Number(category.default_depr_expense_account_id)
      : null;
    const disposalGainAccountId = category.default_disposal_gain_account_id != null
      ? Number(category.default_disposal_gain_account_id)
      : null;
    const disposalLossAccountId = category.default_disposal_loss_account_id != null
      ? Number(category.default_disposal_loss_account_id)
      : null;

    for (const rule of [
      { accountId: assetAccountId, expectedType: "ASSET", label: "asset account" },
      { accountId: accumDeprAccountId, expectedType: "ASSET", label: "accumulated depreciation account" },
      { accountId: deprExpenseAccountId, expectedType: "EXPENSE", label: "depreciation expense account" },
      { accountId: disposalGainAccountId, expectedType: "REVENUE", label: "disposal gain account" },
      { accountId: disposalLossAccountId, expectedType: "EXPENSE", label: "disposal loss account" },
    ]) {
      if (!rule.accountId) {
        throw badRequest(`${rule.label} is required for FA06 capitalization`);
      }
      // eslint-disable-next-line no-await-in-loop
      await validateAccountForCategory(
        rule.accountId,
        legalEntityId,
        tenantId,
        rule.expectedType,
        rule.label,
        tx.query
      );
    }
    await validatePostableAccount(
      parsePositiveInt(line?.postingAccountId),
      legalEntityId,
      tenantId,
      "source line posting account",
      tx.query
    );

    let crossOuSelfBalancingAccounts = null;
    let sourceApControlAccountId = null;
    if (isCrossOuCapitalization) {
      const sourceCounterpartyId = parsePositiveInt(document?.counterpartyId);
      if (!sourceCounterpartyId) {
        throw badRequest(
          "Cross-OU FA06 capitalization requires source CARI document counterpartyId"
        );
      }

      crossOuSelfBalancingAccounts = await resolveOuSelfBalancingAccountsTx(tx, {
        tenantId,
        legalEntityId,
        sourceOperatingUnitId,
        targetOperatingUnitId: normalizedOwnerOperatingUnitId,
        cache: {
          operatingUnitById: new Map(),
          partnerPairById: new Map(),
        },
      });
      assertFa06CrossOuSelfBalancingSetup({
        selfBalancingAccounts: crossOuSelfBalancingAccounts,
        sourceOperatingUnitId,
        targetOperatingUnitId: normalizedOwnerOperatingUnitId,
      });

      const sourceApControlAccount = await resolveCariControlAccountTx({
        tenantId,
        legalEntityId,
        direction: "AP",
        counterpartyId: sourceCounterpartyId,
        runQuery: tx.query,
      });
      sourceApControlAccountId = parsePositiveInt(
        sourceApControlAccount?.controlAccountId
      );
      if (!sourceApControlAccountId) {
        throw badRequest(
          "Cross-OU FA06 capitalization could not resolve the source AP control account"
        );
      }
    }

    const book = await resolveBookForLegalEntity(tenantId, legalEntityId, tx.query);
    const period = await resolveFiscalPeriodForDate(book.calendar_id, capitalizationDate, tx.query);
    await ensurePeriodOpen(book.id, period.id, tx.query);

    const seqResult = await tx.query(
      `SELECT COALESCE(MAX(sequence_no), 0) + 1 AS next_seq
         FROM fixed_assets
        WHERE tenant_id = ? AND legal_entity_id = ?
        FOR UPDATE`,
      [tenantId, legalEntityId]
    );
    let nextSequenceNo = Number(seqResult.rows?.[0]?.next_seq || 1);

    const categoryProfileId = category.default_depreciation_profile_id != null
      ? Number(category.default_depreciation_profile_id)
      : null;
    const categoryUsefulLifeMonths = category.default_useful_life_months != null
      ? Number(category.default_useful_life_months)
      : null;

    let depreciationProfileId = null;
    let usefulLifeMonths = null;
    let remainingUsefulLifeMonths = 0;
    let depreciationMethod = "NONE";
    let decliningBalanceRatePercent = null;
    let switchToStraightLine = 0;
    let salvageRuleType = "NONE";
    let salvagePercent = null;
    let salvageAmountBaseRule = null;
    let salvageValueTxn = 0;
    let salvageValueBase = 0;

    if (!useLowValueSamePeriodPath) {
      if (!categoryProfileId) {
        throw badRequest(
          `Category (id=${categoryId}) must provide a default depreciation profile for FA06 capitalization`
        );
      }
      if (!Number.isInteger(categoryUsefulLifeMonths) || categoryUsefulLifeMonths <= 0) {
        throw badRequest(
          `Category (id=${categoryId}) must provide defaultUsefulLifeMonths for FA06 capitalization`
        );
      }

      const profileSnapshot = await loadProfileSnapshot(
        categoryProfileId,
        legalEntityId,
        tenantId,
        tx.query
      );
      if (!profileSnapshot || profileSnapshot.status !== "ACTIVE") {
        throw badRequest("Category default depreciation profile must be ACTIVE for FA06 capitalization");
      }
      if (!profileSnapshot.depreciationMethod || profileSnapshot.depreciationMethod === "NONE") {
        throw badRequest("FA06 capitalization requires a depreciable category default profile");
      }

      depreciationProfileId = categoryProfileId;
      usefulLifeMonths = categoryUsefulLifeMonths;
      remainingUsefulLifeMonths = categoryUsefulLifeMonths;
      depreciationMethod = profileSnapshot.depreciationMethod;
      decliningBalanceRatePercent = profileSnapshot.decliningBalanceRatePercent;
      switchToStraightLine = profileSnapshot.switchToStraightLine ? 1 : 0;
      salvageRuleType = category.default_salvage_rule_type || "NONE";
      salvagePercent = category.default_salvage_percent != null
        ? Number(category.default_salvage_percent)
        : null;
      salvageAmountBaseRule = category.default_salvage_amount_base != null
        ? Number(category.default_salvage_amount_base)
        : null;

      const computedSalvageValues = computeSalvageValues(
        salvageRuleType,
        salvagePercent,
        salvageAmountBaseRule,
        originalCostTxn,
        originalCostBase
      );
      salvageValueTxn = computedSalvageValues.salvageValueTxn;
      salvageValueBase = computedSalvageValues.salvageValueBase;
      validateSalvageSnapshotForActivation({
        salvageRuleType,
        salvagePercent,
        salvageAmountBaseRule,
        salvageValueTxn,
        salvageValueBase,
        originalCostTxn,
        originalCostBase,
      });
    }

    const createdAssetIds = [];

    for (const unitNo of allocatedUnitNumbers) {
      const sequenceNo = nextSequenceNo;
      nextSequenceNo += 1;
      const assetNo = formatAssetNo(sequenceNo);
      const assetStatus = useLowValueSamePeriodPath ? "FULLY_DEPRECIATED" : "ACTIVE";

      // eslint-disable-next-line no-await-in-loop
      const insertAssetResult = await tx.query(
        `INSERT INTO fixed_assets (
           tenant_id, legal_entity_id, asset_no, sequence_no,
           asset_tag, name, description, category_id, status,
           owner_operating_unit_id, location_operating_unit_id,
           department_code, cost_center_code,
           custodian_employee_id, counterparty_id,
           serial_no, acquisition_date, capitalization_date, in_service_date, currency_code,
           original_cost_txn, original_cost_base,
           salvage_rule_type, salvage_percent, salvage_amount_base_rule,
           salvage_value_txn, salvage_value_base,
           useful_life_months, remaining_useful_life_months,
           legacy_accum_depr_txn, legacy_accum_depr_base,
           legacy_nbv_txn, legacy_nbv_base,
           depreciation_profile_id, depreciation_method,
           declining_balance_rate_percent, switch_to_straight_line,
           asset_account_id, accum_depr_account_id,
           depr_expense_account_id, disposal_gain_account_id,
           disposal_loss_account_id,
           source_cari_document_id, source_cari_document_line_id, source_cari_document_line_unit_no,
           created_by_user_id, updated_by_user_id
         ) VALUES (
           ?, ?, ?, ?,
           NULL, ?, ?, ?, ?,
           ?, ?,
           NULL, NULL,
           NULL, ?,
           NULL, ?, ?, ?, ?,
           ?, ?,
           ?, ?, ?,
           ?, ?,
           ?, ?,
           NULL, NULL,
           NULL, NULL,
           ?, ?,
           ?, ?,
           ?, ?,
           ?, ?, ?,
           ?, ?, ?,
           ?, ?
         )`,
        [
          tenantId,
          legalEntityId,
          assetNo,
          sequenceNo,
          buildFa06AssetName({
            line,
            category,
            unitNo,
            totalUnitQuantity: eligibilityRow.totalUnitQuantity,
          }),
          buildFa06AssetDescription({
            document,
            line,
            unitNo,
            totalUnitQuantity: eligibilityRow.totalUnitQuantity,
          }),
          categoryId,
          assetStatus,
          normalizedOwnerOperatingUnitId,
          normalizedLocationOperatingUnitId,
          parsePositiveInt(document?.counterpartyId) || null,
          acquisitionDate,
          capitalizationDate,
          inServiceDate,
          document.currencyCode,
          originalCostTxn,
          originalCostBase,
          salvageRuleType,
          salvagePercent,
          salvageAmountBaseRule,
          salvageValueTxn,
          salvageValueBase,
          usefulLifeMonths,
          remainingUsefulLifeMonths,
          depreciationProfileId,
          depreciationMethod,
          decliningBalanceRatePercent,
          switchToStraightLine,
          assetAccountId,
          accumDeprAccountId,
          deprExpenseAccountId,
          disposalGainAccountId,
          disposalLossAccountId,
          sourceCariDocumentId,
          sourceCariDocumentLineId,
          unitNo,
          userId,
          userId,
        ]
      );

      const assetId = parsePositiveInt(insertAssetResult.rows?.insertId);
      if (!assetId) {
        throw badRequest("Failed to create FA06 asset");
      }

      const referenceNo = buildFa06ReferenceNo({ document, line, unitNo });
      const capitalizationJournal = await insertPostedJournalWithLinesTx(tx, {
        tenantId,
        legalEntityId,
        bookId: book.id,
        fiscalPeriodId: period.id,
        journalNo: buildFa06JournalNo(assetId),
        entryDate: capitalizationDate,
        documentDate: capitalizationDate,
        currencyCode: document.currencyCode,
        description: `FA capitalization ${assetNo}`.slice(0, 255),
        referenceNo,
        userId,
        operatingUnitId: normalizedOwnerOperatingUnitId,
        lines: buildFa06CapitalizationJournalLines({
          assetAccountId,
          sourceLinePostingAccountId: parsePositiveInt(line?.postingAccountId),
          sourceApControlAccountId,
          isCrossOuCapitalization,
          originalCostTxn,
          originalCostBase,
          currencyCode: document.currencyCode,
          assetNo,
          ownerOperatingUnitId: normalizedOwnerOperatingUnitId,
          sourceOperatingUnitId,
          selfBalancingAccounts: crossOuSelfBalancingAccounts,
        }),
      });
      await upsertJournalSourceLinkTx(tx, {
        tenantId,
        legalEntityId,
        journalEntryId: capitalizationJournal.journalEntryId,
        sourceRefType: "CARI_DOCUMENT",
        sourceRefId: sourceCariDocumentId,
      });

      await insertFixedAssetTransaction(tx, {
        tenantId,
        legalEntityId,
        assetId,
        transactionType: "CAPITALIZATION",
        effectiveDate: capitalizationDate,
        postingDate: capitalizationDate,
        bookId: book.id,
        fiscalPeriodId: period.id,
        currencyCode: document.currencyCode,
        journalEntryId: capitalizationJournal.journalEntryId,
        sourceRefType: "CARI_DOCUMENT",
        sourceRefId: sourceCariDocumentId,
        sourceRefLineId: sourceCariDocumentLineId,
        grossAmountTxn: originalCostTxn,
        grossAmountBase: originalCostBase,
        accumDeprAmountTxn: 0,
        accumDeprAmountBase: 0,
        nbvAmountTxn: originalCostTxn,
        nbvAmountBase: originalCostBase,
        note: isCrossOuCapitalization
          ? "Cross-OU CARI capitalization"
          : "Same-OU CARI capitalization",
        createdByUserId: userId,
      });

      if (useLowValueSamePeriodPath) {
        const depreciationTransactionId = await insertFixedAssetTransaction(tx, {
          tenantId,
          legalEntityId,
          assetId,
          transactionType: "DEPRECIATION",
          effectiveDate: capitalizationDate,
          postingDate: capitalizationDate,
          bookId: book.id,
          fiscalPeriodId: period.id,
          currencyCode: document.currencyCode,
          depreciationKind: "LOW_VALUE_FULL_EXPENSE",
          sourceRefType: "CARI_DOCUMENT",
          sourceRefId: sourceCariDocumentId,
          sourceRefLineId: sourceCariDocumentLineId,
          grossAmountTxn: originalCostTxn,
          grossAmountBase: originalCostBase,
          accumDeprAmountTxn: originalCostTxn,
          accumDeprAmountBase: originalCostBase,
          nbvAmountTxn: 0,
          nbvAmountBase: 0,
          note: "Low-value same-period full expense",
          createdByUserId: userId,
        });

        const lowValueJournal = await insertPostedJournalWithLinesTx(tx, {
          tenantId,
          legalEntityId,
          bookId: book.id,
          fiscalPeriodId: period.id,
          journalNo: buildFa06LowValueJournalNo(assetId),
          entryDate: capitalizationDate,
          documentDate: capitalizationDate,
          currencyCode: document.currencyCode,
          description: `FA low-value full expense ${assetNo}`.slice(0, 255),
          referenceNo,
          userId,
          operatingUnitId: normalizedOwnerOperatingUnitId,
          lines: [
            buildCariDirectionalJournalLine({
              accountId: deprExpenseAccountId,
              side: "DEBIT",
              amountTxn: originalCostTxn,
              amountBase: originalCostBase,
              lineDescription: `FA low-value expense ${assetNo}`.slice(0, 255),
              subledgerReferenceNo: assetNo,
              currencyCode: document.currencyCode,
              operatingUnitId: normalizedOwnerOperatingUnitId,
            }),
            buildCariDirectionalJournalLine({
              accountId: accumDeprAccountId,
              side: "CREDIT",
              amountTxn: originalCostTxn,
              amountBase: originalCostBase,
              lineDescription: `FA low-value accumulated depreciation ${assetNo}`.slice(0, 255),
              subledgerReferenceNo: assetNo,
              currencyCode: document.currencyCode,
              operatingUnitId: normalizedOwnerOperatingUnitId,
            }),
          ],
        });

        await tx.query(
          `UPDATE fixed_asset_transactions
              SET journal_entry_id = ?
            WHERE id = ? AND tenant_id = ?`,
          [lowValueJournal.journalEntryId, depreciationTransactionId, tenantId]
        );

        await upsertJournalSourceLinkTx(tx, {
          tenantId,
          legalEntityId,
          journalEntryId: lowValueJournal.journalEntryId,
          sourceRefType: "FIXED_ASSET_TRANSACTION",
          sourceRefId: depreciationTransactionId,
        });
      }

      createdAssetIds.push(assetId);
    }

    return {
      tenantId,
      sourceCariDocumentId,
      sourceCariDocumentLineId,
      unitCount,
      allocatedUnitNumbers,
      assetIds: createdAssetIds,
    };
  }).then(async (result) => {
    const rows = await Promise.all(
      (result.assetIds || []).map((assetId) => getAssetDetail({ tenantId, assetId }))
    );
    return {
      tenantId: result.tenantId,
      sourceCariDocumentId: result.sourceCariDocumentId,
      sourceCariDocumentLineId: result.sourceCariDocumentLineId,
      unitCount: result.unitCount,
      allocatedUnitNumbers: result.allocatedUnitNumbers,
      rows,
      total: rows.length,
    };
  });
}

export async function activateAsset(input) {
  const { tenantId, assetId, postingDate, capitalizationDate: inputCapDate, inServiceDate: inputInServiceDate, userId } = input;

  return withTransaction(async (tx) => {
    // ── Load existing draft ──────────────────────────────────────
    const existingResult = await tx.query(
      `SELECT * FROM fixed_assets WHERE id = ? AND tenant_id = ? LIMIT 1 FOR UPDATE`,
      [assetId, tenantId]
    );
    const asset = existingResult.rows?.[0];
    if (!asset) throw badRequest(`Asset (id=${assetId}) not found for tenant`);
    if (asset.status !== "DRAFT") {
      throw badRequest(`Asset (id=${assetId}) is not in DRAFT status — only DRAFT assets can be activated`);
    }

    const legalEntityId = asset.legal_entity_id;
    if (!legalEntityId) throw badRequest("legalEntityId is required for activation");
    if (!asset.category_id) throw badRequest("categoryId is required for activation");

    const category = await loadCategoryDefaults(
      Number(asset.category_id),
      legalEntityId,
      tenantId,
      tx.query
    );

    // ── FA27: Source-link revalidation & auto-refresh ──────────────
    const isSourceLinked = hasSourceLinkage(asset);
    let sourceRevalidation = null;

    if (isSourceLinked) {
      const isLegacyOnboardingCheck = hasLegacyOnboardingValues(asset);
      if (isLegacyOnboardingCheck) {
        throw badRequest("Legacy onboarding activation does not support source-linked/CARI assets");
      }

      sourceRevalidation = await revalidateSourceLinkageForActivation({
        asset,
        category,
        tenantId,
        queryFn: tx.query,
      });

      // Auto-refresh source-derived fields on the in-memory asset row
      if (Object.keys(sourceRevalidation.refreshedFields).length > 0) {
        const refreshCols = [];
        const refreshVals = [];
        for (const [col, val] of Object.entries(sourceRevalidation.refreshedFields)) {
          asset[col] = val;
          refreshCols.push(`${col} = ?`);
          refreshVals.push(val);
        }
        refreshVals.push(userId, assetId, tenantId);
        await tx.query(
          `UPDATE fixed_assets SET ${refreshCols.join(", ")}, updated_by_user_id = ? WHERE id = ? AND tenant_id = ?`,
          refreshVals
        );
      }
    }

    // ── Apply capitalization/in-service dates from input or existing ─
    const capitalizationDate = inputCapDate || asset.capitalization_date;
    const inServiceDate = inputInServiceDate || asset.in_service_date;

    // ── Activation-time required field validation ────────────────
    if (!asset.owner_operating_unit_id) throw badRequest("ownerOperatingUnitId is required for activation");
    if (!asset.location_operating_unit_id) throw badRequest("locationOperatingUnitId is required for activation");

    const costTxn = Number(asset.original_cost_txn);
    const costBase = Number(asset.original_cost_base);
    if (!costTxn || costTxn <= 0) throw badRequest("originalCostTxn must be > 0 for activation");
    if (!costBase || costBase <= 0) throw badRequest("originalCostBase must be > 0 for activation");
    const isLegacyOnboarding = hasLegacyOnboardingValues(asset);
    const capitalizationThresholdBase = category.capitalization_threshold_base != null
      ? Number(category.capitalization_threshold_base)
      : null;
    const useLowValueSamePeriodPath =
      isSourceLinked
        ? (sourceRevalidation?.useLowValueSamePeriodPath ?? false)
        : (!isLegacyOnboarding
            && capitalizationThresholdBase != null
            && costBase < capitalizationThresholdBase);

    if (!capitalizationDate) throw badRequest("capitalizationDate is required for activation");
    if (!inServiceDate) throw badRequest("inServiceDate is required for activation");

    const acqDate = String(asset.acquisition_date).slice(0, 10);
    const isd = String(inServiceDate).slice(0, 10);
    if (isd < acqDate) {
      throw badRequest(`inServiceDate (${isd}) cannot precede acquisitionDate (${acqDate})`);
    }

    // ── Profile/useful-life required for standard depreciable assets ─
    let profileSnapshot = null;

    // ── Salvage snapshot validation ──────────────────────────────
    let resolvedSalvageRuleType = asset.salvage_rule_type || "NONE";
    let resolvedSalvagePercent = asset.salvage_percent != null ? Number(asset.salvage_percent) : null;
    let resolvedSalvageAmountBaseRule = asset.salvage_amount_base_rule != null
      ? Number(asset.salvage_amount_base_rule)
      : null;
    let resolvedSalvageValueTxn = 0;
    let resolvedSalvageValueBase = 0;

    if (useLowValueSamePeriodPath) {
      resolvedSalvageRuleType = "NONE";
      resolvedSalvagePercent = null;
      resolvedSalvageAmountBaseRule = null;
    } else {
      if (resolvedSalvageRuleType === "PERCENT_OF_COST" && asset.salvage_percent == null) {
        throw badRequest("salvagePercent is required when salvageRuleType is PERCENT_OF_COST");
      }
      if (resolvedSalvageRuleType === "FIXED_BASE_AMOUNT" && asset.salvage_amount_base_rule == null) {
        throw badRequest("salvageAmountBaseRule is required when salvageRuleType is FIXED_BASE_AMOUNT");
      }
    }

    // ── Account mapping validation ──────────────────────────────
    for (const rule of ASSET_ACCOUNT_TYPE_RULES) {
      const accountId = asset[rule.column] != null ? Number(asset[rule.column]) : null;
      if (!accountId) {
        throw badRequest(`${rule.label} is required for activation`);
      }
      await validateAccountForCategory(
        accountId, legalEntityId, tenantId,
        rule.expectedType, rule.label, tx.query
      );
    }

    // ── Re-snapshot profile fields at activation time ────────────
    // ── Recompute salvage values at activation-time cost ─────────
    if (!useLowValueSamePeriodPath) {
      const computedSalvageValues = computeSalvageValues(
        resolvedSalvageRuleType,
        resolvedSalvagePercent,
        resolvedSalvageAmountBaseRule,
        costTxn, costBase
      );
      resolvedSalvageValueTxn = computedSalvageValues.salvageValueTxn;
      resolvedSalvageValueBase = computedSalvageValues.salvageValueBase;
      validateSalvageSnapshotForActivation({
        salvageRuleType: resolvedSalvageRuleType,
        salvagePercent: resolvedSalvagePercent,
        salvageAmountBaseRule: resolvedSalvageAmountBaseRule,
        salvageValueTxn: resolvedSalvageValueTxn,
        salvageValueBase: resolvedSalvageValueBase,
        originalCostTxn: costTxn,
        originalCostBase: costBase,
      });
    }

    // ── Resolve book & fiscal period ────────────────────────────
    const book = await resolveBookForLegalEntity(tenantId, legalEntityId, tx.query);
    const period = await resolveFiscalPeriodForDate(book.calendar_id, postingDate, tx.query);
    await ensurePeriodOpen(book.id, period.id, tx.query);

    // ── Determine activated status ──────────────────────────────
    let activatedStatus = "ACTIVE";
    let remainingUsefulLifeMonths = Number(asset.useful_life_months);
    let acquisitionAccumDeprAmountTxn = 0;
    let acquisitionAccumDeprAmountBase = 0;
    let acquisitionNbvAmountTxn = roundActivationAmount(costTxn - resolvedSalvageValueTxn);
    let acquisitionNbvAmountBase = roundActivationAmount(costBase - resolvedSalvageValueBase);
    let acquisitionTransactionNote = "Standard manual activation";
    let createLowValueFullExpenseTransaction = false;
    let lowValueDepreciationAccumDeprAmountTxn = null;
    let lowValueDepreciationAccumDeprAmountBase = null;
    let lowValueDepreciationNbvAmountTxn = null;
    let lowValueDepreciationNbvAmountBase = null;

    if (isLegacyOnboarding) {
      const legacyActivation = validateLegacyOnboardingForActivation({
        asset,
        originalCostTxn: costTxn,
        originalCostBase: costBase,
        salvageValueTxn: resolvedSalvageValueTxn,
        salvageValueBase: resolvedSalvageValueBase,
      });

      if (legacyActivation.hasRemainingDepreciableAmount) {
        if (!asset.depreciation_profile_id) {
          throw badRequest("depreciationProfileId is required for legacy onboarding activation when remaining depreciable amount exists");
        }
        if (!asset.useful_life_months || Number(asset.useful_life_months) <= 0) {
          throw badRequest("usefulLifeMonths is required for legacy onboarding activation when remaining depreciable amount exists");
        }

        profileSnapshot = await loadProfileSnapshot(
          Number(asset.depreciation_profile_id),
          legalEntityId,
          tenantId,
          tx.query
        );
        if (!profileSnapshot) {
          throw badRequest("Failed to load depreciation profile for legacy onboarding activation");
        }
        if (profileSnapshot.status !== "ACTIVE") {
          throw badRequest("depreciationProfileId must reference an ACTIVE depreciation profile");
        }
        if (!profileSnapshot.depreciationMethod || profileSnapshot.depreciationMethod === "NONE") {
          throw badRequest("Legacy onboarding with remaining depreciable amount requires a depreciable depreciation profile");
        }
      }

      activatedStatus = legacyActivation.activatedStatus;
      remainingUsefulLifeMonths = legacyActivation.remainingUsefulLifeMonths;
      acquisitionAccumDeprAmountTxn = legacyActivation.legacyAccumDeprTxn;
      acquisitionAccumDeprAmountBase = legacyActivation.legacyAccumDeprBase;
      acquisitionNbvAmountTxn = legacyActivation.legacyNbvTxn;
      acquisitionNbvAmountBase = legacyActivation.legacyNbvBase;
      acquisitionTransactionNote = "Legacy onboarding activation";
    } else if (useLowValueSamePeriodPath) {
      activatedStatus = "FULLY_DEPRECIATED";
      remainingUsefulLifeMonths = 0;
      acquisitionTransactionNote = "Low-value manual activation";
      acquisitionNbvAmountTxn = roundActivationAmount(costTxn);
      acquisitionNbvAmountBase = roundActivationAmount(costBase);
      createLowValueFullExpenseTransaction = true;
      lowValueDepreciationAccumDeprAmountTxn = roundActivationAmount(costTxn);
      lowValueDepreciationAccumDeprAmountBase = roundActivationAmount(costBase);
      lowValueDepreciationNbvAmountTxn = 0;
      lowValueDepreciationNbvAmountBase = 0;
    } else {
      if (!asset.depreciation_profile_id) {
        throw badRequest("depreciationProfileId is required for activation");
      }
      if (!asset.useful_life_months || Number(asset.useful_life_months) <= 0) {
        throw badRequest("usefulLifeMonths is required for activation");
      }

      profileSnapshot = await loadProfileSnapshot(
        Number(asset.depreciation_profile_id),
        legalEntityId,
        tenantId,
        tx.query
      );
      if (!profileSnapshot) {
        throw badRequest("Failed to load depreciation profile for activation snapshot");
      }
      if (profileSnapshot.status !== "ACTIVE") {
        throw badRequest("depreciationProfileId must reference an ACTIVE depreciation profile");
      }
      if (!profileSnapshot.depreciationMethod || profileSnapshot.depreciationMethod === "NONE") {
        throw badRequest("Standard manual activation requires a depreciable depreciation profile");
      }
    }

    const resolvedDepreciationMethod = useLowValueSamePeriodPath
      ? "NONE"
      : (
        profileSnapshot?.depreciationMethod
        ?? asset.depreciation_method
        ?? null
      );
    const resolvedDecliningBalanceRatePercent = useLowValueSamePeriodPath
      ? null
      : (
        profileSnapshot?.decliningBalanceRatePercent
        ?? (asset.declining_balance_rate_percent != null ? Number(asset.declining_balance_rate_percent) : null)
      );
    const resolvedSwitchToStraightLine = useLowValueSamePeriodPath
      ? 0
      : (
        profileSnapshot != null
          ? (profileSnapshot.switchToStraightLine ? 1 : 0)
          : (
            asset.switch_to_straight_line === 1
            || asset.switch_to_straight_line === true
            || asset.switch_to_straight_line === "1"
              ? 1
              : 0
          )
      );

    // ── Update asset to activated state ──────────────────────────
    await tx.query(
      `UPDATE fixed_assets
          SET status = ?,
              capitalization_date = ?,
              in_service_date = ?,
              salvage_rule_type = ?,
              salvage_percent = ?,
              salvage_amount_base_rule = ?,
              depreciation_method = ?,
              declining_balance_rate_percent = ?,
              switch_to_straight_line = ?,
              salvage_value_txn = ?,
              salvage_value_base = ?,
              remaining_useful_life_months = ?,
              updated_by_user_id = ?
        WHERE id = ? AND tenant_id = ?`,
      [
        activatedStatus,
        capitalizationDate,
        inServiceDate,
        resolvedSalvageRuleType,
        resolvedSalvagePercent,
        resolvedSalvageAmountBaseRule,
        resolvedDepreciationMethod,
        resolvedDecliningBalanceRatePercent,
        resolvedSwitchToStraightLine,
        resolvedSalvageValueTxn,
        resolvedSalvageValueBase,
        remainingUsefulLifeMonths,
        userId,
        assetId, tenantId,
      ]
    );

    // ── Create ACQUISITION transaction ──────────────────────────
    await insertFixedAssetTransaction(tx, {
      tenantId,
      legalEntityId,
      assetId,
      transactionType: "ACQUISITION",
      effectiveDate: capitalizationDate,
      postingDate,
      bookId: book.id,
      fiscalPeriodId: period.id,
      currencyCode: asset.currency_code,
      grossAmountTxn: costTxn,
      grossAmountBase: costBase,
      accumDeprAmountTxn: acquisitionAccumDeprAmountTxn,
      accumDeprAmountBase: acquisitionAccumDeprAmountBase,
      nbvAmountTxn: acquisitionNbvAmountTxn,
      nbvAmountBase: acquisitionNbvAmountBase,
      note: acquisitionTransactionNote,
      createdByUserId: userId,
    });

    if (createLowValueFullExpenseTransaction) {
      await insertFixedAssetTransaction(tx, {
        tenantId,
        legalEntityId,
        assetId,
        transactionType: "DEPRECIATION",
        effectiveDate: capitalizationDate,
        postingDate,
        bookId: book.id,
        fiscalPeriodId: period.id,
        currencyCode: asset.currency_code,
        depreciationKind: "LOW_VALUE_FULL_EXPENSE",
        grossAmountTxn: costTxn,
        grossAmountBase: costBase,
        accumDeprAmountTxn: lowValueDepreciationAccumDeprAmountTxn,
        accumDeprAmountBase: lowValueDepreciationAccumDeprAmountBase,
        nbvAmountTxn: lowValueDepreciationNbvAmountTxn,
        nbvAmountBase: lowValueDepreciationNbvAmountBase,
        note: "Low-value same-period full expense",
        createdByUserId: userId,
      });
    }

    return assetId;
  }).then(async (activatedId) => {
    return getAssetDetail({ tenantId, assetId: activatedId });
  });
}

export async function activateAssetStandard(input) {
  return activateAsset(input);
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

// ═══════════════════════════════════════════════════════════════════
// Depreciation Profile CRUD
// ═══════════════════════════════════════════════════════════════════

function mapProfileRow(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    legalEntityId: row.legal_entity_id,
    code: row.code,
    name: row.name,
    status: row.status,
    method: row.method,
    decliningBalanceRatePercent: row.declining_balance_rate_percent != null
      ? Number(row.declining_balance_rate_percent)
      : null,
    switchToStraightLine: row.switch_to_straight_line === 1
      || row.switch_to_straight_line === true
      || row.switch_to_straight_line === "1",
    description: row.description || null,
    createdByUserId: row.created_by_user_id,
    updatedByUserId: row.updated_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Enforce method/rate compatibility after merging updates.
 */
function enforceMethodRateCompatibility(method, decliningBalanceRatePercent) {
  if (method === "DECLINING_BALANCE") {
    if (decliningBalanceRatePercent === null || decliningBalanceRatePercent === undefined) {
      throw badRequest("decliningBalanceRatePercent is required when method is DECLINING_BALANCE");
    }
  } else {
    if (decliningBalanceRatePercent !== null && decliningBalanceRatePercent !== undefined) {
      throw badRequest("decliningBalanceRatePercent must be null when method is not DECLINING_BALANCE");
    }
  }
}

export async function listProfiles({ tenantId, legalEntityId, status }) {
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
    `SELECT * FROM fixed_asset_depreciation_profiles
      WHERE ${conditions.join(" AND ")}
      ORDER BY code ASC`,
    params
  );

  return {
    rows: (result.rows || []).map(mapProfileRow),
    total: result.rows?.length || 0,
  };
}

export async function createProfile({ payload }) {
  const {
    tenantId, legalEntityId, code, name, status, method,
    decliningBalanceRatePercent, switchToStraightLine, description,
  } = payload;

  // Code uniqueness within (tenant_id, legal_entity_id)
  const existing = await query(
    `SELECT id FROM fixed_asset_depreciation_profiles
      WHERE tenant_id = ? AND legal_entity_id = ? AND code = ?
      LIMIT 1`,
    [tenantId, legalEntityId, code]
  );
  if (existing.rows?.length > 0) {
    throw badRequest(`A depreciation profile with code '${code}' already exists in this legal entity`);
  }

  const userId = payload.userId || null;

  const insertResult = await query(
    `INSERT INTO fixed_asset_depreciation_profiles (
       tenant_id, legal_entity_id, code, name, status, method,
       declining_balance_rate_percent, switch_to_straight_line, description,
       created_by_user_id, updated_by_user_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tenantId, legalEntityId, code, name, status, method,
      decliningBalanceRatePercent, switchToStraightLine ? 1 : 0, description,
      userId, userId,
    ]
  );

  const newId = insertResult.rows?.insertId;

  const readResult = await query(
    `SELECT * FROM fixed_asset_depreciation_profiles WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [newId, tenantId]
  );

  return mapProfileRow(readResult.rows[0]);
}

export async function updateProfile({ tenantId, profileId, updates, userId }) {
  if (!tenantId) throw badRequest("tenantId is required");
  if (!profileId) throw badRequest("profileId is required");

  // Load existing
  const existingResult = await query(
    `SELECT * FROM fixed_asset_depreciation_profiles WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [profileId, tenantId]
  );
  const existing = existingResult.rows?.[0];
  if (!existing) {
    throw badRequest(`Depreciation profile (id=${profileId}) not found for tenant`);
  }

  const legalEntityId = existing.legal_entity_id;

  // Code uniqueness check if code is being changed
  if (updates.code !== undefined && updates.code !== existing.code) {
    const dup = await query(
      `SELECT id FROM fixed_asset_depreciation_profiles
        WHERE tenant_id = ? AND legal_entity_id = ? AND code = ? AND id != ?
        LIMIT 1`,
      [tenantId, legalEntityId, updates.code, profileId]
    );
    if (dup.rows?.length > 0) {
      throw badRequest(`A depreciation profile with code '${updates.code}' already exists in this legal entity`);
    }
  }

  // Method/rate compatibility check when either field changes
  if (updates.method !== undefined || updates.decliningBalanceRatePercent !== undefined) {
    const mergedMethod = updates.method !== undefined
      ? updates.method
      : existing.method;
    const mergedRate = updates.decliningBalanceRatePercent !== undefined
      ? updates.decliningBalanceRatePercent
      : (existing.declining_balance_rate_percent != null ? Number(existing.declining_balance_rate_percent) : null);

    enforceMethodRateCompatibility(mergedMethod, mergedRate);
  }

  // Build SET clause
  const setClauses = [];
  const setParams = [];

  const columnMap = {
    code: "code",
    name: "name",
    status: "status",
    method: "method",
    decliningBalanceRatePercent: "declining_balance_rate_percent",
    switchToStraightLine: "switch_to_straight_line",
    description: "description",
  };

  for (const [jsField, dbColumn] of Object.entries(columnMap)) {
    if (updates[jsField] !== undefined) {
      let value = updates[jsField];
      if (jsField === "switchToStraightLine") {
        value = value ? 1 : 0;
      }
      setClauses.push(`${dbColumn} = ?`);
      setParams.push(value);
    }
  }

  if (userId) {
    setClauses.push("updated_by_user_id = ?");
    setParams.push(userId);
  }

  if (setClauses.length === 0) {
    return mapProfileRow(existing);
  }

  setParams.push(profileId, tenantId);

  await query(
    `UPDATE fixed_asset_depreciation_profiles
        SET ${setClauses.join(", ")}
      WHERE id = ? AND tenant_id = ?`,
    setParams
  );

  const readResult = await query(
    `SELECT * FROM fixed_asset_depreciation_profiles WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [profileId, tenantId]
  );

  return mapProfileRow(readResult.rows[0]);
}

// ═══════════════════════════════════════════════════════════════════
// Custodian CRUD
// ═══════════════════════════════════════════════════════════════════

function mapCustodianRow(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    legalEntityId: row.legal_entity_id,
    employeeCode: row.employee_code,
    displayName: row.display_name,
    operatingUnitId: row.operating_unit_id != null
      ? Number(row.operating_unit_id)
      : null,
    status: row.status,
    notes: row.notes || null,
    createdByUserId: row.created_by_user_id,
    updatedByUserId: row.updated_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listCustodians({ tenantId, legalEntityId, operatingUnitId, status }) {
  if (!tenantId) throw badRequest("tenantId is required");

  const conditions = ["tenant_id = ?"];
  const params = [tenantId];

  if (legalEntityId) {
    conditions.push("legal_entity_id = ?");
    params.push(legalEntityId);
  }
  if (operatingUnitId) {
    conditions.push("operating_unit_id = ?");
    params.push(operatingUnitId);
  }
  if (status) {
    conditions.push("status = ?");
    params.push(status);
  }

  const result = await query(
    `SELECT * FROM fixed_asset_custodian_employees
      WHERE ${conditions.join(" AND ")}
      ORDER BY employee_code ASC`,
    params
  );

  return {
    rows: (result.rows || []).map(mapCustodianRow),
    total: result.rows?.length || 0,
  };
}

export async function createCustodian({ payload }) {
  const {
    tenantId, legalEntityId, employeeCode, displayName,
    operatingUnitId, status, notes,
  } = payload;

  // employee_code uniqueness within (tenant_id, legal_entity_id)
  const existing = await query(
    `SELECT id FROM fixed_asset_custodian_employees
      WHERE tenant_id = ? AND legal_entity_id = ? AND employee_code = ?
      LIMIT 1`,
    [tenantId, legalEntityId, employeeCode]
  );
  if (existing.rows?.length > 0) {
    throw badRequest(`A custodian with employee code '${employeeCode}' already exists in this legal entity`);
  }

  const userId = payload.userId || null;

  const insertResult = await query(
    `INSERT INTO fixed_asset_custodian_employees (
       tenant_id, legal_entity_id, employee_code, display_name,
       operating_unit_id, status, notes,
       created_by_user_id, updated_by_user_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tenantId, legalEntityId, employeeCode, displayName,
      operatingUnitId || null, status, notes,
      userId, userId,
    ]
  );

  const newId = insertResult.rows?.insertId;

  const readResult = await query(
    `SELECT * FROM fixed_asset_custodian_employees WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [newId, tenantId]
  );

  return mapCustodianRow(readResult.rows[0]);
}

export async function updateCustodian({ tenantId, custodianId, updates, userId }) {
  if (!tenantId) throw badRequest("tenantId is required");
  if (!custodianId) throw badRequest("custodianId is required");

  const existingResult = await query(
    `SELECT * FROM fixed_asset_custodian_employees WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [custodianId, tenantId]
  );
  const existing = existingResult.rows?.[0];
  if (!existing) {
    throw badRequest(`Custodian (id=${custodianId}) not found for tenant`);
  }

  const legalEntityId = existing.legal_entity_id;

  // employee_code uniqueness check if being changed
  if (updates.employeeCode !== undefined && updates.employeeCode !== existing.employee_code) {
    const dup = await query(
      `SELECT id FROM fixed_asset_custodian_employees
        WHERE tenant_id = ? AND legal_entity_id = ? AND employee_code = ? AND id != ?
        LIMIT 1`,
      [tenantId, legalEntityId, updates.employeeCode, custodianId]
    );
    if (dup.rows?.length > 0) {
      throw badRequest(`A custodian with employee code '${updates.employeeCode}' already exists in this legal entity`);
    }
  }

  const setClauses = [];
  const setParams = [];

  const columnMap = {
    employeeCode: "employee_code",
    displayName: "display_name",
    operatingUnitId: "operating_unit_id",
    status: "status",
    notes: "notes",
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
    return mapCustodianRow(existing);
  }

  setParams.push(custodianId, tenantId);

  await query(
    `UPDATE fixed_asset_custodian_employees
        SET ${setClauses.join(", ")}
      WHERE id = ? AND tenant_id = ?`,
    setParams
  );

  const readResult = await query(
    `SELECT * FROM fixed_asset_custodian_employees WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [custodianId, tenantId]
  );

  return mapCustodianRow(readResult.rows[0]);
}
