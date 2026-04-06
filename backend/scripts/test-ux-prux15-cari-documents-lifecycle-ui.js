import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readCariDocumentsFeatureSource } from "./_cariDocumentsFeatureSource.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const lifecycleRulesPath = path.resolve(
    root,
    "frontend/src/lifecycle/lifecycleRules.js"
  );
  const workflowSetupPath = path.resolve(
    root,
    "frontend/src/pages/settings/WorkflowSetupPage.jsx"
  );
  const lifecycleModule = await import(pathToFileURL(lifecycleRulesPath).href);
  const documentsSource = await readCariDocumentsFeatureSource(root);
  const workflowSetupSource = await readFile(workflowSetupPath, "utf8");

  const { getLifecycleStatusMeta, getLifecycleAllowedActions, buildLifecycleTimelineSteps } =
    lifecycleModule;

  const postedMeta = getLifecycleStatusMeta("cariDocument", "posted");
  assert(
    postedMeta?.code === "POSTED",
    "cariDocument lifecycle should resolve POSTED status metadata"
  );
  const submittedMeta = getLifecycleStatusMeta("cariDocument", "SUBMITTED");
  assert(
    submittedMeta?.code === "SUBMITTED",
    "cariDocument lifecycle should resolve SUBMITTED status metadata"
  );
  const returnedMeta = getLifecycleStatusMeta("cariDocument", "RETURNED");
  assert(
    returnedMeta?.code === "RETURNED",
    "cariDocument lifecycle should resolve RETURNED status metadata"
  );
  const approvedMeta = getLifecycleStatusMeta("cariDocument", "APPROVED");
  assert(
    approvedMeta?.code === "APPROVED",
    "cariDocument lifecycle should resolve APPROVED status metadata"
  );

  const draftActions = getLifecycleAllowedActions("cariDocument", "DRAFT");
  const draftActionSet = new Set((draftActions || []).map((row) => row.action));
  assert(
    draftActionSet.has("submit") &&
      draftActionSet.has("post") &&
      draftActionSet.has("cancel"),
    "cariDocument DRAFT should expose submit/post/cancel lifecycle transitions"
  );

  const returnedActions = getLifecycleAllowedActions("cariDocument", "RETURNED");
  const returnedActionSet = new Set((returnedActions || []).map((row) => row.action));
  assert(
    returnedActionSet.has("submit") && returnedActionSet.has("cancel"),
    "cariDocument RETURNED should expose submit/cancel lifecycle transitions"
  );

  const timeline = buildLifecycleTimelineSteps("cariDocument", "POSTED", [
    { statusCode: "DRAFT", at: "2026-01-01T09:00:00.000Z" },
    { statusCode: "POSTED", at: "2026-01-02T11:00:00.000Z" },
  ]);
  const postedStep = timeline.find((row) => row.statusCode === "POSTED");
  assert(
    postedStep?.state === "current" && postedStep?.eventAt,
    "cariDocument lifecycle timeline should mark POSTED as current with event metadata"
  );

  assert(
    documentsSource.includes("import StatusTimeline from") &&
      documentsSource.includes("StatusTimeline"),
    "CARI documents feature should import and render StatusTimeline"
  );
  assert(
    documentsSource.includes("buildLifecycleTimelineSteps") &&
      documentsSource.includes("getLifecycleAllowedActions") &&
      documentsSource.includes("getLifecycleStatusMeta"),
    "CariDocumentsPage should use shared lifecycle rules helpers"
  );
  assert(
    documentsSource.includes("buildDocumentLifecycleEvents"),
    "CariDocumentsPage should map document timestamps into lifecycle events"
  );
  assert(
    documentsSource.includes("Lifecycle Snapshot") &&
      documentsSource.includes("Document Lifecycle Timeline"),
    "CariDocumentsPage should render lifecycle snapshot and timeline sections"
  );
  assert(
    documentsSource.includes("Returned for correction") &&
      documentsSource.includes("returnReason") &&
      documentsSource.includes("returnedAt"),
    "CARI documents detail should surface returned-for-correction messaging and reason fields"
  );
  assert(
    documentsSource.includes("Workflow gate") &&
      documentsSource.includes("Correction Actions") &&
      documentsSource.includes("Legal Entity"),
    "CARI documents workbench should surface workflow gate, correction copy, and legal-entity context"
  );
  assert(
    documentsSource.includes("FEATURE_AP_DOCUMENT_WORKFLOW_V1") &&
      documentsSource.includes("canSubmitSelected"),
    "CARI documents submit UI should stay gated by the workflow feature flag"
  );
  assert(
    workflowSetupSource.includes("Use the visual builder for normal workflow setup") &&
      workflowSetupSource.includes("Add step") &&
      workflowSetupSource.includes("Advanced JSON"),
    "Workflow setup should expose the visual step builder alongside advanced JSON"
  );
  assert(
    workflowSetupSource.includes("STEP_SCOPE_TYPES") &&
      workflowSetupSource.includes("Must stay empty for AP") &&
      workflowSetupSource.includes("COUNTRY"),
    "Workflow setup should keep country-scoped AP step defaults visible without manual JSON-only editing"
  );

  console.log(
    "PR-UX15 smoke test passed (Cari Documents lifecycle/workbench UI and workflow setup builder remain wired)."
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
