const IGNORABLE_ERRNOS = new Set([
  1060, // ER_DUP_FIELDNAME
]);

async function safeExecute(connection, sql, params = []) {
  try {
    await connection.execute(sql, params);
  } catch (err) {
    if (IGNORABLE_ERRNOS.has(Number(err?.errno))) {
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

const migration106CashExchangePostingMode = {
  key: "m106_cash_exchange_posting_mode",
  description:
    "Add posting_mode to cash exchange batches and allow nullable clearing accounts for future direct-mode exchange posting",
  async up(connection) {
    if (!(await hasColumn(connection, "cash_exchange_batches", "posting_mode"))) {
      await safeExecute(
        connection,
        `ALTER TABLE cash_exchange_batches
         ADD COLUMN posting_mode ENUM('CLEARING','DIRECT') NOT NULL DEFAULT 'CLEARING'
           AFTER clearing_account_id`
      );
    }

    await safeExecute(
      connection,
      `ALTER TABLE cash_exchange_batches
       MODIFY COLUMN clearing_account_id BIGINT UNSIGNED NULL`
    );

    await safeExecute(
      connection,
      `UPDATE cash_exchange_batches
       SET posting_mode = 'CLEARING'
       WHERE posting_mode IS NULL
          OR posting_mode = ''`
    );
  },
};

export default migration106CashExchangePostingMode;
