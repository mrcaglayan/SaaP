/**
 * m146 - CARI document settlement-mode foundation for Track 39.
 *
 * Adds immediate-cash header metadata and auto-settlement tracking columns on
 * cari_documents. Existing accrual documents remain backward-compatible via
 * ACCRUAL default/NULL tracking behavior.
 */

const ignorableErrnos = new Set([
  1060, // ER_DUP_FIELDNAME
  1061, // ER_DUP_KEYNAME
  1826, // ER_FK_DUP_NAME
]);

const CHECK_CONSTRAINT_SETTLEMENT_CASH_REGISTER_REQUIRED =
  "chk_cari_docs_settlement_cash_register_required";

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

async function addColumnIfMissing(connection, tableName, columnName, definitionSql) {
  if (await hasColumn(connection, tableName, columnName)) {
    return;
  }
  await safeExecute(
    connection,
    `ALTER TABLE ${tableName} ADD COLUMN ${definitionSql}`
  );
}

const migration146CariDocumentsSettlementMode = {
  key: "m146_cari_documents_settlement_mode",
  description:
    "Add immediate-cash settlement header fields and auto-settlement tracking to CARI documents.",
  async up(connection) {
    await addColumnIfMissing(
      connection,
      "cari_documents",
      "settlement_mode",
      `settlement_mode ENUM('ACCRUAL','IMMEDIATE_CASH')
         NOT NULL DEFAULT 'ACCRUAL'
         AFTER due_date`
    );
    await addColumnIfMissing(
      connection,
      "cari_documents",
      "settlement_cash_register_id",
      `settlement_cash_register_id BIGINT UNSIGNED NULL
         AFTER settlement_mode`
    );
    await addColumnIfMissing(
      connection,
      "cari_documents",
      "auto_settlement_batch_id",
      `auto_settlement_batch_id BIGINT UNSIGNED NULL
         AFTER settlement_cash_register_id`
    );
    await addColumnIfMissing(
      connection,
      "cari_documents",
      "auto_settlement_cash_transaction_id",
      `auto_settlement_cash_transaction_id BIGINT UNSIGNED NULL
         AFTER auto_settlement_batch_id`
    );

    if (
      !(await hasForeignKey(
        connection,
        "cari_documents",
        "fk_cari_docs_settlement_cash_register"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_documents
         ADD CONSTRAINT fk_cari_docs_settlement_cash_register
         FOREIGN KEY (settlement_cash_register_id)
         REFERENCES cash_registers(id)`
      );
    }

    if (
      !(await hasForeignKey(
        connection,
        "cari_documents",
        "fk_cari_docs_auto_settle_batch_tenant"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_documents
         ADD CONSTRAINT fk_cari_docs_auto_settle_batch_tenant
         FOREIGN KEY (tenant_id, auto_settlement_batch_id)
         REFERENCES cari_settlement_batches(tenant_id, id)`
      );
    }

    if (
      !(await hasForeignKey(
        connection,
        "cari_documents",
        "fk_cari_docs_auto_settle_cash_txn_tenant"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_documents
         ADD CONSTRAINT fk_cari_docs_auto_settle_cash_txn_tenant
         FOREIGN KEY (tenant_id, auto_settlement_cash_transaction_id)
         REFERENCES cash_transactions(tenant_id, id)`
      );
    }

    if (
      !(await hasCheckConstraint(
        connection,
        "cari_documents",
        CHECK_CONSTRAINT_SETTLEMENT_CASH_REGISTER_REQUIRED
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_documents
         ADD CONSTRAINT ${CHECK_CONSTRAINT_SETTLEMENT_CASH_REGISTER_REQUIRED}
         CHECK (
           settlement_mode <> 'IMMEDIATE_CASH'
           OR settlement_cash_register_id IS NOT NULL
         )`
      );
    }
  },
};

export default migration146CariDocumentsSettlementMode;
