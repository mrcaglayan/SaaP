const IGNORABLE_ERRNOS = new Set([
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

const migration103CariDocumentsOperatingUnit = {
  key: "m103_cari_documents_operating_unit",
  description:
    "Add optional operating unit ownership to CARI documents so branch-level attribution can survive shared-bank workflows",
  async up(connection) {
    if (!(await hasColumn(connection, "cari_documents", "operating_unit_id"))) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_documents
         ADD COLUMN operating_unit_id BIGINT UNSIGNED NULL
         AFTER legal_entity_id`
      );
    }

    if (
      !(await hasIndex(
        connection,
        "cari_documents",
        "ix_cari_documents_tenant_entity_ou_date"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_documents
         ADD KEY ix_cari_documents_tenant_entity_ou_date (
           tenant_id,
           legal_entity_id,
           operating_unit_id,
           document_date
         )`
      );
    }

    if (
      !(await hasForeignKey(
        connection,
        "cari_documents",
        "fk_cari_documents_operating_unit"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_documents
         ADD CONSTRAINT fk_cari_documents_operating_unit
           FOREIGN KEY (operating_unit_id) REFERENCES operating_units(id)`
      );
    }
  },
};

export default migration103CariDocumentsOperatingUnit;
