import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

async function main() {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const workflowSetupPageSource = await readFile(
    path.resolve(rootDir, "frontend/src/pages/settings/WorkflowSetupPage.jsx"),
    "utf8"
  );
  const workflowTypeStepSource = await readFile(
    path.resolve(
      rootDir,
      "frontend/src/pages/settings/workflows/components/WorkflowTypeStep.jsx"
    ),
    "utf8"
  );
  const workflowAssignmentStepSource = await readFile(
    path.resolve(
      rootDir,
      "frontend/src/pages/settings/workflows/components/WorkflowAssignmentStep.jsx"
    ),
    "utf8"
  );
  const workflowDefinitionStepSource = await readFile(
    path.resolve(
      rootDir,
      "frontend/src/pages/settings/workflows/components/WorkflowDefinitionStep.jsx"
    ),
    "utf8"
  );
  const workflowStepsBuilderStepSource = await readFile(
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
  const workflowSetupTextSource = await readFile(
    path.resolve(rootDir, "frontend/src/pages/settings/workflows/utils/workflowSetupText.js"),
    "utf8"
  );

  assert(
    workflowTypeStepSource.includes("Continue to Target Scope"),
    "WorkflowTypeStep should advance to target scope next"
  );

  assert(
    workflowAssignmentStepSource.includes("Step 2 - Choose target scope") &&
      workflowAssignmentStepSource.includes("Continue to Definition") &&
      workflowAssignmentStepSource.includes("Scope first"),
    "WorkflowAssignmentStep should represent the second target-scope stage"
  );

  assert(
    workflowDefinitionStepSource.includes("Step 3 - Create or select a workflow") &&
      workflowDefinitionStepSource.includes("Selected target scope"),
    "WorkflowDefinitionStep should move to the third stage and reflect the chosen scope"
  );

  assert(
    workflowStepsBuilderStepSource.includes("Step 4 - Define approval steps") &&
      workflowStepsBuilderStepSource.includes("Current target scope") &&
      workflowStepsBuilderStepSource.includes("Save steps and continue to review"),
    "WorkflowStepsBuilderStep should move to the fourth stage and lead into review"
  );

  assert(
    workflowReviewStepSource.includes("Save assignment") &&
      workflowReviewStepSource.includes("Back to Approval Steps") &&
      workflowReviewStepSource.includes("Ready to save"),
    "WorkflowReviewStep should become the final assignment-save stage"
  );

  assert(
    workflowSetupTextSource.includes('label: l("Target Scope", "Hedef Kapsam")') &&
      workflowSetupTextSource.includes('description: l("Confirm and save", "Dogrula ve kaydet")'),
    "Workflow progress text should expose target scope before definition and review should confirm/save"
  );

  assert(
    workflowSetupPageSource.includes("function continueToDefinitionStep()") &&
      workflowSetupPageSource.includes("setCurrentStep(3);") &&
      workflowSetupPageSource.includes("setCurrentStep(4);") &&
      workflowSetupPageSource.includes(
        'setCurrentStep(5);\n      setMessage(\n        l(\n          "Approval steps saved. Review the setup and save the assignment."'
      ),
    "WorkflowSetupPage should advance scope -> definition -> approval steps -> review in the new order"
  );

  assert(
    workflowSetupPageSource.includes("setAssignmentReviewSaved(true);") &&
      workflowSetupPageSource.includes("onSubmitAssignment={onCreateAssignment}") &&
      workflowSetupPageSource.includes("assignmentSaved={assignmentReviewSaved}") &&
      workflowSetupPageSource.includes("hasTargetScope={currentStep >= 2 && Boolean(assignmentScopeSelection)}"),
    "WorkflowSetupPage should save the assignment from review and refresh sidebar scope state coherently"
  );

  console.log("test-org-wgx12-workflow-step-order passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
