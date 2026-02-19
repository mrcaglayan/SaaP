import express from "express";
import crypto from "node:crypto";
import { query, withTransaction } from "../db.js";
import {
  assertScopeAccess,
  buildScopeFilter,
  requirePermission,
} from "../middleware/rbac.js";
import {
  assertAccountBelongsToTenant,
  assertBookBelongsToTenant,
  assertCoaBelongsToTenant,
  assertFiscalCalendarBelongsToTenant,
  assertFiscalPeriodBelongsToCalendar,
  assertLegalEntityBelongsToTenant,
} from "../tenantGuards.js";
import {
  asyncHandler,
  assertRequiredFields,
  badRequest,
  parsePositiveInt,
  resolveTenantId,
} from "./_utils.js";

const router = express.Router();
const PERIOD_STATUSES = new Set(["OPEN", "SOFT_CLOSED", "HARD_CLOSED"]);
const CLOSE_RUN_STATUSES = new Set(["IN_PROGRESS", "COMPLETED", "FAILED", "REOPENED"]);
const CLOSE_TARGET_STATUSES = new Set(["SOFT_CLOSED", "HARD_CLOSED"]);
const BALANCE_EPSILON = 0.0001;

function toAmount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toIsoDate(value, fieldLabel = "date") {
  const toLocalYyyyMmDd = (date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
      date.getDate()
    ).padStart(2, "0")}`;

  if (value === undefined || value === null || value === "") {
    throw badRequest(`${fieldLabel} is required`);
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw badRequest(`${fieldLabel} must be a valid date`);
    }
    return toLocalYyyyMmDd(value);
  }

  const asString = String(value).trim();
  if (!asString) {
    throw badRequest(`${fieldLabel} must be a valid date`);
  }

  const yyyyMmDdMatch = asString.match(/^(\d{4}-\d{2}-\d{2})/);
  if (yyyyMmDdMatch?.[1]) {
    return yyyyMmDdMatch[1];
  }

  const parsed = new Date(asString);
  if (Number.isNaN(parsed.getTime())) {
    throw badRequest(`${fieldLabel} must be a valid date`);
  }
  return toLocalYyyyMmDd(parsed);
}

function generateJournalNo() {
  const stamp = Date.now();
  const rand = Math.floor(Math.random() * 1000);
  return `JRN-${stamp}-${rand}`;
}

async function resolveScopeFromBookId(bookId, tenantId) {
  const parsedBookId = parsePositiveInt(bookId);
  if (!parsedBookId) {
    return { scopeType: "TENANT", scopeId: tenantId };
  }

  const result = await query(
    `SELECT legal_entity_id
     FROM books
     WHERE id = ?
       AND tenant_id = ?
     LIMIT 1`,
    [parsedBookId, tenantId]
  );

  const legalEntityId = parsePositiveInt(result.rows[0]?.legal_entity_id);
  if (legalEntityId) {
    return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
  }

  return { scopeType: "TENANT", scopeId: tenantId };
}

async function resolveScopeFromJournalId(journalId, tenantId) {
  const parsedJournalId = parsePositiveInt(journalId);
  if (!parsedJournalId) {
    return { scopeType: "TENANT", scopeId: tenantId };
  }

  const result = await query(
    `SELECT legal_entity_id
     FROM journal_entries
     WHERE id = ?
       AND tenant_id = ?
     LIMIT 1`,
    [parsedJournalId, tenantId]
  );

  const legalEntityId = parsePositiveInt(result.rows[0]?.legal_entity_id);
  if (legalEntityId) {
    return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
  }

  return { scopeType: "TENANT", scopeId: tenantId };
}

async function getEffectivePeriodStatus(bookId, fiscalPeriodId, runQuery = query) {
  const result = await runQuery(
    `SELECT status
     FROM period_statuses
     WHERE book_id = ?
       AND fiscal_period_id = ?
     LIMIT 1`,
    [bookId, fiscalPeriodId]
  );

  return String(result.rows[0]?.status || "OPEN").toUpperCase();
}

async function ensurePeriodOpen(bookId, fiscalPeriodId, actionLabel) {
  const status = await getEffectivePeriodStatus(bookId, fiscalPeriodId);
  if (status !== "OPEN") {
    throw badRequest(`Period is ${status}; cannot ${actionLabel}`);
  }
}

async function loadJournal(tenantId, journalId) {
  const result = await query(
    `SELECT id, tenant_id, legal_entity_id, book_id, fiscal_period_id, journal_no, source_type, status,
            entry_date, document_date, currency_code, description, reference_no,
            total_debit_base, total_credit_base, created_by_user_id, posted_by_user_id,
            posted_at, reversed_by_user_id, reversed_at, reverse_reason,
            reversal_journal_entry_id, created_at, updated_at
     FROM journal_entries
     WHERE id = ?
       AND tenant_id = ?
     LIMIT 1`,
    [journalId, tenantId]
  );
  return result.rows[0] || null;
}

function isNearlyZero(value) {
  return Math.abs(Number(value || 0)) < BALANCE_EPSILON;
}

function normalizeCloseTargetStatus(value) {
  const status = String(value || "SOFT_CLOSED").toUpperCase();
  if (!CLOSE_TARGET_STATUSES.has(status)) {
    throw badRequest("closeStatus must be SOFT_CLOSED or HARD_CLOSED");
  }
  return status;
}

function parseJsonColumn(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value === "object") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function mapPeriodCloseRunRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    bookId: parsePositiveInt(row.book_id),
    bookCode: row.book_code || null,
    bookName: row.book_name || null,
    fiscalPeriodId: parsePositiveInt(row.fiscal_period_id),
    nextFiscalPeriodId: parsePositiveInt(row.next_fiscal_period_id),
    fiscalYear: row.fiscal_year === null ? null : Number(row.fiscal_year),
    periodNo: row.period_no === null ? null : Number(row.period_no),
    periodName: row.period_name || null,
    closeStatus: String(row.close_status || "").toUpperCase(),
    status: String(row.status || "").toUpperCase(),
    runHash: String(row.run_hash || ""),
    yearEndClosed: Boolean(row.year_end_closed),
    retainedEarningsAccountId: parsePositiveInt(row.retained_earnings_account_id),
    carryForwardJournalEntryId: parsePositiveInt(row.carry_forward_journal_entry_id),
    yearEndJournalEntryId: parsePositiveInt(row.year_end_journal_entry_id),
    sourceJournalCount: Number(row.source_journal_count || 0),
    sourceDebitTotal: Number(row.source_debit_total || 0),
    sourceCreditTotal: Number(row.source_credit_total || 0),
    startedByUserId: parsePositiveInt(row.started_by_user_id),
    completedByUserId: parsePositiveInt(row.completed_by_user_id),
    reopenedByUserId: parsePositiveInt(row.reopened_by_user_id),
    startedAt: row.started_at || null,
    completedAt: row.completed_at || null,
    reopenedAt: row.reopened_at || null,
    note: row.note || null,
    metadata: parseJsonColumn(row.metadata_json),
  };
}

function buildSystemJournalNo(prefix, scopeId) {
  const rand = Math.floor(Math.random() * 1_679_616)
    .toString(36)
    .padStart(4, "0")
    .toUpperCase();
  const stamp = Date.now().toString(36).toUpperCase();
  return `${String(prefix).toUpperCase()}-${String(scopeId).toUpperCase()}-${stamp}-${rand}`.slice(
    0,
    40
  );
}

function computeCloseRunHash(payload) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}

async function writeAuditLog(runQuery, req, event) {
  const tenantId = parsePositiveInt(event.tenantId);
  if (!tenantId) {
    return;
  }

  const userId = parsePositiveInt(event.userId);
  const scopeType = event.scopeType ? String(event.scopeType).toUpperCase() : null;
  const scopeId = parsePositiveInt(event.scopeId);

  const forwardedFor = req.headers["x-forwarded-for"];
  const forwardedIp = Array.isArray(forwardedFor)
    ? forwardedFor[0]
    : String(forwardedFor || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)[0];

  const ipAddress = forwardedIp || req.ip || req.socket?.remoteAddress || null;
  const userAgent = req.headers["user-agent"] || null;

  await runQuery(
    `INSERT INTO audit_logs (
        tenant_id,
        user_id,
        action,
        resource_type,
        resource_id,
        scope_type,
        scope_id,
        request_id,
        ip_address,
        user_agent,
        payload_json
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tenantId,
      userId || null,
      String(event.action || "gl.period_close"),
      String(event.resourceType || "period_close_run"),
      event.resourceId ? String(event.resourceId) : null,
      scopeType,
      scopeId || null,
      req.headers["x-request-id"] ? String(req.headers["x-request-id"]) : null,
      ipAddress,
      userAgent ? String(userAgent).slice(0, 255) : null,
      event.payload ? JSON.stringify(event.payload) : null,
    ]
  );
}

async function getFiscalPeriodDetails(periodId, runQuery = query) {
  const result = await runQuery(
    `SELECT
       id,
       calendar_id,
       fiscal_year,
       period_no,
       period_name,
       start_date,
       end_date,
       is_adjustment
     FROM fiscal_periods
     WHERE id = ?
     LIMIT 1`,
    [periodId]
  );
  return result.rows[0] || null;
}

async function findNextFiscalPeriod(calendarId, periodEndDate, runQuery = query) {
  const result = await runQuery(
    `SELECT
       id,
       calendar_id,
       fiscal_year,
       period_no,
       period_name,
       start_date,
       end_date,
       is_adjustment
     FROM fiscal_periods
     WHERE calendar_id = ?
       AND is_adjustment = FALSE
       AND start_date > ?
     ORDER BY start_date ASC, id ASC
     LIMIT 1`,
    [calendarId, periodEndDate]
  );
  return result.rows[0] || null;
}

async function getPeriodSourceFingerprint(
  tenantId,
  bookId,
  fiscalPeriodId,
  runQuery = query
) {
  const result = await runQuery(
    `SELECT
       COUNT(*) AS source_journal_count,
       COALESCE(SUM(total_debit_base), 0) AS source_debit_total,
       COALESCE(SUM(total_credit_base), 0) AS source_credit_total,
       COALESCE(MAX(updated_at), '1970-01-01 00:00:00') AS source_last_updated_at
     FROM journal_entries
     WHERE tenant_id = ?
       AND book_id = ?
       AND fiscal_period_id = ?
       AND status = 'POSTED'
       AND (reference_no IS NULL OR reference_no NOT LIKE 'PERIOD_CLOSE_RUN:%')`,
    [tenantId, bookId, fiscalPeriodId]
  );

  const row = result.rows[0] || {};
  return {
    sourceJournalCount: Number(row.source_journal_count || 0),
    sourceDebitTotal: Number(row.source_debit_total || 0),
    sourceCreditTotal: Number(row.source_credit_total || 0),
    sourceLastUpdatedAt: row.source_last_updated_at || null,
  };
}

