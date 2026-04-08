import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPeriodCloseRunDisabledReason,
  buildPeriodCloseRuntimeExplainabilityModel,
} from "../../frontend/src/pages/periodCloseRuntimeExplainability.js";

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
    path.resolve(root, "frontend/src/pages/JournalWorkbenchPage.jsx"),
    "utf8"
  );

  const disabledReason = buildPeriodCloseRunDisabledReason({
    canClosePeriod: true,
    bookId: "44",
    fiscalPeriodId: "",
    saving: "",
    l,
  });
  assert(
    disabledReason === "select a book and fiscal period first",
    "Period-close disabled reason should explain why the main close button is inactive"
  );

  const model = buildPeriodCloseRuntimeExplainabilityModel({
    selectedBookLabel: "STAT - Stat Book",
    selectedPeriodLabel: "FY2026 P03 - March",
    requestedCloseStatus: "SOFT_CLOSED",
    latestRun: {
      id: 18,
      status: "IN_PROGRESS",
      closeStatus: "SOFT_CLOSED",
      startedAt: "2026-04-08T09:20:00Z",
      note: "Initial close attempt",
    },
    periodCloseRuns: [
      {
        id: 18,
        status: "IN_PROGRESS",
        closeStatus: "SOFT_CLOSED",
        startedAt: "2026-04-08T09:20:00Z",
        note: "Initial close attempt",
      },
      {
        id: 17,
        status: "REOPENED",
        closeStatus: "SOFT_CLOSED",
        reopenedAt: "2026-04-07T15:10:00Z",
        note: "Reopened for correction",
      },
    ],
    workflowGateBlock: {
      code: "APPROVAL_REQUIRED",
      message: "Workflow approval is required before period close can complete",
      details: {
        instance: {
          id: 91,
          status: "PENDING",
        },
      },
      requestId: "req-4d",
    },
    fxGateBlock: null,
    canClosePeriod: true,
    canReadTrialBalance: true,
    canReadJournals: true,
    canOverrideCashFxRevaluation: false,
    closeButtonDisabledReason: "",
    l,
  });

  assert(
    model?.requiredPackageLabel === "Period Close / Approve & Close" &&
      model?.requiredScopeLabel === "Legal Entity" &&
      model?.badgeLabel === "Close approval pending",
    "Period-close explainability should expose close package and legal-entity scope"
  );
  assert(
    model?.eligibleRoleLabels?.includes("Entity Manager") &&
      model?.eligibleRoleLabels?.includes("Entity CEO"),
    "Period-close explainability should name the legal-entity roles that can close"
  );
  assert(
    model?.userCapabilityLines?.includes(
      "You have close authority, but workflow approval is still pending for this period close run."
    ),
    "Period-close explainability should distinguish close authority from a pending workflow gate"
  );
  assert(
    model?.historyItems?.[0]?.summary ===
      "Run #18 | IN_PROGRESS | Soft close | 2026-04-08T09:20:00Z",
    "Period-close explainability should summarize recent run history in business-readable form"
  );

  assert(
    pageSource.includes("GovernedRuntimeExplainabilityPanel") &&
      pageSource.includes("buildPeriodCloseRuntimeExplainabilityModel") &&
      pageSource.includes("periodCloseRunDisabledReason") &&
      pageSource.includes("Period-close explainability"),
    "Journal workbench should mount the shared explainability panel and explicit disabled close-button reasons"
  );

  console.log("Security UI-4D period close runtime explainability smoke passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

