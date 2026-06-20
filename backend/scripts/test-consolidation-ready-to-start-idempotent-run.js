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

  const routeSource = await readFile(
    path.resolve(root, "backend/src/routes/consolidation.js"),
    "utf8",
  );
  assert(
    routeSource.includes("isConsolidationRunNaturalKeyDuplicate") &&
      routeSource.includes("uk_cons_run_unique"),
    "Consolidation run create route must detect the natural unique-key duplicate",
  );
  assert(
    routeSource.includes("runName !== OFFICIAL_CONSOLIDATION_RUN_NAME") &&
      routeSource.includes("resolveOfficialRunCreateReplay"),
    "Idempotent replay must be limited to OFFICIAL consolidation runs",
  );
  assert(
    routeSource.includes("return res.status(200).json(replayResponse)") &&
      routeSource.includes("idempotent: true"),
    "Duplicate OFFICIAL create must return 200 with idempotent=true",
  );
  assert(
    routeSource.includes("return res.status(201).json(buildConsolidationRunCreateResponse") &&
      routeSource.includes("idempotent: false"),
    "First consolidation run create must return 201 with idempotent=false",
  );
  assert(
    routeSource.includes('autoLinkAndSyncSource("CONSOLIDATION_RUN", existingRun.id') ||
      routeSource.includes('autoLinkAndSyncSource("CONSOLIDATION_RUN", runId'),
    "Replay and first-create paths must keep close-cycle item links synced",
  );

  const frontendHelperSource = await readFile(
    path.resolve(root, "frontend/src/api/consolidationRuns.js"),
    "utf8",
  );
  assert(
    frontendHelperSource.includes("createOfficialConsolidationRun") &&
      frontendHelperSource.includes('runName: "OFFICIAL"') &&
      frontendHelperSource.includes("/api/v1/consolidation/runs"),
    "Frontend must expose a thin helper for starting the official consolidation run",
  );

  const generatorSource = await readFile(
    path.resolve(root, "backend/scripts/generate-openapi.js"),
    "utf8",
  );
  assert(
    generatorSource.includes("Existing OFFICIAL consolidation run returned from idempotent replay") &&
      generatorSource.includes("idempotent: { type: \"boolean\" }"),
    "OpenAPI generator must document the idempotent create-run replay response",
  );

  const openapiSource = await readFile(
    path.resolve(root, "backend/openapi.yaml"),
    "utf8",
  );
  assert(
    openapiSource.includes('"Existing OFFICIAL consolidation run returned from idempotent replay"') &&
      openapiSource.includes('"idempotent"') &&
      openapiSource.includes('"ConsolidationRunResponse"'),
    "Generated OpenAPI must include the consolidation run idempotent response contract",
  );

  console.log(
    "Consolidation ready-to-start idempotent run checks passed (OFFICIAL replay + helper + OpenAPI).",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
