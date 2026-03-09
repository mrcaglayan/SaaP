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

  const querySource = await readFile(
    path.resolve(root, "backend/src/services/cash.queries.js"),
    "utf8"
  );
  assert(
    querySource.includes("ou.code AS operating_unit_code") &&
      querySource.includes("ou.name AS operating_unit_name") &&
      querySource.includes("WHEN cr.operating_unit_id IS NULL THEN 'Central / HQ'"),
    "cash.queries should expose explicit ownership context on cash session rows"
  );
  assert(
    querySource.includes("counter_cash_register_operating_unit_code") &&
      querySource.includes("counter_cash_register_ownership_context_label"),
    "cash.queries should expose explicit ownership context on counter register rows"
  );
  assert(
    querySource.includes("source_ownership_context_label") &&
      querySource.includes("target_ownership_context_label"),
    "cash.queries should expose explicit ownership context on transit routes"
  );

  const cashTxnServiceSource = await readFile(
    path.resolve(root, "backend/src/services/cash.transaction.service.js"),
    "utf8"
  );
  assert(
    cashTxnServiceSource.includes(
      "Cash transit workflow requires source and target registers from different operating-unit contexts"
    ) &&
      cashTxnServiceSource.includes(
        "Transfers between different operating-unit contexts must use CASH_IN_TRANSIT workflow"
      ),
    "cash.transaction.service should enforce transit routing for different operating-unit contexts"
  );

  const cashServiceSource = await readFile(
    path.resolve(root, "backend/src/services/cash.service.js"),
    "utf8"
  );
  assert(
    cashServiceSource.includes("resolveTransitClearingOperatingUnitId") &&
      cashServiceSource.includes(
        "Transfers between different operating-unit contexts must use CASH_IN_TRANSIT workflow"
      ),
    "cash.service should route transit clearing lines with explicit operating-unit context handling"
  );

  const transactionsPageSource = await readFile(
    path.resolve(root, "frontend/src/pages/cash/CashTransactionsPage.jsx"),
    "utf8"
  );
  assert(
    transactionsPageSource.includes("selectedTransferRouteMeta") &&
      transactionsPageSource.includes('modeLabel: l("Transit workflow required"') &&
      transactionsPageSource.includes("formatRegisterOptionText(row, l)") &&
      transactionsPageSource.includes("formatSessionDisplayLabel(session, l)"),
    "CashTransactionsPage should show ownership-aware register labels and transfer-mode guidance"
  );

  const sessionsPageSource = await readFile(
    path.resolve(root, "frontend/src/pages/cash/CashSessionsPage.jsx"),
    "utf8"
  );
  assert(
    sessionsPageSource.includes("buildRegisterOwnershipContextLabel") &&
      sessionsPageSource.includes('l("Ownership context", "Sahiplik baglami")') &&
      sessionsPageSource.includes("formatCashSessionPickerLabel"),
    "CashSessionsPage should surface ownership context in session selectors and tables"
  );

  const transitPageSource = await readFile(
    path.resolve(root, "frontend/src/pages/cash/CashTransitTransfersPage.jsx"),
    "utf8"
  );
  assert(
    transitPageSource.includes("toTransitRegisterSummary") &&
      transitPageSource.includes("formatCashSessionOptionLabel") &&
      transitPageSource.includes("Different operating-unit contexts use transit"),
    "CashTransitTransfersPage should show ownership-aware route context and routing guidance"
  );

  const orgManagementSource = await readFile(
    path.resolve(root, "frontend/src/pages/settings/OrganizationManagementPage.jsx"),
    "utf8"
  );
  assert(
    orgManagementSource.includes("formatCashRegisterOptionLabel(register)") &&
      orgManagementSource.includes('ownership_context_label: "Central / HQ"') &&
      orgManagementSource.includes("OU: ${register.operating_unit_code}"),
    "OrganizationManagementPage should keep shareholder-capital cash shortcuts aligned with explicit ownership labels"
  );

  console.log("Cash register ownership CRO03 workflow routing smoke passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
