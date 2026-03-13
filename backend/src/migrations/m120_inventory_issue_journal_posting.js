const ignorableErrnos = new Set([
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

const migration120InventoryIssueJournalPosting = {
  key: "m120_inventory_issue_journal_posting",
  description: "Link inventory movements to posted and reversal issue journals",
  async up(connection) {
    await safeExecute(
      connection,
      `ALTER TABLE inventory_movements
         ADD COLUMN posted_journal_entry_id BIGINT UNSIGNED NULL
         AFTER valuation_status`
    );
    await safeExecute(
      connection,
      `ALTER TABLE inventory_movements
         ADD COLUMN posted_at TIMESTAMP NULL
         AFTER posted_journal_entry_id`
    );
    await safeExecute(
      connection,
      `ALTER TABLE inventory_movements
         ADD COLUMN reversal_journal_entry_id BIGINT UNSIGNED NULL
         AFTER posted_at`
    );
    await safeExecute(
      connection,
      `ALTER TABLE inventory_movements
         ADD COLUMN reversed_at TIMESTAMP NULL
         AFTER reversal_journal_entry_id`
    );
    await safeExecute(
      connection,
      `ALTER TABLE inventory_movements
         ADD UNIQUE KEY uk_inventory_movements_posted_journal (posted_journal_entry_id)`
    );
    await safeExecute(
      connection,
      `ALTER TABLE inventory_movements
         ADD UNIQUE KEY uk_inventory_movements_reversal_journal (reversal_journal_entry_id)`
    );
    await safeExecute(
      connection,
      `ALTER TABLE inventory_movements
         ADD CONSTRAINT fk_inventory_movements_posted_journal
           FOREIGN KEY (posted_journal_entry_id) REFERENCES journal_entries(id)`
    );
    await safeExecute(
      connection,
      `ALTER TABLE inventory_movements
         ADD CONSTRAINT fk_inventory_movements_reversal_journal
           FOREIGN KEY (reversal_journal_entry_id) REFERENCES journal_entries(id)`
    );
  },

  async down() {
    // Non-destructive migration policy: no down-op for additive schema changes.
  },
};

export default migration120InventoryIssueJournalPosting;
