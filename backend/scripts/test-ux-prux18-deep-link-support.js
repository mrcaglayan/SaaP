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
  const cariDocumentsSource = await readFile(
    path.resolve(root, "frontend/src/pages/cari/CariDocumentsPage.jsx"),
    "utf8"
  );
  const journalWorkbenchSource = await readFile(
    path.resolve(root, "frontend/src/pages/JournalWorkbenchPage.jsx"),
    "utf8"
  );
  const exceptionsWorkbenchSource = await readFile(
    path.resolve(root, "frontend/src/pages/ExceptionsWorkbenchPage.jsx"),
    "utf8"
  );

  assert(
    cariDocumentsSource.includes("useSearchParams") &&
      cariDocumentsSource.includes('searchParams.get("documentId")') &&
      cariDocumentsSource.includes("setSelectedDocumentId(deepLinkedDocumentId)") &&
      cariDocumentsSource.includes('nextParams.set("documentId"'),
    "CariDocumentsPage should support documentId deep-link read + URL sync"
  );

  assert(
    journalWorkbenchSource.includes("useSearchParams") &&
      journalWorkbenchSource.includes('searchParams.get("journalId")') &&
      journalWorkbenchSource.includes("void loadJournalDetail(deepLinkedJournalId)") &&
      journalWorkbenchSource.includes('nextParams.set("journalId"'),
    "JournalWorkbenchPage should support journalId deep-link read + URL sync"
  );

  assert(
    exceptionsWorkbenchSource.includes("useSearchParams") &&
      exceptionsWorkbenchSource.includes('searchParams.get("exceptionId")') &&
      exceptionsWorkbenchSource.includes("pinnedByDeepLink") &&
      exceptionsWorkbenchSource.includes("void loadDetail(deepLinkedExceptionId)") &&
      exceptionsWorkbenchSource.includes('nextParams.set("exceptionId"'),
    "ExceptionsWorkbenchPage should support exceptionId deep-link read + URL sync"
  );

  console.log(
    "PR-UX18 smoke test passed (documentId/journalId/exceptionId deep-link wiring)."
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
