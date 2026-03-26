
import { closePool, query } from "../src/db.js";
import { resolveOrPrepareSmokeContext } from "./_smoke-context.js";
import {
  createCariDraftDocument,
  postCariDocumentById,
  reverseCariPostedDocumentById,
} from "../src/services/cari.document.service.js";
import {
  createInventoryWarehouse,
  materializeInventoryMovementFromCariStockLink,
  reverseInventoryMovementById,
} from "../src/services/inventory.service.js";
import {
  approveInventoryTransferById,
  createInventoryTransfer,
  receiveInventoryTransferById,
  reverseInventoryTransferById,
  shipInventoryTransferById,
} from "../src/services/inventory.transfer.service.js";
import { createItemCard } from "../src/services/item.card.service.js";
import {
  createInventoryLandedCostVoucher,
  getInventoryLandedCostVoucherById,
  listInventoryLandedCostSourceLineLookup,
  listInventoryLandedCostTargetLookup,
  listInventoryLandedCostVouchers,
  previewInventoryLandedCostVoucher,
  reverseInventoryLandedCostVoucher,
} from "../src/services/inventory.landed-cost.service.js";
let passed = 0;
function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}
function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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
function makeRequestContext({ tenantId, userId, stamp, suffix, lines = null }) {
  return {
    requestId: `${stamp}:${suffix}`.slice(0, 80),
    headers: {
      "user-agent": "inventory-lcv07-landed-cost-smoke",
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
async function runCheck(label, fn) {
  await fn();
  passed += 1;
  console.log(`  [ok] ${label}`);
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
async function createSmokeUser({ tenantId, stamp }) {
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
      `lcv07.smoke.${stamp}@example.test`,
      "not-used-in-direct-service-smoke",
      `LCV07 Smoke ${stamp}`,
    ]
  );
  const userId = toPositiveInt(result.rows?.insertId);
  assert(userId, "Failed to create LCV07 smoke user");
  return userId;
}
async function createTempAccounts({ coaId, stamp }) {
  const defs = [
    ["apControlAccountId", "LIABILITY", "CREDIT", "APC", "AP Control"],
    ["arControlAccountId", "ASSET", "DEBIT", "ARC", "AR Control"],
    ["revenueAccountId", "REVENUE", "CREDIT", "REV", "Revenue"],
    ["expenseAccountId", "EXPENSE", "DEBIT", "EXP", "Expense"],
    ["inventoryAssetAccountId", "ASSET", "DEBIT", "INV", "Inventory Asset"],
    ["inventoryTransitAccountId", "ASSET", "DEBIT", "TRN", "Inventory Transit"],
    ["cogsAccountId", "EXPENSE", "DEBIT", "COG", "COGS"],
  ];
  const ids = {};
  for (const [key, accountType, normalSide, suffix, label] of defs) {
    const code = `LCV07${suffix}${stamp.slice(-5)}`.slice(0, 50).toUpperCase();
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
      [coaId, code, `LCV07 ${label} ${stamp}`, accountType, normalSide]
    );
    const accountId = toPositiveInt(result.rows?.insertId);
    assert(accountId, `Failed to create ${label} account`);
    ids[key] = accountId;
  }
  return ids;
}
async function createSmokeCounterparty({
  tenantId,
  legalEntityId,
  currencyCode,
  accounts,
  stamp,
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
     ) VALUES (?, ?, NULL, ?, ?, 1, 1, ?, ?, ?, 'ACTIVE', ?)`,
    [
      tenantId,
      legalEntityId,
      `LCV07CP${stamp.slice(-8)}`.slice(0, 40).toUpperCase(),
      `LCV07 Smoke Counterparty ${stamp.slice(-8)}`,
      currencyCode,
      accounts.arControlAccountId,
      accounts.apControlAccountId,
      "Temporary LCV07 smoke counterparty",
    ]
  );
  const counterpartyId = toPositiveInt(result.rows?.insertId);
  assert(counterpartyId, "Failed to create LCV07 smoke counterparty");
  return counterpartyId;
}
async function createSmokeWarehouse({
  tenantId,
  legalEntityId,
  ownershipScope,
  operatingUnitId = null,
  code,
  name,
}) {
  const warehouse = await createInventoryWarehouse({
    payload: {
      tenantId,
      legalEntityId,
      ownershipScope,
      operatingUnitId,
      code,
      name,
      status: "ACTIVE",
      notes: "LCV07 smoke warehouse",
    },
  });
  assert(toPositiveInt(warehouse?.id), `Failed to create warehouse ${code}`);
  return warehouse;
}
async function createSmokeItemCard({
  tenantId,
  legalEntityId,
  code,
  name,
  accounts,
}) {
  const row = await createItemCard({
    payload: {
      tenantId,
      legalEntityId,
      code,
      name,
      itemType: "STOCK_ITEM",
      defaultSalesAccountId: accounts.revenueAccountId,
      defaultPurchaseAccountId: accounts.expenseAccountId,
      inventoryAssetAccountId: accounts.inventoryAssetAccountId,
      inventoryTransitAccountId: accounts.inventoryTransitAccountId,
      defaultCogsAccountId: accounts.cogsAccountId,
      taxCategoryCode: null,
      status: "ACTIVE",
    },
  });
  assert(toPositiveInt(row?.id), `Failed to create item card ${code}`);
  return row;
}
async function insertFxRate({
  tenantId,
  rateDate,
  fromCurrencyCode,
  toCurrencyCode,
  rate,
}) {
  await query(
    `INSERT INTO fx_rates (
        tenant_id,
        rate_date,
        from_currency_code,
        to_currency_code,
        rate_type,
        rate,
        source,
        is_locked
     )
     VALUES (?, ?, ?, ?, 'SPOT', ?, 'TEST', FALSE)
     ON DUPLICATE KEY UPDATE
       rate = VALUES(rate),
       source = VALUES(source),
       is_locked = VALUES(is_locked)`,
    [tenantId, rateDate, fromCurrencyCode, toCurrencyCode, rate]
  );
}
async function createSecondaryLegalEntity({ tenantId, sourceLegalEntityId, stamp }) {
  const sourceRowResult = await query(
    `SELECT group_company_id, country_id, functional_currency_code
       FROM legal_entities
      WHERE tenant_id = ?
        AND id = ?
      LIMIT 1`,
    [tenantId, sourceLegalEntityId]
  );
  const sourceRow = sourceRowResult.rows?.[0] || null;
  assert(sourceRow, "Source legal entity missing for secondary smoke legal entity");
  const code = `LCV07LE${stamp.slice(-6)}`.slice(0, 20).toUpperCase();
  await query(
    `INSERT INTO legal_entities (
        tenant_id,
        group_company_id,
        code,
        name,
        country_id,
        functional_currency_code,
        status
     ) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')`,
    [
      tenantId,
      toPositiveInt(sourceRow.group_company_id),
      code,
      `LCV07 Secondary Legal Entity ${stamp.slice(-6)}`,
      toPositiveInt(sourceRow.country_id),
      String(sourceRow.functional_currency_code || "USD").slice(0, 3),
    ]
  );
  const result = await query(
    `SELECT id
       FROM legal_entities
      WHERE tenant_id = ?
        AND code = ?
      LIMIT 1`,
    [tenantId, code]
  );
  const legalEntityId = toPositiveInt(result.rows?.[0]?.id);
  assert(legalEntityId, "Failed to create secondary legal entity");
  return legalEntityId;
}
async function createPostedCariDocument({
  tenantId,
  userId,
  legalEntityId,
  counterpartyId,
  direction,
  documentType = "INVOICE",
  documentDate,
  currencyCode,
  fxRate = null,
  operatingUnitId = null,
  lines,
  stamp,
  suffix,
}) {
  const draft = await createCariDraftDocument({
    req: makeRequestContext({
      tenantId,
      userId,
      stamp,
      suffix: `${suffix}-create`,
      lines,
    }),
    payload: {
      tenantId,
      userId,
      legalEntityId,
      counterpartyId,
      paymentTermId: null,
      direction,
      documentType,
      documentDate,
      dueDate: documentDate,
      currencyCode,
      fxRate,
      operatingUnitId,
      lines,
    },
    assertScopeAccess: allowAllScopes,
  });
  const posted = await postCariDocumentById({
    req: makeRequestContext({
      tenantId,
      userId,
      stamp,
      suffix: `${suffix}-post`,
    }),
    payload: {
      tenantId,
      userId,
      documentId: draft.id,
    },
    assertScopeAccess: allowAllScopes,
  });
  return {
    draft,
    postedRow: posted?.row || posted,
    journal: posted?.journal || null,
  };
}
function findLineByDescription(lines, description) {
  return (Array.isArray(lines) ? lines : []).find(
    (line) => String(line?.description || "").trim() === String(description || "").trim()
  ) || null;
}
async function fetchStockLinkForDocumentLine(documentId, lineId) {
  const result = await query(
    `SELECT
        id,
        cari_document_id,
        cari_document_line_id,
        stock_impact_mode,
        link_status,
        requested_quantity,
        posted_net_amount_txn,
        posted_net_amount_base,
        inventory_movement_id
       FROM cari_document_line_stock_links
      WHERE cari_document_id = ?
        AND cari_document_line_id = ?
      LIMIT 1`,
    [documentId, lineId]
  );
  return result.rows?.[0] || null;
}
async function createPostedReceipt({
  tenantId,
  userId,
  legalEntityId,
  counterpartyId,
  documentDate,
  currencyCode,
  itemCardId,
  warehouseId,
  quantity,
  unitPriceTxn,
  description,
  postingAccountId,
  stamp,
  suffix,
}) {
  const lineNetAmountTxn = Number(quantity) * Number(unitPriceTxn);
  const { postedRow, journal } = await createPostedCariDocument({
    tenantId,
    userId,
    legalEntityId,
    counterpartyId,
    direction: "AP",
    documentType: "INVOICE",
    documentDate,
    currencyCode,
    lines: [
      {
        lineKind: "STANDARD",
        description,
        subledgerType: "STOCK",
        itemCardId,
        quantity,
        unitPriceTxn,
        lineNetAmountTxn,
        lineTaxAmountTxn: 0,
        lineGrossAmountTxn: lineNetAmountTxn,
        postingAccountId,
        stockImpactMode: "RECEIPT_PENDING",
        warehouseId,
      },
    ],
    stamp,
    suffix,
  });
  const receiptLine = findLineByDescription(postedRow?.lines, description);
  assert(receiptLine?.id, `Receipt line not found after posting: ${description}`);
  const stockLink = await fetchStockLinkForDocumentLine(postedRow.id, receiptLine.id);
  assert(toPositiveInt(stockLink?.id), `Receipt stock link missing for ${description}`);
  const movement = await materializeInventoryMovementFromCariStockLink({
    payload: {
      tenantId,
      legalEntityId,
      stockLinkId: stockLink.id,
      movementDate: documentDate,
      userId,
    },
  });
  assert(toPositiveInt(movement?.id), `Receipt movement missing for ${description}`);
  return {
    postedRow,
    journal,
    receiptLine,
    stockLink,
    movement,
  };
}
async function createPostedIssueMovement({
  tenantId,
  userId,
  legalEntityId,
  counterpartyId,
  documentDate,
  currencyCode,
  itemCardId,
  warehouseId,
  quantity,
  unitPriceTxn,
  description,
  postingAccountId,
  stamp,
  suffix,
}) {
  const lineNetAmountTxn = Number(quantity) * Number(unitPriceTxn);
  const { postedRow, journal } = await createPostedCariDocument({
    tenantId,
    userId,
    legalEntityId,
    counterpartyId,
    direction: "AR",
    documentType: "INVOICE",
    documentDate,
    currencyCode,
    lines: [
      {
        lineKind: "STANDARD",
        description,
        subledgerType: "STOCK",
        itemCardId,
        quantity,
        unitPriceTxn,
        lineNetAmountTxn,
        lineTaxAmountTxn: 0,
        lineGrossAmountTxn: lineNetAmountTxn,
        postingAccountId,
        stockImpactMode: "ISSUE_PENDING",
        warehouseId,
      },
    ],
    stamp,
    suffix,
  });
  const issueLine = findLineByDescription(postedRow?.lines, description);
  assert(issueLine?.id, `Issue line not found after posting: ${description}`);
  const stockLink = await fetchStockLinkForDocumentLine(postedRow.id, issueLine.id);
  assert(toPositiveInt(stockLink?.id), `Issue stock link missing for ${description}`);
  const movement = await materializeInventoryMovementFromCariStockLink({
    payload: {
      tenantId,
      legalEntityId,
      stockLinkId: stockLink.id,
      movementDate: documentDate,
      userId,
    },
  });
  assert(toPositiveInt(movement?.id), `Issue movement missing for ${description}`);
  return {
    postedRow,
    journal,
    issueLine,
    stockLink,
    movement,
  };
}
async function createPostedGeneralApBill({
  tenantId,
  userId,
  legalEntityId,
  counterpartyId,
  documentDate,
  currencyCode,
  fxRate = null,
  amountTxn,
  description,
  postingAccountId,
  operatingUnitId = null,
  stamp,
  suffix,
}) {
  const { postedRow, journal } = await createPostedCariDocument({
    tenantId,
    userId,
    legalEntityId,
    counterpartyId,
    direction: "AP",
    documentType: "INVOICE",
    documentDate,
    currencyCode,
    fxRate,
    operatingUnitId,
    lines: [
      {
        lineKind: "STANDARD",
        description,
        subledgerType: "NONE",
        quantity: 1,
        unitPriceTxn: amountTxn,
        lineNetAmountTxn: amountTxn,
        lineTaxAmountTxn: 0,
        lineGrossAmountTxn: amountTxn,
        postingAccountId,
        stockImpactMode: "NONE",
      },
    ],
    stamp,
    suffix,
  });
  const line = findLineByDescription(postedRow?.lines, description);
  assert(line?.id, `General AP line not found after posting: ${description}`);
  return {
    postedRow,
    journal,
    line,
  };
}
async function createSourceLookupFixtureBill({
  tenantId,
  userId,
  legalEntityId,
  counterpartyId,
  documentDate,
  currencyCode,
  postingAccountId,
  stamp,
}) {
  const descriptions = {
    eligible: `LCV07 Eligible Source ${stamp}`,
    charge: `LCV07 Charge Fixture ${stamp}`,
    stock: `LCV07 Stock Fixture ${stamp}`,
    fixedAsset: `LCV07 Fixed Asset Fixture ${stamp}`,
  };
  const { postedRow } = await createPostedCariDocument({
    tenantId,
    userId,
    legalEntityId,
    counterpartyId,
    direction: "AP",
    documentType: "INVOICE",
    documentDate,
    currencyCode,
    lines: Object.values(descriptions).map((description) => ({
      lineKind: "STANDARD",
      description,
      subledgerType: "NONE",
      quantity: 1,
      unitPriceTxn: 5,
      lineNetAmountTxn: 5,
      lineTaxAmountTxn: 0,
      lineGrossAmountTxn: 5,
      postingAccountId,
      stockImpactMode: "NONE",
    })),
    stamp,
    suffix: "source-lookup-fixture",
  });
  const eligibleLine = findLineByDescription(postedRow?.lines, descriptions.eligible);
  const chargeLine = findLineByDescription(postedRow?.lines, descriptions.charge);
  const stockLine = findLineByDescription(postedRow?.lines, descriptions.stock);
  const fixedAssetLine = findLineByDescription(postedRow?.lines, descriptions.fixedAsset);
  assert(eligibleLine?.id && chargeLine?.id && stockLine?.id && fixedAssetLine?.id, "Source lookup fixture lines missing");
  const categoryResult = await query(
    `SELECT id
       FROM fixed_asset_categories
      ORDER BY id ASC
      LIMIT 1`
  );
  const fixedAssetCategoryId = toPositiveInt(categoryResult.rows?.[0]?.id);
  assert(fixedAssetCategoryId, "A fixed_asset_categories row is required for the fixed-asset lookup fixture");
  await query(
    `UPDATE cari_document_lines
        SET charge_allocation_method = 'BY_QTY'
      WHERE id = ?`,
    [chargeLine.id]
  );
  await query(
    `UPDATE cari_document_lines
        SET stock_impact_mode = 'RECEIPT_PENDING'
      WHERE id = ?`,
    [stockLine.id]
  );
  await query(
    `UPDATE cari_document_lines
        SET subledger_type = 'FIXED_ASSET',
            fixed_asset_mode = 'AUTO_CREATE',
            fixed_asset_category_id = ?
      WHERE id = ?`,
    [fixedAssetCategoryId, fixedAssetLine.id]
  );
  return {
    descriptions,
    eligibleLineId: eligibleLine.id,
  };
}
async function fetchJournalLines(journalEntryId) {
  const result = await query(
    `SELECT
        line_no,
        account_id,
        amount_txn,
        debit_base,
        credit_base,
        description,
        operating_unit_id
       FROM journal_lines
      WHERE journal_entry_id = ?
      ORDER BY line_no ASC`,
    [journalEntryId]
  );
  return result.rows || [];
}
async function fetchJournalSourceLinks(journalEntryId) {
  const result = await query(
    `SELECT source_ref_type, source_ref_id, link_role
       FROM journal_source_links
      WHERE journal_entry_id = ?
      ORDER BY id ASC`,
    [journalEntryId]
  );
  return result.rows || [];
}
function findLookupRowByDescription(rows, description) {
  return (Array.isArray(rows) ? rows : []).find(
    (row) => String(row?.lineDescription || "").trim() === String(description || "").trim()
  ) || null;
}
function findVoucherTargetByStockLink(detail, sourceStockLinkId) {
  return (detail?.targets || []).find(
    (row) => toPositiveInt(row?.sourceStockLinkId) === toPositiveInt(sourceStockLinkId)
  ) || null;
}
function findVoucherLayerAllocation(detail, predicate) {
  return (detail?.layerAllocations || []).find(predicate) || null;
}
function findVoucherConsumption(detail, predicate) {
  return (detail?.landedCostConsumptions || []).find(predicate) || null;
}
async function getLayerAllocationDbRow(layerAllocationId) {
  const result = await query(
    `SELECT
        id,
        remaining_adjusted_quantity,
        remaining_adjusted_amount_base,
        open_status,
        origin_layer_allocation_id
       FROM stock_landed_cost_voucher_layer_allocations
      WHERE id = ?
      LIMIT 1`,
    [layerAllocationId]
  );
  return result.rows?.[0] || null;
}
async function main() {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
  const context = await resolveOrPrepareSmokeContext({ prefix: "LCV07" });
  const coaId = await resolveLegalEntityCoaId(context.tenantId, context.legalEntityId);
  const userId = await createSmokeUser({
    tenantId: context.tenantId,
    stamp,
  });
  const accounts = await createTempAccounts({ coaId, stamp });
  const counterpartyId = await createSmokeCounterparty({
    tenantId: context.tenantId,
    legalEntityId: context.legalEntityId,
    currencyCode: context.currencyCode,
    accounts,
    stamp,
  });
  const baseDate = new Date().toISOString().slice(0, 10);
  const centralWarehouse = await createSmokeWarehouse({
    tenantId: context.tenantId,
    legalEntityId: context.legalEntityId,
    ownershipScope: "CENTRAL",
    code: `LCV07C${stamp.slice(-5)}`.toUpperCase(),
    name: `LCV07 Central ${stamp}`,
  });
  const branchWarehouse = await createSmokeWarehouse({
    tenantId: context.tenantId,
    legalEntityId: context.legalEntityId,
    ownershipScope: "OPERATING_UNIT",
    operatingUnitId: context.targetOuId,
    code: `LCV07B${stamp.slice(-5)}`.toUpperCase(),
    name: `LCV07 Branch ${stamp}`,
  });
  const itemA = await createSmokeItemCard({
    tenantId: context.tenantId,
    legalEntityId: context.legalEntityId,
    code: `LCV07A${stamp.slice(-5)}`.toUpperCase(),
    name: `LCV07 Item A ${stamp}`,
    accounts,
  });
  const itemB = await createSmokeItemCard({
    tenantId: context.tenantId,
    legalEntityId: context.legalEntityId,
    code: `LCV07B${stamp.slice(-5)}`.toUpperCase(),
    name: `LCV07 Item B ${stamp}`,
    accounts,
  });
  const itemC = await createSmokeItemCard({
    tenantId: context.tenantId,
    legalEntityId: context.legalEntityId,
    code: `LCV07C${stamp.slice(-5)}`.toUpperCase(),
    name: `LCV07 Item C ${stamp}`,
    accounts,
  });
  const itemD = await createSmokeItemCard({
    tenantId: context.tenantId,
    legalEntityId: context.legalEntityId,
    code: `LCV07D${stamp.slice(-5)}`.toUpperCase(),
    name: `LCV07 Item D ${stamp}`,
    accounts,
  });
  console.log(`\nLCV07 smoke start (stamp=${stamp})`);
  try {
    const sourceLookupFixture = await createSourceLookupFixtureBill({
      tenantId: context.tenantId,
      userId,
      legalEntityId: context.legalEntityId,
      counterpartyId,
      documentDate: baseDate,
      currencyCode: context.currencyCode,
      postingAccountId: accounts.expenseAccountId,
      stamp,
    });
    await runCheck("source lookup rejects Track 40 charge, stock, and fixed-asset source lines", async () => {
      const lookup = await listInventoryLandedCostSourceLineLookup({
        tenantId: context.tenantId,
        legalEntityId: context.legalEntityId,
        filters: {
          limit: 200,
          search: stamp,
        },
      });
      const eligibleRow = findLookupRowByDescription(
        lookup.rows,
        sourceLookupFixture.descriptions.eligible
      );
      const chargeRow = findLookupRowByDescription(
        lookup.rows,
        sourceLookupFixture.descriptions.charge
      );
      const stockRow = findLookupRowByDescription(
        lookup.rows,
        sourceLookupFixture.descriptions.stock
      );
      const fixedAssetRow = findLookupRowByDescription(
        lookup.rows,
        sourceLookupFixture.descriptions.fixedAsset
      );
      assert(eligibleRow?.eligible === true, "Expected eligible fixture source row to stay selectable");
      assert(
        chargeRow?.disabledReasonCode === "TRACK40_CHARGE_LINE",
        `Expected Track 40 charge line rejection, got ${chargeRow?.disabledReasonCode || "<none>"}`
      );
      assert(
        stockRow?.disabledReasonCode === "STOCK_AFFECTING_LINE_NOT_ELIGIBLE",
        `Expected stock-affecting line rejection, got ${stockRow?.disabledReasonCode || "<none>"}`
      );
      assert(
        fixedAssetRow?.disabledReasonCode === "FIXED_ASSET_LINE_NOT_ELIGIBLE",
        `Expected fixed-asset line rejection, got ${fixedAssetRow?.disabledReasonCode || "<none>"}`
      );
    });
    const receiptA = await createPostedReceipt({
      tenantId: context.tenantId,
      userId,
      legalEntityId: context.legalEntityId,
      counterpartyId,
      documentDate: addDays(baseDate, 1),
      currencyCode: context.currencyCode,
      itemCardId: itemA.id,
      warehouseId: centralWarehouse.id,
      quantity: 10,
      unitPriceTxn: 10,
      description: `LCV07 Receipt A ${stamp}`,
      postingAccountId: accounts.expenseAccountId,
      stamp,
      suffix: "receipt-a",
    });
    const freightA = await createPostedGeneralApBill({
      tenantId: context.tenantId,
      userId,
      legalEntityId: context.legalEntityId,
      counterpartyId,
      documentDate: addDays(baseDate, 2),
      currencyCode: context.currencyCode,
      amountTxn: 20,
      description: `LCV07 Freight A ${stamp}`,
      postingAccountId: accounts.expenseAccountId,
      stamp,
      suffix: "freight-a",
    });
    let voucherA = null;
    await runCheck("single posted receipt can receive separate landed-cost capitalization with AP-line-backed journal and source blocker", async () => {
      const preview = await previewInventoryLandedCostVoucher({
        payload: {
          tenantId: context.tenantId,
          legalEntityId: context.legalEntityId,
          postingDate: addDays(baseDate, 3),
          allocationMethod: "BY_QTY",
          ownershipScope: "CENTRAL",
          sourceLines: [
            {
              sourceCariDocumentLineId: freightA.line.id,
            },
          ],
          targets: [
            {
              sourceStockLinkId: receiptA.stockLink.id,
            },
          ],
        },
      });
      assert(
        amountsEqual(preview.sourceSummary.totalAppliedAmountBase, 20),
        `Preview source total should be 20, got ${preview.sourceSummary.totalAppliedAmountBase}`
      );
      assert(
        amountsEqual(preview.targetSummary.totalCapitalizationAmountBase, 20)
          && amountsEqual(preview.targetSummary.totalExpenseAdjustmentAmountBase, 0),
        "Single receipt preview should fully capitalize the landed cost"
      );
      voucherA = await createInventoryLandedCostVoucher({
        payload: {
          tenantId: context.tenantId,
          userId,
          legalEntityId: context.legalEntityId,
          postingDate: addDays(baseDate, 3),
          allocationMethod: "BY_QTY",
          ownershipScope: "CENTRAL",
          note: `LCV07 Voucher A ${stamp}`,
          sourceLines: [
            {
              sourceCariDocumentLineId: freightA.line.id,
            },
          ],
          targets: [
            {
              sourceStockLinkId: receiptA.stockLink.id,
            },
          ],
        },
      });
      assert(
        voucherA?.status === "POSTED" && toPositiveInt(voucherA?.voucherId),
        "Voucher A should post successfully"
      );
      const listResult = await listInventoryLandedCostVouchers({
        tenantId: context.tenantId,
        filters: {
          legalEntityId: context.legalEntityId,
          search: voucherA.voucherNo,
          limit: 50,
        },
      });
      const listRow = (listResult.rows || []).find(
        (row) => toPositiveInt(row?.voucherId) === toPositiveInt(voucherA.voucherId)
      );
      assert(listRow, "Voucher A should appear in landed-cost voucher list");
      assert(
        amountsEqual(listRow.capitalizedAmountBase, 20) && amountsEqual(listRow.consumedAmountBase, 0),
        "Voucher A list totals should show 20 capitalized and 0 consumed"
      );
      const detail = await getInventoryLandedCostVoucherById({
        tenantId: context.tenantId,
        voucherId: voucherA.voucherId,
      });
      assert(detail, "Voucher A detail should resolve");
      assert(
        detail?.journalAudit?.sourceLinkType === "STOCK_LANDED_COST_VOUCHER",
        "Voucher A detail must expose STOCK_LANDED_COST_VOUCHER drillback type"
      );
      const sourceLinks = await fetchJournalSourceLinks(voucherA.postedJournalEntryId);
      assert(
        sourceLinks.some(
          (row) =>            String(row.source_ref_type || "") === "STOCK_LANDED_COST_VOUCHER"
            && toPositiveInt(row.source_ref_id) === toPositiveInt(voucherA.voucherId)
        ),
        "Voucher A journal must link back to STOCK_LANDED_COST_VOUCHER"
      );
      const journalLines = await fetchJournalLines(voucherA.postedJournalEntryId);
      assert(journalLines.length === 2, `Voucher A journal should have 2 lines, got ${journalLines.length}`);
      assert(
        journalLines.some(
          (row) =>            toPositiveInt(row.account_id) === accounts.inventoryAssetAccountId
            && amountsEqual(row.debit_base, 20)
        ),
        "Voucher A journal must debit inventory asset"
      );
      assert(
        journalLines.some(
          (row) =>            toPositiveInt(row.account_id) === accounts.expenseAccountId
            && amountsEqual(row.credit_base, 20)
        ),
        "Voucher A journal must credit the AP source posting account snapshot"
      );
      let reverseBlockedError = null;
      try {
        await reverseCariPostedDocumentById({
          req: makeRequestContext({
            tenantId: context.tenantId,
            userId,
            stamp,
            suffix: "reverse-source-a-blocked",
          }),
          payload: {
            tenantId: context.tenantId,
            userId,
            documentId: freightA.postedRow.id,
            reason: "LCV07 source blocker test",
            reversalDate: addDays(baseDate, 4),
          },
          assertScopeAccess: allowAllScopes,
        });
      } catch (error) {
        reverseBlockedError = error;
      }
      assert(reverseBlockedError, "Expected source AP reversal to block while landed-cost voucher is active");
      assert(
        getErrorMessage(reverseBlockedError).includes("active landed-cost voucher source application"),
        `Unexpected source reversal blocker error: ${getErrorMessage(reverseBlockedError) || "<empty>"}`
      );
    });
    await runCheck("duplicate source AP line application is guarded once remaining unapplied amount reaches zero", async () => {
      let duplicateError = null;
      try {
        await previewInventoryLandedCostVoucher({
          payload: {
            tenantId: context.tenantId,
            legalEntityId: context.legalEntityId,
            postingDate: addDays(baseDate, 4),
            allocationMethod: "BY_QTY",
            ownershipScope: "CENTRAL",
            sourceLines: [
              {
                sourceCariDocumentLineId: freightA.line.id,
              },
            ],
            targets: [
              {
                sourceStockLinkId: receiptA.stockLink.id,
              },
            ],
          },
        });
      } catch (error) {
        duplicateError = error;
      }
      assert(duplicateError, "Expected duplicate source application preview to fail");
      assert(
        getErrorMessage(duplicateError).includes("remaining unapplied amount")
          || getErrorMessage(duplicateError).includes("no remaining unapplied base amount"),
        `Unexpected duplicate source application error: ${getErrorMessage(duplicateError) || "<empty>"}`
      );
    });
    await runCheck("posted landed-cost voucher reverses cleanly when no downstream dependency exists and then releases source AP reversal blocker", async () => {
      const reversal = await reverseInventoryLandedCostVoucher({
        payload: {
          tenantId: context.tenantId,
          userId,
          voucherId: voucherA.voucherId,
          reversalDate: addDays(baseDate, 4),
          reverseReason: "LCV07 voucher A reversal",
        },
      });
      assert(
        reversal?.status === "REVERSED" && toPositiveInt(reversal?.reversalJournalEntryId),
        "Voucher A should reverse successfully"
      );
      const sourceReverse = await reverseCariPostedDocumentById({
        req: makeRequestContext({
          tenantId: context.tenantId,
          userId,
          stamp,
          suffix: "reverse-source-a",
        }),
        payload: {
          tenantId: context.tenantId,
          userId,
          documentId: freightA.postedRow.id,
          reason: "LCV07 source reverse after voucher reverse",
          reversalDate: addDays(baseDate, 5),
        },
        assertScopeAccess: allowAllScopes,
      });
      assert(
        toPositiveInt(sourceReverse?.row?.id),
        "Source AP document should reverse after voucher reversal clears the blocker"
      );
    });
    const receiptB1 = await createPostedReceipt({
      tenantId: context.tenantId,
      userId,
      legalEntityId: context.legalEntityId,
      counterpartyId,
      documentDate: addDays(baseDate, 6),
      currencyCode: context.currencyCode,
      itemCardId: itemB.id,
      warehouseId: centralWarehouse.id,
      quantity: 10,
      unitPriceTxn: 10,
      description: `LCV07 Receipt B1 ${stamp}`,
      postingAccountId: accounts.expenseAccountId,
      stamp,
      suffix: "receipt-b1",
    });
    const receiptB2 = await createPostedReceipt({
      tenantId: context.tenantId,
      userId,
      legalEntityId: context.legalEntityId,
      counterpartyId,
      documentDate: addDays(baseDate, 7),
      currencyCode: context.currencyCode,
      itemCardId: itemB.id,
      warehouseId: centralWarehouse.id,
      quantity: 10,
      unitPriceTxn: 20,
      description: `LCV07 Receipt B2 ${stamp}`,
      postingAccountId: accounts.expenseAccountId,
      stamp,
      suffix: "receipt-b2",
    });
    const preVoucherIssueB = await createPostedIssueMovement({
      tenantId: context.tenantId,
      userId,
      legalEntityId: context.legalEntityId,
      counterpartyId,
      documentDate: addDays(baseDate, 8),
      currencyCode: context.currencyCode,
      itemCardId: itemB.id,
      warehouseId: centralWarehouse.id,
      quantity: 4,
      unitPriceTxn: 50,
      description: `LCV07 Pre-Voucher Issue B ${stamp}`,
      postingAccountId: accounts.revenueAccountId,
      stamp,
      suffix: "issue-b-pre",
    });
    const freightB = await createPostedGeneralApBill({
      tenantId: context.tenantId,
      userId,
      legalEntityId: context.legalEntityId,
      counterpartyId,
      documentDate: addDays(baseDate, 9),
      currencyCode: context.currencyCode,
      amountTxn: 60,
      description: `LCV07 Freight B ${stamp}`,
      postingAccountId: accounts.expenseAccountId,
      stamp,
      suffix: "freight-b",
    });
    let voucherB = null;
    await runCheck("multi-receipt landed-cost voucher splits capitalization vs consumed adjustment after partial prior issue", async () => {
      const preview = await previewInventoryLandedCostVoucher({
        payload: {
          tenantId: context.tenantId,
          legalEntityId: context.legalEntityId,
          postingDate: addDays(baseDate, 10),
          allocationMethod: "BY_QTY",
          ownershipScope: "CENTRAL",
          sourceLines: [
            {
              sourceCariDocumentLineId: freightB.line.id,
            },
          ],
          targets: [
            {
              sourceStockLinkId: receiptB1.stockLink.id,
            },
            {
              sourceStockLinkId: receiptB2.stockLink.id,
            },
          ],
        },
      });
      const previewB1 = (preview.targets || []).find(
        (row) => toPositiveInt(row?.sourceStockLinkId) === toPositiveInt(receiptB1.stockLink.id)
      );
      const previewB2 = (preview.targets || []).find(
        (row) => toPositiveInt(row?.sourceStockLinkId) === toPositiveInt(receiptB2.stockLink.id)
      );
      assert(previewB1 && previewB2, "Expected both receipt targets in preview B");
      assert(
        amountsEqual(previewB1.onHandQuantity, 6)
          && amountsEqual(previewB1.consumedQuantity, 4)
          && amountsEqual(previewB1.onHandAllocatedAmountBase, 18)
          && amountsEqual(previewB1.consumedAllocatedAmountBase, 12),
        "Receipt B1 preview split should be 6 on hand / 4 consumed with 18 capitalized / 12 consumed"
      );
      assert(
        amountsEqual(previewB2.onHandAllocatedAmountBase, 30)
          && amountsEqual(previewB2.consumedAllocatedAmountBase, 0),
        "Receipt B2 preview should stay fully on hand"
      );
      assert(
        amountsEqual(preview.targetSummary.totalCapitalizationAmountBase, 48)
          && amountsEqual(preview.targetSummary.totalExpenseAdjustmentAmountBase, 12),
        "Preview B totals should be 48 capitalized and 12 consumed"
      );
      voucherB = await createInventoryLandedCostVoucher({
        payload: {
          tenantId: context.tenantId,
          userId,
          legalEntityId: context.legalEntityId,
          postingDate: addDays(baseDate, 10),
          allocationMethod: "BY_QTY",
          ownershipScope: "CENTRAL",
          note: `LCV07 Voucher B ${stamp}`,
          sourceLines: [
            {
              sourceCariDocumentLineId: freightB.line.id,
            },
          ],
          targets: [
            {
              sourceStockLinkId: receiptB1.stockLink.id,
            },
            {
              sourceStockLinkId: receiptB2.stockLink.id,
            },
          ],
        },
      });
      const detail = await getInventoryLandedCostVoucherById({
        tenantId: context.tenantId,
        voucherId: voucherB.voucherId,
      });
      const targetB1 = findVoucherTargetByStockLink(detail, receiptB1.stockLink.id);
      const targetB2 = findVoucherTargetByStockLink(detail, receiptB2.stockLink.id);
      assert(targetB1 && targetB2, "Voucher B detail must include both targets");
      assert(
        amountsEqual(targetB1.onHandAllocatedAmountBase, 18)
          && amountsEqual(targetB1.consumedAllocatedAmountBase, 12),
        "Voucher B target 1 should persist partial-consumption split"
      );
      assert(
        amountsEqual(targetB2.onHandAllocatedAmountBase, 30)
          && amountsEqual(targetB2.consumedAllocatedAmountBase, 0),
        "Voucher B target 2 should persist full on-hand split"
      );
    });
    const postVoucherIssueB = await createPostedIssueMovement({
      tenantId: context.tenantId,
      userId,
      legalEntityId: context.legalEntityId,
      counterpartyId,
      documentDate: addDays(baseDate, 11),
      currencyCode: context.currencyCode,
      itemCardId: itemB.id,
      warehouseId: centralWarehouse.id,
      quantity: 5,
      unitPriceTxn: 50,
      description: `LCV07 Post-Voucher Issue B ${stamp}`,
      postingAccountId: accounts.revenueAccountId,
      stamp,
      suffix: "issue-b-post",
    });
    await runCheck("future issue valuation consumes landed-cost uplift and blocks voucher reversal until the issue is reversed", async () => {
      const detail = await getInventoryLandedCostVoucherById({
        tenantId: context.tenantId,
        voucherId: voucherB.voucherId,
      });
      const issueConsumption = findVoucherConsumption(
        detail,
        (row) => toPositiveInt(row?.consumingInventoryMovementId) === toPositiveInt(postVoucherIssueB.movement.id)
      );
      assert(issueConsumption, "Expected landed-cost consumption row for post-voucher issue");
      assert(
        amountsEqual(issueConsumption.allocatedAmountBaseConsumed, 15),
        `Expected issue landed-cost uplift consumption of 15, got ${issueConsumption?.allocatedAmountBaseConsumed}`
      );
      assert(
        detail?.uiStatus === "REVERSAL_BLOCKED"
          && Array.isArray(detail?.reversalDependencies)
          && detail.reversalDependencies.some(
            (row) =>              toPositiveInt(row?.dependentMovementId) === toPositiveInt(postVoucherIssueB.movement.id)
              && String(row?.dependencyType || "") === "ISSUE"
          ),
        "Voucher B detail should expose issue-based reversal blocker"
      );
      const listResult = await listInventoryLandedCostVouchers({
        tenantId: context.tenantId,
        filters: {
          legalEntityId: context.legalEntityId,
          search: voucherB.voucherNo,
          limit: 20,
        },
      });
      const listRow = (listResult.rows || []).find(
        (row) => toPositiveInt(row?.voucherId) === toPositiveInt(voucherB.voucherId)
      );
      assert(
        listRow?.uiStatus === "REVERSAL_BLOCKED",
        `Voucher B list uiStatus should be REVERSAL_BLOCKED, got ${listRow?.uiStatus || "<none>"}`
      );
      let reverseError = null;
      try {
        await reverseInventoryLandedCostVoucher({
          payload: {
            tenantId: context.tenantId,
            userId,
            voucherId: voucherB.voucherId,
            reversalDate: addDays(baseDate, 12),
            reverseReason: "LCV07 blocked voucher B reversal",
          },
        });
      } catch (error) {
        reverseError = error;
      }
      assert(reverseError, "Expected voucher B reversal to block while issue dependency is active");
      assert(
        getErrorMessage(reverseError).includes("capitalized landed-cost balances were later consumed or transferred"),
        `Unexpected voucher B reversal blocker error: ${getErrorMessage(reverseError) || "<empty>"}`
      );
    });
    await runCheck("issue reversal restores landed-cost open balances additively", async () => {
      await reverseInventoryMovementById({
        payload: {
          tenantId: context.tenantId,
          userId,
          movementId: postVoucherIssueB.movement.id,
          reversalDate: addDays(baseDate, 12),
          reason: "LCV07 reverse issue B",
        },
      });
      const detail = await getInventoryLandedCostVoucherById({
        tenantId: context.tenantId,
        voucherId: voucherB.voucherId,
      });
      const restoredConsumption = findVoucherConsumption(
        detail,
        (row) => toPositiveInt(row?.consumingInventoryMovementId) === toPositiveInt(postVoucherIssueB.movement.id)
      );
      assert(
        toPositiveInt(restoredConsumption?.restoredByInventoryMovementId),
        "Issue reversal should mark landed-cost consumption as restored"
      );
      const allocationB1 = findVoucherLayerAllocation(
        detail,
        (row) =>          toPositiveInt(row?.sourceStockLinkId) === toPositiveInt(receiptB1.stockLink.id)
          && String(row?.allocationRole || "") === "ON_HAND"
      );
      assert(allocationB1, "Voucher B should keep an on-hand allocation row for receipt B1");
      assert(
        amountsEqual(allocationB1.remainingAdjustedAmountBase, 18)
          && amountsEqual(allocationB1.remainingAdjustedQuantity, 6),
        "Issue reversal should restore receipt B1 landed-cost open balances to 18 / qty 6"
      );
    });
    const receiptC = await createPostedReceipt({
      tenantId: context.tenantId,
      userId,
      legalEntityId: context.legalEntityId,
      counterpartyId,
      documentDate: addDays(baseDate, 13),
      currencyCode: context.currencyCode,
      itemCardId: itemC.id,
      warehouseId: centralWarehouse.id,
      quantity: 10,
      unitPriceTxn: 10,
      description: `LCV07 Receipt C ${stamp}`,
      postingAccountId: accounts.expenseAccountId,
      stamp,
      suffix: "receipt-c",
    });
    let transferToBranch = await createInventoryTransfer({
      payload: {
        tenantId: context.tenantId,
        legalEntityId: context.legalEntityId,
        sourceWarehouseId: centralWarehouse.id,
        targetWarehouseId: branchWarehouse.id,
        transferDate: addDays(baseDate, 14),
        userId,
        note: `LCV07 Transfer to branch ${stamp}`,
        lines: [
          {
            itemCardId: itemC.id,
            quantityRequested: 10,
          },
        ],
      },
    });
    transferToBranch = await approveInventoryTransferById({
      payload: {
        tenantId: context.tenantId,
        transferId: transferToBranch.id,
        userId,
      },
    });
    transferToBranch = await shipInventoryTransferById({
      payload: {
        tenantId: context.tenantId,
        transferId: transferToBranch.id,
        userId,
      },
    });
    transferToBranch = await receiveInventoryTransferById({
      payload: {
        tenantId: context.tenantId,
        transferId: transferToBranch.id,
        userId,
      },
    });
    const customsC = await createPostedGeneralApBill({
      tenantId: context.tenantId,
      userId,
      legalEntityId: context.legalEntityId,
      counterpartyId,
      documentDate: addDays(baseDate, 15),
      currencyCode: context.currencyCode,
      amountTxn: 20,
      description: `LCV07 Customs C ${stamp}`,
      postingAccountId: accounts.expenseAccountId,
      stamp,
      suffix: "customs-c",
    });
    let voucherC = null;
    await runCheck("transfer-aware preview resolves descendant branch receipt context and posts OU-scoped voucher without blocked remainder", async () => {
      const targetLookup = await listInventoryLandedCostTargetLookup({
        tenantId: context.tenantId,
        legalEntityId: context.legalEntityId,
        filters: {
          ownershipScope: "OPERATING_UNIT",
          operatingUnitId: context.targetOuId,
          matchSelectedContextOnly: true,
          search: receiptC.postedRow.documentNo,
          limit: 50,
        },
      });
      const lookupRow = (targetLookup.rows || []).find(
        (row) => toPositiveInt(row?.sourceStockLinkId) === toPositiveInt(receiptC.stockLink.id)
      );
      assert(lookupRow, "Target lookup should surface original receipt anchor for branch context");
      assert(
        amountsEqual(lookupRow.currentOnHandQuantity, 10)
          && amountsEqual(lookupRow.currentConsumedQuantity, 0)
          && String(lookupRow.ownershipScope || "") === "OPERATING_UNIT"
          && toPositiveInt(lookupRow.operatingUnitId) === toPositiveInt(context.targetOuId),
        "Target lookup should resolve on-hand state against the descendant branch receipt context"
      );
      const preview = await previewInventoryLandedCostVoucher({
        payload: {
          tenantId: context.tenantId,
          legalEntityId: context.legalEntityId,
          postingDate: addDays(baseDate, 16),
          allocationMethod: "BY_QTY",
          ownershipScope: "OPERATING_UNIT",
          operatingUnitId: context.targetOuId,
          sourceLines: [
            {
              sourceCariDocumentLineId: customsC.line.id,
            },
          ],
          targets: [
            {
              sourceStockLinkId: receiptC.stockLink.id,
            },
          ],
        },
      });
      const previewTarget = (preview.targets || [])[0];
      assert(previewTarget, "Transfer-aware preview target missing");
      assert(
        amountsEqual(previewTarget.blockedAllocatedAmountBase, 0)
          && amountsEqual(previewTarget.onHandAllocatedAmountBase, 20)
          && (previewTarget.descendantLayerAllocations || []).some(
            (row) =>
              String(row?.allocationRole || "") === "ON_HAND"
              && toPositiveInt(row?.resolvedInventoryMovementId)
                === toPositiveInt(transferToBranch.lines?.[0]?.targetReceiptMovementId)
              && String(row?.ownershipScope || "") === "OPERATING_UNIT"
              && toPositiveInt(row?.operatingUnitId) === toPositiveInt(context.targetOuId)
          ),
        "Transfer-aware preview should fully capitalize into the descendant branch receipt without blocked remainder"
      );
      voucherC = await createInventoryLandedCostVoucher({
        payload: {
          tenantId: context.tenantId,
          userId,
          legalEntityId: context.legalEntityId,
          postingDate: addDays(baseDate, 16),
          allocationMethod: "BY_QTY",
          ownershipScope: "OPERATING_UNIT",
          operatingUnitId: context.targetOuId,
          note: `LCV07 Voucher C ${stamp}`,
          sourceLines: [
            {
              sourceCariDocumentLineId: customsC.line.id,
            },
          ],
          targets: [
            {
              sourceStockLinkId: receiptC.stockLink.id,
            },
          ],
        },
      });
      assert(voucherC?.status === "POSTED", "Voucher C should post successfully");
    });
    let transferBackToCentral = await createInventoryTransfer({
      payload: {
        tenantId: context.tenantId,
        legalEntityId: context.legalEntityId,
        sourceWarehouseId: branchWarehouse.id,
        targetWarehouseId: centralWarehouse.id,
        transferDate: addDays(baseDate, 17),
        userId,
        note: `LCV07 Transfer back ${stamp}`,
        lines: [
          {
            itemCardId: itemC.id,
            quantityRequested: 5,
          },
        ],
      },
    });
    transferBackToCentral = await approveInventoryTransferById({
      payload: {
        tenantId: context.tenantId,
        transferId: transferBackToCentral.id,
        userId,
      },
    });
    transferBackToCentral = await shipInventoryTransferById({
      payload: {
        tenantId: context.tenantId,
        transferId: transferBackToCentral.id,
        userId,
      },
    });
    transferBackToCentral = await receiveInventoryTransferById({
      payload: {
        tenantId: context.tenantId,
        transferId: transferBackToCentral.id,
        userId,
      },
    });
    await runCheck("transfer shipment consumes landed-cost uplift, transfer receipt recreates carry-forward balances, and transfer reversal restores them", async () => {
      const detailAfterTransfer = await getInventoryLandedCostVoucherById({
        tenantId: context.tenantId,
        voucherId: voucherC.voucherId,
      });
      const transferConsumption = findVoucherConsumption(
        detailAfterTransfer,
        (row) => toPositiveInt(row?.consumingInventoryTransferId) === toPositiveInt(transferBackToCentral.id)
      );
      assert(transferConsumption, "Expected landed-cost transfer consumption row after shipment");
      assert(
        amountsEqual(transferConsumption.allocatedAmountBaseConsumed, 10)
          && toPositiveInt(transferConsumption.carryForwardReceiptMovementId)
          && toPositiveInt(transferConsumption.carryForwardLayerAllocationId),
        "Transfer shipment should consume 10 landed-cost amount and create carry-forward lineage"
      );
      const carryForwardAllocation = await getLayerAllocationDbRow(
        transferConsumption.carryForwardLayerAllocationId
      );
      assert(carryForwardAllocation, "Carry-forward layer allocation row must exist");
      assert(
        amountsEqual(carryForwardAllocation.remaining_adjusted_amount_base, 10)
          && String(carryForwardAllocation.open_status || "") === "OPEN",
        "Transfer receipt should recreate an OPEN carry-forward landed-cost balance of 10"
      );
      const sourceAllocationBeforeReverse = findVoucherLayerAllocation(
        detailAfterTransfer,
        (row) => String(row?.allocationRole || "") === "ON_HAND"
      );
      assert(sourceAllocationBeforeReverse, "Voucher C should expose the original ON_HAND allocation row");
      assert(
        amountsEqual(sourceAllocationBeforeReverse.remainingAdjustedAmountBase, 10),
        "After transferring half the stock, the source landed-cost balance should retain 10 open amount"
      );
      let blockedReverseError = null;
      try {
        await reverseInventoryLandedCostVoucher({
          payload: {
            tenantId: context.tenantId,
            userId,
            voucherId: voucherC.voucherId,
            reversalDate: addDays(baseDate, 18),
            reverseReason: "LCV07 blocked voucher C reversal",
          },
        });
      } catch (error) {
        blockedReverseError = error;
      }
      assert(blockedReverseError, "Expected voucher C reversal to block while transfer dependency is active");
      assert(
        getErrorMessage(blockedReverseError).includes("capitalized landed-cost balances were later consumed or transferred"),
        `Unexpected transfer dependency reversal blocker: ${getErrorMessage(blockedReverseError) || "<empty>"}`
      );
      await reverseInventoryTransferById({
        payload: {
          tenantId: context.tenantId,
          transferId: transferBackToCentral.id,
          userId,
          reverseReason: "LCV07 reverse transfer back",
        },
      });
      const detailAfterTransferReverse = await getInventoryLandedCostVoucherById({
        tenantId: context.tenantId,
        voucherId: voucherC.voucherId,
      });
      const restoredTransferConsumption = findVoucherConsumption(
        detailAfterTransferReverse,
        (row) => toPositiveInt(row?.consumingInventoryTransferId) === toPositiveInt(transferBackToCentral.id)
      );
      assert(
        toPositiveInt(restoredTransferConsumption?.restoredByInventoryMovementId),
        "Transfer reversal should restore the landed-cost transfer consumption row"
      );
      const sourceAllocationAfterReverse = findVoucherLayerAllocation(
        detailAfterTransferReverse,
        (row) => String(row?.allocationRole || "") === "ON_HAND"
      );
      assert(
        amountsEqual(sourceAllocationAfterReverse?.remainingAdjustedAmountBase, 20),
        "Transfer reversal should restore the original branch landed-cost balance to 20"
      );
      const carryForwardAfterReverse = await getLayerAllocationDbRow(
        transferConsumption.carryForwardLayerAllocationId
      );
      assert(
        amountsEqual(carryForwardAfterReverse?.remaining_adjusted_amount_base, 0)
          && String(carryForwardAfterReverse?.open_status || "") === "CLOSED",
        "Transfer reversal should close the carry-forward landed-cost balance"
      );
    });
    await runCheck("cross-currency landed-cost preview stays base-authoritative", async () => {
      const foreignDate = addDays(baseDate, 19);
      await insertFxRate({
        tenantId: context.tenantId,
        rateDate: foreignDate,
        fromCurrencyCode: "EUR",
        toCurrencyCode: context.currencyCode,
        rate: 1.2,
      });
      const receiptD = await createPostedReceipt({
        tenantId: context.tenantId,
        userId,
        legalEntityId: context.legalEntityId,
        counterpartyId,
        documentDate: foreignDate,
        currencyCode: context.currencyCode,
        itemCardId: itemD.id,
        warehouseId: centralWarehouse.id,
        quantity: 5,
        unitPriceTxn: 10,
        description: `LCV07 Receipt D ${stamp}`,
        postingAccountId: accounts.expenseAccountId,
        stamp,
        suffix: "receipt-d",
      });
      const foreignFreight = await createPostedGeneralApBill({
        tenantId: context.tenantId,
        userId,
        legalEntityId: context.legalEntityId,
        counterpartyId,
        documentDate: foreignDate,
        currencyCode: "EUR",
        fxRate: 1.2,
        amountTxn: 10,
        description: `LCV07 Foreign Freight ${stamp}`,
        postingAccountId: accounts.expenseAccountId,
        stamp,
        suffix: "freight-foreign",
      });
      const preview = await previewInventoryLandedCostVoucher({
        payload: {
          tenantId: context.tenantId,
          legalEntityId: context.legalEntityId,
          postingDate: addDays(baseDate, 20),
          allocationMethod: "BY_QTY",
          ownershipScope: "CENTRAL",
          sourceLines: [
            {
              sourceCariDocumentLineId: foreignFreight.line.id,
            },
          ],
          targets: [
            {
              sourceStockLinkId: receiptD.stockLink.id,
            },
          ],
        },
      });
      const previewSourceLine = preview.sourceSummary.lines?.[0] || null;
      assert(
        String(previewSourceLine?.currencyCode || "") === "EUR"
          && amountsEqual(previewSourceLine?.appliedAmountTxn, 10)
          && amountsEqual(previewSourceLine?.appliedAmountBase, 12),
        "Cross-currency source application should preserve EUR txn amount and 12 base amount"
      );
      assert(
        amountsEqual(preview.targetSummary.totalAllocatedAmountBase, 12)
          && amountsEqual(preview.targets?.[0]?.allocatedAmountBase, 12),
        "Cross-currency preview should allocate authoritative base amount 12"
      );
    });
    await runCheck("cross-legal-entity source or target selection is rejected at preview time", async () => {
      const otherLegalEntityId = await createSecondaryLegalEntity({
        tenantId: context.tenantId,
        sourceLegalEntityId: context.legalEntityId,
        stamp,
      });
      let crossEntityError = null;
      try {
        await previewInventoryLandedCostVoucher({
          payload: {
            tenantId: context.tenantId,
            legalEntityId: otherLegalEntityId,
            postingDate: addDays(baseDate, 21),
            allocationMethod: "BY_QTY",
            ownershipScope: "CENTRAL",
            sourceLines: [
              {
                sourceCariDocumentLineId: freightB.line.id,
              },
            ],
            targets: [
              {
                sourceStockLinkId: receiptB1.stockLink.id,
              },
            ],
          },
        });
      } catch (error) {
        crossEntityError = error;
      }
      assert(crossEntityError, "Expected cross-legal-entity preview to be rejected");
      const errorMessage = getErrorMessage(crossEntityError);
      assert(
        errorMessage.includes("eligible posted AP source line")
          || errorMessage.includes("eligible posted AP source lines")
          || errorMessage.includes("eligible posted receipt target"),
        `Unexpected cross-legal-entity rejection message: ${errorMessage || "<empty>"}`
      );
    });
    console.log(`\nLCV07 smoke passed (${passed} checks).`);
  } finally {
    await closePool();
  }
}
main().catch((error) => {
  console.error("\nLCV07 smoke failed.");
  console.error(error);
  process.exitCode = 1;
});
