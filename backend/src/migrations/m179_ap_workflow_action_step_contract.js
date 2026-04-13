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

const migration179ApWorkflowActionStepContract = {
  key: "m179_ap_workflow_action_step_contract",
  description:
    "Add explicit action/package fields to workflow definition steps for AP action-step authoring.",
  async up(connection) {
    if (!(await columnExists(connection, "workflow_definition_steps", "action_code"))) {
      await safeExecute(
        connection,
        `ALTER TABLE workflow_definition_steps
           ADD COLUMN action_code VARCHAR(32) NULL
           AFTER step_no`
      );
    }

    if (
      !(await columnExists(connection, "workflow_definition_steps", "required_package_code"))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE workflow_definition_steps
           ADD COLUMN required_package_code VARCHAR(120) NULL
           AFTER required_permission_code`
      );
    }
  },

  async down() {
    // Additive hardening only.
  },
};

export default migration179ApWorkflowActionStepContract;
