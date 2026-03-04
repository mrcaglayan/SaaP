const ignorableErrnos = new Set([
  1050, // ER_TABLE_EXISTS_ERROR
  1060, // ER_DUP_FIELDNAME
  1061, // ER_DUP_KEYNAME
  1091, // ER_CANT_DROP_FIELD_OR_KEY
  1826, // ER_FK_DUP_NAME
  3815, // ER_CHECK_CONSTRAINT_VIOLATED (during re-apply attempts)
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

const migration095CashFxRevaluationReversalHardening = {
  key: "m095_cash_fx_revaluation_reversal_hardening",
  description:
    "Add cash FX revaluation reversal linkage/status columns and constraints for close-cycle hardening",
  async up(connection) {
    await safeExecute(
      connection,
      `ALTER TABLE cash_fx_revaluation_runs
         ADD COLUMN reversed_by_run_id BIGINT UNSIGNED NULL
           AFTER reversal_journal_entry_id`
    );

    await safeExecute(
      connection,
      `ALTER TABLE cash_fx_revaluation_runs
         ADD COLUMN reversal_status ENUM(
           'PENDING',
           'POSTED',
           'NOT_REQUIRED',
           'BLOCKED_HARD_CLOSED'
         ) NOT NULL DEFAULT 'PENDING'
           AFTER reversed_by_run_id`
    );

    await safeExecute(
      connection,
      `ALTER TABLE cash_fx_revaluation_runs
         ADD KEY ix_cash_fx_reval_reversal_status (
           tenant_id,
           book_id,
           reversal_status,
           period_end_date
         )`
    );

    await safeExecute(
      connection,
      `ALTER TABLE cash_fx_revaluation_runs
         ADD CONSTRAINT fk_cash_fx_reval_run_reversed_by
           FOREIGN KEY (reversed_by_run_id) REFERENCES cash_fx_revaluation_runs(id)`
    );

    await safeExecute(
      connection,
      `ALTER TABLE cash_fx_revaluation_runs
         ADD CONSTRAINT chk_cash_fx_reval_run_reversal_status_link
           CHECK (
             (reversal_status = 'POSTED' AND reversal_journal_entry_id IS NOT NULL) OR
             (reversal_status <> 'POSTED' AND reversal_journal_entry_id IS NULL)
           )`
    );

    await safeExecute(
      connection,
      `UPDATE cash_fx_revaluation_runs
       SET reversal_status = CASE
         WHEN journal_entry_id IS NULL THEN 'NOT_REQUIRED'
         WHEN reversal_journal_entry_id IS NOT NULL THEN 'POSTED'
         ELSE 'PENDING'
       END`
    );
  },
};

export default migration095CashFxRevaluationReversalHardening;
