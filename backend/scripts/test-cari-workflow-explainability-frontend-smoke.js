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
  buildApprovalRoutingMatrixValidationModel,
  buildApprovalRoutingRulePreview,
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
  const actionPanelSource = await readFile(
    path.resolve(root, "frontend/src/pages/cari/components/CariDocumentPostReversePanel.jsx"),
    "utf8"
  );
  const detailContentSource = await readFile(
    path.resolve(root, "frontend/src/pages/cari/components/CariDocumentDetailContent.jsx"),
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

  const routingRulePreview = buildApprovalRoutingRulePreview({
    scopeType: "LEGAL_ENTITY",
    scopeSummary: "Entity A",
    minAmount: 50000.01,
    maxAmount: null,
    amountBasis: "BASE_AMOUNT",
    targetLabel: "WF-AP-ENTITY-APPROVE-GROUP-POST",
    l,
  });
  assert(
    routingRulePreview ===
      "AP documents for Entity A above 50,000.01 base amount use WF-AP-ENTITY-APPROVE-GROUP-POST.",
    "AP routing preview should explain the matched scope, amount band, and target workflow in plain language"
  );

  const routingValidationModel = buildApprovalRoutingMatrixValidationModel({
    draft: {
      scopeType: "LEGAL_ENTITY",
      legalEntityId: 9,
      effectiveFrom: "2026-01-01",
      minAmount: "40000",
      maxAmount: "60000",
      amountBasis: "BASE_AMOUNT",
      workflowDefinitionId: 21,
      status: "ACTIVE",
    },
    assignments: [
      {
        id: 1,
        processType: AP_DOCUMENT_WORKFLOW_PROCESS_TYPE,
        status: "ACTIVE",
        scopeType: "LEGAL_ENTITY",
        legalEntityId: 9,
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        minAmount: 0,
        maxAmount: 50000,
        amountBasis: "BASE_AMOUNT",
        isFallback: false,
      },
    ],
    definitions: [{ id: 21, processType: AP_DOCUMENT_WORKFLOW_PROCESS_TYPE }],
    presetEntries: [],
    l,
  });
  assert(
    routingValidationModel?.isValid === false &&
      routingValidationModel?.conflicts?.[0]?.code === "AMOUNT_OVERLAP" &&
      routingValidationModel?.conflicts?.[0]?.message ===
        "Active amount bands cannot overlap at the same scope and effective window.",
    "AP routing validation should block overlapping active amount bands before save"
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
        workflowDefinitionId: 12,
        workflowDefinitionCode: "WF-AP-ENTITY-REVIEW",
        workflowDefinitionName: "Entity Review Route",
        routingRuleSnapshot: {
          scope_type: "LEGAL_ENTITY",
          min_amount: 50000.01,
          max_amount: null,
          workflow_definition_code: "WF-AP-ENTITY-REVIEW",
          workflow_definition_name: "Entity Review Route",
        },
        evaluatedAmount: 78240,
        evaluatedAmountBasis: "BASE_AMOUNT",
        routingMatchType: "BAND",
        routingMatchedScopeLayer: "LEGAL_ENTITY",
        currentStepNo: 1,
        totalSteps: 2,
        currentStageScopeType: "GROUP",
        currentStageScopeLabel: "Group",
        effectiveApprovalPermissionCode: "approvals.requests.approve",
        effectiveApprovalPermissionLabel: "AP approval at Group scope",
        nextActorType: "GROUP",
        nextActionCode: "APPROVE",
        nextActionLabel: "Group approval",
        waitingForSummary: "Waiting for Group approval",
        blockingReasonDetail: "Approval is pending at Group scope",
        workflowInstanceId: 91,
        workflowInstanceStatus: "PENDING",
      },
    },
    l
  );
  assert(
    pendingDetailModel?.headline === "Waiting for Group approval" &&
      pendingDetailModel?.currentStepLabel === "Step 1 of 2" &&
      pendingDetailModel?.factSectionTitle === "Routing context" &&
      pendingDetailModel?.requiredPackageLabel === "AP Documents / Approve" &&
      pendingDetailModel?.requiredScopeType === "GROUP" &&
      pendingDetailModel?.requiredScopeLabel === "Group" &&
      pendingDetailModel?.eligibleActorSummary ===
        "Users assigned AP Documents / Approve at Group scope can approve the current step." &&
      findItemValue(pendingDetailModel?.factItems, "Matched route") ===
        "WF-AP-ENTITY-REVIEW - Entity Review Route" &&
      findItemValue(pendingDetailModel?.factItems, "Route scope") === "Legal Entity" &&
      String(findItemValue(pendingDetailModel?.factItems, "Matched rule")).includes(
        "Legal Entity"
      ) &&
      String(findItemValue(pendingDetailModel?.factItems, "Matched rule")).includes("above") &&
      String(findItemValue(pendingDetailModel?.factItems, "Evaluated amount")).includes(
        "Base amount"
      ) &&
      findItemValue(pendingDetailModel?.factItems, "Amount basis") === "Base amount" &&
      findItemValue(pendingDetailModel?.noteItems, "Current gate") ===
        "Waiting for AP Documents / Approve at Group scope." &&
      findItemValue(pendingDetailModel?.technicalItems, "Required authority") ===
        "AP approval at Group scope" &&
      findItemValue(pendingDetailModel?.technicalItems, "Technical permission") ===
        "approvals.requests.approve" &&
      findItemValue(pendingDetailModel?.technicalItems, "Routing match type") ===
        "Amount band" &&
      findItemValue(pendingDetailModel?.technicalItems, "Matched scope layer") ===
        "Legal Entity",
    "Detail-card explainability should surface the AMX06 routing context, acting scope, and routing metadata"
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
        workflowDefinitionCode: "WF-AP-ENTITY-REVIEW",
        workflowDefinitionName: "Entity Review Route",
        routingRuleSnapshot: {
          scope_type: "LEGAL_ENTITY",
          min_amount: 50000.01,
          max_amount: null,
          workflow_definition_code: "WF-AP-ENTITY-REVIEW",
          workflow_definition_name: "Entity Review Route",
        },
        evaluatedAmount: 78240,
        evaluatedAmountBasis: "BASE_AMOUNT",
        routingMatchType: "BAND",
        currentStepNo: 1,
        totalSteps: 2,
        currentStageScopeType: "GROUP",
        currentStageScopeLabel: "Group",
        effectiveApprovalPermissionCode: "approvals.requests.approve",
        effectiveApprovalPermissionLabel: "AP approval at Group scope",
        nextActorType: "GROUP",
        nextActionCode: "APPROVE",
        nextActionLabel: "Group approval",
        waitingForSummary: "Waiting for Group approval",
        blockingReasonDetail: "Approval is pending at Group scope",
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
    findItemValue(pendingActionModel?.factItems, "Matched route") ===
      "WF-AP-ENTITY-REVIEW - Entity Review Route" &&
      pendingActionModel?.userCapabilityLines.includes(
        "You can view this document but cannot approve it."
      ) &&
      pendingActionModel?.userCapabilityLines.includes(
        "This step requires AP Documents / Approve at Group scope."
      ) &&
      pendingActionModel?.userCapabilityLines.includes(
        "You do not have approval authority for this step."
      ) &&
      pendingActionModel?.userCapabilityLines.includes(
        "You cannot post because approval is still pending."
      ) &&
      pendingActionModel?.historyItems?.[0]?.title === "Step 1" &&
      String(pendingActionModel?.historyItems?.[0]?.summary || "").includes("Approved") &&
      String(pendingActionModel?.historyItems?.[0]?.summary || "").includes("Entity Reviewer") &&
      String(pendingActionModel?.historyItems?.[0]?.summary || "").includes(
        "2026-04-08T09:15:00Z"
      ) &&
      pendingActionModel?.historyItems?.[0]?.note === "Approved after invoice review.",
    "Action-panel explainability should add user-relative access text, routing context, and prior-step history"
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
        waitingForSummary: "Returned for correction - resubmission required",
        blockingReasonDetail: "Update the supplier evidence and resubmit.",
        latestDecisionComment: "Supplier evidence is incomplete.",
      },
    },
    l
  );
  assert(
    String(returnedDetailModel?.headline || "").includes("Returned for correction") &&
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
    actionPanelSource.includes("GovernedRuntimeExplainabilityPanel") &&
      actionPanelSource.includes('title={l("Your workflow access", "Workflow erisiminiz")}') &&
      detailContentSource.includes(
        'title={l("Workflow route + status", "Workflow rota + durum")}'
      ) &&
      runtimeExplainabilityPanelSource.includes("Current step") &&
      runtimeExplainabilityPanelSource.includes("Required package") &&
      runtimeExplainabilityPanelSource.includes("Required scope") &&
      runtimeExplainabilityPanelSource.includes("Routing context") &&
      runtimeExplainabilityPanelSource.includes("Who can act next") &&
      runtimeExplainabilityPanelSource.includes("Your access") &&
      runtimeExplainabilityPanelSource.includes("Prior step history"),
    "Shared runtime panel should centralize the governed-record explainability sections and AMX06 routing context"
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
