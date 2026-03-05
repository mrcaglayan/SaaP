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

  const intercompanySource = await readFile(
    path.resolve(root, "backend/scripts/test-intercompany-and-consolidation-reports.js"),
    "utf8"
  );
  assert(
    intercompanySource.includes("upsertCanonicalAccountMapping"),
    "intercompany+consolidation integration test must seed canonical mapping prerequisites"
  );
  assert(
    intercompanySource.includes("canonical-mappings/local") &&
      intercompanySource.includes("canonical-mappings/group"),
    "intercompany+consolidation integration test canonical mapping endpoint seeding is incomplete"
  );
  assert(
    intercompanySource.includes("canonicalEffectiveFrom"),
    "intercompany+consolidation integration test must set deterministic canonical effective date"
  );

  const packageJsonSource = await readFile(
    path.resolve(root, "backend/package.json"),
    "utf8"
  );
  assert(
    packageJsonSource.includes('"test:ux:consolidation-prcm05"') &&
      packageJsonSource.includes('"test:ux:consolidation-prcm06"'),
    "backend/package.json must include PR-CM05 and PR-CM06 regression scripts"
  );
  assert(
    packageJsonSource.includes("test:ux:consolidation-prcm"),
    "backend/package.json must include aggregated consolidation PR-CM regression script"
  );
  assert(
    packageJsonSource.includes("test:ux:consolidation-prcm &&"),
    "test:release-gate:core must run consolidation PR-CM regression checks"
  );

  const runbookSource = await readFile(
    path.resolve(root, "docs/runbooks/consolidation-canonical-preflight.md"),
    "utf8"
  );
  assert(
    runbookSource.includes("Pre-Consolidation Checklist"),
    "consolidation canonical preflight runbook must define checklist section"
  );
  assert(
    runbookSource.includes("Preview canonical mapping candidates") &&
      runbookSource.includes("Apply safe deterministic candidates") &&
      runbookSource.includes("Resolve unresolved rows manually"),
    "consolidation canonical preflight runbook checklist steps are incomplete"
  );

  console.log("PR-CM06 release gate + runbook hardening smoke checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
