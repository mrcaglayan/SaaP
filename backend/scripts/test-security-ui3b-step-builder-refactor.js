import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  listWorkflowAuthorityDefinitions,
} from "../../frontend/src/pages/security/roleCatalog.js";
import {
  buildStepDrafts,
  buildStepPreview,
  buildWorkflowStepValidationModel,
  listWorkflowStepAuthorityOptions,
} from "../../frontend/src/pages/settings/workflows/utils/workflowSetupHelpers.js";
import { getApWorkflowRequiredPermissionCode } from "../../shared/cariDocumentWorkflowGovernance.js";
import {
  PERIOD_CLOSE_APPROVE_PERMISSION_CODE,
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

  const workflowPresetEntries = [];
  const localCloseCatalogContext = {
    workflowAuthorityEntries: listWorkflowAuthorityDefinitions("LOCAL_CLOSE_PACK"),
    workflowPresetEntries,
  };
  const apCatalogContext = {
    workflowAuthorityEntries: listWorkflowAuthorityDefinitions("AP_DOCUMENT_POSTING"),
    workflowPresetEntries,
  };

  const localCloseDrafts = buildStepDrafts(
    "LOCAL_CLOSE_PACK",
    [
      {
        stepNo: 1,
        stageScopeType: "LEGAL_ENTITY",
        requiredPermissionCode: "ouclose.review",
        minApproverCount: 1,
        allowSelfApprove: false,
      },
    ],
    localCloseCatalogContext
  );
  const apDrafts = buildStepDrafts(
    "AP_DOCUMENT_POSTING",
    [
      {
        stepNo: 1,
        actionCode: "SUBMIT",
        stageScopeType: "COUNTRY",
        requiredPermissionCode: getApWorkflowRequiredPermissionCode("SUBMIT"),
        minApproverCount: 1,
        allowSelfApprove: false,
      },
    ],
    apCatalogContext
  );
  const consolidationAuthorityOptions = listWorkflowStepAuthorityOptions({
    processType: "CONSOLIDATION_RUN",
    workflowAuthorityEntries: listWorkflowAuthorityDefinitions("CONSOLIDATION_RUN"),
  });
  const periodCloseAuthorityOptions = listWorkflowStepAuthorityOptions({
    processType: "PERIOD_CLOSE",
    workflowAuthorityEntries: listWorkflowAuthorityDefinitions("PERIOD_CLOSE"),
  });

  assert.equal(
    Object.prototype.hasOwnProperty.call(localCloseDrafts[0], "requiredPackageCode"),
    false,
    "UI-3B should keep normalized non-AP step drafts free of legacy requiredPackageCode output"
  );
  assert.equal(
    localCloseDrafts[0].requiredPermissionCode,
    "ouclose.review",
    "UI-3B should preserve the permission-first bridge for non-AP workflow steps"
  );
  assert.equal(
    localCloseDrafts[0].actionLabel,
    "Review Local Close",
    "UI-3B should infer a readable action label for bridged workflow steps"
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(apDrafts[0], "requiredPackageCode"),
    false,
    "UI-3B should keep AP drafts package-free once the action/permission contract is normalized"
  );
  assert.equal(
    apDrafts[0].requiredPermissionCode,
    getApWorkflowRequiredPermissionCode("SUBMIT"),
    "UI-3B should preserve the explicit AP action/permission binding in the step builder"
  );
  assert.equal(
    apDrafts[0].actionCode,
    "SUBMIT",
    "UI-3B should keep explicit AP action codes intact when step drafts are normalized"
  );
  assert.equal(
    buildStepPreview(
      localCloseDrafts[0],
      "LOCAL_CLOSE_PACK",
      {
        OPERATING_UNIT: "Operating Unit",
        LEGAL_ENTITY: "Legal Entity",
        COUNTRY: "Country",
        GROUP: "Group",
      },
      l
    ).includes("Review Local Close"),
    true,
    "UI-3B step previews should speak in terms of workflow authorities instead of raw permission codes"
  );

  assert.equal(
    consolidationAuthorityOptions.some((entry) => entry.code === "CONSOLIDATION_VIEW"),
    false,
    "UI-3B should exclude view-only workflow authorities from the editable step-builder options"
  );
  assert.equal(
    consolidationAuthorityOptions.some((entry) => entry.code === "CONSOLIDATION_FINALIZE"),
    true,
    "UI-3B should include actionable family authorities in the editable step-builder options"
  );
  assert.deepEqual(
    periodCloseAuthorityOptions.map((entry) => entry.primaryPermissionCode),
    [
      PERIOD_CLOSE_READINESS_PERMISSION_CODE,
      PERIOD_CLOSE_APPROVE_PERMISSION_CODE,
    ],
    "UI-3B should offer only readiness and approval authorities for PERIOD_CLOSE workflow steps"
  );

  const invalidApValidation = buildWorkflowStepValidationModel({
    processType: "AP_DOCUMENT_POSTING",
    stepDrafts: [
      {
        stepNo: 1,
        actionCode: "DRAFT",
        stageScopeType: "OPERATING_UNIT",
        requiredPermissionCode: getApWorkflowRequiredPermissionCode("DRAFT"),
        minApproverCount: 1,
        allowSelfApprove: false,
      },
      {
        stepNo: 2,
        actionCode: "POST",
        stageScopeType: "COUNTRY",
        requiredPermissionCode: getApWorkflowRequiredPermissionCode("POST"),
        minApproverCount: 1,
        allowSelfApprove: false,
      },
    ],
    l,
  });
  assert.equal(
    invalidApValidation.hasBlockingIssues,
    true,
    "UI-3B should block AP step chains that skip the explicit SUBMIT step"
  );
  assert.equal(
    invalidApValidation.steps.some((entry) =>
      Array.isArray(entry?.allIssues) &&
      entry.allIssues.some((issue) => issue?.code === "ap_submit_required_once")
    ),
    true,
    "UI-3B should tell admins that AP workflows require exactly one SUBMIT step"
  );

  assert(
    workflowSetupPageSource.includes("listWorkflowAuthorityDefinitions") &&
      workflowSetupPageSource.includes("workflowStepAuthorityOptions") &&
      workflowSetupPageSource.includes("workflowStepCatalogContext"),
    "WorkflowSetupPage should load authority and preset catalog metadata for the step builder"
  );
  assert(
    workflowSetupPageSource.includes("PERIOD_CLOSE_APPROVAL"),
    "WorkflowSetupPage should default new PERIOD_CLOSE steps to approval rather than execution"
  );

  assert(
    workflowStepsBuilderSource.includes("workflowStepAuthorityOptions") &&
      workflowStepsBuilderSource.includes(
        "Each step now binds to one workflow authority at a specific organizational scope."
      ),
    "WorkflowStepsBuilderStep should state and pass the authority-first step-builder model"
  );

  assert(
    approvalStepCardSource.includes("workflowStepAuthorityOptions") &&
      approvalStepCardSource.includes("getApWorkflowRequiredPermissionCode") &&
      approvalStepCardSource.includes('l("Authority source", "Yetki kaynagi")') &&
      approvalStepCardSource.includes(
        "This AP action resolves to one required permission at the chosen step scope."
      ) &&
      approvalStepCardSource.includes("Authority-backed"),
    "ApprovalStepCard should keep AP rows permission-backed while non-AP rows use authority selectors"
  );

  console.log("test-security-ui3b-step-builder-refactor passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
