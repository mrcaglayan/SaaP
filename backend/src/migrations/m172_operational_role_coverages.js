/**
 * m172 - Temporary operational role coverage workflow.
 *
 * Adds one dedicated workflow table that keeps approval-linked absence coverage
 * separate from approval delegation while still materializing approved windows
 * into `user_role_scopes`.
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

const createOperationalRoleCoveragesTableSql = `
  CREATE TABLE IF NOT EXISTS operational_role_coverages (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    approval_request_id BIGINT UNSIGNED NULL,
    requester_user_id INT NOT NULL,
    delegate_user_id INT NOT NULL,
    role_id BIGINT UNSIGNED NOT NULL,
    scope_type ENUM('LEGAL_ENTITY','OPERATING_UNIT') NOT NULL,
    scope_id BIGINT UNSIGNED NOT NULL,
    legal_entity_id BIGINT UNSIGNED NOT NULL,
    operating_unit_id BIGINT UNSIGNED NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    note VARCHAR(255) NULL,
    approved_by_user_id INT NULL,
    approved_at TIMESTAMP NULL,
    activated_by_user_id INT NULL,
    activated_at TIMESTAMP NULL,
    rejected_by_user_id INT NULL,
    rejected_at TIMESTAMP NULL,
    revoked_by_user_id INT NULL,
    revoked_at TIMESTAMP NULL,
    revoked_reason VARCHAR(255) NULL,
    materialized_assignment_id BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_operational_role_coverages_tenant_id_id (tenant_id, id),
    UNIQUE KEY uk_operational_role_coverages_request (tenant_id, approval_request_id),
    KEY ix_operational_role_coverages_scope (
      tenant_id,
      scope_type,
      scope_id,
      start_date,
      end_date
    ),
    KEY ix_operational_role_coverages_delegate (
      tenant_id,
      delegate_user_id,
      start_date,
      end_date
    ),
    KEY ix_operational_role_coverages_requester (
      tenant_id,
      requester_user_id,
      created_at
    ),
    KEY ix_operational_role_coverages_role (
      tenant_id,
      role_id,
      start_date,
      end_date
    ),
    CONSTRAINT fk_operational_role_coverages_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_operational_role_coverages_request
      FOREIGN KEY (tenant_id, approval_request_id)
      REFERENCES approval_requests(tenant_id, id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_operational_role_coverages_requester
      FOREIGN KEY (tenant_id, requester_user_id) REFERENCES users(tenant_id, id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_operational_role_coverages_delegate
      FOREIGN KEY (tenant_id, delegate_user_id) REFERENCES users(tenant_id, id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_operational_role_coverages_role
      FOREIGN KEY (role_id) REFERENCES roles(id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_operational_role_coverages_legal_entity
      FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES legal_entities(tenant_id, id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_operational_role_coverages_operating_unit
      FOREIGN KEY (operating_unit_id) REFERENCES operating_units(id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_operational_role_coverages_approved_by
      FOREIGN KEY (tenant_id, approved_by_user_id) REFERENCES users(tenant_id, id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_operational_role_coverages_activated_by
      FOREIGN KEY (tenant_id, activated_by_user_id) REFERENCES users(tenant_id, id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_operational_role_coverages_rejected_by
      FOREIGN KEY (tenant_id, rejected_by_user_id) REFERENCES users(tenant_id, id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_operational_role_coverages_revoked_by
      FOREIGN KEY (tenant_id, revoked_by_user_id) REFERENCES users(tenant_id, id)
      ON UPDATE RESTRICT ON DELETE RESTRICT,
    CHECK (requester_user_id <> delegate_user_id),
    CHECK (end_date >= start_date),
    CHECK (
      (
        scope_type = 'LEGAL_ENTITY'
        AND legal_entity_id = scope_id
        AND operating_unit_id IS NULL
      )
      OR (
        scope_type = 'OPERATING_UNIT'
        AND operating_unit_id = scope_id
      )
    )
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const migration172OperationalRoleCoverages = {
  key: "m172_operational_role_coverages",
  description:
    "Add temporary operational role coverage workflow storage linked to approval requests.",
  async up(connection) {
    await safeExecute(connection, createOperationalRoleCoveragesTableSql);
  },

  async down() {
    // Non-destructive additive migration.
  },
};

export default migration172OperationalRoleCoverages;
