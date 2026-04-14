import assert from "node:assert/strict";

import { closePool, query } from "../src/db.js";
import { seedCore } from "../src/seedCore.js";
import { assertLegalEntityBelongsToTenant } from "../src/tenantGuards.js";
import { createItemCard } from "../src/services/item.card.service.js";
import { createInventoryWarehouse } from "../src/services/inventory.service.js";
import {
  upsertOperatingUnit,
  upsertOperatingUnitPartnerCurrentAccount,
} from "../src/services/org.write.service.js";
import {
  apiRequest,
  createBootstrapAdmin,
  login,
  startServerProcess,
  waitForServer,
} from "./ex05-test-helpers.js";
import { createInventoryOuAccountingFixture } from "./inventory-ou-smoke-fixture.js";

const PORT = Number(process.env.INVEXEC_BRANCH_EXEC_SMOKE_PORT || 3156);
const BASE_URL =
  process.env.INVEXEC_BRANCH_EXEC_SMOKE_BASE_URL || `http://127.0.0.1:${PORT}`;

function logStep(step) {
  // Keep long end-to-end smoke runs observable so failures can be localized quickly.
  console.log(`[INVEXEC-SMOKE] ${step}`);
}

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function uniqueCode(prefix) {
  const token = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return `${prefix}${token}`.slice(0, 40).toUpperCase();
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
     ) VALUES (?, ?, ?, ?, 'RECEIPT', 'MANUAL', NULL, 'INVEXEC_SETUP', NULL, NULL, ?, ?, ?, ?, ?, ?, ?, 'VALUED', ?)`,
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
  assert(movementId > 0, "Expected seeded receipt movement id");

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

async function createCounterpartyFixture({
  tenantId,
  legalEntityId,
  currencyCode,
}) {
  const code = uniqueCode("INVEXCP");
  const result = await query(
    `INSERT INTO counterparties (
        tenant_id,
        legal_entity_id,
        code,
        name,
        is_customer,
        is_vendor,
        default_currency_code,
        status
      )
      VALUES (?, ?, ?, ?, FALSE, TRUE, ?, 'ACTIVE')`,
    [tenantId, legalEntityId, code, `INVEXEC Vendor ${code}`, currencyCode]
  );
  const id = Number(result.rows?.insertId || 0);
  assert(id > 0, "Expected counterparty fixture id");
  return { id, code };
}

async function createOuScopedReceiptPendingStockLink({
  tenantId,
  legalEntityId,
  operatingUnitId,
  counterpartyId,
  itemCardId,
  warehouseId,
  currencyCode,
  documentDate,
  quantity,
  lineAmount,
}) {
  const documentNo = uniqueCode("INVEXDOC");
  const fiscalYear = Number(String(documentDate || "").slice(0, 4));
  const normalizedQuantity = Number(Number(quantity).toFixed(6));
  const normalizedLineAmount = Number(Number(lineAmount).toFixed(6));

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
  assert(counterpartyRow, "Expected counterparty snapshot for receipt stock-link fixture");

  const documentResult = await query(
    `INSERT INTO cari_documents (
        tenant_id,
        legal_entity_id,
        operating_unit_id,
        counterparty_id,
        payment_term_id,
        direction,
        document_type,
        sequence_namespace,
        fiscal_year,
        sequence_no,
        document_no,
        status,
        document_date,
        due_date,
        amount_txn,
        amount_base,
        subtotal_amount_txn,
        subtotal_amount_base,
        tax_amount_txn,
        tax_amount_base,
        gross_amount_txn,
        gross_amount_base,
        open_amount_txn,
        open_amount_base,
        currency_code,
        fx_rate,
        counterparty_code_snapshot,
        counterparty_name_snapshot,
        payment_term_snapshot,
        due_date_snapshot,
        currency_code_snapshot,
        fx_rate_snapshot
      )
      VALUES (?, ?, ?, ?, NULL, 'AP', 'INVOICE', 'CARI_AP', ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, 1, ?, ?, NULL, ?, ?, 1)`,
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
      normalizedLineAmount,
      normalizedLineAmount,
      normalizedLineAmount,
      normalizedLineAmount,
      normalizedLineAmount,
      normalizedLineAmount,
      normalizedLineAmount,
      normalizedLineAmount,
      currencyCode,
      String(counterpartyRow.code || ""),
      String(counterpartyRow.name || ""),
      documentDate,
      currencyCode,
    ]
  );
  const documentId = Number(documentResult.rows?.insertId || 0);
  assert(documentId > 0, "Expected receipt fixture document id");

  const unitPrice = Number((normalizedLineAmount / normalizedQuantity).toFixed(6));
  const lineResult = await query(
    `INSERT INTO cari_document_lines (
        tenant_id,
        legal_entity_id,
        cari_document_id,
        line_no,
        line_kind,
        description,
        item_card_id,
        quantity,
        unit_price_txn,
        line_net_amount_txn,
        line_tax_amount_txn,
        line_gross_amount_txn,
        line_net_amount_base,
        line_tax_amount_base,
        line_gross_amount_base,
        posting_account_id,
        tax_category_code,
        stock_impact_mode
      )
      VALUES (?, ?, ?, 1, 'STANDARD', ?, ?, ?, ?, ?, 0, ?, ?, 0, ?, NULL, NULL, 'RECEIPT_PENDING')`,
    [
      tenantId,
      legalEntityId,
      documentId,
      "INVEXEC receipt pending line",
      itemCardId,
      normalizedQuantity,
      unitPrice,
      normalizedLineAmount,
      normalizedLineAmount,
      normalizedLineAmount,
      normalizedLineAmount,
    ]
  );
  const lineId = Number(lineResult.rows?.insertId || 0);
  assert(lineId > 0, "Expected receipt fixture document line id");

  const stockLinkResult = await query(
    `INSERT INTO cari_document_line_stock_links (
        tenant_id,
        legal_entity_id,
        cari_document_id,
        cari_document_line_id,
        item_card_id,
        direction,
        stock_impact_mode,
        link_status,
        requested_quantity,
        posted_net_amount_txn,
        posted_net_amount_base,
        warehouse_id
      )
      VALUES (?, ?, ?, ?, ?, 'AP', 'RECEIPT_PENDING', 'PENDING', ?, ?, ?, ?)`,
    [
      tenantId,
      legalEntityId,
      documentId,
      lineId,
      itemCardId,
      normalizedQuantity,
      normalizedLineAmount,
      normalizedLineAmount,
      warehouseId,
    ]
  );
  const stockLinkId = Number(stockLinkResult.rows?.insertId || 0);
  assert(stockLinkId > 0, "Expected receipt fixture stock link id");

  return {
    documentId,
    lineId,
    stockLinkId,
  };
}

async function createActiveTenantUser({ baseUrl, token, email, name, password }) {
  const response = await apiRequest({
    baseUrl,
    token,
    method: "POST",
    requestPath: "/api/v1/security/users",
    expectedStatus: 201,
    body: {
      email,
      name,
      password,
      status: "ACTIVE",
    },
  });
  const userId = toPositiveInt(response.json?.id);
  assert(userId > 0, `Tenant user ${email} should be created`);
  return {
    userId,
    email,
    password,
    name,
  };
}

async function assignBranchOperator({
  baseUrl,
  token,
  email,
  name,
  operatingUnitId,
}) {
  const response = await apiRequest({
    baseUrl,
    token,
    method: "POST",
    requestPath: "/api/v1/security/entity-branch-operators",
    expectedStatus: 201,
    body: {
      email,
      name,
      operatingUnitId,
    },
  });
  assert.equal(
    response.json?.role?.code,
    "BranchOperator",
    "Branch-operator compatibility seam must assign BranchOperator"
  );
  assert(
    (response.json?.createdCompanionRoleCodes || []).includes("BranchInventoryExecutor"),
    "Branch-operator compatibility seam must auto-assign BranchInventoryExecutor"
  );
  return response.json;
}

async function loadStockLinkRow(stockLinkId) {
  const result = await query(
    `SELECT id, link_status, inventory_movement_id
       FROM cari_document_line_stock_links
      WHERE id = ?
      LIMIT 1`,
    [stockLinkId]
  );
  return result.rows?.[0] || null;
}

async function main() {
  logStep("creating accounting fixture");
  const context = await createInventoryOuAccountingFixture({
    prefix: "INVEXEC64",
  });
  logStep("reseeding full role catalog for the fresh tenant");
  await seedCore({
    ensureDefaultTenantIfMissing: true,
  });
  const adminPassword = "InvexecAdmin#12345";
  const adminEmail = `invexec_admin_${Date.now()}@example.com`;
  logStep("creating bootstrap admin");
  const admin = await createBootstrapAdmin({
    tenantId: context.tenantId,
    email: adminEmail,
    password: adminPassword,
    name: "INVEXEC Admin",
  });

  const req = buildReq(context.tenantId, admin.userId);
  const itemAccounts = {
    inventoryAsset: await createLeafAccount({
      coaId: context.coaId,
      code: uniqueCode("INVEXIA"),
      name: "INVEXEC Inventory Asset",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    inventoryTransit: await createLeafAccount({
      coaId: context.coaId,
      code: uniqueCode("INVEXIT"),
      name: "INVEXEC Inventory Transit",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
  };
  const unitAAccounts = {
    centralDueFrom: await createLeafAccount({
      coaId: context.coaId,
      code: uniqueCode("INVEXA1"),
      name: "INVEXEC A Central Due From",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    centralDueTo: await createLeafAccount({
      coaId: context.coaId,
      code: uniqueCode("INVEXA2"),
      name: "INVEXEC A Central Due To",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    ouDueFromCentral: await createLeafAccount({
      coaId: context.coaId,
      code: uniqueCode("INVEXA3"),
      name: "INVEXEC A OU Due From Central",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    ouDueToCentral: await createLeafAccount({
      coaId: context.coaId,
      code: uniqueCode("INVEXA4"),
      name: "INVEXEC A OU Due To Central",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
  };
  const unitBAccounts = {
    centralDueFrom: await createLeafAccount({
      coaId: context.coaId,
      code: uniqueCode("INVEXB1"),
      name: "INVEXEC B Central Due From",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    centralDueTo: await createLeafAccount({
      coaId: context.coaId,
      code: uniqueCode("INVEXB2"),
      name: "INVEXEC B Central Due To",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    ouDueFromCentral: await createLeafAccount({
      coaId: context.coaId,
      code: uniqueCode("INVEXB3"),
      name: "INVEXEC B OU Due From Central",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    ouDueToCentral: await createLeafAccount({
      coaId: context.coaId,
      code: uniqueCode("INVEXB4"),
      name: "INVEXEC B OU Due To Central",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
  };
  const partnerAccounts = {
    aToBDueFrom: await createLeafAccount({
      coaId: context.coaId,
      code: uniqueCode("INVEXPF"),
      name: "INVEXEC A Due From B",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    aToBDueTo: await createLeafAccount({
      coaId: context.coaId,
      code: uniqueCode("INVEXPT"),
      name: "INVEXEC A Due To B",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
    bToADueFrom: await createLeafAccount({
      coaId: context.coaId,
      code: uniqueCode("INVEXRF"),
      name: "INVEXEC B Due From A",
      accountType: "ASSET",
      normalSide: "DEBIT",
    }),
    bToADueTo: await createLeafAccount({
      coaId: context.coaId,
      code: uniqueCode("INVEXRT"),
      name: "INVEXEC B Due To A",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    }),
  };

  logStep("creating operating units and partner mappings");
  const sourceUnit = await upsertOperatingUnit({
    req,
    tenantId: context.tenantId,
    legalEntityId: context.legalEntityId,
    code: uniqueCode("INVEXOUA"),
    name: "INVEXEC Source Branch",
    unitType: "BRANCH",
    hasSubledger: false,
    centralDueFromAccountId: unitAAccounts.centralDueFrom.id,
    centralDueToAccountId: unitAAccounts.centralDueTo.id,
    ouDueFromCentralAccountId: unitAAccounts.ouDueFromCentral.id,
    ouDueToCentralAccountId: unitAAccounts.ouDueToCentral.id,
    assertLegalEntityBelongsToTenant,
    assertScopeAccess: () => {},
  });
  const targetUnit = await upsertOperatingUnit({
    req,
    tenantId: context.tenantId,
    legalEntityId: context.legalEntityId,
    code: uniqueCode("INVEXOUB"),
    name: "INVEXEC Target Branch",
    unitType: "BRANCH",
    hasSubledger: false,
    centralDueFromAccountId: unitBAccounts.centralDueFrom.id,
    centralDueToAccountId: unitBAccounts.centralDueTo.id,
    ouDueFromCentralAccountId: unitBAccounts.ouDueFromCentral.id,
    ouDueToCentralAccountId: unitBAccounts.ouDueToCentral.id,
    assertLegalEntityBelongsToTenant,
    assertScopeAccess: () => {},
  });

  await upsertOperatingUnitPartnerCurrentAccount({
    req,
    tenantId: context.tenantId,
    legalEntityId: context.legalEntityId,
    operatingUnitId: sourceUnit.id,
    partnerOperatingUnitId: targetUnit.id,
    dueFromAccountId: partnerAccounts.aToBDueFrom.id,
    dueToAccountId: partnerAccounts.aToBDueTo.id,
    assertLegalEntityBelongsToTenant,
    assertScopeAccess: () => {},
  });
  await upsertOperatingUnitPartnerCurrentAccount({
    req,
    tenantId: context.tenantId,
    legalEntityId: context.legalEntityId,
    operatingUnitId: targetUnit.id,
    partnerOperatingUnitId: sourceUnit.id,
    dueFromAccountId: partnerAccounts.bToADueFrom.id,
    dueToAccountId: partnerAccounts.bToADueTo.id,
    assertLegalEntityBelongsToTenant,
    assertScopeAccess: () => {},
  });

  logStep("creating warehouses and item card");
  const sourceWarehouse = await createInventoryWarehouse({
    payload: {
      tenantId: context.tenantId,
      userId: admin.userId,
      legalEntityId: context.legalEntityId,
      ownershipScope: "OPERATING_UNIT",
      operatingUnitId: sourceUnit.id,
      code: uniqueCode("INVEXWS"),
      name: "INVEXEC Source Warehouse",
      status: "ACTIVE",
    },
  });
  const targetWarehouse = await createInventoryWarehouse({
    payload: {
      tenantId: context.tenantId,
      userId: admin.userId,
      legalEntityId: context.legalEntityId,
      ownershipScope: "OPERATING_UNIT",
      operatingUnitId: targetUnit.id,
      code: uniqueCode("INVEXWT"),
      name: "INVEXEC Target Warehouse",
      status: "ACTIVE",
    },
  });

  const itemCard = await createItemCard({
    payload: {
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      code: uniqueCode("INVEXITM"),
      name: "INVEXEC Stock Item",
      itemType: "STOCK_ITEM",
      inventoryAssetAccountId: itemAccounts.inventoryAsset.id,
      inventoryTransitAccountId: itemAccounts.inventoryTransit.id,
      status: "ACTIVE",
    },
  });

  logStep("seeding source stock and pending receipt stock link");
  await insertReceiptCostLayer({
    tenantId: context.tenantId,
    legalEntityId: context.legalEntityId,
    warehouseId: Number(sourceWarehouse.id),
    itemCardId: Number(itemCard.id),
    movementDate: context.postingDate,
    quantity: 8,
    unitCost: 14,
    currencyCode: context.functionalCurrencyCode,
    note: "INVEXEC seeded source stock",
  });

  const counterparty = await createCounterpartyFixture({
    tenantId: context.tenantId,
    legalEntityId: context.legalEntityId,
    currencyCode: context.functionalCurrencyCode,
  });
  const receiptFixture = await createOuScopedReceiptPendingStockLink({
    tenantId: context.tenantId,
    legalEntityId: context.legalEntityId,
    operatingUnitId: sourceUnit.id,
    counterpartyId: counterparty.id,
    itemCardId: Number(itemCard.id),
    warehouseId: Number(sourceWarehouse.id),
    currencyCode: context.functionalCurrencyCode,
    documentDate: context.postingDate,
    quantity: 2,
    lineAmount: 48,
  });

  const server = startServerProcess({ port: PORT });
  let serverStopped = false;

  try {
    logStep(`waiting for API server on ${BASE_URL}`);
    await waitForServer({ baseUrl: BASE_URL });
    logStep("logging in bootstrap admin");
    const adminToken = await login({
      baseUrl: BASE_URL,
      email: adminEmail,
      password: adminPassword,
    });

    logStep("creating source and target branch users");
    const sourceUser = await createActiveTenantUser({
      baseUrl: BASE_URL,
      token: adminToken,
      email: `invexec_source_${Date.now()}@example.com`,
      name: "INVEXEC Source User",
      password: "InvexecSource#12345",
    });
    const targetUser = await createActiveTenantUser({
      baseUrl: BASE_URL,
      token: adminToken,
      email: `invexec_target_${Date.now()}@example.com`,
      name: "INVEXEC Target User",
      password: "InvexecTarget#12345",
    });

    logStep("assigning BranchOperator to both OU-scoped users");
    await assignBranchOperator({
      baseUrl: BASE_URL,
      token: adminToken,
      email: sourceUser.email,
      name: sourceUser.name,
      operatingUnitId: sourceUnit.id,
    });
    await assignBranchOperator({
      baseUrl: BASE_URL,
      token: adminToken,
      email: targetUser.email,
      name: targetUser.name,
      operatingUnitId: targetUnit.id,
    });

    logStep("logging in branch users");
    const sourceToken = await login({
      baseUrl: BASE_URL,
      email: sourceUser.email,
      password: sourceUser.password,
    });
    const targetToken = await login({
      baseUrl: BASE_URL,
      email: targetUser.email,
      password: targetUser.password,
    });

    logStep("listing source OU receipt queue and materializing stock link");
    const queueResponse = await apiRequest({
      baseUrl: BASE_URL,
      token: sourceToken,
      method: "GET",
      requestPath:
        `/api/v1/inventory/cari-stock-links?legalEntityId=${context.legalEntityId}` +
        `&operatingUnitId=${sourceUnit.id}&queueScope=ACTIONABLE&limit=100&offset=0`,
      expectedStatus: 200,
    });
    const receiptQueueRow = (queueResponse.json?.rows || []).find(
      (row) => toPositiveInt(row.id) === receiptFixture.stockLinkId
    );
    assert(receiptQueueRow, "OU-scoped branch user should see its ready receipt queue row");
    assert.equal(
      String(receiptQueueRow.queueState || "").toUpperCase(),
      "READY",
      "Receipt queue row should be READY for branch execution"
    );
    assert.equal(
      Boolean(receiptQueueRow.canMaterialize),
      true,
      "Receipt queue row should be materializable by the branch executor"
    );

    const materializeResponse = await apiRequest({
      baseUrl: BASE_URL,
      token: sourceToken,
      method: "POST",
      requestPath: `/api/v1/inventory/cari-stock-links/${receiptFixture.stockLinkId}/materialize`,
      expectedStatus: 201,
      body: {
        legalEntityId: context.legalEntityId,
        movementDate: context.postingDate,
        note: "INVEXEC branch materialize",
      },
    });
    const materializedMovementId = toPositiveInt(materializeResponse.json?.row?.id);
    assert(materializedMovementId > 0, "Branch executor should materialize one receipt movement");

    const stockLinkAfterMaterialize = await loadStockLinkRow(receiptFixture.stockLinkId);
    assert.equal(
      String(stockLinkAfterMaterialize?.link_status || "").toUpperCase(),
      "LINKED",
      "Materialized stock link should transition to LINKED"
    );
    assert.equal(
      toPositiveInt(stockLinkAfterMaterialize?.inventory_movement_id),
      materializedMovementId,
      "Materialized stock link should persist the created movement id"
    );

    logStep("verifying blocked setup and landed-cost/item-card actions");
    await apiRequest({
      baseUrl: BASE_URL,
      token: sourceToken,
      method: "POST",
      requestPath: "/api/v1/inventory/warehouses",
      expectedStatus: 403,
      body: {
        legalEntityId: context.legalEntityId,
        ownershipScope: "OPERATING_UNIT",
        operatingUnitId: sourceUnit.id,
        code: uniqueCode("INVEXNW"),
        name: "INVEXEC Blocked Warehouse",
        status: "ACTIVE",
      },
    });

    await apiRequest({
      baseUrl: BASE_URL,
      token: sourceToken,
      method: "POST",
      requestPath: "/api/v1/inventory/landed-cost-vouchers",
      expectedStatus: 403,
      body: {
        legalEntityId: context.legalEntityId,
      },
    });

    await apiRequest({
      baseUrl: BASE_URL,
      token: sourceToken,
      method: "POST",
      requestPath: "/api/v1/inventory/landed-cost-vouchers/999999/reverse",
      expectedStatus: 403,
      body: {
        legalEntityId: context.legalEntityId,
      },
    });

    await apiRequest({
      baseUrl: BASE_URL,
      token: sourceToken,
      method: "PATCH",
      requestPath: `/api/v1/items/cards/${itemCard.id}`,
      expectedStatus: 403,
      body: {
        legalEntityId: context.legalEntityId,
        name: "INVEXEC Blocked Item Edit",
      },
    });

    logStep("creating transfer as source branch user");
    const createTransferResponse = await apiRequest({
      baseUrl: BASE_URL,
      token: sourceToken,
      method: "POST",
      requestPath: "/api/v1/inventory/transfers",
      expectedStatus: 201,
      body: {
        legalEntityId: context.legalEntityId,
        transferDate: context.postingDate,
        sourceWarehouseId: Number(sourceWarehouse.id),
        targetWarehouseId: Number(targetWarehouse.id),
        note: "INVEXEC OU to OU transfer",
        lines: [
          {
            itemCardId: Number(itemCard.id),
            quantityRequested: "3.000000",
          },
        ],
      },
    });
    const transferId = toPositiveInt(createTransferResponse.json?.row?.id);
    assert(transferId > 0, "Branch executor should create an OU-scoped inventory transfer");

    logStep("verifying branch user cannot approve transfer");
    await apiRequest({
      baseUrl: BASE_URL,
      token: sourceToken,
      method: "POST",
      requestPath: `/api/v1/inventory/transfers/${transferId}/approve`,
      expectedStatus: 403,
      body: {},
    });

    logStep("approving with admin, then shipping and receiving with branch users");
    const approveTransferResponse = await apiRequest({
      baseUrl: BASE_URL,
      token: adminToken,
      method: "POST",
      requestPath: `/api/v1/inventory/transfers/${transferId}/approve`,
      expectedStatus: 200,
      body: {},
    });
    assert.equal(
      String(approveTransferResponse.json?.row?.status || "").toUpperCase(),
      "APPROVED",
      "Admin approval should move the transfer into APPROVED state"
    );

    const shipTransferResponse = await apiRequest({
      baseUrl: BASE_URL,
      token: sourceToken,
      method: "POST",
      requestPath: `/api/v1/inventory/transfers/${transferId}/ship`,
      expectedStatus: 200,
      body: {},
    });
    assert.equal(
      String(shipTransferResponse.json?.row?.status || "").toUpperCase(),
      "IN_TRANSIT",
      "Source branch executor should move the transfer into IN_TRANSIT on shipment"
    );
    assert(
      toPositiveInt(shipTransferResponse.json?.row?.shipmentJournalEntryId) > 0,
      "Shipping should post the self-balancing shipment journal"
    );

    const receiveTransferResponse = await apiRequest({
      baseUrl: BASE_URL,
      token: targetToken,
      method: "POST",
      requestPath: `/api/v1/inventory/transfers/${transferId}/receive`,
      expectedStatus: 200,
      body: {},
    });
    assert.equal(
      String(receiveTransferResponse.json?.row?.status || "").toUpperCase(),
      "RECEIVED",
      "Target branch executor should receive the in-transit transfer"
    );
    assert(
      toPositiveInt(receiveTransferResponse.json?.row?.receiptJournalEntryId) > 0,
      "Receiving should post the receipt self-balancing journal"
    );

    await apiRequest({
      baseUrl: BASE_URL,
      token: sourceToken,
      method: "POST",
      requestPath: `/api/v1/inventory/transfers/${transferId}/reverse`,
      expectedStatus: 403,
      body: {
        legalEntityId: context.legalEntityId,
      },
    });

    logStep("completed branch execution matrix");
    console.log("Inventory INVEXEC branch execution smoke passed.");
    console.log(
      JSON.stringify(
        {
          tenantId: context.tenantId,
          legalEntityId: context.legalEntityId,
          sourceOperatingUnitId: sourceUnit.id,
          targetOperatingUnitId: targetUnit.id,
          sourceWarehouseId: sourceWarehouse.id,
          targetWarehouseId: targetWarehouse.id,
          itemCardId: itemCard.id,
          stockLinkId: receiptFixture.stockLinkId,
          materializedMovementId,
          transferId,
          sourceUserId: sourceUser.userId,
          targetUserId: targetUser.userId,
        },
        null,
        2
      )
    );
  } finally {
    if (!serverStopped) {
      server.kill();
      serverStopped = true;
    }
    await closePool();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
