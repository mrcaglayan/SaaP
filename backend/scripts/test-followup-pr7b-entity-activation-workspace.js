import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const appSource = await readFile(path.resolve(root, "frontend/src/App.jsx"), "utf8");
  const sidebarSource = await readFile(
    path.resolve(root, "frontend/src/layouts/sidebarConfig.js"),
    "utf8"
  );
  const readinessGuardSource = await readFile(
    path.resolve(root, "frontend/src/readiness/RequireTenantReadiness.jsx"),
    "utf8"
  );
  const messagesSource = await readFile(
    path.resolve(root, "frontend/src/i18n/messages.js"),
    "utf8"
  );
  const pageSource = await readFile(
    path.resolve(root, "frontend/src/pages/settings/OrganizationManagementPage.jsx"),
    "utf8"
  );

  assert(
    appSource.includes('appPath: "/app/ayarlar/entity-aktivasyon-alani"') &&
      appSource.includes('<OrganizationManagementPage workspaceMode="activation" />'),
    "App route tree should expose the entity activation workspace route in activation mode"
  );

  assert(
    sidebarSource.includes("ENTITY_ACTIVATION_WORKSPACE_PAGE_PERMISSIONS") &&
      sidebarSource.includes('to: "/app/ayarlar/entity-aktivasyon-alani"') &&
      sidebarSource.includes('label: "Entity Aktivasyon Alani"'),
    "sidebarConfig should expose the entity activation workspace entry with explicit scoped permissions"
  );

  assert(
    readinessGuardSource.includes('"/app/ayarlar/entity-aktivasyon-alani"'),
    "RequireTenantReadiness should allow the entity activation workspace during incomplete tenant readiness"
  );

  const activationLabelOccurrences =
    (messagesSource.match(/"\/app\/ayarlar\/entity-aktivasyon-alani":/g) || []).length;
  assert(
    activationLabelOccurrences >= 2,
    "messages.js should provide TR and EN sidebar labels for the entity activation workspace route"
  );

  assert(
    pageSource.includes('workspaceMode = "full"') &&
      pageSource.includes('isActivationWorkspace = workspaceMode === "activation"') &&
      pageSource.includes("showCentralStructureSections") &&
      pageSource.includes("Local activation checklist") &&
      pageSource.includes(
        "Tenant-wide onboarding readiness is intentionally hidden here."
      ) &&
      pageSource.includes("workspaceLegalEntities") &&
      pageSource.includes("workspaceCalendarOptions") &&
      pageSource.includes("activationChecklistItems") &&
      pageSource.includes("working legal entity context"),
    "OrganizationManagementPage should implement a scoped activation mode that hides tenant-wide setup noise and surfaces a local activation checklist"
  );

  console.log("PR-7B entity activation workspace static checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
