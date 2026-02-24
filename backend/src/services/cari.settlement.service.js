import { query, withTransaction } from "../db.js";
import {
  assertAccountBelongsToTenant,
  assertCurrencyExists,
  assertLegalEntityBelongsToTenant,
} from "../tenantGuards.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";

const AMOUNT_SCALE = 6;
const AMOUNT_EPSILON = 0.000001;
const FX_RATE_TYPE_SPOT = "SPOT";
const SETTLEMENT_SEQUENCE_NAMESPACE = "SETTLEMENT";
const SETTLEMENT_STATUS_POSTED = "POSTED";
const SETTLEMENT_STATUS_REVERSED = "REVERSED";
const OPEN_ITEM_STATUS_OPEN = "OPEN";
const OPEN_ITEM_STATUS_PARTIALLY_SETTLED = "PARTIALLY_SETTLED";
const OPEN_ITEM_STATUS_SETTLED = "SETTLED";
const DOCUMENT_STATUS_POSTED = "POSTED";
const DOCUMENT_STATUS_PARTIALLY_SETTLED = "PARTIALLY_SETTLED";
const DOCUMENT_STATUS_SETTLED = "SETTLED";
const UNAPPLIED_STATUS_UNAPPLIED = "UNAPPLIED";
const UNAPPLIED_STATUS_PARTIALLY_APPLIED = "PARTIALLY_APPLIED";
const UNAPPLIED_STATUS_FULL = "FULLY_APPLIED";
const UNAPPLIED_STATUS_REVERSED = "REVERSED";
const BANK_ATTACH_TARGET_SETTLEMENT = "SETTLEMENT";
const BANK_ATTACH_TARGET_UNAPPLIED_CASH = "UNAPPLIED_CASH";
const RESOURCE_TYPE_SETTLEMENT_BATCH = "cari_settlement_batch";
const RESOURCE_TYPE_UNAPPLIED_CASH = "cari_unapplied_cash";
const CARI_SETTLEMENT_REFERENCE_PREFIX = "CARI_SETTLE:";
const CARI_SETTLEMENT_REVERSE_REFERENCE_PREFIX = "CARI_SETTLE_REV:";
const FOLLOW_UP_RISKS = Object.freeze([
  "Posting depends on configured journal_purpose_accounts mappings (CARI_AR_CONTROL, CARI_AR_OFFSET, CARI_AP_CONTROL, CARI_AP_OFFSET). Missing setup blocks posting.",
  "FX lookup uses exact-date SPOT for currency pair in this PR. Nearest-prior fallback or rate-type selection can be added in a follow-up PR.",
  "Settlement posting uses a generic 2-line control/offset model. Transaction-type-specific derivation can be added in a follow-up PR.",
]);
const CARI_SETTLEMENT_PURPOSES = Object.freeze({
  AR: Object.freeze({
    control: "CARI_AR_CONTROL",
    offset: "CARI_AR_OFFSET",
  }),
  AP: Object.freeze({
    control: "CARI_AP_CONTROL",
    offset: "CARI_AP_OFFSET",
  }),
});

function normalizeUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function toDecimalNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundAmount(value) {
  return Number(Number(value || 0).toFixed(AMOUNT_SCALE));
}

function amountsAreEqual(left, right, epsilon = AMOUNT_EPSILON) {
  return Math.abs(Number(left || 0) - Number(right || 0)) <= epsilon;
}

function toDateOnlyString(value, label = "date") {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw badRequest(`${label} must be a valid date`);
    }
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}(?:\b|T)/.test(raw)) {
    return raw.slice(0, 10);
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw badRequest(`${label} must be a valid date`);
  }
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeDateInput(value, label) {
  const normalized = toDateOnlyString(value, label);
  if (!normalized) {
    throw badRequest(`${label} must be YYYY-MM-DD`);
  }
  return normalized;
}

function normalizeAmount(value, label = "amount", { allowZero = false } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw badRequest(`${label} must be numeric`);
  }
  if (allowZero ? parsed < 0 : parsed <= 0) {
    throw badRequest(
      allowZero ? `${label} must be >= 0` : `${label} must be > 0`
    );
  }
  return roundAmount(parsed);
}

function normalizeSignedAmount(value, label = "amount", { allowZero = true } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw badRequest(`${label} must be numeric`);
  }
  if (!allowZero && Math.abs(parsed) <= AMOUNT_EPSILON) {
    throw badRequest(`${label} must not be zero`);
  }
  return roundAmount(parsed);
}

function normalizeOptionalPositiveDecimal(value, label) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw badRequest(`${label} must be a numeric value greater than 0`);
  }
  return Number(parsed.toFixed(10));
}

function normalizeOptionalPositiveInt(value, label) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = parsePositiveInt(value);
  if (!parsed) {
    throw badRequest(`${label} must be a positive integer`);
  }
  return parsed;
}

function textsEqual(left, right) {
  return toNullableString(left, 100) === toNullableString(right, 100);
}

function resolveBankLinkFields({
  targetLabel,
  existingBankStatementLineId,
  existingBankTransactionRef,
  requestedBankStatementLineId,
  requestedBankTransactionRef,
}) {
  const existingStatementLineId = normalizeOptionalPositiveInt(
    existingBankStatementLineId,
    `${targetLabel}.bankStatementLineId`
  );
  const requestedStatementLineId = normalizeOptionalPositiveInt(
    requestedBankStatementLineId,
    "bankStatementLineId"
  );
  if (
    existingStatementLineId &&
    requestedStatementLineId &&
    existingStatementLineId !== requestedStatementLineId
  ) {
    throw badRequest(`${targetLabel} is already linked to a different bankStatementLineId`);
  }

  const existingTransactionRef = toNullableString(existingBankTransactionRef, 100);
  const requestedTransactionRef = toNullableString(requestedBankTransactionRef, 100);
  if (
    existingTransactionRef &&
    requestedTransactionRef &&
    !textsEqual(existingTransactionRef, requestedTransactionRef)
  ) {
    throw badRequest(`${targetLabel} is already linked to a different bankTransactionRef`);
  }

  const nextBankStatementLineId = requestedStatementLineId || existingStatementLineId || null;
  const nextBankTransactionRef = requestedTransactionRef || existingTransactionRef || null;
  if (!nextBankStatementLineId && !nextBankTransactionRef) {
    throw badRequest("bankStatementLineId or bankTransactionRef is required");
  }

  return {
    nextBankStatementLineId,
    nextBankTransactionRef,
  };
}

function toNullableString(value, maxLength = 255) {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value).trim();
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, maxLength);
}

function resolveClientIp(req) {
  const forwardedFor = String(req?.headers?.["x-forwarded-for"] || "").trim();
  if (forwardedFor) {
    const firstIp = forwardedFor
      .split(",")
      .map((segment) => segment.trim())
      .find(Boolean);
    if (firstIp) {
      return firstIp.slice(0, 64);
    }
  }
  return String(req?.ip || req?.socket?.remoteAddress || "unknown").slice(0, 64);
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({
      serializationError: "payload_json could not be serialized",
    });
  }
}

function isDuplicateKeyError(err, constraintName = null) {
  if (Number(err?.errno) !== 1062) {
    return false;
  }
  if (!constraintName) {
    return true;
  }
  return String(err?.message || "").includes(constraintName);
}

function buildCariJournalNo(prefix, settlementBatchId) {
  const normalizedPrefix =
    normalizeUpperText(prefix || "CARI-SETTLE").slice(0, 12) || "CARI-SETTLE";
  const parsedBatchId = parsePositiveInt(settlementBatchId);
  const stamp = Date.now().toString(36).toUpperCase();
  const base = parsedBatchId
    ? `${normalizedPrefix}-${parsedBatchId}-${stamp}`
    : `${normalizedPrefix}-${stamp}`;
  return base.slice(0, 40);
}

function buildSettlementNo({ fiscalYear, sequenceNo }) {
  const safeYear = Number(fiscalYear) || 0;
  const safeSequence = Number(sequenceNo) || 0;
  return `SETTLEMENT-${safeYear}-${String(safeSequence).padStart(6, "0")}`;
}

function buildUnappliedReceiptNo(settlementNo) {
  const base = `UNAP-${String(settlementNo || "").trim()}`;
  return base.slice(0, 80);
}

function ensureBalancedJournalLines(lines) {
  let debitTotal = 0;
  let creditTotal = 0;
  for (const line of lines || []) {
    debitTotal += Number(line.debitBase || 0);
    creditTotal += Number(line.creditBase || 0);
  }
  if (Math.abs(debitTotal - creditTotal) > AMOUNT_EPSILON) {
    throw badRequest("Cari settlement journal is not balanced");
  }
  return {
    totalDebit: roundAmount(debitTotal),
    totalCredit: roundAmount(creditTotal),
  };
}

function mapSettlementBatchRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    counterpartyId: parsePositiveInt(row.counterparty_id),
    sequenceNamespace: row.sequence_namespace,
    fiscalYear: Number(row.fiscal_year),
    sequenceNo: Number(row.sequence_no),
    settlementNo: row.settlement_no,
    settlementDate: toDateOnlyString(row.settlement_date, "settlementDate"),
    status: row.status,
    totalAllocatedTxn: toDecimalNumber(row.total_allocated_txn),
    totalAllocatedBase: toDecimalNumber(row.total_allocated_base),
    currencyCode: row.currency_code,
    postedJournalEntryId: parsePositiveInt(row.posted_journal_entry_id),
    reversalOfSettlementBatchId: parsePositiveInt(row.reversal_of_settlement_batch_id),
    bankStatementLineId: parsePositiveInt(row.bank_statement_line_id),
    bankTransactionRef: row.bank_transaction_ref || null,
    bankAttachIdempotencyKey: row.bank_attach_idempotency_key || null,
    bankApplyIdempotencyKey: row.bank_apply_idempotency_key || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    postedAt: row.posted_at || null,
    reversedAt: row.reversed_at || null,
  };
}

function mapAllocationRow(row) {
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    settlementBatchId: parsePositiveInt(row.settlement_batch_id),
    openItemId: parsePositiveInt(row.open_item_id),
    allocationDate: toDateOnlyString(row.allocation_date, "allocationDate"),
    allocationAmountTxn: toDecimalNumber(row.allocation_amount_txn),
    allocationAmountBase: toDecimalNumber(row.allocation_amount_base),
    applyIdempotencyKey: row.apply_idempotency_key || null,
    bankStatementLineId: parsePositiveInt(row.bank_statement_line_id),
    bankApplyIdempotencyKey: row.bank_apply_idempotency_key || null,
    note: row.note || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function mapUnappliedCashRow(row) {
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    counterpartyId: parsePositiveInt(row.counterparty_id),
    cashReceiptNo: row.cash_receipt_no,
    receiptDate: toDateOnlyString(row.receipt_date, "receiptDate"),
    status: row.status,
    amountTxn: toDecimalNumber(row.amount_txn),
    amountBase: toDecimalNumber(row.amount_base),
    residualAmountTxn: toDecimalNumber(row.residual_amount_txn),
    residualAmountBase: toDecimalNumber(row.residual_amount_base),
    currencyCode: row.currency_code,
    postedJournalEntryId: parsePositiveInt(row.posted_journal_entry_id),
    settlementBatchId: parsePositiveInt(row.settlement_batch_id),
    reversalOfUnappliedCashId: parsePositiveInt(row.reversal_of_unapplied_cash_id),
    bankStatementLineId: parsePositiveInt(row.bank_statement_line_id),
    bankTransactionRef: row.bank_transaction_ref || null,
    bankAttachIdempotencyKey: row.bank_attach_idempotency_key || null,
    bankApplyIdempotencyKey: row.bank_apply_idempotency_key || null,
    note: row.note || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

async function insertAuditLog({
  req,
  runQuery = query,
  tenantId,
  userId,
  action,
  resourceType = RESOURCE_TYPE_SETTLEMENT_BATCH,
  legalEntityId,
  resourceId,
  payload,
}) {
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
      action,
      resourceType,
      resourceId ? String(resourceId) : null,
      legalEntityId ? "LEGAL_ENTITY" : null,
      legalEntityId || null,
      toNullableString(req?.requestId || req?.headers?.["x-request-id"], 80),
      resolveClientIp(req),
      toNullableString(req?.headers?.["user-agent"], 255),
      safeStringify(payload || null),
    ]
  );
}

async function fetchCounterpartyRow({
  tenantId,
  legalEntityId,
  counterpartyId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
        id,
        tenant_id,
        legal_entity_id,
        code,
        name,
        is_customer,
        is_vendor,
        ar_account_id,
        ap_account_id,
        status
     FROM counterparties
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, legalEntityId, counterpartyId]
  );
  return result.rows?.[0] || null;
}

