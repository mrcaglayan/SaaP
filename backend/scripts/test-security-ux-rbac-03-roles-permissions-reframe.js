import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getRoleCatalogEntry } from "../../frontend/src/pages/security/roleCatalog.js";

async function main() {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const rolesSource = await readFile(
    path.resolve(rootDir, "frontend/src/pages/security/RolesPermissionsPage.jsx"),
    "utf8"
  );
  const detailSource = await readFile(
    path.resolve(rootDir, "frontend/src/pages/security/RolePermissionsDetailPage.jsx"),
    "utf8"
  );
  const panelsSource = await readFile(
    path.resolve(rootDir, "frontend/src/pages/security/RolesPermissionsPanels.jsx"),
    "utf8"
  );

  const entityApController = getRoleCatalogEntry("EntityAPController");
  const glPostingAuthority = getRoleCatalogEntry("GLPostingAuthority");
  const packageRole = getRoleCatalogEntry("WORKFLOW_PACKAGE__PKG-AP-POST");

  assert.match(entityApController.replacementLabel || "", /AP Submitter/i);
  assert.equal(glPostingAuthority.companionOnly, true);
  assert.equal(packageRole.managedPackageRole, true);

  assert(
    rolesSource.includes("Package-backed roles") &&
      rolesSource.includes("Visible results") &&
      rolesSource.includes("RoleMeaningFilterRail") &&
      rolesSource.includes("RoleListTable") &&
      rolesSource.includes("groupRolesForManagement"),
    "UX-RBAC-03 should keep the browse-first roles surface focused on real runtime and package-backed roles"
  );

  assert(
    detailSource.includes("Role detail") &&
      detailSource.includes("Permissions") &&
      detailSource.includes("Staged") &&
      detailSource.includes("replaceRolePermissions"),
    "UX-RBAC-03 should keep the detail surface centered on editable runtime-role permissions"
  );

  assert(
    panelsSource.includes("Authority model") &&
      panelsSource.includes("Recommended scope coverage") &&
      panelsSource.includes("Permission modules") &&
      panelsSource.includes("Package-backed authority") &&
      panelsSource.includes("Companion authority") &&
      panelsSource.includes("Broad administration"),
    "UX-RBAC-03 should keep the overview and permission panels aligned to current runtime-role shapes"
  );

  assert(
    !rolesSource.includes("Label-only business roles") &&
      !detailSource.includes("Business role label roles stay non-authoritative") &&
      !panelsSource.includes("Business role label roles are locked to zero permissions."),
    "UX-RBAC-03 should no longer surface retired business-role-label language in the roles UI"
  );

  console.log("test-security-ux-rbac-03-roles-permissions-reframe passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
