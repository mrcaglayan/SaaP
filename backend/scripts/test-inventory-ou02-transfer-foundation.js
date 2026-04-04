import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseInventoryTransferCreateInput,
  parseInventoryTransferListFilters,
} from "../src/routes/inventory.transfer.validators.js";
import {
  approveInventoryTransferById,
  cancelInventoryTransferById,
  createInventoryTransfer,
  getInventoryTransferById,
  listInventoryTransfers,
  receiveInventoryTransferById,
  reverseInventoryTransferById,
  shipInventoryTransferById,
} from "../src/services/inventory.transfer.service.js";
import { createInventoryWarehouse } from "../src/services/inventory.service.js";
import { createItemCard } from "../src/services/item.card.service.js";
import { closePool, query } from "../src/db.js";
import { createInventoryOuCrossEntityFixture } from "./inventory-ou-smoke-fixture.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertThrows(fn, expectedMessage) {
  let thrown = null;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  assert(thrown, `Expected error containing "${expectedMessage}"`);
  const message = String(thrown?.message || thrown || "");
  assert(
    message.includes(expectedMessage),
    `Expected error containing "${expectedMessage}", got "${message}"`
  );
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

function makeReq({ body = {}, query = {} } = {}) {
  return {
    body,
    query,
    user: {
      tenantId: 1,
      userId: 7,
    },
    headers: {},
  };
}

function uniqueCode(prefix) {
  const token = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return `${prefix}${token}`.slice(0, 40).toUpperCase();
}

