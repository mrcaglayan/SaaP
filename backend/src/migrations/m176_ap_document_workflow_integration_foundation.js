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

const migration176ApDocumentWorkflowIntegrationFoundation = {
  key: "m176_ap_document_workflow_integration_foundation",
  description:
    "Extend workflow schema for AP document workflow integration, return/supersede history, and multi-instance target cycles.",
  async up(connection) {
    if (
      !(await enumColumnIncludesValue(
        connection,
        "workflow_definitions",
        "process_type",
        "AP_DOCUMENT_POSTING"
      ))
    ) {
      await connection.execute(
        `ALTER TABLE workflow_definitions
           MODIFY COLUMN process_type ENUM(
             'PERIOD_CLOSE',
             'CONSOLIDATION_RUN',
             'LOCAL_CLOSE_PACK',
             'AP_DOCUMENT_POSTING'
           ) NOT NULL`
      );
    }

    if (
      !(await enumColumnIncludesValue(
        connection,
        "workflow_assignments",
        "process_type",
        "AP_DOCUMENT_POSTING"
      ))
    ) {
      await connection.execute(
        `ALTER TABLE workflow_assignments
           MODIFY COLUMN process_type ENUM(
             'PERIOD_CLOSE',
             'CONSOLIDATION_RUN',
             'LOCAL_CLOSE_PACK',
             'AP_DOCUMENT_POSTING'
           ) NOT NULL`
      );
    }

    if (
      !(await enumColumnIncludesValue(
        connection,
        "workflow_instances",
        "process_type",
        "AP_DOCUMENT_POSTING"
      ))
    ) {
      await connection.execute(
        `ALTER TABLE workflow_instances
           MODIFY COLUMN process_type ENUM(
             'PERIOD_CLOSE',
             'CONSOLIDATION_RUN',
             'LOCAL_CLOSE_PACK',
             'AP_DOCUMENT_POSTING'
           ) NOT NULL`
      );
    }

    if (
      !(await enumColumnIncludesValue(
        connection,
        "workflow_instances",
        "target_type",
        "CARI_DOCUMENT"
      ))
    ) {
      await connection.execute(
        `ALTER TABLE workflow_instances
           MODIFY COLUMN target_type ENUM(
             'PERIOD_CLOSE_RUN',
             'CONSOLIDATION_RUN',
             'LOCAL_CLOSE_PACK',
             'CARI_DOCUMENT'
           ) NOT NULL`
      );
    }

    if (
      !(await enumColumnIncludesValue(
        connection,
        "workflow_instances",
        "status",
        "SUPERSEDED"
      ))
    ) {
      await connection.execute(
        `ALTER TABLE workflow_instances
           MODIFY COLUMN status ENUM(
             'PENDING',
             'APPROVED',
             'REJECTED',
             'CANCELLED',
             'SUPERSEDED'
           ) NOT NULL DEFAULT 'PENDING'`
      );
    }

    if (
      !(await enumColumnIncludesValue(
        connection,
        "workflow_instance_decisions",
        "decision",
        "RETURN"
      ))
    ) {
      await connection.execute(
        `ALTER TABLE workflow_instance_decisions
           MODIFY COLUMN decision ENUM(
             'APPROVE',
             'REJECT',
             'RETURN'
           ) NOT NULL`
      );
    }

    if (!(await columnAllowsNull(connection, "workflow_definition_steps", "required_permission_code"))) {
      await connection.execute(
        `ALTER TABLE workflow_definition_steps
           MODIFY COLUMN required_permission_code VARCHAR(120) NULL`
      );
    }

    if (!(await columnAllowsNull(connection, "approval_policy_steps", "required_permission_code"))) {
      await connection.execute(
        `ALTER TABLE approval_policy_steps
           MODIFY COLUMN required_permission_code VARCHAR(120) NULL`
      );
    }

    if (await indexExists(connection, "workflow_instances", "uk_workflow_instances_target")) {
      await safeExecute(
        connection,
        `ALTER TABLE workflow_instances
           DROP INDEX uk_workflow_instances_target`
      );
    }

    if (
      !(await indexExists(
        connection,
        "workflow_instances",
        "ix_workflow_instances_target_lookup"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE workflow_instances
           ADD KEY ix_workflow_instances_target_lookup (
             tenant_id,
             process_type,
             target_type,
             target_id,
             id
           )`
      );
    }
  },

  async down() {
    // Additive hardening only.
  },
};

export default migration176ApDocumentWorkflowIntegrationFoundation;
