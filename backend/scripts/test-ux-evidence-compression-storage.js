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
    path.resolve(root, "backend/src/migrations/m071_evidence_storage_compression.js"),
    "utf8"
  );
  const migrationIndexSource = await readFile(
    path.resolve(root, "backend/src/migrations/index.js"),
    "utf8"
  );
  const serviceSource = await readFile(
    path.resolve(root, "backend/src/services/evidence.service.js"),
    "utf8"
  );
  const envExampleSource = await readFile(
    path.resolve(root, "backend/.env.example"),
    "utf8"
  );

  assert(
    migrationSource.includes("m071_evidence_storage_compression") &&
      migrationSource.includes("compression_codec ENUM('NONE','GZIP')") &&
      migrationSource.includes("stored_size_bytes"),
    "Migration m071 should add compression codec and stored size metadata"
  );
  assert(
    migrationIndexSource.includes(
      'import migration071EvidenceStorageCompression from "./m071_evidence_storage_compression.js"'
    ) && migrationIndexSource.includes("migration071EvidenceStorageCompression"),
    "Migration index should register m071 evidence compression migration"
  );

  assert(
    serviceSource.includes("buildStoredEvidencePayload") &&
      serviceSource.includes("resolveCompressionMode") &&
      serviceSource.includes("EVIDENCE_STORAGE_COMPRESSION") &&
      serviceSource.includes("compression_codec") &&
      serviceSource.includes("stored_size_bytes") &&
      serviceSource.includes("await gzip(") &&
      serviceSource.includes("await gunzip("),
    "Evidence service should gzip stored payloads and gunzip during download using compression metadata"
  );

  assert(
    envExampleSource.includes("EVIDENCE_STORAGE_COMPRESSION"),
    "backend/.env.example should document EVIDENCE_STORAGE_COMPRESSION"
  );

  console.log(
    "Evidence compression smoke test passed (migration + service gzip/gunzip flow + env config)."
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

