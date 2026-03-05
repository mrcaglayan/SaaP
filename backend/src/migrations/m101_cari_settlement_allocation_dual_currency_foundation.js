const ignorableErrnos = new Set([
  1060, // ER_DUP_FIELDNAME
  1061, // ER_DUP_KEYNAME
  1826, // ER_FK_DUP_NAME
]);

const CHECK_CONSTRAINT_ALLOC_DOC_TXN_POSITIVE =
  "chk_cari_alloc_amount_doc_txn_positive";
const CHECK_CONSTRAINT_ALLOC_SETTLEMENT_TXN_POSITIVE =
  "chk_cari_alloc_amount_settlement_txn_positive";
const CHECK_CONSTRAINT_ALLOC_CROSS_RATE_POSITIVE =
  "chk_cari_alloc_applied_cross_rate_positive";

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

const migration101CariSettlementAllocationDualCurrencyFoundation = {
  key: "m101_cari_settlement_allocation_dual_currency_foundation",
  description:
    "Add dual-currency allocation metadata for Cari settlement rows with safe backfill",
  async up(connection) {
    if (
      !(await hasColumn(
        connection,
        "cari_settlement_allocations",
        "allocation_amount_doc_txn"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_settlement_allocations
         ADD COLUMN allocation_amount_doc_txn DECIMAL(20,6) NULL
         AFTER allocation_amount_txn`
      );
    }
    if (
      !(await hasColumn(
        connection,
        "cari_settlement_allocations",
        "allocation_amount_settlement_txn"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_settlement_allocations
         ADD COLUMN allocation_amount_settlement_txn DECIMAL(20,6) NULL
         AFTER allocation_amount_doc_txn`
      );
    }
    if (
      !(await hasColumn(
        connection,
        "cari_settlement_allocations",
        "document_currency_code"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_settlement_allocations
         ADD COLUMN document_currency_code CHAR(3) NULL
         AFTER allocation_amount_base`
      );
    }
    if (
      !(await hasColumn(
        connection,
        "cari_settlement_allocations",
        "settlement_currency_code"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_settlement_allocations
         ADD COLUMN settlement_currency_code CHAR(3) NULL
         AFTER document_currency_code`
      );
    }
    if (
      !(await hasColumn(connection, "cari_settlement_allocations", "applied_cross_rate"))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_settlement_allocations
         ADD COLUMN applied_cross_rate DECIMAL(20,10) NULL
         AFTER settlement_currency_code`
      );
    }
    if (!(await hasColumn(connection, "cari_settlement_allocations", "cross_rate_source"))) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_settlement_allocations
         ADD COLUMN cross_rate_source VARCHAR(40) NULL
         AFTER applied_cross_rate`
      );
    }
    if (!(await hasColumn(connection, "cari_settlement_allocations", "cross_rate_date"))) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_settlement_allocations
         ADD COLUMN cross_rate_date DATE NULL
         AFTER cross_rate_source`
      );
    }

    // Existing settlements were same-currency. Backfill with deterministic parity defaults.
    await safeExecute(
      connection,
      `UPDATE cari_settlement_allocations a
       LEFT JOIN cari_open_items oi
         ON oi.tenant_id = a.tenant_id
        AND oi.legal_entity_id = a.legal_entity_id
        AND oi.id = a.open_item_id
       LEFT JOIN cari_settlement_batches b
         ON b.tenant_id = a.tenant_id
        AND b.legal_entity_id = a.legal_entity_id
        AND b.id = a.settlement_batch_id
       SET
         a.allocation_amount_doc_txn =
           COALESCE(a.allocation_amount_doc_txn, a.allocation_amount_txn),
         a.allocation_amount_settlement_txn =
           COALESCE(a.allocation_amount_settlement_txn, a.allocation_amount_txn),
         a.document_currency_code =
           COALESCE(NULLIF(TRIM(a.document_currency_code), ''), oi.currency_code, b.currency_code),
         a.settlement_currency_code =
           COALESCE(NULLIF(TRIM(a.settlement_currency_code), ''), b.currency_code, oi.currency_code),
         a.applied_cross_rate =
           COALESCE(
             a.applied_cross_rate,
             CASE
               WHEN COALESCE(a.allocation_amount_settlement_txn, a.allocation_amount_txn, 0) > 0
                 THEN ROUND(
                   COALESCE(a.allocation_amount_doc_txn, a.allocation_amount_txn, 0) /
                   COALESCE(a.allocation_amount_settlement_txn, a.allocation_amount_txn, 1),
                   10
                 )
               ELSE 1
             END
           ),
         a.cross_rate_source =
           COALESCE(
             NULLIF(TRIM(a.cross_rate_source), ''),
             CASE
               WHEN COALESCE(NULLIF(TRIM(a.document_currency_code), ''), oi.currency_code, b.currency_code) =
                    COALESCE(NULLIF(TRIM(a.settlement_currency_code), ''), b.currency_code, oi.currency_code)
                 THEN 'PARITY'
               ELSE COALESCE(NULLIF(TRIM(b.settlement_fx_source), ''), 'DERIVED')
             END
           ),
         a.cross_rate_date = COALESCE(a.cross_rate_date, a.allocation_date, b.settlement_date)
       WHERE
         a.allocation_amount_doc_txn IS NULL
         OR a.allocation_amount_settlement_txn IS NULL
         OR a.document_currency_code IS NULL
         OR TRIM(a.document_currency_code) = ''
         OR a.settlement_currency_code IS NULL
         OR TRIM(a.settlement_currency_code) = ''
         OR a.applied_cross_rate IS NULL
         OR a.cross_rate_source IS NULL
         OR TRIM(a.cross_rate_source) = ''
         OR a.cross_rate_date IS NULL`
    );

    if (
      !(await hasCheckConstraint(
        connection,
        "cari_settlement_allocations",
        CHECK_CONSTRAINT_ALLOC_DOC_TXN_POSITIVE
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_settlement_allocations
         ADD CONSTRAINT ${CHECK_CONSTRAINT_ALLOC_DOC_TXN_POSITIVE}
         CHECK (
           allocation_amount_doc_txn IS NULL
           OR allocation_amount_doc_txn > 0
         )`
      );
    }
    if (
      !(await hasCheckConstraint(
        connection,
        "cari_settlement_allocations",
        CHECK_CONSTRAINT_ALLOC_SETTLEMENT_TXN_POSITIVE
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_settlement_allocations
         ADD CONSTRAINT ${CHECK_CONSTRAINT_ALLOC_SETTLEMENT_TXN_POSITIVE}
         CHECK (
           allocation_amount_settlement_txn IS NULL
           OR allocation_amount_settlement_txn > 0
         )`
      );
    }
    if (
      !(await hasCheckConstraint(
        connection,
        "cari_settlement_allocations",
        CHECK_CONSTRAINT_ALLOC_CROSS_RATE_POSITIVE
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_settlement_allocations
         ADD CONSTRAINT ${CHECK_CONSTRAINT_ALLOC_CROSS_RATE_POSITIVE}
         CHECK (
           applied_cross_rate IS NULL
           OR applied_cross_rate > 0
         )`
      );
    }
  },
};

export default migration101CariSettlementAllocationDualCurrencyFoundation;
