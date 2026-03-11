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

  const stubRows = {
    regime: {
      id: 701,
      tenant_id: 1,
      country_id: 1,
      legal_entity_id: 11,
      status: "ACTIVE",
      effective_from: "2000-01-01",
      effective_to: null,
    },
    taxCode: {
      id: 702,
      tenant_id: 1,
      tax_regime_id: 701,
      code: "VAT8",
      status: "ACTIVE",
      rate_pct: 8,
      calculation_mode: "EXCLUSIVE",
      recoverability: "FULL",
    },
    taxRule: {
      id: 703,
      tenant_id: 1,
      tax_regime_id: 701,
      tax_code_id: 702,
      module_code: "CARI",
      document_type: "INVOICE",
      counterparty_type: "CUSTOMER",
      threshold_amount: null,
      formula_json: JSON.stringify({ type: "RATE" }),
      status: "ACTIVE",
      effective_from: "2000-01-01",
      effective_to: null,
      apply_priority: 1,
    },
  };
  const resolved = await taxEngine.resolveTaxCodeAndRule({
    tenantId: 1,
    legalEntityId: 11,
    postingDate: "2026-03-11",
    regimeId: stubRows.regime.id,
    moduleCode: "CARI",
    documentType: "INVOICE",
    counterpartyType: "CUSTOMER",
    taxCodeId: stubRows.taxCode.id,
    runQuery: async (sql) => {
      if (sql.includes("FROM tax_regimes")) {
        return { rows: [stubRows.regime] };
      }
      if (sql.includes("FROM tax_codes tc")) {
        return { rows: [stubRows.taxCode] };
      }
      if (sql.includes("FROM tax_rule_sets trs")) {
        return { rows: [stubRows.taxRule] };
      }
      throw new Error(`Unexpected stub query: ${sql}`);
    },
  });
  assert(
    resolved.threshold === null,
    "Null threshold_amount must stay null and not trigger threshold rule handling"
  );
  assert(
    resolved.taxCodeRow?.id === stubRows.taxCode.id &&
      resolved.taxRuleRow?.id === stubRows.taxRule.id,
    "Tax resolver must keep selected regime/code/rule rows"
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
