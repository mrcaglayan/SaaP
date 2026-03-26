import { closePool, query } from "../src/db.js";
import { resolveOrPrepareSmokeContext } from "./_smoke-context.js";
import {
  createCariDraftDocument,
  postCariDocumentById,
  reverseCariPostedDocumentById,
  updateCariDraftDocumentById,
} from "../src/services/cari.document.service.js";
import {
  createInventoryWarehouse,
  materializeInventoryMovementFromCariStockLink,
} from "../src/services/inventory.service.js";
import { createItemCard } from "../src/services/item.card.service.js";
import { createAssetDraft, activateAsset } from "../src/services/fixed-assets.service.js";

const KEEP_ARTIFACTS = parseBooleanEnv(process.env.LC40_SMOKE_KEEP_ARTIFACTS, false);

let passed = 0;

function parseBooleanEnv(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
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

function amountsEqual(left, right, epsilon = 0.000001) {
  return Math.abs(toNumber(left) - toNumber(right)) <= epsilon;
}

function getErrorMessage(error) {
  return String(
    error?.message
      || error?.body?.message
      || error?.response?.body?.message
      || error?.cause?.message
      || ""
  ).trim();
}

function addDays(dateText, days) {
  const next = new Date(`${String(dateText).slice(0, 10)}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + Number(days || 0));
  return next.toISOString().slice(0, 10);
}

function makeInClause(ids) {
  return ids.map(() => "?").join(", ");
}

function makeRequestContext({ tenantId, userId, stamp, suffix, lines = null }) {
  return {
    requestId: `${stamp}:${suffix}`.slice(0, 80),
    headers: {
      "user-agent": "cari-lc40-charge-allocation-smoke",
    },
    ip: "127.0.0.1",
    user: {
      tenantId,
      userId,
    },
    tenantId,
    body: Array.isArray(lines) ? { lines } : {},
  };
}

function allowAllScopes() {}

function buildState(stamp) {
  return {
    stamp,
    context: null,
    createdUserIds: [],
    createdAccountIds: [],
    createdCounterpartyIds: [],
    createdProfileIds: [],
    createdCategoryIds: [],
    createdWarehouseIds: [],
    createdItemCardIds: [],
    documentIds: [],
    fixedAssetIds: [],
    journalEntryIds: [],
    inventoryMovementIds: [],
  };
}

async function runCheck(label, fn) {
  await fn();
  passed += 1;
  console.log(`  [ok] ${label}`);
}

async function resolveSmokeContext() {
  return resolveOrPrepareSmokeContext({ prefix: "LC40" });
}

async function resolveLegalEntityCoaId(tenantId, legalEntityId) {
  const result = await query(
    `SELECT id
       FROM charts_of_accounts
      WHERE tenant_id = ?
        AND legal_entity_id = ?
        AND scope = 'LEGAL_ENTITY'
      ORDER BY id ASC
      LIMIT 1`,
    [tenantId, legalEntityId]
  );
  const coaId = toPositiveInt(result.rows?.[0]?.id);
  assert(coaId, `No LEGAL_ENTITY chart found for tenant=${tenantId}, legalEntity=${legalEntityId}`);
  return coaId;
}

async function createSmokeUser({ tenantId, stamp, state }) {
  const result = await query(
    `INSERT INTO users (
        tenant_id,
        email,
        password_hash,
        name,
        status
     ) VALUES (?, ?, ?, ?, 'ACTIVE')`,
    [
      tenantId,
      `lc40.smoke.${stamp}@example.test`,
      "not-used-in-direct-service-smoke",
      `LC40 Smoke ${stamp}`,
    ]
  );
  const userId = toPositiveInt(result.rows?.insertId);
  assert(userId, "Failed to create LC40 smoke user");
  state.createdUserIds.push(userId);
  return userId;
}

async function createTempAccounts({ coaId, stamp, state }) {
  const defs = [
    ["vendorLiabilityAccountId", "LIABILITY", "CREDIT", "VND", "Vendor Liability"],
    ["expenseAccountId", "EXPENSE", "DEBIT", "EXP", "Expense"],
    ["inventoryAssetAccountId", "ASSET", "DEBIT", "INV", "Inventory Asset"],
    ["cogsAccountId", "EXPENSE", "DEBIT", "COG", "COGS"],
    ["fixedAssetAccountId", "ASSET", "DEBIT", "FAA", "Fixed Asset"],
    ["accumDeprAccountId", "ASSET", "CREDIT", "ADA", "Accumulated Depreciation"],
    ["deprExpenseAccountId", "EXPENSE", "DEBIT", "DEP", "Depreciation Expense"],
    ["disposalGainAccountId", "REVENUE", "CREDIT", "DGN", "Disposal Gain"],
    ["disposalLossAccountId", "EXPENSE", "DEBIT", "DLS", "Disposal Loss"],
  ];

  const ids = {};
  for (const [key, accountType, normalSide, suffix, label] of defs) {
    const code = `LC40${suffix}${stamp.slice(-5)}`.slice(0, 50).toUpperCase();
    const result = await query(
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
      [coaId, code, `LC40 ${label} ${stamp}`, accountType, normalSide]
    );
    const accountId = toPositiveInt(result.rows?.insertId);
    assert(accountId, `Failed to create ${label} account`);
    ids[key] = accountId;
    state.createdAccountIds.push(accountId);
  }
  return ids;
}

async function createSmokeVendor({
  tenantId,
  legalEntityId,
  currencyCode,
  liabilityAccountId,
  stamp,
  state,
}) {
  const result = await query(
    `INSERT INTO counterparties (
        tenant_id,
        legal_entity_id,
        primary_operating_unit_id,
        code,
        name,
        is_customer,
        is_vendor,
        default_currency_code,
        ar_account_id,
        ap_account_id,
        status,
        notes
     ) VALUES (?, ?, NULL, ?, ?, 0, 1, ?, NULL, ?, 'ACTIVE', ?)`,
    [
      tenantId,
      legalEntityId,
      `LC40VND${stamp.slice(-8)}`.slice(0, 40).toUpperCase(),
      `LC40 Smoke Vendor ${stamp.slice(-8)}`,
      currencyCode,
      liabilityAccountId,
      "Temporary LC40 smoke vendor",
    ]
  );
  const counterpartyId = toPositiveInt(result.rows?.insertId);
  assert(counterpartyId, "Failed to create LC40 smoke vendor");
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
  const result = await query(
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
      `LC40PF${stamp.slice(-6)}`.toUpperCase(),
      `LC40 Profile ${stamp}`,
      "LC40 smoke depreciation profile",
      userId,
      userId,
    ]
  );
  const profileId = toPositiveInt(result.rows?.insertId);
  assert(profileId, "Failed to create LC40 depreciation profile");
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
  const result = await query(
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
     ) VALUES (?, ?, ?, ?, 'ACTIVE', ?, 1, 24, 'NONE', NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tenantId,
      legalEntityId,
      `LC40CT${stamp.slice(-6)}`.toUpperCase(),
      `LC40 Category ${stamp}`,
      "LC40 smoke fixed-asset category",
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
  const categoryId = toPositiveInt(result.rows?.insertId);
  assert(categoryId, "Failed to create LC40 fixed-asset category");
  state.createdCategoryIds.push(categoryId);
  return categoryId;
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
      code: `LC40WH${stamp.slice(-5)}`.toUpperCase(),
      name: `LC40 Warehouse ${stamp}`,
      status: "ACTIVE",
      notes: "LC40 stock charge-allocation smoke warehouse",
    },
  });
  const warehouseId = toPositiveInt(warehouse?.id);
  assert(warehouseId, "Failed to create LC40 warehouse");
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
      code: `LC40IT${stamp.slice(-6)}`.toUpperCase(),
      name: `LC40 Stock Item ${stamp}`,
      itemType: "STOCK_ITEM",
      defaultSalesAccountId: null,
      defaultPurchaseAccountId: accounts.expenseAccountId,
      inventoryAssetAccountId: accounts.inventoryAssetAccountId,
      defaultCogsAccountId: accounts.cogsAccountId,
      taxCategoryCode: null,
      status: "ACTIVE",
    },
  });
  const itemCardId = toPositiveInt(row?.id);
  assert(itemCardId, "Failed to create LC40 stock item");
  state.createdItemCardIds.push(itemCardId);
  return row;
}

async function createActiveAsset({
  tenantId,
  legalEntityId,
  userId,
  categoryId,
  currencyCode,
  ownerOperatingUnitId,
  locationOperatingUnitId,
  stamp,
  acquisitionDate,
  state,
}) {
  const asset = await createAssetDraft({
    tenantId,
    legalEntityId,
    userId,
    name: `LC40 Existing Asset ${stamp}`,
    categoryId,
    acquisitionDate,
    currencyCode,
    description: "LC40 smoke improvement target asset",
    assetTag: `LC40-${stamp.slice(-8)}`.slice(0, 100),
    serialNo: null,
    ownerOperatingUnitId,
    locationOperatingUnitId,
    departmentCode: null,
    costCenterCode: null,
    custodianEmployeeId: null,
    counterpartyId: null,
    originalCostTxn: 500,
    originalCostBase: 500,
  });
  const assetId = toPositiveInt(asset?.id);
  assert(assetId, "Failed to create LC40 draft asset");
  state.fixedAssetIds.push(assetId);

  await activateAsset({
    tenantId,
    assetId,
    postingDate: acquisitionDate,
    capitalizationDate: acquisitionDate,
    inServiceDate: acquisitionDate,
    assetTag: `LC40-ACT-${stamp.slice(-6)}`.slice(0, 100),
    userId,
  });

  const activationArtifacts = await query(
    `SELECT id, journal_entry_id
       FROM fixed_asset_transactions
      WHERE asset_id = ?
      ORDER BY id ASC`,
    [assetId]
  );
  for (const row of activationArtifacts.rows || []) {
    const journalEntryId = toPositiveInt(row.journal_entry_id);
    if (journalEntryId) {
      state.journalEntryIds.push(journalEntryId);
    }
  }

  return assetId;
}

async function getAssetRow(assetId) {
  const result = await query(
    `SELECT
        id,
        status,
        original_cost_txn,
        original_cost_base
     FROM fixed_assets
     WHERE id = ?
     LIMIT 1`,
    [assetId]
  );
  return result.rows?.[0] || null;
}

async function getSourceLinkedAssets({ documentId, sourceLineId }) {
  const result = await query(
    `SELECT
        id,
        status,
        source_cari_document_line_unit_no,
        original_cost_txn,
        original_cost_base
     FROM fixed_assets
     WHERE source_cari_document_id = ?
       AND source_cari_document_line_id = ?
     ORDER BY source_cari_document_line_unit_no ASC, id ASC`,
    [documentId, sourceLineId]
  );
  return result.rows || [];
}

async function getDocumentHeaderRow(documentId) {
  const result = await query(
    `SELECT
        id,
        direction,
        document_type,
        row_version
     FROM cari_documents
     WHERE id = ?
     LIMIT 1`,
    [documentId]
  );
  return result.rows?.[0] || null;
}

async function getJournalLines(journalEntryId) {
  const result = await query(
    `SELECT
        line_no,
        account_id,
        amount_txn,
        debit_base,
        credit_base,
        description
     FROM journal_lines
     WHERE journal_entry_id = ?
     ORDER BY line_no ASC`,
    [journalEntryId]
  );
  return result.rows || [];
}

async function getImprovementTransaction({ assetId, documentId }) {
  const result = await query(
    `SELECT
        id,
        transaction_type,
        gross_amount_txn,
        gross_amount_base,
        improvement_pre_cost_txn,
        improvement_pre_cost_base,
        journal_entry_id,
        reversed_transaction_id,
        source_ref_id,
        source_ref_line_id
     FROM fixed_asset_transactions
     WHERE asset_id = ?
       AND source_ref_type = 'CARI_DOCUMENT'
       AND source_ref_id = ?
       AND transaction_type = 'IMPROVEMENT'
     ORDER BY id DESC
     LIMIT 1`,
    [assetId, documentId]
  );
  return result.rows?.[0] || null;
}

async function getImprovementReversalTransaction(reversedTransactionId) {
  const result = await query(
    `SELECT
        id,
        transaction_type,
        journal_entry_id,
        reversed_transaction_id
     FROM fixed_asset_transactions
     WHERE reversed_transaction_id = ?
     ORDER BY id DESC
     LIMIT 1`,
    [reversedTransactionId]
  );
  return result.rows?.[0] || null;
}

async function getChargeTargets(chargeLineId) {
  const result = await query(
    `SELECT
        id,
        charge_line_id,
        target_line_id,
        allocated_amount_txn,
        allocated_amount_base
     FROM cari_document_line_charge_targets
     WHERE charge_line_id = ?
     ORDER BY id ASC`,
    [chargeLineId]
  );
  return result.rows || [];
}

async function getStockLinks(documentId) {
  const result = await query(
    `SELECT
        id,
        cari_document_line_id,
        posted_net_amount_txn,
        posted_net_amount_base,
        inventory_movement_id
     FROM cari_document_line_stock_links
     WHERE cari_document_id = ?
     ORDER BY id ASC`,
    [documentId]
  );
  return result.rows || [];
}

async function cleanupState(state) {
  if (KEEP_ARTIFACTS) {
    console.log(
      `\n[lc40-cleanup] keeping artifacts because LC40_SMOKE_KEEP_ARTIFACTS=true (stamp=${state.stamp})`
    );
    return;
  }

  const tenantId = state.context?.tenantId;
  if (tenantId) {
    try {
      await query(
        `DELETE FROM audit_logs
          WHERE tenant_id = ?
            AND request_id LIKE ?`,
        [tenantId, `${state.stamp}%`]
      );
    } catch (error) {
      console.warn(`[lc40-cleanup] audit_logs cleanup failed: ${String(error?.message || error)}`);
    }
  }

  const documentIds = Array.from(new Set(state.documentIds.filter(Boolean)));
  const fixedAssetIds = Array.from(new Set(state.fixedAssetIds.filter(Boolean)));
  const inventoryMovementIds = Array.from(new Set(state.inventoryMovementIds.filter(Boolean)));
  const journalEntryIds = new Set(state.journalEntryIds.filter(Boolean));

  if (fixedAssetIds.length > 0) {
    const fixedAssetTxResult = await query(
      `SELECT id, journal_entry_id
         FROM fixed_asset_transactions
        WHERE asset_id IN (${makeInClause(fixedAssetIds)})`,
      fixedAssetIds
    );
    for (const row of fixedAssetTxResult.rows || []) {
      const journalEntryId = toPositiveInt(row.journal_entry_id);
      if (journalEntryId) {
        journalEntryIds.add(journalEntryId);
      }
    }
    const fixedAssetTxIds = (fixedAssetTxResult.rows || [])
      .map((row) => toPositiveInt(row.id))
      .filter(Boolean);

    if (fixedAssetTxIds.length > 0) {
      await query(
        `DELETE FROM journal_source_links
          WHERE source_ref_type = 'FIXED_ASSET_TRANSACTION'
            AND source_ref_id IN (${makeInClause(fixedAssetTxIds)})`,
        fixedAssetTxIds
      );
      await query(
        `UPDATE fixed_asset_transactions
            SET reversed_transaction_id = NULL
          WHERE id IN (${makeInClause(fixedAssetTxIds)})
             OR reversed_transaction_id IN (${makeInClause(fixedAssetTxIds)})`,
        [...fixedAssetTxIds, ...fixedAssetTxIds]
      );
      await query(
        `DELETE FROM fixed_asset_transactions
          WHERE id IN (${makeInClause(fixedAssetTxIds)})`,
        fixedAssetTxIds
      );
    }

    await query(
      `DELETE FROM fixed_asset_depreciation_schedule_lines
        WHERE asset_id IN (${makeInClause(fixedAssetIds)})`,
      fixedAssetIds
    );
  }

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
        WHERE id IN (${makeInClause(inventoryMovementIds)})`,
      inventoryMovementIds
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

    const documentJournalResult = await query(
      `SELECT posted_journal_entry_id
         FROM cari_documents
        WHERE id IN (${makeInClause(documentIds)})`,
      documentIds
    );
    for (const row of documentJournalResult.rows || []) {
      const journalEntryId = toPositiveInt(row.posted_journal_entry_id);
      if (journalEntryId) {
        journalEntryIds.add(journalEntryId);
      }
    }

    const lineIdsResult = await query(
      `SELECT id
         FROM cari_document_lines
        WHERE cari_document_id IN (${makeInClause(documentIds)})`,
      documentIds
    );
    const lineIds = (lineIdsResult.rows || [])
      .map((row) => toPositiveInt(row.id))
      .filter(Boolean);

    if (lineIds.length > 0) {
      await query(
        `DELETE FROM cari_document_line_charge_targets
          WHERE charge_line_id IN (${makeInClause(lineIds)})
             OR target_line_id IN (${makeInClause(lineIds)})`,
        [...lineIds, ...lineIds]
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
        WHERE id IN (${makeInClause(documentIds)})
           OR reversal_of_document_id IN (${makeInClause(documentIds)})`,
      [...documentIds, ...documentIds]
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

  const journalIds = Array.from(journalEntryIds);
  if (journalIds.length > 0) {
    await query(
      `DELETE FROM journal_source_links
        WHERE journal_entry_id IN (${makeInClause(journalIds)})`,
      journalIds
    );
    await query(
      `DELETE FROM journal_lines
        WHERE journal_entry_id IN (${makeInClause(journalIds)})`,
      journalIds
    );
    await query(
      `DELETE FROM journal_entries
        WHERE id IN (${makeInClause(journalIds)})`,
      journalIds
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
  if (state.createdAccountIds.length > 0) {
    await query(
      `DELETE FROM accounts
        WHERE id IN (${makeInClause(state.createdAccountIds)})`,
      state.createdAccountIds
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
  const stamp = `LC40${Date.now()}`;
  const state = buildState(stamp);
  console.log("STEP-LC40 smoke test: line charges, ancillary allocation, stock valuation, and reversal");

  try {
    const context = await resolveSmokeContext();
    state.context = context;

    const coaId = await resolveLegalEntityCoaId(context.tenantId, context.legalEntityId);
    const userId = await createSmokeUser({
      tenantId: context.tenantId,
      stamp,
      state,
    });
    const accounts = await createTempAccounts({
      coaId,
      stamp,
      state,
    });
    const counterpartyId = await createSmokeVendor({
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      currencyCode: context.currencyCode,
      liabilityAccountId: accounts.vendorLiabilityAccountId,
      stamp,
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
    const acquisitionDate = addDays(new Date().toISOString().slice(0, 10), -1);
    const targetAssetId = await createActiveAsset({
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      userId,
      categoryId,
      currencyCode: context.currencyCode,
      ownerOperatingUnitId: context.sourceOuId,
      locationOperatingUnitId: context.sourceOuId,
      stamp,
      acquisitionDate,
      state,
    });
    const assetBefore = await getAssetRow(targetAssetId);
    assert(assetBefore, "Smoke asset missing before improvement scenario");

    let improvementPost = null;

    await runCheck(
      "charge lines reject stock-item defaulting that would reintroduce stock impact",
      async () => {
        const documentDate = new Date().toISOString().slice(0, 10);
        const lines = [
          {
            lineKind: "STANDARD",
            description: "LC40 Invalid Stock Charge",
            subledgerType: "NONE",
            itemCardId: itemCard.id,
            quantity: 1,
            unitPriceTxn: 25,
            lineNetAmountTxn: 25,
            lineTaxAmountTxn: 0,
            lineGrossAmountTxn: 25,
            postingAccountId: accounts.expenseAccountId,
            stockImpactMode: "NONE",
            warehouseId: warehouse.id,
            chargeAllocationMethod: "EQUAL",
            chargeTargets: [{ targetLineNo: 2 }],
          },
          {
            lineKind: "STANDARD",
            description: "LC40 Expense Target",
            subledgerType: "NONE",
            quantity: 1,
            unitPriceTxn: 100,
            lineNetAmountTxn: 100,
            lineTaxAmountTxn: 0,
            lineGrossAmountTxn: 100,
            postingAccountId: accounts.expenseAccountId,
            stockImpactMode: "NONE",
          },
        ];

        let failure = null;
        try {
          await createCariDraftDocument({
            req: makeRequestContext({
              tenantId: context.tenantId,
              userId,
              stamp,
              suffix: "invalid-stock-charge",
              lines,
            }),
            payload: {
              tenantId: context.tenantId,
              userId,
              legalEntityId: context.legalEntityId,
              counterpartyId,
              paymentTermId: null,
              direction: "AP",
              documentType: "INVOICE",
              documentDate,
              dueDate: documentDate,
              currencyCode: context.currencyCode,
              lines,
            },
            assertScopeAccess: allowAllScopes,
          });
        } catch (error) {
          failure = error;
        }

        assert(
          failure,
          "Expected stock-item charge line to be rejected after service-side default resolution"
        );
        const errorMessage = getErrorMessage(failure);
        assert(
          errorMessage.includes(
            "stockImpactMode must be NONE when chargeAllocationMethod != NONE"
          ),
          `Expected charge-line stock impact invariant error, got: ${errorMessage || "<empty>"}`
        );
      }
    );

    await runCheck(
      "charge drafts cannot be flipped from AP to AR without replacing lines",
      async () => {
        const documentDate = new Date().toISOString().slice(0, 10);
        const lines = [
          {
            lineKind: "STANDARD",
            description: "LC40 Header Flip Target",
            subledgerType: "NONE",
            quantity: 1,
            unitPriceTxn: 100,
            lineNetAmountTxn: 100,
            lineTaxAmountTxn: 0,
            lineGrossAmountTxn: 100,
            postingAccountId: accounts.expenseAccountId,
            stockImpactMode: "NONE",
          },
          {
            lineKind: "STANDARD",
            description: "LC40 Header Flip Charge",
            subledgerType: "NONE",
            chargeAllocationMethod: "EQUAL",
            chargeTargets: [{ targetLineNo: 1 }],
            quantity: 1,
            unitPriceTxn: 15,
            lineNetAmountTxn: 15,
            lineTaxAmountTxn: 0,
            lineGrossAmountTxn: 15,
            postingAccountId: accounts.expenseAccountId,
            stockImpactMode: "NONE",
          },
        ];

        const draft = await createCariDraftDocument({
          req: makeRequestContext({
            tenantId: context.tenantId,
            userId,
            stamp,
            suffix: "header-flip-create",
            lines,
          }),
          payload: {
            tenantId: context.tenantId,
            userId,
            legalEntityId: context.legalEntityId,
            counterpartyId,
            paymentTermId: null,
            direction: "AP",
            documentType: "INVOICE",
            documentDate,
            dueDate: documentDate,
            currencyCode: context.currencyCode,
            lines,
          },
          assertScopeAccess: allowAllScopes,
        });
        state.documentIds.push(toPositiveInt(draft?.id));

        let failure = null;
        try {
          await updateCariDraftDocumentById({
            req: makeRequestContext({
              tenantId: context.tenantId,
              userId,
              stamp,
              suffix: "header-flip-update",
            }),
            payload: {
              tenantId: context.tenantId,
              userId,
              documentId: draft.id,
              rowVersion: draft.rowVersion,
              direction: "AR",
              documentType: "INVOICE",
            },
            assertScopeAccess: allowAllScopes,
          });
        } catch (error) {
          failure = error;
        }

        assert(
          failure,
          "Expected AP charge draft update to AR without line replacement to be rejected"
        );
        const errorMessage = getErrorMessage(failure);
        assert(
          errorMessage.includes("chargeAllocationMethod is supported only on AP documents"),
          `Expected AP-only charge-line update invariant error, got: ${errorMessage || "<empty>"}`
        );

        const persistedRow = await getDocumentHeaderRow(draft.id);
        assert(persistedRow, "Expected charge draft to remain queryable after rejected update");
        assert(
          String(persistedRow.direction || "").toUpperCase() === "AP",
          `Rejected update must leave document direction as AP, got ${persistedRow?.direction}`
        );
      }
    );

    await runCheck(
      "AUTO_CREATE draft assets preserve charge-augmented cost through activation",
      async () => {
        const documentDate = new Date().toISOString().slice(0, 10);
        const lines = [
          {
            lineKind: "STANDARD",
            description: "LC40 FA Auto Base",
            subledgerType: "FIXED_ASSET",
            fixedAssetMode: "AUTO_CREATE",
            fixedAssetCategoryId: categoryId,
            fixedAssetOwnerOperatingUnitId: context.sourceOuId,
            fixedAssetLocationOperatingUnitId: context.sourceOuId,
            quantity: 3,
            unitPriceTxn: 500,
            lineNetAmountTxn: 1500,
            lineTaxAmountTxn: 0,
            lineGrossAmountTxn: 1500,
            stockImpactMode: "NONE",
          },
          {
            lineKind: "STANDARD",
            description: "LC40 FA Auto Charge",
            subledgerType: "NONE",
            chargeAllocationMethod: "BY_QTY",
            chargeTargets: [{ targetLineNo: 1 }],
            quantity: 1,
            unitPriceTxn: 30,
            lineNetAmountTxn: 30,
            lineTaxAmountTxn: 0,
            lineGrossAmountTxn: 30,
            postingAccountId: accounts.expenseAccountId,
            stockImpactMode: "NONE",
          },
        ];

        const draft = await createCariDraftDocument({
          req: makeRequestContext({
            tenantId: context.tenantId,
            userId,
            stamp,
            suffix: "fa-auto-create",
            lines,
          }),
          payload: {
            tenantId: context.tenantId,
            userId,
            legalEntityId: context.legalEntityId,
            counterpartyId,
            paymentTermId: null,
            direction: "AP",
            documentType: "INVOICE",
            documentDate,
            dueDate: documentDate,
            currencyCode: context.currencyCode,
            operatingUnitId: context.sourceOuId,
            lines,
          },
          assertScopeAccess: allowAllScopes,
        });
        state.documentIds.push(toPositiveInt(draft?.id));

        const postResult = await postCariDocumentById({
          req: makeRequestContext({
            tenantId: context.tenantId,
            userId,
            stamp,
            suffix: "fa-auto-post",
          }),
          payload: {
            tenantId: context.tenantId,
            userId,
            documentId: draft.id,
          },
          assertScopeAccess: allowAllScopes,
        });
        state.journalEntryIds.push(toPositiveInt(postResult?.journal?.journalEntryId));

        const postedRow = postResult?.row || postResult;
        const sourceLine = (postedRow?.lines || []).find(
          (line) => String(line?.description || "").trim() === "LC40 FA Auto Base"
        );
        assert(sourceLine?.id, "Auto-create fixed-asset source line missing after posting");

        const generatedAssets = await getSourceLinkedAssets({
          documentId: postedRow.id,
          sourceLineId: sourceLine.id,
        });
        assert(generatedAssets.length === 3, `Expected 3 auto-created draft assets, got ${generatedAssets.length}`);
        state.fixedAssetIds.push(...generatedAssets.map((asset) => toPositiveInt(asset.id)).filter(Boolean));

        for (const generatedAsset of generatedAssets) {
          assert(
            String(generatedAsset.status || "").toUpperCase() === "DRAFT",
            `Auto-created asset ${generatedAsset.id} should start in DRAFT, got ${generatedAsset.status}`
          );
          assert(
            amountsEqual(generatedAsset.original_cost_txn, 510)
            && amountsEqual(generatedAsset.original_cost_base, 510),
            `Auto-created asset ${generatedAsset.id} should have 510 charge-augmented cost, got txn=${generatedAsset.original_cost_txn}, base=${generatedAsset.original_cost_base}`
          );
        }

        const activationTargetId = toPositiveInt(generatedAssets[0]?.id);
        assert(activationTargetId, "Expected one auto-created asset id for activation");

        await activateAsset({
          tenantId: context.tenantId,
          assetId: activationTargetId,
          postingDate: documentDate,
          capitalizationDate: documentDate,
          inServiceDate: documentDate,
          assetTag: `LC40-AUTO-${stamp.slice(-6)}`.slice(0, 100),
          userId,
        });

        const activatedAsset = await getAssetRow(activationTargetId);
        assert(activatedAsset, "Activated auto-created asset missing after activation");
        assert(
          String(activatedAsset.status || "").toUpperCase() === "ACTIVE",
          `Auto-created asset should become ACTIVE after activation, got ${activatedAsset?.status}`
        );
        assert(
          amountsEqual(activatedAsset.original_cost_txn, 510)
          && amountsEqual(activatedAsset.original_cost_base, 510),
          `Activated auto-created asset should keep 510 charge-augmented cost, got txn=${activatedAsset?.original_cost_txn}, base=${activatedAsset?.original_cost_base}`
        );
      }
    );

    await runCheck("manual charge allocation augments IMPROVE_EXISTING and skips standalone debit", async () => {
      const documentDate = new Date().toISOString().slice(0, 10);
      const lines = [
        {
          lineKind: "STANDARD",
          description: "LC40 Improve Base",
          subledgerType: "FIXED_ASSET",
          fixedAssetMode: "IMPROVE_EXISTING",
          targetFixedAssetId: targetAssetId,
          improvementEffectiveDate: documentDate,
          quantity: 1,
          unitPriceTxn: 100,
          lineNetAmountTxn: 100,
          lineTaxAmountTxn: 0,
          lineGrossAmountTxn: 100,
          stockImpactMode: "NONE",
        },
        {
          lineKind: "STANDARD",
          description: "LC40 Install Charge",
          subledgerType: "NONE",
          chargeAllocationMethod: "MANUAL",
          chargeTargets: [{ targetLineNo: 1, allocatedAmountTxn: 20 }],
          quantity: 1,
          unitPriceTxn: 20,
          lineNetAmountTxn: 20,
          lineTaxAmountTxn: 0,
          lineGrossAmountTxn: 20,
          postingAccountId: accounts.expenseAccountId,
          stockImpactMode: "NONE",
        },
      ];

      const draft = await createCariDraftDocument({
        req: makeRequestContext({
          tenantId: context.tenantId,
          userId,
          stamp,
          suffix: "improve-create",
          lines,
        }),
        payload: {
          tenantId: context.tenantId,
          userId,
          legalEntityId: context.legalEntityId,
          counterpartyId,
          paymentTermId: null,
          direction: "AP",
          documentType: "INVOICE",
          documentDate,
          dueDate: documentDate,
          currencyCode: context.currencyCode,
          lines,
        },
        assertScopeAccess: allowAllScopes,
      });
      state.documentIds.push(toPositiveInt(draft?.id));

      improvementPost = await postCariDocumentById({
        req: makeRequestContext({
          tenantId: context.tenantId,
          userId,
          stamp,
          suffix: "improve-post",
        }),
        payload: {
          tenantId: context.tenantId,
          userId,
          documentId: draft.id,
        },
        assertScopeAccess: allowAllScopes,
      });
      state.journalEntryIds.push(toPositiveInt(improvementPost?.journal?.journalEntryId));

      const postedRow = improvementPost?.row || improvementPost;
      const chargeLine = (postedRow?.lines || []).find(
        (line) => String(line?.description || "").trim() === "LC40 Install Charge"
      );
      assert(chargeLine, "Improvement charge line missing from posted document");
      assert(
        String(chargeLine.chargeAllocationMethod || "").toUpperCase() === "MANUAL",
        "Improvement charge line must preserve MANUAL method"
      );
      assert(
        Array.isArray(chargeLine.chargeTargets) && chargeLine.chargeTargets.length === 1,
        "Improvement charge line must preserve one target"
      );

      const assetAfter = await getAssetRow(targetAssetId);
      assert(assetAfter, "Target asset missing after improvement posting");
      assert(
        amountsEqual(
          toNumber(assetAfter.original_cost_txn) - toNumber(assetBefore.original_cost_txn),
          120
        ),
        `Target asset original_cost_txn should increase by 120, got ${assetAfter.original_cost_txn}`
      );

      const improvementTx = await getImprovementTransaction({
        assetId: targetAssetId,
        documentId: postedRow.id,
      });
      assert(improvementTx, "Expected posted IMPROVEMENT transaction for charge-augmented document");
      assert(
        amountsEqual(
          toNumber(improvementTx.gross_amount_txn) - toNumber(improvementTx.improvement_pre_cost_txn),
          120
        ),
        `Improvement transaction gross delta should be 120, got gross=${improvementTx?.gross_amount_txn}, pre=${improvementTx?.improvement_pre_cost_txn}`
      );

      const journalLines = await getJournalLines(improvementPost.journal.journalEntryId);
      assert(journalLines.length === 2, `Improvement journal should have exactly 2 lines, got ${journalLines.length}`);
      const fixedAssetDebit = journalLines.find(
        (line) =>
          toPositiveInt(line.account_id) === accounts.fixedAssetAccountId
          && amountsEqual(line.debit_base, 120)
      );
      assert(fixedAssetDebit, "Expected one fixed-asset debit line for the augmented 120 amount");
      const ignoredChargeExpenseLine = journalLines.find(
        (line) => toPositiveInt(line.account_id) === accounts.expenseAccountId
      );
      assert(
        !ignoredChargeExpenseLine,
        "Charge line should not create a standalone expense debit when absorbed into target line"
      );
    });

    await runCheck("reversal restores fixed-asset basis and preserves charge graph on reversal document", async () => {
      const reversed = await reverseCariPostedDocumentById({
        req: makeRequestContext({
          tenantId: context.tenantId,
          userId,
          stamp,
          suffix: "improve-reverse",
        }),
        payload: {
          tenantId: context.tenantId,
          userId,
          documentId: improvementPost.row.id,
          reason: "LC40 smoke reversal",
          reversalDate: new Date().toISOString().slice(0, 10),
        },
        assertScopeAccess: allowAllScopes,
      });

      state.documentIds.push(toPositiveInt(reversed?.row?.id));
      state.journalEntryIds.push(toPositiveInt(reversed?.journal?.reversalJournalEntryId));

      const assetRestored = await getAssetRow(targetAssetId);
      assert(assetRestored, "Target asset missing after reversal");
      assert(
        amountsEqual(assetRestored.original_cost_txn, assetBefore.original_cost_txn),
        `Target asset original_cost_txn should restore to ${assetBefore.original_cost_txn}, got ${assetRestored.original_cost_txn}`
      );

      const improvementTx = await getImprovementTransaction({
        assetId: targetAssetId,
        documentId: improvementPost.row.id,
      });
      assert(improvementTx, "Original improvement transaction missing during reversal assertion");
      const reversalTx = await getImprovementReversalTransaction(improvementTx.id);
      assert(reversalTx, "Expected reversal fixed-asset transaction for LC40 improvement");

      const reversalChargeLine = (reversed?.row?.lines || []).find(
        (line) => String(line?.description || "").trim() === "LC40 Install Charge"
      );
      assert(reversalChargeLine, "Reversal document missing mirrored charge line");
      assert(
        String(reversalChargeLine.chargeAllocationMethod || "").toUpperCase() === "MANUAL",
        "Reversal document must preserve the charge allocation method"
      );
      assert(
        Array.isArray(reversalChargeLine.chargeTargets) && reversalChargeLine.chargeTargets.length === 1,
        "Reversal document must preserve the charge target graph"
      );
    });

    await runCheck("BY_QTY stock charge allocation persists computed targets and lands in inventory cost", async () => {
      const documentDate = new Date().toISOString().slice(0, 10);
      const lines = [
        {
          lineKind: "STANDARD",
          description: "LC40 Stock Line A",
          subledgerType: "STOCK",
          itemCardId: itemCard.id,
          quantity: 2,
          unitPriceTxn: 100,
          lineNetAmountTxn: 200,
          lineTaxAmountTxn: 0,
          lineGrossAmountTxn: 200,
          postingAccountId: accounts.expenseAccountId,
          stockImpactMode: "RECEIPT_PENDING",
          warehouseId: warehouse.id,
        },
        {
          lineKind: "STANDARD",
          description: "LC40 Stock Line B",
          subledgerType: "STOCK",
          itemCardId: itemCard.id,
          quantity: 3,
          unitPriceTxn: 100,
          lineNetAmountTxn: 300,
          lineTaxAmountTxn: 0,
          lineGrossAmountTxn: 300,
          postingAccountId: accounts.expenseAccountId,
          stockImpactMode: "RECEIPT_PENDING",
          warehouseId: warehouse.id,
        },
        {
          lineKind: "STANDARD",
          description: "LC40 Freight Charge",
          subledgerType: "NONE",
          chargeAllocationMethod: "BY_QTY",
          chargeTargets: [{ targetLineNo: 1 }, { targetLineNo: 2 }],
          quantity: 1,
          unitPriceTxn: 50,
          lineNetAmountTxn: 50,
          lineTaxAmountTxn: 0,
          lineGrossAmountTxn: 50,
          postingAccountId: accounts.expenseAccountId,
          stockImpactMode: "NONE",
        },
      ];

      const draft = await createCariDraftDocument({
        req: makeRequestContext({
          tenantId: context.tenantId,
          userId,
          stamp,
          suffix: "stock-create",
          lines,
        }),
        payload: {
          tenantId: context.tenantId,
          userId,
          legalEntityId: context.legalEntityId,
          counterpartyId,
          paymentTermId: null,
          direction: "AP",
          documentType: "INVOICE",
          documentDate,
          dueDate: documentDate,
          currencyCode: context.currencyCode,
          lines,
        },
        assertScopeAccess: allowAllScopes,
      });
      state.documentIds.push(toPositiveInt(draft?.id));

      const postResult = await postCariDocumentById({
        req: makeRequestContext({
          tenantId: context.tenantId,
          userId,
          stamp,
          suffix: "stock-post",
        }),
        payload: {
          tenantId: context.tenantId,
          userId,
          documentId: draft.id,
        },
        assertScopeAccess: allowAllScopes,
      });
      state.journalEntryIds.push(toPositiveInt(postResult?.journal?.journalEntryId));

      const postedRow = postResult?.row || postResult;
      const chargeLine = (postedRow?.lines || []).find(
        (line) => String(line?.description || "").trim() === "LC40 Freight Charge"
      );
      assert(chargeLine?.id, "Stock scenario charge line missing after posting");

      const chargeTargets = await getChargeTargets(chargeLine.id);
      assert(chargeTargets.length === 2, `Expected 2 persisted charge targets, got ${chargeTargets.length}`);
      assert(
        amountsEqual(chargeTargets[0].allocated_amount_txn, 20)
        && amountsEqual(chargeTargets[1].allocated_amount_txn, 30),
        `BY_QTY allocations should resolve to 20 and 30, got ${chargeTargets.map((row) => row.allocated_amount_txn).join(", ")}`
      );

      const stockLinks = await getStockLinks(postedRow.id);
      assert(stockLinks.length === 2, `Expected 2 stock links, got ${stockLinks.length}`);
      const firstStockLinkId = toPositiveInt(stockLinks[0].id);
      const secondStockLinkId = toPositiveInt(stockLinks[1].id);
      assert(firstStockLinkId && secondStockLinkId, "Stock links must have ids for materialization");
      assert(
        amountsEqual(stockLinks[0].posted_net_amount_txn, 220)
        && amountsEqual(stockLinks[1].posted_net_amount_txn, 330),
        `Augmented stock link amounts should be 220 and 330, got ${stockLinks.map((row) => row.posted_net_amount_txn).join(", ")}`
      );

      const movementA = await materializeInventoryMovementFromCariStockLink({
        payload: {
          tenantId: context.tenantId,
          legalEntityId: context.legalEntityId,
          stockLinkId: firstStockLinkId,
          movementDate: documentDate,
          userId,
        },
      });
      const movementB = await materializeInventoryMovementFromCariStockLink({
        payload: {
          tenantId: context.tenantId,
          legalEntityId: context.legalEntityId,
          stockLinkId: secondStockLinkId,
          movementDate: documentDate,
          userId,
        },
      });
      state.inventoryMovementIds.push(toPositiveInt(movementA?.id), toPositiveInt(movementB?.id));

      assert(
        amountsEqual(movementA?.totalCostTxn, 220) && amountsEqual(movementB?.totalCostTxn, 330),
        `Inventory receipt costs should be 220 and 330, got ${movementA?.totalCostTxn} and ${movementB?.totalCostTxn}`
      );
      assert(
        String(movementA?.note || "").includes("Includes allocated charges from CARI line charges")
        && String(movementB?.note || "").includes("Includes allocated charges from CARI line charges"),
        "Inventory movements must annotate that allocated charges were included"
      );
    });

    console.log(`\nLC40 smoke passed (${passed} checks).`);
  } finally {
    try {
      await cleanupState(state);
    } finally {
      await closePool();
    }
  }
}

main().catch((error) => {
  console.error("\nLC40 smoke failed.");
  console.error(error);
  process.exitCode = 1;
});
