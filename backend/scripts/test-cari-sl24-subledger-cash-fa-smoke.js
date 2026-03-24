
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, query } from "../src/db.js";
import { resolveOrPrepareSmokeContext } from "./_smoke-context.js";
import {
  createCariDraftDocument,
  postCariDocumentById,
  reverseCariPostedDocumentById,
} from "../src/services/cari.document.service.js";
import { insertCashRegister, markAccountAsCashControlled } from "../src/services/cash.queries.js";
import {
  createAssetDraft,
  activateAsset,
} from "../src/services/fixed-assets.service.js";
import {
  resolveDestinationAsync,
  resolveReverseBlockAsync,
} from "../src/services/gl.reverse-block-destination.service.js";
import { createInventoryWarehouse, materializeInventoryMovementFromCariStockLink } from "../src/services/inventory.service.js";
import { createItemCard } from "../src/services/item.card.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const KEEP_ARTIFACTS = parseBooleanEnv(process.env.SL24_SMOKE_KEEP_ARTIFACTS, false);

const PURPOSE_CODES = Object.freeze([
  "CARI_AR_CONTROL",
  "CARI_AR_OFFSET",
  "CARI_AP_CONTROL",
  "CARI_AP_OFFSET",
  "CARI_AR_CONTROL_CASH",
  "CARI_AR_OFFSET_CASH",
  "CARI_AP_CONTROL_CASH",
  "CARI_AP_OFFSET_CASH",
]);

let passed = 0;

