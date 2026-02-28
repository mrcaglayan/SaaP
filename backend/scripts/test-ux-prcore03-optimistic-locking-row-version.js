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
    path.resolve(root, "backend/src/migrations/m080_row_version_optimistic_locking.js"),
    "utf8"
  );
  const migrationIndexSource = await readFile(
    path.resolve(root, "backend/src/migrations/index.js"),
    "utf8"
  );
  const docValidatorSource = await readFile(
    path.resolve(root, "backend/src/routes/cari.document.validators.js"),
    "utf8"
  );
  const docServiceSource = await readFile(
    path.resolve(root, "backend/src/services/cari.document.service.js"),
    "utf8"
  );
  const cardValidatorSource = await readFile(
    path.resolve(root, "backend/src/routes/cari.counterparty.validators.js"),
    "utf8"
  );
  const cardServiceSource = await readFile(
    path.resolve(root, "backend/src/services/cari.counterparty.service.js"),
    "utf8"
  );
  const docUtilsSource = await readFile(
    path.resolve(root, "frontend/src/pages/cari/cariDocumentsUtils.js"),
    "utf8"
  );
  const cardUtilsSource = await readFile(
    path.resolve(root, "frontend/src/pages/cari/counterpartyFormUtils.js"),
    "utf8"
  );

  assert(
    migrationSource.includes("cari_documents") &&
      migrationSource.includes("counterparties") &&
      migrationSource.includes("row_version"),
    "Migration m080 should add row_version columns to editable CARI entities"
  );
  assert(
    migrationIndexSource.includes(
      'import migration080RowVersionOptimisticLocking from "./m080_row_version_optimistic_locking.js"'
    ) && migrationIndexSource.includes("migration080RowVersionOptimisticLocking"),
    "Migration index should register m080_row_version_optimistic_locking"
  );

  assert(
    (docValidatorSource.includes('parseRequiredRowVersion(req.body?.rowVersion, "rowVersion")') ||
      docValidatorSource.includes("rowVersion is required")) &&
      docServiceSource.includes("AND row_version = ?") &&
      docServiceSource.includes("OPTIMISTIC_LOCK_CONFLICT"),
    "Cari document update should require rowVersion and enforce optimistic lock"
  );

  assert(
    cardValidatorSource.includes("rowVersion is required") &&
      cardServiceSource.includes("AND row_version = ?") &&
      cardServiceSource.includes("OPTIMISTIC_LOCK_CONFLICT"),
    "Counterparty update should require rowVersion and enforce optimistic lock"
  );

  assert(
    docUtilsSource.includes("rowVersion") && cardUtilsSource.includes("rowVersion"),
    "Frontend CARI forms should include rowVersion in update payload mapping"
  );

  console.log("PR-CORE03 smoke test passed (row_version optimistic locking wiring).");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
