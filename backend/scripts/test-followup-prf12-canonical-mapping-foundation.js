import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as canonicalMappingsService from "../src/services/consolidation.canonical-mappings.service.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  assert(
    typeof canonicalMappingsService.listCanonicalKeys === "function",
    "Missing listCanonicalKeys service export"
  );
  assert(
    typeof canonicalMappingsService.upsertLocalAccountCanonicalMapping === "function",
    "Missing upsertLocalAccountCanonicalMapping service export"
  );
  assert(
    typeof canonicalMappingsService.upsertGroupAccountCanonicalMapping === "function",
    "Missing upsertGroupAccountCanonicalMapping service export"
  );

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

  const migrationIndexSource = await readFile(
    path.resolve(root, "backend/src/migrations/index.js"),
    "utf8"
  );
  assert(
    migrationIndexSource.includes("m084_consolidation_canonical_mapping_foundation"),
    "Migration index missing m084 canonical mapping registration"
  );

  const migrationSource = await readFile(
    path.resolve(root, "backend/src/migrations/m084_consolidation_canonical_mapping_foundation.js"),
    "utf8"
  );
  assert(
    migrationSource.includes("consolidation_canonical_keys") &&
      migrationSource.includes("consolidation_canonical_local_account_mappings") &&
      migrationSource.includes("consolidation_canonical_group_account_mappings"),
    "Canonical mapping migration must define key/local/group mapping tables"
  );

  const consolidationRouteSource = await readFile(
    path.resolve(root, "backend/src/routes/consolidation.js"),
    "utf8"
  );
  assert(
    consolidationRouteSource.includes('"/groups/:groupId/canonical-keys"') &&
      consolidationRouteSource.includes('"/groups/:groupId/canonical-mappings"') &&
      consolidationRouteSource.includes('"/groups/:groupId/canonical-mappings/local"') &&
      consolidationRouteSource.includes('"/groups/:groupId/canonical-mappings/group"'),
    "Consolidation route missing canonical mapping setup endpoints"
  );

  const backfillSource = await readFile(
    path.resolve(root, "backend/scripts/backfill-canonical-consolidation-mappings.js"),
    "utf8"
  );
  assert(
    backfillSource.includes("Dry-run only") &&
      backfillSource.includes("consolidation_canonical_local_account_mappings") &&
      backfillSource.includes("consolidation_canonical_group_account_mappings"),
    "Canonical backfill scaffold script missing expected behavior"
  );

  console.log("PR-F12 canonical mapping foundation checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
