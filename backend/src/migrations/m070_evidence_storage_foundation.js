const IGNORABLE_ERRNOS = new Set([
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
    if (IGNORABLE_ERRNOS.has(Number(err?.errno))) {
      return;
    }
    throw err;
  }
}

const migration070EvidenceStorageFoundation = {
  key: "m070_evidence_storage_foundation",
  description: "Evidence storage foundation (UX20): metadata table for scoped file evidence",
  async up(connection) {
    await safeExecute(
      connection,
      `CREATE TABLE IF NOT EXISTS evidence_objects (
         id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
         tenant_id BIGINT UNSIGNED NOT NULL,
         legal_entity_id BIGINT UNSIGNED NOT NULL,
         source_ref_type VARCHAR(80) NOT NULL,
         source_ref_id BIGINT UNSIGNED NOT NULL,
         status ENUM('PENDING_UPLOAD','ACTIVE','DELETED') NOT NULL DEFAULT 'PENDING_UPLOAD',
         display_name VARCHAR(190) NULL,
         note VARCHAR(500) NULL,
         file_name VARCHAR(255) NOT NULL,
         file_extension VARCHAR(16) NULL,
         content_type VARCHAR(120) NOT NULL DEFAULT 'application/octet-stream',
         file_size_bytes BIGINT UNSIGNED NULL,
         file_sha256 CHAR(64) NULL,
         storage_driver VARCHAR(30) NOT NULL DEFAULT 'LOCAL_FS',
         storage_path VARCHAR(500) NULL,
         uploaded_at TIMESTAMP NULL,
         created_by_user_id INT NULL,
         deleted_by_user_id INT NULL,
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
         deleted_at TIMESTAMP NULL,
         UNIQUE KEY uk_evidence_objects_scope_id (tenant_id, legal_entity_id, id),
         KEY ix_evidence_objects_scope_source
           (tenant_id, legal_entity_id, source_ref_type, source_ref_id, status, created_at),
         KEY ix_evidence_objects_scope_sha (tenant_id, legal_entity_id, file_sha256),
         CONSTRAINT fk_evidence_objects_tenant
           FOREIGN KEY (tenant_id) REFERENCES tenants(id),
         CONSTRAINT fk_evidence_objects_legal_entity
           FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES legal_entities(tenant_id, id),
         CONSTRAINT fk_evidence_objects_created_user
           FOREIGN KEY (tenant_id, created_by_user_id) REFERENCES users(tenant_id, id),
         CONSTRAINT fk_evidence_objects_deleted_user
           FOREIGN KEY (tenant_id, deleted_by_user_id) REFERENCES users(tenant_id, id)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
  },

  async down(connection) {
    await safeExecute(connection, `DROP TABLE IF EXISTS evidence_objects`);
  },
};

export default migration070EvidenceStorageFoundation;
