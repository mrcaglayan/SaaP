import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getAccessModelTypeLabel,
  getBootstrapHandoffPresetEntry,
  getBusinessRoleCatalogEntry,
  getRoleCatalogEntry,
  getWorkflowFamilyLabel,
  getWorkflowPackageCatalogEntry,
  getWorkflowPresetCatalogEntry,
  listAccessModelCatalogSections,
  listBusinessRoleCatalogEntries,
  listLegacyRoleCatalogEntries,
  listWorkflowPackageCatalogEntries,
  listWorkflowPresetCatalogEntries,
} from "../../frontend/src/pages/security/roleCatalog.js";

async function main() {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const roleCatalogSource = await readFile(
    path.resolve(rootDir, "frontend/src/pages/security/roleCatalog.js"),
    "utf8"
  );
  const roleSummaryCardSource = await readFile(
    path.resolve(rootDir, "frontend/src/pages/security/RoleSummaryCard.jsx"),
    "utf8"
  );

  assert.equal(getAccessModelTypeLabel("workflow_package"), "Workflow Package");
  assert.equal(getWorkflowFamilyLabel("CONSOLIDATION_RUN"), "Consolidation Run");

  const branchBusinessRole = getBusinessRoleCatalogEntry("branch_accountant");
  assert.equal(branchBusinessRole.modelType, "business_role");
  assert.equal(branchBusinessRole.displayName, "Branch Accountant");
  assert.equal(branchBusinessRole.defaultScope, "OPERATING_UNIT");
  assert.deepEqual(branchBusinessRole.starterPackageCodes, ["PKG-AP-DRAFT-SUBMIT"]);
  assert.deepEqual(branchBusinessRole.optionalPackageLabels, ["Period Close / Readiness View"]);

  const packageCatalog = listWorkflowPackageCatalogEntries();
  assert.equal(packageCatalog[0].displayName, "Workflow Governance / Setup Admin");
  assert(packageCatalog.some((entry) => entry.code === "PKG-AP-POST-GROUP" && entry.plannedExtension));

  const groupPostPackage = getWorkflowPackageCatalogEntry("PKG-AP-POST-GROUP");
  assert.equal(groupPostPackage.categoryLabel, "Extension package");
  assert.equal(groupPostPackage.workflowFamilyLabel, "AP Document Posting");
  assert.equal(groupPostPackage.defaultScope, "GROUP");
  assert.equal(groupPostPackage.plannedExtension, true);
  assert.match(groupPostPackage.extensionNote, /group-scoped AP posting/i);

  const localCloseLockPackage = getWorkflowPackageCatalogEntry("PKG-LC-APPROVE-LOCK");
  assert.deepEqual(localCloseLockPackage.usedInPresetCodes, [
    "LOCAL_CLOSE_STANDARD",
    "LOCAL_CLOSE_BRANCH_ASSISTED",
    "LOCAL_CLOSE_GROUP_SUPERVISED",
  ]);

  const presetCatalog = listWorkflowPresetCatalogEntries();
  assert.equal(presetCatalog[0].displayName, "AP / Lean Entity");
  assert.equal(presetCatalog.at(-1)?.displayName, "Consolidation / Executive");

  const groupControlledPostPreset = getWorkflowPresetCatalogEntry("AP_GROUP_CONTROLLED_POST");
  assert.equal(groupControlledPostPreset.usesExtension, true);
  assert.equal(groupControlledPostPreset.stepCount, 3);
  assert.equal(groupControlledPostPreset.steps[2].scopeType, "GROUP");
  assert.equal(groupControlledPostPreset.steps[2].requiredPackageLabel, "AP Documents / Group Post");

  const consolidationExecutivePreset = getWorkflowPresetCatalogEntry("CONSOLIDATION_EXECUTIVE");
  assert.equal(consolidationExecutivePreset.primaryScope, "GROUP");
  assert.equal(consolidationExecutivePreset.stepCount, 3);
  assert.deepEqual(consolidationExecutivePreset.typicalActorLabels, [
    "Group Checker",
    "Group Approver",
    "Group CEO",
  ]);

  const bootstrapPreset = getBootstrapHandoffPresetEntry("CountryFinanceSetupManager");
  assert.equal(bootstrapPreset.modelType, "assignment_preset");
  assert.equal(bootstrapPreset.defaultScope, "COUNTRY");
  assert(bootstrapPreset.roleLabels.includes("AP Poster"));

  const branchRuntimeRole = getRoleCatalogEntry("BranchOperator");
  assert.equal(branchRuntimeRole.modelTypeLabel, "Runtime Role");
  assert.equal(branchRuntimeRole.displayName, "Branch Accountant");
  assert.equal(branchRuntimeRole.workflowFamilyLabel, "AP Document Posting");

  const legacyCatalog = listLegacyRoleCatalogEntries();
  assert.equal(legacyCatalog[0].displayName, "Legacy Tenant Admin");
  assert(
    legacyCatalog.some(
      (entry) =>
        entry.technicalCode === "GroupController" &&
        entry.replacementLabel === "Group Checker / Group Approver / Group CEO"
    )
  );

  const sections = listAccessModelCatalogSections();
  assert.deepEqual(
    sections.map((section) => section.key),
    ["business_roles", "workflow_packages", "workflow_presets", "legacy_catalog"]
  );
  assert.equal(sections[0].entries[0].displayName, "Branch Accountant");
  assert.equal(sections[1].modelTypeLabel, "Workflow Package");
  assert.equal(sections[2].entries[0].displayName, "AP / Lean Entity");
  assert.equal(sections[3].entries[0].displayName, "Legacy Tenant Admin");

  assert.equal(listBusinessRoleCatalogEntries()[0].displayName, "Branch Accountant");

  assert(
    roleCatalogSource.includes("listAccessModelCatalogSections") &&
      roleCatalogSource.includes("getWorkflowPackageCatalogEntry") &&
      roleCatalogSource.includes("getWorkflowPresetCatalogEntry") &&
      roleCatalogSource.includes("Extension package"),
    "roleCatalog should expose the UI-0B access-model metadata helpers"
  );

  assert(
    roleSummaryCardSource.includes("entry.modelTypeLabel") &&
      roleSummaryCardSource.includes("Workflow family:") &&
      roleSummaryCardSource.includes("Replacement path:") &&
      roleSummaryCardSource.includes("entry.description"),
    "RoleSummaryCard should render access-model metadata from the shared catalog"
  );

  console.log("test-security-ui0b-access-model-metadata passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
