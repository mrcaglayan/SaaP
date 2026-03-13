import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, query } from "../src/db.js";
import { assertLegalEntityBelongsToTenant } from "../src/tenantGuards.js";
import { createItemCard } from "../src/services/item.card.service.js";
import {
  approveInventoryTransferById,
  createInventoryTransfer,
  receiveInventoryTransferById,
  shipInventoryTransferById,
} from "../src/services/inventory.transfer.service.js";
import { createInventoryWarehouse } from "../src/services/inventory.service.js";
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

function uniqueCode(prefix) {
  const token = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return `${prefix}${token}`.slice(0, 40).toUpperCase();
}

function buildReq(tenantId) {
  return {
    user: {
      tenantId,
      userId: 7,
    },
    body: {},
    query: {},
  };
}

async function loadSmokeContext() {
  const result = await query(
    `SELECT
        le.tenant_id,
        le.id AS legal_entity_id,
        le.code AS legal_entity_code,
        le.functional_currency_code,
        coa.id AS coa_id,
        fp.start_date AS posting_date
       FROM legal_entities le
       JOIN charts_of_accounts coa
         ON coa.tenant_id = le.tenant_id
        AND coa.legal_entity_id = le.id
        AND coa.scope = 'LEGAL_ENTITY'
       JOIN books b
         ON b.tenant_id = le.tenant_id
        AND b.legal_entity_id = le.id
       JOIN fiscal_periods fp
         ON fp.calendar_id = b.calendar_id
       LEFT JOIN period_statuses ps
         ON ps.book_id = b.id
        AND ps.fiscal_period_id = fp.id
      WHERE le.status = 'ACTIVE'
        AND (ps.status IS NULL OR ps.status = 'OPEN')
      ORDER BY
        le.id ASC,
        CASE WHEN b.book_type = 'LOCAL' THEN 0 ELSE 1 END,
        fp.start_date ASC
      LIMIT 1`
  );
  const row = result.rows?.[0] || null;
  assert(row, "Expected one active legal entity with an open fiscal period");
  return {
    tenantId: Number(row.tenant_id),
    legalEntityId: Number(row.legal_entity_id),
    legalEntityCode: String(row.legal_entity_code || ""),
    functionalCurrencyCode: String(row.functional_currency_code || "").trim().toUpperCase(),
    coaId: Number(row.coa_id),
    postingDate: String(row.posting_date || "").slice(0, 10),
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
  return {
    id,
    code,
    name,
  };
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
     ) VALUES (?, ?, ?, ?, 'RECEIPT', 'MANUAL', NULL, 'OU05_TEST_RECEIPT', NULL, NULL, ?, ?, ?, ?, ?, ?, ?, 'VALUED', ?)`,
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

async function loadJournalLines(journalEntryId) {
  const result = await query(
    `SELECT
        jl.account_id,
        jl.operating_unit_id,
        jl.amount_txn,
        jl.debit_base,
        jl.credit_base,
        jl.currency_code,
        a.account_type,
        a.code AS account_code
       FROM journal_lines jl
       JOIN accounts a
         ON a.id = jl.account_id
      WHERE jl.journal_entry_id = ?
      ORDER BY jl.line_no ASC`,
    [journalEntryId]
  );
  return result.rows || [];
}

async function loadMovementRow(movementId) {
  const result = await query(
    `SELECT
        id,
        warehouse_id,
        movement_type,
        source_type,
        source_document_type,
        source_document_id,
        source_document_line_id,
        valuation_status,
        posted_journal_entry_id,
        quantity,
        unit_cost_txn,
        unit_cost_base,
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

async function loadReceiptCostLayer(sourceMovementId) {
  const result = await query(
    `SELECT
        source_movement_id,
        warehouse_id,
        item_card_id,
        currency_code,
        quantity_in,
        quantity_remaining,
        unit_cost_txn,
        unit_cost_base,
        total_cost_txn,
        total_cost_base
       FROM inventory_cost_layers
      WHERE source_movement_id = ?
      LIMIT 1`,
    [sourceMovementId]
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

async function createApprovedTransfer({
  tenantId,
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
      userId: 7,
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
  const approved = await approveInventoryTransferById({
    payload: {
      tenantId,
      userId: 7,
      transferId: Number(created.id),
    },
  });
  return approved;
}

function expectJournalLine(lines, expected) {
  const match = lines.find(
    (line) =>
      Number(line.account_id) === Number(expected.accountId) &&
      Number(line.operating_unit_id || 0) === Number(expected.operatingUnitId || 0) &&
      Math.abs(Number(line.debit_base || 0) - Number(expected.debitBase || 0)) <= 0.000001 &&
      Math.abs(Number(line.credit_base || 0) - Number(expected.creditBase || 0)) <= 0.000001
  );
  assert(
    match,
    `Missing journal line for account ${expected.accountId} / OU ${expected.operatingUnitId || 0}`
  );
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const [transferServiceSource, transfersPageSource, inventoryApiSource] = await Promise.all([
    readFile(path.resolve(root, "src/services/inventory.transfer.service.js"), "utf8"),
    readFile(path.resolve(root, "../frontend/src/pages/inventory/InventoryTransfersPage.jsx"), "utf8"),
    readFile(path.resolve(root, "../frontend/src/api/inventory.js"), "utf8"),
  ]);

  assert(
    transferServiceSource.includes("createTransferReceiptJournalTx") &&
      transferServiceSource.includes("target_receipt_movement_id = ?") &&
      transferServiceSource.includes("receipt_journal_entry_id = ?") &&
      transferServiceSource.includes("status = 'RECEIVED'"),
    "Transfer service should implement receipt materialization and receipt journal posting"
  );
  assert(
    transfersPageSource.includes("receiveInventoryTransfer(transferId)") &&
      transfersPageSource.includes("runTransferAction(action.key)") &&
      inventoryApiSource.includes("/transfers/${transferId}/receive"),
    "Frontend should expose the receive transfer action"
  );

  const context = await loadSmokeContext();
  const req = buildReq(context.tenantId);
  const createdAccountIds = [];
  const createdUnitIds = [];
  const warehouseIds = [];
  const itemCardIds = [];
  const transferIds = [];
  const journalEntryIds = [];
  const issueMovementIds = [];
  const receiptMovementIds = [];
  const allMovementIds = [];

  try {
    const itemAccounts = {
      inventoryAsset: await createLeafAccount({
        coaId: context.coaId,
        code: uniqueCode("OU05INV"),
        name: "OU05 Inventory Asset",
        accountType: "ASSET",
        normalSide: "DEBIT",
      }),
      inventoryTransit: await createLeafAccount({
        coaId: context.coaId,
        code: uniqueCode("OU05TRN"),
        name: "OU05 Inventory Transit",
        accountType: "ASSET",
        normalSide: "DEBIT",
      }),
    };
    const unitAccounts = {
      centralDueFrom: await createLeafAccount({
        coaId: context.coaId,
        code: uniqueCode("OU05CDF"),
        name: "OU05 Central Due From",
        accountType: "ASSET",
        normalSide: "DEBIT",
      }),
      centralDueTo: await createLeafAccount({
        coaId: context.coaId,
        code: uniqueCode("OU05CDT"),
        name: "OU05 Central Due To",
        accountType: "LIABILITY",
        normalSide: "CREDIT",
      }),
      ouDueFromCentral: await createLeafAccount({
        coaId: context.coaId,
        code: uniqueCode("OU05ODF"),
        name: "OU05 OU Due From Central",
        accountType: "ASSET",
        normalSide: "DEBIT",
      }),
      ouDueToCentral: await createLeafAccount({
        coaId: context.coaId,
        code: uniqueCode("OU05ODT"),
        name: "OU05 OU Due To Central",
        accountType: "LIABILITY",
        normalSide: "CREDIT",
      }),
    };
    createdAccountIds.push(
      itemAccounts.inventoryAsset.id,
      itemAccounts.inventoryTransit.id,
      unitAccounts.centralDueFrom.id,
      unitAccounts.centralDueTo.id,
      unitAccounts.ouDueFromCentral.id,
      unitAccounts.ouDueToCentral.id
    );

    const unit = await upsertOperatingUnit({
      req,
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      code: uniqueCode("OU05OU"),
      name: "OU05 Branch",
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
      centralShip: await createInventoryWarehouse({
        payload: {
          tenantId: context.tenantId,
          userId: 7,
          legalEntityId: context.legalEntityId,
          ownershipScope: "CENTRAL",
          operatingUnitId: null,
          code: uniqueCode("OU05CS"),
          name: "OU05 Central Ship",
          status: "ACTIVE",
        },
      }),
      centralReceive: await createInventoryWarehouse({
        payload: {
          tenantId: context.tenantId,
          userId: 7,
          legalEntityId: context.legalEntityId,
          ownershipScope: "CENTRAL",
          operatingUnitId: null,
          code: uniqueCode("OU05CR"),
          name: "OU05 Central Receive",
          status: "ACTIVE",
        },
      }),
      ouShip: await createInventoryWarehouse({
        payload: {
          tenantId: context.tenantId,
          userId: 7,
          legalEntityId: context.legalEntityId,
          ownershipScope: "OPERATING_UNIT",
          operatingUnitId: unit.id,
          code: uniqueCode("OU05OS"),
          name: "OU05 OU Ship",
          status: "ACTIVE",
        },
      }),
      ouReceive: await createInventoryWarehouse({
        payload: {
          tenantId: context.tenantId,
          userId: 7,
          legalEntityId: context.legalEntityId,
          ownershipScope: "OPERATING_UNIT",
          operatingUnitId: unit.id,
          code: uniqueCode("OU05OR"),
          name: "OU05 OU Receive",
          status: "ACTIVE",
        },
      }),
    };
    warehouseIds.push(
      Number(warehouses.centralShip.id),
      Number(warehouses.centralReceive.id),
      Number(warehouses.ouShip.id),
      Number(warehouses.ouReceive.id)
    );

    const stockedItem = await createItemCard({
      payload: {
        tenantId: context.tenantId,
        legalEntityId: context.legalEntityId,
        code: uniqueCode("OU05ITM"),
        name: "OU05 Stocked Item",
        itemType: "STOCK_ITEM",
        inventoryAssetAccountId: itemAccounts.inventoryAsset.id,
        inventoryTransitAccountId: itemAccounts.inventoryTransit.id,
        status: "ACTIVE",
      },
    });
    itemCardIds.push(Number(stockedItem.id));

    const seededReceiptMovementIds = [
      await insertReceiptCostLayer({
        tenantId: context.tenantId,
        legalEntityId: context.legalEntityId,
        warehouseId: Number(warehouses.centralShip.id),
        itemCardId: Number(stockedItem.id),
        movementDate: context.postingDate,
        quantity: 3,
        unitCost: 10,
        currencyCode: context.functionalCurrencyCode,
        note: "OU05 central layer 1",
      }),
      await insertReceiptCostLayer({
        tenantId: context.tenantId,
        legalEntityId: context.legalEntityId,
        warehouseId: Number(warehouses.centralShip.id),
        itemCardId: Number(stockedItem.id),
        movementDate: context.postingDate,
        quantity: 4,
        unitCost: 12,
        currencyCode: context.functionalCurrencyCode,
        note: "OU05 central layer 2",
      }),
      await insertReceiptCostLayer({
        tenantId: context.tenantId,
        legalEntityId: context.legalEntityId,
        warehouseId: Number(warehouses.ouShip.id),
        itemCardId: Number(stockedItem.id),
        movementDate: context.postingDate,
        quantity: 2,
        unitCost: 9,
        currencyCode: context.functionalCurrencyCode,
        note: "OU05 OU layer 1",
      }),
      await insertReceiptCostLayer({
        tenantId: context.tenantId,
        legalEntityId: context.legalEntityId,
        warehouseId: Number(warehouses.ouShip.id),
        itemCardId: Number(stockedItem.id),
        movementDate: context.postingDate,
        quantity: 4,
        unitCost: 11,
        currencyCode: context.functionalCurrencyCode,
        note: "OU05 OU layer 2",
      }),
    ];
    receiptMovementIds.push(...seededReceiptMovementIds);
    allMovementIds.push(...seededReceiptMovementIds);

    const centralToOuTransfer = await createApprovedTransfer({
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      transferDate: context.postingDate,
      sourceWarehouseId: Number(warehouses.centralShip.id),
      targetWarehouseId: Number(warehouses.ouReceive.id),
      itemCardId: Number(stockedItem.id),
      quantityRequested: 5,
      note: "OU05 CENTRAL->OU",
    });
    transferIds.push(Number(centralToOuTransfer.id));
    const centralToOuShipped = await shipInventoryTransferById({
      payload: {
        tenantId: context.tenantId,
        userId: 7,
        transferId: Number(centralToOuTransfer.id),
      },
    });
    journalEntryIds.push(Number(centralToOuShipped.shipmentJournalEntryId));
    issueMovementIds.push(Number(centralToOuShipped.lines?.[0]?.sourceIssueMovementId || 0));
    allMovementIds.push(Number(centralToOuShipped.lines?.[0]?.sourceIssueMovementId || 0));

    const ouReceiveRemainingBefore = await sumRemainingLayerQuantity(
      Number(warehouses.ouReceive.id),
      Number(stockedItem.id)
    );
    const centralToOuReceived = await receiveInventoryTransferById({
      payload: {
        tenantId: context.tenantId,
        userId: 7,
        transferId: Number(centralToOuTransfer.id),
      },
    });
    const centralReceiptLine = centralToOuReceived.lines?.[0] || null;
    journalEntryIds.push(Number(centralToOuReceived.receiptJournalEntryId));
    receiptMovementIds.push(Number(centralReceiptLine?.targetReceiptMovementId || 0));
    allMovementIds.push(Number(centralReceiptLine?.targetReceiptMovementId || 0));

    assert(
      centralToOuReceived.status === "RECEIVED" &&
        Number(centralToOuReceived.receivedByUserId) === 7 &&
        Number(centralToOuReceived.receiptJournalEntryId) > 0,
      "CENTRAL -> OU receive should set RECEIVED and header receipt journal fields"
    );
    assertClose(
      centralReceiptLine.quantityReceived,
      5,
      "CENTRAL -> OU should receive the full shipped quantity"
    );
    assert(
      Number(centralReceiptLine.targetReceiptMovementId) > 0,
      "CENTRAL -> OU should persist target receipt movement id"
    );

    const centralReceiptMovement = await loadMovementRow(
      Number(centralReceiptLine.targetReceiptMovementId)
    );
    assert(
      centralReceiptMovement &&
        centralReceiptMovement.movement_type === "RECEIPT" &&
        centralReceiptMovement.source_type === "INVENTORY_TRANSFER" &&
        centralReceiptMovement.source_document_type === "INVENTORY_TRANSFER" &&
        Number(centralReceiptMovement.source_document_id) === Number(centralToOuReceived.id) &&
        Number(centralReceiptMovement.source_document_line_id) === Number(centralReceiptLine.id) &&
        centralReceiptMovement.valuation_status === "VALUED" &&
        !Number(centralReceiptMovement.posted_journal_entry_id || 0),
      "CENTRAL -> OU should create a valued transfer-linked receipt movement without per-movement journal linkage"
    );
    const centralReceiptLayer = await loadReceiptCostLayer(
      Number(centralReceiptLine.targetReceiptMovementId)
    );
    assert(
      centralReceiptLayer &&
        Number(centralReceiptLayer.warehouse_id) === Number(warehouses.ouReceive.id),
      "CENTRAL -> OU should create a target warehouse cost layer"
    );
    assertClose(
      centralReceiptLayer.quantity_in,
      5,
      "CENTRAL -> OU receipt cost layer should keep full inbound quantity"
    );
    assertClose(
      centralReceiptLayer.quantity_remaining,
      5,
      "CENTRAL -> OU receipt cost layer should remain fully open"
    );
    assertClose(
      centralReceiptLayer.total_cost_txn,
      centralReceiptLine.shippedTotalCostTxn,
      "CENTRAL -> OU receipt should reuse shipped total txn cost"
    );
    assertClose(
      centralReceiptLayer.total_cost_base,
      centralReceiptLine.shippedTotalCostBase,
      "CENTRAL -> OU receipt should reuse shipped total base cost"
    );
    assert(
      String(centralReceiptLayer.currency_code || "").toUpperCase() ===
        String(centralReceiptLine.shippedCurrencyCode || "").toUpperCase(),
      "CENTRAL -> OU receipt should reuse shipped currency code"
    );

    const centralReceiptJournalLines = await loadJournalLines(
      Number(centralToOuReceived.receiptJournalEntryId)
    );
    assert(
      centralReceiptJournalLines.length === 2,
      "CENTRAL -> OU receipt should post one two-line journal"
    );
    expectJournalLine(centralReceiptJournalLines, {
      accountId: itemAccounts.inventoryAsset.id,
      operatingUnitId: unit.id,
      debitBase: 54,
      creditBase: 0,
    });
    expectJournalLine(centralReceiptJournalLines, {
      accountId: itemAccounts.inventoryTransit.id,
      operatingUnitId: unit.id,
      debitBase: 0,
      creditBase: 54,
    });
    const centralReceiptJournalLink = await loadJournalSourceLink(
      Number(centralToOuReceived.receiptJournalEntryId),
      Number(centralToOuReceived.id)
    );
    assert(
      centralReceiptJournalLink?.source_ref_type === "INVENTORY_TRANSFER" &&
        centralReceiptJournalLink?.link_role === "PRIMARY",
      "CENTRAL -> OU receipt journal should link back to the transfer header"
    );
    const ouReceiveRemainingAfter = await sumRemainingLayerQuantity(
      Number(warehouses.ouReceive.id),
      Number(stockedItem.id)
    );
    assertClose(
      ouReceiveRemainingAfter - ouReceiveRemainingBefore,
      5,
      "CENTRAL -> OU receipt should increase target warehouse quantity immediately"
    );

    const ouToCentralTransfer = await createApprovedTransfer({
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      transferDate: context.postingDate,
      sourceWarehouseId: Number(warehouses.ouShip.id),
      targetWarehouseId: Number(warehouses.centralReceive.id),
      itemCardId: Number(stockedItem.id),
      quantityRequested: 4,
      note: "OU05 OU->CENTRAL",
    });
    transferIds.push(Number(ouToCentralTransfer.id));
    const ouToCentralShipped = await shipInventoryTransferById({
      payload: {
        tenantId: context.tenantId,
        userId: 7,
        transferId: Number(ouToCentralTransfer.id),
      },
    });
    journalEntryIds.push(Number(ouToCentralShipped.shipmentJournalEntryId));
    issueMovementIds.push(Number(ouToCentralShipped.lines?.[0]?.sourceIssueMovementId || 0));
    allMovementIds.push(Number(ouToCentralShipped.lines?.[0]?.sourceIssueMovementId || 0));

    const centralReceiveRemainingBefore = await sumRemainingLayerQuantity(
      Number(warehouses.centralReceive.id),
      Number(stockedItem.id)
    );
    const ouToCentralReceived = await receiveInventoryTransferById({
      payload: {
        tenantId: context.tenantId,
        userId: 7,
        transferId: Number(ouToCentralTransfer.id),
      },
    });
    const ouToCentralReceiptLine = ouToCentralReceived.lines?.[0] || null;
    journalEntryIds.push(Number(ouToCentralReceived.receiptJournalEntryId));
    receiptMovementIds.push(Number(ouToCentralReceiptLine?.targetReceiptMovementId || 0));
    allMovementIds.push(Number(ouToCentralReceiptLine?.targetReceiptMovementId || 0));

    assert(
      ouToCentralReceived.status === "RECEIVED" &&
        Number(ouToCentralReceived.receiptJournalEntryId) > 0,
      "OU -> CENTRAL receive should post the receipt journal and close the transfer"
    );
    assertClose(
      ouToCentralReceiptLine.quantityReceived,
      4,
      "OU -> CENTRAL should receive the full shipped quantity"
    );
    const ouToCentralReceiptJournalLines = await loadJournalLines(
      Number(ouToCentralReceived.receiptJournalEntryId)
    );
    expectJournalLine(ouToCentralReceiptJournalLines, {
      accountId: itemAccounts.inventoryAsset.id,
      operatingUnitId: null,
      debitBase: 40,
      creditBase: 0,
    });
    expectJournalLine(ouToCentralReceiptJournalLines, {
      accountId: itemAccounts.inventoryTransit.id,
      operatingUnitId: null,
      debitBase: 0,
      creditBase: 40,
    });
    const centralReceiveRemainingAfter = await sumRemainingLayerQuantity(
      Number(warehouses.centralReceive.id),
      Number(stockedItem.id)
    );
    assertClose(
      centralReceiveRemainingAfter - centralReceiveRemainingBefore,
      4,
      "OU -> CENTRAL receipt should increase central target warehouse quantity immediately"
    );

    console.log("Inventory OU05 transfer receipt smoke passed.");
  } finally {
    const uniqueTransferIds = Array.from(new Set(transferIds.filter(Boolean)));
    const uniqueJournalEntryIds = Array.from(new Set(journalEntryIds.filter(Boolean)));
    const uniqueIssueMovementIds = Array.from(new Set(issueMovementIds.filter(Boolean)));
    const uniqueReceiptMovementIds = Array.from(new Set(receiptMovementIds.filter(Boolean)));
    const uniqueMovementIds = Array.from(new Set(allMovementIds.filter(Boolean)));
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
    if (uniqueReceiptMovementIds.length > 0) {
      await query(
        `DELETE FROM inventory_cost_layers
          WHERE source_movement_id IN (${uniqueReceiptMovementIds.map(() => "?").join(",")})`,
        uniqueReceiptMovementIds
      );
    }
    if (uniqueMovementIds.length > 0) {
      await query(
        `DELETE FROM inventory_movements
          WHERE id IN (${uniqueMovementIds.map(() => "?").join(",")})`,
        uniqueMovementIds
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
