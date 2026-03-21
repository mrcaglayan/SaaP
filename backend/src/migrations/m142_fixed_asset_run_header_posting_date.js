/**
 * m142 - Fixed-asset depreciation run header posting_date.
 *
 * Adds a nullable posting_date column to fixed_asset_depreciation_runs and
 * backfills existing posted/reversed rows from the linked posted journal entry.
 */

const ignorableErrnos = new Set([
  1060, // ER_DUP_FIELDNAME
  1054, // ER_BAD_FIELD_ERROR
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

const migration142FixedAssetRunHeaderPostingDate = {
  key: "m142_fixed_asset_run_header_posting_date",
  description:
    "Add posting_date to fixed_asset_depreciation_runs and backfill it " +
    "from the linked posted journal entry where available.",
  async up(connection) {
    await safeExecute(
      connection,
      `ALTER TABLE fixed_asset_depreciation_runs
         ADD COLUMN posting_date DATE NULL AFTER fiscal_period_id`
    );

    await safeExecute(
      connection,
      `UPDATE fixed_asset_depreciation_runs run
          LEFT JOIN journal_entries journal
            ON journal.id = run.posted_journal_entry_id
         SET run.posting_date = COALESCE(run.posting_date, journal.entry_date)
       WHERE run.posting_date IS NULL
         AND run.posted_journal_entry_id IS NOT NULL`
    );
  },
};

export default migration142FixedAssetRunHeaderPostingDate;
