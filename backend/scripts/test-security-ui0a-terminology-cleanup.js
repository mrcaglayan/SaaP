import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getBootstrapHandoffPresetDisplayLabel,
  getBootstrapHandoffPresetEntry,
  getRoleCatalogEntry,
} from "../../frontend/src/pages/security/roleCatalog.js";

async function main() {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const roleCatalogSource = await readFile(
    path.resolve(rootDir, "frontend/src/pages/security/roleCatalog.js"),
    "utf8"
  );
  const rolesPermissionsPageSource = await readFile(
    path.resolve(rootDir, "frontend/src/pages/security/RolesPermissionsPage.jsx"),
    "utf8"
  );
  const roleSummaryCardSource = await readFile(
    path.resolve(rootDir, "frontend/src/pages/security/RoleSummaryCard.jsx"),
    "utf8"
  );
  const userAssignmentsPageSource = await readFile(
    path.resolve(rootDir, "frontend/src/pages/security/UserAssignmentsPage.jsx"),
    "utf8"
  );
  const branchOperatorManagementPageSource = await readFile(
    path.resolve(rootDir, "frontend/src/pages/security/BranchOperatorManagementPage.jsx"),
    "utf8"
  );
  const scopeAssignmentsPageSource = await readFile(
    path.resolve(rootDir, "frontend/src/pages/security/ScopeAssignmentsPage.jsx"),
    "utf8"
  );
  const roleMigrationsPageSource = await readFile(
    path.resolve(rootDir, "frontend/src/pages/security/RoleMigrationsPage.jsx"),
    "utf8"
  );
  const companyOnboardingPageSource = await readFile(
    path.resolve(rootDir, "frontend/src/pages/settings/CompanyOnboardingPage.jsx"),
    "utf8"
  );
  const workflowSetupHelpersSource = await readFile(
    path.resolve(
      rootDir,
      "frontend/src/pages/settings/workflows/utils/workflowSetupHelpers.js"
    ),
    "utf8"
  );

  assert.equal(getRoleCatalogEntry("BranchOperator").code, "Branch Accountant");
  assert.equal(getRoleCatalogEntry("EntityAPController").code, "AP Submitter");
  assert.equal(getRoleCatalogEntry("CountryAPApprover").code, "AP Reviewer");
  assert.equal(getRoleCatalogEntry("CountryAPController").code, "AP Poster");
  assert.equal(getRoleCatalogEntry("CountryAPPoster").code, "AP Poster");
  assert.equal(getRoleCatalogEntry("BranchOperator").technicalCode, "");
  assert.equal(getRoleCatalogEntry("GroupController").code, "Legacy Group Controller");
  assert.equal(getRoleCatalogEntry("GroupController").categoryLabel, "Legacy");
  assert.equal(getRoleCatalogEntry("GroupController").technicalCode, "GroupController");

  const entitySetupPreset = getBootstrapHandoffPresetEntry("EntityAPController");
  const countrySetupPreset = getBootstrapHandoffPresetEntry("CountryAPApprover");
  assert.equal(entitySetupPreset.displayName, "AP Submitter Setup Lead");
  assert.equal(countrySetupPreset.displayName, "AP Reviewer Setup Lead");
  assert.equal(getBootstrapHandoffPresetDisplayLabel("EntityAPController"), "AP Submitter Setup Lead");
  assert.equal(getBootstrapHandoffPresetDisplayLabel("CountryAPApprover"), "AP Reviewer Setup Lead");

  assert(
    roleCatalogSource.includes('legacy: "Legacy"') &&
      roleCatalogSource.includes('code: "Branch Accountant"') &&
      roleCatalogSource.includes('code: "AP Submitter"') &&
      roleCatalogSource.includes('code: "AP Reviewer"') &&
      roleCatalogSource.includes('code: "AP Poster"') &&
      roleCatalogSource.includes('displayName: "AP Submitter Setup Lead"') &&
      roleCatalogSource.includes('displayName: "AP Reviewer Setup Lead"'),
    "roleCatalog should expose the UI-0A business-facing role and preset labels"
  );

  assert(
    rolesPermissionsPageSource.includes("const selectedRoleEntry = useMemo(") &&
      rolesPermissionsPageSource.includes("roleEntry.legacy ?") &&
      rolesPermissionsPageSource.includes("Legacy") &&
      rolesPermissionsPageSource.includes("selectedRoleEntry?.code || selectedRole.code"),
    "RolesPermissionsPage should surface legacy badges and display labels from the shared catalog"
  );

  assert(
    roleSummaryCardSource.includes('roleDetailLabel = entry.technicalCode') &&
      roleSummaryCardSource.includes('"Legacy runtime role"') &&
      roleSummaryCardSource.includes("Hidden for new assignments"),
    "RoleSummaryCard should keep legacy runtime traceability while avoiding old labels for active roles"
  );

  assert(
    userAssignmentsPageSource.includes("getBootstrapHandoffPresetDisplayLabel") &&
      userAssignmentsPageSource.includes("presetDisplayName: presetMatch?.preset?.displayName || \"\"") &&
      userAssignmentsPageSource.includes("bundle.presetDisplayName || bundle.presetCode") &&
      userAssignmentsPageSource.includes("label={getPresetDisplayLabel(presetCode)}") &&
      userAssignmentsPageSource.includes("Legacy runtime roles are hidden here for new assignments."),
    "UserAssignmentsPage should render preset labels and legacy copy through the UI-0A terminology layer"
  );

  assert(
    branchOperatorManagementPageSource.includes('import { getRoleCatalogEntry } from "./roleCatalog.js";') &&
      branchOperatorManagementPageSource.includes("return getRoleCatalogEntry(roleCode).code;"),
    "BranchOperatorManagementPage should render local-role choices with the shared business labels"
  );

  assert(
    scopeAssignmentsPageSource.includes("getRoleCatalogEntry(assignment.role_code).code"),
    "ScopeAssignmentsPage should display assignment roles through the shared catalog labels"
  );

  assert(
    roleMigrationsPageSource.includes("const sourceRoleEntry = getRoleCatalogEntry(item.source_role_code);") &&
      roleMigrationsPageSource.includes("{sourceRoleEntry.code}") &&
      roleMigrationsPageSource.includes("Runtime code: ${sourceRoleEntry.technicalCode}") &&
      roleMigrationsPageSource.includes("legacy runtime roles map into composable roles"),
    "RoleMigrationsPage should rename legacy roles while preserving migration traceability"
  );

  assert(
    companyOnboardingPageSource.includes("ENTITY_SETUP_PRESET.displayName || ENTITY_SETUP_PRESET.code") &&
      companyOnboardingPageSource.includes(
        "COUNTRY_FINANCE_SETUP_PRESET.displayName || COUNTRY_FINANCE_SETUP_PRESET.code"
      ),
    "CompanyOnboardingPage should use the business-facing bootstrap preset labels"
  );

  assert(
    workflowSetupHelpersSource.includes("Branch accountants with submit authority can submit this AP document.") &&
      workflowSetupHelpersSource.includes(
        "Gonderim yetkisine sahip sube muhasebecileri bu AP belgesini gonderebilir."
      ),
    "Workflow setup helper text should use the renamed Branch Accountant wording"
  );

  console.log("test-security-ui0a-terminology-cleanup passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
