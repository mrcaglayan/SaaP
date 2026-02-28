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

  const cariDocumentsPageSource = await readFile(
    path.resolve(root, "frontend/src/pages/cari/CariDocumentsPage.jsx"),
    "utf8"
  );

  assert(
    cariDocumentsPageSource.includes("DOCUMENT_DRAFT_TEMPLATE_MODULE_CODE") &&
      cariDocumentsPageSource.includes("DOCUMENT_RECURRING_TEMPLATE_CADENCES") &&
      cariDocumentsPageSource.includes("createRecurringRule") &&
      cariDocumentsPageSource.includes("handleCloneSelectedDocumentToCreateForm") &&
      cariDocumentsPageSource.includes("buildCloneDraftFormFromRow"),
    "CariDocumentsPage should expose clone-to-draft and recurring template foundations"
  );

  assert(
    cariDocumentsPageSource.includes("loadDocumentDraftTemplates") &&
      cariDocumentsPageSource.includes("applyDocumentDraftTemplate") &&
      cariDocumentsPageSource.includes("handleCreateDocumentDraftTemplate") &&
      cariDocumentsPageSource.includes("handleUpdateDocumentDraftTemplate") &&
      cariDocumentsPageSource.includes("handleDeleteDocumentDraftTemplate"),
    "CariDocumentsPage should wire recurring template CRUD using /me saved-view API helpers"
  );

  assert(
    cariDocumentsPageSource.includes("Clone + Recurring Templates") &&
      cariDocumentsPageSource.includes("Clone Selected Document") &&
      cariDocumentsPageSource.includes("Save Current Template") &&
      cariDocumentsPageSource.includes("Recurring Cadence"),
    "CariDocumentsPage create UI should provide clone action and recurring template controls"
  );

  console.log(
    "PR-UX27 smoke test passed (Cari document clone flow + recurring template controls/persistence)."
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
