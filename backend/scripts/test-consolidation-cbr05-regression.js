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

  const packageJsonSource = await readFile(
    path.resolve(root, "backend/package.json"),
    "utf8"
  );
  assert(
    packageJsonSource.includes('"test:ux:consolidation-cbr01"') &&
      packageJsonSource.includes('"test:ux:consolidation-cbr02"') &&
      packageJsonSource.includes('"test:ux:consolidation-cbr03"') &&
      packageJsonSource.includes('"test:ux:consolidation-cbr04"') &&
      packageJsonSource.includes('"test:ux:consolidation-cbr05"'),
    "backend/package.json must expose CBR01-CBR05 regression scripts"
  );

  const runbookSource = await readFile(
    path.resolve(root, "docs/runbooks/consolidation-canonical-preflight.md"),
    "utf8"
  );
  assert(
    runbookSource.includes("Bulk Rule Mapping Guidance") &&
      runbookSource.includes("Saved Rule Operations") &&
      runbookSource.includes("Rollout Notes"),
    "consolidation canonical preflight runbook must include bulk-rule guidance and rollout notes"
  );
  assert(
    runbookSource.includes("120.* -> AR_TRADE") &&
      runbookSource.includes("descendants of `320` -> `AP_TRADE`") &&
      runbookSource.includes("savedRuleMatches"),
    "consolidation canonical preflight runbook must include the required bulk-rule examples and governance notes"
  );

  const trackerSource = await readFile(
    path.resolve(root, "PR-STEPS/24-CANONICAL-BULK-RULE-MAPPING.md"),
    "utf8"
  );
  assert(
    trackerSource.includes("test-consolidation-cbr05-regression.js"),
    "PR-STEPS tracker must reference the CBR05 regression script"
  );

  console.log("CBR05 bulk canonical regression smoke checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
