import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function readFirstExisting(filePaths) {
  for (const filePath of filePaths) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const source = await readFile(filePath, "utf8");
      return { source, filePath };
    } catch (error) {
      if (error?.code === "ENOENT") {
        // Try the next candidate path.
        // eslint-disable-next-line no-continue
        continue;
      }
      throw error;
    }
  }
  throw new Error(
    `None of the expected documentation files were found: ${filePaths.join(", ")}`
  );
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

  const packageJson = JSON.parse(
    await readFile(path.resolve(root, "backend/package.json"), "utf8")
  );
  const scripts = packageJson?.scripts || {};

  assert(
    scripts["rollout:prf13-pilot"] === "node scripts/pilot-rollout-prf13.js",
    "backend/package.json missing rollout:prf13-pilot script"
  );
  assert(
    scripts["test:followup:prf13-rollout"] ===
      "node scripts/test-followup-prf13-rollout-backfill-release-gate.js",
    "backend/package.json missing test:followup:prf13-rollout script"
  );

  const releaseGateExpansionSource = await readFile(
    path.resolve(root, "backend/scripts/test-followup-prf13-release-gate-expansion.js"),
    "utf8"
  );
  assert(
    releaseGateExpansionSource.includes(
      "test-followup-prf13-rollout-backfill-release-gate.js"
    ),
    "PR-F13 release-gate expansion must include rollout/backfill/release-gate smoke script"
  );

  const pilotRolloutSource = await readFile(
    path.resolve(root, "backend/scripts/pilot-rollout-prf13.js"),
    "utf8"
  );
  for (const requiredToken of [
    "FEATURE_SUBACCOUNTS_V1",
    "FEATURE_SETUP_WIZARD_V2",
    "FEATURE_CONSOLIDATION_CANONICAL_MAPPING_V1",
    "FEATURE_WORKFLOW_CLOSE_CONSOLIDATION_V1",
    "FEATURE_TAX_ENGINE_V1",
    "PHASE_CONFIG",
    "--apply",
    "Dry-run only",
  ]) {
    assert(
      pilotRolloutSource.includes(requiredToken),
      `pilot-rollout-prf13.js missing required token: ${requiredToken}`
    );
  }

  const runbookDoc = await readFirstExisting([
    path.resolve(root, "11-PR-F13-ROLLOUT-RUNBOOK.md"),
    path.resolve(root, "PR-STEPS/11-PR-F13-ROLLOUT-RUNBOOK.md"),
  ]);
  const runbookSource = runbookDoc.source;
  for (const requiredToken of [
    "Pilot Feature Rollout Automation",
    "rollout:prf13-pilot",
    "test:followup:prf13-release-gate",
  ]) {
    assert(
      runbookSource.includes(requiredToken),
      `${runbookDoc.filePath} missing required rollout token: ${requiredToken}`
    );
  }

  const gaPlanDoc = await readFirstExisting([
    path.resolve(root, "12-PR-F13-PILOT-GA-SWITCH-PLAN.md"),
    path.resolve(root, "PR-STEPS/12-PR-F13-PILOT-GA-SWITCH-PLAN.md"),
  ]);
  const gaPlanSource = gaPlanDoc.source;
  for (const requiredToken of [
    "Pilot Tenant Matrix",
    "Close + Consolidation + Tax E2E Validation",
    "GA Switch Decision",
    "rollout:prf13-pilot",
  ]) {
    assert(
      gaPlanSource.includes(requiredToken),
      `${gaPlanDoc.filePath} missing required token: ${requiredToken}`
    );
  }

  console.log("PR-F13 rollout/backfill/release-gate smoke checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
