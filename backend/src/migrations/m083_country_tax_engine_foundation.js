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

const statements = [
  `
  CREATE TABLE IF NOT EXISTS tax_regimes (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    country_id BIGINT UNSIGNED NOT NULL,
    legal_entity_id BIGINT UNSIGNED NULL,
    code VARCHAR(60) NOT NULL,
    name VARCHAR(255) NOT NULL,
    currency_code CHAR(3) NOT NULL,
    effective_from DATE NOT NULL,
    effective_to DATE NULL,
    status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    created_by_user_id INT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_tax_regimes_code_effective (tenant_id, code, effective_from),
    KEY ix_tax_regimes_resolver (
      tenant_id,
      country_id,
      legal_entity_id,
      status,
      effective_from,
      effective_to
    ),
    CONSTRAINT fk_tax_regimes_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_tax_regimes_country
      FOREIGN KEY (country_id) REFERENCES countries(id),
    CONSTRAINT fk_tax_regimes_legal_entity
      FOREIGN KEY (legal_entity_id) REFERENCES legal_entities(id),
    CONSTRAINT fk_tax_regimes_created_by
      FOREIGN KEY (created_by_user_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
  `
  CREATE TABLE IF NOT EXISTS tax_codes (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    tax_regime_id BIGINT UNSIGNED NOT NULL,
    code VARCHAR(40) NOT NULL,
    name VARCHAR(255) NOT NULL,
    tax_kind ENUM('VAT','WITHHOLDING','STAMP','OTHER') NOT NULL,
    rate_pct DECIMAL(9,4) NOT NULL,
    calculation_mode ENUM('EXCLUSIVE','INCLUSIVE') NOT NULL,
    recoverability ENUM('FULL','PARTIAL','NONE') NOT NULL DEFAULT 'FULL',
    is_reverse_charge BOOLEAN NOT NULL DEFAULT FALSE,
    status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_tax_codes_regime_code (tenant_id, tax_regime_id, code),
    KEY ix_tax_codes_resolver (tenant_id, tax_regime_id, status, tax_kind),
    CONSTRAINT fk_tax_codes_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_tax_codes_regime
      FOREIGN KEY (tax_regime_id) REFERENCES tax_regimes(id)
      ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
  `
  CREATE TABLE IF NOT EXISTS tax_rule_sets (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    tax_regime_id BIGINT UNSIGNED NOT NULL,
    tax_code_id BIGINT UNSIGNED NOT NULL,
    module_code ENUM('CARI','BANK','PAYROLL','CONTRACTS','GL_MANUAL') NOT NULL,
    document_type VARCHAR(60) NULL,
    counterparty_type ENUM('CUSTOMER','VENDOR','EMPLOYEE','GOVERNMENT','OTHER') NULL,
    apply_priority INT NOT NULL DEFAULT 100,
    formula_json JSON NOT NULL,
    status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    effective_from DATE NOT NULL,
    effective_to DATE NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY ix_tax_rule_sets_resolver (
      tenant_id,
      tax_regime_id,
      module_code,
      status,
      effective_from,
      effective_to,
      apply_priority
    ),
    KEY ix_tax_rule_sets_tax_code (tenant_id, tax_code_id, status),
    CONSTRAINT fk_tax_rule_sets_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_tax_rule_sets_regime
      FOREIGN KEY (tax_regime_id) REFERENCES tax_regimes(id)
      ON DELETE CASCADE,
    CONSTRAINT fk_tax_rule_sets_tax_code
      FOREIGN KEY (tax_code_id) REFERENCES tax_codes(id)
      ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
  `
  CREATE TABLE IF NOT EXISTS tax_account_mappings (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    tax_regime_id BIGINT UNSIGNED NOT NULL,
    legal_entity_id BIGINT UNSIGNED NOT NULL,
    tax_code_id BIGINT UNSIGNED NOT NULL,
    tax_purpose_code ENUM(
      'VAT_INPUT',
      'VAT_OUTPUT',
      'VAT_PAYABLE',
      'VAT_RECEIVABLE',
      'WITHHOLDING_PAYABLE',
      'WITHHOLDING_RECEIVABLE',
      'ROUNDING'
    ) NOT NULL,
    account_id BIGINT UNSIGNED NOT NULL,
    status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_tax_account_map_scope (
      tenant_id,
      legal_entity_id,
      tax_code_id,
      tax_purpose_code
    ),
    KEY ix_tax_account_map_resolver (
      tenant_id,
      tax_regime_id,
      legal_entity_id,
      tax_code_id,
      status
    ),
    KEY ix_tax_account_map_account (account_id),
    CONSTRAINT fk_tax_account_map_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_tax_account_map_regime
      FOREIGN KEY (tax_regime_id) REFERENCES tax_regimes(id)
      ON DELETE CASCADE,
    CONSTRAINT fk_tax_account_map_legal_entity
      FOREIGN KEY (legal_entity_id) REFERENCES legal_entities(id),
    CONSTRAINT fk_tax_account_map_tax_code
      FOREIGN KEY (tax_code_id) REFERENCES tax_codes(id)
      ON DELETE CASCADE,
    CONSTRAINT fk_tax_account_map_account
      FOREIGN KEY (account_id) REFERENCES accounts(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
];

const migration083CountryTaxEngineFoundation = {
  key: "m083_country_tax_engine_foundation",
  description:
    "Country tax engine foundation schema (regimes, codes, rules, and account mappings)",
  async up(connection) {
    for (const statement of statements) {
      await safeExecute(connection, statement);
    }
  },

  async down() {
    // Non-destructive migration policy: no down-op for additive hardening.
  },
};

export default migration083CountryTaxEngineFoundation;

