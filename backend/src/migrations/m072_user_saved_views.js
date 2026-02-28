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

const migration072UserSavedViews = {
  key: "m072_user_saved_views",
  description:
    "Per-user server-side saved views for list filters/table prefs persistence across devices (UX25)",
  async up(connection) {
    await safeExecute(
      connection,
      `CREATE TABLE IF NOT EXISTS user_saved_views (
         id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
         tenant_id BIGINT UNSIGNED NOT NULL,
         user_id INT NOT NULL,
         module_code VARCHAR(80) NOT NULL,
         view_name VARCHAR(120) NOT NULL,
         view_payload_json JSON NOT NULL,
         is_default TINYINT(1) NOT NULL DEFAULT 0,
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
         UNIQUE KEY uk_user_saved_views_scope_name (tenant_id, user_id, module_code, view_name),
         KEY ix_user_saved_views_scope_module (tenant_id, user_id, module_code),
         CONSTRAINT fk_user_saved_views_tenant
           FOREIGN KEY (tenant_id) REFERENCES tenants(id),
         CONSTRAINT fk_user_saved_views_user
           FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id)
           ON DELETE CASCADE
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
  },

  async down(connection) {
    await safeExecute(connection, `DROP TABLE IF EXISTS user_saved_views`);
  },
};

export default migration072UserSavedViews;
