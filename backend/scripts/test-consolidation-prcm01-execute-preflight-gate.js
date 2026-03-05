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
    apiSource.includes("export async function getConsolidationRun(runId)"),
    "consolidationAdmin.js must export getConsolidationRun(runId)"
  );
  assert(
    apiSource.includes('`/api/v1/consolidation/runs/${runId}`'),
    "getConsolidationRun(runId) must call GET /api/v1/consolidation/runs/:runId"
  );

  const setupPageSource = await readFile(
    path.resolve(root, "frontend/src/pages/settings/ConsolidationSetupPage.jsx"),
    "utf8"
  );
  assert(
    setupPageSource.includes("getConsolidationRun"),
    "ConsolidationSetupPage must import and use getConsolidationRun"
  );
  assert(
    setupPageSource.includes("resolveCanonicalCoverageSnapshot"),
    "ConsolidationSetupPage must derive canonical coverage from run compatibility payload"
  );
  assert(
    setupPageSource.includes("runPreflightById"),
    "ConsolidationSetupPage must track per-run preflight compatibility state"
  );
  assert(
    setupPageSource.includes("executeBlockedByPreflight"),
    "ConsolidationSetupPage must compute preflight-based execute blocking"
  );
  assert(
    setupPageSource.includes("canonical mapping coverage"),
    "ConsolidationSetupPage must show canonical mapping coverage guidance text"
  );

  console.log(
    "PR-CM01 consolidation execute preflight gate smoke checks passed."
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
