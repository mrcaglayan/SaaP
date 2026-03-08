import { badRequest, parsePositiveInt } from "../routes/_utils.js";

function normalizeUpperText(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeOptionalShortText(value, fieldLabel, maxLength = 100) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const normalized = String(value).trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length > maxLength) {
    throw badRequest(`${fieldLabel} cannot exceed ${maxLength} characters`);
  }
  return normalized;
}

async function loadOriginalJournalTx(tx, tenantId, journalId) {
  const result = await tx.query(
    `SELECT
       id,
       tenant_id,
       legal_entity_id,
       book_id,
       fiscal_period_id,
       journal_no,
       source_type,
       status,
       entry_date,
       document_date,
       currency_code,
       description,
       reference_no,
       total_debit_base,
       total_credit_base,
       reversal_journal_entry_id
     FROM journal_entries
     WHERE id = ?
       AND tenant_id = ?
     LIMIT 1
     FOR UPDATE`,
    [journalId, tenantId]
  );
  return result.rows?.[0] || null;
}

async function loadOriginalJournalLinesTx(tx, journalId) {
  const result = await tx.query(
    `SELECT
       line_no,
       account_id,
       operating_unit_id,
       counterparty_legal_entity_id,
       description,
       subledger_reference_no,
       currency_code,
       amount_txn,
       debit_base,
       credit_base,
       tax_code
     FROM journal_lines
     WHERE journal_entry_id = ?
     ORDER BY line_no ASC`,
    [journalId]
  );
  return Array.isArray(result.rows) ? result.rows : [];
}

export async function reverseJournalEntryTx(tx, {
  tenantId,
  journalId,
  userId,
  reason,
  reversalPeriodId,
  entryDate,
  documentDate,
  journalNo,
  autoPost = true,
  idempotentOnAlreadyReversed = false,
} = {}) {
  const original = await loadOriginalJournalTx(tx, tenantId, journalId);
  if (!original) {
    throw badRequest("Journal not found");
  }

  const existingReversalJournalId = parsePositiveInt(original.reversal_journal_entry_id);
  if (normalizeUpperText(original.status) === "REVERSED" && existingReversalJournalId) {
    if (idempotentOnAlreadyReversed) {
      return {
        original,
        reversalJournalId: existingReversalJournalId,
        originalUpdated: true,
        idempotentReplay: true,
      };
    }
    throw badRequest("Journal is already reversed");
  }

  if (normalizeUpperText(original.status) !== "POSTED") {
    throw badRequest("Only POSTED journals can be reversed");
  }

  const lines = await loadOriginalJournalLinesTx(tx, journalId);
  if (lines.length === 0) {
    throw badRequest("Journal has no lines to reverse");
  }

  const reversalReason = normalizeOptionalShortText(reason, "reason", 255) || "Manual reversal";
  const reversalJournalNo =
    normalizeOptionalShortText(journalNo, "journalNo", 40) ||
    `${String(original.journal_no || "").trim()}-REV`;
  const reversalEntryDate = entryDate || original.entry_date;
  const reversalDocumentDate = documentDate || original.document_date;

  const reversalResult = await tx.query(
    `INSERT INTO journal_entries (
        tenant_id,
        legal_entity_id,
        book_id,
        fiscal_period_id,
        journal_no,
        source_type,
        status,
        entry_date,
        document_date,
        currency_code,
        description,
        reference_no,
        total_debit_base,
        total_credit_base,
        created_by_user_id,
        posted_by_user_id,
        posted_at,
        reverse_reason
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      parsePositiveInt(tenantId),
      parsePositiveInt(original.legal_entity_id),
      parsePositiveInt(original.book_id),
      parsePositiveInt(reversalPeriodId) || parsePositiveInt(original.fiscal_period_id),
      reversalJournalNo,
      normalizeUpperText(original.source_type || "MANUAL") || "MANUAL",
      autoPost ? "POSTED" : "DRAFT",
      reversalEntryDate,
      reversalDocumentDate,
      normalizeUpperText(original.currency_code || "USD") || "USD",
      `Reversal of ${String(original.journal_no || "").trim()}`.slice(0, 500),
      original.reference_no ? String(original.reference_no) : null,
      Number(original.total_credit_base || 0),
      Number(original.total_debit_base || 0),
      parsePositiveInt(userId),
      autoPost ? parsePositiveInt(userId) : null,
      autoPost ? new Date() : null,
      reversalReason,
    ]
  );

  const reversalJournalId = parsePositiveInt(reversalResult.rows?.insertId);
  if (!reversalJournalId) {
    throw badRequest("Failed to create reversal journal");
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    // eslint-disable-next-line no-await-in-loop
    await tx.query(
      `INSERT INTO journal_lines (
          journal_entry_id,
          line_no,
          account_id,
          operating_unit_id,
          counterparty_legal_entity_id,
          description,
          subledger_reference_no,
          currency_code,
          amount_txn,
          debit_base,
          credit_base,
          tax_code
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        reversalJournalId,
        index + 1,
        parsePositiveInt(line.account_id),
        parsePositiveInt(line.operating_unit_id),
        parsePositiveInt(line.counterparty_legal_entity_id),
        line.description ? String(line.description) : null,
        normalizeOptionalShortText(line.subledger_reference_no, "subledger_reference_no", 100),
        normalizeUpperText(line.currency_code || original.currency_code || "USD") || "USD",
        Number(line.amount_txn || 0) * -1,
        Number(line.credit_base || 0),
        Number(line.debit_base || 0),
        line.tax_code ? String(line.tax_code) : null,
      ]
    );
  }

  let originalUpdated = false;
  if (autoPost) {
    const updateResult = await tx.query(
      `UPDATE journal_entries
       SET status = 'REVERSED',
           reversed_by_user_id = ?,
           reversed_at = CURRENT_TIMESTAMP,
           reversal_journal_entry_id = ?,
           reverse_reason = ?
       WHERE id = ?
         AND tenant_id = ?
         AND status = 'POSTED'
         AND reversal_journal_entry_id IS NULL`,
      [parsePositiveInt(userId), reversalJournalId, reversalReason, journalId, parsePositiveInt(tenantId)]
    );
    originalUpdated = Number(updateResult.rows?.affectedRows || 0) > 0;
    if (!originalUpdated) {
      throw badRequest("Journal is already reversed");
    }
  }

  return {
    original,
    reversalJournalId,
    originalUpdated,
    idempotentReplay: false,
  };
}
