/**
 * m156 - Local close-pack header domain and workflow-engine extension.
 *
 * Adds the baseline local_close_packs header table and extends the generic
 * workflow enums so local close packs can reuse workflow definitions,
 * assignments, and runtime instances as a first-class process family.
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

async function enumColumnIncludesValue(connection, tableName, columnName, enumValue) {
  const [rows] = await connection.execute(
    `SELECT COLUMN_TYPE AS column_type
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name = ?
      LIMIT 1`,
    [tableName, columnName]
  );
  const columnType = String(rows?.[0]?.column_type || "").toUpperCase();
  return columnType.includes(`'${String(enumValue || "").trim().toUpperCase()}'`);
}

const createLocalClosePacksTableSql = `
  CREATE TABLE IF NOT EXISTS local_close_packs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT UNSIGNED NOT NULL,
    legal_entity_id BIGINT UNSIGNED NOT NULL,
    book_id BIGINT UNSIGNED NOT NULL,
    fiscal_period_id BIGINT UNSIGNED NOT NULL,
    close_scope_type ENUM('OPERATING_UNIT','CENTRAL') NOT NULL,
    scope_key VARCHAR(40) NOT NULL,
    operating_unit_id BIGINT UNSIGNED NULL,
    status ENUM(
      'NOT_OPENED',
      'OPEN',
      'IN_PROGRESS',
      'READY_FOR_REVIEW',
      'RETURNED',
      'APPROVED',
      'LOCKED',
      'REOPENED',
      'SUPERSEDED'
    ) NOT NULL DEFAULT 'NOT_OPENED',
    note VARCHAR(1000) NULL,
    owner_user_id INT NULL,
    reviewer_user_id INT NULL,
    workflow_instance_id BIGINT UNSIGNED NULL,
    submitted_at TIMESTAMP NULL,
    approved_at TIMESTAMP NULL,
    locked_at TIMESTAMP NULL,
    reopened_at TIMESTAMP NULL,
    created_by_user_id INT NOT NULL,
    updated_by_user_id INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_local_close_packs_scope (
      tenant_id,
      book_id,
      fiscal_period_id,
      scope_key
    ),
    UNIQUE KEY uk_local_close_packs_workflow_instance (workflow_instance_id),
    KEY ix_local_close_packs_entity_period_status (
      tenant_id,
      legal_entity_id,
      fiscal_period_id,
      status
    ),
    KEY ix_local_close_packs_book_scope_status (
      tenant_id,
      book_id,
      close_scope_type,
      operating_unit_id,
      status
    ),
    CONSTRAINT fk_local_close_packs_tenant
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_local_close_packs_entity
      FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES legal_entities(tenant_id, id),
    CONSTRAINT fk_local_close_packs_book
      FOREIGN KEY (book_id) REFERENCES books(id),
    CONSTRAINT fk_local_close_packs_period
      FOREIGN KEY (fiscal_period_id) REFERENCES fiscal_periods(id),
    CONSTRAINT fk_local_close_packs_operating_unit
      FOREIGN KEY (operating_unit_id) REFERENCES operating_units(id),
    CONSTRAINT fk_local_close_packs_owner_user
      FOREIGN KEY (tenant_id, owner_user_id) REFERENCES users(tenant_id, id),
    CONSTRAINT fk_local_close_packs_reviewer_user
      FOREIGN KEY (tenant_id, reviewer_user_id) REFERENCES users(tenant_id, id),
    CONSTRAINT fk_local_close_packs_workflow_instance
      FOREIGN KEY (workflow_instance_id) REFERENCES workflow_instances(id),
    CONSTRAINT fk_local_close_packs_created_by_user
      FOREIGN KEY (tenant_id, created_by_user_id) REFERENCES users(tenant_id, id),
    CONSTRAINT fk_local_close_packs_updated_by_user
      FOREIGN KEY (tenant_id, updated_by_user_id) REFERENCES users(tenant_id, id),
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

const migration156LocalClosePacks = {
  key: "m156_local_close_packs",
  description:
    "Add local close-pack header tables and extend workflow enums for LOCAL_CLOSE_PACK.",
  async up(connection) {
    if (
      !(await enumColumnIncludesValue(
        connection,
        "workflow_definitions",
        "process_type",
        "LOCAL_CLOSE_PACK"
      ))
    ) {
      await connection.execute(
        `ALTER TABLE workflow_definitions
           MODIFY COLUMN process_type ENUM(
             'PERIOD_CLOSE',
             'CONSOLIDATION_RUN',
             'LOCAL_CLOSE_PACK'
           ) NOT NULL`
      );
    }

    if (
      !(await enumColumnIncludesValue(
        connection,
        "workflow_assignments",
        "process_type",
        "LOCAL_CLOSE_PACK"
      ))
    ) {
      await connection.execute(
        `ALTER TABLE workflow_assignments
           MODIFY COLUMN process_type ENUM(
             'PERIOD_CLOSE',
             'CONSOLIDATION_RUN',
             'LOCAL_CLOSE_PACK'
           ) NOT NULL`
      );
    }

    if (
      !(await enumColumnIncludesValue(
        connection,
        "workflow_instances",
        "process_type",
        "LOCAL_CLOSE_PACK"
      ))
    ) {
      await connection.execute(
        `ALTER TABLE workflow_instances
           MODIFY COLUMN process_type ENUM(
             'PERIOD_CLOSE',
             'CONSOLIDATION_RUN',
             'LOCAL_CLOSE_PACK'
           ) NOT NULL`
      );
    }

    if (
      !(await enumColumnIncludesValue(
        connection,
        "workflow_instances",
        "target_type",
        "LOCAL_CLOSE_PACK"
      ))
    ) {
      await connection.execute(
        `ALTER TABLE workflow_instances
           MODIFY COLUMN target_type ENUM(
             'PERIOD_CLOSE_RUN',
             'CONSOLIDATION_RUN',
             'LOCAL_CLOSE_PACK'
           ) NOT NULL`
      );
    }

    await safeExecute(connection, createLocalClosePacksTableSql);
  },
};

export default migration156LocalClosePacks;
