const ignorableErrnos = new Set([
  1060, // ER_DUP_FIELDNAME
  1061, // ER_DUP_KEYNAME
  1826, // ER_FK_DUP_NAME
]);

const CHECK_CONSTRAINT_SETTLEMENT_FX_RATE =
  "chk_cari_settle_settlement_fx_rate_positive";
const CHECK_CONSTRAINT_SETTLEMENT_FX_FALLBACK_DAYS =
  "chk_cari_settle_fx_fallback_max_days_non_negative";

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

async function hasCheckConstraint(connection, tableName, constraintName) {
  const [rows] = await connection.execute(
    `SELECT 1
     FROM information_schema.table_constraints
     WHERE constraint_schema = DATABASE()
       AND table_name = ?
       AND constraint_type = 'CHECK'
       AND constraint_name = ?
     LIMIT 1`,
    [tableName, constraintName]
  );
  return Array.isArray(rows) && rows.length > 0;
}

const migration092CariSettlementFxReportingColumns = {
  key: "m092_cari_settlement_fx_reporting_columns",
  description:
    "Add settlement FX reporting columns on cari_settlement_batches for persisted FX auditability/reporting",
  async up(connection) {
    if (!(await hasColumn(connection, "cari_settlement_batches", "settlement_fx_rate"))) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_settlement_batches
         ADD COLUMN settlement_fx_rate DECIMAL(20,10) NULL
         AFTER currency_code`
      );
    }
    if (!(await hasColumn(connection, "cari_settlement_batches", "settlement_fx_source"))) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_settlement_batches
         ADD COLUMN settlement_fx_source VARCHAR(40) NULL
         AFTER settlement_fx_rate`
      );
    }
    if (!(await hasColumn(connection, "cari_settlement_batches", "settlement_fx_rate_date"))) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_settlement_batches
         ADD COLUMN settlement_fx_rate_date DATE NULL
         AFTER settlement_fx_source`
      );
    }
    if (
      !(await hasColumn(
        connection,
        "cari_settlement_batches",
        "settlement_fx_fallback_mode"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_settlement_batches
         ADD COLUMN settlement_fx_fallback_mode VARCHAR(20) NULL
         AFTER settlement_fx_rate_date`
      );
    }
    if (
      !(await hasColumn(
        connection,
        "cari_settlement_batches",
        "settlement_fx_fallback_max_days"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_settlement_batches
         ADD COLUMN settlement_fx_fallback_max_days INT NULL
         AFTER settlement_fx_fallback_mode`
      );
    }
    if (!(await hasColumn(connection, "cari_settlement_batches", "realized_fx_net_base"))) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_settlement_batches
         ADD COLUMN realized_fx_net_base DECIMAL(20,6) NULL
         AFTER total_allocated_base`
      );
    }

    if (
      !(await hasCheckConstraint(
        connection,
        "cari_settlement_batches",
        CHECK_CONSTRAINT_SETTLEMENT_FX_RATE
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_settlement_batches
         ADD CONSTRAINT ${CHECK_CONSTRAINT_SETTLEMENT_FX_RATE}
         CHECK (settlement_fx_rate IS NULL OR settlement_fx_rate > 0)`
      );
    }
    if (
      !(await hasCheckConstraint(
        connection,
        "cari_settlement_batches",
        CHECK_CONSTRAINT_SETTLEMENT_FX_FALLBACK_DAYS
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_settlement_batches
         ADD CONSTRAINT ${CHECK_CONSTRAINT_SETTLEMENT_FX_FALLBACK_DAYS}
         CHECK (
           settlement_fx_fallback_max_days IS NULL
           OR settlement_fx_fallback_max_days >= 0
         )`
      );
    }
  },
};

export default migration092CariSettlementFxReportingColumns;
