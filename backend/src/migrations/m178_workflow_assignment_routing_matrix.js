const IGNORABLE_ERRNOS = new Set([
  1050, // ER_TABLE_EXISTS_ERROR
  1060, // ER_DUP_FIELDNAME
  1061, // ER_DUP_KEYNAME
  1091, // ER_CANT_DROP_FIELD_OR_KEY
  1826, // ER_FK_DUP_NAME
  3822, // ER_CHECK_CONSTRAINT_DUP_NAME
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

async function columnExists(connection, tableName, columnName) {
  const [rows] = await connection.execute(
    `SELECT 1
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name = ?
      LIMIT 1`,
    [tableName, columnName]
  );
  return Boolean(rows?.[0]);
}

async function indexExists(connection, tableName, indexName) {
  const [rows] = await connection.execute(
    `SELECT 1
       FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND index_name = ?
      LIMIT 1`,
    [tableName, indexName]
  );
  return Boolean(rows?.[0]);
}

const migration178WorkflowAssignmentRoutingMatrix = {
  key: "m178_workflow_assignment_routing_matrix",
  description:
    "Add amount-band routing matrix fields and routing lookup indexes to workflow assignments.",
  async up(connection) {
    if (!(await columnExists(connection, "workflow_assignments", "amount_basis"))) {
      await safeExecute(
        connection,
        `ALTER TABLE workflow_assignments
           ADD COLUMN amount_basis ENUM('BASE_AMOUNT') NULL
           AFTER operating_unit_id`
      );
    }

    if (!(await columnExists(connection, "workflow_assignments", "min_amount"))) {
      await safeExecute(
        connection,
        `ALTER TABLE workflow_assignments
           ADD COLUMN min_amount DECIMAL(20,6) NULL
           AFTER amount_basis`
      );
    }

    if (!(await columnExists(connection, "workflow_assignments", "max_amount"))) {
      await safeExecute(
        connection,
        `ALTER TABLE workflow_assignments
           ADD COLUMN max_amount DECIMAL(20,6) NULL
           AFTER min_amount`
      );
    }

    if (!(await columnExists(connection, "workflow_assignments", "priority"))) {
      await safeExecute(
        connection,
        `ALTER TABLE workflow_assignments
           ADD COLUMN priority INT NOT NULL DEFAULT 100
           AFTER max_amount`
      );
    }

    if (!(await columnExists(connection, "workflow_assignments", "is_fallback"))) {
      await safeExecute(
        connection,
        `ALTER TABLE workflow_assignments
           ADD COLUMN is_fallback BOOLEAN NOT NULL DEFAULT FALSE
           AFTER priority`
      );
    }

    if (
      !(await indexExists(
        connection,
        "workflow_assignments",
        "ix_workflow_assignments_routing_scope_window"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE workflow_assignments
           ADD KEY ix_workflow_assignments_routing_scope_window (
             tenant_id,
             process_type,
             status,
             operating_unit_id,
             legal_entity_id,
             country_id,
             group_company_id,
             effective_from,
             effective_to,
             is_fallback,
             priority
           )`
      );
    }

    if (
      !(await indexExists(
        connection,
        "workflow_assignments",
        "ix_workflow_assignments_routing_amount_band"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE workflow_assignments
           ADD KEY ix_workflow_assignments_routing_amount_band (
             tenant_id,
             process_type,
             amount_basis,
             min_amount,
             max_amount
           )`
      );
    }

    await safeExecute(
      connection,
      `ALTER TABLE workflow_assignments
         ADD CONSTRAINT chk_workflow_assignments_amount_bounds
         CHECK (
           (min_amount IS NULL OR min_amount >= 0)
           AND (max_amount IS NULL OR max_amount >= 0)
           AND (
             min_amount IS NULL
             OR max_amount IS NULL
             OR min_amount <= max_amount
           )
         )`
    );

    await safeExecute(
      connection,
      `ALTER TABLE workflow_assignments
         ADD CONSTRAINT chk_workflow_assignments_priority_non_negative
         CHECK (priority >= 0)`
    );
  },

  async down() {
    // Additive hardening only.
  },
};

export default migration178WorkflowAssignmentRoutingMatrix;
