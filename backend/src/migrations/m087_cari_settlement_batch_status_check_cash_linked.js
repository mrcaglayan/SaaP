const IGNORABLE_ERRNOS = new Set([
  1091, // ER_CANT_DROP_FIELD_OR_KEY
]);

const NEW_CHECK_NAME = "chk_cari_settle_batch_status_requires_posting_link";

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

function isLegacyStatusCheckClause(checkClause) {
  const normalized = String(checkClause || "")
    .toUpperCase()
    .replace(/`/g, "")
    .replace(/_UTF8MB4/g, "")
    .replace(/\\'/g, "'")
    .replace(/\s+/g, " ");
  const hasLegacyStatusGuard =
    normalized.includes("STATUS IN") &&
    normalized.includes("POSTED") &&
    normalized.includes("REVERSED") &&
    normalized.includes("DRAFT") &&
    normalized.includes("CANCELLED") &&
    /POSTED_JOURNAL_ENTRY_ID\s+IS\s+NOT\s+NULL/.test(normalized);
  return (
    hasLegacyStatusGuard &&
    !normalized.includes("CASH_TRANSACTION_ID") &&
    !normalized.includes("REVERSAL_OF_SETTLEMENT_BATCH_ID")
  );
}

function readRowField(row, key) {
  return row?.[key] ?? row?.[key.toUpperCase()] ?? null;
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

async function findLegacyStatusConstraintNames(connection) {
  try {
    const [rows] = await connection.execute(
      `SELECT tc.constraint_name, cc.check_clause
       FROM information_schema.table_constraints tc
       JOIN information_schema.check_constraints cc
         ON cc.constraint_schema = tc.constraint_schema
        AND cc.constraint_name = tc.constraint_name
       WHERE tc.constraint_schema = DATABASE()
         AND tc.table_name = 'cari_settlement_batches'
         AND tc.constraint_type = 'CHECK'`
    );
    return (Array.isArray(rows) ? rows : [])
      .filter((row) => isLegacyStatusCheckClause(readRowField(row, "check_clause")))
      .map((row) => String(readRowField(row, "constraint_name") || ""))
      .filter(Boolean);
  } catch (err) {
    if (Number(err?.errno) !== 1109) {
      throw err;
    }
    const fallbackNames = [];
    if (
      await hasCheckConstraint(connection, "cari_settlement_batches", "cari_settlement_batches_chk_6")
    ) {
      fallbackNames.push("cari_settlement_batches_chk_6");
    }
    return fallbackNames;
  }
}

const migration087CariSettlementBatchStatusCheckCashLinked = {
  key: "m087_cari_settlement_batch_status_check_cash_linked",
  description:
    "Allow cash-linked CARI settlement batches to be POSTED/REVERSED without requiring settlement journal id",
  async up(connection) {
    const legacyConstraintNames = await findLegacyStatusConstraintNames(connection);
    for (const constraintName of legacyConstraintNames) {
      if (constraintName === NEW_CHECK_NAME) {
        continue;
      }
      // The legacy anonymous check is too strict for cash-linked settlements.
      // Drop it first so it cannot keep rejecting valid rows after adding the new check.
      // eslint-disable-next-line no-await-in-loop
      await safeExecute(
        connection,
        `ALTER TABLE cari_settlement_batches DROP CHECK ${constraintName}`
      );
    }

    if (await hasCheckConstraint(connection, "cari_settlement_batches", NEW_CHECK_NAME)) {
      return;
    }

    await safeExecute(
      connection,
      `ALTER TABLE cari_settlement_batches
       ADD CONSTRAINT ${NEW_CHECK_NAME}
       CHECK (
         (
           status = 'POSTED'
           AND (
             posted_journal_entry_id IS NOT NULL
             OR cash_transaction_id IS NOT NULL
           )
         )
         OR (
           status = 'REVERSED'
           AND (
             posted_journal_entry_id IS NOT NULL
             OR cash_transaction_id IS NOT NULL
             OR reversal_of_settlement_batch_id IS NOT NULL
           )
         )
         OR status IN ('DRAFT','CANCELLED')
       )`
    );
  },
};

export default migration087CariSettlementBatchStatusCheckCashLinked;
