import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as taxEngine from "../src/services/tax.engine.service.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  assert(
    typeof taxEngine.resolveTaxRegime === "function",
    "Missing resolveTaxRegime tax engine export"
  );
  assert(
    typeof taxEngine.resolveTaxCodeAndRule === "function",
    "Missing resolveTaxCodeAndRule tax engine export"
  );
  assert(
    typeof taxEngine.computeTaxBreakdown === "function",
    "Missing computeTaxBreakdown tax engine export"
  );
  assert(
    typeof taxEngine.resolveTaxAccounts === "function",
    "Missing resolveTaxAccounts tax engine export"
  );
  assert(
    typeof taxEngine.buildTaxJournalLines === "function",
    "Missing buildTaxJournalLines tax engine export"
  );

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

  const taxEngineSource = await readFile(
    path.resolve(root, "backend/src/services/tax.engine.service.js"),
    "utf8"
  );
  assert(
    taxEngineSource.includes("CASE WHEN tr.legal_entity_id = ? THEN 0 ELSE 1 END") &&
      taxEngineSource.includes("TAX_REGIME_NOT_FOUND"),
    "Tax regime resolver must keep LE-over-country priority and explicit TAX_REGIME_NOT_FOUND"
  );
  assert(
    taxEngineSource.includes("EXCLUSIVE") &&
      taxEngineSource.includes("INCLUSIVE") &&
      taxEngineSource.includes("recoverability") &&
      taxEngineSource.includes("PARTIAL recoverability requires recoverablePct between 0 and 100"),
    "Tax computation must keep EXCLUSIVE/INCLUSIVE + recoverability behaviors"
  );
  assert(
    taxEngineSource.includes("TAX_RULE_NOT_FOUND") &&
      taxEngineSource.includes("TAX_CODE_NOT_ACTIVE") &&
      taxEngineSource.includes("TAX_ACCOUNT_MAPPING_MISSING"),
    "Tax engine must keep explicit rule/code/mapping error contracts"
  );

  const taxIntegrationSource = await readFile(
    path.resolve(root, "backend/src/services/cari.tax.integration.service.js"),
    "utf8"
  );
  assert(
    taxIntegrationSource.includes("resolveTaxRegime") &&
      taxIntegrationSource.includes("resolveTaxCodeAndRule") &&
      taxIntegrationSource.includes("computeTaxBreakdown") &&
      taxIntegrationSource.includes("resolveTaxAccounts") &&
      taxIntegrationSource.includes("buildTaxJournalLines") &&
      taxIntegrationSource.includes("FEATURE_TAX_ENGINE_V1"),
    "CARI tax integration should use full tax engine pipeline"
  );

  const cariDocumentSource = await readFile(
    path.resolve(root, "backend/src/services/cari.document.service.js"),
    "utf8"
  );
  const cariSettlementSource = await readFile(
    path.resolve(root, "backend/src/services/cari.settlement.service.js"),
    "utf8"
  );

  assert(
    cariDocumentSource.includes("buildCariTaxAugmentation"),
    "CARI document posting must keep tax-engine integration hook"
  );
  assert(
    cariSettlementSource.includes("buildCariTaxAugmentation"),
    "CARI settlement posting must keep tax-engine integration hook"
  );

  console.log("PR-F13 tax engine regression checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
