async function hasTable(connection, tableName) {
  const [rows] = await connection.execute(
    `SELECT 1
     FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name = ?
     LIMIT 1`,
    [tableName]
  );
  return Array.isArray(rows) && rows.length > 0;
}

const migration130OperatingUnitCurrentAccountConfigs = {
  key: "m130_operating_unit_current_account_configs",
  description:
    "Add legal-entity OU current-account saved parent configuration for setup-time and delta auto-provisioning",
  async up(connection) {
    if (!(await hasTable(connection, "operating_unit_current_account_configs"))) {
      await connection.execute(
        `CREATE TABLE operating_unit_current_account_configs (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          tenant_id BIGINT UNSIGNED NOT NULL,
          legal_entity_id BIGINT UNSIGNED NOT NULL,
          due_from_parent_account_id BIGINT UNSIGNED NOT NULL,
          due_to_parent_account_id BIGINT UNSIGNED NOT NULL,
          auto_provision_on_operating_unit_create BOOLEAN NOT NULL DEFAULT TRUE,
          last_applied_at TIMESTAMP NULL DEFAULT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uk_ou_current_account_configs_tenant_entity (
            tenant_id,
            legal_entity_id
          ),
          KEY ix_ou_current_account_configs_tenant_entity (
            tenant_id,
            legal_entity_id
          ),
          CONSTRAINT fk_ou_current_account_configs_legal_entity
            FOREIGN KEY (legal_entity_id) REFERENCES legal_entities(id),
          CONSTRAINT fk_ou_current_account_configs_due_from_parent
            FOREIGN KEY (due_from_parent_account_id) REFERENCES accounts(id),
          CONSTRAINT fk_ou_current_account_configs_due_to_parent
            FOREIGN KEY (due_to_parent_account_id) REFERENCES accounts(id)
        )`
      );
    }
  },

  async down() {
    // Non-destructive migration policy: no down-op for additive schema changes.
  },
};

export default migration130OperatingUnitCurrentAccountConfigs;
