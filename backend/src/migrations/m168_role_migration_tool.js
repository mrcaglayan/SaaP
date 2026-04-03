/**
 * m168 - Role migration tool state.
 *
 * Stores deterministic preview snapshots and execution/rollback state for the
 * Phase 4 role remap from legacy broad roles to composable duty-boundary roles.
 * The active legacy-disable table also lets reseed logic keep retired source
 * roles disabled instead of silently re-enabling them later.
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

const migration168RoleMigrationTool = {
  key: "m168_role_migration_tool",
  description:
    "Add snapshot-backed role migration runs, items, and active legacy-role disable state.",
  async up(connection) {
    await safeExecute(
      connection,
      `CREATE TABLE IF NOT EXISTS role_migration_runs (
         id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
         tenant_id BIGINT UNSIGNED NOT NULL,
         requested_by_user_id INT NULL,
         executed_by_user_id INT NULL,
         rolled_back_by_user_id INT NULL,
         status ENUM('PREVIEWED', 'EXECUTED', 'ROLLED_BACK') NOT NULL DEFAULT 'PREVIEWED',
         mapping_version VARCHAR(40) NOT NULL,
         preview_summary_json JSON NOT NULL,
         execution_summary_json JSON NULL,
         rollback_summary_json JSON NULL,
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         executed_at TIMESTAMP NULL DEFAULT NULL,
         rolled_back_at TIMESTAMP NULL DEFAULT NULL,
         KEY ix_role_migration_runs_tenant_status (tenant_id, status, id),
         CONSTRAINT fk_role_migration_run_tenant
           FOREIGN KEY (tenant_id) REFERENCES tenants(id)
           ON UPDATE RESTRICT ON DELETE RESTRICT
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );

    await safeExecute(
      connection,
      `CREATE TABLE IF NOT EXISTS role_migration_run_items (
         id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
         run_id BIGINT UNSIGNED NOT NULL,
         tenant_id BIGINT UNSIGNED NOT NULL,
         source_assignment_id BIGINT UNSIGNED NOT NULL,
         source_user_id INT NOT NULL,
         source_role_id BIGINT UNSIGNED NOT NULL,
         source_role_code VARCHAR(120) NOT NULL,
         source_role_name VARCHAR(255) NOT NULL,
         source_scope_type ENUM('TENANT','GROUP','COUNTRY','LEGAL_ENTITY','OPERATING_UNIT') NOT NULL,
         source_scope_id BIGINT UNSIGNED NOT NULL,
         source_effect ENUM('ALLOW','DENY') NOT NULL,
         source_effective_from DATE NULL,
         source_effective_to DATE NULL,
         preview_status ENUM('READY', 'REVIEW_REQUIRED', 'SKIPPED_UNMAPPED') NOT NULL DEFAULT 'READY',
         execution_status ENUM('PENDING', 'EXECUTED', 'SKIPPED', 'CONFLICT') NOT NULL DEFAULT 'PENDING',
         rollback_status ENUM('NOT_APPLICABLE', 'ROLLED_BACK', 'SKIPPED') NOT NULL DEFAULT 'NOT_APPLICABLE',
         source_snapshot_json JSON NOT NULL,
         target_assignments_json JSON NOT NULL,
         notes_json JSON NULL,
         execution_result_json JSON NULL,
         rollback_result_json JSON NULL,
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         UNIQUE KEY uk_role_migration_run_item_source (run_id, source_assignment_id),
         KEY ix_role_migration_run_items_tenant_role (tenant_id, source_role_code, source_scope_type, source_scope_id),
         CONSTRAINT fk_role_migration_run_item_run
           FOREIGN KEY (run_id) REFERENCES role_migration_runs(id)
           ON UPDATE RESTRICT ON DELETE CASCADE,
         CONSTRAINT fk_role_migration_run_item_tenant
           FOREIGN KEY (tenant_id) REFERENCES tenants(id)
           ON UPDATE RESTRICT ON DELETE RESTRICT,
         CONSTRAINT fk_role_migration_run_item_role
           FOREIGN KEY (source_role_id) REFERENCES roles(id)
           ON UPDATE RESTRICT ON DELETE RESTRICT
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );

    await safeExecute(
      connection,
      `CREATE TABLE IF NOT EXISTS role_migration_legacy_disabled_roles (
         id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
         tenant_id BIGINT UNSIGNED NOT NULL,
         role_id BIGINT UNSIGNED NOT NULL,
         role_code VARCHAR(120) NOT NULL,
         disabled_by_run_id BIGINT UNSIGNED NOT NULL,
         disabled_by_user_id INT NULL,
         is_disabled BOOLEAN NOT NULL DEFAULT TRUE,
         disabled_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         reenabled_by_user_id INT NULL,
         reenabled_at TIMESTAMP NULL DEFAULT NULL,
         UNIQUE KEY uk_role_migration_legacy_disabled_role (tenant_id, role_id),
         KEY ix_role_migration_legacy_disabled_active (tenant_id, is_disabled, role_code),
         CONSTRAINT fk_role_migration_legacy_disabled_tenant
           FOREIGN KEY (tenant_id) REFERENCES tenants(id)
           ON UPDATE RESTRICT ON DELETE RESTRICT,
         CONSTRAINT fk_role_migration_legacy_disabled_role
           FOREIGN KEY (role_id) REFERENCES roles(id)
           ON UPDATE RESTRICT ON DELETE RESTRICT,
         CONSTRAINT fk_role_migration_legacy_disabled_run
           FOREIGN KEY (disabled_by_run_id) REFERENCES role_migration_runs(id)
           ON UPDATE RESTRICT ON DELETE RESTRICT
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
  },

  async down() {
    // Non-destructive migration policy: no down-op for additive governance schema.
  },
};

export default migration168RoleMigrationTool;
