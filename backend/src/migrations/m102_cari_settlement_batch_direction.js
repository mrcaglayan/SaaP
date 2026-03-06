const ignorableErrnos = new Set([
  1060, // ER_DUP_FIELDNAME
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

const migration102CariSettlementBatchDirection = {
  key: "m102_cari_settlement_batch_direction",
  description:
    "Persist settlement direction on settlement batches and backfill historical rows",
  async up(connection) {
    if (!(await hasColumn(connection, "cari_settlement_batches", "direction"))) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_settlement_batches
         ADD COLUMN direction ENUM('AR','AP') NULL
         AFTER counterparty_id`
      );
    }
  },
};

export default migration102CariSettlementBatchDirection;
