const ignorableErrnos = new Set([
  1050, // ER_TABLE_EXISTS_ERROR
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

const migration091CashExchangeBatches = {
  key: "m091_cash_exchange_batches",
  description:
    "Add cash_exchange_batches workflow table for explicit cross-currency cash exchange with idempotent posting and reversal links",
  async up(connection) {
    await safeExecute(
      connection,
      `CREATE TABLE IF NOT EXISTS cash_exchange_batches (
         id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
         tenant_id BIGINT UNSIGNED NOT NULL,
         legal_entity_id BIGINT UNSIGNED NOT NULL,
         source_cash_register_id BIGINT UNSIGNED NOT NULL,
         target_cash_register_id BIGINT UNSIGNED NOT NULL,
         source_currency_code CHAR(3) NOT NULL,
         target_currency_code CHAR(3) NOT NULL,
         source_amount_txn DECIMAL(20,6) NOT NULL,
         target_amount_txn DECIMAL(20,6) NOT NULL,
         source_amount_base DECIMAL(20,6) NULL,
         target_amount_base DECIMAL(20,6) NULL,
         clearing_account_id BIGINT UNSIGNED NOT NULL,
         fx_rate DECIMAL(20,10) NULL,
         fx_rate_source VARCHAR(40) NULL,
         fx_rate_date DATE NULL,
         status ENUM('DRAFT','POSTED','REVERSED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
         exchange_out_cash_transaction_id BIGINT UNSIGNED NULL,
         exchange_in_cash_transaction_id BIGINT UNSIGNED NULL,
         reversal_out_cash_transaction_id BIGINT UNSIGNED NULL,
         reversal_in_cash_transaction_id BIGINT UNSIGNED NULL,
         posted_by_user_id INT NULL,
         reversed_by_user_id INT NULL,
         posted_at TIMESTAMP NULL,
         reversed_at TIMESTAMP NULL,
         reverse_reason VARCHAR(255) NULL,
         idempotency_key VARCHAR(100) NOT NULL,
         integration_event_uid VARCHAR(100) NULL,
         source_module VARCHAR(40) NOT NULL DEFAULT 'CASH',
         source_entity_type VARCHAR(60) NOT NULL DEFAULT 'cash_exchange_batch',
         source_entity_id VARCHAR(120) NULL,
         note VARCHAR(500) NULL,
         created_by_user_id INT NOT NULL,
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
         UNIQUE KEY uk_cash_exchange_tenant_source_register_idem (
           tenant_id,
           source_cash_register_id,
           idempotency_key
         ),
         UNIQUE KEY uk_cash_exchange_tenant_event_uid (tenant_id, integration_event_uid),
         UNIQUE KEY uk_cash_exchange_tenant_out_txn (tenant_id, exchange_out_cash_transaction_id),
         UNIQUE KEY uk_cash_exchange_tenant_in_txn (tenant_id, exchange_in_cash_transaction_id),
         KEY ix_cash_exchange_tenant_status (tenant_id, status, updated_at),
         KEY ix_cash_exchange_tenant_source_target_status (
           tenant_id,
           source_cash_register_id,
           target_cash_register_id,
           status
         ),
         CONSTRAINT fk_cash_exchange_tenant
           FOREIGN KEY (tenant_id) REFERENCES tenants(id),
         CONSTRAINT fk_cash_exchange_legal_entity
           FOREIGN KEY (legal_entity_id) REFERENCES legal_entities(id),
         CONSTRAINT fk_cash_exchange_source_register
           FOREIGN KEY (source_cash_register_id) REFERENCES cash_registers(id),
         CONSTRAINT fk_cash_exchange_target_register
           FOREIGN KEY (target_cash_register_id) REFERENCES cash_registers(id),
         CONSTRAINT fk_cash_exchange_source_currency
           FOREIGN KEY (source_currency_code) REFERENCES currencies(code),
         CONSTRAINT fk_cash_exchange_target_currency
           FOREIGN KEY (target_currency_code) REFERENCES currencies(code),
         CONSTRAINT fk_cash_exchange_clearing_account
           FOREIGN KEY (clearing_account_id) REFERENCES accounts(id),
         CONSTRAINT fk_cash_exchange_out_txn_tenant
           FOREIGN KEY (tenant_id, exchange_out_cash_transaction_id)
           REFERENCES cash_transactions(tenant_id, id),
         CONSTRAINT fk_cash_exchange_in_txn_tenant
           FOREIGN KEY (tenant_id, exchange_in_cash_transaction_id)
           REFERENCES cash_transactions(tenant_id, id),
         CONSTRAINT fk_cash_exchange_rev_out_txn_tenant
           FOREIGN KEY (tenant_id, reversal_out_cash_transaction_id)
           REFERENCES cash_transactions(tenant_id, id),
         CONSTRAINT fk_cash_exchange_rev_in_txn_tenant
           FOREIGN KEY (tenant_id, reversal_in_cash_transaction_id)
           REFERENCES cash_transactions(tenant_id, id),
         CONSTRAINT fk_cash_exchange_posted_by
           FOREIGN KEY (posted_by_user_id) REFERENCES users(id),
         CONSTRAINT fk_cash_exchange_reversed_by
           FOREIGN KEY (reversed_by_user_id) REFERENCES users(id),
         CONSTRAINT fk_cash_exchange_created_by
           FOREIGN KEY (created_by_user_id) REFERENCES users(id),
         CHECK (source_amount_txn > 0),
         CHECK (target_amount_txn > 0),
         CHECK (source_cash_register_id <> target_cash_register_id),
         CHECK (source_currency_code <> target_currency_code),
         CHECK (fx_rate IS NULL OR fx_rate > 0),
         CHECK (idempotency_key IS NOT NULL AND CHAR_LENGTH(idempotency_key) > 0),
         CHECK (integration_event_uid IS NULL OR CHAR_LENGTH(integration_event_uid) > 0)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );

    if (!(await hasIndex(connection, "cash_exchange_batches", "ix_cash_exchange_tenant_status"))) {
      await safeExecute(
        connection,
        `ALTER TABLE cash_exchange_batches
         ADD KEY ix_cash_exchange_tenant_status (tenant_id, status, updated_at)`
      );
    }
    if (
      !(await hasIndex(
        connection,
        "cash_exchange_batches",
        "ix_cash_exchange_tenant_source_target_status"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cash_exchange_batches
         ADD KEY ix_cash_exchange_tenant_source_target_status (
           tenant_id,
           source_cash_register_id,
           target_cash_register_id,
           status
         )`
      );
    }

    if (
      !(await hasForeignKey(
        connection,
        "cash_exchange_batches",
        "fk_cash_exchange_out_txn_tenant"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cash_exchange_batches
         ADD CONSTRAINT fk_cash_exchange_out_txn_tenant
         FOREIGN KEY (tenant_id, exchange_out_cash_transaction_id)
         REFERENCES cash_transactions(tenant_id, id)`
      );
    }
    if (
      !(await hasForeignKey(
        connection,
        "cash_exchange_batches",
        "fk_cash_exchange_in_txn_tenant"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cash_exchange_batches
         ADD CONSTRAINT fk_cash_exchange_in_txn_tenant
         FOREIGN KEY (tenant_id, exchange_in_cash_transaction_id)
         REFERENCES cash_transactions(tenant_id, id)`
      );
    }
    if (
      !(await hasForeignKey(
        connection,
        "cash_exchange_batches",
        "fk_cash_exchange_rev_out_txn_tenant"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cash_exchange_batches
         ADD CONSTRAINT fk_cash_exchange_rev_out_txn_tenant
         FOREIGN KEY (tenant_id, reversal_out_cash_transaction_id)
         REFERENCES cash_transactions(tenant_id, id)`
      );
    }
    if (
      !(await hasForeignKey(
        connection,
        "cash_exchange_batches",
        "fk_cash_exchange_rev_in_txn_tenant"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cash_exchange_batches
         ADD CONSTRAINT fk_cash_exchange_rev_in_txn_tenant
         FOREIGN KEY (tenant_id, reversal_in_cash_transaction_id)
         REFERENCES cash_transactions(tenant_id, id)`
      );
    }
  },
};

export default migration091CashExchangeBatches;
