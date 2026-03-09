import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseCashRegisterReadFilters,
  parseCashRegisterUpsertInput,
} from "../src/routes/cash.register.validators.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertThrows(fn, expectedMessage) {
  let thrown = null;
  try {
    fn();
  } catch (err) {
    thrown = err;
  }
  assert(thrown, `Expected error containing "${expectedMessage}"`);
  const message = String(thrown?.message || thrown || "");
  assert(
    message.includes(expectedMessage),
    `Expected error containing "${expectedMessage}", got "${message}"`
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

async function main() {
  const centralPayload = parseCashRegisterUpsertInput(
    makeReq({
      body: {
        legalEntityId: 10,
        accountId: 99,
        code: "hqafn",
        name: "HQ AFN",
        currencyCode: "AFN",
      },
    })
  );
  assert(
    centralPayload.ownershipScope === "CENTRAL",
    "Omitted ownershipScope + empty operatingUnitId should derive CENTRAL"
  );
  assert(
    centralPayload.operatingUnitId === null,
    "Central register payload should keep operatingUnitId null"
  );

  const ouPayload = parseCashRegisterUpsertInput(
    makeReq({
      body: {
        legalEntityId: 10,
        operatingUnitId: 55,
        accountId: 100,
        code: "keoafn",
        name: "KEO AFN",
        currencyCode: "AFN",
      },
    })
  );
  assert(
    ouPayload.ownershipScope === "OPERATING_UNIT",
    "Omitted ownershipScope + operatingUnitId should derive OPERATING_UNIT"
  );

  const explicitCentralPayload = parseCashRegisterUpsertInput(
    makeReq({
      body: {
        legalEntityId: 10,
        ownershipScope: "CENTRAL",
        accountId: 101,
        code: "hqusd",
        name: "HQ USD",
        currencyCode: "USD",
      },
    })
  );
  assert(
    explicitCentralPayload.ownershipScope === "CENTRAL",
    "Explicit CENTRAL ownershipScope should parse successfully"
  );

  assertThrows(
    () =>
      parseCashRegisterUpsertInput(
        makeReq({
          body: {
            legalEntityId: 10,
            ownershipScope: "CENTRAL",
            operatingUnitId: 55,
            accountId: 102,
            code: "bad1",
            name: "Bad Central",
            currencyCode: "AFN",
          },
        })
      ),
    "operatingUnitId must be empty when ownershipScope=CENTRAL"
  );

  assertThrows(
    () =>
      parseCashRegisterUpsertInput(
        makeReq({
          body: {
            legalEntityId: 10,
            ownershipScope: "OPERATING_UNIT",
            accountId: 103,
            code: "bad2",
            name: "Bad Branch",
            currencyCode: "AFN",
          },
        })
      ),
    "operatingUnitId is required when ownershipScope=OPERATING_UNIT"
  );

  const filters = parseCashRegisterReadFilters(
    makeReq({
      query: {
        ownershipScope: "central",
      },
    })
  );
  assert(filters.ownershipScope === "CENTRAL", "Read filters should parse ownershipScope");

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const migrationSource = await readFile(
    path.resolve(root, "backend/src/migrations/m111_cash_register_ownership_scope.js"),
    "utf8"
  );
  const querySource = await readFile(
    path.resolve(root, "backend/src/services/cash.queries.js"),
    "utf8"
  );
  const serviceSource = await readFile(
    path.resolve(root, "backend/src/services/cash.register.service.js"),
    "utf8"
  );

  assert(
    migrationSource.includes("ownership_scope ENUM('CENTRAL','OPERATING_UNIT')"),
    "m111 migration should add ownership_scope enum"
  );
  assert(
    migrationSource.includes("SET ownership_scope = CASE"),
    "m111 migration should backfill ownership_scope from operating_unit_id"
  );
  assert(
    querySource.includes("cr.ownership_scope"),
    "cash register base select should expose ownership_scope"
  );
  assert(
    querySource.includes("ownership_context_label"),
    "cash register reads should expose ownership_context_label"
  );
  assert(
    serviceSource.includes("filters.ownershipScope"),
    "cash register service should support ownershipScope filters"
  );

  console.log("Cash register ownership CRO01 smoke passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