async function getPostedPeriodAccountBalances(
  tenantId,
  bookId,
  fiscalPeriodId,
  runQuery = query
) {
  const result = await runQuery(
    `SELECT
       jl.account_id,
       a.code AS account_code,
       a.name AS account_name,
       a.account_type,
       c.legal_entity_id,
       SUM(jl.debit_base) AS debit_total,
       SUM(jl.credit_base) AS credit_total,
       SUM(jl.debit_base - jl.credit_base) AS closing_balance
     FROM journal_entries je
     JOIN journal_lines jl ON jl.journal_entry_id = je.id
     JOIN accounts a ON a.id = jl.account_id
     JOIN charts_of_accounts c ON c.id = a.coa_id
     WHERE je.tenant_id = ?
       AND je.book_id = ?
       AND je.fiscal_period_id = ?
       AND je.status = 'POSTED'
       AND (je.reference_no IS NULL OR je.reference_no NOT LIKE 'PERIOD_CLOSE_RUN:%')
       AND c.tenant_id = ?
     GROUP BY jl.account_id, a.code, a.name, a.account_type, c.legal_entity_id
     HAVING ABS(SUM(jl.debit_base - jl.credit_base)) >= ?
     ORDER BY a.code, jl.account_id`,
    [tenantId, bookId, fiscalPeriodId, tenantId, BALANCE_EPSILON]
  );

  return result.rows || [];
}

function buildYearEndCloseLine(balanceRow) {
  const closingBalance = Number(balanceRow.closing_balance || 0);
  if (isNearlyZero(closingBalance)) {
    return null;
  }

  if (closingBalance > 0) {
    return {
      accountId: parsePositiveInt(balanceRow.account_id),
      closingBalance,
      debitBase: 0,
      creditBase: closingBalance,
      description: `Year-end close (${String(balanceRow.account_code || "").trim()})`,
    };
  }

  return {
    accountId: parsePositiveInt(balanceRow.account_id),
    closingBalance,
    debitBase: Math.abs(closingBalance),
    creditBase: 0,
    description: `Year-end close (${String(balanceRow.account_code || "").trim()})`,
  };
}

async function createSystemJournalWithLines(tx, payload) {
  const lines = Array.isArray(payload.lines) ? payload.lines : [];
  if (lines.length === 0) {
    return null;
  }

  const entryDate = toIsoDate(payload.entryDate, "entryDate");
  const documentDate = toIsoDate(payload.documentDate, "documentDate");

  let totalDebitBase = 0;
  let totalCreditBase = 0;
  for (const line of lines) {
    totalDebitBase += Number(line.debitBase || 0);
    totalCreditBase += Number(line.creditBase || 0);
  }
  if (Math.abs(totalDebitBase - totalCreditBase) > BALANCE_EPSILON) {
    throw badRequest("System-generated journal is not balanced");
  }

  const entryResult = await tx.query(
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
        posted_at
     )
     VALUES (?, ?, ?, ?, ?, 'SYSTEM', 'POSTED', ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [
      payload.tenantId,
      payload.legalEntityId,
      payload.bookId,
      payload.fiscalPeriodId,
      payload.journalNo,
      entryDate,
      documentDate,
      payload.currencyCode,
      payload.description || null,
      payload.referenceNo || null,
      totalDebitBase,
      totalCreditBase,
      payload.userId,
      payload.userId,
    ]
  );

  const journalEntryId = parsePositiveInt(entryResult.rows.insertId);
  if (!journalEntryId) {
    throw badRequest("Failed to create system journal entry");
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const debitBase = Number(line.debitBase || 0);
    const creditBase = Number(line.creditBase || 0);
    // eslint-disable-next-line no-await-in-loop
    await tx.query(
      `INSERT INTO journal_lines (
          journal_entry_id,
          line_no,
          account_id,
          operating_unit_id,
          counterparty_legal_entity_id,
          description,
          currency_code,
          amount_txn,
          debit_base,
          credit_base,
          tax_code
       )
       VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, NULL)`,
      [
        journalEntryId,
        i + 1,
        parsePositiveInt(line.accountId),
        line.description ? String(line.description) : null,
        payload.currencyCode,
        debitBase - creditBase,
        debitBase,
        creditBase,
      ]
    );
  }

  return {
    journalEntryId,
    totalDebitBase,
    totalCreditBase,
    lineCount: lines.length,
  };
}

