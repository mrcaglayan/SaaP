import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  listWorkflowAuthorityDefinitions,
} from "../../frontend/src/pages/security/roleCatalog.js";
import {
  buildWorkflowStepValidationModel,
  listWorkflowStepAuthorityOptions,
} from "../../frontend/src/pages/settings/workflows/utils/workflowSetupHelpers.js";
import { getApWorkflowRequiredPermissionCode } from "../../shared/cariDocumentWorkflowGovernance.js";
import {
  PERIOD_CLOSE_APPROVE_PERMISSION_CODE,
  PERIOD_CLOSE_EXECUTE_PERMISSION_CODE,
  PERIOD_CLOSE_READINESS_PERMISSION_CODE,
} from "../../shared/periodCloseGovernance.js";

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

  const stepScopeLabels = {
    OPERATING_UNIT: "Operating Unit",
    LEGAL_ENTITY: "Legal Entity",
    COUNTRY: "Country",
    GROUP: "Group",
  };
  const periodCloseWorkflowAuthorities = listWorkflowStepAuthorityOptions({
    processType: "PERIOD_CLOSE",
    workflowAuthorityEntries: listWorkflowAuthorityDefinitions("PERIOD_CLOSE"),
  });
  const consolidationWorkflowAuthorities = listWorkflowStepAuthorityOptions({
    processType: "CONSOLIDATION_RUN",
    workflowAuthorityEntries: listWorkflowAuthorityDefinitions("CONSOLIDATION_RUN"),
  });

  const missingAuthorityValidation = buildWorkflowStepValidationModel({
    stepDrafts: [
      {
        stepNo: 1,
        stageScopeType: "LEGAL_ENTITY",
        requiredPermissionCode: "",
        allowSelfApprove: false,
      },
    ],
    processType: "LOCAL_CLOSE_PACK",
    workflowAuthorityEntries: listWorkflowAuthorityDefinitions("LOCAL_CLOSE_PACK"),
    stepScopeLabels,
    l,
  });

  assert.equal(
    missingAuthorityValidation.hasBlockingIssues,
    true,
    "UI-3C should block save when a workflow step has no authority selected"
  );
  assert.equal(
    missingAuthorityValidation.steps[0].blockingIssues[0].code,
    "no_authority_selected",
    "UI-3C should label the missing authority rule explicitly"
  );

  const invalidScopeValidation = buildWorkflowStepValidationModel({
    stepDrafts: [
      {
        stepNo: 1,
        stageScopeType: "GROUP",
        requiredPermissionCode: "ouclose.prepare",
        requiredAuthorityLabel: "Prepare Local Close",
        allowSelfApprove: false,
      },
    ],
    processType: "LOCAL_CLOSE_PACK",
    workflowAuthorityEntries: listWorkflowAuthorityDefinitions("LOCAL_CLOSE_PACK"),
    stepScopeLabels,
    l,
  });

  assert.equal(
    invalidScopeValidation.steps[0].blockingIssues.some(
      (issue) => issue.code === "authority_scope_mismatch"
    ),
    true,
    "UI-3C should warn when the selected authority does not support the selected scope"
  );

  const selfApproveAndCoverageValidation = buildWorkflowStepValidationModel({
    stepDrafts: [
      {
        stepNo: 1,
        stageScopeType: "LEGAL_ENTITY",
        requiredPermissionCode: PERIOD_CLOSE_APPROVE_PERMISSION_CODE,
        requiredAuthorityLabel: "Approve period close",
        allowSelfApprove: true,
      },
    ],
    processType: "PERIOD_CLOSE",
    workflowAuthorityEntries: listWorkflowAuthorityDefinitions("PERIOD_CLOSE"),
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
    "UI-3C should warn when no in-scope users currently match the step authority"
  );

  const apSubmitCoverageValidation = buildWorkflowStepValidationModel({
    stepDrafts: [
      {
        stepNo: 1,
        actionCode: "SUBMIT",
        stageScopeType: "LEGAL_ENTITY",
        requiredPermissionCode: getApWorkflowRequiredPermissionCode("SUBMIT"),
        allowSelfApprove: false,
      },
    ],
    processType: "AP_DOCUMENT_POSTING",
    workflowAuthorityEntries: listWorkflowAuthorityDefinitions("AP_DOCUMENT_POSTING"),
    coverageDiagnostics: {
      checks: {
        steps: [
          {
            stepNo: 1,
            actionCode: "SUBMIT",
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
    apSubmitCoverageValidation.steps[0].warningIssues.some(
      (issue) => issue.code === "no_eligible_users"
    ),
    true,
    "UI-3C should keep AP submit coverage gaps visible instead of limiting warnings to APPROVE only"
  );

  const periodCloseGroupApprovalValidation = buildWorkflowStepValidationModel({
    stepDrafts: [
      {
        stepNo: 1,
        stageScopeType: "GROUP",
        requiredPermissionCode: PERIOD_CLOSE_APPROVE_PERMISSION_CODE,
        requiredAuthorityLabel: "Approve period close",
        allowSelfApprove: false,
      },
    ],
    processType: "PERIOD_CLOSE",
    workflowAuthorityEntries: listWorkflowAuthorityDefinitions("PERIOD_CLOSE"),
    stepScopeLabels,
    l,
  });

  assert.equal(
    periodCloseGroupApprovalValidation.steps[0].blockingIssues.some(
      (issue) => issue.code === "authority_scope_mismatch"
    ),
    false,
    "UI-3C should allow GROUP period-close approval steps in the split governance model"
  );
  assert.deepEqual(
    periodCloseWorkflowAuthorities.map((entry) => entry.primaryPermissionCode),
    [
      PERIOD_CLOSE_READINESS_PERMISSION_CODE,
      PERIOD_CLOSE_APPROVE_PERMISSION_CODE,
    ],
    "UI-3C should expose only readiness and approval authorities for PERIOD_CLOSE step editing"
  );

  const consolidationPrepareEntry = consolidationWorkflowAuthorities.find(
    (entry) => entry.code === "CONSOLIDATION_PREPARE"
  );
  assert.deepEqual(
    consolidationPrepareEntry?.allowedStepScopes,
    ["OPERATING_UNIT", "LEGAL_ENTITY", "GROUP"],
    "UI-3C should surface the consolidation prepare authority scopes from the shared authority contract"
  );

  const consolidationLegalEntityValidation = buildWorkflowStepValidationModel({
    stepDrafts: [
      {
        stepNo: 1,
        stageScopeType: "LEGAL_ENTITY",
        requiredPermissionCode: "consolidation.run.create",
        requiredAuthorityLabel: "Prepare Consolidation runs",
        requiredAuthorityCode: "CONSOLIDATION_PREPARE",
        allowSelfApprove: false,
      },
    ],
    processType: "CONSOLIDATION_RUN",
    workflowAuthorityEntries: listWorkflowAuthorityDefinitions("CONSOLIDATION_RUN"),
    stepScopeLabels,
    l,
  });
  assert.equal(
    consolidationLegalEntityValidation.steps[0].blockingIssues.some(
      (issue) => issue.code === "authority_scope_mismatch"
    ),
    false,
    "UI-3C should allow Legal Entity consolidation preparation steps when the selected authority supports them"
  );

  const consolidationCountryValidation = buildWorkflowStepValidationModel({
    stepDrafts: [
      {
        stepNo: 1,
        stageScopeType: "COUNTRY",
        requiredPermissionCode: "consolidation.run.create",
        requiredAuthorityLabel: "Prepare Consolidation runs",
        requiredAuthorityCode: "CONSOLIDATION_PREPARE",
        allowSelfApprove: false,
      },
    ],
    processType: "CONSOLIDATION_RUN",
    workflowAuthorityEntries: listWorkflowAuthorityDefinitions("CONSOLIDATION_RUN"),
    stepScopeLabels,
    l,
  });
  assert.equal(
    consolidationCountryValidation.steps[0].blockingIssues.some(
      (issue) => issue.code === "authority_scope_mismatch"
    ),
    true,
    "UI-3C should still reject consolidation preparation scopes that fall outside the authority contract"
  );

  const invalidPeriodCloseExecutionValidation = buildWorkflowStepValidationModel({
    stepDrafts: [
      {
        stepNo: 1,
        stageScopeType: "LEGAL_ENTITY",
        requiredPermissionCode: PERIOD_CLOSE_EXECUTE_PERMISSION_CODE,
        requiredAuthorityLabel: "Execute period close",
        allowSelfApprove: false,
      },
    ],
    processType: "PERIOD_CLOSE",
    workflowAuthorityEntries: listWorkflowAuthorityDefinitions("PERIOD_CLOSE"),
    stepScopeLabels,
    l,
  });

  assert.equal(
    invalidPeriodCloseExecutionValidation.steps[0].blockingIssues.some(
      (issue) => issue.code === "period_close_permission_mismatch"
    ),
    true,
    "UI-3C should block PERIOD_CLOSE steps that try to use execution instead of readiness or approval"
  );

  const readinessOnlyPeriodCloseValidation = buildWorkflowStepValidationModel({
    stepDrafts: [
      {
        stepNo: 1,
        stageScopeType: "LEGAL_ENTITY",
        requiredPermissionCode: PERIOD_CLOSE_READINESS_PERMISSION_CODE,
        requiredAuthorityLabel: "Review period-close readiness",
        allowSelfApprove: false,
      },
    ],
    processType: "PERIOD_CLOSE",
    workflowAuthorityEntries: listWorkflowAuthorityDefinitions("PERIOD_CLOSE"),
    stepScopeLabels,
    l,
  });

  assert.equal(
    readinessOnlyPeriodCloseValidation.steps[0].blockingIssues.some(
      (issue) => issue.code === "period_close_approval_required"
    ),
    true,
    "UI-3C should block PERIOD_CLOSE drafts that never include an approval step"
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
      approvalStepCardSource.includes("validation?.allIssues") &&
      approvalStepCardSource.includes('l("Blocked", "Engelli")'),
    "ApprovalStepCard should render inline blocker and warning states per workflow step"
  );

  console.log("test-security-ui3c-step-validation-inline-warnings passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
