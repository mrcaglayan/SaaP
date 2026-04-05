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
  const activationApiSource = await readFile(
    path.resolve(root, "frontend/src/api/legalEntityActivation.js"),
    "utf8"
  );
  const activationProviderSource = await readFile(
    path.resolve(root, "frontend/src/readiness/LegalEntityActivationProvider.jsx"),
    "utf8"
  );
  const activationHookSource = await readFile(
    path.resolve(root, "frontend/src/readiness/useLegalEntityActivation.js"),
    "utf8"
  );
  const activationChecklistSource = await readFile(
    path.resolve(root, "frontend/src/readiness/LegalEntityActivationChecklist.jsx"),
    "utf8"
  );
  const pageSource = await readFile(
    path.resolve(root, "frontend/src/pages/settings/OrganizationManagementPage.jsx"),
    "utf8"
  );

  assert(
    appSource.includes('appPath: "/app/ayarlar/entity-aktivasyon-alani"') &&
      appSource.includes('<OrganizationManagementPage workspaceMode="activation" />') &&
      appSource.includes("LegalEntityActivationProvider"),
    "App route tree should expose the entity activation workspace route in activation mode and wrap it in LegalEntityActivationProvider"
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
    activationApiSource.includes("/api/v1/onboarding/legal-entity-activation"),
    "legalEntityActivation API client should call the scoped activation-readiness route"
  );

  assert(
    activationProviderSource.includes("getLegalEntityActivationReadiness") &&
      activationProviderSource.includes('hasPermission("org.tree.read")') &&
      activationProviderSource.includes("refreshLegalEntity"),
    "LegalEntityActivationProvider should load scoped activation readiness with org.tree.read gating and per-entity refresh support"
  );

  assert(
    activationHookSource.includes("useLegalEntityActivation must be used within") &&
      activationChecklistSource.includes("Focus this entity") &&
      activationChecklistSource.includes("Current focus"),
    "Activation workspace support files should expose the new hook and focused-entity checklist UI"
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
      pageSource.includes("useLegalEntityActivation") &&
      pageSource.includes("LegalEntityActivationChecklist") &&
      pageSource.includes("activationVisibleEntityCards") &&
      pageSource.includes("activationFocusedEntityGroups") &&
      pageSource.includes("working legal entity context"),
    "OrganizationManagementPage should implement a scoped activation mode that hides tenant-wide setup noise and surfaces the activation-readiness-backed checklist"
  );

  console.log("PR-7B entity activation workspace static checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
