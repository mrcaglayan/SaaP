const ignorableErrnos = new Set([
  1060, // ER_DUP_FIELDNAME
]);

async function safeExecute(connection, sql, params = []) {
  try {
    await connection.execute(sql, params);
  } catch (err) {
    if (ignorableErrnos.has(Number(err?.errno))) {
      return;
    }
    throw err;
  }
}

const migration162TemporalRoleAssignments = {
  key: "m162_temporal_role_assignments",
  description: "Add effective dating to user role scope assignments.",
  async up(connection) {
    await safeExecute(
      connection,
      `ALTER TABLE user_role_scopes
         ADD COLUMN effective_from DATE NULL DEFAULT NULL AFTER effect`
    );
    await safeExecute(
      connection,
      `ALTER TABLE user_role_scopes
         ADD COLUMN effective_to DATE NULL DEFAULT NULL AFTER effective_from`
    );
  },
};

export default migration162TemporalRoleAssignments;
