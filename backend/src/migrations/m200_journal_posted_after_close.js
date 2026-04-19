/**
 * m200 - Audit flag for journals posted into a SOFT_CLOSED period.
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

const migration200JournalPostedAfterClose = {
  key: "m200_journal_posted_after_close",
  description:
    "Add posted_after_close and posted_after_close_at audit columns to journal_entries.",
  async up(connection) {
    await safeExecute(
      connection,
      `ALTER TABLE journal_entries
       ADD COLUMN posted_after_close TINYINT(1) NOT NULL DEFAULT 0`
    );
    await safeExecute(
      connection,
      `ALTER TABLE journal_entries
       ADD COLUMN posted_after_close_at DATETIME NULL`
    );
  },

  async down() {
    // Additive audit columns only.
  },
};

export default migration200JournalPostedAfterClose;
