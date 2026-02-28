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
    path.resolve(root, "backend/src/migrations/m075_ops_status_note_blocked_reason.js"),
    "utf8"
  );
  const migrationIndexSource = await readFile(
    path.resolve(root, "backend/src/migrations/index.js"),
    "utf8"
  );
  const opsStatusServiceSource = await readFile(
    path.resolve(root, "backend/src/services/opsStatus.service.js"),
    "utf8"
  );
  const opsStatusRouteSource = await readFile(
    path.resolve(root, "backend/src/routes/cari.document.ops-status.routes.js"),
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
  const documentsPageSource = await readFile(
    path.resolve(root, "frontend/src/pages/cari/CariDocumentsPage.jsx"),
    "utf8"
  );

  assert(
    migrationSource.includes("CREATE TABLE IF NOT EXISTS ops_status_notes") &&
      migrationSource.includes("ops_status ENUM('OK','AT_RISK','BLOCKED')") &&
      migrationSource.includes("blocked_reason") &&
      migrationSource.includes("note"),
    "Migration m075 should create ops_status_notes with ops_status + blocked_reason + note fields"
  );
  assert(
    migrationIndexSource.includes(
      'import migration075OpsStatusNoteBlockedReason from "./m075_ops_status_note_blocked_reason.js"'
    ) && migrationIndexSource.includes("migration075OpsStatusNoteBlockedReason"),
    "Migration index should register m075_ops_status_note_blocked_reason"
  );

  assert(
    opsStatusServiceSource.includes("getCariDocumentOpsStatusForTenant") &&
      opsStatusServiceSource.includes("upsertCariDocumentOpsStatus") &&
      opsStatusServiceSource.includes("blockedReason is required when opsStatus=BLOCKED"),
    "Ops status service should expose CARI get/upsert operations with BLOCKED reason guard"
  );

  assert(
    opsStatusRouteSource.includes('router.get(\n  "/"') &&
      opsStatusRouteSource.includes('router.put(\n  "/"') &&
      opsStatusRouteSource.includes('requirePermission("cari.doc.read"') &&
      opsStatusRouteSource.includes('requirePermission("cari.doc.update"'),
    "CARI document ops-status routes should expose read/update with permission guards"
  );

  assert(
    documentRouteSource.includes('router.use("/:documentId/ops-status", cariDocumentOpsStatusRoutes)'),
    "CARI document router should mount /:documentId/ops-status routes"
  );

  assert(
    documentApiSource.includes("export async function getCariDocumentOpsStatus") &&
      documentApiSource.includes("export async function upsertCariDocumentOpsStatus"),
    "CARI document frontend API should expose ops-status get/upsert clients"
  );

  assert(
    documentsPageSource.includes("Ops status note / blocked reason") &&
      documentsPageSource.includes("handleSaveOpsStatus") &&
      documentsPageSource.includes("getCariDocumentOpsStatus") &&
      documentsPageSource.includes("upsertCariDocumentOpsStatus") &&
      documentsPageSource.includes("Save Ops Status"),
    "CariDocumentsPage should expose ops status note / blocked reason UI wired to ops-status API"
  );

  console.log(
    "PR-UX31 smoke test passed (ops status note / blocked reason wiring)."
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
