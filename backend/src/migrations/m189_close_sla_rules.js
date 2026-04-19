/**
 * m189 - Close SLA rules foundation.
 *
 * Adds the PR-05 SLA rule catalog and a default global rule set so alerts and
 * due-state visibility can run without tenant-by-tenant manual setup.
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

const createCloseSlaRulesTableSql = `
  CREATE TABLE IF NOT EXISTS close_sla_rules (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NULL,
    rule_code VARCHAR(96) NOT NULL,
    target_type ENUM('CYCLE','ITEM') NOT NULL,
    item_type ENUM('ANY','LOCAL_CLOSE_PACK','PERIOD_CLOSE_RUN','CONSOLIDATION_RUN') NOT NULL DEFAULT 'ANY',
    due_soon_lead_hours INT UNSIGNED NOT NULL DEFAULT 48,
    overdue_grace_hours INT UNSIGNED NOT NULL DEFAULT 0,
    stale_grace_hours INT UNSIGNED NOT NULL DEFAULT 0,
    escalate_after_hours INT UNSIGNED NOT NULL DEFAULT 24,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_by_user_id INT NULL,
    updated_by_user_id INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_close_sla_rules_scope_code (tenant_id, rule_code),
    KEY ix_close_sla_rules_active_lookup (tenant_id, is_active, target_type, item_type),
    CONSTRAINT fk_close_sla_rules_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_close_sla_rules_created_by_user
      FOREIGN KEY (created_by_user_id) REFERENCES users(id),
    CONSTRAINT fk_close_sla_rules_updated_by_user
      FOREIGN KEY (updated_by_user_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const seedDefaultCloseSlaRulesSql = `
  INSERT INTO close_sla_rules (
    tenant_id,
    rule_code,
    target_type,
    item_type,
    due_soon_lead_hours,
    overdue_grace_hours,
    stale_grace_hours,
    escalate_after_hours,
    is_active
  )
  VALUES
    (NULL, 'DEFAULT_CYCLE', 'CYCLE', 'ANY', 72, 0, 0, 24, 1),
    (NULL, 'DEFAULT_ITEM', 'ITEM', 'ANY', 48, 0, 0, 24, 1),
    (NULL, 'CONSOLIDATION_RUN', 'ITEM', 'CONSOLIDATION_RUN', 24, 0, 0, 12, 1)
  ON DUPLICATE KEY UPDATE
    target_type = VALUES(target_type),
    item_type = VALUES(item_type),
    due_soon_lead_hours = VALUES(due_soon_lead_hours),
    overdue_grace_hours = VALUES(overdue_grace_hours),
    stale_grace_hours = VALUES(stale_grace_hours),
    escalate_after_hours = VALUES(escalate_after_hours),
    is_active = VALUES(is_active)
`;

const migration189CloseSlaRules = {
  key: "m189_close_sla_rules",
  description:
    "Add close SLA rule catalog and default global thresholds for PR-05 operational due-state visibility.",
  async up(connection) {
    await safeExecute(connection, createCloseSlaRulesTableSql);
    await safeExecute(connection, seedDefaultCloseSlaRulesSql);
  },

  async down() {
    // Additive foundation only.
  },
};

export default migration189CloseSlaRules;
