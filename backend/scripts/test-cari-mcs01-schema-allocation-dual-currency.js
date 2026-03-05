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
  const migrationSource = await readUtf8(
    "src/migrations/m101_cari_settlement_allocation_dual_currency_foundation.js"
  );
  const migrationIndexSource = await readUtf8("src/migrations/index.js");
  const settlementServiceSource = await readUtf8(
    "src/services/cari.settlement.service.js"
  );
  const reportServiceSource = await readUtf8("src/services/cari.report.service.js");

  const requiredMigrationColumns = [
    "allocation_amount_doc_txn",
    "allocation_amount_settlement_txn",
    "document_currency_code",
    "settlement_currency_code",
    "applied_cross_rate",
    "cross_rate_source",
    "cross_rate_date",
  ];
  for (const column of requiredMigrationColumns) {
    assert(
      migrationSource.includes(column),
      `m101 must include column wiring for ${column}`
    );
  }

  assert(
    migrationSource.includes("UPDATE cari_settlement_allocations"),
    "m101 must include backfill update for existing allocation rows"
  );
  assert(
    migrationSource.includes("chk_cari_alloc_applied_cross_rate_positive"),
    "m101 must add applied_cross_rate positive check"
  );

  assert(
    migrationIndexSource.includes(
      'import migration101CariSettlementAllocationDualCurrencyFoundation from "./m101_cari_settlement_allocation_dual_currency_foundation.js";'
    ),
    "m101 must be imported in migrations index"
  );
  assert(
    migrationIndexSource.includes(
      "migration101CariSettlementAllocationDualCurrencyFoundation"
    ),
    "m101 must be registered in migrations array"
  );

  const requiredSettlementSelectFields = [
    "allocation_amount_doc_txn",
    "allocation_amount_settlement_txn",
    "document_currency_code",
    "settlement_currency_code",
    "applied_cross_rate",
    "cross_rate_source",
    "cross_rate_date",
  ];
  for (const field of requiredSettlementSelectFields) {
    assert(
      settlementServiceSource.includes(field),
      `Settlement service must query and expose ${field}`
    );
  }

  assert(
    settlementServiceSource.includes("allocationAmountDocTxn"),
    "Settlement allocation mapper must expose allocationAmountDocTxn"
  );
  assert(
    settlementServiceSource.includes("allocationAmountSettlementTxn"),
    "Settlement allocation mapper must expose allocationAmountSettlementTxn"
  );
  assert(
    settlementServiceSource.includes("documentCurrencyCode"),
    "Settlement allocation mapper must expose documentCurrencyCode"
  );
  assert(
    settlementServiceSource.includes("settlementCurrencyCode"),
    "Settlement allocation mapper must expose settlementCurrencyCode"
  );
  assert(
    settlementServiceSource.includes("appliedCrossRate"),
    "Settlement allocation mapper must expose appliedCrossRate"
  );

  assert(
    settlementServiceSource.includes("INSERT INTO cari_settlement_allocations"),
    "Settlement apply flow must still insert allocation rows"
  );
  assert(
    settlementServiceSource.includes("allocation_amount_doc_txn"),
    "Settlement apply insert must include allocation_amount_doc_txn"
  );
  assert(
    settlementServiceSource.includes("allocation_amount_settlement_txn"),
    "Settlement apply insert must include allocation_amount_settlement_txn"
  );

  assert(
    reportServiceSource.includes("allocation_amount_doc_txn"),
    "Statement/report allocation query must include allocation_amount_doc_txn"
  );
  assert(
    reportServiceSource.includes("allocation_amount_settlement_txn"),
    "Statement/report allocation query must include allocation_amount_settlement_txn"
  );
  assert(
    reportServiceSource.includes(
      "SUM(COALESCE(a.allocation_amount_doc_txn, a.allocation_amount_txn)) AS allocated_txn"
    ),
    "Open-items as-of allocation aggregation must prefer document-currency allocation amount"
  );

  console.log("CARI MCS01 allocation dual-currency foundation smoke test passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
