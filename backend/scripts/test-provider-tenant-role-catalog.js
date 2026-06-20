import assert from "assert";
import { readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function readBackend(relativePath) {
  return readFile(path.resolve(root, relativePath), "utf8");
}

async function main() {
  const seedCoreSource = await readBackend("src/seedCore.js");
  const providerSource = await readBackend("src/routes/provider.js");
  const onboardingSource = await readBackend("src/routes/onboarding.js");

  assert(
    seedCoreSource.includes("export async function seedTenantRoleCatalog"),
    "seedCore should export a one-tenant role catalog seeder",
  );
  assert(
    seedCoreSource.includes("ALL_ROLE_DEFINITIONS") &&
      seedCoreSource.includes("await upsertPermissions(runQuery)") &&
      seedCoreSource.includes("upsertFieldVisibilityPoliciesForTenant") &&
      seedCoreSource.includes("roleIdsByCode"),
    "tenant role catalog seeding should use the full authoritative role definitions",
  );
  assert(
    providerSource.includes('import { seedTenantRoleCatalog } from "../seedCore.js"') &&
      providerSource.includes("const catalog = await seedTenantRoleCatalog(tenantId") &&
      providerSource.includes("return catalog.roleIdsByCode"),
    "provider tenant provisioning should seed the full tenant role catalog",
  );
  assert(
    !providerSource.includes("ensureSystemRolesForTenant"),
    "provider provisioning should not fall back to bootstrap-only system roles",
  );
  assert(
    onboardingSource.includes('import { seedTenantRoleCatalog } from "../seedCore.js"') &&
      onboardingSource.includes("await seedTenantRoleCatalog(tenantId, { runQuery: tx.query });"),
    "company bootstrap should self-heal the tenant role catalog before handoff assignments",
  );
}

main()
  .then(() => {
    console.log("test-provider-tenant-role-catalog passed");
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
