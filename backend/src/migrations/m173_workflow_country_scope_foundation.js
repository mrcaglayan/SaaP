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

async function columnAllowsNull(connection, tableName, columnName) {
  const [rows] = await connection.execute(
    `SELECT is_nullable
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name = ?
      LIMIT 1`,
    [tableName, columnName]
  );
  return String(rows?.[0]?.is_nullable || "").toUpperCase() === "YES";
}

async function enumColumnIncludesValue(connection, tableName, columnName, enumValue) {
  const [rows] = await connection.execute(
    `SELECT column_type
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name = ?
      LIMIT 1`,
    [tableName, columnName]
  );
  const columnType = String(rows?.[0]?.column_type || "").toUpperCase();
  return columnType.includes(`'${String(enumValue || "").trim().toUpperCase()}'`);
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

async function countRows(connection, sql, params = []) {
  const [rows] = await connection.execute(sql, params);
  return Number(rows?.[0]?.total || 0);
}

const WORKFLOW_ASSIGNMENT_ONE_SCOPE_CHECK_SQL = `
  ALTER TABLE workflow_assignments
  ADD CONSTRAINT chk_workflow_assignments_one_scope
  CHECK (
    (
      CASE WHEN group_company_id IS NOT NULL THEN 1 ELSE 0 END
      + CASE WHEN country_id IS NOT NULL THEN 1 ELSE 0 END
      + CASE WHEN legal_entity_id IS NOT NULL THEN 1 ELSE 0 END
      + CASE WHEN operating_unit_id IS NOT NULL THEN 1 ELSE 0 END
    ) <= 1
  )
`;

const migration173WorkflowCountryScopeFoundation = {
  key: "m173_workflow_country_scope_foundation",
  description:
    "Add COUNTRY workflow assignment scope, TARGET_COUNTRY bridge support, and enforce one-row-one-scope workflow assignments.",
  async up(connection) {
    const nullCountryRows = await countRows(
      connection,
      `SELECT COUNT(*) AS total
         FROM legal_entities
        WHERE country_id IS NULL`
    );
    if (nullCountryRows > 0) {
      throw new Error(
        `Cannot enable COUNTRY workflow scope: ${nullCountryRows} legal_entities rows still have NULL country_id.`
      );
    }

    if (await columnAllowsNull(connection, "legal_entities", "country_id")) {
      await connection.execute(
        `ALTER TABLE legal_entities
           MODIFY COLUMN country_id BIGINT UNSIGNED NOT NULL`
      );
    }

    if (
      !(await enumColumnIncludesValue(
        connection,
        "workflow_definition_steps",
        "stage_scope_type",
        "COUNTRY"
      ))
    ) {
      await connection.execute(
        `ALTER TABLE workflow_definition_steps
           MODIFY COLUMN stage_scope_type ENUM(
             'OPERATING_UNIT',
             'LEGAL_ENTITY',
             'COUNTRY',
             'GROUP'
           ) NOT NULL`
      );
    }

    if (!(await columnExists(connection, "workflow_assignments", "country_id"))) {
      await safeExecute(
        connection,
        `ALTER TABLE workflow_assignments
           ADD COLUMN country_id BIGINT UNSIGNED NULL
           AFTER group_company_id`
      );
    }

    if (!(await indexExists(connection, "workflow_assignments", "ix_workflow_assignments_country_id"))) {
      await safeExecute(
        connection,
        `ALTER TABLE workflow_assignments
           ADD KEY ix_workflow_assignments_country_id (country_id)`
      );
    }

    if (
      !(await indexExists(
        connection,
        "workflow_assignments",
        "ix_workflow_assignments_process_scope_country"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE workflow_assignments
           ADD KEY ix_workflow_assignments_process_scope_country (
             tenant_id,
             process_type,
             status,
             operating_unit_id,
             legal_entity_id,
             country_id,
             group_company_id
           )`
      );
    }

    await safeExecute(
      connection,
      `ALTER TABLE workflow_assignments
         ADD CONSTRAINT fk_workflow_assignments_country
           FOREIGN KEY (country_id) REFERENCES countries(id)`
    );

    const ambiguousAssignmentRows = await countRows(
      connection,
      `SELECT COUNT(*) AS total
         FROM workflow_assignments
        WHERE (
          CASE WHEN group_company_id IS NOT NULL THEN 1 ELSE 0 END
          + CASE WHEN country_id IS NOT NULL THEN 1 ELSE 0 END
          + CASE WHEN legal_entity_id IS NOT NULL THEN 1 ELSE 0 END
          + CASE WHEN operating_unit_id IS NOT NULL THEN 1 ELSE 0 END
        ) > 1`
    );
    if (ambiguousAssignmentRows > 0) {
      throw new Error(
        `Cannot enforce workflow assignment one-scope invariant: ${ambiguousAssignmentRows} workflow_assignments rows still set more than one scope target.`
      );
    }

    await safeExecute(connection, WORKFLOW_ASSIGNMENT_ONE_SCOPE_CHECK_SQL);

    if (
      !(await enumColumnIncludesValue(
        connection,
        "approval_policy_steps",
        "scope_resolution_mode",
        "TARGET_COUNTRY"
      ))
    ) {
      await connection.execute(
        `ALTER TABLE approval_policy_steps
           MODIFY COLUMN scope_resolution_mode ENUM(
             'REQUEST_SCOPE',
             'POLICY_SCOPE',
             'TARGET_GROUP',
             'TARGET_COUNTRY',
             'TARGET_LEGAL_ENTITY',
             'TARGET_OPERATING_UNIT',
             'CUSTOM'
           ) NOT NULL DEFAULT 'REQUEST_SCOPE'`
      );
    }

    if (
      (await columnExists(connection, "approval_policy_steps", "escalation_target_scope_mode")) &&
      !(await enumColumnIncludesValue(
        connection,
        "approval_policy_steps",
        "escalation_target_scope_mode",
        "TARGET_COUNTRY"
      ))
    ) {
      await connection.execute(
        `ALTER TABLE approval_policy_steps
           MODIFY COLUMN escalation_target_scope_mode ENUM(
             'REQUEST_SCOPE',
             'POLICY_SCOPE',
             'TARGET_GROUP',
             'TARGET_COUNTRY',
             'TARGET_LEGAL_ENTITY',
             'TARGET_OPERATING_UNIT',
             'CUSTOM'
           ) NULL`
      );
    }
  },

  async down() {
    // Additive hardening only.
  },
};

export default migration173WorkflowCountryScopeFoundation;
