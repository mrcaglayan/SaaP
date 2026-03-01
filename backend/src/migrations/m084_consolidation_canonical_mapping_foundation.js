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
  CREATE TABLE IF NOT EXISTS consolidation_canonical_keys (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    consolidation_group_id BIGINT UNSIGNED NOT NULL,
    canonical_key VARCHAR(120) NOT NULL,
    canonical_name VARCHAR(255) NOT NULL,
    canonical_type ENUM('ACCOUNT','PURPOSE') NOT NULL DEFAULT 'ACCOUNT',
    purpose_code VARCHAR(80) NULL,
    status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_cons_canonical_key (tenant_id, consolidation_group_id, canonical_key),
    KEY ix_cons_canonical_keys_group_status (tenant_id, consolidation_group_id, status),
    KEY ix_cons_canonical_keys_purpose (tenant_id, consolidation_group_id, purpose_code),
    CONSTRAINT fk_cons_canonical_key_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_cons_canonical_key_group
      FOREIGN KEY (consolidation_group_id) REFERENCES consolidation_groups(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
  `
  CREATE TABLE IF NOT EXISTS consolidation_canonical_local_account_mappings (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    consolidation_group_id BIGINT UNSIGNED NOT NULL,
    legal_entity_id BIGINT UNSIGNED NOT NULL,
    local_account_id BIGINT UNSIGNED NOT NULL,
    canonical_key_id BIGINT UNSIGNED NOT NULL,
    status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    effective_from DATE NOT NULL DEFAULT (CURRENT_DATE),
    effective_to DATE NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_cons_local_account_map (
      tenant_id,
      consolidation_group_id,
      legal_entity_id,
      local_account_id
    ),
    KEY ix_cons_local_account_map_key (tenant_id, consolidation_group_id, canonical_key_id, status),
    KEY ix_cons_local_account_map_effective (
      tenant_id,
      consolidation_group_id,
      legal_entity_id,
      status,
      effective_from,
      effective_to
    ),
    CONSTRAINT fk_cons_local_account_map_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_cons_local_account_map_group
      FOREIGN KEY (consolidation_group_id) REFERENCES consolidation_groups(id),
    CONSTRAINT fk_cons_local_account_map_legal_entity
      FOREIGN KEY (legal_entity_id) REFERENCES legal_entities(id),
    CONSTRAINT fk_cons_local_account_map_local_account
      FOREIGN KEY (local_account_id) REFERENCES accounts(id),
    CONSTRAINT fk_cons_local_account_map_key
      FOREIGN KEY (canonical_key_id) REFERENCES consolidation_canonical_keys(id)
      ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
  `
  CREATE TABLE IF NOT EXISTS consolidation_canonical_group_account_mappings (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    consolidation_group_id BIGINT UNSIGNED NOT NULL,
    canonical_key_id BIGINT UNSIGNED NOT NULL,
    group_account_id BIGINT UNSIGNED NOT NULL,
    status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    effective_from DATE NOT NULL DEFAULT (CURRENT_DATE),
    effective_to DATE NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_cons_group_account_map (
      tenant_id,
      consolidation_group_id,
      canonical_key_id
    ),
    KEY ix_cons_group_account_map_account (tenant_id, consolidation_group_id, group_account_id, status),
    KEY ix_cons_group_account_map_effective (
      tenant_id,
      consolidation_group_id,
      status,
      effective_from,
      effective_to
    ),
    CONSTRAINT fk_cons_group_account_map_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_cons_group_account_map_group
      FOREIGN KEY (consolidation_group_id) REFERENCES consolidation_groups(id),
    CONSTRAINT fk_cons_group_account_map_key
      FOREIGN KEY (canonical_key_id) REFERENCES consolidation_canonical_keys(id)
      ON DELETE CASCADE,
    CONSTRAINT fk_cons_group_account_map_group_account
      FOREIGN KEY (group_account_id) REFERENCES accounts(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
];

const migration084ConsolidationCanonicalMappingFoundation = {
  key: "m084_consolidation_canonical_mapping_foundation",
  description:
    "Canonical consolidation mapping schema: local account -> canonical key -> group account",
  async up(connection) {
    for (const statement of statements) {
      await safeExecute(connection, statement);
    }
  },

  async down() {
    // Non-destructive migration policy: no down-op for additive hardening.
  },
};

export default migration084ConsolidationCanonicalMappingFoundation;
