import { closePool, query } from "../src/db.js";
import {
  createCariDraftDocument,
  postCariDocumentById,
  reverseCariPostedDocumentById,
} from "../src/services/cari.document.service.js";
import { createItemCard } from "../src/services/item.card.service.js";
import {
  createInventoryWarehouse,
  createInventoryMovementFromStockLink as createLegacyInventoryMovementFromStockLink,
  getInventoryWorkQueueSummary,
  listInventoryCostLayers,
  listPendingInventoryStockLinks,
  materializeInventoryMovementFromCariStockLink,
  reverseInventoryMovementById,
} from "../src/services/inventory.service.js";

const FEATURE_TAX_ENGINE_V1 = "FEATURE_TAX_ENGINE_V1";
const PURPOSE_CODES = Object.freeze([
  "CARI_AR_CONTROL",
  "CARI_AR_OFFSET",
  "CARI_AP_CONTROL",
  "CARI_AP_OFFSET",
]);

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

function makeRequestContext({ tenantId, userId, stamp, suffix }) {
  return {
    requestId: `${stamp}:${suffix}`.slice(0, 80),
    headers: {
      "user-agent": "cli09-rollout-regression",
    },
    ip: "127.0.0.1",
    user: {
      tenantId,
      userId,
    },
  };
}

function allowAllScopes() {}

