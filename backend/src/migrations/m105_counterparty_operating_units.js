const IGNORABLE_ERRNOS = new Set([
  1050, // ER_TABLE_EXISTS_ERROR
  1060, // ER_DUP_FIELDNAME
  1061, // ER_DUP_KEYNAME
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

async function hasTable(connection, tableName) {
  const [rows] = await connection.execute(
    `SELECT 1
     FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name = ?
     LIMIT 1`,
    [tableName]
  );
  return Array.isArray(rows) && rows.length > 0;
}

const migration105CounterpartyOperatingUnits = {
  key: "m105_counterparty_operating_units",
  description:
    "Add primary operating unit and allowed operating unit ownership model to counterparties",
  async up(connection) {
    if (!(await hasColumn(connection, "counterparties", "primary_operating_unit_id"))) {
      await safeExecute(
        connection,
        `ALTER TABLE counterparties
         ADD COLUMN primary_operating_unit_id BIGINT UNSIGNED NULL
         AFTER legal_entity_id`
      );
    }

    if (
      !(await hasIndex(
        connection,
        "counterparties",
        "ix_counterparties_tenant_entity_primary_operating_unit"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE counterparties
         ADD KEY ix_counterparties_tenant_entity_primary_operating_unit (
           tenant_id,
           legal_entity_id,
           primary_operating_unit_id
         )`
      );
    }

    if (
      !(await hasForeignKey(
        connection,
        "counterparties",
        "fk_counterparties_primary_operating_unit"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE counterparties
         ADD CONSTRAINT fk_counterparties_primary_operating_unit
           FOREIGN KEY (primary_operating_unit_id) REFERENCES operating_units(id)`
      );
    }

    if (!(await hasTable(connection, "counterparty_operating_units"))) {
      await safeExecute(
        connection,
        `CREATE TABLE counterparty_operating_units (
           id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
           tenant_id BIGINT UNSIGNED NOT NULL,
           legal_entity_id BIGINT UNSIGNED NOT NULL,
           counterparty_id BIGINT UNSIGNED NOT NULL,
           operating_unit_id BIGINT UNSIGNED NOT NULL,
           created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
           UNIQUE KEY uk_counterparty_operating_units_scope (
             tenant_id,
             legal_entity_id,
             counterparty_id,
             operating_unit_id
           ),
           KEY ix_counterparty_operating_units_tenant_counterparty (
             tenant_id,
             counterparty_id
           ),
           KEY ix_counterparty_operating_units_tenant_operating_unit (
             tenant_id,
             operating_unit_id
           ),
           CONSTRAINT fk_counterparty_operating_units_counterparty
             FOREIGN KEY (tenant_id, legal_entity_id, counterparty_id)
             REFERENCES counterparties(tenant_id, legal_entity_id, id),
           CONSTRAINT fk_counterparty_operating_units_operating_unit
             FOREIGN KEY (operating_unit_id) REFERENCES operating_units(id)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
      );
    }
  },
};

export default migration105CounterpartyOperatingUnits;
