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

const migration112OperatingUnitPartnerCurrentAccounts = {
  key: "m112_operating_unit_partner_current_accounts",
  description:
    "Add direct operating-unit partner current-account mappings for branch-to-branch cash transfers",
  async up(connection) {
    if (!(await hasTable(connection, "operating_unit_partner_current_accounts"))) {
      await connection.execute(
        `CREATE TABLE operating_unit_partner_current_accounts (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          tenant_id BIGINT UNSIGNED NOT NULL,
          legal_entity_id BIGINT UNSIGNED NOT NULL,
          operating_unit_id BIGINT UNSIGNED NOT NULL,
          partner_operating_unit_id BIGINT UNSIGNED NOT NULL,
          due_from_account_id BIGINT UNSIGNED NOT NULL,
          due_to_account_id BIGINT UNSIGNED NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uk_ou_partner_current_pair (
            tenant_id,
            operating_unit_id,
            partner_operating_unit_id
          ),
          KEY ix_ou_partner_current_legal_entity (
            tenant_id,
            legal_entity_id
          ),
          KEY ix_ou_partner_current_partner (
            tenant_id,
            partner_operating_unit_id
          ),
          CONSTRAINT fk_ou_partner_current_legal_entity
            FOREIGN KEY (legal_entity_id) REFERENCES legal_entities(id),
          CONSTRAINT fk_ou_partner_current_operating_unit
            FOREIGN KEY (operating_unit_id) REFERENCES operating_units(id),
          CONSTRAINT fk_ou_partner_current_partner_operating_unit
            FOREIGN KEY (partner_operating_unit_id) REFERENCES operating_units(id),
          CONSTRAINT fk_ou_partner_current_due_from_account
            FOREIGN KEY (due_from_account_id) REFERENCES accounts(id),
          CONSTRAINT fk_ou_partner_current_due_to_account
            FOREIGN KEY (due_to_account_id) REFERENCES accounts(id)
        )`
      );
    }
  },

  async down() {
    // Non-destructive migration policy: no down-op for additive schema changes.
  },
};

export default migration112OperatingUnitPartnerCurrentAccounts;
