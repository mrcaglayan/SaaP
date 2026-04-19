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

const createCloseStaleEventsTableSql = `
  CREATE TABLE IF NOT EXISTS close_stale_events (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    close_cycle_id BIGINT UNSIGNED NOT NULL,
    close_cycle_item_id BIGINT UNSIGNED NULL,
    source_target_type ENUM('LOCAL_CLOSE_PACK','PERIOD_CLOSE_RUN','CONSOLIDATION_RUN') NULL,
    source_target_id BIGINT UNSIGNED NULL,
    event_code VARCHAR(96) NOT NULL,
    target_stale_status ENUM('FRESH','STALE','STALE_REVIEW_REQUIRED','FINALIZED_BUT_OUTDATED') NOT NULL,
    payload_json JSON NULL,
    created_by_user_id INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY ix_close_stale_events_cycle_created (close_cycle_id, created_at),
    KEY ix_close_stale_events_item_created (close_cycle_item_id, created_at),
    KEY ix_close_stale_events_source_created (source_target_type, source_target_id, created_at),
    CONSTRAINT fk_close_stale_events_cycle
      FOREIGN KEY (close_cycle_id) REFERENCES close_cycles(id),
    CONSTRAINT fk_close_stale_events_item
      FOREIGN KEY (close_cycle_item_id) REFERENCES close_cycle_items(id),
    CONSTRAINT fk_close_stale_events_created_by_user
      FOREIGN KEY (created_by_user_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const migration185CloseStaleEvents = {
  key: "m185_close_stale_events",
  description: "Add close stale-event history so later reopen and unlock flows can propagate freshness changes.",
  async up(connection) {
    await safeExecute(connection, createCloseStaleEventsTableSql);
  },

  async down() {
    // Additive foundation only.
  },
};

export default migration185CloseStaleEvents;
