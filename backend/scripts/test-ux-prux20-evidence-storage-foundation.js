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

  const migrationSource = await readFile(
    path.resolve(root, "backend/src/migrations/m070_evidence_storage_foundation.js"),
    "utf8"
  );
  const migrationIndexSource = await readFile(
    path.resolve(root, "backend/src/migrations/index.js"),
    "utf8"
  );
  const adapterSource = await readFile(
    path.resolve(root, "backend/src/services/evidence.storage.adapter.js"),
    "utf8"
  );
  const evidenceServiceSource = await readFile(
    path.resolve(root, "backend/src/services/evidence.service.js"),
    "utf8"
  );
  const evidenceRouteSource = await readFile(
    path.resolve(root, "backend/src/routes/cari.document.evidence.routes.js"),
    "utf8"
  );
  const documentRouteSource = await readFile(
    path.resolve(root, "backend/src/routes/cari.document.routes.js"),
    "utf8"
  );

  assert(
    migrationSource.includes("CREATE TABLE IF NOT EXISTS evidence_objects") &&
      migrationSource.includes("source_ref_type") &&
      migrationSource.includes("source_ref_id") &&
      migrationSource.includes("status ENUM('PENDING_UPLOAD','ACTIVE','DELETED')") &&
      migrationSource.includes("storage_driver") &&
      migrationSource.includes("storage_path"),
    "Migration m070 should create evidence_objects foundation table with source/link/status/storage fields"
  );
  assert(
    migrationIndexSource.includes(
      'import migration070EvidenceStorageFoundation from "./m070_evidence_storage_foundation.js"'
    ) && migrationIndexSource.includes("migration070EvidenceStorageFoundation"),
    "Migration index should register m070_evidence_storage_foundation"
  );

  assert(
    adapterSource.includes("buildEvidenceStoragePath") &&
      adapterSource.includes("writeEvidenceBinary") &&
      adapterSource.includes("readEvidenceBinary") &&
      adapterSource.includes("deleteEvidenceBinary"),
    "Evidence storage adapter should expose build/write/read/delete helpers"
  );

  assert(
    evidenceServiceSource.includes("createCariDocumentEvidenceDraft") &&
      evidenceServiceSource.includes("listCariDocumentEvidenceForTenant") &&
      evidenceServiceSource.includes("uploadCariDocumentEvidenceContent") &&
      evidenceServiceSource.includes("getCariDocumentEvidenceContentForTenant") &&
      evidenceServiceSource.includes("deleteCariDocumentEvidenceByIdForTenant") &&
      evidenceServiceSource.includes('SOURCE_REF_TYPE_CARI_DOCUMENT = "CARI_DOCUMENT"'),
    "Evidence service should expose CARI document evidence lifecycle operations"
  );

  assert(
    evidenceRouteSource.includes('router.get(\n  "/"') &&
      evidenceRouteSource.includes('router.post(\n  "/"') &&
      evidenceRouteSource.includes('"/:evidenceId/content"') &&
      evidenceRouteSource.includes('"/:evidenceId/download"') &&
      evidenceRouteSource.includes('requirePermission("cari.doc.read"') &&
      evidenceRouteSource.includes('requirePermission("cari.doc.update"'),
    "CARI document evidence routes should provide list/create/upload/download/delete with permission guards"
  );

  assert(
    documentRouteSource.includes('router.use("/:documentId/evidence", cariDocumentEvidenceRoutes)'),
    "CARI document router should mount /:documentId/evidence routes"
  );

  console.log(
    "PR-UX20 smoke test passed (evidence migration + storage adapter + service + CARI document evidence routes)."
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

