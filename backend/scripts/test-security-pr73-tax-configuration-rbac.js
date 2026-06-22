import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

async function readRepoFile(relativePath) {
  return readFile(path.resolve(root, relativePath), "utf8");
}

function extractObjectBlock(source, marker) {
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `Missing marker ${marker}`);

  const startIndex = source.indexOf("{", markerIndex);
  assert.notEqual(startIndex, -1, `Missing object start for ${marker}`);

  let depth = 0;
  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(startIndex, index + 1);
      }
    }
  }

  throw new Error(`Could not extract object block for ${marker}`);
}

function assertIncludes(source, expected, message) {
  assert(source.includes(expected), message || `Expected source to include ${expected}`);
}

function assertExcludes(source, unexpected, message) {
  assert(!source.includes(unexpected), message || `Expected source not to include ${unexpected}`);
}

async function main() {
  const seedCoreSource = await readRepoFile("backend/src/seedCore.js");
  const permissionGroupsSource = await readRepoFile(
    "backend/src/constants/permission-groups.js",
  );
  const permissionRulesSource = await readRepoFile(
    "backend/src/constants/permission-rules.js",
  );
  const systemRolesSource = await readRepoFile(
    "backend/src/services/systemRoles.service.js",
  );
  const taxRoutesSource = await readRepoFile("backend/src/routes/tax.routes.js");
  const taxSetupPageSource = await readRepoFile(
    "frontend/src/pages/settings/TaxSetupPage.jsx",
  );
  const sidebarSource = await readRepoFile("frontend/src/layouts/sidebarConfig.js");
  const roleCatalogSource = await readRepoFile(
    "frontend/src/pages/security/roleCatalog.js",
  );
  const localRolesSource = await readRepoFile(
    "backend/src/services/localOperationalRoles.service.js",
  );
  const migrationsIndexSource = await readRepoFile("backend/src/migrations/index.js");
  const migration208Source = await readRepoFile(
    "backend/src/migrations/m208_tax_configuration_rbac.js",
  );

  assertIncludes(seedCoreSource, '["tax.setup.read", "Read tax setup configuration"]');
  assertIncludes(
    seedCoreSource,
    '["tax.setup.upsert", "Create/update tax setup configuration"]',
  );
  assertIncludes(seedCoreSource, "const TAX_CONFIGURATION_MANAGER_PERMISSION_CODES");
  assertIncludes(seedCoreSource, 'permissionGroups: ["tax.configuration"]');
  assertIncludes(seedCoreSource, 'code: "TaxConfigurationManager"');
  assertIncludes(
    seedCoreSource,
    'TaxConfigurationManager: Object.freeze(["tax.configuration"])',
  );

  const taxConfigurationGroup = extractObjectBlock(
    permissionGroupsSource,
    '"tax.configuration"',
  );
  assertIncludes(taxConfigurationGroup, '"org.tree.read"');
  assertIncludes(taxConfigurationGroup, '"tax.setup.read"');
  assertIncludes(taxConfigurationGroup, '"tax.setup.upsert"');
  assertIncludes(taxConfigurationGroup, '"gl.account.read"');
  assertExcludes(taxConfigurationGroup, '"gl.account.upsert"');

  assertIncludes(
    permissionRulesSource,
    '"tax.setup.read": Object.freeze(["org.tree.read"])',
  );
  assertIncludes(
    permissionRulesSource,
    '"tax.setup.upsert": Object.freeze(["tax.setup.read", "org.tree.read"])',
  );

  const systemAdminAdditionalBlock = systemRolesSource.match(
    /const SYSTEM_ADMIN_ADDITIONAL_PERMISSION_CODES = new Set\(\[[\s\S]*?\]\);/,
  )?.[0];
  assert(systemAdminAdditionalBlock, "Missing SYSTEM_ADMIN_ADDITIONAL_PERMISSION_CODES block");
  assertIncludes(systemAdminAdditionalBlock, '"org.tree.read"');
  assertIncludes(systemAdminAdditionalBlock, '"tax.setup.read"');
  assertIncludes(systemAdminAdditionalBlock, '"tax.setup.upsert"');
  assertIncludes(systemAdminAdditionalBlock, '"gl.account.read"');
  assertExcludes(systemAdminAdditionalBlock, '"gl.account.upsert"');

  assert.equal(
    (taxRoutesSource.match(/requirePermission\("tax\.setup\.upsert"/g) || []).length,
    8,
    "Tax setup mutation routes should require tax.setup.upsert",
  );
  assertExcludes(
    taxRoutesSource,
    'requirePermission("onboarding.company.setup"',
    "Tax routes should not use onboarding.company.setup",
  );
  assert.equal(
    (taxRoutesSource.match(/requirePermission\("org\.tree\.read"/g) || []).length,
    5,
    "Tax read and preview routes should remain compatible on org.tree.read",
  );

  assertIncludes(
    taxSetupPageSource,
    'const canRead = hasPermission("tax.setup.read")',
  );
  assertIncludes(
    taxSetupPageSource,
    'const canWrite = hasPermission("tax.setup.upsert")',
  );
  assertIncludes(taxSetupPageSource, "Missing permission: tax.setup.read");
  assertIncludes(taxSetupPageSource, "Missing permission: tax.setup.upsert");
  assertExcludes(
    taxSetupPageSource,
    "Missing permission: onboarding.company.setup",
    "Tax Setup page should no longer instruct users to request onboarding setup",
  );

  const taxSetupSidebarBlock = sidebarSource.match(
    /const TAX_SETUP_PAGE_PERMISSIONS = \[[\s\S]*?\];/,
  )?.[0];
  assert(taxSetupSidebarBlock, "Missing TAX_SETUP_PAGE_PERMISSIONS block");
  assertIncludes(taxSetupSidebarBlock, '"tax.setup.read"');
  assertIncludes(taxSetupSidebarBlock, '"tax.setup.upsert"');
  assertExcludes(taxSetupSidebarBlock, '"org.tree.read"');
  assertExcludes(taxSetupSidebarBlock, '"onboarding.company.setup"');

  const taxCatalogBlock = extractObjectBlock(roleCatalogSource, "TaxConfigurationManager");
  assertIncludes(taxCatalogBlock, 'category: "composable"');
  assertIncludes(taxCatalogBlock, "Tax regime setup");
  assertIncludes(taxCatalogBlock, "Tax rule maintenance");
  assertIncludes(taxCatalogBlock, "Tax account mapping");
  assertIncludes(taxCatalogBlock, 'recommendedScopes: ["TENANT", "LEGAL_ENTITY"]');
  assertExcludes(taxCatalogBlock, '"COUNTRY"');

  assertExcludes(
    localRolesSource,
    "TaxConfigurationManager",
    "TaxConfigurationManager should stay central-only in PR-73",
  );
  assertIncludes(migrationsIndexSource, "migration208TaxConfigurationRbac");
  assertIncludes(migration208Source, 'Object.freeze(["org.tree.read", "Read org hierarchy tree"])');
  assertIncludes(migration208Source, 'Object.freeze(["gl.account.read", "Read accounts"])');
  assertIncludes(
    migration208Source,
    'Object.freeze(["onboarding.company.setup", "Run company onboarding bootstrap flow"])',
  );

  console.log("test-security-pr73-tax-configuration-rbac passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
