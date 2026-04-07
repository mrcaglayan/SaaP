import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getWorkflowPackageCatalogEntry,
  listAccessModelCatalogSections,
  listWorkflowPackageCatalogEntries,
} from "../../frontend/src/pages/security/roleCatalog.js";

async function main() {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const accessModelPageSource = await readFile(
    path.resolve(rootDir, "frontend/src/pages/security/AccessModelCatalogPage.jsx"),
    "utf8"
  );

  const packageEntries = listWorkflowPackageCatalogEntries();
  const packageSection = listAccessModelCatalogSections().find(
    (section) => section.key === "workflow_packages"
  );
  const apApprove = getWorkflowPackageCatalogEntry("PKG-AP-APPROVE");
  const lcReview = getWorkflowPackageCatalogEntry("PKG-LC-REVIEW");
  const groupPost = getWorkflowPackageCatalogEntry("PKG-AP-POST-GROUP");
  const pcClose = getWorkflowPackageCatalogEntry("PKG-PC-CLOSE");

  assert(packageSection, "workflow_packages section should remain available in the access-model shell");
  assert(
    packageSection.entries.every((entry) => entry.modelType === "workflow_package" && !entry.legacy),
    "workflow package tab should stay separate from legacy runtime rows"
  );
  assert(packageEntries.length >= 10, "UI-1C should surface the workflow package catalog");

  assert.equal(apApprove.runtimeMappingLabel, "CountryAPApprover + APApprover compatibility split");
  assert.deepEqual(apApprove.runtimeRoleLabels, [
    "AP Reviewer / CountryAPApprover",
    "APApprover",
  ]);
  assert.match(
    apApprove.legacyWarnings[0] || "",
    /Approval-engine request authority still rides on APApprover/i
  );

  assert.deepEqual(lcReview.helperBundleLabels, [
    "Close reviewer bundle (close.reviewer)",
  ]);
  assert.deepEqual(lcReview.runtimeRoleLabels, ["LocalCloseReviewer"]);

  assert.equal(pcClose.runtimeMappingLabel, "GLPostingAuthority compatibility companion");
  assert.deepEqual(pcClose.helperBundleLabels, ["GL posting bundle (gl.posting)"]);

  assert.equal(groupPost.plannedExtension, true);
  assert.match(groupPost.legacyWarnings[0] || "", /GroupController/i);

  assert(
    accessModelPageSource.includes("Workflow package guidance") &&
      accessModelPageSource.includes("Packages are the authority layer") &&
      accessModelPageSource.includes("Package name") &&
      accessModelPageSource.includes("Workflow family") &&
      accessModelPageSource.includes("Allowed scopes") &&
      accessModelPageSource.includes("Underlying permission codes") &&
      accessModelPageSource.includes("Current runtime mapping") &&
      accessModelPageSource.includes("Used in presets") &&
      accessModelPageSource.includes("Exact permission codes") &&
      accessModelPageSource.includes("Legacy warnings") &&
      accessModelPageSource.includes("WorkflowPackageCatalogTable"),
    "AccessModelCatalogPage should expose the dedicated UI-1C package table and drawer surfaces"
  );

  assert(
    accessModelPageSource.includes("Workflow steps bind to packages, not to job titles.") &&
      accessModelPageSource.includes("Current runtime mapping") &&
      accessModelPageSource.includes("Existing helper bundle mapping") &&
      accessModelPageSource.includes("Existing runtime role mapping"),
    "UI-1C should explain package authority and the compatibility mapping from current runtime roles"
  );

  assert(
    accessModelPageSource.includes('to="/app/ayarlar/workflow-kurulumu"') &&
      accessModelPageSource.includes('to="/app/ayarlar/rbac/roles-permissions"') &&
      accessModelPageSource.includes('entry.modelType === "business_role" && Array.isArray(entry.usedInPresetLabels)'),
    "UI-1C should provide workflow/current-role handoffs and keep the business-role where-used drawer scoped correctly"
  );

  console.log("test-security-ui1c-workflow-packages-tab passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
