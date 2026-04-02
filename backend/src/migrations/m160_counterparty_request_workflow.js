/**
 * m160 - Counterparty request workflow.
 *
 * Adds a lightweight request queue so branch-scoped users can submit customer
 * or vendor master requests without receiving direct counterparty upsert power.
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

const createCounterpartyRequestsTableSql = `
  CREATE TABLE IF NOT EXISTS counterparty_requests (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    legal_entity_id BIGINT UNSIGNED NOT NULL,
    primary_operating_unit_id BIGINT UNSIGNED NULL,
    code VARCHAR(60) NOT NULL,
    name VARCHAR(255) NOT NULL,
    is_customer BOOLEAN NOT NULL DEFAULT FALSE,
    is_vendor BOOLEAN NOT NULL DEFAULT FALSE,
    request_status ENUM('PENDING','APPROVED','REJECTED','CANCELLED') NOT NULL DEFAULT 'PENDING',
    requested_payload_json LONGTEXT NOT NULL,
    requested_by_user_id INT NOT NULL,
    decision_comment VARCHAR(500) NULL,
    decided_by_user_id INT NULL,
    created_counterparty_id BIGINT UNSIGNED NULL,
    decided_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_counterparty_requests_tenant_id_id (tenant_id, id),
    KEY ix_counterparty_requests_tenant_entity_status (
      tenant_id,
      legal_entity_id,
      request_status
    ),
    KEY ix_counterparty_requests_tenant_requester_status (
      tenant_id,
      requested_by_user_id,
      request_status
    ),
    KEY ix_counterparty_requests_tenant_primary_ou_status (
      tenant_id,
      primary_operating_unit_id,
      request_status
    ),
    CONSTRAINT fk_counterparty_requests_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_counterparty_requests_entity
      FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES legal_entities(tenant_id, id),
    CONSTRAINT fk_counterparty_requests_primary_ou
      FOREIGN KEY (primary_operating_unit_id) REFERENCES operating_units(id),
    CONSTRAINT fk_counterparty_requests_requester
      FOREIGN KEY (tenant_id, requested_by_user_id) REFERENCES users(tenant_id, id),
    CONSTRAINT fk_counterparty_requests_decider
      FOREIGN KEY (tenant_id, decided_by_user_id) REFERENCES users(tenant_id, id),
    CONSTRAINT fk_counterparty_requests_counterparty
      FOREIGN KEY (tenant_id, legal_entity_id, created_counterparty_id)
      REFERENCES counterparties(tenant_id, legal_entity_id, id),
    CHECK (is_customer OR is_vendor)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const migration160CounterpartyRequestWorkflow = {
  key: "m160_counterparty_request_workflow",
  description:
    "Add branch-submitted counterparty request queue with entity-scoped approval linkage.",
  async up(connection) {
    await safeExecute(connection, createCounterpartyRequestsTableSql);
  },
};

export default migration160CounterpartyRequestWorkflow;
