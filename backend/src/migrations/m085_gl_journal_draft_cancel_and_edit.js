const ignorableErrnos = new Set([
  1060, // ER_DUP_FIELDNAME
  1061, // ER_DUP_KEYNAME
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

const statements = [
  `
  ALTER TABLE journal_entries
    MODIFY COLUMN status ENUM('DRAFT','POSTED','REVERSED','CANCELLED')
      NOT NULL DEFAULT 'DRAFT'
  `,
  `
  ALTER TABLE journal_entries
    ADD COLUMN cancel_reason VARCHAR(500) NULL
      AFTER reverse_reason
  `,
  `
  ALTER TABLE journal_entries
    ADD COLUMN cancelled_by_user_id INT NULL
      AFTER reversed_by_user_id
  `,
  `
  ALTER TABLE journal_entries
    ADD COLUMN cancelled_at TIMESTAMP NULL
      AFTER reversed_at
  `,
  `
  ALTER TABLE journal_entries
    ADD CONSTRAINT fk_journal_cancelled_by
      FOREIGN KEY (cancelled_by_user_id) REFERENCES users(id)
  `,
  `
  ALTER TABLE journal_entries
    ADD KEY ix_journal_entries_tenant_status (tenant_id, status)
  `,
];

const migration085GlJournalDraftCancelAndEdit = {
  key: "m085_gl_journal_draft_cancel_and_edit",
  description:
    "GL journals: allow draft update workflow and draft cancellation with audit metadata",
  async up(connection) {
    for (const statement of statements) {
      await safeExecute(connection, statement);
    }
  },

  async down() {
    // Non-destructive migration policy: no down-op for additive hardening.
  },
};

export default migration085GlJournalDraftCancelAndEdit;
