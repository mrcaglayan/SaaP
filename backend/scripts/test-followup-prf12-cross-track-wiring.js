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
  const consolidationRoutePath = path.resolve(root, "backend/src/routes/consolidation.js");
  const source = await readFile(consolidationRoutePath, "utf8");

  assert(
    source.includes("evaluateSubaccountsCompatibility"),
    "Missing subaccounts cross-track compatibility evaluator in consolidation route"
  );
  assert(
    source.includes("evaluateApprovalGateCompatibility"),
    "Missing approval-gate cross-track compatibility evaluator in consolidation route"
  );
  assert(
    source.includes("evaluateTaxPostedLinesCompatibility"),
    "Missing tax-posted-lines cross-track compatibility evaluator in consolidation route"
  );
  assert(
    source.includes("buildCrossTrackCompatibilitySnapshot"),
    "Missing cross-track compatibility snapshot builder in consolidation route"
  );

  const compatibilityKeyCount = (source.match(/compatibility,/g) || []).length;
  assert(
    compatibilityKeyCount >= 4,
    "Consolidation outputs must return compatibility snapshot in report responses"
  );

  assert(
    source.includes("FEATURE_SUBACCOUNTS_V1") &&
      source.includes("FEATURE_WORKFLOW_CLOSE_CONSOLIDATION_V1") &&
      source.includes("FEATURE_TAX_ENGINE_V1"),
    "Cross-track compatibility checks must reference subaccounts/workflow/tax feature flags"
  );

  assert(
    source.includes('"/runs/:runId/finalize"') &&
      source.includes("evaluateWorkflowApprovalGate"),
    "Finalize route must keep workflow gate enforcement while wiring compatibility outputs"
  );

  console.log("PR-F12 cross-track wiring checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
