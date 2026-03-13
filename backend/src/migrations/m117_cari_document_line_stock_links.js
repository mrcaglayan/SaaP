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
  CREATE TABLE IF NOT EXISTS cari_document_line_stock_links (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    legal_entity_id BIGINT UNSIGNED NOT NULL,
    cari_document_id BIGINT UNSIGNED NOT NULL,
    cari_document_line_id BIGINT UNSIGNED NOT NULL,
    item_card_id BIGINT UNSIGNED NOT NULL,
    direction ENUM('AR','AP') NOT NULL,
    stock_impact_mode ENUM('RECEIPT_PENDING','ISSUE_PENDING') NOT NULL,
    link_status ENUM('PENDING','LINKED','VOID') NOT NULL DEFAULT 'PENDING',
    requested_quantity DECIMAL(20,6) NOT NULL DEFAULT 0.000000,
    posted_net_amount_txn DECIMAL(20,6) NOT NULL DEFAULT 0.000000,
    posted_net_amount_base DECIMAL(20,6) NOT NULL DEFAULT 0.000000,
    inventory_document_type VARCHAR(60) NULL,
    inventory_document_id BIGINT UNSIGNED NULL,
    inventory_movement_id BIGINT UNSIGNED NULL,
    resolved_at TIMESTAMP NULL DEFAULT NULL,
    resolution_note VARCHAR(255) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_cari_doc_line_stock_link_tenant_line_mode (
      tenant_id,
      legal_entity_id,
      cari_document_line_id,
      stock_impact_mode
    ),
    UNIQUE KEY uk_cari_doc_line_stock_link_tenant_id_id (tenant_id, id),
    KEY ix_cari_doc_line_stock_link_tenant_id (tenant_id),
    KEY ix_cari_doc_line_stock_link_tenant_entity (tenant_id, legal_entity_id),
    KEY ix_cari_doc_line_stock_link_tenant_doc (
      tenant_id,
      legal_entity_id,
      cari_document_id
    ),
    KEY ix_cari_doc_line_stock_link_tenant_item (tenant_id, item_card_id),
    KEY ix_cari_doc_line_stock_link_tenant_status (tenant_id, link_status),
    CONSTRAINT fk_cari_doc_line_stock_link_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_cari_doc_line_stock_link_entity_tenant
      FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES legal_entities(tenant_id, id),
    CONSTRAINT fk_cari_doc_line_stock_link_document_tenant
      FOREIGN KEY (tenant_id, legal_entity_id, cari_document_id)
      REFERENCES cari_documents(tenant_id, legal_entity_id, id),
    CONSTRAINT fk_cari_doc_line_stock_link_line_tenant
      FOREIGN KEY (tenant_id, legal_entity_id, cari_document_id, cari_document_line_id)
      REFERENCES cari_document_lines(tenant_id, legal_entity_id, cari_document_id, id),
    CONSTRAINT fk_cari_doc_line_stock_link_item_card
      FOREIGN KEY (item_card_id) REFERENCES item_cards(id),
    CHECK (requested_quantity >= 0),
    CHECK (posted_net_amount_txn >= 0),
    CHECK (posted_net_amount_base >= 0)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
];

const migration117CariDocumentLineStockLinks = {
  key: "m117_cari_document_line_stock_links",
  description:
    "Add pending stock-impact linkage rows for posted CARI document lines",
  async up(connection) {
    for (const statement of createTableStatements) {
      await safeExecute(connection, statement);
    }
  },

  async down() {
    // Non-destructive migration policy: no down-op for additive schema changes.
  },
};

export default migration117CariDocumentLineStockLinks;
