const ignorableErrnos = new Set([
  1060, // ER_DUP_FIELDNAME
  1061, // ER_DUP_KEYNAME
  1091, // ER_CANT_DROP_FIELD_OR_KEY
  1826, // ER_FK_DUP_NAME
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

async function hasForeignKey(connection, tableName, constraintName) {
  const [rows] = await connection.execute(
    `SELECT 1
     FROM information_schema.referential_constraints
     WHERE constraint_schema = DATABASE()
       AND table_name = ?
       AND constraint_name = ?
     LIMIT 1`,
    [tableName, constraintName]
  );
  return Array.isArray(rows) && rows.length > 0;
}

const migration096CashExchangeFeeSpreadAccounting = {
  key: "m096_cash_exchange_fee_spread_accounting",
  description:
    "Extend cash_exchange_batches with exchange fee/spread metadata, fee transaction links, and realized-FX reporting fields",
  async up(connection) {
    await safeExecute(
      connection,
      `ALTER TABLE cash_exchange_batches
         ADD COLUMN fee_amount_txn DECIMAL(20,6) NULL
           AFTER target_amount_base`
    );
    await safeExecute(
      connection,
      `ALTER TABLE cash_exchange_batches
         ADD COLUMN fee_amount_base DECIMAL(20,6) NULL
           AFTER fee_amount_txn`
    );
    await safeExecute(
      connection,
      `ALTER TABLE cash_exchange_batches
         ADD COLUMN realized_fx_base DECIMAL(20,6) NULL
           AFTER target_amount_base`
    );
    await safeExecute(
      connection,
      `ALTER TABLE cash_exchange_batches
         ADD COLUMN reversal_realized_fx_base DECIMAL(20,6) NULL
           AFTER realized_fx_base`
    );
    await safeExecute(
      connection,
      `ALTER TABLE cash_exchange_batches
         ADD COLUMN fee_account_id BIGINT UNSIGNED NULL
           AFTER clearing_account_id`
    );
    await safeExecute(
      connection,
      `ALTER TABLE cash_exchange_batches
         ADD COLUMN fee_cash_transaction_id BIGINT UNSIGNED NULL
           AFTER exchange_in_cash_transaction_id`
    );
    await safeExecute(
      connection,
      `ALTER TABLE cash_exchange_batches
         ADD COLUMN reversal_fee_cash_transaction_id BIGINT UNSIGNED NULL
           AFTER reversal_in_cash_transaction_id`
    );
    await safeExecute(
      connection,
      `ALTER TABLE cash_exchange_batches
         ADD COLUMN provider_ref VARCHAR(120) NULL
           AFTER integration_event_uid`
    );
    await safeExecute(
      connection,
      `ALTER TABLE cash_exchange_batches
         ADD COLUMN spread_reference_rate DECIMAL(20,10) NULL
           AFTER provider_ref`
    );
    await safeExecute(
      connection,
      `ALTER TABLE cash_exchange_batches
         ADD COLUMN spread_rate_delta DECIMAL(20,10) NULL
           AFTER spread_reference_rate`
    );
    await safeExecute(
      connection,
      `ALTER TABLE cash_exchange_batches
         ADD COLUMN spread_amount_base DECIMAL(20,6) NULL
           AFTER spread_rate_delta`
    );

    if (
      !(await hasIndex(connection, "cash_exchange_batches", "uk_cash_exchange_tenant_fee_txn"))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cash_exchange_batches
         ADD UNIQUE KEY uk_cash_exchange_tenant_fee_txn (
           tenant_id,
           fee_cash_transaction_id
         )`
      );
    }
    if (
      !(await hasIndex(
        connection,
        "cash_exchange_batches",
        "uk_cash_exchange_tenant_rev_fee_txn"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cash_exchange_batches
         ADD UNIQUE KEY uk_cash_exchange_tenant_rev_fee_txn (
           tenant_id,
           reversal_fee_cash_transaction_id
         )`
      );
    }

    if (
      !(await hasForeignKey(connection, "cash_exchange_batches", "fk_cash_exchange_fee_account"))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cash_exchange_batches
         ADD CONSTRAINT fk_cash_exchange_fee_account
           FOREIGN KEY (fee_account_id) REFERENCES accounts(id)`
      );
    }
    if (
      !(await hasForeignKey(connection, "cash_exchange_batches", "fk_cash_exchange_fee_txn_tenant"))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cash_exchange_batches
         ADD CONSTRAINT fk_cash_exchange_fee_txn_tenant
           FOREIGN KEY (tenant_id, fee_cash_transaction_id)
           REFERENCES cash_transactions(tenant_id, id)`
      );
    }
    if (
      !(await hasForeignKey(
        connection,
        "cash_exchange_batches",
        "fk_cash_exchange_rev_fee_txn_tenant"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cash_exchange_batches
         ADD CONSTRAINT fk_cash_exchange_rev_fee_txn_tenant
           FOREIGN KEY (tenant_id, reversal_fee_cash_transaction_id)
           REFERENCES cash_transactions(tenant_id, id)`
      );
    }
  },
};

export default migration096CashExchangeFeeSpreadAccounting;

