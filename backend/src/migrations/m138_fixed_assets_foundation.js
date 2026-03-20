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
    if (ignorableErrnos.has(err?.errno)) {
      return;
    }
    throw err;
  }
}

const migration138FixedAssetsFoundation = {
  key: "m138_fixed_assets_foundation",
  description:
    "Fixed-assets foundation base tables, constraints, and indexes (PR-FA09/FA10)",
  async up(connection) {
    // ── 1. fixed_asset_depreciation_profiles ─────────────────────────
    await safeExecute(
      connection,
      `CREATE TABLE IF NOT EXISTS fixed_asset_depreciation_profiles (
         id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
         tenant_id BIGINT UNSIGNED NOT NULL,
         legal_entity_id BIGINT UNSIGNED NOT NULL,
         code VARCHAR(100) NOT NULL,
         name VARCHAR(255) NOT NULL,
         status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
         method ENUM('STRAIGHT_LINE','DECLINING_BALANCE','NONE') NOT NULL,
         declining_balance_rate_percent DECIMAL(7,4) NULL,
         switch_to_straight_line TINYINT(1) NOT NULL DEFAULT 0,
         description VARCHAR(500) NULL,
         created_by_user_id INT NULL,
         updated_by_user_id INT NULL,
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
           ON UPDATE CURRENT_TIMESTAMP,
         CONSTRAINT fk_fadp_tenant
           FOREIGN KEY (tenant_id) REFERENCES tenants(id),
         CONSTRAINT fk_fadp_legal_entity
           FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES legal_entities(tenant_id, id),
         CONSTRAINT fk_fadp_created_user
           FOREIGN KEY (tenant_id, created_by_user_id) REFERENCES users(tenant_id, id),
         CONSTRAINT fk_fadp_updated_user
           FOREIGN KEY (tenant_id, updated_by_user_id) REFERENCES users(tenant_id, id)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );

    // ── 2. fixed_asset_categories ────────────────────────────────────
    // default_depreciation_profile_id FK is deferred (forward ref)
    await safeExecute(
      connection,
      `CREATE TABLE IF NOT EXISTS fixed_asset_categories (
         id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
         tenant_id BIGINT UNSIGNED NOT NULL,
         legal_entity_id BIGINT UNSIGNED NOT NULL,
         code VARCHAR(100) NOT NULL,
         name VARCHAR(255) NOT NULL,
         status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
         description VARCHAR(500) NULL,
         capitalization_threshold_base DECIMAL(18,4) NULL,
         default_useful_life_months INT UNSIGNED NULL,
         default_salvage_rule_type ENUM('NONE','FIXED_BASE_AMOUNT','PERCENT_OF_COST') NOT NULL DEFAULT 'NONE',
         default_salvage_percent DECIMAL(7,4) NULL,
         default_salvage_amount_base DECIMAL(18,4) NULL,
         default_depreciation_profile_id BIGINT UNSIGNED NULL,
         default_asset_account_id BIGINT UNSIGNED NULL,
         default_accum_depr_account_id BIGINT UNSIGNED NULL,
         default_depr_expense_account_id BIGINT UNSIGNED NULL,
         default_disposal_gain_account_id BIGINT UNSIGNED NULL,
         default_disposal_loss_account_id BIGINT UNSIGNED NULL,
         created_by_user_id INT NULL,
         updated_by_user_id INT NULL,
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
           ON UPDATE CURRENT_TIMESTAMP,
         CONSTRAINT fk_fac_tenant
           FOREIGN KEY (tenant_id) REFERENCES tenants(id),
         CONSTRAINT fk_fac_legal_entity
           FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES legal_entities(tenant_id, id),
         CONSTRAINT fk_fac_default_asset_account
           FOREIGN KEY (default_asset_account_id) REFERENCES accounts(id),
         CONSTRAINT fk_fac_default_accum_depr_account
           FOREIGN KEY (default_accum_depr_account_id) REFERENCES accounts(id),
         CONSTRAINT fk_fac_default_depr_expense_account
           FOREIGN KEY (default_depr_expense_account_id) REFERENCES accounts(id),
         CONSTRAINT fk_fac_default_disposal_gain_account
           FOREIGN KEY (default_disposal_gain_account_id) REFERENCES accounts(id),
         CONSTRAINT fk_fac_default_disposal_loss_account
           FOREIGN KEY (default_disposal_loss_account_id) REFERENCES accounts(id),
         CONSTRAINT fk_fac_created_user
           FOREIGN KEY (tenant_id, created_by_user_id) REFERENCES users(tenant_id, id),
         CONSTRAINT fk_fac_updated_user
           FOREIGN KEY (tenant_id, updated_by_user_id) REFERENCES users(tenant_id, id)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );

    // ── 3. fixed_assets ──────────────────────────────────────────────
    // custodian_employee_id FK deferred to m139
    await safeExecute(
      connection,
      `CREATE TABLE IF NOT EXISTS fixed_assets (
         id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
         tenant_id BIGINT UNSIGNED NOT NULL,
         legal_entity_id BIGINT UNSIGNED NOT NULL,
         asset_no VARCHAR(100) NOT NULL,
         sequence_no BIGINT UNSIGNED NOT NULL,
         asset_tag VARCHAR(255) NULL,
         name VARCHAR(255) NOT NULL,
         description VARCHAR(1000) NULL,
         category_id BIGINT UNSIGNED NOT NULL,
         status ENUM('DRAFT','ACTIVE','SUSPENDED','FULLY_DEPRECIATED','DISPOSED') NOT NULL DEFAULT 'DRAFT',
         owner_operating_unit_id BIGINT UNSIGNED NULL,
         location_operating_unit_id BIGINT UNSIGNED NULL,
         department_code VARCHAR(100) NULL,
         cost_center_code VARCHAR(100) NULL,
         custodian_employee_id BIGINT UNSIGNED NULL,
         counterparty_id BIGINT UNSIGNED NULL,
         source_cari_document_id BIGINT UNSIGNED NULL,
         source_cari_document_line_id BIGINT UNSIGNED NULL,
         source_cari_document_line_unit_no INT UNSIGNED NULL,
         serial_no VARCHAR(255) NULL,
         acquisition_date DATE NOT NULL,
         capitalization_date DATE NULL,
         in_service_date DATE NULL,
         disposal_date DATE NULL,
         currency_code VARCHAR(10) NOT NULL,
         original_cost_txn DECIMAL(18,4) NOT NULL DEFAULT 0,
         original_cost_base DECIMAL(18,4) NOT NULL DEFAULT 0,
         salvage_rule_type ENUM('NONE','FIXED_BASE_AMOUNT','PERCENT_OF_COST') NOT NULL DEFAULT 'NONE',
         salvage_percent DECIMAL(7,4) NULL,
         salvage_amount_base_rule DECIMAL(18,4) NULL,
         salvage_value_txn DECIMAL(18,4) NOT NULL DEFAULT 0,
         salvage_value_base DECIMAL(18,4) NOT NULL DEFAULT 0,
         useful_life_months INT UNSIGNED NULL,
         remaining_useful_life_months INT UNSIGNED NULL,
         depreciation_profile_id BIGINT UNSIGNED NULL,
         depreciation_method ENUM('STRAIGHT_LINE','DECLINING_BALANCE','NONE') NULL,
         declining_balance_rate_percent DECIMAL(7,4) NULL,
         switch_to_straight_line TINYINT(1) NOT NULL DEFAULT 0,
         asset_account_id BIGINT UNSIGNED NULL,
         accum_depr_account_id BIGINT UNSIGNED NULL,
         depr_expense_account_id BIGINT UNSIGNED NULL,
         disposal_gain_account_id BIGINT UNSIGNED NULL,
         disposal_loss_account_id BIGINT UNSIGNED NULL,
         legacy_accum_depr_txn DECIMAL(18,4) NULL,
         legacy_accum_depr_base DECIMAL(18,4) NULL,
         legacy_nbv_txn DECIMAL(18,4) NULL,
         legacy_nbv_base DECIMAL(18,4) NULL,
         last_depreciation_period VARCHAR(7) NULL,
         created_by_user_id INT NULL,
         updated_by_user_id INT NULL,
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
           ON UPDATE CURRENT_TIMESTAMP,
         CONSTRAINT fk_fa_tenant
           FOREIGN KEY (tenant_id) REFERENCES tenants(id),
         CONSTRAINT fk_fa_legal_entity
           FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES legal_entities(tenant_id, id),
         CONSTRAINT fk_fa_category
           FOREIGN KEY (category_id) REFERENCES fixed_asset_categories(id),
         CONSTRAINT fk_fa_owner_ou
           FOREIGN KEY (owner_operating_unit_id) REFERENCES operating_units(id),
         CONSTRAINT fk_fa_location_ou
           FOREIGN KEY (location_operating_unit_id) REFERENCES operating_units(id),
         CONSTRAINT fk_fa_depreciation_profile
           FOREIGN KEY (depreciation_profile_id) REFERENCES fixed_asset_depreciation_profiles(id),
         CONSTRAINT fk_fa_asset_account
           FOREIGN KEY (asset_account_id) REFERENCES accounts(id),
         CONSTRAINT fk_fa_accum_depr_account
           FOREIGN KEY (accum_depr_account_id) REFERENCES accounts(id),
         CONSTRAINT fk_fa_depr_expense_account
           FOREIGN KEY (depr_expense_account_id) REFERENCES accounts(id),
         CONSTRAINT fk_fa_disposal_gain_account
           FOREIGN KEY (disposal_gain_account_id) REFERENCES accounts(id),
         CONSTRAINT fk_fa_disposal_loss_account
           FOREIGN KEY (disposal_loss_account_id) REFERENCES accounts(id),
         CONSTRAINT fk_fa_created_user
           FOREIGN KEY (tenant_id, created_by_user_id) REFERENCES users(tenant_id, id),
         CONSTRAINT fk_fa_updated_user
           FOREIGN KEY (tenant_id, updated_by_user_id) REFERENCES users(tenant_id, id)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );

    // ── 4. fixed_asset_depreciation_runs ─────────────────────────────
    await safeExecute(
      connection,
      `CREATE TABLE IF NOT EXISTS fixed_asset_depreciation_runs (
         id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
         tenant_id BIGINT UNSIGNED NOT NULL,
         legal_entity_id BIGINT UNSIGNED NOT NULL,
         book_id BIGINT UNSIGNED NOT NULL,
         fiscal_period_id BIGINT UNSIGNED NOT NULL,
         period_key VARCHAR(7) NOT NULL,
         status ENUM('DRAFT','POSTED','REVERSED') NOT NULL DEFAULT 'DRAFT',
         asset_count INT UNSIGNED NOT NULL DEFAULT 0,
         posted_asset_count INT UNSIGNED NOT NULL DEFAULT 0,
         skipped_asset_count INT UNSIGNED NOT NULL DEFAULT 0,
         error_count INT UNSIGNED NOT NULL DEFAULT 0,
         total_planned_amount_txn DECIMAL(18,4) NOT NULL DEFAULT 0,
         total_planned_amount_base DECIMAL(18,4) NOT NULL DEFAULT 0,
         total_posted_amount_txn DECIMAL(18,4) NOT NULL DEFAULT 0,
         total_posted_amount_base DECIMAL(18,4) NOT NULL DEFAULT 0,
         posted_journal_entry_id BIGINT UNSIGNED NULL,
         reversal_journal_entry_id BIGINT UNSIGNED NULL,
         created_by_user_id INT NULL,
         posted_by_user_id INT NULL,
         reversed_by_user_id INT NULL,
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         posted_at TIMESTAMP NULL,
         reversed_at TIMESTAMP NULL,
         CONSTRAINT fk_fadr_tenant
           FOREIGN KEY (tenant_id) REFERENCES tenants(id),
         CONSTRAINT fk_fadr_legal_entity
           FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES legal_entities(tenant_id, id),
         CONSTRAINT fk_fadr_book
           FOREIGN KEY (book_id) REFERENCES books(id),
         CONSTRAINT fk_fadr_fiscal_period
           FOREIGN KEY (fiscal_period_id) REFERENCES fiscal_periods(id),
         CONSTRAINT fk_fadr_posted_journal
           FOREIGN KEY (posted_journal_entry_id) REFERENCES journal_entries(id),
         CONSTRAINT fk_fadr_reversal_journal
           FOREIGN KEY (reversal_journal_entry_id) REFERENCES journal_entries(id),
         CONSTRAINT fk_fadr_created_user
           FOREIGN KEY (tenant_id, created_by_user_id) REFERENCES users(tenant_id, id),
         CONSTRAINT fk_fadr_posted_user
           FOREIGN KEY (tenant_id, posted_by_user_id) REFERENCES users(tenant_id, id),
         CONSTRAINT fk_fadr_reversed_user
           FOREIGN KEY (tenant_id, reversed_by_user_id) REFERENCES users(tenant_id, id)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );

    // ── 5. fixed_asset_transactions ──────────────────────────────────
    await safeExecute(
      connection,
      `CREATE TABLE IF NOT EXISTS fixed_asset_transactions (
         id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
         tenant_id BIGINT UNSIGNED NOT NULL,
         legal_entity_id BIGINT UNSIGNED NOT NULL,
         asset_id BIGINT UNSIGNED NOT NULL,
         transaction_type ENUM('ACQUISITION','CAPITALIZATION','DEPRECIATION','SUSPEND','REACTIVATE','PHYSICAL_MOVE','OWNERSHIP_TRANSFER','WRITEOFF','SALE','REVERSAL') NOT NULL,
         status ENUM('DRAFT','POSTED','REVERSED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
         effective_date DATE NOT NULL,
         posting_date DATE NULL,
         book_id BIGINT UNSIGNED NULL,
         fiscal_period_id BIGINT UNSIGNED NULL,
         currency_code VARCHAR(10) NOT NULL,
         depreciation_kind ENUM('RUN','LOW_VALUE_FULL_EXPENSE') NULL,
         gross_amount_txn DECIMAL(18,4) NULL,
         gross_amount_base DECIMAL(18,4) NULL,
         accum_depr_amount_txn DECIMAL(18,4) NULL,
         accum_depr_amount_base DECIMAL(18,4) NULL,
         nbv_amount_txn DECIMAL(18,4) NULL,
         nbv_amount_base DECIMAL(18,4) NULL,
         proceeds_amount_txn DECIMAL(18,4) NULL,
         proceeds_amount_base DECIMAL(18,4) NULL,
         journal_entry_id BIGINT UNSIGNED NULL,
         source_ref_type VARCHAR(60) NULL,
         source_ref_id BIGINT UNSIGNED NULL,
         source_ref_line_id BIGINT UNSIGNED NULL,
         reversed_transaction_id BIGINT UNSIGNED NULL,
         reversal_transaction_id BIGINT UNSIGNED NULL,
         note VARCHAR(1000) NULL,
         created_by_user_id INT NULL,
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
           ON UPDATE CURRENT_TIMESTAMP,
         CONSTRAINT fk_fat_tenant
           FOREIGN KEY (tenant_id) REFERENCES tenants(id),
         CONSTRAINT fk_fat_legal_entity
           FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES legal_entities(tenant_id, id),
         CONSTRAINT fk_fat_asset
           FOREIGN KEY (asset_id) REFERENCES fixed_assets(id),
         CONSTRAINT fk_fat_book
           FOREIGN KEY (book_id) REFERENCES books(id),
         CONSTRAINT fk_fat_fiscal_period
           FOREIGN KEY (fiscal_period_id) REFERENCES fiscal_periods(id),
         CONSTRAINT fk_fat_journal_entry
           FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id),
         CONSTRAINT fk_fat_created_user
           FOREIGN KEY (tenant_id, created_by_user_id) REFERENCES users(tenant_id, id)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );

    // ── 6. fixed_asset_depreciation_schedule_lines ───────────────────
    // posted_run_line_id FK is deferred (forward ref to run_lines)
    await safeExecute(
      connection,
      `CREATE TABLE IF NOT EXISTS fixed_asset_depreciation_schedule_lines (
         id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
         tenant_id BIGINT UNSIGNED NOT NULL,
         legal_entity_id BIGINT UNSIGNED NOT NULL,
         asset_id BIGINT UNSIGNED NOT NULL,
         period_key VARCHAR(7) NOT NULL,
         line_no INT UNSIGNED NOT NULL,
         planned_amount_txn DECIMAL(18,4) NOT NULL DEFAULT 0,
         planned_amount_base DECIMAL(18,4) NOT NULL DEFAULT 0,
         opening_nbv_txn DECIMAL(18,4) NOT NULL DEFAULT 0,
         opening_nbv_base DECIMAL(18,4) NOT NULL DEFAULT 0,
         closing_nbv_txn DECIMAL(18,4) NOT NULL DEFAULT 0,
         closing_nbv_base DECIMAL(18,4) NOT NULL DEFAULT 0,
         status ENUM('PLANNED','POSTED','SKIPPED','REVERSED') NOT NULL DEFAULT 'PLANNED',
         posted_run_line_id BIGINT UNSIGNED NULL,
         posted_transaction_id BIGINT UNSIGNED NULL,
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
           ON UPDATE CURRENT_TIMESTAMP,
         CONSTRAINT fk_fadsl_tenant
           FOREIGN KEY (tenant_id) REFERENCES tenants(id),
         CONSTRAINT fk_fadsl_legal_entity
           FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES legal_entities(tenant_id, id),
         CONSTRAINT fk_fadsl_asset
           FOREIGN KEY (asset_id) REFERENCES fixed_assets(id),
         CONSTRAINT fk_fadsl_posted_transaction
           FOREIGN KEY (posted_transaction_id) REFERENCES fixed_asset_transactions(id)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );

    // ── 7. fixed_asset_depreciation_run_lines ────────────────────────
    // schedule_line_id FK is deferred (circular ref to schedule_lines)
    await safeExecute(
      connection,
      `CREATE TABLE IF NOT EXISTS fixed_asset_depreciation_run_lines (
         id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
         tenant_id BIGINT UNSIGNED NOT NULL,
         legal_entity_id BIGINT UNSIGNED NOT NULL,
         run_id BIGINT UNSIGNED NOT NULL,
         asset_id BIGINT UNSIGNED NOT NULL,
         fiscal_period_id BIGINT UNSIGNED NOT NULL,
         period_key VARCHAR(7) NOT NULL,
         schedule_line_id BIGINT UNSIGNED NULL,
         eligible_days INT UNSIGNED NOT NULL DEFAULT 0,
         days_in_period INT UNSIGNED NOT NULL DEFAULT 0,
         planned_amount_txn DECIMAL(18,4) NOT NULL DEFAULT 0,
         planned_amount_base DECIMAL(18,4) NOT NULL DEFAULT 0,
         status ENUM('READY','POSTED','SKIPPED','ERROR','REVERSED') NOT NULL DEFAULT 'READY',
         posted_transaction_id BIGINT UNSIGNED NULL,
         skip_reason_code VARCHAR(60) NULL,
         skip_reason_text VARCHAR(500) NULL,
         error_code VARCHAR(60) NULL,
         error_message VARCHAR(1000) NULL,
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
           ON UPDATE CURRENT_TIMESTAMP,
         CONSTRAINT fk_fadrl_tenant
           FOREIGN KEY (tenant_id) REFERENCES tenants(id),
         CONSTRAINT fk_fadrl_legal_entity
           FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES legal_entities(tenant_id, id),
         CONSTRAINT fk_fadrl_run
           FOREIGN KEY (run_id) REFERENCES fixed_asset_depreciation_runs(id),
         CONSTRAINT fk_fadrl_asset
           FOREIGN KEY (asset_id) REFERENCES fixed_assets(id),
         CONSTRAINT fk_fadrl_fiscal_period
           FOREIGN KEY (fiscal_period_id) REFERENCES fiscal_periods(id),
         CONSTRAINT fk_fadrl_posted_transaction
           FOREIGN KEY (posted_transaction_id) REFERENCES fixed_asset_transactions(id)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );

    // ── 8. fixed_asset_depreciation_run_line_allocations ─────────────
    await safeExecute(
      connection,
      `CREATE TABLE IF NOT EXISTS fixed_asset_depreciation_run_line_allocations (
         id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
         tenant_id BIGINT UNSIGNED NOT NULL,
         legal_entity_id BIGINT UNSIGNED NOT NULL,
         run_line_id BIGINT UNSIGNED NOT NULL,
         asset_id BIGINT UNSIGNED NOT NULL,
         fiscal_period_id BIGINT UNSIGNED NOT NULL,
         period_key VARCHAR(7) NOT NULL,
         allocation_type ENUM('OWNER_OU') NOT NULL,
         operating_unit_id BIGINT UNSIGNED NULL,
         from_date DATE NOT NULL,
         to_date DATE NOT NULL,
         eligible_days INT UNSIGNED NOT NULL DEFAULT 0,
         planned_amount_txn DECIMAL(18,4) NOT NULL DEFAULT 0,
         planned_amount_base DECIMAL(18,4) NOT NULL DEFAULT 0,
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
           ON UPDATE CURRENT_TIMESTAMP,
         CONSTRAINT fk_fadrla_tenant
           FOREIGN KEY (tenant_id) REFERENCES tenants(id),
         CONSTRAINT fk_fadrla_legal_entity
           FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES legal_entities(tenant_id, id),
         CONSTRAINT fk_fadrla_run_line
           FOREIGN KEY (run_line_id) REFERENCES fixed_asset_depreciation_run_lines(id),
         CONSTRAINT fk_fadrla_asset
           FOREIGN KEY (asset_id) REFERENCES fixed_assets(id),
         CONSTRAINT fk_fadrla_fiscal_period
           FOREIGN KEY (fiscal_period_id) REFERENCES fiscal_periods(id),
         CONSTRAINT fk_fadrla_operating_unit
           FOREIGN KEY (operating_unit_id) REFERENCES operating_units(id)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );

    // ── 9. fixed_asset_physical_move_details ─────────────────────────
    // custodian FK columns deferred to m139
    await safeExecute(
      connection,
      `CREATE TABLE IF NOT EXISTS fixed_asset_physical_move_details (
         id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
         tenant_id BIGINT UNSIGNED NOT NULL,
         legal_entity_id BIGINT UNSIGNED NOT NULL,
         transaction_id BIGINT UNSIGNED NOT NULL,
         asset_id BIGINT UNSIGNED NOT NULL,
         from_location_operating_unit_id BIGINT UNSIGNED NOT NULL,
         to_location_operating_unit_id BIGINT UNSIGNED NOT NULL,
         from_custodian_employee_id BIGINT UNSIGNED NULL,
         to_custodian_employee_id BIGINT UNSIGNED NULL,
         from_department_code VARCHAR(100) NULL,
         to_department_code VARCHAR(100) NULL,
         from_cost_center_code VARCHAR(100) NULL,
         to_cost_center_code VARCHAR(100) NULL,
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
           ON UPDATE CURRENT_TIMESTAMP,
         CONSTRAINT fk_fapmd_tenant
           FOREIGN KEY (tenant_id) REFERENCES tenants(id),
         CONSTRAINT fk_fapmd_legal_entity
           FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES legal_entities(tenant_id, id),
         CONSTRAINT fk_fapmd_transaction
           FOREIGN KEY (transaction_id) REFERENCES fixed_asset_transactions(id),
         CONSTRAINT fk_fapmd_asset
           FOREIGN KEY (asset_id) REFERENCES fixed_assets(id),
         CONSTRAINT fk_fapmd_from_location_ou
           FOREIGN KEY (from_location_operating_unit_id) REFERENCES operating_units(id),
         CONSTRAINT fk_fapmd_to_location_ou
           FOREIGN KEY (to_location_operating_unit_id) REFERENCES operating_units(id)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );

    // ── 10. fixed_asset_ownership_transfer_details ───────────────────
    await safeExecute(
      connection,
      `CREATE TABLE IF NOT EXISTS fixed_asset_ownership_transfer_details (
         id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
         tenant_id BIGINT UNSIGNED NOT NULL,
         legal_entity_id BIGINT UNSIGNED NOT NULL,
         transaction_id BIGINT UNSIGNED NOT NULL,
         asset_id BIGINT UNSIGNED NOT NULL,
         from_owner_operating_unit_id BIGINT UNSIGNED NOT NULL,
         to_owner_operating_unit_id BIGINT UNSIGNED NOT NULL,
         from_location_operating_unit_id BIGINT UNSIGNED NOT NULL,
         to_location_operating_unit_id BIGINT UNSIGNED NOT NULL,
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
           ON UPDATE CURRENT_TIMESTAMP,
         CONSTRAINT fk_faotd_tenant
           FOREIGN KEY (tenant_id) REFERENCES tenants(id),
         CONSTRAINT fk_faotd_legal_entity
           FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES legal_entities(tenant_id, id),
         CONSTRAINT fk_faotd_transaction
           FOREIGN KEY (transaction_id) REFERENCES fixed_asset_transactions(id),
         CONSTRAINT fk_faotd_asset
           FOREIGN KEY (asset_id) REFERENCES fixed_assets(id),
         CONSTRAINT fk_faotd_from_owner_ou
           FOREIGN KEY (from_owner_operating_unit_id) REFERENCES operating_units(id),
         CONSTRAINT fk_faotd_to_owner_ou
           FOREIGN KEY (to_owner_operating_unit_id) REFERENCES operating_units(id),
         CONSTRAINT fk_faotd_from_location_ou
           FOREIGN KEY (from_location_operating_unit_id) REFERENCES operating_units(id),
         CONSTRAINT fk_faotd_to_location_ou
           FOREIGN KEY (to_location_operating_unit_id) REFERENCES operating_units(id)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );

    // ── Deferred intra-m138 foreign keys (ALTER TABLE) ───────────────
    // Now that both referenced tables exist, add the forward/circular FKs.

    // categories → depreciation_profiles
    await safeExecute(
      connection,
      `ALTER TABLE fixed_asset_categories
         ADD CONSTRAINT fk_fac_default_depreciation_profile
         FOREIGN KEY (default_depreciation_profile_id)
         REFERENCES fixed_asset_depreciation_profiles(id)`
    );

    // schedule_lines → run_lines (forward ref)
    await safeExecute(
      connection,
      `ALTER TABLE fixed_asset_depreciation_schedule_lines
         ADD CONSTRAINT fk_fadsl_posted_run_line
         FOREIGN KEY (posted_run_line_id)
         REFERENCES fixed_asset_depreciation_run_lines(id)`
    );

    // run_lines → schedule_lines (circular ref)
    await safeExecute(
      connection,
      `ALTER TABLE fixed_asset_depreciation_run_lines
         ADD CONSTRAINT fk_fadrl_schedule_line
         FOREIGN KEY (schedule_line_id)
         REFERENCES fixed_asset_depreciation_schedule_lines(id)`
    );

    // ══════════════════════════════════════════════════════════════════
    // FA10: Constraints, uniqueness guards, and reporting indexes
    // ══════════════════════════════════════════════════════════════════

    // ── Unique guards ────────────────────────────────────────────────

    // depreciation_profiles: unique code per tenant + legal_entity
    await safeExecute(
      connection,
      `ALTER TABLE fixed_asset_depreciation_profiles
         ADD UNIQUE KEY uk_fadp_code (tenant_id, legal_entity_id, code)`
    );

    // categories: unique code per tenant + legal_entity
    await safeExecute(
      connection,
      `ALTER TABLE fixed_asset_categories
         ADD UNIQUE KEY uk_fac_code (tenant_id, legal_entity_id, code)`
    );

    // fixed_assets: unique asset_no per tenant + legal_entity
    await safeExecute(
      connection,
      `ALTER TABLE fixed_assets
         ADD UNIQUE KEY uk_fa_asset_no (tenant_id, legal_entity_id, asset_no)`
    );

    // fixed_assets: unique sequence_no per tenant + legal_entity
    await safeExecute(
      connection,
      `ALTER TABLE fixed_assets
         ADD UNIQUE KEY uk_fa_sequence_no (tenant_id, legal_entity_id, sequence_no)`
    );

    // fixed_assets: CARI-linked multi-asset provenance uniqueness
    // NULLs pass through in MySQL unique indexes, so non-CARI assets are unaffected
    await safeExecute(
      connection,
      `ALTER TABLE fixed_assets
         ADD UNIQUE KEY uk_fa_cari_provenance
           (tenant_id, source_cari_document_line_id, source_cari_document_line_unit_no)`
    );

    // transactions: reversal lineage — unique non-null reversed_transaction_id
    // MySQL allows multiple NULLs, so only actual reversals enforce one-reversal-per-original
    await safeExecute(
      connection,
      `ALTER TABLE fixed_asset_transactions
         ADD UNIQUE KEY uk_fat_reversed_transaction (reversed_transaction_id)`
    );

    // one-detail-row-per-transaction: physical_move_details
    await safeExecute(
      connection,
      `ALTER TABLE fixed_asset_physical_move_details
         ADD UNIQUE KEY uk_fapmd_transaction (transaction_id)`
    );

    // one-detail-row-per-transaction: ownership_transfer_details
    await safeExecute(
      connection,
      `ALTER TABLE fixed_asset_ownership_transfer_details
         ADD UNIQUE KEY uk_faotd_transaction (transaction_id)`
    );

    // ── Self-referencing FKs for reversal lineage ────────────────────

    await safeExecute(
      connection,
      `ALTER TABLE fixed_asset_transactions
         ADD CONSTRAINT fk_fat_reversed_transaction
         FOREIGN KEY (reversed_transaction_id) REFERENCES fixed_asset_transactions(id)`
    );

    await safeExecute(
      connection,
      `ALTER TABLE fixed_asset_transactions
         ADD CONSTRAINT fk_fat_reversal_transaction
         FOREIGN KEY (reversal_transaction_id) REFERENCES fixed_asset_transactions(id)`
    );

    // ── MySQL-realistic generated-column uniqueness ──────────────────

    // Persisted-DRAFT run: at most one DRAFT per (tenant, le, book, fiscal_period).
    // Strategy: generated STORED column that is 0 for DRAFT, NULL otherwise.
    // MySQL unique indexes treat NULLs as distinct, so only DRAFT rows collide.
    await safeExecute(
      connection,
      `ALTER TABLE fixed_asset_depreciation_runs
         ADD COLUMN draft_guard TINYINT UNSIGNED
           GENERATED ALWAYS AS (IF(status = 'DRAFT', 0, NULL)) STORED`
    );

    await safeExecute(
      connection,
      `ALTER TABLE fixed_asset_depreciation_runs
         ADD UNIQUE KEY uk_fadr_draft_guard
           (tenant_id, legal_entity_id, book_id, fiscal_period_id, draft_guard)`
    );

    // Current-effective posted depreciation per asset + period.
    // Strategy: generated STORED column that is 0 for POSTED, NULL otherwise.
    // When a schedule line is REVERSED, the guard becomes NULL, freeing
    // the slot for repost without stranding the asset-period pair.
    await safeExecute(
      connection,
      `ALTER TABLE fixed_asset_depreciation_schedule_lines
         ADD COLUMN current_posted_guard TINYINT UNSIGNED
           GENERATED ALWAYS AS (IF(status = 'POSTED', 0, NULL)) STORED`
    );

    await safeExecute(
      connection,
      `ALTER TABLE fixed_asset_depreciation_schedule_lines
         ADD UNIQUE KEY uk_fadsl_current_posted
           (tenant_id, legal_entity_id, asset_id, period_key, current_posted_guard)`
    );

    // ── Reporting and lookup indexes ─────────────────────────────────

    // Register filtering: legal_entity + owner OU + status
    await safeExecute(
      connection,
      `ALTER TABLE fixed_assets
         ADD KEY ix_fa_register
           (tenant_id, legal_entity_id, owner_operating_unit_id, status)`
    );

    // Source CARI document lookup
    await safeExecute(
      connection,
      `ALTER TABLE fixed_assets
         ADD KEY ix_fa_cari_source (tenant_id, source_cari_document_id)`
    );

    // Asset transaction history reporting
    await safeExecute(
      connection,
      `ALTER TABLE fixed_asset_transactions
         ADD KEY ix_fat_asset_history
           (tenant_id, legal_entity_id, asset_id, effective_date)`
    );

    // Transaction status lookup
    await safeExecute(
      connection,
      `ALTER TABLE fixed_asset_transactions
         ADD KEY ix_fat_status (tenant_id, legal_entity_id, status)`
    );

    // Depreciation-run reporting
    await safeExecute(
      connection,
      `ALTER TABLE fixed_asset_depreciation_runs
         ADD KEY ix_fadr_report
           (tenant_id, legal_entity_id, book_id, fiscal_period_id, status)`
    );

    // Schedule-line asset + period lookup
    await safeExecute(
      connection,
      `ALTER TABLE fixed_asset_depreciation_schedule_lines
         ADD KEY ix_fadsl_asset_period
           (tenant_id, legal_entity_id, asset_id, period_key)`
    );

    // Run-line run + asset lookup
    await safeExecute(
      connection,
      `ALTER TABLE fixed_asset_depreciation_run_lines
         ADD KEY ix_fadrl_run_asset (run_id, asset_id)`
    );

    // Allocation: asset + fiscal period reporting
    await safeExecute(
      connection,
      `ALTER TABLE fixed_asset_depreciation_run_line_allocations
         ADD KEY ix_fadrla_asset_period
           (tenant_id, legal_entity_id, asset_id, fiscal_period_id)`
    );

    // Allocation: operating-unit reporting
    await safeExecute(
      connection,
      `ALTER TABLE fixed_asset_depreciation_run_line_allocations
         ADD KEY ix_fadrla_ou_period
           (tenant_id, legal_entity_id, operating_unit_id, fiscal_period_id)`
    );

    // Move-detail: asset lookup
    await safeExecute(
      connection,
      `ALTER TABLE fixed_asset_physical_move_details
         ADD KEY ix_fapmd_asset (asset_id)`
    );

    // Transfer-detail: asset lookup
    await safeExecute(
      connection,
      `ALTER TABLE fixed_asset_ownership_transfer_details
         ADD KEY ix_faotd_asset (asset_id)`
    );
  },
};

export default migration138FixedAssetsFoundation;
