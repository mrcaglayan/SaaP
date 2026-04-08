import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildWorkflowExplainabilityPreviewModel,
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
  const workflowSidebarSource = await readFile(
    path.resolve(
      rootDir,
      "frontend/src/pages/settings/workflows/components/WorkflowSetupSidebar.jsx"
    ),
    "utf8"
  );
  const explainabilityPanelSource = await readFile(
    path.resolve(
      rootDir,
      "frontend/src/pages/settings/workflows/components/WorkflowExplainabilityPreviewPanel.jsx"
    ),
    "utf8"
  );

  const stepScopeLabels = {
    OPERATING_UNIT: "Operating Unit",
    LEGAL_ENTITY: "Legal Entity",
    COUNTRY: "Country",
    GROUP: "Group",
  };

  const localClosePreview = buildWorkflowExplainabilityPreviewModel({
    processType: "LOCAL_CLOSE_PACK",
    stepDrafts: [
      {
        stepNo: 1,
        actionLabel: "Prepare & Submit",
        stageScopeType: "LEGAL_ENTITY",
        requiredPackageCode: "PKG-LC-PREPARE",
        requiredPackageLabel: "Local Close Pack / Prepare & Submit",
        eligibleBusinessRoleLabels: ["Entity Accountant"],
        minApproverCount: 1,
        allowSelfApprove: false,
        escalationAfterHours: "",
      },
      {
        stepNo: 2,
        actionLabel: "Approve & Lock",
        stageScopeType: "LEGAL_ENTITY",
        requiredPackageCode: "PKG-LC-APPROVE-LOCK",
        requiredPackageLabel: "Local Close Pack / Approve & Lock",
        eligibleBusinessRoleLabels: ["Entity CEO"],
        minApproverCount: 1,
        allowSelfApprove: false,
        escalationAfterHours: "",
      },
    ],
    stepScopeLabels,
    l,
  });

  assert.equal(
    localClosePreview.entryCount,
    2,
    "UI-3D should preview each configured non-AP workflow step as an explainable business stage"
  );
  assert.equal(
    localClosePreview.entries[0].lineText.includes(
      "Step 1: Local Close Pack / Prepare & Submit at Legal Entity scope - usually Entity Accountant"
    ),
    true,
    "UI-3D should explain the package, scope, and typical actor for local-close stages"
  );

  const apPreview = buildWorkflowExplainabilityPreviewModel({
    processType: "AP_DOCUMENT_POSTING",
    stepDrafts: [
      {
        stepNo: 1,
        actionLabel: "Approve",
        stageScopeType: "LEGAL_ENTITY",
        requiredPackageCode: "PKG-AP-APPROVE",
        requiredPackageLabel: "AP Documents / Approve",
        eligibleBusinessRoleLabels: ["Entity Accountant"],
        minApproverCount: 1,
        allowSelfApprove: false,
        escalationAfterHours: "",
      },
    ],
    stepScopeLabels,
    l,
  });

  assert.equal(
    apPreview.entryCount,
    3,
    "UI-3D should keep AP submit and post stages visible even though the current backend bridge stores approval rows only"
  );
  assert.equal(
    apPreview.entries[0].lineText.includes(
      "Step 1: AP Documents / Draft & Submit at Operating Unit scope - usually Branch Accountant"
    ),
    true,
    "UI-3D should prepend the implicit AP submit stage in business language"
  );
  assert.equal(
    apPreview.entries[2].lineText.includes(
      "Step 3: AP Documents / Post at Legal Entity scope - usually Entity posting authority"
    ),
    true,
    "UI-3D should append the implicit AP posting stage in business language"
  );
  assert.equal(
    apPreview.notes.length > 0,
    true,
    "UI-3D should explain the current AP backend bridge limitation in the preview model"
  );

  assert(
    workflowSetupPageSource.includes("buildWorkflowExplainabilityPreviewModel") &&
      workflowSetupPageSource.includes("workflowExplainabilityPreview") &&
      workflowSetupPageSource.includes("workflowExplainabilityPreview={workflowExplainabilityPreview}"),
    "WorkflowSetupPage should build one shared explainability preview model and pass it into the workflow setup surfaces"
  );

  assert(
    workflowStepsBuilderSource.includes("WorkflowExplainabilityPreviewPanel") &&
      workflowStepsBuilderSource.includes('l("Explainability preview", "Aciklanabilirlik onizlemesi")'),
    "WorkflowStepsBuilderStep should render the new explainability preview panel while editing steps"
  );

  assert(
    workflowReviewStepSource.includes("WorkflowExplainabilityPreviewPanel") &&
      workflowReviewStepSource.includes("workflowExplainabilityPreview"),
    "WorkflowReviewStep should keep the explainability preview visible during final review"
  );

  assert(
    workflowSidebarSource.includes("WorkflowExplainabilityPreviewPanel") &&
      workflowSidebarSource.includes("maxEntries={3}"),
    "WorkflowSetupSidebar should surface a compact live explainability preview"
  );

  assert(
    explainabilityPanelSource.includes("detailBadges") &&
      explainabilityPanelSource.includes("summaryText") &&
      explainabilityPanelSource.includes("maxEntries"),
    "WorkflowExplainabilityPreviewPanel should render shared stage lines, badges, and compact truncation"
  );

  console.log("test-security-ui3d-explainability-preview-panel passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
