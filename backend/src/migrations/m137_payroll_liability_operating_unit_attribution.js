const IGNORABLE_ERRNOS = new Set([
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

async function hasColumn(connection, tableName, columnName) {
  const [rows] = await connection.execute(
    `SELECT 1
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name = ?
      LIMIT 1`,
    [tableName, columnName]
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function hasIndex(connection, tableName, indexName) {
  const [rows] = await connection.execute(
    `SELECT 1
       FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND index_name = ?
      LIMIT 1`,
    [tableName, indexName]
  );
  return Array.isArray(rows) && rows.length > 0;
}

const migration137PayrollLiabilityOperatingUnitAttribution = {
  key: "m137_payroll_liability_operating_unit_attribution",
  description: "Add explicit owner-context attribution to payroll liabilities (PR-POU05)",
  async up(connection) {
    const hasOwnershipScope = await hasColumn(
      connection,
      "payroll_run_liabilities",
      "ownership_scope"
    );
    const hasOperatingUnitId = await hasColumn(
      connection,
      "payroll_run_liabilities",
      "operating_unit_id"
    );

    if (!hasOwnershipScope) {
      await safeExecute(
        connection,
        `ALTER TABLE payroll_run_liabilities
         ADD COLUMN ownership_scope ENUM('CENTRAL','OPERATING_UNIT') NULL
         AFTER cost_center_code`
      );
    } else {
      await safeExecute(
        connection,
        `ALTER TABLE payroll_run_liabilities
         MODIFY COLUMN ownership_scope ENUM('CENTRAL','OPERATING_UNIT') NULL
         AFTER cost_center_code`
      );
    }

    if (!hasOperatingUnitId) {
      await safeExecute(
        connection,
        `ALTER TABLE payroll_run_liabilities
         ADD COLUMN operating_unit_id BIGINT UNSIGNED NULL
         AFTER ownership_scope`
      );
    }

    await safeExecute(
      connection,
      `UPDATE payroll_run_liabilities l
       JOIN payroll_run_lines rl
         ON rl.tenant_id = l.tenant_id
        AND rl.legal_entity_id = l.legal_entity_id
        AND rl.id = l.source_run_line_id
       SET l.ownership_scope = CASE
             WHEN rl.ownership_scope IN ('CENTRAL','OPERATING_UNIT') THEN rl.ownership_scope
             ELSE l.ownership_scope
           END,
           l.operating_unit_id = CASE
             WHEN rl.ownership_scope = 'CENTRAL' THEN NULL
             WHEN rl.ownership_scope = 'OPERATING_UNIT' THEN rl.operating_unit_id
             ELSE l.operating_unit_id
           END
       WHERE l.source_run_line_id IS NOT NULL`
    );

    await safeExecute(
      connection,
      `UPDATE payroll_run_liabilities l
       JOIN (
         SELECT
           rl.tenant_id,
           rl.legal_entity_id,
           rl.run_id,
           CASE
             WHEN COUNT(*) > 0
              AND COUNT(DISTINCT CONCAT(COALESCE(rl.ownership_scope, 'NULL'), '|', COALESCE(rl.operating_unit_id, 0))) = 1
              AND MIN(CASE WHEN rl.ownership_scope IN ('CENTRAL','OPERATING_UNIT') THEN 1 ELSE 0 END) = 1
             THEN MIN(rl.ownership_scope)
             ELSE NULL
           END AS uniform_ownership_scope,
           CASE
             WHEN COUNT(*) > 0
              AND COUNT(DISTINCT CONCAT(COALESCE(rl.ownership_scope, 'NULL'), '|', COALESCE(rl.operating_unit_id, 0))) = 1
              AND MIN(CASE WHEN rl.ownership_scope IN ('CENTRAL','OPERATING_UNIT') THEN 1 ELSE 0 END) = 1
             THEN MIN(CASE WHEN rl.ownership_scope = 'OPERATING_UNIT' THEN rl.operating_unit_id ELSE NULL END)
             ELSE NULL
           END AS uniform_operating_unit_id
         FROM payroll_run_lines rl
         GROUP BY rl.tenant_id, rl.legal_entity_id, rl.run_id
       ) ctx
         ON ctx.tenant_id = l.tenant_id
        AND ctx.legal_entity_id = l.legal_entity_id
        AND ctx.run_id = l.run_id
       SET l.ownership_scope = CASE
             WHEN l.ownership_scope IS NULL THEN ctx.uniform_ownership_scope
             ELSE l.ownership_scope
           END,
           l.operating_unit_id = CASE
             WHEN l.ownership_scope = 'CENTRAL' THEN NULL
             WHEN l.ownership_scope = 'OPERATING_UNIT' THEN l.operating_unit_id
             WHEN ctx.uniform_ownership_scope = 'CENTRAL' THEN NULL
             WHEN ctx.uniform_ownership_scope = 'OPERATING_UNIT' THEN ctx.uniform_operating_unit_id
             ELSE l.operating_unit_id
           END
       WHERE l.source_run_line_id IS NULL
         AND ctx.uniform_ownership_scope IS NOT NULL`
    );

    if (
      !(await hasIndex(
        connection,
        "payroll_run_liabilities",
        "ix_payroll_run_liabilities_scope_owner_status"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE payroll_run_liabilities
         ADD KEY ix_payroll_run_liabilities_scope_owner_status (
           tenant_id,
           legal_entity_id,
           run_id,
           ownership_scope,
           operating_unit_id,
           status
         )`
      );
    }

    await safeExecute(
      connection,
      `ALTER TABLE payroll_run_liabilities
       ADD CONSTRAINT fk_payroll_run_liabilities_operating_unit
       FOREIGN KEY (operating_unit_id) REFERENCES operating_units(id)`
    );
  },

  async down() {
    // Non-destructive migration policy: no down-op for additive schema changes.
  },
};

export default migration137PayrollLiabilityOperatingUnitAttribution;
