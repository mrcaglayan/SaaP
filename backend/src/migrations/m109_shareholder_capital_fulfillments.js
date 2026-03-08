const migration109ShareholderCapitalFulfillments = {
  key: "m109_shareholder_capital_fulfillments",
  description:
    "Add shareholder capital fulfillment workflow table for Option B branch self-balancing support (CF02)",
  async up(connection) {
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS shareholder_capital_fulfillments (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        tenant_id BIGINT UNSIGNED NOT NULL,
        legal_entity_id BIGINT UNSIGNED NOT NULL,
        shareholder_id BIGINT UNSIGNED NOT NULL,
        operating_unit_id BIGINT UNSIGNED NULL,
        destination_mode ENUM('BANK_ACCOUNT','ASSET_GL') NOT NULL,
        bank_account_id BIGINT UNSIGNED NULL,
        destination_account_id BIGINT UNSIGNED NULL,
        amount_base DECIMAL(18,6) NOT NULL,
        currency_code CHAR(3) NOT NULL,
        contribution_kind ENUM('CASH','IN_KIND') NOT NULL,
        status ENUM('POSTED','REVERSED') NOT NULL DEFAULT 'POSTED',
        journal_entry_id BIGINT UNSIGNED NOT NULL,
        reversal_journal_entry_id BIGINT UNSIGNED NULL,
        contribution_date DATE NOT NULL,
        note VARCHAR(500) NULL,
        created_by_user_id INT NOT NULL,
        posted_by_user_id INT NOT NULL,
        reversed_by_user_id INT NULL,
        reversed_at TIMESTAMP NULL DEFAULT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_sh_cap_fulfillments_journal (journal_entry_id),
        UNIQUE KEY uk_sh_cap_fulfillments_reversal_journal (reversal_journal_entry_id),
        KEY ix_sh_cap_fulfillments_tenant_entity_status_date (
          tenant_id,
          legal_entity_id,
          status,
          contribution_date,
          id
        ),
        KEY ix_sh_cap_fulfillments_tenant_shareholder_date (
          tenant_id,
          shareholder_id,
          contribution_date,
          id
        ),
        KEY ix_sh_cap_fulfillments_tenant_ou_date (
          tenant_id,
          operating_unit_id,
          contribution_date,
          id
        ),
        CONSTRAINT fk_sh_cap_fulfillments_tenant
          FOREIGN KEY (tenant_id) REFERENCES tenants(id),
        CONSTRAINT fk_sh_cap_fulfillments_entity
          FOREIGN KEY (legal_entity_id) REFERENCES legal_entities(id),
        CONSTRAINT fk_sh_cap_fulfillments_shareholder
          FOREIGN KEY (shareholder_id) REFERENCES shareholders(id),
        CONSTRAINT fk_sh_cap_fulfillments_operating_unit
          FOREIGN KEY (operating_unit_id) REFERENCES operating_units(id),
        CONSTRAINT fk_sh_cap_fulfillments_bank_account
          FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id),
        CONSTRAINT fk_sh_cap_fulfillments_destination_account
          FOREIGN KEY (destination_account_id) REFERENCES accounts(id),
        CONSTRAINT fk_sh_cap_fulfillments_journal
          FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id),
        CONSTRAINT fk_sh_cap_fulfillments_reversal_journal
          FOREIGN KEY (reversal_journal_entry_id) REFERENCES journal_entries(id),
        CONSTRAINT fk_sh_cap_fulfillments_created_by
          FOREIGN KEY (created_by_user_id) REFERENCES users(id),
        CONSTRAINT fk_sh_cap_fulfillments_posted_by
          FOREIGN KEY (posted_by_user_id) REFERENCES users(id),
        CONSTRAINT fk_sh_cap_fulfillments_reversed_by
          FOREIGN KEY (reversed_by_user_id) REFERENCES users(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  },

  async down() {
    // Non-destructive migration policy: no down-op for additive workflow tables.
  },
};

export default migration109ShareholderCapitalFulfillments;
