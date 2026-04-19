const IGNORABLE_ERRNOS = new Set([
  1091, // ER_CANT_DROP_FIELD_OR_KEY
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
    [tableName, columnName],
  );
  return Boolean(rows?.[0]);
}

const migration202DropWorkflowDefinitionStepsRequiredPackageCode = {
  key: "m202_drop_workflow_definition_steps_required_package_code",
  description:
    "Drop the retired workflow step package-code column after permission-first workflow contracts.",
  async up(connection) {
    if (
      await columnExists(
        connection,
        "workflow_definition_steps",
        "required_package_code",
      )
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE workflow_definition_steps
           DROP COLUMN required_package_code`,
      );
    }
  },

  async down() {
    // Hard-delete migration. No down path.
  },
};

export default migration202DropWorkflowDefinitionStepsRequiredPackageCode;
