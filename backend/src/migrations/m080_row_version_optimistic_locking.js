const IGNORABLE_ERRNOS = new Set([
  1060, // ER_DUP_FIELDNAME
  1061, // ER_DUP_KEYNAME
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

const migration080RowVersionOptimisticLocking = {
  key: "m080_row_version_optimistic_locking",
  description:
    "Add row_version columns for optimistic locking on editable CARI entities (CORE03)",
  async up(connection) {
    if (!(await hasColumn(connection, "cari_documents", "row_version"))) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_documents
         ADD COLUMN row_version BIGINT UNSIGNED NOT NULL DEFAULT 1
         AFTER updated_at`
      );
    }
    if (
      !(await hasIndex(connection, "cari_documents", "ix_cari_documents_row_version_lock"))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_documents
         ADD KEY ix_cari_documents_row_version_lock (tenant_id, id, row_version)`
      );
    }

    if (!(await hasColumn(connection, "counterparties", "row_version"))) {
      await safeExecute(
        connection,
        `ALTER TABLE counterparties
         ADD COLUMN row_version BIGINT UNSIGNED NOT NULL DEFAULT 1
         AFTER updated_at`
      );
    }
    if (!(await hasIndex(connection, "counterparties", "ix_counterparties_row_version_lock"))) {
      await safeExecute(
        connection,
        `ALTER TABLE counterparties
         ADD KEY ix_counterparties_row_version_lock (tenant_id, id, row_version)`
      );
    }
  },

  async down(connection) {
    // Non-destructive migration policy: no down-op for additive lock columns.
  },
};

export default migration080RowVersionOptimisticLocking;
