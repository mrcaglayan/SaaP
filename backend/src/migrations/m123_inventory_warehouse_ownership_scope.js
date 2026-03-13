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

const migration123InventoryWarehouseOwnershipScope = {
  key: "m123_inventory_warehouse_ownership_scope",
  description: "Add CENTRAL vs OPERATING_UNIT ownership scope to inventory warehouses",
  async up(connection) {
    if (!(await hasColumn(connection, "inventory_warehouses", "ownership_scope"))) {
      await safeExecute(
        connection,
        `ALTER TABLE inventory_warehouses
         ADD COLUMN ownership_scope ENUM('CENTRAL','OPERATING_UNIT') NOT NULL DEFAULT 'CENTRAL'
         AFTER legal_entity_id`
      );
    } else {
      await safeExecute(
        connection,
        `ALTER TABLE inventory_warehouses
         MODIFY COLUMN ownership_scope ENUM('CENTRAL','OPERATING_UNIT') NOT NULL DEFAULT 'CENTRAL'
         AFTER legal_entity_id`
      );
    }

    if (!(await hasColumn(connection, "inventory_warehouses", "operating_unit_id"))) {
      await safeExecute(
        connection,
        `ALTER TABLE inventory_warehouses
         ADD COLUMN operating_unit_id BIGINT UNSIGNED NULL
         AFTER ownership_scope`
      );
    }

    await safeExecute(
      connection,
      `UPDATE inventory_warehouses
          SET ownership_scope = 'CENTRAL'
        WHERE ownership_scope IS NULL
           OR ownership_scope <> 'OPERATING_UNIT'`
    );

    await safeExecute(
      connection,
      `ALTER TABLE inventory_warehouses
       ADD CONSTRAINT fk_inventory_warehouses_operating_unit
       FOREIGN KEY (operating_unit_id) REFERENCES operating_units(id)`
    );

    if (
      !(await hasIndex(
        connection,
        "inventory_warehouses",
        "ix_inventory_warehouses_tenant_entity_scope_ou_status"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE inventory_warehouses
         ADD KEY ix_inventory_warehouses_tenant_entity_scope_ou_status (
           tenant_id,
           legal_entity_id,
           ownership_scope,
           operating_unit_id,
           status
         )`
      );
    }

    if (
      !(await hasIndex(
        connection,
        "inventory_warehouses",
        "ix_inventory_warehouses_tenant_operating_unit"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE inventory_warehouses
         ADD KEY ix_inventory_warehouses_tenant_operating_unit (
           tenant_id,
           operating_unit_id
         )`
      );
    }
  },

  async down() {
    // Non-destructive migration policy: no down-op for additive schema changes.
  },
};

export default migration123InventoryWarehouseOwnershipScope;
