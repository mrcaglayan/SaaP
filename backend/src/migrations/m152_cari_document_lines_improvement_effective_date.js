/**
 * m152 - Persist line-level fixed-asset improvement effective date.
 *
 * Adds an optional historical effective date to CARI document lines so
 * IMPROVE_EXISTING AP lines can distinguish the vendor bill posting date
 * from the depreciation-effective date used by the fixed-assets engine.
 */

const ignorableErrnos = new Set([
  1060, // ER_DUP_FIELDNAME
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

const migration152CariDocumentLinesImprovementEffectiveDate = {
  key: "m152_cari_document_lines_improvement_effective_date",
  description:
    "Add line-level improvement_effective_date to cari_document_lines for retro fixed-asset improvements.",
  async up(connection) {
    if (!(await hasColumn(connection, "cari_document_lines", "improvement_effective_date"))) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_document_lines
           ADD COLUMN improvement_effective_date DATE NULL
           AFTER fixed_asset_tag`
      );
    }
  },
};

export default migration152CariDocumentLinesImprovementEffectiveDate;
