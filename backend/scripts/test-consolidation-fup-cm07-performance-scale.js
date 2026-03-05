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
    path.resolve(
      root,
      "backend/src/migrations/m098_consolidation_canonical_performance_indexes.js"
    ),
    "utf8"
  );
  assert(
    migrationSource.includes("ix_journal_tenant_entity_period_status_entry") &&
      migrationSource.includes("ix_journal_lines_entry_account") &&
      migrationSource.includes("ix_group_coa_map_scope_status") &&
      migrationSource.includes("ix_accounts_coa_active_code"),
    "FUP-CM07 migration must add canonical execute/candidate join index coverage"
  );
  assert(
    migrationSource.includes("ix_cons_local_scope_status_effective") &&
      migrationSource.includes("ix_cons_group_scope_status_effective") &&
      migrationSource.includes("ix_audit_tenant_action_scope_time"),
    "FUP-CM07 migration must add canonical mapping + governance audit index coverage"
  );

  const migrationIndexSource = await readFile(
    path.resolve(root, "backend/src/migrations/index.js"),
    "utf8"
  );
  assert(
    migrationIndexSource.includes("m098_consolidation_canonical_performance_indexes") &&
      migrationIndexSource.includes("migration098ConsolidationCanonicalPerformanceIndexes"),
    "Migration registry must include m098_consolidation_canonical_performance_indexes"
  );

  const opsScriptSource = await readFile(
    path.resolve(
      root,
      "backend/scripts/consolidation-canonical-performance-benchmark.js"
    ),
    "utf8"
  );
  assert(
    opsScriptSource.includes("EXPLAIN") &&
      opsScriptSource.includes("listCanonicalMappingCandidates") &&
      opsScriptSource.includes("getCanonicalMappingGovernanceReview"),
    "FUP-CM07 ops benchmark must include explain checks and canonical service benchmarks"
  );
  assert(
    opsScriptSource.includes("--executeThresholdMs") &&
      opsScriptSource.includes("--candidateThresholdMs") &&
      opsScriptSource.includes("--governanceThresholdMs") &&
      opsScriptSource.includes("Indexing follow-up required"),
    "FUP-CM07 ops benchmark must expose threshold controls and follow-up signal"
  );

  const packageSource = await readFile(
    path.resolve(root, "backend/package.json"),
    "utf8"
  );
  assert(
    packageSource.includes('"ops:consolidation:canonical-performance-benchmark"'),
    "backend/package.json must expose FUP-CM07 ops benchmark command"
  );
  assert(
    packageSource.includes('"test:ux:consolidation-fup-cm07"'),
    "backend/package.json must expose FUP-CM07 smoke script"
  );
  const releaseGateCoreMatch = packageSource.match(
    /"test:release-gate:core"\s*:\s*"([^"]+)"/
  );
  assert(releaseGateCoreMatch, "backend/package.json must define test:release-gate:core");
  assert(
    String(releaseGateCoreMatch?.[1] || "").includes(
      "npm run test:ux:consolidation-fup-cm07"
    ),
    "FUP-CM07 smoke test must be included in test:release-gate:core chain"
  );

  const runbookSource = await readFile(
    path.resolve(root, "docs/runbooks/consolidation-canonical-preflight.md"),
    "utf8"
  );
  assert(
    runbookSource.includes("Performance and Scale Validation (FUP-CM07)") &&
      runbookSource.includes("canonical-performance-benchmark") &&
      runbookSource.includes("threshold breach") &&
      runbookSource.includes("m098_consolidation_canonical_performance_indexes"),
    "Runbook must document FUP-CM07 benchmark + indexing follow-up workflow"
  );

  console.log("FUP-CM07 performance + scale validation checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
