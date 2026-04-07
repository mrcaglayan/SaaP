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
        stageScopeType: "COUNTRY",
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
    "PKG-AP-APPROVE",
    "UI-3B should keep AP approval steps bound to the AP approve package in the current bridge"
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
    approvalStepCardSource.includes('l("Action label", "Islem etiketi")') &&
      approvalStepCardSource.includes('l("Required package", "Gerekli paket")') &&
      approvalStepCardSource.includes('l("Eligible business roles", "Uygun is rolleri")') &&
      !approvalStepCardSource.includes('l("Required reviewer permission", "Gerekli inceleyen yetkisi")'),
    "ApprovalStepCard should replace the raw reviewer-permission input with package and business-role fields"
  );

  console.log("test-security-ui3b-step-builder-refactor passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
