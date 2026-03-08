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
    path.resolve(
      root,
      "backend/src/migrations/m108_operating_unit_internal_current_accounts.js"
    ),
    "utf8"
  );
  assert(
    migrationSource.includes("central_due_from_account_id") &&
      migrationSource.includes("ou_due_to_central_account_id"),
    "m108 should add both operating_units internal current account columns"
  );
  assert(
    migrationSource.includes("fk_operating_units_central_due_from_account") &&
      migrationSource.includes("fk_operating_units_ou_due_to_central_account"),
    "m108 should add both operating_units account foreign keys"
  );

  const migrationIndexSource = await readFile(
    path.resolve(root, "backend/src/migrations/index.js"),
    "utf8"
  );
  assert(
    migrationIndexSource.includes("m108_operating_unit_internal_current_accounts") &&
      migrationIndexSource.includes("migration108OperatingUnitInternalCurrentAccounts"),
    "migrations index should register m108"
  );

  const validatorsSource = await readFile(
    path.resolve(root, "backend/src/routes/org.write.validators.js"),
    "utf8"
  );
  assert(
    validatorsSource.includes("centralDueFromAccountId") &&
      validatorsSource.includes("ouDueToCentralAccountId"),
    "OU write validator should parse both internal current account ids"
  );

  const writeServiceSource = await readFile(
    path.resolve(root, "backend/src/services/org.write.service.js"),
    "utf8"
  );
  assert(
    writeServiceSource.includes("assertOperatingUnitInternalCurrentAccountTx") &&
      writeServiceSource.includes("ouDueToCentralAccountId must be different from centralDueFromAccountId"),
    "OU write service should validate both accounts and reject duplicate mapping ids"
  );

  const readQueriesSource = await readFile(
    path.resolve(root, "backend/src/services/org.read.queries.js"),
    "utf8"
  );
  assert(
    readQueriesSource.includes("central_due_from_account_code") &&
      readQueriesSource.includes("ou_due_to_central_account_code") &&
      readQueriesSource.includes("capital_self_balancing_ready"),
    "OU read queries should expose mapping codes and readiness"
  );

  const frontendSource = await readFile(
    path.resolve(root, "frontend/src/pages/settings/OrganizationManagementPage.jsx"),
    "utf8"
  );
  assert(
    frontendSource.includes("HQ Due From OU (optional)") &&
      frontendSource.includes("OU Due To HQ (optional)") &&
      frontendSource.includes("handleOperatingUnitEdit") &&
      frontendSource.includes("capital_self_balancing_ready"),
    "OrganizationManagementPage should surface OU mapping form fields, edit flow, and readiness"
  );

  console.log("PR-CF01 OU internal current mapping smoke checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
