/**
 * m151 - Fixed-asset improvement transaction foundation.
 *
 * Adds IMPROVEMENT as a first-class fixed_asset_transactions type and
 * persists the pre-improvement cost/life snapshot needed for deterministic
 * reversal of subsequent-acquisition postings.
 */

const ignorableErrnos = new Set([
  1060, // ER_DUP_FIELDNAME
  1061, // ER_DUP_KEYNAME
]);

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

async function addColumnIfMissing(connection, tableName, columnName, definitionSql) {
  if (await hasColumn(connection, tableName, columnName)) {
    return;
  }
  await safeExecute(
    connection,
    `ALTER TABLE ${tableName} ADD COLUMN ${definitionSql}`
  );
}

async function hasImprovementTransactionType(connection) {
  const [rows] = await connection.execute(
    `SELECT COLUMN_TYPE AS column_type
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'fixed_asset_transactions'
        AND column_name = 'transaction_type'
      LIMIT 1`
  );
  const columnType = String(rows?.[0]?.column_type || "").toUpperCase();
  return columnType.includes("'IMPROVEMENT'");
}

const migration151FixedAssetImprovementTransactionType = {
  key: "m151_fixed_asset_improvement_transaction_type",
  description:
    "Add IMPROVEMENT fixed-asset transaction type and pre-improvement snapshot metadata.",
  async up(connection) {
    if (!(await hasImprovementTransactionType(connection))) {
      await connection.execute(
        `ALTER TABLE fixed_asset_transactions
           MODIFY COLUMN transaction_type ENUM(
             'ACQUISITION',
             'CAPITALIZATION',
             'DEPRECIATION',
             'SUSPEND',
             'REACTIVATE',
             'PHYSICAL_MOVE',
             'OWNERSHIP_TRANSFER',
             'WRITEOFF',
             'SALE',
             'IMPROVEMENT',
             'REVERSAL'
           ) NOT NULL`
      );
    }

    await addColumnIfMissing(
      connection,
      "fixed_asset_transactions",
      "improvement_revised_useful_life_months",
      `improvement_revised_useful_life_months INT UNSIGNED NULL
         AFTER pre_disposal_status`
    );
    await addColumnIfMissing(
      connection,
      "fixed_asset_transactions",
      "improvement_life_extension_months",
      `improvement_life_extension_months INT UNSIGNED NULL
         AFTER improvement_revised_useful_life_months`
    );
    await addColumnIfMissing(
      connection,
      "fixed_asset_transactions",
      "improvement_pre_cost_txn",
      `improvement_pre_cost_txn DECIMAL(20,6) NULL
         AFTER improvement_life_extension_months`
    );
    await addColumnIfMissing(
      connection,
      "fixed_asset_transactions",
      "improvement_pre_cost_base",
      `improvement_pre_cost_base DECIMAL(20,6) NULL
         AFTER improvement_pre_cost_txn`
    );
    await addColumnIfMissing(
      connection,
      "fixed_asset_transactions",
      "improvement_pre_useful_life_months",
      `improvement_pre_useful_life_months INT UNSIGNED NULL
         AFTER improvement_pre_cost_base`
    );
    await addColumnIfMissing(
      connection,
      "fixed_asset_transactions",
      "improvement_pre_remaining_life_months",
      `improvement_pre_remaining_life_months INT UNSIGNED NULL
         AFTER improvement_pre_useful_life_months`
    );
  },
};

export default migration151FixedAssetImprovementTransactionType;
