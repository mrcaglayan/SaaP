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

  const cockpitSource = await readFile(
    path.resolve(root, "frontend/src/pages/CloseCockpitPage.jsx"),
    "utf8",
  );
  assert(
    cockpitSource.includes("createOfficialConsolidationRun") &&
      cockpitSource.includes("onStartConsolidationRun") &&
      cockpitSource.includes("onOpenConsolidationRun"),
    "Close cockpit must wire the official run create/open handlers",
  );
  assert(
    cockpitSource.includes("consolidationReadiness") &&
      cockpitSource.includes("canCreateConsolidationRun") &&
      cockpitSource.includes("canReadConsolidationRun"),
    "Close cockpit must pass readiness and permission-aware action props to the group monitor",
  );
  assert(
    cockpitSource.includes("consolidation.run.create") &&
      cockpitSource.includes("consolidation.run.read") &&
      cockpitSource.includes("canOpenRun"),
    "Close cockpit must guard start and open actions with the consolidation run permissions",
  );
  assert(
    cockpitSource.includes("Boolean(readiness?.userCanOpen) && canReadConsolidationRunLocal") &&
      cockpitSource.includes("if (runId && canOpenStartedRun)") &&
      cockpitSource.includes("started or already exists") &&
      cockpitSource.includes("A user with consolidation.run.read can open it"),
    "Starting the official run must not auto-navigate unless the user can also read/open it",
  );
  assert(
    cockpitSource.includes("this cockpit only exposes the governed consolidation start action"),
    "Close cockpit copy must no longer describe every cockpit action as read-only",
  );

  const monitorSource = await readFile(
    path.resolve(root, "frontend/src/pages/GroupCloseMonitorPage.jsx"),
    "utf8",
  );
  for (const label of [
    "Waiting for entity close",
    "Ready to start",
    "In progress",
    "Ready to finalize",
    "Locked",
    "Start consolidation run",
    "Ready for consolidation - waiting for consolidation preparer",
    "Open consolidation run",
    "Open finalization review",
    "Consolidation locked",
  ]) {
    assert(
      monitorSource.includes(label),
      `Group monitor must render readiness label/action: ${label}`,
    );
  }
  assert(
    monitorSource.includes("readiness?.canStart && canCreateConsolidationRun") &&
      monitorSource.includes("readiness?.canOpenRun && canReadConsolidationRun"),
    "Group monitor CTAs must use backend readiness booleans and local defensive permission props",
  );
  assert(
    monitorSource.includes("Owner") &&
      monitorSource.includes("Group reporting controller / consolidation preparer"),
    "Group monitor must show the readiness owner hint",
  );

  const consolidationRunsSource = await readFile(
    path.resolve(root, "frontend/src/api/consolidationRuns.js"),
    "utf8",
  );
  assert(
    consolidationRunsSource.includes("createOfficialConsolidationRun") &&
      consolidationRunsSource.includes('runName: "OFFICIAL"') &&
      consolidationRunsSource.includes("/api/v1/consolidation/runs"),
    "Frontend consolidation run helper must create/replay the OFFICIAL run through the existing route",
  );

  const closeCyclesSource = await readFile(
    path.resolve(root, "frontend/src/api/closeCycles.js"),
    "utf8",
  );
  assert(
    closeCyclesSource.includes("consolidationReadiness") &&
      closeCyclesSource.includes("getCloseCycleCockpit"),
    "Close-cycle cockpit API helper must document the consolidationReadiness payload",
  );

  console.log(
    "Consolidation ready-to-start frontend contract checks passed (CTA wiring + permission guards + helper).",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
