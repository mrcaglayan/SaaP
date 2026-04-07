import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getBusinessRoleCatalogEntry,
  getWorkflowPresetCatalogEntry,
} from "../../frontend/src/pages/security/roleCatalog.js";

async function main() {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const workbenchSource = await readFile(
    path.resolve(rootDir, "frontend/src/pages/security/UserAssignmentWorkbench.jsx"),
    "utf8"
  );
  const assignmentsPageSource = await readFile(
    path.resolve(rootDir, "frontend/src/pages/security/UserAssignmentsPage.jsx"),
    "utf8"
  );

  const branchStarter = getBusinessRoleCatalogEntry("BRANCH_ACCOUNTANT");
  const standardPreset = getWorkflowPresetCatalogEntry("AP_STANDARD_ENTITY");

  assert.equal(
    branchStarter.starterPackageCodes.includes("PKG-AP-DRAFT-SUBMIT"),
    true,
    "UI-2D should reuse business-role starter package metadata"
  );
  assert.equal(
    standardPreset.requiredPackageCodes.includes("PKG-AP-POST"),
    true,
    "UI-2D should reuse workflow preset package metadata"
  );
  assert.equal(
    standardPreset.steps.some((step) => step.requiredPackageCode === "PKG-AP-APPROVE"),
    true,
    "Workflow preset preview should still expose step-to-package mapping"
  );

  assert(
    assignmentsPageSource.includes("handleApplyPackageSource") &&
      assignmentsPageSource.includes("packageSourceApplyForm") &&
      assignmentsPageSource.includes("togglePackageSourcePreviewPackage") &&
      assignmentsPageSource.includes("selectedPackageSourcePackageCodes") &&
      assignmentsPageSource.includes("assignmentBlockedByExtension") &&
      assignmentsPageSource.includes("STARTER_DERIVED"),
    "UserAssignmentsPage should wire starter/preset package apply flow with derived-source tracking"
  );

  assert(
    workbenchSource.includes("Starter bundles & presets") &&
      workbenchSource.includes("Business role starter") &&
      workbenchSource.includes("Workflow preset") &&
      workbenchSource.includes("Preview packages") &&
      workbenchSource.includes("Apply {{count}} selected packages") &&
      workbenchSource.includes("Starter-derived") &&
      workbenchSource.includes("Preset-derived") &&
      workbenchSource.includes("Derived (starter/preset)") &&
      workbenchSource.includes("Also assign the business role label"),
    "UserAssignmentWorkbench should expose UI-2D starter/preset apply UX and derived-source copy"
  );

  console.log("test-security-ui2d-starter-bundle-preset-apply passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
