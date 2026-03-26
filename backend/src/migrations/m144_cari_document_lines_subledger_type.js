/**
 * m144 - CARI document-line subledger foundation for Track 39.
 *
 * Adds subledger-aware line columns on cari_document_lines, persisted
 * fixed-asset mode disambiguation, expanded-line per-unit metadata,
 * improvement payload fields, and SALE reversal status snapshot support on
 * fixed_asset_transactions. This is additive only: existing rows are left
 * untouched and rely on DEFAULT/NULL behavior.
 */

const ignorableErrnos = new Set([
  1060, // ER_DUP_FIELDNAME
  1061, // ER_DUP_KEYNAME
  1826, // ER_FK_DUP_NAME
  3822, // ER_CHECK_CONSTRAINT_DUP_NAME
]);

const CHECK_CONSTRAINT_FA_MODE_REQUIRED =
  "chk_cari_doc_lines_fa_mode_required";
const CHECK_CONSTRAINT_FA_AUTO_CREATE_CATEGORY =
  "chk_cari_doc_lines_fa_auto_create_category";
const CHECK_CONSTRAINT_FA_TARGET_REQUIRED =
  "chk_cari_doc_lines_fa_target_required";
const CHECK_CONSTRAINT_IMPROVEMENT_LIFE_EXCLUSIVE =
  "chk_cari_doc_lines_improvement_life_exclusive";

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

