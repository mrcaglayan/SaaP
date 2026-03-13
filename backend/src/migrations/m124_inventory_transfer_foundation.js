const IGNORABLE_ERRNOS = new Set([
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
    if (IGNORABLE_ERRNOS.has(Number(err?.errno))) {
      return;
    }
    throw err;
  }
}

async function readColumnType(connection, tableName, columnName) {
  const [rows] = await connection.execute(
    `SELECT column_type
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name = ?
      LIMIT 1`,
    [tableName, columnName]
  );
  return Array.isArray(rows) && rows.length > 0 ? String(rows[0].column_type || "") : "";
}

async function ensureInventoryMovementSourceTypeEnum(connection) {
  const columnType = await readColumnType(connection, "inventory_movements", "source_type");
  if (!columnType) {
    return;
  }

  const enumMatches = Array.from(columnType.matchAll(/'([^']+)'/g)).map((match) => match[1]);
  if (enumMatches.includes("INVENTORY_TRANSFER")) {
    return;
  }

  const nextValues = [...enumMatches, "INVENTORY_TRANSFER"];
  await safeExecute(
    connection,
    `ALTER TABLE inventory_movements
       MODIFY COLUMN source_type ENUM(${nextValues.map((value) => `'${value}'`).join(",")}) NOT NULL`
  );
}

