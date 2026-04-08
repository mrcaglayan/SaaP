import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listWorkflowPackageCatalogEntries } from "../../frontend/src/pages/security/roleCatalog.js";
import { buildWorkflowStepValidationModel } from "../../frontend/src/pages/settings/workflows/utils/workflowSetupHelpers.js";

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
  const approvalStepCardSource = await readFile(
    path.resolve(
      rootDir,
      "frontend/src/pages/settings/workflows/components/ApprovalStepCard.jsx"
    ),
    "utf8"
  );

  const workflowPackageEntries = listWorkflowPackageCatalogEntries();
  const stepScopeLabels = {
    OPERATING_UNIT: "Operating Unit",
    LEGAL_ENTITY: "Legal Entity",
    COUNTRY: "Country",
    GROUP: "Group",
  };

  const missingPackageValidation = buildWorkflowStepValidationModel({
    stepDrafts: [
      {
        stepNo: 1,
        stageScopeType: "LEGAL_ENTITY",
        requiredPackageCode: "",
        allowSelfApprove: false,
      },
    ],
    processType: "LOCAL_CLOSE_PACK",
    workflowPackageEntries,
    stepScopeLabels,
    l,
  });

  assert.equal(
    missingPackageValidation.hasBlockingIssues,
    true,
    "UI-3C should block save when a workflow step has no package selected"
  );
  assert.equal(
    missingPackageValidation.steps[0].blockingIssues[0].code,
    "no_package_selected",
    "UI-3C should label the missing package rule explicitly"
  );

  const invalidScopeValidation = buildWorkflowStepValidationModel({
    stepDrafts: [
      {
        stepNo: 1,
        stageScopeType: "GROUP",
        requiredPackageCode: "PKG-LC-PREPARE",
        requiredPackageLabel: "Local Close Pack / Prepare & Submit",
        allowSelfApprove: false,
      },
    ],
    processType: "LOCAL_CLOSE_PACK",
    workflowPackageEntries,
    stepScopeLabels,
    l,
  });

  assert.equal(
    invalidScopeValidation.steps[0].blockingIssues.some(
      (issue) => issue.code === "package_scope_mismatch"
    ),
    true,
    "UI-3C should warn when the selected package does not support the selected scope"
  );

  const selfApproveAndCoverageValidation = buildWorkflowStepValidationModel({
    stepDrafts: [
      {
        stepNo: 1,
        stageScopeType: "LEGAL_ENTITY",
        requiredPackageCode: "PKG-PC-CLOSE",
        requiredPackageLabel: "Period Close / Approve & Close",
        allowSelfApprove: true,
      },
    ],
    processType: "PERIOD_CLOSE",
    workflowPackageEntries,
    coverageDiagnostics: {
      checks: {
        approvers: [
          {
            stepNo: 1,
            status: "NO_COVERAGE",
            uncoveredScopeCount: 1,
          },
        ],
      },
    },
    stepScopeLabels,
    l,
  });

  assert.equal(
    selfApproveAndCoverageValidation.hasBlockingIssues,
    false,
    "UI-3C should keep self-approve and coverage gaps as advisory warnings, not hard blockers"
  );
  assert.equal(
    selfApproveAndCoverageValidation.steps[0].warningIssues.some(
      (issue) => issue.code === "self_approve_enabled"
    ),
    true,
    "UI-3C should warn when self-approval is enabled"
  );
  assert.equal(
    selfApproveAndCoverageValidation.steps[0].warningIssues.some(
      (issue) => issue.code === "no_eligible_users"
    ),
    true,
    "UI-3C should warn when no in-scope users currently match the step package"
  );

  const apExtensionValidation = buildWorkflowStepValidationModel({
    stepDrafts: [
      {
        stepNo: 1,
        stageScopeType: "GROUP",
        requiredPackageCode: "PKG-AP-POST-GROUP",
        requiredPackageLabel: "AP Documents / Group Post",
        allowSelfApprove: false,
      },
    ],
    processType: "AP_DOCUMENT_POSTING",
    workflowPackageEntries,
    stepScopeLabels,
    l,
  });

  assert.equal(
    apExtensionValidation.steps[0].blockingIssues.some(
      (issue) => issue.code === "ap_group_post_extension_not_enabled"
    ),
    true,
    "UI-3C should block group-scoped AP post until the extension-backed package is enabled"
  );

  const periodCloseExtensionValidation = buildWorkflowStepValidationModel({
    stepDrafts: [
      {
        stepNo: 1,
        stageScopeType: "GROUP",
        requiredPackageCode: "PKG-PC-CLOSE",
        requiredPackageLabel: "Period Close / Approve & Close",
        allowSelfApprove: false,
      },
    ],
    processType: "PERIOD_CLOSE",
    workflowPackageEntries,
    stepScopeLabels,
    l,
  });

  assert.equal(
    periodCloseExtensionValidation.steps[0].blockingIssues.some(
      (issue) => issue.code === "period_close_group_extension_not_ready"
    ),
    true,
    "UI-3C should block unsupported group period-close steps before save"
  );

  assert(
    workflowSetupPageSource.includes("buildWorkflowStepValidationModel") &&
      workflowSetupPageSource.includes("workflowStepValidation") &&
      workflowSetupPageSource.includes("currentStep < 4"),
    "WorkflowSetupPage should compute step validation and reuse coverage diagnostics before the review step"
  );

  assert(
    workflowStepsBuilderSource.includes("workflowStepValidation") &&
      workflowStepsBuilderSource.includes("Fix the blocking step issues before saving.") &&
      workflowStepsBuilderSource.includes("Checking in-scope actors"),
    "WorkflowStepsBuilderStep should surface the new validation summary and inline coverage-check status"
  );

  assert(
    approvalStepCardSource.includes('l("Blocking issue", "Engelleyici sorun")') &&
      approvalStepCardSource.includes('l("Warning", "Uyari")') &&
      approvalStepCardSource.includes('l("blocker", "engel")'),
    "ApprovalStepCard should render inline blocker and warning states per workflow step"
  );

  console.log("test-security-ui3c-step-validation-inline-warnings passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
