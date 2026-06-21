import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertIncludes(source, needle, message) {
  assert(source.includes(needle), message || `Expected source to include: ${needle}`);
}

function assertNotIncludes(source, needle, message) {
  assert(!source.includes(needle), message || `Expected source to omit: ${needle}`);
}

function assertIncludesAll(source, needles, context) {
  for (const needle of needles) {
    assertIncludes(source, needle, `${context}: missing ${needle}`);
  }
}

async function readRootFile(root, relativePath) {
  return readFile(path.resolve(root, relativePath), "utf8");
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

  const packageJson = JSON.parse(await readRootFile(root, "backend/package.json"));
  assert(
    packageJson.scripts?.["test:consolidation:ready-start:ux"] ===
      "node scripts/test-consolidation-ready-to-start-ux-polish.js",
    "backend/package.json must expose test:consolidation:ready-start:ux",
  );

  const cockpitSource = await readRootFile(
    root,
    "frontend/src/pages/CloseCockpitPage.jsx",
  );
  const monitorSource = await readRootFile(
    root,
    "frontend/src/pages/GroupCloseMonitorPage.jsx",
  );
  const summarySource = await readRootFile(
    root,
    "frontend/src/components/close/ConsolidationReadinessSummary.jsx",
  );
  const stepperSource = await readRootFile(
    root,
    "frontend/src/components/close/ConsolidationReadinessStepper.jsx",
  );
  const factsSource = await readRootFile(
    root,
    "frontend/src/components/close/ConsolidationReadinessFacts.jsx",
  );
  const blockersSource = await readRootFile(
    root,
    "frontend/src/components/close/ConsolidationReadinessBlockers.jsx",
  );
  const utilsSource = await readRootFile(
    root,
    "frontend/src/components/close/consolidationReadinessUtils.js",
  );
  const frontendReadinessSource = [
    monitorSource,
    summarySource,
    stepperSource,
    factsSource,
    blockersSource,
    utilsSource,
  ].join("\n");

  assertIncludesAll(
    summarySource,
    [
      "ConsolidationReadinessSummaryCard",
      "Consolidation Readiness",
      "getConsolidationReadinessDescription",
      "getConsolidationReadinessNextActionCopy",
      "getOwnerHint",
      "ConsolidationReadinessFacts",
      "ConsolidationReadinessStepper",
    ],
    "summary card",
  );
  assertIncludes(
    monitorSource,
    "consolidationReadiness && consolidationReadiness.applicable !== false",
    "Group monitor must avoid showing group readiness for non-applicable/entity scoped cycles",
  );

  assertIncludesAll(
    utilsSource,
    [
      "Waiting for entity close",
      "Ready to start",
      "Consolidation in progress",
      "Ready for final review",
      "Locked",
    ],
    "professional readiness status labels",
  );
  assertIncludes(
    utilsSource,
    'case "READY_TO_FINALIZE":\n      return l("Ready for final review"',
    "READY_TO_FINALIZE must display as Ready for final review",
  );
  assertIncludes(
    summarySource,
    "getConsolidationReadinessLabel(readiness.status, l)",
    "Summary card must render mapped readiness labels instead of raw backend enum values",
  );
  assertNotIncludes(
    frontendReadinessSource,
    'l("Ready to finalize"',
    "UI copy must not expose Ready to finalize as the primary READY_TO_FINALIZE label",
  );
  assertNotIncludes(
    utilsSource,
    "return status ||",
    "Readiness label helper must not fall back to raw enum labels",
  );

  assertIncludesAll(
    stepperSource,
    [
      "Consolidation readiness journey",
      "Entity close packs",
      "Ready to start",
      "Consolidation in progress",
      "Ready for final review",
      "Locked",
      'aria-current={stepState === "current" ? "step" : undefined}',
      "Current consolidation readiness step",
    ],
    "journey stepper",
  );

  assertIncludesAll(
    summarySource,
    [
      "ConsolidationReadinessWhyPanel",
      "Why this status?",
      "getConsolidationReadinessWhyLines",
    ],
    "why-this-status panel",
  );
  assertIncludesAll(
    utilsSource,
    [
      "All mandatory entity close packs are locked and up to date.",
      "Open the blocking items below to resolve them.",
      "Operational checks are clear. Final workflow approval",
    ],
    "why-this-status explanations",
  );

  assertIncludesAll(
    blockersSource,
    [
      "Blocking reasons",
      "No blocking reasons. All good.",
      "If something blocks consolidation, it will appear here with direct links.",
      "No direct link is available for this blocker.",
      "buildReadinessBlockerItems",
      "groupReadinessBlockerItems",
    ],
    "blocking reason drill-down",
  );
  assertIncludesAll(
    utilsSource,
    [
      "Missing local close pack",
      "Not locked",
      "Stale",
      "Operational blocker",
      "Workflow approval",
      "Open local close pack",
      "Review stale changes",
      "Complete workflow approval",
    ],
    "blocking reason grouping and actions",
  );

  assertIncludesAll(
    utilsSource,
    [
      "This will create the official consolidation run for this group and period.",
      "You can view readiness status, but you do not have permission to start the official consolidation run.",
      "Review consolidation entries, adjustments, eliminations, and report checks.",
      "You can view cockpit readiness status, but opening the run requires consolidation.run.read.",
      "You can view cockpit readiness status, but opening final review requires consolidation.run.read.",
      "Ready to start - waiting for",
      "getOwnerHint(readiness, l)",
    ],
    "role-aware CTA helper text",
  );
  assertIncludes(
    utilsSource,
    "readiness?.canStart && canCreateConsolidationRun",
    "Start CTA must require backend canStart and local consolidation.run.create permission",
  );
  assertIncludes(
    utilsSource,
    "readiness?.canOpenRun && canReadConsolidationRun",
    "Open-run CTA must require backend canOpenRun and local consolidation.run.read permission",
  );
  assertIncludes(
    cockpitSource,
    "if (runId && canOpenStartedRun)",
    "Auto-navigation after start must remain gated by canOpenRun/read permission",
  );

  assertIncludesAll(
    factsSource + utilsSource,
    [
      "Key facts",
      "Local close packs",
      "Stale packs",
      "Official run",
      "Operational blockers",
      "Workflow approval",
      "Owner",
      "getMissingFactValue",
    ],
    "facts section",
  );

  assertIncludesAll(
    frontendReadinessSource,
    [
      "min-w-0",
      "overflow-hidden",
      "break-words",
      "w-full",
      "sm:w-auto",
      "sm:grid-cols-2",
      "xl:grid-cols-5",
      "aria-describedby",
      "aria-labelledby",
      "sr-only",
    ],
    "mobile and accessibility wrappers",
  );

  const consolidationRouteSource = await readRootFile(
    root,
    "backend/src/routes/consolidation.js",
  );
  assertNotIncludes(
    consolidationRouteSource,
    "getConsolidationReadyToStartStatus",
    "This UX polish must not add a consolidation readiness route or duplicate backend readiness engine",
  );
  assertNotIncludes(
    consolidationRouteSource,
    "consolidationReadiness",
    "Consolidation readiness must remain surfaced through the close cockpit payload",
  );
  assertNotIncludes(
    consolidationRouteSource,
    "ready-to-start",
    "This PR must not introduce a new ready-to-start API route",
  );

  const readinessServiceSource = await readRootFile(
    root,
    "backend/src/services/consolidation.ready-to-start.service.js",
  );
  assertIncludesAll(
    readinessServiceSource,
    [
      'const STATUS_WAITING_FOR_ENTITY_CLOSE = "WAITING_FOR_ENTITY_CLOSE"',
      'const STATUS_READY_TO_START = "READY_TO_START"',
      'const STATUS_IN_PROGRESS = "IN_PROGRESS"',
      'const STATUS_READY_TO_FINALIZE = "READY_TO_FINALIZE"',
      'const STATUS_LOCKED = "LOCKED"',
      "buildNoRunStatusPayload",
      "buildRunExistsPayload",
      "getConsolidationRunReviewGate",
      "blockingReasons.length === 0",
      "operationalReadyToFinalize",
      "applicable: false",
      "NOT_CONSOLIDATION_GROUP_CYCLE",
    ],
    "backend readiness semantics guard",
  );

  console.log(
    "Consolidation ready-to-start UX polish checks passed (summary, labels, stepper, blockers, CTAs, mobile/accessibility, backend guardrails).",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
