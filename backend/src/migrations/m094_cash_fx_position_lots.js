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

const migration094CashFxPositionLots = {
  key: "m094_cash_fx_position_lots",
  description:
    "Add foreign-currency cash position lots and lot movement tables for disposal realized FX tracking",
  async up(connection) {
    await safeExecute(
      connection,
      `CREATE TABLE IF NOT EXISTS cash_fx_position_lots (
         id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
         tenant_id BIGINT UNSIGNED NOT NULL,
         legal_entity_id BIGINT UNSIGNED NOT NULL,
         cash_register_id BIGINT UNSIGNED NOT NULL,
         account_id BIGINT UNSIGNED NOT NULL,
         currency_code CHAR(3) NOT NULL,
         opened_by_cash_transaction_id BIGINT UNSIGNED NOT NULL,
         open_book_date DATE NOT NULL,
         original_amount_txn DECIMAL(20,6) NOT NULL,
         original_amount_base DECIMAL(20,6) NOT NULL,
         remaining_amount_txn DECIMAL(20,6) NOT NULL,
         remaining_amount_base DECIMAL(20,6) NOT NULL,
         unit_cost_base DECIMAL(20,10) NOT NULL,
         status ENUM('OPEN','CLOSED') NOT NULL DEFAULT 'OPEN',
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
         UNIQUE KEY uk_cash_fx_lot_opened_txn (tenant_id, opened_by_cash_transaction_id),
         KEY ix_cash_fx_lot_scope (tenant_id, legal_entity_id, cash_register_id, currency_code, status),
         KEY ix_cash_fx_lot_open_date (tenant_id, cash_register_id, currency_code, open_book_date, id),
         CONSTRAINT fk_cash_fx_lot_tenant
           FOREIGN KEY (tenant_id) REFERENCES tenants(id),
         CONSTRAINT fk_cash_fx_lot_legal_entity
           FOREIGN KEY (legal_entity_id) REFERENCES legal_entities(id),
         CONSTRAINT fk_cash_fx_lot_register
           FOREIGN KEY (cash_register_id) REFERENCES cash_registers(id),
         CONSTRAINT fk_cash_fx_lot_account
           FOREIGN KEY (account_id) REFERENCES accounts(id),
         CONSTRAINT fk_cash_fx_lot_currency
           FOREIGN KEY (currency_code) REFERENCES currencies(code),
         CONSTRAINT fk_cash_fx_lot_opened_txn
           FOREIGN KEY (opened_by_cash_transaction_id) REFERENCES cash_transactions(id),
         CHECK (original_amount_txn > 0),
         CHECK (original_amount_base > 0),
         CHECK (remaining_amount_txn >= 0),
         CHECK (remaining_amount_base >= 0),
         CHECK (unit_cost_base > 0)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );

    await safeExecute(
      connection,
      `CREATE TABLE IF NOT EXISTS cash_fx_lot_movements (
         id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
         tenant_id BIGINT UNSIGNED NOT NULL,
         legal_entity_id BIGINT UNSIGNED NOT NULL,
         cash_register_id BIGINT UNSIGNED NOT NULL,
         currency_code CHAR(3) NOT NULL,
         cash_transaction_id BIGINT UNSIGNED NOT NULL,
         lot_id BIGINT UNSIGNED NOT NULL,
         line_no INT NOT NULL,
         movement_direction ENUM('IN','OUT') NOT NULL,
         movement_amount_txn DECIMAL(20,6) NOT NULL,
         movement_amount_base DECIMAL(20,6) NOT NULL,
         carrying_amount_base DECIMAL(20,6) NOT NULL,
         realized_fx_base DECIMAL(20,6) NOT NULL DEFAULT 0.000000,
         posted_journal_entry_id BIGINT UNSIGNED NULL,
         reversal_of_movement_id BIGINT UNSIGNED NULL,
         source_module VARCHAR(20) NULL,
         source_entity_type VARCHAR(80) NULL,
         source_entity_id VARCHAR(80) NULL,
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         UNIQUE KEY uk_cash_fx_lot_mv_txn_line (tenant_id, cash_transaction_id, line_no),
         UNIQUE KEY uk_cash_fx_lot_mv_reversal (reversal_of_movement_id),
         KEY ix_cash_fx_lot_mv_scope (tenant_id, legal_entity_id, cash_register_id, currency_code),
         KEY ix_cash_fx_lot_mv_lot (tenant_id, lot_id, id),
         KEY ix_cash_fx_lot_mv_txn (tenant_id, cash_transaction_id),
         CONSTRAINT fk_cash_fx_lot_mv_tenant
           FOREIGN KEY (tenant_id) REFERENCES tenants(id),
         CONSTRAINT fk_cash_fx_lot_mv_legal_entity
           FOREIGN KEY (legal_entity_id) REFERENCES legal_entities(id),
         CONSTRAINT fk_cash_fx_lot_mv_register
           FOREIGN KEY (cash_register_id) REFERENCES cash_registers(id),
         CONSTRAINT fk_cash_fx_lot_mv_currency
           FOREIGN KEY (currency_code) REFERENCES currencies(code),
         CONSTRAINT fk_cash_fx_lot_mv_cash_txn
           FOREIGN KEY (cash_transaction_id) REFERENCES cash_transactions(id),
         CONSTRAINT fk_cash_fx_lot_mv_lot
           FOREIGN KEY (lot_id) REFERENCES cash_fx_position_lots(id),
         CONSTRAINT fk_cash_fx_lot_mv_journal
           FOREIGN KEY (posted_journal_entry_id) REFERENCES journal_entries(id),
         CONSTRAINT fk_cash_fx_lot_mv_reversal
           FOREIGN KEY (reversal_of_movement_id) REFERENCES cash_fx_lot_movements(id),
         CHECK (line_no > 0),
         CHECK (movement_amount_txn > 0),
         CHECK (movement_amount_base > 0),
         CHECK (carrying_amount_base > 0)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
  },
};

export default migration094CashFxPositionLots;
