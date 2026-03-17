const IGNORABLE_ERRNOS = new Set([
  1091, // ER_CANT_DROP_FIELD_OR_KEY
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

async function hasForeignKey(connection, tableName, constraintName) {
  const [rows] = await connection.execute(
    `SELECT 1
       FROM information_schema.table_constraints
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND constraint_name = ?
        AND constraint_type = 'FOREIGN KEY'
      LIMIT 1`,
    [tableName, constraintName]
  );
  return Array.isArray(rows) && rows.length > 0;
}

const migration134DropCashTransitAccount = {
  key: "m134_drop_cash_transit_account",
  description:
    "Drop obsolete transit account metadata column from cash transit transfers after reset-only cleanup",
  async up(connection) {
    if (!(await hasColumn(connection, "cash_transit_transfers", "transit_account_id"))) {
      return;
    }

    if (
      await hasForeignKey(connection, "cash_transit_transfers", "fk_cash_transit_account")
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cash_transit_transfers
         DROP FOREIGN KEY fk_cash_transit_account`
      );
    }

    await safeExecute(
      connection,
      `ALTER TABLE cash_transit_transfers
       DROP COLUMN transit_account_id`
    );
  },

  async down() {
    // Non-destructive migration policy: no down-op for reset-only legacy cleanup.
  },
};

export default migration134DropCashTransitAccount;
