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
  const reportServiceSource = await readUtf8("src/services/cari.report.service.js");

  assert(
    settlementServiceSource.includes("settlementFxRateOverrideFromLinkedCash"),
    "MCS04 must keep cash-linked settlement FX override wiring"
  );
  assert(
    settlementServiceSource.includes(
      "incomingAmountTxn must equal cashTransactionId amount"
    ),
    "Cash-linked apply must keep amount parity guard against linked cash txn"
  );
  assert(
    settlementServiceSource.includes("deriveSettlementPostingSourceContext"),
    "Settlement posting source context resolver must exist"
  );
  assert(
    settlementServiceSource.includes("SETTLEMENT_POSTING_SOURCE_CONTEXT.CASH_LINKED"),
    "Settlement posting source context must support CASH_LINKED"
  );
  assert(
    settlementServiceSource.includes("postingSourceContext"),
    "Settlement apply must pass postingSourceContext into posting resolution"
  );

  assert(
    reportServiceSource.includes("reversal_of_settlement_batch_id"),
    "Statement settlement report query must include reversal_of_settlement_batch_id"
  );
  assert(
    reportServiceSource.includes("reversed_by_settlement_batch_id"),
    "Statement settlement report query must include reversed_by_settlement_batch_id"
  );
  assert(
    reportServiceSource.includes("reversalRowsCount"),
    "Statement settlement summary must expose reversal row count"
  );

  console.log("CARI MCS04 cash-linked base/status smoke test passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
