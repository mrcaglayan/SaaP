const IGNORABLE_ERRNOS = new Set([
  1050, // ER_TABLE_EXISTS_ERROR
  1061, // ER_DUP_KEYNAME
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

const createCloseCycleItemsTableSql = `
  CREATE TABLE IF NOT EXISTS close_cycle_items (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    close_cycle_id BIGINT UNSIGNED NOT NULL,
    item_type ENUM('PERIOD_CLOSE_RUN','LOCAL_CLOSE_PACK','CONSOLIDATION_RUN') NOT NULL,
    item_key VARCHAR(160) NOT NULL,
    scope_type ENUM('BOOK','CENTRAL','OPERATING_UNIT','CONSOLIDATION_GROUP') NOT NULL,
    scope_id BIGINT UNSIGNED NOT NULL,
    legal_entity_id BIGINT UNSIGNED NULL,
    operating_unit_id BIGINT UNSIGNED NULL,
    book_id BIGINT UNSIGNED NULL,
    consolidation_group_id BIGINT UNSIGNED NULL,
    run_name VARCHAR(80) NULL,
    presentation_currency_code CHAR(3) NULL,
    business_status ENUM(
      'NOT_STARTED',
      'NOT_OPENED',
      'OPEN',
      'IN_PROGRESS',
      'READY_FOR_REVIEW',
      'RETURNED',
      'APPROVED',
      'LOCKED',
      'REOPENED',
      'SUPERSEDED',
      'DRAFT',
      'COMPLETED',
      'FAILED'
    ) NOT NULL DEFAULT 'NOT_STARTED',
    stale_status ENUM('FRESH','STALE','STALE_REVIEW_REQUIRED','FINALIZED_BUT_OUTDATED') NOT NULL DEFAULT 'FRESH',
    owner_user_id INT NULL,
    due_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_close_cycle_items_key (close_cycle_id, item_type, item_key),
    KEY ix_close_cycle_items_cycle_type_status (close_cycle_id, item_type, business_status),
    KEY ix_close_cycle_items_book_scope (book_id, legal_entity_id, operating_unit_id),
    KEY ix_close_cycle_items_group_scope (consolidation_group_id, run_name),
    CONSTRAINT fk_close_cycle_items_cycle
      FOREIGN KEY (close_cycle_id) REFERENCES close_cycles(id),
    CONSTRAINT fk_close_cycle_items_legal_entity
      FOREIGN KEY (legal_entity_id) REFERENCES legal_entities(id),
    CONSTRAINT fk_close_cycle_items_operating_unit
      FOREIGN KEY (operating_unit_id) REFERENCES operating_units(id),
    CONSTRAINT fk_close_cycle_items_book
      FOREIGN KEY (book_id) REFERENCES books(id),
    CONSTRAINT fk_close_cycle_items_consolidation_group
      FOREIGN KEY (consolidation_group_id) REFERENCES consolidation_groups(id),
    CONSTRAINT fk_close_cycle_items_owner_user
      FOREIGN KEY (owner_user_id) REFERENCES users(id),
    CONSTRAINT fk_close_cycle_items_presentation_currency
      FOREIGN KEY (presentation_currency_code) REFERENCES currencies(code),
    CHECK (
      (
        item_type = 'CONSOLIDATION_RUN'
        AND run_name IS NOT NULL
        AND presentation_currency_code IS NOT NULL
        AND consolidation_group_id IS NOT NULL
        AND scope_type = 'CONSOLIDATION_GROUP'
      )
      OR (
        item_type <> 'CONSOLIDATION_RUN'
        AND run_name IS NULL
        AND presentation_currency_code IS NULL
      )
    )
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const migration182CloseCycleItems = {
  key: "m182_close_cycle_items",
  description: "Add book-aware close cycle participation rows for period close, local close, and consolidation runs.",
  async up(connection) {
    await safeExecute(connection, createCloseCycleItemsTableSql);
  },

  async down() {
    // Additive foundation only.
  },
};

export default migration182CloseCycleItems;
