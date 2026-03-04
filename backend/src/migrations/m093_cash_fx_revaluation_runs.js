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

const migration093CashFxRevaluationRuns = {
  key: "m093_cash_fx_revaluation_runs",
  description:
    "Add foreign-currency cash FX revaluation run/line tables for month-end and year-end unrealized FX tracking",
  async up(connection) {
    await safeExecute(
      connection,
      `CREATE TABLE IF NOT EXISTS cash_fx_revaluation_runs (
         id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
         tenant_id BIGINT UNSIGNED NOT NULL,
         legal_entity_id BIGINT UNSIGNED NOT NULL,
         book_id BIGINT UNSIGNED NOT NULL,
         fiscal_period_id BIGINT UNSIGNED NOT NULL,
         run_type ENUM('MONTH_END','YEAR_END') NOT NULL,
         status ENUM('DRAFT','COMPLETED','FAILED','REVERSED') NOT NULL DEFAULT 'DRAFT',
         period_end_date DATE NOT NULL,
         base_currency_code CHAR(3) NOT NULL,
         fx_rate_type VARCHAR(20) NOT NULL DEFAULT 'SPOT',
         fx_fallback_mode VARCHAR(20) NULL,
         fx_fallback_max_days INT NULL,
         foreign_balance_count INT NOT NULL DEFAULT 0,
         line_count INT NOT NULL DEFAULT 0,
         total_carrying_base DECIMAL(20,6) NOT NULL DEFAULT 0.000000,
         total_closing_base DECIMAL(20,6) NOT NULL DEFAULT 0.000000,
         total_delta_base DECIMAL(20,6) NOT NULL DEFAULT 0.000000,
         journal_entry_id BIGINT UNSIGNED NULL,
         reversal_journal_entry_id BIGINT UNSIGNED NULL,
         close_gate_override BOOLEAN NOT NULL DEFAULT FALSE,
         close_gate_override_reason VARCHAR(255) NULL,
         note VARCHAR(500) NULL,
         run_hash CHAR(64) NOT NULL,
         idempotency_key VARCHAR(100) NOT NULL,
         source VARCHAR(30) NOT NULL DEFAULT 'MANUAL',
         app_job_id BIGINT UNSIGNED NULL,
         requested_by_user_id INT NULL,
         completed_by_user_id INT NULL,
         completed_at TIMESTAMP NULL,
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
         UNIQUE KEY uk_cash_fx_reval_scope_hash (
           tenant_id,
           book_id,
           fiscal_period_id,
           run_type,
           run_hash
         ),
         UNIQUE KEY uk_cash_fx_reval_scope_idem (
           tenant_id,
           book_id,
           fiscal_period_id,
           run_type,
           idempotency_key
         ),
         KEY ix_cash_fx_reval_scope_status (
           tenant_id,
           legal_entity_id,
           status,
           period_end_date
         ),
         KEY ix_cash_fx_reval_scope_period (
           tenant_id,
           book_id,
           fiscal_period_id,
           run_type,
           status
         ),
         CONSTRAINT fk_cash_fx_reval_run_tenant
           FOREIGN KEY (tenant_id) REFERENCES tenants(id),
         CONSTRAINT fk_cash_fx_reval_run_legal_entity
           FOREIGN KEY (legal_entity_id) REFERENCES legal_entities(id),
         CONSTRAINT fk_cash_fx_reval_run_book
           FOREIGN KEY (book_id) REFERENCES books(id),
         CONSTRAINT fk_cash_fx_reval_run_period
           FOREIGN KEY (fiscal_period_id) REFERENCES fiscal_periods(id),
         CONSTRAINT fk_cash_fx_reval_run_base_currency
           FOREIGN KEY (base_currency_code) REFERENCES currencies(code),
         CONSTRAINT fk_cash_fx_reval_run_journal
           FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id),
         CONSTRAINT fk_cash_fx_reval_run_reversal_journal
           FOREIGN KEY (reversal_journal_entry_id) REFERENCES journal_entries(id),
         CONSTRAINT fk_cash_fx_reval_run_app_job
           FOREIGN KEY (app_job_id) REFERENCES app_jobs(id),
         CONSTRAINT fk_cash_fx_reval_run_requested_by
           FOREIGN KEY (requested_by_user_id) REFERENCES users(id),
         CONSTRAINT fk_cash_fx_reval_run_completed_by
           FOREIGN KEY (completed_by_user_id) REFERENCES users(id),
         CHECK (CHAR_LENGTH(run_hash) = 64),
         CHECK (CHAR_LENGTH(idempotency_key) > 0),
         CHECK (fx_fallback_max_days IS NULL OR fx_fallback_max_days >= 0),
         CHECK (close_gate_override = FALSE OR close_gate_override_reason IS NOT NULL)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );

    await safeExecute(
      connection,
      `CREATE TABLE IF NOT EXISTS cash_fx_revaluation_lines (
         id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
         tenant_id BIGINT UNSIGNED NOT NULL,
         cash_fx_revaluation_run_id BIGINT UNSIGNED NOT NULL,
         line_no INT NOT NULL,
         cash_register_id BIGINT UNSIGNED NOT NULL,
         account_id BIGINT UNSIGNED NOT NULL,
         operating_unit_id BIGINT UNSIGNED NULL,
         currency_code CHAR(3) NOT NULL,
         balance_amount_txn DECIMAL(20,6) NOT NULL DEFAULT 0.000000,
         carrying_amount_base DECIMAL(20,6) NOT NULL DEFAULT 0.000000,
         closing_fx_rate DECIMAL(20,10) NOT NULL,
         closing_fx_rate_source VARCHAR(40) NULL,
         closing_fx_rate_date DATE NOT NULL,
         closing_amount_base DECIMAL(20,6) NOT NULL DEFAULT 0.000000,
         delta_base DECIMAL(20,6) NOT NULL DEFAULT 0.000000,
         gain_loss_account_id BIGINT UNSIGNED NULL,
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         UNIQUE KEY uk_cash_fx_reval_line_no (cash_fx_revaluation_run_id, line_no),
         KEY ix_cash_fx_reval_line_scope (tenant_id, currency_code, cash_register_id),
         KEY ix_cash_fx_reval_line_delta (tenant_id, delta_base),
         CONSTRAINT fk_cash_fx_reval_line_tenant
           FOREIGN KEY (tenant_id) REFERENCES tenants(id),
         CONSTRAINT fk_cash_fx_reval_line_run
           FOREIGN KEY (cash_fx_revaluation_run_id) REFERENCES cash_fx_revaluation_runs(id),
         CONSTRAINT fk_cash_fx_reval_line_register
           FOREIGN KEY (cash_register_id) REFERENCES cash_registers(id),
         CONSTRAINT fk_cash_fx_reval_line_account
           FOREIGN KEY (account_id) REFERENCES accounts(id),
         CONSTRAINT fk_cash_fx_reval_line_operating_unit
           FOREIGN KEY (operating_unit_id) REFERENCES operating_units(id),
         CONSTRAINT fk_cash_fx_reval_line_currency
           FOREIGN KEY (currency_code) REFERENCES currencies(code),
         CONSTRAINT fk_cash_fx_reval_line_gain_loss_account
           FOREIGN KEY (gain_loss_account_id) REFERENCES accounts(id),
         CHECK (closing_fx_rate > 0)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
  },
};

export default migration093CashFxRevaluationRuns;
