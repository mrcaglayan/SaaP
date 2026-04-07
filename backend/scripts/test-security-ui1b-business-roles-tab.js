import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getBusinessRoleCatalogEntry,
  listAccessModelCatalogSections,
  listBusinessRoleCatalogEntries,
} from "../../frontend/src/pages/security/roleCatalog.js";

async function main() {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const accessModelPageSource = await readFile(
    path.resolve(rootDir, "frontend/src/pages/security/AccessModelCatalogPage.jsx"),
    "utf8"
  );

  const businessRoles = listBusinessRoleCatalogEntries();
  const businessRoleSection = listAccessModelCatalogSections().find(
    (section) => section.key === "business_roles"
  );
  const branchAccountant = getBusinessRoleCatalogEntry("BRANCH_ACCOUNTANT");
  const groupCeo = getBusinessRoleCatalogEntry("GROUP_CEO");

  assert.equal(businessRoles.length, 8, "UI-1B should surface the 8 planned business-role rows");
  assert.deepEqual(
    businessRoles.map((entry) => entry.displayName),
    [
      "Branch Accountant",
      "Branch Manager",
      "Entity Accountant",
      "Entity Manager",
      "Entity CEO",
      "Group Checker",
      "Group Approver",
      "Group CEO",
    ]
  );
  assert(businessRoleSection, "business_roles section should remain available in the catalog shell");
  assert(
    businessRoleSection.entries.every((entry) => entry.modelType === "business_role" && !entry.legacy),
    "business role tab should stay separate from legacy runtime rows"
  );

  assert.equal(branchAccountant.statusLabel, "Active");
  assert.equal(branchAccountant.hiddenFromPicker, false);
  assert.deepEqual(branchAccountant.starterPackageLabels, ["AP Documents / Draft & Submit"]);
  assert.deepEqual(branchAccountant.usedInPresetLabels, [
    "AP / Lean Entity",
    "AP / Standard Entity",
    "AP / Group-Controlled Post",
    "Local Close / Branch-Assisted",
  ]);
  assert.deepEqual(groupCeo.usedInPresetLabels, ["Consolidation / Executive"]);

  assert(
    accessModelPageSource.includes("Business role guidance") &&
      accessModelPageSource.includes("Labels stay separate from workflow authority") &&
      accessModelPageSource.includes("Business role name") &&
      accessModelPageSource.includes("Default scope") &&
      accessModelPageSource.includes("Suggested starter packages") &&
      accessModelPageSource.includes("Active / Hidden") &&
      accessModelPageSource.includes("Create role label") &&
      accessModelPageSource.includes("Edit label") &&
      accessModelPageSource.includes("Hide from picker") &&
      accessModelPageSource.includes("Duplicate") &&
      accessModelPageSource.includes("View where used"),
    "AccessModelCatalogPage should expose the dedicated UI-1B business-role table and action surface"
  );

  assert(
    accessModelPageSource.includes(
      "Package assignment at scope is still what grants authority."
    ) &&
      accessModelPageSource.includes(
        "These are onboarding suggestions only. Workflow authority still comes from the"
      ),
    "UI-1B should explain starter packages without implying they directly grant authority"
  );

  assert(
    accessModelPageSource.includes('to="/app/ayarlar/rbac/user-assignments"') &&
      accessModelPageSource.includes('to="/app/ayarlar/workflow-kurulumu"'),
    "UI-1B should provide handoff paths for where-used and assignment follow-up"
  );

  console.log("test-security-ui1b-business-roles-tab passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
