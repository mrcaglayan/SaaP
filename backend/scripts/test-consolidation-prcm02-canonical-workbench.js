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

  const apiSource = await readFile(
    path.resolve(root, "frontend/src/api/consolidationAdmin.js"),
    "utf8"
  );
  assert(
    apiSource.includes("listConsolidationCanonicalMappings"),
    "consolidationAdmin.js must export listConsolidationCanonicalMappings"
  );
  assert(
    apiSource.includes("upsertConsolidationCanonicalLocalMapping"),
    "consolidationAdmin.js must export upsertConsolidationCanonicalLocalMapping"
  );
  assert(
    apiSource.includes("upsertConsolidationCanonicalGroupMapping"),
    "consolidationAdmin.js must export upsertConsolidationCanonicalGroupMapping"
  );
  assert(
    apiSource.includes("canonical-mappings/local") &&
      apiSource.includes("canonical-mappings/group") &&
      apiSource.includes("canonical-mappings"),
    "consolidationAdmin.js canonical mapping endpoints are incomplete"
  );

  const setupPageSource = await readFile(
    path.resolve(root, "frontend/src/pages/settings/ConsolidationSetupPage.jsx"),
    "utf8"
  );
  assert(
    setupPageSource.includes("canonicalMappings"),
    "ConsolidationSetupPage must track canonicalMappings state"
  );
  assert(
    setupPageSource.includes("onSaveCanonicalLocalMapping"),
    "ConsolidationSetupPage must implement local canonical mapping save handler"
  );
  assert(
    setupPageSource.includes("onSaveCanonicalGroupMapping"),
    "ConsolidationSetupPage must implement group canonical mapping save handler"
  );
  assert(
    setupPageSource.includes("Canonical Mappings") &&
      setupPageSource.includes("canonical-local-account-options") &&
      setupPageSource.includes("canonical-group-account-options"),
    "ConsolidationSetupPage canonical mapping workbench UI is incomplete"
  );

  console.log("PR-CM02 consolidation canonical workbench smoke checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
