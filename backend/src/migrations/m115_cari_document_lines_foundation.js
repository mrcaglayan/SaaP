const ignorableErrnos = new Set([
  1050, // ER_TABLE_EXISTS_ERROR
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

async function addColumnIfMissing(connection, tableName, columnName, definitionSql) {
  if (await hasColumn(connection, tableName, columnName)) {
    return;
  }
  await connection.execute(`ALTER TABLE ${tableName} ADD COLUMN ${definitionSql}`);
}

const createTableStatements = [
  `
  CREATE TABLE IF NOT EXISTS cari_document_lines (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    legal_entity_id BIGINT UNSIGNED NOT NULL,
    cari_document_id BIGINT UNSIGNED NOT NULL,
    line_no INT UNSIGNED NOT NULL,
    line_kind ENUM('STANDARD','COMMENT','ROUNDING','ADJUSTMENT','OTHER')
      NOT NULL DEFAULT 'STANDARD',
    description VARCHAR(500) NULL,
    item_card_id BIGINT UNSIGNED NULL,
    quantity DECIMAL(20,6) NOT NULL DEFAULT 1.000000,
    unit_price_txn DECIMAL(20,6) NOT NULL DEFAULT 0.000000,
    line_net_amount_txn DECIMAL(20,6) NOT NULL DEFAULT 0.000000,
    line_tax_amount_txn DECIMAL(20,6) NOT NULL DEFAULT 0.000000,
    line_gross_amount_txn DECIMAL(20,6) NOT NULL DEFAULT 0.000000,
    line_net_amount_base DECIMAL(20,6) NULL,
    line_tax_amount_base DECIMAL(20,6) NULL,
    line_gross_amount_base DECIMAL(20,6) NULL,
    posting_account_id BIGINT UNSIGNED NULL,
    tax_category_code VARCHAR(60) NULL,
    stock_impact_mode ENUM('NONE','RECEIPT_PENDING','ISSUE_PENDING')
      NOT NULL DEFAULT 'NONE',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_cari_doc_lines_tenant_doc_line (
      tenant_id,
      legal_entity_id,
      cari_document_id,
      line_no
    ),
    UNIQUE KEY uk_cari_doc_lines_tenant_id_id (tenant_id, id),
    UNIQUE KEY uk_cari_doc_lines_tenant_entity_id (tenant_id, legal_entity_id, id),
    UNIQUE KEY uk_cari_doc_lines_tenant_entity_doc_id (
      tenant_id,
      legal_entity_id,
      cari_document_id,
      id
    ),
    KEY ix_cari_doc_lines_tenant_id (tenant_id),
    KEY ix_cari_doc_lines_tenant_entity (tenant_id, legal_entity_id),
    KEY ix_cari_doc_lines_tenant_doc (tenant_id, cari_document_id),
    KEY ix_cari_doc_lines_tenant_posting_account (tenant_id, posting_account_id),
    KEY ix_cari_doc_lines_tenant_item_card (tenant_id, item_card_id),
    CONSTRAINT fk_cari_doc_lines_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_cari_doc_lines_entity_tenant
      FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES legal_entities(tenant_id, id),
    CONSTRAINT fk_cari_doc_lines_document_tenant
      FOREIGN KEY (tenant_id, legal_entity_id, cari_document_id)
      REFERENCES cari_documents(tenant_id, legal_entity_id, id),
    CONSTRAINT fk_cari_doc_lines_posting_account
      FOREIGN KEY (posting_account_id) REFERENCES accounts(id),
    CHECK (line_no > 0),
    CHECK (quantity >= 0),
    CHECK (unit_price_txn >= 0),
    CHECK (line_net_amount_txn >= 0),
    CHECK (line_tax_amount_txn >= 0),
    CHECK (line_gross_amount_txn >= 0),
    CHECK (line_net_amount_base IS NULL OR line_net_amount_base >= 0),
    CHECK (line_tax_amount_base IS NULL OR line_tax_amount_base >= 0),
    CHECK (line_gross_amount_base IS NULL OR line_gross_amount_base >= 0)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
  `
  CREATE TABLE IF NOT EXISTS cari_document_line_taxes (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    legal_entity_id BIGINT UNSIGNED NOT NULL,
    cari_document_id BIGINT UNSIGNED NOT NULL,
    cari_document_line_id BIGINT UNSIGNED NOT NULL,
    component_no INT UNSIGNED NOT NULL,
    tax_code VARCHAR(40) NOT NULL,
    tax_kind ENUM('VAT','WITHHOLDING','STAMP','OTHER') NOT NULL,
    rate_pct DECIMAL(9,4) NOT NULL,
    tax_base_amount_txn DECIMAL(20,6) NOT NULL DEFAULT 0.000000,
    tax_amount_txn DECIMAL(20,6) NOT NULL DEFAULT 0.000000,
    tax_base_amount_base DECIMAL(20,6) NULL,
    tax_amount_base DECIMAL(20,6) NULL,
    tax_purpose_code ENUM(
      'VAT_INPUT',
      'VAT_OUTPUT',
      'VAT_PAYABLE',
      'VAT_RECEIVABLE',
      'WITHHOLDING_PAYABLE',
      'WITHHOLDING_RECEIVABLE',
      'ROUNDING'
    ) NULL,
    account_id BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_cari_doc_line_tax_tenant_line_component (
      tenant_id,
      legal_entity_id,
      cari_document_line_id,
      component_no
    ),
    UNIQUE KEY uk_cari_doc_line_tax_tenant_id_id (tenant_id, id),
    UNIQUE KEY uk_cari_doc_line_tax_tenant_entity_id (tenant_id, legal_entity_id, id),
    KEY ix_cari_doc_line_tax_tenant_id (tenant_id),
    KEY ix_cari_doc_line_tax_tenant_entity (tenant_id, legal_entity_id),
    KEY ix_cari_doc_line_tax_tenant_doc (tenant_id, cari_document_id),
    KEY ix_cari_doc_line_tax_tenant_line (tenant_id, cari_document_line_id),
    KEY ix_cari_doc_line_tax_tenant_tax_code (tenant_id, tax_code),
    CONSTRAINT fk_cari_doc_line_tax_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_cari_doc_line_tax_entity_tenant
      FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES legal_entities(tenant_id, id),
    CONSTRAINT fk_cari_doc_line_tax_document_tenant
      FOREIGN KEY (tenant_id, legal_entity_id, cari_document_id)
      REFERENCES cari_documents(tenant_id, legal_entity_id, id),
    CONSTRAINT fk_cari_doc_line_tax_line_tenant
      FOREIGN KEY (tenant_id, legal_entity_id, cari_document_id, cari_document_line_id)
      REFERENCES cari_document_lines(tenant_id, legal_entity_id, cari_document_id, id),
    CONSTRAINT fk_cari_doc_line_tax_account
      FOREIGN KEY (account_id) REFERENCES accounts(id),
    CHECK (component_no > 0),
    CHECK (rate_pct >= 0),
    CHECK (tax_base_amount_txn >= 0),
    CHECK (tax_amount_txn >= 0),
    CHECK (tax_base_amount_base IS NULL OR tax_base_amount_base >= 0),
    CHECK (tax_amount_base IS NULL OR tax_amount_base >= 0)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
];

const headerColumns = [
  [
    "subtotal_amount_txn",
    "subtotal_amount_txn DECIMAL(20,6) NULL AFTER amount_base",
  ],
  [
    "subtotal_amount_base",
    "subtotal_amount_base DECIMAL(20,6) NULL AFTER subtotal_amount_txn",
  ],
  [
    "tax_amount_txn",
    "tax_amount_txn DECIMAL(20,6) NULL AFTER subtotal_amount_base",
  ],
  [
    "tax_amount_base",
    "tax_amount_base DECIMAL(20,6) NULL AFTER tax_amount_txn",
  ],
  [
    "gross_amount_txn",
    "gross_amount_txn DECIMAL(20,6) NULL AFTER tax_amount_base",
  ],
  [
    "gross_amount_base",
    "gross_amount_base DECIMAL(20,6) NULL AFTER gross_amount_txn",
  ],
];

const migration115CariDocumentLinesFoundation = {
  key: "m115_cari_document_lines_foundation",
  description:
    "Add CARI document line and line-tax foundation schema for future mixed-line and mixed-tax invoices",
  async up(connection) {
    for (const statement of createTableStatements) {
      await safeExecute(connection, statement);
    }

    for (const [columnName, definitionSql] of headerColumns) {
      await addColumnIfMissing(connection, "cari_documents", columnName, definitionSql);
    }
  },

  async down() {
    // Non-destructive migration policy: no down-op for additive schema changes.
  },
};

export default migration115CariDocumentLinesFoundation;
