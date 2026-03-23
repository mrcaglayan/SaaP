/**
 * m147 - Fixed-asset depreciation run skipped status.
 *
 * Adds SKIPPED as a first-class depreciation-run status and backfills
 * existing no-op draft runs that contain only skipped lines.
 */

async function hasSkippedRunStatus(connection) {
  const [rows] = await connection.execute(
    `SELECT COLUMN_TYPE AS column_type
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'fixed_asset_depreciation_runs'
        AND column_name = 'status'
      LIMIT 1`
  );
  const columnType = String(rows?.[0]?.column_type || "").toUpperCase();
  return columnType.includes("'SKIPPED'");
}

const migration147FixedAssetRunSkippedStatus = {
  key: "m147_fixed_asset_run_skipped_status",
  description:
    "Add SKIPPED depreciation-run status and backfill skip-only draft runs.",
  async up(connection) {
    if (!(await hasSkippedRunStatus(connection))) {
      await connection.execute(
        `ALTER TABLE fixed_asset_depreciation_runs
           MODIFY COLUMN status ENUM('DRAFT','SKIPPED','POSTED','REVERSED')
           NOT NULL DEFAULT 'DRAFT'`
      );
    }

    await connection.execute(
      `UPDATE fixed_asset_depreciation_runs run
          SET run.status = 'SKIPPED'
        WHERE run.status = 'DRAFT'
          AND run.error_count = 0
          AND run.posted_asset_count = 0
          AND run.skipped_asset_count > 0
          AND EXISTS (
            SELECT 1
              FROM fixed_asset_depreciation_run_lines line
             WHERE line.tenant_id = run.tenant_id
               AND line.run_id = run.id
          )
          AND NOT EXISTS (
            SELECT 1
              FROM fixed_asset_depreciation_run_lines line
             WHERE line.tenant_id = run.tenant_id
               AND line.run_id = run.id
               AND line.status <> 'SKIPPED'
          )`
    );
  },
};

export default migration147FixedAssetRunSkippedStatus;
