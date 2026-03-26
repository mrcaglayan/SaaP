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
  CREATE TABLE IF NOT EXISTS stock_landed_cost_vouchers (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    legal_entity_id BIGINT UNSIGNED NOT NULL,
    voucher_no VARCHAR(60) NOT NULL,
    status ENUM('DRAFT','POSTED','REVERSED','CANCELED') NOT NULL DEFAULT 'DRAFT',
    posting_date DATE NOT NULL,
    ownership_scope ENUM('CENTRAL','OPERATING_UNIT') NOT NULL,
    operating_unit_id BIGINT UNSIGNED NULL,
    currency_code CHAR(3) NOT NULL,
    note VARCHAR(500) NULL,
    posted_journal_entry_id BIGINT UNSIGNED NULL,
    reversal_journal_entry_id BIGINT UNSIGNED NULL,
    reversal_of_voucher_id BIGINT UNSIGNED NULL,
    reversed_by_voucher_id BIGINT UNSIGNED NULL,
    posted_at TIMESTAMP NULL,
    reversed_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_slcv_tenant_entity_voucher_no (tenant_id, legal_entity_id, voucher_no),
    UNIQUE KEY uk_slcv_tenant_id_id (tenant_id, id),
    UNIQUE KEY uk_slcv_tenant_entity_id (tenant_id, legal_entity_id, id),
    KEY ix_slcv_tenant_id (tenant_id),
    KEY ix_slcv_tenant_entity (tenant_id, legal_entity_id),
    KEY ix_slcv_tenant_status_date (tenant_id, legal_entity_id, status, posting_date),
    KEY ix_slcv_tenant_scope_status (
      tenant_id,
      legal_entity_id,
      ownership_scope,
      operating_unit_id,
      status
    ),
    CONSTRAINT fk_slcv_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_slcv_entity_tenant
      FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES legal_entities(tenant_id, id),
    CONSTRAINT fk_slcv_operating_unit
      FOREIGN KEY (operating_unit_id) REFERENCES operating_units(id),
    CONSTRAINT fk_slcv_posted_journal
      FOREIGN KEY (posted_journal_entry_id) REFERENCES journal_entries(id),
    CONSTRAINT fk_slcv_reversal_journal
      FOREIGN KEY (reversal_journal_entry_id) REFERENCES journal_entries(id),
    CONSTRAINT fk_slcv_reversal_of
      FOREIGN KEY (reversal_of_voucher_id) REFERENCES stock_landed_cost_vouchers(id),
    CONSTRAINT fk_slcv_reversed_by
      FOREIGN KEY (reversed_by_voucher_id) REFERENCES stock_landed_cost_vouchers(id),
    CHECK (
      (ownership_scope = 'CENTRAL' AND operating_unit_id IS NULL)
      OR (ownership_scope = 'OPERATING_UNIT' AND operating_unit_id IS NOT NULL)
    )
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
  `
  CREATE TABLE IF NOT EXISTS stock_landed_cost_voucher_sources (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    legal_entity_id BIGINT UNSIGNED NOT NULL,
    voucher_id BIGINT UNSIGNED NOT NULL,
    source_cari_document_id BIGINT UNSIGNED NOT NULL,
    source_cari_document_line_id BIGINT UNSIGNED NOT NULL,
    source_currency_code_snapshot CHAR(3) NOT NULL,
    source_posting_account_id_snapshot BIGINT UNSIGNED NOT NULL,
    applied_amount_txn DECIMAL(20,6) NOT NULL DEFAULT 0.000000,
    applied_amount_base DECIMAL(20,6) NOT NULL DEFAULT 0.000000,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_slcvs_voucher_source_line (voucher_id, source_cari_document_line_id),
    UNIQUE KEY uk_slcvs_tenant_id_id (tenant_id, id),
    UNIQUE KEY uk_slcvs_tenant_entity_id (tenant_id, legal_entity_id, id),
    KEY ix_slcvs_tenant_id (tenant_id),
    KEY ix_slcvs_tenant_entity (tenant_id, legal_entity_id),
    KEY ix_slcvs_tenant_voucher (tenant_id, legal_entity_id, voucher_id),
    KEY ix_slcvs_tenant_source_doc (tenant_id, legal_entity_id, source_cari_document_id),
    KEY ix_slcvs_tenant_source_line (tenant_id, legal_entity_id, source_cari_document_line_id),
    CONSTRAINT fk_slcvs_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_slcvs_entity_tenant
      FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES legal_entities(tenant_id, id),
    CONSTRAINT fk_slcvs_voucher
      FOREIGN KEY (tenant_id, legal_entity_id, voucher_id)
      REFERENCES stock_landed_cost_vouchers(tenant_id, legal_entity_id, id)
      ON DELETE CASCADE,
    CONSTRAINT fk_slcvs_source_document
      FOREIGN KEY (tenant_id, legal_entity_id, source_cari_document_id)
      REFERENCES cari_documents(tenant_id, legal_entity_id, id),
    CONSTRAINT fk_slcvs_source_line
      FOREIGN KEY (
        tenant_id,
        legal_entity_id,
        source_cari_document_id,
        source_cari_document_line_id
      )
      REFERENCES cari_document_lines(tenant_id, legal_entity_id, cari_document_id, id),
    CONSTRAINT fk_slcvs_posting_account
      FOREIGN KEY (source_posting_account_id_snapshot) REFERENCES accounts(id),
    CHECK (applied_amount_txn >= 0),
    CHECK (applied_amount_base > 0)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
  `
  CREATE TABLE IF NOT EXISTS stock_landed_cost_voucher_targets (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    legal_entity_id BIGINT UNSIGNED NOT NULL,
    voucher_id BIGINT UNSIGNED NOT NULL,
    source_stock_link_id BIGINT UNSIGNED NOT NULL,
    source_anchor_inventory_movement_id BIGINT UNSIGNED NOT NULL,
    allocation_method_snapshot ENUM('EQUAL','BY_AMOUNT','BY_QTY','MANUAL') NOT NULL,
    allocated_amount_txn DECIMAL(20,6) NULL,
    allocated_amount_base DECIMAL(20,6) NOT NULL DEFAULT 0.000000,
    quantity_basis_snapshot DECIMAL(20,6) NOT NULL DEFAULT 0.000000,
    on_hand_allocated_amount_base DECIMAL(20,6) NOT NULL DEFAULT 0.000000,
    consumed_allocated_amount_base DECIMAL(20,6) NOT NULL DEFAULT 0.000000,
    ownership_scope_snapshot ENUM('CENTRAL','OPERATING_UNIT') NOT NULL,
    operating_unit_id_snapshot BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_slcvt_voucher_stock_link (voucher_id, source_stock_link_id),
    UNIQUE KEY uk_slcvt_tenant_id_id (tenant_id, id),
    UNIQUE KEY uk_slcvt_tenant_entity_id (tenant_id, legal_entity_id, id),
    KEY ix_slcvt_tenant_id (tenant_id),
    KEY ix_slcvt_tenant_entity (tenant_id, legal_entity_id),
    KEY ix_slcvt_tenant_voucher (tenant_id, legal_entity_id, voucher_id),
    KEY ix_slcvt_tenant_stock_link (tenant_id, source_stock_link_id),
    KEY ix_slcvt_tenant_anchor_move (tenant_id, source_anchor_inventory_movement_id),
    KEY ix_slcvt_tenant_context (
      tenant_id,
      legal_entity_id,
      ownership_scope_snapshot,
      operating_unit_id_snapshot
    ),
    CONSTRAINT fk_slcvt_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_slcvt_entity_tenant
      FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES legal_entities(tenant_id, id),
    CONSTRAINT fk_slcvt_voucher
      FOREIGN KEY (tenant_id, legal_entity_id, voucher_id)
      REFERENCES stock_landed_cost_vouchers(tenant_id, legal_entity_id, id)
      ON DELETE CASCADE,
    CONSTRAINT fk_slcvt_stock_link
      FOREIGN KEY (tenant_id, source_stock_link_id)
      REFERENCES cari_document_line_stock_links(tenant_id, id),
    CONSTRAINT fk_slcvt_anchor_movement
      FOREIGN KEY (source_anchor_inventory_movement_id) REFERENCES inventory_movements(id),
    CONSTRAINT fk_slcvt_ou_snapshot
      FOREIGN KEY (operating_unit_id_snapshot) REFERENCES operating_units(id),
    CHECK (allocated_amount_txn IS NULL OR allocated_amount_txn >= 0),
    CHECK (allocated_amount_base >= 0),
    CHECK (quantity_basis_snapshot >= 0),
    CHECK (on_hand_allocated_amount_base >= 0),
    CHECK (consumed_allocated_amount_base >= 0),
    CHECK (
      (ownership_scope_snapshot = 'CENTRAL' AND operating_unit_id_snapshot IS NULL)
      OR (
        ownership_scope_snapshot = 'OPERATING_UNIT'
        AND operating_unit_id_snapshot IS NOT NULL
      )
    )
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
  `
  CREATE TABLE IF NOT EXISTS stock_landed_cost_voucher_layer_allocations (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    legal_entity_id BIGINT UNSIGNED NOT NULL,
    voucher_target_id BIGINT UNSIGNED NOT NULL,
    source_anchor_inventory_movement_id BIGINT UNSIGNED NOT NULL,
    resolved_inventory_movement_id BIGINT UNSIGNED NOT NULL,
    resolved_cost_layer_id BIGINT UNSIGNED NOT NULL,
    origin_layer_allocation_id BIGINT UNSIGNED NULL,
    allocation_role ENUM('ON_HAND','CONSUMED') NOT NULL,
    quantity_snapshot DECIMAL(20,6) NOT NULL DEFAULT 0.000000,
    allocated_amount_base DECIMAL(20,6) NOT NULL DEFAULT 0.000000,
    remaining_adjusted_quantity DECIMAL(20,6) NOT NULL DEFAULT 0.000000,
    remaining_adjusted_amount_base DECIMAL(20,6) NOT NULL DEFAULT 0.000000,
    open_status ENUM('OPEN','CLOSED') NOT NULL DEFAULT 'OPEN',
    allocated_amount_txn DECIMAL(20,6) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_slcvla_target_layer_role (
      voucher_target_id,
      resolved_cost_layer_id,
      allocation_role
    ),
    UNIQUE KEY uk_slcvla_tenant_id_id (tenant_id, id),
    UNIQUE KEY uk_slcvla_tenant_entity_id (tenant_id, legal_entity_id, id),
    KEY ix_slcvla_tenant_id (tenant_id),
    KEY ix_slcvla_tenant_entity (tenant_id, legal_entity_id),
    KEY ix_slcvla_target (tenant_id, legal_entity_id, voucher_target_id),
    KEY ix_slcvla_anchor_move (tenant_id, source_anchor_inventory_movement_id),
    KEY ix_slcvla_resolved_move (tenant_id, resolved_inventory_movement_id),
    KEY ix_slcvla_resolved_layer_open (
      tenant_id,
      resolved_cost_layer_id,
      open_status,
      remaining_adjusted_quantity,
      remaining_adjusted_amount_base
    ),
    KEY ix_slcvla_origin (tenant_id, origin_layer_allocation_id),
    CONSTRAINT fk_slcvla_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_slcvla_entity_tenant
      FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES legal_entities(tenant_id, id),
    CONSTRAINT fk_slcvla_target
      FOREIGN KEY (tenant_id, legal_entity_id, voucher_target_id)
      REFERENCES stock_landed_cost_voucher_targets(tenant_id, legal_entity_id, id)
      ON DELETE CASCADE,
    CONSTRAINT fk_slcvla_anchor_move
      FOREIGN KEY (source_anchor_inventory_movement_id) REFERENCES inventory_movements(id),
    CONSTRAINT fk_slcvla_resolved_move
      FOREIGN KEY (resolved_inventory_movement_id) REFERENCES inventory_movements(id),
    CONSTRAINT fk_slcvla_resolved_layer
      FOREIGN KEY (resolved_cost_layer_id) REFERENCES inventory_cost_layers(id),
    CONSTRAINT fk_slcvla_origin
      FOREIGN KEY (origin_layer_allocation_id)
      REFERENCES stock_landed_cost_voucher_layer_allocations(id),
    CHECK (quantity_snapshot >= 0),
    CHECK (allocated_amount_base >= 0),
    CHECK (remaining_adjusted_quantity >= 0),
    CHECK (remaining_adjusted_amount_base >= 0),
    CHECK (allocated_amount_txn IS NULL OR allocated_amount_txn >= 0)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
  `
  CREATE TABLE IF NOT EXISTS stock_landed_cost_layer_consumptions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    legal_entity_id BIGINT UNSIGNED NOT NULL,
    voucher_layer_allocation_id BIGINT UNSIGNED NOT NULL,
    consuming_inventory_movement_id BIGINT UNSIGNED NOT NULL,
    consuming_inventory_transfer_id BIGINT UNSIGNED NULL,
    quantity_consumed DECIMAL(20,6) NOT NULL DEFAULT 0.000000,
    allocated_amount_base_consumed DECIMAL(20,6) NOT NULL DEFAULT 0.000000,
    carry_forward_receipt_movement_id BIGINT UNSIGNED NULL,
    carry_forward_cost_layer_id BIGINT UNSIGNED NULL,
    carry_forward_layer_allocation_id BIGINT UNSIGNED NULL,
    restored_by_inventory_movement_id BIGINT UNSIGNED NULL,
    restored_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_slclc_layer_consuming_move (
      voucher_layer_allocation_id,
      consuming_inventory_movement_id
    ),
    UNIQUE KEY uk_slclc_tenant_id_id (tenant_id, id),
    UNIQUE KEY uk_slclc_tenant_entity_id (tenant_id, legal_entity_id, id),
    KEY ix_slclc_tenant_id (tenant_id),
    KEY ix_slclc_tenant_entity (tenant_id, legal_entity_id),
    KEY ix_slclc_layer_alloc (tenant_id, legal_entity_id, voucher_layer_allocation_id),
    KEY ix_slclc_consuming_move (tenant_id, consuming_inventory_movement_id),
    KEY ix_slclc_transfer (tenant_id, consuming_inventory_transfer_id),
    KEY ix_slclc_carry_receipt (tenant_id, carry_forward_receipt_movement_id),
    KEY ix_slclc_carry_layer_alloc (tenant_id, carry_forward_layer_allocation_id),
    CONSTRAINT fk_slclc_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_slclc_entity_tenant
      FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES legal_entities(tenant_id, id),
    CONSTRAINT fk_slclc_layer_alloc
      FOREIGN KEY (tenant_id, legal_entity_id, voucher_layer_allocation_id)
      REFERENCES stock_landed_cost_voucher_layer_allocations(tenant_id, legal_entity_id, id)
      ON DELETE CASCADE,
    CONSTRAINT fk_slclc_consuming_move
      FOREIGN KEY (consuming_inventory_movement_id) REFERENCES inventory_movements(id),
    CONSTRAINT fk_slclc_consuming_transfer
      FOREIGN KEY (consuming_inventory_transfer_id) REFERENCES inventory_transfers(id),
    CONSTRAINT fk_slclc_carry_receipt_move
      FOREIGN KEY (carry_forward_receipt_movement_id) REFERENCES inventory_movements(id),
    CONSTRAINT fk_slclc_carry_cost_layer
      FOREIGN KEY (carry_forward_cost_layer_id) REFERENCES inventory_cost_layers(id),
    CONSTRAINT fk_slclc_carry_layer_alloc
      FOREIGN KEY (carry_forward_layer_allocation_id)
      REFERENCES stock_landed_cost_voucher_layer_allocations(id),
    CONSTRAINT fk_slclc_restored_move
      FOREIGN KEY (restored_by_inventory_movement_id) REFERENCES inventory_movements(id),
    CHECK (quantity_consumed > 0),
    CHECK (allocated_amount_base_consumed >= 0)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
];

const migration154StockLandedCostVouchers = {
  key: "m154_stock_landed_cost_vouchers",
  description:
    "Add landed-cost voucher, source, target, layer-allocation, and consumption foundation schema",
  async up(connection) {
    for (const statement of createTableStatements) {
      await safeExecute(connection, statement);
    }
  },

  async down() {
    // Non-destructive migration policy: no down-op for additive schema changes.
  },
};

export default migration154StockLandedCostVouchers;
