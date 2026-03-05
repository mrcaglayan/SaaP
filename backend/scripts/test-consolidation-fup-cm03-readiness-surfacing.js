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

  const serviceSource = await readFile(
    path.resolve(
      root,
      "backend/src/services/consolidation.canonical-mappings.service.js"
    ),
    "utf8"
  );
  assert(
    serviceSource.includes("export async function getCanonicalMappingReadiness"),
    "canonical mappings service must export getCanonicalMappingReadiness"
  );
  assert(
    serviceSource.includes("byLegalEntity") &&
      serviceSource.includes("coverageDetected") &&
      serviceSource.includes("UNRESOLVED_CANDIDATE_MAPPINGS"),
    "canonical readiness snapshot payload is incomplete"
  );

  const routeSource = await readFile(
    path.resolve(root, "backend/src/routes/consolidation.js"),
    "utf8"
  );
  assert(
    routeSource.includes('/groups/:groupId/canonical-readiness') &&
      routeSource.includes("getCanonicalMappingReadiness") &&
      routeSource.includes('requirePermission("consolidation.coa_mapping.read")'),
    "consolidation route must expose canonical-readiness endpoint with read permission guard"
  );

  const apiSource = await readFile(
    path.resolve(root, "frontend/src/api/consolidationAdmin.js"),
    "utf8"
  );
  assert(
    apiSource.includes("export async function getConsolidationCanonicalReadiness"),
    "frontend consolidation API must export getConsolidationCanonicalReadiness"
  );
  assert(
    apiSource.includes("/canonical-readiness"),
    "frontend consolidation API canonical-readiness endpoint path is missing"
  );

  const setupPageSource = await readFile(
    path.resolve(root, "frontend/src/pages/settings/ConsolidationSetupPage.jsx"),
    "utf8"
  );
  assert(
    setupPageSource.includes("canonicalReadiness") &&
      setupPageSource.includes("Canonical Readiness") &&
      setupPageSource.includes("Refresh readiness"),
    "ConsolidationSetupPage must render canonical readiness setup card"
  );

  const onboardingSource = await readFile(
    path.resolve(root, "backend/src/routes/onboarding.js"),
    "utf8"
  );
  assert(
    onboardingSource.includes('key: "consolidationCanonicalMappingV1"') &&
      onboardingSource.includes('key: "workflowCloseConsolidationV1"'),
    "onboarding readiness contract keys must remain stable"
  );

  console.log("FUP-CM03 operational readiness surfacing checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

