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

  const cashTransactionsPageSource = await readFile(
    path.resolve(root, "frontend/src/pages/cash/CashTransactionsPage.jsx"),
    "utf8"
  );

  assert(
    cashTransactionsPageSource.includes("CASH_TRANSACTION_TEMPLATE_MODULE_CODE") &&
      cashTransactionsPageSource.includes("CASH_TRANSACTION_PRESET_OPTIONS") &&
      cashTransactionsPageSource.includes("buildCashTransactionTemplateDefinition") &&
      cashTransactionsPageSource.includes("resolveCashTransactionTemplateState"),
    "CashTransactionsPage should define template/preset contracts for create-form presets"
  );

  assert(
    cashTransactionsPageSource.includes("loadTransactionTemplates") &&
      cashTransactionsPageSource.includes("applyTransactionTemplate") &&
      cashTransactionsPageSource.includes("handleCreateTransactionTemplate") &&
      cashTransactionsPageSource.includes("handleUpdateTransactionTemplate") &&
      cashTransactionsPageSource.includes("handleDeleteTransactionTemplate") &&
      cashTransactionsPageSource.includes("handleApplyCreatePreset"),
    "CashTransactionsPage should wire server-side template CRUD and preset apply actions"
  );

  assert(
    cashTransactionsPageSource.includes("Templates + Presets") &&
      cashTransactionsPageSource.includes("Apply Template") &&
      cashTransactionsPageSource.includes("Save Current") &&
      cashTransactionsPageSource.includes("Apply Preset"),
    "CashTransactionsPage create UI should expose templates/presets controls"
  );

  console.log(
    "PR-UX28 smoke test passed (cash transaction create templates + presets)."
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
