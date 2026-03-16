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

const migration131CariDocumentLinesWarehouseBinding = {
  key: "m131_cari_document_lines_warehouse_binding",
  description:
    "Add nullable line-level warehouse binding to CARI document lines",
  async up(connection) {
    if (!(await hasColumn(connection, "cari_document_lines", "warehouse_id"))) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_document_lines
         ADD COLUMN warehouse_id BIGINT UNSIGNED NULL
         AFTER stock_impact_mode`
      );
    }

    await safeExecute(
      connection,
      `ALTER TABLE cari_document_lines
       ADD CONSTRAINT fk_cari_doc_lines_warehouse
       FOREIGN KEY (warehouse_id) REFERENCES inventory_warehouses(id)`
    );

    if (
      !(await hasIndex(
        connection,
        "cari_document_lines",
        "ix_cari_doc_lines_tenant_entity_warehouse"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_document_lines
         ADD KEY ix_cari_doc_lines_tenant_entity_warehouse (
           tenant_id,
           legal_entity_id,
           warehouse_id
         )`
      );
    }
  },

  async down() {
    // Non-destructive migration policy: no down-op for additive schema changes.
  },
};

export default migration131CariDocumentLinesWarehouseBinding;
