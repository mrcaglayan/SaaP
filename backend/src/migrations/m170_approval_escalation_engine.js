/**
 * m170 - Approval escalation engine.
 *
 * Operationalizes generic approval-step escalation by adding explicit
 * escalation-target configuration on approval_policy_steps and a durable
 * approval_escalation_events audit table for scheduled escalation sweeps.
 *
 * `approval_policy_steps.escalation_after_hours` already exists from earlier
 * phases, so this migration only adds the new target/max-count columns.
 */

const IGNORABLE_ERRNOS = new Set([
  1050, // ER_TABLE_EXISTS_ERROR
  1060, // ER_DUP_FIELDNAME
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

const createApprovalEscalationEventsTableSql = `
  CREATE TABLE IF NOT EXISTS approval_escalation_events (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    request_id BIGINT UNSIGNED NOT NULL,
    step_no TINYINT UNSIGNED NOT NULL,
    escalation_no TINYINT UNSIGNED NOT NULL,
    event_type ENUM('ESCALATED') NOT NULL DEFAULT 'ESCALATED',
    target_permission_code VARCHAR(120) NOT NULL,
    target_scope_type ENUM(
      'TENANT',
      'GROUP',
      'COUNTRY',
      'LEGAL_ENTITY',
      'OPERATING_UNIT'
    ) NOT NULL,
    target_scope_id BIGINT UNSIGNED NOT NULL,
    notified_user_count INT UNSIGNED NOT NULL DEFAULT 0,
    trigger_source VARCHAR(40) NOT NULL DEFAULT 'SCHEDULE_SWEEP',
    payload_json JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_approval_escalation_events_step_no (
      tenant_id,
      request_id,
      step_no,
      escalation_no
    ),
    KEY ix_approval_escalation_events_request (
      tenant_id,
      request_id,
      created_at
    ),
    KEY ix_approval_escalation_events_scope (
      tenant_id,
      target_scope_type,
      target_scope_id,
      created_at
    ),
    CONSTRAINT fk_approval_escalation_events_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_approval_escalation_events_request
      FOREIGN KEY (tenant_id, request_id) REFERENCES approval_requests(tenant_id, id)
      ON UPDATE RESTRICT ON DELETE CASCADE,
    CHECK (step_no >= 1),
    CHECK (escalation_no >= 1)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const migration170ApprovalEscalationEngine = {
  key: "m170_approval_escalation_engine",
  description:
    "Add approval escalation target config and durable escalation event audit rows.",
  async up(connection) {
    await safeExecute(
      connection,
      `ALTER TABLE approval_policy_steps
         ADD COLUMN escalation_target_scope_mode ENUM(
           'REQUEST_SCOPE',
           'POLICY_SCOPE',
           'TARGET_GROUP',
           'TARGET_LEGAL_ENTITY',
           'TARGET_OPERATING_UNIT',
           'CUSTOM'
         ) NULL
         AFTER escalation_after_hours`
    );
    await safeExecute(
      connection,
      `ALTER TABLE approval_policy_steps
         ADD COLUMN escalation_max_count TINYINT UNSIGNED NULL
         AFTER escalation_target_scope_mode`
    );
    await safeExecute(
      connection,
      `ALTER TABLE approval_policy_steps
         ADD KEY ix_approval_policy_steps_escalation_due (
           tenant_id,
           policy_id,
           step_no,
           escalation_after_hours,
           escalation_max_count
         )`
    );

    await safeExecute(connection, createApprovalEscalationEventsTableSql);
  },

  async down() {
    // Non-destructive additive migration.
  },
};

export default migration170ApprovalEscalationEngine;
