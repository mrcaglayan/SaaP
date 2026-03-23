/**
 * m148 - Extend fixed-asset run active-guard to SKIPPED.
 *
 * Makes the generated guard column treat SKIPPED the same as DRAFT so the
 * database enforces at most one active saved run snapshot per scope/period.
 */

async function hasIndex(connection, tableName, indexName) {
  const [rows] = await connection.execute(
    `SELECT 1
       FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND index_name = ?
      LIMIT 1`,
    [tableName, indexName]
  );
  return Array.isArray(rows) && rows.length > 0;
}

const migration148FixedAssetRunGuardSkipped = {
  key: "m148_fixed_asset_run_guard_skipped",
  description:
    "Extend fixed-asset depreciation run active guard to cover SKIPPED status.",
  async up(connection) {
    if (await hasIndex(connection, "fixed_asset_depreciation_runs", "uk_fadr_draft_guard")) {
      await connection.execute(
        `ALTER TABLE fixed_asset_depreciation_runs
           DROP INDEX uk_fadr_draft_guard`
      );
    }

    await connection.execute(
      `ALTER TABLE fixed_asset_depreciation_runs
         MODIFY COLUMN draft_guard TINYINT UNSIGNED
           GENERATED ALWAYS AS (IF(status IN ('DRAFT', 'SKIPPED'), 0, NULL)) STORED`
    );

    await connection.execute(
      `ALTER TABLE fixed_asset_depreciation_runs
         ADD UNIQUE KEY uk_fadr_draft_guard
           (tenant_id, legal_entity_id, book_id, fiscal_period_id, draft_guard)`
    );
  },
};

export default migration148FixedAssetRunGuardSkipped;
