/**
 * m153 - CARI same-document charge allocation foundation for Track 40.
 *
 * Adds a persisted charge-allocation method to cari_document_lines and a
 * linking table that records which standard lines receive the absorbed cost.
 * Existing rows remain backward compatible through the default `NONE` method.
 */

const ignorableErrnos = new Set([
  1050, // ER_TABLE_EXISTS_ERROR
  1060, // ER_DUP_FIELDNAME
  1061, // ER_DUP_KEYNAME
  1826, // ER_FK_DUP_NAME
]);

const CHECK_CONSTRAINT_CHARGE_TARGET_NOT_SELF =
  "chk_cari_doc_line_charge_target_not_self";

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

async function hasCheckConstraint(connection, tableName, constraintName) {
  const [rows] = await connection.execute(
    `SELECT 1
       FROM information_schema.table_constraints
      WHERE constraint_schema = DATABASE()
        AND table_name = ?
        AND constraint_type = 'CHECK'
        AND constraint_name = ?
      LIMIT 1`,
    [tableName, constraintName]
  );
  return Array.isArray(rows) && rows.length > 0;
}

const migration153CariDocumentLineChargeAllocations = {
  key: "m153_cari_document_line_charge_allocations",
  description:
    "Add CARI same-document charge-allocation metadata and charge-target rows.",
  async up(connection) {
    if (
      !(await hasColumn(
        connection,
        "cari_document_lines",
        "charge_allocation_method"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_document_lines
           ADD COLUMN charge_allocation_method
             ENUM('NONE','EQUAL','BY_AMOUNT','BY_QTY','MANUAL')
             NOT NULL DEFAULT 'NONE'
             AFTER fixed_asset_mode`
      );
    }

    if (!(await hasTable(connection, "cari_document_line_charge_targets"))) {
      await safeExecute(
        connection,
        `CREATE TABLE cari_document_line_charge_targets (
           id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
           tenant_id BIGINT UNSIGNED NOT NULL,
           legal_entity_id BIGINT UNSIGNED NOT NULL,
           charge_line_id BIGINT UNSIGNED NOT NULL,
           target_line_id BIGINT UNSIGNED NOT NULL,
           allocated_amount_txn DECIMAL(20,6) NOT NULL DEFAULT 0.000000,
           allocated_amount_base DECIMAL(20,6) NULL,
           created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
           PRIMARY KEY (id),
           UNIQUE KEY uk_cari_doc_line_charge_target (charge_line_id, target_line_id),
           KEY idx_cari_doc_line_charge_target_target (target_line_id),
           CONSTRAINT fk_cari_doc_line_charge_target_charge
             FOREIGN KEY (charge_line_id) REFERENCES cari_document_lines(id)
             ON DELETE CASCADE,
           CONSTRAINT fk_cari_doc_line_charge_target_target
             FOREIGN KEY (target_line_id) REFERENCES cari_document_lines(id)
             ON DELETE CASCADE
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
      );
    }

    if (
      !(await hasIndex(
        connection,
        "cari_document_lines",
        "ix_cari_doc_lines_charge_allocation_method"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_document_lines
           ADD KEY ix_cari_doc_lines_charge_allocation_method
             (tenant_id, legal_entity_id, cari_document_id, charge_allocation_method)`
      );
    }

    if (
      await hasTable(connection, "cari_document_line_charge_targets")
      && !(await hasCheckConstraint(
        connection,
        "cari_document_line_charge_targets",
        CHECK_CONSTRAINT_CHARGE_TARGET_NOT_SELF
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_document_line_charge_targets
           ADD CONSTRAINT ${CHECK_CONSTRAINT_CHARGE_TARGET_NOT_SELF}
           CHECK (charge_line_id <> target_line_id)`
      );
    }
  },
};

export default migration153CariDocumentLineChargeAllocations;
