import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, query } from "../src/db.js";
import { assertLegalEntityBelongsToTenant } from "../src/tenantGuards.js";
import { createItemCard } from "../src/services/item.card.service.js";
import {
  approveInventoryTransferById,
  cancelInventoryTransferById,
  createInventoryTransfer,
  receiveInventoryTransferById,
  reverseInventoryTransferById,
  shipInventoryTransferById,
} from "../src/services/inventory.transfer.service.js";
import {
  createInventoryMovementFromStockLink,
  createInventoryWarehouse,
} from "../src/services/inventory.service.js";
import { upsertOperatingUnit } from "../src/services/org.write.service.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertClose(actual, expected, message, tolerance = 0.000001) {
  if (Math.abs(Number(actual || 0) - Number(expected || 0)) > tolerance) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

async function assertThrowsAsync(fn, expectedMessage) {
  let thrown = null;
  try {
    await fn();
  } catch (error) {
    thrown = error;
  }
  assert(thrown, `Expected async error containing "${expectedMessage}"`);
  const message = String(thrown?.message || thrown || "");
  assert(
    message.includes(expectedMessage),
    `Expected async error containing "${expectedMessage}", got "${message}"`
  );
}

function uniqueCode(prefix) {
  const token = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return `${prefix}${token}`.slice(0, 40).toUpperCase();
}

function todayDateOnly() {
  return new Date().toISOString().slice(0, 10);
}

function buildReq(tenantId, userId) {
  return {
    user: {
      tenantId,
      userId,
    },
    body: {},
    query: {},
  };
}

async function loadSmokeContext() {
  const today = todayDateOnly();
  const result = await query(
    `SELECT
        le.tenant_id,
        le.id AS legal_entity_id,
        le.code AS legal_entity_code,
        le.functional_currency_code,
        coa.id AS coa_id,
        u.id AS user_id
       FROM legal_entities le
       JOIN charts_of_accounts coa
         ON coa.tenant_id = le.tenant_id
        AND coa.legal_entity_id = le.id
        AND coa.scope = 'LEGAL_ENTITY'
       JOIN users u
         ON u.tenant_id = le.tenant_id
       JOIN books b
         ON b.tenant_id = le.tenant_id
        AND b.legal_entity_id = le.id
       JOIN fiscal_periods fp
         ON fp.calendar_id = b.calendar_id
       LEFT JOIN period_statuses ps
         ON ps.book_id = b.id
        AND ps.fiscal_period_id = fp.id
      WHERE le.status = 'ACTIVE'
        AND ? BETWEEN fp.start_date AND fp.end_date
        AND (ps.status IS NULL OR ps.status = 'OPEN')
      ORDER BY le.id ASC,
        CASE WHEN b.book_type = 'LOCAL' THEN 0 ELSE 1 END
      LIMIT 1`,
    [today]
  );
  const row = result.rows?.[0] || null;
  assert(row, "Expected one active legal entity with an open fiscal period covering today");
  return {
    tenantId: Number(row.tenant_id),
    legalEntityId: Number(row.legal_entity_id),
    legalEntityCode: String(row.legal_entity_code || ""),
    functionalCurrencyCode: String(row.functional_currency_code || "").trim().toUpperCase(),
    coaId: Number(row.coa_id),
    userId: Number(row.user_id),
    postingDate: today,
  };
}

