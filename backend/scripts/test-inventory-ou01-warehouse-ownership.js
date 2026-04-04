import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseInventoryWarehouseCreateInput,
  parseInventoryWarehouseListFilters,
} from "../src/routes/inventory.validators.js";
import {
  createInventoryWarehouse,
  listInventoryWarehouses,
} from "../src/services/inventory.service.js";
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
  };
}

function uniqueCode(prefix) {
  const token = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return `${prefix}${token}`.slice(0, 32).toUpperCase();
}

async function loadSmokeContext() {
  return createInventoryOuCrossEntityFixture({
    prefix: "INVOU01",
  });
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const migrationSource = await readFile(
    path.resolve(root, "src/migrations/m123_inventory_warehouse_ownership_scope.js"),
    "utf8"
  );
  const serviceSource = await readFile(
    path.resolve(root, "src/services/inventory.service.js"),
    "utf8"
  );

  assert(
    migrationSource.includes("ownership_scope ENUM('CENTRAL','OPERATING_UNIT')"),
    "m123 migration should add warehouse ownership_scope enum"
  );
  assert(
    migrationSource.includes("operating_unit_id BIGINT UNSIGNED NULL"),
    "m123 migration should add warehouse operating_unit_id"
  );
  assert(
    serviceSource.includes("operatingUnitCode"),
    "inventory warehouse reads should expose operatingUnitCode"
  );
  assert(
    serviceSource.includes("filters?.ownershipScope"),
    "inventory warehouse service should support ownershipScope filters"
  );

  assertThrows(
    () =>
      parseInventoryWarehouseCreateInput(
        makeReq({
          body: {
            legalEntityId: 10,
            ownershipScope: "CENTRAL",
            operatingUnitId: 55,
            code: "hq1",
            name: "Central Invalid",
          },
        })
      ),
    "operatingUnitId must be empty when ownershipScope=CENTRAL"
  );

  assertThrows(
    () =>
      parseInventoryWarehouseCreateInput(
        makeReq({
          body: {
            legalEntityId: 10,
            ownershipScope: "OPERATING_UNIT",
            code: "br1",
            name: "Branch Invalid",
          },
        })
      ),
    "operatingUnitId is required when ownershipScope=OPERATING_UNIT"
  );

  const parsedOuPayload = parseInventoryWarehouseCreateInput(
    makeReq({
      body: {
        legalEntityId: 10,
        ownershipScope: "OPERATING_UNIT",
        operatingUnitId: 55,
        code: "br2",
        name: "Branch Valid",
      },
    })
  );
  assert(
    parsedOuPayload.ownershipScope === "OPERATING_UNIT" && parsedOuPayload.operatingUnitId === 55,
    "OU-owned warehouse payload should parse successfully"
  );

  const parsedFilters = parseInventoryWarehouseListFilters(
    makeReq({
      query: {
        legalEntityId: 10,
        ownershipScope: "operating_unit",
        operatingUnitId: 55,
      },
    })
  );
  assert(
    parsedFilters.ownershipScope === "OPERATING_UNIT" &&
      parsedFilters.operatingUnitId === 55,
    "Warehouse list filters should parse ownershipScope and operatingUnitId"
  );

  const context = await loadSmokeContext();
  const createdWarehouseIds = [];

  try {
    const centralWarehouse = await createInventoryWarehouse({
      payload: {
            tenantId: context.tenantId,
            userId: context.userId,
            legalEntityId: context.legalEntityId,
            ownershipScope: "CENTRAL",
        code: uniqueCode("OU01C"),
        name: "OU01 Central Warehouse",
        status: "ACTIVE",
        notes: "OU01 smoke central warehouse",
      },
    });
    createdWarehouseIds.push(Number(centralWarehouse.id));

    assert(
      centralWarehouse.ownershipScope === "CENTRAL" && !centralWarehouse.operatingUnitId,
      "Central warehouse should return CENTRAL ownershipScope with null operatingUnitId"
    );

    const ouWarehouse = await createInventoryWarehouse({
      payload: {
        tenantId: context.tenantId,
        userId: context.userId,
        legalEntityId: context.legalEntityId,
        ownershipScope: "OPERATING_UNIT",
        operatingUnitId: context.operatingUnitId,
        code: uniqueCode("OU01O"),
        name: "OU01 OU Warehouse",
        status: "ACTIVE",
        notes: "OU01 smoke OU-owned warehouse",
      },
    });
    createdWarehouseIds.push(Number(ouWarehouse.id));

    assert(
      ouWarehouse.ownershipScope === "OPERATING_UNIT" &&
        Number(ouWarehouse.operatingUnitId) === context.operatingUnitId,
      "OU-owned warehouse should return OU ownership context"
    );
    assert(
      String(ouWarehouse.operatingUnitCode || "").trim(),
      "OU-owned warehouse should expose operatingUnitCode"
    );
    assert(
      String(ouWarehouse.operatingUnitName || "").trim(),
      "OU-owned warehouse should expose operatingUnitName"
    );

    const centralList = await listInventoryWarehouses({
      tenantId: context.tenantId,
      filters: {
        legalEntityId: context.legalEntityId,
        ownershipScope: "CENTRAL",
        limit: 200,
        offset: 0,
      },
    });
    assert(
      centralList.rows.some((row) => Number(row.id) === Number(centralWarehouse.id)),
      "Central warehouse filter should return the created central warehouse"
    );

    const ouList = await listInventoryWarehouses({
      tenantId: context.tenantId,
      filters: {
        legalEntityId: context.legalEntityId,
        ownershipScope: "OPERATING_UNIT",
        operatingUnitId: context.operatingUnitId,
        limit: 200,
        offset: 0,
      },
    });
    assert(
      ouList.rows.some((row) => Number(row.id) === Number(ouWarehouse.id)),
      "OU warehouse filter should return the created OU-owned warehouse"
    );

    await assertThrowsAsync(
      () =>
        createInventoryWarehouse({
          payload: {
            tenantId: context.tenantId,
            userId: context.userId,
            legalEntityId: context.legalEntityId,
            ownershipScope: "OPERATING_UNIT",
            operatingUnitId: context.mismatchOperatingUnitId,
            code: uniqueCode("OU01X"),
            name: "OU01 Wrong LE Warehouse",
            status: "ACTIVE",
          },
        }),
      "operatingUnitId must belong to legalEntityId"
    );
  } finally {
    if (createdWarehouseIds.length > 0) {
      await query(
        `DELETE FROM inventory_warehouses
          WHERE id IN (${createdWarehouseIds.map(() => "?").join(",")})`,
        createdWarehouseIds
      );
    }
    await closePool();
  }

  console.log("Inventory warehouse ownership OU01 smoke passed.");
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
