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

  assert.equal(apApprove.runtimeMappingLabel, "AP Reviewer + APApprover source roles");
  assert.deepEqual(apApprove.runtimeRoleLabels, [
    "AP Reviewer / CountryAPApprover",
    "APApprover",
  ]);
  assert.match(
    apApprove.runtimeNotes[0] || "",
    /Approval-engine request authority still rides on APApprover/i
  );

  assert.deepEqual(lcReview.helperBundleLabels, [
    "Close reviewer bundle (close.reviewer)",
  ]);
  assert.deepEqual(lcReview.runtimeRoleLabels, ["LocalCloseReviewer"]);

  assert.equal(pcClose.runtimeMappingLabel, "GLPostingAuthority companion role");
  assert.deepEqual(pcClose.helperBundleLabels, ["GL posting bundle (gl.posting)"]);

  assert.equal(groupPost.plannedExtension, true);
  assert.match(groupPost.runtimeNotes[0] || "", /backend group-post extension/i);

  assert(
    accessModelPageSource.includes("Workflow package guidance") &&
      accessModelPageSource.includes("Packages are the authority layer") &&
      accessModelPageSource.includes("Browse by workflow family") &&
      accessModelPageSource.includes("Package name") &&
      accessModelPageSource.includes("Allowed scopes") &&
      accessModelPageSource.includes("Underlying permission codes") &&
      accessModelPageSource.includes("Current runtime sources") &&
      accessModelPageSource.includes("Used in presets") &&
      accessModelPageSource.includes("Permission modules") &&
      accessModelPageSource.includes("Permissions grouped by module") &&
      accessModelPageSource.includes("Scope coverage") &&
      accessModelPageSource.includes("WorkflowPackageCatalogTable"),
    "AccessModelCatalogPage should expose the dedicated UI-1C package card list and richer drawer surface"
  );

  assert(
    accessModelPageSource.includes("Workflow steps bind to packages, not to legacy job-title labels.") &&
      accessModelPageSource.includes("Current runtime sources") &&
      accessModelPageSource.includes("Module groups keep package meaning readable") &&
      accessModelPageSource.includes("Helper bundle sources") &&
      accessModelPageSource.includes("Runtime role sources"),
    "UI-1C should explain package authority and the compatibility mapping from current runtime roles"
  );

  assert(
    accessModelPageSource.includes('to="/app/ayarlar/security-admin/workflows?tab=definitions"') &&
      accessModelPageSource.includes("ROLES_PERMISSIONS_CANONICAL_PATH"),
    "UI-1C should provide workflow and current-role handoffs from the package catalog"
  );

  console.log("test-security-ui1c-workflow-packages-tab passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
