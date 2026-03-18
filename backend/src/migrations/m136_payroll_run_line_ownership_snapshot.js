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

const migration136PayrollRunLineOwnershipSnapshot = {
  key: "m136_payroll_run_line_ownership_snapshot",
  description: "Payroll run-line ownership snapshot fields (PR-POU02)",
  async up(connection) {
    await safeExecute(
      connection,
      `ALTER TABLE payroll_runs
         ADD COLUMN ownership_as_of_date DATE NULL AFTER pay_date`
    );

    await safeExecute(
      connection,
      `ALTER TABLE payroll_run_lines
         ADD COLUMN ownership_scope ENUM('CENTRAL','OPERATING_UNIT') NULL AFTER cost_center_code`
    );
    await safeExecute(
      connection,
      `ALTER TABLE payroll_run_lines
         ADD COLUMN operating_unit_id BIGINT UNSIGNED NULL AFTER ownership_scope`
    );
    await safeExecute(
      connection,
      `ALTER TABLE payroll_run_lines
         ADD COLUMN ownership_assignment_id BIGINT UNSIGNED NULL AFTER operating_unit_id`
    );
    await safeExecute(
      connection,
      `ALTER TABLE payroll_run_lines
         ADD COLUMN ownership_resolution_status
           ENUM('RESOLVED','UNRESOLVED','AMBIGUOUS','MISMATCH')
           NOT NULL DEFAULT 'UNRESOLVED'
           AFTER ownership_assignment_id`
    );
    await safeExecute(
      connection,
      `ALTER TABLE payroll_run_lines
         ADD COLUMN ownership_resolution_note VARCHAR(255) NULL
           AFTER ownership_resolution_status`
    );

    await safeExecute(
      connection,
      `ALTER TABLE payroll_run_lines
         ADD KEY ix_prl_own_ctx
           (tenant_id, legal_entity_id, run_id, ownership_scope, operating_unit_id)`
    );
    await safeExecute(
      connection,
      `ALTER TABLE payroll_run_lines
         ADD KEY ix_prl_own_status
           (tenant_id, legal_entity_id, run_id, ownership_resolution_status)`
    );

    await safeExecute(
      connection,
      `ALTER TABLE payroll_run_lines
         ADD CONSTRAINT fk_prl_ou
           FOREIGN KEY (operating_unit_id) REFERENCES operating_units(id)`
    );
    await safeExecute(
      connection,
      `ALTER TABLE payroll_run_lines
         ADD CONSTRAINT fk_prl_own_asn
           FOREIGN KEY (ownership_assignment_id)
           REFERENCES payroll_employee_owner_context_assignments(id)`
    );
  },
};

export default migration136PayrollRunLineOwnershipSnapshot;
