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

const migration140FixedAssetCariCapitalizationAndTraceability = {
  key: "m140_fixed_asset_cari_capitalization_and_traceability",
  description:
    "Fixed-asset CARI source traceability, unit-slot provenance FKs, and journal_source_links one-PRIMARY-per-journal hardening (PR-FA12)",
  async up(connection) {
    // ══════════════════════════════════════════════════════════════════
    // 1. CARI source-document foreign keys on fixed_assets
    // ══════════════════════════════════════════════════════════════════
    // Columns source_cari_document_id, source_cari_document_line_id,
    // and source_cari_document_line_unit_no already exist from m138.
    // The unique key uk_fa_cari_provenance already exists from m138.
    // m140 adds the referential integrity FKs to cari_documents and
    // cari_document_lines now that both are confirmed present.

    if (
      !(await hasForeignKey(
        connection,
        "fixed_assets",
        "fk_fa_source_cari_document"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE fixed_assets
         ADD CONSTRAINT fk_fa_source_cari_document
         FOREIGN KEY (source_cari_document_id)
         REFERENCES cari_documents(id)`
      );
    }

    if (
      !(await hasForeignKey(
        connection,
        "fixed_assets",
        "fk_fa_source_cari_document_line"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE fixed_assets
         ADD CONSTRAINT fk_fa_source_cari_document_line
         FOREIGN KEY (source_cari_document_line_id)
         REFERENCES cari_document_lines(id)`
      );
    }

    // Counterparty FK (nullable, for vendor/customer linkage on asset)
    if (
      !(await hasForeignKey(
        connection,
        "fixed_assets",
        "fk_fa_counterparty"
      ))
    ) {
      await safeExecute(
        connection,
        `ALTER TABLE fixed_assets
         ADD CONSTRAINT fk_fa_counterparty
         FOREIGN KEY (counterparty_id)
         REFERENCES counterparties(id)`
      );
    }

    // ══════════════════════════════════════════════════════════════════
    // 2. Source-ref lookup indexes on fixed_asset_transactions
    // ══════════════════════════════════════════════════════════════════
    // source_ref_type/source_ref_id/source_ref_line_id are polymorphic
    // columns already created in m138. We cannot add FK constraints on
    // polymorphic refs, but we add indexes for reverse lookups
    // (e.g. "which FA transactions reference CARI doc X?").

    if (!(await hasIndex(connection, "fixed_asset_transactions", "ix_fat_source_ref"))) {
      await safeExecute(
        connection,
        `ALTER TABLE fixed_asset_transactions
         ADD KEY ix_fat_source_ref
           (tenant_id, source_ref_type, source_ref_id)`
      );
    }

    if (!(await hasIndex(connection, "fixed_asset_transactions", "ix_fat_source_ref_line"))) {
      await safeExecute(
        connection,
        `ALTER TABLE fixed_asset_transactions
         ADD KEY ix_fat_source_ref_line
           (tenant_id, source_ref_type, source_ref_id, source_ref_line_id)`
      );
    }

    // ══════════════════════════════════════════════════════════════════
    // 3. Source-line provenance index on fixed_assets
    // ══════════════════════════════════════════════════════════════════
    // Supports efficient lookup of all assets created from a specific
    // CARI document line (for remaining-unit-slot eligibility queries).

    if (!(await hasIndex(connection, "fixed_assets", "ix_fa_cari_line_provenance"))) {
      await safeExecute(
        connection,
        `ALTER TABLE fixed_assets
         ADD KEY ix_fa_cari_line_provenance
           (tenant_id, source_cari_document_line_id, source_cari_document_line_unit_no)`
      );
    }

    // ══════════════════════════════════════════════════════════════════
    // 4. journal_source_links: one-PRIMARY-per-journal hardening
    // ══════════════════════════════════════════════════════════════════
    // MySQL does not support partial unique indexes. Strategy: add a
    // generated STORED column that is 0 when link_role = 'PRIMARY'
    // and NULL otherwise. A unique key on (journal_entry_id, <guard>)
    // then enforces at most one PRIMARY per journal because MySQL
    // treats NULLs as distinct in unique indexes, so only rows where
    // the guard is 0 (i.e. PRIMARY) will collide.
    //
    // Prerequisite: STEP-FA02 through STEP-FA05 must have already
    // normalized any legacy duplicate-PRIMARY rows and brought all
    // existing writer modules into one-owning-link compliance.

    if (!(await hasColumn(connection, "journal_source_links", "primary_guard"))) {
      await safeExecute(
        connection,
        `ALTER TABLE journal_source_links
         ADD COLUMN primary_guard TINYINT UNSIGNED
           GENERATED ALWAYS AS (IF(link_role = 'PRIMARY', 0, NULL)) STORED`
      );
    }

    if (!(await hasIndex(connection, "journal_source_links", "uk_jsl_one_primary_per_journal"))) {
      await safeExecute(
        connection,
        `ALTER TABLE journal_source_links
         ADD UNIQUE KEY uk_jsl_one_primary_per_journal
           (journal_entry_id, primary_guard)`
      );
    }
  },
};

export default migration140FixedAssetCariCapitalizationAndTraceability;
