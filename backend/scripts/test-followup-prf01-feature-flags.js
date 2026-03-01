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
  const catalogSource = await readFile(
    path.resolve(root, "backend/src/services/features.catalog.js"),
    "utf8"
  );
  const featureServiceSource = await readFile(
    path.resolve(root, "backend/src/services/me.features.service.js"),
    "utf8"
  );

  const requiredFlags = [
    "feature_subaccounts_v1",
    "feature_setup_wizard_v2",
    "feature_consolidation_canonical_mapping_v1",
    "feature_workflow_close_consolidation_v1",
    "feature_tax_engine_v1",
  ];

  for (const flag of requiredFlags) {
    assert(
      catalogSource.toLowerCase().includes(flag),
      `Missing required feature code in catalog: ${flag}`
    );
  }

  assert(
    featureServiceSource.includes("KNOWN_TENANT_FEATURE_CODES") &&
      featureServiceSource.includes("includeDisabled") &&
      featureServiceSource.includes("Object.fromEntries"),
    "Me feature service should merge known feature defaults and expose disabled defaults"
  );

  console.log("PR-F01 feature-flag smoke test passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
