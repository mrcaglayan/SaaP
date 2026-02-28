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

  const hookSource = await readFile(
    path.resolve(root, "frontend/src/context/useWorkingContextDefaults.js"),
    "utf8"
  );

  assert(
    hookSource.includes("const currentValue = normalizeText(previousState?.[stateKey]);") &&
      hookSource.includes(
        "const shouldApply =\n          currentValue === \"\" ||\n          currentValue === lastAutoValue;"
      ),
    "Working context defaults must apply only to empty fields or previously auto-applied values"
  );
  assert(
    hookSource.includes("if (!shouldApply) {\n          continue;\n        }"),
    "Working context defaults must skip user-entered values"
  );
  assert(
    hookSource.includes("nextState[stateKey] = contextValue;") &&
      hookSource.includes("return changed ? nextState : previousState;"),
    "Working context defaults should preserve state unless an allowed auto-apply change is needed"
  );

  const pagesToCheck = [
    {
      file: "frontend/src/pages/cari/CariDocumentsPage.jsx",
      needle: "useWorkingContextDefaults(setFilters, DOCUMENT_FILTER_CONTEXT_MAPPINGS",
    },
    {
      file: "frontend/src/pages/cari/CariDocumentsPage.jsx",
      needle: "useWorkingContextDefaults(setCreateForm, DOCUMENT_CREATE_CONTEXT_MAPPINGS",
    },
    {
      file: "frontend/src/pages/cari/CariCounterpartyPage.jsx",
      needle: "useWorkingContextDefaults(setCreateForm, COUNTERPARTY_CREATE_CONTEXT_MAPPINGS",
    },
    {
      file: "frontend/src/pages/cari/CariSettlementsPage.jsx",
      needle: "useWorkingContextDefaults(setApplyForm, SETTLEMENT_APPLY_CONTEXT_MAPPINGS",
    },
    {
      file: "frontend/src/pages/cash/CashTransactionsPage.jsx",
      needle: "useWorkingContextDefaults(setFilters, CASH_TRANSACTION_FILTER_CONTEXT_MAPPINGS",
    },
    {
      file: "frontend/src/pages/cash/CashRegistersPage.jsx",
      needle: "useWorkingContextDefaults(setForm, CASH_REGISTER_CONTEXT_MAPPINGS",
    },
    {
      file: "frontend/src/pages/OpsDashboardPage.jsx",
      needle: "useWorkingContextDefaults(setFilters, OPS_DASHBOARD_CONTEXT_MAPPINGS",
    },
    {
      file: "frontend/src/pages/ExceptionsWorkbenchPage.jsx",
      needle: "useWorkingContextDefaults(setFilters, EXCEPTIONS_CONTEXT_MAPPINGS",
    },
  ];

  for (const check of pagesToCheck) {
    const pageSource = await readFile(path.resolve(root, check.file), "utf8");
    assert(
      pageSource.includes(check.needle),
      `Context-default wiring missing in ${check.file}: expected ${check.needle}`
    );
  }

  console.log(
    "PR-UX02 acceptance smoke passed (context defaults only auto-apply on empty/auto-applied values and preserve user edits)."
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

