/**
 * m158 - Local close-pack report review fingerprints.
 *
 * Adds the first persisted RP07 evidence fingerprint seam so reviewed local
 * report launches can be tied back to one local close pack before the later
 * export bundle hardening step lands.
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

const createLocalClosePackReportReviewsTableSql = `
  CREATE TABLE IF NOT EXISTS local_close_pack_report_reviews (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    local_close_pack_id BIGINT UNSIGNED NOT NULL,
    report_key VARCHAR(60) NOT NULL,
    route_path VARCHAR(255) NOT NULL,
    launch_mode ENUM('PACK_SCOPE','ENTITY_STATEMENT_FALLBACK') NOT NULL DEFAULT 'PACK_SCOPE',
    query_json JSON NOT NULL,
    response_snapshot_json JSON NOT NULL,
    fingerprint_sha256 CHAR(64) NOT NULL,
    review_note VARCHAR(500) NULL,
    reviewed_by_user_id INT NOT NULL,
    reviewed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_local_close_pack_report_reviews_pack_report (
      tenant_id,
      local_close_pack_id,
      report_key
    ),
    KEY ix_local_close_pack_report_reviews_pack_time (
      tenant_id,
      local_close_pack_id,
      reviewed_at
    ),
    KEY ix_local_close_pack_report_reviews_hash (
      tenant_id,
      fingerprint_sha256
    ),
    CONSTRAINT fk_local_close_pack_report_reviews_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_local_close_pack_report_reviews_pack
      FOREIGN KEY (local_close_pack_id) REFERENCES local_close_packs(id),
    CONSTRAINT fk_local_close_pack_report_reviews_user
      FOREIGN KEY (tenant_id, reviewed_by_user_id) REFERENCES users(tenant_id, id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const migration158LocalClosePackReportReviews = {
  key: "m158_local_close_pack_report_reviews",
  description:
    "Add first-pass local close-pack report review fingerprints for RP07 evidence pack support.",
  async up(connection) {
    await safeExecute(connection, createLocalClosePackReportReviewsTableSql);
  },
};

export default migration158LocalClosePackReportReviews;
