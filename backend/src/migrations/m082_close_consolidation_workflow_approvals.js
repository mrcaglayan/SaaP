const ignorableErrnos = new Set([
  1050, // ER_TABLE_EXISTS_ERROR
  1060, // ER_DUP_FIELDNAME
  1061, // ER_DUP_KEYNAME
  1091, // ER_CANT_DROP_FIELD_OR_KEY
  1826, // ER_FK_DUP_NAME
]);

async function safeExecute(connection, sql, params = []) {
  try {
    await connection.execute(sql, params);
  } catch (err) {
    if (ignorableErrnos.has(Number(err?.errno))) {
      return;
    }
    throw err;
  }
}

const statements = [
  `
  CREATE TABLE IF NOT EXISTS workflow_definitions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    code VARCHAR(60) NOT NULL,
    name VARCHAR(255) NOT NULL,
    process_type ENUM('PERIOD_CLOSE','CONSOLIDATION_RUN') NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    version_no INT NOT NULL DEFAULT 1,
    created_by_user_id INT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_workflow_definitions_code_ver (tenant_id, code, version_no),
    KEY ix_workflow_definitions_tenant_process_active (
      tenant_id,
      process_type,
      is_active
    ),
    CONSTRAINT fk_workflow_definitions_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_workflow_definitions_created_by
      FOREIGN KEY (created_by_user_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
  `
  CREATE TABLE IF NOT EXISTS workflow_definition_steps (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    workflow_definition_id BIGINT UNSIGNED NOT NULL,
    step_no INT NOT NULL,
    stage_scope_type ENUM('OPERATING_UNIT','LEGAL_ENTITY','GROUP') NOT NULL,
    required_permission_code VARCHAR(120) NOT NULL,
    min_approver_count INT NOT NULL DEFAULT 1,
    allow_self_approve BOOLEAN NOT NULL DEFAULT FALSE,
    escalation_after_hours INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_workflow_definition_steps_order (workflow_definition_id, step_no),
    KEY ix_workflow_definition_steps_scope (
      workflow_definition_id,
      stage_scope_type,
      step_no
    ),
    CONSTRAINT fk_workflow_definition_steps_definition
      FOREIGN KEY (workflow_definition_id) REFERENCES workflow_definitions(id)
      ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
  `
  CREATE TABLE IF NOT EXISTS workflow_assignments (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    process_type ENUM('PERIOD_CLOSE','CONSOLIDATION_RUN') NOT NULL,
    workflow_definition_id BIGINT UNSIGNED NOT NULL,
    group_company_id BIGINT UNSIGNED NULL,
    legal_entity_id BIGINT UNSIGNED NULL,
    operating_unit_id BIGINT UNSIGNED NULL,
    effective_from DATE NOT NULL,
    effective_to DATE NULL,
    status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    created_by_user_id INT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY ix_workflow_assignments_process_scope (
      tenant_id,
      process_type,
      status,
      operating_unit_id,
      legal_entity_id,
      group_company_id
    ),
    KEY ix_workflow_assignments_effective_window (
      tenant_id,
      process_type,
      effective_from,
      effective_to
    ),
    CONSTRAINT fk_workflow_assignments_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_workflow_assignments_definition
      FOREIGN KEY (workflow_definition_id) REFERENCES workflow_definitions(id),
    CONSTRAINT fk_workflow_assignments_group_company
      FOREIGN KEY (group_company_id) REFERENCES group_companies(id),
    CONSTRAINT fk_workflow_assignments_legal_entity
      FOREIGN KEY (legal_entity_id) REFERENCES legal_entities(id),
    CONSTRAINT fk_workflow_assignments_operating_unit
      FOREIGN KEY (operating_unit_id) REFERENCES operating_units(id),
    CONSTRAINT fk_workflow_assignments_created_by
      FOREIGN KEY (created_by_user_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
  `
  CREATE TABLE IF NOT EXISTS workflow_instances (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    process_type ENUM('PERIOD_CLOSE','CONSOLIDATION_RUN') NOT NULL,
    target_type ENUM('PERIOD_CLOSE_RUN','CONSOLIDATION_RUN') NOT NULL,
    target_id BIGINT UNSIGNED NOT NULL,
    workflow_definition_id BIGINT UNSIGNED NOT NULL,
    status ENUM('PENDING','APPROVED','REJECTED','CANCELLED') NOT NULL DEFAULT 'PENDING',
    current_step_no INT NOT NULL DEFAULT 1,
    requested_by_user_id INT NOT NULL,
    requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP NULL,
    resolution_note VARCHAR(500) NULL,
    idempotency_key VARCHAR(120) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_workflow_instances_target (
      tenant_id,
      process_type,
      target_type,
      target_id
    ),
    UNIQUE KEY uk_workflow_instances_idempotency (tenant_id, idempotency_key),
    KEY ix_workflow_instances_status (tenant_id, process_type, status, current_step_no),
    CONSTRAINT fk_workflow_instances_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_workflow_instances_definition
      FOREIGN KEY (workflow_definition_id) REFERENCES workflow_definitions(id),
    CONSTRAINT fk_workflow_instances_requested_by
      FOREIGN KEY (requested_by_user_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
  `
  CREATE TABLE IF NOT EXISTS workflow_instance_decisions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    workflow_instance_id BIGINT UNSIGNED NOT NULL,
    step_no INT NOT NULL,
    decision ENUM('APPROVE','REJECT') NOT NULL,
    decision_by_user_id INT NOT NULL,
    decision_note VARCHAR(500) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY ix_workflow_instance_decisions_step (workflow_instance_id, step_no),
    UNIQUE KEY uk_workflow_instance_decisions_actor (
      workflow_instance_id,
      step_no,
      decision_by_user_id
    ),
    CONSTRAINT fk_workflow_instance_decisions_instance
      FOREIGN KEY (workflow_instance_id) REFERENCES workflow_instances(id)
      ON DELETE CASCADE,
    CONSTRAINT fk_workflow_instance_decisions_actor
      FOREIGN KEY (decision_by_user_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
];

const migration082CloseConsolidationWorkflowApprovals = {
  key: "m082_close_consolidation_workflow_approvals",
  description:
    "Approval workflow schema for period close and consolidation run gates (definitions, assignments, runtime instances, decisions)",
  async up(connection) {
    for (const statement of statements) {
      await safeExecute(connection, statement);
    }
  },

  async down() {
    // Non-destructive migration policy: no down-op for additive hardening.
  },
};

export default migration082CloseConsolidationWorkflowApprovals;

