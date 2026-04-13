import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getWorkflowPresetCatalogEntry } from "../../frontend/src/pages/security/roleCatalog.js";
import {
  buildWorkflowPresetBaselineStepDrafts,
  buildWorkflowPresetComparisonModel,
} from "../../frontend/src/pages/settings/workflows/utils/workflowSetupHelpers.js";

function l(en) {
  return en;
}

async function main() {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const workflowSetupPageSource = await readFile(
    path.resolve(rootDir, "frontend/src/pages/settings/WorkflowSetupPage.jsx"),
    "utf8"
  );
  const workflowStepsBuilderSource = await readFile(
    path.resolve(
      rootDir,
      "frontend/src/pages/settings/workflows/components/WorkflowStepsBuilderStep.jsx"
    ),
    "utf8"
  );
  const workflowReviewStepSource = await readFile(
    path.resolve(
      rootDir,
      "frontend/src/pages/settings/workflows/components/WorkflowReviewStep.jsx"
    ),
    "utf8"
  );

  const localClosePreset = getWorkflowPresetCatalogEntry("LOCAL_CLOSE_STANDARD");
  const localCloseBaselineDrafts = buildWorkflowPresetBaselineStepDrafts(localClosePreset);
  const localCloseComparison = buildWorkflowPresetComparisonModel({
    presetEntry: localClosePreset,
    stepDrafts: localCloseBaselineDrafts,
    stepScopeLabels: {
      OPERATING_UNIT: "Operating Unit",
      LEGAL_ENTITY: "Legal Entity",
      COUNTRY: "Country",
      GROUP: "Group",
    },
    l,
  });

  assert.deepEqual(
    localCloseBaselineDrafts.map((step) => step.requiredPermissionCode),
    ["ouclose.submit", "ouclose.review", "ouclose.lock"],
    "UI-3A should derive workflow-step permission baselines from local-close preset packages"
  );
  assert.equal(
    localCloseComparison?.matchesBaseline,
    true,
    "Preset comparison should recognize when the current steps still match the selected preset"
  );
  assert.equal(
    localCloseComparison?.canApply,
    true,
    "Shipped non-extension presets should remain clonable into the current workflow step model"
  );

  assert(
    /isApWorkflowProcess\s*\?\s*\[\]\s*:\s*workflowPresetEntries\.filter/s.test(
      workflowSetupPageSource
    ) &&
      workflowStepsBuilderSource.includes(
        "No preset is used. Every AP step saves explicit action, scope, and package binding."
      ) &&
      workflowStepsBuilderSource.includes(
        "AP action-step mode stays explicit. Each row saves exactly which action happens at which scope."
      ),
    "AP workflow setup should keep shipped presets out of the first-pass authoring path"
  );

  assert(
    workflowSetupPageSource.includes("listWorkflowPresetCatalogEntries") &&
      workflowSetupPageSource.includes("selectedWorkflowPresetCode") &&
      workflowSetupPageSource.includes("workflowPresetComparison") &&
      workflowSetupPageSource.includes("function onCloneWorkflowPreset()") &&
      workflowSetupPageSource.includes("const apStepBuilderPresetProps = isApWorkflowProcess") &&
      workflowSetupPageSource.includes("const apReviewPresetProps = isApWorkflowProcess") &&
      workflowSetupPageSource.includes("{...apStepBuilderPresetProps}") &&
      workflowSetupPageSource.includes("{...apReviewPresetProps}") &&
      !workflowSetupPageSource.includes("selectedApTemplate"),
    "WorkflowSetupPage should keep shared preset state for non-AP workflow families while short-circuiting AP preset props at the render boundary"
  );

  assert(
    workflowStepsBuilderSource.includes("Workflow preset") &&
      workflowStepsBuilderSource.includes("Clone preset into this workflow") &&
      workflowStepsBuilderSource.includes("Reset to preset baseline") &&
      workflowStepsBuilderSource.includes("Preset comparison") &&
      !workflowStepsBuilderSource.includes("apTemplates"),
    "WorkflowStepsBuilderStep should expose the UI-3A preset selector, preview, and comparison shell"
  );

  assert(
    workflowReviewStepSource.includes("selectedWorkflowPreset") &&
      workflowReviewStepSource.includes("workflowPresetPreview") &&
      workflowReviewStepSource.includes("Workflow preset"),
    "WorkflowReviewStep should keep the selected preset visible through the final save gate"
  );

  console.log("test-security-ui3a-workflow-preset-selector passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
