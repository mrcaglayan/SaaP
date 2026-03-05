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
  const reportServiceSource = await readUtf8("src/services/cari.report.service.js");
  const reconcileScriptSource = await readUtf8(
    "scripts/reconcile-cari-settlement-dual-currency.js"
  );
  const packageJsonSource = await readUtf8("package.json");

  const requiredAllocationReportFields = [
    "allocationAmountDocTxn",
    "allocationAmountSettlementTxn",
    "documentCurrencyCode",
    "settlementCurrencyCode",
    "appliedCrossRate",
    "crossRateSource",
    "crossRateDate",
  ];
  for (const field of requiredAllocationReportFields) {
    assert(
      reportServiceSource.includes(field),
      `Statement allocation rows must expose ${field}`
    );
  }

  const requiredAllocationSummaryFields = [
    "allocationAmountDocTxnTotal",
    "allocationAmountSettlementTxnTotal",
    "activeAllocationAmountDocTxnTotal",
    "activeAllocationAmountSettlementTxnTotal",
    "reversedAllocationAmountDocTxnTotal",
    "reversedAllocationAmountSettlementTxnTotal",
    "allocationByDocumentCurrency",
    "allocationBySettlementCurrency",
  ];
  for (const field of requiredAllocationSummaryFields) {
    assert(
      reportServiceSource.includes(field),
      `Statement allocation summary must expose ${field}`
    );
  }

  const requiredSettlementSummaryFields = [
    "postedTotalAllocatedTxn",
    "reversedOriginalTotalAllocatedTxn",
    "reversalRowsTotalAllocatedTxn",
    "asOfVisibleTotalAllocatedTxn",
    "asOfVisibleRealizedFxNetBase",
  ];
  for (const field of requiredSettlementSummaryFields) {
    assert(
      reportServiceSource.includes(field),
      `Statement settlement summary must expose ${field}`
    );
  }

  assert(
    reportServiceSource.includes("buildAllocationLinksByDocumentId"),
    "Statement report must continue linking allocations per document"
  );
  assert(
    reportServiceSource.includes("allocationAmountSettlementTxn: row.allocationAmountSettlementTxn"),
    "Document settlementLinks must include settlement-currency allocation amount"
  );

  const requiredReconcileChecks = [
    "reconcile-cari-settlement-dual-currency",
    "missing_metadata_count",
    "legacy_parity_signature_count",
    "PARITY_WITH_DIFFERENT_CURRENCIES",
    "PARITY_WITH_NON_ONE_RATE",
  ];
  for (const check of requiredReconcileChecks) {
    assert(
      reconcileScriptSource.includes(check),
      `Reconcile script must include check: ${check}`
    );
  }

  assert(
    packageJsonSource.includes('"test:cari:mcs-release-gate"'),
    "package.json must expose test:cari:mcs-release-gate script"
  );

  console.log("CARI MCS05 reporting/reconcile smoke test passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
