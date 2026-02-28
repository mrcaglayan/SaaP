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

const migration076UserInvitesCopyLinkFlow = {
  key: "m076_user_invites_copy_link_flow",
  description: "User invite token table for copy-link onboarding flow (UX32)",
  async up(connection) {
    await safeExecute(
      connection,
      `CREATE TABLE IF NOT EXISTS user_invites (
         id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
         tenant_id BIGINT UNSIGNED NOT NULL,
         user_id INT NOT NULL,
         email VARCHAR(255) NOT NULL,
         invite_token_hash CHAR(64) NOT NULL,
         status ENUM('PENDING','ACCEPTED','REVOKED','EXPIRED') NOT NULL DEFAULT 'PENDING',
         expires_at TIMESTAMP NOT NULL,
         accepted_at TIMESTAMP NULL,
         revoked_at TIMESTAMP NULL,
         created_by_user_id INT NULL,
         accepted_by_user_id INT NULL,
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
         UNIQUE KEY uk_user_invites_token_hash (invite_token_hash),
         KEY ix_user_invites_user_status (tenant_id, user_id, status, expires_at, id),
         KEY ix_user_invites_email_status (tenant_id, email, status, expires_at, id),
         CONSTRAINT fk_user_invites_tenant
           FOREIGN KEY (tenant_id) REFERENCES tenants(id),
         CONSTRAINT fk_user_invites_user
           FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id),
         CONSTRAINT fk_user_invites_created_by_user
           FOREIGN KEY (tenant_id, created_by_user_id) REFERENCES users(tenant_id, id),
         CONSTRAINT fk_user_invites_accepted_by_user
           FOREIGN KEY (tenant_id, accepted_by_user_id) REFERENCES users(tenant_id, id)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
  },

  async down(connection) {
    await safeExecute(connection, `DROP TABLE IF EXISTS user_invites`);
  },
};

export default migration076UserInvitesCopyLinkFlow;
