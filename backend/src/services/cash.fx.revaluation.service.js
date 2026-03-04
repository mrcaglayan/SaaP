import crypto from "node:crypto";
import { query, withTransaction } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";

const RUN_TYPE_MONTH_END = "MONTH_END";
const RUN_TYPE_YEAR_END = "YEAR_END";
const RUN_STATUS_DRAFT = "DRAFT";
const RUN_STATUS_COMPLETED = "COMPLETED";
const RUN_STATUS_FAILED = "FAILED";
const FX_RATE_TYPE_SPOT = "SPOT";
const FX_FALLBACK_MODE_EXACT_ONLY = "EXACT_ONLY";
const FX_FALLBACK_MODE_PRIOR_DATE = "PRIOR_DATE";
const PURPOSE_CODE_GAIN = "CASH_FX_REVALUATION_GAIN";
const PURPOSE_CODE_LOSS = "CASH_FX_REVALUATION_LOSS";
const REVERSAL_STATUS_PENDING = "PENDING";
const REVERSAL_STATUS_POSTED = "POSTED";
const REVERSAL_STATUS_NOT_REQUIRED = "NOT_REQUIRED";
const REVERSAL_STATUS_BLOCKED_HARD_CLOSED = "BLOCKED_HARD_CLOSED";
const AMOUNT_EPSILON = 0.000001;

function asUpper(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeText(value, fieldLabel, maxLength = 255) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) {
    throw badRequest(`${fieldLabel} must be at most ${maxLength} characters`);
  }
  return normalized;
}

function normalizeDateOnly(value, fieldLabel) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw badRequest(`${fieldLabel} must be YYYY-MM-DD`);
    }
    return value.toISOString().slice(0, 10);
  }
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw badRequest(`${fieldLabel} must be YYYY-MM-DD`);
  }
  return parsed.toISOString().slice(0, 10);
}

function normalizeRunType(value) {
  const normalized = asUpper(value);
  if (normalized === RUN_TYPE_MONTH_END || normalized === RUN_TYPE_YEAR_END) {
    return normalized;
  }
  throw badRequest("runType must be MONTH_END or YEAR_END");
}

function roundAmount(value) {
  return Number(Number(value || 0).toFixed(6));
}

function isNearlyZero(value, epsilon = AMOUNT_EPSILON) {
  return Math.abs(Number(value || 0)) <= epsilon;
}

function normalizeFallbackMode(value, fallback) {
  const normalized = asUpper(value || fallback || FX_FALLBACK_MODE_EXACT_ONLY);
  if (
    normalized !== FX_FALLBACK_MODE_EXACT_ONLY &&
    normalized !== FX_FALLBACK_MODE_PRIOR_DATE
  ) {
    throw badRequest("fxFallbackMode must be EXACT_ONLY or PRIOR_DATE");
  }
  return normalized;
}

function normalizeFallbackMaxDays(value, fallbackMode) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw badRequest("fxFallbackMaxDays must be a non-negative integer");
  }
  if (fallbackMode !== FX_FALLBACK_MODE_PRIOR_DATE) {
    throw badRequest("fxFallbackMaxDays is only supported when fxFallbackMode=PRIOR_DATE");
  }
  return parsed;
}

const DEFAULT_FALLBACK_MODE =
  asUpper(process.env.CASH_FX_REVALUATION_FX_FALLBACK_MODE) === FX_FALLBACK_MODE_PRIOR_DATE
    ? FX_FALLBACK_MODE_PRIOR_DATE
    : FX_FALLBACK_MODE_EXACT_ONLY;
const DEFAULT_FALLBACK_MAX_DAYS = (() => {
  const raw = process.env.CASH_FX_REVALUATION_FX_FALLBACK_MAX_DAYS;
  if (raw === undefined || raw === null || raw === "") return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  if (DEFAULT_FALLBACK_MODE !== FX_FALLBACK_MODE_PRIOR_DATE) return null;
  return parsed;
})();

function normalizeIdempotencyKey(value, fallback) {
  return normalizeText(value, "idempotencyKey", 100) || normalizeText(fallback, "idempotencyKey", 100);
}

function buildRunHash(payload) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(payload || {}))
    .digest("hex");
}

function inferRunType(period, nextPeriod) {
  const year = Number(period?.fiscal_year || 0);
  const nextYear = Number(nextPeriod?.fiscal_year || year);
  return nextYear !== year ? RUN_TYPE_YEAR_END : RUN_TYPE_MONTH_END;
}

function signedAmountCase(columnSql) {
  return `
    CASE
      WHEN ct.txn_type IN ('RECEIPT','WITHDRAWAL_FROM_BANK','TRANSFER_IN','OPENING_FLOAT') THEN ${columnSql}
      WHEN ct.txn_type IN ('PAYOUT','DEPOSIT_TO_BANK','TRANSFER_OUT','CLOSING_ADJUSTMENT') THEN -${columnSql}
      ELSE 0
    END
  `;
}

