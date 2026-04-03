/**
 * m163 - Generic approval engine schema.
 *
 * Adds module-agnostic approval policy, assignment, step, request, and
 * decision tables in parallel with the older bank-shaped and workflow-shaped
 * approval systems. Scope precedence is modeled explicitly:
 *
 * - approval_policies.scope_* = natural ownership/default bound
 * - approval_policy_assignments.scope_* = authoritative runtime applicability
 * - approval_decisions unique reviewer key = counted approvals stay
 *   reviewer-unique per request step
 */

const IGNORABLE_ERRNOS = new Set([
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
    if (IGNORABLE_ERRNOS.has(Number(err?.errno))) {
      return;
    }
    throw err;
  }
}

const createApprovalPoliciesTableSql = `
  CREATE TABLE IF NOT EXISTS approval_policies (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    module_code VARCHAR(30) NOT NULL,
    policy_code VARCHAR(80) NOT NULL,
    policy_name VARCHAR(190) NOT NULL,
    target_type VARCHAR(60) NOT NULL,
    action_type VARCHAR(60) NOT NULL,
    version_no INT UNSIGNED NOT NULL DEFAULT 1,
    scope_type ENUM('TENANT','GROUP','COUNTRY','LEGAL_ENTITY','OPERATING_UNIT') NULL,
    scope_id BIGINT UNSIGNED NULL,
    effective_from DATE NULL,
    effective_to DATE NULL,
    step_count TINYINT UNSIGNED NOT NULL DEFAULT 1,
    min_approvals TINYINT UNSIGNED NOT NULL DEFAULT 1,
    maker_checker_required BOOLEAN NOT NULL DEFAULT FALSE,
    allow_self_approve BOOLEAN NOT NULL DEFAULT TRUE,
    auto_execute_on_final_approval BOOLEAN NOT NULL DEFAULT FALSE,
    escalation_after_hours INT UNSIGNED NULL,
    min_amount DECIMAL(20,6) NULL,
    max_amount DECIMAL(20,6) NULL,
    currency_code CHAR(3) NULL,
    approver_permission_code VARCHAR(120) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by_user_id INT NULL,
    updated_by_user_id INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_approval_policies_tenant_id_id (tenant_id, id),
    UNIQUE KEY uk_approval_policies_code_ver (
      tenant_id,
      module_code,
      policy_code,
      version_no
    ),
    KEY ix_approval_policies_lookup (
      tenant_id,
      module_code,
      target_type,
      action_type,
      is_active
    ),
    KEY ix_approval_policies_scope (
      tenant_id,
      scope_type,
      scope_id,
      is_active
    ),
    CONSTRAINT fk_approval_policies_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_approval_policies_created_by
      FOREIGN KEY (tenant_id, created_by_user_id) REFERENCES users(tenant_id, id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_approval_policies_updated_by
      FOREIGN KEY (tenant_id, updated_by_user_id) REFERENCES users(tenant_id, id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    CHECK (
      (
        scope_type IS NULL
        AND scope_id IS NULL
      )
      OR (
        scope_type IS NOT NULL
        AND scope_id IS NOT NULL
      )
    ),
    CHECK (step_count >= 1),
    CHECK (min_approvals >= 1),
    CHECK (
      min_amount IS NULL
      OR max_amount IS NULL
      OR min_amount <= max_amount
    )
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const createApprovalPolicyAssignmentsTableSql = `
  CREATE TABLE IF NOT EXISTS approval_policy_assignments (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    policy_id BIGINT UNSIGNED NOT NULL,
    scope_type ENUM('TENANT','GROUP','COUNTRY','LEGAL_ENTITY','OPERATING_UNIT') NOT NULL,
    scope_id BIGINT UNSIGNED NOT NULL,
    effective_from DATE NULL,
    effective_to DATE NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_approval_policy_assignments_tenant_id_id (tenant_id, id),
    UNIQUE KEY uk_approval_policy_assignments_scope_window (
      tenant_id,
      policy_id,
      scope_type,
      scope_id,
      effective_from
    ),
    KEY ix_approval_policy_assignments_scope (
      tenant_id,
      scope_type,
      scope_id,
      is_active,
      effective_from,
      effective_to
    ),
    CONSTRAINT fk_approval_policy_assignments_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_approval_policy_assignments_policy
      FOREIGN KEY (tenant_id, policy_id) REFERENCES approval_policies(tenant_id, id)
      ON UPDATE RESTRICT ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const createApprovalPolicyStepsTableSql = `
  CREATE TABLE IF NOT EXISTS approval_policy_steps (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    policy_id BIGINT UNSIGNED NOT NULL,
    step_no TINYINT UNSIGNED NOT NULL,
    required_permission_code VARCHAR(120) NOT NULL,
    scope_resolution_mode ENUM(
      'REQUEST_SCOPE',
      'POLICY_SCOPE',
      'TARGET_GROUP',
      'TARGET_LEGAL_ENTITY',
      'TARGET_OPERATING_UNIT',
      'CUSTOM'
    ) NOT NULL DEFAULT 'REQUEST_SCOPE',
    custom_scope_resolver_key VARCHAR(60) NULL,
    min_approvals TINYINT UNSIGNED NOT NULL DEFAULT 1,
    allow_self_approve BOOLEAN NOT NULL DEFAULT TRUE,
    escalation_after_hours INT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_approval_policy_steps_tenant_id_id (tenant_id, id),
    UNIQUE KEY uk_approval_policy_steps_order (tenant_id, policy_id, step_no),
    KEY ix_approval_policy_steps_scope_mode (
      tenant_id,
      policy_id,
      scope_resolution_mode,
      step_no
    ),
    CONSTRAINT fk_approval_policy_steps_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_approval_policy_steps_policy
      FOREIGN KEY (tenant_id, policy_id) REFERENCES approval_policies(tenant_id, id)
      ON UPDATE RESTRICT ON DELETE CASCADE,
    CHECK (step_no >= 1),
    CHECK (min_approvals >= 1),
    CHECK (
      (
        scope_resolution_mode = 'CUSTOM'
        AND custom_scope_resolver_key IS NOT NULL
      )
      OR (
        scope_resolution_mode <> 'CUSTOM'
        AND custom_scope_resolver_key IS NULL
      )
    )
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const createApprovalRequestsTableSql = `
  CREATE TABLE IF NOT EXISTS approval_requests (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    request_code VARCHAR(80) NOT NULL,
    idempotency_key VARCHAR(120) NULL,
    policy_id BIGINT UNSIGNED NOT NULL,
    policy_version_no INT UNSIGNED NOT NULL,
    module_code VARCHAR(30) NOT NULL,
    target_type VARCHAR(60) NOT NULL,
    target_id BIGINT UNSIGNED NOT NULL,
    scope_type ENUM('TENANT','GROUP','COUNTRY','LEGAL_ENTITY','OPERATING_UNIT') NOT NULL,
    scope_id BIGINT UNSIGNED NOT NULL,
    legal_entity_id BIGINT UNSIGNED NULL,
    operating_unit_id BIGINT UNSIGNED NULL,
    request_status ENUM(
      'DRAFT',
      'SUBMITTED',
      'PENDING_REVIEW',
      'RETURNED',
      'APPROVED',
      'REJECTED',
      'WITHDRAWN',
      'ESCALATED'
    ) NOT NULL DEFAULT 'DRAFT',
    current_step_no TINYINT UNSIGNED NOT NULL DEFAULT 1,
    execution_status ENUM(
      'NOT_EXECUTED',
      'EXECUTED',
      'FAILED',
      'REVERSED'
    ) NOT NULL DEFAULT 'NOT_EXECUTED',
    submitted_by_user_id INT NULL,
    submitted_at TIMESTAMP NULL,
    approved_at TIMESTAMP NULL,
    rejected_at TIMESTAMP NULL,
    withdrawn_at TIMESTAMP NULL,
    executed_at TIMESTAMP NULL,
    executed_by_user_id INT NULL,
    last_activity_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    policy_snapshot_json JSON NOT NULL,
    target_snapshot_json JSON NULL,
    action_payload_json JSON NULL,
    execution_result_json JSON NULL,
    execution_error_text TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_approval_requests_tenant_id_id (tenant_id, id),
    UNIQUE KEY uk_approval_requests_request_code (tenant_id, request_code),
    UNIQUE KEY uk_approval_requests_idempotency (tenant_id, idempotency_key),
    KEY ix_approval_requests_module_status (
      tenant_id,
      module_code,
      request_status,
      execution_status
    ),
    KEY ix_approval_requests_scope (
      tenant_id,
      scope_type,
      scope_id,
      request_status
    ),
    KEY ix_approval_requests_target (
      tenant_id,
      module_code,
      target_type,
      target_id,
      request_status
    ),
    CONSTRAINT fk_approval_requests_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_approval_requests_policy
      FOREIGN KEY (tenant_id, policy_id) REFERENCES approval_policies(tenant_id, id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_approval_requests_legal_entity
      FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES legal_entities(tenant_id, id),
    CONSTRAINT fk_approval_requests_operating_unit
      FOREIGN KEY (operating_unit_id) REFERENCES operating_units(id),
    CONSTRAINT fk_approval_requests_submitted_by
      FOREIGN KEY (tenant_id, submitted_by_user_id) REFERENCES users(tenant_id, id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_approval_requests_executed_by
      FOREIGN KEY (tenant_id, executed_by_user_id) REFERENCES users(tenant_id, id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    CHECK (current_step_no >= 1)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const createApprovalDecisionsTableSql = `
  CREATE TABLE IF NOT EXISTS approval_decisions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    request_id BIGINT UNSIGNED NOT NULL,
    step_no TINYINT UNSIGNED NOT NULL,
    decision ENUM('APPROVE','REJECT','RETURN') NOT NULL,
    decided_by_user_id INT NOT NULL,
    comment TEXT NULL,
    decided_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_approval_decisions_tenant_id_id (tenant_id, id),
    UNIQUE KEY uk_approval_decisions_request_step_reviewer (
      tenant_id,
      request_id,
      step_no,
      decided_by_user_id
    ),
    KEY ix_approval_decisions_request_step (
      tenant_id,
      request_id,
      step_no,
      decided_at
    ),
    CONSTRAINT fk_approval_decisions_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_approval_decisions_request
      FOREIGN KEY (tenant_id, request_id) REFERENCES approval_requests(tenant_id, id)
      ON UPDATE RESTRICT ON DELETE CASCADE,
    CONSTRAINT fk_approval_decisions_decided_by
      FOREIGN KEY (tenant_id, decided_by_user_id) REFERENCES users(tenant_id, id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    CHECK (step_no >= 1)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const migration163GenericApprovalEngineSchema = {
  key: "m163_generic_approval_engine_schema",
  description:
    "Add generic approval policy, assignment, step, request, and decision tables in parallel with existing approval systems.",
  async up(connection) {
    await safeExecute(connection, createApprovalPoliciesTableSql);
    await safeExecute(connection, createApprovalPolicyAssignmentsTableSql);
    await safeExecute(connection, createApprovalPolicyStepsTableSql);
    await safeExecute(connection, createApprovalRequestsTableSql);
    await safeExecute(connection, createApprovalDecisionsTableSql);
  },

  async down() {
    // Non-destructive migration policy: no down-op for additive governance schema.
  },
};

export default migration163GenericApprovalEngineSchema;
