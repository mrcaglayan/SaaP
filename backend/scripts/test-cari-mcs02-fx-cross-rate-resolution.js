import { readFile } from "node:fs/promises";
import path from "node:path";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function readUtf8(relativePathFromBackend) {
  const absolutePath = path.resolve(process.cwd(), relativePathFromBackend);
  return readFile(absolutePath, "utf8");
}

async function main() {
  const settlementServiceSource = await readUtf8(
    "src/services/cari.settlement.service.js"
  );

  assert(
    settlementServiceSource.includes(
      "async function resolveSettlementToDocumentCrossRate"
    ),
    "MCS02 must introduce resolveSettlementToDocumentCrossRate helper"
  );
  assert(
    settlementServiceSource.includes("allowMissingRate = false"),
    "resolveSettlementFxRate must support allowMissingRate option"
  );
  assert(
    settlementServiceSource.includes("allowMissingRate: true"),
    "Cross-rate resolver must attempt direct pair with allowMissingRate"
  );
  assert(
    settlementServiceSource.includes("functionalCurrencyCode: documentCurrency"),
    "Cross-rate resolver must query direct settlement/document pair"
  );
  assert(
    settlementServiceSource.includes(
      "settlementToFunctionalRate / documentToFunctionalRate"
    ),
    "Cross-rate resolver must derive via functional currency when direct pair is unavailable"
  );
  assert(
    settlementServiceSource.includes("DERIVED_VIA_FUNCTIONAL"),
    "Cross-rate resolver must persist derived source metadata"
  );
  assert(
    settlementServiceSource.includes("allocationAmountSettlementTxn"),
    "Enriched allocations must carry settlement-currency amount"
  );
  assert(
    settlementServiceSource.includes("entry.appliedCrossRate"),
    "Allocation insert must persist applied_cross_rate from resolved policy"
  );
  assert(
    settlementServiceSource.includes("entry.crossRateSource"),
    "Allocation insert must persist cross_rate_source from resolved policy"
  );
  assert(
    settlementServiceSource.includes("entry.crossRateDate"),
    "Allocation insert must persist cross_rate_date from resolved policy"
  );

  console.log("CARI MCS02 FX cross-rate resolution smoke test passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
