import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listAccessModelCatalogSections } from "../../frontend/src/pages/security/roleCatalog.js";

async function main() {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const accessModelPageSource = await readFile(
    path.resolve(rootDir, "frontend/src/pages/security/AccessModelCatalogPage.jsx"),
    "utf8"
  );
  const appSource = await readFile(
    path.resolve(rootDir, "frontend/src/App.jsx"),
    "utf8"
  );
  const sidebarConfigSource = await readFile(
    path.resolve(rootDir, "frontend/src/layouts/sidebarConfig.js"),
    "utf8"
  );

  const sections = listAccessModelCatalogSections();
  const legacySection = sections.find((section) => section.key === "legacy_catalog");
  const businessRoleSection = sections.find((section) => section.key === "business_roles");

  assert.deepEqual(
    sections.map((section) => section.key),
    ["business_roles", "workflow_packages", "workflow_presets", "legacy_catalog"]
  );
  assert(legacySection, "legacy catalog section should exist");
  assert(businessRoleSection, "business role section should exist");
  assert(legacySection.entries.every((entry) => entry.legacy), "legacy section should contain only legacy entries");
  assert(
    businessRoleSection.entries.every((entry) => !entry.legacy && entry.modelType === "business_role"),
    "business roles section should exclude legacy runtime rows"
  );

  assert(
    accessModelPageSource.includes("useSearchParams") &&
      accessModelPageSource.includes("ACCESS_MODEL_TAB_ORDER") &&
      accessModelPageSource.includes("Detail drawer") &&
      accessModelPageSource.includes("Shared filters") &&
      accessModelPageSource.includes('Security / Access Model') &&
      accessModelPageSource.includes('setSearchParams(') &&
      accessModelPageSource.includes('item: entry.code'),
    "AccessModelCatalogPage should provide the UI-1A tab, filter, and drawer shell"
  );

  assert(
    accessModelPageSource.includes('Open workflow governance') &&
      accessModelPageSource.includes('Open migration workspace') &&
      accessModelPageSource.includes('Open current role editor'),
    "AccessModelCatalogPage should expose handoff links to the current editor surfaces while the shell remains read-only"
  );

  assert(
    appSource.includes('import AccessModelCatalogPage from "./pages/security/AccessModelCatalogPage.jsx";') &&
      appSource.includes('appPath: "/app/ayarlar/rbac/access-model"') &&
      appSource.includes("element: <AccessModelCatalogPage />"),
    "App route tree should register the access model catalog shell route"
  );

  assert(
    sidebarConfigSource.includes('const ACCESS_MODEL_PAGE_PERMISSIONS = ROLE_PERMISSIONS_PAGE_PERMISSIONS;') &&
      sidebarConfigSource.includes('label: "Erisim Modeli"') &&
      sidebarConfigSource.includes('to: "/app/ayarlar/rbac/access-model"'),
    "Sidebar config should surface the new Access Model navigation entry"
  );

  console.log("test-security-ui1a-access-model-shell passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
