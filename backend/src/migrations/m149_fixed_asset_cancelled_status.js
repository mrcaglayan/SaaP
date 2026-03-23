/**
 * m149 - Fixed-asset cancelled status.
 *
 * Adds CANCELLED as a first-class fixed-asset lifecycle status so source
 * document reversal can preserve audited asset history without leaving the
 * asset in DRAFT or overloading DISPOSED.
 */

async function hasCancelledAssetStatus(connection) {
  const [rows] = await connection.execute(
    `SELECT COLUMN_TYPE AS column_type
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'fixed_assets'
        AND column_name = 'status'
      LIMIT 1`
  );
  const columnType = String(rows?.[0]?.column_type || "").toUpperCase();
  return columnType.includes("'CANCELLED'");
}

const migration149FixedAssetCancelledStatus = {
  key: "m149_fixed_asset_cancelled_status",
  description: "Add CANCELLED fixed-asset lifecycle status.",
  async up(connection) {
    if (await hasCancelledAssetStatus(connection)) {
      return;
    }

    await connection.execute(
      `ALTER TABLE fixed_assets
         MODIFY COLUMN status ENUM('DRAFT','ACTIVE','SUSPENDED','FULLY_DEPRECIATED','DISPOSED','CANCELLED')
         NOT NULL DEFAULT 'DRAFT'`
    );
  },
};

export default migration149FixedAssetCancelledStatus;
