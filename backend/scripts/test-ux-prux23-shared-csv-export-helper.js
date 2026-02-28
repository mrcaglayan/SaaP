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

  const csvHelperSource = await readFile(
    path.resolve(root, "frontend/src/utils/csvExport.js"),
    "utf8"
  );
  const cariDocumentsPageSource = await readFile(
    path.resolve(root, "frontend/src/pages/cari/CariDocumentsPage.jsx"),
    "utf8"
  );
  const cashTransactionsPageSource = await readFile(
    path.resolve(root, "frontend/src/pages/cash/CashTransactionsPage.jsx"),
    "utf8"
  );

  assert(
    csvHelperSource.includes("export function buildCsvString") &&
      csvHelperSource.includes("export function exportRowsAsCsv") &&
      csvHelperSource.includes("export function triggerBlobDownload") &&
      csvHelperSource.includes("export function sanitizeCsvFileName"),
    "Shared CSV utility should expose CSV build + download helpers"
  );

  assert(
    cariDocumentsPageSource.includes('import { exportRowsAsCsv } from "../../utils/csvExport.js"') &&
      cariDocumentsPageSource.includes("DOCUMENT_EXPORT_COLUMNS") &&
      cariDocumentsPageSource.includes("handleExportDocumentListCsv") &&
      cariDocumentsPageSource.includes("Export CSV"),
    "CariDocumentsPage should wire list export action through shared CSV helper"
  );

  assert(
    cashTransactionsPageSource.includes('import { exportRowsAsCsv } from "../../utils/csvExport.js"') &&
      cashTransactionsPageSource.includes("CASH_TRANSACTION_EXPORT_COLUMNS") &&
      cashTransactionsPageSource.includes("handleExportTransactionsCsv") &&
      cashTransactionsPageSource.includes("cashTransactions.actions.exportCsv"),
    "CashTransactionsPage should wire list export action through shared CSV helper"
  );

  console.log(
    "PR-UX23 smoke test passed (shared CSV export helper + list export actions on Cari/Cash pages)."
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