async function resolveBookAndOpenPeriodForDate({
  tenantId,
  legalEntityId,
  targetDate,
  preferredBookId = null,
  runQuery = query,
}) {
  const normalizedDate = normalizeDateInput(targetDate, "settlementDate");
  let book = null;

  if (preferredBookId) {
    const preferredBookResult = await runQuery(
      `SELECT id, calendar_id, base_currency_code, book_type
       FROM books
       WHERE tenant_id = ?
         AND legal_entity_id = ?
         AND id = ?
       LIMIT 1`,
      [tenantId, legalEntityId, preferredBookId]
    );
    book = preferredBookResult.rows?.[0] || null;
  }

  if (!book) {
    const bookResult = await runQuery(
      `SELECT id, calendar_id, base_currency_code, book_type
       FROM books
       WHERE tenant_id = ?
         AND legal_entity_id = ?
       ORDER BY
         CASE WHEN book_type = 'LOCAL' THEN 0 ELSE 1 END,
         id ASC
       LIMIT 1`,
      [tenantId, legalEntityId]
    );
    book = bookResult.rows?.[0] || null;
  }
  if (!book) {
    throw badRequest("No book found for settlement legalEntityId");
  }

  const bookId = parsePositiveInt(book.id);
  const calendarId = parsePositiveInt(book.calendar_id);
  if (!bookId || !calendarId) {
    throw badRequest("Book configuration is invalid for settlement posting");
  }

  const periodResult = await runQuery(
    `SELECT id, fiscal_year, period_no, start_date, end_date
     FROM fiscal_periods
     WHERE calendar_id = ?
       AND ? BETWEEN start_date AND end_date
     ORDER BY is_adjustment ASC, id ASC
     LIMIT 1`,
    [calendarId, normalizedDate]
  );
  const period = periodResult.rows?.[0] || null;
  if (!period) {
    throw badRequest("No fiscal period found for settlement date");
  }

  const fiscalPeriodId = parsePositiveInt(period.id);
  if (!fiscalPeriodId) {
    throw badRequest("Fiscal period configuration is invalid for settlement posting");
  }

  const statusResult = await runQuery(
    `SELECT status
     FROM period_statuses
     WHERE book_id = ?
       AND fiscal_period_id = ?
     LIMIT 1`,
    [bookId, fiscalPeriodId]
  );
  const periodStatus = normalizeUpperText(statusResult.rows?.[0]?.status || "OPEN");
  if (periodStatus !== "OPEN") {
    throw badRequest(`Period is ${periodStatus}; cannot apply/reverse settlement`);
  }

  return {
    bookId,
    fiscalPeriodId,
    fiscalYear: Number(period.fiscal_year),
    baseCurrencyCode: normalizeUpperText(book.base_currency_code),
  };
}

async function reserveSettlementSequence({
  tenantId,
  legalEntityId,
  settlementDate,
  runQuery = query,
}) {
  const normalizedDate = normalizeDateInput(settlementDate, "settlementDate");
  const fiscalYear = Number(normalizedDate.slice(0, 4));
  const sequenceNamespace = SETTLEMENT_SEQUENCE_NAMESPACE;

  const result = await runQuery(
    `SELECT COALESCE(MAX(sequence_no), 0) AS current_max
     FROM cari_settlement_batches
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND sequence_namespace = ?
       AND fiscal_year = ?
     FOR UPDATE`,
    [tenantId, legalEntityId, sequenceNamespace, fiscalYear]
  );
  const nextSequenceNo = Number(result.rows?.[0]?.current_max || 0) + 1;
  return {
    sequenceNamespace,
    fiscalYear,
    sequenceNo: nextSequenceNo,
    settlementNo: buildSettlementNo({
      fiscalYear,
      sequenceNo: nextSequenceNo,
    }),
  };
}

async function resolveCounterpartyControlAccountOverride({
  tenantId,
  legalEntityId,
  direction,
  counterpartyRow,
  runQuery = query,
}) {
  if (!counterpartyRow || !parsePositiveInt(counterpartyRow.id)) {
    return null;
  }

  const normalizedDirection = normalizeUpperText(direction);
  const mapping =
    normalizedDirection === "AR"
      ? {
          accountId: parsePositiveInt(counterpartyRow.ar_account_id),
          roleEnabled: counterpartyRow.is_customer === true || Number(counterpartyRow.is_customer) === 1,
          fieldLabel: "arAccountId",
          expectedAccountType: "ASSET",
        }
      : normalizedDirection === "AP"
        ? {
            accountId: parsePositiveInt(counterpartyRow.ap_account_id),
            roleEnabled:
              counterpartyRow.is_vendor === true || Number(counterpartyRow.is_vendor) === 1,
            fieldLabel: "apAccountId",
            expectedAccountType: "LIABILITY",
          }
        : null;

  if (!mapping) {
    throw badRequest("Settlement direction must be AR or AP");
  }
  if (!mapping.accountId) {
    return null;
  }
  if (!mapping.roleEnabled) {
    throw badRequest(`${mapping.fieldLabel} requires compatible counterparty role`);
  }

  await assertAccountBelongsToTenant(tenantId, mapping.accountId, mapping.fieldLabel, {
    runQuery,
  });

  const accountResult = await runQuery(
    `SELECT
        a.id,
        a.code,
        a.account_type,
        a.is_active,
        a.allow_posting,
        c.scope AS coa_scope,
        c.legal_entity_id AS coa_legal_entity_id
     FROM accounts a
     JOIN charts_of_accounts c ON c.id = a.coa_id
     WHERE a.id = ?
       AND c.tenant_id = ?
     LIMIT 1`,
    [mapping.accountId, tenantId]
  );
  const account = accountResult.rows?.[0] || null;
  if (!account) {
    throw badRequest(`${mapping.fieldLabel} not found for tenant`);
  }

  if (normalizeUpperText(account.coa_scope) !== "LEGAL_ENTITY") {
    throw badRequest(`${mapping.fieldLabel} must belong to a LEGAL_ENTITY chart`);
  }
  if (parsePositiveInt(account.coa_legal_entity_id) !== parsePositiveInt(legalEntityId)) {
    throw badRequest(`${mapping.fieldLabel} must belong to legalEntityId`);
  }
  if (normalizeUpperText(account.account_type) !== mapping.expectedAccountType) {
    throw badRequest(`${mapping.fieldLabel} must have accountType=${mapping.expectedAccountType}`);
  }
  if (!(account.is_active === true || Number(account.is_active) === 1)) {
    throw badRequest(`${mapping.fieldLabel} must reference an ACTIVE account`);
  }
  if (!(account.allow_posting === true || Number(account.allow_posting) === 1)) {
    throw badRequest(`${mapping.fieldLabel} must reference a postable account`);
  }

  return {
    id: parsePositiveInt(account.id),
    code: account.code || null,
  };
}

async function resolveSettlementPostingAccounts({
  tenantId,
  legalEntityId,
  direction,
  counterpartyRow = null,
  runQuery = query,
}) {
  const purposeDefinition = CARI_SETTLEMENT_PURPOSES[normalizeUpperText(direction)];
  if (!purposeDefinition) {
    throw badRequest("Settlement direction must be AR or AP");
  }

  const requestedPurposes = [purposeDefinition.control, purposeDefinition.offset];
  const placeholders = requestedPurposes.map(() => "?").join(", ");
  const result = await runQuery(
    `SELECT
       jpa.purpose_code,
       a.id AS account_id,
       a.code AS account_code
     FROM journal_purpose_accounts jpa
     JOIN accounts a ON a.id = jpa.account_id
     JOIN charts_of_accounts c ON c.id = a.coa_id
     WHERE jpa.tenant_id = ?
       AND jpa.legal_entity_id = ?
       AND jpa.purpose_code IN (${placeholders})
       AND c.tenant_id = ?
       AND c.legal_entity_id = ?
       AND a.is_active = TRUE
       AND a.allow_posting = TRUE`,
    [tenantId, legalEntityId, ...requestedPurposes, tenantId, legalEntityId]
  );

  const byPurpose = new Map(
    (result.rows || []).map((row) => [
      normalizeUpperText(row.purpose_code),
      {
        id: parsePositiveInt(row.account_id),
        code: String(row.account_code || ""),
      },
    ])
  );

  const control = byPurpose.get(purposeDefinition.control);
  const offset = byPurpose.get(purposeDefinition.offset);
  if (!control?.id || !offset?.id) {
    throw badRequest(
      `Setup required: configure journal_purpose_accounts for ${purposeDefinition.control} and ${purposeDefinition.offset}`
    );
  }

  const overrideControl = await resolveCounterpartyControlAccountOverride({
    tenantId,
    legalEntityId,
    direction,
    counterpartyRow,
    runQuery,
  });
  const effectiveControl = overrideControl?.id
    ? {
        id: overrideControl.id,
        code: overrideControl.code || null,
      }
    : control;

  if (effectiveControl.id === offset.id) {
    throw badRequest("Cari settlement control and offset accounts must be different");
  }

  return {
    controlAccountId: effectiveControl.id,
    offsetAccountId: offset.id,
    controlAccountCode: effectiveControl.code || null,
    offsetAccountCode: offset.code || null,
  };
}

async function resolveSettlementFxRate({
  tenantId,
  settlementDate,
  settlementCurrencyCode,
  functionalCurrencyCode,
  providedFxRate,
  runQuery = query,
}) {
  const normalizedDate = normalizeDateInput(settlementDate, "settlementDate");
  const settlementCurrency = normalizeUpperText(settlementCurrencyCode);
  const functionalCurrency = normalizeUpperText(functionalCurrencyCode);
  const normalizedProvidedRate = normalizeOptionalPositiveDecimal(
    providedFxRate,
    "fxRate"
  );

  if (!settlementCurrency || !functionalCurrency) {
    throw badRequest("Settlement and functional currency codes are required");
  }

  if (settlementCurrency === functionalCurrency) {
    const effectiveRate = normalizedProvidedRate || 1;
    if (!amountsAreEqual(effectiveRate, 1)) {
      throw badRequest(
        "fxRate must be 1 when settlement currency equals legal entity functional currency"
      );
    }
    return {
      settlementFxRate: 1,
      source: "PARITY",
      rateDate: normalizedDate,
      riskNotes: FOLLOW_UP_RISKS,
    };
  }

  const fxResult = await runQuery(
    `SELECT rate, rate_date
     FROM fx_rates
     WHERE tenant_id = ?
       AND rate_date = ?
       AND from_currency_code = ?
       AND to_currency_code = ?
       AND rate_type = ?
     ORDER BY id DESC
     LIMIT 1`,
    [
      tenantId,
      normalizedDate,
      settlementCurrency,
      functionalCurrency,
      FX_RATE_TYPE_SPOT,
    ]
  );
  const fxRow = fxResult.rows?.[0] || null;
  const tableRate = normalizeOptionalPositiveDecimal(fxRow?.rate, "fxRates.rate");
  const effectiveRate = normalizedProvidedRate || tableRate;
  if (!effectiveRate) {
    throw badRequest(
      "fxRate is required because no exact-date SPOT FX rate exists for settlementDate and currency pair"
    );
  }

  return {
    settlementFxRate: effectiveRate,
    source: normalizedProvidedRate ? "REQUEST" : "FX_TABLE_EXACT_SPOT",
    rateDate: toDateOnlyString(fxRow?.rate_date || normalizedDate, "fxRateDate"),
    riskNotes: FOLLOW_UP_RISKS,
  };
}

async function insertPostedJournalWithLinesTx(tx, payload) {
  const totals = ensureBalancedJournalLines(payload.lines);
  const insertResult = await tx.query(
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
      payload.description,
      payload.referenceNo,
      totals.totalDebit,
      totals.totalCredit,
      payload.userId,
      payload.userId,
    ]
  );
  const journalEntryId = parsePositiveInt(insertResult.rows?.insertId);
  if (!journalEntryId) {
    throw badRequest("Failed to create settlement journal entry");
  }

  for (let i = 0; i < payload.lines.length; i += 1) {
    const line = payload.lines[i];
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
       VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, NULL)`,
      [
        journalEntryId,
        i + 1,
        parsePositiveInt(line.accountId),
        line.description || null,
        line.subledgerReferenceNo || null,
        line.currencyCode,
        normalizeSignedAmount(line.amountTxn, `line[${i}].amountTxn`),
        normalizeAmount(line.debitBase, `line[${i}].debitBase`, { allowZero: true }),
        normalizeAmount(line.creditBase, `line[${i}].creditBase`, { allowZero: true }),
      ]
    );
  }

  return {
    journalEntryId,
    lineCount: payload.lines.length,
    totalDebit: totals.totalDebit,
    totalCredit: totals.totalCredit,
  };
}

async function fetchPostedJournalWithLines({
  tenantId,
  journalEntryId,
  runQuery = query,
}) {
  const journalResult = await runQuery(
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
       posted_at,
       reversal_journal_entry_id
     FROM journal_entries
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, journalEntryId]
  );
  const journalRow = journalResult.rows?.[0] || null;
  if (!journalRow) {
    return null;
  }

  const lineResult = await runQuery(
    `SELECT
       id,
       line_no,
       account_id,
       description,
       subledger_reference_no,
       currency_code,
       amount_txn,
       debit_base,
       credit_base
     FROM journal_lines
     WHERE journal_entry_id = ?
     ORDER BY line_no ASC`,
    [journalEntryId]
  );

  return {
    journal: journalRow,
    lines: lineResult.rows || [],
  };
}

async function fetchSettlementBatchRow({
  tenantId,
  settlementBatchId,
  runQuery = query,
  forUpdate = false,
}) {
  const lockClause = forUpdate ? "FOR UPDATE" : "";
  const result = await runQuery(
    `SELECT
       id,
       tenant_id,
       legal_entity_id,
       counterparty_id,
       sequence_namespace,
       fiscal_year,
       sequence_no,
       settlement_no,
       settlement_date,
       status,
       total_allocated_txn,
       total_allocated_base,
       currency_code,
       posted_journal_entry_id,
       reversal_of_settlement_batch_id,
       bank_statement_line_id,
       bank_transaction_ref,
       bank_attach_idempotency_key,
       bank_apply_idempotency_key,
       created_at,
       updated_at,
       posted_at,
       reversed_at
     FROM cari_settlement_batches
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1
     ${lockClause}`,
    [tenantId, settlementBatchId]
  );
  return result.rows?.[0] || null;
}

async function fetchSettlementAllocationsByBatchId({
  tenantId,
  settlementBatchId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
       id,
       tenant_id,
       legal_entity_id,
       settlement_batch_id,
       open_item_id,
       allocation_date,
       allocation_amount_txn,
       allocation_amount_base,
       apply_idempotency_key,
       bank_statement_line_id,
       bank_apply_idempotency_key,
       note,
       created_at,
       updated_at
     FROM cari_settlement_allocations
     WHERE tenant_id = ?
       AND settlement_batch_id = ?
     ORDER BY id ASC`,
    [tenantId, settlementBatchId]
  );
  return result.rows || [];
}
async function findSettlementBatchIdByApplyIdempotency({
  tenantId,
  legalEntityId,
  applyIdempotencyKey,
  runQuery = query,
}) {
  const normalizedKey = toNullableString(applyIdempotencyKey, 100);
  if (!normalizedKey) {
    return null;
  }
  const result = await runQuery(
    `SELECT settlement_batch_id
     FROM cari_settlement_allocations
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND apply_idempotency_key = ?
     LIMIT 1`,
    [tenantId, legalEntityId, normalizedKey]
  );
  return parsePositiveInt(result.rows?.[0]?.settlement_batch_id);
}

