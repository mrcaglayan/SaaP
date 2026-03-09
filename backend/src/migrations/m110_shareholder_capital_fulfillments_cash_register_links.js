const IGNORABLE_ERRNOS = new Set([
  1060, // ER_DUP_FIELDNAME
  1061, // ER_DUP_KEYNAME
  1091, // ER_CANT_DROP_FIELD_OR_KEY
  1826, // ER_FK_DUP_NAME
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

const migration110ShareholderCapitalFulfillmentsCashRegisterLinks = {
  key: "m110_shareholder_capital_fulfillments_cash_register_links",
  description:
    "Add cash register/session/transaction linkage to shareholder capital fulfillments and enable CASH_REGISTER destination mode (CF05-A)",
  async up(connection) {
    await safeExecute(
      connection,
      `ALTER TABLE shareholder_capital_fulfillments
       MODIFY COLUMN destination_mode ENUM('BANK_ACCOUNT','ASSET_GL','CASH_REGISTER') NOT NULL`
    );

    if (!(await hasColumn(connection, "shareholder_capital_fulfillments", "cash_register_id"))) {
      await safeExecute(
        connection,
        `ALTER TABLE shareholder_capital_fulfillments
         ADD COLUMN cash_register_id BIGINT UNSIGNED NULL
         AFTER bank_account_id`
      );
    }

    if (!(await hasColumn(connection, "shareholder_capital_fulfillments", "cash_session_id"))) {
      await safeExecute(
        connection,
        `ALTER TABLE shareholder_capital_fulfillments
         ADD COLUMN cash_session_id BIGINT UNSIGNED NULL
         AFTER cash_register_id`
      );
    }

    if (!(await hasColumn(connection, "shareholder_capital_fulfillments", "cash_transaction_id"))) {
      await safeExecute(
        connection,
        `ALTER TABLE shareholder_capital_fulfillments
         ADD COLUMN cash_transaction_id BIGINT UNSIGNED NULL
         AFTER cash_session_id`
      );
    }

    if (
      !(await hasColumn(
        connection,
        "shareholder_capital_fulfillments",
        "cash_reversal_transaction_id"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE shareholder_capital_fulfillments
         ADD COLUMN cash_reversal_transaction_id BIGINT UNSIGNED NULL
         AFTER cash_transaction_id`
      );
    }

    if (
      !(await hasIndex(
        connection,
        "shareholder_capital_fulfillments",
        "ix_sh_cap_fulfillments_cash_register"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE shareholder_capital_fulfillments
         ADD KEY ix_sh_cap_fulfillments_cash_register (cash_register_id)`
      );
    }

    if (
      !(await hasIndex(
        connection,
        "shareholder_capital_fulfillments",
        "ix_sh_cap_fulfillments_cash_session"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE shareholder_capital_fulfillments
         ADD KEY ix_sh_cap_fulfillments_cash_session (cash_session_id)`
      );
    }

    if (
      !(await hasIndex(
        connection,
        "shareholder_capital_fulfillments",
        "uk_sh_cap_fulfillments_cash_transaction"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE shareholder_capital_fulfillments
         ADD UNIQUE KEY uk_sh_cap_fulfillments_cash_transaction (cash_transaction_id)`
      );
    }

    if (
      !(await hasIndex(
        connection,
        "shareholder_capital_fulfillments",
        "uk_sh_cap_fulfillments_cash_reversal_transaction"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE shareholder_capital_fulfillments
         ADD UNIQUE KEY uk_sh_cap_fulfillments_cash_reversal_transaction (
           cash_reversal_transaction_id
         )`
      );
    }

    if (
      !(await hasForeignKey(
        connection,
        "shareholder_capital_fulfillments",
        "fk_sh_cap_fulfillments_cash_register"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE shareholder_capital_fulfillments
         ADD CONSTRAINT fk_sh_cap_fulfillments_cash_register
           FOREIGN KEY (cash_register_id) REFERENCES cash_registers(id)`
      );
    }

    if (
      !(await hasForeignKey(
        connection,
        "shareholder_capital_fulfillments",
        "fk_sh_cap_fulfillments_cash_session"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE shareholder_capital_fulfillments
         ADD CONSTRAINT fk_sh_cap_fulfillments_cash_session
           FOREIGN KEY (cash_session_id) REFERENCES cash_sessions(id)`
      );
    }

    if (
      !(await hasForeignKey(
        connection,
        "shareholder_capital_fulfillments",
        "fk_sh_cap_fulfillments_cash_transaction"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE shareholder_capital_fulfillments
         ADD CONSTRAINT fk_sh_cap_fulfillments_cash_transaction
           FOREIGN KEY (cash_transaction_id) REFERENCES cash_transactions(id)`
      );
    }

    if (
      !(await hasForeignKey(
        connection,
        "shareholder_capital_fulfillments",
        "fk_sh_cap_fulfillments_cash_reversal_transaction"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE shareholder_capital_fulfillments
         ADD CONSTRAINT fk_sh_cap_fulfillments_cash_reversal_transaction
           FOREIGN KEY (cash_reversal_transaction_id) REFERENCES cash_transactions(id)`
      );
    }
  },

  async down() {
    // Non-destructive migration policy: no down-op for additive schema changes.
  },
};

export default migration110ShareholderCapitalFulfillmentsCashRegisterLinks;
