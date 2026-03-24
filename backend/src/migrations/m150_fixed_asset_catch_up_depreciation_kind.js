/**
 * m150 - Fixed-asset catch-up depreciation kind.
 *
 * Adds CATCH_UP as a first-class depreciation_kind so late-asset immutable
 * catch-up postings can be recorded distinctly from normal run depreciation.
 */

async function hasCatchUpDepreciationKind(connection) {
  const [rows] = await connection.execute(
    `SELECT COLUMN_TYPE AS column_type
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'fixed_asset_transactions'
        AND column_name = 'depreciation_kind'
      LIMIT 1`
  );
  const columnType = String(rows?.[0]?.column_type || "").toUpperCase();
  return columnType.includes("'CATCH_UP'");
}

const migration150FixedAssetCatchUpDepreciationKind = {
  key: "m150_fixed_asset_catch_up_depreciation_kind",
  description: "Add CATCH_UP depreciation kind for late-asset immutable catch-up postings.",
  async up(connection) {
    if (await hasCatchUpDepreciationKind(connection)) {
      return;
    }

    await connection.execute(
      `ALTER TABLE fixed_asset_transactions
         MODIFY COLUMN depreciation_kind ENUM('RUN','LOW_VALUE_FULL_EXPENSE','CATCH_UP') NULL`
    );
  },
};

export default migration150FixedAssetCatchUpDepreciationKind;