async function reversePostedJournalWithinTransaction(tx, params) {
  const journalId = parsePositiveInt(params.journalId);
  if (!journalId) {
    return null;
  }

  const originalResult = await tx.query(
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
    [journalId, params.tenantId]
  );
  const original = originalResult.rows[0];
  if (!original) {
    return null;
  }

  const existingReversalId = parsePositiveInt(original.reversal_journal_entry_id);
  if (String(original.status || "").toUpperCase() === "REVERSED" && existingReversalId) {
    return existingReversalId;
  }

  if (String(original.status || "").toUpperCase() !== "POSTED") {
    throw badRequest(`Journal ${journalId} is not POSTED and cannot be auto-reversed`);
  }

  const lineResult = await tx.query(
    `SELECT
       account_id,
       operating_unit_id,
       counterparty_legal_entity_id,
       description,
       currency_code,
       amount_txn,
       debit_base,
       credit_base,
       tax_code
     FROM journal_lines
     WHERE journal_entry_id = ?
     ORDER BY line_no`,
    [journalId]
  );
  const lines = lineResult.rows || [];
  if (lines.length === 0) {
    throw badRequest(`Journal ${journalId} has no lines to auto-reverse`);
  }

  const reversalNo = buildSystemJournalNo("REV", journalId);
  const reason = params.reason || "Period close reopen";

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
     VALUES (?, ?, ?, ?, ?, ?, 'POSTED', ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
    [
      params.tenantId,
      parsePositiveInt(original.legal_entity_id),
      parsePositiveInt(original.book_id),
      parsePositiveInt(original.fiscal_period_id),
      reversalNo,
      String(original.source_type || "SYSTEM").toUpperCase(),
      toIsoDate(original.entry_date, "entry_date"),
      toIsoDate(original.document_date, "document_date"),
      String(original.currency_code || params.currencyCode || "USD").toUpperCase(),
      `Auto-reversal of ${original.journal_no}`,
      original.reference_no ? String(original.reference_no) : null,
      Number(original.total_credit_base || 0),
      Number(original.total_debit_base || 0),
      params.userId,
      params.userId,
      reason,
    ]
  );

  const reversalJournalId = parsePositiveInt(reversalResult.rows.insertId);
  if (!reversalJournalId) {
    throw badRequest(`Failed to create reversal for journal ${journalId}`);
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    // eslint-disable-next-line no-await-in-loop
    await tx.query(
      `INSERT INTO journal_lines (
          journal_entry_id,
          line_no,
          account_id,
          operating_unit_id,
          counterparty_legal_entity_id,
          description,
          currency_code,
          amount_txn,
          debit_base,
          credit_base,
          tax_code
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        reversalJournalId,
        i + 1,
        parsePositiveInt(line.account_id),
        parsePositiveInt(line.operating_unit_id),
        parsePositiveInt(line.counterparty_legal_entity_id),
        line.description ? String(line.description) : null,
        String(line.currency_code || original.currency_code).toUpperCase(),
        Number(line.amount_txn || 0) * -1,
        Number(line.credit_base || 0),
        Number(line.debit_base || 0),
        line.tax_code ? String(line.tax_code) : null,
      ]
    );
  }

  await tx.query(
    `UPDATE journal_entries
     SET status = 'REVERSED',
         reversed_by_user_id = ?,
         reversed_at = CURRENT_TIMESTAMP,
         reversal_journal_entry_id = ?,
         reverse_reason = ?
     WHERE id = ?
       AND tenant_id = ?`,
    [params.userId, reversalJournalId, reason, journalId, params.tenantId]
  );

  return reversalJournalId;
}

async function getRetainedEarningsAccountForBook(
  tenantId,
  bookLegalEntityId,
  accountId,
  runQuery = query
) {
  const parsedAccountId = parsePositiveInt(accountId);
  if (!parsedAccountId) {
    return null;
  }

  const result = await runQuery(
    `SELECT
       a.id,
       a.code,
       a.name,
       a.account_type,
       a.allow_posting,
       a.is_active,
       EXISTS(
         SELECT 1
         FROM accounts child
         WHERE child.parent_account_id = a.id
           AND child.is_active = TRUE
       ) AS has_active_children,
       c.legal_entity_id
     FROM accounts a
     JOIN charts_of_accounts c ON c.id = a.coa_id
     WHERE a.id = ?
       AND c.tenant_id = ?
     LIMIT 1`,
    [parsedAccountId, tenantId]
  );
  const row = result.rows[0];
  if (!row) {
    throw badRequest("retainedEarningsAccountId not found for tenant");
  }

  const accountType = String(row.account_type || "").toUpperCase();
  if (accountType !== "EQUITY") {
    throw badRequest("retainedEarningsAccountId must reference an EQUITY account");
  }
  if (!Boolean(row.is_active)) {
    throw badRequest("retainedEarningsAccountId must reference an active account");
  }
  if (!Boolean(row.allow_posting)) {
    throw badRequest("retainedEarningsAccountId must reference a postable leaf account");
  }
  if (Boolean(row.has_active_children)) {
    throw badRequest("retainedEarningsAccountId must reference a leaf account");
  }

  const accountLegalEntityId = parsePositiveInt(row.legal_entity_id);
  if (accountLegalEntityId && accountLegalEntityId !== bookLegalEntityId) {
    throw badRequest("retainedEarningsAccountId must belong to the same legal entity as bookId");
  }

  return {
    id: parsedAccountId,
    code: String(row.code || ""),
    name: String(row.name || ""),
    accountType,
    legalEntityId: accountLegalEntityId,
  };
}

function parseOptionalPositiveInt(value, fieldLabel) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = parsePositiveInt(value);
  if (!parsed) {
    throw badRequest(`${fieldLabel} must be a positive integer`);
  }
  return parsed;
}

async function validateJournalLineScope(req, tenantId, legalEntityId, line, index) {
  const lineLabel = `lines[${index}]`;
  const accountId = parsePositiveInt(line?.accountId);
  if (!accountId) {
    throw badRequest(`${lineLabel}.accountId must be a positive integer`);
  }

  const accountResult = await query(
    `SELECT
       a.id,
       a.is_active,
       a.allow_posting,
       EXISTS(
         SELECT 1
         FROM accounts child
         WHERE child.parent_account_id = a.id
           AND child.is_active = TRUE
       ) AS has_active_children,
       c.legal_entity_id
     FROM accounts a
     JOIN charts_of_accounts c ON c.id = a.coa_id
     WHERE a.id = ?
       AND c.tenant_id = ?
     LIMIT 1`,
    [accountId, tenantId]
  );
  const account = accountResult.rows[0];
  if (!account) {
    throw badRequest(`${lineLabel}.accountId not found for tenant`);
  }
  if (!Boolean(account.is_active)) {
    throw badRequest(`${lineLabel}.accountId is inactive`);
  }
  if (!Boolean(account.allow_posting)) {
    throw badRequest(
      `${lineLabel}.accountId is not postable. Select a postable sub-account.`
    );
  }
  if (Boolean(account.has_active_children)) {
    throw badRequest(
      `${lineLabel}.accountId is a parent account. Select a leaf sub-account.`
    );
  }

  const accountLegalEntityId = parsePositiveInt(account.legal_entity_id);
  if (accountLegalEntityId && accountLegalEntityId !== legalEntityId) {
    throw badRequest(`${lineLabel}.accountId does not belong to legalEntityId`);
  }
  if (accountLegalEntityId) {
    assertScopeAccess(req, "legal_entity", accountLegalEntityId, `${lineLabel}.accountId`);
  }

  const operatingUnitId = parseOptionalPositiveInt(
    line?.operatingUnitId,
    `${lineLabel}.operatingUnitId`
  );
  if (operatingUnitId) {
    const unitResult = await query(
      `SELECT id, legal_entity_id
       FROM operating_units
       WHERE id = ?
         AND tenant_id = ?
       LIMIT 1`,
      [operatingUnitId, tenantId]
    );
    const unit = unitResult.rows[0];
    if (!unit) {
      throw badRequest(`${lineLabel}.operatingUnitId not found for tenant`);
    }
    if (parsePositiveInt(unit.legal_entity_id) !== legalEntityId) {
      throw badRequest(`${lineLabel}.operatingUnitId does not belong to legalEntityId`);
    }
    assertScopeAccess(req, "operating_unit", operatingUnitId, `${lineLabel}.operatingUnitId`);
  }

  const counterpartyLegalEntityId = parseOptionalPositiveInt(
    line?.counterpartyLegalEntityId,
    `${lineLabel}.counterpartyLegalEntityId`
  );
  if (counterpartyLegalEntityId) {
    const counterpartyResult = await query(
      `SELECT id
       FROM legal_entities
       WHERE id = ?
         AND tenant_id = ?
       LIMIT 1`,
      [counterpartyLegalEntityId, tenantId]
    );
    if (!counterpartyResult.rows[0]) {
      throw badRequest(`${lineLabel}.counterpartyLegalEntityId not found for tenant`);
    }
    assertScopeAccess(
      req,
      "legal_entity",
      counterpartyLegalEntityId,
      `${lineLabel}.counterpartyLegalEntityId`
    );
  }

  const debitBase = toAmount(line?.debitBase);
  const creditBase = toAmount(line?.creditBase);
  if (debitBase < 0 || creditBase < 0) {
    throw badRequest(`${lineLabel}.debitBase/creditBase cannot be negative`);
  }
  if ((debitBase === 0 && creditBase === 0) || (debitBase > 0 && creditBase > 0)) {
    throw badRequest(
      `${lineLabel} must have exactly one side > 0 (either debitBase or creditBase)`
    );
  }
}

router.get(
  "/books",
  requirePermission("gl.book.read", {
    resolveScope: (req) => {
      const legalEntityId = parsePositiveInt(req.query?.legalEntityId);
      return legalEntityId ? { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId } : null;
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) throw badRequest("tenantId is required");

    const legalEntityId = parsePositiveInt(req.query.legalEntityId);
    if (legalEntityId) {
      assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");
    }

    const conditions = ["tenant_id = ?"];
    const params = [tenantId];
    conditions.push(buildScopeFilter(req, "legal_entity", "legal_entity_id", params));
    if (legalEntityId) {
      conditions.push("legal_entity_id = ?");
      params.push(legalEntityId);
    }

    const result = await query(
      `SELECT id, tenant_id, legal_entity_id, calendar_id, code, name, book_type, base_currency_code, created_at
       FROM books
       WHERE ${conditions.join(" AND ")}
       ORDER BY id`,
      params
    );

    return res.json({ tenantId, rows: result.rows });
  })
);

router.get(
  "/coas",
  requirePermission("gl.coa.read", {
    resolveScope: (req) => {
      const legalEntityId = parsePositiveInt(req.query?.legalEntityId);
      return legalEntityId ? { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId } : null;
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) throw badRequest("tenantId is required");

    const legalEntityId = parsePositiveInt(req.query.legalEntityId);
    if (legalEntityId) {
      assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");
    }

    const scope = req.query.scope ? String(req.query.scope).toUpperCase() : null;
    const conditions = ["tenant_id = ?"];
    const params = [tenantId];
    const legalScopeFilter = buildScopeFilter(req, "legal_entity", "legal_entity_id", params);
    conditions.push(`(legal_entity_id IS NULL OR ${legalScopeFilter})`);
    if (legalEntityId) {
      conditions.push("legal_entity_id = ?");
      params.push(legalEntityId);
    }
    if (scope) {
      conditions.push("scope = ?");
      params.push(scope);
    }

    const result = await query(
      `SELECT id, tenant_id, legal_entity_id, scope, code, name, created_at
       FROM charts_of_accounts
       WHERE ${conditions.join(" AND ")}
       ORDER BY id`,
      params
    );

    return res.json({ tenantId, rows: result.rows });
  })
);

router.get(
  "/accounts",
  requirePermission("gl.account.read", {
    resolveScope: (req) => {
      const legalEntityId = parsePositiveInt(req.query?.legalEntityId);
      return legalEntityId ? { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId } : null;
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) throw badRequest("tenantId is required");

    const coaId = parsePositiveInt(req.query.coaId);
    const legalEntityId = parsePositiveInt(req.query.legalEntityId);
    const includeInactive = String(req.query.includeInactive || "").toLowerCase() === "true";

    if (legalEntityId) {
      assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");
    }

    const conditions = ["c.tenant_id = ?"];
    const params = [tenantId];
    const legalScopeFilter = buildScopeFilter(req, "legal_entity", "c.legal_entity_id", params);
    conditions.push(`(c.legal_entity_id IS NULL OR ${legalScopeFilter})`);
    if (coaId) {
      conditions.push("a.coa_id = ?");
      params.push(coaId);
    }
    if (legalEntityId) {
      conditions.push("c.legal_entity_id = ?");
      params.push(legalEntityId);
    }
    if (!includeInactive) {
      conditions.push("a.is_active = TRUE");
    }

    const result = await query(
      `SELECT
         a.id, a.coa_id, a.code, a.name, a.account_type, a.normal_side, a.allow_posting,
         a.parent_account_id, a.is_active, c.legal_entity_id, c.scope
       FROM accounts a
       JOIN charts_of_accounts c ON c.id = a.coa_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY c.id, a.code`,
      params
    );

    return res.json({ tenantId, rows: result.rows });
  })
);

router.post(
  "/books",
  requirePermission("gl.book.upsert", {
    resolveScope: (req, tenantId) => {
      const legalEntityId = parsePositiveInt(req.body?.legalEntityId);
      return legalEntityId
        ? { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId }
        : { scopeType: "TENANT", scopeId: tenantId };
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) throw badRequest("tenantId is required");

    assertRequiredFields(req.body, [
      "legalEntityId",
      "calendarId",
      "code",
      "name",
      "baseCurrencyCode",
    ]);

    const legalEntityId = parsePositiveInt(req.body.legalEntityId);
    const calendarId = parsePositiveInt(req.body.calendarId);
    if (!legalEntityId || !calendarId) {
      throw badRequest("legalEntityId and calendarId must be positive integers");
    }

    await assertLegalEntityBelongsToTenant(tenantId, legalEntityId, "legalEntityId");
    await assertFiscalCalendarBelongsToTenant(tenantId, calendarId, "calendarId");
    assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");

    const { code, name, bookType = "LOCAL", baseCurrencyCode } = req.body;
    const result = await query(
      `INSERT INTO books (
          tenant_id, legal_entity_id, calendar_id, code, name, book_type, base_currency_code
        )
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         book_type = VALUES(book_type),
         base_currency_code = VALUES(base_currency_code),
         calendar_id = VALUES(calendar_id)`,
      [
        tenantId,
        legalEntityId,
        calendarId,
        String(code).trim(),
        String(name).trim(),
        String(bookType).toUpperCase(),
        String(baseCurrencyCode).trim().toUpperCase(),
      ]
    );

    return res.status(201).json({ ok: true, id: result.rows.insertId || null });
  })
);

router.post(
  "/coas",
  requirePermission("gl.coa.upsert", {
    resolveScope: (req, tenantId) => {
      const legalEntityId = parsePositiveInt(req.body?.legalEntityId);
      return legalEntityId
        ? { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId }
        : { scopeType: "TENANT", scopeId: tenantId };
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) throw badRequest("tenantId is required");

    assertRequiredFields(req.body, ["scope", "code", "name"]);
    const scope = String(req.body.scope || "").toUpperCase();
    if (!["LEGAL_ENTITY", "GROUP"].includes(scope)) {
      throw badRequest("scope must be LEGAL_ENTITY or GROUP");
    }

    const legalEntityId = req.body.legalEntityId
      ? parsePositiveInt(req.body.legalEntityId)
      : null;
    if (scope === "LEGAL_ENTITY" && !legalEntityId) {
      throw badRequest("legalEntityId is required for LEGAL_ENTITY scope");
    }
    if (scope === "GROUP" && legalEntityId) {
      throw badRequest("legalEntityId must be omitted for GROUP scope");
    }
    if (legalEntityId) {
      await assertLegalEntityBelongsToTenant(tenantId, legalEntityId, "legalEntityId");
      assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");
    }

    const { code, name } = req.body;
    const result = await query(
      `INSERT INTO charts_of_accounts (
          tenant_id, legal_entity_id, scope, code, name
        )
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         legal_entity_id = VALUES(legal_entity_id),
         scope = VALUES(scope)`,
      [
        tenantId,
        legalEntityId,
        scope,
        String(code).trim(),
        String(name).trim(),
      ]
    );

    return res.status(201).json({ ok: true, id: result.rows.insertId || null });
  })
);

router.post(
  "/accounts",
  requirePermission("gl.account.upsert", {
    resolveScope: async (req, tenantId) => {
      const coaId = parsePositiveInt(req.body?.coaId);
      if (!coaId) {
        return { scopeType: "TENANT", scopeId: tenantId };
      }

      const coaResult = await query(
        `SELECT legal_entity_id
         FROM charts_of_accounts
         WHERE id = ?
           AND tenant_id = ?
         LIMIT 1`,
        [coaId, tenantId]
      );
      const legalEntityId = parsePositiveInt(coaResult.rows[0]?.legal_entity_id);
      if (legalEntityId) {
        return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
      }
      return { scopeType: "TENANT", scopeId: tenantId };
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) throw badRequest("tenantId is required");

    assertRequiredFields(req.body, [
      "coaId",
      "code",
      "name",
      "accountType",
      "normalSide",
    ]);
    const coaId = parsePositiveInt(req.body.coaId);
    if (!coaId) {
      throw badRequest("coaId must be a positive integer");
    }

    const coa = await assertCoaBelongsToTenant(tenantId, coaId, "coaId");
    const coaLegalEntityId = parsePositiveInt(coa.legal_entity_id);
    if (coaLegalEntityId) {
      assertScopeAccess(req, "legal_entity", coaLegalEntityId, "coa.legalEntityId");
    }

    const parentAccountId = req.body.parentAccountId
      ? parsePositiveInt(req.body.parentAccountId)
      : null;
    if (req.body.parentAccountId && !parentAccountId) {
      throw badRequest("parentAccountId must be a positive integer");
    }
    if (parentAccountId) {
      const parent = await assertAccountBelongsToTenant(
        tenantId,
        parentAccountId,
        "parentAccountId"
      );
      if (parsePositiveInt(parent.coa_id) !== coaId) {
        throw badRequest("parentAccountId must belong to the same coaId");
      }
    }

    const { code, name, accountType, normalSide, allowPosting = true } = req.body;

    const result = await query(
      `INSERT INTO accounts (
          coa_id, code, name, account_type, normal_side, allow_posting, parent_account_id
        )
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         account_type = VALUES(account_type),
         normal_side = VALUES(normal_side),
         allow_posting = VALUES(allow_posting),
         parent_account_id = VALUES(parent_account_id)`,
      [
        coaId,
        String(code).trim(),
        String(name).trim(),
        String(accountType).toUpperCase(),
        String(normalSide).toUpperCase(),
        Boolean(allowPosting),
        parentAccountId,
      ]
    );

    return res.status(201).json({ ok: true, id: result.rows.insertId || null });
  })
);

router.post(
  "/account-mappings",
  requirePermission("gl.account_mapping.upsert", {
    resolveScope: async (req, tenantId) => {
      const sourceAccountId = parsePositiveInt(req.body?.sourceAccountId);
      if (!sourceAccountId) {
        return { scopeType: "TENANT", scopeId: tenantId };
      }

      const sourceResult = await query(
        `SELECT c.legal_entity_id
         FROM accounts a
         JOIN charts_of_accounts c ON c.id = a.coa_id
         WHERE a.id = ?
           AND c.tenant_id = ?
         LIMIT 1`,
        [sourceAccountId, tenantId]
      );

      const legalEntityId = parsePositiveInt(sourceResult.rows[0]?.legal_entity_id);
      if (legalEntityId) {
        return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
      }
      return { scopeType: "TENANT", scopeId: tenantId };
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) throw badRequest("tenantId is required");

    assertRequiredFields(req.body, ["sourceAccountId", "targetAccountId"]);
    const sourceAccountId = parsePositiveInt(req.body.sourceAccountId);
    const targetAccountId = parsePositiveInt(req.body.targetAccountId);
    if (!sourceAccountId || !targetAccountId) {
      throw badRequest("sourceAccountId and targetAccountId must be positive integers");
    }

    const sourceAccount = await assertAccountBelongsToTenant(
      tenantId,
      sourceAccountId,
      "sourceAccountId"
    );
    const targetAccount = await assertAccountBelongsToTenant(
      tenantId,
      targetAccountId,
      "targetAccountId"
    );

    const sourceEntityId = parsePositiveInt(sourceAccount.legal_entity_id);
    const targetEntityId = parsePositiveInt(targetAccount.legal_entity_id);
    if (sourceEntityId) {
      assertScopeAccess(req, "legal_entity", sourceEntityId, "sourceAccount.legalEntityId");
    }
    if (targetEntityId) {
      assertScopeAccess(req, "legal_entity", targetEntityId, "targetAccount.legalEntityId");
    }

    const mappingType = String(req.body.mappingType || "LOCAL_TO_GROUP").toUpperCase();
    const result = await query(
      `INSERT INTO account_mappings (
          tenant_id, source_account_id, target_account_id, mapping_type
        )
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         mapping_type = VALUES(mapping_type)`,
      [tenantId, sourceAccountId, targetAccountId, mappingType]
    );

    return res.status(201).json({ ok: true, id: result.rows.insertId || null });
  })
);

router.get(
  "/journals",
  requirePermission("gl.journal.read", {
    resolveScope: async (req, tenantId) => {
      const legalEntityId = parsePositiveInt(req.query?.legalEntityId);
      if (legalEntityId) {
        return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
      }

      const bookId = parsePositiveInt(req.query?.bookId);
      if (bookId) {
        return resolveScopeFromBookId(bookId, tenantId);
      }

      return null;
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) throw badRequest("tenantId is required");

    const legalEntityId = parsePositiveInt(req.query.legalEntityId);
    const bookId = parsePositiveInt(req.query.bookId);
    const fiscalPeriodId = parsePositiveInt(req.query.fiscalPeriodId);
    const status = req.query.status ? String(req.query.status).toUpperCase() : null;
    const includeLines = String(req.query.includeLines || "").toLowerCase() === "true";

    if (legalEntityId) {
      assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");
    }
    if (status && !["DRAFT", "POSTED", "REVERSED"].includes(status)) {
      throw badRequest("status must be one of DRAFT, POSTED, REVERSED");
    }

    const limitRaw = Number(req.query.limit);
    const limit =
      Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50;
    const offsetRaw = Number(req.query.offset);
    const offset = Number.isInteger(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;

    const conditions = ["je.tenant_id = ?"];
    const params = [tenantId];
    conditions.push(buildScopeFilter(req, "legal_entity", "je.legal_entity_id", params));

    if (legalEntityId) {
      conditions.push("je.legal_entity_id = ?");
      params.push(legalEntityId);
    }
    if (bookId) {
      conditions.push("je.book_id = ?");
      params.push(bookId);
    }
    if (fiscalPeriodId) {
      conditions.push("je.fiscal_period_id = ?");
      params.push(fiscalPeriodId);
    }
    if (status) {
      conditions.push("je.status = ?");
      params.push(status);
    }

    const whereSql = conditions.join(" AND ");
    const countResult = await query(
      `SELECT COUNT(*) AS total
       FROM journal_entries je
       WHERE ${whereSql}`,
      params
    );
    const total = Number(countResult.rows[0]?.total || 0);

    const rowsResult = await query(
      `SELECT
         je.id, je.tenant_id, je.legal_entity_id, je.book_id, je.fiscal_period_id,
         je.journal_no, je.source_type, je.status, je.entry_date, je.document_date,
         je.currency_code, je.description, je.reference_no,
         je.total_debit_base, je.total_credit_base,
         je.created_by_user_id, je.posted_by_user_id, je.posted_at,
         je.reversed_by_user_id, je.reversed_at, je.reverse_reason,
         je.reversal_journal_entry_id, je.created_at, je.updated_at,
         le.code AS legal_entity_code, le.name AS legal_entity_name,
         b.code AS book_code, b.name AS book_name,
         fp.fiscal_year, fp.period_no, fp.period_name,
         (
           SELECT COUNT(*)
           FROM journal_lines jl
           WHERE jl.journal_entry_id = je.id
         ) AS line_count
       FROM journal_entries je
       JOIN legal_entities le ON le.id = je.legal_entity_id
       JOIN books b ON b.id = je.book_id
       JOIN fiscal_periods fp ON fp.id = je.fiscal_period_id
       WHERE ${whereSql}
       ORDER BY je.id DESC
       LIMIT ${limit}
       OFFSET ${offset}`,
      params
    );

    const rows = rowsResult.rows || [];

    if (includeLines && rows.length > 0) {
      const journalIds = rows
        .map((row) => parsePositiveInt(row.id))
        .filter((value) => Boolean(value));

      if (journalIds.length > 0) {
        const placeholders = journalIds.map(() => "?").join(", ");
        const lineResult = await query(
          `SELECT
             jl.id, jl.journal_entry_id, jl.line_no, jl.account_id,
             jl.operating_unit_id, jl.counterparty_legal_entity_id,
             jl.description, jl.currency_code, jl.amount_txn, jl.debit_base,
             jl.credit_base, jl.tax_code, jl.created_at,
             a.code AS account_code, a.name AS account_name,
             ou.code AS operating_unit_code, ou.name AS operating_unit_name,
             cle.code AS counterparty_legal_entity_code,
             cle.name AS counterparty_legal_entity_name
           FROM journal_lines jl
           JOIN accounts a ON a.id = jl.account_id
           LEFT JOIN operating_units ou ON ou.id = jl.operating_unit_id
           LEFT JOIN legal_entities cle ON cle.id = jl.counterparty_legal_entity_id
           WHERE jl.journal_entry_id IN (${placeholders})
           ORDER BY jl.journal_entry_id, jl.line_no`,
          journalIds
        );

        const linesByJournalId = new Map();
        for (const line of lineResult.rows || []) {
          const journalEntryId = parsePositiveInt(line.journal_entry_id);
          if (!journalEntryId) continue;
          if (!linesByJournalId.has(journalEntryId)) {
            linesByJournalId.set(journalEntryId, []);
          }
          linesByJournalId.get(journalEntryId).push(line);
        }

        for (const row of rows) {
          row.lines = linesByJournalId.get(parsePositiveInt(row.id)) || [];
        }
      }
    }

    return res.json({
      tenantId,
      rows,
      total,
      limit,
      offset,
    });
  })
);

router.get(
  "/journals/:journalId",
  requirePermission("gl.journal.read", {
    resolveScope: async (req, tenantId) => {
      return resolveScopeFromJournalId(req.params?.journalId, tenantId);
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) throw badRequest("tenantId is required");

    const journalId = parsePositiveInt(req.params.journalId);
    if (!journalId) {
      throw badRequest("journalId must be a positive integer");
    }

    const rowResult = await query(
      `SELECT
         je.id, je.tenant_id, je.legal_entity_id, je.book_id, je.fiscal_period_id,
         je.journal_no, je.source_type, je.status, je.entry_date, je.document_date,
         je.currency_code, je.description, je.reference_no,
         je.total_debit_base, je.total_credit_base,
         je.created_by_user_id, je.posted_by_user_id, je.posted_at,
         je.reversed_by_user_id, je.reversed_at, je.reverse_reason,
         je.reversal_journal_entry_id, je.created_at, je.updated_at,
         le.code AS legal_entity_code, le.name AS legal_entity_name,
         b.code AS book_code, b.name AS book_name,
         fp.fiscal_year, fp.period_no, fp.period_name
       FROM journal_entries je
       JOIN legal_entities le ON le.id = je.legal_entity_id
       JOIN books b ON b.id = je.book_id
       JOIN fiscal_periods fp ON fp.id = je.fiscal_period_id
       WHERE je.id = ?
         AND je.tenant_id = ?
       LIMIT 1`,
      [journalId, tenantId]
    );
    const journal = rowResult.rows[0];
    if (!journal) {
      throw badRequest("Journal not found");
    }

    assertScopeAccess(req, "legal_entity", journal.legal_entity_id, "journal.legalEntityId");

    const lineResult = await query(
      `SELECT
         jl.id, jl.journal_entry_id, jl.line_no, jl.account_id,
         jl.operating_unit_id, jl.counterparty_legal_entity_id,
         jl.description, jl.currency_code, jl.amount_txn, jl.debit_base,
         jl.credit_base, jl.tax_code, jl.created_at,
         a.code AS account_code, a.name AS account_name,
         ou.code AS operating_unit_code, ou.name AS operating_unit_name,
         cle.code AS counterparty_legal_entity_code,
         cle.name AS counterparty_legal_entity_name
       FROM journal_lines jl
       JOIN accounts a ON a.id = jl.account_id
       LEFT JOIN operating_units ou ON ou.id = jl.operating_unit_id
       LEFT JOIN legal_entities cle ON cle.id = jl.counterparty_legal_entity_id
       WHERE jl.journal_entry_id = ?
       ORDER BY jl.line_no`,
      [journalId]
    );

    return res.json({
      tenantId,
      row: {
        ...journal,
        lines: lineResult.rows || [],
      },
    });
  })
);

router.post(
  "/journals",
  requirePermission("gl.journal.create", {
    resolveScope: (req, tenantId) => {
      const legalEntityId = parsePositiveInt(req.body?.legalEntityId);
      return legalEntityId
        ? { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId }
        : { scopeType: "TENANT", scopeId: tenantId };
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) throw badRequest("tenantId is required");

    assertRequiredFields(req.body, [
      "legalEntityId",
      "bookId",
      "fiscalPeriodId",
      "entryDate",
      "documentDate",
      "currencyCode",
      "lines",
    ]);

    const legalEntityId = parsePositiveInt(req.body.legalEntityId);
    const bookId = parsePositiveInt(req.body.bookId);
    const fiscalPeriodId = parsePositiveInt(req.body.fiscalPeriodId);
    const lines = Array.isArray(req.body.lines) ? req.body.lines : [];
    if (!legalEntityId || !bookId || !fiscalPeriodId) {
      throw badRequest("legalEntityId, bookId and fiscalPeriodId must be positive integers");
    }
    if (lines.length < 2) {
      throw badRequest("At least 2 journal lines are required");
    }

    await assertLegalEntityBelongsToTenant(tenantId, legalEntityId, "legalEntityId");
    assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");

    const book = await assertBookBelongsToTenant(tenantId, bookId, "bookId");
    if (parsePositiveInt(book.legal_entity_id) !== legalEntityId) {
      throw badRequest("Book does not belong to legalEntityId");
    }

    await assertFiscalPeriodBelongsToCalendar(
      parsePositiveInt(book.calendar_id),
      fiscalPeriodId,
      "fiscalPeriodId"
    );

    await ensurePeriodOpen(bookId, fiscalPeriodId, "create draft journal");

    let totalDebit = 0;
    let totalCredit = 0;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      totalDebit += toAmount(line.debitBase);
      totalCredit += toAmount(line.creditBase);
      await validateJournalLineScope(req, tenantId, legalEntityId, line, i);
    }

    if (Math.abs(totalDebit - totalCredit) > 0.0001) {
      throw badRequest("Journal is not balanced");
    }

    const userId = parsePositiveInt(req.user?.userId);
    if (!userId) throw badRequest("Authenticated user is required");

    const journalNo = req.body.journalNo || generateJournalNo();
    const sourceType = String(req.body.sourceType || "MANUAL").toUpperCase();
    const description = req.body.description ? String(req.body.description) : null;
    const referenceNo = req.body.referenceNo ? String(req.body.referenceNo) : null;
    const currencyCode = String(req.body.currencyCode).toUpperCase();

    const journalEntryId = await withTransaction(async (tx) => {
      const entryResult = await tx.query(
        `INSERT INTO journal_entries (
            tenant_id, legal_entity_id, book_id, fiscal_period_id, journal_no,
            source_type, status, entry_date, document_date, currency_code,
            description, reference_no, total_debit_base, total_credit_base, created_by_user_id
          )
         VALUES (?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tenantId,
          legalEntityId,
          bookId,
          fiscalPeriodId,
          journalNo,
          sourceType,
          req.body.entryDate,
          req.body.documentDate,
          currencyCode,
          description,
          referenceNo,
          totalDebit,
          totalCredit,
          userId,
        ]
      );

      const createdJournalEntryId = parsePositiveInt(entryResult.rows.insertId);
      if (!createdJournalEntryId) {
        throw badRequest("Failed to create journal entry");
      }

      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        // eslint-disable-next-line no-await-in-loop
        await tx.query(
          `INSERT INTO journal_lines (
              journal_entry_id, line_no, account_id, operating_unit_id,
              counterparty_legal_entity_id, description, currency_code,
              amount_txn, debit_base, credit_base, tax_code
            )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            createdJournalEntryId,
            i + 1,
            parsePositiveInt(line.accountId),
            parsePositiveInt(line.operatingUnitId),
            parsePositiveInt(line.counterpartyLegalEntityId),
            line.description ? String(line.description) : null,
            String(line.currencyCode || currencyCode).toUpperCase(),
            toAmount(line.amountTxn),
            toAmount(line.debitBase),
            toAmount(line.creditBase),
            line.taxCode ? String(line.taxCode) : null,
          ]
        );
      }

      return createdJournalEntryId;
    });

    return res.status(201).json({
      ok: true,
      journalEntryId,
      journalNo,
      status: "DRAFT",
      totalDebit,
      totalCredit,
    });
  })
);

router.post(
  "/journals/:journalId/post",
  requirePermission("gl.journal.post", {
    resolveScope: async (req, tenantId) => {
      return resolveScopeFromJournalId(req.params?.journalId, tenantId);
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) throw badRequest("tenantId is required");

    const journalId = parsePositiveInt(req.params.journalId);
    if (!journalId) {
      throw badRequest("journalId must be a positive integer");
    }

    const userId = parsePositiveInt(req.user?.userId);
    if (!userId) throw badRequest("Authenticated user is required");

    const journal = await loadJournal(tenantId, journalId);
    if (!journal) throw badRequest("Journal not found");
    if (String(journal.status).toUpperCase() !== "DRAFT") {
      throw badRequest("Only DRAFT journals can be posted");
    }

    await ensurePeriodOpen(
      parsePositiveInt(journal.book_id),
      parsePositiveInt(journal.fiscal_period_id),
      "post journal"
    );

    const result = await query(
      `UPDATE journal_entries
       SET status = 'POSTED',
           posted_by_user_id = ?,
           posted_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND tenant_id = ?
         AND status = 'DRAFT'`,
      [userId, journalId, tenantId]
    );

    return res.json({
      ok: true,
      journalId,
      posted: Number(result.rows.affectedRows || 0) > 0,
    });
  })
);

router.post(
  "/journals/:journalId/reverse",
  requirePermission("gl.journal.reverse", {
    resolveScope: async (req, tenantId) => {
      return resolveScopeFromJournalId(req.params?.journalId, tenantId);
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) throw badRequest("tenantId is required");

    const journalId = parsePositiveInt(req.params.journalId);
    if (!journalId) {
      throw badRequest("journalId must be a positive integer");
    }

    const userId = parsePositiveInt(req.user?.userId);
    if (!userId) throw badRequest("Authenticated user is required");

    const original = await loadJournal(tenantId, journalId);
    if (!original) throw badRequest("Journal not found");
    if (String(original.status).toUpperCase() !== "POSTED") {
      throw badRequest("Only POSTED journals can be reversed");
    }
    if (parsePositiveInt(original.reversal_journal_entry_id)) {
      throw badRequest("Journal is already reversed");
    }

    const reversalPeriodId =
      parsePositiveInt(req.body?.reversalPeriodId) ||
      parsePositiveInt(original.fiscal_period_id);
    const autoPost = req.body?.autoPost === undefined ? true : Boolean(req.body.autoPost);
    const reason = req.body?.reason ? String(req.body.reason) : "Manual reversal";

    const bookId = parsePositiveInt(original.book_id);
    const book = await assertBookBelongsToTenant(tenantId, bookId, "bookId");
    await assertFiscalPeriodBelongsToCalendar(
      parsePositiveInt(book.calendar_id),
      reversalPeriodId,
      "reversalPeriodId"
    );

    await ensurePeriodOpen(bookId, reversalPeriodId, "reverse journal");

    const lineResult = await query(
      `SELECT
         account_id, operating_unit_id, counterparty_legal_entity_id, description,
         currency_code, amount_txn, debit_base, credit_base, tax_code
       FROM journal_lines
       WHERE journal_entry_id = ?
       ORDER BY line_no`,
      [journalId]
    );
    const lines = lineResult.rows || [];
    if (lines.length === 0) throw badRequest("Journal has no lines to reverse");

    const reversalJournalNo = req.body?.journalNo || `${original.journal_no}-REV`;
    const entryDate = req.body?.entryDate || original.entry_date;
    const documentDate = req.body?.documentDate || original.document_date;

    const { reversalJournalId, originalUpdated } = await withTransaction(async (tx) => {
      const reversalResult = await tx.query(
        `INSERT INTO journal_entries (
            tenant_id, legal_entity_id, book_id, fiscal_period_id, journal_no,
            source_type, status, entry_date, document_date, currency_code,
            description, reference_no, total_debit_base, total_credit_base,
            created_by_user_id, posted_by_user_id, posted_at, reverse_reason
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tenantId,
          parsePositiveInt(original.legal_entity_id),
          bookId,
          reversalPeriodId,
          reversalJournalNo,
          String(original.source_type || "MANUAL").toUpperCase(),
          autoPost ? "POSTED" : "DRAFT",
          String(entryDate),
          String(documentDate),
          String(original.currency_code).toUpperCase(),
          `Reversal of ${original.journal_no}`,
          original.reference_no ? String(original.reference_no) : null,
          Number(original.total_credit_base || 0),
          Number(original.total_debit_base || 0),
          userId,
          autoPost ? userId : null,
          autoPost ? new Date() : null,
          reason,
        ]
      );

      const createdReversalJournalId = parsePositiveInt(reversalResult.rows.insertId);
      if (!createdReversalJournalId) {
        throw badRequest("Failed to create reversal journal");
      }

      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        // eslint-disable-next-line no-await-in-loop
        await tx.query(
          `INSERT INTO journal_lines (
              journal_entry_id, line_no, account_id, operating_unit_id,
              counterparty_legal_entity_id, description, currency_code,
              amount_txn, debit_base, credit_base, tax_code
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            createdReversalJournalId,
            i + 1,
            parsePositiveInt(line.account_id),
            parsePositiveInt(line.operating_unit_id),
            parsePositiveInt(line.counterparty_legal_entity_id),
            line.description ? String(line.description) : null,
            String(line.currency_code || original.currency_code).toUpperCase(),
            Number(line.amount_txn || 0) * -1,
            Number(line.credit_base || 0),
            Number(line.debit_base || 0),
            line.tax_code ? String(line.tax_code) : null,
          ]
        );
      }

      let markedReversed = false;
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
             AND status = 'POSTED'`,
          [userId, createdReversalJournalId, reason, journalId, tenantId]
        );
        markedReversed = Number(updateResult.rows.affectedRows || 0) > 0;
      }

      return {
        reversalJournalId: createdReversalJournalId,
        originalUpdated: markedReversed,
      };
    });

    return res.status(201).json({
      ok: true,
      originalJournalId: journalId,
      reversalJournalId,
      reversalStatus: autoPost ? "POSTED" : "DRAFT",
      originalMarkedReversed: originalUpdated,
    });
  })
);

