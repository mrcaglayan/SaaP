import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildWorkflowExplainabilityPreviewModel,
} from "../../frontend/src/pages/settings/workflows/utils/workflowSetupHelpers.js";
import { getApWorkflowRequiredPermissionCode } from "../../shared/cariDocumentWorkflowGovernance.js";

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
        requiredPermissionCode: "ouclose.submit",
        requiredAuthorityLabel: "Prepare Local Close",
        minApproverCount: 1,
        allowSelfApprove: false,
        escalationAfterHours: "",
      },
      {
        stepNo: 2,
        actionLabel: "Approve & Lock",
        stageScopeType: "LEGAL_ENTITY",
        requiredPermissionCode: "ouclose.lock",
        requiredAuthorityLabel: "Approve and lock Local Close",
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
      "Step 1: Prepare Local Close at Legal Entity scope - usually In-scope authority holders"
    ),
    true,
    "UI-3D should explain the authority, scope, and in-scope audience for local-close stages"
  );

  const apPreview = buildWorkflowExplainabilityPreviewModel({
    processType: "AP_DOCUMENT_POSTING",
    stepDrafts: [
      {
        stepNo: 1,
        actionCode: "APPROVE",
        actionLabel: "Approve",
        stageScopeType: "LEGAL_ENTITY",
        requiredPermissionCode: getApWorkflowRequiredPermissionCode("APPROVE"),
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
    1,
    "UI-3D should preview only the explicit AP steps saved in the current builder model"
  );
  assert.equal(
    apPreview.entries[0].lineText.includes(
      "Step 1: approvals.requests.approve at Legal Entity scope - usually In-scope AP approvers"
    ),
    true,
    "UI-3D should explain the explicit AP permission and scope in business language"
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
