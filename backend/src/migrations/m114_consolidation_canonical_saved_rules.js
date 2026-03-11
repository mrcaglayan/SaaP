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
  CREATE TABLE IF NOT EXISTS consolidation_canonical_mapping_rules (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    consolidation_group_id BIGINT UNSIGNED NOT NULL,
    legal_entity_id BIGINT UNSIGNED NOT NULL,
    rule_type ENUM('DESCENDANTS_OF_ACCOUNT','CODE_PREFIX') NOT NULL,
    parent_local_account_id BIGINT UNSIGNED NULL,
    code_prefix VARCHAR(64) NULL,
    canonical_key_id BIGINT UNSIGNED NOT NULL,
    group_account_id BIGINT UNSIGNED NULL,
    status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    effective_from DATE NOT NULL,
    effective_to DATE NULL,
    reason VARCHAR(500) NULL,
    created_by_user_id INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY ix_cons_canonical_rule_group_status (
      tenant_id,
      consolidation_group_id,
      status,
      rule_type
    ),
    KEY ix_cons_canonical_rule_legal_entity (
      tenant_id,
      consolidation_group_id,
      legal_entity_id,
      status
    ),
    KEY ix_cons_canonical_rule_key (
      tenant_id,
      consolidation_group_id,
      canonical_key_id,
      status
    ),
    CONSTRAINT fk_cons_canonical_rule_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_cons_canonical_rule_group
      FOREIGN KEY (consolidation_group_id) REFERENCES consolidation_groups(id),
    CONSTRAINT fk_cons_canonical_rule_legal_entity
      FOREIGN KEY (legal_entity_id) REFERENCES legal_entities(id),
    CONSTRAINT fk_cons_canonical_rule_parent_local_account
      FOREIGN KEY (parent_local_account_id) REFERENCES accounts(id),
    CONSTRAINT fk_cons_canonical_rule_key
      FOREIGN KEY (canonical_key_id) REFERENCES consolidation_canonical_keys(id)
      ON DELETE CASCADE,
    CONSTRAINT fk_cons_canonical_rule_group_account
      FOREIGN KEY (group_account_id) REFERENCES accounts(id),
    CONSTRAINT fk_cons_canonical_rule_created_by
      FOREIGN KEY (created_by_user_id) REFERENCES users(id)
      ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
];

const migration114ConsolidationCanonicalSavedRules = {
  key: "m114_consolidation_canonical_saved_rules",
  description:
    "Persist reusable consolidation canonical bulk-mapping rules for preview/apply reruns",
  async up(connection) {
    for (const statement of statements) {
      await safeExecute(connection, statement);
    }
  },

  async down() {
    // Non-destructive migration policy: no down-op for additive schema changes.
  },
};

export default migration114ConsolidationCanonicalSavedRules;
