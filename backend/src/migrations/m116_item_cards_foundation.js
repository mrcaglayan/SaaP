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
  CREATE TABLE IF NOT EXISTS item_cards (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    legal_entity_id BIGINT UNSIGNED NULL,
    code VARCHAR(80) NOT NULL,
    name VARCHAR(200) NOT NULL,
    item_type ENUM('SERVICE','NON_STOCK_GOOD','STOCK_ITEM') NOT NULL,
    default_sales_account_id BIGINT UNSIGNED NULL,
    default_purchase_account_id BIGINT UNSIGNED NULL,
    inventory_asset_account_id BIGINT UNSIGNED NULL,
    default_cogs_account_id BIGINT UNSIGNED NULL,
    tax_category_code VARCHAR(60) NULL,
    status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_item_cards_tenant_entity_code (tenant_id, legal_entity_id, code),
    UNIQUE KEY uk_item_cards_tenant_id_id (tenant_id, id),
    UNIQUE KEY uk_item_cards_tenant_entity_id (tenant_id, legal_entity_id, id),
    KEY ix_item_cards_tenant_id (tenant_id),
    KEY ix_item_cards_tenant_entity (tenant_id, legal_entity_id),
    KEY ix_item_cards_tenant_status (tenant_id, status),
    KEY ix_item_cards_tenant_type (tenant_id, item_type),
    KEY ix_item_cards_tenant_sales_account (tenant_id, default_sales_account_id),
    KEY ix_item_cards_tenant_purchase_account (tenant_id, default_purchase_account_id),
    KEY ix_item_cards_tenant_inventory_account (tenant_id, inventory_asset_account_id),
    KEY ix_item_cards_tenant_cogs_account (tenant_id, default_cogs_account_id),
    CONSTRAINT fk_item_cards_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_item_cards_entity_tenant
      FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES legal_entities(tenant_id, id),
    CONSTRAINT fk_item_cards_sales_account
      FOREIGN KEY (default_sales_account_id) REFERENCES accounts(id),
    CONSTRAINT fk_item_cards_purchase_account
      FOREIGN KEY (default_purchase_account_id) REFERENCES accounts(id),
    CONSTRAINT fk_item_cards_inventory_account
      FOREIGN KEY (inventory_asset_account_id) REFERENCES accounts(id),
    CONSTRAINT fk_item_cards_cogs_account
      FOREIGN KEY (default_cogs_account_id) REFERENCES accounts(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
];

const migration116ItemCardsFoundation = {
  key: "m116_item_cards_foundation",
  description:
    "Add reusable item card master foundation for CARI lines and future inventory linkage",
  async up(connection) {
    for (const statement of createTableStatements) {
      await safeExecute(connection, statement);
    }
  },

  async down() {
    // Non-destructive migration policy: no down-op for additive schema changes.
  },
};

export default migration116ItemCardsFoundation;
