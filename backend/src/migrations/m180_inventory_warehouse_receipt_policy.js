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

const migration180InventoryWarehouseReceiptPolicy = {
  key: "m180_inventory_warehouse_receipt_policy",
  description:
    "Add inventory receipt policy to warehouses for invoice-before-receipt control",
  async up(connection) {
    if (!(await hasColumn(connection, "inventory_warehouses", "inventory_receipt_policy"))) {
      await safeExecute(
        connection,
        `ALTER TABLE inventory_warehouses
         ADD COLUMN inventory_receipt_policy
           ENUM('ALLOW_INVOICE_BEFORE_RECEIPT','REQUIRE_RECEIPT_BEFORE_INVOICE')
           NOT NULL
           DEFAULT 'ALLOW_INVOICE_BEFORE_RECEIPT'
         AFTER status`
      );
    } else {
      await safeExecute(
        connection,
        `ALTER TABLE inventory_warehouses
         MODIFY COLUMN inventory_receipt_policy
           ENUM('ALLOW_INVOICE_BEFORE_RECEIPT','REQUIRE_RECEIPT_BEFORE_INVOICE')
           NOT NULL
           DEFAULT 'ALLOW_INVOICE_BEFORE_RECEIPT'
         AFTER status`
      );
    }
  },

  async down() {
    // Non-destructive migration policy: no down-op for additive schema changes.
  },
};

export default migration180InventoryWarehouseReceiptPolicy;
