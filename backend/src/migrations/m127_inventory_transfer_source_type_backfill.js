async function readColumnType(connection, tableName, columnName) {
  const [rows] = await connection.query(
    `SELECT column_type
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name = ?
      LIMIT 1`,
    [tableName, columnName]
  );
  return Array.isArray(rows) && rows.length > 0 ? String(rows[0].column_type || "") : "";
}

async function ensureInventoryMovementSourceTypeEnum(connection) {
  const columnType = await readColumnType(connection, "inventory_movements", "source_type");
  if (!columnType) {
    return;
  }

  const enumMatches = Array.from(columnType.matchAll(/'([^']+)'/g)).map((match) => match[1]);
  if (enumMatches.includes("INVENTORY_TRANSFER")) {
    return;
  }

  const nextValues = [...enumMatches, "INVENTORY_TRANSFER"];
  await connection.query(
    `ALTER TABLE inventory_movements
       MODIFY COLUMN source_type ENUM(${nextValues.map((value) => `'${value}'`).join(",")}) NOT NULL`
  );
}

const migration127InventoryTransferSourceTypeBackfill = {
  key: "m127_inventory_transfer_source_type_backfill",
  description:
    "Backfill inventory movement source_type enum coverage for INVENTORY_TRANSFER on already-applied inventory transfer installs",
  async up(connection) {
    await ensureInventoryMovementSourceTypeEnum(connection);
  },

  async down() {
    // Non-destructive migration policy: no down-op for additive schema changes.
  },
};

export default migration127InventoryTransferSourceTypeBackfill;
