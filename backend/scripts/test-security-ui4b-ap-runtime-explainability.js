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
        currentStepNo: 1,
        totalSteps: 2,
        currentStageScopeType: "LEGAL_ENTITY",
        currentStageScopeLabel: "Legal Entity",
        effectiveApprovalPermissionCode: "approvals.requests.approve",
        effectiveApprovalPermissionLabel: "AP approval at Legal Entity scope",
        waitingForSummary: "Waiting for Legal Entity approval",
        workflowInstanceStatus: "PENDING",
      },
    },
    l
  );
  assert(
    findItemValue(pendingDetailModel?.noteItems, "Current gate") ===
      "Waiting for AP Documents / Approve at LEGAL_ENTITY scope." &&
      pendingDetailModel?.eligibleRoleLabels?.includes("Entity Accountant") &&
      pendingDetailModel?.eligibleRoleLabels?.includes("Entity Manager"),
    "AP detail explainability should surface package+scope wait text and inferred eligible roles for in-scope approval"
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
    findItemValue(approvedActionModel?.noteItems, "Current gate") ===
      "Waiting for AP Documents / Post at LEGAL_ENTITY scope." &&
      approvedActionModel?.userCapabilityLines?.includes(
        "You can view this document but cannot post it."
      ) &&
      approvedActionModel?.userCapabilityLines?.includes(
        "Posting requires AP Documents / Post at LEGAL_ENTITY scope."
      ),
    "AP action explainability should explain the posting gate and why a read-only user cannot post"
  );

  assert(
    actionPanelSource.includes("ActionButtonWithTooltip") &&
      actionPanelSource.includes("approvalActionDisabledReason") &&
      actionPanelSource.includes("submitActionDisabledReason") &&
      actionPanelSource.includes("postActionDisabledReason") &&
      actionPanelSource.includes("showApprovalActionsSection") &&
      actionPanelSource.includes("showSubmitActionsSection"),
    "AP action panel should keep disabled action sections visible with tooltip-backed disabled reasons"
  );
  assert(
    explainabilitySource.includes("You can view this document but cannot approve it.") &&
      explainabilitySource.includes("You can view this document but cannot post it.") &&
      hookSource.includes("You can view this document but cannot submit it because `cari.doc.submit` is missing."),
    "AP action-state hook should keep user-relative explainability for read-only viewers"
  );

  console.log("Security UI-4B AP runtime explainability smoke passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
