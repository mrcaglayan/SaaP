import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getBusinessRoleAssignmentRoleDefinition,
  getRoleCatalogEntry,
  isBusinessRoleAssignmentRoleCode,
  listBusinessRoleCatalogEntries,
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
  const rolesPageSource = await readFile(
    path.resolve(rootDir, "frontend/src/pages/security/RolesPermissionsPage.jsx"),
    "utf8"
  );
  const securityRouteSource = await readFile(
    path.resolve(rootDir, "backend/src/routes/security.js"),
    "utf8"
  );

  const branchDefinition = getBusinessRoleAssignmentRoleDefinition("BRANCH_ACCOUNTANT");
  const branchRoleEntry = getRoleCatalogEntry(branchDefinition?.roleCode || "");

  assert(branchDefinition, "UI-2B should expose a runtime-role definition for Branch Accountant labels");
  assert.equal(branchDefinition?.roleCode, "BUSINESS_ROLE__BRANCH_ACCOUNTANT");
  assert.equal(branchDefinition?.defaultScope, "OPERATING_UNIT");
  assert(isBusinessRoleAssignmentRoleCode(branchDefinition?.roleCode));
  assert.equal(branchRoleEntry.businessLabelOnly, true);
  assert.equal(branchRoleEntry.nonAuthoritative, true);
  assert.equal(branchRoleEntry.defaultScope, "OPERATING_UNIT");
  assert.match(branchRoleEntry.summary || "", /does not grant/i);

  assert.equal(
    listBusinessRoleCatalogEntries().length >= 8,
    true,
    "UI-2B should reuse the shipped business role catalog"
  );

  assert(
    assignmentsPageSource.includes("handleAssignBusinessRoleLabel") &&
      assignmentsPageSource.includes("handleRemoveBusinessRoleLabel") &&
      assignmentsPageSource.includes("businessRoleAssignmentForm") &&
      assignmentsPageSource.includes("createOrUpdateRole") &&
      assignmentsPageSource.includes("buildBusinessRoleLabelAssignments"),
    "UserAssignmentsPage should wire the dedicated business-role assignment flow"
  );

  assert(
    workbenchSource.includes("Business role labels") &&
      workbenchSource.includes("Assign label") &&
      workbenchSource.includes("Assigned labels") &&
      workbenchSource.includes("Suggested scope") &&
      workbenchSource.includes("Remove label") &&
      workbenchSource.includes("do not grant action permissions") &&
      workbenchSource.includes("Runtime authority snapshot") &&
      workbenchSource.includes("Current runtime role mix"),
    "UserAssignmentWorkbench should separate business labels from runtime authority in UI-2B"
  );

  assert(
    rolesPageSource.includes("selectedRoleLocksPermissions") &&
      rolesPageSource.includes("locked to zero permissions") &&
      rolesPageSource.includes("cannot receive permissions"),
    "RolesPermissionsPage should keep business label roles non-authoritative"
  );

  assert(
    securityRouteSource.includes("BUSINESS_ROLE_ASSIGNMENT_ROLE_PREFIX") &&
      securityRouteSource.includes("Business role label roles cannot carry permissions") &&
      securityRouteSource.includes("assertBusinessRoleLabelRolePermissionsNotManaged"),
    "Security routes should reject permission mutation for business label roles"
  );

  console.log("test-security-ui2b-business-role-assignment-ux passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