async function loadBookRow({ tenantId, bookId, runQuery = query }) {
  const result = await runQuery(
    `SELECT id, tenant_id, legal_entity_id, calendar_id, base_currency_code
     FROM books
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, bookId]
  );
  return result.rows?.[0] || null;
}

async function loadPeriodRow({ calendarId, fiscalPeriodId, runQuery = query }) {
  const result = await runQuery(
    `SELECT id, calendar_id, fiscal_year, period_no, period_name, start_date, end_date
     FROM fiscal_periods
     WHERE id = ?
       AND calendar_id = ?
     LIMIT 1`,
    [fiscalPeriodId, calendarId]
  );
  return result.rows?.[0] || null;
}

async function loadNextPeriod({ calendarId, periodEndDate, runQuery = query }) {
  const result = await runQuery(
    `SELECT id, fiscal_year, period_no, start_date, end_date
     FROM fiscal_periods
     WHERE calendar_id = ?
       AND start_date > ?
     ORDER BY start_date ASC, id ASC
     LIMIT 1`,
    [calendarId, periodEndDate]
  );
  return result.rows?.[0] || null;
}

async function loadPreviousPeriod({ calendarId, periodStartDate, runQuery = query }) {
  const result = await runQuery(
    `SELECT id, fiscal_year, period_no, start_date, end_date
     FROM fiscal_periods
     WHERE calendar_id = ?
       AND start_date < ?
     ORDER BY start_date DESC, id DESC
     LIMIT 1`,
    [calendarId, periodStartDate]
  );
  return result.rows?.[0] || null;
}

async function loadPeriodStatus({ bookId, fiscalPeriodId, runQuery = query }) {
  const result = await runQuery(
    `SELECT status
     FROM period_statuses
     WHERE book_id = ?
       AND fiscal_period_id = ?
     LIMIT 1`,
    [bookId, fiscalPeriodId]
  );
  return asUpper(result.rows?.[0]?.status || "OPEN") || "OPEN";
}

async function loadPurposeAccounts({ tenantId, legalEntityId, runQuery = query }) {
  const result = await runQuery(
    `SELECT purpose_code, account_id
     FROM journal_purpose_accounts
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND purpose_code IN (?, ?)`,
    [tenantId, legalEntityId, PURPOSE_CODE_GAIN, PURPOSE_CODE_LOSS]
  );
  let gainAccountId = null;
  let lossAccountId = null;
  for (const row of result.rows || []) {
    const purpose = asUpper(row?.purpose_code);
    const accountId = parsePositiveInt(row?.account_id);
    if (!accountId) continue;
    if (purpose === PURPOSE_CODE_GAIN) gainAccountId = accountId;
    if (purpose === PURPOSE_CODE_LOSS) lossAccountId = accountId;
  }
  if (!gainAccountId || !lossAccountId) {
    throw badRequest(
      `Setup required: configure journal_purpose_accounts for ${PURPOSE_CODE_GAIN} and ${PURPOSE_CODE_LOSS}`
    );
  }
  return { gainAccountId, lossAccountId };
}

async function loadForeignCashBalances({
  tenantId,
  legalEntityId,
  baseCurrencyCode,
  periodEndDate,
  runQuery = query,
}) {
  const signedTxn = signedAmountCase("ct.amount");
  const signedBase = signedAmountCase("COALESCE(ct.amount_base, ct.amount)");
  const result = await runQuery(
    `SELECT
       cr.id AS cash_register_id,
       cr.account_id,
       cr.operating_unit_id,
       UPPER(cr.currency_code) AS currency_code,
       SUM(${signedTxn}) AS balance_amount_txn,
       SUM(${signedBase}) AS carrying_amount_base
     FROM cash_transactions ct
     JOIN cash_registers cr
       ON cr.id = ct.cash_register_id
      AND cr.tenant_id = ct.tenant_id
     WHERE ct.tenant_id = ?
       AND cr.legal_entity_id = ?
       AND ct.status = 'POSTED'
       AND ct.book_date <= ?
       AND UPPER(cr.currency_code) <> ?
     GROUP BY cr.id, cr.account_id, cr.operating_unit_id, UPPER(cr.currency_code)
     HAVING ABS(SUM(${signedTxn})) >= ?
     ORDER BY cr.id ASC`,
    [tenantId, legalEntityId, periodEndDate, asUpper(baseCurrencyCode), AMOUNT_EPSILON]
  );
  return (result.rows || []).map((row) => ({
    cashRegisterId: parsePositiveInt(row.cash_register_id),
    accountId: parsePositiveInt(row.account_id),
    operatingUnitId: parsePositiveInt(row.operating_unit_id),
    currencyCode: asUpper(row.currency_code),
    balanceAmountTxn: roundAmount(row.balance_amount_txn),
    carryingAmountBase: roundAmount(row.carrying_amount_base),
  }));
}

async function resolveFxRate({
  tenantId,
  fromCurrencyCode,
  toCurrencyCode,
  rateDate,
  rateType = FX_RATE_TYPE_SPOT,
  fallbackMode = FX_FALLBACK_MODE_EXACT_ONLY,
  fallbackMaxDays = null,
  runQuery = query,
}) {
  const normalizedDate = normalizeDateOnly(rateDate, "periodEndDate");
  const fromCurrency = asUpper(fromCurrencyCode);
  const toCurrency = asUpper(toCurrencyCode);
  if (fromCurrency === toCurrency) {
    return { fxRate: 1, fxRateSource: "PARITY", fxRateDate: normalizedDate };
  }

  const exact = await runQuery(
    `SELECT rate, rate_date
     FROM fx_rates
     WHERE tenant_id = ?
       AND from_currency_code = ?
       AND to_currency_code = ?
       AND rate_type = ?
       AND rate_date = ?
     ORDER BY id DESC
     LIMIT 1`,
    [tenantId, fromCurrency, toCurrency, asUpper(rateType), normalizedDate]
  );
  const exactRate = Number(exact.rows?.[0]?.rate);
  if (Number.isFinite(exactRate) && exactRate > 0) {
    return {
      fxRate: Number(exactRate.toFixed(10)),
      fxRateSource: "FX_TABLE_EXACT_SPOT",
      fxRateDate: normalizeDateOnly(exact.rows?.[0]?.rate_date || normalizedDate, "fxRateDate"),
    };
  }

  if (fallbackMode === FX_FALLBACK_MODE_PRIOR_DATE) {
    const params = [tenantId, fromCurrency, toCurrency, asUpper(rateType), normalizedDate];
    const extra = fallbackMaxDays === null ? "" : "AND DATEDIFF(?, rate_date) <= ?";
    if (fallbackMaxDays !== null) {
      params.push(normalizedDate, fallbackMaxDays);
    }
    const prior = await runQuery(
      `SELECT rate, rate_date
       FROM fx_rates
       WHERE tenant_id = ?
         AND from_currency_code = ?
         AND to_currency_code = ?
         AND rate_type = ?
         AND rate_date < ?
         ${extra}
       ORDER BY rate_date DESC, id DESC
       LIMIT 1`,
      params
    );
    const priorRate = Number(prior.rows?.[0]?.rate);
    if (Number.isFinite(priorRate) && priorRate > 0) {
      return {
        fxRate: Number(priorRate.toFixed(10)),
        fxRateSource: "FX_TABLE_PRIOR_SPOT",
        fxRateDate: normalizeDateOnly(prior.rows?.[0]?.rate_date, "fxRateDate"),
      };
    }
  }

  throw badRequest(`FX rate is required for ${fromCurrency}/${toCurrency} on ${normalizedDate}`);
}

function mapRunRow(row) {
  if (!row) return null;
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    bookId: parsePositiveInt(row.book_id),
    fiscalPeriodId: parsePositiveInt(row.fiscal_period_id),
    runType: row.run_type || null,
    status: row.status || null,
    periodEndDate: row.period_end_date || null,
    baseCurrencyCode: row.base_currency_code || null,
    fxRateType: row.fx_rate_type || null,
    fxFallbackMode: row.fx_fallback_mode || null,
    fxFallbackMaxDays:
      row.fx_fallback_max_days === null || row.fx_fallback_max_days === undefined
        ? null
        : Number(row.fx_fallback_max_days),
    foreignBalanceCount: Number(row.foreign_balance_count || 0),
    lineCount: Number(row.line_count || 0),
    totalCarryingBase: roundAmount(row.total_carrying_base),
    totalClosingBase: roundAmount(row.total_closing_base),
    totalDeltaBase: roundAmount(row.total_delta_base),
    journalEntryId: parsePositiveInt(row.journal_entry_id),
    reversalJournalEntryId: parsePositiveInt(row.reversal_journal_entry_id),
    reversedByRunId: parsePositiveInt(row.reversed_by_run_id),
    reversalStatus: row.reversal_status || null,
    closeGateOverride: Boolean(row.close_gate_override),
    closeGateOverrideReason: row.close_gate_override_reason || null,
    idempotencyKey: row.idempotency_key || null,
    runHash: row.run_hash || null,
    source: row.source || null,
    appJobId: parsePositiveInt(row.app_job_id),
    completedByUserId: parsePositiveInt(row.completed_by_user_id),
    completedAt: row.completed_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function mapLineRow(row) {
  if (!row) return null;
  return {
    id: parsePositiveInt(row.id),
    cashFxRevaluationRunId: parsePositiveInt(row.cash_fx_revaluation_run_id),
    lineNo: Number(row.line_no || 0),
    cashRegisterId: parsePositiveInt(row.cash_register_id),
    accountId: parsePositiveInt(row.account_id),
    operatingUnitId: parsePositiveInt(row.operating_unit_id),
    currencyCode: row.currency_code || null,
    balanceAmountTxn: roundAmount(row.balance_amount_txn),
    carryingAmountBase: roundAmount(row.carrying_amount_base),
    closingFxRate: row.closing_fx_rate === null ? null : Number(row.closing_fx_rate),
    closingFxRateSource: row.closing_fx_rate_source || null,
    closingFxRateDate: row.closing_fx_rate_date || null,
    closingAmountBase: roundAmount(row.closing_amount_base),
    deltaBase: roundAmount(row.delta_base),
    gainLossAccountId: parsePositiveInt(row.gain_loss_account_id),
  };
}

async function loadRunLines({ tenantId, runId, runQuery = query }) {
  const result = await runQuery(
    `SELECT *
     FROM cash_fx_revaluation_lines
     WHERE tenant_id = ?
       AND cash_fx_revaluation_run_id = ?
     ORDER BY line_no ASC, id ASC`,
    [tenantId, runId]
  );
  return (result.rows || []).map(mapLineRow);
}

async function loadLatestCompletedRun({ tenantId, bookId, fiscalPeriodId, runType, runQuery = query }) {
  const result = await runQuery(
    `SELECT *
     FROM cash_fx_revaluation_runs
     WHERE tenant_id = ?
       AND book_id = ?
       AND fiscal_period_id = ?
       AND run_type = ?
       AND status = ?
     ORDER BY id DESC
     LIMIT 1`,
    [tenantId, bookId, fiscalPeriodId, runType, RUN_STATUS_COMPLETED]
  );
  return result.rows?.[0] || null;
}

async function loadJournalEntryRow({ tenantId, journalEntryId, runQuery = query }) {
  const normalizedJournalEntryId = parsePositiveInt(journalEntryId);
  if (!normalizedJournalEntryId) return null;
  const result = await runQuery(
    `SELECT
       id,
       tenant_id,
       legal_entity_id,
       book_id,
       fiscal_period_id,
       status,
       journal_no,
       reference_no,
       reversal_journal_entry_id
     FROM journal_entries
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, normalizedJournalEntryId]
  );
  return result.rows?.[0] || null;
}

