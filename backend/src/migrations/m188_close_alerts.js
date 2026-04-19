/**
 * m188 - Close alerts foundation.
 *
 * Adds the PR-05 alert read-model table so the close operating layer has a
 * durable place for later notification and escalation snapshots.
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

const createCloseAlertsTableSql = `
  CREATE TABLE IF NOT EXISTS close_alerts (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    alert_key VARCHAR(191) NOT NULL,
    close_cycle_id BIGINT UNSIGNED NOT NULL,
    close_cycle_item_id BIGINT UNSIGNED NULL,
    alert_code VARCHAR(96) NOT NULL,
    alert_type ENUM('DUE_SOON','OVERDUE','BLOCKED','STALE') NOT NULL,
    severity ENUM('LOW','MEDIUM','HIGH','CRITICAL') NOT NULL DEFAULT 'MEDIUM',
    alert_state ENUM('ACTIVE','RESOLVED') NOT NULL DEFAULT 'ACTIVE',
    title VARCHAR(191) NOT NULL,
    message VARCHAR(512) NOT NULL,
    owner_user_id INT NULL,
    due_at TIMESTAMP NULL DEFAULT NULL,
    first_triggered_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_triggered_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP NULL DEFAULT NULL,
    payload_json JSON NULL,
    created_by_user_id INT NULL,
    updated_by_user_id INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_close_alerts_tenant_alert_key (tenant_id, alert_key),
    KEY ix_close_alerts_cycle_state (tenant_id, close_cycle_id, alert_state, severity),
    KEY ix_close_alerts_item_state (tenant_id, close_cycle_item_id, alert_state),
    KEY ix_close_alerts_due (tenant_id, alert_state, due_at),
    CONSTRAINT fk_close_alerts_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_close_alerts_cycle
      FOREIGN KEY (close_cycle_id) REFERENCES close_cycles(id),
    CONSTRAINT fk_close_alerts_item
      FOREIGN KEY (close_cycle_item_id) REFERENCES close_cycle_items(id),
    CONSTRAINT fk_close_alerts_owner_user
      FOREIGN KEY (owner_user_id) REFERENCES users(id),
    CONSTRAINT fk_close_alerts_created_by_user
      FOREIGN KEY (created_by_user_id) REFERENCES users(id),
    CONSTRAINT fk_close_alerts_updated_by_user
      FOREIGN KEY (updated_by_user_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const migration188CloseAlerts = {
  key: "m188_close_alerts",
  description:
    "Add close alert storage so PR-05 can surface due, blocked, and stale operational attention states.",
  async up(connection) {
    await safeExecute(connection, createCloseAlertsTableSql);
  },

  async down() {
    // Additive foundation only.
  },
};

export default migration188CloseAlerts;
