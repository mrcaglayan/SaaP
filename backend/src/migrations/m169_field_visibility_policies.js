/**
 * m169 - Field-level visibility policies.
 *
 * Adds tenant-scoped policy rows that drive row-aware masking/hiding for
 * sensitive fields such as bank-account identifiers and payroll salary data.
 */

const IGNORABLE_ERRNOS = new Set([
  1050, // ER_TABLE_EXISTS_ERROR
  1060, // ER_DUP_FIELDNAME
  1061, // ER_DUP_KEYNAME
  1826, // ER_FK_DUP_NAME
]);

async function safeExecute(connection, sql, params = []) {
  try {
    await connection.execute(sql, params);
  } catch (err) {
    if (IGNORABLE_ERRNOS.has(Number(err?.errno))) {
      return;
    }
    throw err;
  }
}

const migration169FieldVisibilityPolicies = {
  key: "m169_field_visibility_policies",
  description:
    "Add field visibility policy rows for row-scope-aware masking and hiding of sensitive data.",
  async up(connection) {
    await safeExecute(
      connection,
      `CREATE TABLE IF NOT EXISTS field_visibility_policies (
         id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
         tenant_id BIGINT UNSIGNED NOT NULL,
         module_code VARCHAR(30) NOT NULL,
         object_type VARCHAR(60) NOT NULL,
         field_name VARCHAR(120) NOT NULL,
         visibility_rule ENUM('FULL', 'MASKED', 'HIDDEN', 'LAST_4') NOT NULL DEFAULT 'FULL',
         applies_to_scope_type ENUM('TENANT','GROUP','COUNTRY','LEGAL_ENTITY','OPERATING_UNIT') NULL,
         applies_to_scope_id BIGINT UNSIGNED NULL,
         required_permission_code VARCHAR(120) NULL,
         is_active BOOLEAN NOT NULL DEFAULT TRUE,
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
         created_by_user_id INT NULL,
         scope_type_key VARCHAR(20)
           GENERATED ALWAYS AS (COALESCE(applies_to_scope_type, 'GLOBAL')) STORED,
         scope_id_key BIGINT UNSIGNED
           GENERATED ALWAYS AS (COALESCE(applies_to_scope_id, 0)) STORED,
         UNIQUE KEY uk_field_vis_policy (
           tenant_id,
           module_code,
           object_type,
           field_name,
           scope_type_key,
           scope_id_key
         ),
         KEY ix_field_vis_policy_lookup (
           tenant_id,
           module_code,
           object_type,
           is_active
         ),
         KEY ix_field_vis_policy_scope (
           tenant_id,
           applies_to_scope_type,
           applies_to_scope_id
         ),
         CONSTRAINT fk_field_vis_policy_tenant
           FOREIGN KEY (tenant_id) REFERENCES tenants(id)
           ON UPDATE RESTRICT ON DELETE RESTRICT
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
  },

  async down() {
    // Non-destructive migration policy: no down-op for additive governance schema.
  },
};

export default migration169FieldVisibilityPolicies;
