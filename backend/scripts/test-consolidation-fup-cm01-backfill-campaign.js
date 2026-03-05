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
  const campaignSource = await readFile(
    path.resolve(root, "backend/scripts/consolidation-canonical-backfill-campaign.js"),
    "utf8"
  );
  assert(
    campaignSource.includes("listCanonicalMappingCandidates") &&
      campaignSource.includes("applyCanonicalMappingCandidates"),
    "FUP-CM01 campaign must use canonical candidate preview/apply services"
  );
  assert(
    campaignSource.includes("FROM consolidation_groups") &&
      campaignSource.includes("t.status = 'ACTIVE'") &&
      campaignSource.includes("cg.status = 'ACTIVE'"),
    "FUP-CM01 campaign must scan ACTIVE tenants + ACTIVE consolidation groups"
  );
  assert(
    campaignSource.includes("TenantAdmin") &&
      campaignSource.includes("ownerByTenant"),
    "FUP-CM01 campaign must assign owner per tenant (TenantAdmin fallback strategy)"
  );
  assert(
    campaignSource.includes("unresolvedBacklog") &&
      campaignSource.includes("unresolvedBacklogSummary"),
    "FUP-CM01 campaign must emit unresolved backlog output"
  );

  const packageSource = await readFile(
    path.resolve(root, "backend/package.json"),
    "utf8"
  );
  assert(
    packageSource.includes('"ops:consolidation:canonical-campaign"'),
    "backend/package.json must expose campaign run script"
  );
  assert(
    packageSource.includes('"test:ux:consolidation-fup-cm01"'),
    "backend/package.json must expose FUP-CM01 smoke script"
  );

  console.log("FUP-CM01 one-time canonical campaign smoke checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

