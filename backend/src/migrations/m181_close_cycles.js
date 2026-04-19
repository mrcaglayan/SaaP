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

const createCloseCyclesTableSql = `
  CREATE TABLE IF NOT EXISTS close_cycles (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    cycle_type ENUM('MONTH_END','QUARTER_END','YEAR_END') NOT NULL,
    scope_kind ENUM('LEGAL_ENTITY','CONSOLIDATION_GROUP') NOT NULL,
    fiscal_calendar_id BIGINT UNSIGNED NOT NULL,
    fiscal_period_id BIGINT UNSIGNED NOT NULL,
    legal_entity_id BIGINT UNSIGNED NULL,
    consolidation_group_id BIGINT UNSIGNED NULL,
    group_company_id BIGINT UNSIGNED NULL,
    scope_key VARCHAR(80) NOT NULL,
    status ENUM('PLANNED','OPEN','LOCKED','IN_REVIEW','CLOSED','REOPENED') NOT NULL DEFAULT 'PLANNED',
    starts_at TIMESTAMP NULL,
    due_at TIMESTAMP NULL,
    owner_user_id INT NULL,
    created_by_user_id INT NOT NULL,
    updated_by_user_id INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_close_cycles_scope (tenant_id, cycle_type, fiscal_period_id, scope_key),
    KEY ix_close_cycles_status_period (tenant_id, status, fiscal_period_id),
    KEY ix_close_cycles_entity_scope (tenant_id, legal_entity_id, fiscal_period_id),
    KEY ix_close_cycles_group_scope (tenant_id, consolidation_group_id, fiscal_period_id),
    CONSTRAINT fk_close_cycles_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_close_cycles_calendar
      FOREIGN KEY (fiscal_calendar_id) REFERENCES fiscal_calendars(id),
    CONSTRAINT fk_close_cycles_period
      FOREIGN KEY (fiscal_period_id) REFERENCES fiscal_periods(id),
    CONSTRAINT fk_close_cycles_legal_entity
      FOREIGN KEY (legal_entity_id) REFERENCES legal_entities(id),
    CONSTRAINT fk_close_cycles_consolidation_group
      FOREIGN KEY (consolidation_group_id) REFERENCES consolidation_groups(id),
    CONSTRAINT fk_close_cycles_group_company
      FOREIGN KEY (group_company_id) REFERENCES group_companies(id),
    CONSTRAINT fk_close_cycles_owner_user
      FOREIGN KEY (tenant_id, owner_user_id) REFERENCES users(tenant_id, id),
    CONSTRAINT fk_close_cycles_created_by_user
      FOREIGN KEY (tenant_id, created_by_user_id) REFERENCES users(tenant_id, id),
    CONSTRAINT fk_close_cycles_updated_by_user
      FOREIGN KEY (tenant_id, updated_by_user_id) REFERENCES users(tenant_id, id),
    CHECK (
      (
        scope_kind = 'LEGAL_ENTITY'
        AND legal_entity_id IS NOT NULL
        AND consolidation_group_id IS NULL
      )
      OR (
        scope_kind = 'CONSOLIDATION_GROUP'
        AND legal_entity_id IS NULL
        AND consolidation_group_id IS NOT NULL
      )
    )
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const migration181CloseCycles = {
  key: "m181_close_cycles",
  description: "Add close cycle control-plane headers for entity and consolidation-group close orchestration.",
  async up(connection) {
    await safeExecute(connection, createCloseCyclesTableSql);
  },

  async down() {
    // Additive foundation only.
  },
};

export default migration181CloseCycles;
