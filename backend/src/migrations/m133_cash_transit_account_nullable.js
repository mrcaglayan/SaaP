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

const migration133CashTransitAccountNullable = {
  key: "m133_cash_transit_account_nullable",
  description:
    "Allow nullable transit account metadata on cash transit transfers for self-balancing cross-OU workflows",
  async up(connection) {
    if (!(await hasColumn(connection, "cash_transit_transfers", "transit_account_id"))) {
      return;
    }

    await connection.execute(
      `ALTER TABLE cash_transit_transfers
       MODIFY COLUMN transit_account_id BIGINT UNSIGNED NULL`
    );
  },

  async down() {
    // Non-destructive migration policy: no down-op for nullability relaxation.
  },
};

export default migration133CashTransitAccountNullable;
