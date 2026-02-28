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

  const migrationSource = await readFile(
    path.resolve(root, "backend/src/migrations/m078_tenant_feature_flags.js"),
    "utf8"
  );
  const migrationIndexSource = await readFile(
    path.resolve(root, "backend/src/migrations/index.js"),
    "utf8"
  );
  const meFeaturesServiceSource = await readFile(
    path.resolve(root, "backend/src/services/me.features.service.js"),
    "utf8"
  );
  const meRouteSource = await readFile(path.resolve(root, "backend/src/routes/me.js"), "utf8");
  const meApiSource = await readFile(path.resolve(root, "frontend/src/api/me.js"), "utf8");
  const authContextSource = await readFile(
    path.resolve(root, "frontend/src/auth/AuthContext.jsx"),
    "utf8"
  );

  assert(
    migrationSource.includes("CREATE TABLE IF NOT EXISTS tenant_features") &&
      migrationSource.includes("feature_code") &&
      migrationSource.includes("is_enabled"),
    "Migration m078 should create tenant_features with feature_code and enable toggle"
  );

  assert(
    migrationIndexSource.includes(
      'import migration078TenantFeatureFlags from "./m078_tenant_feature_flags.js"'
    ) && migrationIndexSource.includes("migration078TenantFeatureFlags"),
    "Migration index should register m078_tenant_feature_flags"
  );

  assert(
    meFeaturesServiceSource.includes("export async function listTenantFeatures") &&
      meFeaturesServiceSource.includes("enabledFeatureCodes") &&
      meFeaturesServiceSource.includes("flags"),
    "Feature service should expose tenant feature rows with enabledFeatureCodes/flags"
  );

  assert(
    meRouteSource.includes('router.get("/features", requireAuth') &&
      meRouteSource.includes("listTenantFeatures"),
    "Me routes should expose GET /me/features backed by feature service"
  );

  assert(
    meApiSource.includes("export async function listMeFeatures"),
    "Frontend me API should expose listMeFeatures client"
  );

  assert(
    authContextSource.includes("featureCodes") &&
      authContextSource.includes("hasFeature") &&
      authContextSource.includes('api.get("/me/features"'),
    "Auth context should hydrate and expose tenant feature flags"
  );

  console.log("PR-UX34 smoke test passed (tenant feature flags + /me/features wiring).");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
