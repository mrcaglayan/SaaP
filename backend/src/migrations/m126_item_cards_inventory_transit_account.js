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

const migration126ItemCardsInventoryTransitAccount = {
  key: "m126_item_cards_inventory_transit_account",
  description:
    "Add item-card inventory transit account mapping for cross-context inventory transfers",
  async up(connection) {
    if (!(await hasColumn(connection, "item_cards", "inventory_transit_account_id"))) {
      await safeExecute(
        connection,
        `ALTER TABLE item_cards
         ADD COLUMN inventory_transit_account_id BIGINT UNSIGNED NULL
         AFTER inventory_asset_account_id`
      );
    }

    if (
      !(await hasIndex(
        connection,
        "item_cards",
        "ix_item_cards_tenant_inventory_transit_account"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE item_cards
         ADD KEY ix_item_cards_tenant_inventory_transit_account (
           tenant_id,
           inventory_transit_account_id
         )`
      );
    }

    if (
      !(await hasForeignKey(
        connection,
        "item_cards",
        "fk_item_cards_inventory_transit_account"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE item_cards
         ADD CONSTRAINT fk_item_cards_inventory_transit_account
           FOREIGN KEY (inventory_transit_account_id) REFERENCES accounts(id)`
      );
    }
  },

  async down() {
    // Non-destructive migration policy: no down-op for additive schema changes.
  },
};

export default migration126ItemCardsInventoryTransitAccount;
