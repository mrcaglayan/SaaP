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

const migration111CashRegisterOwnershipScope = {
  key: "m111_cash_register_ownership_scope",
  description:
    "Add explicit CENTRAL vs OPERATING_UNIT ownership scope to cash registers without changing central no-OU posting semantics",
  async up(connection) {
    if (!(await hasColumn(connection, "cash_registers", "ownership_scope"))) {
      await safeExecute(
        connection,
        `ALTER TABLE cash_registers
         ADD COLUMN ownership_scope ENUM('CENTRAL','OPERATING_UNIT') NOT NULL DEFAULT 'CENTRAL'
         AFTER legal_entity_id`
      );
    } else {
      await safeExecute(
        connection,
        `ALTER TABLE cash_registers
         MODIFY COLUMN ownership_scope ENUM('CENTRAL','OPERATING_UNIT') NOT NULL DEFAULT 'CENTRAL'
         AFTER legal_entity_id`
      );
    }

    await safeExecute(
      connection,
      `UPDATE cash_registers
       SET ownership_scope = CASE
         WHEN operating_unit_id IS NULL THEN 'CENTRAL'
         ELSE 'OPERATING_UNIT'
       END`
    );

    if (
      !(await hasIndex(
        connection,
        "cash_registers",
        "ix_cash_register_tenant_ownership_scope"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cash_registers
         ADD KEY ix_cash_register_tenant_ownership_scope (
           tenant_id,
           legal_entity_id,
           ownership_scope,
           status
         )`
      );
    }
  },

  async down() {
    // Non-destructive migration policy: no down-op for additive schema changes.
  },
};

export default migration111CashRegisterOwnershipScope;
