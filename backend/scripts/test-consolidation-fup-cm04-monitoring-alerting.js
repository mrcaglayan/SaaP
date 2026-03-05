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
    "utf8"
  );
  assert(
    routeSource.includes("CONSOLIDATION_CANONICAL_FAILURE_AUDIT_ACTION") &&
      routeSource.includes("consolidation.execute.failure.canonical_mapping"),
    "Consolidation execute failure audit action is missing"
  );
  assert(
    routeSource.includes("recordCanonicalExecuteFailureEvent") &&
      routeSource.includes("resolveCanonicalFailureSubtype"),
    "Canonical execute failure monitoring helpers are missing"
  );
  assert(
    routeSource.includes('"EFFECTIVE_DATE_MISMATCH"') &&
      routeSource.includes('"MISSING_MAPPING"'),
    "Canonical execute failure subtype classification is incomplete"
  );
  assert(
    routeSource.includes("CONSOLIDATION_CANONICAL_FAILURE_ALERT_WINDOW_MINUTES") &&
      routeSource.includes("CONSOLIDATION_CANONICAL_FAILURE_ALERT_THRESHOLD") &&
      routeSource.includes("CONSOLIDATION_CANONICAL_EXECUTE_FAILURE_ALERT"),
    "Repeated execute failure alert threshold wiring is missing"
  );

  const serviceSource = await readFile(
    path.resolve(
      root,
      "backend/src/services/consolidation.canonical-mappings.service.js"
    ),
    "utf8"
  );
  assert(
    serviceSource.includes("emitSemanticRiskOverrideUsageEvent") &&
      serviceSource.includes('"SEMANTIC_RISK_OVERRIDE_USAGE"') &&
      serviceSource.includes('"CONSOLIDATION_CANONICAL_MAPPING_OVERRIDE_USAGE"'),
    "Semantic-risk override telemetry event is missing"
  );
  assert(
    serviceSource.includes('"LOCAL_MAPPING_REMAP"') &&
      serviceSource.includes('"GROUP_MAPPING_REMAP"') &&
      serviceSource.includes('"SAFE_CANDIDATE_AUTO_APPLY"'),
    "Semantic-risk override telemetry contexts are incomplete"
  );

  const packageSource = await readFile(
    path.resolve(root, "backend/package.json"),
    "utf8"
  );
  assert(
    packageSource.includes('"test:ux:consolidation-fup-cm04"'),
    "backend/package.json must expose FUP-CM04 smoke script"
  );
  const releaseGateCoreMatch = packageSource.match(
    /"test:release-gate:core"\s*:\s*"([^"]+)"/
  );
  assert(releaseGateCoreMatch, "backend/package.json must define test:release-gate:core");
  assert(
    String(releaseGateCoreMatch?.[1] || "").includes(
      "npm run test:ux:consolidation-fup-cm04"
    ),
    "FUP-CM04 smoke test must be included in test:release-gate:core chain"
  );

  const runbookSource = await readFile(
    path.resolve(root, "docs/runbooks/consolidation-canonical-preflight.md"),
    "utf8"
  );
  assert(
    runbookSource.includes("Monitoring and Alerting (FUP-CM04)") &&
      runbookSource.includes("CONSOLIDATION_CANONICAL_FAILURE_ALERT_WINDOW_MINUTES") &&
      runbookSource.includes("CONSOLIDATION_CANONICAL_FAILURE_ALERT_THRESHOLD"),
    "Runbook must document FUP-CM04 monitoring and alert settings"
  );

  console.log("FUP-CM04 monitoring + alerting checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
