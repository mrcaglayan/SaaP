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
  CREATE TABLE IF NOT EXISTS inventory_warehouses (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    legal_entity_id BIGINT UNSIGNED NOT NULL,
    code VARCHAR(80) NOT NULL,
    name VARCHAR(200) NOT NULL,
    status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    notes VARCHAR(255) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_inventory_warehouses_tenant_entity_code (tenant_id, legal_entity_id, code),
    KEY ix_inventory_warehouses_tenant_id (tenant_id),
    KEY ix_inventory_warehouses_tenant_entity (tenant_id, legal_entity_id),
    KEY ix_inventory_warehouses_tenant_status (tenant_id, status),
    CONSTRAINT fk_inventory_warehouses_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_inventory_warehouses_entity_tenant
      FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES legal_entities(tenant_id, id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
  `
  CREATE TABLE IF NOT EXISTS inventory_movements (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    legal_entity_id BIGINT UNSIGNED NOT NULL,
    warehouse_id BIGINT UNSIGNED NOT NULL,
    item_card_id BIGINT UNSIGNED NOT NULL,
    movement_type ENUM('RECEIPT','ISSUE','ADJUSTMENT_IN','ADJUSTMENT_OUT') NOT NULL,
    source_type ENUM('CARI_STOCK_LINK','MANUAL') NOT NULL,
    source_stock_link_id BIGINT UNSIGNED NULL,
    source_document_type VARCHAR(60) NULL,
    source_document_id BIGINT UNSIGNED NULL,
    source_document_line_id BIGINT UNSIGNED NULL,
    movement_date DATE NOT NULL,
    quantity DECIMAL(20,6) NOT NULL DEFAULT 0.000000,
    unit_cost_txn DECIMAL(20,6) NULL,
    unit_cost_base DECIMAL(20,6) NULL,
    total_cost_txn DECIMAL(20,6) NULL,
    total_cost_base DECIMAL(20,6) NULL,
    currency_code CHAR(3) NOT NULL,
    valuation_status ENUM('NOT_REQUIRED','PENDING','VALUED') NOT NULL DEFAULT 'NOT_REQUIRED',
    note VARCHAR(255) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_inventory_movements_source_stock_link (tenant_id, source_stock_link_id),
    KEY ix_inventory_movements_tenant_id (tenant_id),
    KEY ix_inventory_movements_tenant_entity (tenant_id, legal_entity_id),
    KEY ix_inventory_movements_tenant_wh_item (tenant_id, warehouse_id, item_card_id),
    KEY ix_inventory_movements_tenant_date (tenant_id, movement_date),
    KEY ix_inventory_movements_tenant_valuation (tenant_id, valuation_status),
    CONSTRAINT fk_inventory_movements_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_inventory_movements_entity_tenant
      FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES legal_entities(tenant_id, id),
    CONSTRAINT fk_inventory_movements_warehouse
      FOREIGN KEY (warehouse_id) REFERENCES inventory_warehouses(id),
    CONSTRAINT fk_inventory_movements_item_card
      FOREIGN KEY (item_card_id) REFERENCES item_cards(id),
    CONSTRAINT fk_inventory_movements_source_stock_link
      FOREIGN KEY (source_stock_link_id) REFERENCES cari_document_line_stock_links(id),
    CHECK (quantity > 0),
    CHECK (unit_cost_txn IS NULL OR unit_cost_txn >= 0),
    CHECK (unit_cost_base IS NULL OR unit_cost_base >= 0),
    CHECK (total_cost_txn IS NULL OR total_cost_txn >= 0),
    CHECK (total_cost_base IS NULL OR total_cost_base >= 0)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
  `
  CREATE TABLE IF NOT EXISTS inventory_cost_layers (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    legal_entity_id BIGINT UNSIGNED NOT NULL,
    warehouse_id BIGINT UNSIGNED NOT NULL,
    item_card_id BIGINT UNSIGNED NOT NULL,
    source_movement_id BIGINT UNSIGNED NOT NULL,
    valuation_method ENUM('FIFO') NOT NULL DEFAULT 'FIFO',
    layer_status ENUM('OPEN','CLOSED') NOT NULL DEFAULT 'OPEN',
    currency_code CHAR(3) NOT NULL,
    quantity_in DECIMAL(20,6) NOT NULL DEFAULT 0.000000,
    quantity_remaining DECIMAL(20,6) NOT NULL DEFAULT 0.000000,
    unit_cost_txn DECIMAL(20,6) NOT NULL DEFAULT 0.000000,
    unit_cost_base DECIMAL(20,6) NOT NULL DEFAULT 0.000000,
    total_cost_txn DECIMAL(20,6) NOT NULL DEFAULT 0.000000,
    total_cost_base DECIMAL(20,6) NOT NULL DEFAULT 0.000000,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY ix_inventory_cost_layers_tenant_id (tenant_id),
    KEY ix_inventory_cost_layers_tenant_entity (tenant_id, legal_entity_id),
    KEY ix_inventory_cost_layers_tenant_wh_item (tenant_id, warehouse_id, item_card_id),
    KEY ix_inventory_cost_layers_tenant_status (tenant_id, layer_status),
    CONSTRAINT fk_inventory_cost_layers_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_inventory_cost_layers_entity_tenant
      FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES legal_entities(tenant_id, id),
    CONSTRAINT fk_inventory_cost_layers_warehouse
      FOREIGN KEY (warehouse_id) REFERENCES inventory_warehouses(id),
    CONSTRAINT fk_inventory_cost_layers_item_card
      FOREIGN KEY (item_card_id) REFERENCES item_cards(id),
    CONSTRAINT fk_inventory_cost_layers_source_movement
      FOREIGN KEY (source_movement_id) REFERENCES inventory_movements(id),
    CHECK (quantity_in > 0),
    CHECK (quantity_remaining >= 0),
    CHECK (unit_cost_txn >= 0),
    CHECK (unit_cost_base >= 0),
    CHECK (total_cost_txn >= 0),
    CHECK (total_cost_base >= 0)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
];

const migration118InventoryFoundation = {
  key: "m118_inventory_foundation",
  description:
    "Add inventory warehouses, stock movements, and receipt cost layers foundation",
  async up(connection) {
    for (const statement of createTableStatements) {
      await safeExecute(connection, statement);
    }
  },

  async down() {
    // Non-destructive migration policy: no down-op for additive schema changes.
  },
};

export default migration118InventoryFoundation;
