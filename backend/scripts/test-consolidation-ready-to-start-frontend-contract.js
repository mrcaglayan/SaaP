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
  assert(
    cockpitSource.includes("getCockpitBreadcrumbItems") &&
      cockpitSource.includes("Group Close Cockpit") &&
      cockpitSource.includes("Period Close") &&
      cockpitSource.includes('params.set("from", "close-cockpit")') &&
      cockpitSource.includes('params.set("cycleId", String(toPositiveInt(cycleId)))') &&
      cockpitSource.includes("fromCloseCockpit: true"),
    "Close cockpit must show breadcrumb context and preserve cockpit return params on run links",
  );
  assert(
    cockpitSource.includes("RecentActivityPanel") &&
      cockpitSource.includes("buildRecentActivityItems") &&
      cockpitSource.includes("firstTriggeredAt") &&
      cockpitSource.includes("latestEvent?.createdAt") &&
      cockpitSource.includes("Recent Activity") &&
      cockpitSource.includes("Recent activity is not available yet."),
    "Close cockpit must render recent activity from existing timestamped alert/stale payloads with an empty state",
  );

  const monitorSource = await readFile(
    path.resolve(root, "frontend/src/pages/GroupCloseMonitorPage.jsx"),
    "utf8",
  );
  const readinessUtilsSource = await readFile(
    path.resolve(root, "frontend/src/components/close/consolidationReadinessUtils.js"),
    "utf8",
  );
  const readinessSummarySource = await readFile(
    path.resolve(root, "frontend/src/components/close/ConsolidationReadinessSummary.jsx"),
    "utf8",
  );
  const readinessStepperSource = await readFile(
    path.resolve(root, "frontend/src/components/close/ConsolidationReadinessStepper.jsx"),
    "utf8",
  );
  const readinessFactsSource = await readFile(
    path.resolve(root, "frontend/src/components/close/ConsolidationReadinessFacts.jsx"),
    "utf8",
  );
  const readinessBlockersSource = await readFile(
    path.resolve(root, "frontend/src/components/close/ConsolidationReadinessBlockers.jsx"),
    "utf8",
  );
  const readinessComponentSource = [
    readinessUtilsSource,
    readinessSummarySource,
    readinessStepperSource,
    readinessFactsSource,
    readinessBlockersSource,
  ].join("\n");
  for (const label of [
    "Waiting for entity close",
    "Ready to start",
    "Consolidation in progress",
    "Ready for final review",
    "Locked",
    "Start official consolidation run",
    "Ready to start - waiting for",
    "Open consolidation run",
    "Open finalization review",
    "Consolidation locked",
  ]) {
    assert(
      readinessComponentSource.includes(label),
      `Close readiness components must render readiness label/action: ${label}`,
    );
  }
  assert(
    readinessUtilsSource.includes("readiness?.canStart && canCreateConsolidationRun") &&
      readinessUtilsSource.includes("readiness?.canOpenRun && canReadConsolidationRun"),
    "Close readiness CTA helpers must use backend readiness booleans and local defensive permission props",
  );
  assert(
    readinessSummarySource.includes("Owner") &&
      readinessUtilsSource.includes("getReadyToStartWaitingCopy") &&
      readinessUtilsSource.includes("getOwnerHint(readiness, l)") &&
      readinessUtilsSource.includes("Group reporting controller / consolidation preparer"),
    "Close readiness components must show and reuse the readiness owner hint",
  );
  assert(
    monitorSource.includes("../components/close/ConsolidationReadinessSummary.jsx") &&
      monitorSource.includes("<ConsolidationReadinessSection") &&
      monitorSource.includes("<ConsolidationRunReadinessStrip") &&
      readinessSummarySource.includes("export function ConsolidationReadinessSection") &&
      readinessSummarySource.includes("export function ConsolidationRunReadinessStrip") &&
      readinessStepperSource.includes("export default function ConsolidationReadinessStepper") &&
      readinessFactsSource.includes("export default function ConsolidationReadinessFacts") &&
      readinessBlockersSource.includes("export default function ConsolidationReadinessBlockers"),
    "Group monitor must keep consolidation readiness UX in extracted close components",
  );

  const reportsSource = await readFile(
    path.resolve(root, "frontend/src/pages/ConsolidationReportsPage.jsx"),
    "utf8",
  );
  assert(
    reportsSource.includes('searchParams.get("from")') &&
      reportsSource.includes('"close-cockpit"') &&
      reportsSource.includes("closeCockpitBackPath") &&
      reportsSource.includes("Back to Group Close Cockpit"),
    "Consolidation reports page must expose a cockpit return link when opened from close cockpit",
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
