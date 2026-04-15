import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getRoleCatalogEntry,
  getWorkflowPackageAssignmentRoleDefinition,
  isWorkflowPackageAssignmentRoleCode,
  resolveWorkflowPackagesForRuntimeRoles,
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

  const approveDefinition = getWorkflowPackageAssignmentRoleDefinition("PKG-AP-APPROVE");
  const approveRoleEntry = getRoleCatalogEntry(approveDefinition?.roleCode || "");
  const resolvedPackages = resolveWorkflowPackagesForRuntimeRoles([
    approveDefinition?.roleCode || "",
  ]);

  assert(approveDefinition, "UI-2C should expose a managed runtime-role definition for workflow packages");
  assert.equal(approveDefinition?.roleCode, "WORKFLOW_PACKAGE__PKG-AP-APPROVE");
  assert.equal(approveDefinition?.defaultScope, "LEGAL_ENTITY");
  assert.equal(approveDefinition?.allowedScopes.includes("COUNTRY"), true);
  assert.equal(
    approveDefinition?.permissionCodes.includes("approvals.requests.approve"),
    true,
    "AP approve package should carry approval action authority"
  );
  assert(isWorkflowPackageAssignmentRoleCode(approveDefinition?.roleCode));
  assert.equal(approveRoleEntry.packageAuthorityOnly, true);
  assert.equal(approveRoleEntry.workflowPackageCode, "PKG-AP-APPROVE");
  assert.match(approveRoleEntry.summary || "", /exact package permission set/i);
  assert.deepEqual(
    resolvedPackages.map((entry) => entry.code),
    ["PKG-AP-APPROVE"],
    "Direct package runtime roles should resolve back to clean package metadata"
  );

  assert(
    assignmentsPageSource.includes("handleAssignWorkflowPackage") &&
      assignmentsPageSource.includes("handleRemoveWorkflowPackage") &&
      assignmentsPageSource.includes("workflowPackageAssignmentForm") &&
      assignmentsPageSource.includes("replaceRolePermissions") &&
      assignmentsPageSource.includes("buildWorkflowPackageAssignments") &&
      assignmentsPageSource.includes("isWorkflowPackageAssignmentRoleCode"),
    "UserAssignmentsPage should wire the dedicated workflow-package assignment flow"
  );

  assert(
    workbenchSource.includes("Direct workflow packages") &&
      workbenchSource.includes("Assign package") &&
      workbenchSource.includes("Assigned packages") &&
      workbenchSource.includes("Workflow package") &&
      workbenchSource.includes("Scope type") &&
      workbenchSource.includes("Scope target") &&
      workbenchSource.includes("No direct workflow packages assigned yet.") &&
      workbenchSource.includes("Remove"),
    "UserAssignmentWorkbench should expose direct workflow-package assignment UX in UI-2C"
  );

  console.log("test-security-ui2c-workflow-package-assignment-ux passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