function addDays(dateString, daysToAdd) {
  const base = new Date(`${String(dateString).slice(0, 10)}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + Number(daysToAdd || 0));
  return base.toISOString().slice(0, 10);
}

function makeInClause(ids) {
  return ids.map(() => "?").join(", ");
}

async function hasActiveWarehouseForOwnershipContext({
  tenantId,
  legalEntityId,
  operatingUnitId = null,
}) {
  const ownershipScope = operatingUnitId ? "OPERATING_UNIT" : "CENTRAL";
  const params = [tenantId, legalEntityId, ownershipScope];
  let sql = `
    SELECT id
      FROM inventory_warehouses
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND status = 'ACTIVE'
       AND ownership_scope = ?`;
  if (operatingUnitId) {
    sql += " AND operating_unit_id = ?";
    params.push(operatingUnitId);
  } else {
    sql += " AND operating_unit_id IS NULL";
  }
  sql += " LIMIT 1";
  const result = await query(sql, params);
  return toPositiveInt(result.rows?.[0]?.id) > 0;
}

async function createInventoryMovementFromStockLink({ payload }) {
  const strictPayload = {
    tenantId: payload?.tenantId,
    userId: payload?.userId,
    legalEntityId: payload?.legalEntityId,
    stockLinkId: payload?.stockLinkId ?? payload?.sourceStockLinkId,
    movementDate: payload?.movementDate,
    note: payload?.note,
  };
  const row = await materializeInventoryMovementFromCariStockLink({
    payload: strictPayload,
  });
  const expectedWarehouseId = toPositiveInt(payload?.warehouseId);
  if (expectedWarehouseId) {
    assert(
      toPositiveInt(row?.warehouseId) === expectedWarehouseId,
      "Strict stock-link materialization must derive the bound warehouse from the stock link"
    );
  }
  return row;
}

async function expectLegacyStrictMaterializationBlocked({
  tenantId,
  userId,
  legalEntityId,
  warehouseId,
  stockLinkId,
  movementDate,
  note,
}) {
  let blockedError = null;
  try {
    await createLegacyInventoryMovementFromStockLink({
      payload: {
        tenantId,
        userId,
        legalEntityId,
        warehouseId,
        sourceStockLinkId: stockLinkId,
        movementDate,
        note,
      },
    });
  } catch (error) {
    blockedError = error;
  }

  assert(
    blockedError,
    "Legacy inventory movement route must reject strict-mode stock links"
  );
  assert(
    String(blockedError.code || "").trim().toUpperCase() ===
      "STRICT_STOCK_LINK_MATERIALIZE_ROUTE_REQUIRED",
    "Legacy inventory movement route must require the dedicated strict stock-link materialize route"
  );
  assert(
    String(blockedError.message || "").includes(
      `/api/v1/inventory/cari-stock-links/${stockLinkId}/materialize`
    ),
    "Legacy strict-route rejection must point operators to the dedicated stock-link materialize endpoint"
  );
}

async function expectStrictStockLinkCleanupRequired({
  tenantId,
  userId,
  legalEntityId,
  stockLinkId,
  movementDate,
  note,
}) {
  let blockedError = null;
  try {
    await materializeInventoryMovementFromCariStockLink({
      payload: {
        tenantId,
        userId,
        legalEntityId,
        stockLinkId,
        movementDate,
        note,
      },
    });
  } catch (error) {
    blockedError = error;
  }

  assert(
    blockedError,
    "Strict stock-link materialization must reject cleanup-only successor rows"
  );
  assert(
    String(blockedError.code || "").trim().toUpperCase() ===
      "STOCK_LINK_CLEANUP_REQUIRED",
    "Cleanup-only successor rows must raise STOCK_LINK_CLEANUP_REQUIRED"
  );
  assert(
    /reset|clean up|cleanup/i.test(String(blockedError.message || "")),
    "Cleanup-only successor rows must instruct operators to reset or clean up invalid legacy data"
  );
}

function assertQueueReadModelFields(row, messagePrefix) {
  assert(row, `${messagePrefix} row is required`);
  assert("queueState" in row, `${messagePrefix} must expose queueState`);
  assert("blockedReasonCode" in row, `${messagePrefix} must expose blockedReasonCode`);
  assert("repairReasonCode" in row, `${messagePrefix} must expose repairReasonCode`);
  assert("canMaterialize" in row, `${messagePrefix} must expose canMaterialize`);
  assert("isStrictMode" in row, `${messagePrefix} must expose isStrictMode`);
  assert("isRepairOnly" in row, `${messagePrefix} must expose isRepairOnly`);
  assert("isLegacyRow" in row, `${messagePrefix} must expose isLegacyRow`);
}

async function resolveRegressionContext() {
  const result = await query(
    `SELECT
        t.id AS tenant_id,
        u.id AS user_id,
        le.id AS legal_entity_id,
        le.code AS legal_entity_code,
        le.country_id,
        le.functional_currency_code,
        fp.end_date AS posting_date
      FROM tenants t
      JOIN users u
        ON u.tenant_id = t.id
       AND u.status = 'ACTIVE'
      JOIN legal_entities le
        ON le.tenant_id = t.id
       AND le.status = 'ACTIVE'
      JOIN books b
        ON b.tenant_id = t.id
       AND b.legal_entity_id = le.id
       AND b.calendar_id IS NOT NULL
      JOIN fiscal_periods fp
        ON fp.calendar_id = b.calendar_id
      ORDER BY
        CASE WHEN t.id = 1 THEN 0 ELSE 1 END,
        t.id ASC,
        le.id ASC,
        fp.end_date DESC,
        u.id ASC
      LIMIT 1`
  );
  const row = result.rows?.[0] || null;
  assert(row, "No tenant/user/legal entity/book context available for CLI09 regression");
  return {
    tenantId: toPositiveInt(row.tenant_id),
    userId: toPositiveInt(row.user_id),
    legalEntityId: toPositiveInt(row.legal_entity_id),
    legalEntityCode: String(row.legal_entity_code || "").trim() || null,
    countryId: toPositiveInt(row.country_id),
    currencyCode: String(row.functional_currency_code || "USD").trim().toUpperCase(),
    postingDate: String(row.posting_date || "").slice(0, 10),
  };
}

async function ensureLegalEntityCoa({ tenantId, legalEntityId, stamp, state }) {
  const existing = await query(
    `SELECT id
       FROM charts_of_accounts
      WHERE tenant_id = ?
        AND scope = 'LEGAL_ENTITY'
        AND legal_entity_id = ?
      ORDER BY id ASC
      LIMIT 1`,
    [tenantId, legalEntityId]
  );
  const existingId = toPositiveInt(existing.rows?.[0]?.id);
  if (existingId) {
    return existingId;
  }

  const code = `CLI09COA${stamp.slice(-6)}`.slice(0, 60);
  const insertResult = await query(
    `INSERT INTO charts_of_accounts (
        tenant_id,
        legal_entity_id,
        scope,
        code,
        name
     )
     VALUES (?, ?, 'LEGAL_ENTITY', ?, ?)`,
    [tenantId, legalEntityId, code, `CLI09 Rollout CoA ${stamp}`]
  );
  const coaId = toPositiveInt(insertResult.rows?.insertId);
  assert(coaId, "Failed to create fallback LEGAL_ENTITY CoA for CLI09 regression");
  state.createdCoaId = coaId;
  return coaId;
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
    map.set(String(row.purpose_code || "").trim().toUpperCase(), toPositiveInt(row.account_id));
  }
  return map;
}

async function restorePurposeMappings({ tenantId, legalEntityId, previousMappings }) {
  for (const purposeCode of PURPOSE_CODES) {
    const previousAccountId = toPositiveInt(previousMappings.get(purposeCode));
    if (previousAccountId) {
      await query(
        `INSERT INTO journal_purpose_accounts (
            tenant_id,
            legal_entity_id,
            purpose_code,
            account_id
         )
         VALUES (?, ?, ?, ?)
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

async function createRegressionAccounts({ tenantId, legalEntityId, coaId, stamp, state }) {
  const accountDefs = [
    {
      key: "arControlAccountId",
      code: `CLI09ARC${stamp.slice(-5)}`.slice(0, 50),
      name: `CLI09 AR Control ${stamp}`,
      accountType: "ASSET",
      normalSide: "DEBIT",
    },
    {
      key: "arOffsetAccountId",
      code: `CLI09ARO${stamp.slice(-5)}`.slice(0, 50),
      name: `CLI09 Revenue ${stamp}`,
      accountType: "REVENUE",
      normalSide: "CREDIT",
    },
    {
      key: "apControlAccountId",
      code: `CLI09APC${stamp.slice(-5)}`.slice(0, 50),
      name: `CLI09 AP Control ${stamp}`,
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    },
    {
      key: "apOffsetAccountId",
      code: `CLI09APO${stamp.slice(-5)}`.slice(0, 50),
      name: `CLI09 Purchase Expense ${stamp}`,
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    },
    {
      key: "inventoryAssetAccountId",
      code: `CLI09INV${stamp.slice(-5)}`.slice(0, 50),
      name: `CLI09 Inventory Asset ${stamp}`,
      accountType: "ASSET",
      normalSide: "DEBIT",
    },
    {
      key: "cogsAccountId",
      code: `CLI09COG${stamp.slice(-5)}`.slice(0, 50),
      name: `CLI09 COGS ${stamp}`,
      accountType: "EXPENSE",
      normalSide: "DEBIT",
    },
    {
      key: "tax8AccountId",
      code: `CLI09T8${stamp.slice(-5)}`.slice(0, 50),
      name: `CLI09 VAT 8 Output ${stamp}`,
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    },
    {
      key: "tax18AccountId",
      code: `CLI09T18${stamp.slice(-4)}`.slice(0, 50),
      name: `CLI09 VAT 18 Output ${stamp}`,
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    },
  ];

  const ids = {};
  for (const definition of accountDefs) {
    const insertResult = await query(
      `INSERT INTO accounts (
          coa_id,
          code,
          name,
          account_type,
          normal_side,
          allow_posting,
          parent_account_id,
          is_active
       )
       VALUES (?, ?, ?, ?, ?, TRUE, NULL, TRUE)`,
      [
        coaId,
        definition.code,
        definition.name,
        definition.accountType,
        definition.normalSide,
      ]
    );
    const accountId = toPositiveInt(insertResult.rows?.insertId);
    assert(accountId, `Failed to create temp account ${definition.code}`);
    ids[definition.key] = accountId;
    state.createdAccountIds.push(accountId);
  }

  await query(
    `INSERT INTO journal_purpose_accounts (
        tenant_id,
        legal_entity_id,
        purpose_code,
        account_id
     )
     VALUES
       (?, ?, 'CARI_AR_CONTROL', ?),
       (?, ?, 'CARI_AR_OFFSET', ?),
       (?, ?, 'CARI_AP_CONTROL', ?),
       (?, ?, 'CARI_AP_OFFSET', ?)
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
    ]
  );

  return ids;
}

async function createTempCounterparty({ tenantId, legalEntityId, currencyCode, stamp, state }) {
  const code = `CLI09CP${stamp.slice(-6)}`.slice(0, 60);
  const insertResult = await query(
    `INSERT INTO counterparties (
        tenant_id,
        legal_entity_id,
        code,
        name,
        is_customer,
        is_vendor,
        default_currency_code,
        status,
        notes
     )
     VALUES (?, ?, ?, ?, TRUE, TRUE, ?, 'ACTIVE', ?)`,
    [
      tenantId,
      legalEntityId,
      code,
      `CLI09 Counterparty ${stamp}`,
      currencyCode,
      `CLI09 temp counterparty ${stamp}`,
    ]
  );
  const counterpartyId = toPositiveInt(insertResult.rows?.insertId);
  assert(counterpartyId, "Failed to create CLI09 temp counterparty");
  state.counterpartyId = counterpartyId;
  return counterpartyId;
}

async function createTempOperatingUnit({ tenantId, legalEntityId, stamp, state }) {
  const code = `CLI09OU${stamp.slice(-6)}`.slice(0, 80);
  const insertResult = await query(
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
     )
     VALUES (?, ?, ?, ?, 'BRANCH', FALSE, NULL, NULL, NULL, NULL)`,
    [
      tenantId,
      legalEntityId,
      code,
      `CLI09 Operating Unit ${stamp}`,
    ]
  );
  const operatingUnitId = toPositiveInt(insertResult.rows?.insertId);
  assert(operatingUnitId, "Failed to create CLI09 temp operating unit");
  state.operatingUnitIds.push(operatingUnitId);
  return operatingUnitId;
}

async function setFeatureFlag({ tenantId, userId, featureCode, enabled }) {
  await query(
    `INSERT INTO tenant_features (
        tenant_id,
        feature_code,
        is_enabled,
        updated_by_user_id
     )
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       is_enabled = VALUES(is_enabled),
       updated_by_user_id = VALUES(updated_by_user_id)`,
    [tenantId, featureCode, enabled ? 1 : 0, userId || null]
  );
}

async function createMixedTaxFixture({
  tenantId,
  legalEntityId,
  countryId,
  currencyCode,
  postingDate,
  userId,
  accountIds,
  stamp,
  state,
}) {
  const regimeCode = `CLI09RG${stamp.slice(-6)}`.slice(0, 80);
  const regimeInsert = await query(
    `INSERT INTO tax_regimes (
        tenant_id,
        country_id,
        legal_entity_id,
        code,
        name,
        currency_code,
        effective_from,
        effective_to,
        status,
        created_by_user_id
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'ACTIVE', ?)`,
    [
      tenantId,
      countryId,
      legalEntityId,
      regimeCode,
      `CLI09 Tax Regime ${stamp}`,
      currencyCode,
      postingDate,
      userId,
    ]
  );
  const regimeId = toPositiveInt(regimeInsert.rows?.insertId);
  assert(regimeId, "Failed to create CLI09 tax regime");
  state.taxRegimeIds.push(regimeId);

  const code8Insert = await query(
    `INSERT INTO tax_codes (
        tenant_id,
        tax_regime_id,
        code,
        name,
        tax_kind,
        rate_pct,
        calculation_mode,
        recoverability,
        is_reverse_charge,
        status
     )
     VALUES (?, ?, ?, ?, 'VAT', 8, 'EXCLUSIVE', 'FULL', FALSE, 'ACTIVE')`,
    [tenantId, regimeId, `CLI09V8${stamp.slice(-4)}`, `CLI09 VAT 8 ${stamp}`]
  );
  const taxCode8Id = toPositiveInt(code8Insert.rows?.insertId);
  assert(taxCode8Id, "Failed to create CLI09 VAT 8 code");
  state.taxCodeIds.push(taxCode8Id);

  const code18Insert = await query(
    `INSERT INTO tax_codes (
        tenant_id,
        tax_regime_id,
        code,
        name,
        tax_kind,
        rate_pct,
        calculation_mode,
        recoverability,
        is_reverse_charge,
        status
     )
     VALUES (?, ?, ?, ?, 'VAT', 18, 'EXCLUSIVE', 'FULL', FALSE, 'ACTIVE')`,
    [tenantId, regimeId, `CLI09V18${stamp.slice(-4)}`, `CLI09 VAT 18 ${stamp}`]
  );
  const taxCode18Id = toPositiveInt(code18Insert.rows?.insertId);
  assert(taxCode18Id, "Failed to create CLI09 VAT 18 code");
  state.taxCodeIds.push(taxCode18Id);

  const rule8Insert = await query(
    `INSERT INTO tax_rule_sets (
        tenant_id,
        tax_regime_id,
        tax_code_id,
        module_code,
        document_type,
        counterparty_type,
        apply_priority,
        threshold_amount,
        formula_json,
        status,
        effective_from,
        effective_to
     )
     VALUES (?, ?, ?, 'CARI', 'INVOICE', 'CUSTOMER', 10, NULL, CAST(? AS JSON), 'ACTIVE', ?, NULL)`,
    [
      tenantId,
      regimeId,
      taxCode8Id,
      JSON.stringify({
        type: "RATE",
        match: {
          taxCategoryCode: "FOOD8",
        },
      }),
      postingDate,
    ]
  );
  const rule8Id = toPositiveInt(rule8Insert.rows?.insertId);
  assert(rule8Id, "Failed to create CLI09 VAT 8 rule");
  state.taxRuleIds.push(rule8Id);

  const rule18Insert = await query(
    `INSERT INTO tax_rule_sets (
        tenant_id,
        tax_regime_id,
        tax_code_id,
        module_code,
        document_type,
        counterparty_type,
        apply_priority,
        threshold_amount,
        formula_json,
        status,
        effective_from,
        effective_to
     )
     VALUES (?, ?, ?, 'CARI', 'INVOICE', 'CUSTOMER', 20, NULL, CAST(? AS JSON), 'ACTIVE', ?, NULL)`,
    [
      tenantId,
      regimeId,
      taxCode18Id,
      JSON.stringify({
        type: "RATE",
        match: {
          taxCategoryCode: "GOODS18",
        },
      }),
      postingDate,
    ]
  );
  const rule18Id = toPositiveInt(rule18Insert.rows?.insertId);
  assert(rule18Id, "Failed to create CLI09 VAT 18 rule");
  state.taxRuleIds.push(rule18Id);

  const mapping8Insert = await query(
    `INSERT INTO tax_account_mappings (
        tenant_id,
        tax_regime_id,
        legal_entity_id,
        tax_code_id,
        tax_purpose_code,
        account_id,
        status
     )
     VALUES (?, ?, ?, ?, 'VAT_OUTPUT', ?, 'ACTIVE')`,
    [tenantId, regimeId, legalEntityId, taxCode8Id, accountIds.tax8AccountId]
  );
  const mapping8Id = toPositiveInt(mapping8Insert.rows?.insertId);
  assert(mapping8Id, "Failed to create CLI09 VAT 8 mapping");
  state.taxMappingIds.push(mapping8Id);

  const mapping18Insert = await query(
    `INSERT INTO tax_account_mappings (
        tenant_id,
        tax_regime_id,
        legal_entity_id,
        tax_code_id,
        tax_purpose_code,
        account_id,
        status
     )
     VALUES (?, ?, ?, ?, 'VAT_OUTPUT', ?, 'ACTIVE')`,
    [tenantId, regimeId, legalEntityId, taxCode18Id, accountIds.tax18AccountId]
  );
  const mapping18Id = toPositiveInt(mapping18Insert.rows?.insertId);
  assert(mapping18Id, "Failed to create CLI09 VAT 18 mapping");
  state.taxMappingIds.push(mapping18Id);
}

async function queryJournalLines(journalEntryId) {
  const result = await query(
    `SELECT
        account_id,
        tax_code,
        debit_base,
        credit_base,
        amount_txn
       FROM journal_lines
      WHERE journal_entry_id = ?
      ORDER BY line_no ASC`,
    [journalEntryId]
  );
  return result.rows || [];
}

async function queryJournalSummary(journalEntryId) {
  const result = await query(
    `SELECT
        id,
        status,
        reversal_journal_entry_id,
        reversed_at
      FROM journal_entries
      WHERE id = ?
      LIMIT 1`,
    [journalEntryId]
  );
  return result.rows?.[0] || null;
}

async function queryDocumentSummary(documentId) {
  const result = await query(
    `SELECT
        id,
        status,
        reversal_of_document_id,
        reversed_at
      FROM cari_documents
      WHERE id = ?
      LIMIT 1`,
    [documentId]
  );
  return result.rows?.[0] || null;
}

async function queryInventoryMovementSummary(movementId) {
  const result = await query(
    `SELECT
        id,
        movement_type,
        source_stock_link_id,
        source_document_type,
        source_document_id,
        source_document_line_id,
        reversal_of_movement_id,
        posted_journal_entry_id,
        reversal_journal_entry_id,
        reversed_at,
        valuation_status,
        quantity,
        total_cost_txn,
        total_cost_base,
        currency_code
      FROM inventory_movements
      WHERE id = ?
      LIMIT 1`,
    [movementId]
  );
  return result.rows?.[0] || null;
}

async function queryReceiptCostLayerBySourceMovementId(movementId) {
  const result = await query(
    `SELECT
        id,
        source_movement_id,
        layer_status,
        quantity_in,
        quantity_remaining,
        total_cost_txn,
        total_cost_base,
        currency_code
      FROM inventory_cost_layers
      WHERE source_movement_id = ?
      ORDER BY id ASC
      LIMIT 1`,
    [movementId]
  );
  return result.rows?.[0] || null;
}

async function expectCariReverseBlockedByInventory({
  context,
  documentId,
  expectedMovementType,
  expectedMovementId,
  expectedActionCode,
}) {
  let blockedError = null;
  try {
    await reverseCariPostedDocumentById({
      req: makeRequestContext({
        tenantId: context.tenantId,
        userId: context.userId,
        stamp: `CLI09REV${documentId}`,
        suffix: "blocked-reverse",
      }),
      payload: {
        tenantId: context.tenantId,
        userId: context.userId,
        documentId,
        reason: "CLI09 blocked reverse preflight",
        reversalDate: context.postingDate,
      },
      assertScopeAccess: allowAllScopes,
    });
  } catch (error) {
    blockedError = error;
  }

  assert(blockedError, "Document reverse should be blocked by linked inventory movement");
  assert(
    Number(blockedError.status) === 409,
    "Blocked document reverse must return status 409"
  );
  assert(
    String(blockedError.code || "").trim().toUpperCase() ===
      "CARI_DOCUMENT_REVERSE_BLOCKED_BY_INVENTORY",
    "Blocked document reverse must use inventory blocker error code"
  );
  const details = blockedError.details || blockedError.payload?.details || null;
  assert(details, "Blocked document reverse must include error details");
  const inventoryBlocks = Array.isArray(details?.inventoryBlocks)
    ? details.inventoryBlocks
    : [];
  assert(
    inventoryBlocks.length > 0,
    "Blocked document reverse must describe the active inventory block"
  );
  const matchedBlock = inventoryBlocks.find(
    (row) => toPositiveInt(row?.inventoryMovementId) === toPositiveInt(expectedMovementId)
  );
  assert(
    matchedBlock,
    "Blocked document reverse must identify the blocking inventory movement id"
  );
  assert(
    String(matchedBlock.inventoryMovementType || "").toUpperCase() ===
      String(expectedMovementType || "").toUpperCase(),
    "Blocked document reverse must expose the blocking movement type"
  );
  assert(
    String(matchedBlock.suggestedActionCode || "").toUpperCase() ===
      String(expectedActionCode || "").toUpperCase(),
    "Blocked document reverse must expose the correct suggested action code"
  );

  const documentSummary = await queryDocumentSummary(documentId);
  assert(documentSummary, "Blocked document reverse must leave the original document queryable");
  assert(
    String(documentSummary.status || "").toUpperCase() === "POSTED",
    "Blocked document reverse must not mutate original document status"
  );
  assert(
    !toPositiveInt(documentSummary.reversal_of_document_id) &&
      !String(documentSummary.reversed_at || "").trim(),
    "Blocked document reverse must not stamp reversal fields on the original document"
  );
}

async function queryOpenItem(documentId) {
  const result = await query(
    `SELECT
        original_amount_txn,
        residual_amount_txn,
        original_amount_base,
        residual_amount_base
       FROM cari_open_items
      WHERE document_id = ?
      ORDER BY id ASC
      LIMIT 1`,
    [documentId]
  );
  return result.rows?.[0] || null;
}

async function queryDocumentPostingState(documentId) {
  const result = await query(
    `SELECT
        id,
        status,
        posted_journal_entry_id
       FROM cari_documents
      WHERE id = ?
      LIMIT 1`,
    [documentId]
  );
  return result.rows?.[0] || null;
}

async function queryDocumentStockLinkCount(documentId) {
  const result = await query(
    `SELECT COUNT(*) AS row_count
       FROM cari_document_line_stock_links
      WHERE cari_document_id = ?`,
    [documentId]
  );
  return Number(result.rows?.[0]?.row_count || 0);
}

async function expectPostBlocked({
  context,
  documentId,
  stamp,
  suffix,
  expectedCode = null,
  expectedMessagePattern = null,
  expectedReason = null,
  expectedLineField = null,
}) {
  let blockedError = null;
  try {
    await postCariDocumentById({
      req: makeRequestContext({
        tenantId: context.tenantId,
        userId: context.userId,
        stamp,
        suffix,
      }),
      payload: {
        tenantId: context.tenantId,
        userId: context.userId,
        documentId,
      },
      assertScopeAccess: allowAllScopes,
    });
  } catch (error) {
    blockedError = error;
  }

  assert(blockedError, "Posting should be blocked");
  assert(Number(blockedError.status) === 400, "Blocked post must return status 400");
  if (expectedCode) {
    assert(
      String(blockedError.code || "").trim().toUpperCase() ===
        String(expectedCode).trim().toUpperCase(),
      "Blocked post must expose the expected error code"
    );
  }
  if (expectedMessagePattern) {
    assert(
      expectedMessagePattern.test(String(blockedError.message || "")),
      "Blocked post must expose the expected validation message"
    );
  }
  if (expectedReason) {
    assert(
      String(blockedError.details?.reason || "").trim().toUpperCase() ===
        String(expectedReason).trim().toUpperCase(),
      "Blocked post must expose the expected validation reason"
    );
  }
  if (expectedLineField) {
    const lineErrors = Array.isArray(blockedError.details?.lineErrors)
      ? blockedError.details.lineErrors
      : [];
    assert(lineErrors.length > 0, "Blocked post must include line-level stock validation errors");
    assert(
      lineErrors.some((row) => String(row?.field || "").trim() === String(expectedLineField)),
      "Blocked post must identify the blocked line field"
    );
  }

  const documentState = await queryDocumentPostingState(documentId);
  assert(documentState, "Blocked post must leave the draft document queryable");
  assert(
    String(documentState.status || "").toUpperCase() === "DRAFT",
    "Blocked post must leave document status as DRAFT"
  );
  assert(
    !toPositiveInt(documentState.posted_journal_entry_id),
    "Blocked post must not stamp posted journal linkage"
  );

  const openItem = await queryOpenItem(documentId);
  assert(!openItem, "Blocked post must not create an open item");

  const stockLinkCount = await queryDocumentStockLinkCount(documentId);
  assert(stockLinkCount === 0, "Blocked post must not create stock links before validation succeeds");

  return blockedError;
}

async function expectDraftCreateBlocked({
  context,
  payload,
  stamp,
  suffix,
  expectedMessagePattern = null,
}) {
  let blockedError = null;
  try {
    await createCariDraftDocument({
      req: makeRequestContext({
        tenantId: context.tenantId,
        userId: context.userId,
        stamp,
        suffix,
      }),
      payload,
      assertScopeAccess: allowAllScopes,
    });
  } catch (error) {
    blockedError = error;
  }

  assert(blockedError, "Draft create should be blocked");
  assert(Number(blockedError.status) === 400, "Blocked draft create must return status 400");
  if (expectedMessagePattern) {
    assert(
      expectedMessagePattern.test(String(blockedError.message || "")),
      "Blocked draft create must expose the expected validation message"
    );
  }
  return blockedError;
}

async function queryIssueLayerConsumptions(issueMovementId) {
  const result = await query(
    `SELECT
        id,
        issue_movement_id,
        cost_layer_id,
        consumption_no,
        quantity_consumed,
        unit_cost_txn,
        unit_cost_base,
        total_cost_txn,
        total_cost_base,
        currency_code
      FROM inventory_issue_layer_consumptions
      WHERE issue_movement_id = ?
      ORDER BY consumption_no ASC`,
    [issueMovementId]
  );
  return result.rows || [];
}

async function queryStockLinksForDocumentLine({
  tenantId,
  legalEntityId,
  documentId,
  documentLineId,
  stockImpactMode = null,
}) {
  const params = [tenantId, legalEntityId, documentId, documentLineId];
  let whereSql = `
      WHERE tenant_id = ?
        AND legal_entity_id = ?
        AND cari_document_id = ?
        AND cari_document_line_id = ?`;
  if (stockImpactMode) {
    whereSql += " AND stock_impact_mode = ?";
    params.push(stockImpactMode);
  }

  const result = await query(
    `SELECT
        id,
        cari_document_id,
        cari_document_line_id,
        stock_impact_mode,
        link_status,
        warehouse_id,
        inventory_movement_id,
        reopened_from_stock_link_id,
        superseded_by_stock_link_id,
        resolved_at,
        resolution_note
       FROM cari_document_line_stock_links
      ${whereSql}
      ORDER BY id ASC`,
    params
  );
  return result.rows || [];
}

async function resolveAlternateCurrencyCode(baseCurrencyCode) {
  const result = await query(
    `SELECT code
       FROM currencies
      WHERE code <> ?
      ORDER BY
        CASE WHEN code IN ('EUR', 'USD', 'AFN') THEN 0 ELSE 1 END,
        code ASC
      LIMIT 1`,
    [String(baseCurrencyCode || "").trim().toUpperCase()]
  );
  const code = String(result.rows?.[0]?.code || "")
    .trim()
    .toUpperCase();
  assert(code, "No alternate currency found for mixed-currency inventory regression");
  return code;
}

async function insertManualReceiptLayer({
  tenantId,
  legalEntityId,
  warehouseId,
  itemCardId,
  movementDate,
  quantity,
  currencyCode,
  unitCostTxn,
  unitCostBase,
  note,
  state,
}) {
  const totalCostTxn = Number((Number(quantity) * Number(unitCostTxn)).toFixed(6));
  const totalCostBase = Number((Number(quantity) * Number(unitCostBase)).toFixed(6));
  const movementInsert = await query(
    `INSERT INTO inventory_movements (
        tenant_id,
        legal_entity_id,
        warehouse_id,
        item_card_id,
        movement_type,
        source_type,
        source_stock_link_id,
        source_document_type,
        source_document_id,
        source_document_line_id,
        movement_date,
        quantity,
        unit_cost_txn,
        unit_cost_base,
        total_cost_txn,
        total_cost_base,
        currency_code,
        valuation_status,
        note
      )
      VALUES (?, ?, ?, ?, 'RECEIPT', 'MANUAL', NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, 'VALUED', ?)`,
    [
      tenantId,
      legalEntityId,
      warehouseId,
      itemCardId,
      movementDate,
      quantity,
      unitCostTxn,
      unitCostBase,
      totalCostTxn,
      totalCostBase,
      currencyCode,
      note,
    ]
  );
  const movementId = toPositiveInt(movementInsert.rows?.insertId);
  assert(movementId, "Failed to insert manual receipt movement for mixed-currency regression");
  state.inventoryMovementIds.push(movementId);

  const costLayerInsert = await query(
    `INSERT INTO inventory_cost_layers (
        tenant_id,
        legal_entity_id,
        warehouse_id,
        item_card_id,
        source_movement_id,
        valuation_method,
        layer_status,
        currency_code,
        quantity_in,
        quantity_remaining,
        unit_cost_txn,
        unit_cost_base,
        total_cost_txn,
        total_cost_base
      )
      VALUES (?, ?, ?, ?, ?, 'FIFO', 'OPEN', ?, ?, ?, ?, ?, ?, ?)`,
    [
      tenantId,
      legalEntityId,
      warehouseId,
      itemCardId,
      movementId,
      currencyCode,
      quantity,
      quantity,
      unitCostTxn,
      unitCostBase,
      totalCostTxn,
      totalCostBase,
    ]
  );
  const costLayerId = toPositiveInt(costLayerInsert.rows?.insertId);
  assert(costLayerId, "Failed to insert manual receipt cost layer for mixed-currency regression");
  state.inventoryCostLayerIds.push(costLayerId);

  return {
    movementId,
    costLayerId,
    totalCostTxn,
    totalCostBase,
    currencyCode,
  };
}

async function runSyntheticSingleLineScenario({
  context,
  counterpartyId,
  accountIds,
  state,
}) {
  const draft = await createCariDraftDocument({
    req: makeRequestContext({
      tenantId: context.tenantId,
      userId: context.userId,
      stamp: state.stamp,
      suffix: "synthetic-create",
    }),
    payload: {
      tenantId: context.tenantId,
      userId: context.userId,
      legalEntityId: context.legalEntityId,
      counterpartyId,
      paymentTermId: null,
      direction: "AR",
      documentType: "INVOICE",
      documentDate: context.postingDate,
      dueDate: addDays(context.postingDate, 15),
      amountTxn: 1200,
      currencyCode: context.currencyCode,
    },
    assertScopeAccess: allowAllScopes,
  });
  state.documentIds.push(draft.id);
  assert(Array.isArray(draft.lines) && draft.lines.length === 1, "Synthetic draft must store one compatibility line");
  assert(amountsEqual(draft.grossAmountTxn, 1200), "Synthetic draft gross total should stay 1200");
  assert(amountsEqual(draft.lines[0]?.lineNetAmountTxn, 1200), "Synthetic line net amount should equal header amount");
  assert(toPositiveInt(draft.lines[0]?.postingAccountId) === 0, "Synthetic line should not persist an explicit postingAccountId");

  const posted = await postCariDocumentById({
    req: makeRequestContext({
      tenantId: context.tenantId,
      userId: context.userId,
      stamp: state.stamp,
      suffix: "synthetic-post",
    }),
    payload: {
      tenantId: context.tenantId,
      userId: context.userId,
      documentId: draft.id,
    },
    assertScopeAccess: allowAllScopes,
  });
  state.journalEntryIds.push(toPositiveInt(posted.journal?.journalEntryId));
  assert(posted.row?.status === "POSTED", "Synthetic document must post successfully");
  const journalLines = await queryJournalLines(posted.journal.journalEntryId);
  assert(journalLines.length === 2, "Synthetic one-line post should create exactly two journal lines");
  assert(
    journalLines.some((row) => toPositiveInt(row.account_id) === accountIds.arControlAccountId),
    "Synthetic journal must use the temp AR control account"
  );
  assert(
    journalLines.some((row) => toPositiveInt(row.account_id) === accountIds.arOffsetAccountId),
    "Synthetic journal must use the temp AR offset account"
  );
  assert(
    journalLines.every((row) => !String(row.tax_code || "").trim()),
    "Synthetic one-line compatibility post must not create tax lines"
  );
}

async function runStrictPostingValidationScenario({
  context,
  counterpartyId,
  accountIds,
  state,
}) {
  const itemCard = await createItemCard({
    payload: {
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      code: `CLI09PV${state.stamp.slice(-6)}`.slice(0, 80),
      name: `CLI09 Post Validation Item ${state.stamp}`,
      itemType: "STOCK_ITEM",
      defaultSalesAccountId: accountIds.arOffsetAccountId,
      defaultPurchaseAccountId: accountIds.apOffsetAccountId,
      inventoryAssetAccountId: accountIds.inventoryAssetAccountId,
      defaultCogsAccountId: accountIds.cogsAccountId,
      taxCategoryCode: null,
      status: "ACTIVE",
    },
  });
  state.itemCardIds.push(toPositiveInt(itemCard.id));

  const inactiveWarehouse = await createInventoryWarehouse({
    payload: {
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      code: `CLI09IA${state.stamp.slice(-5)}`.slice(0, 80),
      name: `CLI09 Inactive Warehouse ${state.stamp}`,
      status: "INACTIVE",
      notes: "CLI09 inactive warehouse for post-time validation",
    },
  });
  state.warehouseIds.push(toPositiveInt(inactiveWarehouse.id));
  const hasActiveCentralWarehouse = await hasActiveWarehouseForOwnershipContext({
    tenantId: context.tenantId,
    legalEntityId: context.legalEntityId,
  });

  const noActiveWarehouseDraft = await createCariDraftDocument({
    req: makeRequestContext({
      tenantId: context.tenantId,
      userId: context.userId,
      stamp: state.stamp,
      suffix: "strict-no-active-create",
    }),
    payload: {
      tenantId: context.tenantId,
      userId: context.userId,
      legalEntityId: context.legalEntityId,
      counterpartyId,
      paymentTermId: null,
      direction: "AR",
      documentType: "INVOICE",
      documentDate: context.postingDate,
      dueDate: addDays(context.postingDate, 11),
      currencyCode: context.currencyCode,
      lines: [
        {
          description: "CLI09 blocked by no active warehouse",
          itemCardId: itemCard.id,
          warehouseId: inactiveWarehouse.id,
          quantity: 2,
          lineNetAmountTxn: 180,
          lineTaxAmountTxn: 0,
          lineGrossAmountTxn: 180,
        },
      ],
    },
    assertScopeAccess: allowAllScopes,
  });
  state.documentIds.push(noActiveWarehouseDraft.id);

  await expectPostBlocked({
    context,
    documentId: noActiveWarehouseDraft.id,
    stamp: state.stamp,
    suffix: "strict-no-active-post",
    expectedMessagePattern: hasActiveCentralWarehouse
      ? /warehouseId must reference an ACTIVE warehouse/i
      : /No active warehouse exists for ownership context CENTRAL/i,
  });

  const activeWarehouse = await createInventoryWarehouse({
    payload: {
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      code: `CLI09AV${state.stamp.slice(-5)}`.slice(0, 80),
      name: `CLI09 Active Warehouse ${state.stamp}`,
      status: "ACTIVE",
      notes: "CLI09 active warehouse for stock shortage validation",
    },
  });
  state.warehouseIds.push(toPositiveInt(activeWarehouse.id));

  const shortageDraft = await createCariDraftDocument({
    req: makeRequestContext({
      tenantId: context.tenantId,
      userId: context.userId,
      stamp: state.stamp,
      suffix: "strict-shortage-create",
    }),
    payload: {
      tenantId: context.tenantId,
      userId: context.userId,
      legalEntityId: context.legalEntityId,
      counterpartyId,
      paymentTermId: null,
      direction: "AR",
      documentType: "INVOICE",
      documentDate: context.postingDate,
      dueDate: addDays(context.postingDate, 13),
      currencyCode: context.currencyCode,
      lines: [
        {
          description: "CLI09 blocked by bound warehouse shortage",
          itemCardId: itemCard.id,
          warehouseId: activeWarehouse.id,
          quantity: 2,
          lineNetAmountTxn: 240,
          lineTaxAmountTxn: 0,
          lineGrossAmountTxn: 240,
        },
      ],
    },
    assertScopeAccess: allowAllScopes,
  });
  state.documentIds.push(shortageDraft.id);

  const shortageError = await expectPostBlocked({
    context,
    documentId: shortageDraft.id,
    stamp: state.stamp,
    suffix: "strict-shortage-post",
    expectedCode: "CARI_DOCUMENT_POST_STOCK_VALIDATION_FAILED",
    expectedReason: "INSUFFICIENT_AVAILABLE_STOCK_IN_BOUND_WAREHOUSE",
    expectedLineField: "storedLines[1].quantity",
    expectedMessagePattern: /Insufficient available stock in bound warehouse/i,
  });
  const lineErrors = Array.isArray(shortageError.details?.lineErrors)
    ? shortageError.details.lineErrors
    : [];
  assert(lineErrors.length === 1, "Shortage-blocked post must report one blocked line");
  assert(
    amountsEqual(lineErrors[0]?.requestedQuantity, 2) &&
      amountsEqual(lineErrors[0]?.availableQuantity, 0),
    "Shortage-blocked post must expose requested and available quantities"
  );

  const transferOperatingUnitId = await createTempOperatingUnit({
    tenantId: context.tenantId,
    legalEntityId: context.legalEntityId,
    stamp: `${state.stamp}TV`,
    state,
  });
  const transferSourceWarehouse = await createInventoryWarehouse({
    payload: {
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      ownershipScope: "OPERATING_UNIT",
      operatingUnitId: transferOperatingUnitId,
      code: `CLI09TV${state.stamp.slice(-5)}`.slice(0, 80),
      name: `CLI09 Transfer Source Warehouse ${state.stamp}`,
      status: "ACTIVE",
      notes: "CLI09 transfer-required source warehouse",
    },
  });
  state.warehouseIds.push(toPositiveInt(transferSourceWarehouse.id));

  const transferSourceReceiptDraft = await createCariDraftDocument({
    req: makeRequestContext({
      tenantId: context.tenantId,
      userId: context.userId,
      stamp: state.stamp,
      suffix: "strict-transfer-source-receipt-create",
    }),
    payload: {
      tenantId: context.tenantId,
      userId: context.userId,
      legalEntityId: context.legalEntityId,
      operatingUnitId: transferOperatingUnitId,
      counterpartyId,
      paymentTermId: null,
      direction: "AP",
      documentType: "INVOICE",
      documentDate: context.postingDate,
      dueDate: addDays(context.postingDate, 14),
      currencyCode: context.currencyCode,
      lines: [
        {
          description: "CLI09 transfer-required source receipt",
          itemCardId: itemCard.id,
          warehouseId: transferSourceWarehouse.id,
          quantity: 6,
          lineNetAmountTxn: 600,
          lineTaxAmountTxn: 0,
          lineGrossAmountTxn: 600,
        },
      ],
    },
    assertScopeAccess: allowAllScopes,
  });
  state.documentIds.push(transferSourceReceiptDraft.id);

  const postedTransferSourceReceipt = await postCariDocumentById({
    req: makeRequestContext({
      tenantId: context.tenantId,
      userId: context.userId,
      stamp: state.stamp,
      suffix: "strict-transfer-source-receipt-post",
    }),
    payload: {
      tenantId: context.tenantId,
      userId: context.userId,
      documentId: transferSourceReceiptDraft.id,
    },
    assertScopeAccess: allowAllScopes,
  });
  state.journalEntryIds.push(toPositiveInt(postedTransferSourceReceipt.journal?.journalEntryId));

  const postedTransferSourceLinks = await listPendingInventoryStockLinks({
    tenantId: context.tenantId,
    filters: {
      legalEntityId: context.legalEntityId,
      queueScope: "ACTIONABLE",
      limit: 200,
      offset: 0,
    },
  });
  const transferSourceReceiptLink = (postedTransferSourceLinks.rows || []).find(
    (row) =>
      toPositiveInt(row.documentId) === toPositiveInt(transferSourceReceiptDraft.id) &&
      String(row.stockImpactMode || "").toUpperCase() === "RECEIPT_PENDING"
  );
  assert(
    transferSourceReceiptLink,
    "Transfer-required source receipt must create a pending receipt stock link"
  );
  state.stockLinkIds.push(toPositiveInt(transferSourceReceiptLink.id));
  const transferSourceReceiptMovement = await createInventoryMovementFromStockLink({
    payload: {
      tenantId: context.tenantId,
      userId: context.userId,
      legalEntityId: context.legalEntityId,
      warehouseId: transferSourceWarehouse.id,
      stockLinkId: transferSourceReceiptLink.id,
      movementDate: context.postingDate,
      note: `CLI09 transfer-required source receipt materialization ${state.stamp}`,
    },
  });
  state.inventoryMovementIds.push(toPositiveInt(transferSourceReceiptMovement.id));

  const transferRequiredDraft = await createCariDraftDocument({
    req: makeRequestContext({
      tenantId: context.tenantId,
      userId: context.userId,
      stamp: state.stamp,
      suffix: "strict-transfer-required-create",
    }),
    payload: {
      tenantId: context.tenantId,
      userId: context.userId,
      legalEntityId: context.legalEntityId,
      counterpartyId,
      paymentTermId: null,
      direction: "AR",
      documentType: "INVOICE",
      documentDate: context.postingDate,
      dueDate: addDays(context.postingDate, 15),
      currencyCode: context.currencyCode,
      lines: [
        {
          description: "CLI09 blocked by transfer-required guidance",
          itemCardId: itemCard.id,
          warehouseId: activeWarehouse.id,
          quantity: 2,
          lineNetAmountTxn: 260,
          lineTaxAmountTxn: 0,
          lineGrossAmountTxn: 260,
        },
      ],
    },
    assertScopeAccess: allowAllScopes,
  });
  state.documentIds.push(transferRequiredDraft.id);

  const transferRequiredError = await expectPostBlocked({
    context,
    documentId: transferRequiredDraft.id,
    stamp: state.stamp,
    suffix: "strict-transfer-required-post",
    expectedCode: "CARI_DOCUMENT_POST_STOCK_VALIDATION_FAILED",
    expectedReason: "TRANSFER_REQUIRED",
    expectedLineField: "storedLines[1].quantity",
    expectedMessagePattern: /transfer is required/i,
  });
  const transferRequiredLineErrors = Array.isArray(transferRequiredError.details?.lineErrors)
    ? transferRequiredError.details.lineErrors
    : [];
  assert(
    transferRequiredLineErrors.length === 1,
    "Transfer-required blocked post must report one blocked line"
  );
  assert(
    toPositiveInt(transferRequiredLineErrors[0]?.transferSourceWarehouseId) ===
      toPositiveInt(transferSourceWarehouse.id),
    "Transfer-required blocked post must suggest the other ownership-context warehouse"
  );
  assert(
    amountsEqual(transferRequiredLineErrors[0]?.crossContextAvailableQuantity, 6),
    "Transfer-required blocked post must expose cross-context availability quantity"
  );
}

async function runTransferRequiredQueueScenario({
  context,
  counterpartyId,
  accountIds,
  state,
}) {
  const itemCard = await createItemCard({
    payload: {
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      code: `CLI09TR${state.stamp.slice(-6)}`.slice(0, 80),
      name: `CLI09 Transfer Required Item ${state.stamp}`,
      itemType: "STOCK_ITEM",
      defaultSalesAccountId: accountIds.arOffsetAccountId,
      defaultPurchaseAccountId: accountIds.apOffsetAccountId,
      inventoryAssetAccountId: accountIds.inventoryAssetAccountId,
      defaultCogsAccountId: accountIds.cogsAccountId,
      taxCategoryCode: null,
      status: "ACTIVE",
    },
  });
  state.itemCardIds.push(toPositiveInt(itemCard.id));

  const transferOperatingUnitId = await createTempOperatingUnit({
    tenantId: context.tenantId,
    legalEntityId: context.legalEntityId,
    stamp: `${state.stamp}TR`,
    state,
  });
  const boundWarehouse = await createInventoryWarehouse({
    payload: {
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      code: `CLI09TB${state.stamp.slice(-5)}`.slice(0, 80),
      name: `CLI09 Transfer Bound Warehouse ${state.stamp}`,
      status: "ACTIVE",
      notes: "CLI09 transfer-required bound warehouse",
    },
  });
  state.warehouseIds.push(toPositiveInt(boundWarehouse.id));
  const sourceWarehouse = await createInventoryWarehouse({
    payload: {
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      ownershipScope: "OPERATING_UNIT",
      operatingUnitId: transferOperatingUnitId,
      code: `CLI09TS${state.stamp.slice(-5)}`.slice(0, 80),
      name: `CLI09 Transfer Source Queue Warehouse ${state.stamp}`,
      status: "ACTIVE",
      notes: "CLI09 transfer-required queue source warehouse",
    },
  });
  state.warehouseIds.push(toPositiveInt(sourceWarehouse.id));

  const boundReceiptDraft = await createCariDraftDocument({
    req: makeRequestContext({
      tenantId: context.tenantId,
      userId: context.userId,
      stamp: state.stamp,
      suffix: "transfer-queue-bound-receipt-create",
    }),
    payload: {
      tenantId: context.tenantId,
      userId: context.userId,
      legalEntityId: context.legalEntityId,
      counterpartyId,
      paymentTermId: null,
      direction: "AP",
      documentType: "INVOICE",
      documentDate: context.postingDate,
      dueDate: addDays(context.postingDate, 16),
      currencyCode: context.currencyCode,
      lines: [
        {
          description: "CLI09 transfer queue bound receipt",
          itemCardId: itemCard.id,
          warehouseId: boundWarehouse.id,
          quantity: 4,
          lineNetAmountTxn: 400,
          lineTaxAmountTxn: 0,
          lineGrossAmountTxn: 400,
        },
      ],
    },
    assertScopeAccess: allowAllScopes,
  });
  state.documentIds.push(boundReceiptDraft.id);
  const postedBoundReceipt = await postCariDocumentById({
    req: makeRequestContext({
      tenantId: context.tenantId,
      userId: context.userId,
      stamp: state.stamp,
      suffix: "transfer-queue-bound-receipt-post",
    }),
    payload: {
      tenantId: context.tenantId,
      userId: context.userId,
      documentId: boundReceiptDraft.id,
    },
    assertScopeAccess: allowAllScopes,
  });
  state.journalEntryIds.push(toPositiveInt(postedBoundReceipt.journal?.journalEntryId));

  const sourceReceiptDraft = await createCariDraftDocument({
    req: makeRequestContext({
      tenantId: context.tenantId,
      userId: context.userId,
      stamp: state.stamp,
      suffix: "transfer-queue-source-receipt-create",
    }),
    payload: {
      tenantId: context.tenantId,
      userId: context.userId,
      legalEntityId: context.legalEntityId,
      operatingUnitId: transferOperatingUnitId,
      counterpartyId,
      paymentTermId: null,
      direction: "AP",
      documentType: "INVOICE",
      documentDate: context.postingDate,
      dueDate: addDays(context.postingDate, 16),
      currencyCode: context.currencyCode,
      lines: [
        {
          description: "CLI09 transfer queue source receipt",
          itemCardId: itemCard.id,
          warehouseId: sourceWarehouse.id,
          quantity: 6,
          lineNetAmountTxn: 600,
          lineTaxAmountTxn: 0,
          lineGrossAmountTxn: 600,
        },
      ],
    },
    assertScopeAccess: allowAllScopes,
  });
  state.documentIds.push(sourceReceiptDraft.id);
  const postedSourceReceipt = await postCariDocumentById({
    req: makeRequestContext({
      tenantId: context.tenantId,
      userId: context.userId,
      stamp: state.stamp,
      suffix: "transfer-queue-source-receipt-post",
    }),
    payload: {
      tenantId: context.tenantId,
      userId: context.userId,
      documentId: sourceReceiptDraft.id,
    },
    assertScopeAccess: allowAllScopes,
  });
  state.journalEntryIds.push(toPositiveInt(postedSourceReceipt.journal?.journalEntryId));

  const postedReceiptLinks = await listPendingInventoryStockLinks({
    tenantId: context.tenantId,
    filters: {
      legalEntityId: context.legalEntityId,
      queueScope: "ACTIONABLE",
      limit: 200,
      offset: 0,
    },
  });
  const boundReceiptLink = (postedReceiptLinks.rows || []).find(
    (row) =>
      toPositiveInt(row.documentId) === toPositiveInt(boundReceiptDraft.id) &&
      String(row.stockImpactMode || "").toUpperCase() === "RECEIPT_PENDING"
  );
  const sourceReceiptLink = (postedReceiptLinks.rows || []).find(
    (row) =>
      toPositiveInt(row.documentId) === toPositiveInt(sourceReceiptDraft.id) &&
      String(row.stockImpactMode || "").toUpperCase() === "RECEIPT_PENDING"
  );
  assert(boundReceiptLink, "Transfer-required queue scenario must create a bound receipt link");
  assert(sourceReceiptLink, "Transfer-required queue scenario must create a source receipt link");
  state.stockLinkIds.push(toPositiveInt(boundReceiptLink.id));
  state.stockLinkIds.push(toPositiveInt(sourceReceiptLink.id));

  const boundReceiptMovement = await createInventoryMovementFromStockLink({
    payload: {
      tenantId: context.tenantId,
      userId: context.userId,
      legalEntityId: context.legalEntityId,
      warehouseId: boundWarehouse.id,
      stockLinkId: boundReceiptLink.id,
      movementDate: context.postingDate,
      note: `CLI09 transfer queue bound receipt materialization ${state.stamp}`,
    },
  });
  const sourceReceiptMovement = await createInventoryMovementFromStockLink({
    payload: {
      tenantId: context.tenantId,
      userId: context.userId,
      legalEntityId: context.legalEntityId,
      warehouseId: sourceWarehouse.id,
      stockLinkId: sourceReceiptLink.id,
      movementDate: context.postingDate,
      note: `CLI09 transfer queue source receipt materialization ${state.stamp}`,
    },
  });
  state.inventoryMovementIds.push(toPositiveInt(boundReceiptMovement.id));
  state.inventoryMovementIds.push(toPositiveInt(sourceReceiptMovement.id));

  const firstIssueDraft = await createCariDraftDocument({
    req: makeRequestContext({
      tenantId: context.tenantId,
      userId: context.userId,
      stamp: state.stamp,
      suffix: "transfer-queue-first-issue-create",
    }),
    payload: {
      tenantId: context.tenantId,
      userId: context.userId,
      legalEntityId: context.legalEntityId,
      counterpartyId,
      paymentTermId: null,
      direction: "AR",
      documentType: "INVOICE",
      documentDate: context.postingDate,
      dueDate: addDays(context.postingDate, 17),
      currencyCode: context.currencyCode,
      lines: [
        {
          description: "CLI09 transfer queue first issue",
          itemCardId: itemCard.id,
          warehouseId: boundWarehouse.id,
          quantity: 4,
          lineNetAmountTxn: 520,
          lineTaxAmountTxn: 0,
          lineGrossAmountTxn: 520,
        },
      ],
    },
    assertScopeAccess: allowAllScopes,
  });
  state.documentIds.push(firstIssueDraft.id);
  const postedFirstIssue = await postCariDocumentById({
    req: makeRequestContext({
      tenantId: context.tenantId,
      userId: context.userId,
      stamp: state.stamp,
      suffix: "transfer-queue-first-issue-post",
    }),
    payload: {
      tenantId: context.tenantId,
      userId: context.userId,
      documentId: firstIssueDraft.id,
    },
    assertScopeAccess: allowAllScopes,
  });
  state.journalEntryIds.push(toPositiveInt(postedFirstIssue.journal?.journalEntryId));

  const secondIssueDraft = await createCariDraftDocument({
    req: makeRequestContext({
      tenantId: context.tenantId,
      userId: context.userId,
      stamp: state.stamp,
      suffix: "transfer-queue-second-issue-create",
    }),
    payload: {
      tenantId: context.tenantId,
      userId: context.userId,
      legalEntityId: context.legalEntityId,
      counterpartyId,
      paymentTermId: null,
      direction: "AR",
      documentType: "INVOICE",
      documentDate: context.postingDate,
      dueDate: addDays(context.postingDate, 18),
      currencyCode: context.currencyCode,
      lines: [
        {
          description: "CLI09 transfer queue second issue",
          itemCardId: itemCard.id,
          warehouseId: boundWarehouse.id,
          quantity: 3,
          lineNetAmountTxn: 390,
          lineTaxAmountTxn: 0,
          lineGrossAmountTxn: 390,
        },
      ],
    },
    assertScopeAccess: allowAllScopes,
  });
  state.documentIds.push(secondIssueDraft.id);
  const postedSecondIssue = await postCariDocumentById({
    req: makeRequestContext({
      tenantId: context.tenantId,
      userId: context.userId,
      stamp: state.stamp,
      suffix: "transfer-queue-second-issue-post",
    }),
    payload: {
      tenantId: context.tenantId,
      userId: context.userId,
      documentId: secondIssueDraft.id,
    },
    assertScopeAccess: allowAllScopes,
  });
  state.journalEntryIds.push(toPositiveInt(postedSecondIssue.journal?.journalEntryId));

  const pendingIssueLinks = await listPendingInventoryStockLinks({
    tenantId: context.tenantId,
    filters: {
      legalEntityId: context.legalEntityId,
      queueScope: "ACTIONABLE",
      stockImpactMode: "ISSUE_PENDING",
      limit: 200,
      offset: 0,
    },
  });
  const firstIssueLink = (pendingIssueLinks.rows || []).find(
    (row) => toPositiveInt(row.documentId) === toPositiveInt(firstIssueDraft.id)
  );
  const secondIssueLink = (pendingIssueLinks.rows || []).find(
    (row) => toPositiveInt(row.documentId) === toPositiveInt(secondIssueDraft.id)
  );
  assert(firstIssueLink, "Transfer-required queue scenario must create the first issue link");
  assert(secondIssueLink, "Transfer-required queue scenario must create the second issue link");
  state.stockLinkIds.push(toPositiveInt(firstIssueLink.id));
  state.stockLinkIds.push(toPositiveInt(secondIssueLink.id));

  const firstIssueMovement = await createInventoryMovementFromStockLink({
    payload: {
      tenantId: context.tenantId,
      userId: context.userId,
      legalEntityId: context.legalEntityId,
      warehouseId: boundWarehouse.id,
      stockLinkId: firstIssueLink.id,
      movementDate: context.postingDate,
      note: `CLI09 transfer queue first issue materialization ${state.stamp}`,
    },
  });
  state.inventoryMovementIds.push(toPositiveInt(firstIssueMovement.id));
  if (toPositiveInt(firstIssueMovement.postedJournalEntryId)) {
    state.journalEntryIds.push(toPositiveInt(firstIssueMovement.postedJournalEntryId));
  }

  const actionableQueueAfterConsumption = await listPendingInventoryStockLinks({
    tenantId: context.tenantId,
    filters: {
      legalEntityId: context.legalEntityId,
      queueScope: "ACTIONABLE",
      stockImpactMode: "ISSUE_PENDING",
      limit: 200,
      offset: 0,
    },
  });
  const transferRequiredRow = (actionableQueueAfterConsumption.rows || []).find(
    (row) => toPositiveInt(row.id) === toPositiveInt(secondIssueLink.id)
  );
  assert(transferRequiredRow, "Consumed queue must still expose the second pending issue row");
  assertQueueReadModelFields(transferRequiredRow, "Transfer-required queue row");
  assert(
    String(transferRequiredRow.queueState || "").toUpperCase() === "TRANSFER_REQUIRED",
    "Queue must derive TRANSFER_REQUIRED when another ownership context has stock"
  );
  assert(
    transferRequiredRow.canMaterialize === false &&
      !String(transferRequiredRow.blockedReasonCode || "").trim(),
    "TRANSFER_REQUIRED rows must not materialize and must not duplicate the queue state in blockedReasonCode"
  );
  assert(
    toPositiveInt(transferRequiredRow.transferSourceWarehouseId) ===
      toPositiveInt(sourceWarehouse.id),
    "TRANSFER_REQUIRED queue rows must expose the suggested source warehouse"
  );
  assert(
    amountsEqual(transferRequiredRow.boundAvailableQuantity, 0) &&
      amountsEqual(transferRequiredRow.crossContextAvailableQuantity, 6),
    "TRANSFER_REQUIRED queue rows must expose bound and cross-context availability quantities"
  );

  const transferQueueSummary = await getInventoryWorkQueueSummary({
    tenantId: context.tenantId,
    filters: {
      legalEntityId: context.legalEntityId,
    },
  });
  assert(
    toNumber(transferQueueSummary?.stockLinks?.transfer_required_total) >= 1,
    "Inventory work-queue summary must count transfer-required rows"
  );

  let transferRequiredMaterializeError = null;
  try {
    await materializeInventoryMovementFromCariStockLink({
      payload: {
        tenantId: context.tenantId,
        userId: context.userId,
        legalEntityId: context.legalEntityId,
        stockLinkId: secondIssueLink.id,
        movementDate: context.postingDate,
        note: `CLI09 transfer queue blocked materialization ${state.stamp}`,
      },
    });
  } catch (error) {
    transferRequiredMaterializeError = error;
  }
  assert(
    transferRequiredMaterializeError,
    "Strict materialization must block when transfer is required"
  );
  assert(
    String(transferRequiredMaterializeError.code || "").trim().toUpperCase() ===
      "TRANSFER_REQUIRED",
    "Strict materialization must surface TRANSFER_REQUIRED when another ownership context has stock"
  );
  assert(
    toPositiveInt(transferRequiredMaterializeError.details?.transferSourceWarehouseId) ===
      toPositiveInt(sourceWarehouse.id),
    "Strict materialization transfer-required error must suggest the source warehouse"
  );
}

async function runDraftWarehouseOwnershipValidationScenario({
  context,
  counterpartyId,
  accountIds,
  state,
}) {
  const itemCard = await createItemCard({
    payload: {
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      code: `CLI09OUV${state.stamp.slice(-6)}`.slice(0, 80),
      name: `CLI09 Ownership Validation Item ${state.stamp}`,
      itemType: "STOCK_ITEM",
      defaultSalesAccountId: accountIds.arOffsetAccountId,
      defaultPurchaseAccountId: accountIds.apOffsetAccountId,
      inventoryAssetAccountId: accountIds.inventoryAssetAccountId,
      defaultCogsAccountId: accountIds.cogsAccountId,
      taxCategoryCode: null,
      status: "ACTIVE",
    },
  });
  state.itemCardIds.push(toPositiveInt(itemCard.id));

  const operatingUnitId = await createTempOperatingUnit({
    tenantId: context.tenantId,
    legalEntityId: context.legalEntityId,
    stamp: state.stamp,
    state,
  });

  const foreignContextWarehouse = await createInventoryWarehouse({
    payload: {
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      ownershipScope: "OPERATING_UNIT",
      operatingUnitId,
      code: `CLI09OW${state.stamp.slice(-5)}`.slice(0, 80),
      name: `CLI09 Cross-context Warehouse ${state.stamp}`,
      status: "ACTIVE",
      notes: "CLI09 draft ownership-context validation",
    },
  });
  state.warehouseIds.push(toPositiveInt(foreignContextWarehouse.id));

  await expectDraftCreateBlocked({
    context,
    stamp: state.stamp,
    suffix: "draft-cross-context-create",
    expectedMessagePattern: /Warehouse does not belong to ownership context CENTRAL/i,
    payload: {
      tenantId: context.tenantId,
      userId: context.userId,
      legalEntityId: context.legalEntityId,
      counterpartyId,
      paymentTermId: null,
      direction: "AR",
      documentType: "INVOICE",
      documentDate: context.postingDate,
      dueDate: addDays(context.postingDate, 9),
      currencyCode: context.currencyCode,
      lines: [
        {
          description: "CLI09 cross-context draft save block",
          itemCardId: itemCard.id,
          warehouseId: foreignContextWarehouse.id,
          quantity: 1,
          lineNetAmountTxn: 90,
          lineTaxAmountTxn: 0,
          lineGrossAmountTxn: 90,
        },
      ],
    },
  });
}

async function runItemCardAndInventoryScenario({
  context,
  counterpartyId,
  accountIds,
  state,
}) {
  const itemCard = await createItemCard({
    payload: {
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      code: `CLI09ITM${state.stamp.slice(-6)}`.slice(0, 80),
      name: `CLI09 Stock Item ${state.stamp}`,
      itemType: "STOCK_ITEM",
      defaultSalesAccountId: accountIds.arOffsetAccountId,
      defaultPurchaseAccountId: accountIds.apOffsetAccountId,
      inventoryAssetAccountId: accountIds.inventoryAssetAccountId,
      defaultCogsAccountId: accountIds.cogsAccountId,
      taxCategoryCode: null,
      status: "ACTIVE",
    },
  });
  state.itemCardIds.push(toPositiveInt(itemCard.id));

  const warehouse = await createInventoryWarehouse({
    payload: {
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      code: `CLI09WH${state.stamp.slice(-6)}`.slice(0, 80),
      name: `CLI09 Warehouse ${state.stamp}`,
      status: "ACTIVE",
      notes: "CLI09 temp warehouse",
    },
  });
  state.warehouseIds.push(toPositiveInt(warehouse.id));

  const apDraft = await createCariDraftDocument({
    req: makeRequestContext({
      tenantId: context.tenantId,
      userId: context.userId,
      stamp: state.stamp,
      suffix: "item-ap-create",
    }),
    payload: {
      tenantId: context.tenantId,
      userId: context.userId,
      legalEntityId: context.legalEntityId,
      counterpartyId,
      paymentTermId: null,
      direction: "AP",
      documentType: "INVOICE",
      documentDate: context.postingDate,
      dueDate: addDays(context.postingDate, 10),
      currencyCode: context.currencyCode,
      lines: [
        {
          description: "CLI09 AP stock purchase",
          itemCardId: itemCard.id,
          warehouseId: warehouse.id,
          quantity: 10,
          lineNetAmountTxn: 500,
          lineTaxAmountTxn: 0,
          lineGrossAmountTxn: 500,
        },
      ],
    },
    assertScopeAccess: allowAllScopes,
  });
  state.documentIds.push(apDraft.id);
  assert(
    toPositiveInt(apDraft.lines?.[0]?.postingAccountId) === accountIds.inventoryAssetAccountId,
    "AP stock draft must default postingAccountId to inventory asset account"
  );
  assert(
    String(apDraft.lines?.[0]?.stockImpactMode || "").toUpperCase() === "RECEIPT_PENDING",
    "AP stock draft must default stockImpactMode to RECEIPT_PENDING"
  );

  const postedAp = await postCariDocumentById({
    req: makeRequestContext({
      tenantId: context.tenantId,
      userId: context.userId,
      stamp: state.stamp,
      suffix: "item-ap-post",
    }),
    payload: {
      tenantId: context.tenantId,
      userId: context.userId,
      documentId: apDraft.id,
    },
    assertScopeAccess: allowAllScopes,
  });
  state.journalEntryIds.push(toPositiveInt(postedAp.journal?.journalEntryId));

  const apJournalLines = await queryJournalLines(postedAp.journal.journalEntryId);
  assert(
    apJournalLines.some((row) => toPositiveInt(row.account_id) === accountIds.inventoryAssetAccountId),
    "Posted AP stock invoice must debit the inventory asset account"
  );
  assert(
    apJournalLines.some((row) => toPositiveInt(row.account_id) === accountIds.apControlAccountId),
    "Posted AP stock invoice must credit the AP control account"
  );

  const pendingLinks = await listPendingInventoryStockLinks({
    tenantId: context.tenantId,
    filters: {
      legalEntityId: context.legalEntityId,
      queueScope: "ACTIONABLE",
      limit: 200,
      offset: 0,
    },
  });
  const receiptLink = (pendingLinks.rows || []).find(
    (row) =>
      toPositiveInt(row.documentId) === toPositiveInt(apDraft.id) &&
      String(row.stockImpactMode || "").toUpperCase() === "RECEIPT_PENDING"
  );
  assert(receiptLink, "Posted AP stock invoice must create one pending receipt stock link");
  assert(
    toPositiveInt(receiptLink.boundWarehouseId) === toPositiveInt(warehouse.id),
    "Posted AP stock invoice must propagate the selected warehouse onto the pending receipt stock link"
  );
  assertQueueReadModelFields(receiptLink, "Receipt queue row");
  assert(
    String(receiptLink.queueState || "").toUpperCase() === "READY" &&
      receiptLink.canMaterialize === true &&
      receiptLink.isStrictMode === true &&
      receiptLink.isRepairOnly === false &&
      receiptLink.isLegacyRow === false,
    "New strict-mode receipt queue rows must surface READY/canMaterialize/isStrictMode flags"
  );
  state.stockLinkIds.push(toPositiveInt(receiptLink.id));

  await expectLegacyStrictMaterializationBlocked({
    tenantId: context.tenantId,
    userId: context.userId,
    legalEntityId: context.legalEntityId,
    warehouseId: warehouse.id,
    stockLinkId: receiptLink.id,
    movementDate: context.postingDate,
    note: `CLI09 legacy receipt materialization blocked ${state.stamp}`,
  });

  const receiptMovement = await createInventoryMovementFromStockLink({
    payload: {
      tenantId: context.tenantId,
      userId: context.userId,
      legalEntityId: context.legalEntityId,
      warehouseId: warehouse.id,
      sourceStockLinkId: receiptLink.id,
      movementDate: context.postingDate,
      note: `CLI09 receipt materialization ${state.stamp}`,
    },
  });
  state.inventoryMovementIds.push(toPositiveInt(receiptMovement.id));
  assert(
    String(receiptMovement.valuationStatus || "").toUpperCase() === "VALUED",
    "Receipt movement must be VALUED on materialization"
  );
  const completedReceiptLinks = await listPendingInventoryStockLinks({
    tenantId: context.tenantId,
    filters: {
      legalEntityId: context.legalEntityId,
      queueScope: "COMPLETED",
      limit: 200,
      offset: 0,
    },
  });
  const completedReceiptLink = (completedReceiptLinks.rows || []).find(
    (row) => toPositiveInt(row.id) === toPositiveInt(receiptLink.id)
  );
  assert(
    completedReceiptLink &&
      String(completedReceiptLink.queueState || "").toUpperCase() === "COMPLETED" &&
      completedReceiptLink.canMaterialize === false,
    "Completed queue scope must expose linked stock links as COMPLETED history rows"
  );

  const arDraft = await createCariDraftDocument({
    req: makeRequestContext({
      tenantId: context.tenantId,
      userId: context.userId,
      stamp: state.stamp,
      suffix: "item-ar-create",
    }),
    payload: {
      tenantId: context.tenantId,
      userId: context.userId,
      legalEntityId: context.legalEntityId,
      counterpartyId,
      paymentTermId: null,
      direction: "AR",
      documentType: "INVOICE",
      documentDate: context.postingDate,
      dueDate: addDays(context.postingDate, 12),
      currencyCode: context.currencyCode,
      lines: [
        {
          description: "CLI09 AR stock sale",
          itemCardId: itemCard.id,
          warehouseId: warehouse.id,
          quantity: 5,
          lineNetAmountTxn: 700,
          lineTaxAmountTxn: 0,
          lineGrossAmountTxn: 700,
        },
      ],
    },
    assertScopeAccess: allowAllScopes,
  });
  state.documentIds.push(arDraft.id);
  assert(
    toPositiveInt(arDraft.lines?.[0]?.postingAccountId) === accountIds.arOffsetAccountId,
    "AR stock draft must default postingAccountId to sales account"
  );
  assert(
    String(arDraft.lines?.[0]?.stockImpactMode || "").toUpperCase() === "ISSUE_PENDING",
    "AR stock draft must default stockImpactMode to ISSUE_PENDING"
  );

  const postedAr = await postCariDocumentById({
    req: makeRequestContext({
      tenantId: context.tenantId,
      userId: context.userId,
      stamp: state.stamp,
      suffix: "item-ar-post",
    }),
    payload: {
      tenantId: context.tenantId,
      userId: context.userId,
      documentId: arDraft.id,
    },
    assertScopeAccess: allowAllScopes,
  });
  state.journalEntryIds.push(toPositiveInt(postedAr.journal?.journalEntryId));

  const arJournalLines = await queryJournalLines(postedAr.journal.journalEntryId);
  assert(
    arJournalLines.some((row) => toPositiveInt(row.account_id) === accountIds.arOffsetAccountId),
    "Posted AR stock invoice must credit the revenue account"
  );
  assert(
    arJournalLines.some((row) => toPositiveInt(row.account_id) === accountIds.arControlAccountId),
    "Posted AR stock invoice must debit the AR control account"
  );

  const pendingIssueLinks = await listPendingInventoryStockLinks({
    tenantId: context.tenantId,
    filters: {
      legalEntityId: context.legalEntityId,
      queueScope: "ACTIONABLE",
      limit: 200,
      offset: 0,
    },
  });
  const issueLink = (pendingIssueLinks.rows || []).find(
    (row) =>
      toPositiveInt(row.documentId) === toPositiveInt(arDraft.id) &&
      String(row.stockImpactMode || "").toUpperCase() === "ISSUE_PENDING"
  );
  assert(issueLink, "Posted AR stock invoice must create one pending issue stock link");
  assert(
    toPositiveInt(issueLink.boundWarehouseId) === toPositiveInt(warehouse.id),
    "Posted AR stock invoice must propagate the selected warehouse onto the pending issue stock link"
  );
  assertQueueReadModelFields(issueLink, "Issue queue row");
  state.stockLinkIds.push(toPositiveInt(issueLink.id));

  const issueMovement = await createInventoryMovementFromStockLink({
    payload: {
      tenantId: context.tenantId,
      userId: context.userId,
      legalEntityId: context.legalEntityId,
      warehouseId: warehouse.id,
      sourceStockLinkId: issueLink.id,
      movementDate: context.postingDate,
      note: `CLI09 issue materialization ${state.stamp}`,
    },
  });
  state.inventoryMovementIds.push(toPositiveInt(issueMovement.id));
  if (toPositiveInt(issueMovement.postedJournalEntryId)) {
    state.journalEntryIds.push(toPositiveInt(issueMovement.postedJournalEntryId));
  }
  assert(
    String(issueMovement.valuationStatus || "").toUpperCase() === "VALUED",
    "Issue movement must be VALUED once FIFO layer costing succeeds"
  );
  assert(
    amountsEqual(issueMovement.totalCostTxn, 250) &&
      amountsEqual(issueMovement.totalCostBase, 250),
    "Issue movement must carry the consumed FIFO total cost"
  );
  assert(
    toPositiveInt(issueMovement.postedJournalEntryId) > 0,
    "Issue movement must link to a posted inventory COGS journal"
  );
  const workQueueSummary = await getInventoryWorkQueueSummary({
    tenantId: context.tenantId,
    filters: {
      legalEntityId: context.legalEntityId,
    },
  });
  assert(
    Number.isInteger(workQueueSummary?.stockLinks?.completed_total) &&
      Number.isInteger(workQueueSummary?.stockLinks?.ready_total) &&
      Number.isInteger(workQueueSummary?.stockLinks?.void_total),
    "Inventory work-queue summary must expose completed/ready/void queue-state counts"
  );

  const issueJournalLines = await queryJournalLines(issueMovement.postedJournalEntryId);
  assert(issueJournalLines.length === 2, "Issue COGS journal must contain exactly two lines");
  assert(
    issueJournalLines.some(
      (row) =>
        toPositiveInt(row.account_id) === accountIds.cogsAccountId &&
        amountsEqual(row.debit_base, 250)
    ),
    "Issue COGS journal must debit the item card COGS account"
  );
  assert(
    issueJournalLines.some(
      (row) =>
        toPositiveInt(row.account_id) === accountIds.inventoryAssetAccountId &&
        amountsEqual(row.credit_base, 250)
    ),
    "Issue COGS journal must credit the inventory asset account"
  );

  const costLayers = await listInventoryCostLayers({
    tenantId: context.tenantId,
    filters: {
      legalEntityId: context.legalEntityId,
      itemCardId: itemCard.id,
      limit: 50,
      offset: 0,
    },
  });
  const relevantCostLayer = (costLayers.rows || []).find(
    (row) => toPositiveInt(row.sourceMovementId) === toPositiveInt(receiptMovement.id)
  );
  assert(relevantCostLayer, "Receipt materialization must create a cost layer");
  state.inventoryCostLayerIds.push(toPositiveInt(relevantCostLayer.id));
  assert(
    String(relevantCostLayer.layerStatus || "").toUpperCase() === "OPEN",
    "Partially consumed receipt cost layer must stay OPEN"
  );
  assert(
    amountsEqual(relevantCostLayer.quantityRemaining, 5),
    "Receipt cost layer remaining quantity must decrease by the issued quantity"
  );

  const issueConsumptions = await queryIssueLayerConsumptions(issueMovement.id);
  assert(issueConsumptions.length === 1, "Issue movement must persist one FIFO layer consumption row");
  assert(
    toPositiveInt(issueConsumptions[0]?.cost_layer_id) === toPositiveInt(relevantCostLayer.id),
    "Issue movement must consume the receipt cost layer it was valued from"
  );
  assert(
    amountsEqual(issueConsumptions[0]?.quantity_consumed, 5) &&
      amountsEqual(issueConsumptions[0]?.total_cost_txn, 250),
    "Issue layer consumption must capture consumed quantity and total cost"
  );

  const linkedResult = await query(
    `SELECT id, link_status, inventory_movement_id
       FROM cari_document_line_stock_links
      WHERE id IN (?, ?)
      ORDER BY id ASC`,
    [receiptLink.id, issueLink.id]
  );
  assert(
    (linkedResult.rows || []).every(
      (row) =>
        String(row.link_status || "").toUpperCase() === "LINKED" &&
        toPositiveInt(row.inventory_movement_id) > 0
    ),
    "Materialized stock links must transition to LINKED with inventory movement ids"
  );

  await expectCariReverseBlockedByInventory({
    context,
    documentId: arDraft.id,
    expectedMovementType: "ISSUE",
    expectedMovementId: issueMovement.id,
    expectedActionCode: "REVERSE_INVENTORY_ISSUE_FIRST",
  });
  await expectCariReverseBlockedByInventory({
    context,
    documentId: apDraft.id,
    expectedMovementType: "RECEIPT",
    expectedMovementId: receiptMovement.id,
    expectedActionCode: "UNDO_RECEIPT_MATERIALIZATION_FIRST",
  });

  let blockedReceiptUndoError = null;
  try {
    await reverseInventoryMovementById({
      payload: {
        tenantId: context.tenantId,
        userId: context.userId,
        movementId: receiptMovement.id,
        reversalDate: context.postingDate,
        reason: `CLI09 receipt undo blocked while consumed ${state.stamp}`,
      },
    });
  } catch (error) {
    blockedReceiptUndoError = error;
  }
  assert(
    blockedReceiptUndoError,
    "Partially consumed receipt undo must fail while later issue consumption is still active"
  );
  assert(
    /consumed by later issue movements/i.test(String(blockedReceiptUndoError?.message || "")),
    "Partially consumed receipt undo must explain dependent later issue consumption"
  );

  const issueReplay = await createInventoryMovementFromStockLink({
    payload: {
      tenantId: context.tenantId,
      userId: context.userId,
      legalEntityId: context.legalEntityId,
      warehouseId: warehouse.id,
      sourceStockLinkId: issueLink.id,
      movementDate: context.postingDate,
      note: `CLI09 issue materialization replay ${state.stamp}`,
    },
  });
  assert(
    toPositiveInt(issueReplay.id) === toPositiveInt(issueMovement.id),
    "Replaying the same issue materialization must reuse the existing movement"
  );
  assert(
    toPositiveInt(issueReplay.postedJournalEntryId) === toPositiveInt(issueMovement.postedJournalEntryId),
    "Replaying the same issue materialization must reuse the existing COGS journal"
  );

  const reversalDate = context.postingDate;
  const reversedIssue = await reverseInventoryMovementById({
    payload: {
      tenantId: context.tenantId,
      userId: context.userId,
      movementId: issueMovement.id,
      reversalDate,
      reason: `CLI09 issue reverse ${state.stamp}`,
    },
  });
  if (toPositiveInt(reversedIssue.reversalJournalEntryId)) {
    state.journalEntryIds.push(toPositiveInt(reversedIssue.reversalJournalEntryId));
  }
  assert(
    toPositiveInt(reversedIssue.id) === toPositiveInt(issueMovement.id),
    "Issue reversal must return the original issue movement"
  );
  assert(
    toPositiveInt(reversedIssue.reversalJournalEntryId) > 0,
    "Reversed issue must persist a reversal journal id"
  );
  assert(
    String(reversedIssue.reversedAt || "").trim(),
    "Reversed issue must stamp reversedAt"
  );

  const originalJournalSummary = await queryJournalSummary(issueMovement.postedJournalEntryId);
  assert(originalJournalSummary, "Original issue journal must still exist after reversal");
  assert(
    String(originalJournalSummary.status || "").toUpperCase() === "REVERSED",
    "Original issue journal must transition to REVERSED"
  );
  assert(
    toPositiveInt(originalJournalSummary.reversal_journal_entry_id) ===
      toPositiveInt(reversedIssue.reversalJournalEntryId),
    "Original issue journal must link to the generated reversal journal"
  );
  assert(
    String(originalJournalSummary.reversed_at || "").trim(),
    "Original issue journal must stamp reversed_at"
  );

  const reversalJournalLines = await queryJournalLines(reversedIssue.reversalJournalEntryId);
  assert(reversalJournalLines.length === 2, "Issue reversal journal must contain exactly two lines");
  assert(
    reversalJournalLines.some(
      (row) =>
        toPositiveInt(row.account_id) === accountIds.inventoryAssetAccountId &&
        amountsEqual(row.debit_base, 250)
    ),
    "Issue reversal journal must debit the inventory asset account"
  );
  assert(
    reversalJournalLines.some(
      (row) =>
        toPositiveInt(row.account_id) === accountIds.cogsAccountId &&
        amountsEqual(row.credit_base, 250)
    ),
    "Issue reversal journal must credit the item card COGS account"
  );

  const restoredCostLayers = await listInventoryCostLayers({
    tenantId: context.tenantId,
    filters: {
      legalEntityId: context.legalEntityId,
      itemCardId: itemCard.id,
      limit: 50,
      offset: 0,
    },
  });
  const restoredCostLayer = (restoredCostLayers.rows || []).find(
    (row) => toPositiveInt(row.sourceMovementId) === toPositiveInt(receiptMovement.id)
  );
  assert(restoredCostLayer, "Reversed issue must still leave the original receipt cost layer visible");
  assert(
    String(restoredCostLayer.layerStatus || "").toUpperCase() === "OPEN",
    "Reversed issue must reopen the consumed receipt cost layer"
  );
  assert(
    amountsEqual(restoredCostLayer.quantityRemaining, 10),
    "Reversed issue must restore the receipt layer quantity to its pre-issue balance"
  );

  const issueLinksAfterReverse = await queryStockLinksForDocumentLine({
    tenantId: context.tenantId,
    legalEntityId: context.legalEntityId,
    documentId: arDraft.id,
    documentLineId: issueLink.documentLineId,
    stockImpactMode: "ISSUE_PENDING",
  });
  const originalIssueLinkAfterReverse = issueLinksAfterReverse.find(
    (row) => toPositiveInt(row.id) === toPositiveInt(issueLink.id)
  );
  const reopenedSuccessorLink = issueLinksAfterReverse.find(
    (row) => toPositiveInt(row.reopened_from_stock_link_id) === toPositiveInt(issueLink.id)
  );
  assert(
    originalIssueLinkAfterReverse,
    "Original issue stock link must stay queryable after reversal"
  );
  assert(
    reopenedSuccessorLink,
    "Issue reversal must create one reopened successor stock link"
  );
  assert(
    String(reopenedSuccessorLink.link_status || "").toUpperCase() === "PENDING",
    "Reopened successor stock link must start in PENDING state"
  );
  assert(
    !toPositiveInt(reopenedSuccessorLink.inventory_movement_id),
    "Reopened successor stock link must not carry an inventory movement before rematerialization"
  );
  assert(
    toPositiveInt(originalIssueLinkAfterReverse.superseded_by_stock_link_id) ===
      toPositiveInt(reopenedSuccessorLink.id),
    "Original issue stock link must reference its reopened successor"
  );
  assert(
    issueLinksAfterReverse.filter(
      (row) => toPositiveInt(row.reopened_from_stock_link_id) === toPositiveInt(issueLink.id)
    ).length === 1,
    "Issue reversal must create exactly one reopened successor stock link"
  );
  assert(
    toPositiveInt(reopenedSuccessorLink.warehouse_id) === toPositiveInt(warehouse.id),
    "Valid reopened successor stock links must inherit the original bound warehouse"
  );
  state.stockLinkIds.push(toPositiveInt(reopenedSuccessorLink.id));

  const reversalReplay = await reverseInventoryMovementById({
    payload: {
      tenantId: context.tenantId,
      userId: context.userId,
      movementId: issueMovement.id,
      reversalDate,
      reason: `CLI09 issue reverse replay ${state.stamp}`,
    },
  });
  assert(
    toPositiveInt(reversalReplay.id) === toPositiveInt(issueMovement.id),
    "Replaying the same issue reversal must reuse the original movement row"
  );
  assert(
    toPositiveInt(reversalReplay.reversalJournalEntryId) ===
      toPositiveInt(reversedIssue.reversalJournalEntryId),
    "Replaying the same issue reversal must reuse the original reversal journal"
  );

  const issueLinksAfterReplay = await queryStockLinksForDocumentLine({
    tenantId: context.tenantId,
    legalEntityId: context.legalEntityId,
    documentId: arDraft.id,
    documentLineId: issueLink.documentLineId,
    stockImpactMode: "ISSUE_PENDING",
  });
  const reopenedLinksAfterReplay = issueLinksAfterReplay.filter(
    (row) => toPositiveInt(row.reopened_from_stock_link_id) === toPositiveInt(issueLink.id)
  );
  assert(
    reopenedLinksAfterReplay.length === 1,
    "Replaying issue reversal must not create duplicate reopened successor stock links"
  );
  assert(
    toPositiveInt(reopenedLinksAfterReplay[0]?.id) === toPositiveInt(reopenedSuccessorLink.id),
    "Replaying issue reversal must reuse the original reopened successor stock link"
  );

  const rematerializedIssue = await createInventoryMovementFromStockLink({
    payload: {
      tenantId: context.tenantId,
      userId: context.userId,
      legalEntityId: context.legalEntityId,
      warehouseId: warehouse.id,
      sourceStockLinkId: reopenedSuccessorLink.id,
      movementDate: context.postingDate,
      note: `CLI09 rematerialized issue ${state.stamp}`,
    },
  });
  state.inventoryMovementIds.push(toPositiveInt(rematerializedIssue.id));
  if (toPositiveInt(rematerializedIssue.postedJournalEntryId)) {
    state.journalEntryIds.push(toPositiveInt(rematerializedIssue.postedJournalEntryId));
  }
  assert(
    toPositiveInt(rematerializedIssue.id) > 0 &&
      toPositiveInt(rematerializedIssue.id) !== toPositiveInt(issueMovement.id),
    "Rematerialized issue must create a new inventory movement"
  );
  assert(
    toPositiveInt(rematerializedIssue.sourceStockLinkId) ===
      toPositiveInt(reopenedSuccessorLink.id),
    "Rematerialized issue must use the reopened successor stock link"
  );
  assert(
    String(rematerializedIssue.movementType || "").toUpperCase() === "ISSUE" &&
      String(rematerializedIssue.valuationStatus || "").toUpperCase() === "VALUED",
    "Rematerialized successor issue must be a VALUED ISSUE movement"
  );
  assert(
    toPositiveInt(rematerializedIssue.postedJournalEntryId) > 0,
    "Rematerialized successor issue must post a new COGS journal"
  );
  assert(
    toPositiveInt(rematerializedIssue.postedJournalEntryId) !==
      toPositiveInt(issueMovement.postedJournalEntryId),
    "Rematerialized successor issue must create a new journal, not reuse the reversed one"
  );

  const rematerializedIssueReplay = await createInventoryMovementFromStockLink({
    payload: {
      tenantId: context.tenantId,
      userId: context.userId,
      legalEntityId: context.legalEntityId,
      warehouseId: warehouse.id,
      sourceStockLinkId: reopenedSuccessorLink.id,
      movementDate: context.postingDate,
      note: `CLI09 rematerialized issue replay ${state.stamp}`,
    },
  });
  assert(
    toPositiveInt(rematerializedIssueReplay.id) === toPositiveInt(rematerializedIssue.id),
    "Replaying successor rematerialization must reuse the new successor movement"
  );
  assert(
    toPositiveInt(rematerializedIssueReplay.postedJournalEntryId) ===
      toPositiveInt(rematerializedIssue.postedJournalEntryId),
    "Replaying successor rematerialization must reuse the new successor journal"
  );

  const issueLinksAfterRematerialization = await queryStockLinksForDocumentLine({
    tenantId: context.tenantId,
    legalEntityId: context.legalEntityId,
    documentId: arDraft.id,
    documentLineId: issueLink.documentLineId,
    stockImpactMode: "ISSUE_PENDING",
  });
  const reopenedSuccessorAfterMaterialization = issueLinksAfterRematerialization.find(
    (row) => toPositiveInt(row.id) === toPositiveInt(reopenedSuccessorLink.id)
  );
  assert(
    reopenedSuccessorAfterMaterialization &&
      String(reopenedSuccessorAfterMaterialization.link_status || "").toUpperCase() ===
        "LINKED",
    "Rematerialized successor stock link must transition to LINKED"
  );
  assert(
    toPositiveInt(reopenedSuccessorAfterMaterialization.inventory_movement_id) ===
      toPositiveInt(rematerializedIssue.id),
    "Rematerialized successor stock link must point to the new inventory movement"
  );
}

async function runSuccessorRepairFallbackScenario({
  context,
  counterpartyId,
  accountIds,
  state,
}) {
  const itemCard = await createItemCard({
    payload: {
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      code: `CLI09SR${state.stamp.slice(-6)}`.slice(0, 80),
      name: `CLI09 Successor Repair Item ${state.stamp}`,
      itemType: "STOCK_ITEM",
      defaultSalesAccountId: accountIds.arOffsetAccountId,
      defaultPurchaseAccountId: accountIds.apOffsetAccountId,
      inventoryAssetAccountId: accountIds.inventoryAssetAccountId,
      defaultCogsAccountId: accountIds.cogsAccountId,
      taxCategoryCode: null,
      status: "ACTIVE",
    },
  });
  state.itemCardIds.push(toPositiveInt(itemCard.id));

  const warehouse = await createInventoryWarehouse({
    payload: {
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      code: `CLI09SRW${state.stamp.slice(-5)}`.slice(0, 80),
      name: `CLI09 Successor Repair Warehouse ${state.stamp}`,
      status: "ACTIVE",
      notes: "CLI09 successor repair warehouse",
    },
  });
  state.warehouseIds.push(toPositiveInt(warehouse.id));

  const receiptDraft = await createCariDraftDocument({
    req: makeRequestContext({
      tenantId: context.tenantId,
      userId: context.userId,
      stamp: state.stamp,
      suffix: "successor-repair-receipt-create",
    }),
    payload: {
      tenantId: context.tenantId,
      userId: context.userId,
      legalEntityId: context.legalEntityId,
      counterpartyId,
      paymentTermId: null,
      direction: "AP",
      documentType: "INVOICE",
      documentDate: context.postingDate,
      dueDate: addDays(context.postingDate, 7),
      currencyCode: context.currencyCode,
      lines: [
        {
          description: "CLI09 successor repair receipt",
          itemCardId: itemCard.id,
          warehouseId: warehouse.id,
          quantity: 4,
          lineNetAmountTxn: 160,
          lineTaxAmountTxn: 0,
          lineGrossAmountTxn: 160,
        },
      ],
    },
    assertScopeAccess: allowAllScopes,
  });
  state.documentIds.push(receiptDraft.id);

  const postedReceipt = await postCariDocumentById({
    req: makeRequestContext({
      tenantId: context.tenantId,
      userId: context.userId,
      stamp: state.stamp,
      suffix: "successor-repair-receipt-post",
    }),
    payload: {
      tenantId: context.tenantId,
      userId: context.userId,
      documentId: receiptDraft.id,
    },
    assertScopeAccess: allowAllScopes,
  });
  state.journalEntryIds.push(toPositiveInt(postedReceipt.journal?.journalEntryId));

  const receiptLinks = await listPendingInventoryStockLinks({
    tenantId: context.tenantId,
    filters: {
      legalEntityId: context.legalEntityId,
      linkStatus: "PENDING",
      limit: 200,
      offset: 0,
    },
  });
  const receiptLink = (receiptLinks.rows || []).find(
    (row) =>
      toPositiveInt(row.documentId) === toPositiveInt(receiptDraft.id) &&
      String(row.stockImpactMode || "").toUpperCase() === "RECEIPT_PENDING"
  );
  assert(receiptLink, "Successor repair scenario must create one pending receipt stock link");
  state.stockLinkIds.push(toPositiveInt(receiptLink.id));

  const receiptMovement = await createInventoryMovementFromStockLink({
    payload: {
      tenantId: context.tenantId,
      userId: context.userId,
      legalEntityId: context.legalEntityId,
      warehouseId: warehouse.id,
      sourceStockLinkId: receiptLink.id,
      movementDate: context.postingDate,
      note: `CLI09 successor repair receipt materialization ${state.stamp}`,
    },
  });
  state.inventoryMovementIds.push(toPositiveInt(receiptMovement.id));
  const receiptCostLayer = await queryReceiptCostLayerBySourceMovementId(receiptMovement.id);
  assert(
    receiptCostLayer,
    "Successor repair scenario must create one receipt cost layer before issue reversal"
  );
  state.inventoryCostLayerIds.push(toPositiveInt(receiptCostLayer.id));

  const issueDraft = await createCariDraftDocument({
    req: makeRequestContext({
      tenantId: context.tenantId,
      userId: context.userId,
      stamp: state.stamp,
      suffix: "successor-repair-issue-create",
    }),
    payload: {
      tenantId: context.tenantId,
      userId: context.userId,
      legalEntityId: context.legalEntityId,
      counterpartyId,
      paymentTermId: null,
      direction: "AR",
      documentType: "INVOICE",
      documentDate: context.postingDate,
      dueDate: addDays(context.postingDate, 8),
      currencyCode: context.currencyCode,
      lines: [
        {
          description: "CLI09 successor repair issue",
          itemCardId: itemCard.id,
          warehouseId: warehouse.id,
          quantity: 2,
          lineNetAmountTxn: 240,
          lineTaxAmountTxn: 0,
          lineGrossAmountTxn: 240,
        },
      ],
    },
    assertScopeAccess: allowAllScopes,
  });
  state.documentIds.push(issueDraft.id);

  const postedIssue = await postCariDocumentById({
    req: makeRequestContext({
      tenantId: context.tenantId,
      userId: context.userId,
      stamp: state.stamp,
      suffix: "successor-repair-issue-post",
    }),
    payload: {
      tenantId: context.tenantId,
      userId: context.userId,
      documentId: issueDraft.id,
    },
    assertScopeAccess: allowAllScopes,
  });
  state.journalEntryIds.push(toPositiveInt(postedIssue.journal?.journalEntryId));

  const issueLinks = await listPendingInventoryStockLinks({
    tenantId: context.tenantId,
    filters: {
      legalEntityId: context.legalEntityId,
      linkStatus: "PENDING",
      limit: 200,
      offset: 0,
    },
  });
  const issueLink = (issueLinks.rows || []).find(
    (row) =>
      toPositiveInt(row.documentId) === toPositiveInt(issueDraft.id) &&
      String(row.stockImpactMode || "").toUpperCase() === "ISSUE_PENDING"
  );
  assert(issueLink, "Successor repair scenario must create one pending issue stock link");
  state.stockLinkIds.push(toPositiveInt(issueLink.id));

  const issueMovement = await createInventoryMovementFromStockLink({
    payload: {
      tenantId: context.tenantId,
      userId: context.userId,
      legalEntityId: context.legalEntityId,
      warehouseId: warehouse.id,
      sourceStockLinkId: issueLink.id,
      movementDate: context.postingDate,
      note: `CLI09 successor repair issue materialization ${state.stamp}`,
    },
  });
  state.inventoryMovementIds.push(toPositiveInt(issueMovement.id));
  if (toPositiveInt(issueMovement.postedJournalEntryId)) {
    state.journalEntryIds.push(toPositiveInt(issueMovement.postedJournalEntryId));
  }

  await query(
    `UPDATE inventory_warehouses
        SET status = 'INACTIVE'
      WHERE id = ?`,
    [warehouse.id]
  );

  const reversedIssue = await reverseInventoryMovementById({
    payload: {
      tenantId: context.tenantId,
      userId: context.userId,
      movementId: issueMovement.id,
      reversalDate: context.postingDate,
      reason: `CLI09 successor repair reverse ${state.stamp}`,
    },
  });
  if (toPositiveInt(reversedIssue.reversalJournalEntryId)) {
    state.journalEntryIds.push(toPositiveInt(reversedIssue.reversalJournalEntryId));
  }

  const successorRows = await listPendingInventoryStockLinks({
    tenantId: context.tenantId,
    filters: {
      legalEntityId: context.legalEntityId,
      linkStatus: "PENDING",
      limit: 200,
      offset: 0,
    },
  });
  const reopenedSuccessor = (successorRows.rows || []).find(
    (row) => toPositiveInt(row.reopenedFromStockLinkId) === toPositiveInt(issueLink.id)
  );
  assert(reopenedSuccessor, "Invalid successor inheritance must still create one reopened successor row");
  state.stockLinkIds.push(toPositiveInt(reopenedSuccessor.id));
  assert(
    !toPositiveInt(reopenedSuccessor.boundWarehouseId),
    "Invalid successor inheritance must keep the reopened successor out of normal strict-mode work"
  );
  assert(
    String(reopenedSuccessor.queueState || "").toUpperCase() === "REPAIR_REQUIRED",
    "Invalid successor inheritance must surface REPAIR_REQUIRED queue state"
  );
  assert(
    String(reopenedSuccessor.repairReasonCode || "").toUpperCase() ===
      "SUCCESSOR_WAREHOUSE_INHERITANCE_INVALID",
    "Invalid successor inheritance must expose a dedicated repair reason code"
  );
  assert(
    /cleanup required/i.test(String(reopenedSuccessor.resolutionNote || "")),
    "Cleanup-only reopened successors must record cleanup guidance in resolutionNote"
  );

  await expectStrictStockLinkCleanupRequired({
    tenantId: context.tenantId,
    userId: context.userId,
    legalEntityId: context.legalEntityId,
    stockLinkId: reopenedSuccessor.id,
    movementDate: context.postingDate,
    note: `CLI09 successor cleanup strict materialization blocked ${state.stamp}`,
  });
}

async function runReceiptUndoScenario({
  context,
  counterpartyId,
  accountIds,
  state,
}) {
  const itemCard = await createItemCard({
    payload: {
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      code: `CLI09RT${state.stamp.slice(-6)}`.slice(0, 80),
      name: `CLI09 Receipt Undo Item ${state.stamp}`,
      itemType: "STOCK_ITEM",
      defaultSalesAccountId: accountIds.arOffsetAccountId,
      defaultPurchaseAccountId: accountIds.apOffsetAccountId,
      inventoryAssetAccountId: accountIds.inventoryAssetAccountId,
      defaultCogsAccountId: accountIds.cogsAccountId,
      taxCategoryCode: null,
      status: "ACTIVE",
    },
  });
  state.itemCardIds.push(toPositiveInt(itemCard.id));

  const warehouse = await createInventoryWarehouse({
    payload: {
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      code: `CLI09RWH${state.stamp.slice(-5)}`.slice(0, 80),
      name: `CLI09 Receipt Undo Warehouse ${state.stamp}`,
      status: "ACTIVE",
      notes: "CLI09 receipt undo warehouse",
    },
  });
  state.warehouseIds.push(toPositiveInt(warehouse.id));

  const draft = await createCariDraftDocument({
    req: makeRequestContext({
      tenantId: context.tenantId,
      userId: context.userId,
      stamp: state.stamp,
      suffix: "receipt-undo-create",
    }),
    payload: {
      tenantId: context.tenantId,
      userId: context.userId,
      legalEntityId: context.legalEntityId,
      counterpartyId,
      paymentTermId: null,
      direction: "AP",
      documentType: "INVOICE",
      documentDate: context.postingDate,
      dueDate: addDays(context.postingDate, 9),
      currencyCode: context.currencyCode,
      lines: [
        {
          description: "CLI09 receipt undo purchase",
          itemCardId: itemCard.id,
          warehouseId: warehouse.id,
          quantity: 6,
          lineNetAmountTxn: 420,
          lineTaxAmountTxn: 0,
          lineGrossAmountTxn: 420,
        },
      ],
    },
    assertScopeAccess: allowAllScopes,
  });
  state.documentIds.push(draft.id);

  const posted = await postCariDocumentById({
    req: makeRequestContext({
      tenantId: context.tenantId,
      userId: context.userId,
      stamp: state.stamp,
      suffix: "receipt-undo-post",
    }),
    payload: {
      tenantId: context.tenantId,
      userId: context.userId,
      documentId: draft.id,
    },
    assertScopeAccess: allowAllScopes,
  });
  state.journalEntryIds.push(toPositiveInt(posted.journal?.journalEntryId));

  const pendingLinks = await listPendingInventoryStockLinks({
    tenantId: context.tenantId,
    filters: {
      legalEntityId: context.legalEntityId,
      linkStatus: "PENDING",
      limit: 200,
      offset: 0,
    },
  });
  const receiptLink = (pendingLinks.rows || []).find(
    (row) =>
      toPositiveInt(row.documentId) === toPositiveInt(draft.id) &&
      String(row.stockImpactMode || "").toUpperCase() === "RECEIPT_PENDING"
  );
  assert(receiptLink, "Receipt undo AP document must create one pending receipt stock link");
  assert(
    toPositiveInt(receiptLink.boundWarehouseId) === toPositiveInt(warehouse.id),
    "Receipt undo AP document must propagate the selected warehouse onto the pending receipt stock link"
  );
  state.stockLinkIds.push(toPositiveInt(receiptLink.id));

  const receiptMovement = await createInventoryMovementFromStockLink({
    payload: {
      tenantId: context.tenantId,
      userId: context.userId,
      legalEntityId: context.legalEntityId,
      warehouseId: warehouse.id,
      sourceStockLinkId: receiptLink.id,
      movementDate: context.postingDate,
      note: `CLI09 receipt undo materialization ${state.stamp}`,
    },
  });
  state.inventoryMovementIds.push(toPositiveInt(receiptMovement.id));
  assert(
    String(receiptMovement.movementType || "").toUpperCase() === "RECEIPT" &&
      String(receiptMovement.valuationStatus || "").toUpperCase() === "VALUED",
    "Receipt undo scenario must materialize one VALUED receipt movement"
  );

  const receiptCostLayer = await queryReceiptCostLayerBySourceMovementId(receiptMovement.id);
  assert(receiptCostLayer, "Receipt undo scenario must create one receipt cost layer");
  state.inventoryCostLayerIds.push(toPositiveInt(receiptCostLayer.id));
  assert(
    amountsEqual(receiptCostLayer.quantity_remaining, receiptCostLayer.quantity_in),
    "Receipt undo scenario must start with a fully available cost layer"
  );

  await expectCariReverseBlockedByInventory({
    context,
    documentId: draft.id,
    expectedMovementType: "RECEIPT",
    expectedMovementId: receiptMovement.id,
    expectedActionCode: "UNDO_RECEIPT_MATERIALIZATION_FIRST",
  });

  const undoneReceipt = await reverseInventoryMovementById({
    payload: {
      tenantId: context.tenantId,
      userId: context.userId,
      movementId: receiptMovement.id,
      reversalDate: context.postingDate,
      reason: `CLI09 receipt undo ${state.stamp}`,
    },
  });
  assert(
    toPositiveInt(undoneReceipt.id) === toPositiveInt(receiptMovement.id),
    "Receipt undo must return the original receipt movement row"
  );
  assert(
    String(undoneReceipt.reversedAt || "").trim(),
    "Receipt undo must stamp reversedAt on the original receipt movement"
  );
  assert(
    !toPositiveInt(undoneReceipt.reversalJournalEntryId),
    "Receipt undo must not invent a duplicate inventory journal"
  );
  assert(
    toPositiveInt(undoneReceipt.reversalMovementId) > 0,
    "Receipt undo must expose the additive reversal movement id"
  );
  assert(
    String(undoneReceipt.reversalMovementType || "").toUpperCase() === "ADJUSTMENT_OUT",
    "Receipt undo must represent additive evidence as an ADJUSTMENT_OUT movement"
  );
  state.inventoryMovementIds.push(toPositiveInt(undoneReceipt.reversalMovementId));

  const reversalMovementRow = await queryInventoryMovementSummary(
    undoneReceipt.reversalMovementId
  );
  assert(reversalMovementRow, "Receipt undo reversal movement must be queryable");
  assert(
    toPositiveInt(reversalMovementRow.reversal_of_movement_id) ===
      toPositiveInt(receiptMovement.id),
    "Receipt undo reversal movement must link back to the original receipt movement"
  );
  assert(
    String(reversalMovementRow.movement_type || "").toUpperCase() === "ADJUSTMENT_OUT" &&
      String(reversalMovementRow.valuation_status || "").toUpperCase() === "VALUED",
    "Receipt undo reversal movement must persist as a VALUED ADJUSTMENT_OUT row"
  );
  assert(
    !toPositiveInt(reversalMovementRow.posted_journal_entry_id),
    "Receipt undo reversal movement must not create a duplicate journal entry"
  );

  const closedReceiptCostLayer = await queryReceiptCostLayerBySourceMovementId(receiptMovement.id);
  assert(closedReceiptCostLayer, "Receipt cost layer must remain queryable after undo");
  assert(
    String(closedReceiptCostLayer.layer_status || "").toUpperCase() === "CLOSED" &&
      amountsEqual(closedReceiptCostLayer.quantity_remaining, 0),
    "Receipt undo must close the original cost layer and clear remaining quantity"
  );

  const undoneReceiptReplay = await reverseInventoryMovementById({
    payload: {
      tenantId: context.tenantId,
      userId: context.userId,
      movementId: receiptMovement.id,
      reversalDate: context.postingDate,
      reason: `CLI09 receipt undo replay ${state.stamp}`,
    },
  });
  assert(
    toPositiveInt(undoneReceiptReplay.reversalMovementId) ===
      toPositiveInt(undoneReceipt.reversalMovementId),
    "Replaying receipt undo must reuse the same additive reversal movement"
  );

  const reversedResult = await reverseCariPostedDocumentById({
    req: makeRequestContext({
      tenantId: context.tenantId,
      userId: context.userId,
      stamp: state.stamp,
      suffix: "receipt-undo-doc-reverse",
    }),
    payload: {
      tenantId: context.tenantId,
      userId: context.userId,
      documentId: draft.id,
      reason: `CLI09 receipt undo cleared blocker ${state.stamp}`,
      reversalDate: context.postingDate,
    },
    assertScopeAccess: allowAllScopes,
  });
  state.documentIds.push(toPositiveInt(reversedResult.row?.id));
  state.journalEntryIds.push(toPositiveInt(reversedResult.journal?.reversalJournalEntryId));
  assert(
    String(reversedResult.original?.status || "").toUpperCase() === "REVERSED",
    "Receipt undo must clear the inventory blocker so the AP document can reverse"
  );
  assert(
    toPositiveInt(reversedResult.row?.reversalOfDocumentId) === toPositiveInt(draft.id),
    "Receipt undo document reverse must create a reversal document linked to the original"
  );
}

async function runMixedCurrencyIssueScenario({
  context,
  counterpartyId,
  accountIds,
  state,
}) {
  const alternateCurrencyCode = await resolveAlternateCurrencyCode(context.currencyCode);
  const itemCard = await createItemCard({
    payload: {
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      code: `CLI09MC${state.stamp.slice(-6)}`.slice(0, 80),
      name: `CLI09 Mixed Currency Stock ${state.stamp}`,
      itemType: "STOCK_ITEM",
      defaultSalesAccountId: accountIds.arOffsetAccountId,
      defaultPurchaseAccountId: accountIds.apOffsetAccountId,
      inventoryAssetAccountId: accountIds.inventoryAssetAccountId,
      defaultCogsAccountId: accountIds.cogsAccountId,
      taxCategoryCode: null,
      status: "ACTIVE",
    },
  });
  state.itemCardIds.push(toPositiveInt(itemCard.id));

  const warehouse = await createInventoryWarehouse({
    payload: {
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      code: `CLI09MXW${state.stamp.slice(-5)}`.slice(0, 80),
      name: `CLI09 Mixed Currency Warehouse ${state.stamp}`,
      status: "ACTIVE",
      notes: "CLI09 mixed-currency FIFO temp warehouse",
    },
  });
  state.warehouseIds.push(toPositiveInt(warehouse.id));

  const firstReceipt = await insertManualReceiptLayer({
    tenantId: context.tenantId,
    legalEntityId: context.legalEntityId,
    warehouseId: warehouse.id,
    itemCardId: itemCard.id,
    movementDate: context.postingDate,
    quantity: 3,
    currencyCode: context.currencyCode,
    unitCostTxn: 40,
    unitCostBase: 40,
    note: `CLI09 mixed-currency base receipt ${state.stamp}`,
    state,
  });
  const secondReceipt = await insertManualReceiptLayer({
    tenantId: context.tenantId,
    legalEntityId: context.legalEntityId,
    warehouseId: warehouse.id,
    itemCardId: itemCard.id,
    movementDate: context.postingDate,
    quantity: 4,
    currencyCode: alternateCurrencyCode,
    unitCostTxn: 5,
    unitCostBase: 60,
    note: `CLI09 mixed-currency alt receipt ${state.stamp}`,
    state,
  });

  const draft = await createCariDraftDocument({
    req: makeRequestContext({
      tenantId: context.tenantId,
      userId: context.userId,
      stamp: state.stamp,
      suffix: "mixed-currency-issue-create",
    }),
    payload: {
      tenantId: context.tenantId,
      userId: context.userId,
      legalEntityId: context.legalEntityId,
      counterpartyId,
      paymentTermId: null,
      direction: "AR",
      documentType: "INVOICE",
      documentDate: context.postingDate,
      dueDate: addDays(context.postingDate, 14),
      currencyCode: context.currencyCode,
      lines: [
        {
          description: "CLI09 mixed-currency stock sale",
          itemCardId: itemCard.id,
          warehouseId: warehouse.id,
          quantity: 5,
          lineNetAmountTxn: 900,
          lineTaxAmountTxn: 0,
          lineGrossAmountTxn: 900,
        },
      ],
    },
    assertScopeAccess: allowAllScopes,
  });
  state.documentIds.push(draft.id);

  const posted = await postCariDocumentById({
    req: makeRequestContext({
      tenantId: context.tenantId,
      userId: context.userId,
      stamp: state.stamp,
      suffix: "mixed-currency-issue-post",
    }),
    payload: {
      tenantId: context.tenantId,
      userId: context.userId,
      documentId: draft.id,
    },
    assertScopeAccess: allowAllScopes,
  });
  state.journalEntryIds.push(toPositiveInt(posted.journal?.journalEntryId));

  const pendingLinks = await listPendingInventoryStockLinks({
    tenantId: context.tenantId,
    filters: {
      legalEntityId: context.legalEntityId,
      linkStatus: "PENDING",
      limit: 200,
      offset: 0,
    },
  });
  const issueLink = (pendingLinks.rows || []).find(
    (row) =>
      toPositiveInt(row.documentId) === toPositiveInt(draft.id) &&
      String(row.stockImpactMode || "").toUpperCase() === "ISSUE_PENDING"
  );
  assert(issueLink, "Mixed-currency stock sale must create one pending issue stock link");
  assert(
    toPositiveInt(issueLink.boundWarehouseId) === toPositiveInt(warehouse.id),
    "Mixed-currency stock sale must propagate the selected warehouse onto the pending issue stock link"
  );
  state.stockLinkIds.push(toPositiveInt(issueLink.id));

  const issueMovement = await createInventoryMovementFromStockLink({
    payload: {
      tenantId: context.tenantId,
      userId: context.userId,
      legalEntityId: context.legalEntityId,
      warehouseId: warehouse.id,
      sourceStockLinkId: issueLink.id,
      movementDate: context.postingDate,
      note: `CLI09 mixed-currency issue materialization ${state.stamp}`,
    },
  });
  state.inventoryMovementIds.push(toPositiveInt(issueMovement.id));
  if (toPositiveInt(issueMovement.postedJournalEntryId)) {
    state.journalEntryIds.push(toPositiveInt(issueMovement.postedJournalEntryId));
  }

  const expectedBaseIssueCost = 240;
  assert(
    String(issueMovement.valuationStatus || "").toUpperCase() === "VALUED",
    "Mixed-currency issue must still value successfully"
  );
  assert(
    String(issueMovement.currencyCode || "").toUpperCase() === String(context.currencyCode).toUpperCase(),
    "Mixed-currency issue must report the legal-entity base currency as its accounting currency"
  );
  assert(
    amountsEqual(issueMovement.totalCostTxn, expectedBaseIssueCost) &&
      amountsEqual(issueMovement.totalCostBase, expectedBaseIssueCost),
    "Mixed-currency issue must aggregate consumed layer cost in base currency"
  );

  const issueConsumptions = await queryIssueLayerConsumptions(issueMovement.id);
  assert(issueConsumptions.length === 2, "Mixed-currency issue must consume two FIFO layers");
  const consumedCurrencies = Array.from(
    new Set(
      issueConsumptions
        .map((row) => String(row.currency_code || "").trim().toUpperCase())
        .filter(Boolean)
    )
  );
  assert(
    consumedCurrencies.includes(String(context.currencyCode).toUpperCase()) &&
      consumedCurrencies.includes(String(alternateCurrencyCode).toUpperCase()),
    "Mixed-currency issue must preserve source-layer currency evidence on consumption rows"
  );
  assert(
    amountsEqual(issueConsumptions[0]?.total_cost_base, 120) &&
      amountsEqual(issueConsumptions[1]?.total_cost_base, 120),
    "Mixed-currency issue must preserve deterministic FIFO base-cost breakdown"
  );

  const issueJournalLines = await queryJournalLines(issueMovement.postedJournalEntryId);
  assert(issueJournalLines.length === 2, "Mixed-currency issue journal must contain exactly two lines");
  assert(
    issueJournalLines.some(
      (row) =>
        toPositiveInt(row.account_id) === accountIds.cogsAccountId &&
        amountsEqual(row.debit_base, expectedBaseIssueCost)
    ),
    "Mixed-currency issue journal must debit COGS with the aggregated base total"
  );
  assert(
    issueJournalLines.some(
      (row) =>
        toPositiveInt(row.account_id) === accountIds.inventoryAssetAccountId &&
        amountsEqual(row.credit_base, expectedBaseIssueCost)
    ),
    "Mixed-currency issue journal must credit inventory with the aggregated base total"
  );

  const costLayers = await listInventoryCostLayers({
    tenantId: context.tenantId,
    filters: {
      legalEntityId: context.legalEntityId,
      warehouseId: warehouse.id,
      itemCardId: itemCard.id,
      limit: 50,
      offset: 0,
    },
  });
  const firstLayer = (costLayers.rows || []).find(
    (row) => toPositiveInt(row.sourceMovementId) === toPositiveInt(firstReceipt.movementId)
  );
  const secondLayer = (costLayers.rows || []).find(
    (row) => toPositiveInt(row.sourceMovementId) === toPositiveInt(secondReceipt.movementId)
  );
  assert(firstLayer && secondLayer, "Mixed-currency issue must leave both receipt layers queryable");
  assert(
    String(firstLayer.layerStatus || "").toUpperCase() === "CLOSED" &&
      amountsEqual(firstLayer.quantityRemaining, 0),
    "Mixed-currency issue must fully consume the first FIFO layer"
  );
  assert(
    String(secondLayer.layerStatus || "").toUpperCase() === "OPEN" &&
      amountsEqual(secondLayer.quantityRemaining, 2),
    "Mixed-currency issue must partially consume the second FIFO layer"
  );
}

async function runMixedTaxScenario({
  context,
  counterpartyId,
  accountIds,
  state,
}) {
  await setFeatureFlag({
    tenantId: context.tenantId,
    userId: context.userId,
    featureCode: FEATURE_TAX_ENGINE_V1,
    enabled: true,
  });
  state.featureFlagTouched = true;

  await createMixedTaxFixture({
    tenantId: context.tenantId,
    legalEntityId: context.legalEntityId,
    countryId: context.countryId,
    currencyCode: context.currencyCode,
    postingDate: context.postingDate,
    userId: context.userId,
    accountIds,
    stamp: state.stamp,
    state,
  });

  const mixedDraft = await createCariDraftDocument({
    req: makeRequestContext({
      tenantId: context.tenantId,
      userId: context.userId,
      stamp: state.stamp,
      suffix: "mixed-tax-create",
    }),
    payload: {
      tenantId: context.tenantId,
      userId: context.userId,
      legalEntityId: context.legalEntityId,
      counterpartyId,
      paymentTermId: null,
      direction: "AR",
      documentType: "INVOICE",
      documentDate: context.postingDate,
      dueDate: addDays(context.postingDate, 20),
      currencyCode: context.currencyCode,
      lines: [
        {
          description: "CLI09 food line",
          lineKind: "STANDARD",
          postingAccountId: accountIds.arOffsetAccountId,
          quantity: 1,
          lineNetAmountTxn: 1000,
          lineTaxAmountTxn: 0,
          lineGrossAmountTxn: 1000,
          taxCategoryCode: "FOOD8",
        },
        {
          description: "CLI09 goods line",
          lineKind: "STANDARD",
          postingAccountId: accountIds.arOffsetAccountId,
          quantity: 1,
          lineNetAmountTxn: 2000,
          lineTaxAmountTxn: 0,
          lineGrossAmountTxn: 2000,
          taxCategoryCode: "GOODS18",
        },
      ],
    },
    assertScopeAccess: allowAllScopes,
  });
  state.documentIds.push(mixedDraft.id);
  assert(Array.isArray(mixedDraft.lines) && mixedDraft.lines.length === 2, "Mixed-tax draft must keep both lines");
  assert(amountsEqual(mixedDraft.lines[0]?.lineTaxAmountTxn, 80), "Food line tax should resolve to 80");
  assert(amountsEqual(mixedDraft.lines[1]?.lineTaxAmountTxn, 360), "Goods line tax should resolve to 360");
  assert(amountsEqual(mixedDraft.taxAmountTxn, 440), "Draft tax total should resolve to 440");
  assert(amountsEqual(mixedDraft.grossAmountTxn, 3440), "Draft gross total should resolve to 3440");

  const lineTaxRows = await query(
    `SELECT cari_document_line_id, tax_code, tax_amount_txn, account_id
       FROM cari_document_line_taxes
      WHERE tenant_id = ?
        AND legal_entity_id = ?
        AND cari_document_id = ?
      ORDER BY cari_document_line_id ASC, component_no ASC`,
    [context.tenantId, context.legalEntityId, mixedDraft.id]
  );
  assert(lineTaxRows.rows.length === 2, "Mixed-tax draft must persist two line-tax rows");

  const posted = await postCariDocumentById({
    req: makeRequestContext({
      tenantId: context.tenantId,
      userId: context.userId,
      stamp: state.stamp,
      suffix: "mixed-tax-post",
    }),
    payload: {
      tenantId: context.tenantId,
      userId: context.userId,
      documentId: mixedDraft.id,
    },
    assertScopeAccess: allowAllScopes,
  });
  state.journalEntryIds.push(toPositiveInt(posted.journal?.journalEntryId));
  assert(posted.row?.status === "POSTED", "Mixed-tax draft must post successfully");

  const journalLines = await queryJournalLines(posted.journal.journalEntryId);
  assert(journalLines.length === 5, "Mixed-tax journal should produce 2 revenue lines + 2 tax lines + 1 control line");
  const taxCodes = journalLines
    .map((row) => String(row.tax_code || "").trim())
    .filter(Boolean);
  assert(taxCodes.length === 2, "Mixed-tax journal must expose two tax-coded lines");
  assert(
    taxCodes.some((code) => code.includes("CLI09V8")) &&
      taxCodes.some((code) => code.includes("CLI09V18")),
    "Mixed-tax journal must keep separate 8% and 18% tax codes"
  );
  assert(
    journalLines.some((row) => toPositiveInt(row.account_id) === accountIds.tax8AccountId),
    "Mixed-tax journal must post the 8% tax line to the temp VAT 8 account"
  );
  assert(
    journalLines.some((row) => toPositiveInt(row.account_id) === accountIds.tax18AccountId),
    "Mixed-tax journal must post the 18% tax line to the temp VAT 18 account"
  );

  const openItem = await queryOpenItem(mixedDraft.id);
  assert(openItem, "Mixed-tax post must create an open item");
  assert(
    amountsEqual(openItem.original_amount_txn, 3440) &&
      amountsEqual(openItem.residual_amount_txn, 3440),
    "Mixed-tax open item should carry the gross document amount"
  );
}

async function cleanupState(state) {
  const tenantId = state.context?.tenantId;
  const legalEntityId = state.context?.legalEntityId;
  const stamp = state.stamp;

  if (tenantId && legalEntityId && state.previousPurposeMappings) {
    try {
      await restorePurposeMappings({
        tenantId,
        legalEntityId,
        previousMappings: state.previousPurposeMappings,
      });
    } catch (error) {
      console.warn(`[CLI09 cleanup] failed to restore purpose mappings: ${String(error?.message || error)}`);
    }
  }

  if (tenantId && state.originalFeatureFlagLoaded) {
    try {
      if (state.originalFeatureFlagExists) {
        await query(
          `UPDATE tenant_features
              SET is_enabled = ?,
                  updated_by_user_id = ?
            WHERE tenant_id = ?
              AND feature_code = ?`,
          [
            state.originalFeatureFlagEnabled ? 1 : 0,
            state.context?.userId || null,
            tenantId,
            FEATURE_TAX_ENGINE_V1,
          ]
        );
      } else {
        await query(
          `DELETE FROM tenant_features
            WHERE tenant_id = ?
              AND feature_code = ?`,
          [tenantId, FEATURE_TAX_ENGINE_V1]
        );
      }
    } catch (error) {
      console.warn(`[CLI09 cleanup] failed to restore feature flag: ${String(error?.message || error)}`);
    }
  }

  if (stamp) {
    try {
      await query(
        `DELETE FROM audit_logs
          WHERE tenant_id = ?
            AND request_id LIKE ?`,
        [tenantId, `${stamp}%`]
      );
    } catch (error) {
      console.warn(`[CLI09 cleanup] failed to delete audit logs: ${String(error?.message || error)}`);
    }
  }

  if (state.inventoryCostLayerIds.length > 0) {
    await query(
      `DELETE FROM inventory_issue_layer_consumptions
        WHERE issue_movement_id IN (${makeInClause(state.inventoryMovementIds)})`,
      state.inventoryMovementIds
    );
  }
  if (state.inventoryCostLayerIds.length > 0) {
    await query(
      `DELETE FROM inventory_cost_layers
        WHERE id IN (${makeInClause(state.inventoryCostLayerIds)})`,
      state.inventoryCostLayerIds
    );
  }
  if (state.inventoryMovementIds.length > 0) {
    await query(
      `DELETE FROM inventory_cost_layers
        WHERE source_movement_id IN (${makeInClause(state.inventoryMovementIds)})`,
      state.inventoryMovementIds
    );
  }
  if (state.inventoryMovementIds.length > 0) {
    await query(
      `DELETE FROM inventory_movements
        WHERE reversal_of_movement_id IN (${makeInClause(state.inventoryMovementIds)})`,
      state.inventoryMovementIds
    );
  }
  if (state.inventoryMovementIds.length > 0) {
    await query(
      `DELETE FROM inventory_movements
        WHERE id IN (${makeInClause(state.inventoryMovementIds)})`,
      state.inventoryMovementIds
    );
  }
  if (state.stockLinkIds.length > 0) {
    await query(
      `DELETE FROM cari_document_line_stock_links
        WHERE id IN (${makeInClause(state.stockLinkIds)})`,
      state.stockLinkIds
    );
  }
  if (state.documentIds.length > 0 && tenantId && legalEntityId) {
    await query(
      `DELETE FROM cari_document_line_stock_links
        WHERE tenant_id = ?
          AND legal_entity_id = ?
          AND cari_document_id IN (${makeInClause(state.documentIds)})`,
      [tenantId, legalEntityId, ...state.documentIds]
    );
    await query(
      `DELETE FROM cari_document_line_taxes
        WHERE tenant_id = ?
          AND legal_entity_id = ?
          AND cari_document_id IN (${makeInClause(state.documentIds)})`,
      [tenantId, legalEntityId, ...state.documentIds]
    );
    await query(
      `DELETE FROM cari_document_lines
        WHERE tenant_id = ?
          AND legal_entity_id = ?
          AND cari_document_id IN (${makeInClause(state.documentIds)})`,
      [tenantId, legalEntityId, ...state.documentIds]
    );
    await query(
      `DELETE FROM cari_open_items
        WHERE tenant_id = ?
          AND legal_entity_id = ?
          AND document_id IN (${makeInClause(state.documentIds)})`,
      [tenantId, legalEntityId, ...state.documentIds]
    );
    await query(
      `DELETE FROM cari_documents
        WHERE tenant_id = ?
          AND legal_entity_id = ?
          AND reversal_of_document_id IN (${makeInClause(state.documentIds)})`,
      [tenantId, legalEntityId, ...state.documentIds]
    );
    await query(
      `DELETE FROM cari_documents
        WHERE tenant_id = ?
          AND legal_entity_id = ?
          AND id IN (${makeInClause(state.documentIds)})`,
      [tenantId, legalEntityId, ...state.documentIds]
    );
  }
  if (state.journalEntryIds.length > 0 && tenantId) {
    await query(
      `DELETE FROM journal_source_links
        WHERE tenant_id = ?
          AND journal_entry_id IN (${makeInClause(state.journalEntryIds)})`,
      [tenantId, ...state.journalEntryIds]
    );
    await query(
      `DELETE FROM journal_lines
        WHERE journal_entry_id IN (${makeInClause(state.journalEntryIds)})`,
      state.journalEntryIds
    );
    await query(
      `DELETE FROM journal_entries
        WHERE tenant_id = ?
          AND reversal_journal_entry_id IN (${makeInClause(state.journalEntryIds)})`,
      [tenantId, ...state.journalEntryIds]
    );
    await query(
      `DELETE FROM journal_entries
        WHERE tenant_id = ?
          AND id IN (${makeInClause(state.journalEntryIds)})`,
      [tenantId, ...state.journalEntryIds]
    );
  }
  if (state.warehouseIds.length > 0) {
    await query(
      `DELETE FROM inventory_warehouses
        WHERE id IN (${makeInClause(state.warehouseIds)})`,
      state.warehouseIds
    );
  }
  if (state.operatingUnitIds.length > 0) {
    await query(
      `DELETE FROM operating_units
        WHERE id IN (${makeInClause(state.operatingUnitIds)})`,
      state.operatingUnitIds
    );
  }
  if (state.itemCardIds.length > 0) {
    await query(
      `DELETE FROM item_cards
        WHERE id IN (${makeInClause(state.itemCardIds)})`,
      state.itemCardIds
    );
  }
  if (state.taxMappingIds.length > 0) {
    await query(
      `DELETE FROM tax_account_mappings
        WHERE id IN (${makeInClause(state.taxMappingIds)})`,
      state.taxMappingIds
    );
  }
  if (state.taxRuleIds.length > 0) {
    await query(
      `DELETE FROM tax_rule_sets
        WHERE id IN (${makeInClause(state.taxRuleIds)})`,
      state.taxRuleIds
    );
  }
  if (state.taxCodeIds.length > 0) {
    await query(
      `DELETE FROM tax_codes
        WHERE id IN (${makeInClause(state.taxCodeIds)})`,
      state.taxCodeIds
    );
  }
  if (state.taxRegimeIds.length > 0) {
    await query(
      `DELETE FROM tax_regimes
        WHERE id IN (${makeInClause(state.taxRegimeIds)})`,
      state.taxRegimeIds
    );
  }
  if (state.counterpartyId) {
    await query(`DELETE FROM counterparties WHERE id = ?`, [state.counterpartyId]);
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
}

async function main() {
  const stamp = `CLI09${Date.now()}`;
  const state = {
    stamp,
    context: null,
    originalFeatureFlagLoaded: false,
    originalFeatureFlagExists: false,
    originalFeatureFlagEnabled: false,
    previousPurposeMappings: null,
    featureFlagTouched: false,
    createdCoaId: null,
    createdAccountIds: [],
    counterpartyId: null,
    documentIds: [],
    journalEntryIds: [],
    stockLinkIds: [],
    warehouseIds: [],
    operatingUnitIds: [],
    inventoryMovementIds: [],
    inventoryCostLayerIds: [],
    itemCardIds: [],
    taxRegimeIds: [],
    taxCodeIds: [],
    taxRuleIds: [],
    taxMappingIds: [],
  };

  try {
    const context = await resolveRegressionContext();
    state.context = context;

    const featureRow = await query(
      `SELECT is_enabled
         FROM tenant_features
        WHERE tenant_id = ?
          AND feature_code = ?
        LIMIT 1`,
      [context.tenantId, FEATURE_TAX_ENGINE_V1]
    );
    state.originalFeatureFlagLoaded = true;
    state.originalFeatureFlagExists = Boolean(featureRow.rows?.[0]);
    state.originalFeatureFlagEnabled = toNumber(featureRow.rows?.[0]?.is_enabled) === 1;
    await setFeatureFlag({
      tenantId: context.tenantId,
      userId: context.userId,
      featureCode: FEATURE_TAX_ENGINE_V1,
      enabled: false,
    });

    const coaId = await ensureLegalEntityCoa({
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      stamp,
      state,
    });
    state.previousPurposeMappings = await capturePurposeMappings({
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
    });
    const accountIds = await createRegressionAccounts({
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      coaId,
      stamp,
      state,
    });
    const counterpartyId = await createTempCounterparty({
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      currencyCode: context.currencyCode,
      stamp,
      state,
    });

    await runSyntheticSingleLineScenario({
      context,
      counterpartyId,
      accountIds,
      state,
    });
    await runDraftWarehouseOwnershipValidationScenario({
      context,
      counterpartyId,
      accountIds,
      state,
    });
    await runStrictPostingValidationScenario({
      context,
      counterpartyId,
      accountIds,
      state,
    });
    await runItemCardAndInventoryScenario({
      context,
      counterpartyId,
      accountIds,
      state,
    });
    await runTransferRequiredQueueScenario({
      context,
      counterpartyId,
      accountIds,
      state,
    });
    await runSuccessorRepairFallbackScenario({
      context,
      counterpartyId,
      accountIds,
      state,
    });
    await runReceiptUndoScenario({
      context,
      counterpartyId,
      accountIds,
      state,
    });
    await runMixedCurrencyIssueScenario({
      context,
      counterpartyId,
      accountIds,
      state,
    });
    await runMixedTaxScenario({
      context,
      counterpartyId,
      accountIds,
      state,
    });

    console.log("CARI line-model rollout regression passed.");
    console.log(
      JSON.stringify(
        {
          ok: true,
          tenantId: context.tenantId,
          legalEntityId: context.legalEntityId,
          postingDate: context.postingDate,
          stamp,
          checkedDocumentIds: state.documentIds,
          checkedJournalEntryIds: state.journalEntryIds,
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
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
