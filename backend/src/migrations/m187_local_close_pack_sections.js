/**
 * m187 - Local close-pack certification sections.
 *
 * Adds explicit section rows so RP04 can strengthen local close locking with a
 * certification checklist instead of heuristic one-off flags.
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

const createLocalClosePackCertificationSectionsTableSql = `
  CREATE TABLE IF NOT EXISTS local_close_pack_certification_sections (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    local_close_pack_certification_id BIGINT UNSIGNED NOT NULL,
    section_key VARCHAR(64) NOT NULL,
    section_title VARCHAR(120) NOT NULL,
    section_description VARCHAR(500) NULL,
    section_type ENUM('SYSTEM','MANUAL') NOT NULL DEFAULT 'SYSTEM',
    section_order INT UNSIGNED NOT NULL DEFAULT 0,
    is_required TINYINT(1) NOT NULL DEFAULT 1,
    status ENUM('OPEN','COMPLETE') NOT NULL DEFAULT 'OPEN',
    completion_source ENUM('SYSTEM','USER') NULL,
    note VARCHAR(1000) NULL,
    completed_by_user_id INT NULL,
    completed_at TIMESTAMP NULL DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_local_close_pack_certification_sections_key (
      tenant_id,
      local_close_pack_certification_id,
      section_key
    ),
    KEY ix_local_close_pack_certification_sections_status (
      tenant_id,
      status,
      is_required,
      section_order
    ),
    CONSTRAINT fk_local_close_pack_certification_sections_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_local_close_pack_certification_sections_header
      FOREIGN KEY (local_close_pack_certification_id)
      REFERENCES local_close_pack_certifications(id),
    CONSTRAINT fk_local_close_pack_certification_sections_completed_by_user
      FOREIGN KEY (completed_by_user_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const migration187LocalClosePackSections = {
  key: "m187_local_close_pack_sections",
  description:
    "Add local close-pack certification sections so RP04 can block lock when required sections remain incomplete.",
  async up(connection) {
    await safeExecute(connection, createLocalClosePackCertificationSectionsTableSql);
  },

  async down() {
    // Additive foundation only.
  },
};

export default migration187LocalClosePackSections;
