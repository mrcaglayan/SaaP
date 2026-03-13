const ignorableErrnos = new Set([
  1050, // ER_TABLE_EXISTS_ERROR
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

const createTableStatements = [
  `
  CREATE TABLE IF NOT EXISTS inventory_issue_layer_consumptions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    legal_entity_id BIGINT UNSIGNED NOT NULL,
    issue_movement_id BIGINT UNSIGNED NOT NULL,
    cost_layer_id BIGINT UNSIGNED NOT NULL,
    consumption_no INT UNSIGNED NOT NULL,
    quantity_consumed DECIMAL(20,6) NOT NULL DEFAULT 0.000000,
    unit_cost_txn DECIMAL(20,6) NOT NULL DEFAULT 0.000000,
    unit_cost_base DECIMAL(20,6) NOT NULL DEFAULT 0.000000,
    total_cost_txn DECIMAL(20,6) NOT NULL DEFAULT 0.000000,
    total_cost_base DECIMAL(20,6) NOT NULL DEFAULT 0.000000,
    currency_code CHAR(3) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_inventory_issue_layer_consumptions_issue_seq (issue_movement_id, consumption_no),
    KEY ix_inventory_issue_layer_consumptions_tenant_id (tenant_id),
    KEY ix_inventory_issue_layer_consumptions_tenant_entity (tenant_id, legal_entity_id),
    KEY ix_inventory_issue_layer_consumptions_issue (issue_movement_id),
    KEY ix_inventory_issue_layer_consumptions_layer (cost_layer_id),
    CONSTRAINT fk_inventory_issue_layer_consumptions_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_inventory_issue_layer_consumptions_entity_tenant
      FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES legal_entities(tenant_id, id),
    CONSTRAINT fk_inventory_issue_layer_consumptions_issue
      FOREIGN KEY (issue_movement_id) REFERENCES inventory_movements(id),
    CONSTRAINT fk_inventory_issue_layer_consumptions_layer
      FOREIGN KEY (cost_layer_id) REFERENCES inventory_cost_layers(id),
    CHECK (quantity_consumed > 0),
    CHECK (unit_cost_txn >= 0),
    CHECK (unit_cost_base >= 0),
    CHECK (total_cost_txn >= 0),
    CHECK (total_cost_base >= 0)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
];

const migration119InventoryIssueLayerConsumptions = {
  key: "m119_inventory_issue_layer_consumptions",
  description: "Add inventory issue valuation consumption audit rows",
  async up(connection) {
    for (const statement of createTableStatements) {
      await safeExecute(connection, statement);
    }
  },

  async down() {
    // Non-destructive migration policy: no down-op for additive schema changes.
  },
};

export default migration119InventoryIssueLayerConsumptions;
