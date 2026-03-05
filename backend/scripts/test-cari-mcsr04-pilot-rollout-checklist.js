import { readFile } from "node:fs/promises";
import path from "node:path";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function readUtf8(relativePathFromBackend) {
  const absolutePath = path.resolve(process.cwd(), relativePathFromBackend);
  return readFile(absolutePath, "utf8");
}

async function main() {
  const trackerSource = await readUtf8(
    "../PR-STEPS/18-CARI-MULTI-CURRENCY-SETTLEMENTS-ROLLOUT-UAT.md"
  );
  const releaseGateScriptSource = await readUtf8("scripts/test-cari-mcsr-release-gate.js");

  const requiredTrackerTokens = [
    "PR-MCSR04",
    "Pilot rollout + rollback runbook",
    "Pilot wave plan",
    "Rollback path",
    "go/no-go criteria",
    "evidence",
  ];
  for (const token of requiredTrackerTokens) {
    assert(
      trackerSource.includes(token),
      `Rollout tracker must include token: ${token}`
    );
  }

  assert(
    trackerSource.includes("Rollout Checklist (Operational)"),
    "Rollout tracker must include operational checklist"
  );

  assert(
    releaseGateScriptSource.includes("test-cari-mcsr01-uat-matrix.js") &&
      releaseGateScriptSource.includes("test-cari-mcsr02-reconcile-gate.js") &&
      releaseGateScriptSource.includes("test-cari-mcsr03-error-playbook-smoke.js"),
    "MCSR release-gate must include previous track scripts"
  );

  console.log("CARI MCSR04 pilot rollout checklist smoke test passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
