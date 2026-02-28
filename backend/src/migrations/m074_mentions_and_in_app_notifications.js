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

const migration074MentionsAndInAppNotifications = {
  key: "m074_mentions_and_in_app_notifications",
  description:
    "Internal comment mentions and user in-app notifications for mention delivery (UX30)",
  async up(connection) {
    await safeExecute(
      connection,
      `CREATE TABLE IF NOT EXISTS internal_comment_mentions (
         id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
         tenant_id BIGINT UNSIGNED NOT NULL,
         internal_comment_id BIGINT UNSIGNED NOT NULL,
         mentioned_user_id INT NOT NULL,
         mention_token VARCHAR(255) NOT NULL,
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         UNIQUE KEY uk_internal_comment_mentions_unique (
           tenant_id,
           internal_comment_id,
           mentioned_user_id
         ),
         KEY ix_internal_comment_mentions_user (
           tenant_id,
           mentioned_user_id,
           created_at,
           id
         ),
         CONSTRAINT fk_internal_comment_mentions_tenant
           FOREIGN KEY (tenant_id) REFERENCES tenants(id),
         CONSTRAINT fk_internal_comment_mentions_comment
           FOREIGN KEY (internal_comment_id) REFERENCES internal_comments(id),
         CONSTRAINT fk_internal_comment_mentions_user
           FOREIGN KEY (tenant_id, mentioned_user_id) REFERENCES users(tenant_id, id)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );

    await safeExecute(
      connection,
      `CREATE TABLE IF NOT EXISTS in_app_notifications (
         id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
         tenant_id BIGINT UNSIGNED NOT NULL,
         user_id INT NOT NULL,
         notification_type VARCHAR(80) NOT NULL,
         title VARCHAR(190) NOT NULL,
         body VARCHAR(1000) NULL,
         status ENUM('UNREAD','READ') NOT NULL DEFAULT 'UNREAD',
         source_ref_type VARCHAR(60) NULL,
         source_ref_id BIGINT UNSIGNED NULL,
         source_event_id BIGINT UNSIGNED NULL,
         payload_json JSON NULL,
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
         read_at TIMESTAMP NULL DEFAULT NULL,
         KEY ix_in_app_notifications_user_status (
           tenant_id,
           user_id,
           status,
           created_at,
           id
         ),
         KEY ix_in_app_notifications_source (
           tenant_id,
           source_ref_type,
           source_ref_id,
           created_at,
           id
         ),
         CONSTRAINT fk_in_app_notifications_tenant
           FOREIGN KEY (tenant_id) REFERENCES tenants(id),
         CONSTRAINT fk_in_app_notifications_user
           FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
  },

  async down(connection) {
    await safeExecute(connection, `DROP TABLE IF EXISTS in_app_notifications`);
    await safeExecute(connection, `DROP TABLE IF EXISTS internal_comment_mentions`);
  },
};

export default migration074MentionsAndInAppNotifications;