async function loadSmokeContext() {
  return createInventoryOuCrossEntityFixture({
    prefix: "INVOU02",
  });
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const [
    migration124Source,
    migration127Source,
    migrationIndexSource,
    appSource,
    sidebarSource,
    messagesSource,
    inventoryApiSource,
  ] = await Promise.all([
    readFile(
      path.resolve(root, "src/migrations/m124_inventory_transfer_foundation.js"),
      "utf8"
    ),
    readFile(
      path.resolve(root, "src/migrations/m127_inventory_transfer_source_type_backfill.js"),
      "utf8"
    ),
    readFile(path.resolve(root, "src/migrations/index.js"), "utf8"),
    readFile(path.resolve(root, "../frontend/src/App.jsx"), "utf8"),
    readFile(path.resolve(root, "../frontend/src/layouts/sidebarConfig.js"), "utf8"),
    readFile(path.resolve(root, "../frontend/src/i18n/messages.js"), "utf8"),
    readFile(path.resolve(root, "../frontend/src/api/inventory.js"), "utf8"),
  ]);

  assert(
    migration124Source.includes("inventory_transfers") &&
      migration124Source.includes("inventory_transfer_lines"),
    "m124 migration should create transfer header and lines"
  );
  assert(
    migration124Source.includes("INVENTORY_TRANSFER"),
    "m124 migration should extend inventory movement source_type with INVENTORY_TRANSFER"
  );
  assert(
    migration124Source.includes("SELECT column_type AS column_type") &&
      migration127Source.includes("SELECT column_type AS column_type"),
    "Inventory transfer enum migrations should alias information_schema column_type reads"
  );
  assert(
    migrationIndexSource.includes("m129_inventory_transfer_source_type_enum_repair") &&
      migrationIndexSource.includes("migration129InventoryTransferSourceTypeEnumRepair"),
    "migrations index should register m129 inventory transfer enum repair"
  );
  assert(
    appSource.includes('appPath: "/app/stok-transferleri"') &&
      appSource.includes('childPath: "stok-transferleri"'),
    "App route wiring should lock /app/stok-transferleri"
  );
  assert(
    sidebarSource.includes('to: "/app/stok-transferleri"') &&
      sidebarSource.includes('implemented: true'),
    "Sidebar should expose the transfer route as implemented"
  );
  assert(
    messagesSource.includes('"/app/stok-transferleri": "Stok Transferleri"') &&
      messagesSource.includes('"/app/stok-transferleri": "Inventory Transfers"'),
    "messages.sidebar.byPath should include the transfer route in TR and EN"
  );
  assert(
    inventoryApiSource.includes("/api/v1/inventory/transfers"),
    "inventory API client should expose transfer endpoints"
  );

  assertThrows(
    () =>
      parseInventoryTransferCreateInput(
        makeReq({
          body: {
            legalEntityId: 10,
            transferDate: "2026-03-13",
            sourceWarehouseId: 1,
            targetWarehouseId: 2,
          },
        })
      ),
    "lines must contain at least one transfer line"
  );

  const parsedCreatePayload = parseInventoryTransferCreateInput(
    makeReq({
      body: {
        legalEntityId: 10,
        transferDate: "2026-03-13",
        sourceWarehouseId: 11,
        targetWarehouseId: 12,
        lines: [
          {
            itemCardId: 77,
            quantityRequested: "5.250000",
            note: "Line note",
          },
        ],
      },
    })
  );
  assert(
    parsedCreatePayload.lines.length === 1 &&
      parsedCreatePayload.lines[0].quantityRequested === "5.250000",
    "Transfer create parser should preserve line quantities"
  );

  const parsedListFilters = parseInventoryTransferListFilters(
    makeReq({
      query: {
        legalEntityId: 10,
        sourceWarehouseId: 11,
        targetWarehouseId: 12,
        status: "approved",
      },
    })
  );
  assert(
    parsedListFilters.legalEntityId === 10 &&
      parsedListFilters.sourceWarehouseId === 11 &&
      parsedListFilters.targetWarehouseId === 12 &&
      parsedListFilters.status === "APPROVED",
    "Transfer list parser should normalize legal entity, warehouse, and status filters"
  );

  const context = await loadSmokeContext();
  const actingUserId = context.userId;
  const approverUserId = context.approverUserId;
  const warehouseIds = [];
  const itemCardIds = [];
  const transferIds = [];

  try {
    const centralWarehouse = await createInventoryWarehouse({
      payload: {
        tenantId: context.tenantId,
        userId: actingUserId,
        legalEntityId: context.legalEntityId,
        ownershipScope: "CENTRAL",
        code: uniqueCode("OU02C"),
        name: "OU02 Central Warehouse",
        status: "ACTIVE",
      },
    });
    warehouseIds.push(Number(centralWarehouse.id));

    const sourceOuWarehouse = await createInventoryWarehouse({
      payload: {
        tenantId: context.tenantId,
        userId: actingUserId,
        legalEntityId: context.legalEntityId,
        ownershipScope: "OPERATING_UNIT",
        operatingUnitId: context.operatingUnitId,
        code: uniqueCode("OU02O"),
        name: "OU02 OU Warehouse",
        status: "ACTIVE",
      },
    });
    warehouseIds.push(Number(sourceOuWarehouse.id));

    const sameContextCentralWarehouse = await createInventoryWarehouse({
      payload: {
        tenantId: context.tenantId,
        userId: actingUserId,
        legalEntityId: context.legalEntityId,
        ownershipScope: "CENTRAL",
        code: uniqueCode("OU02S"),
        name: "OU02 Central Peer Warehouse",
        status: "ACTIVE",
      },
    });
    warehouseIds.push(Number(sameContextCentralWarehouse.id));

    const alternateLegalEntityWarehouse = await createInventoryWarehouse({
      payload: {
        tenantId: context.tenantId,
        userId: actingUserId,
        legalEntityId: context.alternateLegalEntityId,
        ownershipScope: "CENTRAL",
        code: uniqueCode("OU02X"),
        name: "OU02 Alternate LE Warehouse",
        status: "ACTIVE",
      },
    });
    warehouseIds.push(Number(alternateLegalEntityWarehouse.id));

    const itemCard = await createItemCard({
      payload: {
        tenantId: context.tenantId,
        legalEntityId: context.legalEntityId,
        code: uniqueCode("OU02ITEM"),
        name: "OU02 Transfer Item",
        itemType: "STOCK_ITEM",
        status: "ACTIVE",
      },
    });
    itemCardIds.push(Number(itemCard.id));

    const createdTransfer = await createInventoryTransfer({
      payload: {
        tenantId: context.tenantId,
        userId: actingUserId,
        legalEntityId: context.legalEntityId,
        transferDate: "2026-03-13",
        sourceWarehouseId: Number(centralWarehouse.id),
        targetWarehouseId: Number(sourceOuWarehouse.id),
        note: "OU02 create smoke",
        lines: [
          {
            itemCardId: Number(itemCard.id),
            quantityRequested: "3.500000",
            note: "Primary line",
          },
        ],
      },
    });
    transferIds.push(Number(createdTransfer.id));

    assert(
      createdTransfer.status === "INITIATED" &&
        createdTransfer.lines.length === 1 &&
        createdTransfer.sourceOwnershipScope === "CENTRAL" &&
        createdTransfer.targetOwnershipScope === "OPERATING_UNIT",
      "Created transfer should persist status, lines, and ownership snapshots"
    );
    assert(
      Number(createdTransfer.targetOperatingUnitId) === context.operatingUnitId,
      "Created transfer should persist target operating unit snapshot"
    );

    const detailRow = await getInventoryTransferById({
      tenantId: context.tenantId,
      transferId: Number(createdTransfer.id),
    });
    assert(
      detailRow.transferNo && detailRow.lines.length === 1,
      "Transfer detail should return header and lines"
    );

    const listResult = await listInventoryTransfers({
      tenantId: context.tenantId,
      filters: {
        legalEntityId: context.legalEntityId,
        status: "INITIATED",
        limit: 100,
        offset: 0,
      },
    });
    assert(
      listResult.rows.some((row) => Number(row.id) === Number(createdTransfer.id)),
      "Transfer list should return the created initiated transfer"
    );

    await assertThrowsAsync(
      () =>
        createInventoryTransfer({
          payload: {
            tenantId: context.tenantId,
            userId: actingUserId,
            legalEntityId: context.legalEntityId,
            transferDate: "2026-03-13",
            sourceWarehouseId: Number(centralWarehouse.id),
            targetWarehouseId: Number(centralWarehouse.id),
            lines: [{ itemCardId: Number(itemCard.id), quantityRequested: "1.000000" }],
          },
        }),
      "sourceWarehouseId and targetWarehouseId must differ"
    );

    await assertThrowsAsync(
      () =>
        createInventoryTransfer({
          payload: {
            tenantId: context.tenantId,
            userId: actingUserId,
            legalEntityId: context.legalEntityId,
            transferDate: "2026-03-13",
            sourceWarehouseId: Number(centralWarehouse.id),
            targetWarehouseId: Number(sameContextCentralWarehouse.id),
            lines: [{ itemCardId: Number(itemCard.id), quantityRequested: "1.000000" }],
          },
        }),
      "must belong to different ownership contexts"
    );

    await assertThrowsAsync(
      () =>
        createInventoryTransfer({
          payload: {
            tenantId: context.tenantId,
            userId: actingUserId,
            legalEntityId: context.legalEntityId,
            transferDate: "2026-03-13",
            sourceWarehouseId: Number(centralWarehouse.id),
            targetWarehouseId: Number(alternateLegalEntityWarehouse.id),
            lines: [{ itemCardId: Number(itemCard.id), quantityRequested: "1.000000" }],
          },
        }),
      "targetWarehouseId not found for legalEntityId"
    );

    const approvalTransfer = await createInventoryTransfer({
      payload: {
        tenantId: context.tenantId,
        userId: actingUserId,
        legalEntityId: context.legalEntityId,
        transferDate: "2026-03-13",
        sourceWarehouseId: Number(centralWarehouse.id),
        targetWarehouseId: Number(sourceOuWarehouse.id),
        lines: [{ itemCardId: Number(itemCard.id), quantityRequested: "2.000000" }],
      },
    });
    transferIds.push(Number(approvalTransfer.id));

    const approvedRow = await approveInventoryTransferById({
      payload: {
        tenantId: context.tenantId,
        userId: approverUserId,
        transferId: Number(approvalTransfer.id),
      },
    });
    assert(
      approvedRow.status === "APPROVED" && approvedRow.approvedByUserId === approverUserId,
      "Approve action should move transfer to APPROVED"
    );

    await assertThrowsAsync(
      () =>
        approveInventoryTransferById({
          payload: {
            tenantId: context.tenantId,
            userId: approverUserId,
            transferId: Number(approvalTransfer.id),
          },
        }),
      "Transfer cannot move to APPROVED from status APPROVED"
    );

    const shipGateTransfer = await createInventoryTransfer({
      payload: {
        tenantId: context.tenantId,
        userId: actingUserId,
        legalEntityId: context.legalEntityId,
        transferDate: "2026-03-13",
        sourceWarehouseId: Number(centralWarehouse.id),
        targetWarehouseId: Number(sourceOuWarehouse.id),
        lines: [{ itemCardId: Number(itemCard.id), quantityRequested: "1.000000" }],
      },
    });
    transferIds.push(Number(shipGateTransfer.id));

    await assertThrowsAsync(
      () =>
        shipInventoryTransferById({
          payload: {
            tenantId: context.tenantId,
            userId: actingUserId,
            transferId: Number(shipGateTransfer.id),
          },
        }),
      "must be APPROVED before shipment"
    );

    await approveInventoryTransferById({
      payload: {
        tenantId: context.tenantId,
        userId: approverUserId,
        transferId: Number(shipGateTransfer.id),
      },
    });

    await assertThrowsAsync(
      () =>
        shipInventoryTransferById({
          payload: {
            tenantId: context.tenantId,
            userId: actingUserId,
            transferId: Number(shipGateTransfer.id),
          },
        }),
      "inventoryTransitAccountId"
    );

    const shipTwiceTransfer = await createInventoryTransfer({
      payload: {
        tenantId: context.tenantId,
        userId: actingUserId,
        legalEntityId: context.legalEntityId,
        transferDate: "2026-03-13",
        sourceWarehouseId: Number(centralWarehouse.id),
        targetWarehouseId: Number(sourceOuWarehouse.id),
        lines: [{ itemCardId: Number(itemCard.id), quantityRequested: "1.000000" }],
      },
    });
    transferIds.push(Number(shipTwiceTransfer.id));
    await query(`UPDATE inventory_transfers SET status = 'IN_TRANSIT' WHERE id = ?`, [
      Number(shipTwiceTransfer.id),
    ]);
    await assertThrowsAsync(
      () =>
        shipInventoryTransferById({
          payload: {
            tenantId: context.tenantId,
            userId: actingUserId,
            transferId: Number(shipTwiceTransfer.id),
          },
        }),
      "current status: IN_TRANSIT"
    );

    const receiveGateTransfer = await createInventoryTransfer({
      payload: {
        tenantId: context.tenantId,
        userId: actingUserId,
        legalEntityId: context.legalEntityId,
        transferDate: "2026-03-13",
        sourceWarehouseId: Number(centralWarehouse.id),
        targetWarehouseId: Number(sourceOuWarehouse.id),
        lines: [{ itemCardId: Number(itemCard.id), quantityRequested: "1.000000" }],
      },
    });
    transferIds.push(Number(receiveGateTransfer.id));

    await assertThrowsAsync(
      () =>
        receiveInventoryTransferById({
          payload: {
            tenantId: context.tenantId,
            userId: actingUserId,
            transferId: Number(receiveGateTransfer.id),
          },
        }),
      "must be IN_TRANSIT before receipt"
    );

    await query(`UPDATE inventory_transfers SET status = 'RECEIVED' WHERE id = ?`, [
      Number(receiveGateTransfer.id),
    ]);
    await assertThrowsAsync(
      () =>
        receiveInventoryTransferById({
          payload: {
            tenantId: context.tenantId,
            userId: actingUserId,
            transferId: Number(receiveGateTransfer.id),
          },
        }),
      "current status: RECEIVED"
    );

    const cancelGateTransfer = await createInventoryTransfer({
      payload: {
        tenantId: context.tenantId,
        userId: actingUserId,
        legalEntityId: context.legalEntityId,
        transferDate: "2026-03-13",
        sourceWarehouseId: Number(centralWarehouse.id),
        targetWarehouseId: Number(sourceOuWarehouse.id),
        lines: [{ itemCardId: Number(itemCard.id), quantityRequested: "1.000000" }],
      },
    });
    transferIds.push(Number(cancelGateTransfer.id));
    await query(`UPDATE inventory_transfers SET status = 'IN_TRANSIT' WHERE id = ?`, [
      Number(cancelGateTransfer.id),
    ]);
    await assertThrowsAsync(
      () =>
        cancelInventoryTransferById({
          payload: {
            tenantId: context.tenantId,
            userId: actingUserId,
            transferId: Number(cancelGateTransfer.id),
            cancelReason: "Too late",
          },
        }),
      "Transfer cannot move to CANCELLED from status IN_TRANSIT"
    );

    const reverseGateTransfer = await createInventoryTransfer({
      payload: {
        tenantId: context.tenantId,
        userId: actingUserId,
        legalEntityId: context.legalEntityId,
        transferDate: "2026-03-13",
        sourceWarehouseId: Number(centralWarehouse.id),
        targetWarehouseId: Number(sourceOuWarehouse.id),
        lines: [{ itemCardId: Number(itemCard.id), quantityRequested: "1.000000" }],
      },
    });
    transferIds.push(Number(reverseGateTransfer.id));
    await cancelInventoryTransferById({
      payload: {
        tenantId: context.tenantId,
        userId: actingUserId,
        transferId: Number(reverseGateTransfer.id),
        cancelReason: "Cancel for reverse test",
      },
    });
    await assertThrowsAsync(
      () =>
        reverseInventoryTransferById({
          payload: {
            tenantId: context.tenantId,
            userId: actingUserId,
            transferId: Number(reverseGateTransfer.id),
            reverseReason: "Should fail",
          },
        }),
      "Canceled transfer cannot be reversed"
    );
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
    if (itemCardIds.length > 0) {
      await query(
        `DELETE FROM item_cards WHERE id IN (${itemCardIds.map(() => "?").join(",")})`,
        itemCardIds
      );
    }
    if (warehouseIds.length > 0) {
      await query(
        `DELETE FROM inventory_warehouses
          WHERE id IN (${warehouseIds.map(() => "?").join(",")})`,
        warehouseIds
      );
    }
    await closePool();
  }

  console.log("Inventory transfer OU02 smoke passed.");
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
