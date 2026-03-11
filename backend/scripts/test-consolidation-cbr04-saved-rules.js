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
    path.resolve(
      root,
      "backend/src/migrations/m114_consolidation_canonical_saved_rules.js"
    ),
    "utf8"
  );
  assert(
    migrationSource.includes("consolidation_canonical_mapping_rules"),
    "saved-rule migration must create consolidation_canonical_mapping_rules"
  );

  const serviceSource = await readFile(
    path.resolve(
      root,
      "backend/src/services/consolidation.canonical-mappings.service.js"
    ),
    "utf8"
  );
  assert(
    serviceSource.includes("export async function listCanonicalMappingRules") &&
      serviceSource.includes("export async function createCanonicalMappingRule") &&
      serviceSource.includes("export async function deactivateCanonicalMappingRule"),
    "canonical mappings service must expose saved-rule list/create/deactivate functions"
  );
  assert(
    serviceSource.includes("previewCanonicalMappingRuleById") &&
      serviceSource.includes("applyCanonicalMappingRuleById"),
    "canonical mappings service must expose saved-rule rerun preview/apply functions"
  );
  assert(
    serviceSource.includes("savedRules: {") &&
      serviceSource.includes("unmappedPostedAccountSampleCoveredBySavedRulesCount"),
    "governance review must include saved-rule visibility"
  );

  const routeSource = await readFile(
    path.resolve(root, "backend/src/routes/consolidation.js"),
    "utf8"
  );
  assert(
    routeSource.includes("/groups/:groupId/canonical-mappings/rules") &&
      routeSource.includes("/groups/:groupId/canonical-mappings/rules/:ruleId/preview") &&
      routeSource.includes("/groups/:groupId/canonical-mappings/rules/:ruleId/apply") &&
      routeSource.includes("/groups/:groupId/canonical-mappings/rules/:ruleId/deactivate"),
    "consolidation routes must expose saved-rule CRUD/rerun endpoints"
  );

  const apiSource = await readFile(
    path.resolve(root, "frontend/src/api/consolidationAdmin.js"),
    "utf8"
  );
  assert(
    apiSource.includes("listConsolidationCanonicalMappingRules") &&
      apiSource.includes("createConsolidationCanonicalMappingRule") &&
      apiSource.includes("previewSavedConsolidationCanonicalMappingRule") &&
      apiSource.includes("applySavedConsolidationCanonicalMappingRule") &&
      apiSource.includes("deactivateConsolidationCanonicalMappingRule"),
    "consolidationAdmin.js must expose saved-rule API helpers"
  );

  const setupPageSource = await readFile(
    path.resolve(root, "frontend/src/pages/settings/ConsolidationSetupPage.jsx"),
    "utf8"
  );
  assert(
    setupPageSource.includes("Saved bulk rules") &&
      setupPageSource.includes("onSaveCanonicalRuleDefinition") &&
      setupPageSource.includes("onReuseSavedCanonicalRule") &&
      setupPageSource.includes("onDeactivateSavedCanonicalRule"),
    "ConsolidationSetupPage must render saved-rule actions"
  );

  console.log("CBR04 saved canonical rule smoke checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
