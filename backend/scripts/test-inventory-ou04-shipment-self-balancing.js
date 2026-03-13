
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, query } from "../src/db.js";
import { assertLegalEntityBelongsToTenant } from "../src/tenantGuards.js";
import { createItemCard } from "../src/services/item.card.service.js";
import {
  approveInventoryTransferById,
  createInventoryTransfer,
  getInventoryTransferById,
  shipInventoryTransferById,
} from "../src/services/inventory.transfer.service.js";
import { createInventoryWarehouse } from "../src/services/inventory.service.js";
import {
  upsertOperatingUnit,
  upsertOperatingUnitPartnerCurrentAccount,
} from "../src/services/org.write.service.js";

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

async function assertInventoryTransferSourceTypeSchema() {
  const tableResult = await query(
    `SELECT COUNT(*) AS table_count
       FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = 'inventory_movements'`
  );
  const inventoryMovementsTableExists = Number(tableResult.rows?.[0]?.table_count || 0) > 0;

  const migrationResult = await query(
    `SELECT migration_key
       FROM schema_migrations
      WHERE migration_key IN (
        'm118_inventory_foundation',
        'm124_inventory_transfer_foundation',
        'm127_inventory_transfer_source_type_backfill'
      )
      ORDER BY migration_key`
  );
  const appliedMigrationKeys = Array.isArray(migrationResult.rows)
    ? migrationResult.rows
        .map((row) => String(row.migration_key || "").trim())
        .filter(Boolean)
    : [];

  const columnTypeResult = await query(
    `SELECT column_type
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'inventory_movements'
        AND column_name = 'source_type'
      LIMIT 1`
  );
  const columnType = String(columnTypeResult.rows?.[0]?.column_type || "");
  if (!columnType) {
    throw new Error(
      `Schema preflight failed: inventory_movements.source_type metadata was not found. ` +
        `inventory_movements table exists=${inventoryMovementsTableExists}. ` +
        `Applied migration keys: ${appliedMigrationKeys.length ? appliedMigrationKeys.join(", ") : "none"}. ` +
        `This usually means inventory migrations were not applied, or schema_migrations is out of sync with the actual schema. ` +
        `Run \`npm run audit:inventory:transfer-schema\`, then apply latest migrations or rebuild the test database.`
    );
  }

  const enumValues = Array.from(columnType.matchAll(/'([^']+)'/g)).map((match) => match[1]);
  if (enumValues.includes("INVENTORY_TRANSFER")) {
    return;
  }

  throw new Error(
    `Schema preflight failed: inventory_movements.source_type does not include INVENTORY_TRANSFER. ` +
      `Current column_type=${columnType}. Applied enum migration keys: ` +
      `${appliedMigrationKeys.length ? appliedMigrationKeys.join(", ") : "none"}. ` +
      `Run \`npm run audit:inventory:transfer-schema\`, then verify m124/m127 updated inventory_movements.source_type.`
  );
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
     ) VALUES (?, ?, ?, ?, 'RECEIPT', 'MANUAL', NULL, 'OU04_TEST_RECEIPT', NULL, NULL, ?, ?, ?, ?, ?, ?, ?, 'VALUED', ?)`,
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
        movement_type,
        source_type,
        source_document_type,
        source_document_id,
        source_document_line_id,
        valuation_status,
        posted_journal_entry_id,
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

async function loadIssueConsumptions(issueMovementId) {
  const result = await query(
    `SELECT quantity_consumed
       FROM inventory_issue_layer_consumptions
      WHERE issue_movement_id = ?
      ORDER BY consumption_no ASC`,
    [issueMovementId]
  );
  return (result.rows || []).map((row) => Number(row.quantity_consumed || 0));
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
  const [
    migrationSource,
    migrationIndexSource,
    itemCardServiceSource,
    itemCardValidatorSource,
    transferServiceSource,
    itemCardsPageSource,
    transfersPageSource,
    inventoryApiSource,
  ] = await Promise.all([
    readFile(
      path.resolve(root, "src/migrations/m126_item_cards_inventory_transit_account.js"),
      "utf8"
    ),
    readFile(path.resolve(root, "src/migrations/index.js"), "utf8"),
    readFile(path.resolve(root, "src/services/item.card.service.js"), "utf8"),
    readFile(path.resolve(root, "src/routes/item.card.validators.js"), "utf8"),
    readFile(path.resolve(root, "src/services/inventory.transfer.service.js"), "utf8"),
    readFile(path.resolve(root, "../frontend/src/pages/inventory/ItemCardsPage.jsx"), "utf8"),
    readFile(
      path.resolve(root, "../frontend/src/pages/inventory/InventoryTransfersPage.jsx"),
      "utf8"
    ),
    readFile(path.resolve(root, "../frontend/src/api/inventory.js"), "utf8"),
  ]);

  assert(
    migrationSource.includes("inventory_transit_account_id") &&
      migrationSource.includes("fk_item_cards_inventory_transit_account"),
    "m126 should add item-card inventory transit account schema coverage"
  );
  assert(
    migrationIndexSource.includes("m126_item_cards_inventory_transit_account") &&
      migrationIndexSource.includes("migration126ItemCardsInventoryTransitAccount"),
    "migrations index should register m126"
  );
  assert(
    itemCardServiceSource.includes("inventoryTransitAccountId") &&
      itemCardValidatorSource.includes("inventoryTransitAccountId"),
    "Item-card service and validators should expose inventoryTransitAccountId"
  );
  assert(
    transferServiceSource.includes("consumeTransferShipmentCostLayersTx") &&
      transferServiceSource.includes("shipment_journal_entry_id = ?") &&
      transferServiceSource.includes("sourceRefType: \"INVENTORY_TRANSFER\""),
    "Transfer service should implement shipment costing, posting, and source linking"
  );
  assert(
    itemCardsPageSource.includes("Inventory Transit Account (optional)") &&
      transfersPageSource.includes("approveInventoryTransfer(transferId)") &&
      transfersPageSource.includes("shipInventoryTransfer(transferId)") &&
      transfersPageSource.includes("runTransferAction(action.key)") &&
      inventoryApiSource.includes("/transfers/${transferId}/ship"),
    "Frontend should expose transit-account maintenance and approve/ship transfer actions"
  );

  await assertInventoryTransferSourceTypeSchema();

  const context = await loadSmokeContext();
  const req = buildReq(context.tenantId);
  const createdAccountIds = [];
  const createdUnitIds = [];
  const createdPartnerMappings = [];
  const warehouseIds = [];
  const itemCardIds = [];
  const transferIds = [];
  const journalEntryIds = [];
  const movementIds = [];
  const receiptMovementIds = [];

  try {
    const itemAccounts = {
      inventoryAsset: await createLeafAccount({
        coaId: context.coaId,
        code: uniqueCode("OU04INV"),
        name: "OU04 Inventory Asset",
        accountType: "ASSET",
        normalSide: "DEBIT",
      }),
      inventoryTransit: await createLeafAccount({
        coaId: context.coaId,
        code: uniqueCode("OU04TRN"),
        name: "OU04 Inventory Transit",
        accountType: "ASSET",
        normalSide: "DEBIT",
      }),
    };
    const unitAAccounts = {
      centralDueFrom: await createLeafAccount({
        coaId: context.coaId,
        code: uniqueCode("OU04ACF"),
        name: "OU04 A Central Due From",
        accountType: "ASSET",
        normalSide: "DEBIT",
      }),
      centralDueTo: await createLeafAccount({
        coaId: context.coaId,
        code: uniqueCode("OU04ACT"),
        name: "OU04 A Central Due To",
        accountType: "LIABILITY",
        normalSide: "CREDIT",
      }),
      ouDueFromCentral: await createLeafAccount({
        coaId: context.coaId,
        code: uniqueCode("OU04AOF"),
        name: "OU04 A OU Due From Central",
        accountType: "ASSET",
        normalSide: "DEBIT",
      }),
      ouDueToCentral: await createLeafAccount({
        coaId: context.coaId,
        code: uniqueCode("OU04AOT"),
        name: "OU04 A OU Due To Central",
        accountType: "LIABILITY",
        normalSide: "CREDIT",
      }),
    };
    const unitBAccounts = {
      centralDueFrom: await createLeafAccount({
        coaId: context.coaId,
        code: uniqueCode("OU04BCF"),
        name: "OU04 B Central Due From",
        accountType: "ASSET",
        normalSide: "DEBIT",
      }),
      centralDueTo: await createLeafAccount({
        coaId: context.coaId,
        code: uniqueCode("OU04BCT"),
        name: "OU04 B Central Due To",
        accountType: "LIABILITY",
        normalSide: "CREDIT",
      }),
      ouDueFromCentral: await createLeafAccount({
        coaId: context.coaId,
        code: uniqueCode("OU04BOF"),
        name: "OU04 B OU Due From Central",
        accountType: "ASSET",
        normalSide: "DEBIT",
      }),
      ouDueToCentral: await createLeafAccount({
        coaId: context.coaId,
        code: uniqueCode("OU04BOT"),
        name: "OU04 B OU Due To Central",
        accountType: "LIABILITY",
        normalSide: "CREDIT",
      }),
    };
    const unitPartialAccounts = {
      centralDueFrom: await createLeafAccount({
        coaId: context.coaId,
        code: uniqueCode("OU04PCF"),
        name: "OU04 Partial Central Due From",
        accountType: "ASSET",
        normalSide: "DEBIT",
      }),
      ouDueToCentral: await createLeafAccount({
        coaId: context.coaId,
        code: uniqueCode("OU04POT"),
        name: "OU04 Partial OU Due To Central",
        accountType: "LIABILITY",
        normalSide: "CREDIT",
      }),
    };
    const partnerForwardAccounts = {
      dueFrom: await createLeafAccount({
        coaId: context.coaId,
        code: uniqueCode("OU04PDF"),
        name: "OU04 A Due From B",
        accountType: "ASSET",
        normalSide: "DEBIT",
      }),
      dueTo: await createLeafAccount({
        coaId: context.coaId,
        code: uniqueCode("OU04PDT"),
        name: "OU04 A Due To B",
        accountType: "LIABILITY",
        normalSide: "CREDIT",
      }),
    };
    const partnerReverseAccounts = {
      dueFrom: await createLeafAccount({
        coaId: context.coaId,
        code: uniqueCode("OU04RDF"),
        name: "OU04 B Due From A",
        accountType: "ASSET",
        normalSide: "DEBIT",
      }),
      dueTo: await createLeafAccount({
        coaId: context.coaId,
        code: uniqueCode("OU04RDT"),
        name: "OU04 B Due To A",
        accountType: "LIABILITY",
        normalSide: "CREDIT",
      }),
    };
    createdAccountIds.push(
      itemAccounts.inventoryAsset.id,
      itemAccounts.inventoryTransit.id,
      unitAAccounts.centralDueFrom.id,
      unitAAccounts.centralDueTo.id,
      unitAAccounts.ouDueFromCentral.id,
      unitAAccounts.ouDueToCentral.id,
      unitBAccounts.centralDueFrom.id,
      unitBAccounts.centralDueTo.id,
      unitBAccounts.ouDueFromCentral.id,
      unitBAccounts.ouDueToCentral.id,
      unitPartialAccounts.centralDueFrom.id,
      unitPartialAccounts.ouDueToCentral.id,
      partnerForwardAccounts.dueFrom.id,
      partnerForwardAccounts.dueTo.id,
      partnerReverseAccounts.dueFrom.id,
      partnerReverseAccounts.dueTo.id
    );

    const unitA = await upsertOperatingUnit({
      req,
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      code: uniqueCode("OU04A"),
      name: "OU04 Branch A",
      unitType: "BRANCH",
      hasSubledger: false,
      centralDueFromAccountId: unitAAccounts.centralDueFrom.id,
      centralDueToAccountId: unitAAccounts.centralDueTo.id,
      ouDueFromCentralAccountId: unitAAccounts.ouDueFromCentral.id,
      ouDueToCentralAccountId: unitAAccounts.ouDueToCentral.id,
      assertLegalEntityBelongsToTenant,
      assertScopeAccess: () => {},
    });
    const unitB = await upsertOperatingUnit({
      req,
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      code: uniqueCode("OU04B"),
      name: "OU04 Branch B",
      unitType: "BRANCH",
      hasSubledger: false,
      centralDueFromAccountId: unitBAccounts.centralDueFrom.id,
      centralDueToAccountId: unitBAccounts.centralDueTo.id,
      ouDueFromCentralAccountId: unitBAccounts.ouDueFromCentral.id,
      ouDueToCentralAccountId: unitBAccounts.ouDueToCentral.id,
      assertLegalEntityBelongsToTenant,
      assertScopeAccess: () => {},
    });
    const unitPartial = await upsertOperatingUnit({
      req,
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      code: uniqueCode("OU04P"),
      name: "OU04 Partial Branch",
      unitType: "BRANCH",
      hasSubledger: false,
      centralDueFromAccountId: unitPartialAccounts.centralDueFrom.id,
      centralDueToAccountId: null,
      ouDueFromCentralAccountId: null,
      ouDueToCentralAccountId: unitPartialAccounts.ouDueToCentral.id,
      assertLegalEntityBelongsToTenant,
      assertScopeAccess: () => {},
    });
    createdUnitIds.push(unitA.id, unitB.id, unitPartial.id);

    await upsertOperatingUnitPartnerCurrentAccount({
      req,
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      operatingUnitId: unitA.id,
      partnerOperatingUnitId: unitB.id,
      dueFromAccountId: partnerForwardAccounts.dueFrom.id,
      dueToAccountId: partnerForwardAccounts.dueTo.id,
      assertLegalEntityBelongsToTenant,
      assertScopeAccess: () => {},
    });
    createdPartnerMappings.push([unitA.id, unitB.id]);
    await upsertOperatingUnitPartnerCurrentAccount({
      req,
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      operatingUnitId: unitB.id,
      partnerOperatingUnitId: unitA.id,
      dueFromAccountId: partnerReverseAccounts.dueFrom.id,
      dueToAccountId: partnerReverseAccounts.dueTo.id,
      assertLegalEntityBelongsToTenant,
      assertScopeAccess: () => {},
    });
    createdPartnerMappings.push([unitB.id, unitA.id]);

    const warehouses = {
      centralShip: await createInventoryWarehouse({
        payload: {
          tenantId: context.tenantId,
          userId: 7,
          legalEntityId: context.legalEntityId,
          ownershipScope: "CENTRAL",
          code: uniqueCode("OU04CS"),
          name: "OU04 Central Ship",
          status: "ACTIVE",
        },
      }),
      centralReceive: await createInventoryWarehouse({
        payload: {
          tenantId: context.tenantId,
          userId: 7,
          legalEntityId: context.legalEntityId,
          ownershipScope: "CENTRAL",
          code: uniqueCode("OU04CR"),
          name: "OU04 Central Receive",
          status: "ACTIVE",
        },
      }),
      centralMissingMap: await createInventoryWarehouse({
        payload: {
          tenantId: context.tenantId,
          userId: 7,
          legalEntityId: context.legalEntityId,
          ownershipScope: "CENTRAL",
          code: uniqueCode("OU04CM"),
          name: "OU04 Central Missing Map",
          status: "ACTIVE",
        },
      }),
      centralMissingTransit: await createInventoryWarehouse({
        payload: {
          tenantId: context.tenantId,
          userId: 7,
          legalEntityId: context.legalEntityId,
          ownershipScope: "CENTRAL",
          code: uniqueCode("OU04CT"),
          name: "OU04 Central Missing Transit",
          status: "ACTIVE",
        },
      }),
      centralInsufficient: await createInventoryWarehouse({
        payload: {
          tenantId: context.tenantId,
          userId: 7,
          legalEntityId: context.legalEntityId,
          ownershipScope: "CENTRAL",
          code: uniqueCode("OU04CI"),
          name: "OU04 Central Insufficient",
          status: "ACTIVE",
        },
      }),
      ouA: await createInventoryWarehouse({
        payload: {
          tenantId: context.tenantId,
          userId: 7,
          legalEntityId: context.legalEntityId,
          ownershipScope: "OPERATING_UNIT",
          operatingUnitId: unitA.id,
          code: uniqueCode("OU04WA"),
          name: "OU04 OU A Warehouse",
          status: "ACTIVE",
        },
      }),
      ouB: await createInventoryWarehouse({
        payload: {
          tenantId: context.tenantId,
          userId: 7,
          legalEntityId: context.legalEntityId,
          ownershipScope: "OPERATING_UNIT",
          operatingUnitId: unitB.id,
          code: uniqueCode("OU04WB"),
          name: "OU04 OU B Warehouse",
          status: "ACTIVE",
        },
      }),
      ouPartial: await createInventoryWarehouse({
        payload: {
          tenantId: context.tenantId,
          userId: 7,
          legalEntityId: context.legalEntityId,
          ownershipScope: "OPERATING_UNIT",
          operatingUnitId: unitPartial.id,
          code: uniqueCode("OU04WP"),
          name: "OU04 Partial OU Warehouse",
          status: "ACTIVE",
        },
      }),
    };
    warehouseIds.push(
      Number(warehouses.centralShip.id),
      Number(warehouses.centralReceive.id),
      Number(warehouses.centralMissingMap.id),
      Number(warehouses.centralMissingTransit.id),
      Number(warehouses.centralInsufficient.id),
      Number(warehouses.ouA.id),
      Number(warehouses.ouB.id),
      Number(warehouses.ouPartial.id)
    );

    const stockedItem = await createItemCard({
      payload: {
        tenantId: context.tenantId,
        legalEntityId: context.legalEntityId,
        code: uniqueCode("OU04ITM"),
        name: "OU04 Stocked Item",
        itemType: "STOCK_ITEM",
        inventoryAssetAccountId: itemAccounts.inventoryAsset.id,
        inventoryTransitAccountId: itemAccounts.inventoryTransit.id,
        status: "ACTIVE",
      },
    });
    const noTransitItem = await createItemCard({
      payload: {
        tenantId: context.tenantId,
        legalEntityId: context.legalEntityId,
        code: uniqueCode("OU04NTR"),
        name: "OU04 No Transit Item",
        itemType: "STOCK_ITEM",
        inventoryAssetAccountId: itemAccounts.inventoryAsset.id,
        status: "ACTIVE",
      },
    });
    itemCardIds.push(Number(stockedItem.id), Number(noTransitItem.id));

    receiptMovementIds.push(
      await insertReceiptCostLayer({
        tenantId: context.tenantId,
        legalEntityId: context.legalEntityId,
        warehouseId: Number(warehouses.centralShip.id),
        itemCardId: Number(stockedItem.id),
        movementDate: context.postingDate,
        quantity: 5,
        unitCost: 10,
        currencyCode: context.functionalCurrencyCode,
        note: "OU04 central ship layer 1",
      }),
      await insertReceiptCostLayer({
        tenantId: context.tenantId,
        legalEntityId: context.legalEntityId,
        warehouseId: Number(warehouses.centralShip.id),
        itemCardId: Number(stockedItem.id),
        movementDate: context.postingDate,
        quantity: 5,
        unitCost: 12,
        currencyCode: context.functionalCurrencyCode,
        note: "OU04 central ship layer 2",
      }),
      await insertReceiptCostLayer({
        tenantId: context.tenantId,
        legalEntityId: context.legalEntityId,
        warehouseId: Number(warehouses.ouA.id),
        itemCardId: Number(stockedItem.id),
        movementDate: context.postingDate,
        quantity: 4,
        unitCost: 9,
        currencyCode: context.functionalCurrencyCode,
        note: "OU04 OU A layer 1",
      }),
      await insertReceiptCostLayer({
        tenantId: context.tenantId,
        legalEntityId: context.legalEntityId,
        warehouseId: Number(warehouses.ouA.id),
        itemCardId: Number(stockedItem.id),
        movementDate: context.postingDate,
        quantity: 8,
        unitCost: 11,
        currencyCode: context.functionalCurrencyCode,
        note: "OU04 OU A layer 2",
      }),
      await insertReceiptCostLayer({
        tenantId: context.tenantId,
        legalEntityId: context.legalEntityId,
        warehouseId: Number(warehouses.centralMissingMap.id),
        itemCardId: Number(stockedItem.id),
        movementDate: context.postingDate,
        quantity: 2,
        unitCost: 10,
        currencyCode: context.functionalCurrencyCode,
        note: "OU04 central missing map",
      }),
      await insertReceiptCostLayer({
        tenantId: context.tenantId,
        legalEntityId: context.legalEntityId,
        warehouseId: Number(warehouses.centralMissingTransit.id),
        itemCardId: Number(noTransitItem.id),
        movementDate: context.postingDate,
        quantity: 3,
        unitCost: 10,
        currencyCode: context.functionalCurrencyCode,
        note: "OU04 central missing transit",
      }),
      await insertReceiptCostLayer({
        tenantId: context.tenantId,
        legalEntityId: context.legalEntityId,
        warehouseId: Number(warehouses.centralInsufficient.id),
        itemCardId: Number(stockedItem.id),
        movementDate: context.postingDate,
        quantity: 2,
        unitCost: 10,
        currencyCode: context.functionalCurrencyCode,
        note: "OU04 central insufficient",
      })
    );
    movementIds.push(...receiptMovementIds);

    const centralToOuTransfer = await createApprovedTransfer({
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      transferDate: context.postingDate,
      sourceWarehouseId: Number(warehouses.centralShip.id),
      targetWarehouseId: Number(warehouses.ouA.id),
      itemCardId: Number(stockedItem.id),
      quantityRequested: 7,
      note: "OU04 CENTRAL->OU",
    });
    transferIds.push(Number(centralToOuTransfer.id));
    const centralToOuShipped = await shipInventoryTransferById({
      payload: {
        tenantId: context.tenantId,
        userId: 7,
        transferId: Number(centralToOuTransfer.id),
      },
    });
    const centralLine = centralToOuShipped.lines?.[0] || null;
    assert(
      centralToOuShipped.status === "IN_TRANSIT" &&
        Number(centralToOuShipped.shippedByUserId) === 7 &&
        Number(centralToOuShipped.shipmentJournalEntryId) > 0,
      "CENTRAL -> OU shipment should set IN_TRANSIT and header journal fields"
    );
    assertClose(centralLine.quantityShipped, 7, "CENTRAL -> OU should ship requested quantity");
    assertClose(
      centralLine.shippedTotalCostTxn,
      74,
      "CENTRAL -> OU should persist FIFO shipment total txn cost"
    );
    assertClose(
      centralLine.shippedUnitCostTxn,
      10.571429,
      "CENTRAL -> OU should persist FIFO shipment unit txn cost"
    );
    assert(
      centralLine.shippedCurrencyCode === context.functionalCurrencyCode &&
        Number(centralLine.sourceIssueMovementId) > 0,
      "CENTRAL -> OU should persist shipment currency and issue movement id"
    );
    journalEntryIds.push(Number(centralToOuShipped.shipmentJournalEntryId));
    movementIds.push(Number(centralLine.sourceIssueMovementId));

    const centralIssueMovement = await loadMovementRow(Number(centralLine.sourceIssueMovementId));
    assert(
      centralIssueMovement &&
        centralIssueMovement.movement_type === "ISSUE" &&
        centralIssueMovement.source_type === "INVENTORY_TRANSFER" &&
        centralIssueMovement.source_document_type === "INVENTORY_TRANSFER" &&
        Number(centralIssueMovement.source_document_id) === Number(centralToOuShipped.id) &&
        Number(centralIssueMovement.source_document_line_id) === Number(centralLine.id) &&
        centralIssueMovement.valuation_status === "VALUED" &&
        !Number(centralIssueMovement.posted_journal_entry_id || 0),
      "CENTRAL -> OU shipment should create valued transfer-linked issue movement without per-movement journal linkage"
    );
    const centralConsumptions = await loadIssueConsumptions(Number(centralLine.sourceIssueMovementId));
    assert(
      centralConsumptions.length === 2 &&
        Math.abs(centralConsumptions[0] - 5) <= 0.000001 &&
        Math.abs(centralConsumptions[1] - 2) <= 0.000001,
      "CENTRAL -> OU shipment should consume FIFO layers oldest-first"
    );
    const centralJournalLines = await loadJournalLines(Number(centralToOuShipped.shipmentJournalEntryId));
    assert(centralJournalLines.length === 4, "CENTRAL -> OU shipment should post one four-line journal");
    expectJournalLine(centralJournalLines, {
      accountId: itemAccounts.inventoryTransit.id,
      operatingUnitId: unitA.id,
      debitBase: 74,
      creditBase: 0,
    });
    expectJournalLine(centralJournalLines, {
      accountId: unitAAccounts.centralDueFrom.id,
      operatingUnitId: null,
      debitBase: 74,
      creditBase: 0,
    });
    expectJournalLine(centralJournalLines, {
      accountId: itemAccounts.inventoryAsset.id,
      operatingUnitId: null,
      debitBase: 0,
      creditBase: 74,
    });
    expectJournalLine(centralJournalLines, {
      accountId: unitAAccounts.ouDueToCentral.id,
      operatingUnitId: unitA.id,
      debitBase: 0,
      creditBase: 74,
    });
    assert(
      centralJournalLines.every(
        (row) => !["EXPENSE", "REVENUE"].includes(String(row.account_type || "").toUpperCase())
      ),
      "CENTRAL -> OU shipment journal should not use revenue/expense/COGS account types"
    );
    const centralJournalLink = await loadJournalSourceLink(
      Number(centralToOuShipped.shipmentJournalEntryId),
      Number(centralToOuShipped.id)
    );
    assert(
      centralJournalLink?.source_ref_type === "INVENTORY_TRANSFER" &&
        centralJournalLink?.link_role === "PRIMARY",
      "CENTRAL -> OU shipment journal should link back to the transfer header"
    );

    const ouToCentralTransfer = await createApprovedTransfer({
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      transferDate: context.postingDate,
      sourceWarehouseId: Number(warehouses.ouA.id),
      targetWarehouseId: Number(warehouses.centralReceive.id),
      itemCardId: Number(stockedItem.id),
      quantityRequested: 6,
      note: "OU04 OU->CENTRAL",
    });
    transferIds.push(Number(ouToCentralTransfer.id));
    const ouToCentralShipped = await shipInventoryTransferById({
      payload: {
        tenantId: context.tenantId,
        userId: 7,
        transferId: Number(ouToCentralTransfer.id),
      },
    });
    const ouToCentralLine = ouToCentralShipped.lines?.[0] || null;
    journalEntryIds.push(Number(ouToCentralShipped.shipmentJournalEntryId));
    movementIds.push(Number(ouToCentralLine.sourceIssueMovementId));
    assertClose(
      ouToCentralLine.shippedTotalCostTxn,
      58,
      "OU -> CENTRAL should persist FIFO shipment total txn cost"
    );
    const ouToCentralJournalLines = await loadJournalLines(
      Number(ouToCentralShipped.shipmentJournalEntryId)
    );
    expectJournalLine(ouToCentralJournalLines, {
      accountId: itemAccounts.inventoryTransit.id,
      operatingUnitId: null,
      debitBase: 58,
      creditBase: 0,
    });
    expectJournalLine(ouToCentralJournalLines, {
      accountId: unitAAccounts.ouDueFromCentral.id,
      operatingUnitId: unitA.id,
      debitBase: 58,
      creditBase: 0,
    });
    expectJournalLine(ouToCentralJournalLines, {
      accountId: itemAccounts.inventoryAsset.id,
      operatingUnitId: unitA.id,
      debitBase: 0,
      creditBase: 58,
    });
    expectJournalLine(ouToCentralJournalLines, {
      accountId: unitAAccounts.centralDueTo.id,
      operatingUnitId: null,
      debitBase: 0,
      creditBase: 58,
    });

    const ouToOuTransfer = await createApprovedTransfer({
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      transferDate: context.postingDate,
      sourceWarehouseId: Number(warehouses.ouA.id),
      targetWarehouseId: Number(warehouses.ouB.id),
      itemCardId: Number(stockedItem.id),
      quantityRequested: 3,
      note: "OU04 OU->OU",
    });
    transferIds.push(Number(ouToOuTransfer.id));
    const ouToOuShipped = await shipInventoryTransferById({
      payload: {
        tenantId: context.tenantId,
        userId: 7,
        transferId: Number(ouToOuTransfer.id),
      },
    });
    const ouToOuLine = ouToOuShipped.lines?.[0] || null;
    journalEntryIds.push(Number(ouToOuShipped.shipmentJournalEntryId));
    movementIds.push(Number(ouToOuLine.sourceIssueMovementId));
    assertClose(
      ouToOuLine.shippedTotalCostTxn,
      33,
      "OU -> OU should persist FIFO shipment total txn cost"
    );
    const ouToOuJournalLines = await loadJournalLines(Number(ouToOuShipped.shipmentJournalEntryId));
    expectJournalLine(ouToOuJournalLines, {
      accountId: itemAccounts.inventoryTransit.id,
      operatingUnitId: unitB.id,
      debitBase: 33,
      creditBase: 0,
    });
    expectJournalLine(ouToOuJournalLines, {
      accountId: partnerForwardAccounts.dueFrom.id,
      operatingUnitId: unitA.id,
      debitBase: 33,
      creditBase: 0,
    });
    expectJournalLine(ouToOuJournalLines, {
      accountId: itemAccounts.inventoryAsset.id,
      operatingUnitId: unitA.id,
      debitBase: 0,
      creditBase: 33,
    });
    expectJournalLine(ouToOuJournalLines, {
      accountId: partnerReverseAccounts.dueTo.id,
      operatingUnitId: unitB.id,
      debitBase: 0,
      creditBase: 33,
    });

    const missingMapRemainingBefore = await sumRemainingLayerQuantity(
      Number(warehouses.centralMissingMap.id),
      Number(stockedItem.id)
    );
    const missingMappingTransfer = await createApprovedTransfer({
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      transferDate: context.postingDate,
      sourceWarehouseId: Number(warehouses.centralMissingMap.id),
      targetWarehouseId: Number(warehouses.ouPartial.id),
      itemCardId: Number(stockedItem.id),
      quantityRequested: 1,
      note: "OU04 missing current-account mapping",
    });
    transferIds.push(Number(missingMappingTransfer.id));
    await assertThrowsAsync(
      () =>
        shipInventoryTransferById({
          payload: {
            tenantId: context.tenantId,
            userId: 7,
            transferId: Number(missingMappingTransfer.id),
          },
        }),
      "Configure all four central <-> OU current-account fields"
    );
    const missingMappingDetail = await getInventoryTransferById({
      tenantId: context.tenantId,
      transferId: Number(missingMappingTransfer.id),
    });
    const missingMapRemainingAfter = await sumRemainingLayerQuantity(
      Number(warehouses.centralMissingMap.id),
      Number(stockedItem.id)
    );
    assert(
      missingMappingDetail.status === "APPROVED" &&
        !Number(missingMappingDetail.shipmentJournalEntryId || 0) &&
        !Number(missingMappingDetail.lines?.[0]?.sourceIssueMovementId || 0),
      "Missing current-account mapping should leave transfer unshipped"
    );
    assertClose(
      missingMapRemainingAfter,
      missingMapRemainingBefore,
      "Missing current-account mapping should roll back source stock consumption"
    );

    const noTransitTransfer = await createApprovedTransfer({
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      transferDate: context.postingDate,
      sourceWarehouseId: Number(warehouses.centralMissingTransit.id),
      targetWarehouseId: Number(warehouses.ouA.id),
      itemCardId: Number(noTransitItem.id),
      quantityRequested: 1,
      note: "OU04 missing transit account",
    });
    transferIds.push(Number(noTransitTransfer.id));
    await assertThrowsAsync(
      () =>
        shipInventoryTransferById({
          payload: {
            tenantId: context.tenantId,
            userId: 7,
            transferId: Number(noTransitTransfer.id),
          },
        }),
      "requires inventoryTransitAccountId"
    );

    const insufficientTransfer = await createApprovedTransfer({
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      transferDate: context.postingDate,
      sourceWarehouseId: Number(warehouses.centralInsufficient.id),
      targetWarehouseId: Number(warehouses.ouA.id),
      itemCardId: Number(stockedItem.id),
      quantityRequested: 5,
      note: "OU04 insufficient stock",
    });
    transferIds.push(Number(insufficientTransfer.id));
    await assertThrowsAsync(
      () =>
        shipInventoryTransferById({
          payload: {
            tenantId: context.tenantId,
            userId: 7,
            transferId: Number(insufficientTransfer.id),
          },
        }),
      "Insufficient available stock"
    );

    console.log("Inventory OU04 shipment self-balancing smoke passed.");
  } finally {
    if (transferIds.length > 0) {
      await query(
        `DELETE FROM inventory_transfer_lines
          WHERE inventory_transfer_id IN (${transferIds.map(() => "?").join(",")})`,
        transferIds
      );
      await query(
        `DELETE FROM inventory_transfers
          WHERE id IN (${transferIds.map(() => "?").join(",")})`,
        transferIds
      );
    }
    if (movementIds.length > 0) {
      await query(
        `DELETE FROM inventory_issue_layer_consumptions
          WHERE issue_movement_id IN (${movementIds.map(() => "?").join(",")})`,
        movementIds
      );
    }
    if (journalEntryIds.length > 0) {
      await query(
        `DELETE FROM journal_source_links
          WHERE journal_entry_id IN (${journalEntryIds.map(() => "?").join(",")})`,
        journalEntryIds
      );
      await query(
        `DELETE FROM journal_lines
          WHERE journal_entry_id IN (${journalEntryIds.map(() => "?").join(",")})`,
        journalEntryIds
      );
      await query(
        `DELETE FROM journal_entries
          WHERE id IN (${journalEntryIds.map(() => "?").join(",")})`,
        journalEntryIds
      );
    }
    if (receiptMovementIds.length > 0) {
      await query(
        `DELETE FROM inventory_cost_layers
          WHERE source_movement_id IN (${receiptMovementIds.map(() => "?").join(",")})`,
        receiptMovementIds
      );
    }
    if (movementIds.length > 0) {
      await query(
        `DELETE FROM inventory_movements
          WHERE id IN (${movementIds.map(() => "?").join(",")})`,
        movementIds
      );
    }
    if (warehouseIds.length > 0) {
      await query(
        `DELETE FROM inventory_warehouses
          WHERE id IN (${warehouseIds.map(() => "?").join(",")})`,
        warehouseIds
      );
    }
    if (itemCardIds.length > 0) {
      await query(
        `DELETE FROM item_cards
          WHERE id IN (${itemCardIds.map(() => "?").join(",")})`,
        itemCardIds
      );
    }
    if (createdPartnerMappings.length > 0) {
      const conditions = createdPartnerMappings
        .map(() => "(operating_unit_id = ? AND partner_operating_unit_id = ?)")
        .join(" OR ");
      const params = createdPartnerMappings.flatMap(([sourceId, targetId]) => [
        sourceId,
        targetId,
      ]);
      await query(
        `DELETE FROM operating_unit_partner_current_accounts
          WHERE ${conditions}`,
        params
      );
    }
    if (createdUnitIds.length > 0) {
      await query(
        `DELETE FROM operating_units
          WHERE id IN (${createdUnitIds.map(() => "?").join(",")})`,
        createdUnitIds
      );
    }
    if (createdAccountIds.length > 0) {
      await query(
        `DELETE FROM accounts
          WHERE id IN (${createdAccountIds.map(() => "?").join(",")})`,
        createdAccountIds
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