router.get(
  "/trial-balance",
  requirePermission("gl.trial_balance.read", {
    resolveScope: async (req, tenantId) => {
      return resolveScopeFromBookId(req.query?.bookId, tenantId);
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) throw badRequest("tenantId is required");

    const bookId = parsePositiveInt(req.query.bookId);
    const fiscalPeriodId = parsePositiveInt(req.query.fiscalPeriodId);
    const includeRollupRaw = req.query.includeRollup;
    const includeRollup =
      includeRollupRaw === undefined || includeRollupRaw === null || includeRollupRaw === ""
        ? true
        : String(includeRollupRaw).toLowerCase() === "true";
    if (!bookId || !fiscalPeriodId) {
      throw badRequest("bookId and fiscalPeriodId query params are required");
    }

    const book = await assertBookBelongsToTenant(tenantId, bookId, "bookId");
    await assertFiscalPeriodBelongsToCalendar(
      parsePositiveInt(book.calendar_id),
      fiscalPeriodId,
      "fiscalPeriodId"
    );

    const result = await query(
      `SELECT
         a.id AS account_id,
         a.code AS account_code,
         a.name AS account_name,
         SUM(jl.debit_base) AS debit_total,
         SUM(jl.credit_base) AS credit_total,
         SUM(jl.debit_base - jl.credit_base) AS balance
       FROM journal_entries je
       JOIN journal_lines jl ON jl.journal_entry_id = je.id
       JOIN accounts a ON a.id = jl.account_id
       WHERE je.tenant_id = ?
         AND je.book_id = ?
         AND je.fiscal_period_id = ?
         AND je.status = 'POSTED'
       GROUP BY a.id, a.code, a.name
       ORDER BY a.code`,
      [tenantId, bookId, fiscalPeriodId]
    );

    const postedRows = (result.rows || []).map((row) => ({
      account_id: parsePositiveInt(row.account_id),
      account_code: row.account_code,
      account_name: row.account_name,
      debit_total: Number(row.debit_total || 0),
      credit_total: Number(row.credit_total || 0),
      balance: Number(row.balance || 0),
      is_rollup: false,
      direct_debit_total: Number(row.debit_total || 0),
      direct_credit_total: Number(row.credit_total || 0),
      direct_balance: Number(row.balance || 0),
    }));

    const summary = postedRows.reduce(
      (acc, row) => {
        acc.debitTotal += Number(row.debit_total || 0);
        acc.creditTotal += Number(row.credit_total || 0);
        acc.balanceTotal += Number(row.balance || 0);
        return acc;
      },
      { debitTotal: 0, creditTotal: 0, balanceTotal: 0 }
    );

    if (!includeRollup) {
      return res.json({
        bookId,
        fiscalPeriodId,
        includeRollup,
        summary,
        rows: postedRows,
      });
    }

    const bookLegalEntityId = parsePositiveInt(book.legal_entity_id);
    const hierarchyParams = [tenantId];
    const hierarchyConditions = ["c.tenant_id = ?"];
    if (bookLegalEntityId) {
      hierarchyConditions.push("(c.legal_entity_id IS NULL OR c.legal_entity_id = ?)");
      hierarchyParams.push(bookLegalEntityId);
    }

    const hierarchyResult = await query(
      `SELECT
         a.id,
         a.parent_account_id,
         a.code,
         a.name
       FROM accounts a
       JOIN charts_of_accounts c ON c.id = a.coa_id
       WHERE ${hierarchyConditions.join(" AND ")}`,
      hierarchyParams
    );

    const accountById = new Map();
    for (const row of hierarchyResult.rows || []) {
      const accountId = parsePositiveInt(row.id);
      if (!accountId) {
        continue;
      }
      accountById.set(accountId, {
        id: accountId,
        parentAccountId: parsePositiveInt(row.parent_account_id),
        code: String(row.code || `ACC-${accountId}`),
        name: String(row.name || `Account ${accountId}`),
      });
    }

    const aggregateByAccountId = new Map();
    for (const row of postedRows) {
      const accountId = parsePositiveInt(row.account_id);
      if (!accountId) {
        continue;
      }

      if (!accountById.has(accountId)) {
        accountById.set(accountId, {
          id: accountId,
          parentAccountId: null,
          code: String(row.account_code || `ACC-${accountId}`),
          name: String(row.account_name || `Account ${accountId}`),
        });
      }

      const current = aggregateByAccountId.get(accountId) || {
        debitTotal: 0,
        creditTotal: 0,
        balance: 0,
        directDebitTotal: 0,
        directCreditTotal: 0,
        directBalance: 0,
      };
      current.debitTotal += Number(row.debit_total || 0);
      current.creditTotal += Number(row.credit_total || 0);
      current.balance += Number(row.balance || 0);
      current.directDebitTotal += Number(row.debit_total || 0);
      current.directCreditTotal += Number(row.credit_total || 0);
      current.directBalance += Number(row.balance || 0);
      aggregateByAccountId.set(accountId, current);

      let parentAccountId = parsePositiveInt(accountById.get(accountId)?.parentAccountId);
      const visited = new Set([accountId]);
      while (parentAccountId && !visited.has(parentAccountId)) {
        visited.add(parentAccountId);
        const parentCurrent = aggregateByAccountId.get(parentAccountId) || {
          debitTotal: 0,
          creditTotal: 0,
          balance: 0,
          directDebitTotal: 0,
          directCreditTotal: 0,
          directBalance: 0,
        };
        parentCurrent.debitTotal += Number(row.debit_total || 0);
        parentCurrent.creditTotal += Number(row.credit_total || 0);
        parentCurrent.balance += Number(row.balance || 0);
        aggregateByAccountId.set(parentAccountId, parentCurrent);

        const parentAccount = accountById.get(parentAccountId);
        if (!parentAccount) {
          break;
        }
        parentAccountId = parsePositiveInt(parentAccount.parentAccountId);
      }
    }

    const rows = [];
    for (const [accountId, totals] of aggregateByAccountId.entries()) {
      const debitTotal = Number(totals.debitTotal || 0);
      const creditTotal = Number(totals.creditTotal || 0);
      const balance = Number(totals.balance || 0);
      if (isNearlyZero(debitTotal) && isNearlyZero(creditTotal) && isNearlyZero(balance)) {
        continue;
      }

      const account = accountById.get(accountId);
      rows.push({
        account_id: accountId,
        account_code: account?.code || `ACC-${accountId}`,
        account_name: account?.name || `Account ${accountId}`,
        debit_total: debitTotal,
        credit_total: creditTotal,
        balance,
        is_rollup:
          isNearlyZero(Number(totals.directDebitTotal || 0)) &&
          isNearlyZero(Number(totals.directCreditTotal || 0)),
        direct_debit_total: Number(totals.directDebitTotal || 0),
        direct_credit_total: Number(totals.directCreditTotal || 0),
        direct_balance: Number(totals.directBalance || 0),
      });
    }

    rows.sort((a, b) => {
      const codeCompare = String(a.account_code || "").localeCompare(
        String(b.account_code || "")
      );
      if (codeCompare !== 0) {
        return codeCompare;
      }
      return Number(a.account_id) - Number(b.account_id);
    });

    return res.json({
      bookId,
      fiscalPeriodId,
      includeRollup,
      summary,
      rows,
    });
  })
);

