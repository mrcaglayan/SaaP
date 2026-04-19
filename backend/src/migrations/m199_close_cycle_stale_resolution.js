/**
 * m199 - Close cycle stale-resolution metadata.
 *
 * Adds additive columns so close-cycle items can treat stale as a current-state
 * flag while preserving the historical audit trail in close_stale_events.
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

const migration199CloseCycleStaleResolution = {
  key: "m199_close_cycle_stale_resolution",
  description:
    "Add stale resolution timestamps and actor metadata for close-cycle items.",
  async up(connection) {
    await safeExecute(
      connection,
      `ALTER TABLE close_cycle_items
       ADD COLUMN stale_resolved_at TIMESTAMP NULL AFTER stale_status`
    );
    await safeExecute(
      connection,
      `ALTER TABLE close_cycle_items
       ADD COLUMN stale_resolved_by_user_id INT NULL AFTER stale_resolved_at`
    );
    await safeExecute(
      connection,
      `ALTER TABLE close_cycle_items
       ADD CONSTRAINT fk_close_cycle_items_stale_resolved_by_user
         FOREIGN KEY (stale_resolved_by_user_id) REFERENCES users(id)`
    );
  },

  async down() {
    // Additive metadata only.
  },
};

export default migration199CloseCycleStaleResolution;
