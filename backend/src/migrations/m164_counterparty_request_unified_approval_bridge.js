/**
 * m164 - Counterparty request unified approval bridge.
 *
 * Adds the generic approval-request linkage used by the CARI pilot so the
 * domain request row can expose review/execution state without replacing the
 * business table itself.
 */

const IGNORABLE_ERRNOS = new Set([
  1060, // ER_DUP_FIELDNAME
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

const migration164CounterpartyRequestUnifiedApprovalBridge = {
  key: "m164_counterparty_request_unified_approval_bridge",
  description:
    "Link counterparty requests to generic approval requests for the CARI approval-engine pilot.",
  async up(connection) {
    await safeExecute(
      connection,
      `ALTER TABLE counterparty_requests
         ADD COLUMN approval_request_id BIGINT UNSIGNED NULL AFTER created_counterparty_id`
    );

    await safeExecute(
      connection,
      `ALTER TABLE counterparty_requests
         ADD KEY ix_counterparty_requests_approval_request (
           tenant_id,
           approval_request_id
         )`
    );

    await safeExecute(
      connection,
      `ALTER TABLE counterparty_requests
         ADD CONSTRAINT fk_counterparty_requests_approval_request
           FOREIGN KEY (approval_request_id) REFERENCES approval_requests(id)
           ON UPDATE RESTRICT ON DELETE RESTRICT`
    );
  },

  async down() {
    // Non-destructive migration policy: no down-op for additive governance schema.
  },
};

export default migration164CounterpartyRequestUnifiedApprovalBridge;
