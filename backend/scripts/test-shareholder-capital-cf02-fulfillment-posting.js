import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

  const migrationSource = await readFile(
    path.resolve(root, "backend/src/migrations/m109_shareholder_capital_fulfillments.js"),
    "utf8"
  );
  assert(
    migrationSource.includes("destination_mode ENUM('BANK_ACCOUNT','ASSET_GL')") &&
      migrationSource.includes("status ENUM('POSTED','REVERSED')"),
    "m109 should define destination_mode and POSTED/REVERSED workflow status enums"
  );

  const migrationIndexSource = await readFile(
    path.resolve(root, "backend/src/migrations/index.js"),
    "utf8"
  );
  assert(
    migrationIndexSource.includes("m109_shareholder_capital_fulfillments") &&
      migrationIndexSource.includes("migration109ShareholderCapitalFulfillments"),
    "migrations index should register m109"
  );

  const validatorsSource = await readFile(
    path.resolve(root, "backend/src/routes/org.write.validators.js"),
    "utf8"
  );
  assert(
    validatorsSource.includes("parseShareholderCapitalFulfillmentPreviewInput") &&
      validatorsSource.includes("parseShareholderCapitalFulfillmentCreateInput") &&
      validatorsSource.includes("parseShareholderCapitalFulfillmentListFilters") &&
      validatorsSource.includes("parseShareholderCapitalFulfillmentReverseInput"),
    "org.write.validators should export all shareholder capital fulfillment parsers"
  );

  const serviceSource = await readFile(
    path.resolve(root, "backend/src/services/org.capital-fulfillment.service.js"),
    "utf8"
  );
  assert(
    serviceSource.includes("BANK_ACCOUNT") &&
      serviceSource.includes("ASSET_GL") &&
      serviceSource.includes("commitmentDebitSubAccountId") &&
      serviceSource.includes("'SYSTEM'") &&
      serviceSource.includes("status = 'REVERSED'"),
    "capital fulfillment service should implement destination modes, SYSTEM journals, mapped commitment credits, and reversal status handling"
  );

  const routesSource = await readFile(path.resolve(root, "backend/src/routes/org.js"), "utf8");
  assert(
    routesSource.includes("/shareholders/capital-fulfillments/preview") &&
      routesSource.includes("/shareholders/capital-fulfillments") &&
      routesSource.includes("/shareholders/capital-fulfillments/:id/reverse"),
    "org routes should expose preview, create, list, and reverse capital fulfillment endpoints"
  );

  console.log("PR-CF02 shareholder capital fulfillment smoke checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
