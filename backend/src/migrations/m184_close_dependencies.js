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

const createCloseCycleDependenciesTableSql = `
  CREATE TABLE IF NOT EXISTS close_cycle_dependencies (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    close_cycle_id BIGINT UNSIGNED NOT NULL,
    blocking_item_id BIGINT UNSIGNED NOT NULL,
    dependent_target_type ENUM('ITEM_ACTION','CYCLE_ACTION') NOT NULL,
    dependent_target_key VARCHAR(160) NOT NULL,
    dependent_item_id BIGINT UNSIGNED NULL,
    dependent_action VARCHAR(32) NOT NULL,
    required_blocking_status VARCHAR(32) NOT NULL,
    dependency_code VARCHAR(96) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_close_cycle_dependencies_identity (
      close_cycle_id,
      blocking_item_id,
      dependent_target_type,
      dependent_target_key,
      dependency_code
    ),
    KEY ix_close_cycle_dependencies_item_action (
      dependent_item_id,
      dependent_action,
      required_blocking_status
    ),
    KEY ix_close_cycle_dependencies_cycle_action (
      close_cycle_id,
      dependent_target_type,
      dependent_action
    ),
    KEY ix_close_cycle_dependencies_blocking_item (blocking_item_id),
    CONSTRAINT fk_close_cycle_dependencies_cycle
      FOREIGN KEY (close_cycle_id) REFERENCES close_cycles(id),
    CONSTRAINT fk_close_cycle_dependencies_blocking_item
      FOREIGN KEY (blocking_item_id) REFERENCES close_cycle_items(id),
    CONSTRAINT fk_close_cycle_dependencies_dependent_item
      FOREIGN KEY (dependent_item_id) REFERENCES close_cycle_items(id),
    CHECK (
      (
        dependent_target_type = 'ITEM_ACTION'
        AND dependent_item_id IS NOT NULL
      )
      OR (
        dependent_target_type = 'CYCLE_ACTION'
        AND dependent_item_id IS NULL
      )
    )
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const migration184CloseDependencies = {
  key: "m184_close_dependencies",
  description: "Add explicit close-cycle dependency rows for item actions and future cycle locking.",
  async up(connection) {
    await safeExecute(connection, createCloseCycleDependenciesTableSql);
  },

  async down() {
    // Additive foundation only.
  },
};

export default migration184CloseDependencies;
