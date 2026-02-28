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

const migration077PasswordResetTokens = {
  key: "m077_password_reset_tokens",
  description: "Password reset token flow table for self-service auth recovery (UX33)",
  async up(connection) {
    await safeExecute(
      connection,
      `CREATE TABLE IF NOT EXISTS user_password_resets (
         id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
         tenant_id BIGINT UNSIGNED NOT NULL,
         user_id INT NOT NULL,
         email VARCHAR(255) NOT NULL,
         reset_token_hash CHAR(64) NOT NULL,
         status ENUM('PENDING','USED','REVOKED','EXPIRED') NOT NULL DEFAULT 'PENDING',
         expires_at TIMESTAMP NOT NULL,
         used_at TIMESTAMP NULL,
         revoked_at TIMESTAMP NULL,
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
         UNIQUE KEY uk_user_password_resets_token_hash (reset_token_hash),
         KEY ix_user_password_resets_user_status (tenant_id, user_id, status, expires_at, id),
         KEY ix_user_password_resets_email_status (email, status, expires_at, id),
         CONSTRAINT fk_user_password_resets_tenant
           FOREIGN KEY (tenant_id) REFERENCES tenants(id),
         CONSTRAINT fk_user_password_resets_user
           FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
  },

  async down(connection) {
    await safeExecute(connection, `DROP TABLE IF EXISTS user_password_resets`);
  },
};

export default migration077PasswordResetTokens;
