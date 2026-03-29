/**
 * m155 - Fixed-asset retro ownership transfer corrections foundation.
 *
 * Adds the persisted audit tables and transaction taxonomy needed for
 * late-entered ownership-transfer correction workflows.
 */

const ignorableErrnos = new Set([
  1050, // ER_TABLE_EXISTS_ERROR
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

async function hasRetroOwnershipCorrectionTransactionType(connection) {
  const [rows] = await connection.execute(
    `SELECT COLUMN_TYPE AS column_type
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'fixed_asset_transactions'
        AND column_name = 'transaction_type'
      LIMIT 1`
  );
  const columnType = String(rows?.[0]?.column_type || "").toUpperCase();
  return columnType.includes("'RETRO_OWNERSHIP_CORRECTION'");
}

const createTableStatements = [
  `
  CREATE TABLE IF NOT EXISTS fixed_asset_retro_transfer_corrections (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    legal_entity_id BIGINT UNSIGNED NOT NULL,
    asset_id BIGINT UNSIGNED NOT NULL,
    from_owner_operating_unit_id BIGINT UNSIGNED NOT NULL,
    to_owner_operating_unit_id BIGINT UNSIGNED NOT NULL,
    actual_effective_date DATE NOT NULL,
    correction_posting_date DATE NOT NULL,
    balance_sheet_transfer_posting_date DATE NOT NULL,
    resolution_mode ENUM('CURRENT_PERIOD_TRUE_UP') NOT NULL DEFAULT 'CURRENT_PERIOD_TRUE_UP',
    status ENUM('POSTED','SUPERSEDED') NOT NULL DEFAULT 'POSTED',
    note VARCHAR(1000) NULL,
    posted_by_user_id INT NULL,
    replaces_correction_id BIGINT UNSIGNED NULL,
    replaced_by_correction_id BIGINT UNSIGNED NULL,
    true_up_transaction_id BIGINT UNSIGNED NULL,
    true_up_journal_entry_id BIGINT UNSIGNED NULL,
    owner_move_transaction_id BIGINT UNSIGNED NULL,
    owner_move_journal_entry_id BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_fartc_true_up_tx (true_up_transaction_id),
    UNIQUE KEY uk_fartc_owner_move_tx (owner_move_transaction_id),
    UNIQUE KEY uk_fartc_true_up_journal (true_up_journal_entry_id),
    UNIQUE KEY uk_fartc_owner_move_journal (owner_move_journal_entry_id),
    KEY ix_fartc_tenant_asset_status_effective (
      tenant_id,
      asset_id,
      status,
      actual_effective_date
    ),
    KEY ix_fartc_tenant_asset_posting_date (
      tenant_id,
      asset_id,
      correction_posting_date
    ),
    KEY ix_fartc_tenant_asset_status_posting (
      tenant_id,
      asset_id,
      status,
      correction_posting_date
    ),
    KEY ix_fartc_replaces (replaces_correction_id),
    KEY ix_fartc_replaced_by (replaced_by_correction_id),
    CONSTRAINT fk_fartc_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_fartc_entity
      FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES legal_entities(tenant_id, id),
    CONSTRAINT fk_fartc_asset
      FOREIGN KEY (asset_id) REFERENCES fixed_assets(id),
    CONSTRAINT fk_fartc_from_owner_ou
      FOREIGN KEY (from_owner_operating_unit_id) REFERENCES operating_units(id),
    CONSTRAINT fk_fartc_to_owner_ou
      FOREIGN KEY (to_owner_operating_unit_id) REFERENCES operating_units(id),
    CONSTRAINT fk_fartc_posted_user
      FOREIGN KEY (tenant_id, posted_by_user_id) REFERENCES users(tenant_id, id),
    CONSTRAINT fk_fartc_replaces
      FOREIGN KEY (replaces_correction_id) REFERENCES fixed_asset_retro_transfer_corrections(id),
    CONSTRAINT fk_fartc_replaced_by
      FOREIGN KEY (replaced_by_correction_id) REFERENCES fixed_asset_retro_transfer_corrections(id),
    CONSTRAINT fk_fartc_true_up_tx
      FOREIGN KEY (true_up_transaction_id) REFERENCES fixed_asset_transactions(id),
    CONSTRAINT fk_fartc_true_up_journal
      FOREIGN KEY (true_up_journal_entry_id) REFERENCES journal_entries(id),
    CONSTRAINT fk_fartc_owner_move_tx
      FOREIGN KEY (owner_move_transaction_id) REFERENCES fixed_asset_transactions(id),
    CONSTRAINT fk_fartc_owner_move_journal
      FOREIGN KEY (owner_move_journal_entry_id) REFERENCES journal_entries(id),
    CHECK (from_owner_operating_unit_id <> to_owner_operating_unit_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
  `
  CREATE TABLE IF NOT EXISTS fixed_asset_retro_transfer_correction_periods (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    legal_entity_id BIGINT UNSIGNED NOT NULL,
    correction_id BIGINT UNSIGNED NOT NULL,
    period_key VARCHAR(7) NOT NULL,
    posted_depreciation_run_id BIGINT UNSIGNED NULL,
    from_owner_operating_unit_id BIGINT UNSIGNED NOT NULL,
    to_owner_operating_unit_id BIGINT UNSIGNED NOT NULL,
    source_eligible_days INT UNSIGNED NOT NULL DEFAULT 0,
    target_eligible_days INT UNSIGNED NOT NULL DEFAULT 0,
    originally_posted_source_amount_txn DECIMAL(18,4) NOT NULL DEFAULT 0,
    originally_posted_source_amount_base DECIMAL(18,4) NOT NULL DEFAULT 0,
    originally_posted_target_amount_txn DECIMAL(18,4) NOT NULL DEFAULT 0,
    originally_posted_target_amount_base DECIMAL(18,4) NOT NULL DEFAULT 0,
    corrected_source_amount_txn DECIMAL(18,4) NOT NULL DEFAULT 0,
    corrected_source_amount_base DECIMAL(18,4) NOT NULL DEFAULT 0,
    corrected_target_amount_txn DECIMAL(18,4) NOT NULL DEFAULT 0,
    corrected_target_amount_base DECIMAL(18,4) NOT NULL DEFAULT 0,
    delta_amount_txn DECIMAL(18,4) NOT NULL DEFAULT 0,
    delta_amount_base DECIMAL(18,4) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_fartcp_correction_period (correction_id, period_key),
    KEY ix_fartcp_tenant_correction (tenant_id, legal_entity_id, correction_id),
    KEY ix_fartcp_tenant_run (tenant_id, legal_entity_id, posted_depreciation_run_id),
    KEY ix_fartcp_tenant_period (tenant_id, legal_entity_id, period_key),
    CONSTRAINT fk_fartcp_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_fartcp_entity
      FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES legal_entities(tenant_id, id),
    CONSTRAINT fk_fartcp_correction
      FOREIGN KEY (correction_id) REFERENCES fixed_asset_retro_transfer_corrections(id)
      ON DELETE CASCADE,
    CONSTRAINT fk_fartcp_run
      FOREIGN KEY (posted_depreciation_run_id) REFERENCES fixed_asset_depreciation_runs(id),
    CONSTRAINT fk_fartcp_from_owner_ou
      FOREIGN KEY (from_owner_operating_unit_id) REFERENCES operating_units(id),
    CONSTRAINT fk_fartcp_to_owner_ou
      FOREIGN KEY (to_owner_operating_unit_id) REFERENCES operating_units(id),
    CHECK (from_owner_operating_unit_id <> to_owner_operating_unit_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
];

const migration155FixedAssetRetroTransferCorrections = {
  key: "m155_fixed_asset_retro_transfer_corrections",
  description:
    "Add retro ownership transfer correction taxonomy and persisted audit tables.",
  async up(connection) {
    if (!(await hasRetroOwnershipCorrectionTransactionType(connection))) {
      await connection.execute(
        `ALTER TABLE fixed_asset_transactions
           MODIFY COLUMN transaction_type ENUM(
             'ACQUISITION',
             'CAPITALIZATION',
             'DEPRECIATION',
             'SUSPEND',
             'REACTIVATE',
             'PHYSICAL_MOVE',
             'OWNERSHIP_TRANSFER',
             'RETRO_OWNERSHIP_CORRECTION',
             'WRITEOFF',
             'SALE',
             'IMPROVEMENT',
             'REVERSAL'
           ) NOT NULL`
      );
    }

    for (const statement of createTableStatements) {
      await safeExecute(connection, statement);
    }
  },
};

export default migration155FixedAssetRetroTransferCorrections;
