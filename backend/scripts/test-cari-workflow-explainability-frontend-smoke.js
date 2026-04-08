import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCariWorkflowActionExplainabilityModel,
  buildCariWorkflowDetailCardModel,
  buildCariWorkflowListSummaryModel,
} from "../../frontend/src/pages/cari/cariWorkflowExplainability.js";
import {
  buildApBusinessPreview,
  buildWorkflowCoverageReviewModel,
} from "../../frontend/src/pages/settings/workflows/utils/workflowSetupHelpers.js";
import { AP_DOCUMENT_WORKFLOW_PROCESS_TYPE } from "../../shared/cariDocumentWorkflowGovernance.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function l(en) {
  return en;
}

function findItemValue(items, label) {
  return (
    (Array.isArray(items) ? items : []).find((item) => item?.label === label)?.value || ""
  );
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const panelSource = await readFile(
    path.resolve(root, "frontend/src/pages/cari/components/CariDocumentPostReversePanel.jsx"),
    "utf8"
  );
  const runtimeExplainabilityPanelSource = await readFile(
    path.resolve(
      root,
      "frontend/src/components/workflows/GovernedRuntimeExplainabilityPanel.jsx"
    ),
    "utf8"
  );
  const setupPageSource = await readFile(
    path.resolve(root, "frontend/src/pages/settings/WorkflowSetupPage.jsx"),
    "utf8"
  );
  const reviewStepSource = await readFile(
    path.resolve(
      root,
      "frontend/src/pages/settings/workflows/components/WorkflowReviewStep.jsx"
    ),
    "utf8"
  );

  const apPreviewLines = buildApBusinessPreview(
    [
      { stepNo: 1, stageScopeType: "LEGAL_ENTITY", minApproverCount: 1 },
      { stepNo: 2, stageScopeType: "COUNTRY", minApproverCount: 1 },
    ],
    {
      LEGAL_ENTITY: "Legal Entity",
      COUNTRY: "Country",
    },
    l
  );
  assert(
    apPreviewLines[0] ===
      "Branch accountants with submit authority can submit this AP document." &&
      apPreviewLines.includes("Step 1: One Legal Entity AP reviewer must approve.") &&
      apPreviewLines.includes("Step 2: One Country AP reviewer must approve.") &&
      apPreviewLines.includes(
        "After approval, Country posting authority can post the document."
      ),
    "AP setup preview should keep the business-language submit -> approve -> post flow wording"
  );

  const pendingDetailModel = buildCariWorkflowDetailCardModel(
    {
      status: "SUBMITTED",
      direction: "AP",
      workflowGate: {
        state: "pending",
        workflowGoverned: true,
        assignmentResolved: true,
        assignmentScopeType: "LEGAL_ENTITY",
        assignmentScopeLabel: "Legal Entity",
        currentStepNo: 1,
        totalSteps: 2,
        currentStageScopeType: "LEGAL_ENTITY",
        currentStageScopeLabel: "Legal Entity",
        effectiveApprovalPermissionCode: "approvals.requests.approve",
        effectiveApprovalPermissionLabel: "AP approval at Legal Entity scope",
        nextActorType: "COUNTRY",
        nextActionCode: "APPROVE",
        nextActionLabel: "Country approval",
        waitingForSummary: "Waiting for Legal Entity approval",
        blockingReasonDetail: "Approval is pending at Legal Entity scope",
        workflowInstanceId: 91,
      },
    },
    l
  );
  assert(
    pendingDetailModel?.headline === "Waiting for Legal Entity approval" &&
      findItemValue(pendingDetailModel?.factItems, "Current step") === "Step 1 of 2" &&
      pendingDetailModel?.currentStepLabel === "Step 1 of 2" &&
      pendingDetailModel?.requiredPackageLabel === "AP Documents / Approve" &&
      pendingDetailModel?.requiredScopeType === "LEGAL_ENTITY" &&
      pendingDetailModel?.requiredScopeLabel === "Legal Entity" &&
      pendingDetailModel?.eligibleActorSummary ===
        "Users assigned AP Documents / Approve at Legal Entity scope can approve the current step." &&
      pendingDetailModel?.eligibleRoleLabels?.includes("Entity Accountant") &&
      pendingDetailModel?.eligibleRoleLabels?.includes("Entity Manager") &&
      findItemValue(pendingDetailModel?.noteItems, "Current gate") ===
        "Waiting for AP Documents / Approve at LEGAL_ENTITY scope." &&
      findItemValue(pendingDetailModel?.factItems, "Active scope") === "Legal Entity" &&
      findItemValue(pendingDetailModel?.factItems, "Next action") === "Country approval" &&
      findItemValue(pendingDetailModel?.technicalItems, "Required authority") ===
        "AP approval at Legal Entity scope" &&
      findItemValue(pendingDetailModel?.technicalItems, "Technical permission") ===
        "approvals.requests.approve",
    "Detail-card explainability should describe pending legal-entity approval with business and technical context"
  );

  const pendingActionModel = buildCariWorkflowActionExplainabilityModel({
    row: {
      status: "SUBMITTED",
      direction: "AP",
      workflowGate: {
        state: "pending",
        workflowGoverned: true,
        assignmentResolved: true,
        assignmentScopeType: "LEGAL_ENTITY",
        assignmentScopeLabel: "Legal Entity",
        currentStepNo: 1,
        totalSteps: 2,
        currentStageScopeType: "LEGAL_ENTITY",
        currentStageScopeLabel: "Legal Entity",
        effectiveApprovalPermissionCode: "approvals.requests.approve",
        effectiveApprovalPermissionLabel: "AP approval at Legal Entity scope",
        nextActorType: "COUNTRY",
        nextActionCode: "APPROVE",
        nextActionLabel: "Country approval",
        waitingForSummary: "Waiting for Legal Entity approval",
        blockingReasonDetail: "Approval is pending at Legal Entity scope",
        workflowInstanceId: 91,
        workflowInstanceStatus: "PENDING",
      },
    },
    workflowInstance: {
      id: 91,
      decisions: [
        {
          id: 7,
          stepNo: 1,
          decision: "APPROVE",
          decisionByUserName: "Entity Reviewer",
          decisionNote: "Approved after invoice review.",
          createdAt: "2026-04-08T09:15:00Z",
        },
      ],
    },
    canReadSelected: true,
    canSubmitSelected: false,
    canApproveSelected: false,
    canApproveWorkflow: false,
    canPostSelected: false,
    l,
  });
  assert(
    pendingActionModel?.userCapabilityLines.includes(
      "You do not have approval authority for this step."
    ) &&
      pendingActionModel?.userCapabilityLines.includes(
        "You cannot post because approval is still pending."
      ) &&
      pendingActionModel?.historyItems?.[0]?.title === "Step 1" &&
      pendingActionModel?.historyItems?.[0]?.summary ===
        "Approved • by Entity Reviewer • 2026-04-08T09:15:00Z" &&
      pendingActionModel?.historyItems?.[0]?.note === "Approved after invoice review.",
    "Action-panel explainability should add user-relative access text and prior-step history"
  );

  const approvedListModel = buildCariWorkflowListSummaryModel(
    {
      status: "APPROVED",
      direction: "AP",
      workflowGate: {
        state: "approved",
        workflowGoverned: true,
        assignmentResolved: true,
        currentStepNo: 1,
        totalSteps: 1,
        currentStageScopeType: "COUNTRY",
        currentStageScopeLabel: "Country",
        nextActionCode: "POST",
        nextActionLabel: "Country posting",
        waitingForSummary: "Ready for Country posting",
      },
    },
    l
  );
  assert(
    approvedListModel?.headline === "Ready for Country posting" &&
      String(approvedListModel?.detail || "").includes("Step 1 of 1") &&
      String(approvedListModel?.detail || "").includes("Country") &&
      String(approvedListModel?.detail || "").includes("Next: Country posting"),
    "List explainability should keep the ready-to-post queue summary wording"
  );

  const returnedDetailModel = buildCariWorkflowDetailCardModel(
    {
      status: "RETURNED",
      direction: "AP",
      returnReason: "Supplier evidence is incomplete.",
      workflowGate: {
        state: "returned",
        workflowGoverned: true,
        assignmentResolved: true,
        waitingForSummary: "Returned for correction — resubmission required",
        blockingReasonDetail: "Update the supplier evidence and resubmit.",
        latestDecisionComment: "Supplier evidence is incomplete.",
      },
    },
    l
  );
  assert(
    returnedDetailModel?.headline === "Returned for correction — resubmission required" &&
      returnedDetailModel?.supportingText === "Update the supplier evidence and resubmit." &&
      findItemValue(returnedDetailModel?.noteItems, "Return reason") ===
        "Supplier evidence is incomplete.",
    "Detail explainability should preserve returned-for-correction and resubmit wording"
  );

  const coverageReviewModel = buildWorkflowCoverageReviewModel({
    diagnostics: {
      effectiveOn: "2026-04-07",
      checks: {
        submitter: {
          actorType: "SUBMITTER",
          scopeType: "OPERATING_UNIT",
          status: "COVERED",
          targetScopeCount: 2,
          coveredScopeCount: 2,
          uncoveredScopeCount: 0,
          matchedUserCount: 3,
        },
        approvers: [
          {
            actorType: "APPROVER",
            stepNo: 1,
            scopeType: "LEGAL_ENTITY",
            status: "NO_COVERAGE",
            targetScopeCount: 1,
            coveredScopeCount: 0,
            uncoveredScopeCount: 1,
            matchedUserCount: 0,
            permissionCode: "approvals.requests.approve",
            uncoveredScopes: [{ scopeType: "LEGAL_ENTITY", scopeId: 9 }],
          },
        ],
        poster: {
          actorType: "POSTER",
          scopeType: "COUNTRY",
          status: "COVERED",
          targetScopeCount: 1,
          coveredScopeCount: 1,
          uncoveredScopeCount: 0,
          matchedUserCount: 2,
        },
      },
      warnings: [
        {
          code: "APPROVER_GAP",
          actorType: "APPROVER",
          stepNo: 1,
          scopeType: "LEGAL_ENTITY",
          status: "NO_COVERAGE",
          targetScopeCount: 1,
          uncoveredScopeCount: 1,
          minRequiredActors: 1,
          permissionCode: "approvals.requests.approve",
          uncoveredScopes: [{ scopeType: "LEGAL_ENTITY", scopeId: 9 }],
        },
      ],
    },
    workflowType: AP_DOCUMENT_WORKFLOW_PROCESS_TYPE,
    lookups: {
      legalEntities: [{ id: 9, code: "NIST", name: "Nistanc" }],
    },
    tenantScopeId: 3,
    l,
  });
  assert(
    coverageReviewModel?.checkedOnLabel === "Coverage checked for 2026-04-07" &&
      coverageReviewModel.warningCards?.[0]?.title === "Step 1 Legal Entity approvers" &&
      coverageReviewModel.warningCards?.[0]?.description ===
        "This workflow uses Legal Entity approval, but no in-scope users currently hold AP approval authority." &&
      coverageReviewModel.warningCards?.[0]?.technicalHint ===
        "Technical permission: approvals.requests.approve",
    "Workflow review diagnostics should keep the AP approval coverage warning wording"
  );

  assert(
    panelSource.includes("GovernedRuntimeExplainabilityPanel") &&
      runtimeExplainabilityPanelSource.includes("Current step") &&
      runtimeExplainabilityPanelSource.includes("Required package") &&
      runtimeExplainabilityPanelSource.includes("Required scope") &&
      runtimeExplainabilityPanelSource.includes("Who can act next") &&
      runtimeExplainabilityPanelSource.includes("Your access") &&
      runtimeExplainabilityPanelSource.includes("Prior step history"),
    "Shared runtime panel should centralize the governed-record explainability sections"
  );
  assert(
    setupPageSource.includes("runWorkflowCoverageDiagnostics") &&
      setupPageSource.includes("coverageDiagnostics") &&
      reviewStepSource.includes("buildWorkflowCoverageReviewModel"),
    "Workflow setup review wiring should keep diagnostics connected to the review-step explainability model"
  );

  console.log("CARI workflow explainability frontend smoke passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
