/**
 * m201 - Audit column to preserve the original fiscal period when a draft
 * journal is reclassified to a different period.
 */

const IGNORABLE_ERRNOS = new Set([
  1060, // ER_DUP_FIELDNAME
]);

async function safeExecute(connection, sql) {
  try {
    await connection.execute(sql);
  } catch (err) {
    if (IGNORABLE_ERRNOS.has(Number(err?.errno))) {
      return;
    }
    throw err;
  }
}

const migration201JournalOriginalFiscalPeriod = {
  key: "m201_journal_original_fiscal_period",
  description:
    "Add original_fiscal_period_id audit column to journal_entries for period reclassification tracking.",
  async up(connection) {
    await safeExecute(
      connection,
      `ALTER TABLE journal_entries
       ADD COLUMN original_fiscal_period_id INT NULL`
    );
  },

  async down() {
    // Additive audit column only.
  },
};

export default migration201JournalOriginalFiscalPeriod;
