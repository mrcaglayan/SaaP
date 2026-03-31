/**
 * m157 - Local close-pack reopen requests.
 *
 * Adds a first-class reopen request record so financially relevant reopen
 * actions can be reason-coded, reviewed, and audited without overloading the
 * pack header row itself.
 */

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

const createLocalClosePackReopenRequestsTableSql = `
  CREATE TABLE IF NOT EXISTS local_close_pack_reopen_requests (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    local_close_pack_id BIGINT UNSIGNED NOT NULL,
    legal_entity_id BIGINT UNSIGNED NOT NULL,
    book_id BIGINT UNSIGNED NOT NULL,
    fiscal_period_id BIGINT UNSIGNED NOT NULL,
    close_scope_type ENUM('OPERATING_UNIT','CENTRAL') NOT NULL,
    scope_key VARCHAR(40) NOT NULL,
    operating_unit_id BIGINT UNSIGNED NULL,
    request_status ENUM('REQUESTED','APPROVED','REJECTED','EXECUTED') NOT NULL DEFAULT 'REQUESTED',
    reason_code VARCHAR(80) NOT NULL,
    requested_action_type ENUM(
      'REVERSAL_REQUIRED',
      'LATE_POSTING_REQUIRED',
      'RECLASS_REQUIRED',
      'EVIDENCE_CORRECTION_ONLY',
      'AUDIT_ADJUSTMENT',
      'CONSOLIDATION_FEEDBACK'
    ) NOT NULL,
    explanation VARCHAR(2000) NOT NULL,
    materiality_level ENUM('UNKNOWN','IMMATERIAL','MATERIAL') NOT NULL DEFAULT 'UNKNOWN',
    estimated_impact_note VARCHAR(500) NULL,
    downstream_stage ENUM(
      'ENTITY_NOT_SUBMITTED',
      'ENTITY_SUBMITTED',
      'GROUP_REVIEW',
      'GROUP_PUBLISHED'
    ) NOT NULL DEFAULT 'ENTITY_NOT_SUBMITTED',
    requires_high_governance BOOLEAN NOT NULL DEFAULT FALSE,
    requested_by_user_id INT NOT NULL,
    reviewed_by_user_id INT NULL,
    requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TIMESTAMP NULL,
    decision_note VARCHAR(1000) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY ix_local_close_pack_reopen_requests_pack_status (
      tenant_id,
      local_close_pack_id,
      request_status,
      requested_at
    ),
    KEY ix_local_close_pack_reopen_requests_entity_period (
      tenant_id,
      legal_entity_id,
      book_id,
      fiscal_period_id,
      request_status
    ),
    CONSTRAINT fk_local_close_pack_reopen_requests_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_local_close_pack_reopen_requests_pack
      FOREIGN KEY (local_close_pack_id) REFERENCES local_close_packs(id),
    CONSTRAINT fk_local_close_pack_reopen_requests_entity
      FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES legal_entities(tenant_id, id),
    CONSTRAINT fk_local_close_pack_reopen_requests_book
      FOREIGN KEY (book_id) REFERENCES books(id),
    CONSTRAINT fk_local_close_pack_reopen_requests_period
      FOREIGN KEY (fiscal_period_id) REFERENCES fiscal_periods(id),
    CONSTRAINT fk_local_close_pack_reopen_requests_operating_unit
      FOREIGN KEY (operating_unit_id) REFERENCES operating_units(id),
    CONSTRAINT fk_local_close_pack_reopen_requests_requested_by
      FOREIGN KEY (tenant_id, requested_by_user_id) REFERENCES users(tenant_id, id),
    CONSTRAINT fk_local_close_pack_reopen_requests_reviewed_by
      FOREIGN KEY (tenant_id, reviewed_by_user_id) REFERENCES users(tenant_id, id),
    CHECK (
      (
        close_scope_type = 'OPERATING_UNIT'
        AND operating_unit_id IS NOT NULL
        AND scope_key <> 'CENTRAL'
      )
      OR (
        close_scope_type = 'CENTRAL'
        AND operating_unit_id IS NULL
        AND scope_key = 'CENTRAL'
      )
    )
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const migration157LocalClosePackReopenRequests = {
  key: "m157_local_close_pack_reopen_requests",
  description:
    "Add governed local close-pack reopen requests for late-change control and audit.",
  async up(connection) {
    await safeExecute(connection, createLocalClosePackReopenRequestsTableSql);
  },
};

export default migration157LocalClosePackReopenRequests;
