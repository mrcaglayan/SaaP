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

  const pageSource = await readFile(
    path.resolve(root, "frontend/src/pages/cari/CariDocumentsPage.jsx"),
    "utf8"
  );
  const documentApiSource = await readFile(
    path.resolve(root, "frontend/src/api/cariDocuments.js"),
    "utf8"
  );
  const documentRouteSource = await readFile(
    path.resolve(root, "backend/src/routes/cari.document.routes.js"),
    "utf8"
  );
  const documentServiceSource = await readFile(
    path.resolve(root, "backend/src/services/cari.document.service.js"),
    "utf8"
  );
  const exceptionRouteSource = await readFile(
    path.resolve(root, "backend/src/routes/exceptions.workbench.routes.js"),
    "utf8"
  );
  const exceptionServiceSource = await readFile(
    path.resolve(root, "backend/src/services/exceptions.workbench.service.js"),
    "utf8"
  );

  assert(
    pageSource.includes("Related Panel (GL / Open Items / Exceptions / Audit)") &&
      pageSource.includes("getCariDocumentOpenItems") &&
      pageSource.includes("getJournal(") &&
      pageSource.includes("listExceptionWorkbench(") &&
      pageSource.includes("listCariAudit(") &&
      pageSource.includes("sourceRefId: documentId"),
    "CariDocumentsPage should load/render related GL/open-items/exceptions/audit panel"
  );

  assert(
    documentApiSource.includes("export async function getCariDocumentOpenItems") &&
      documentApiSource.includes('`/api/v1/cari/documents/${documentId}/open-items`'),
    "Cari document frontend API should expose open-items endpoint client"
  );

  assert(
    documentRouteSource.includes('"/:documentId/open-items"') &&
      documentRouteSource.includes("listCariDocumentOpenItemsByIdForTenant"),
    "Cari document route should expose GET /:documentId/open-items endpoint"
  );

  assert(
    documentServiceSource.includes("export async function listCariDocumentOpenItemsByIdForTenant") &&
      documentServiceSource.includes("FROM cari_open_items"),
    "Cari document service should load open items by documentId"
  );

  assert(
    exceptionRouteSource.includes("sourceRefId") &&
      exceptionServiceSource.includes("ew.source_ref_id = ?"),
    "Exceptions workbench list should support sourceRefId filtering for related panel"
  );

  console.log(
    "PR-UX19 smoke test passed (related panel wiring + document open-items API + exception sourceRefId filter)."
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
