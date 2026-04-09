import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

async function main() {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const shellSource = await readFile(
    path.resolve(rootDir, "frontend/src/pages/security/SecurityAdminWorkspaceShell.jsx"),
    "utf8"
  );
  const accessModelSource = await readFile(
    path.resolve(rootDir, "frontend/src/pages/security/AccessModelCatalogPage.jsx"),
    "utf8"
  );
  const rolesSource = await readFile(
    path.resolve(rootDir, "frontend/src/pages/security/RolesPermissionsPage.jsx"),
    "utf8"
  );
  const assignmentsSource = await readFile(
    path.resolve(rootDir, "frontend/src/pages/security/UserAssignmentsPage.jsx"),
    "utf8"
  );
  const appSource = await readFile(path.resolve(rootDir, "frontend/src/App.jsx"), "utf8");
  const sidebarSource = await readFile(
    path.resolve(rootDir, "frontend/src/layouts/sidebarConfig.js"),
    "utf8"
  );

  assert(
    shellSource.includes("SecurityAdminWorkspaceShell") &&
      shellSource.includes("/app/ayarlar/rbac/access-model") &&
      shellSource.includes("/app/ayarlar/rbac/roles-permissions") &&
      shellSource.includes("/app/ayarlar/rbac/user-assignments") &&
      shellSource.includes("/app/ayarlar/rbac/access-debugger") &&
      shellSource.includes("/app/ayarlar/rbac/delegations") &&
      shellSource.includes("/app/ayarlar/rbac/audit-logs"),
    "The shared shell should define the primary workspace sections and companion-tool links"
  );

  assert(
    accessModelSource.includes("SecurityAdminWorkspaceShell") &&
      accessModelSource.includes('sectionKey="access-model"') &&
      accessModelSource.includes('eyebrow="Security / Access Model"') &&
      accessModelSource.includes('title: "Detail drawer"') &&
      accessModelSource.includes("Shared filters"),
    "AccessModelCatalogPage should mount inside the shared workspace shell and keep its drawer/filter contract"
  );

  assert(
    rolesSource.includes("SecurityAdminWorkspaceShell") &&
      rolesSource.includes('sectionKey="roles-permissions"') &&
      rolesSource.includes('title: "Managed roles"') &&
      rolesSource.includes("RoleSummaryCard") &&
      rolesSource.includes("replaceRolePermissions"),
    "RolesPermissionsPage should use the shared shell without losing the current role editor behavior"
  );

  assert(
    assignmentsSource.includes("SecurityAdminWorkspaceShell") &&
      assignmentsSource.includes('sectionKey="user-assignments"') &&
      assignmentsSource.includes("WorkspaceTabButton") &&
      assignmentsSource.includes("UserAssignmentWorkbench") &&
      assignmentsSource.includes("Open approval delegations") &&
      assignmentsSource.includes("Invite user"),
    "UserAssignmentsPage should mount inside the shared shell and keep assignment, invite, and delegation entry points"
  );

  assert(
    appSource.includes('appPath: "/app/ayarlar/rbac/access-model"') &&
      appSource.includes('appPath: "/app/ayarlar/rbac/roles-permissions"') &&
      appSource.includes('appPath: "/app/ayarlar/rbac/user-assignments"'),
    "Primary security workspace routes should remain registered in the app router"
  );

  assert(
    sidebarSource.includes('to: "/app/ayarlar/rbac/access-model"') &&
      sidebarSource.includes('to: "/app/ayarlar/rbac/roles-permissions"') &&
      sidebarSource.includes('to: "/app/ayarlar/rbac/user-assignments"') &&
      sidebarSource.includes('to: "/app/ayarlar/rbac/delegations"') &&
      sidebarSource.includes('to: "/app/ayarlar/rbac/access-debugger"'),
    "Sidebar navigation should keep both primary pages and companion security tools reachable"
  );

  console.log("test-security-ux-rbac-01-workspace-shell passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
