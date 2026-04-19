/**
 * m198 - Close KPI snapshots.
 *
 * Adds persisted PR-09 KPI snapshot rows so the cockpit can retain summary and
 * entity heatmap metrics without changing the underlying close-runtime engines.
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

const createCloseKpiSnapshotsTableSql = `
  CREATE TABLE IF NOT EXISTS close_kpi_snapshots (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    close_cycle_id BIGINT UNSIGNED NOT NULL,
    snapshot_kind ENUM(
      'CYCLE_SUMMARY',
      'ENTITY_READINESS_HEATMAP'
    ) NOT NULL,
    snapshot_key VARCHAR(191) NOT NULL,
    scope_legal_entity_id BIGINT UNSIGNED NULL,
    completion_percent DECIMAL(9,2) NOT NULL DEFAULT 0,
    overdue_count INT UNSIGNED NOT NULL DEFAULT 0,
    stale_count INT UNSIGNED NOT NULL DEFAULT 0,
    reopen_count INT UNSIGNED NOT NULL DEFAULT 0,
    avg_approval_sla_hours DECIMAL(12,2) NULL,
    bottleneck_step VARCHAR(64) NULL,
    payload_json JSON NULL,
    captured_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_close_kpi_snapshots_cycle_key (
      tenant_id,
      close_cycle_id,
      snapshot_kind,
      snapshot_key
    ),
    KEY ix_close_kpi_snapshots_kind (
      tenant_id,
      close_cycle_id,
      snapshot_kind
    ),
    KEY ix_close_kpi_snapshots_entity (
      tenant_id,
      scope_legal_entity_id,
      snapshot_kind
    ),
    CONSTRAINT fk_close_kpi_snapshots_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_close_kpi_snapshots_cycle
      FOREIGN KEY (close_cycle_id) REFERENCES close_cycles(id),
    CONSTRAINT fk_close_kpi_snapshots_entity
      FOREIGN KEY (scope_legal_entity_id) REFERENCES legal_entities(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const migration198CloseKpiSnapshots = {
  key: "m198_close_kpi_snapshots",
  description:
    "Add PR-09 close KPI snapshot rows for summary metrics and entity readiness heatmaps.",
  async up(connection) {
    await safeExecute(connection, createCloseKpiSnapshotsTableSql);
  },

  async down() {
    // Additive foundation only.
  },
};

export default migration198CloseKpiSnapshots;
