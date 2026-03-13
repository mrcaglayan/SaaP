const IGNORABLE_ERRNOS = new Set([
  1060, // ER_DUP_FIELDNAME
  1061, // ER_DUP_KEYNAME
  1091, // ER_CANT_DROP_FIELD_OR_KEY
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

const migration128CariSettlementOwnerCollectorContexts = {
  key: "m128_cari_settlement_owner_collector_contexts",
  description:
    "Add owner and collector operating-unit context persistence for Cari settlements",
  async up(connection) {
    if (
      !(await hasColumn(connection, "cari_settlement_batches", "owner_operating_unit_id"))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_settlement_batches
         ADD COLUMN owner_operating_unit_id BIGINT UNSIGNED NULL
         AFTER counterparty_id`
      );
    }

    if (
      !(await hasColumn(connection, "cari_settlement_batches", "collector_operating_unit_id"))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_settlement_batches
         ADD COLUMN collector_operating_unit_id BIGINT UNSIGNED NULL
         AFTER owner_operating_unit_id`
      );
    }

    if (
      !(await hasColumn(
        connection,
        "cari_settlement_batches",
        "originating_cross_context_settlement_batch_id"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_settlement_batches
         ADD COLUMN originating_cross_context_settlement_batch_id BIGINT UNSIGNED NULL
         AFTER reversal_of_settlement_batch_id`
      );
    }

    if (
      !(await hasIndex(
        connection,
        "cari_settlement_batches",
        "ix_cari_settle_batches_tenant_entity_owner_date"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_settlement_batches
         ADD KEY ix_cari_settle_batches_tenant_entity_owner_date (
           tenant_id,
           legal_entity_id,
           owner_operating_unit_id,
           settlement_date
         )`
      );
    }

    if (
      !(await hasIndex(
        connection,
        "cari_settlement_batches",
        "ix_cari_settle_batches_tenant_entity_collector_date"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_settlement_batches
         ADD KEY ix_cari_settle_batches_tenant_entity_collector_date (
           tenant_id,
           legal_entity_id,
           collector_operating_unit_id,
           settlement_date
         )`
      );
    }

    if (
      !(await hasIndex(
        connection,
        "cari_settlement_batches",
        "ix_cari_settle_batches_originating_cross_context"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_settlement_batches
         ADD KEY ix_cari_settle_batches_originating_cross_context (
           tenant_id,
           legal_entity_id,
           originating_cross_context_settlement_batch_id
         )`
      );
    }

    if (
      !(await hasForeignKey(
        connection,
        "cari_settlement_batches",
        "fk_cari_settle_owner_operating_unit"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_settlement_batches
         ADD CONSTRAINT fk_cari_settle_owner_operating_unit
           FOREIGN KEY (owner_operating_unit_id) REFERENCES operating_units(id)`
      );
    }

    if (
      !(await hasForeignKey(
        connection,
        "cari_settlement_batches",
        "fk_cari_settle_collector_operating_unit"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_settlement_batches
         ADD CONSTRAINT fk_cari_settle_collector_operating_unit
           FOREIGN KEY (collector_operating_unit_id) REFERENCES operating_units(id)`
      );
    }

    if (
      !(await hasForeignKey(
        connection,
        "cari_settlement_batches",
        "fk_cari_settle_originating_cross_context_batch"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE cari_settlement_batches
         ADD CONSTRAINT fk_cari_settle_originating_cross_context_batch
           FOREIGN KEY (
             tenant_id,
             legal_entity_id,
             originating_cross_context_settlement_batch_id
           ) REFERENCES cari_settlement_batches(tenant_id, legal_entity_id, id)`
      );
    }
  },

  async down() {
    // Non-destructive migration policy: no down-op for additive schema changes.
  },
};

export default migration128CariSettlementOwnerCollectorContexts;
