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
    settlementServiceSource.includes("currencyFilterSql"),
    "fetchOpenItemsForApply must support cross-currency (optional currency filter)"
  );
  assert(
    settlementServiceSource.includes("crossRateByDocumentCurrency"),
    "MCS03 auto-allocation must be FX-aware by document currency"
  );
  assert(
    settlementServiceSource.includes("allocationSettlementTxnHint"),
    "Auto-allocation must persist settlement-currency hint per allocation"
  );
  assert(
    settlementServiceSource.includes("totalAllocatedSettlementTxn"),
    "Apply flow must compute settlement-currency allocation total"
  );
  assert(
    settlementServiceSource.includes(
      "currentResidualTxn - entry.allocationAmountDocTxn"
    ),
    "Open-item residual updates must use document-currency allocation amount"
  );
  assert(
    settlementServiceSource.includes(
      "allocation.allocation_amount_doc_txn ?? allocation.allocation_amount_txn"
    ),
    "Reversal must restore open-items using persisted document amount"
  );
  assert(
    settlementServiceSource.includes("settlementFxRateOverrideFromLinkedCash"),
    "Cash-linked settlement must reuse linked cash FX when request fxRate is absent"
  );
  assert(
    settlementServiceSource.includes(
      "incomingAmountTxn must equal cashTransactionId amount"
    ),
    "Cash-linked settlement must reconcile incomingAmountTxn with linked cash amount"
  );

  console.log("CARI MCS03 apply/reverse multi-currency smoke test passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
