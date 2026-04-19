/**
 * m196 - Intercompany mismatch-queue foundation.
 *
 * Adds the PR-08 persisted queue rows that can retain detected intercompany
 * pair mismatches for close cycles while later roadmap steps decide how those
 * rows are actioned and escalated.
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

const createIntercompanyMismatchQueueTableSql = `
  CREATE TABLE IF NOT EXISTS intercompany_mismatch_queue (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    close_cycle_id BIGINT UNSIGNED NOT NULL,
    close_reconciliation_item_id BIGINT UNSIGNED NOT NULL,
    mismatch_key VARCHAR(191) NOT NULL,
    fiscal_period_id BIGINT UNSIGNED NOT NULL,
    legal_entity_a_id BIGINT UNSIGNED NOT NULL,
    legal_entity_b_id BIGINT UNSIGNED NOT NULL,
    status ENUM('MISMATCHED','UNILATERAL','RESOLVED') NOT NULL DEFAULT 'MISMATCHED',
    difference_base DECIMAL(20,6) NOT NULL DEFAULT 0,
    absolute_difference_base DECIMAL(20,6) NOT NULL DEFAULT 0,
    payload_json JSON NULL,
    first_detected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_detected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_intercompany_mismatch_queue_cycle_key (tenant_id, close_cycle_id, mismatch_key),
    KEY ix_intercompany_mismatch_queue_item (tenant_id, close_reconciliation_item_id),
    KEY ix_intercompany_mismatch_queue_status (tenant_id, close_cycle_id, status),
    CONSTRAINT fk_intercompany_mismatch_queue_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_intercompany_mismatch_queue_cycle
      FOREIGN KEY (close_cycle_id) REFERENCES close_cycles(id),
    CONSTRAINT fk_intercompany_mismatch_queue_reconciliation_item
      FOREIGN KEY (close_reconciliation_item_id) REFERENCES close_reconciliation_items(id),
    CONSTRAINT fk_intercompany_mismatch_queue_period
      FOREIGN KEY (fiscal_period_id) REFERENCES fiscal_periods(id),
    CONSTRAINT fk_intercompany_mismatch_queue_entity_a
      FOREIGN KEY (tenant_id, legal_entity_a_id) REFERENCES legal_entities(tenant_id, id),
    CONSTRAINT fk_intercompany_mismatch_queue_entity_b
      FOREIGN KEY (tenant_id, legal_entity_b_id) REFERENCES legal_entities(tenant_id, id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const migration196IntercompanyMismatchQueue = {
  key: "m196_intercompany_mismatch_queue",
  description:
    "Add persisted intercompany mismatch queue rows so PR-08 can retain detected pair mismatches per close cycle.",
  async up(connection) {
    await safeExecute(connection, createIntercompanyMismatchQueueTableSql);
  },

  async down() {
    // Additive foundation only.
  },
};

export default migration196IntercompanyMismatchQueue;
