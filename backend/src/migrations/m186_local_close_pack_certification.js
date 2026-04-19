/**
 * m186 - Local close-pack certification foundation.
 *
 * Adds the RP04 header row that tracks certification-pack progress for one
 * local close pack without replacing the existing local close runtime.
 */

const IGNORABLE_ERRNOS = new Set([
  1050, // ER_TABLE_EXISTS_ERROR
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

const createLocalClosePackCertificationsTableSql = `
  CREATE TABLE IF NOT EXISTS local_close_pack_certifications (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    local_close_pack_id BIGINT UNSIGNED NOT NULL,
    status ENUM('NOT_STARTED','IN_PROGRESS','COMPLETE') NOT NULL DEFAULT 'NOT_STARTED',
    required_section_count INT UNSIGNED NOT NULL DEFAULT 0,
    completed_required_section_count INT UNSIGNED NOT NULL DEFAULT 0,
    incomplete_required_section_count INT UNSIGNED NOT NULL DEFAULT 0,
    progress_percentage TINYINT UNSIGNED NOT NULL DEFAULT 0,
    certified_by_user_id INT NULL,
    certified_at TIMESTAMP NULL DEFAULT NULL,
    created_by_user_id INT NULL,
    updated_by_user_id INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_local_close_pack_certifications_pack (
      tenant_id,
      local_close_pack_id
    ),
    KEY ix_local_close_pack_certifications_status (
      tenant_id,
      status,
      updated_at
    ),
    CONSTRAINT fk_local_close_pack_certifications_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_local_close_pack_certifications_pack
      FOREIGN KEY (local_close_pack_id) REFERENCES local_close_packs(id),
    CONSTRAINT fk_local_close_pack_certifications_certified_by_user
      FOREIGN KEY (certified_by_user_id) REFERENCES users(id),
    CONSTRAINT fk_local_close_pack_certifications_created_by_user
      FOREIGN KEY (created_by_user_id) REFERENCES users(id),
    CONSTRAINT fk_local_close_pack_certifications_updated_by_user
      FOREIGN KEY (updated_by_user_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const migration186LocalClosePackCertification = {
  key: "m186_local_close_pack_certification",
  description:
    "Add local close-pack certification headers so RP04 can track explicit certification progress before lock.",
  async up(connection) {
    await safeExecute(connection, createLocalClosePackCertificationsTableSql);
  },

  async down() {
    // Additive foundation only.
  },
};

export default migration186LocalClosePackCertification;
