const ignorableErrnos = new Set([
  1050, // ER_TABLE_EXISTS_ERROR
  1060, // ER_DUP_FIELDNAME
  1061, // ER_DUP_KEYNAME
  1091, // ER_CANT_DROP_FIELD_OR_KEY
  1826, // ER_FK_DUP_NAME
]);

async function safeExecute(connection, sql, params = []) {
  try {
    await connection.execute(sql, params);
  } catch (err) {
    if (ignorableErrnos.has(err?.errno)) {
      return;
    }
    throw err;
  }
}

async function hasColumn(connection, tableName, columnName) {
  const [rows] = await connection.execute(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = ?
       AND column_name = ?
     LIMIT 1`,
    [tableName, columnName]
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function hasForeignKey(connection, tableName, constraintName) {
  const [rows] = await connection.execute(
    `SELECT 1
     FROM information_schema.table_constraints
     WHERE table_schema = DATABASE()
       AND table_name = ?
       AND constraint_name = ?
       AND constraint_type = 'FOREIGN KEY'
     LIMIT 1`,
    [tableName, constraintName]
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function assertColumnExists(connection, tableName, columnName) {
  if (await hasColumn(connection, tableName, columnName)) {
    return;
  }

  throw new Error(
    `m139 requires ${tableName}.${columnName} from m138_fixed_assets_foundation before deferred custodian foreign keys can be attached`
  );
}

const migration139FixedAssetCustodianEmployees = {
  key: "m139_fixed_asset_custodian_employees",
  description:
    "Fixed-asset interim custodian employees and deferred custodian foreign keys (PR-FA11)",
  async up(connection) {
    await safeExecute(
      connection,
      `CREATE TABLE IF NOT EXISTS fixed_asset_custodian_employees (
         id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
         tenant_id BIGINT UNSIGNED NOT NULL,
         legal_entity_id BIGINT UNSIGNED NOT NULL,
         employee_code VARCHAR(100) NOT NULL,
         display_name VARCHAR(255) NOT NULL,
         operating_unit_id BIGINT UNSIGNED NULL,
         status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
         notes VARCHAR(500) NULL,
         created_by_user_id INT NULL,
         updated_by_user_id INT NULL,
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
           ON UPDATE CURRENT_TIMESTAMP,
         UNIQUE KEY uk_face_employee_code
           (tenant_id, legal_entity_id, employee_code),
         KEY ix_face_ou_status
           (tenant_id, legal_entity_id, operating_unit_id, status),
         KEY ix_face_status
           (tenant_id, legal_entity_id, status),
         CONSTRAINT fk_face_tenant
           FOREIGN KEY (tenant_id) REFERENCES tenants(id),
         CONSTRAINT fk_face_legal_entity
           FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES legal_entities(tenant_id, id),
         CONSTRAINT fk_face_operating_unit
           FOREIGN KEY (operating_unit_id) REFERENCES operating_units(id),
         CONSTRAINT fk_face_created_user
           FOREIGN KEY (tenant_id, created_by_user_id) REFERENCES users(tenant_id, id),
         CONSTRAINT fk_face_updated_user
           FOREIGN KEY (tenant_id, updated_by_user_id) REFERENCES users(tenant_id, id)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );

    await assertColumnExists(connection, "fixed_assets", "custodian_employee_id");
    await assertColumnExists(
      connection,
      "fixed_asset_physical_move_details",
      "from_custodian_employee_id"
    );
    await assertColumnExists(
      connection,
      "fixed_asset_physical_move_details",
      "to_custodian_employee_id"
    );

    if (!(await hasForeignKey(connection, "fixed_assets", "fk_fa_custodian_employee"))) {
      await safeExecute(
        connection,
        `ALTER TABLE fixed_assets
         ADD CONSTRAINT fk_fa_custodian_employee
         FOREIGN KEY (custodian_employee_id)
         REFERENCES fixed_asset_custodian_employees(id)`
      );
    }

    if (
      !(await hasForeignKey(
        connection,
        "fixed_asset_physical_move_details",
        "fk_fapmd_from_custodian_employee"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE fixed_asset_physical_move_details
         ADD CONSTRAINT fk_fapmd_from_custodian_employee
         FOREIGN KEY (from_custodian_employee_id)
         REFERENCES fixed_asset_custodian_employees(id)`
      );
    }

    if (
      !(await hasForeignKey(
        connection,
        "fixed_asset_physical_move_details",
        "fk_fapmd_to_custodian_employee"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE fixed_asset_physical_move_details
         ADD CONSTRAINT fk_fapmd_to_custodian_employee
         FOREIGN KEY (to_custodian_employee_id)
         REFERENCES fixed_asset_custodian_employees(id)`
      );
    }
  },
};

export default migration139FixedAssetCustodianEmployees;
