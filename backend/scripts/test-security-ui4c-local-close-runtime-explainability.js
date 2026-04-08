import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildLocalCloseActionDisabledReason,
  buildLocalCloseRuntimeExplainabilityModel,
} from "../../frontend/src/pages/localCloseRuntimeExplainability.js";

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
  const detailSource = await readFile(
    path.resolve(root, "frontend/src/pages/LocalClosePackDetailPage.jsx"),
    "utf8"
  );

  const reviewGate = {
    currentStatus: "READY_FOR_REVIEW",
    blockerCount: 1,
    warningCount: 0,
    workflowGate: {
      required: true,
      approved: false,
      workflowInstanceStatus: "PENDING",
      workflowInstanceId: 77,
      message: "Workflow approval is still pending for this local close pack",
    },
    actionAvailability: {
      submit: {
        allowed: false,
        blockedByCodes: [],
      },
      return: {
        allowed: true,
        blockedByCodes: [],
      },
      approve: {
        allowed: false,
        blockedByCodes: ["APPROVAL_REQUIRED"],
      },
      lock: {
        allowed: false,
        blockedByCodes: [],
      },
    },
    blockers: [
      {
        code: "APPROVAL_REQUIRED",
        message: "Workflow approval is still pending for this local close pack",
        appliesToActions: ["approve"],
      },
    ],
    warnings: [],
  };

  const model = buildLocalCloseRuntimeExplainabilityModel({
    pack: {
      id: 18,
      status: "READY_FOR_REVIEW",
      closeScopeType: "OPERATING_UNIT",
      operatingUnitCode: "OU-101",
      operatingUnitName: "Ankara Branch",
    },
    reviewGate,
    auditRows: [
      {
        auditLogId: 501,
        action: "ouclose.return",
        actorName: "Entity Manager",
        createdAt: "2026-04-08T09:35:00Z",
        payload: {
          decisionNote: "Need one more report review.",
        },
      },
      {
        auditLogId: 500,
        action: "ouclose.submit",
        actorName: "Entity Accountant",
        createdAt: "2026-04-08T09:20:00Z",
        payload: {},
      },
    ],
    canRead: true,
    canPrepare: false,
    canSubmit: false,
    canReview: true,
    canApprove: true,
    canLock: false,
    l,
  });

  assert(
    model?.requiredPackageLabel === "Local Close Pack / Review" &&
      model?.requiredScopeLabel === "Legal Entity" &&
      model?.badgeLabel === "Workflow approval pending",
    "Local close explainability should expose the current review package and scope"
  );
  assert(
    model?.noteItems?.some(
      (item) =>
        item.label === "Pack content scope" && item.value === "OU-101 - Ankara Branch"
    ),
    "Local close explainability should keep the pack content scope visible beside the governance scope"
  );
  assert(
    model?.userCapabilityLines?.includes("You can return this pack for correction.") &&
      model?.userCapabilityLines?.some((line) =>
        line.includes("Workflow approval is still pending for this local close pack")
      ),
    "Local close explainability should distinguish review authority from blocked approval authority"
  );
  assert(
    model?.historyItems?.[0]?.title === "Returned" &&
      model?.historyItems?.[0]?.summary ===
        "Returned | by Entity Manager | 2026-04-08T09:35:00Z",
    "Local close explainability should reuse pack audit history for prior step context"
  );

  const approveDisabledReason = buildLocalCloseActionDisabledReason({
    actionKey: "approve",
    reviewGate,
    l,
  });
  assert(
    approveDisabledReason === "Workflow approval is still pending for this local close pack",
    "Approve disabled reason should surface the exact workflow gate blocker"
  );

  assert(
    detailSource.includes("GovernedRuntimeExplainabilityPanel") &&
      detailSource.includes("buildLocalCloseRuntimeExplainabilityModel") &&
      detailSource.includes("visibleActionDisabledReasons") &&
      detailSource.includes("Close-stage explainability"),
    "Local close detail page should mount the shared explainability panel and blocked-action guidance"
  );

  console.log("Security UI-4C local close runtime explainability smoke passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