async function loadJournalLinesForEntry({ journalEntryId, runQuery = query }) {
  const normalizedJournalEntryId = parsePositiveInt(journalEntryId);
  if (!normalizedJournalEntryId) return [];
  const result = await runQuery(
    `SELECT
       line_no,
       account_id,
       operating_unit_id,
       description,
       debit_base,
       credit_base
     FROM journal_lines
     WHERE journal_entry_id = ?
     ORDER BY line_no ASC, id ASC`,
    [normalizedJournalEntryId]
  );
  return result.rows || [];
}

function buildReversalJournalNo(runId) {
  return `CASHFXRR-${parsePositiveInt(runId)}`.slice(0, 40);
}

async function countPostedJournalsByReference({
  tenantId,
  bookId,
  referenceNo,
  runQuery = query,
}) {
  if (!referenceNo) return 0;
  const result = await runQuery(
    `SELECT COUNT(*) AS total
     FROM journal_entries
     WHERE tenant_id = ?
       AND book_id = ?
       AND reference_no = ?
       AND status = 'POSTED'`,
    [tenantId, bookId, String(referenceNo)]
  );
  return Number(result.rows?.[0]?.total || 0);
}

export async function evaluateCashFxRevaluationReversalIntegrity({
  tenantId,
  bookId,
  fiscalPeriodId,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedBookId = parsePositiveInt(bookId);
  const normalizedPeriodId = parsePositiveInt(fiscalPeriodId);
  if (!normalizedTenantId || !normalizedBookId || !normalizedPeriodId) {
    throw badRequest("tenantId, bookId and fiscalPeriodId are required");
  }

  const book = await loadBookRow({
    tenantId: normalizedTenantId,
    bookId: normalizedBookId,
    runQuery,
  });
  if (!book) throw badRequest("bookId not found for tenant");

  const period = await loadPeriodRow({
    calendarId: parsePositiveInt(book.calendar_id),
    fiscalPeriodId: normalizedPeriodId,
    runQuery,
  });
  if (!period) throw badRequest("fiscalPeriodId does not belong to book calendar");

  const previousPeriod = await loadPreviousPeriod({
    calendarId: parsePositiveInt(book.calendar_id),
    periodStartDate: normalizeDateOnly(period.start_date, "period.start_date"),
    runQuery,
  });
  if (!previousPeriod) {
    return {
      required: false,
      satisfied: true,
      reasonCode: "NO_PREVIOUS_PERIOD",
      previousFiscalPeriodId: null,
      previousRunType: null,
      previousRun: null,
      reversalJournalEntryId: null,
    };
  }

  const previousRunType = inferRunType(previousPeriod, period);
  const previousRun = await loadLatestCompletedRun({
    tenantId: normalizedTenantId,
    bookId: normalizedBookId,
    fiscalPeriodId: parsePositiveInt(previousPeriod.id),
    runType: previousRunType,
    runQuery,
  });

  if (!previousRun) {
    return {
      required: false,
      satisfied: true,
      reasonCode: "PREVIOUS_REVALUATION_NOT_FOUND",
      previousFiscalPeriodId: parsePositiveInt(previousPeriod.id),
      previousRunType,
      previousRun: null,
      reversalJournalEntryId: null,
    };
  }

  const previousRunId = parsePositiveInt(previousRun.id);
  const originalJournalEntryId = parsePositiveInt(previousRun.journal_entry_id);
  if (!originalJournalEntryId) {
    return {
      required: false,
      satisfied: true,
      reasonCode: "PREVIOUS_REVALUATION_NO_JOURNAL",
      previousFiscalPeriodId: parsePositiveInt(previousPeriod.id),
      previousRunType,
      previousRun: mapRunRow(previousRun),
      reversalJournalEntryId: null,
    };
  }

  const originalJournal = await loadJournalEntryRow({
    tenantId: normalizedTenantId,
    journalEntryId: originalJournalEntryId,
    runQuery,
  });
  if (!originalJournal) {
    return {
      required: true,
      satisfied: false,
      reasonCode: "PREVIOUS_ORIGINAL_JOURNAL_MISSING",
      previousFiscalPeriodId: parsePositiveInt(previousPeriod.id),
      previousRunType,
      previousRun: mapRunRow(previousRun),
      reversalJournalEntryId: null,
    };
  }

  const reversalJournalEntryId = parsePositiveInt(previousRun.reversal_journal_entry_id);
  if (!reversalJournalEntryId) {
    return {
      required: true,
      satisfied: false,
      reasonCode: "PREVIOUS_REVERSAL_MISSING",
      previousFiscalPeriodId: parsePositiveInt(previousPeriod.id),
      previousRunType,
      previousRun: mapRunRow(previousRun),
      reversalJournalEntryId: null,
    };
  }

  const reversalJournal = await loadJournalEntryRow({
    tenantId: normalizedTenantId,
    journalEntryId: reversalJournalEntryId,
    runQuery,
  });
  if (!reversalJournal) {
    return {
      required: true,
      satisfied: false,
      reasonCode: "PREVIOUS_REVERSAL_JOURNAL_MISSING",
      previousFiscalPeriodId: parsePositiveInt(previousPeriod.id),
      previousRunType,
      previousRun: mapRunRow(previousRun),
      reversalJournalEntryId,
    };
  }

  if (asUpper(reversalJournal.status) !== "POSTED") {
    return {
      required: true,
      satisfied: false,
      reasonCode: "PREVIOUS_REVERSAL_NOT_POSTED",
      previousFiscalPeriodId: parsePositiveInt(previousPeriod.id),
      previousRunType,
      previousRun: mapRunRow(previousRun),
      reversalJournalEntryId,
    };
  }

  if (parsePositiveInt(reversalJournal.fiscal_period_id) !== normalizedPeriodId) {
    return {
      required: true,
      satisfied: false,
      reasonCode: "PREVIOUS_REVERSAL_PERIOD_MISMATCH",
      previousFiscalPeriodId: parsePositiveInt(previousPeriod.id),
      previousRunType,
      previousRun: mapRunRow(previousRun),
      reversalJournalEntryId,
    };
  }

  const linkedReversalJournalId = parsePositiveInt(originalJournal.reversal_journal_entry_id);
  if (!linkedReversalJournalId) {
    return {
      required: true,
      satisfied: false,
      reasonCode: "PREVIOUS_REVERSAL_LINK_MISSING",
      previousFiscalPeriodId: parsePositiveInt(previousPeriod.id),
      previousRunType,
      previousRun: mapRunRow(previousRun),
      reversalJournalEntryId,
    };
  }
  if (linkedReversalJournalId !== reversalJournalEntryId) {
    return {
      required: true,
      satisfied: false,
      reasonCode: "PREVIOUS_REVERSAL_LINK_MISMATCH",
      previousFiscalPeriodId: parsePositiveInt(previousPeriod.id),
      previousRunType,
      previousRun: mapRunRow(previousRun),
      reversalJournalEntryId,
    };
  }

  const duplicateReferenceCount = await countPostedJournalsByReference({
    tenantId: normalizedTenantId,
    bookId: normalizedBookId,
    referenceNo: `CASH_FX_REVAL_REVERSAL_RUN:${previousRunId}`,
    runQuery,
  });
  if (duplicateReferenceCount > 1) {
    return {
      required: true,
      satisfied: false,
      reasonCode: "PREVIOUS_REVERSAL_DUPLICATE",
      previousFiscalPeriodId: parsePositiveInt(previousPeriod.id),
      previousRunType,
      previousRun: mapRunRow(previousRun),
      reversalJournalEntryId,
    };
  }

  return {
    required: true,
    satisfied: true,
    reasonCode: "PREVIOUS_REVERSAL_PRESENT",
    previousFiscalPeriodId: parsePositiveInt(previousPeriod.id),
    previousRunType,
    previousRun: mapRunRow(previousRun),
    reversalJournalEntryId,
  };
}

export async function evaluateCashFxRevaluationCloseGate({
  tenantId,
  bookId,
  fiscalPeriodId,
  runType = null,
  periodEndDate = null,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedBookId = parsePositiveInt(bookId);
  const normalizedPeriodId = parsePositiveInt(fiscalPeriodId);
  if (!normalizedTenantId || !normalizedBookId || !normalizedPeriodId) {
    throw badRequest("tenantId, bookId and fiscalPeriodId are required");
  }

  const book = await loadBookRow({ tenantId: normalizedTenantId, bookId: normalizedBookId, runQuery });
  if (!book) throw badRequest("bookId not found for tenant");

  const period = await loadPeriodRow({
    calendarId: parsePositiveInt(book.calendar_id),
    fiscalPeriodId: normalizedPeriodId,
    runQuery,
  });
  if (!period) throw badRequest("fiscalPeriodId does not belong to book calendar");

  const nextPeriod = await loadNextPeriod({
    calendarId: parsePositiveInt(book.calendar_id),
    periodEndDate: normalizeDateOnly(period.end_date, "period.end_date"),
    runQuery,
  });
  const effectiveRunType = runType ? normalizeRunType(runType) : inferRunType(period, nextPeriod);
  const effectivePeriodEndDate = periodEndDate
    ? normalizeDateOnly(periodEndDate, "periodEndDate")
    : normalizeDateOnly(period.end_date, "period.end_date");
  const reversalIntegrity = await evaluateCashFxRevaluationReversalIntegrity({
    tenantId: normalizedTenantId,
    bookId: normalizedBookId,
    fiscalPeriodId: normalizedPeriodId,
    runQuery,
  });

  const balances = await loadForeignCashBalances({
    tenantId: normalizedTenantId,
    legalEntityId: parsePositiveInt(book.legal_entity_id),
    baseCurrencyCode: asUpper(book.base_currency_code),
    periodEndDate: effectivePeriodEndDate,
    runQuery,
  });

  if (balances.length === 0) {
    return {
      required: false,
      satisfied: true,
      reasonCode: "NO_FOREIGN_CASH_BALANCE",
      runType: effectiveRunType,
      foreignBalanceCount: 0,
      completedRun: null,
      periodEndDate: effectivePeriodEndDate,
      reversalIntegrity,
    };
  }

  const completedRun = await loadLatestCompletedRun({
    tenantId: normalizedTenantId,
    bookId: normalizedBookId,
    fiscalPeriodId: normalizedPeriodId,
    runType: effectiveRunType,
    runQuery,
  });

  if (!completedRun) {
    return {
      required: true,
      satisfied: false,
      reasonCode: "REVALUATION_RUN_MISSING",
      runType: effectiveRunType,
      foreignBalanceCount: balances.length,
      completedRun: null,
      periodEndDate: effectivePeriodEndDate,
      reversalIntegrity,
    };
  }

  return {
    required: true,
    satisfied: true,
    reasonCode: "REVALUATION_RUN_PRESENT",
    runType: effectiveRunType,
    foreignBalanceCount: balances.length,
    completedRun: mapRunRow(completedRun),
    periodEndDate: effectivePeriodEndDate,
    reversalIntegrity,
  };
}

async function loadRunById({ tenantId, runId, runQuery = query }) {
  const result = await runQuery(
    `SELECT *
     FROM cash_fx_revaluation_runs
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, runId]
  );
  return result.rows?.[0] || null;
}

async function loadRunByIdempotency({
  tenantId,
  bookId,
  fiscalPeriodId,
  runType,
  idempotencyKey,
  runQuery = query,
  forUpdate = false,
}) {
  const result = await runQuery(
    `SELECT *
     FROM cash_fx_revaluation_runs
     WHERE tenant_id = ?
       AND book_id = ?
       AND fiscal_period_id = ?
       AND run_type = ?
       AND idempotency_key = ?
     LIMIT 1
     ${forUpdate ? "FOR UPDATE" : ""}`,
    [tenantId, bookId, fiscalPeriodId, runType, idempotencyKey]
  );
  return result.rows?.[0] || null;
}

async function loadRunByHash({
  tenantId,
  bookId,
  fiscalPeriodId,
  runType,
  runHash,
  runQuery = query,
  forUpdate = false,
}) {
  const result = await runQuery(
    `SELECT *
     FROM cash_fx_revaluation_runs
     WHERE tenant_id = ?
       AND book_id = ?
       AND fiscal_period_id = ?
       AND run_type = ?
       AND run_hash = ?
     LIMIT 1
     ${forUpdate ? "FOR UPDATE" : ""}`,
    [tenantId, bookId, fiscalPeriodId, runType, runHash]
  );
  return result.rows?.[0] || null;
}

function buildJournalNo(runId) {
  return `CASHFXR-${parsePositiveInt(runId)}`.slice(0, 40);
}

async function createSystemJournalTx(tx, payload) {
  const lines = Array.isArray(payload.lines) ? payload.lines : [];
  if (lines.length === 0) return null;

  let totalDebitBase = 0;
  let totalCreditBase = 0;
  for (const line of lines) {
    totalDebitBase += Number(line.debitBase || 0);
    totalCreditBase += Number(line.creditBase || 0);
  }
  totalDebitBase = roundAmount(totalDebitBase);
  totalCreditBase = roundAmount(totalCreditBase);
  if (!isNearlyZero(totalDebitBase - totalCreditBase)) {
    throw badRequest("Cash FX revaluation journal is not balanced");
  }

  const entryRes = await tx.query(
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
      payload.entryDate,
      payload.documentDate,
      payload.currencyCode,
      payload.description || null,
      payload.referenceNo || null,
      totalDebitBase,
      totalCreditBase,
      payload.userId,
      payload.userId,
    ]
  );
  const journalEntryId = parsePositiveInt(entryRes.rows?.insertId);
  if (!journalEntryId) {
    throw badRequest("Failed to create cash FX revaluation journal entry");
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const accountId = parsePositiveInt(line.accountId);
    if (!accountId) {
      throw badRequest("Invalid accountId on cash FX revaluation journal line");
    }
    const debitBase = roundAmount(line.debitBase);
    const creditBase = roundAmount(line.creditBase);
    if ((debitBase <= 0 && creditBase <= 0) || (debitBase > 0 && creditBase > 0)) {
      throw badRequest("Cash FX revaluation journal line must have exactly one non-zero side");
    }

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
       VALUES (?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?, ?, NULL)`,
      [
        journalEntryId,
        i + 1,
        accountId,
        parsePositiveInt(line.operatingUnitId),
        line.description || null,
        payload.currencyCode,
        roundAmount(debitBase - creditBase),
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

async function buildRunAutoReversalTx(tx, payload) {
  const tenantId = parsePositiveInt(payload.tenantId);
  const runId = parsePositiveInt(payload.runId);
  const userId = parsePositiveInt(payload.userId);
  const bookId = parsePositiveInt(payload.bookId);
  const legalEntityId = parsePositiveInt(payload.legalEntityId);
  const calendarId = parsePositiveInt(payload.calendarId);
  const runType = normalizeRunType(payload.runType);
  const periodEndDate = normalizeDateOnly(payload.periodEndDate, "periodEndDate");
  const journalEntryId = parsePositiveInt(payload.journalEntryId);
  const baseCurrencyCode = asUpper(payload.baseCurrencyCode);
  if (
    !tenantId ||
    !runId ||
    !userId ||
    !bookId ||
    !legalEntityId ||
    !calendarId ||
    !baseCurrencyCode
  ) {
    throw badRequest("Invalid payload for cash FX revaluation auto-reversal");
  }

  if (!journalEntryId) {
    return {
      reversalJournalEntryId: null,
      reversalStatus: REVERSAL_STATUS_NOT_REQUIRED,
      reversalFiscalPeriodId: null,
    };
  }

  const nextPeriod = await loadNextPeriod({
    calendarId,
    periodEndDate,
    runQuery: tx.query,
  });
  if (!nextPeriod) {
    return {
      reversalJournalEntryId: null,
      reversalStatus: REVERSAL_STATUS_NOT_REQUIRED,
      reversalFiscalPeriodId: null,
    };
  }

  const nextFiscalPeriodId = parsePositiveInt(nextPeriod.id);
  const nextPeriodStatus = await loadPeriodStatus({
    bookId,
    fiscalPeriodId: nextFiscalPeriodId,
    runQuery: tx.query,
  });
  if (nextPeriodStatus === "HARD_CLOSED") {
    throw badRequest(
      "Cannot auto-post cash FX revaluation reversal because next fiscal period is HARD_CLOSED"
    );
  }

  const originalJournal = await loadJournalEntryRow({
    tenantId,
    journalEntryId,
    runQuery: tx.query,
  });
  if (!originalJournal) {
    throw badRequest("Cash FX revaluation journal entry not found for reversal");
  }

  const existingReversalJournalId = parsePositiveInt(originalJournal.reversal_journal_entry_id);
  if (existingReversalJournalId) {
    const existingReversalJournal = await loadJournalEntryRow({
      tenantId,
      journalEntryId: existingReversalJournalId,
      runQuery: tx.query,
    });
    if (!existingReversalJournal) {
      throw badRequest("Existing cash FX revaluation reversal journal link is invalid");
    }
    if (asUpper(existingReversalJournal.status) !== "POSTED") {
      throw badRequest("Existing cash FX revaluation reversal journal is not posted");
    }
    if (parsePositiveInt(existingReversalJournal.fiscal_period_id) !== nextFiscalPeriodId) {
      throw badRequest(
        "Existing cash FX revaluation reversal journal is posted in unexpected fiscal period"
      );
    }
    return {
      reversalJournalEntryId: existingReversalJournalId,
      reversalStatus: REVERSAL_STATUS_POSTED,
      reversalFiscalPeriodId: nextFiscalPeriodId,
    };
  }

  const originalLines = await loadJournalLinesForEntry({
    journalEntryId,
    runQuery: tx.query,
  });
  const reversalLines = [];
  for (const line of originalLines) {
    const accountId = parsePositiveInt(line.account_id);
    if (!accountId) continue;
    const debitBase = roundAmount(line.credit_base);
    const creditBase = roundAmount(line.debit_base);
    if ((debitBase <= 0 && creditBase <= 0) || (debitBase > 0 && creditBase > 0)) {
      continue;
    }
    reversalLines.push({
      accountId,
      operatingUnitId: parsePositiveInt(line.operating_unit_id),
      debitBase,
      creditBase,
      description: line.description || `Cash FX revaluation reversal (${runType})`,
    });
  }

  if (reversalLines.length === 0) {
    return {
      reversalJournalEntryId: null,
      reversalStatus: REVERSAL_STATUS_NOT_REQUIRED,
      reversalFiscalPeriodId: nextFiscalPeriodId,
    };
  }

  const reversalJournal = await createSystemJournalTx(tx, {
    tenantId,
    legalEntityId,
    bookId,
    fiscalPeriodId: nextFiscalPeriodId,
    journalNo: buildReversalJournalNo(runId),
    entryDate: normalizeDateOnly(nextPeriod.start_date, "nextPeriod.start_date"),
    documentDate: normalizeDateOnly(nextPeriod.start_date, "nextPeriod.start_date"),
    currencyCode: baseCurrencyCode,
    description: `Cash FX revaluation reversal ${runType} ${periodEndDate}`,
    referenceNo: `CASH_FX_REVAL_REVERSAL_RUN:${runId}`,
    userId,
    lines: reversalLines,
  });
  const reversalJournalEntryId = parsePositiveInt(reversalJournal?.journalEntryId);
  if (!reversalJournalEntryId) {
    throw badRequest("Failed to create cash FX revaluation reversal journal");
  }

  await tx.query(
    `UPDATE journal_entries
     SET reversal_journal_entry_id = ?
     WHERE id = ?
       AND (reversal_journal_entry_id IS NULL OR reversal_journal_entry_id = ?)`,
    [reversalJournalEntryId, journalEntryId, reversalJournalEntryId]
  );

  const refreshedOriginal = await loadJournalEntryRow({
    tenantId,
    journalEntryId,
    runQuery: tx.query,
  });
  if (parsePositiveInt(refreshedOriginal?.reversal_journal_entry_id) !== reversalJournalEntryId) {
    throw badRequest("Failed to persist cash FX revaluation reversal journal linkage");
  }

  return {
    reversalJournalEntryId,
    reversalStatus: REVERSAL_STATUS_POSTED,
    reversalFiscalPeriodId: nextFiscalPeriodId,
  };
}

export async function runCashFxRevaluation({ req = null, payload = {}, assertScopeAccess = null }) {
  const tenantId = parsePositiveInt(payload.tenantId);
  const userId = parsePositiveInt(payload.userId);
  const bookId = parsePositiveInt(payload.bookId);
  const fiscalPeriodId = parsePositiveInt(payload.fiscalPeriodId);
  const expectedLegalEntityId = parsePositiveInt(payload.legalEntityId);
  if (!tenantId || !userId || !bookId || !fiscalPeriodId) {
    throw badRequest("tenantId, userId, bookId and fiscalPeriodId are required");
  }

  const book = await loadBookRow({ tenantId, bookId });
  if (!book) throw badRequest("bookId not found for tenant");
  const legalEntityId = parsePositiveInt(book.legal_entity_id);
  if (!legalEntityId) throw badRequest("Book legal entity is invalid");
  if (expectedLegalEntityId && expectedLegalEntityId !== legalEntityId) {
    throw badRequest("legalEntityId must match book legal entity");
  }

  if (req && typeof assertScopeAccess === "function") {
    assertScopeAccess(req, "legal_entity", legalEntityId, "bookId");
  }

  const period = await loadPeriodRow({
    calendarId: parsePositiveInt(book.calendar_id),
    fiscalPeriodId,
  });
  if (!period) throw badRequest("fiscalPeriodId does not belong to book calendar");

  const nextPeriod = await loadNextPeriod({
    calendarId: parsePositiveInt(book.calendar_id),
    periodEndDate: normalizeDateOnly(period.end_date, "period.end_date"),
  });
  const runType = payload.runType ? normalizeRunType(payload.runType) : inferRunType(period, nextPeriod);
  const periodEndDate = payload.periodEndDate
    ? normalizeDateOnly(payload.periodEndDate, "periodEndDate")
    : normalizeDateOnly(period.end_date, "period.end_date");

  const fxRateType = asUpper(payload.fxRateType || FX_RATE_TYPE_SPOT) || FX_RATE_TYPE_SPOT;
  const fxFallbackMode = normalizeFallbackMode(payload.fxFallbackMode, DEFAULT_FALLBACK_MODE);
  const fxFallbackMaxDays = normalizeFallbackMaxDays(
    payload.fxFallbackMaxDays ?? DEFAULT_FALLBACK_MAX_DAYS,
    fxFallbackMode
  );

  const closeGateOverride = Boolean(payload.closeGateOverride);
  const closeGateOverrideReason = normalizeText(
    payload.closeGateOverrideReason,
    "closeGateOverrideReason",
    255
  );
  if (closeGateOverride && !closeGateOverrideReason) {
    throw badRequest("closeGateOverrideReason is required when closeGateOverride=true");
  }

  const source = normalizeText(payload.source, "source", 30) || "MANUAL";
  const note = normalizeText(payload.note, "note", 500);
  const appJobId = parsePositiveInt(payload.appJobId);
  const idempotencyKey = normalizeIdempotencyKey(
    payload.idempotencyKey,
    `CASH_FX_REVAL:${bookId}:${fiscalPeriodId}:${runType}`
  );
  if (!idempotencyKey) throw badRequest("idempotencyKey is required");

  const runHash = buildRunHash({
    tenantId,
    bookId,
    fiscalPeriodId,
    runType,
    periodEndDate,
    fxRateType,
    fxFallbackMode,
    fxFallbackMaxDays,
    source,
  });

  let activeRunId = null;

  try {
    return await withTransaction(async (tx) => {
      const periodStatus = await loadPeriodStatus({ bookId, fiscalPeriodId, runQuery: tx.query });
      if (periodStatus === "HARD_CLOSED") {
        throw badRequest("Cannot run cash FX revaluation on HARD_CLOSED period");
      }

      const replayByIdem = await loadRunByIdempotency({
        tenantId,
        bookId,
        fiscalPeriodId,
        runType,
        idempotencyKey,
        runQuery: tx.query,
        forUpdate: true,
      });
      if (replayByIdem && asUpper(replayByIdem.status) === RUN_STATUS_COMPLETED) {
        return {
          run: mapRunRow(replayByIdem),
          lines: await loadRunLines({ tenantId, runId: replayByIdem.id, runQuery: tx.query }),
          idempotentReplay: true,
        };
      }

      const replayByHash = await loadRunByHash({
        tenantId,
        bookId,
        fiscalPeriodId,
        runType,
        runHash,
        runQuery: tx.query,
        forUpdate: true,
      });
      if (replayByHash && asUpper(replayByHash.status) === RUN_STATUS_COMPLETED) {
        return {
          run: mapRunRow(replayByHash),
          lines: await loadRunLines({ tenantId, runId: replayByHash.id, runQuery: tx.query }),
          idempotentReplay: true,
        };
      }

      let runId = parsePositiveInt(replayByIdem?.id || replayByHash?.id);
      if (!runId) {
        const insertRes = await tx.query(
          `INSERT INTO cash_fx_revaluation_runs (
             tenant_id,
             legal_entity_id,
             book_id,
             fiscal_period_id,
             run_type,
             status,
             period_end_date,
             base_currency_code,
             fx_rate_type,
             fx_fallback_mode,
             fx_fallback_max_days,
             close_gate_override,
             close_gate_override_reason,
             note,
             run_hash,
             idempotency_key,
             source,
             app_job_id,
             requested_by_user_id
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            tenantId,
            legalEntityId,
            bookId,
            fiscalPeriodId,
            runType,
            RUN_STATUS_DRAFT,
            periodEndDate,
            asUpper(book.base_currency_code),
            fxRateType,
            fxFallbackMode,
            fxFallbackMaxDays,
            closeGateOverride,
            closeGateOverrideReason,
            note,
            runHash,
            idempotencyKey,
            source,
            appJobId,
            userId,
          ]
        );
        runId = parsePositiveInt(insertRes.rows?.insertId);
      } else {
        await tx.query(
          `UPDATE cash_fx_revaluation_runs
           SET
             status = ?,
             period_end_date = ?,
             base_currency_code = ?,
             fx_rate_type = ?,
             fx_fallback_mode = ?,
             fx_fallback_max_days = ?,
             foreign_balance_count = 0,
             line_count = 0,
             total_carrying_base = 0,
             total_closing_base = 0,
             total_delta_base = 0,
             journal_entry_id = NULL,
             reversal_journal_entry_id = NULL,
             reversed_by_run_id = NULL,
             reversal_status = ?,
             close_gate_override = ?,
             close_gate_override_reason = ?,
             note = ?,
             run_hash = ?,
             idempotency_key = ?,
             source = ?,
             app_job_id = ?,
             requested_by_user_id = ?,
             completed_by_user_id = NULL,
             completed_at = NULL,
             updated_at = CURRENT_TIMESTAMP
           WHERE tenant_id = ?
             AND id = ?`,
          [
            RUN_STATUS_DRAFT,
            periodEndDate,
            asUpper(book.base_currency_code),
            fxRateType,
            fxFallbackMode,
            fxFallbackMaxDays,
            REVERSAL_STATUS_PENDING,
            closeGateOverride,
            closeGateOverrideReason,
            note,
            runHash,
            idempotencyKey,
            source,
            appJobId,
            userId,
            tenantId,
            runId,
          ]
        );
        await tx.query(
          `DELETE FROM cash_fx_revaluation_lines
           WHERE tenant_id = ?
             AND cash_fx_revaluation_run_id = ?`,
          [tenantId, runId]
        );
      }

      if (!runId) throw badRequest("Failed to initialize cash FX revaluation run");
      activeRunId = runId;

      const balances = await loadForeignCashBalances({
        tenantId,
        legalEntityId,
        baseCurrencyCode: asUpper(book.base_currency_code),
        periodEndDate,
        runQuery: tx.query,
      });
      const { gainAccountId, lossAccountId } = await loadPurposeAccounts({
        tenantId,
        legalEntityId,
        runQuery: tx.query,
      });

      let lineNo = 0;
      let totalCarryingBase = 0;
      let totalClosingBase = 0;
      let totalDeltaBase = 0;
      const journalLines = [];

      for (const row of balances) {
        const fx = await resolveFxRate({
          tenantId,
          fromCurrencyCode: row.currencyCode,
          toCurrencyCode: asUpper(book.base_currency_code),
          rateDate: periodEndDate,
          rateType: fxRateType,
          fallbackMode: fxFallbackMode,
          fallbackMaxDays: fxFallbackMaxDays,
          runQuery: tx.query,
        });

        const carryingAmountBase = roundAmount(row.carryingAmountBase);
        const closingAmountBase = roundAmount(row.balanceAmountTxn * Number(fx.fxRate));
        const deltaBase = roundAmount(closingAmountBase - carryingAmountBase);

        totalCarryingBase = roundAmount(totalCarryingBase + carryingAmountBase);
        totalClosingBase = roundAmount(totalClosingBase + closingAmountBase);
        totalDeltaBase = roundAmount(totalDeltaBase + deltaBase);

        lineNo += 1;
        // eslint-disable-next-line no-await-in-loop
        await tx.query(
          `INSERT INTO cash_fx_revaluation_lines (
             tenant_id,
             cash_fx_revaluation_run_id,
             line_no,
             cash_register_id,
             account_id,
             operating_unit_id,
             currency_code,
             balance_amount_txn,
             carrying_amount_base,
             closing_fx_rate,
             closing_fx_rate_source,
             closing_fx_rate_date,
             closing_amount_base,
             delta_base,
             gain_loss_account_id
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            tenantId,
            runId,
            lineNo,
            row.cashRegisterId,
            row.accountId,
            row.operatingUnitId,
            row.currencyCode,
            row.balanceAmountTxn,
            carryingAmountBase,
            Number(fx.fxRate).toFixed(10),
            fx.fxRateSource,
            fx.fxRateDate,
            closingAmountBase,
            deltaBase,
            deltaBase > 0 ? gainAccountId : deltaBase < 0 ? lossAccountId : null,
          ]
        );

        if (isNearlyZero(deltaBase)) continue;

        if (deltaBase > 0) {
          journalLines.push({
            accountId: row.accountId,
            operatingUnitId: row.operatingUnitId,
            debitBase: deltaBase,
            creditBase: 0,
            description: `Cash FX revaluation gain (${row.currencyCode})`,
          });
          journalLines.push({
            accountId: gainAccountId,
            operatingUnitId: row.operatingUnitId,
            debitBase: 0,
            creditBase: deltaBase,
            description: `Cash FX revaluation gain (${row.currencyCode})`,
          });
        } else {
          const absDelta = roundAmount(Math.abs(deltaBase));
          journalLines.push({
            accountId: lossAccountId,
            operatingUnitId: row.operatingUnitId,
            debitBase: absDelta,
            creditBase: 0,
            description: `Cash FX revaluation loss (${row.currencyCode})`,
          });
          journalLines.push({
            accountId: row.accountId,
            operatingUnitId: row.operatingUnitId,
            debitBase: 0,
            creditBase: absDelta,
            description: `Cash FX revaluation loss (${row.currencyCode})`,
          });
        }
      }

      let journalEntryId = null;
      if (journalLines.length > 0) {
        const journal = await createSystemJournalTx(tx, {
          tenantId,
          legalEntityId,
          bookId,
          fiscalPeriodId,
          journalNo: buildJournalNo(runId),
          entryDate: periodEndDate,
          documentDate: periodEndDate,
          currencyCode: asUpper(book.base_currency_code),
          description: `Cash FX revaluation ${runType} ${periodEndDate}`,
          referenceNo: `CASH_FX_REVAL_RUN:${runId}`,
          userId,
          lines: journalLines,
        });
        journalEntryId = parsePositiveInt(journal?.journalEntryId);
      }

      let reversalJournalEntryId = null;
      let reversalStatus = journalEntryId
        ? REVERSAL_STATUS_PENDING
        : REVERSAL_STATUS_NOT_REQUIRED;
      try {
        const autoReversal = await buildRunAutoReversalTx(tx, {
          tenantId,
          userId,
          runId,
          bookId,
          legalEntityId,
          calendarId: parsePositiveInt(book.calendar_id),
          runType,
          periodEndDate,
          journalEntryId,
          baseCurrencyCode: asUpper(book.base_currency_code),
        });
        reversalJournalEntryId = parsePositiveInt(autoReversal?.reversalJournalEntryId);
        reversalStatus =
          autoReversal?.reversalStatus ||
          (journalEntryId ? REVERSAL_STATUS_PENDING : REVERSAL_STATUS_NOT_REQUIRED);
      } catch (err) {
        if (
          String(err?.message || "").includes("next fiscal period is HARD_CLOSED") &&
          parsePositiveInt(runId)
        ) {
          await tx.query(
            `UPDATE cash_fx_revaluation_runs
             SET reversal_journal_entry_id = NULL,
                 reversed_by_run_id = NULL,
                 reversal_status = ?,
                 updated_at = CURRENT_TIMESTAMP
             WHERE tenant_id = ?
               AND id = ?`,
            [REVERSAL_STATUS_BLOCKED_HARD_CLOSED, tenantId, runId]
          );
        }
        throw err;
      }

      await tx.query(
        `UPDATE cash_fx_revaluation_runs
         SET
           status = ?,
           foreign_balance_count = ?,
           line_count = ?,
           total_carrying_base = ?,
           total_closing_base = ?,
           total_delta_base = ?,
           journal_entry_id = ?,
           reversal_journal_entry_id = ?,
           reversed_by_run_id = NULL,
           reversal_status = ?,
           completed_by_user_id = ?,
           completed_at = CURRENT_TIMESTAMP
         WHERE tenant_id = ?
           AND id = ?`,
        [
          RUN_STATUS_COMPLETED,
          balances.length,
          lineNo,
          totalCarryingBase,
          totalClosingBase,
          totalDeltaBase,
          journalEntryId,
          reversalJournalEntryId,
          reversalStatus,
          userId,
          tenantId,
          runId,
        ]
      );

      const runRow = await loadRunById({ tenantId, runId, runQuery: tx.query });
      const lines = await loadRunLines({ tenantId, runId, runQuery: tx.query });
      return {
        run: mapRunRow(runRow),
        lines,
        idempotentReplay: false,
      };
    });
  } catch (err) {
    if (activeRunId) {
      try {
        await query(
          `UPDATE cash_fx_revaluation_runs
           SET status = ?
           WHERE tenant_id = ?
             AND id = ?
             AND status = ?`,
          [RUN_STATUS_FAILED, tenantId, activeRunId, RUN_STATUS_DRAFT]
        );
      } catch {
        // Ignore fallback status update failures.
      }
    }
    throw err;
  }
}

export async function getCashFxRevaluationRunById({ tenantId, runId }) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedRunId = parsePositiveInt(runId);
  if (!normalizedTenantId || !normalizedRunId) {
    throw badRequest("tenantId and runId are required");
  }
  const run = await loadRunById({ tenantId: normalizedTenantId, runId: normalizedRunId });
  if (!run) {
    throw badRequest("cashFxRevaluationRunId not found");
  }
  const lines = await loadRunLines({ tenantId: normalizedTenantId, runId: normalizedRunId });
  return {
    run: mapRunRow(run),
    lines,
  };
}

export default {
  evaluateCashFxRevaluationCloseGate,
  evaluateCashFxRevaluationReversalIntegrity,
  runCashFxRevaluation,
  getCashFxRevaluationRunById,
};
