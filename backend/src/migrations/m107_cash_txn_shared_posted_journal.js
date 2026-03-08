const ignorableErrnos = new Set([
  1061, // ER_DUP_KEYNAME
  1091, // ER_CANT_DROP_FIELD_OR_KEY
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

const migration107CashTxnSharedPostedJournal = {
  key: "m107_cash_txn_shared_posted_journal",
  description:
    "Allow shared posted_journal_entry_id across multiple cash transactions for direct exchange posting",
  async up(connection) {
    if (!(await hasIndex(connection, "cash_transactions", "ix_cash_txn_posted_journal_entry"))) {
      await safeExecute(
        connection,
        `ALTER TABLE cash_transactions
         ADD KEY ix_cash_txn_posted_journal_entry (posted_journal_entry_id)`
      );
    }

    if (await hasIndex(connection, "cash_transactions", "uk_cash_txn_posted_journal_entry")) {
      await safeExecute(
        connection,
        `ALTER TABLE cash_transactions
         DROP INDEX uk_cash_txn_posted_journal_entry`
      );
    }
  },
};

export default migration107CashTxnSharedPostedJournal;
