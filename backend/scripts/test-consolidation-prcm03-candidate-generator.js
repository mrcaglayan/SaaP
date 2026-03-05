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
    apiSource.includes("previewConsolidationCanonicalMappingCandidates"),
    "consolidationAdmin.js must export previewConsolidationCanonicalMappingCandidates"
  );
  assert(
    apiSource.includes("applyConsolidationCanonicalMappingCandidates"),
    "consolidationAdmin.js must export applyConsolidationCanonicalMappingCandidates"
  );
  assert(
    apiSource.includes("canonical-mappings/candidates") &&
      apiSource.includes("canonical-mappings/candidates/apply"),
    "consolidationAdmin.js candidate preview/apply endpoints are incomplete"
  );

  const serviceSource = await readFile(
    path.resolve(
      root,
      "backend/src/services/consolidation.canonical-mappings.service.js"
    ),
    "utf8"
  );
  assert(
    serviceSource.includes("export async function listCanonicalMappingCandidates"),
    "canonical mappings service must export listCanonicalMappingCandidates"
  );
  assert(
    serviceSource.includes("export async function applyCanonicalMappingCandidates"),
    "canonical mappings service must export applyCanonicalMappingCandidates"
  );
  assert(
    serviceSource.includes("SAFE") &&
      serviceSource.includes("PARTIAL_MAPPING") &&
      serviceSource.includes("AMBIGUOUS_GROUP_MATCH"),
    "candidate classification constants are missing in canonical mapping service"
  );

  const routeSource = await readFile(
    path.resolve(root, "backend/src/routes/consolidation.js"),
    "utf8"
  );
  assert(
    routeSource.includes("/groups/:groupId/canonical-mappings/candidates"),
    "consolidation route must expose candidate preview endpoint"
  );
  assert(
    routeSource.includes("/groups/:groupId/canonical-mappings/candidates/apply"),
    "consolidation route must expose candidate apply endpoint"
  );

  const setupPageSource = await readFile(
    path.resolve(root, "frontend/src/pages/settings/ConsolidationSetupPage.jsx"),
    "utf8"
  );
  assert(
    setupPageSource.includes("onPreviewCanonicalCandidates"),
    "ConsolidationSetupPage must implement candidate preview handler"
  );
  assert(
    setupPageSource.includes("onApplyCanonicalCandidates"),
    "ConsolidationSetupPage must implement safe candidate apply handler"
  );
  assert(
    setupPageSource.includes("Preview candidates") &&
      setupPageSource.includes("Apply safe candidates"),
    "ConsolidationSetupPage candidate preview/apply controls are incomplete"
  );

  console.log("PR-CM03 candidate generator + controlled apply smoke checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