async function findSettlementBatchIdByBankApplyIdempotency({
  tenantId,
  legalEntityId,
  bankApplyIdempotencyKey,
  runQuery = query,
}) {
  const normalizedKey = toNullableString(bankApplyIdempotencyKey, 100);
  if (!normalizedKey) {
    return null;
  }
  const result = await runQuery(
    `SELECT id
     FROM cari_settlement_batches
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND bank_apply_idempotency_key = ?
     LIMIT 1`,
    [tenantId, legalEntityId, normalizedKey]
  );
  return parsePositiveInt(result.rows?.[0]?.id);
}

async function fetchSettlementBatchRowByBankAttachIdempotency({
  tenantId,
  legalEntityId,
  bankAttachIdempotencyKey,
  runQuery = query,
  forUpdate = false,
}) {
  const normalizedKey = toNullableString(bankAttachIdempotencyKey, 100);
  if (!normalizedKey) {
    return null;
  }
  const lockClause = forUpdate ? "FOR UPDATE" : "";
  const result = await runQuery(
    `SELECT
       id,
       tenant_id,
       legal_entity_id,
       counterparty_id,
       sequence_namespace,
       fiscal_year,
       sequence_no,
       settlement_no,
       settlement_date,
       status,
       total_allocated_txn,
       total_allocated_base,
       currency_code,
       posted_journal_entry_id,
       reversal_of_settlement_batch_id,
       bank_statement_line_id,
       bank_transaction_ref,
       bank_attach_idempotency_key,
       bank_apply_idempotency_key,
       created_at,
       updated_at,
       posted_at,
       reversed_at
     FROM cari_settlement_batches
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND bank_attach_idempotency_key = ?
     LIMIT 1
     ${lockClause}`,
    [tenantId, legalEntityId, normalizedKey]
  );
  return result.rows?.[0] || null;
}

async function fetchUnappliedCashRowById({
  tenantId,
  legalEntityId,
  unappliedCashId,
  runQuery = query,
  forUpdate = false,
}) {
  const lockClause = forUpdate ? "FOR UPDATE" : "";
  const result = await runQuery(
    `SELECT
       id,
       tenant_id,
       legal_entity_id,
       counterparty_id,
       cash_receipt_no,
       receipt_date,
       status,
       amount_txn,
       amount_base,
       residual_amount_txn,
       residual_amount_base,
       currency_code,
       posted_journal_entry_id,
       settlement_batch_id,
       reversal_of_unapplied_cash_id,
       bank_statement_line_id,
       bank_transaction_ref,
       bank_attach_idempotency_key,
       bank_apply_idempotency_key,
       note,
       created_at,
       updated_at
     FROM cari_unapplied_cash
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND id = ?
     LIMIT 1
     ${lockClause}`,
    [tenantId, legalEntityId, unappliedCashId]
  );
  return result.rows?.[0] || null;
}

async function fetchUnappliedCashRowByBankAttachIdempotency({
  tenantId,
  legalEntityId,
  bankAttachIdempotencyKey,
  runQuery = query,
  forUpdate = false,
}) {
  const normalizedKey = toNullableString(bankAttachIdempotencyKey, 100);
  if (!normalizedKey) {
    return null;
  }
  const lockClause = forUpdate ? "FOR UPDATE" : "";
  const result = await runQuery(
    `SELECT
       id,
       tenant_id,
       legal_entity_id,
       counterparty_id,
       cash_receipt_no,
       receipt_date,
       status,
       amount_txn,
       amount_base,
       residual_amount_txn,
       residual_amount_base,
       currency_code,
       posted_journal_entry_id,
       settlement_batch_id,
       reversal_of_unapplied_cash_id,
       bank_statement_line_id,
       bank_transaction_ref,
       bank_attach_idempotency_key,
       bank_apply_idempotency_key,
       note,
       created_at,
       updated_at
     FROM cari_unapplied_cash
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND bank_attach_idempotency_key = ?
     LIMIT 1
     ${lockClause}`,
    [tenantId, legalEntityId, normalizedKey]
  );
  return result.rows?.[0] || null;
}

async function findReversalSettlementBatchId({
  tenantId,
  originalSettlementBatchId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT id
     FROM cari_settlement_batches
     WHERE tenant_id = ?
       AND reversal_of_settlement_batch_id = ?
     LIMIT 1`,
    [tenantId, originalSettlementBatchId]
  );
  return parsePositiveInt(result.rows?.[0]?.id);
}

async function fetchOpenItemsForApply({
  tenantId,
  legalEntityId,
  counterpartyId,
  currencyCode,
  openItemIds = null,
  runQuery = query,
}) {
  const statuses = [OPEN_ITEM_STATUS_OPEN, OPEN_ITEM_STATUS_PARTIALLY_SETTLED];
  const params = [
    tenantId,
    legalEntityId,
    counterpartyId,
    normalizeUpperText(currencyCode),
    ...statuses,
  ];
  let whereExtra = "";
  if (Array.isArray(openItemIds) && openItemIds.length > 0) {
    whereExtra = ` AND oi.id IN (${openItemIds.map(() => "?").join(", ")})`;
    params.push(...openItemIds);
  }

  const result = await runQuery(
    `SELECT
       oi.id,
       oi.tenant_id,
       oi.legal_entity_id,
       oi.counterparty_id,
       oi.document_id,
       oi.status,
       oi.document_date,
       oi.due_date,
       oi.original_amount_txn,
       oi.original_amount_base,
       oi.residual_amount_txn,
       oi.residual_amount_base,
       oi.settled_amount_txn,
       oi.settled_amount_base,
       oi.currency_code,
       d.direction,
       d.document_type,
       d.status AS document_status
     FROM cari_open_items oi
     JOIN cari_documents d
       ON d.tenant_id = oi.tenant_id
      AND d.legal_entity_id = oi.legal_entity_id
      AND d.id = oi.document_id
     WHERE oi.tenant_id = ?
       AND oi.legal_entity_id = ?
       AND oi.counterparty_id = ?
       AND oi.currency_code = ?
       AND oi.status IN (?, ?)
       AND oi.residual_amount_txn > 0
       ${whereExtra}
     ORDER BY oi.id ASC
     FOR UPDATE`,
    params
  );
  return result.rows || [];
}

async function fetchOpenItemsByIdsForUpdate({
  tenantId,
  legalEntityId,
  openItemIds,
  runQuery = query,
}) {
  if (!Array.isArray(openItemIds) || openItemIds.length === 0) {
    return [];
  }
  const result = await runQuery(
    `SELECT
       oi.id,
       oi.tenant_id,
       oi.legal_entity_id,
       oi.counterparty_id,
       oi.document_id,
       oi.status,
       oi.document_date,
       oi.due_date,
       oi.original_amount_txn,
       oi.original_amount_base,
       oi.residual_amount_txn,
       oi.residual_amount_base,
       oi.settled_amount_txn,
       oi.settled_amount_base,
       oi.currency_code,
       d.direction,
       d.document_type,
       d.status AS document_status
     FROM cari_open_items oi
     JOIN cari_documents d
       ON d.tenant_id = oi.tenant_id
      AND d.legal_entity_id = oi.legal_entity_id
      AND d.id = oi.document_id
     WHERE oi.tenant_id = ?
       AND oi.legal_entity_id = ?
       AND oi.id IN (${openItemIds.map(() => "?").join(", ")})
     ORDER BY oi.id ASC
     FOR UPDATE`,
    [tenantId, legalEntityId, ...openItemIds]
  );
  return result.rows || [];
}

async function fetchUnappliedRowsForApply({
  tenantId,
  legalEntityId,
  counterpartyId,
  currencyCode,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
       id,
       tenant_id,
       legal_entity_id,
       counterparty_id,
       cash_receipt_no,
       receipt_date,
       status,
       amount_txn,
       amount_base,
       residual_amount_txn,
       residual_amount_base,
       currency_code,
       note
     FROM cari_unapplied_cash
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND counterparty_id = ?
       AND currency_code = ?
       AND status IN (?, ?)
       AND residual_amount_txn > 0
     ORDER BY id ASC
     FOR UPDATE`,
    [
      tenantId,
      legalEntityId,
      counterpartyId,
      normalizeUpperText(currencyCode),
      UNAPPLIED_STATUS_UNAPPLIED,
      UNAPPLIED_STATUS_PARTIALLY_APPLIED,
    ]
  );
  return result.rows || [];
}

function normalizeOpenItemStatus({
  originalAmountTxn,
  residualAmountTxn,
  settledAmountTxn,
}) {
  const original = roundAmount(originalAmountTxn);
  const residual = roundAmount(residualAmountTxn);
  const settled = roundAmount(settledAmountTxn);

  if (amountsAreEqual(residual, 0)) {
    return OPEN_ITEM_STATUS_SETTLED;
  }
  if (amountsAreEqual(settled, 0) || amountsAreEqual(residual, original)) {
    return OPEN_ITEM_STATUS_OPEN;
  }
  return OPEN_ITEM_STATUS_PARTIALLY_SETTLED;
}

function normalizeUnappliedStatus({
  residualAmountTxn,
  amountTxn,
}) {
  const residual = roundAmount(residualAmountTxn);
  const amount = roundAmount(amountTxn);
  if (amountsAreEqual(residual, 0)) {
    return UNAPPLIED_STATUS_FULL;
  }
  if (amountsAreEqual(residual, amount)) {
    return UNAPPLIED_STATUS_UNAPPLIED;
  }
  return UNAPPLIED_STATUS_PARTIALLY_APPLIED;
}

function buildManualAllocationPlan(openItems, requestedAllocations) {
  if (!Array.isArray(requestedAllocations) || requestedAllocations.length === 0) {
    return [];
  }
  const byOpenItem = new Map();
  for (const allocation of requestedAllocations) {
    const openItemId = parsePositiveInt(allocation?.openItemId);
    const amountTxn = normalizeAmount(allocation?.amountTxn, "allocations[].amountTxn");
    if (!openItemId) {
      throw badRequest("allocations[].openItemId must be a positive integer");
    }
    const current = byOpenItem.get(openItemId) || 0;
    byOpenItem.set(openItemId, roundAmount(current + amountTxn));
  }

  const openItemById = new Map(openItems.map((row) => [parsePositiveInt(row.id), row]));
  const plan = [];
  for (const [openItemId, allocationTxn] of byOpenItem.entries()) {
    const row = openItemById.get(openItemId);
    if (!row) {
      throw badRequest(`openItemId=${openItemId} is not available for settlement`);
    }
    const residualTxn = normalizeAmount(row.residual_amount_txn, "openItem.residualAmountTxn");
    if (allocationTxn > residualTxn + AMOUNT_EPSILON) {
      throw badRequest(`allocation exceeds residual for openItemId=${openItemId}`);
    }
    plan.push({
      openItemId,
      allocationTxn,
      row,
    });
  }

  return plan.sort((left, right) => left.openItemId - right.openItemId);
}