async function hasIndex(connection, tableName, indexName) {
  const [rows] = await connection.execute(
    `SELECT 1
       FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND index_name = ?
      LIMIT 1`,
    [tableName, indexName]
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function hasCheckConstraint(connection, tableName, constraintName) {
  const [rows] = await connection.execute(
    `SELECT 1
       FROM information_schema.table_constraints
      WHERE constraint_schema = DATABASE()
        AND table_name = ?
        AND constraint_type = 'CHECK'
        AND constraint_name = ?
      LIMIT 1`,
    [tableName, constraintName]
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function addColumnIfMissing(connection, tableName, columnName, definitionSql) {
  if (await hasColumn(connection, tableName, columnName)) {
    return;
  }
  await safeExecute(
    connection,
    `ALTER TABLE ${tableName} ADD COLUMN ${definitionSql}`
  );
}

const migration144CariDocumentLinesSubledgerType = {
  key: "m144_cari_document_lines_subledger_type",
  description:
    "Add subledger-aware line columns, persisted fixed-asset mode, " +
    "improvement payload fields, and pre-disposal status snapshot support.",
  async up(connection) {
    await addColumnIfMissing(
      connection,
      "cari_document_lines",
      "subledger_type",
      `subledger_type ENUM('NONE','STOCK','FIXED_ASSET')
         NOT NULL DEFAULT 'NONE'
         AFTER stock_impact_mode`
    );
    await addColumnIfMissing(
      connection,
      "cari_document_lines",
      "target_fixed_asset_id",
      `target_fixed_asset_id BIGINT UNSIGNED NULL
         AFTER subledger_type`
    );
    await addColumnIfMissing(
      connection,
      "cari_document_lines",
      "fixed_asset_category_id",
      `fixed_asset_category_id BIGINT UNSIGNED NULL
         AFTER target_fixed_asset_id`
    );
    await addColumnIfMissing(
      connection,
      "cari_document_lines",
      "fixed_asset_owner_operating_unit_id",
      `fixed_asset_owner_operating_unit_id BIGINT UNSIGNED NULL
         AFTER fixed_asset_category_id`
    );
    await addColumnIfMissing(
      connection,
      "cari_document_lines",
      "fixed_asset_location_operating_unit_id",
      `fixed_asset_location_operating_unit_id BIGINT UNSIGNED NULL
         AFTER fixed_asset_owner_operating_unit_id`
    );
    await addColumnIfMissing(
      connection,
      "cari_document_lines",
      "fixed_asset_mode",
      `fixed_asset_mode ENUM('AUTO_CREATE','LINK_EXISTING','IMPROVE_EXISTING')
         NULL
         AFTER fixed_asset_location_operating_unit_id`
    );
    await addColumnIfMissing(
      connection,
      "cari_document_lines",
      "fixed_asset_name_override",
      `fixed_asset_name_override VARCHAR(255) NULL
         AFTER fixed_asset_mode`
    );
    await addColumnIfMissing(
      connection,
      "cari_document_lines",
      "fixed_asset_serial_no",
      `fixed_asset_serial_no VARCHAR(100) NULL
         AFTER fixed_asset_name_override`
    );
    await addColumnIfMissing(
      connection,
      "cari_document_lines",
      "fixed_asset_tag",
      `fixed_asset_tag VARCHAR(100) NULL
         AFTER fixed_asset_serial_no`
    );
    await addColumnIfMissing(
      connection,
      "cari_document_lines",
      "improvement_revised_useful_life_months",
      `improvement_revised_useful_life_months INT UNSIGNED NULL
         AFTER fixed_asset_tag`
    );
    await addColumnIfMissing(
      connection,
      "cari_document_lines",
      "improvement_life_extension_months",
      `improvement_life_extension_months INT UNSIGNED NULL
         AFTER improvement_revised_useful_life_months`
    );

    await addColumnIfMissing(
      connection,
      "fixed_asset_transactions",
      "pre_disposal_status",
      `pre_disposal_status ENUM('ACTIVE','SUSPENDED','FULLY_DEPRECIATED')
         NULL
         AFTER proceeds_amount_base`
    );

    if (
      !(await hasForeignKey(
        connection,
        "cari_document_lines",
        "fk_cari_doc_lines_target_fixed_asset"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_document_lines
         ADD CONSTRAINT fk_cari_doc_lines_target_fixed_asset
         FOREIGN KEY (target_fixed_asset_id)
         REFERENCES fixed_assets(id)`
      );
    }

    if (
      !(await hasForeignKey(
        connection,
        "cari_document_lines",
        "fk_cari_doc_lines_fixed_asset_category"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_document_lines
         ADD CONSTRAINT fk_cari_doc_lines_fixed_asset_category
         FOREIGN KEY (fixed_asset_category_id)
         REFERENCES fixed_asset_categories(id)`
      );
    }

    if (
      !(await hasForeignKey(
        connection,
        "cari_document_lines",
        "fk_cari_doc_lines_fixed_asset_owner_ou"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_document_lines
         ADD CONSTRAINT fk_cari_doc_lines_fixed_asset_owner_ou
         FOREIGN KEY (fixed_asset_owner_operating_unit_id)
         REFERENCES operating_units(id)`
      );
    }

    if (
      !(await hasForeignKey(
        connection,
        "cari_document_lines",
        "fk_cari_doc_lines_fixed_asset_location_ou"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_document_lines
         ADD CONSTRAINT fk_cari_doc_lines_fixed_asset_location_ou
         FOREIGN KEY (fixed_asset_location_operating_unit_id)
         REFERENCES operating_units(id)`
      );
    }

    if (
      !(await hasCheckConstraint(
        connection,
        "cari_document_lines",
        CHECK_CONSTRAINT_FA_MODE_REQUIRED
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_document_lines
         ADD CONSTRAINT ${CHECK_CONSTRAINT_FA_MODE_REQUIRED}
         CHECK (
           subledger_type <> 'FIXED_ASSET'
           OR fixed_asset_mode IS NOT NULL
         )`
      );
    }

    if (
      !(await hasCheckConstraint(
        connection,
        "cari_document_lines",
        CHECK_CONSTRAINT_FA_AUTO_CREATE_CATEGORY
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_document_lines
         ADD CONSTRAINT ${CHECK_CONSTRAINT_FA_AUTO_CREATE_CATEGORY}
         CHECK (
           fixed_asset_mode IS NULL
           OR fixed_asset_mode <> 'AUTO_CREATE'
           OR fixed_asset_category_id IS NOT NULL
         )`
      );
    }

    if (
      !(await hasCheckConstraint(
        connection,
        "cari_document_lines",
        CHECK_CONSTRAINT_FA_TARGET_REQUIRED
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_document_lines
         ADD CONSTRAINT ${CHECK_CONSTRAINT_FA_TARGET_REQUIRED}
         CHECK (
           fixed_asset_mode IS NULL
           OR fixed_asset_mode = 'AUTO_CREATE'
           OR target_fixed_asset_id IS NOT NULL
         )`
      );
    }

    if (
      !(await hasCheckConstraint(
        connection,
        "cari_document_lines",
        CHECK_CONSTRAINT_IMPROVEMENT_LIFE_EXCLUSIVE
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_document_lines
         ADD CONSTRAINT ${CHECK_CONSTRAINT_IMPROVEMENT_LIFE_EXCLUSIVE}
         CHECK (
           improvement_revised_useful_life_months IS NULL
           OR improvement_life_extension_months IS NULL
         )`
      );
    }

    if (
      !(await hasIndex(
        connection,
        "cari_document_lines",
        "ix_cari_doc_lines_tenant_target_fa"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_document_lines
         ADD KEY ix_cari_doc_lines_tenant_target_fa
           (tenant_id, target_fixed_asset_id)`
      );
    }

    if (
      !(await hasIndex(
        connection,
        "cari_document_lines",
        "ix_cari_doc_lines_tenant_fa_category"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_document_lines
         ADD KEY ix_cari_doc_lines_tenant_fa_category
           (tenant_id, fixed_asset_category_id)`
      );
    }
  },
};

export default migration144CariDocumentLinesSubledgerType;
