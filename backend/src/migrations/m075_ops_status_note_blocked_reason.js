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

const migration075OpsStatusNoteBlockedReason = {
  key: "m075_ops_status_note_blocked_reason",
  description:
    "Ops status note / blocked reason records for scoped operational entities (UX31)",
  async up(connection) {
    await safeExecute(
      connection,
      `CREATE TABLE IF NOT EXISTS ops_status_notes (
         id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
         tenant_id BIGINT UNSIGNED NOT NULL,
         legal_entity_id BIGINT UNSIGNED NOT NULL,
         source_ref_type VARCHAR(60) NOT NULL,
         source_ref_id BIGINT UNSIGNED NOT NULL,
         ops_status ENUM('OK','AT_RISK','BLOCKED') NOT NULL DEFAULT 'OK',
         blocked_reason VARCHAR(500) NULL,
         note VARCHAR(1000) NULL,
         updated_by_user_id INT NULL,
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
         UNIQUE KEY uk_ops_status_scope (
           tenant_id,
           legal_entity_id,
           source_ref_type,
           source_ref_id
         ),
         KEY ix_ops_status_scope_status (
           tenant_id,
           legal_entity_id,
           source_ref_type,
           ops_status,
           updated_at,
           id
         ),
         CONSTRAINT fk_ops_status_notes_tenant
           FOREIGN KEY (tenant_id) REFERENCES tenants(id),
         CONSTRAINT fk_ops_status_notes_updated_by_user
           FOREIGN KEY (tenant_id, updated_by_user_id) REFERENCES users(tenant_id, id)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
  },

  async down(connection) {
    await safeExecute(connection, `DROP TABLE IF EXISTS ops_status_notes`);
  },
};

export default migration075OpsStatusNoteBlockedReason;
