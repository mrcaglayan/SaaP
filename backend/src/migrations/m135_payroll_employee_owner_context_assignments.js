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
    if (ignorableErrnos.has(err?.errno)) {
      return;
    }
    throw err;
  }
}

const migration135PayrollEmployeeOwnerContextAssignments = {
  key: "m135_payroll_employee_owner_context_assignments",
  description:
    "Payroll effective-dated employee owner-context assignments (PR-POU01)",
  async up(connection) {
    await safeExecute(
      connection,
      `CREATE TABLE IF NOT EXISTS payroll_employee_owner_context_assignments (
         id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
         tenant_id BIGINT UNSIGNED NOT NULL,
         legal_entity_id BIGINT UNSIGNED NOT NULL,
         employee_code VARCHAR(100) NOT NULL,
         employee_name_snapshot VARCHAR(255) NULL,
         ownership_scope ENUM('CENTRAL','OPERATING_UNIT') NOT NULL,
         operating_unit_id BIGINT UNSIGNED NULL,
         effective_from DATE NOT NULL,
         effective_to DATE NULL,
         status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
         expected_cost_center_code VARCHAR(100) NULL,
         source_type VARCHAR(40) NOT NULL DEFAULT 'MANUAL',
         notes VARCHAR(500) NULL,
         created_by_user_id INT NULL,
         updated_by_user_id INT NULL,
         deactivated_by_user_id INT NULL,
         deactivated_at TIMESTAMP NULL,
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
           ON UPDATE CURRENT_TIMESTAMP,
         UNIQUE KEY uk_peoca_scope_id
           (tenant_id, legal_entity_id, id),
         KEY ix_peoca_emp_from
           (tenant_id, legal_entity_id, employee_code, effective_from),
         KEY ix_peoca_ou_status
           (tenant_id, legal_entity_id, operating_unit_id, status),
         KEY ix_peoca_status
           (tenant_id, legal_entity_id, status),
         CONSTRAINT fk_peoca_tenant
           FOREIGN KEY (tenant_id) REFERENCES tenants(id),
         CONSTRAINT fk_peoca_legal_entity
           FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES legal_entities(tenant_id, id),
         CONSTRAINT fk_peoca_operating_unit
           FOREIGN KEY (operating_unit_id) REFERENCES operating_units(id),
         CONSTRAINT fk_peoca_created_user
           FOREIGN KEY (tenant_id, created_by_user_id) REFERENCES users(tenant_id, id),
         CONSTRAINT fk_peoca_updated_user
           FOREIGN KEY (tenant_id, updated_by_user_id) REFERENCES users(tenant_id, id),
         CONSTRAINT fk_peoca_deactivated_user
           FOREIGN KEY (tenant_id, deactivated_by_user_id) REFERENCES users(tenant_id, id)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
  },
};

export default migration135PayrollEmployeeOwnerContextAssignments;
