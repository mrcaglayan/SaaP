const ignorableErrnos = new Set([
  1060, // ER_DUP_FIELDNAME
  1061, // ER_DUP_KEYNAME
  1826, // ER_FK_DUP_NAME
]);

const CHECK_CONSTRAINT_AMOUNT_BASE = "chk_cash_txn_amount_base_positive";
const CHECK_CONSTRAINT_FX_RATE = "chk_cash_txn_fx_rate_positive";

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

const migration090CashFxDualAmountFoundation = {
  key: "m090_cash_fx_dual_amount_foundation",
  description:
    "Add dual-amount and FX metadata columns to cash_transactions with safe backfill",
  async up(connection) {
    if (!(await hasColumn(connection, "cash_transactions", "amount_base"))) {
      await safeExecute(
        connection,
        `ALTER TABLE cash_transactions
         ADD COLUMN amount_base DECIMAL(20,6) NULL
         AFTER amount`
      );
    }
    if (!(await hasColumn(connection, "cash_transactions", "fx_rate"))) {
      await safeExecute(
        connection,
        `ALTER TABLE cash_transactions
         ADD COLUMN fx_rate DECIMAL(20,10) NULL
         AFTER amount_base`
      );
    }
    if (!(await hasColumn(connection, "cash_transactions", "fx_rate_source"))) {
      await safeExecute(
        connection,
        `ALTER TABLE cash_transactions
         ADD COLUMN fx_rate_source VARCHAR(40) NULL
         AFTER fx_rate`
      );
    }
    if (!(await hasColumn(connection, "cash_transactions", "fx_rate_date"))) {
      await safeExecute(
        connection,
        `ALTER TABLE cash_transactions
         ADD COLUMN fx_rate_date DATE NULL
         AFTER fx_rate_source`
      );
    }
    if (!(await hasColumn(connection, "cash_transactions", "fx_fallback_mode"))) {
      await safeExecute(
        connection,
        `ALTER TABLE cash_transactions
         ADD COLUMN fx_fallback_mode VARCHAR(20) NULL
         AFTER fx_rate_date`
      );
    }
    if (!(await hasColumn(connection, "cash_transactions", "fx_fallback_max_days"))) {
      await safeExecute(
        connection,
        `ALTER TABLE cash_transactions
         ADD COLUMN fx_fallback_max_days INT NULL
         AFTER fx_fallback_mode`
      );
    }

    // Backfill legacy rows where amount was implicitly treated as base.
    await safeExecute(
      connection,
      `UPDATE cash_transactions
       SET amount_base = COALESCE(amount_base, amount),
           fx_rate = COALESCE(fx_rate, 1),
           fx_rate_source = COALESCE(NULLIF(TRIM(fx_rate_source), ''), 'PARITY'),
           fx_rate_date = COALESCE(fx_rate_date, book_date)
       WHERE amount_base IS NULL
          OR fx_rate IS NULL
          OR fx_rate_source IS NULL
          OR TRIM(fx_rate_source) = ''
          OR fx_rate_date IS NULL`
    );

    await safeExecute(
      connection,
      `ALTER TABLE cash_transactions
       MODIFY COLUMN amount_base DECIMAL(20,6) NOT NULL`
    );

    if (
      !(await hasCheckConstraint(
        connection,
        "cash_transactions",
        CHECK_CONSTRAINT_AMOUNT_BASE
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cash_transactions
         ADD CONSTRAINT ${CHECK_CONSTRAINT_AMOUNT_BASE}
         CHECK (amount_base > 0)`
      );
    }

    if (
      !(await hasCheckConstraint(
        connection,
        "cash_transactions",
        CHECK_CONSTRAINT_FX_RATE
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cash_transactions
         ADD CONSTRAINT ${CHECK_CONSTRAINT_FX_RATE}
         CHECK (fx_rate IS NULL OR fx_rate > 0)`
      );
    }
  },
};

export default migration090CashFxDualAmountFoundation;

