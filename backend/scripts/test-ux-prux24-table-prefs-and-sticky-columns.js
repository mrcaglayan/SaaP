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

  const tablePrefsHookSource = await readFile(
    path.resolve(root, "frontend/src/hooks/usePersistedTablePrefs.js"),
    "utf8"
  );
  const tablePrefsPanelSource = await readFile(
    path.resolve(root, "frontend/src/components/TablePreferencesPanel.jsx"),
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
    tablePrefsHookSource.includes("export function usePersistedTablePrefs") &&
      tablePrefsHookSource.includes("table-prefs.") &&
      tablePrefsHookSource.includes("visibleColumnIds") &&
      tablePrefsHookSource.includes("rowsPerPage") &&
      tablePrefsHookSource.includes("stickyHeader"),
    "Shared table prefs hook should persist rows/page, sticky-header, and visible-column settings"
  );

  assert(
    tablePrefsPanelSource.includes("export default function TablePreferencesPanel") &&
      tablePrefsPanelSource.includes("Rows per page") &&
      tablePrefsPanelSource.includes("Sticky header") &&
      tablePrefsPanelSource.includes("Select all columns") &&
      tablePrefsPanelSource.includes("Reset table prefs"),
    "Shared table preferences panel should expose rows-per-page, sticky-header, and column chooser controls"
  );

  assert(
    cariDocumentsPageSource.includes('import TablePreferencesPanel from "../../components/TablePreferencesPanel.jsx"') &&
      cariDocumentsPageSource.includes('import { usePersistedTablePrefs } from "../../hooks/usePersistedTablePrefs.js"') &&
      cariDocumentsPageSource.includes("DOCUMENT_TABLE_PREFS_STORAGE_SCOPE") &&
      cariDocumentsPageSource.includes("documentTablePrefs.stickyHeader") &&
      cariDocumentsPageSource.includes("handleDocumentTableToggleColumn"),
    "CariDocumentsPage should wire shared table prefs for column chooser + sticky header + rows per page"
  );

  assert(
    cashTransactionsPageSource.includes('import TablePreferencesPanel from "../../components/TablePreferencesPanel.jsx"') &&
      cashTransactionsPageSource.includes('import { usePersistedTablePrefs } from "../../hooks/usePersistedTablePrefs.js"') &&
      cashTransactionsPageSource.includes("CASH_TRANSACTION_TABLE_PREFS_STORAGE_SCOPE") &&
      cashTransactionsPageSource.includes("transactionTablePrefs.stickyHeader") &&
      cashTransactionsPageSource.includes("handleTransactionTableToggleColumn"),
    "CashTransactionsPage should wire shared table prefs for column chooser + sticky header + rows per page"
  );

  console.log(
    "PR-UX24 smoke test passed (shared table prefs hook/panel + sticky headers + column chooser + per-page rows on Cari/Cash lists)."
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
