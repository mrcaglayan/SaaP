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

  const serviceSource = await readFile(
    path.resolve(
      root,
      "backend/src/services/consolidation.canonical-mappings.service.js"
    ),
    "utf8"
  );
  assert(
    serviceSource.includes("export async function previewCanonicalMappingRule"),
    "canonical mappings service must export previewCanonicalMappingRule"
  );
  assert(
    serviceSource.includes("DESCENDANTS_OF_ACCOUNT") &&
      serviceSource.includes("CODE_PREFIX"),
    "bulk rule preview service must support descendant and prefix rule types"
  );
  assert(
    serviceSource.includes("selectedRootAccount") &&
      serviceSource.includes("READY_TO_APPLY") &&
      serviceSource.includes("CONFLICTING_LOCAL_MAPPING"),
    "bulk rule preview service must expose context and row classification buckets"
  );

  const routeSource = await readFile(
    path.resolve(root, "backend/src/routes/consolidation.js"),
    "utf8"
  );
  assert(
    routeSource.includes("/groups/:groupId/canonical-mappings/rules/preview"),
    "consolidation route must expose bulk canonical rule preview endpoint"
  );
  assert(
    routeSource.includes("previewCanonicalMappingRule"),
    "consolidation route must call previewCanonicalMappingRule"
  );

  console.log("CBR01 bulk canonical rule preview smoke checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