function buildAutoAllocationPlan(openItems, availableFundsTxn) {
  let remainingFunds = roundAmount(availableFundsTxn);
  if (remainingFunds <= AMOUNT_EPSILON) {
    return [];
  }

  const ordered = [...openItems].sort((left, right) => {
    const leftDue = toDateOnlyString(left.due_date, "dueDate") || "9999-12-31";
    const rightDue = toDateOnlyString(right.due_date, "dueDate") || "9999-12-31";
    if (leftDue !== rightDue) {
      return leftDue < rightDue ? -1 : 1;
    }
    const leftDocDate = toDateOnlyString(left.document_date, "documentDate") || "9999-12-31";
    const rightDocDate =
      toDateOnlyString(right.document_date, "documentDate") || "9999-12-31";
    if (leftDocDate !== rightDocDate) {
      return leftDocDate < rightDocDate ? -1 : 1;
    }
    return Number(left.id) - Number(right.id);
  });

  const plan = [];
  for (const row of ordered) {
    if (remainingFunds <= AMOUNT_EPSILON) {
      break;
    }
    const residualTxn = normalizeAmount(row.residual_amount_txn, "openItem.residualAmountTxn");
    if (residualTxn <= AMOUNT_EPSILON) {
      continue;
    }
    const allocationTxn = roundAmount(Math.min(remainingFunds, residualTxn));
    if (allocationTxn <= AMOUNT_EPSILON) {
      continue;
    }
    plan.push({
      openItemId: parsePositiveInt(row.id),
      allocationTxn,
      row,
    });
    remainingFunds = roundAmount(remainingFunds - allocationTxn);
  }

  return plan;
}

function calculateHistoricalBaseAllocation(row, allocationTxn) {
  const residualTxn = normalizeAmount(row.residual_amount_txn, "openItem.residualAmountTxn");
  const residualBase = normalizeAmount(row.residual_amount_base, "openItem.residualAmountBase");
  const normalizedAllocation = normalizeAmount(allocationTxn, "allocationTxn");
  if (normalizedAllocation > residualTxn + AMOUNT_EPSILON) {
    throw badRequest(`allocation exceeds residual for openItemId=${row.id}`);
  }

  if (amountsAreEqual(normalizedAllocation, residualTxn)) {
    return residualBase;
  }

  if (residualTxn <= AMOUNT_EPSILON) {
    return 0;
  }

  const proportional = roundAmount((normalizedAllocation * residualBase) / residualTxn);
  return proportional > residualBase ? residualBase : proportional;
}

