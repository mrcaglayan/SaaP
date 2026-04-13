import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  listBusinessRoleCatalogEntries,
  listWorkflowPackageCatalogEntries,
  listWorkflowPresetCatalogEntries,
} from "../../frontend/src/pages/security/roleCatalog.js";
import {
  buildStepDrafts,
  buildStepPreview,
  buildWorkflowStepValidationModel,
  listWorkflowStepPackageOptions,
} from "../../frontend/src/pages/settings/workflows/utils/workflowSetupHelpers.js";

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
  const workflowPresetEntries = listWorkflowPresetCatalogEntries();
  const businessRoleEntries = listBusinessRoleCatalogEntries();
  const workflowStepCatalogContext = {
    workflowPackageEntries,
    workflowPresetEntries,
    businessRoleEntries,
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
    workflowStepCatalogContext
  );
  const apDrafts = buildStepDrafts(
    "AP_DOCUMENT_POSTING",
    [
      {
        stepNo: 1,
        actionCode: "SUBMIT",
        stageScopeType: "COUNTRY",
        requiredPackageCode: "PKG-AP-DRAFT-SUBMIT",
        requiredPermissionCode: null,
        minApproverCount: 1,
        allowSelfApprove: false,
      },
    ],
    workflowStepCatalogContext
  );
  const consolidationPackageOptions = listWorkflowStepPackageOptions({
    processType: "CONSOLIDATION_RUN",
    workflowPackageEntries,
  });

  assert.equal(
    localCloseDrafts[0].requiredPackageCode,
    "PKG-LC-REVIEW",
    "UI-3B should infer the workflow package from the existing local-close permission bridge"
  );
  assert.equal(
    localCloseDrafts[0].actionLabel,
    "Review",
    "UI-3B should infer a readable action label for bridged workflow steps"
  );
  assert.equal(
    localCloseDrafts[0].eligibleBusinessRoleLabels.includes("Entity Manager"),
    true,
    "UI-3B should surface business-role suggestions for the selected workflow package"
  );

  assert.equal(
    apDrafts[0].requiredPackageCode,
    "PKG-AP-DRAFT-SUBMIT",
    "UI-3B should preserve the explicit AP action/package binding in the step builder"
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
    ).includes("Local Close Pack / Review"),
    true,
    "UI-3B step previews should speak in terms of workflow packages instead of raw permission codes"
  );

  assert.equal(
    consolidationPackageOptions.some((entry) => entry.code === "PKG-CON-VIEW"),
    false,
    "UI-3B should exclude view-only workflow packages from the editable step-builder options"
  );
  assert.equal(
    consolidationPackageOptions.some((entry) => entry.code === "PKG-CON-FINALIZE"),
    true,
    "UI-3B should include actionable family packages in the editable step-builder options"
  );

  const invalidApValidation = buildWorkflowStepValidationModel({
    processType: "AP_DOCUMENT_POSTING",
    stepDrafts: [
      {
        stepNo: 1,
        actionCode: "DRAFT",
        stageScopeType: "OPERATING_UNIT",
        requiredPackageCode: "PKG-AP-DRAFT-SUBMIT",
        requiredPermissionCode: null,
        minApproverCount: 1,
        allowSelfApprove: false,
      },
      {
        stepNo: 2,
        actionCode: "POST",
        stageScopeType: "COUNTRY",
        requiredPackageCode: "PKG-AP-POST",
        requiredPermissionCode: null,
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
    workflowSetupPageSource.includes("listWorkflowPackageCatalogEntries") &&
      workflowSetupPageSource.includes("listBusinessRoleCatalogEntries") &&
      workflowSetupPageSource.includes("workflowStepPackageOptions") &&
      workflowSetupPageSource.includes("workflowStepBusinessRoleOptions"),
    "WorkflowSetupPage should load package and business-role catalog metadata for the step builder"
  );

  assert(
    workflowStepsBuilderSource.includes("workflowStepPackageOptions") &&
      workflowStepsBuilderSource.includes("workflowStepBusinessRoleOptions") &&
      workflowStepsBuilderSource.includes(
        "Each step now binds to a workflow package at a specific organizational scope."
      ),
    "WorkflowStepsBuilderStep should state and pass the package-first step-builder model"
  );

  assert(
    approvalStepCardSource.includes("workflowStepPackageOptions") &&
      approvalStepCardSource.includes("getApWorkflowRequiredPackageCode") &&
      approvalStepCardSource.includes('l("Eligible business roles", "Uygun is rolleri")') &&
      approvalStepCardSource.includes(
        "This AP package is bound by the selected action and resolves authority at the chosen step scope."
      ) &&
      !approvalStepCardSource.includes('l("Required reviewer permission", "Gerekli inceleyen yetkisi")'),
    "ApprovalStepCard should keep the package-first row editor and remove the raw reviewer-permission field"
  );

  console.log("test-security-ui3b-step-builder-refactor passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
