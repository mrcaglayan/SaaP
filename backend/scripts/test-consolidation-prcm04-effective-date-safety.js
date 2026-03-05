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
    serviceSource.includes("assertNoOverlappingActiveLocalMappingWindow"),
    "canonical mapping service must guard local mapping effective-date overlap"
  );
  assert(
    serviceSource.includes("assertNoOverlappingActiveGroupMappingWindow"),
    "canonical mapping service must guard group mapping effective-date overlap"
  );
  assert(
    serviceSource.includes("effectiveTo must be >= effectiveFrom"),
    "canonical mapping service must enforce effectiveTo >= effectiveFrom"
  );

  const routeSource = await readFile(
    path.resolve(root, "backend/src/routes/consolidation.js"),
    "utf8"
  );
  assert(
    routeSource.includes("LOCAL_MAPPING_DATE_MISMATCH") &&
      routeSource.includes("GROUP_MAPPING_DATE_MISMATCH"),
    "consolidation execute coverage must classify date mismatch reasons"
  );
  assert(
    routeSource.includes("err.details") &&
      routeSource.includes("reasonCounts") &&
      routeSource.includes("sampleRows"),
    "consolidation execute coverage error must return structured details"
  );

  const setupPageSource = await readFile(
    path.resolve(root, "frontend/src/pages/settings/ConsolidationSetupPage.jsx"),
    "utf8"
  );
  assert(
    setupPageSource.includes("findCanonicalDateMisalignedRuns"),
    "ConsolidationSetupPage must detect run-period date misalignment"
  );
  assert(
    setupPageSource.includes("effectiveFrom") &&
      setupPageSource.includes("run period end for unresolved run"),
    "ConsolidationSetupPage must block obvious effectiveFrom > run period end mismatches"
  );

  console.log("PR-CM04 effective date safety smoke checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
