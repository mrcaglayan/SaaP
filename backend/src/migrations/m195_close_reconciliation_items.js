/**
 * m195 - Close reconciliation-item foundation.
 *
 * Adds the PR-08 child rows that materialize bank, subledger, suspense, and
 * intercompany control participants for each close cycle.
 */

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

const createCloseReconciliationItemsTableSql = `
  CREATE TABLE IF NOT EXISTS close_reconciliation_items (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    close_reconciliation_set_id BIGINT UNSIGNED NOT NULL,
    close_cycle_id BIGINT UNSIGNED NOT NULL,
    close_cycle_item_id BIGINT UNSIGNED NULL,
    item_key VARCHAR(191) NOT NULL,
    control_type ENUM('BANK_ACCOUNT','BOOK','LEGAL_ENTITY','ENTITY_PAIR') NOT NULL,
    legal_entity_id BIGINT UNSIGNED NULL,
    book_id BIGINT UNSIGNED NULL,
    bank_account_id BIGINT UNSIGNED NULL,
    account_id BIGINT UNSIGNED NULL,
    counterparty_legal_entity_id BIGINT UNSIGNED NULL,
    owner_user_id INT NULL,
    due_at TIMESTAMP NULL,
    metadata_json JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_close_reconciliation_items_cycle_key (tenant_id, close_cycle_id, item_key),
    KEY ix_close_reconciliation_items_set (tenant_id, close_reconciliation_set_id),
    KEY ix_close_reconciliation_items_family_dims (
      tenant_id,
      close_cycle_id,
      legal_entity_id,
      book_id,
      bank_account_id,
      counterparty_legal_entity_id
    ),
    CONSTRAINT fk_close_reconciliation_items_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_close_reconciliation_items_set
      FOREIGN KEY (close_reconciliation_set_id) REFERENCES close_reconciliation_sets(id),
    CONSTRAINT fk_close_reconciliation_items_cycle
      FOREIGN KEY (close_cycle_id) REFERENCES close_cycles(id),
    CONSTRAINT fk_close_reconciliation_items_cycle_item
      FOREIGN KEY (close_cycle_item_id) REFERENCES close_cycle_items(id),
    CONSTRAINT fk_close_reconciliation_items_legal_entity
      FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES legal_entities(tenant_id, id),
    CONSTRAINT fk_close_reconciliation_items_book
      FOREIGN KEY (book_id) REFERENCES books(id),
    CONSTRAINT fk_close_reconciliation_items_bank_account
      FOREIGN KEY (tenant_id, legal_entity_id, bank_account_id)
      REFERENCES bank_accounts(tenant_id, legal_entity_id, id),
    CONSTRAINT fk_close_reconciliation_items_account
      FOREIGN KEY (account_id) REFERENCES accounts(id),
    CONSTRAINT fk_close_reconciliation_items_owner_user
      FOREIGN KEY (owner_user_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const migration195CloseReconciliationItems = {
  key: "m195_close_reconciliation_items",
  description:
    "Add close reconciliation-item rows so PR-08 can materialize real close controls from cycle participation.",
  async up(connection) {
    await safeExecute(connection, createCloseReconciliationItemsTableSql);
  },

  async down() {
    // Additive foundation only.
  },
};

export default migration195CloseReconciliationItems;
