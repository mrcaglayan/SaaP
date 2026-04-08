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

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const sharedPanelSource = await readFile(
    path.resolve(
      root,
      "frontend/src/components/workflows/GovernedRuntimeExplainabilityPanel.jsx"
    ),
    "utf8"
  );
  const detailSource = await readFile(
    path.resolve(root, "frontend/src/pages/cari/components/CariDocumentDetailContent.jsx"),
    "utf8"
  );
  const actionPanelSource = await readFile(
    path.resolve(root, "frontend/src/pages/cari/components/CariDocumentPostReversePanel.jsx"),
    "utf8"
  );

  const detailModel = buildCariWorkflowDetailCardModel(
    {
      status: "APPROVED",
      direction: "AP",
      workflowGate: {
        state: "approved",
        workflowGoverned: true,
        assignmentResolved: true,
        assignmentScopeType: "LEGAL_ENTITY",
        assignmentScopeLabel: "Legal Entity",
        currentStepNo: 2,
        totalSteps: 2,
        currentStageScopeType: "LEGAL_ENTITY",
        currentStageScopeLabel: "Legal Entity",
        waitingForSummary: "Ready for Legal Entity posting",
        nextActionCode: "POST",
        nextActionLabel: "Legal Entity posting",
        workflowInstanceStatus: "APPROVED",
      },
    },
    l
  );
  assert(
    detailModel?.requiredPackageLabel === "AP Documents / Post" &&
      detailModel?.requiredScopeLabel === "Legal Entity" &&
      detailModel?.currentStepLabel === "Step 2 of 2" &&
      detailModel?.eligibleActorSummary ===
        "Users assigned AP Documents / Post at Legal Entity scope can post the document now.",
    "Shared explainability detail model should expose package, scope, step, and next-actor summary"
  );

  const actionModel = buildCariWorkflowActionExplainabilityModel({
    row: {
      status: "RETURNED",
      direction: "AP",
      workflowGate: {
        state: "returned",
        workflowGoverned: true,
        assignmentResolved: true,
        assignmentScopeType: "LEGAL_ENTITY",
        assignmentScopeLabel: "Legal Entity",
        currentStepNo: 1,
        totalSteps: 2,
        currentStageScopeType: "LEGAL_ENTITY",
        currentStageScopeLabel: "Legal Entity",
        latestDecisionComment: "Supplier evidence is incomplete.",
        blockingReasonDetail: "Update the supplier evidence and resubmit.",
        workflowInstanceStatus: "RETURNED",
      },
    },
    workflowInstance: {
      id: 55,
      decisions: [
        {
          id: 2,
          stepNo: 1,
          decision: "RETURN",
          decisionByUserName: "Entity Reviewer",
          decisionNote: "Supplier evidence is incomplete.",
          createdAt: "2026-04-08T11:05:00Z",
        },
      ],
    },
    canSubmitSelected: true,
    canApproveSelected: false,
    canApproveWorkflow: false,
    canPostSelected: false,
    l,
  });
  assert(
    actionModel?.requiredPackageLabel === "AP Documents / Draft & Submit" &&
      actionModel?.userCapabilityLines?.includes("You can resubmit this document.") &&
      actionModel?.historyItems?.[0]?.summary ===
        "Returned • by Entity Reviewer • 2026-04-08T11:05:00Z",
    "Shared explainability action model should support resubmit guidance and prior-step history"
  );

  assert(
    sharedPanelSource.includes("Current step") &&
      sharedPanelSource.includes("Required package") &&
      sharedPanelSource.includes("Required scope") &&
      sharedPanelSource.includes("Who can act next") &&
      sharedPanelSource.includes("Your access") &&
      sharedPanelSource.includes("Prior step history"),
    "Shared runtime explainability component should render the plan-required explainability sections"
  );
  assert(
    detailSource.includes("GovernedRuntimeExplainabilityPanel") &&
      actionPanelSource.includes("GovernedRuntimeExplainabilityPanel"),
    "Current AP/CARI surfaces should adopt the shared runtime explainability component"
  );

  console.log("Security UI-4A shared explainability component smoke passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