const migration124InventoryTransferFoundation = {
  key: "m124_inventory_transfer_foundation",
  description:
    "Add cross-context inventory transfer header and line foundation with approval lifecycle",
  async up(connection) {
    await safeExecute(
      connection,
      `CREATE TABLE IF NOT EXISTS inventory_transfers (
         id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
         tenant_id BIGINT UNSIGNED NOT NULL,
         legal_entity_id BIGINT UNSIGNED NOT NULL,
         transfer_no VARCHAR(60) NOT NULL,
         transfer_date DATE NOT NULL,
         status ENUM('INITIATED','APPROVED','IN_TRANSIT','RECEIVED','CANCELED','REVERSED') NOT NULL DEFAULT 'INITIATED',
         source_warehouse_id BIGINT UNSIGNED NOT NULL,
         target_warehouse_id BIGINT UNSIGNED NOT NULL,
         source_ownership_scope ENUM('CENTRAL','OPERATING_UNIT') NOT NULL,
         source_operating_unit_id BIGINT UNSIGNED NULL,
         target_ownership_scope ENUM('CENTRAL','OPERATING_UNIT') NOT NULL,
         target_operating_unit_id BIGINT UNSIGNED NULL,
         shipment_journal_entry_id BIGINT UNSIGNED NULL,
         receipt_journal_entry_id BIGINT UNSIGNED NULL,
         reversal_journal_entry_id BIGINT UNSIGNED NULL,
         initiated_by_user_id INT NOT NULL,
         approved_by_user_id INT NULL,
         shipped_by_user_id INT NULL,
         received_by_user_id INT NULL,
         canceled_by_user_id INT NULL,
         reversed_by_user_id INT NULL,
         initiated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         approved_at TIMESTAMP NULL,
         in_transit_at TIMESTAMP NULL,
         received_at TIMESTAMP NULL,
         canceled_at TIMESTAMP NULL,
         reversed_at TIMESTAMP NULL,
         cancel_reason VARCHAR(255) NULL,
         reverse_reason VARCHAR(255) NULL,
         idempotency_key VARCHAR(100) NULL,
         integration_event_uid VARCHAR(100) NULL,
         source_module VARCHAR(40) NOT NULL DEFAULT 'INVENTORY',
         source_entity_type VARCHAR(60) NULL,
         source_entity_id BIGINT UNSIGNED NULL,
         note VARCHAR(500) NULL,
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
         UNIQUE KEY uk_inventory_transfers_tenant_entity_transfer_no (tenant_id, legal_entity_id, transfer_no),
         UNIQUE KEY uk_inventory_transfers_tenant_idempotency_key (tenant_id, idempotency_key),
         KEY ix_inventory_transfers_tenant_entity_status_date (
           tenant_id,
           legal_entity_id,
           status,
           transfer_date
         ),
         KEY ix_inventory_transfers_tenant_source_target_status (
           tenant_id,
           source_warehouse_id,
           target_warehouse_id,
           status
         ),
         CONSTRAINT fk_inventory_transfers_tenant
           FOREIGN KEY (tenant_id) REFERENCES tenants(id),
         CONSTRAINT fk_inventory_transfers_legal_entity_tenant
           FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES legal_entities(tenant_id, id),
         CONSTRAINT fk_inventory_transfers_source_warehouse
           FOREIGN KEY (source_warehouse_id) REFERENCES inventory_warehouses(id),
         CONSTRAINT fk_inventory_transfers_target_warehouse
           FOREIGN KEY (target_warehouse_id) REFERENCES inventory_warehouses(id),
         CONSTRAINT fk_inventory_transfers_source_operating_unit
           FOREIGN KEY (source_operating_unit_id) REFERENCES operating_units(id),
         CONSTRAINT fk_inventory_transfers_target_operating_unit
           FOREIGN KEY (target_operating_unit_id) REFERENCES operating_units(id),
         CONSTRAINT fk_inventory_transfers_shipment_journal
           FOREIGN KEY (shipment_journal_entry_id) REFERENCES journal_entries(id),
         CONSTRAINT fk_inventory_transfers_receipt_journal
           FOREIGN KEY (receipt_journal_entry_id) REFERENCES journal_entries(id),
         CONSTRAINT fk_inventory_transfers_reversal_journal
           FOREIGN KEY (reversal_journal_entry_id) REFERENCES journal_entries(id),
         CONSTRAINT fk_inventory_transfers_initiated_by
           FOREIGN KEY (initiated_by_user_id) REFERENCES users(id),
         CONSTRAINT fk_inventory_transfers_approved_by
           FOREIGN KEY (approved_by_user_id) REFERENCES users(id),
         CONSTRAINT fk_inventory_transfers_shipped_by
           FOREIGN KEY (shipped_by_user_id) REFERENCES users(id),
         CONSTRAINT fk_inventory_transfers_received_by
           FOREIGN KEY (received_by_user_id) REFERENCES users(id),
         CONSTRAINT fk_inventory_transfers_canceled_by
           FOREIGN KEY (canceled_by_user_id) REFERENCES users(id),
         CONSTRAINT fk_inventory_transfers_reversed_by
           FOREIGN KEY (reversed_by_user_id) REFERENCES users(id),
         CHECK (source_warehouse_id <> target_warehouse_id)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );

    await safeExecute(
      connection,
      `CREATE TABLE IF NOT EXISTS inventory_transfer_lines (
         id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
         tenant_id BIGINT UNSIGNED NOT NULL,
         legal_entity_id BIGINT UNSIGNED NOT NULL,
         inventory_transfer_id BIGINT UNSIGNED NOT NULL,
         line_no INT NOT NULL,
         item_card_id BIGINT UNSIGNED NOT NULL,
         quantity_requested DECIMAL(20,6) NOT NULL DEFAULT 0.000000,
         quantity_shipped DECIMAL(20,6) NOT NULL DEFAULT 0.000000,
         quantity_received DECIMAL(20,6) NOT NULL DEFAULT 0.000000,
         shipped_currency_code CHAR(3) NULL,
         shipped_unit_cost_txn DECIMAL(20,6) NULL,
         shipped_unit_cost_base DECIMAL(20,6) NULL,
         shipped_total_cost_txn DECIMAL(20,6) NULL,
         shipped_total_cost_base DECIMAL(20,6) NULL,
         source_issue_movement_id BIGINT UNSIGNED NULL,
         target_receipt_movement_id BIGINT UNSIGNED NULL,
         note VARCHAR(255) NULL,
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
         UNIQUE KEY uk_inventory_transfer_lines_transfer_line_no (inventory_transfer_id, line_no),
         KEY ix_inventory_transfer_lines_tenant_transfer (tenant_id, inventory_transfer_id),
         KEY ix_inventory_transfer_lines_tenant_item_card (tenant_id, item_card_id),
         CONSTRAINT fk_inventory_transfer_lines_tenant
           FOREIGN KEY (tenant_id) REFERENCES tenants(id),
         CONSTRAINT fk_inventory_transfer_lines_legal_entity_tenant
           FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES legal_entities(tenant_id, id),
         CONSTRAINT fk_inventory_transfer_lines_transfer
           FOREIGN KEY (inventory_transfer_id) REFERENCES inventory_transfers(id),
         CONSTRAINT fk_inventory_transfer_lines_item_card
           FOREIGN KEY (item_card_id) REFERENCES item_cards(id),
         CONSTRAINT fk_inventory_transfer_lines_source_issue_movement
           FOREIGN KEY (source_issue_movement_id) REFERENCES inventory_movements(id),
         CONSTRAINT fk_inventory_transfer_lines_target_receipt_movement
           FOREIGN KEY (target_receipt_movement_id) REFERENCES inventory_movements(id),
         CHECK (quantity_requested > 0),
         CHECK (quantity_shipped >= 0),
         CHECK (quantity_received >= 0)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );

    await ensureInventoryMovementSourceTypeEnum(connection);
  },

  async down() {
    // Non-destructive migration policy: no down-op for additive schema changes.
  },
};

export default migration124InventoryTransferFoundation;
