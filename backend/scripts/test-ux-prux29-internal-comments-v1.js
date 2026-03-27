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

  const migrationSource = await readFile(
    path.resolve(root, "backend/src/migrations/m073_internal_comments_v1.js"),
    "utf8"
  );
  const migrationIndexSource = await readFile(
    path.resolve(root, "backend/src/migrations/index.js"),
    "utf8"
  );
  const commentsServiceSource = await readFile(
    path.resolve(root, "backend/src/services/internalComments.service.js"),
    "utf8"
  );
  const commentsRouteSource = await readFile(
    path.resolve(root, "backend/src/routes/cari.document.comments.routes.js"),
    "utf8"
  );
  const documentRouteSource = await readFile(
    path.resolve(root, "backend/src/routes/cari.document.routes.js"),
    "utf8"
  );
  const documentApiSource = await readFile(
    path.resolve(root, "frontend/src/api/cariDocuments.js"),
    "utf8"
  );
  const documentsPageSource = await readCariDocumentsFeatureSource(root);

  assert(
    migrationSource.includes("CREATE TABLE IF NOT EXISTS internal_comments") &&
      migrationSource.includes("source_ref_type") &&
      migrationSource.includes("source_ref_id") &&
      migrationSource.includes("body VARCHAR(2000)") &&
      migrationSource.includes("status ENUM('ACTIVE','DELETED')"),
    "Migration m073 should create internal_comments table with scoped source + body + status fields"
  );
  assert(
    migrationIndexSource.includes(
      'import migration073InternalCommentsV1 from "./m073_internal_comments_v1.js"'
    ) && migrationIndexSource.includes("migration073InternalCommentsV1"),
    "Migration index should register m073_internal_comments_v1"
  );

  assert(
    commentsServiceSource.includes("listCariDocumentInternalCommentsForTenant") &&
      commentsServiceSource.includes("createCariDocumentInternalComment") &&
      commentsServiceSource.includes('SOURCE_REF_TYPE_CARI_DOCUMENT = "CARI_DOCUMENT"'),
    "Internal comments service should expose CARI document list/create operations"
  );

  assert(
    commentsRouteSource.includes('router.get(\n  "/"') &&
      commentsRouteSource.includes('router.post(\n  "/"') &&
      commentsRouteSource.includes('requirePermission("cari.doc.read"') &&
      commentsRouteSource.includes('requirePermission("cari.doc.update"'),
    "CARI document comments routes should expose list/create with permission guards"
  );

  assert(
    documentRouteSource.includes('router.use("/:documentId/comments", cariDocumentCommentsRoutes)'),
    "CARI document router should mount /:documentId/comments routes"
  );

  assert(
    documentApiSource.includes("export async function listCariDocumentComments") &&
      documentApiSource.includes("export async function createCariDocumentComment"),
    "Cari document frontend API should expose internal comments list/create clients"
  );

  assert(
    documentsPageSource.includes("Internal comments") &&
      documentsPageSource.includes("handleCreateInternalComment") &&
      documentsPageSource.includes("listCariDocumentComments") &&
      documentsPageSource.includes("createCariDocumentComment") &&
      documentsPageSource.includes("Add Comment"),
    "CariDocumentsPage should show internal comments list/add UI wired to comments APIs"
  );

  console.log("PR-UX29 smoke test passed (internal comments v1 wiring).");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
