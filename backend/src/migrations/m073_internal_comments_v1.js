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

const migration073InternalCommentsV1 = {
  key: "m073_internal_comments_v1",
  description:
    "Internal comments v1 foundation table for scoped source records (UX29)",
  async up(connection) {
    await safeExecute(
      connection,
      `CREATE TABLE IF NOT EXISTS internal_comments (
         id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
         tenant_id BIGINT UNSIGNED NOT NULL,
         legal_entity_id BIGINT UNSIGNED NOT NULL,
         source_ref_type VARCHAR(60) NOT NULL,
         source_ref_id BIGINT UNSIGNED NOT NULL,
         body VARCHAR(2000) NOT NULL,
         status ENUM('ACTIVE','DELETED') NOT NULL DEFAULT 'ACTIVE',
         created_by_user_id INT NOT NULL,
         updated_by_user_id INT NULL,
         deleted_by_user_id INT NULL,
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
         deleted_at TIMESTAMP NULL DEFAULT NULL,
         KEY ix_internal_comments_scope (tenant_id, legal_entity_id, source_ref_type, source_ref_id, status, id),
         KEY ix_internal_comments_actor (tenant_id, created_by_user_id),
         CONSTRAINT fk_internal_comments_tenant
           FOREIGN KEY (tenant_id) REFERENCES tenants(id),
         CONSTRAINT fk_internal_comments_creator
           FOREIGN KEY (tenant_id, created_by_user_id) REFERENCES users(tenant_id, id),
         CONSTRAINT fk_internal_comments_updater
           FOREIGN KEY (tenant_id, updated_by_user_id) REFERENCES users(tenant_id, id)
           ON DELETE SET NULL,
         CONSTRAINT fk_internal_comments_deleter
           FOREIGN KEY (tenant_id, deleted_by_user_id) REFERENCES users(tenant_id, id)
           ON DELETE SET NULL
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
  },

  async down(connection) {
    await safeExecute(connection, `DROP TABLE IF EXISTS internal_comments`);
  },
};

export default migration073InternalCommentsV1;
