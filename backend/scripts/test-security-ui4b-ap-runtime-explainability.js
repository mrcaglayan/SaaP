import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCariWorkflowActionExplainabilityModel,
  buildCariWorkflowDetailCardModel,
} from "../../frontend/src/pages/cari/cariWorkflowExplainability.js";

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
  const explainabilitySource = await readFile(
    path.resolve(root, "frontend/src/pages/cari/cariWorkflowExplainability.js"),
    "utf8"
  );
  const hookSource = await readFile(
    path.resolve(
      root,
      "frontend/src/pages/cari/hooks/useCariDocumentPostReverseController.js"
    ),
    "utf8"
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
        workflowDefinitionCode: "WF-AP-ENTITY-APPROVE",
        workflowDefinitionName: "Entity Approval Route",
        routingRuleSnapshot: {
          scope_type: "LEGAL_ENTITY",
          min_amount: 0,
          max_amount: 50000,
          workflow_definition_code: "WF-AP-ENTITY-APPROVE",
          workflow_definition_name: "Entity Approval Route",
        },
        evaluatedAmount: 42000,
        evaluatedAmountBasis: "BASE_AMOUNT",
        routingMatchType: "BAND",
        routingMatchedScopeLayer: "LEGAL_ENTITY",
        currentStepNo: 1,
        totalSteps: 2,
        currentStageScopeType: "LEGAL_ENTITY",
        currentStageScopeLabel: "Legal Entity",
        effectiveApprovalPermissionCode: "approvals.requests.approve",
        effectiveApprovalPermissionLabel: "AP approval at Legal Entity scope",
        waitingForSummary: "Waiting for Legal Entity approval",
        blockingReasonDetail: "Approval is pending at Legal Entity scope",
        workflowInstanceStatus: "PENDING",
      },
    },
    l
  );
  assert(
    pendingDetailModel?.factSectionTitle === "Routing context" &&
      findItemValue(pendingDetailModel?.factItems, "Matched route") ===
        "WF-AP-ENTITY-APPROVE - Entity Approval Route" &&
      String(findItemValue(pendingDetailModel?.factItems, "Matched rule")).includes(
        "Legal Entity"
      ) &&
      findItemValue(pendingDetailModel?.noteItems, "Current gate") ===
        "Waiting for AP Documents / Approve at Legal Entity scope." &&
      pendingDetailModel?.eligibleRoleLabels?.includes("Entity Accountant") &&
      pendingDetailModel?.eligibleRoleLabels?.includes("Entity Manager") &&
      findItemValue(pendingDetailModel?.technicalItems, "Routing match type") ===
        "Amount band",
    "AP detail explainability should surface the AMX06 route facts and in-scope approval gate"
  );

  const approvedActionModel = buildCariWorkflowActionExplainabilityModel({
    row: {
      status: "APPROVED",
      direction: "AP",
      workflowGate: {
        state: "approved",
        workflowGoverned: true,
        assignmentResolved: true,
        assignmentScopeType: "LEGAL_ENTITY",
        assignmentScopeLabel: "Legal Entity",
        workflowDefinitionCode: "WF-AP-ENTITY-POST",
        workflowDefinitionName: "Entity Post Route",
        routingRuleSnapshot: {
          scope_type: "LEGAL_ENTITY",
          is_fallback: true,
          workflow_definition_code: "WF-AP-ENTITY-POST",
          workflow_definition_name: "Entity Post Route",
        },
        evaluatedAmount: 120000,
        evaluatedAmountBasis: "BASE_AMOUNT",
        routingUsedFallback: true,
        routingMatchType: "FALLBACK",
        currentStageScopeType: "LEGAL_ENTITY",
        currentStageScopeLabel: "Legal Entity",
        waitingForSummary: "Ready for Legal Entity posting",
        workflowInstanceStatus: "APPROVED",
      },
    },
    workflowInstance: null,
    canReadSelected: true,
    canSubmitSelected: false,
    canApproveSelected: false,
    canApproveWorkflow: false,
    canPostSelected: false,
    l,
  });
  assert(
    findItemValue(approvedActionModel?.factItems, "Matched route") ===
      "WF-AP-ENTITY-POST - Entity Post Route" &&
      findItemValue(approvedActionModel?.factItems, "Matched rule") ===
        "Legal Entity fallback route" &&
      findItemValue(approvedActionModel?.noteItems, "Current gate") ===
        "Waiting for AP Documents / Post at Legal Entity scope." &&
      findItemValue(approvedActionModel?.noteItems, "Fallback route used") ===
        "No amount band matched in the selected scope, so the fallback route was used." &&
      approvedActionModel?.userCapabilityLines?.includes(
        "You can view this document but cannot post it."
      ) &&
      approvedActionModel?.userCapabilityLines?.includes(
        "Posting requires AP Documents / Post at Legal Entity scope."
      ) &&
      approvedActionModel?.eligibleRoleLabels?.includes("Entity CEO"),
    "AP action explainability should explain fallback-post routing and why a read-only user cannot post"
  );

  assert(
    actionPanelSource.includes("ActionButtonWithTooltip") &&
      actionPanelSource.includes("approvalActionDisabledReason") &&
      actionPanelSource.includes("submitActionDisabledReason") &&
      actionPanelSource.includes("postActionDisabledReason") &&
      actionPanelSource.includes("showApprovalActionsSection") &&
      actionPanelSource.includes("showSubmitActionsSection") &&
      actionPanelSource.includes('title={l("Your workflow access", "Workflow erisiminiz")}'),
    "AP action panel should keep disabled action sections visible with tooltip-backed disabled reasons and the AMX06 access title"
  );
  assert(
    explainabilitySource.includes("Matched route") &&
      explainabilitySource.includes("Matched rule") &&
      explainabilitySource.includes("Fallback route used") &&
      explainabilitySource.includes("You can view this document but cannot approve it.") &&
      explainabilitySource.includes("You can view this document but cannot post it.") &&
      hookSource.includes(
        "You can view this document but cannot submit it because `cari.doc.submit` is missing."
      ),
    "AP runtime explainability sources should keep route facts and user-relative disabled-state messaging"
  );

  console.log("Security UI-4B AP runtime explainability smoke passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
