/**
 * m194 - Close reconciliation-set foundation.
 *
 * Adds the PR-08 parent control rows that let the close cockpit group bank,
 * subledger, suspense/clearing, and intercompany reconciliations without
 * replacing the existing runtime modules that already compute those controls.
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

const createCloseReconciliationSetsTableSql = `
  CREATE TABLE IF NOT EXISTS close_reconciliation_sets (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    close_cycle_id BIGINT UNSIGNED NOT NULL,
    set_key VARCHAR(128) NOT NULL,
    set_family ENUM(
      'BANK_RECONCILIATION',
      'SUBLEDGER_GL_RECONCILIATION',
      'SUSPENSE_CLEARING_RECONCILIATION',
      'INTERCOMPANY_RECONCILIATION'
    ) NOT NULL,
    set_title VARCHAR(191) NOT NULL,
    owner_user_id INT NULL,
    due_at TIMESTAMP NULL,
    metadata_json JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_close_reconciliation_sets_cycle_key (tenant_id, close_cycle_id, set_key),
    KEY ix_close_reconciliation_sets_family (tenant_id, close_cycle_id, set_family),
    CONSTRAINT fk_close_reconciliation_sets_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_close_reconciliation_sets_cycle
      FOREIGN KEY (close_cycle_id) REFERENCES close_cycles(id),
    CONSTRAINT fk_close_reconciliation_sets_owner_user
      FOREIGN KEY (owner_user_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const migration194CloseReconciliationSets = {
  key: "m194_close_reconciliation_sets",
  description:
    "Add close reconciliation-set rows so PR-08 can anchor the first close-control layer beyond approvals.",
  async up(connection) {
    await safeExecute(connection, createCloseReconciliationSetsTableSql);
  },

  async down() {
    // Additive foundation only.
  },
};

export default migration194CloseReconciliationSets;
