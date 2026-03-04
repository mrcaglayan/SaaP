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
  const migrationSource = await readUtf8("src/migrations/m090_cash_fx_dual_amount_foundation.js");
  const migrationIndexSource = await readUtf8("src/migrations/index.js");
  const cashQueriesSource = await readUtf8("src/services/cash.queries.js");
  const cashCreateValidatorSource = await readUtf8("src/routes/cash.transaction.validators.js");
  const cashTxnServiceSource = await readUtf8("src/services/cash.transaction.service.js");

  const requiredMigrationColumns = [
    "amount_base",
    "fx_rate",
    "fx_rate_source",
    "fx_rate_date",
    "fx_fallback_mode",
    "fx_fallback_max_days",
  ];
  for (const column of requiredMigrationColumns) {
    assert(
      migrationSource.includes(column),
      `m090 must include column wiring for ${column}`
    );
  }

  assert(
    migrationSource.includes("UPDATE cash_transactions"),
    "m090 must include backfill update for legacy rows"
  );
  assert(
    migrationSource.includes("MODIFY COLUMN amount_base DECIMAL(20,6) NOT NULL"),
    "m090 must enforce amount_base NOT NULL after backfill"
  );
  assert(
    migrationSource.includes("chk_cash_txn_amount_base_positive"),
    "m090 must add amount_base positive check"
  );
  assert(
    migrationSource.includes("chk_cash_txn_fx_rate_positive"),
    "m090 must add fx_rate positive check"
  );

  assert(
    migrationIndexSource.includes(
      'import migration090CashFxDualAmountFoundation from "./m090_cash_fx_dual_amount_foundation.js";'
    ),
    "m090 must be imported in migrations index"
  );
  assert(
    migrationIndexSource.includes("migration090CashFxDualAmountFoundation"),
    "m090 must be registered in migrations array"
  );

  const requiredSelectFields = [
    "ct.amount_base",
    "ct.fx_rate",
    "ct.fx_rate_source",
    "ct.fx_rate_date",
    "ct.fx_fallback_mode",
    "ct.fx_fallback_max_days",
  ];
  for (const field of requiredSelectFields) {
    assert(
      cashQueriesSource.includes(field),
      `cash transaction base SELECT must return ${field}`
    );
  }

  const requiredInsertFields = [
    "amount_base",
    "fx_rate",
    "fx_rate_source",
    "fx_rate_date",
    "fx_fallback_mode",
    "fx_fallback_max_days",
  ];
  for (const field of requiredInsertFields) {
    assert(
      cashQueriesSource.includes(field),
      `cash transaction INSERT must include ${field}`
    );
  }

  assert(
    cashCreateValidatorSource.includes("amountBase"),
    "cash transaction create validator must parse amountBase"
  );
  assert(
    cashCreateValidatorSource.includes("fxRate"),
    "cash transaction create validator must parse fxRate"
  );
  assert(
    cashCreateValidatorSource.includes("fxRateSource"),
    "cash transaction create validator must parse fxRateSource"
  );
  assert(
    cashCreateValidatorSource.includes("fxRateDate"),
    "cash transaction create validator must parse fxRateDate"
  );

  assert(
    cashTxnServiceSource.includes("amountBase: normalizeMoney(fxPolicy.amountBase)"),
    "cash create service must persist resolved amountBase"
  );

  console.log("PR-EX01 cash dual-amount schema foundation smoke test passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
