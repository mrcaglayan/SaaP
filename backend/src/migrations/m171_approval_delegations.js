/**
 * m171 - Approval delegation.
 *
 * Adds scoped approval-acting delegations plus explicit approval-decision
 * audit columns so the engine can record:
 * - the human actor who clicked approve/reject
 * - the delegator whose authority was used, when applicable
 * - the delegation row used to authorize the action
 * - the reviewer authority identity used for min-approval dedupe
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

const createApprovalDelegationsTableSql = `
  CREATE TABLE IF NOT EXISTS approval_delegations (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    delegator_user_id INT NOT NULL,
    delegate_user_id INT NOT NULL,
    module_code VARCHAR(30) NULL,
    scope_type ENUM(
      'TENANT',
      'GROUP',
      'COUNTRY',
      'LEGAL_ENTITY',
      'OPERATING_UNIT'
    ) NOT NULL,
    scope_id BIGINT UNSIGNED NOT NULL,
    effective_from DATE NULL,
    effective_to DATE NULL,
    note VARCHAR(255) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by_user_id INT NULL,
    revoked_by_user_id INT NULL,
    revoked_reason VARCHAR(255) NULL,
    revoked_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_approval_delegations_tenant_id_id (tenant_id, id),
    KEY ix_approval_delegations_delegate_lookup (
      tenant_id,
      delegate_user_id,
      is_active,
      module_code,
      effective_from,
      effective_to
    ),
    KEY ix_approval_delegations_delegator_lookup (
      tenant_id,
      delegator_user_id,
      is_active,
      module_code
    ),
    KEY ix_approval_delegations_scope (
      tenant_id,
      scope_type,
      scope_id,
      is_active
    ),
    CONSTRAINT fk_approval_delegations_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_approval_delegations_delegator
      FOREIGN KEY (tenant_id, delegator_user_id) REFERENCES users(tenant_id, id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_approval_delegations_delegate
      FOREIGN KEY (tenant_id, delegate_user_id) REFERENCES users(tenant_id, id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_approval_delegations_created_by
      FOREIGN KEY (tenant_id, created_by_user_id) REFERENCES users(tenant_id, id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_approval_delegations_revoked_by
      FOREIGN KEY (tenant_id, revoked_by_user_id) REFERENCES users(tenant_id, id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    CHECK (delegator_user_id <> delegate_user_id),
    CHECK (
      effective_from IS NULL
      OR effective_to IS NULL
      OR effective_to >= effective_from
    )
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const migration171ApprovalDelegations = {
  key: "m171_approval_delegations",
  description:
    "Add scoped approval delegations and explicit delegated-acting audit columns on approval decisions.",
  async up(connection) {
    await safeExecute(connection, createApprovalDelegationsTableSql);

    await safeExecute(
      connection,
      `ALTER TABLE approval_decisions
         ADD COLUMN acting_user_id INT NULL
         AFTER decided_by_user_id`
    );
    await safeExecute(
      connection,
      `ALTER TABLE approval_decisions
         ADD COLUMN delegator_user_id INT NULL
         AFTER acting_user_id`
    );
    await safeExecute(
      connection,
      `ALTER TABLE approval_decisions
         ADD COLUMN delegation_id BIGINT UNSIGNED NULL
         AFTER delegator_user_id`
    );
    await safeExecute(
      connection,
      `ALTER TABLE approval_decisions
         ADD COLUMN reviewer_authority_user_id INT NULL
         AFTER delegation_id`
    );

    await connection.execute(
      `UPDATE approval_decisions
          SET acting_user_id = COALESCE(acting_user_id, decided_by_user_id),
              reviewer_authority_user_id = COALESCE(
                reviewer_authority_user_id,
                delegator_user_id,
                acting_user_id,
                decided_by_user_id
              )
        WHERE acting_user_id IS NULL
           OR reviewer_authority_user_id IS NULL`
    );

    await connection.execute(
      `ALTER TABLE approval_decisions
         MODIFY COLUMN acting_user_id INT NOT NULL`
    );
    await connection.execute(
      `ALTER TABLE approval_decisions
         MODIFY COLUMN reviewer_authority_user_id INT NOT NULL`
    );

    await safeExecute(
      connection,
      `ALTER TABLE approval_decisions
         ADD KEY ix_approval_decisions_delegation (tenant_id, delegation_id)`
    );
    await safeExecute(
      connection,
      `ALTER TABLE approval_decisions
         ADD UNIQUE KEY uk_approval_decisions_request_step_authority (
           tenant_id,
           request_id,
           step_no,
           reviewer_authority_user_id
         )`
    );
    await safeExecute(
      connection,
      `ALTER TABLE approval_decisions
         ADD CONSTRAINT fk_approval_decisions_acting_user
           FOREIGN KEY (tenant_id, acting_user_id) REFERENCES users(tenant_id, id)
           ON UPDATE RESTRICT ON DELETE RESTRICT`
    );
    await safeExecute(
      connection,
      `ALTER TABLE approval_decisions
         ADD CONSTRAINT fk_approval_decisions_delegator_user
           FOREIGN KEY (tenant_id, delegator_user_id) REFERENCES users(tenant_id, id)
           ON UPDATE RESTRICT ON DELETE RESTRICT`
    );
    await safeExecute(
      connection,
      `ALTER TABLE approval_decisions
         ADD CONSTRAINT fk_approval_decisions_delegation
           FOREIGN KEY (tenant_id, delegation_id)
           REFERENCES approval_delegations(tenant_id, id)
           ON UPDATE RESTRICT ON DELETE RESTRICT`
    );
    await safeExecute(
      connection,
      `ALTER TABLE approval_decisions
         ADD CONSTRAINT fk_approval_decisions_authority_user
           FOREIGN KEY (tenant_id, reviewer_authority_user_id)
           REFERENCES users(tenant_id, id)
           ON UPDATE RESTRICT ON DELETE RESTRICT`
    );
  },

  async down() {
    // Non-destructive additive migration.
  },
};

export default migration171ApprovalDelegations;
