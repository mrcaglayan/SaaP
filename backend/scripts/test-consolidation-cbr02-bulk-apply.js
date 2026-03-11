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
    serviceSource.includes("export async function applyCanonicalMappingRule"),
    "canonical mappings service must export applyCanonicalMappingRule"
  );
  assert(
    serviceSource.includes("BULK_RULE_APPLY_CONFLICTS") &&
      serviceSource.includes("HIGH_RISK_BULK_RULE_APPLY_REASON_REQUIRED"),
    "bulk rule apply service must block conflicts and high-risk no-reason applies"
  );
  assert(
    serviceSource.includes("upsertLocalAccountCanonicalMapping") &&
      serviceSource.includes("upsertGroupAccountCanonicalMapping"),
    "bulk rule apply service must reuse guarded local/group upsert paths"
  );

  const routeSource = await readFile(
    path.resolve(root, "backend/src/routes/consolidation.js"),
    "utf8"
  );
  assert(
    routeSource.includes("/groups/:groupId/canonical-mappings/rules/apply"),
    "consolidation route must expose bulk canonical rule apply endpoint"
  );
  assert(
    routeSource.includes("applyCanonicalMappingRule"),
    "consolidation route must call applyCanonicalMappingRule"
  );

  console.log("CBR02 bulk canonical rule apply smoke checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