async function createLeafAccount({
  coaId,
  code,
  name,
  accountType,
  normalSide,
}) {
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
      )
     VALUES (?, ?, ?, ?, ?, TRUE, NULL, TRUE)`,
    [coaId, code, name, accountType, normalSide]
  );
  const id = Number(result.rows?.insertId || 0);
  assert(id > 0, `Expected account insert id for ${code}`);
  return { id, code, name };
}

async function insertReceiptCostLayer({
  tenantId,
  legalEntityId,
  warehouseId,
  itemCardId,
  movementDate,
  quantity,
  unitCost,
  currencyCode,
  note,
}) {
  const normalizedQuantity = Number(Number(quantity).toFixed(6));
  const normalizedUnitCost = Number(Number(unitCost).toFixed(6));
  const totalCost = Number((normalizedQuantity * normalizedUnitCost).toFixed(6));
  const movementResult = await query(
    `INSERT INTO inventory_movements (
        tenant_id, legal_entity_id, warehouse_id, item_card_id, movement_type, source_type,
        source_stock_link_id, source_document_type, source_document_id, source_document_line_id,
        movement_date, quantity, unit_cost_txn, unit_cost_base, total_cost_txn, total_cost_base,
        currency_code, valuation_status, note
     ) VALUES (?, ?, ?, ?, 'RECEIPT', 'MANUAL', NULL, 'OU06_TEST_RECEIPT', NULL, NULL, ?, ?, ?, ?, ?, ?, ?, 'VALUED', ?)`,
    [
      tenantId,
      legalEntityId,
      warehouseId,
      itemCardId,
      movementDate,
      normalizedQuantity,
      normalizedUnitCost,
      normalizedUnitCost,
      totalCost,
      totalCost,
      currencyCode,
      note || null,
    ]
  );
  const movementId = Number(movementResult.rows?.insertId || 0);
  assert(movementId > 0, "Expected receipt movement insert id");
  await query(
    `INSERT INTO inventory_cost_layers (
        tenant_id, legal_entity_id, warehouse_id, item_card_id, source_movement_id,
        valuation_method, layer_status, currency_code, quantity_in, quantity_remaining,
        unit_cost_txn, unit_cost_base, total_cost_txn, total_cost_base
     ) VALUES (?, ?, ?, ?, ?, 'FIFO', 'OPEN', ?, ?, ?, ?, ?, ?, ?)`,
    [
      tenantId,
      legalEntityId,
      warehouseId,
      itemCardId,
      movementId,
      currencyCode,
      normalizedQuantity,
      normalizedQuantity,
      normalizedUnitCost,
      normalizedUnitCost,
      totalCost,
      totalCost,
    ]
  );
  return movementId;
}

async function sumRemainingLayerQuantity(warehouseId, itemCardId) {
  const result = await query(
    `SELECT COALESCE(SUM(quantity_remaining), 0) AS total
       FROM inventory_cost_layers
      WHERE warehouse_id = ?
        AND item_card_id = ?`,
    [warehouseId, itemCardId]
  );
  return Number(result.rows?.[0]?.total || 0);
}

async function loadMovementRow(movementId) {
  const result = await query(
    `SELECT id, movement_type, warehouse_id, reversal_of_movement_id, reversed_at
       FROM inventory_movements
      WHERE id = ?
      LIMIT 1`,
    [movementId]
  );
  return result.rows?.[0] || null;
}

async function loadReversalMovementByOriginalId(originalMovementId) {
  const result = await query(
    `SELECT id, movement_type, warehouse_id, reversal_of_movement_id
       FROM inventory_movements
      WHERE reversal_of_movement_id = ?
      ORDER BY id DESC
      LIMIT 1`,
    [originalMovementId]
  );
  return result.rows?.[0] || null;
}

async function loadJournalRow(journalEntryId) {
  const result = await query(
    `SELECT id, status, reversal_journal_entry_id, reverse_reason
       FROM journal_entries
      WHERE id = ?
      LIMIT 1`,
    [journalEntryId]
  );
  return result.rows?.[0] || null;
}

async function loadJournalSourceLink(journalEntryId, sourceRefId) {
  const result = await query(
    `SELECT source_ref_type, source_ref_id, link_role
       FROM journal_source_links
      WHERE journal_entry_id = ?
        AND source_ref_type = 'INVENTORY_TRANSFER'
        AND source_ref_id = ?
      LIMIT 1`,
    [journalEntryId, sourceRefId]
  );
  return result.rows?.[0] || null;
}

async function createCounterpartyFixture({
  tenantId,
  legalEntityId,
  currencyCode,
}) {
  const code = uniqueCode("OU06CP");
  const result = await query(
    `INSERT INTO counterparties (
        tenant_id, legal_entity_id, code, name, is_customer, is_vendor, default_currency_code, status
      )
      VALUES (?, ?, ?, ?, TRUE, FALSE, ?, 'ACTIVE')`,
    [tenantId, legalEntityId, code, `OU06 Counterparty ${code}`, currencyCode]
  );
  const id = Number(result.rows?.insertId || 0);
  assert(id > 0, "Expected counterparty fixture id");
  return { id, code };
}

async function loadStockLinkForDocument(documentId) {
  const result = await query(
    `SELECT id, cari_document_line_id, link_status, inventory_movement_id
       FROM cari_document_line_stock_links
      WHERE cari_document_id = ?
      ORDER BY id ASC
      LIMIT 1`,
    [documentId]
  );
  return result.rows?.[0] || null;
}

async function createApprovedTransfer({
  tenantId,
  userId,
  legalEntityId,
  transferDate,
  sourceWarehouseId,
  targetWarehouseId,
  itemCardId,
  quantityRequested,
  note,
}) {
  const created = await createInventoryTransfer({
    payload: {
      tenantId,
      userId,
      legalEntityId,
      transferDate,
      sourceWarehouseId,
      targetWarehouseId,
      note: note || null,
      lines: [
        {
          itemCardId,
          quantityRequested: Number(quantityRequested).toFixed(6),
        },
      ],
    },
  });
  return approveInventoryTransferById({
    payload: {
      tenantId,
      userId,
      transferId: Number(created.id),
    },
  });
}

async function createOuScopedIssueDraft({
  tenantId,
  userId,
  legalEntityId,
  operatingUnitId,
  counterpartyId,
  itemCardId,
  currencyCode,
  documentDate,
}) {
  const documentNo = uniqueCode("OU06DOC");
  const fiscalYear = Number(String(documentDate || "").slice(0, 4));
  const counterpartyResult = await query(
    `SELECT code, name
       FROM counterparties
      WHERE tenant_id = ?
        AND legal_entity_id = ?
        AND id = ?
      LIMIT 1`,
    [tenantId, legalEntityId, counterpartyId]
  );
  const counterpartyRow = counterpartyResult.rows?.[0] || null;
  assert(counterpartyRow, "Expected counterparty snapshot for bypass draft");
  const documentResult = await query(
    `INSERT INTO cari_documents (
        tenant_id, legal_entity_id, operating_unit_id, counterparty_id, payment_term_id,
        direction, document_type, sequence_namespace, fiscal_year, sequence_no, document_no,
        status, document_date, due_date, amount_txn, amount_base, subtotal_amount_txn,
        subtotal_amount_base, tax_amount_txn, tax_amount_base, gross_amount_txn, gross_amount_base,
        open_amount_txn, open_amount_base, currency_code, fx_rate, counterparty_code_snapshot,
        counterparty_name_snapshot, payment_term_snapshot, due_date_snapshot, currency_code_snapshot,
        fx_rate_snapshot
      )
      VALUES (?, ?, ?, ?, NULL, 'AR', 'INVOICE', 'CARI_AR', ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, 1, ?, ?, NULL, ?, ?, 1)`,
    [
      tenantId,
      legalEntityId,
      operatingUnitId,
      counterpartyId,
      fiscalYear,
      Number(`${Date.now()}`.slice(-6)),
      documentNo,
      documentDate,
      documentDate,
      100,
      100,
      100,
      100,
      100,
      100,
      100,
      100,
      currencyCode,
      String(counterpartyRow.code || ""),
      String(counterpartyRow.name || ""),
      documentDate,
      currencyCode,
    ]
  );
  const documentId = Number(documentResult.rows?.insertId || 0);
  assert(documentId > 0, "Expected bypass draft document id");
  const lineResult = await query(
    `INSERT INTO cari_document_lines (
        tenant_id, legal_entity_id, cari_document_id, line_no, line_kind, description,
        item_card_id, quantity, unit_price_txn, line_net_amount_txn, line_tax_amount_txn,
        line_gross_amount_txn, line_net_amount_base, line_tax_amount_base, line_gross_amount_base,
        posting_account_id, tax_category_code, stock_impact_mode
      )
      VALUES (?, ?, ?, 1, 'STANDARD', ?, ?, 1, 100, 100, 0, 100, 100, 0, 100, NULL, NULL, 'ISSUE_PENDING')`,
    [tenantId, legalEntityId, documentId, "OU06 bypass mismatch", itemCardId]
  );
  const lineId = Number(lineResult.rows?.insertId || 0);
  assert(lineId > 0, "Expected bypass draft line id");
  await query(
    `INSERT INTO cari_document_line_stock_links (
        tenant_id, legal_entity_id, cari_document_id, cari_document_line_id, item_card_id,
        direction, stock_impact_mode, link_status, requested_quantity, posted_net_amount_txn,
        posted_net_amount_base
      )
      VALUES (?, ?, ?, ?, ?, 'AR', 'ISSUE_PENDING', 'PENDING', 1, 100, 100)`,
    [tenantId, legalEntityId, documentId, lineId, itemCardId]
  );
  return {
    id: documentId,
    userId,
  };
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const [inventoryServiceSource, transferServiceSource, transfersPageSource, inventoryApiSource] =
    await Promise.all([
      readFile(path.resolve(root, "src/services/inventory.service.js"), "utf8"),
      readFile(path.resolve(root, "src/services/inventory.transfer.service.js"), "utf8"),
      readFile(
        path.resolve(root, "../frontend/src/pages/inventory/InventoryTransfersPage.jsx"),
        "utf8"
      ),
      readFile(path.resolve(root, "../frontend/src/api/inventory.js"), "utf8"),
    ]);

  assert(
    inventoryServiceSource.includes("Cross-context stock movement must use inventory transfer workflow"),
    "Inventory service should hard-block generic cross-context stock movement bypass"
  );
  assert(
    transferServiceSource.includes("assertTransferCancelableWithoutArtifactsTx") &&
      transferServiceSource.includes("reverseTransferJournalTx") &&
      transferServiceSource.includes("status = 'REVERSED'"),
    "Transfer service should enforce cancel discipline and additive reversal flow"
  );
  assert(
    transfersPageSource.includes("cancelInventoryTransfer(transferId") &&
      transfersPageSource.includes("reverseInventoryTransfer(transferId") &&
      transfersPageSource.includes("runTransferAction(action.key)") &&
      inventoryApiSource.includes("/transfers/${transferId}/cancel") &&
      inventoryApiSource.includes("/transfers/${transferId}/reverse"),
    "Frontend should expose cancel and reverse transfer actions"
  );

  const context = await loadSmokeContext();
  const req = buildReq(context.tenantId, context.userId);
  const createdAccountIds = [];
  const createdUnitIds = [];
  const warehouseIds = [];
  const itemCardIds = [];
  const counterpartyIds = [];
  const documentIds = [];
  const transferIds = [];
  const journalEntryIds = [];
  const issueMovementIds = [];
  const costLayerMovementIds = [];
  const allMovementIds = [];

  try {
    const itemAccounts = {
      inventoryAsset: await createLeafAccount({
        coaId: context.coaId,
        code: uniqueCode("OU06INV"),
        name: "OU06 Inventory Asset",
        accountType: "ASSET",
        normalSide: "DEBIT",
      }),
      inventoryTransit: await createLeafAccount({
        coaId: context.coaId,
        code: uniqueCode("OU06TRN"),
        name: "OU06 Inventory Transit",
        accountType: "ASSET",
        normalSide: "DEBIT",
      }),
      sales: await createLeafAccount({
        coaId: context.coaId,
        code: uniqueCode("OU06SAL"),
        name: "OU06 Sales",
        accountType: "REVENUE",
        normalSide: "CREDIT",
      }),
      purchase: await createLeafAccount({
        coaId: context.coaId,
        code: uniqueCode("OU06PUR"),
        name: "OU06 Purchase",
        accountType: "EXPENSE",
        normalSide: "DEBIT",
      }),
      cogs: await createLeafAccount({
        coaId: context.coaId,
        code: uniqueCode("OU06COG"),
        name: "OU06 COGS",
        accountType: "EXPENSE",
        normalSide: "DEBIT",
      }),
    };
    const unitAccounts = {
      centralDueFrom: await createLeafAccount({
        coaId: context.coaId,
        code: uniqueCode("OU06CDF"),
        name: "OU06 Central Due From",
        accountType: "ASSET",
        normalSide: "DEBIT",
      }),
      centralDueTo: await createLeafAccount({
        coaId: context.coaId,
        code: uniqueCode("OU06CDT"),
        name: "OU06 Central Due To",
        accountType: "LIABILITY",
        normalSide: "CREDIT",
      }),
      ouDueFromCentral: await createLeafAccount({
        coaId: context.coaId,
        code: uniqueCode("OU06ODF"),
        name: "OU06 OU Due From Central",
        accountType: "ASSET",
        normalSide: "DEBIT",
      }),
      ouDueToCentral: await createLeafAccount({
        coaId: context.coaId,
        code: uniqueCode("OU06ODT"),
        name: "OU06 OU Due To Central",
        accountType: "LIABILITY",
        normalSide: "CREDIT",
      }),
    };
    createdAccountIds.push(
      itemAccounts.inventoryAsset.id,
      itemAccounts.inventoryTransit.id,
      itemAccounts.sales.id,
      itemAccounts.purchase.id,
      itemAccounts.cogs.id,
      unitAccounts.centralDueFrom.id,
      unitAccounts.centralDueTo.id,
      unitAccounts.ouDueFromCentral.id,
      unitAccounts.ouDueToCentral.id
    );

    const unit = await upsertOperatingUnit({
      req,
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      code: uniqueCode("OU06OU"),
      name: "OU06 Branch",
      unitType: "BRANCH",
      hasSubledger: false,
      centralDueFromAccountId: unitAccounts.centralDueFrom.id,
      centralDueToAccountId: unitAccounts.centralDueTo.id,
      ouDueFromCentralAccountId: unitAccounts.ouDueFromCentral.id,
      ouDueToCentralAccountId: unitAccounts.ouDueToCentral.id,
      assertLegalEntityBelongsToTenant,
      assertScopeAccess: () => {},
    });
    createdUnitIds.push(unit.id);

    const warehouses = {
      centralSource: await createInventoryWarehouse({
        payload: {
          tenantId: context.tenantId,
          userId: context.userId,
          legalEntityId: context.legalEntityId,
          ownershipScope: "CENTRAL",
          operatingUnitId: null,
          code: uniqueCode("OU06CS"),
          name: "OU06 Central Source",
          status: "ACTIVE",
        },
      }),
      ouTarget: await createInventoryWarehouse({
        payload: {
          tenantId: context.tenantId,
          userId: context.userId,
          legalEntityId: context.legalEntityId,
          ownershipScope: "OPERATING_UNIT",
          operatingUnitId: unit.id,
          code: uniqueCode("OU06OT"),
          name: "OU06 OU Target",
          status: "ACTIVE",
        },
      }),
    };
    warehouseIds.push(Number(warehouses.centralSource.id), Number(warehouses.ouTarget.id));

    const stockedItem = await createItemCard({
      payload: {
        tenantId: context.tenantId,
        legalEntityId: context.legalEntityId,
        code: uniqueCode("OU06ITM"),
        name: "OU06 Stocked Item",
        itemType: "STOCK_ITEM",
        defaultSalesAccountId: itemAccounts.sales.id,
        defaultPurchaseAccountId: itemAccounts.purchase.id,
        inventoryAssetAccountId: itemAccounts.inventoryAsset.id,
        inventoryTransitAccountId: itemAccounts.inventoryTransit.id,
        defaultCogsAccountId: itemAccounts.cogs.id,
        status: "ACTIVE",
      },
    });
    itemCardIds.push(Number(stockedItem.id));

    const seededReceiptMovementId = await insertReceiptCostLayer({
      tenantId: context.tenantId,
      userId: context.userId,
      legalEntityId: context.legalEntityId,
      warehouseId: Number(warehouses.centralSource.id),
      itemCardId: Number(stockedItem.id),
      movementDate: context.postingDate,
      quantity: 20,
      unitCost: 10,
      currencyCode: context.functionalCurrencyCode,
      note: "OU06 seeded source layer",
    });
    costLayerMovementIds.push(seededReceiptMovementId);
    allMovementIds.push(seededReceiptMovementId);

    const cancelTransfer = await createApprovedTransfer({
      tenantId: context.tenantId,
      userId: context.userId,
      legalEntityId: context.legalEntityId,
      transferDate: context.postingDate,
      sourceWarehouseId: Number(warehouses.centralSource.id),
      targetWarehouseId: Number(warehouses.ouTarget.id),
      itemCardId: Number(stockedItem.id),
      quantityRequested: 2,
      note: "OU06 cancel",
    });
    transferIds.push(Number(cancelTransfer.id));
    const canceled = await cancelInventoryTransferById({
      payload: {
        tenantId: context.tenantId,
        userId: context.userId,
        transferId: Number(cancelTransfer.id),
        cancelReason: "OU06 pre-shipment cancel",
      },
    });
    assert(
      canceled.status === "CANCELLED" &&
        Number(canceled.canceledByUserId) === Number(context.userId) &&
        canceled.cancelReason === "OU06 pre-shipment cancel" &&
        !Number(canceled.shipmentJournalEntryId || 0),
      "Cancel should work only before shipment and persist cancel metadata"
    );

    const inTransitTransfer = await createApprovedTransfer({
      tenantId: context.tenantId,
      userId: context.userId,
      legalEntityId: context.legalEntityId,
      transferDate: context.postingDate,
      sourceWarehouseId: Number(warehouses.centralSource.id),
      targetWarehouseId: Number(warehouses.ouTarget.id),
      itemCardId: Number(stockedItem.id),
      quantityRequested: 4,
      note: "OU06 in-transit reverse",
    });
    transferIds.push(Number(inTransitTransfer.id));
    const sourceQtyBeforeShipmentReverse = await sumRemainingLayerQuantity(
      Number(warehouses.centralSource.id),
      Number(stockedItem.id)
    );
    const inTransitShipped = await shipInventoryTransferById({
      payload: {
        tenantId: context.tenantId,
        userId: context.userId,
        transferId: Number(inTransitTransfer.id),
      },
    });
    const inTransitIssueMovementId = Number(inTransitShipped.lines?.[0]?.sourceIssueMovementId || 0);
    issueMovementIds.push(inTransitIssueMovementId);
    allMovementIds.push(inTransitIssueMovementId);
    journalEntryIds.push(Number(inTransitShipped.shipmentJournalEntryId));
    const sourceQtyAfterShipment = await sumRemainingLayerQuantity(
      Number(warehouses.centralSource.id),
      Number(stockedItem.id)
    );
    assertClose(
      sourceQtyBeforeShipmentReverse - sourceQtyAfterShipment,
      4,
      "Shipment should reduce source quantity before in-transit reversal"
    );

    const inTransitReversed = await reverseInventoryTransferById({
      payload: {
        tenantId: context.tenantId,
        userId: context.userId,
        transferId: Number(inTransitTransfer.id),
        reverseReason: "OU06 reverse in transit",
      },
    });
    journalEntryIds.push(Number(inTransitReversed.reversalJournalEntryId));
    assert(
      inTransitReversed.status === "REVERSED" &&
        Number(inTransitReversed.reversedByUserId) === Number(context.userId) &&
        inTransitReversed.reverseReason === "OU06 reverse in transit" &&
        Number(inTransitReversed.reversalJournalEntryId) > 0,
      "In-transit reverse should mark the transfer reversed and persist reversal metadata"
    );
    const sourceQtyAfterInTransitReverse = await sumRemainingLayerQuantity(
      Number(warehouses.centralSource.id),
      Number(stockedItem.id)
    );
    assertClose(
      sourceQtyAfterInTransitReverse,
      sourceQtyBeforeShipmentReverse,
      "In-transit reverse should fully restore source warehouse stock"
    );
    const inTransitIssueRow = await loadMovementRow(inTransitIssueMovementId);
    assert(inTransitIssueRow?.reversed_at, "In-transit reverse should mark shipment issue reversed");
    const inTransitReturnMovement = await loadReversalMovementByOriginalId(inTransitIssueMovementId);
    assert(
      Number(inTransitReturnMovement?.id || 0) > 0 &&
        String(inTransitReturnMovement?.movement_type || "").toUpperCase() === "ADJUSTMENT_IN",
      "In-transit reverse should create an additive source return movement"
    );
    allMovementIds.push(Number(inTransitReturnMovement?.id || 0));
    const inTransitShipmentJournal = await loadJournalRow(Number(inTransitShipped.shipmentJournalEntryId));
    assert(
      String(inTransitShipmentJournal?.status || "").toUpperCase() === "REVERSED" &&
        Number(inTransitShipmentJournal?.reversal_journal_entry_id || 0) ===
          Number(inTransitReversed.reversalJournalEntryId),
      "In-transit reverse should reverse the shipment journal and link the reversal journal"
    );
    const inTransitJournalLink = await loadJournalSourceLink(
      Number(inTransitReversed.reversalJournalEntryId),
      Number(inTransitTransfer.id)
    );
    assert(
      inTransitJournalLink?.source_ref_type === "INVENTORY_TRANSFER",
      "In-transit reversal journal should link back to the transfer header"
    );
    const receivedTransfer = await createApprovedTransfer({
      tenantId: context.tenantId,
      userId: context.userId,
      legalEntityId: context.legalEntityId,
      transferDate: context.postingDate,
      sourceWarehouseId: Number(warehouses.centralSource.id),
      targetWarehouseId: Number(warehouses.ouTarget.id),
      itemCardId: Number(stockedItem.id),
      quantityRequested: 5,
      note: "OU06 received reverse",
    });
    transferIds.push(Number(receivedTransfer.id));
    const sourceQtyBeforeReceivedCycle = await sumRemainingLayerQuantity(
      Number(warehouses.centralSource.id),
      Number(stockedItem.id)
    );
    const targetQtyBeforeReceivedCycle = await sumRemainingLayerQuantity(
      Number(warehouses.ouTarget.id),
      Number(stockedItem.id)
    );
    const receivedShipped = await shipInventoryTransferById({
      payload: {
        tenantId: context.tenantId,
        userId: context.userId,
        transferId: Number(receivedTransfer.id),
      },
    });
    const receivedIssueMovementId = Number(receivedShipped.lines?.[0]?.sourceIssueMovementId || 0);
    issueMovementIds.push(receivedIssueMovementId);
    allMovementIds.push(receivedIssueMovementId);
    journalEntryIds.push(Number(receivedShipped.shipmentJournalEntryId));
    const receivedCompleted = await receiveInventoryTransferById({
      payload: {
        tenantId: context.tenantId,
        userId: context.userId,
        transferId: Number(receivedTransfer.id),
      },
    });
    const receivedReceiptMovementId = Number(
      receivedCompleted.lines?.[0]?.targetReceiptMovementId || 0
    );
    costLayerMovementIds.push(receivedReceiptMovementId);
    allMovementIds.push(receivedReceiptMovementId);
    journalEntryIds.push(Number(receivedCompleted.receiptJournalEntryId));
    const targetQtyAfterReceipt = await sumRemainingLayerQuantity(
      Number(warehouses.ouTarget.id),
      Number(stockedItem.id)
    );
    assertClose(
      targetQtyAfterReceipt - targetQtyBeforeReceivedCycle,
      5,
      "Receipt should increase target warehouse stock before full reversal"
    );

    const receivedReversed = await reverseInventoryTransferById({
      payload: {
        tenantId: context.tenantId,
        userId: context.userId,
        transferId: Number(receivedTransfer.id),
        reverseReason: "OU06 reverse received",
      },
    });
    journalEntryIds.push(Number(receivedReversed.reversalJournalEntryId));
    const sourceQtyAfterReceivedReverse = await sumRemainingLayerQuantity(
      Number(warehouses.centralSource.id),
      Number(stockedItem.id)
    );
    const targetQtyAfterReceivedReverse = await sumRemainingLayerQuantity(
      Number(warehouses.ouTarget.id),
      Number(stockedItem.id)
    );
    assert(
      receivedReversed.status === "REVERSED" &&
        Number(receivedReversed.reversalJournalEntryId) > 0,
      "Received transfer reverse should mark the header reversed"
    );
    assertClose(
      sourceQtyAfterReceivedReverse,
      sourceQtyBeforeReceivedCycle,
      "Received reverse should restore the source warehouse quantity"
    );
    assertClose(
      targetQtyAfterReceivedReverse,
      targetQtyBeforeReceivedCycle,
      "Received reverse should fully clear the target warehouse quantity impact"
    );
    const receivedReceiptRow = await loadMovementRow(receivedReceiptMovementId);
    assert(receivedReceiptRow?.reversed_at, "Received reverse should mark receipt movement reversed");
    const receivedReturnMovement = await loadReversalMovementByOriginalId(receivedIssueMovementId);
    assert(
      Number(receivedReturnMovement?.id || 0) > 0 &&
        String(receivedReturnMovement?.movement_type || "").toUpperCase() === "ADJUSTMENT_IN",
      "Received reverse should create an additive source return movement"
    );
    allMovementIds.push(Number(receivedReturnMovement?.id || 0));
    const receiptUndoMovement = await loadReversalMovementByOriginalId(receivedReceiptMovementId);
    assert(
      Number(receiptUndoMovement?.id || 0) > 0 &&
        String(receiptUndoMovement?.movement_type || "").toUpperCase() === "ADJUSTMENT_OUT",
      "Received reverse should create an additive receipt undo movement"
    );
    allMovementIds.push(Number(receiptUndoMovement?.id || 0));
    const receiptJournalAfterReverse = await loadJournalRow(Number(receivedCompleted.receiptJournalEntryId));
    const shipmentJournalAfterReverse = await loadJournalRow(Number(receivedCompleted.shipmentJournalEntryId));
    journalEntryIds.push(Number(receiptJournalAfterReverse?.reversal_journal_entry_id || 0));
    assert(
      String(receiptJournalAfterReverse?.status || "").toUpperCase() === "REVERSED" &&
        Number(receiptJournalAfterReverse?.reversal_journal_entry_id || 0) > 0,
      "Received reverse should reverse the receipt journal before closing the transfer"
    );
    assert(
      String(shipmentJournalAfterReverse?.status || "").toUpperCase() === "REVERSED" &&
        Number(shipmentJournalAfterReverse?.reversal_journal_entry_id || 0) ===
          Number(receivedReversed.reversalJournalEntryId),
      "Received reverse should reverse the shipment journal and store that reversal on the transfer header"
    );
    const receiptReversalJournalLink = await loadJournalSourceLink(
      Number(receiptJournalAfterReverse?.reversal_journal_entry_id || 0),
      Number(receivedTransfer.id)
    );
    const shipmentReversalJournalLink = await loadJournalSourceLink(
      Number(receivedReversed.reversalJournalEntryId),
      Number(receivedTransfer.id)
    );
    assert(
      receiptReversalJournalLink?.source_ref_type === "INVENTORY_TRANSFER" &&
        shipmentReversalJournalLink?.source_ref_type === "INVENTORY_TRANSFER",
      "Receipt and shipment reversal journals should both link back to the transfer header"
    );

    const counterparty = await createCounterpartyFixture({
      tenantId: context.tenantId,
      userId: context.userId,
      legalEntityId: context.legalEntityId,
      currencyCode: context.functionalCurrencyCode,
    });
    counterpartyIds.push(counterparty.id);
    const mismatchDraft = await createOuScopedIssueDraft({
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      operatingUnitId: Number(unit.id),
      counterpartyId: Number(counterparty.id),
      itemCardId: Number(stockedItem.id),
      currencyCode: context.functionalCurrencyCode,
      documentDate: context.postingDate,
    });
    documentIds.push(Number(mismatchDraft.id));
    const mismatchStockLink = await loadStockLinkForDocument(Number(mismatchDraft.id));
    assert(Number(mismatchStockLink?.id || 0) > 0, "Expected a pending stock link for bypass guard");
    await assertThrowsAsync(
      () =>
        createInventoryMovementFromStockLink({
          payload: {
            tenantId: context.tenantId,
            userId: context.userId,
            legalEntityId: context.legalEntityId,
            warehouseId: Number(warehouses.centralSource.id),
            sourceStockLinkId: Number(mismatchStockLink.id),
            movementDate: context.postingDate,
            note: "OU06 mismatch bypass",
          },
        }),
      "Cross-context stock movement must use inventory transfer workflow"
    );
    const mismatchStockLinkAfter = await loadStockLinkForDocument(Number(mismatchDraft.id));
    assert(
      String(mismatchStockLinkAfter?.link_status || "").toUpperCase() === "PENDING" &&
        !Number(mismatchStockLinkAfter?.inventory_movement_id || 0),
      "Blocked cross-context bypass should leave the stock link unresolved"
    );

    console.log("Inventory OU06 transfer reversal and bypass smoke passed.");
  } finally {
    const uniqueTransferIds = Array.from(new Set(transferIds.filter(Boolean)));
    const uniqueJournalEntryIds = Array.from(new Set(journalEntryIds.filter(Boolean)));
    const uniqueIssueMovementIds = Array.from(new Set(issueMovementIds.filter(Boolean)));
    const uniqueCostLayerMovementIds = Array.from(new Set(costLayerMovementIds.filter(Boolean)));
    const uniqueMovementIds = Array.from(new Set(allMovementIds.filter(Boolean)));
    const uniqueDocumentIds = Array.from(new Set(documentIds.filter(Boolean)));
    const uniqueCounterpartyIds = Array.from(new Set(counterpartyIds.filter(Boolean)));
    const uniqueWarehouseIds = Array.from(new Set(warehouseIds.filter(Boolean)));
    const uniqueItemCardIds = Array.from(new Set(itemCardIds.filter(Boolean)));
    const uniqueOperatingUnitIds = Array.from(new Set(createdUnitIds.filter(Boolean)));
    const uniqueAccountIds = Array.from(new Set(createdAccountIds.filter(Boolean)));
    if (uniqueTransferIds.length > 0) {
      await query(
        `DELETE FROM inventory_transfer_lines
          WHERE inventory_transfer_id IN (${uniqueTransferIds.map(() => "?").join(",")})`,
        uniqueTransferIds
      );
      await query(
        `DELETE FROM inventory_transfers
          WHERE id IN (${uniqueTransferIds.map(() => "?").join(",")})`,
        uniqueTransferIds
      );
    }
    if (uniqueIssueMovementIds.length > 0) {
      await query(
        `DELETE FROM inventory_issue_layer_consumptions
          WHERE issue_movement_id IN (${uniqueIssueMovementIds.map(() => "?").join(",")})`,
        uniqueIssueMovementIds
      );
    }
    if (uniqueJournalEntryIds.length > 0) {
      await query(
        `DELETE FROM journal_source_links
          WHERE journal_entry_id IN (${uniqueJournalEntryIds.map(() => "?").join(",")})`,
        uniqueJournalEntryIds
      );
      await query(
        `DELETE FROM journal_lines
          WHERE journal_entry_id IN (${uniqueJournalEntryIds.map(() => "?").join(",")})`,
        uniqueJournalEntryIds
      );
      await query(
        `DELETE FROM journal_entries
          WHERE id IN (${uniqueJournalEntryIds.map(() => "?").join(",")})`,
        uniqueJournalEntryIds
      );
    }
    if (uniqueCostLayerMovementIds.length > 0) {
      await query(
        `DELETE FROM inventory_cost_layers
          WHERE source_movement_id IN (${uniqueCostLayerMovementIds.map(() => "?").join(",")})`,
        uniqueCostLayerMovementIds
      );
    }
    if (uniqueMovementIds.length > 0) {
      const reversalMovementResult = await query(
        `SELECT id
           FROM inventory_movements
          WHERE id IN (${uniqueMovementIds.map(() => "?").join(",")})
            AND reversal_of_movement_id IS NOT NULL`,
        uniqueMovementIds
      );
      const reversalMovementIds = (reversalMovementResult.rows || [])
        .map((row) => Number(row.id || 0))
        .filter(Boolean);
      if (reversalMovementIds.length > 0) {
        await query(
          `DELETE FROM inventory_movements
            WHERE id IN (${reversalMovementIds.map(() => "?").join(",")})`,
          reversalMovementIds
        );
      }
      const baseMovementIds = uniqueMovementIds.filter(
        (id) => !reversalMovementIds.includes(Number(id))
      );
      if (baseMovementIds.length > 0) {
        await query(
          `DELETE FROM inventory_movements
            WHERE id IN (${baseMovementIds.map(() => "?").join(",")})`,
          baseMovementIds
        );
      }
    }
    if (uniqueDocumentIds.length > 0) {
      await query(
        `DELETE FROM cari_document_line_stock_links
          WHERE cari_document_id IN (${uniqueDocumentIds.map(() => "?").join(",")})`,
        uniqueDocumentIds
      );
      await query(
        `DELETE FROM cari_document_lines
          WHERE cari_document_id IN (${uniqueDocumentIds.map(() => "?").join(",")})`,
        uniqueDocumentIds
      );
      await query(
        `DELETE FROM cari_documents
          WHERE id IN (${uniqueDocumentIds.map(() => "?").join(",")})`,
        uniqueDocumentIds
      );
    }
    if (uniqueCounterpartyIds.length > 0) {
      await query(
        `DELETE FROM counterparties
          WHERE id IN (${uniqueCounterpartyIds.map(() => "?").join(",")})`,
        uniqueCounterpartyIds
      );
    }
    if (uniqueWarehouseIds.length > 0) {
      await query(
        `DELETE FROM inventory_warehouses
          WHERE id IN (${uniqueWarehouseIds.map(() => "?").join(",")})`,
        uniqueWarehouseIds
      );
    }
    if (uniqueItemCardIds.length > 0) {
      await query(
        `DELETE FROM item_cards
          WHERE id IN (${uniqueItemCardIds.map(() => "?").join(",")})`,
        uniqueItemCardIds
      );
    }
    if (uniqueOperatingUnitIds.length > 0) {
      await query(
        `DELETE FROM operating_unit_partner_current_accounts
          WHERE operating_unit_id IN (${uniqueOperatingUnitIds.map(() => "?").join(",")})
             OR partner_operating_unit_id IN (${uniqueOperatingUnitIds.map(() => "?").join(",")})`,
        [...uniqueOperatingUnitIds, ...uniqueOperatingUnitIds]
      );
      await query(
        `DELETE FROM operating_units
          WHERE id IN (${uniqueOperatingUnitIds.map(() => "?").join(",")})`,
        uniqueOperatingUnitIds
      );
    }
    if (uniqueAccountIds.length > 0) {
      await query(
        `DELETE FROM accounts
          WHERE id IN (${uniqueAccountIds.map(() => "?").join(",")})`,
        uniqueAccountIds
      );
    }
    await closePool();
  }
}

main().catch(async (error) => {
  console.error(error);
  try {
    await closePool();
  } catch {
    // ignore cleanup failures on exit
  }
  process.exit(1);
});