function parseBooleanEnv(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeUpper(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function amountsEqual(left, right, epsilon = 0.000001) {
  return Math.abs(toNumber(left) - toNumber(right)) <= epsilon;
}

function addDays(dateText, days) {
  const next = new Date(`${String(dateText).slice(0, 10)}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + Number(days || 0));
  return next.toISOString().slice(0, 10);
}

function minDate(left, right) {
  return left <= right ? left : right;
}

function scenarioDate(window, offset) {
  return minDate(addDays(window.startDate, offset), window.endDate);
}

function makeInClause(ids) {
  return ids.map(() => "?").join(", ");
}

function makeRequestContext({ tenantId, userId, stamp, suffix }) {
    return {
      requestId: `${stamp}:${suffix}`.slice(0, 80),
      headers: { "user-agent": "sl24-subledger-cash-fa-smoke" },
      ip: "127.0.0.1",
      user: { tenantId, userId },
      rbac: {
        scopeContext: {
          tenantWide: true,
          groups: new Set(),
          countries: new Set(),
          legalEntities: new Set(),
          operatingUnits: new Set(),
        },
      },
      tenantId,
    };
  }

function routeMatches(route, expectedPath, expectedParams = {}) {
    if (!route) {
      return false;
    }
    const parsed = new URL(route, "http://localhost");
    if (parsed.pathname !== expectedPath) {
      return false;
    }
    return Object.entries(expectedParams).every(
      ([key, value]) => parsed.searchParams.get(key) === String(value)
    );
  }

function allowAllScopes() { }

async function runCheck(label, fn) {
  await fn();
  passed += 1;
  console.log(`  âœ“ ${label}`);
}

function buildState(stamp) {
  return {
    stamp,
    context: null,
    previousPurposeMappings: null,
    createdCoaId: null,
    createdUserIds: [],
    createdUserRoleScopeUserIds: [],
    createdAccountIds: [],
    createdCounterpartyIds: [],
    createdProfileIds: [],
    createdCategoryIds: [],
    createdOperatingUnitIds: [],
    createdRegisterIds: [],
    createdWarehouseIds: [],
    createdItemCardIds: [],
    documentIds: [],
    settlementBatchIds: [],
    cashTransactionIds: [],
    journalEntryIds: [],
    stockLinkIds: [],
    inventoryMovementIds: [],
    fixedAssetIds: [],
    fixedAssetTransactionIds: [],
  };
}

async function resolveSmokeContext() {
  return resolveOrPrepareSmokeContext({ prefix: "SL24" });
}

async function resolveLegalEntityCoaId(tenantId, legalEntityId, state) {
    const existing = await query(
      `SELECT id
       FROM charts_of_accounts
      WHERE tenant_id = ?
        AND legal_entity_id = ?
        AND scope = 'LEGAL_ENTITY'
      ORDER BY id ASC
      LIMIT 1`,
      [tenantId, legalEntityId]
    );
    const coaId = toPositiveInt(existing.rows?.[0]?.id);
    if (coaId) {
      return coaId;
    }

    const code = `SL24COA${state.stamp.slice(-6)}`.slice(0, 60).toUpperCase();
    const insert = await query(
      `INSERT INTO charts_of_accounts (
        tenant_id,
        legal_entity_id,
        scope,
        code,
        name
      ) VALUES (?, ?, 'LEGAL_ENTITY', ?, ?)`,
      [tenantId, legalEntityId, code, `SL24 Smoke CoA ${state.stamp}`]
    );
    const createdId = toPositiveInt(insert.rows?.insertId);
    assert(createdId, "Failed to create fallback CoA for SL24 smoke");
    state.createdCoaId = createdId;
    return createdId;
  }

async function resolveTenantAdminRoleId(tenantId) {
    const result = await query(
      `SELECT id
       FROM roles
      WHERE tenant_id = ?
        AND code = 'TenantAdmin'
      LIMIT 1`,
      [tenantId]
    );
    const roleId = toPositiveInt(result.rows?.[0]?.id);
    assert(roleId, `TenantAdmin role not found for tenant ${tenantId}`);
    return roleId;
  }

async function createSmokeUser({ tenantId, stamp, state }) {
    const insert = await query(
      `INSERT INTO users (
        tenant_id,
        email,
        password_hash,
        name,
        status
      ) VALUES (?, ?, ?, ?, 'ACTIVE')`,
      [
        tenantId,
        `sl24.smoke.${stamp}@example.test`,
        "not-used-in-direct-service-smoke",
        `SL24 Smoke ${stamp}`,
      ]
    );
    const userId = toPositiveInt(insert.rows?.insertId);
    assert(userId, "Failed to create SL24 smoke user");
    state.createdUserIds.push(userId);

    const roleId = await resolveTenantAdminRoleId(tenantId);
    await query(
      `INSERT INTO user_role_scopes (
        tenant_id,
        user_id,
        role_id,
        scope_type,
        scope_id,
        effect
      ) VALUES (?, ?, ?, 'TENANT', ?, 'ALLOW')`,
      [tenantId, userId, roleId, tenantId]
    );
    state.createdUserRoleScopeUserIds.push(userId);
    return userId;
  }

async function capturePurposeMappings({ tenantId, legalEntityId }) {
    const result = await query(
      `SELECT purpose_code, account_id
       FROM journal_purpose_accounts
      WHERE tenant_id = ?
        AND legal_entity_id = ?
        AND purpose_code IN (${makeInClause(PURPOSE_CODES)})`,
      [tenantId, legalEntityId, ...PURPOSE_CODES]
    );
    const map = new Map();
    for (const row of result.rows || []) {
      map.set(normalizeUpper(row.purpose_code), toPositiveInt(row.account_id));
    }
    return map;
  }

async function restorePurposeMappings({
    tenantId,
    legalEntityId,
    previousMappings,
  }) {
    for (const purposeCode of PURPOSE_CODES) {
      const previousAccountId = toPositiveInt(previousMappings.get(purposeCode));
      if (previousAccountId) {
        await query(
          `INSERT INTO journal_purpose_accounts (
            tenant_id,
            legal_entity_id,
            purpose_code,
            account_id
          ) VALUES (?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE account_id = VALUES(account_id)`,
          [tenantId, legalEntityId, purposeCode, previousAccountId]
        );
        continue;
      }
      await query(
        `DELETE FROM journal_purpose_accounts
        WHERE tenant_id = ?
          AND legal_entity_id = ?
          AND purpose_code = ?`,
        [tenantId, legalEntityId, purposeCode]
      );
    }
  }

async function createTempAccounts({
    coaId,
    tenantId,
    legalEntityId,
    stamp,
    state,
  }) {
    const defs = [
      ["arControlAccountId", "ASSET", "DEBIT", "ARCTL", "AR Control"],
      ["arOffsetAccountId", "REVENUE", "CREDIT", "ARREV", "AR Revenue"],
      ["apControlAccountId", "LIABILITY", "CREDIT", "APCTL", "AP Control"],
      ["apOffsetAccountId", "EXPENSE", "DEBIT", "APEXP", "AP Expense"],
      ["inventoryAssetAccountId", "ASSET", "DEBIT", "INVAS", "Inventory Asset"],
      ["cogsAccountId", "EXPENSE", "DEBIT", "COGS", "COGS"],
      ["cashRegisterAccountId", "ASSET", "DEBIT", "CASH", "Cash Register"],
      ["fixedAssetAccountId", "ASSET", "DEBIT", "FAAST", "Fixed Asset"],
      ["accumDeprAccountId", "ASSET", "CREDIT", "FAACC", "Accumulated Depreciation"],
      ["deprExpenseAccountId", "EXPENSE", "DEBIT", "FADEP", "Depreciation Expense"],
      ["disposalGainAccountId", "REVENUE", "CREDIT", "FAGAI", "Disposal Gain"],
      ["disposalLossAccountId", "EXPENSE", "DEBIT", "FALOS", "Disposal Loss"],
    ];

    const ids = {};
    for (const [key, accountType, normalSide, suffix, label] of defs) {
      const code = `SL24${suffix}${stamp.slice(-5)}`.slice(0, 50).toUpperCase();
      const insert = await query(
        `INSERT INTO accounts (
          coa_id,
          code,
          name,
          account_type,
          normal_side,
          allow_posting,
          parent_account_id,
          is_active
        ) VALUES (?, ?, ?, ?, ?, TRUE, NULL, TRUE)`,
        [coaId, code, `SL24 ${label} ${stamp}`, accountType, normalSide]
      );
      const accountId = toPositiveInt(insert.rows?.insertId);
      assert(accountId, `Failed to create ${label} account for SL24 smoke`);
      ids[key] = accountId;
      state.createdAccountIds.push(accountId);
    }

    await query(
      `INSERT INTO journal_purpose_accounts (
        tenant_id,
        legal_entity_id,
        purpose_code,
        account_id
      ) VALUES
        (?, ?, 'CARI_AR_CONTROL', ?),
        (?, ?, 'CARI_AR_OFFSET', ?),
        (?, ?, 'CARI_AP_CONTROL', ?),
        (?, ?, 'CARI_AP_OFFSET', ?),
        (?, ?, 'CARI_AR_CONTROL_CASH', ?),
        (?, ?, 'CARI_AR_OFFSET_CASH', ?),
        (?, ?, 'CARI_AP_CONTROL_CASH', ?),
        (?, ?, 'CARI_AP_OFFSET_CASH', ?)
      ON DUPLICATE KEY UPDATE account_id = VALUES(account_id)`,
      [
        tenantId,
        legalEntityId,
        ids.arControlAccountId,
        tenantId,
        legalEntityId,
        ids.arOffsetAccountId,
        tenantId,
        legalEntityId,
        ids.apControlAccountId,
        tenantId,
        legalEntityId,
        ids.apOffsetAccountId,
        tenantId,
        legalEntityId,
        ids.arControlAccountId,
        tenantId,
        legalEntityId,
        ids.arOffsetAccountId,
        tenantId,
        legalEntityId,
        ids.apControlAccountId,
        tenantId,
        legalEntityId,
        ids.apOffsetAccountId,
      ]
    );

    return ids;
  }

async function createTempOperatingUnit({
    tenantId,
    legalEntityId,
    stamp,
    label,
    state,
  }) {
    const code = `SL24${label}${stamp.slice(-6)}`.slice(0, 80).toUpperCase();
    const insert = await query(
      `INSERT INTO operating_units (
        tenant_id,
        legal_entity_id,
        code,
        name,
        unit_type,
        has_subledger,
        central_due_from_account_id,
        central_due_to_account_id,
        ou_due_from_central_account_id,
        ou_due_to_central_account_id
      ) VALUES (?, ?, ?, ?, 'BRANCH', FALSE, NULL, NULL, NULL, NULL)`,
      [tenantId, legalEntityId, code, `SL24 ${label} ${stamp}`]
    );
    const operatingUnitId = toPositiveInt(insert.rows?.insertId);
    assert(operatingUnitId, `Failed to create operating unit ${label}`);
    state.createdOperatingUnitIds.push(operatingUnitId);
    return operatingUnitId;
  }

async function resolveOpenPostingWindow(tenantId, legalEntityId) {
    const today = new Date().toISOString().slice(0, 10);
    const result = await query(
      `SELECT fp.start_date, fp.end_date
       FROM books b
       JOIN fiscal_periods fp
         ON fp.calendar_id = b.calendar_id
       LEFT JOIN period_statuses ps
         ON ps.book_id = b.id
        AND ps.fiscal_period_id = fp.id
      WHERE b.tenant_id = ?
        AND b.legal_entity_id = ?
        AND b.book_type = 'LOCAL'
        AND fp.is_adjustment = 0
        AND COALESCE(ps.status, 'OPEN') = 'OPEN'
      ORDER BY CASE WHEN ? BETWEEN fp.start_date AND fp.end_date THEN 0 ELSE 1 END,
               fp.start_date DESC
      LIMIT 1`,
      [tenantId, legalEntityId, today]
    );
    const row = result.rows?.[0] || null;
    assert(row, "No OPEN posting window found for SL24 smoke");
    return {
      startDate: String(row.start_date).slice(0, 10),
      endDate: String(row.end_date).slice(0, 10),
    };
  }

async function createCounterparty({
    tenantId,
    legalEntityId,
    code,
    name,
    currencyCode,
    isCustomer,
    isVendor,
    state,
  }) {
    const insert = await query(
      `INSERT INTO counterparties (
        tenant_id,
        legal_entity_id,
        code,
        name,
        is_customer,
        is_vendor,
        default_currency_code,
        status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
      [
        tenantId,
        legalEntityId,
        code,
        name,
        isCustomer ? 1 : 0,
        isVendor ? 1 : 0,
        currencyCode,
      ]
    );
    const counterpartyId = toPositiveInt(insert.rows?.insertId);
    assert(counterpartyId, `Failed to create counterparty ${code}`);
    state.createdCounterpartyIds.push(counterpartyId);
    return counterpartyId;
  }

async function createSmokeProfile({
    tenantId,
    legalEntityId,
    userId,
    stamp,
    state,
  }) {
    const insert = await query(
      `INSERT INTO fixed_asset_depreciation_profiles (
        tenant_id,
        legal_entity_id,
        code,
        name,
        status,
        method,
        declining_balance_rate_percent,
        switch_to_straight_line,
        description,
        created_by_user_id,
        updated_by_user_id
      ) VALUES (?, ?, ?, ?, 'ACTIVE', 'STRAIGHT_LINE', NULL, 0, ?, ?, ?)`,
      [
        tenantId,
        legalEntityId,
        `SL24PF${stamp.slice(-6)}`.toUpperCase(),
        `SL24 Profile ${stamp}`,
        "SL24 smoke profile",
        userId,
        userId,
      ]
    );
    const profileId = toPositiveInt(insert.rows?.insertId);
    assert(profileId, "Failed to create fixed-asset profile for SL24");
    state.createdProfileIds.push(profileId);
    return profileId;
  }

async function createSmokeCategory({
    tenantId,
    legalEntityId,
    userId,
    profileId,
    accounts,
    stamp,
    state,
  }) {
    const insert = await query(
      `INSERT INTO fixed_asset_categories (
        tenant_id,
        legal_entity_id,
        code,
        name,
        status,
        description,
        capitalization_threshold_base,
        default_useful_life_months,
        default_salvage_rule_type,
        default_salvage_amount_base,
        default_depreciation_profile_id,
        default_asset_account_id,
        default_accum_depr_account_id,
        default_depr_expense_account_id,
        default_disposal_gain_account_id,
        default_disposal_loss_account_id,
        created_by_user_id,
        updated_by_user_id
      ) VALUES (?, ?, ?, ?, 'ACTIVE', ?, 100, 24, 'NONE', NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        legalEntityId,
        `SL24CT${stamp.slice(-6)}`.toUpperCase(),
        `SL24 Category ${stamp}`,
        "SL24 smoke category",
        profileId,
        accounts.fixedAssetAccountId,
        accounts.accumDeprAccountId,
        accounts.deprExpenseAccountId,
        accounts.disposalGainAccountId,
        accounts.disposalLossAccountId,
        userId,
        userId,
      ]
    );
    const categoryId = toPositiveInt(insert.rows?.insertId);
    assert(categoryId, "Failed to create fixed-asset category for SL24");
    state.createdCategoryIds.push(categoryId);
    return categoryId;
  }

async function createSmokeRegister({
    tenantId,
    legalEntityId,
    userId,
    currencyCode,
    accountId,
    stamp,
    state,
  }) {
    await markAccountAsCashControlled({ accountId });
    const registerId = await insertCashRegister({
      payload: {
        tenantId,
        legalEntityId,
        ownershipScope: "CENTRAL",
        operatingUnitId: null,
        accountId,
        code: `SL24RG${stamp.slice(-6)}`.toUpperCase(),
        name: `SL24 Register ${stamp}`,
        registerType: "DRAWER",
        sessionMode: "OPTIONAL",
        currencyCode,
        status: "ACTIVE",
        allowNegative: false,
        varianceGainAccountId: null,
        varianceLossAccountId: null,
        maxTxnAmount: null,
        requiresApprovalOverAmount: null,
        userId,
      },
    });
    assert(registerId, "Failed to create cash register for SL24");
    state.createdRegisterIds.push(registerId);
    return registerId;
  }

async function createSmokeWarehouse({
    tenantId,
    legalEntityId,
    stamp,
    state,
  }) {
    const warehouse = await createInventoryWarehouse({
      payload: {
        tenantId,
        legalEntityId,
        code: `SL24WH${stamp.slice(-5)}`.toUpperCase(),
        name: `SL24 Warehouse ${stamp}`,
        status: "ACTIVE",
        notes: "SL24 stock smoke warehouse",
      },
    });
    const warehouseId = toPositiveInt(warehouse?.id);
    assert(warehouseId, "Failed to create warehouse for SL24");
    state.createdWarehouseIds.push(warehouseId);
    return warehouse;
  }

async function createSmokeItemCard({
    tenantId,
    legalEntityId,
    stamp,
    accounts,
    state,
  }) {
    const row = await createItemCard({
      payload: {
        tenantId,
        legalEntityId,
        code: `SL24IT${stamp.slice(-6)}`.toUpperCase(),
        name: `SL24 Item ${stamp}`,
        itemType: "STOCK_ITEM",
        defaultSalesAccountId: accounts.arOffsetAccountId,
        defaultPurchaseAccountId: accounts.apOffsetAccountId,
        inventoryAssetAccountId: accounts.inventoryAssetAccountId,
        defaultCogsAccountId: accounts.cogsAccountId,
        taxCategoryCode: null,
        status: "ACTIVE",
      },
    });
    const itemCardId = toPositiveInt(row?.id);
    assert(itemCardId, "Failed to create stock item card for SL24");
    state.createdItemCardIds.push(itemCardId);
    return row;
  }

async function loadDocumentLines(documentId) {
    const result = await query(
      `SELECT
        id,
        description,
        subledger_type,
        fixed_asset_mode,
        target_fixed_asset_id,
        quantity,
        posting_account_id,
        item_card_id,
        warehouse_id,
        line_net_amount_txn,
        line_net_amount_base
      FROM cari_document_lines
      WHERE cari_document_id = ?
      ORDER BY line_no ASC, id ASC`,
      [documentId]
    );
    return result.rows || [];
  }

async function getDocumentRow(documentId) {
    const result = await query(
      `SELECT
        id,
        status,
        direction,
        posted_journal_entry_id,
        reversal_of_document_id,
        auto_settlement_batch_id,
        auto_settlement_cash_transaction_id
      FROM cari_documents
      WHERE id = ?
      LIMIT 1`,
      [documentId]
    );
    return result.rows?.[0] || null;
  }

async function findReversalDocumentRow(originalDocumentId) {
    const result = await query(
      `SELECT
        id,
        posted_journal_entry_id
      FROM cari_documents
      WHERE reversal_of_document_id = ?
      ORDER BY id DESC
      LIMIT 1`,
      [originalDocumentId]
    );
    return result.rows?.[0] || null;
  }

async function getOpenItem(documentId) {
    const result = await query(
      `SELECT
        id,
        status,
        original_amount_txn,
        residual_amount_txn,
        settled_amount_txn
      FROM cari_open_items
      WHERE document_id = ?
      ORDER BY id ASC
      LIMIT 1`,
      [documentId]
    );
    return result.rows?.[0] || null;
  }

async function getCashTransactionRow(transactionId) {
    const result = await query(
      `SELECT
        id,
        status,
        txn_type,
        posted_journal_entry_id,
        reversal_of_transaction_id,
        linked_cari_settlement_batch_id,
        source_entity_type,
        source_entity_id
      FROM cash_transactions
      WHERE id = ?
      LIMIT 1`,
      [transactionId]
    );
    return result.rows?.[0] || null;
  }

async function getSettlementBatchRow(settlementBatchId) {
    const result = await query(
      `SELECT
        id,
        status,
        direction,
        cash_transaction_id,
        posted_journal_entry_id,
        reversal_of_settlement_batch_id
      FROM cari_settlement_batches
      WHERE id = ?
      LIMIT 1`,
      [settlementBatchId]
    );
    return result.rows?.[0] || null;
  }

async function countSettlementAllocations(settlementBatchId) {
    const result = await query(
      `SELECT COUNT(*) AS row_count
      FROM cari_settlement_allocations
      WHERE settlement_batch_id = ?`,
      [settlementBatchId]
    );
    return toNumber(result.rows?.[0]?.row_count);
  }

async function listAssetsBySourceLine(documentId, documentLineId) {
    const result = await query(
      `SELECT
        id,
        asset_no,
        status,
        original_cost_txn,
        original_cost_base,
        source_cari_document_line_unit_no,
        source_cari_document_id,
        source_cari_document_line_id
      FROM fixed_assets
      WHERE source_cari_document_id = ?
        AND source_cari_document_line_id = ?
      ORDER BY source_cari_document_line_unit_no ASC, id ASC`,
      [documentId, documentLineId]
    );
    return result.rows || [];
  }

async function listCapitalizationTransactionsBySourceLine(documentId, documentLineId) {
    const result = await query(
      `SELECT
        id,
        asset_id,
        transaction_type,
        status,
        source_ref_id,
        source_ref_line_id,
        gross_amount_txn,
        gross_amount_base,
        proceeds_amount_base
      FROM fixed_asset_transactions
      WHERE source_ref_type = 'CARI_DOCUMENT'
        AND source_ref_id = ?
        AND source_ref_line_id = ?
      ORDER BY id ASC`,
      [documentId, documentLineId]
    );
    return result.rows || [];
  }

async function getAssetRow(assetId) {
    const result = await query(
      `SELECT
        id,
        status,
        disposal_type,
        disposal_proceeds_base,
        disposal_gain_loss_base,
        disposed_at,
        source_cari_document_id,
        source_cari_document_line_id
      FROM fixed_assets
      WHERE id = ?
      LIMIT 1`,
      [assetId]
    );
    return result.rows?.[0] || null;
  }

async function listPostedDepreciationScheduleLinesByTransactionIds(transactionIds) {
    const normalizedIds = Array.from(
      new Set((Array.isArray(transactionIds) ? transactionIds : []).map((value) => toPositiveInt(value)).filter(Boolean))
    );
    if (normalizedIds.length === 0) {
      return [];
    }
    const result = await query(
      `SELECT
        id,
        asset_id,
        period_key,
        status,
        posted_transaction_id
      FROM fixed_asset_depreciation_schedule_lines
      WHERE posted_transaction_id IN (${makeInClause(normalizedIds)})
      ORDER BY id ASC`,
      normalizedIds
    );
    return result.rows || [];
  }

async function getPendingStockLinkByLine(documentId, documentLineId) {
    const result = await query(
      `SELECT
        id,
        stock_impact_mode,
        warehouse_id,
        inventory_movement_id,
        link_status
      FROM cari_document_line_stock_links
      WHERE cari_document_id = ?
        AND cari_document_line_id = ?
      ORDER BY id ASC
      LIMIT 1`,
      [documentId, documentLineId]
    );
    return result.rows?.[0] || null;
  }

async function getInventoryMovementRow(movementId) {
    const result = await query(
      `SELECT
        id,
        valuation_status,
        source_stock_link_id,
        posted_journal_entry_id
      FROM inventory_movements
      WHERE id = ?
      LIMIT 1`,
      [movementId]
    );
    return result.rows?.[0] || null;
  }

async function createDraftDocument({
    tenantId,
    userId,
    legalEntityId,
    counterpartyId,
    direction,
    documentDate,
    dueDate,
    currencyCode,
    lines,
    settlementMode,
    settlementCashRegisterId,
    operatingUnitId = null,
    stamp,
    suffix,
  }) {
    const draft = await createCariDraftDocument({
      req: makeRequestContext({ tenantId, userId, stamp, suffix }),
      payload: {
        tenantId,
        userId,
        legalEntityId,
        counterpartyId,
        paymentTermId: null,
        operatingUnitId,
        direction,
        documentType: "INVOICE",
        documentDate,
        dueDate,
        currencyCode,
        settlementMode,
        settlementCashRegisterId,
        lines,
      },
      assertScopeAccess: allowAllScopes,
    });
    return draft;
  }

async function postDraftDocument({
    tenantId,
    userId,
    documentId,
    stamp,
    suffix,
  }) {
    return postCariDocumentById({
      req: makeRequestContext({ tenantId, userId, stamp, suffix }),
      payload: {
        tenantId,
        userId,
        documentId,
      },
      assertScopeAccess: allowAllScopes,
    });
  }

async function reversePostedDocument({
    tenantId,
    userId,
    documentId,
    reversalDate,
    stamp,
    suffix,
  }) {
    return reverseCariPostedDocumentById({
      req: makeRequestContext({ tenantId, userId, stamp, suffix }),
      payload: {
        tenantId,
        userId,
        documentId,
        reversalDate,
        reason: `SL24 smoke reverse ${stamp}`,
      },
      assertScopeAccess: allowAllScopes,
    });
  }

async function createQuickLinkDraftAsset({
    env,
    name,
    amount,
  }) {
    const asset = await createAssetDraft({
      tenantId: env.tenantId,
      legalEntityId: env.legalEntityId,
      name,
      categoryId: env.categoryId,
      acquisitionDate: scenarioDate(env.window, 0),
      currencyCode: env.currencyCode,
      description: `${name} draft`,
      assetTag: null,
      serialNo: null,
      ownerOperatingUnitId: env.ownerOperatingUnitId,
      locationOperatingUnitId: env.locationOperatingUnitId,
      departmentCode: null,
      costCenterCode: null,
      custodianEmployeeId: null,
      counterpartyId: null,
      originalCostTxn: amount,
      originalCostBase: amount,
      userId: env.userId,
    });
    return asset;
  }

function pushUnique(target, values) {
  for (const value of values) {
    const normalized = toPositiveInt(value);
    if (normalized && !target.includes(normalized)) {
      target.push(normalized);
    }
  }
}

async function trackDocumentArtifacts(documentId, state) {
  const row = await getDocumentRow(documentId);
  if (!row) {
    return;
  }
  pushUnique(state.documentIds, [row.id]);
  pushUnique(state.journalEntryIds, [row.posted_journal_entry_id]);
  pushUnique(state.settlementBatchIds, [row.auto_settlement_batch_id]);
  pushUnique(state.cashTransactionIds, [row.auto_settlement_cash_transaction_id]);
}

async function trackSettlementArtifacts(settlementBatchId, state) {
    const row = await getSettlementBatchRow(settlementBatchId);
    if (!row) {
      return;
    }
    pushUnique(state.settlementBatchIds, [row.id]);
    pushUnique(state.cashTransactionIds, [row.cash_transaction_id]);
    pushUnique(state.journalEntryIds, [row.posted_journal_entry_id]);
  }

async function trackCashArtifacts(transactionId, state) {
    const row = await getCashTransactionRow(transactionId);
    if (!row) {
      return;
    }
    pushUnique(state.cashTransactionIds, [row.id]);
    pushUnique(state.journalEntryIds, [row.posted_journal_entry_id]);
  }

async function trackReversalSettlementAndCash(originalSettlementBatchId, originalCashTransactionId, state) {
    const [settlementResult, cashResult] = await Promise.all([
      query(
        `SELECT id, posted_journal_entry_id
         FROM cari_settlement_batches
        WHERE reversal_of_settlement_batch_id = ?
        ORDER BY id DESC
        LIMIT 1`,
        [originalSettlementBatchId]
      ),
      query(
        `SELECT id, posted_journal_entry_id
         FROM cash_transactions
        WHERE reversal_of_transaction_id = ?
        ORDER BY id DESC
        LIMIT 1`,
        [originalCashTransactionId]
      ),
    ]);
    const settlementRow = settlementResult.rows?.[0] || null;
    const cashRow = cashResult.rows?.[0] || null;
    pushUnique(state.settlementBatchIds, [settlementRow?.id]);
    pushUnique(state.cashTransactionIds, [cashRow?.id]);
    pushUnique(state.journalEntryIds, [
      settlementRow?.posted_journal_entry_id,
      cashRow?.posted_journal_entry_id,
    ]);
    return {
      settlementBatchId: toPositiveInt(settlementRow?.id),
      cashTransactionId: toPositiveInt(cashRow?.id),
    };
  }

async function runFrontendContractChecks() {
    console.log("\n-- Frontend + route contract checks --");

    const appSource = readFileSync(
      path.resolve(REPO_ROOT, "frontend/src/App.jsx"),
      "utf8"
    );
    const sidebarSource = readFileSync(
      path.resolve(REPO_ROOT, "frontend/src/layouts/sidebarConfig.js"),
      "utf8"
    );
    const pageSource = readFileSync(
      path.resolve(REPO_ROOT, "frontend/src/pages/cari/CariDocumentsPage.jsx"),
      "utf8"
    );
    const utilsSource = readFileSync(
      path.resolve(REPO_ROOT, "frontend/src/pages/cari/cariDocumentsUtils.js"),
      "utf8"
    );

    await runCheck("AP/AR document and settlement routes stay split in App.jsx", async () => {
      assert(
        appSource.includes('appPath: "/app/alis-faturalari"') &&
        appSource.includes('appPath: "/app/satis-faturalari"') &&
        appSource.includes('appPath: "/app/tedarikci-odemeler"') &&
        appSource.includes('appPath: "/app/musteri-tahsilatlar"'),
        "App routes must keep the canonical AP/AR documents and settlements pages"
      );
      assert(
        /appPath:\s*["']\/app\/cari-belgeler["'][\s\S]*?LegacyRouteRedirect/.test(appSource),
        "Legacy /app/cari-belgeler route must remain a redirect"
      );
    });

    await runCheck("Sidebar keeps the old mixed Cari bucket removed", async () => {
      assert(
        sidebarSource.includes("/app/alis-faturalari") &&
        sidebarSource.includes("/app/satis-faturalari") &&
        sidebarSource.includes("/app/tedarikci-odemeler") &&
        sidebarSource.includes("/app/musteri-tahsilatlar"),
        "Sidebar must surface the split AP/AR destinations"
      );
      assert(
        !sidebarSource.includes("Cari Islemler"),
        "Sidebar should no longer expose the old mixed Cari Islemler bucket"
      );
    });

    await runCheck("CariDocumentsPage still exposes fixed-asset preview, expand, and quick-create hooks", async () => {
      assert(
        pageSource.includes('l("Posting this line will create"') &&
        /l\(\s*"Expand into individual asset lines"/.test(pageSource) &&
        pageSource.includes('l("+ New Asset", "+ Yeni Varlik")'),
        "CariDocumentsPage must keep the fixed-asset preview/expand/quick-create affordances"
      );
      assert(
        pageSource.includes('fixedAssetMode: "LINK_EXISTING"') &&
        pageSource.includes("targetFixedAssetId: String(createdAssetId)") &&
        pageSource.includes('quantity: "1"') &&
        pageSource.includes("patchDraftFormLine"),
        "Quick-create asset flow must still auto-select the created draft asset on the line"
      );
    });

    await runCheck("CariDocumentsPage + utils still send and guard immediate-cash fields", async () => {
      assert(
        pageSource.includes(
          "settlementCashRegisterId is required when settlementMode=IMMEDIATE_CASH"
        ) &&
        pageSource.includes("Cash register is required when immediate cash is selected."),
        "Immediate-cash field validation copy must remain in the document page"
      );
      assert(
        utilsSource.includes('const settlementMode = normalizeSettlementMode(form.settlementMode);') &&
        utilsSource.includes(
          'settlementMode === "IMMEDIATE_CASH" ? settlementCashRegisterId || undefined : undefined'
        ),
        "Draft payload builder must keep settlementMode and settlementCashRegisterId wiring"
      );
    });
  }

async function runAutoCreatePurchaseSmoke(env, state) {
    console.log("\n-- Subledger runtime smokes --");

    await runCheck("AP FIXED_ASSET AUTO_CREATE posts 10 draft assets with per-unit capitalization", async () => {
      const draft = await createDraftDocument({
        tenantId: env.tenantId,
        userId: env.userId,
        legalEntityId: env.legalEntityId,
        counterpartyId: env.vendorCounterpartyId,
        direction: "AP",
        documentDate: scenarioDate(env.window, 0),
        dueDate: scenarioDate(env.window, 5),
        currencyCode: env.currencyCode,
        stamp: env.stamp,
        suffix: "auto-create-draft",
        lines: [
          {
            description: "SL24 AUTO_CREATE x10",
            subledgerType: "FIXED_ASSET",
            fixedAssetMode: "AUTO_CREATE",
            fixedAssetCategoryId: env.categoryId,
            fixedAssetOwnerOperatingUnitId: env.ownerOperatingUnitId,
            fixedAssetLocationOperatingUnitId: env.locationOperatingUnitId,
            quantity: 10,
            lineNetAmountTxn: 1000,
            lineTaxAmountTxn: 0,
            lineGrossAmountTxn: 1000,
          },
        ],
      });
      await trackDocumentArtifacts(draft.id, state);

      const posted = await postDraftDocument({
        tenantId: env.tenantId,
        userId: env.userId,
        documentId: draft.id,
        stamp: env.stamp,
        suffix: "auto-create-post",
      });
      pushUnique(state.journalEntryIds, [posted?.journal?.journalEntryId]);

      const lines = await loadDocumentLines(draft.id);
      const lineId = toPositiveInt(lines[0]?.id);
      assert(lineId, "AUTO_CREATE smoke line id missing");

      const assets = await listAssetsBySourceLine(draft.id, lineId);
      const capitalizationRows = await listCapitalizationTransactionsBySourceLine(
        draft.id,
        lineId
      );
      pushUnique(state.fixedAssetIds, assets.map((row) => row.id));
      pushUnique(state.fixedAssetTransactionIds, capitalizationRows.map((row) => row.id));

      assert(assets.length === 10, "AUTO_CREATE smoke must create 10 draft assets");
      assert(
        capitalizationRows.length === 10,
        "AUTO_CREATE smoke must create 10 CAPITALIZATION transactions"
      );

      for (let index = 0; index < assets.length; index += 1) {
        const asset = assets[index];
        assert(
          normalizeUpper(asset.status) === "DRAFT",
          "AUTO_CREATE assets must remain DRAFT after posting"
        );
        assert(
          toPositiveInt(asset.source_cari_document_line_unit_no) === index + 1,
          "AUTO_CREATE assets must preserve 1..10 unit provenance"
        );
        assert(
          amountsEqual(asset.original_cost_txn, 100) &&
          amountsEqual(asset.original_cost_base, 100),
          "AUTO_CREATE assets must split cost into 100-per-unit values"
        );
      }
    });
  }

async function runLinkExistingSmoke(env, state) {
    await runCheck("AP FIXED_ASSET LINK_EXISTING capitalizes the selected draft asset", async () => {
      const draftAsset = await createQuickLinkDraftAsset({
        env,
        name: `SL24 link-existing ${env.stamp}`,
        amount: 1,
      });
      pushUnique(state.fixedAssetIds, [draftAsset?.id]);

      const draft = await createDraftDocument({
        tenantId: env.tenantId,
        userId: env.userId,
        legalEntityId: env.legalEntityId,
        counterpartyId: env.vendorCounterpartyId,
        direction: "AP",
        documentDate: scenarioDate(env.window, 1),
        dueDate: scenarioDate(env.window, 6),
        currencyCode: env.currencyCode,
        stamp: env.stamp,
        suffix: "link-existing-draft",
        lines: [
          {
            description: "SL24 LINK_EXISTING",
            subledgerType: "FIXED_ASSET",
            fixedAssetMode: "LINK_EXISTING",
            targetFixedAssetId: draftAsset.id,
            quantity: 1,
            lineNetAmountTxn: 450,
            lineTaxAmountTxn: 0,
            lineGrossAmountTxn: 450,
          },
        ],
      });
      await trackDocumentArtifacts(draft.id, state);

      const posted = await postDraftDocument({
        tenantId: env.tenantId,
        userId: env.userId,
        documentId: draft.id,
        stamp: env.stamp,
        suffix: "link-existing-post",
      });
      pushUnique(state.journalEntryIds, [posted?.journal?.journalEntryId]);

      const lines = await loadDocumentLines(draft.id);
      const lineId = toPositiveInt(lines[0]?.id);
      const transactions = await listCapitalizationTransactionsBySourceLine(draft.id, lineId);
      pushUnique(state.fixedAssetTransactionIds, transactions.map((row) => row.id));
      assert(
        transactions.length === 1 &&
        normalizeUpper(transactions[0]?.transaction_type) === "CAPITALIZATION",
        "LINK_EXISTING smoke must create exactly one CAPITALIZATION transaction"
      );
      assert(
        toPositiveInt(transactions[0]?.asset_id) === toPositiveInt(draftAsset.id),
        "LINK_EXISTING capitalization must attach to the selected draft asset"
      );

      const assetRow = await getAssetRow(draftAsset.id);
      assert(assetRow, "LINK_EXISTING asset row must remain queryable");
      assert(
        toPositiveInt(assetRow.source_cari_document_id) === draft.id,
        "LINK_EXISTING asset must point back to the source CARI document"
      );
    });
  }

async function runSaleSmoke(env, state, artifacts) {
    await runCheck("AR FIXED_ASSET sale disposes an activated asset and records gain/loss metadata", async () => {
      const purchaseDraft = await createDraftDocument({
        tenantId: env.tenantId,
        userId: env.userId,
        legalEntityId: env.legalEntityId,
        counterpartyId: env.vendorCounterpartyId,
        direction: "AP",
        documentDate: scenarioDate(env.window, 2),
        dueDate: scenarioDate(env.window, 7),
        currencyCode: env.currencyCode,
        stamp: env.stamp,
        suffix: "sale-source-draft",
        lines: [
          {
            description: "SL24 SALE source purchase",
            subledgerType: "FIXED_ASSET",
            fixedAssetMode: "AUTO_CREATE",
            fixedAssetCategoryId: env.categoryId,
            fixedAssetOwnerOperatingUnitId: env.ownerOperatingUnitId,
            fixedAssetLocationOperatingUnitId: env.locationOperatingUnitId,
            quantity: 1,
            lineNetAmountTxn: 900,
            lineTaxAmountTxn: 0,
            lineGrossAmountTxn: 900,
          },
        ],
      });
      await trackDocumentArtifacts(purchaseDraft.id, state);
      const purchasePosted = await postDraftDocument({
        tenantId: env.tenantId,
        userId: env.userId,
        documentId: purchaseDraft.id,
        stamp: env.stamp,
        suffix: "sale-source-post",
      });
      pushUnique(state.journalEntryIds, [purchasePosted?.journal?.journalEntryId]);

      const purchaseLine = (await loadDocumentLines(purchaseDraft.id))[0];
      const generatedAssets = await listAssetsBySourceLine(purchaseDraft.id, purchaseLine.id);
      const sourceAsset = generatedAssets[0];
      assert(sourceAsset, "Sale smoke purchase must create one draft asset");
      pushUnique(state.fixedAssetIds, [sourceAsset.id]);
      const purchaseTransactions = await listCapitalizationTransactionsBySourceLine(
        purchaseDraft.id,
        purchaseLine.id
      );
      pushUnique(state.fixedAssetTransactionIds, purchaseTransactions.map((row) => row.id));

      await activateAsset({
        tenantId: env.tenantId,
        assetId: sourceAsset.id,
        postingDate: scenarioDate(env.window, 3),
        capitalizationDate: scenarioDate(env.window, 3),
        inServiceDate: scenarioDate(env.window, 4),
        assetTag: `SL24-SALE-${env.stamp}`,
        userId: env.userId,
      });

      const saleDraft = await createDraftDocument({
        tenantId: env.tenantId,
        userId: env.userId,
        legalEntityId: env.legalEntityId,
        counterpartyId: env.customerCounterpartyId,
        direction: "AR",
        documentDate: scenarioDate(env.window, 5),
        dueDate: scenarioDate(env.window, 8),
        currencyCode: env.currencyCode,
        stamp: env.stamp,
        suffix: "sale-draft",
        lines: [
          {
            description: "SL24 SALE line",
            subledgerType: "FIXED_ASSET",
            targetFixedAssetId: sourceAsset.id,
            quantity: 1,
            lineNetAmountTxn: 1200,
            lineTaxAmountTxn: 0,
            lineGrossAmountTxn: 1200,
          },
        ],
      });
      await trackDocumentArtifacts(saleDraft.id, state);
      const salePosted = await postDraftDocument({
        tenantId: env.tenantId,
        userId: env.userId,
        documentId: saleDraft.id,
        stamp: env.stamp,
        suffix: "sale-post",
      });
      pushUnique(state.journalEntryIds, [salePosted?.journal?.journalEntryId]);

      const saleLine = (await loadDocumentLines(saleDraft.id))[0];
      const saleTransactions = await listCapitalizationTransactionsBySourceLine(
        saleDraft.id,
        saleLine.id
      );
      const cutoffDepreciationTransaction = saleTransactions.find(
        (row) => normalizeUpper(row.transaction_type) === "DEPRECIATION"
      );
      const saleTransaction = saleTransactions.find(
        (row) => normalizeUpper(row.transaction_type) === "SALE"
      );
      pushUnique(state.fixedAssetTransactionIds, saleTransactions.map((row) => row.id));
      assert(saleTransaction, "Sale smoke must create a SALE fixed-asset transaction");
      assert(
        cutoffDepreciationTransaction,
        "Sale smoke must create a cutoff DEPRECIATION fixed-asset transaction"
      );

      const postedCutoffScheduleLines = await listPostedDepreciationScheduleLinesByTransactionIds([
        cutoffDepreciationTransaction.id,
      ]);
      assert(
        postedCutoffScheduleLines.length === 1
        && normalizeUpper(postedCutoffScheduleLines[0]?.status) === "POSTED"
        && toPositiveInt(postedCutoffScheduleLines[0]?.asset_id) === toPositiveInt(sourceAsset.id)
        && toPositiveInt(postedCutoffScheduleLines[0]?.posted_transaction_id)
          === toPositiveInt(cutoffDepreciationTransaction.id),
        "Sale smoke must mark the disposal cutoff period as POSTED in depreciation schedule state"
      );

      const assetRow = await getAssetRow(sourceAsset.id);
      assert(assetRow, "Disposed asset must remain queryable");
      assert(
        normalizeUpper(assetRow.status) === "DISPOSED" &&
        normalizeUpper(assetRow.disposal_type) === "SALE" &&
        String(assetRow.disposed_at || "").trim(),
        "Sale smoke asset must transition to DISPOSED with SALE disposal metadata"
      );
      assert(
        amountsEqual(assetRow.disposal_proceeds_base, 1200),
        "Sale smoke must persist disposal proceeds from the AR line"
      );
      assert(
        assetRow.disposal_gain_loss_base !== null &&
        assetRow.disposal_gain_loss_base !== undefined,
        "Sale smoke must persist disposal gain/loss metadata"
      );

      artifacts.saleDocumentId = saleDraft.id;
      artifacts.saleTransactionId = saleTransaction.id;
    });
  }

async function runMixedLineSmoke(env, state) {
    await runCheck("Mixed AP document posts NONE, STOCK, and FIXED_ASSET lines together", async () => {
      const draft = await createDraftDocument({
        tenantId: env.tenantId,
        userId: env.userId,
        legalEntityId: env.legalEntityId,
        counterpartyId: env.vendorCounterpartyId,
        direction: "AP",
        documentDate: scenarioDate(env.window, 6),
        dueDate: scenarioDate(env.window, 10),
        currencyCode: env.currencyCode,
        stamp: env.stamp,
        suffix: "mixed-draft",
        lines: [
          {
            description: "SL24 mixed NONE",
            subledgerType: "NONE",
            postingAccountId: env.accounts.apOffsetAccountId,
            quantity: 1,
            lineNetAmountTxn: 100,
            lineTaxAmountTxn: 0,
            lineGrossAmountTxn: 100,
          },
          {
            description: "SL24 mixed STOCK",
            itemCardId: env.itemCard.id,
            warehouseId: env.warehouse.id,
            quantity: 4,
            lineNetAmountTxn: 400,
            lineTaxAmountTxn: 0,
            lineGrossAmountTxn: 400,
          },
          {
            description: "SL24 mixed FIXED_ASSET",
            subledgerType: "FIXED_ASSET",
            fixedAssetMode: "AUTO_CREATE",
            fixedAssetCategoryId: env.categoryId,
            fixedAssetOwnerOperatingUnitId: env.ownerOperatingUnitId,
            fixedAssetLocationOperatingUnitId: env.locationOperatingUnitId,
            quantity: 2,
            lineNetAmountTxn: 600,
            lineTaxAmountTxn: 0,
            lineGrossAmountTxn: 600,
          },
        ],
      });
      await trackDocumentArtifacts(draft.id, state);

      const posted = await postDraftDocument({
        tenantId: env.tenantId,
        userId: env.userId,
        documentId: draft.id,
        stamp: env.stamp,
        suffix: "mixed-post",
      });
      pushUnique(state.journalEntryIds, [posted?.journal?.journalEntryId]);

      const lines = await loadDocumentLines(draft.id);
      const noneLine = lines.find((row) => row.description === "SL24 mixed NONE");
      const stockLine = lines.find((row) => row.description === "SL24 mixed STOCK");
      const fixedAssetLine = lines.find(
        (row) => row.description === "SL24 mixed FIXED_ASSET"
      );
      assert(noneLine && stockLine && fixedAssetLine, "Mixed-line smoke must resolve all three lines");

      const journalLines = await query(
        `SELECT account_id
         FROM journal_lines
        WHERE journal_entry_id = ?`,
        [posted.journal.journalEntryId]
      );
      const accountIds = (journalLines.rows || []).map((row) => toPositiveInt(row.account_id));
      assert(
        accountIds.includes(env.accounts.apOffsetAccountId),
        "Mixed-line smoke must include the NONE-line expense account in the journal"
      );
      assert(
        accountIds.includes(env.accounts.inventoryAssetAccountId),
        "Mixed-line smoke must include the STOCK-line inventory account in the journal"
      );
      assert(
        accountIds.includes(env.accounts.fixedAssetAccountId),
        "Mixed-line smoke must include the FIXED_ASSET account in the journal"
      );

      const stockLink = await getPendingStockLinkByLine(draft.id, stockLine.id);
      assert(
        stockLink &&
        normalizeUpper(stockLink.stock_impact_mode) === "RECEIPT_PENDING" &&
        toPositiveInt(stockLink.warehouse_id) === toPositiveInt(env.warehouse.id),
        "Mixed-line smoke STOCK row must create a pending receipt stock link"
      );
      pushUnique(state.stockLinkIds, [stockLink.id]);

      const movement = await materializeInventoryMovementFromCariStockLink({
        payload: {
          tenantId: env.tenantId,
          userId: env.userId,
          legalEntityId: env.legalEntityId,
          stockLinkId: stockLink.id,
          movementDate: scenarioDate(env.window, 6),
          note: `SL24 mixed-line receipt ${env.stamp}`,
        },
      });
      pushUnique(state.inventoryMovementIds, [movement.id]);
      pushUnique(state.journalEntryIds, [movement.postedJournalEntryId]);

      const movementRow = await getInventoryMovementRow(movement.id);
      assert(
        movementRow &&
        normalizeUpper(movementRow.valuation_status) === "VALUED" &&
        toPositiveInt(movementRow.source_stock_link_id) === toPositiveInt(stockLink.id),
        "Mixed-line smoke STOCK movement must materialize and value successfully"
      );

      const assets = await listAssetsBySourceLine(draft.id, fixedAssetLine.id);
      const capitalizationRows = await listCapitalizationTransactionsBySourceLine(
        draft.id,
        fixedAssetLine.id
      );
      pushUnique(state.fixedAssetIds, assets.map((row) => row.id));
      pushUnique(state.fixedAssetTransactionIds, capitalizationRows.map((row) => row.id));
      assert(
        assets.length === 2 && capitalizationRows.length === 2,
        "Mixed-line smoke FIXED_ASSET row must create two draft assets and two capitalization rows"
      );
    });
  }

async function runAutoCreateReversalSmoke(env, state) {
    await runCheck("AP AUTO_CREATE reversal deletes untouched draft assets and capitalization rows", async () => {
      const draft = await createDraftDocument({
        tenantId: env.tenantId,
        userId: env.userId,
        legalEntityId: env.legalEntityId,
        counterpartyId: env.vendorCounterpartyId,
        direction: "AP",
        documentDate: scenarioDate(env.window, 7),
        dueDate: scenarioDate(env.window, 11),
        currencyCode: env.currencyCode,
        stamp: env.stamp,
        suffix: "reverse-auto-draft",
        lines: [
          {
            description: "SL24 reverse AUTO_CREATE",
            subledgerType: "FIXED_ASSET",
            fixedAssetMode: "AUTO_CREATE",
            fixedAssetCategoryId: env.categoryId,
            fixedAssetOwnerOperatingUnitId: env.ownerOperatingUnitId,
            fixedAssetLocationOperatingUnitId: env.locationOperatingUnitId,
            quantity: 2,
            lineNetAmountTxn: 500,
            lineTaxAmountTxn: 0,
            lineGrossAmountTxn: 500,
          },
        ],
      });
      await trackDocumentArtifacts(draft.id, state);
      const posted = await postDraftDocument({
        tenantId: env.tenantId,
        userId: env.userId,
        documentId: draft.id,
        stamp: env.stamp,
        suffix: "reverse-auto-post",
      });
      pushUnique(state.journalEntryIds, [posted?.journal?.journalEntryId]);

      const line = (await loadDocumentLines(draft.id))[0];
      const assets = await listAssetsBySourceLine(draft.id, line.id);
      const transactions = await listCapitalizationTransactionsBySourceLine(
        draft.id,
        line.id
      );
      assert(assets.length === 2, "Reverse smoke setup must create two assets");
      assert(transactions.length === 2, "Reverse smoke setup must create two capitalization rows");
      const assetIds = assets.map((row) => row.id);
      const transactionIds = transactions.map((row) => row.id);

      const reversed = await reversePostedDocument({
        tenantId: env.tenantId,
        userId: env.userId,
        documentId: draft.id,
        reversalDate: scenarioDate(env.window, 12),
        stamp: env.stamp,
        suffix: "reverse-auto-run",
      });
      pushUnique(state.documentIds, [reversed?.row?.id, reversed?.original?.id]);
      pushUnique(state.journalEntryIds, [
        reversed?.journal?.originalJournalEntryId,
        reversed?.journal?.reversalJournalEntryId,
      ]);

      const survivingAssets = await query(
        `SELECT COUNT(*) AS row_count
         FROM fixed_assets
        WHERE id IN (${makeInClause(assetIds)})`,
        assetIds
      );
      const survivingTransactions = await query(
        `SELECT COUNT(*) AS row_count
         FROM fixed_asset_transactions
        WHERE id IN (${makeInClause(transactionIds)})`,
        transactionIds
      );
      const orphanTransactions = await listCapitalizationTransactionsBySourceLine(
        draft.id,
        line.id
      );

      assert(
        toNumber(survivingAssets.rows?.[0]?.row_count) === 0,
        "AUTO_CREATE reversal must hard-delete generated draft assets"
      );
      assert(
        toNumber(survivingTransactions.rows?.[0]?.row_count) === 0,
        "AUTO_CREATE reversal must hard-delete capitalization transactions"
      );
      assert(
        orphanTransactions.length === 0,
        "AUTO_CREATE reversal must leave no orphan capitalization rows behind"
      );
    });
  }

async function runReversalGuardSmoke(env, state) {
    await runCheck("AP FIXED_ASSET reversal is blocked once a generated asset has been activated", async () => {
      const draft = await createDraftDocument({
        tenantId: env.tenantId,
        userId: env.userId,
        legalEntityId: env.legalEntityId,
        counterpartyId: env.vendorCounterpartyId,
        direction: "AP",
        documentDate: scenarioDate(env.window, 8),
        dueDate: scenarioDate(env.window, 13),
        currencyCode: env.currencyCode,
        stamp: env.stamp,
        suffix: "reverse-guard-draft",
        lines: [
          {
            description: "SL24 reverse guard AUTO_CREATE",
            subledgerType: "FIXED_ASSET",
            fixedAssetMode: "AUTO_CREATE",
            fixedAssetCategoryId: env.categoryId,
            fixedAssetOwnerOperatingUnitId: env.ownerOperatingUnitId,
            fixedAssetLocationOperatingUnitId: env.locationOperatingUnitId,
            quantity: 1,
            lineNetAmountTxn: 700,
            lineTaxAmountTxn: 0,
            lineGrossAmountTxn: 700,
          },
        ],
      });
      await trackDocumentArtifacts(draft.id, state);
      const posted = await postDraftDocument({
        tenantId: env.tenantId,
        userId: env.userId,
        documentId: draft.id,
        stamp: env.stamp,
        suffix: "reverse-guard-post",
      });
      pushUnique(state.journalEntryIds, [posted?.journal?.journalEntryId]);

      const line = (await loadDocumentLines(draft.id))[0];
      const assets = await listAssetsBySourceLine(draft.id, line.id);
      const transactions = await listCapitalizationTransactionsBySourceLine(
        draft.id,
        line.id
      );
      const asset = assets[0];
      assert(asset, "Reversal-guard smoke must create one draft asset");
      pushUnique(state.fixedAssetIds, [asset.id]);
      pushUnique(state.fixedAssetTransactionIds, transactions.map((row) => row.id));

      await activateAsset({
        tenantId: env.tenantId,
        assetId: asset.id,
        postingDate: scenarioDate(env.window, 9),
        capitalizationDate: scenarioDate(env.window, 9),
        inServiceDate: scenarioDate(env.window, 10),
        assetTag: `SL24-REV-GUARD-${env.stamp}`,
        userId: env.userId,
      });

      let blockedError = null;
      try {
        await reversePostedDocument({
          tenantId: env.tenantId,
          userId: env.userId,
          documentId: draft.id,
          reversalDate: scenarioDate(env.window, 14),
          stamp: env.stamp,
          suffix: "reverse-guard-run",
        });
      } catch (error) {
        blockedError = error;
      }

      assert(blockedError, "Activated-asset reversal must be blocked");
      assert(
        /activated since capitalization/i.test(String(blockedError.message || "")),
        "Activated-asset reversal must explain that activation must be reversed first"
      );

      const reversalRow = await findReversalDocumentRow(draft.id);
      const assetRow = await getAssetRow(asset.id);
      assert(
        !reversalRow,
        "Blocked reversal must not create a reversal document"
      );
      assert(
        normalizeUpper(assetRow?.status) === "ACTIVE",
        "Blocked reversal must leave the activated asset untouched"
      );
    });
  }

async function runImmediateCashSmokes(env, state, artifacts) {
    console.log("\n-- Immediate-cash runtime smokes --");

    await runCheck("Immediate-cash AP posting creates payout + settlement and clears the open item", async () => {
      const draft = await createDraftDocument({
        tenantId: env.tenantId,
        userId: env.userId,
        legalEntityId: env.legalEntityId,
        counterpartyId: env.vendorCounterpartyId,
        direction: "AP",
        documentDate: scenarioDate(env.window, 10),
        dueDate: scenarioDate(env.window, 12),
        currencyCode: env.currencyCode,
        settlementMode: "IMMEDIATE_CASH",
        settlementCashRegisterId: env.cashRegisterId,
        stamp: env.stamp,
        suffix: "cash-ap-draft",
        lines: [
          {
            description: "SL24 immediate cash AP",
            postingAccountId: env.accounts.apOffsetAccountId,
            quantity: 1,
            lineNetAmountTxn: 250,
            lineTaxAmountTxn: 0,
            lineGrossAmountTxn: 250,
          },
        ],
      });
      await trackDocumentArtifacts(draft.id, state);
      const posted = await postDraftDocument({
        tenantId: env.tenantId,
        userId: env.userId,
        documentId: draft.id,
        stamp: env.stamp,
        suffix: "cash-ap-post",
      });
      pushUnique(state.journalEntryIds, [posted?.journal?.journalEntryId]);

      const documentRow = await getDocumentRow(draft.id);
      const openItem = await getOpenItem(draft.id);
      assert(
        toPositiveInt(documentRow?.auto_settlement_batch_id) > 0 &&
        toPositiveInt(documentRow?.auto_settlement_cash_transaction_id) > 0,
        "Immediate-cash AP document must persist linked settlement and cash ids"
      );
      assert(
        openItem && amountsEqual(openItem.residual_amount_txn, 0),
        "Immediate-cash AP open item must be cleared immediately"
      );

      await trackSettlementArtifacts(documentRow.auto_settlement_batch_id, state);
      await trackCashArtifacts(documentRow.auto_settlement_cash_transaction_id, state);

      const [settlementRow, cashRow, allocationCount] = await Promise.all([
        getSettlementBatchRow(documentRow.auto_settlement_batch_id),
        getCashTransactionRow(documentRow.auto_settlement_cash_transaction_id),
        countSettlementAllocations(documentRow.auto_settlement_batch_id),
      ]);
      assert(
        settlementRow &&
        normalizeUpper(settlementRow.direction) === "AP" &&
        toPositiveInt(settlementRow.cash_transaction_id) ===
        toPositiveInt(documentRow.auto_settlement_cash_transaction_id),
        "Immediate-cash AP settlement row must point at the auto-created cash payout"
      );
      assert(
        cashRow &&
        normalizeUpper(cashRow.txn_type) === "PAYOUT" &&
        normalizeUpper(cashRow.source_entity_type) === "CARI_DOCUMENT" &&
        toPositiveInt(cashRow.source_entity_id) === draft.id,
        "Immediate-cash AP cash row must be a linked PAYOUT for the document"
      );
      assert(
        allocationCount === 1,
        "Immediate-cash AP must create exactly one settlement allocation"
      );

      artifacts.apDocumentId = draft.id;
      artifacts.apSettlementBatchId = documentRow.auto_settlement_batch_id;
    });

    await runCheck("Immediate-cash AR posting creates receipt + settlement and clears the open item", async () => {
      const draft = await createDraftDocument({
        tenantId: env.tenantId,
        userId: env.userId,
        legalEntityId: env.legalEntityId,
        counterpartyId: env.customerCounterpartyId,
        direction: "AR",
        documentDate: scenarioDate(env.window, 11),
        dueDate: scenarioDate(env.window, 13),
        currencyCode: env.currencyCode,
        settlementMode: "IMMEDIATE_CASH",
        settlementCashRegisterId: env.cashRegisterId,
        stamp: env.stamp,
        suffix: "cash-ar-draft",
        lines: [
          {
            description: "SL24 immediate cash AR",
            postingAccountId: env.accounts.arOffsetAccountId,
            quantity: 1,
            lineNetAmountTxn: 325,
            lineTaxAmountTxn: 0,
            lineGrossAmountTxn: 325,
          },
        ],
      });
      await trackDocumentArtifacts(draft.id, state);
      const posted = await postDraftDocument({
        tenantId: env.tenantId,
        userId: env.userId,
        documentId: draft.id,
        stamp: env.stamp,
        suffix: "cash-ar-post",
      });
      pushUnique(state.journalEntryIds, [posted?.journal?.journalEntryId]);

      const documentRow = await getDocumentRow(draft.id);
      const openItem = await getOpenItem(draft.id);
      assert(
        toPositiveInt(documentRow?.auto_settlement_batch_id) > 0 &&
        toPositiveInt(documentRow?.auto_settlement_cash_transaction_id) > 0,
        "Immediate-cash AR document must persist linked settlement and cash ids"
      );
      assert(
        openItem && amountsEqual(openItem.residual_amount_txn, 0),
        "Immediate-cash AR open item must be cleared immediately"
      );

      await trackSettlementArtifacts(documentRow.auto_settlement_batch_id, state);
      await trackCashArtifacts(documentRow.auto_settlement_cash_transaction_id, state);

      const [settlementRow, cashRow, allocationCount] = await Promise.all([
        getSettlementBatchRow(documentRow.auto_settlement_batch_id),
        getCashTransactionRow(documentRow.auto_settlement_cash_transaction_id),
        countSettlementAllocations(documentRow.auto_settlement_batch_id),
      ]);
      assert(
        settlementRow &&
        normalizeUpper(settlementRow.direction) === "AR" &&
        toPositiveInt(settlementRow.cash_transaction_id) ===
        toPositiveInt(documentRow.auto_settlement_cash_transaction_id),
        "Immediate-cash AR settlement row must point at the auto-created cash receipt"
      );
      assert(
        cashRow &&
        normalizeUpper(cashRow.txn_type) === "RECEIPT" &&
        normalizeUpper(cashRow.source_entity_type) === "CARI_DOCUMENT" &&
        toPositiveInt(cashRow.source_entity_id) === draft.id,
        "Immediate-cash AR cash row must be a linked RECEIPT for the document"
      );
      assert(
        allocationCount === 1,
        "Immediate-cash AR must create exactly one settlement allocation"
      );

      artifacts.arDocumentId = draft.id;
      artifacts.arSettlementBatchId = documentRow.auto_settlement_batch_id;
    });

    await runCheck("Immediate-cash AP fIXED_ASSET combines capitalization and settlement in one post", async () => {
      const draft = await createDraftDocument({
        tenantId: env.tenantId,
        userId: env.userId,
        legalEntityId: env.legalEntityId,
        counterpartyId: env.vendorCounterpartyId,
        direction: "AP",
        documentDate: scenarioDate(env.window, 12),
        dueDate: scenarioDate(env.window, 14),
        currencyCode: env.currencyCode,
        settlementMode: "IMMEDIATE_CASH",
        settlementCashRegisterId: env.cashRegisterId,
        stamp: env.stamp,
        suffix: "cash-fa-draft",
        lines: [
          {
            description: "SL24 immediate cash FIXED_ASSET",
            subledgerType: "FIXED_ASSET",
            fixedAssetMode: "AUTO_CREATE",
            fixedAssetCategoryId: env.categoryId,
            fixedAssetOwnerOperatingUnitId: env.ownerOperatingUnitId,
            fixedAssetLocationOperatingUnitId: env.locationOperatingUnitId,
            quantity: 1,
            lineNetAmountTxn: 800,
            lineTaxAmountTxn: 0,
            lineGrossAmountTxn: 800,
          },
        ],
      });
      await trackDocumentArtifacts(draft.id, state);
      const posted = await postDraftDocument({
        tenantId: env.tenantId,
        userId: env.userId,
        documentId: draft.id,
        stamp: env.stamp,
        suffix: "cash-fa-post",
      });
      pushUnique(state.journalEntryIds, [posted?.journal?.journalEntryId]);

      const documentRow = await getDocumentRow(draft.id);
      const line = (await loadDocumentLines(draft.id))[0];
      const [openItem, assets, transactions] = await Promise.all([
        getOpenItem(draft.id),
        listAssetsBySourceLine(draft.id, line.id),
        listCapitalizationTransactionsBySourceLine(draft.id, line.id),
      ]);
      pushUnique(state.fixedAssetIds, assets.map((row) => row.id));
      pushUnique(state.fixedAssetTransactionIds, transactions.map((row) => row.id));
      await trackSettlementArtifacts(documentRow.auto_settlement_batch_id, state);
      await trackCashArtifacts(documentRow.auto_settlement_cash_transaction_id, state);

      assert(
        openItem && amountsEqual(openItem.residual_amount_txn, 0),
        "Immediate-cash FA open item must be fully settled"
      );
      assert(
        assets.length === 1 && transactions.length === 1,
        "Immediate-cash FA document must still create the fixed-asset capitalization side effects"
      );
      assert(
        toPositiveInt(documentRow?.auto_settlement_batch_id) > 0 &&
        toPositiveInt(documentRow?.auto_settlement_cash_transaction_id) > 0,
        "Immediate-cash FA document must also persist the linked cash-settlement ids"
      );
    });

    await runCheck("Immediate-cash AP reversal reverses settlement + payout without reopening the item", async () => {
      const draft = await createDraftDocument({
        tenantId: env.tenantId,
        userId: env.userId,
        legalEntityId: env.legalEntityId,
        counterpartyId: env.vendorCounterpartyId,
        direction: "AP",
        documentDate: scenarioDate(env.window, 13),
        dueDate: scenarioDate(env.window, 15),
        currencyCode: env.currencyCode,
        settlementMode: "IMMEDIATE_CASH",
        settlementCashRegisterId: env.cashRegisterId,
        stamp: env.stamp,
        suffix: "cash-ap-reverse-draft",
        lines: [
          {
            description: "SL24 immediate cash AP reverse",
            postingAccountId: env.accounts.apOffsetAccountId,
            quantity: 1,
            lineNetAmountTxn: 333,
            lineTaxAmountTxn: 0,
            lineGrossAmountTxn: 333,
          },
        ],
      });
      await trackDocumentArtifacts(draft.id, state);
      const posted = await postDraftDocument({
        tenantId: env.tenantId,
        userId: env.userId,
        documentId: draft.id,
        stamp: env.stamp,
        suffix: "cash-ap-reverse-post",
      });
      pushUnique(state.journalEntryIds, [posted?.journal?.journalEntryId]);

      const originalDocument = await getDocumentRow(draft.id);
      const originalSettlementBatchId = toPositiveInt(
        originalDocument?.auto_settlement_batch_id
      );
      const originalCashTransactionId = toPositiveInt(
        originalDocument?.auto_settlement_cash_transaction_id
      );
      await trackSettlementArtifacts(originalSettlementBatchId, state);
      await trackCashArtifacts(originalCashTransactionId, state);

      const reversed = await reversePostedDocument({
        tenantId: env.tenantId,
        userId: env.userId,
        documentId: draft.id,
        reversalDate: scenarioDate(env.window, 16),
        stamp: env.stamp,
        suffix: "cash-ap-reverse-run",
      });
      pushUnique(state.documentIds, [reversed?.row?.id, reversed?.original?.id]);
      pushUnique(state.journalEntryIds, [
        reversed?.journal?.originalJournalEntryId,
        reversed?.journal?.reversalJournalEntryId,
      ]);

      const reversedArtifacts = await trackReversalSettlementAndCash(
        originalSettlementBatchId,
        originalCashTransactionId,
        state
      );
      const [originalSettlementRow, originalCashRow, openItem] = await Promise.all([
        getSettlementBatchRow(originalSettlementBatchId),
        getCashTransactionRow(originalCashTransactionId),
        getOpenItem(draft.id),
      ]);

      assert(
        normalizeUpper(originalSettlementRow?.status) === "REVERSED" &&
        toPositiveInt(reversedArtifacts.settlementBatchId) > 0,
        "Immediate-cash AP reversal must reverse the linked settlement batch and create its reversal row"
      );
      assert(
        normalizeUpper(originalCashRow?.status) === "REVERSED" &&
        toPositiveInt(reversedArtifacts.cashTransactionId) > 0,
        "Immediate-cash AP reversal must reverse the linked payout and create its reversal row"
      );
      assert(
        openItem && amountsEqual(openItem.residual_amount_txn, 0),
        "Immediate-cash AP reversal must leave the original open item cleared"
      );
    });

    await runCheck("Immediate-cash AR reversal reverses settlement + receipt without reopening the item", async () => {
      const draft = await createDraftDocument({
        tenantId: env.tenantId,
        userId: env.userId,
        legalEntityId: env.legalEntityId,
        counterpartyId: env.customerCounterpartyId,
        direction: "AR",
        documentDate: scenarioDate(env.window, 14),
        dueDate: scenarioDate(env.window, 16),
        currencyCode: env.currencyCode,
        settlementMode: "IMMEDIATE_CASH",
        settlementCashRegisterId: env.cashRegisterId,
        stamp: env.stamp,
        suffix: "cash-ar-reverse-draft",
        lines: [
          {
            description: "SL24 immediate cash AR reverse",
            postingAccountId: env.accounts.arOffsetAccountId,
            quantity: 1,
            lineNetAmountTxn: 444,
            lineTaxAmountTxn: 0,
            lineGrossAmountTxn: 444,
          },
        ],
      });
      await trackDocumentArtifacts(draft.id, state);
      const posted = await postDraftDocument({
        tenantId: env.tenantId,
        userId: env.userId,
        documentId: draft.id,
        stamp: env.stamp,
        suffix: "cash-ar-reverse-post",
      });
      pushUnique(state.journalEntryIds, [posted?.journal?.journalEntryId]);

      const originalDocument = await getDocumentRow(draft.id);
      const originalSettlementBatchId = toPositiveInt(
        originalDocument?.auto_settlement_batch_id
      );
      const originalCashTransactionId = toPositiveInt(
        originalDocument?.auto_settlement_cash_transaction_id
      );
      await trackSettlementArtifacts(originalSettlementBatchId, state);
      await trackCashArtifacts(originalCashTransactionId, state);

      const reversed = await reversePostedDocument({
        tenantId: env.tenantId,
        userId: env.userId,
        documentId: draft.id,
        reversalDate: scenarioDate(env.window, 17),
        stamp: env.stamp,
        suffix: "cash-ar-reverse-run",
      });
      pushUnique(state.documentIds, [reversed?.row?.id, reversed?.original?.id]);
      pushUnique(state.journalEntryIds, [
        reversed?.journal?.originalJournalEntryId,
        reversed?.journal?.reversalJournalEntryId,
      ]);

      const reversedArtifacts = await trackReversalSettlementAndCash(
        originalSettlementBatchId,
        originalCashTransactionId,
        state
      );
      const [originalSettlementRow, originalCashRow, openItem] = await Promise.all([
        getSettlementBatchRow(originalSettlementBatchId),
        getCashTransactionRow(originalCashTransactionId),
        getOpenItem(draft.id),
      ]);

      assert(
        normalizeUpper(originalSettlementRow?.status) === "REVERSED" &&
        toPositiveInt(reversedArtifacts.settlementBatchId) > 0,
        "Immediate-cash AR reversal must reverse the linked settlement batch and create its reversal row"
      );
      assert(
        normalizeUpper(originalCashRow?.status) === "REVERSED" &&
        toPositiveInt(reversedArtifacts.cashTransactionId) > 0,
        "Immediate-cash AR reversal must reverse the linked receipt and create its reversal row"
      );
      assert(
        openItem && amountsEqual(openItem.residual_amount_txn, 0),
        "Immediate-cash AR reversal must leave the original open item cleared"
      );
    });

    await runCheck("ACCRUAL remains the default when no settlement mode is provided", async () => {
      const draft = await createDraftDocument({
        tenantId: env.tenantId,
        userId: env.userId,
        legalEntityId: env.legalEntityId,
        counterpartyId: env.vendorCounterpartyId,
        direction: "AP",
        documentDate: scenarioDate(env.window, 15),
        dueDate: scenarioDate(env.window, 18),
        currencyCode: env.currencyCode,
        stamp: env.stamp,
        suffix: "accrual-default-draft",
        lines: [
          {
            description: "SL24 accrual default",
            postingAccountId: env.accounts.apOffsetAccountId,
            quantity: 1,
            lineNetAmountTxn: 275,
            lineTaxAmountTxn: 0,
            lineGrossAmountTxn: 275,
          },
        ],
      });
      await trackDocumentArtifacts(draft.id, state);
      const posted = await postDraftDocument({
        tenantId: env.tenantId,
        userId: env.userId,
        documentId: draft.id,
        stamp: env.stamp,
        suffix: "accrual-default-post",
      });
      pushUnique(state.journalEntryIds, [posted?.journal?.journalEntryId]);

      const [documentRow, openItem] = await Promise.all([
        getDocumentRow(draft.id),
        getOpenItem(draft.id),
      ]);
      assert(
        !toPositiveInt(documentRow?.auto_settlement_batch_id) &&
        !toPositiveInt(documentRow?.auto_settlement_cash_transaction_id),
        "ACCRUAL default smoke must not create auto-settlement links"
      );
      assert(
        openItem &&
        amountsEqual(openItem.original_amount_txn, 275) &&
        amountsEqual(openItem.residual_amount_txn, 275),
        "ACCRUAL default smoke must preserve the unpaid open item"
      );
    });
  }

async function runNavigationAndDrillbackSmoke(artifacts) {
    console.log("\n-- Navigation + drillback smokes --");

    await runCheck("Direction-aware CARI document routes resolve to AP and AR pages", async () => {
      const [apDest, arDest] = await Promise.all([
        resolveDestinationAsync("CARI_DOCUMENT", artifacts.apDocumentId),
        resolveDestinationAsync("CARI_DOCUMENT", artifacts.arDocumentId),
      ]);
      assert(
        routeMatches(apDest?.route, "/app/alis-faturalari", {
          documentId: artifacts.apDocumentId,
        }),
        `AP document route mismatch: ${apDest?.route}`
      );
      assert(
        routeMatches(arDest?.route, "/app/satis-faturalari", {
          documentId: artifacts.arDocumentId,
        }),
        `AR document route mismatch: ${arDest?.route}`
      );
    });

    await runCheck("Direction-aware settlement routes resolve to AP and AR settlement pages", async () => {
      const [apDest, arDest] = await Promise.all([
        resolveDestinationAsync("CARI_SETTLEMENT_BATCH", artifacts.apSettlementBatchId),
        resolveDestinationAsync("CARI_SETTLEMENT_BATCH", artifacts.arSettlementBatchId),
      ]);
      assert(
        routeMatches(apDest?.route, "/app/tedarikci-odemeler", {
          settlementBatchId: artifacts.apSettlementBatchId,
        }),
        `AP settlement route mismatch: ${apDest?.route}`
      );
      assert(
        routeMatches(arDest?.route, "/app/musteri-tahsilatlar", {
          settlementBatchId: artifacts.arSettlementBatchId,
        }),
        `AR settlement route mismatch: ${arDest?.route}`
      );
    });

    await runCheck("Reverse-block helper preserves the same AP/AR destination split", async () => {
      const [docBlock, settlementBlock] = await Promise.all([
        resolveReverseBlockAsync([
          {
            source_ref_type: "CARI_DOCUMENT",
            source_ref_id: artifacts.arDocumentId,
            link_role: "PRIMARY",
          },
        ]),
        resolveReverseBlockAsync([
          {
            source_ref_type: "CARI_SETTLEMENT_BATCH",
            source_ref_id: artifacts.apSettlementBatchId,
            link_role: "PRIMARY",
          },
        ]),
      ]);
      assert(
        docBlock?.isBlocked === true &&
        routeMatches(docBlock?.primaryDestination?.route, "/app/satis-faturalari", {
          documentId: artifacts.arDocumentId,
        }),
        "Reverse-block helper must return the AR document destination"
      );
      assert(
        settlementBlock?.isBlocked === true &&
        routeMatches(
          settlementBlock?.primaryDestination?.route,
          "/app/tedarikci-odemeler",
          { settlementBatchId: artifacts.apSettlementBatchId }
        ),
        "Reverse-block helper must return the AP settlement destination"
      );
    });

    await runCheck("SALE fixed-asset transaction drillback resolves to the disposal page", async () => {
      const saleDest = await resolveDestinationAsync(
        "FIXED_ASSET_TRANSACTION",
        artifacts.saleTransactionId
      );
      assert(
        saleDest?.route?.includes("/app/demirbas-satis-islemleri"),
        `SALE transaction route mismatch: ${saleDest?.route}`
      );
    });
  }

async function cleanupState(state) {
    if (KEEP_ARTIFACTS) {
      console.log(
        `\n[sl24-cleanup] keeping artifacts because SL24_SMOKE_KEEP_ARTIFACTS=true (stamp=${state.stamp})`
      );
      return;
    }

    const tenantId = state.context?.tenantId;
    const legalEntityId = state.context?.legalEntityId;

    if (tenantId) {
      try {
        await query(
          `DELETE FROM audit_logs
          WHERE tenant_id = ?
            AND request_id LIKE ?`,
          [tenantId, `${state.stamp}%`]
        );
      } catch (error) {
        console.warn(`[sl24-cleanup] audit_logs cleanup failed: ${String(error?.message || error)}`);
      }
    }

    const fixedAssetTxIds = Array.from(new Set(state.fixedAssetTransactionIds.filter(Boolean)));
    const fixedAssetIds = Array.from(new Set(state.fixedAssetIds.filter(Boolean)));
    const stockLinkIds = Array.from(new Set(state.stockLinkIds.filter(Boolean)));
    const inventoryMovementIds = Array.from(new Set(state.inventoryMovementIds.filter(Boolean)));
    const documentIds = Array.from(new Set(state.documentIds.filter(Boolean)));
    const settlementBatchIds = Array.from(new Set(state.settlementBatchIds.filter(Boolean)));
    const cashTransactionIds = Array.from(new Set(state.cashTransactionIds.filter(Boolean)));
    const journalEntryIds = Array.from(new Set(state.journalEntryIds.filter(Boolean)));

    if (inventoryMovementIds.length > 0) {
      await query(
        `DELETE FROM inventory_issue_layer_consumptions
        WHERE issue_movement_id IN (${makeInClause(inventoryMovementIds)})`,
        inventoryMovementIds
      );
      await query(
        `DELETE FROM inventory_cost_layers
        WHERE source_movement_id IN (${makeInClause(inventoryMovementIds)})`,
        inventoryMovementIds
      );
      await query(
        `DELETE FROM inventory_movements
        WHERE reversal_of_movement_id IN (${makeInClause(inventoryMovementIds)})`,
        inventoryMovementIds
      );
      await query(
        `DELETE FROM inventory_movements
        WHERE id IN (${makeInClause(inventoryMovementIds)})`,
        inventoryMovementIds
      );
    }

    if (fixedAssetIds.length > 0) {
      await query(
        `DELETE FROM fixed_asset_depreciation_schedule_lines
        WHERE asset_id IN (${makeInClause(fixedAssetIds)})`,
        fixedAssetIds
      );
    }

    if (fixedAssetTxIds.length > 0) {
      await query(
        `DELETE FROM journal_source_links
        WHERE source_ref_type = 'FIXED_ASSET_TRANSACTION'
          AND source_ref_id IN (${makeInClause(fixedAssetTxIds)})`,
        fixedAssetTxIds
      );
      await query(
        `DELETE FROM fixed_asset_transactions
        WHERE id IN (${makeInClause(fixedAssetTxIds)})`,
        fixedAssetTxIds
      );
    }

    if (stockLinkIds.length > 0) {
      await query(
        `DELETE FROM cari_document_line_stock_links
        WHERE id IN (${makeInClause(stockLinkIds)})`,
        stockLinkIds
      );
    }

    if (settlementBatchIds.length > 0) {
      await query(
        `DELETE FROM cari_settlement_allocations
        WHERE settlement_batch_id IN (${makeInClause(settlementBatchIds)})`,
        settlementBatchIds
      );
    }

    if (documentIds.length > 0) {
      if (fixedAssetIds.length > 0) {
        await query(
          `UPDATE fixed_assets
              SET source_cari_document_id = NULL,
                  source_cari_document_line_id = NULL,
                  source_cari_document_line_unit_no = NULL
            WHERE id IN (${makeInClause(fixedAssetIds)})`,
          fixedAssetIds
        );
      }

      const openItemIdsResult = await query(
        `SELECT id
         FROM cari_open_items
        WHERE document_id IN (${makeInClause(documentIds)})`,
        documentIds
      );
      const openItemIds = (openItemIdsResult.rows || [])
        .map((row) => toPositiveInt(row.id))
        .filter(Boolean);
      if (openItemIds.length > 0) {
        await query(
          `DELETE FROM cari_settlement_allocations
          WHERE open_item_id IN (${makeInClause(openItemIds)})`,
          openItemIds
        );
      }

      await query(
        `DELETE FROM cari_document_line_taxes
        WHERE cari_document_id IN (${makeInClause(documentIds)})`,
        documentIds
      );
      await query(
        `DELETE FROM cari_document_line_stock_links
        WHERE cari_document_id IN (${makeInClause(documentIds)})`,
        documentIds
      );
      await query(
        `DELETE FROM cari_document_lines
        WHERE cari_document_id IN (${makeInClause(documentIds)})`,
        documentIds
      );
      await query(
        `DELETE FROM cari_open_items
        WHERE document_id IN (${makeInClause(documentIds)})`,
        documentIds
      );
      await query(
        `UPDATE cari_documents
            SET reversal_of_document_id = NULL
          WHERE tenant_id = ?
            AND (
              id IN (${makeInClause(documentIds)})
              OR reversal_of_document_id IN (${makeInClause(documentIds)})
            )`,
        [tenantId, ...documentIds, ...documentIds]
      );
      await query(
        `DELETE FROM cari_documents
        WHERE id IN (${makeInClause(documentIds)})`,
        documentIds
      );
    }

    if (fixedAssetIds.length > 0) {
      await query(
        `DELETE FROM fixed_assets
        WHERE id IN (${makeInClause(fixedAssetIds)})`,
        fixedAssetIds
      );
    }

    if (settlementBatchIds.length > 0) {
      await query(
        `UPDATE cash_transactions
            SET linked_cari_settlement_batch_id = NULL
          WHERE tenant_id = ?
            AND linked_cari_settlement_batch_id IN (${makeInClause(settlementBatchIds)})`,
        [tenantId, ...settlementBatchIds]
      );
      await query(
        `UPDATE cari_settlement_batches
            SET cash_transaction_id = NULL,
                reversal_of_settlement_batch_id = NULL
          WHERE tenant_id = ?
            AND (
              id IN (${makeInClause(settlementBatchIds)})
              OR reversal_of_settlement_batch_id IN (${makeInClause(settlementBatchIds)})
            )`,
        [tenantId, ...settlementBatchIds, ...settlementBatchIds]
      );
      await query(
        `DELETE FROM cari_settlement_batches
        WHERE id IN (${makeInClause(settlementBatchIds)})`,
        settlementBatchIds
      );
    }

    if (cashTransactionIds.length > 0) {
      await query(
        `UPDATE cash_transactions
            SET reversal_of_transaction_id = NULL
          WHERE tenant_id = ?
            AND (
              id IN (${makeInClause(cashTransactionIds)})
              OR reversal_of_transaction_id IN (${makeInClause(cashTransactionIds)})
            )`,
        [tenantId, ...cashTransactionIds, ...cashTransactionIds]
      );
      await query(
        `DELETE FROM cash_transactions
        WHERE id IN (${makeInClause(cashTransactionIds)})`,
        cashTransactionIds
      );
    }

    if (journalEntryIds.length > 0) {
      await query(
        `DELETE FROM journal_source_links
        WHERE journal_entry_id IN (${makeInClause(journalEntryIds)})`,
        journalEntryIds
      );
      await query(
        `DELETE FROM journal_lines
        WHERE journal_entry_id IN (${makeInClause(journalEntryIds)})`,
        journalEntryIds
      );
      await query(
        `DELETE FROM journal_entries
        WHERE id IN (${makeInClause(journalEntryIds)})`,
        journalEntryIds
      );
    }

    if (state.createdRegisterIds.length > 0) {
      await query(
        `DELETE FROM cash_registers
        WHERE id IN (${makeInClause(state.createdRegisterIds)})`,
        state.createdRegisterIds
      );
    }
    if (state.createdWarehouseIds.length > 0) {
      await query(
        `DELETE FROM inventory_warehouses
        WHERE id IN (${makeInClause(state.createdWarehouseIds)})`,
        state.createdWarehouseIds
      );
    }
    if (state.createdItemCardIds.length > 0) {
      await query(
        `DELETE FROM item_cards
        WHERE id IN (${makeInClause(state.createdItemCardIds)})`,
        state.createdItemCardIds
      );
    }
    if (state.createdCounterpartyIds.length > 0) {
      await query(
        `DELETE FROM counterparties
        WHERE id IN (${makeInClause(state.createdCounterpartyIds)})`,
        state.createdCounterpartyIds
      );
    }
    if (state.createdCategoryIds.length > 0) {
      await query(
        `DELETE FROM fixed_asset_categories
        WHERE id IN (${makeInClause(state.createdCategoryIds)})`,
        state.createdCategoryIds
      );
    }
    if (state.createdProfileIds.length > 0) {
      await query(
        `DELETE FROM fixed_asset_depreciation_profiles
        WHERE id IN (${makeInClause(state.createdProfileIds)})`,
        state.createdProfileIds
      );
    }
    if (state.createdOperatingUnitIds.length > 0) {
      await query(
        `DELETE FROM operating_units
        WHERE id IN (${makeInClause(state.createdOperatingUnitIds)})`,
        state.createdOperatingUnitIds
      );
    }

    if (tenantId && legalEntityId && state.previousPurposeMappings instanceof Map) {
      await restorePurposeMappings({
        tenantId,
        legalEntityId,
        previousMappings: state.previousPurposeMappings,
      });
    }

    if (state.createdAccountIds.length > 0) {
      await query(
        `DELETE FROM accounts
        WHERE id IN (${makeInClause(state.createdAccountIds)})`,
        state.createdAccountIds
      );
    }
    if (state.createdCoaId) {
      await query(`DELETE FROM charts_of_accounts WHERE id = ?`, [state.createdCoaId]);
    }
    if (state.createdUserRoleScopeUserIds.length > 0) {
      await query(
        `DELETE FROM user_role_scopes
        WHERE user_id IN (${makeInClause(state.createdUserRoleScopeUserIds)})`,
        state.createdUserRoleScopeUserIds
      );
    }
    if (state.createdUserIds.length > 0) {
      await query(
        `DELETE FROM users
        WHERE id IN (${makeInClause(state.createdUserIds)})`,
        state.createdUserIds
      );
    }
  }

async function main() {
    const stamp = `SL24${Date.now()}`;
    const state = buildState(stamp);
    const artifacts = {
      apDocumentId: null,
      arDocumentId: null,
      apSettlementBatchId: null,
      arSettlementBatchId: null,
      saleDocumentId: null,
      saleTransactionId: null,
    };

    console.log("STEP-SL24 smoke test: subledger-aware lines, immediate cash, navigation, and reversals");

    try {
      await runFrontendContractChecks();

      const context = await resolveSmokeContext();
      state.context = context;
      const coaId = await resolveLegalEntityCoaId(
        context.tenantId,
        context.legalEntityId,
        state
      );
      state.previousPurposeMappings = await capturePurposeMappings({
        tenantId: context.tenantId,
        legalEntityId: context.legalEntityId,
      });

      const userId = await createSmokeUser({
        tenantId: context.tenantId,
        stamp,
        state,
      });
      const accounts = await createTempAccounts({
        coaId,
        tenantId: context.tenantId,
        legalEntityId: context.legalEntityId,
        stamp,
        state,
      });
      const ownerOperatingUnitId = await createTempOperatingUnit({
        tenantId: context.tenantId,
        legalEntityId: context.legalEntityId,
        stamp,
        label: "OWNER",
        state,
      });
      const locationOperatingUnitId = await createTempOperatingUnit({
        tenantId: context.tenantId,
        legalEntityId: context.legalEntityId,
        stamp,
        label: "LOC",
        state,
      });
      const window = await resolveOpenPostingWindow(
        context.tenantId,
        context.legalEntityId
      );
      const vendorCounterpartyId = await createCounterparty({
        tenantId: context.tenantId,
        legalEntityId: context.legalEntityId,
        code: `SL24V${stamp.slice(-6)}`.toUpperCase(),
        name: `SL24 Vendor ${stamp}`,
        currencyCode: context.currencyCode,
        isCustomer: false,
        isVendor: true,
        state,
      });
      const customerCounterpartyId = await createCounterparty({
        tenantId: context.tenantId,
        legalEntityId: context.legalEntityId,
        code: `SL24C${stamp.slice(-6)}`.toUpperCase(),
        name: `SL24 Customer ${stamp}`,
        currencyCode: context.currencyCode,
        isCustomer: true,
        isVendor: false,
        state,
      });
      const profileId = await createSmokeProfile({
        tenantId: context.tenantId,
        legalEntityId: context.legalEntityId,
        userId,
        stamp,
        state,
      });
      const categoryId = await createSmokeCategory({
        tenantId: context.tenantId,
        legalEntityId: context.legalEntityId,
        userId,
        profileId,
        accounts,
        stamp,
        state,
      });
      const cashRegisterId = await createSmokeRegister({
        tenantId: context.tenantId,
        legalEntityId: context.legalEntityId,
        userId,
        currencyCode: context.currencyCode,
        accountId: accounts.cashRegisterAccountId,
        stamp,
        state,
      });
      const warehouse = await createSmokeWarehouse({
        tenantId: context.tenantId,
        legalEntityId: context.legalEntityId,
        stamp,
        state,
      });
      const itemCard = await createSmokeItemCard({
        tenantId: context.tenantId,
        legalEntityId: context.legalEntityId,
        stamp,
        accounts,
        state,
      });

      const env = {
        ...context,
        userId,
        stamp,
        window,
        accounts,
        vendorCounterpartyId,
        customerCounterpartyId,
        ownerOperatingUnitId,
        locationOperatingUnitId,
        categoryId,
        profileId,
        cashRegisterId,
        warehouse,
        itemCard,
      };

      await runAutoCreatePurchaseSmoke(env, state);
      await runLinkExistingSmoke(env, state);
      await runSaleSmoke(env, state, artifacts);
      await runMixedLineSmoke(env, state);
      await runAutoCreateReversalSmoke(env, state);
      await runReversalGuardSmoke(env, state);
      await runImmediateCashSmokes(env, state, artifacts);
      await runNavigationAndDrillbackSmoke(artifacts);

      console.log(`\nSL24 smoke passed (${passed} checks).`);
      console.log(
        JSON.stringify(
          {
            ok: true,
            tenantId: context.tenantId,
            legalEntityId: context.legalEntityId,
            checkedDocumentIds: state.documentIds,
            checkedSettlementBatchIds: state.settlementBatchIds,
            checkedCashTransactionIds: state.cashTransactionIds,
            checkedAssetIds: state.fixedAssetIds,
          },
          null,
          2
        )
      );
    } finally {
      await cleanupState(state);
    }
  }

main()
  .catch((error) => {
    console.error("\nSL24 smoke failed.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
