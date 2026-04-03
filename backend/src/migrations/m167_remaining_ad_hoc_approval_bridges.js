/**
 * m167 - Remaining ad-hoc approval bridges.
 *
 * Links the remaining business tables that still owned ad-hoc approval flows to
 * the generic approval request table. The business rows remain authoritative for
 * module state and audit, while the approval_requests row becomes the
 * authoritative review/execution envelope.
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

const migration167RemainingAdHocApprovalBridges = {
  key: "m167_remaining_ad_hoc_approval_bridges",
  description:
    "Link remaining ad-hoc approval business rows to generic approval requests.",
  async up(connection) {
    await safeExecute(
      connection,
      `ALTER TABLE payment_batches
         ADD COLUMN approval_request_id BIGINT UNSIGNED NULL
         AFTER governance_approval_request_id`
    );
    await safeExecute(
      connection,
      `ALTER TABLE payment_batches
         ADD KEY ix_payment_batches_approval_request (tenant_id, approval_request_id)`
    );
    await safeExecute(
      connection,
      `ALTER TABLE payment_batches
         ADD CONSTRAINT fk_payment_batches_approval_request
           FOREIGN KEY (approval_request_id) REFERENCES approval_requests(id)
           ON UPDATE RESTRICT ON DELETE RESTRICT`
    );

    await safeExecute(
      connection,
      `ALTER TABLE payroll_liability_override_requests
         ADD COLUMN approval_request_id BIGINT UNSIGNED NULL
         AFTER applied_settlement_id`
    );
    await safeExecute(
      connection,
      `ALTER TABLE payroll_liability_override_requests
         ADD KEY ix_payroll_override_requests_approval_request (
           tenant_id,
           legal_entity_id,
           approval_request_id
         )`
    );
    await safeExecute(
      connection,
      `ALTER TABLE payroll_liability_override_requests
         ADD CONSTRAINT fk_payroll_override_requests_approval_request
           FOREIGN KEY (approval_request_id) REFERENCES approval_requests(id)
           ON UPDATE RESTRICT ON DELETE RESTRICT`
    );

    await safeExecute(
      connection,
      `ALTER TABLE inventory_transfers
         ADD COLUMN approval_request_id BIGINT UNSIGNED NULL
         AFTER approved_by_user_id`
    );
    await safeExecute(
      connection,
      `ALTER TABLE inventory_transfers
         ADD KEY ix_inventory_transfers_approval_request (tenant_id, approval_request_id)`
    );
    await safeExecute(
      connection,
      `ALTER TABLE inventory_transfers
         ADD CONSTRAINT fk_inventory_transfers_approval_request
           FOREIGN KEY (approval_request_id) REFERENCES approval_requests(id)
           ON UPDATE RESTRICT ON DELETE RESTRICT`
    );

    await safeExecute(
      connection,
      `ALTER TABLE local_close_pack_reopen_requests
         ADD COLUMN approval_request_id BIGINT UNSIGNED NULL
         AFTER decision_note`
    );
    await safeExecute(
      connection,
      `ALTER TABLE local_close_pack_reopen_requests
         ADD KEY ix_local_close_pack_reopen_approval_request (
           tenant_id,
           approval_request_id
         )`
    );
    await safeExecute(
      connection,
      `ALTER TABLE local_close_pack_reopen_requests
         ADD CONSTRAINT fk_local_close_pack_reopen_approval_request
           FOREIGN KEY (approval_request_id) REFERENCES approval_requests(id)
           ON UPDATE RESTRICT ON DELETE RESTRICT`
    );
  },

  async down() {
    // Non-destructive migration policy: no down-op for additive governance schema.
  },
};

export default migration167RemainingAdHocApprovalBridges;