async function refreshDocumentBalancesTx({
  tx,
  tenantId,
  legalEntityId,
  documentIds,
}) {
  if (!Array.isArray(documentIds) || documentIds.length === 0) {
    return;
  }
  const uniqueDocumentIds = Array.from(
    new Set(documentIds.map((value) => parsePositiveInt(value)).filter(Boolean))
  ).sort((left, right) => left - right);

  for (const documentId of uniqueDocumentIds) {
    // eslint-disable-next-line no-await-in-loop
    const documentResult = await tx.query(
      `SELECT
         id,
         status,
         amount_txn,
         amount_base
       FROM cari_documents
       WHERE tenant_id = ?
         AND legal_entity_id = ?
         AND id = ?
       LIMIT 1
       FOR UPDATE`,
      [tenantId, legalEntityId, documentId]
    );
    const documentRow = documentResult.rows?.[0] || null;
    if (!documentRow) {
      continue;
    }
    const existingStatus = normalizeUpperText(documentRow.status);
    if (["REVERSED", "CANCELLED", "DRAFT"].includes(existingStatus)) {
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const aggregateResult = await tx.query(
      `SELECT
         COALESCE(SUM(residual_amount_txn), 0) AS residual_txn,
         COALESCE(SUM(residual_amount_base), 0) AS residual_base
       FROM cari_open_items
       WHERE tenant_id = ?
         AND legal_entity_id = ?
         AND document_id = ?`,
      [tenantId, legalEntityId, documentId]
    );
    const residualTxn = roundAmount(aggregateResult.rows?.[0]?.residual_txn || 0);
    const residualBase = roundAmount(aggregateResult.rows?.[0]?.residual_base || 0);
    const amountTxn = normalizeAmount(documentRow.amount_txn, "document.amountTxn");

    let nextStatus = DOCUMENT_STATUS_PARTIALLY_SETTLED;
    if (amountsAreEqual(residualTxn, 0)) {
      nextStatus = DOCUMENT_STATUS_SETTLED;
    } else if (amountsAreEqual(residualTxn, amountTxn)) {
      nextStatus = DOCUMENT_STATUS_POSTED;
    }

    // eslint-disable-next-line no-await-in-loop
    await tx.query(
      `UPDATE cari_documents
       SET open_amount_txn = ?,
           open_amount_base = ?,
           status = ?
       WHERE tenant_id = ?
         AND legal_entity_id = ?
         AND id = ?`,
      [residualTxn, residualBase, nextStatus, tenantId, legalEntityId, documentId]
    );
  }
}

async function fetchApplyAuditPayloadForSettlement({
  tenantId,
  settlementBatchId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT payload_json
     FROM audit_logs
     WHERE tenant_id = ?
       AND action = 'cari.settlement.apply'
       AND resource_type = 'cari_settlement_batch'
       AND resource_id = ?
     ORDER BY id DESC
     LIMIT 1`,
    [tenantId, String(settlementBatchId)]
  );
  const row = result.rows?.[0] || null;
  if (!row) {
    return null;
  }
  if (row.payload_json && typeof row.payload_json === "object") {
    return row.payload_json;
  }
  if (typeof row.payload_json === "string") {
    try {
      return JSON.parse(row.payload_json);
    } catch {
      return null;
    }
  }
  return null;
}

function buildSettlementPostingLines({
  direction,
  totalAmountTxn,
  totalAmountBase,
  controlAccountId,
  offsetAccountId,
  lineDescription,
  subledgerReferenceNo,
  currencyCode,
}) {
  const normalizedDirection = normalizeUpperText(direction);
  const normalizedCurrency = normalizeUpperText(currencyCode);
  const amountTxn = normalizeAmount(totalAmountTxn, "totalAllocatedTxn");
  const amountBase = normalizeAmount(totalAmountBase, "totalPostingAmountBase");

  if (normalizedDirection === "AR") {
    return [
      {
        accountId: parsePositiveInt(offsetAccountId),
        debitBase: amountBase,
        creditBase: 0,
        amountTxn,
        description: toNullableString(lineDescription, 255),
        subledgerReferenceNo: toNullableString(subledgerReferenceNo, 100),
        currencyCode: normalizedCurrency,
      },
      {
        accountId: parsePositiveInt(controlAccountId),
        debitBase: 0,
        creditBase: amountBase,
        amountTxn: roundAmount(amountTxn * -1),
        description: toNullableString(lineDescription, 255),
        subledgerReferenceNo: toNullableString(subledgerReferenceNo, 100),
        currencyCode: normalizedCurrency,
      },
    ];
  }

  if (normalizedDirection === "AP") {
    return [
      {
        accountId: parsePositiveInt(controlAccountId),
        debitBase: amountBase,
        creditBase: 0,
        amountTxn,
        description: toNullableString(lineDescription, 255),
        subledgerReferenceNo: toNullableString(subledgerReferenceNo, 100),
        currencyCode: normalizedCurrency,
      },
      {
        accountId: parsePositiveInt(offsetAccountId),
        debitBase: 0,
        creditBase: amountBase,
        amountTxn: roundAmount(amountTxn * -1),
        description: toNullableString(lineDescription, 255),
        subledgerReferenceNo: toNullableString(subledgerReferenceNo, 100),
        currencyCode: normalizedCurrency,
      },
    ];
  }

  throw badRequest("Settlement direction must be AR or AP");
}

async function loadSettlementResult({
  tenantId,
  settlementBatchId,
  includeApplyAudit = false,
  runQuery = query,
}) {
  const batchRow = await fetchSettlementBatchRow({
    tenantId,
    settlementBatchId,
    runQuery,
  });
  if (!batchRow) {
    throw badRequest("Settlement batch not found");
  }
  const allocations = await fetchSettlementAllocationsByBatchId({
    tenantId,
    settlementBatchId,
    runQuery,
  });
  const unappliedRowsResult = await runQuery(
    `SELECT
       id,
       tenant_id,
       legal_entity_id,
       counterparty_id,
       cash_receipt_no,
       receipt_date,
       status,
       amount_txn,
       amount_base,
       residual_amount_txn,
       residual_amount_base,
       currency_code,
       posted_journal_entry_id,
       settlement_batch_id,
       reversal_of_unapplied_cash_id,
       bank_statement_line_id,
       bank_transaction_ref,
       bank_attach_idempotency_key,
       bank_apply_idempotency_key,
       note,
       created_at,
       updated_at
     FROM cari_unapplied_cash
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND settlement_batch_id = ?
     ORDER BY id ASC`,
    [tenantId, parsePositiveInt(batchRow.legal_entity_id), settlementBatchId]
  );
  const postedJournalEntryId = parsePositiveInt(batchRow.posted_journal_entry_id);
  const journalWithLines = postedJournalEntryId
    ? await fetchPostedJournalWithLines({
        tenantId,
        journalEntryId: postedJournalEntryId,
        runQuery,
      })
    : null;
  const applyAuditPayload = includeApplyAudit
    ? await fetchApplyAuditPayloadForSettlement({
        tenantId,
        settlementBatchId,
        runQuery,
      })
    : null;

  return {
    row: mapSettlementBatchRow(batchRow),
    allocations: allocations.map(mapAllocationRow),
    unappliedCash: (unappliedRowsResult.rows || []).map(mapUnappliedCashRow),
    journal: postedJournalEntryId
      ? {
          journalEntryId: postedJournalEntryId,
          lineCount: journalWithLines?.lines?.length || 0,
          lines: (journalWithLines?.lines || []).map((line) => ({
            id: parsePositiveInt(line.id),
            lineNo: Number(line.line_no),
            accountId: parsePositiveInt(line.account_id),
            amountTxn: toDecimalNumber(line.amount_txn),
            debitBase: toDecimalNumber(line.debit_base),
            creditBase: toDecimalNumber(line.credit_base),
            currencyCode: line.currency_code,
            description: line.description || null,
            subledgerReferenceNo: line.subledger_reference_no || null,
          })),
        }
      : null,
    applyAuditPayload,
  };
}

export async function resolveCariSettlementScope(settlementBatchId, tenantId) {
  const parsedSettlementBatchId = parsePositiveInt(settlementBatchId);
  const parsedTenantId = parsePositiveInt(tenantId);
  if (!parsedSettlementBatchId || !parsedTenantId) {
    return null;
  }

  const row = await fetchSettlementBatchRow({
    tenantId: parsedTenantId,
    settlementBatchId: parsedSettlementBatchId,
  });
  if (!row) {
    return null;
  }

  return {
    scopeType: "LEGAL_ENTITY",
    scopeId: parsePositiveInt(row.legal_entity_id),
  };
}

export const CARI_SETTLEMENT_FOLLOW_UP_RISKS = FOLLOW_UP_RISKS;
export async function applyCariSettlement({
  req,
  payload,
  assertScopeAccess,
}) {
  const tenantId = payload.tenantId;
  const legalEntityId = payload.legalEntityId;
  const counterpartyId = payload.counterpartyId;
  const idempotencyKey = toNullableString(payload.idempotencyKey, 100);
  const settlementDate = normalizeDateInput(payload.settlementDate, "settlementDate");
  const incomingAmountTxn = normalizeAmount(payload.incomingAmountTxn || 0, "incomingAmountTxn", {
    allowZero: true,
  });
  const useUnappliedCash = payload.useUnappliedCash !== false;
  const autoAllocate = Boolean(payload.autoAllocate);
  const bankApplyIdempotencyKey = toNullableString(payload.bankApplyIdempotencyKey, 100);
  const bankStatementLineId = normalizeOptionalPositiveInt(
    payload.bankStatementLineId,
    "bankStatementLineId"
  );
  const bankTransactionRef = toNullableString(payload.bankTransactionRef, 100);

  if (!idempotencyKey) {
    throw badRequest("idempotencyKey is required");
  }
  if (bankApplyIdempotencyKey && !bankStatementLineId && !bankTransactionRef) {
    throw badRequest(
      "bankStatementLineId or bankTransactionRef is required when bankApplyIdempotencyKey is set"
    );
  }

  assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");
  const legalEntity = await assertLegalEntityBelongsToTenant(
    tenantId,
    legalEntityId,
    "legalEntityId"
  );
  const settlementCurrencyCode = normalizeUpperText(payload.currencyCode);
  await assertCurrencyExists(settlementCurrencyCode, "currencyCode");

  const existingBatchIdByApply = await findSettlementBatchIdByApplyIdempotency({
    tenantId,
    legalEntityId,
    applyIdempotencyKey: idempotencyKey,
  });
  const existingBatchIdByBankApply = await findSettlementBatchIdByBankApplyIdempotency({
    tenantId,
    legalEntityId,
    bankApplyIdempotencyKey,
  });
  if (
    existingBatchIdByApply &&
    existingBatchIdByBankApply &&
    existingBatchIdByApply !== existingBatchIdByBankApply
  ) {
    throw badRequest("idempotencyKey and bankApplyIdempotencyKey map to different settlements");
  }
  const existingBatchId = existingBatchIdByApply || existingBatchIdByBankApply;
  if (existingBatchId) {
    const replay = await loadSettlementResult({
      tenantId,
      settlementBatchId: existingBatchId,
      includeApplyAudit: true,
    });
    return {
      ...replay,
      idempotentReplay: true,
      followUpRisks: FOLLOW_UP_RISKS,
    };
  }

  const counterparty = await fetchCounterpartyRow({
    tenantId,
    legalEntityId,
    counterpartyId,
  });
  if (!counterparty) {
    throw badRequest("counterpartyId must belong to legalEntityId");
  }

  try {
    const created = await withTransaction(async (tx) => {
      const replayBatchIdByApply = await findSettlementBatchIdByApplyIdempotency({
        tenantId,
        legalEntityId,
        applyIdempotencyKey: idempotencyKey,
        runQuery: tx.query,
      });
      const replayBatchIdByBankApply = await findSettlementBatchIdByBankApplyIdempotency({
        tenantId,
        legalEntityId,
        bankApplyIdempotencyKey,
        runQuery: tx.query,
      });
      if (
        replayBatchIdByApply &&
        replayBatchIdByBankApply &&
        replayBatchIdByApply !== replayBatchIdByBankApply
      ) {
        throw badRequest("idempotencyKey and bankApplyIdempotencyKey map to different settlements");
      }
      const replayBatchId = replayBatchIdByApply || replayBatchIdByBankApply;
      if (replayBatchId) {
        const replay = await loadSettlementResult({
          tenantId,
          settlementBatchId: replayBatchId,
          includeApplyAudit: true,
          runQuery: tx.query,
        });
        return {
          ...replay,
          idempotentReplay: true,
          followUpRisks: FOLLOW_UP_RISKS,
        };
      }

      const requestedOpenItemIds = Array.isArray(payload.allocations)
        ? payload.allocations
            .map((entry) => parsePositiveInt(entry?.openItemId))
            .filter(Boolean)
        : [];
      const lockedOpenItems = await fetchOpenItemsForApply({
        tenantId,
        legalEntityId,
        counterpartyId,
        currencyCode: settlementCurrencyCode,
        openItemIds: requestedOpenItemIds.length > 0 ? requestedOpenItemIds : null,
        runQuery: tx.query,
      });
      if (requestedOpenItemIds.length > 0 && lockedOpenItems.length !== requestedOpenItemIds.length) {
        throw badRequest("Some allocations target open items that are unavailable");
      }
      if (lockedOpenItems.length === 0) {
        throw badRequest("No open items are available for settlement");
      }

      const directions = new Set(
        lockedOpenItems
          .map((row) => normalizeUpperText(row.direction))
          .filter((value) => value === "AR" || value === "AP")
      );
      if (directions.size !== 1) {
        throw badRequest("Settlement apply supports one direction (AR or AP) per request");
      }
      const direction = Array.from(directions)[0];

      const fxPolicy = await resolveSettlementFxRate({
        tenantId,
        settlementDate,
        settlementCurrencyCode,
        functionalCurrencyCode: legalEntity.functional_currency_code,
        providedFxRate: payload.fxRate,
        runQuery: tx.query,
      });

      const unappliedRows = useUnappliedCash
        ? await fetchUnappliedRowsForApply({
            tenantId,
            legalEntityId,
            counterpartyId,
            currencyCode: settlementCurrencyCode,
            runQuery: tx.query,
          })
        : [];
      const unappliedAvailableTxn = roundAmount(
        unappliedRows.reduce(
          (total, row) => total + Number(row.residual_amount_txn || 0),
          0
        )
      );
      const totalAvailableFundsTxn = roundAmount(incomingAmountTxn + unappliedAvailableTxn);
      if (totalAvailableFundsTxn <= AMOUNT_EPSILON) {
        throw badRequest("No available funds from incomingAmountTxn or unapplied cash");
      }

      const requestedAllocations = Array.isArray(payload.allocations)
        ? payload.allocations
        : [];
      const manualPlan =
        requestedAllocations.length > 0
          ? buildManualAllocationPlan(lockedOpenItems, requestedAllocations)
          : [];
      let allocationPlan = manualPlan;
      if (autoAllocate || manualPlan.length === 0) {
        allocationPlan = buildAutoAllocationPlan(lockedOpenItems, totalAvailableFundsTxn);
      }
      if (allocationPlan.length === 0) {
        throw badRequest("No allocations can be produced for this settlement request");
      }

      const enrichedAllocations = allocationPlan.map((entry) => {
        const historicalBase = calculateHistoricalBaseAllocation(
          entry.row,
          entry.allocationTxn
        );
        const settlementBase = roundAmount(
          Number(entry.allocationTxn) * Number(fxPolicy.settlementFxRate)
        );
        return {
          ...entry,
          allocationBaseHistorical: historicalBase,
          allocationBaseSettlement: settlementBase,
        };
      });
      const totalAllocatedTxn = roundAmount(
        enrichedAllocations.reduce((sum, entry) => sum + Number(entry.allocationTxn), 0)
      );
      const totalAllocatedBaseHistorical = roundAmount(
        enrichedAllocations.reduce(
          (sum, entry) => sum + Number(entry.allocationBaseHistorical),
          0
        )
      );
      const totalAllocatedBaseSettlement = roundAmount(
        enrichedAllocations.reduce(
          (sum, entry) => sum + Number(entry.allocationBaseSettlement),
          0
        )
      );
      if (totalAllocatedTxn > totalAvailableFundsTxn + AMOUNT_EPSILON) {
        throw badRequest("Total allocations exceed incoming + unapplied available funds");
      }

      const unappliedConsumePlan = [];
      let remainingNeedTxn = totalAllocatedTxn;
      const unappliedConsumptionOrder = [...unappliedRows].sort((left, right) => {
        const leftReceipt = toDateOnlyString(left.receipt_date, "receiptDate") || "9999-12-31";
        const rightReceipt =
          toDateOnlyString(right.receipt_date, "receiptDate") || "9999-12-31";
        if (leftReceipt !== rightReceipt) {
          return leftReceipt < rightReceipt ? -1 : 1;
        }
        return Number(left.id) - Number(right.id);
      });

      for (const row of unappliedConsumptionOrder) {
        if (remainingNeedTxn <= AMOUNT_EPSILON) {
          break;
        }
        const rowResidualTxn = normalizeAmount(
          row.residual_amount_txn,
          "unapplied.residualAmountTxn"
        );
        if (rowResidualTxn <= AMOUNT_EPSILON) {
          continue;
        }
        const consumeTxn = roundAmount(Math.min(rowResidualTxn, remainingNeedTxn));
        if (consumeTxn <= AMOUNT_EPSILON) {
          continue;
        }
        const rowResidualBase = normalizeAmount(
          row.residual_amount_base,
          "unapplied.residualAmountBase"
        );
        const consumeBase = amountsAreEqual(consumeTxn, rowResidualTxn)
          ? rowResidualBase
          : roundAmount((consumeTxn * rowResidualBase) / rowResidualTxn);
        unappliedConsumePlan.push({
          row,
          consumeTxn,
          consumeBase: consumeBase > rowResidualBase ? rowResidualBase : consumeBase,
        });
        remainingNeedTxn = roundAmount(remainingNeedTxn - consumeTxn);
      }

      if (remainingNeedTxn > incomingAmountTxn + AMOUNT_EPSILON) {
        throw badRequest(
          "incomingAmountTxn is insufficient after unapplied consumption for requested allocations"
        );
      }
      const incomingUsedTxn = roundAmount(Math.max(0, remainingNeedTxn));
      const incomingResidualTxn = roundAmount(Math.max(0, incomingAmountTxn - incomingUsedTxn));
      const incomingResidualBase = roundAmount(
        incomingResidualTxn * Number(fxPolicy.settlementFxRate)
      );
      const realizedFxNetBase = roundAmount(
        totalAllocatedBaseSettlement - totalAllocatedBaseHistorical
      );

      const sequence = await reserveSettlementSequence({
        tenantId,
        legalEntityId,
        settlementDate,
        runQuery: tx.query,
      });
      const postingAccounts = await resolveSettlementPostingAccounts({
        tenantId,
        legalEntityId,
        direction,
        counterpartyRow: counterparty,
        runQuery: tx.query,
      });
      const journalContext = await resolveBookAndOpenPeriodForDate({
        tenantId,
        legalEntityId,
        targetDate: settlementDate,
        runQuery: tx.query,
      });

      const postingLines = buildSettlementPostingLines({
        direction,
        totalAmountTxn: totalAllocatedTxn,
        totalAmountBase: totalAllocatedBaseSettlement,
        controlAccountId: postingAccounts.controlAccountId,
        offsetAccountId: postingAccounts.offsetAccountId,
        lineDescription: `Cari settlement ${sequence.settlementNo}`.slice(0, 255),
        subledgerReferenceNo: `${CARI_SETTLEMENT_REFERENCE_PREFIX}${sequence.settlementNo}`,
        currencyCode: settlementCurrencyCode,
      });
      const journalResult = await insertPostedJournalWithLinesTx(tx, {
        tenantId,
        legalEntityId,
        bookId: journalContext.bookId,
        fiscalPeriodId: journalContext.fiscalPeriodId,
        userId: payload.userId,
        journalNo: buildCariJournalNo("CARI-SETTLE", sequence.sequenceNo),
        entryDate: settlementDate,
        documentDate: settlementDate,
        currencyCode: settlementCurrencyCode,
        description: `Cari settlement apply ${sequence.settlementNo}`.slice(0, 500),
        referenceNo: toNullableString(sequence.settlementNo, 100),
        lines: postingLines,
      });

      const settlementInsert = await tx.query(
        `INSERT INTO cari_settlement_batches (
            tenant_id,
            legal_entity_id,
            counterparty_id,
            sequence_namespace,
            fiscal_year,
            sequence_no,
            settlement_no,
            settlement_date,
            status,
            total_allocated_txn,
            total_allocated_base,
            currency_code,
            posted_journal_entry_id,
            reversal_of_settlement_batch_id,
            bank_statement_line_id,
            bank_transaction_ref,
            bank_attach_idempotency_key,
            bank_apply_idempotency_key,
            posted_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?, CURRENT_TIMESTAMP)`,
        [
          tenantId,
          legalEntityId,
          counterpartyId,
          sequence.sequenceNamespace,
          sequence.fiscalYear,
          sequence.sequenceNo,
          sequence.settlementNo,
          settlementDate,
          SETTLEMENT_STATUS_POSTED,
          totalAllocatedTxn,
          totalAllocatedBaseHistorical,
          settlementCurrencyCode,
          journalResult.journalEntryId,
          bankStatementLineId,
          bankTransactionRef,
          bankApplyIdempotencyKey,
        ]
      );
      const settlementBatchId = parsePositiveInt(settlementInsert.rows?.insertId);
      if (!settlementBatchId) {
        throw new Error("Failed to create settlement batch");
      }

      const allocationInsertOrder = [...enrichedAllocations].sort((left, right) => {
        const leftDue = toDateOnlyString(left.row.due_date, "dueDate") || "9999-12-31";
        const rightDue = toDateOnlyString(right.row.due_date, "dueDate") || "9999-12-31";
        if (leftDue !== rightDue) {
          return leftDue < rightDue ? -1 : 1;
        }
        const leftDocDate = toDateOnlyString(left.row.document_date, "documentDate") || "9999-12-31";
        const rightDocDate =
          toDateOnlyString(right.row.document_date, "documentDate") || "9999-12-31";
        if (leftDocDate !== rightDocDate) {
          return leftDocDate < rightDocDate ? -1 : 1;
        }
        return Number(left.openItemId) - Number(right.openItemId);
      });

      for (let index = 0; index < allocationInsertOrder.length; index += 1) {
        const entry = allocationInsertOrder[index];
        const applyIdempotencyKey = index === 0 ? idempotencyKey : null;
        const allocationBankApplyIdempotencyKey =
          index === 0 ? bankApplyIdempotencyKey : null;
        // eslint-disable-next-line no-await-in-loop
        await tx.query(
          `INSERT INTO cari_settlement_allocations (
              tenant_id,
              legal_entity_id,
              settlement_batch_id,
              open_item_id,
              allocation_date,
              allocation_amount_txn,
              allocation_amount_base,
              apply_idempotency_key,
              bank_statement_line_id,
              bank_apply_idempotency_key,
              note
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            tenantId,
            legalEntityId,
            settlementBatchId,
            entry.openItemId,
            settlementDate,
            entry.allocationTxn,
            entry.allocationBaseHistorical,
            applyIdempotencyKey,
            bankStatementLineId,
            allocationBankApplyIdempotencyKey,
            toNullableString(payload.note, 500),
          ]
        );
      }

      const touchedDocumentIds = [];
      for (const entry of enrichedAllocations) {
        const row = entry.row;
        const currentResidualTxn = normalizeAmount(
          row.residual_amount_txn,
          "openItem.residualAmountTxn"
        );
        const currentResidualBase = normalizeAmount(
          row.residual_amount_base,
          "openItem.residualAmountBase"
        );
        const originalAmountTxn = normalizeAmount(
          row.original_amount_txn,
          "openItem.originalAmountTxn"
        );
        const originalAmountBase = normalizeAmount(
          row.original_amount_base,
          "openItem.originalAmountBase"
        );
        let nextResidualTxn = roundAmount(currentResidualTxn - entry.allocationTxn);
        let nextResidualBase = roundAmount(
          currentResidualBase - entry.allocationBaseHistorical
        );
        if (nextResidualTxn < 0 && Math.abs(nextResidualTxn) <= AMOUNT_EPSILON) {
          nextResidualTxn = 0;
        }
        if (nextResidualBase < 0 && Math.abs(nextResidualBase) <= AMOUNT_EPSILON) {
          nextResidualBase = 0;
        }
        if (nextResidualTxn < -AMOUNT_EPSILON || nextResidualBase < -AMOUNT_EPSILON) {
          throw badRequest(`allocation exceeds residual for openItemId=${entry.openItemId}`);
        }
        const nextSettledTxn = roundAmount(originalAmountTxn - nextResidualTxn);
        const nextSettledBase = roundAmount(originalAmountBase - nextResidualBase);
        const nextStatus = normalizeOpenItemStatus({
          originalAmountTxn,
          residualAmountTxn: nextResidualTxn,
          settledAmountTxn: nextSettledTxn,
        });

        // eslint-disable-next-line no-await-in-loop
        await tx.query(
          `UPDATE cari_open_items
           SET status = ?,
               residual_amount_txn = ?,
               residual_amount_base = ?,
               settled_amount_txn = ?,
               settled_amount_base = ?
           WHERE tenant_id = ?
             AND legal_entity_id = ?
             AND id = ?`,
          [
            nextStatus,
            nextResidualTxn,
            nextResidualBase,
            nextSettledTxn,
            nextSettledBase,
            tenantId,
            legalEntityId,
            entry.openItemId,
          ]
        );
        touchedDocumentIds.push(parsePositiveInt(row.document_id));
      }

      await refreshDocumentBalancesTx({
        tx,
        tenantId,
        legalEntityId,
        documentIds: touchedDocumentIds,
      });

      for (const consumeEntry of unappliedConsumePlan) {
        const row = consumeEntry.row;
        const rowResidualTxn = normalizeAmount(
          row.residual_amount_txn,
          "unapplied.residualAmountTxn"
        );
        const rowResidualBase = normalizeAmount(
          row.residual_amount_base,
          "unapplied.residualAmountBase"
        );
        const amountTxn = normalizeAmount(row.amount_txn, "unapplied.amountTxn");
        let nextResidualTxn = roundAmount(rowResidualTxn - consumeEntry.consumeTxn);
        let nextResidualBase = roundAmount(rowResidualBase - consumeEntry.consumeBase);
        if (nextResidualTxn < 0 && Math.abs(nextResidualTxn) <= AMOUNT_EPSILON) {
          nextResidualTxn = 0;
        }
        if (nextResidualBase < 0 && Math.abs(nextResidualBase) <= AMOUNT_EPSILON) {
          nextResidualBase = 0;
        }
        if (nextResidualTxn < -AMOUNT_EPSILON || nextResidualBase < -AMOUNT_EPSILON) {
          throw badRequest(`Unapplied cash over-consume detected for id=${row.id}`);
        }
        const nextStatus = normalizeUnappliedStatus({
          residualAmountTxn: nextResidualTxn,
          amountTxn,
        });
        // eslint-disable-next-line no-await-in-loop
        await tx.query(
          `UPDATE cari_unapplied_cash
           SET status = ?,
               residual_amount_txn = ?,
               residual_amount_base = ?,
               note = ?
           WHERE tenant_id = ?
             AND legal_entity_id = ?
             AND id = ?`,
          [
            nextStatus,
            nextResidualTxn,
            nextResidualBase,
            toNullableString(
              `${row.note || ""}${row.note ? " | " : ""}Applied by settlement ${
                sequence.settlementNo
              }`,
              500
            ),
            tenantId,
            legalEntityId,
            parsePositiveInt(row.id),
          ]
        );
      }

      let createdUnappliedCashId = null;
      if (incomingResidualTxn > AMOUNT_EPSILON) {
        const unappliedInsert = await tx.query(
          `INSERT INTO cari_unapplied_cash (
              tenant_id,
              legal_entity_id,
              counterparty_id,
              cash_receipt_no,
              receipt_date,
              status,
              amount_txn,
              amount_base,
              residual_amount_txn,
              residual_amount_base,
              currency_code,
              posted_journal_entry_id,
              settlement_batch_id,
              reversal_of_unapplied_cash_id,
              bank_statement_line_id,
              bank_transaction_ref,
              bank_attach_idempotency_key,
              bank_apply_idempotency_key,
              note
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?, NULL, ?, ?)`,
          [
            tenantId,
            legalEntityId,
            counterpartyId,
            buildUnappliedReceiptNo(sequence.settlementNo),
            settlementDate,
            UNAPPLIED_STATUS_UNAPPLIED,
            incomingResidualTxn,
            incomingResidualBase,
            incomingResidualTxn,
            incomingResidualBase,
            settlementCurrencyCode,
            settlementBatchId,
            bankStatementLineId,
            bankTransactionRef,
            bankApplyIdempotencyKey,
            toNullableString(
              `Residual unapplied from settlement ${sequence.settlementNo}`,
              500
            ),
          ]
        );
        createdUnappliedCashId = parsePositiveInt(unappliedInsert.rows?.insertId);
      }

      await insertAuditLog({
        req,
        runQuery: tx.query,
        tenantId,
        userId: payload.userId,
        action: "cari.settlement.apply",
        legalEntityId,
        resourceId: settlementBatchId,
        payload: {
          settlementBatchId,
          settlementNo: sequence.settlementNo,
          idempotencyKey,
          bankApplyIdempotencyKey,
          bankStatementLineId,
          bankTransactionRef,
          counterpartyId,
          direction,
          settlementDate,
          incomingAmountTxn,
          totalAllocatedTxn,
          totalAllocatedBaseHistorical,
          totalAllocatedBaseSettlement,
          realizedFxNetBase,
          settlementFxRate: fxPolicy.settlementFxRate,
          settlementFxSource: fxPolicy.source,
          allocations: enrichedAllocations.map((entry) => ({
            openItemId: entry.openItemId,
            documentId: parsePositiveInt(entry.row.document_id),
            allocationTxn: entry.allocationTxn,
            allocationBaseHistorical: entry.allocationBaseHistorical,
            allocationBaseSettlement: entry.allocationBaseSettlement,
          })),
          unappliedConsumed: unappliedConsumePlan.map((entry) => ({
            unappliedCashId: parsePositiveInt(entry.row.id),
            consumeTxn: entry.consumeTxn,
            consumeBase: entry.consumeBase,
          })),
          createdUnappliedCashId,
          followUpRisks: FOLLOW_UP_RISKS,
        },
      });
      if (bankApplyIdempotencyKey) {
        await insertAuditLog({
          req,
          runQuery: tx.query,
          tenantId,
          userId: payload.userId,
          action: "cari.bank.apply",
          legalEntityId,
          resourceId: settlementBatchId,
          payload: {
            settlementBatchId,
            settlementNo: sequence.settlementNo,
            idempotencyKey,
            bankApplyIdempotencyKey,
            bankStatementLineId,
            bankTransactionRef,
            followUpRisks: FOLLOW_UP_RISKS,
          },
        });
      }

      const result = await loadSettlementResult({
        tenantId,
        settlementBatchId,
        includeApplyAudit: true,
        runQuery: tx.query,
      });

      return {
        ...result,
        idempotentReplay: false,
        followUpRisks: FOLLOW_UP_RISKS,
        metrics: {
          totalAllocatedTxn,
          totalAllocatedBaseHistorical,
          totalAllocatedBaseSettlement,
          realizedFxNetBase,
          settlementFxRate: fxPolicy.settlementFxRate,
          settlementFxSource: fxPolicy.source,
          fxRateDate: fxPolicy.rateDate,
          journalPurposeAccounts: {
            controlAccountId: postingAccounts.controlAccountId,
            offsetAccountId: postingAccounts.offsetAccountId,
            controlAccountCode: postingAccounts.controlAccountCode,
            offsetAccountCode: postingAccounts.offsetAccountCode,
          },
        },
      };
    });

    return created;
  } catch (err) {
    if (
      isDuplicateKeyError(err, "uk_cari_alloc_apply_idempo") ||
      isDuplicateKeyError(err, "uk_cari_alloc_bank_apply_idempo") ||
      isDuplicateKeyError(err, "uk_cari_settle_batches_bank_apply_idempo") ||
      isDuplicateKeyError(err, "uk_cari_unap_bank_apply_idempo")
    ) {
      const replayBatchIdByApply = await findSettlementBatchIdByApplyIdempotency({
        tenantId,
        legalEntityId,
        applyIdempotencyKey: idempotencyKey,
      });
      const replayBatchIdByBankApply = await findSettlementBatchIdByBankApplyIdempotency({
        tenantId,
        legalEntityId,
        bankApplyIdempotencyKey,
      });
      if (
        replayBatchIdByApply &&
        replayBatchIdByBankApply &&
        replayBatchIdByApply !== replayBatchIdByBankApply
      ) {
        throw badRequest("idempotencyKey and bankApplyIdempotencyKey map to different settlements");
      }
      const replayBatchId = replayBatchIdByApply || replayBatchIdByBankApply;
      if (replayBatchId) {
        const replay = await loadSettlementResult({
          tenantId,
          settlementBatchId: replayBatchId,
          includeApplyAudit: true,
        });
        return {
          ...replay,
          idempotentReplay: true,
          followUpRisks: FOLLOW_UP_RISKS,
        };
      }
      if (bankApplyIdempotencyKey) {
        throw badRequest("Duplicate settlement bank-apply idempotency key");
      }
      throw badRequest("Duplicate settlement apply idempotency key");
    }
    throw err;
  }
}

