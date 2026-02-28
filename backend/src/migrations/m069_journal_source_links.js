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
    if (ignorableErrnos.has(Number(err?.errno))) {
      return;
    }
    throw err;
  }
}

const migration069JournalSourceLinks = {
  key: "m069_journal_source_links",
  description: "Journal source-link contract for related panel dependency (RS-DEP-02)",
  async up(connection) {
    await safeExecute(
      connection,
      `CREATE TABLE IF NOT EXISTS journal_source_links (
         id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
         tenant_id BIGINT UNSIGNED NOT NULL,
         legal_entity_id BIGINT UNSIGNED NOT NULL,
         journal_entry_id BIGINT UNSIGNED NOT NULL,
         source_ref_type VARCHAR(80) NOT NULL,
         source_ref_id BIGINT UNSIGNED NOT NULL,
         link_role VARCHAR(40) NOT NULL DEFAULT 'PRIMARY',
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         UNIQUE KEY uk_journal_source_links_scope_unique (
           tenant_id,
           journal_entry_id,
           source_ref_type,
           source_ref_id,
           link_role
         ),
         KEY ix_journal_source_links_scope_journal (tenant_id, journal_entry_id),
         KEY ix_journal_source_links_scope_source (
           tenant_id,
           legal_entity_id,
           source_ref_type,
           source_ref_id
         ),
         KEY ix_journal_source_links_scope_role (tenant_id, link_role),
         CONSTRAINT fk_journal_source_links_tenant
           FOREIGN KEY (tenant_id) REFERENCES tenants(id),
         CONSTRAINT fk_journal_source_links_legal_entity
           FOREIGN KEY (legal_entity_id) REFERENCES legal_entities(id),
         CONSTRAINT fk_journal_source_links_journal
           FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id)
           ON DELETE CASCADE
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
  },

  async down(connection) {
    await safeExecute(connection, `DROP TABLE IF EXISTS journal_source_links`);
  },
};

export default migration069JournalSourceLinks;
