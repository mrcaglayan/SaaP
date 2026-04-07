import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  listAccessModelCatalogSections,
  listLegacyRoleCatalogEntries,
} from "../../frontend/src/pages/security/roleCatalog.js";

async function main() {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const accessModelPageSource = await readFile(
    path.resolve(rootDir, "frontend/src/pages/security/AccessModelCatalogPage.jsx"),
    "utf8"
  );

  const legacyEntries = listLegacyRoleCatalogEntries();
  const legacySection = listAccessModelCatalogSections().find(
    (section) => section.key === "legacy_catalog"
  );
  const tenantAdmin = legacyEntries.find((entry) => entry.runtimeCode === "TenantAdmin");
  const legacyApPoster = legacyEntries.find((entry) => entry.runtimeCode === "APDocumentPoster");
  const entityApLabel = legacyEntries.find((entry) => entry.runtimeCode === "EntityAPController");
  const countryPosterLabels = legacyEntries.find(
    (entry) => entry.runtimeCode === "CountryAPController / CountryAPPoster"
  );

  assert(legacySection, "legacy_catalog section should remain available in the access-model shell");
  assert.equal(legacyEntries.length, 8, "UI-1E should surface 8 compatibility rows in the legacy catalog");
  assert(
    legacySection.entries.every(
      (entry) => entry.modelType === "runtime_role" && entry.legacy && entry.visibleInNewTenant === false
    ),
    "legacy catalog tab should stay isolated to compatibility-only rows hidden from fresh-tenant pickers"
  );

  assert.equal(tenantAdmin?.replacementLabel, "SecurityAdmin + SystemAdmin");
  assert.match(tenantAdmin?.legacyReason || "", /brownfield/i);

  assert.equal(legacyApPoster?.replacementLabel, "AP Submitter + AP Poster");
  assert.equal(legacyApPoster?.defaultScope, "LEGAL_ENTITY");

  assert.equal(entityApLabel?.replacementLabel, "AP Submitter");
  assert.deepEqual(entityApLabel?.usageSourceRoleCodes, ["EntityAPController"]);

  assert.equal(countryPosterLabels?.replacementLabel, "AP Poster");
  assert.deepEqual(countryPosterLabels?.usageSourceRoleCodes, [
    "CountryAPController",
    "CountryAPPoster",
  ]);

  assert(
    accessModelPageSource.includes("Legacy catalog guidance") &&
      accessModelPageSource.includes("Compatibility stays visible but out of fresh-tenant pickers") &&
      accessModelPageSource.includes("LegacyCatalogTable") &&
      accessModelPageSource.includes("Runtime code") &&
      accessModelPageSource.includes("Legacy reason") &&
      accessModelPageSource.includes("Replacement") &&
      accessModelPageSource.includes("Used By Count") &&
      accessModelPageSource.includes("Visible In New Tenant?"),
    "AccessModelCatalogPage should expose the dedicated UI-1E legacy table surface"
  );

  assert(
    accessModelPageSource.includes("listRoleAssignments()") &&
      accessModelPageSource.includes("Used By Count requires role-assignment read permission.") &&
      accessModelPageSource.includes("live role assignments"),
    "UI-1E should source compatibility counts from live role assignments and explain the permission fallback"
  );

  assert(
    accessModelPageSource.includes("Compatibility status") &&
      accessModelPageSource.includes("This tab does not execute migration.") &&
      accessModelPageSource.includes('to="/app/ayarlar/rbac/role-migrations"') &&
      accessModelPageSource.includes('to="/app/ayarlar/rbac/roles-permissions"'),
    "UI-1E should keep migration/current-role handoff paths without turning the legacy tab into execution tooling"
  );

  console.log("test-security-ui1e-legacy-catalog-tab passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
