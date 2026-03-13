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

async function hasForeignKey(connection, tableName, constraintName) {
  const [rows] = await connection.execute(
    `SELECT 1
     FROM information_schema.table_constraints
     WHERE table_schema = DATABASE()
       AND table_name = ?
       AND constraint_name = ?
       AND constraint_type = 'FOREIGN KEY'
     LIMIT 1`,
    [tableName, constraintName]
  );
  return Array.isArray(rows) && rows.length > 0;
}

const migration125OperatingUnitReverseInternalCurrentAccounts = {
  key: "m125_operating_unit_reverse_internal_current_accounts",
  description:
    "Add reverse-direction central and operating-unit internal current-account mappings for OU self-balancing",
  async up(connection) {
    if (!(await hasColumn(connection, "operating_units", "central_due_to_account_id"))) {
      await safeExecute(
        connection,
        `ALTER TABLE operating_units
         ADD COLUMN central_due_to_account_id BIGINT UNSIGNED NULL
         AFTER central_due_from_account_id`
      );
    }

    if (
      !(await hasColumn(connection, "operating_units", "ou_due_from_central_account_id"))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE operating_units
         ADD COLUMN ou_due_from_central_account_id BIGINT UNSIGNED NULL
         AFTER central_due_to_account_id`
      );
    }

    if (
      !(await hasIndex(
        connection,
        "operating_units",
        "ix_operating_units_central_due_to_account"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE operating_units
         ADD KEY ix_operating_units_central_due_to_account (
           central_due_to_account_id
         )`
      );
    }

    if (
      !(await hasIndex(
        connection,
        "operating_units",
        "ix_operating_units_ou_due_from_central_account"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE operating_units
         ADD KEY ix_operating_units_ou_due_from_central_account (
           ou_due_from_central_account_id
         )`
      );
    }

    if (
      !(await hasForeignKey(
        connection,
        "operating_units",
        "fk_operating_units_central_due_to_account"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE operating_units
         ADD CONSTRAINT fk_operating_units_central_due_to_account
           FOREIGN KEY (central_due_to_account_id) REFERENCES accounts(id)`
      );
    }

    if (
      !(await hasForeignKey(
        connection,
        "operating_units",
        "fk_operating_units_ou_due_from_central_account"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE operating_units
         ADD CONSTRAINT fk_operating_units_ou_due_from_central_account
           FOREIGN KEY (ou_due_from_central_account_id) REFERENCES accounts(id)`
      );
    }
  },

  async down() {
    // Non-destructive migration policy: no down-op for additive schema changes.
  },
};

export default migration125OperatingUnitReverseInternalCurrentAccounts;
