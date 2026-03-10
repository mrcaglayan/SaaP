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
      "backend/src/migrations/m110_shareholder_capital_fulfillments_cash_register_links.js"
    ),
    "utf8"
  );
  assert(
    migrationSource.includes("CASH_REGISTER") &&
      migrationSource.includes("cash_register_id") &&
      migrationSource.includes("cash_session_id") &&
      migrationSource.includes("cash_transaction_id") &&
      migrationSource.includes("cash_reversal_transaction_id"),
    "m110 should extend shareholder capital fulfillments for cash register linkage"
  );

  const migrationIndexSource = await readFile(
    path.resolve(root, "backend/src/migrations/index.js"),
    "utf8"
  );
  assert(
    migrationIndexSource.includes(
      "m110_shareholder_capital_fulfillments_cash_register_links"
    ) &&
      migrationIndexSource.includes(
        "migration110ShareholderCapitalFulfillmentsCashRegisterLinks"
      ),
    "migrations index should register m110"
  );

  const validatorsSource = await readFile(
    path.resolve(root, "backend/src/routes/org.write.validators.js"),
    "utf8"
  );
  assert(
    validatorsSource.includes('"CASH_REGISTER"') &&
      validatorsSource.includes("cashRegisterId") &&
      validatorsSource.includes("cashSessionId"),
    "org.write.validators should parse CASH_REGISTER fulfillment inputs"
  );

  const serviceSource = await readFile(
    path.resolve(root, "backend/src/services/org.capital-fulfillment.service.js"),
    "utf8"
  );
  assert(
    serviceSource.includes("createCashRegisterFulfillmentPostingTx") &&
      serviceSource.includes("reverseCashRegisterFulfillmentTx") &&
      serviceSource.includes("buildCapitalFulfillmentCentralJournalLines") &&
      serviceSource.includes("sourceEntityType: \"shareholder_capital_fulfillment\"") &&
      serviceSource.includes("cashRegisterId must belong to operatingUnitId") &&
      serviceSource.includes("Central fulfillment requires a cashRegisterId without OU ownership") &&
      serviceSource.includes("cashSessionId is required because selected cash register has session_mode=REQUIRED.") &&
      serviceSource.includes("cash_reversal_transaction_id") &&
      serviceSource.includes("cash_journal_entry_id") &&
      !serviceSource.includes(
        "CASH_REGISTER fulfillment currently supports central/HQ registers only; do not select operatingUnitId"
      ),
    "capital fulfillment service should support central and OU-targeted cash register fulfillment with linked cash and journal reversals"
  );

  const frontendSource = await readFile(
    path.resolve(root, "frontend/src/pages/settings/OrganizationManagementPage.jsx"),
    "utf8"
  );
  assert(
    frontendSource.includes("CASH_REGISTER") &&
      frontendSource.includes("listCashRegisters") &&
      frontendSource.includes("listCashSessions") &&
      frontendSource.includes("Cash register destination") &&
      frontendSource.includes("Open cash session") &&
      frontendSource.includes("Selected OU uses a two-layer flow") &&
      frontendSource.includes("Create the branch cash register first") &&
      frontendSource.includes("Cash txn") &&
      frontendSource.includes("Open cash transit transfer") &&
      frontendSource.includes("Central -> Branch cash transit") &&
      !frontendSource.includes("No OU (central / HQ register only)"),
    "OrganizationManagementPage should expose central and OU-targeted cash register fulfillment with branch-aware guidance and the central-to-branch transit shortcut"
  );

  const cashTransactionsSource = await readFile(
    path.resolve(root, "frontend/src/pages/cash/CashTransactionsPage.jsx"),
    "utf8"
  );
  assert(
    cashTransactionsSource.includes("buildCapitalFulfillmentTransitPrefill") &&
      cashTransactionsSource.includes("CAPITAL_FULFILLMENT_TRANSIT") &&
      cashTransactionsSource.includes("Prefilled central-to-branch cash transit transfer") &&
      cashTransactionsSource.includes("counterCashRegisterId") &&
      cashTransactionsSource.includes("TRANSFER_OUT"),
    "CashTransactionsPage should accept the capital fulfillment transit shortcut and prefill the existing transfer workflow"
  );

  console.log("PR-CF05 cash register fulfillment smoke checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
