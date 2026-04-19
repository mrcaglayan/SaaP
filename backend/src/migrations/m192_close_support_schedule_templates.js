/**
 * m192 - Close support-schedule template foundation.
 *
 * Adds the PR-07 template catalog used to define structured support-schedule
 * and disclosure-pack expectations per close-cycle scope without changing the
 * existing core close runtimes.
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

const createCloseSupportScheduleTemplatesTableSql = `
  CREATE TABLE IF NOT EXISTS close_support_schedule_templates (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NULL,
    tenant_scope_key VARCHAR(32)
      GENERATED ALWAYS AS (IFNULL(CONCAT('TENANT:', CAST(tenant_id AS CHAR)), 'GLOBAL'))
      STORED,
    template_code VARCHAR(96) NOT NULL,
    template_name VARCHAR(191) NOT NULL,
    schedule_kind ENUM('SUPPORT_SCHEDULE','DISCLOSURE_PACK') NOT NULL DEFAULT 'SUPPORT_SCHEDULE',
    cycle_scope_kind ENUM('ANY','LEGAL_ENTITY','CONSOLIDATION_GROUP') NOT NULL DEFAULT 'ANY',
    anchor_item_type ENUM('ANY','LOCAL_CLOSE_PACK','PERIOD_CLOSE_RUN','CONSOLIDATION_RUN') NOT NULL DEFAULT 'ANY',
    materialization_scope ENUM('CYCLE','ITEM') NOT NULL DEFAULT 'ITEM',
    status ENUM('ACTIVE','PAUSED','DISABLED') NOT NULL DEFAULT 'ACTIVE',
    default_due_offset_days INT NOT NULL DEFAULT 0,
    required_for_close_visibility TINYINT(1) NOT NULL DEFAULT 1,
    description VARCHAR(500) NULL,
    config_json JSON NULL,
    created_by_user_id INT NULL,
    updated_by_user_id INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_close_support_schedule_templates_scope_code (tenant_scope_key, template_code),
    KEY ix_close_support_schedule_templates_lookup (
      tenant_id,
      status,
      cycle_scope_kind,
      anchor_item_type
    ),
    CONSTRAINT fk_close_support_schedule_templates_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_close_support_schedule_templates_created_by_user
      FOREIGN KEY (created_by_user_id) REFERENCES users(id),
    CONSTRAINT fk_close_support_schedule_templates_updated_by_user
      FOREIGN KEY (updated_by_user_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const seedDefaultCloseSupportScheduleTemplatesSql = `
  INSERT INTO close_support_schedule_templates (
    tenant_id,
    template_code,
    template_name,
    schedule_kind,
    cycle_scope_kind,
    anchor_item_type,
    materialization_scope,
    status,
    default_due_offset_days,
    required_for_close_visibility,
    description,
    config_json
  )
  VALUES
    (
      NULL,
      'ENTITY_DISCLOSURE_PACK_STANDARD',
      'Entity Disclosure Pack',
      'DISCLOSURE_PACK',
      'LEGAL_ENTITY',
      'ANY',
      'CYCLE',
      'ACTIVE',
      0,
      1,
      'Cycle-level disclosure pack for entity close cycles.',
      JSON_OBJECT('preferredSurface', 'CLOSE_COCKPIT')
    ),
    (
      NULL,
      'ENTITY_LOCAL_SUPPORT_STANDARD',
      'Entity Local Support Schedule',
      'SUPPORT_SCHEDULE',
      'LEGAL_ENTITY',
      'LOCAL_CLOSE_PACK',
      'ITEM',
      'ACTIVE',
      0,
      1,
      'Item-level support schedule for local close pack participation in entity cycles.',
      JSON_OBJECT('preferredSurface', 'CLOSE_COCKPIT')
    ),
    (
      NULL,
      'GROUP_DISCLOSURE_PACK_STANDARD',
      'Group Disclosure Pack',
      'DISCLOSURE_PACK',
      'CONSOLIDATION_GROUP',
      'CONSOLIDATION_RUN',
      'CYCLE',
      'ACTIVE',
      0,
      1,
      'Cycle-level disclosure pack for consolidation-group close cycles.',
      JSON_OBJECT('preferredSurface', 'CLOSE_COCKPIT')
    ),
    (
      NULL,
      'GROUP_CONSOLIDATION_SUPPORT_STANDARD',
      'Group Consolidation Support Schedule',
      'SUPPORT_SCHEDULE',
      'CONSOLIDATION_GROUP',
      'CONSOLIDATION_RUN',
      'ITEM',
      'ACTIVE',
      0,
      1,
      'Item-level support schedule for the official consolidation run in group cycles.',
      JSON_OBJECT('preferredSurface', 'CLOSE_COCKPIT')
    ),
    (
      NULL,
      'GROUP_MEMBER_LOCAL_SUPPORT_STANDARD',
      'Group Member Local Support Schedule',
      'SUPPORT_SCHEDULE',
      'CONSOLIDATION_GROUP',
      'LOCAL_CLOSE_PACK',
      'ITEM',
      'ACTIVE',
      0,
      1,
      'Item-level support schedule for member local close participation inside group cycles.',
      JSON_OBJECT('preferredSurface', 'CLOSE_COCKPIT')
    )
  ON DUPLICATE KEY UPDATE
    template_name = VALUES(template_name),
    schedule_kind = VALUES(schedule_kind),
    cycle_scope_kind = VALUES(cycle_scope_kind),
    anchor_item_type = VALUES(anchor_item_type),
    materialization_scope = VALUES(materialization_scope),
    status = VALUES(status),
    default_due_offset_days = VALUES(default_due_offset_days),
    required_for_close_visibility = VALUES(required_for_close_visibility),
    description = VALUES(description),
    config_json = VALUES(config_json)
`;

const migration192CloseSupportScheduleTemplates = {
  key: "m192_close_support_schedule_templates",
  description:
    "Add support-schedule and disclosure-pack templates so PR-07 can materialize structured close-support expectations.",
  async up(connection) {
    await safeExecute(connection, createCloseSupportScheduleTemplatesTableSql);
    await safeExecute(connection, seedDefaultCloseSupportScheduleTemplatesSql);
  },

  async down() {
    // Additive foundation only.
  },
};

export default migration192CloseSupportScheduleTemplates;
