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

const createCloseCycleItemLinksTableSql = `
  CREATE TABLE IF NOT EXISTS close_cycle_item_links (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    close_cycle_item_id BIGINT UNSIGNED NOT NULL,
    source_target_type ENUM('LOCAL_CLOSE_PACK','PERIOD_CLOSE_RUN','CONSOLIDATION_RUN') NOT NULL,
    source_target_id BIGINT UNSIGNED NOT NULL,
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    superseded_at TIMESTAMP NULL,
    UNIQUE KEY uk_close_cycle_item_links_source (close_cycle_item_id, source_target_type, source_target_id),
    KEY ix_close_cycle_item_links_source_current (source_target_type, source_target_id, is_current),
    KEY ix_close_cycle_item_links_item_current (close_cycle_item_id, is_current),
    CONSTRAINT fk_close_cycle_item_links_item
      FOREIGN KEY (close_cycle_item_id) REFERENCES close_cycle_items(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const migration183CloseCycleItemLinks = {
  key: "m183_close_cycle_item_links",
  description: "Add current-and-historical source links for close cycle items.",
  async up(connection) {
    await safeExecute(connection, createCloseCycleItemLinksTableSql);
  },

  async down() {
    // Additive foundation only.
  },
};

export default migration183CloseCycleItemLinks;
