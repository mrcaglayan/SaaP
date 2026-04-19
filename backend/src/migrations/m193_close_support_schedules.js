/**
 * m193 - Close support-schedules foundation.
 *
 * Adds the PR-07 materialized support-schedule rows created from the active
 * support-schedule template catalog for each close cycle.
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

const createCloseSupportSchedulesTableSql = `
  CREATE TABLE IF NOT EXISTS close_support_schedules (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    close_cycle_id BIGINT UNSIGNED NOT NULL,
    close_cycle_item_id BIGINT UNSIGNED NULL,
    close_support_schedule_template_id BIGINT UNSIGNED NOT NULL,
    schedule_key VARCHAR(191) NOT NULL,
    schedule_title VARCHAR(191) NOT NULL,
    schedule_kind ENUM('SUPPORT_SCHEDULE','DISCLOSURE_PACK') NOT NULL DEFAULT 'SUPPORT_SCHEDULE',
    schedule_status ENUM('NOT_STARTED','IN_PROGRESS','SUBMITTED','APPROVED') NOT NULL DEFAULT 'NOT_STARTED',
    owner_user_id INT NULL,
    due_at TIMESTAMP NULL,
    progress_percentage TINYINT UNSIGNED NOT NULL DEFAULT 0,
    completed_response_count INT UNSIGNED NOT NULL DEFAULT 0,
    total_response_count INT UNSIGNED NOT NULL DEFAULT 0,
    payload_json JSON NULL,
    created_by_user_id INT NULL,
    updated_by_user_id INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_close_support_schedules_cycle_key (tenant_id, close_cycle_id, schedule_key),
    KEY ix_close_support_schedules_cycle_status (
      tenant_id,
      close_cycle_id,
      schedule_status,
      schedule_kind
    ),
    KEY ix_close_support_schedules_item_status (
      tenant_id,
      close_cycle_item_id,
      schedule_status
    ),
    CONSTRAINT fk_close_support_schedules_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_close_support_schedules_cycle
      FOREIGN KEY (close_cycle_id) REFERENCES close_cycles(id),
    CONSTRAINT fk_close_support_schedules_cycle_item
      FOREIGN KEY (close_cycle_item_id) REFERENCES close_cycle_items(id),
    CONSTRAINT fk_close_support_schedules_template
      FOREIGN KEY (close_support_schedule_template_id) REFERENCES close_support_schedule_templates(id),
    CONSTRAINT fk_close_support_schedules_owner_user
      FOREIGN KEY (owner_user_id) REFERENCES users(id),
    CONSTRAINT fk_close_support_schedules_created_by_user
      FOREIGN KEY (created_by_user_id) REFERENCES users(id),
    CONSTRAINT fk_close_support_schedules_updated_by_user
      FOREIGN KEY (updated_by_user_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const migration193CloseSupportSchedules = {
  key: "m193_close_support_schedules",
  description:
    "Add materialized close support schedules so PR-07 can provision structured support and disclosure rows per cycle.",
  async up(connection) {
    await safeExecute(connection, createCloseSupportSchedulesTableSql);
  },

  async down() {
    // Additive foundation only.
  },
};

export default migration193CloseSupportSchedules;
