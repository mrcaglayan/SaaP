/**
 * m205 - Generic close-alert subject pointer.
 *
 * Adds durable subject columns so task alerts can live in `close_alerts`
 * alongside cycle and cycle-item alerts.
 */

const IGNORABLE_ERRNOS = new Set([
  1060, // ER_DUP_FIELDNAME
  1061, // ER_DUP_KEYNAME
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

async function addColumnIfMissing(connection, tableName, columnName, definitionSql) {
  if (await columnExists(connection, tableName, columnName)) {
    return;
  }
  await safeExecute(connection, `ALTER TABLE ${tableName} ADD COLUMN ${definitionSql}`);
}

const migration205CloseAlertsGenericSubject = {
  key: "m205_close_alerts_generic_subject",
  description:
    "Add generic close-alert subject columns for durable close checklist task alerts.",
  async up(connection) {
    await addColumnIfMissing(
      connection,
      "close_alerts",
      "subject_type",
      "subject_type VARCHAR(80) NULL AFTER close_cycle_item_id",
    );
    await addColumnIfMissing(
      connection,
      "close_alerts",
      "subject_id",
      "subject_id BIGINT UNSIGNED NULL AFTER subject_type",
    );
    await safeExecute(
      connection,
      `ALTER TABLE close_alerts
         ADD KEY ix_close_alerts_subject_state (
           tenant_id,
           subject_type,
           subject_id,
           alert_state
         )`,
    );
    await safeExecute(
      connection,
      `ALTER TABLE close_alerts
         ADD KEY ix_close_alerts_cycle_subject_state (
           tenant_id,
           close_cycle_id,
           subject_type,
           alert_state,
           severity
         )`,
    );
  },

  async down() {
    // Additive compatibility metadata only.
  },
};

export default migration205CloseAlertsGenericSubject;
