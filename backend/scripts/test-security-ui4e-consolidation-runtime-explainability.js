import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildConsolidationFinalizeDisabledReason,
  buildConsolidationRuntimeExplainabilityModel,
} from "../../frontend/src/pages/consolidationRuntimeExplainability.js";

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
  const pageSource = await readFile(
    path.resolve(root, "frontend/src/pages/ConsolidationReportsPage.jsx"),
    "utf8",
  );

  const finalizeDisabledReason = buildConsolidationFinalizeDisabledReason({
    selectedRun: {
      id: 31,
      status: "COMPLETED",
    },
    reviewGateLoading: false,
    reviewGateData: {
      canFinalize: false,
      blockers: [
        {
          code: "DRAFT_CONSOLIDATION_ADJUSTMENTS_PRESENT",
          message: "Draft consolidation adjustments remain (2)",
        },
      ],
    },
    canFinalizeRuns: true,
    saving: "",
    l,
  });
  assert(
    finalizeDisabledReason === "Draft consolidation adjustments remain (2)",
    "Consolidation finalize disabled reason should surface the first live review-gate blocker",
  );

  const model = buildConsolidationRuntimeExplainabilityModel({
    selectedRun: {
      id: 31,
      status: "COMPLETED",
      consolidation_group_code: "GRP-AFG",
      consolidation_group_name: "Afghanistan Group",
      fiscal_year: "2026",
      period_no: "03",
      period_name: "March",
    },
    reviewGateData: {
      publishState: "BLOCKED",
      canFinalize: false,
      run: {
        id: 31,
        currentStatus: "COMPLETED",
      },
      counts: {
        entryCount: 144,
        draftAdjustmentCount: 2,
        draftEliminationCount: 1,
        memberReadinessBlockCount: 0,
      },
      workflowGate: {
        required: false,
        approved: false,
        message: "",
      },
      blockers: [
        {
          code: "DRAFT_CONSOLIDATION_ADJUSTMENTS_PRESENT",
          message: "Draft consolidation adjustments remain (2)",
        },
      ],
      warnings: [],
    },
    reviewGateLoading: false,
    reviewGateError: "",
    canCreateRun: true,
    canExecuteRun: false,
    canPostAdjustment: true,
    canPostElimination: false,
    canFinalizeRuns: true,
    finalizeDisabledReason,
    l,
  });

  assert(
    model?.requiredPackageLabel === "Consolidation / Post Adjustments" &&
      model?.requiredScopeLabel === "Group" &&
      model?.badgeLabel === "Draft adjustments pending",
    "Consolidation explainability should expose the current adjustment package and group scope",
  );
  assert(
    model?.eligibleRoleLabels?.includes("Group Approver"),
    "Consolidation explainability should name the group role that can post adjustments",
  );
  assert(
    model?.userCapabilityLines?.includes("You can post draft adjustments for this run now."),
    "Consolidation explainability should tell the current user when they can post draft adjustments",
  );
  assert(
    model?.noteItems?.some(
      (item) =>
        item.label === "Prepare stage" &&
        item.value.includes("Group Checker"),
    ) &&
      model?.noteItems?.some(
        (item) =>
          item.label === "Elimination stage" &&
          item.value === "1 draft eliminations remain and must be posted before finalization.",
      ),
    "Consolidation explainability should keep prepare and elimination stage visibility on the run page",
  );

  assert(
    pageSource.includes("GovernedRuntimeExplainabilityPanel") &&
      pageSource.includes("buildConsolidationRuntimeExplainabilityModel") &&
      pageSource.includes("buildConsolidationFinalizeDisabledReason") &&
      pageSource.includes("ActionButtonWithTooltip") &&
      pageSource.includes("Consolidation explainability"),
    "Consolidation reports page should mount the shared explainability panel and tooltip-backed action buttons",
  );

  console.log("Security UI-4E consolidation runtime explainability smoke passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