export async function attachCariBankReference({
  req,
  payload,
  assertScopeAccess,
}) {
  const tenantId = payload.tenantId;
  const userId = payload.userId;
  const legalEntityId = payload.legalEntityId;
  const targetType = normalizeUpperText(payload.targetType);
  const settlementBatchId = parsePositiveInt(payload.settlementBatchId);
  const unappliedCashId = parsePositiveInt(payload.unappliedCashId);
  const idempotencyKey = toNullableString(payload.idempotencyKey, 100);
  const bankStatementLineId = normalizeOptionalPositiveInt(
    payload.bankStatementLineId,
    "bankStatementLineId"
  );
  const bankTransactionRef = toNullableString(payload.bankTransactionRef, 100);
  const note = toNullableString(payload.note, 500);

  if (!idempotencyKey) {
    throw badRequest("idempotencyKey is required");
  }
  if (!bankStatementLineId && !bankTransactionRef) {
    throw badRequest("bankStatementLineId or bankTransactionRef is required");
  }
  if (
    targetType !== BANK_ATTACH_TARGET_SETTLEMENT &&
    targetType !== BANK_ATTACH_TARGET_UNAPPLIED_CASH
  ) {
    throw badRequest("targetType must be SETTLEMENT or UNAPPLIED_CASH");
  }

  assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");
  await assertLegalEntityBelongsToTenant(tenantId, legalEntityId, "legalEntityId");

  try {
    const result = await withTransaction(async (tx) => {
      if (targetType === BANK_ATTACH_TARGET_SETTLEMENT) {
        if (!settlementBatchId) {
          throw badRequest("settlementBatchId is required when targetType=SETTLEMENT");
        }

        const replayByKey = await fetchSettlementBatchRowByBankAttachIdempotency({
          tenantId,
          legalEntityId,
          bankAttachIdempotencyKey: idempotencyKey,
          runQuery: tx.query,
          forUpdate: true,
        });
        if (replayByKey) {
          if (parsePositiveInt(replayByKey.id) !== settlementBatchId) {
            throw badRequest(
              "idempotencyKey is already used for a different settlementBatchId"
            );
          }
          const replayLink = resolveBankLinkFields({
            targetLabel: `settlementBatchId=${settlementBatchId}`,
            existingBankStatementLineId: replayByKey.bank_statement_line_id,
            existingBankTransactionRef: replayByKey.bank_transaction_ref,
            requestedBankStatementLineId: bankStatementLineId,
            requestedBankTransactionRef: bankTransactionRef,
          });
          const replayChanged =
            parsePositiveInt(replayByKey.bank_statement_line_id) !==
              replayLink.nextBankStatementLineId ||
            !textsEqual(replayByKey.bank_transaction_ref, replayLink.nextBankTransactionRef);
          if (replayChanged) {
            throw badRequest(
              "idempotencyKey replay payload does not match existing settlement bank link"
            );
          }
          return {
            targetType,
            settlement: mapSettlementBatchRow(replayByKey),
            unappliedCash: null,
            idempotentReplay: true,
          };
        }

        const targetRow = await fetchSettlementBatchRow({
          tenantId,
          settlementBatchId,
          runQuery: tx.query,
          forUpdate: true,
        });
        if (!targetRow) {
          throw badRequest("Settlement batch not found");
        }
        if (parsePositiveInt(targetRow.legal_entity_id) !== legalEntityId) {
          throw badRequest("settlementBatchId must belong to legalEntityId");
        }

        const existingAttachIdempotencyKey = toNullableString(
          targetRow.bank_attach_idempotency_key,
          100
        );
        if (existingAttachIdempotencyKey && existingAttachIdempotencyKey !== idempotencyKey) {
          throw badRequest("Settlement batch already has a bank attach idempotency key");
        }

        const resolvedLink = resolveBankLinkFields({
          targetLabel: `settlementBatchId=${settlementBatchId}`,
          existingBankStatementLineId: targetRow.bank_statement_line_id,
          existingBankTransactionRef: targetRow.bank_transaction_ref,
          requestedBankStatementLineId: bankStatementLineId,
          requestedBankTransactionRef: bankTransactionRef,
        });
        const alreadyAttachedWithSameKey =
          existingAttachIdempotencyKey === idempotencyKey &&
          parsePositiveInt(targetRow.bank_statement_line_id) ===
            resolvedLink.nextBankStatementLineId &&
          textsEqual(targetRow.bank_transaction_ref, resolvedLink.nextBankTransactionRef);
        if (alreadyAttachedWithSameKey) {
          return {
            targetType,
            settlement: mapSettlementBatchRow(targetRow),
            unappliedCash: null,
            idempotentReplay: true,
          };
        }

        await tx.query(
          `UPDATE cari_settlement_batches
           SET bank_statement_line_id = ?,
               bank_transaction_ref = ?,
               bank_attach_idempotency_key = ?
           WHERE tenant_id = ?
             AND legal_entity_id = ?
             AND id = ?`,
          [
            resolvedLink.nextBankStatementLineId,
            resolvedLink.nextBankTransactionRef,
            idempotencyKey,
            tenantId,
            legalEntityId,
            settlementBatchId,
          ]
        );

        const updatedRow = await fetchSettlementBatchRow({
          tenantId,
          settlementBatchId,
          runQuery: tx.query,
          forUpdate: true,
        });
        if (!updatedRow) {
          throw badRequest("Settlement batch not found after bank attach update");
        }

        await insertAuditLog({
          req,
          runQuery: tx.query,
          tenantId,
          userId,
          action: "cari.bank.attach",
          resourceType: RESOURCE_TYPE_SETTLEMENT_BATCH,
          legalEntityId,
          resourceId: settlementBatchId,
          payload: {
            targetType: BANK_ATTACH_TARGET_SETTLEMENT,
            settlementBatchId,
            bankStatementLineId: resolvedLink.nextBankStatementLineId,
            bankTransactionRef: resolvedLink.nextBankTransactionRef,
            idempotencyKey,
            note,
          },
        });

        return {
          targetType,
          settlement: mapSettlementBatchRow(updatedRow),
          unappliedCash: null,
          idempotentReplay: false,
        };
      }

      if (!unappliedCashId) {
        throw badRequest("unappliedCashId is required when targetType=UNAPPLIED_CASH");
      }
      const replayByKey = await fetchUnappliedCashRowByBankAttachIdempotency({
        tenantId,
        legalEntityId,
        bankAttachIdempotencyKey: idempotencyKey,
        runQuery: tx.query,
        forUpdate: true,
      });
      if (replayByKey) {
        if (parsePositiveInt(replayByKey.id) !== unappliedCashId) {
          throw badRequest("idempotencyKey is already used for a different unappliedCashId");
        }
        const replayLink = resolveBankLinkFields({
          targetLabel: `unappliedCashId=${unappliedCashId}`,
          existingBankStatementLineId: replayByKey.bank_statement_line_id,
          existingBankTransactionRef: replayByKey.bank_transaction_ref,
          requestedBankStatementLineId: bankStatementLineId,
          requestedBankTransactionRef: bankTransactionRef,
        });
        const replayChanged =
          parsePositiveInt(replayByKey.bank_statement_line_id) !==
            replayLink.nextBankStatementLineId ||
          !textsEqual(replayByKey.bank_transaction_ref, replayLink.nextBankTransactionRef);
        if (replayChanged) {
          throw badRequest(
            "idempotencyKey replay payload does not match existing unapplied cash bank link"
          );
        }
        return {
          targetType,
          settlement: null,
          unappliedCash: mapUnappliedCashRow(replayByKey),
          idempotentReplay: true,
        };
      }

      const targetRow = await fetchUnappliedCashRowById({
        tenantId,
        legalEntityId,
        unappliedCashId,
        runQuery: tx.query,
        forUpdate: true,
      });
      if (!targetRow) {
        throw badRequest("Unapplied cash row not found");
      }
      if (parsePositiveInt(targetRow.legal_entity_id) !== legalEntityId) {
        throw badRequest("unappliedCashId must belong to legalEntityId");
      }

      const existingAttachIdempotencyKey = toNullableString(
        targetRow.bank_attach_idempotency_key,
        100
      );
      if (existingAttachIdempotencyKey && existingAttachIdempotencyKey !== idempotencyKey) {
        throw badRequest("Unapplied cash row already has a bank attach idempotency key");
      }

      const resolvedLink = resolveBankLinkFields({
        targetLabel: `unappliedCashId=${unappliedCashId}`,
        existingBankStatementLineId: targetRow.bank_statement_line_id,
        existingBankTransactionRef: targetRow.bank_transaction_ref,
        requestedBankStatementLineId: bankStatementLineId,
        requestedBankTransactionRef: bankTransactionRef,
      });
      const alreadyAttachedWithSameKey =
        existingAttachIdempotencyKey === idempotencyKey &&
        parsePositiveInt(targetRow.bank_statement_line_id) ===
          resolvedLink.nextBankStatementLineId &&
        textsEqual(targetRow.bank_transaction_ref, resolvedLink.nextBankTransactionRef);
      if (alreadyAttachedWithSameKey) {
        return {
          targetType,
          settlement: null,
          unappliedCash: mapUnappliedCashRow(targetRow),
          idempotentReplay: true,
        };
      }

      await tx.query(
        `UPDATE cari_unapplied_cash
         SET bank_statement_line_id = ?,
             bank_transaction_ref = ?,
             bank_attach_idempotency_key = ?
         WHERE tenant_id = ?
           AND legal_entity_id = ?
           AND id = ?`,
        [
          resolvedLink.nextBankStatementLineId,
          resolvedLink.nextBankTransactionRef,
          idempotencyKey,
          tenantId,
          legalEntityId,
          unappliedCashId,
        ]
      );

      const updatedRow = await fetchUnappliedCashRowById({
        tenantId,
        legalEntityId,
        unappliedCashId,
        runQuery: tx.query,
        forUpdate: true,
      });
      if (!updatedRow) {
        throw badRequest("Unapplied cash row not found after bank attach update");
      }

      await insertAuditLog({
        req,
        runQuery: tx.query,
        tenantId,
        userId,
        action: "cari.bank.attach",
        resourceType: RESOURCE_TYPE_UNAPPLIED_CASH,
        legalEntityId,
        resourceId: unappliedCashId,
        payload: {
          targetType: BANK_ATTACH_TARGET_UNAPPLIED_CASH,
          unappliedCashId,
          bankStatementLineId: resolvedLink.nextBankStatementLineId,
          bankTransactionRef: resolvedLink.nextBankTransactionRef,
          idempotencyKey,
          note,
        },
      });

      return {
        targetType,
        settlement: null,
        unappliedCash: mapUnappliedCashRow(updatedRow),
        idempotentReplay: false,
      };
    });

    return result;
  } catch (err) {
    if (
      isDuplicateKeyError(err, "uk_cari_settle_batches_bank_attach_idempo") ||
      isDuplicateKeyError(err, "uk_cari_unap_bank_attach_idempo")
    ) {
      if (targetType === BANK_ATTACH_TARGET_SETTLEMENT) {
        const replay = await fetchSettlementBatchRowByBankAttachIdempotency({
          tenantId,
          legalEntityId,
          bankAttachIdempotencyKey: idempotencyKey,
        });
        if (replay) {
          if (parsePositiveInt(replay.id) !== settlementBatchId) {
            throw badRequest(
              "idempotencyKey is already used for a different settlementBatchId"
            );
          }
          return {
            targetType,
            settlement: mapSettlementBatchRow(replay),
            unappliedCash: null,
            idempotentReplay: true,
          };
        }
      } else {
        const replay = await fetchUnappliedCashRowByBankAttachIdempotency({
          tenantId,
          legalEntityId,
          bankAttachIdempotencyKey: idempotencyKey,
        });
        if (replay) {
          if (parsePositiveInt(replay.id) !== unappliedCashId) {
            throw badRequest("idempotencyKey is already used for a different unappliedCashId");
          }
          return {
            targetType,
            settlement: null,
            unappliedCash: mapUnappliedCashRow(replay),
            idempotentReplay: true,
          };
        }
      }
      throw badRequest("Duplicate bank attach idempotency key");
    }
    throw err;
  }
}

