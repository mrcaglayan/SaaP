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

  const branchBusinessLabel = getRoleCatalogEntry("BUSINESS_ROLE__BRANCH_ACCOUNTANT");
  const groupController = getRoleCatalogEntry("GroupController");
  const glPostingAuthority = getRoleCatalogEntry("GLPostingAuthority");

  assert.equal(branchBusinessLabel.businessLabelOnly, true);
  assert.equal(branchBusinessLabel.nonAuthoritative, true);
  assert.equal(groupController.legacy, true);
  assert.match(groupController.replacementLabel || "", /Group Checker/i);
  assert.equal(glPostingAuthority.companionOnly, true);

  assert(
    rolesSource.includes("Browse by role meaning") &&
      rolesSource.includes("Composable runtime roles") &&
      rolesSource.includes("Label-only business roles") &&
      rolesSource.includes("Legacy compatibility roles") &&
      rolesSource.includes("Role selection") &&
      rolesSource.includes("Role meaning") &&
      rolesSource.includes("Role guidance") &&
      rolesSource.includes("Authority model") &&
      rolesSource.includes("Recommended scope coverage") &&
      rolesSource.includes("Permission modules") &&
      rolesSource.includes("Permission editing stays secondary to role meaning") &&
      rolesSource.includes("What to watch before editing"),
    "UX-RBAC-03 should reframe the page around browse-first role meaning, guidance, and secondary permission editing"
  );

  assert(
    rolesSource.includes("RoleMeaningFilterRail") &&
      rolesSource.includes("RoleSelectionCard") &&
      rolesSource.includes("buildPermissionModuleGroups") &&
      rolesSource.includes("Requires READ") &&
      rolesSource.includes("selectedRoleAttentionItems"),
    "UX-RBAC-03 should group permission modules and keep attention state visible in the new role detail surface"
  );

  assert(
    rolesSource.includes("Business role label roles are locked to zero permissions.") &&
      rolesSource.includes("Open migration workspace") &&
      rolesSource.includes("Open user assignments") &&
      rolesSource.includes("Open access model") &&
      rolesSource.includes("Companion role") &&
      rolesSource.includes("Hidden for new assignments"),
    "UX-RBAC-03 should preserve label-only, legacy, and companion-role handoffs in the new layout"
  );

  console.log("test-security-ux-rbac-03-roles-permissions-reframe passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
