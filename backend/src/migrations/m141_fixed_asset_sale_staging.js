/**
 * m141 – Fixed-asset sale staging columns.
 *
 * Adds nullable columns to fixed_assets for tracking a pending AR-side
 * sale linkage before finalization (FA39 staged sale workflow).
 */

const ignorableErrnos = new Set([
  1060, // ER_DUP_FIELDNAME
]);

async function safeExecute(connection, sql) {
  try {
    await connection.execute(sql);
  } catch (err) {
    if (ignorableErrnos.has(err?.errno)) {
      return;
    }
    throw err;
  }
}

const migration141FixedAssetSaleStaging = {
  key: "m141_fixed_asset_sale_staging",
  description:
    "Add pending_sale_cari_document_id and pending_sale_cari_document_line_id " +
    "columns to fixed_assets for staged sale linkage.",
  async up(connection) {
    await safeExecute(
      connection,
      `ALTER TABLE fixed_assets
         ADD COLUMN pending_sale_cari_document_id BIGINT UNSIGNED NULL AFTER disposal_loss_account_id`
    );
    await safeExecute(
      connection,
      `ALTER TABLE fixed_assets
         ADD COLUMN pending_sale_cari_document_line_id BIGINT UNSIGNED NULL AFTER pending_sale_cari_document_id`
    );
  },
};

export default migration141FixedAssetSaleStaging;
