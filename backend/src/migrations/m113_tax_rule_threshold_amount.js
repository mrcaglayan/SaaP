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

const migration113TaxRuleThresholdAmount = {
  key: "m113_tax_rule_threshold_amount",
  description:
    "Add cumulative fiscal-period threshold amount support to tax rules",
  async up(connection) {
    if (!(await hasColumn(connection, "tax_rule_sets", "threshold_amount"))) {
      await connection.execute(
        `ALTER TABLE tax_rule_sets
           ADD COLUMN threshold_amount DECIMAL(20,6) NULL
             AFTER apply_priority`
      );
    }
  },

  async down() {
    // Non-destructive migration policy: no down-op for additive schema changes.
  },
};

export default migration113TaxRuleThresholdAmount;
