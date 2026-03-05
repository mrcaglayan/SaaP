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
    serviceSource.includes("export async function getCanonicalMappingGovernanceReview"),
    "canonical mappings service must export getCanonicalMappingGovernanceReview"
  );
  assert(
    serviceSource.includes("AMBIGUOUS_CANDIDATE_SELECTION") &&
      serviceSource.includes("HIGH_RISK_REMAP_OR_APPLY") &&
      serviceSource.includes("PENDING_CHECKER_REVIEW"),
    "maker-checker governance reason/status contract is missing"
  );
  assert(
    serviceSource.includes("unmappedPostedAccounts") &&
      serviceSource.includes("recentMappingChanges") &&
      serviceSource.includes("highRiskOverrides"),
    "governance review snapshot must include required month-end sections"
  );

  const routeSource = await readFile(
    path.resolve(root, "backend/src/routes/consolidation.js"),
    "utf8"
  );
  assert(
    routeSource.includes('/groups/:groupId/canonical-governance-review') &&
      routeSource.includes("getCanonicalMappingGovernanceReview") &&
      routeSource.includes('requirePermission("consolidation.coa_mapping.read")'),
    "consolidation route must expose canonical-governance-review endpoint with read guard"
  );

  const opsScriptSource = await readFile(
    path.resolve(root, "backend/scripts/consolidation-canonical-governance-review.js"),
    "utf8"
  );
  assert(
    opsScriptSource.includes("getCanonicalMappingGovernanceReview") &&
      opsScriptSource.includes("--tenantId") &&
      opsScriptSource.includes("--groupId"),
    "ops governance review script must call service and require tenant/group arguments"
  );

  const packageSource = await readFile(
    path.resolve(root, "backend/package.json"),
    "utf8"
  );
  assert(
    packageSource.includes('"ops:consolidation:canonical-governance-review"'),
    "backend/package.json must expose governance review ops command"
  );
  assert(
    packageSource.includes('"test:ux:consolidation-fup-cm05"'),
    "backend/package.json must expose FUP-CM05 smoke script"
  );
  const releaseGateCoreMatch = packageSource.match(
    /"test:release-gate:core"\s*:\s*"([^"]+)"/
  );
  assert(releaseGateCoreMatch, "backend/package.json must define test:release-gate:core");
  assert(
    String(releaseGateCoreMatch?.[1] || "").includes(
      "npm run test:ux:consolidation-fup-cm05"
    ),
    "FUP-CM05 smoke test must be included in test:release-gate:core chain"
  );

  const runbookSource = await readFile(
    path.resolve(root, "docs/runbooks/consolidation-canonical-preflight.md"),
    "utf8"
  );
  assert(
    runbookSource.includes("Mapping Governance Cadence (FUP-CM05)") &&
      runbookSource.includes("unmapped posted accounts") &&
      runbookSource.includes("maker-checker"),
    "runbook must document FUP-CM05 governance cadence"
  );

  console.log("FUP-CM05 mapping governance cadence checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
