const ignorableErrnos = new Set([
  1060, // ER_DUP_FIELDNAME
  1061, // ER_DUP_KEYNAME
  1091, // ER_CANT_DROP_FIELD_OR_KEY
  1826, // ER_FK_DUP_NAME
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

const migration122InventoryMovementReversalLineage = {
  key: "m122_inventory_movement_reversal_lineage",
  description: "Track additive inventory movement reversal lineage",
  async up(connection) {
    await safeExecute(
      connection,
      `ALTER TABLE inventory_movements
         ADD COLUMN reversal_of_movement_id BIGINT UNSIGNED NULL
         AFTER source_document_line_id`
    );
    await safeExecute(
      connection,
      `ALTER TABLE inventory_movements
         ADD UNIQUE KEY uk_inventory_movements_reversal_of_movement (reversal_of_movement_id)`
    );
    await safeExecute(
      connection,
      `ALTER TABLE inventory_movements
         ADD KEY ix_inventory_movements_tenant_reversal_of (tenant_id, reversal_of_movement_id)`
    );
    await safeExecute(
      connection,
      `ALTER TABLE inventory_movements
         ADD CONSTRAINT fk_inventory_movements_reversal_of_movement
           FOREIGN KEY (reversal_of_movement_id) REFERENCES inventory_movements(id)`
    );
  },

  async down() {
    // Non-destructive migration policy: no down-op for additive schema changes.
  },
};

export default migration122InventoryMovementReversalLineage;
