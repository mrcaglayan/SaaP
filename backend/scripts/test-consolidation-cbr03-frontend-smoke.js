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

  const apiSource = await readFile(
    path.resolve(root, "frontend/src/api/consolidationAdmin.js"),
    "utf8"
  );
  assert(
    apiSource.includes("previewConsolidationCanonicalRuleMappings"),
    "consolidationAdmin.js must export previewConsolidationCanonicalRuleMappings"
  );
  assert(
    apiSource.includes("applyConsolidationCanonicalRuleMappings"),
    "consolidationAdmin.js must export applyConsolidationCanonicalRuleMappings"
  );
  assert(
    apiSource.includes("canonical-mappings/rules/preview") &&
      apiSource.includes("canonical-mappings/rules/apply"),
    "consolidationAdmin.js must wire bulk canonical rule preview/apply endpoints"
  );

  const setupPageSource = await readFile(
    path.resolve(root, "frontend/src/pages/settings/ConsolidationSetupPage.jsx"),
    "utf8"
  );
  assert(
    setupPageSource.includes("Bulk Canonical Mapping"),
    "ConsolidationSetupPage must render the bulk canonical mapping card"
  );
  assert(
    setupPageSource.includes("onPreviewCanonicalRule") &&
      setupPageSource.includes("onApplyCanonicalRule"),
    "ConsolidationSetupPage must implement bulk canonical preview/apply handlers"
  );
  assert(
    setupPageSource.includes("onEditCanonicalMapping") &&
      setupPageSource.includes("Toplu Canonical Esleme"),
    "ConsolidationSetupPage must expose edit actions and bilingual bulk mapping copy"
  );

  console.log("CBR03 bulk canonical frontend smoke checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
