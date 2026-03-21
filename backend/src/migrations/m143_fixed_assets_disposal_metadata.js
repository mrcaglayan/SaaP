/**
 * m143 - Fixed-asset disposal metadata.
 *
 * Adds additive disposal metadata columns directly on fixed_assets so
 * disposal type, disposal recording timestamp, proceeds, and gain/loss can
 * be queried without reconstructing terminal disposal facts from transaction
 * history. Backfills existing DISPOSED assets with disposal_type and
 * disposed_at using the latest active terminal transaction plus asset.updated_at
 * as the best available historical approximation.
 */

const ignorableErrnos = new Set([
  1060, // ER_DUP_FIELDNAME
]);

async function safeExecute(connection, sql, params = []) {
  try {
    await connection.execute(sql, params);
  } catch (err) {
    if (ignorableErrnos.has(Number(err?.errno))) {
      return;
    }
    throw err;
  }
}

async function hasColumn(connection, tableName, columnName) {
  const [rows] = await connection.execute(
    `SELECT 1
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name = ?
      LIMIT 1`,
    [tableName, columnName]
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function addColumnIfMissing(connection, tableName, columnName, definitionSql) {
  if (await hasColumn(connection, tableName, columnName)) {
    return;
  }
  await connection.execute(`ALTER TABLE ${tableName} ADD COLUMN ${definitionSql}`);
}

const migration143FixedAssetsDisposalMetadata = {
  key: "m143_fixed_assets_disposal_metadata",
  description:
    "Add disposal metadata columns to fixed_assets and backfill " +
    "existing disposed assets from terminal fixed_asset_transactions history.",
  async up(connection) {
    await addColumnIfMissing(
      connection,
      "fixed_assets",
      "disposal_type",
      `disposal_type ENUM('SALE','WRITEOFF','SCRAPPING','DONATION','THEFT_LOSS')
         NULL AFTER disposal_date`
    );
    await addColumnIfMissing(
      connection,
      "fixed_assets",
      "disposed_at",
      `disposed_at DATETIME NULL AFTER disposal_type`
    );
    await addColumnIfMissing(
      connection,
      "fixed_assets",
      "disposal_proceeds_base",
      `disposal_proceeds_base DECIMAL(18,4) NULL AFTER disposed_at`
    );
    await addColumnIfMissing(
      connection,
      "fixed_assets",
      "disposal_gain_loss_base",
      `disposal_gain_loss_base DECIMAL(18,4) NULL AFTER disposal_proceeds_base`
    );

    await safeExecute(
      connection,
      `UPDATE fixed_assets fa
          SET fa.disposal_type = COALESCE(
                fa.disposal_type,
                (
                  SELECT fat.transaction_type
                    FROM fixed_asset_transactions fat
                   WHERE fat.tenant_id = fa.tenant_id
                     AND fat.asset_id = fa.id
                     AND fat.status = 'POSTED'
                     AND fat.transaction_type IN ('WRITEOFF', 'SALE')
                     AND fat.reversal_transaction_id IS NULL
                     AND NOT EXISTS (
                           SELECT 1
                             FROM fixed_asset_transactions rev
                            WHERE rev.reversed_transaction_id = fat.id
                              AND rev.status = 'POSTED'
                         )
                   ORDER BY fat.effective_date DESC, fat.id DESC
                   LIMIT 1
                )
              ),
              fa.disposed_at = COALESCE(fa.disposed_at, fa.updated_at)
        WHERE fa.status = 'DISPOSED'
          AND (fa.disposal_type IS NULL OR fa.disposed_at IS NULL)`
    );
  },
};

export default migration143FixedAssetsDisposalMetadata;
