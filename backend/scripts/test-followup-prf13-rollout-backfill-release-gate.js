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

  const runbookSource = await readFile(
    path.resolve(root, "11-PR-F13-ROLLOUT-RUNBOOK.md"),
    "utf8"
  );
  for (const requiredToken of [
    "Pilot Feature Rollout Automation",
    "rollout:prf13-pilot",
    "test:followup:prf13-release-gate",
  ]) {
    assert(
      runbookSource.includes(requiredToken),
      `11-PR-F13-ROLLOUT-RUNBOOK.md missing required rollout token: ${requiredToken}`
    );
  }

  const gaPlanSource = await readFile(
    path.resolve(root, "12-PR-F13-PILOT-GA-SWITCH-PLAN.md"),
    "utf8"
  );
  for (const requiredToken of [
    "Pilot Tenant Matrix",
    "Close + Consolidation + Tax E2E Validation",
    "GA Switch Decision",
    "rollout:prf13-pilot",
  ]) {
    assert(
      gaPlanSource.includes(requiredToken),
      `12-PR-F13-PILOT-GA-SWITCH-PLAN.md missing required token: ${requiredToken}`
    );
  }

  console.log("PR-F13 rollout/backfill/release-gate smoke checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