export async function reverseCariSettlementById({
  req,
  payload,
  assertScopeAccess,
}) {
  const tenantId = payload.tenantId;
  const settlementBatchId = payload.settlementBatchId;
  const reason = toNullableString(payload.reason, 255) || "Manual settlement reversal";
  const reversalDate = payload.reversalDate
    ? normalizeDateInput(payload.reversalDate, "reversalDate")
    : toDateOnlyString(new Date(), "reversalDate");

  const existing = await fetchSettlementBatchRow({
    tenantId,
    settlementBatchId,
  });
  if (!existing) {
    throw badRequest("Settlement batch not found");
  }
  const legalEntityId = parsePositiveInt(existing.legal_entity_id);
  assertScopeAccess(req, "legal_entity", legalEntityId, "settlementBatchId");
  if (normalizeUpperText(existing.status) !== SETTLEMENT_STATUS_POSTED) {
    throw badRequest("Only POSTED settlements can be reversed");
  }

  try {
    const reversed = await withTransaction(async (tx) => {
      const original = await fetchSettlementBatchRow({
        tenantId,
        settlementBatchId,
        runQuery: tx.query,
        forUpdate: true,
      });
      if (!original) {
        throw badRequest("Settlement batch not found");
      }
      if (normalizeUpperText(original.status) !== SETTLEMENT_STATUS_POSTED) {
        throw badRequest("Only POSTED settlements can be reversed");
      }
      const lockedLegalEntityId = parsePositiveInt(original.legal_entity_id);
      const originalJournalEntryId = parsePositiveInt(original.posted_journal_entry_id);
      if (!originalJournalEntryId) {
        throw badRequest("Settlement posted journal linkage is missing");
      }

      const existingReversalBatchId = await findReversalSettlementBatchId({
        tenantId,
        originalSettlementBatchId: settlementBatchId,
        runQuery: tx.query,
      });
      if (existingReversalBatchId) {
        throw badRequest("Settlement is already reversed");
      }

      const allocations = await fetchSettlementAllocationsByBatchId({
        tenantId,
        settlementBatchId,
        runQuery: tx.query,
      });
      if (!allocations.length) {
        throw badRequest("Settlement has no allocations to reverse");
      }
      const openItemIds = allocations
        .map((row) => parsePositiveInt(row.open_item_id))
        .filter(Boolean)
        .sort((left, right) => left - right);
      const lockedOpenItems = await fetchOpenItemsByIdsForUpdate({
        tenantId,
        legalEntityId: lockedLegalEntityId,
        openItemIds,
        runQuery: tx.query,
      });
      const openItemById = new Map(
        lockedOpenItems.map((row) => [parsePositiveInt(row.id), row])
      );

      const touchedDocumentIds = [];
      for (const allocation of allocations) {
        const openItemId = parsePositiveInt(allocation.open_item_id);
        const lockedOpenItem = openItemById.get(openItemId);
        if (!lockedOpenItem) {
          throw badRequest(`openItemId=${openItemId} no longer exists for reversal`);
        }

        const allocationTxn = normalizeAmount(
          allocation.allocation_amount_txn,
          "allocationAmountTxn"
        );
        const allocationBase = normalizeAmount(
          allocation.allocation_amount_base,
          "allocationAmountBase"
        );
        const originalAmountTxn = normalizeAmount(
          lockedOpenItem.original_amount_txn,
          "openItem.originalAmountTxn"
        );
        const originalAmountBase = normalizeAmount(
          lockedOpenItem.original_amount_base,
          "openItem.originalAmountBase"
        );
        const currentResidualTxn = normalizeAmount(
          lockedOpenItem.residual_amount_txn,
          "openItem.residualAmountTxn",
          { allowZero: true }
        );
        const currentResidualBase = normalizeAmount(
          lockedOpenItem.residual_amount_base,
          "openItem.residualAmountBase",
          { allowZero: true }
        );
        let nextResidualTxn = roundAmount(currentResidualTxn + allocationTxn);
        let nextResidualBase = roundAmount(currentResidualBase + allocationBase);
        if (nextResidualTxn > originalAmountTxn && nextResidualTxn - originalAmountTxn <= AMOUNT_EPSILON) {
          nextResidualTxn = originalAmountTxn;
        }
        if (nextResidualBase > originalAmountBase && nextResidualBase - originalAmountBase <= AMOUNT_EPSILON) {
          nextResidualBase = originalAmountBase;
        }
        if (
          nextResidualTxn > originalAmountTxn + AMOUNT_EPSILON ||
          nextResidualBase > originalAmountBase + AMOUNT_EPSILON
        ) {
          throw badRequest(
            `Cannot reverse settlement because open item ${openItemId} has progressed beyond reversible state`
          );
        }
        const nextSettledTxn = roundAmount(originalAmountTxn - nextResidualTxn);
        const nextSettledBase = roundAmount(originalAmountBase - nextResidualBase);
        const nextStatus = normalizeOpenItemStatus({
          originalAmountTxn,
          residualAmountTxn: nextResidualTxn,
          settledAmountTxn: nextSettledTxn,
        });

        // eslint-disable-next-line no-await-in-loop
        await tx.query(
          `UPDATE cari_open_items
           SET status = ?,
               residual_amount_txn = ?,
               residual_amount_base = ?,
               settled_amount_txn = ?,
               settled_amount_base = ?
           WHERE tenant_id = ?
             AND legal_entity_id = ?
             AND id = ?`,
          [
            nextStatus,
            nextResidualTxn,
            nextResidualBase,
            nextSettledTxn,
            nextSettledBase,
            tenantId,
            lockedLegalEntityId,
            openItemId,
          ]
        );
        touchedDocumentIds.push(parsePositiveInt(lockedOpenItem.document_id));
      }

      await refreshDocumentBalancesTx({
        tx,
        tenantId,
        legalEntityId: lockedLegalEntityId,
        documentIds: touchedDocumentIds,
      });

      const applyAuditPayload = await fetchApplyAuditPayloadForSettlement({
        tenantId,
        settlementBatchId,
        runQuery: tx.query,
      });
      const unappliedConsumed = Array.isArray(applyAuditPayload?.unappliedConsumed)
        ? applyAuditPayload.unappliedConsumed
        : [];
      const createdUnappliedCashId = parsePositiveInt(
        applyAuditPayload?.createdUnappliedCashId
      );

      for (const consumed of unappliedConsumed.sort(
        (left, right) =>
          parsePositiveInt(left?.unappliedCashId) - parsePositiveInt(right?.unappliedCashId)
      )) {
        const unappliedCashId = parsePositiveInt(consumed?.unappliedCashId);
        if (!unappliedCashId) {
          continue;
        }
        const consumeTxn = normalizeAmount(consumed?.consumeTxn || 0, "consumeTxn", {
          allowZero: true,
        });
        const consumeBase = normalizeAmount(consumed?.consumeBase || 0, "consumeBase", {
          allowZero: true,
        });
        if (consumeTxn <= AMOUNT_EPSILON && consumeBase <= AMOUNT_EPSILON) {
          continue;
        }

        // eslint-disable-next-line no-await-in-loop
        const rowResult = await tx.query(
          `SELECT
             id,
             amount_txn,
             amount_base,
             residual_amount_txn,
             residual_amount_base,
             status,
             note
           FROM cari_unapplied_cash
           WHERE tenant_id = ?
             AND legal_entity_id = ?
             AND id = ?
           LIMIT 1
           FOR UPDATE`,
          [tenantId, lockedLegalEntityId, unappliedCashId]
        );
        const row = rowResult.rows?.[0] || null;
        if (!row) {
          throw badRequest(
            `Cannot reverse settlement because unapplied cash ${unappliedCashId} no longer exists`
          );
        }

        const amountTxn = normalizeAmount(row.amount_txn, "unapplied.amountTxn");
        const amountBase = normalizeAmount(row.amount_base, "unapplied.amountBase");
        const residualTxn = normalizeAmount(
          row.residual_amount_txn,
          "unapplied.residualAmountTxn"
        );
        const residualBase = normalizeAmount(
          row.residual_amount_base,
          "unapplied.residualAmountBase"
        );
        let nextResidualTxn = roundAmount(residualTxn + consumeTxn);
        let nextResidualBase = roundAmount(residualBase + consumeBase);
        if (nextResidualTxn > amountTxn && nextResidualTxn - amountTxn <= AMOUNT_EPSILON) {
          nextResidualTxn = amountTxn;
        }
        if (nextResidualBase > amountBase && nextResidualBase - amountBase <= AMOUNT_EPSILON) {
          nextResidualBase = amountBase;
        }
        if (
          nextResidualTxn > amountTxn + AMOUNT_EPSILON ||
          nextResidualBase > amountBase + AMOUNT_EPSILON
        ) {
          throw badRequest(
            `Cannot reverse settlement because unapplied cash ${unappliedCashId} was consumed by later operations`
          );
        }
        const nextStatus = normalizeUnappliedStatus({
          residualAmountTxn: nextResidualTxn,
          amountTxn,
        });

        // eslint-disable-next-line no-await-in-loop
        await tx.query(
          `UPDATE cari_unapplied_cash
           SET status = ?,
               residual_amount_txn = ?,
               residual_amount_base = ?,
               note = ?
           WHERE tenant_id = ?
             AND legal_entity_id = ?
             AND id = ?`,
          [
            nextStatus,
            nextResidualTxn,
            nextResidualBase,
            toNullableString(
              `${row.note || ""}${row.note ? " | " : ""}Restored by reversal of settlement ${
                original.settlement_no
              }`,
              500
            ),
            tenantId,
            lockedLegalEntityId,
            unappliedCashId,
          ]
        );
      }

      if (createdUnappliedCashId) {
        const createdUnappliedRowResult = await tx.query(
          `SELECT
             id,
             amount_txn,
             amount_base,
             residual_amount_txn,
             residual_amount_base,
             status,
             note
           FROM cari_unapplied_cash
           WHERE tenant_id = ?
             AND legal_entity_id = ?
             AND id = ?
           LIMIT 1
           FOR UPDATE`,
          [tenantId, lockedLegalEntityId, createdUnappliedCashId]
        );
        const createdRow = createdUnappliedRowResult.rows?.[0] || null;
        if (createdRow) {
          const amountTxn = normalizeAmount(createdRow.amount_txn, "unapplied.amountTxn");
          const amountBase = normalizeAmount(createdRow.amount_base, "unapplied.amountBase");
          const residualTxn = normalizeAmount(
            createdRow.residual_amount_txn,
            "unapplied.residualAmountTxn"
          );
          const residualBase = normalizeAmount(
            createdRow.residual_amount_base,
            "unapplied.residualAmountBase"
          );
          if (
            !amountsAreEqual(residualTxn, amountTxn) ||
            !amountsAreEqual(residualBase, amountBase)
          ) {
            throw badRequest(
              `Cannot reverse settlement because created unapplied cash ${createdUnappliedCashId} is already consumed`
            );
          }
          await tx.query(
            `UPDATE cari_unapplied_cash
             SET status = ?,
                 residual_amount_txn = 0.000000,
                 residual_amount_base = 0.000000,
                 note = ?
             WHERE tenant_id = ?
               AND legal_entity_id = ?
               AND id = ?`,
            [
              UNAPPLIED_STATUS_REVERSED,
              toNullableString(
                `${createdRow.note || ""}${createdRow.note ? " | " : ""}Reversed by settlement ${
                  original.settlement_no
                }`,
                500
              ),
              tenantId,
              lockedLegalEntityId,
              createdUnappliedCashId,
            ]
          );
        }
      }

      const originalJournalWithLines = await fetchPostedJournalWithLines({
        tenantId,
        journalEntryId: originalJournalEntryId,
        runQuery: tx.query,
      });
      const originalJournal = originalJournalWithLines?.journal || null;
      const originalJournalLines = originalJournalWithLines?.lines || [];
      if (!originalJournal) {
        throw badRequest("Original settlement posted journal not found");
      }
      if (normalizeUpperText(originalJournal.status) !== "POSTED") {
        throw badRequest("Only POSTED journals can be reversed");
      }
      if (parsePositiveInt(originalJournal.reversal_journal_entry_id)) {
        throw badRequest("Settlement journal is already reversed");
      }
      if (!originalJournalLines.length) {
        throw badRequest("Original settlement journal has no lines to reverse");
      }

      const reversalPeriodContext = await resolveBookAndOpenPeriodForDate({
        tenantId,
        legalEntityId: lockedLegalEntityId,
        targetDate: reversalDate,
        preferredBookId: parsePositiveInt(originalJournal.book_id),
        runQuery: tx.query,
      });

      const reversalSubledgerReferenceNo = `${CARI_SETTLEMENT_REVERSE_REFERENCE_PREFIX}${settlementBatchId}`;
      const reversalLines = originalJournalLines.map((line) => ({
        accountId: parsePositiveInt(line.account_id),
        debitBase: Number(line.credit_base || 0),
        creditBase: Number(line.debit_base || 0),
        amountTxn: roundAmount(Number(line.amount_txn || 0) * -1),
        description: line.description
          ? String(line.description).slice(0, 255)
          : `Reversal of ${original.settlement_no || `SETTLEMENT-${settlementBatchId}`}`,
        subledgerReferenceNo: reversalSubledgerReferenceNo,
        currencyCode: normalizeUpperText(line.currency_code || original.currency_code),
      }));
      ensureBalancedJournalLines(reversalLines);

      const reversalJournalResult = await insertPostedJournalWithLinesTx(tx, {
        tenantId,
        legalEntityId: lockedLegalEntityId,
        bookId: reversalPeriodContext.bookId,
        fiscalPeriodId: reversalPeriodContext.fiscalPeriodId,
        userId: payload.userId,
        journalNo: buildCariJournalNo("CARI-SET-REV", settlementBatchId),
        entryDate: reversalDate,
        documentDate: reversalDate,
        currencyCode: normalizeUpperText(original.currency_code),
        description: `Reversal of ${original.settlement_no || `SETTLEMENT-${settlementBatchId}`}`.slice(
          0,
          500
        ),
        referenceNo: toNullableString(`REV:${original.settlement_no || settlementBatchId}`, 100),
        lines: reversalLines,
      });

      const reverseJournalUpdateResult = await tx.query(
        `UPDATE journal_entries
         SET status = 'REVERSED',
             reversed_by_user_id = ?,
             reversed_at = CURRENT_TIMESTAMP,
             reversal_journal_entry_id = ?,
             reverse_reason = ?
         WHERE tenant_id = ?
           AND id = ?
           AND status = 'POSTED'
           AND reversal_journal_entry_id IS NULL`,
        [
          payload.userId,
          reversalJournalResult.journalEntryId,
          reason,
          tenantId,
          originalJournalEntryId,
        ]
      );
      if (Number(reverseJournalUpdateResult.rows?.affectedRows || 0) === 0) {
        throw badRequest("Settlement journal is already reversed");
      }

      const reversalSequence = await reserveSettlementSequence({
        tenantId,
        legalEntityId: lockedLegalEntityId,
        settlementDate: reversalDate,
        runQuery: tx.query,
      });
      const reversalInsert = await tx.query(
        `INSERT INTO cari_settlement_batches (
            tenant_id,
            legal_entity_id,
            counterparty_id,
            sequence_namespace,
            fiscal_year,
            sequence_no,
            settlement_no,
            settlement_date,
            status,
            total_allocated_txn,
            total_allocated_base,
            currency_code,
            posted_journal_entry_id,
            reversal_of_settlement_batch_id,
            bank_statement_line_id,
            bank_transaction_ref,
            bank_attach_idempotency_key,
            bank_apply_idempotency_key,
            posted_at,
            reversed_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          tenantId,
          lockedLegalEntityId,
          parsePositiveInt(original.counterparty_id),
          reversalSequence.sequenceNamespace,
          reversalSequence.fiscalYear,
          reversalSequence.sequenceNo,
          reversalSequence.settlementNo,
          reversalDate,
          SETTLEMENT_STATUS_REVERSED,
          normalizeAmount(original.total_allocated_txn, "totalAllocatedTxn"),
          normalizeAmount(original.total_allocated_base, "totalAllocatedBase"),
          normalizeUpperText(original.currency_code),
          reversalJournalResult.journalEntryId,
          settlementBatchId,
        ]
      );
      const reversalSettlementBatchId = parsePositiveInt(reversalInsert.rows?.insertId);
      if (!reversalSettlementBatchId) {
        throw new Error("Reversal settlement batch create failed");
      }

      await tx.query(
        `UPDATE cari_settlement_batches
         SET status = ?,
             reversed_at = CURRENT_TIMESTAMP
         WHERE tenant_id = ?
           AND id = ?`,
        [SETTLEMENT_STATUS_REVERSED, tenantId, settlementBatchId]
      );

      await insertAuditLog({
        req,
        runQuery: tx.query,
        tenantId,
        userId: payload.userId,
        action: "cari.settlement.reverse",
        legalEntityId: lockedLegalEntityId,
        resourceId: settlementBatchId,
        payload: {
          reason,
          originalSettlementBatchId: settlementBatchId,
          reversalSettlementBatchId,
          originalPostedJournalEntryId: originalJournalEntryId,
          reversalPostedJournalEntryId: reversalJournalResult.journalEntryId,
          followUpRisks: FOLLOW_UP_RISKS,
        },
      });

      const originalResult = await loadSettlementResult({
        tenantId,
        settlementBatchId,
        runQuery: tx.query,
      });
      const reversalResult = await loadSettlementResult({
        tenantId,
        settlementBatchId: reversalSettlementBatchId,
        runQuery: tx.query,
      });

      return {
        row: reversalResult.row,
        original: originalResult.row,
        journal: reversalResult.journal,
        idempotentReplay: false,
        followUpRisks: FOLLOW_UP_RISKS,
      };
    });

    return reversed;
  } catch (err) {
    if (isDuplicateKeyError(err, "uk_cari_settle_batches_single_reversal")) {
      throw badRequest("Settlement is already reversed");
    }
    throw err;
  }
}