router.get(
  "/period-closing/runs",
  requirePermission("gl.period.close", {
    resolveScope: async (req, tenantId) => {
      return resolveScopeFromBookId(req.query?.bookId, tenantId);
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const bookId = parsePositiveInt(req.query.bookId);
    const fiscalPeriodId = parsePositiveInt(req.query.fiscalPeriodId);
    const status = req.query.status ? String(req.query.status).toUpperCase() : null;
    const includeLines = String(req.query.includeLines || "").toLowerCase() === "true";

    if (status && !CLOSE_RUN_STATUSES.has(status)) {
      throw badRequest("status must be one of IN_PROGRESS, COMPLETED, FAILED, REOPENED");
    }

    if (bookId) {
      const book = await assertBookBelongsToTenant(tenantId, bookId, "bookId");
      assertScopeAccess(req, "legal_entity", parsePositiveInt(book.legal_entity_id), "bookId");
    }

    const params = [tenantId];
    const conditions = ["r.tenant_id = ?"];
    conditions.push(buildScopeFilter(req, "legal_entity", "b.legal_entity_id", params));

    if (bookId) {
      conditions.push("r.book_id = ?");
      params.push(bookId);
    }
    if (fiscalPeriodId) {
      conditions.push("r.fiscal_period_id = ?");
      params.push(fiscalPeriodId);
    }
    if (status) {
      conditions.push("r.status = ?");
      params.push(status);
    }

    const result = await query(
      `SELECT
         r.*,
         b.code AS book_code,
         b.name AS book_name,
         fp.fiscal_year,
         fp.period_no,
         fp.period_name
       FROM period_close_runs r
       JOIN books b ON b.id = r.book_id
       JOIN fiscal_periods fp ON fp.id = r.fiscal_period_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY r.id DESC
       LIMIT 250`,
      params
    );

    const rows = (result.rows || []).map((row) => mapPeriodCloseRunRow(row));

    if (includeLines && rows.length > 0) {
      const runIds = rows.map((row) => row.id).filter(Boolean);
      if (runIds.length > 0) {
        const placeholders = runIds.map(() => "?").join(", ");
        const lineResult = await query(
          `SELECT
             l.period_close_run_id,
             l.line_type,
             l.account_id,
             l.closing_balance,
             l.debit_base,
             l.credit_base,
             a.code AS account_code,
             a.name AS account_name
           FROM period_close_run_lines l
           JOIN accounts a ON a.id = l.account_id
           WHERE l.period_close_run_id IN (${placeholders})
           ORDER BY l.period_close_run_id, l.line_type, a.code`,
          runIds
        );

        const linesByRunId = new Map();
        for (const line of lineResult.rows || []) {
          const runId = parsePositiveInt(line.period_close_run_id);
          if (!runId) {
            continue;
          }
          if (!linesByRunId.has(runId)) {
            linesByRunId.set(runId, []);
          }
          linesByRunId.get(runId).push({
            lineType: String(line.line_type || ""),
            accountId: parsePositiveInt(line.account_id),
            accountCode: line.account_code || null,
            accountName: line.account_name || null,
            closingBalance: Number(line.closing_balance || 0),
            debitBase: Number(line.debit_base || 0),
            creditBase: Number(line.credit_base || 0),
          });
        }

        for (const row of rows) {
          row.lines = linesByRunId.get(row.id) || [];
        }
      }
    }

    return res.json({
      tenantId,
      rows,
    });
  })
);

router.post(
  "/period-closing/:bookId/:periodId/close-run",
  requirePermission("gl.period.close", {
    resolveScope: async (req, tenantId) => {
      return resolveScopeFromBookId(req.params?.bookId, tenantId);
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const userId = parsePositiveInt(req.user?.userId);
    if (!userId) {
      throw badRequest("Authenticated user is required");
    }

    const bookId = parsePositiveInt(req.params.bookId);
    const fiscalPeriodId = parsePositiveInt(req.params.periodId);
    if (!bookId || !fiscalPeriodId) {
      throw badRequest("bookId and periodId must be positive integers");
    }

    const book = await assertBookBelongsToTenant(tenantId, bookId, "bookId");
    const legalEntityId = parsePositiveInt(book.legal_entity_id);
    if (legalEntityId) {
      assertScopeAccess(req, "legal_entity", legalEntityId, "bookId");
    }

    await assertFiscalPeriodBelongsToCalendar(
      parsePositiveInt(book.calendar_id),
      fiscalPeriodId,
      "periodId"
    );
    const currentPeriod = await getFiscalPeriodDetails(fiscalPeriodId);
    if (!currentPeriod) {
      throw badRequest("periodId not found");
    }

    const nextPeriod = await findNextFiscalPeriod(
      parsePositiveInt(book.calendar_id),
      currentPeriod.end_date
    );
    if (!nextPeriod) {
      throw badRequest(
        "No next fiscal period found for carry-forward. Generate next periods first."
      );
    }

    const isYearEnd =
      Number(nextPeriod.fiscal_year || 0) !== Number(currentPeriod.fiscal_year || 0);

    const closeStatus = normalizeCloseTargetStatus(req.body?.closeStatus);
    const note = req.body?.note ? String(req.body.note) : null;

    const retainedEarningsAccountIdRaw =
      req.body?.retainedEarningsAccountId === undefined ||
      req.body?.retainedEarningsAccountId === null ||
      req.body?.retainedEarningsAccountId === ""
        ? null
        : parsePositiveInt(req.body?.retainedEarningsAccountId);

    if (
      req.body?.retainedEarningsAccountId !== undefined &&
      req.body?.retainedEarningsAccountId !== null &&
      req.body?.retainedEarningsAccountId !== "" &&
      !retainedEarningsAccountIdRaw
    ) {
      throw badRequest("retainedEarningsAccountId must be a positive integer");
    }

    if (isYearEnd && !retainedEarningsAccountIdRaw) {
      throw badRequest("retainedEarningsAccountId is required for year-end P&L closing");
    }

    let retainedAccount = null;
    if (retainedEarningsAccountIdRaw) {
      retainedAccount = await getRetainedEarningsAccountForBook(
        tenantId,
        legalEntityId,
        retainedEarningsAccountIdRaw
      );
    }

    const sourceFingerprint = await getPeriodSourceFingerprint(
      tenantId,
      bookId,
      fiscalPeriodId
    );

    const runHash = computeCloseRunHash({
      tenantId,
      bookId,
      fiscalPeriodId,
      nextFiscalPeriodId: parsePositiveInt(nextPeriod.id),
      closeStatus,
      isYearEnd,
      retainedEarningsAccountId: retainedAccount?.id || null,
      sourceFingerprint,
    });

    const closeResult = await withTransaction(async (tx) => {
      const existingResult = await tx.query(
        `SELECT *
         FROM period_close_runs
         WHERE tenant_id = ?
           AND book_id = ?
           AND fiscal_period_id = ?
           AND run_hash = ?
         LIMIT 1
         FOR UPDATE`,
        [tenantId, bookId, fiscalPeriodId, runHash]
      );
      const existingRun = existingResult.rows[0] || null;

      const currentStatus = await getEffectivePeriodStatus(
        bookId,
        fiscalPeriodId,
        tx.query
      );

      if (
        existingRun &&
        String(existingRun.status || "").toUpperCase() === "COMPLETED" &&
        !existingRun.reopened_at
      ) {
        const existingCloseStatus = String(existingRun.close_status || "").toUpperCase();
        if (existingCloseStatus && existingCloseStatus !== currentStatus) {
          await tx.query(
            `INSERT INTO period_statuses (
                book_id, fiscal_period_id, status, closed_by_user_id, closed_at, note
             )
             VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
             ON DUPLICATE KEY UPDATE
               status = VALUES(status),
               closed_by_user_id = VALUES(closed_by_user_id),
               closed_at = VALUES(closed_at),
               note = VALUES(note)`,
            [
              bookId,
              fiscalPeriodId,
              existingCloseStatus,
              userId,
              `Idempotent close run #${existingRun.id} reapplied`,
            ]
          );
        }

        const rowResult = await tx.query(
          `SELECT
             r.*,
             b.code AS book_code,
             b.name AS book_name,
             fp.fiscal_year,
             fp.period_no,
             fp.period_name
           FROM period_close_runs r
           JOIN books b ON b.id = r.book_id
           JOIN fiscal_periods fp ON fp.id = r.fiscal_period_id
           WHERE r.id = ?
           LIMIT 1`,
          [existingRun.id]
        );

        return {
          idempotent: true,
          previousStatus: currentStatus,
          run: mapPeriodCloseRunRow(rowResult.rows[0] || existingRun),
          carryForwardLineCount: Number(
            parseJsonColumn(existingRun.metadata_json)?.carryForwardLineCount || 0
          ),
          yearEndLineCount: Number(
            parseJsonColumn(existingRun.metadata_json)?.yearEndLineCount || 0
          ),
        };
      }

      if (currentStatus === "HARD_CLOSED") {
        throw badRequest("Period is HARD_CLOSED. Reopen the period before running close again.");
      }

      let runId = parsePositiveInt(existingRun?.id);
      const existingStatus = String(existingRun?.status || "").toUpperCase();
      if (existingRun && existingStatus === "IN_PROGRESS") {
        throw badRequest("A close run is already in progress for this period hash");
      }

      if (runId) {
        await tx.query(
          `UPDATE period_close_runs
           SET status = 'IN_PROGRESS',
               close_status = ?,
               next_fiscal_period_id = ?,
               year_end_closed = FALSE,
               retained_earnings_account_id = ?,
               carry_forward_journal_entry_id = NULL,
               year_end_journal_entry_id = NULL,
               source_journal_count = ?,
               source_debit_total = ?,
               source_credit_total = ?,
               started_by_user_id = ?,
               completed_by_user_id = NULL,
               reopened_by_user_id = NULL,
               started_at = CURRENT_TIMESTAMP,
               completed_at = NULL,
               reopened_at = NULL,
               note = ?,
               metadata_json = NULL
           WHERE id = ?`,
          [
            closeStatus,
            parsePositiveInt(nextPeriod.id),
            retainedAccount?.id || null,
            sourceFingerprint.sourceJournalCount,
            sourceFingerprint.sourceDebitTotal,
            sourceFingerprint.sourceCreditTotal,
            userId,
            note,
            runId,
          ]
        );

        await tx.query(
          `DELETE FROM period_close_run_lines
           WHERE period_close_run_id = ?`,
          [runId]
        );
      } else {
        const insertResult = await tx.query(
          `INSERT INTO period_close_runs (
              tenant_id,
              book_id,
              fiscal_period_id,
              next_fiscal_period_id,
              run_hash,
              close_status,
              status,
              year_end_closed,
              retained_earnings_account_id,
              source_journal_count,
              source_debit_total,
              source_credit_total,
              started_by_user_id,
              note
           )
           VALUES (?, ?, ?, ?, ?, ?, 'IN_PROGRESS', FALSE, ?, ?, ?, ?, ?, ?)`,
          [
            tenantId,
            bookId,
            fiscalPeriodId,
            parsePositiveInt(nextPeriod.id),
            runHash,
            closeStatus,
            retainedAccount?.id || null,
            sourceFingerprint.sourceJournalCount,
            sourceFingerprint.sourceDebitTotal,
            sourceFingerprint.sourceCreditTotal,
            userId,
            note,
          ]
        );
        runId = parsePositiveInt(insertResult.rows.insertId);
      }

      if (!runId) {
        throw badRequest("Failed to initialize period close run");
      }

      const balances = await getPostedPeriodAccountBalances(
        tenantId,
        bookId,
        fiscalPeriodId,
        tx.query
      );

      const carryForwardBalanceByAccountId = new Map();
      const accountCodeById = new Map();
      for (const row of balances) {
        const accountId = parsePositiveInt(row.account_id);
        if (!accountId) {
          continue;
        }

        accountCodeById.set(accountId, String(row.account_code || `ACC-${accountId}`));

        const accountType = String(row.account_type || "").toUpperCase();
        if (!["REVENUE", "EXPENSE"].includes(accountType)) {
          carryForwardBalanceByAccountId.set(accountId, Number(row.closing_balance || 0));
        }
      }

      const pnlCloseLines = balances
        .filter((row) => ["REVENUE", "EXPENSE"].includes(String(row.account_type || "").toUpperCase()))
        .map((row) => buildYearEndCloseLine(row))
        .filter(Boolean);

      const yearEndLines = [];
      if (isYearEnd) {
        if (!retainedAccount?.id) {
          throw badRequest("retainedEarningsAccountId is required for year-end P&L closing");
        }

        yearEndLines.push(...pnlCloseLines);

        const pnlDebitTotal = pnlCloseLines.reduce(
          (sum, line) => sum + Number(line.debitBase || 0),
          0
        );
        const pnlCreditTotal = pnlCloseLines.reduce(
          (sum, line) => sum + Number(line.creditBase || 0),
          0
        );
        const retainedDifference = pnlDebitTotal - pnlCreditTotal;
        if (!isNearlyZero(retainedDifference)) {
          let retainedLine = null;
          if (retainedDifference > 0) {
            retainedLine = {
              accountId: retainedAccount.id,
              closingBalance: retainedDifference * -1,
              debitBase: 0,
              creditBase: retainedDifference,
              description: "Year-end transfer to retained earnings",
            };
          } else {
            retainedLine = {
              accountId: retainedAccount.id,
              closingBalance: Math.abs(retainedDifference),
              debitBase: Math.abs(retainedDifference),
              creditBase: 0,
              description: "Year-end transfer to retained earnings",
            };
          }

          if (retainedLine) {
            yearEndLines.push(retainedLine);
            accountCodeById.set(
              retainedAccount.id,
              String(retainedAccount.code || `ACC-${retainedAccount.id}`)
            );
            const currentRetainedBalance = Number(
              carryForwardBalanceByAccountId.get(retainedAccount.id) || 0
            );
            carryForwardBalanceByAccountId.set(
              retainedAccount.id,
              currentRetainedBalance +
                (Number(retainedLine.debitBase || 0) - Number(retainedLine.creditBase || 0))
            );
          }
        }
      }

      const carryForwardLines = [];
      for (const [accountId, closingBalanceRaw] of carryForwardBalanceByAccountId.entries()) {
        const closingBalance = Number(closingBalanceRaw || 0);
        if (isNearlyZero(closingBalance)) {
          continue;
        }

        const accountCode = accountCodeById.get(accountId) || `ACC-${accountId}`;
        if (closingBalance > 0) {
          carryForwardLines.push({
            accountId,
            closingBalance,
            debitBase: closingBalance,
            creditBase: 0,
            description: `Opening from previous period (${accountCode})`,
          });
        } else {
          carryForwardLines.push({
            accountId,
            closingBalance,
            debitBase: 0,
            creditBase: Math.abs(closingBalance),
            description: `Opening from previous period (${accountCode})`,
          });
        }
      }

      let carryForwardJournalEntryId = null;
      if (carryForwardLines.length > 0) {
        const nextPeriodStatus = await getEffectivePeriodStatus(
          bookId,
          parsePositiveInt(nextPeriod.id),
          tx.query
        );
        if (nextPeriodStatus === "HARD_CLOSED") {
          throw badRequest(
            "Next period is HARD_CLOSED; cannot post opening carry-forward entry"
          );
        }

        const carryJournal = await createSystemJournalWithLines(tx, {
          tenantId,
          legalEntityId,
          bookId,
          fiscalPeriodId: parsePositiveInt(nextPeriod.id),
          journalNo: buildSystemJournalNo("CARRY", runId),
          entryDate: String(nextPeriod.start_date),
          documentDate: String(nextPeriod.start_date),
          currencyCode: String(book.base_currency_code || "USD").toUpperCase(),
          description: `Auto carry-forward opening balances from FY${currentPeriod.fiscal_year} P${currentPeriod.period_no}`,
          referenceNo: `PERIOD_CLOSE_RUN:${runId}`,
          userId,
          lines: carryForwardLines,
        });
        carryForwardJournalEntryId = parsePositiveInt(carryJournal?.journalEntryId);
      }

      let yearEndJournalEntryId = null;
      if (isYearEnd && yearEndLines.length > 0) {
        const yearEndJournal = await createSystemJournalWithLines(tx, {
          tenantId,
          legalEntityId,
          bookId,
          fiscalPeriodId,
          journalNo: buildSystemJournalNo("YECLOSE", runId),
          entryDate: String(currentPeriod.end_date),
          documentDate: String(currentPeriod.end_date),
          currencyCode: String(book.base_currency_code || "USD").toUpperCase(),
          description: `Auto year-end P&L close FY${currentPeriod.fiscal_year} P${currentPeriod.period_no}`,
          referenceNo: `PERIOD_CLOSE_RUN:${runId}`,
          userId,
          lines: yearEndLines,
        });
        yearEndJournalEntryId = parsePositiveInt(yearEndJournal?.journalEntryId);
      }

      for (const line of carryForwardLines) {
        // eslint-disable-next-line no-await-in-loop
        await tx.query(
          `INSERT INTO period_close_run_lines (
              period_close_run_id,
              tenant_id,
              line_type,
              account_id,
              closing_balance,
              debit_base,
              credit_base
           )
           VALUES (?, ?, 'CARRY_FORWARD', ?, ?, ?, ?)`,
          [
            runId,
            tenantId,
            parsePositiveInt(line.accountId),
            Number(line.closingBalance || 0),
            Number(line.debitBase || 0),
            Number(line.creditBase || 0),
          ]
        );
      }

      for (const line of yearEndLines) {
        // eslint-disable-next-line no-await-in-loop
        await tx.query(
          `INSERT INTO period_close_run_lines (
              period_close_run_id,
              tenant_id,
              line_type,
              account_id,
              closing_balance,
              debit_base,
              credit_base
           )
           VALUES (?, ?, 'YEAR_END', ?, ?, ?, ?)`,
          [
            runId,
            tenantId,
            parsePositiveInt(line.accountId),
            Number(line.closingBalance || 0),
            Number(line.debitBase || 0),
            Number(line.creditBase || 0),
          ]
        );
      }

      await tx.query(
        `INSERT INTO period_statuses (
            book_id, fiscal_period_id, status, closed_by_user_id, closed_at, note
         )
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
         ON DUPLICATE KEY UPDATE
           status = VALUES(status),
           closed_by_user_id = VALUES(closed_by_user_id),
           closed_at = VALUES(closed_at),
           note = VALUES(note)`,
        [
          bookId,
          fiscalPeriodId,
          closeStatus,
          userId,
          `Period close run #${runId}${note ? `: ${note}` : ""}`,
        ]
      );

      const metadata = {
        nextFiscalPeriodId: parsePositiveInt(nextPeriod.id),
        isYearEnd,
        carryForwardLineCount: carryForwardLines.length,
        yearEndLineCount: yearEndLines.length,
        sourceFingerprint,
      };

      await tx.query(
        `UPDATE period_close_runs
         SET status = 'COMPLETED',
             year_end_closed = ?,
             retained_earnings_account_id = ?,
             carry_forward_journal_entry_id = ?,
             year_end_journal_entry_id = ?,
             completed_by_user_id = ?,
             completed_at = CURRENT_TIMESTAMP,
             metadata_json = ?
         WHERE id = ?`,
        [
          isYearEnd,
          retainedAccount?.id || null,
          carryForwardJournalEntryId,
          yearEndJournalEntryId,
          userId,
          JSON.stringify(metadata),
          runId,
        ]
      );

      await writeAuditLog(tx.query, req, {
        tenantId,
        userId,
        action: "gl.period_close.execute",
        resourceType: "period_close_run",
        resourceId: String(runId),
        scopeType: "LEGAL_ENTITY",
        scopeId: legalEntityId,
        payload: {
          bookId,
          fiscalPeriodId,
          closeStatus,
          runHash,
          isYearEnd,
          retainedEarningsAccountId: retainedAccount?.id || null,
          carryForwardJournalEntryId,
          yearEndJournalEntryId,
          carryForwardLineCount: carryForwardLines.length,
          yearEndLineCount: yearEndLines.length,
          sourceFingerprint,
        },
      });

      const runResult = await tx.query(
        `SELECT
           r.*,
           b.code AS book_code,
           b.name AS book_name,
           fp.fiscal_year,
           fp.period_no,
           fp.period_name
         FROM period_close_runs r
         JOIN books b ON b.id = r.book_id
         JOIN fiscal_periods fp ON fp.id = r.fiscal_period_id
         WHERE r.id = ?
         LIMIT 1`,
        [runId]
      );

      return {
        idempotent: false,
        previousStatus: currentStatus,
        run: mapPeriodCloseRunRow(runResult.rows[0]),
        carryForwardLineCount: carryForwardLines.length,
        yearEndLineCount: yearEndLines.length,
      };
    });

    return res.status(closeResult.idempotent ? 200 : 201).json({
      ok: true,
      tenantId,
      idempotent: closeResult.idempotent,
      previousStatus: closeResult.previousStatus,
      run: closeResult.run,
      carryForwardLineCount: closeResult.carryForwardLineCount,
      yearEndLineCount: closeResult.yearEndLineCount,
    });
  })
);

router.post(
  "/period-closing/:bookId/:periodId/reopen",
  requirePermission("gl.period.close", {
    resolveScope: async (req, tenantId) => {
      return resolveScopeFromBookId(req.params?.bookId, tenantId);
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const userId = parsePositiveInt(req.user?.userId);
    if (!userId) {
      throw badRequest("Authenticated user is required");
    }

    const bookId = parsePositiveInt(req.params.bookId);
    const fiscalPeriodId = parsePositiveInt(req.params.periodId);
    if (!bookId || !fiscalPeriodId) {
      throw badRequest("bookId and periodId must be positive integers");
    }

    const reason = req.body?.reason ? String(req.body.reason).trim() : null;
    if (!reason) {
      throw badRequest("reason is required to reopen a closed period");
    }

    const book = await assertBookBelongsToTenant(tenantId, bookId, "bookId");
    const legalEntityId = parsePositiveInt(book.legal_entity_id);
    if (legalEntityId) {
      assertScopeAccess(req, "legal_entity", legalEntityId, "bookId");
    }

    await assertFiscalPeriodBelongsToCalendar(
      parsePositiveInt(book.calendar_id),
      fiscalPeriodId,
      "periodId"
    );

    const reopenResult = await withTransaction(async (tx) => {
      const currentStatus = await getEffectivePeriodStatus(
        bookId,
        fiscalPeriodId,
        tx.query
      );

      const runResult = await tx.query(
        `SELECT *
         FROM period_close_runs
         WHERE tenant_id = ?
           AND book_id = ?
           AND fiscal_period_id = ?
           AND status = 'COMPLETED'
         ORDER BY id DESC
         LIMIT 1
         FOR UPDATE`,
        [tenantId, bookId, fiscalPeriodId]
      );
      const run = runResult.rows[0] || null;

      const reversalJournalEntryIds = [];
      if (run) {
        const carryReversalId = await reversePostedJournalWithinTransaction(tx, {
          tenantId,
          journalId: parsePositiveInt(run.carry_forward_journal_entry_id),
          userId,
          reason: `Reopen period close run #${run.id}: ${reason}`,
        });
        if (carryReversalId) {
          reversalJournalEntryIds.push(carryReversalId);
        }

        const yearEndReversalId = await reversePostedJournalWithinTransaction(tx, {
          tenantId,
          journalId: parsePositiveInt(run.year_end_journal_entry_id),
          userId,
          reason: `Reopen period close run #${run.id}: ${reason}`,
        });
        if (yearEndReversalId) {
          reversalJournalEntryIds.push(yearEndReversalId);
        }

        const mergedMetadata = {
          ...(parseJsonColumn(run.metadata_json) || {}),
          reopen: {
            reopenedByUserId: userId,
            reopenedAt: new Date().toISOString(),
            reason,
            reversalJournalEntryIds,
          },
        };

        await tx.query(
          `UPDATE period_close_runs
           SET status = 'REOPENED',
               reopened_by_user_id = ?,
               reopened_at = CURRENT_TIMESTAMP,
               note = ?,
               metadata_json = ?
           WHERE id = ?`,
          [userId, reason, JSON.stringify(mergedMetadata), run.id]
        );
      }

      await tx.query(
        `INSERT INTO period_statuses (
            book_id, fiscal_period_id, status, closed_by_user_id, closed_at, note
         )
         VALUES (?, ?, 'OPEN', ?, CURRENT_TIMESTAMP, ?)
         ON DUPLICATE KEY UPDATE
           status = 'OPEN',
           closed_by_user_id = VALUES(closed_by_user_id),
           closed_at = VALUES(closed_at),
           note = VALUES(note)`,
        [bookId, fiscalPeriodId, userId, `Reopened: ${reason}`]
      );

      await writeAuditLog(tx.query, req, {
        tenantId,
        userId,
        action: "gl.period_close.reopen",
        resourceType: "period_close_run",
        resourceId: run ? String(run.id) : null,
        scopeType: "LEGAL_ENTITY",
        scopeId: legalEntityId,
        payload: {
          bookId,
          fiscalPeriodId,
          previousStatus: currentStatus,
          reason,
          reversalJournalEntryIds,
          runId: run ? parsePositiveInt(run.id) : null,
        },
      });

      let runPayload = null;
      if (run) {
        const latestRunResult = await tx.query(
          `SELECT
             r.*,
             b.code AS book_code,
             b.name AS book_name,
             fp.fiscal_year,
             fp.period_no,
             fp.period_name
           FROM period_close_runs r
           JOIN books b ON b.id = r.book_id
           JOIN fiscal_periods fp ON fp.id = r.fiscal_period_id
           WHERE r.id = ?
           LIMIT 1`,
          [run.id]
        );
        runPayload = mapPeriodCloseRunRow(latestRunResult.rows[0] || run);
      }

      return {
        previousStatus: currentStatus,
        status: "OPEN",
        run: runPayload,
        reversalJournalEntryIds,
      };
    });

    return res.status(201).json({
      ok: true,
      tenantId,
      bookId,
      fiscalPeriodId,
      previousStatus: reopenResult.previousStatus,
      status: reopenResult.status,
      run: reopenResult.run,
      reversalJournalEntryIds: reopenResult.reversalJournalEntryIds,
    });
  })
);

router.post(
  "/period-statuses/:bookId/:periodId/close",
  requirePermission("gl.period.close", {
    resolveScope: async (req, tenantId) => {
      return resolveScopeFromBookId(req.params?.bookId, tenantId);
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) throw badRequest("tenantId is required");

    const bookId = parsePositiveInt(req.params.bookId);
    const fiscalPeriodId = parsePositiveInt(req.params.periodId);
    if (!bookId || !fiscalPeriodId) {
      throw badRequest("bookId and periodId must be positive integers");
    }

    const book = await assertBookBelongsToTenant(tenantId, bookId, "bookId");
    await assertFiscalPeriodBelongsToCalendar(
      parsePositiveInt(book.calendar_id),
      fiscalPeriodId,
      "periodId"
    );

    const status = String(req.body.status || "SOFT_CLOSED").toUpperCase();
    if (!PERIOD_STATUSES.has(status)) {
      throw badRequest("status must be one of OPEN, SOFT_CLOSED, HARD_CLOSED");
    }

    const note = req.body.note ? String(req.body.note) : null;
    const userId = parsePositiveInt(req.user?.userId);
    const currentStatus = await getEffectivePeriodStatus(bookId, fiscalPeriodId);

    if (currentStatus === "HARD_CLOSED" && status !== "HARD_CLOSED") {
      throw badRequest("HARD_CLOSED periods cannot be re-opened or softened");
    }

    await query(
      `INSERT INTO period_statuses (
          book_id, fiscal_period_id, status, closed_by_user_id, closed_at, note
        )
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
       ON DUPLICATE KEY UPDATE
         status = VALUES(status),
         closed_by_user_id = VALUES(closed_by_user_id),
         closed_at = VALUES(closed_at),
         note = VALUES(note)`,
      [bookId, fiscalPeriodId, status, userId, note]
    );

    return res.status(201).json({
      ok: true,
      bookId,
      fiscalPeriodId,
      status,
      previousStatus: currentStatus,
    });
  })
);

export default router;
