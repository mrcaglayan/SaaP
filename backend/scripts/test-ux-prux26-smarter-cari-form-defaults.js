import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCariDocumentsFeatureSource } from "./_cariDocumentsFeatureSource.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

  const cariDocumentsPageSource = await readCariDocumentsFeatureSource(root);
  const cariSettlementsPageSource = await readFile(
    path.resolve(root, "frontend/src/pages/cari/CariSettlementsPage.jsx"),
    "utf8"
  );
  const cariCounterpartyPageSource = await readFile(
    path.resolve(root, "frontend/src/pages/cari/CariCounterpartyPage.jsx"),
    "utf8"
  );

  assert(
    cariDocumentsPageSource.includes("stateKey: \"documentDate\"") &&
      cariDocumentsPageSource.includes("contextKey: \"dateTo\"") &&
      cariDocumentsPageSource.includes("selectedCreateCounterparty") &&
      cariDocumentsPageSource.includes("defaultPaymentTermId") &&
      cariDocumentsPageSource.includes("defaultCurrencyCode") &&
      cariDocumentsPageSource.includes("resetCreateDraftFormWithSmartDefaults"),
    "CariDocumentsPage should apply smarter create-form defaults from working context and selected counterparty"
  );

  assert(
    cariSettlementsPageSource.includes("stateKey: \"asOfDate\", contextKey: \"dateTo\"") &&
      cariSettlementsPageSource.includes("stateKey: \"settlementDate\", contextKey: \"dateTo\"") &&
      cariSettlementsPageSource.includes("SETTLEMENT_REVERSE_CONTEXT_MAPPINGS") &&
      cariSettlementsPageSource.includes("setReverseForm, SETTLEMENT_REVERSE_CONTEXT_MAPPINGS"),
    "CariSettlementsPage should map working-context date defaults into preview/apply/bank-apply/reverse forms"
  );

  assert(
    cariCounterpartyPageSource.includes("COUNTERPARTY_CREATE_CONTEXT_MAPPINGS") &&
      cariCounterpartyPageSource.includes("useWorkingContextDefaults(setCreateForm"),
    "CariCounterpartyPage create form should hydrate legalEntityId from working context defaults"
  );

  console.log(
    "PR-UX26 smoke test passed (smarter defaulting across Cari document, settlement, and counterparty forms)."
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
