const ignorableErrnos = new Set([
  1060, // ER_DUP_FIELDNAME
  1061, // ER_DUP_KEYNAME
  1091, // ER_CANT_DROP_FIELD_OR_KEY
]);

async function safeExecute(connection, sql, params = []) {
  try {
    await connection.execute(sql, params);
  } catch (error) {
    if (ignorableErrnos.has(Number(error?.errno))) {
      return;
    }
    throw error;
  }
}

const statements = [
  `
  ALTER TABLE cari_document_line_stock_links
    ADD COLUMN reopened_from_stock_link_id BIGINT UNSIGNED NULL
      AFTER inventory_movement_id
  `,
  `
  ALTER TABLE cari_document_line_stock_links
    ADD COLUMN superseded_by_stock_link_id BIGINT UNSIGNED NULL
      AFTER reopened_from_stock_link_id
  `,
  `
  ALTER TABLE cari_document_line_stock_links
    DROP INDEX uk_cari_doc_line_stock_link_tenant_line_mode
  `,
  `
  ALTER TABLE cari_document_line_stock_links
    ADD KEY ix_cari_doc_line_stock_link_reopened_from (
      tenant_id,
      reopened_from_stock_link_id
    )
  `,
  `
  ALTER TABLE cari_document_line_stock_links
    ADD KEY ix_cari_doc_line_stock_link_superseded_by (
      tenant_id,
      superseded_by_stock_link_id
    )
  `,
  `
  ALTER TABLE cari_document_line_stock_links
    ADD KEY ix_cari_doc_line_stock_link_line_mode_status (
      tenant_id,
      legal_entity_id,
      cari_document_line_id,
      stock_impact_mode,
      link_status
    )
  `,
];

const migration121CariStockLinkSuccessorLineage = {
  key: "m121_cari_stock_link_successor_lineage",
  description:
    "Allow successor stock-intent lineage for reversed issue materialization",
  async up(connection) {
    for (const statement of statements) {
      await safeExecute(connection, statement);
    }
  },

  async down() {
    // Non-destructive migration policy: no down-op for additive schema changes.
  },
};

export default migration121CariStockLinkSuccessorLineage;
