import { query, withTransaction } from "../db.js";
import { assertAccountBelongsToTenant } from "../tenantGuards.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import {
  buildOffsetPaginationResult,
  resolveOffsetPagination,
} from "../utils/pagination.js";
import {
  findCashRegisterById,
  findCashTransactionById,
  findCashTransactionByReversalOf,
  generateCashTxnNoForLegalEntityYearTx,
  insertCashTransaction,
  markCashTransactionAsReversed,
  postCashTransaction,
} from "./cash.queries.js";
import { assertRegisterOperationalConfig } from "./cash.register.service.js";
import {
  createCashTransaction,
  postCashTransactionById,
  reverseCashTransactionById,
} from "./cash.transaction.service.js";
import {
  applyCashFxPositionForPostedTransactionTx,
  getCashFxLotMovementSummaryByTransaction,
} from "./cash.fx.position.service.js";
import {
  CASH_PURPOSE_CODES,
  resolveCashPurposeAccountId,
} from "./cash.purpose-mappings.service.js";
import { createAndPostCashJournalTx } from "./cash.service.js";
import { upsertJournalSourceLinkTx } from "./journal.source-link.service.js";

const EXCHANGE_STATUS_DRAFT = "DRAFT";
const EXCHANGE_STATUS_POSTED = "POSTED";
const EXCHANGE_STATUS_REVERSED = "REVERSED";
const EXCHANGE_POSTING_MODE_CLEARING = "CLEARING";
const EXCHANGE_POSTING_MODE_DIRECT = "DIRECT";
const AMOUNT_EPSILON = 0.000001;
const CASH_POSTABLE_STATUSES = new Set(["DRAFT", "SUBMITTED", "APPROVED"]);

const EXCHANGE_BASE_SELECT = `
  SELECT
    ceb.id,
    ceb.tenant_id,
    ceb.legal_entity_id,
    ceb.source_cash_register_id,
    ceb.target_cash_register_id,
    ceb.source_currency_code,
    ceb.target_currency_code,
    ceb.source_amount_txn,
    ceb.target_amount_txn,
    ceb.source_amount_base,
    ceb.target_amount_base,
    ceb.realized_fx_base,
    ceb.reversal_realized_fx_base,
    ceb.fee_amount_txn,
    ceb.fee_amount_base,
    ceb.clearing_account_id,
    ceb.posting_mode,
    ceb.fee_account_id,
    ceb.fx_rate,
    ceb.fx_rate_source,
    ceb.fx_rate_date,
    ceb.provider_ref,
    ceb.spread_reference_rate,
    ceb.spread_rate_delta,
    ceb.spread_amount_base,
    ceb.status,
    ceb.exchange_out_cash_transaction_id,
    ceb.exchange_in_cash_transaction_id,
    ceb.fee_cash_transaction_id,
    ceb.reversal_out_cash_transaction_id,
    ceb.reversal_in_cash_transaction_id,
    ceb.reversal_fee_cash_transaction_id,
    ceb.posted_by_user_id,
    ceb.reversed_by_user_id,
    ceb.posted_at,
    ceb.reversed_at,
    ceb.reverse_reason,
    ceb.idempotency_key,
    ceb.integration_event_uid,
    ceb.note,
    ceb.created_by_user_id,
    ceb.created_at,
    ceb.updated_at,
    sr.operating_unit_id AS source_operating_unit_id,
    tr.operating_unit_id AS target_operating_unit_id,
    sr.code AS source_cash_register_code,
    sr.name AS source_cash_register_name,
    tr.code AS target_cash_register_code,
    tr.name AS target_cash_register_name,
    le.code AS legal_entity_code,
    le.name AS legal_entity_name,
    ca.code AS clearing_account_code,
    ca.name AS clearing_account_name,
    fa.code AS fee_account_code,
    fa.name AS fee_account_name
  FROM cash_exchange_batches ceb
  JOIN cash_registers sr ON sr.id = ceb.source_cash_register_id
  JOIN cash_registers tr ON tr.id = ceb.target_cash_register_id
  JOIN legal_entities le ON le.id = ceb.legal_entity_id
  LEFT JOIN accounts ca ON ca.id = ceb.clearing_account_id
  LEFT JOIN accounts fa ON fa.id = ceb.fee_account_id
`;

function asUpper(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeExchangePostingMode(value) {
  return asUpper(value) === EXCHANGE_POSTING_MODE_DIRECT
    ? EXCHANGE_POSTING_MODE_DIRECT
    : EXCHANGE_POSTING_MODE_CLEARING;
}

function normalizeCurrency(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function isActive(value) {
  return asUpper(value) === "ACTIVE";
}

function nowMysqlDateTime() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeText(value, maxLength = 100) {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value).trim();
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, maxLength);
}

function normalizeDate(value, label) {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw badRequest(`${label} must be YYYY-MM-DD`);
  }
  return raw;
}

function normalizePositiveAmount(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw badRequest(`${label} must be a numeric value greater than 0`);
  }
  return Number(parsed.toFixed(6));
}

function normalizeOptionalPositiveAmount(value, label) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return normalizePositiveAmount(value, label);
}

function normalizeOptionalPositiveRate(value, label) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw badRequest(`${label} must be a numeric value greater than 0`);
  }
  return Number(parsed.toFixed(10));
}

function normalizeOptionalDecimal(value, label, precision = 6) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw badRequest(`${label} must be a numeric value`);
  }
  return Number(parsed.toFixed(precision));
}

function amountsEqual(left, right, epsilon = AMOUNT_EPSILON) {
  return Math.abs(Number(left || 0) - Number(right || 0)) <= epsilon;
}

function roundAmount(value, precision = 6) {
  return Number(Number(value || 0).toFixed(precision));
}

function normalizeMoney(value) {
  return Number(value || 0).toFixed(6);
}

function toDateOnly(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  const normalized = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function toDateTimeSql(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 19).replace("T", " ");
  }
  const normalized = String(value).trim();
  return normalized.length >= 19 ? normalized.replace("T", " ").slice(0, 19) : null;
}

function buildDerivedKey(prefix, value, maxLength = 100) {
  const normalizedPrefix = String(prefix || "").trim();
  const normalizedValue = String(value || "").trim();
  if (!normalizedPrefix || !normalizedValue) {
    throw badRequest("Unable to derive idempotency key");
  }
  return `${normalizedPrefix}:${normalizedValue}`.slice(0, maxLength);
}

function assertCashTransactionReadyForPosting(row, label) {
  if (!row) {
    throw badRequest(`${label} not found`);
  }

  const status = asUpper(row.status);
  const postedJournalEntryId = parsePositiveInt(row.posted_journal_entry_id);
  if (status === "POSTED") {
    if (!postedJournalEntryId) {
      throw badRequest(`${label} is POSTED without posted_journal_entry_id`);
    }
    return;
  }

  if (!CASH_POSTABLE_STATUSES.has(status)) {
    throw badRequest(`${label} must be DRAFT, SUBMITTED, or APPROVED before posting`);
  }

  if (!isActive(row.register_status)) {
    throw badRequest(`${label} cash register is not ACTIVE`);
  }

  const sessionMode = asUpper(row.register_session_mode);
  if (sessionMode === "REQUIRED") {
    if (!parsePositiveInt(row.cash_session_id)) {
      throw badRequest(`${label} requires an OPEN cash session`);
    }
    if (asUpper(row.cash_session_status) !== "OPEN") {
      throw badRequest(`${label} cash_session_id must be OPEN`);
    }
  }
}

function resolveSharedCashJournalEntryId(leftTxn, rightTxn, label) {
  const leftStatus = asUpper(leftTxn?.status);
  const rightStatus = asUpper(rightTxn?.status);
  const leftJournalEntryId = parsePositiveInt(leftTxn?.posted_journal_entry_id);
  const rightJournalEntryId = parsePositiveInt(rightTxn?.posted_journal_entry_id);
  const leftPosted = leftStatus === "POSTED";
  const rightPosted = rightStatus === "POSTED";

  if (leftPosted && rightPosted) {
    if (!leftJournalEntryId || !rightJournalEntryId || leftJournalEntryId !== rightJournalEntryId) {
      throw badRequest(`${label} must share a single posted journal entry`);
    }
    return leftJournalEntryId;
  }

  if (leftPosted || rightPosted) {
    throw badRequest(`${label} is partially posted`);
  }

  return null;
}

function buildExchangeSubledgerReference(exchangeBatchId) {
  return `CASH_EXCH:${exchangeBatchId}`.slice(0, 100);
}

function buildDirectExchangeJournalLines({
  exchangeBatchId,
  sourceTransaction,
  targetTransaction,
  description,
}) {
  const sourceAmountTxn = normalizePositiveAmount(
    sourceTransaction.amount,
    "exchangeOut.amountTxn"
  );
  const targetAmountTxn = normalizePositiveAmount(
    targetTransaction.amount,
    "exchangeIn.amountTxn"
  );
  const sourceAmountBase = normalizePositiveAmount(
    sourceTransaction.amount_base ?? sourceTransaction.amount,
    "exchangeOut.amountBase"
  );
  const targetAmountBase = normalizePositiveAmount(
    targetTransaction.amount_base ?? targetTransaction.amount,
    "exchangeIn.amountBase"
  );
  if (!amountsEqual(sourceAmountBase, targetAmountBase)) {
    throw badRequest("Direct exchange source/target base effects must net cleanly");
  }

  const sourceRegisterAccountId = parsePositiveInt(sourceTransaction.register_account_id);
  const targetRegisterAccountId = parsePositiveInt(targetTransaction.register_account_id);
  if (!sourceRegisterAccountId || !targetRegisterAccountId) {
    throw badRequest("Direct exchange register account metadata is missing");
  }

  const lineDescription = normalizeText(description, 255) || "Cash exchange direct";
  const subledgerReferenceNo = buildExchangeSubledgerReference(exchangeBatchId);

  return [
    {
      accountId: targetRegisterAccountId,
      operatingUnitId: parsePositiveInt(targetTransaction.operating_unit_id) || null,
      description: lineDescription,
      subledgerReferenceNo,
      currencyCode: normalizeCurrency(targetTransaction.currency_code),
      amountTxn: targetAmountTxn,
      debitBase: targetAmountBase,
      creditBase: 0,
    },
    {
      accountId: sourceRegisterAccountId,
      operatingUnitId: parsePositiveInt(sourceTransaction.operating_unit_id) || null,
      description: lineDescription,
      subledgerReferenceNo,
      currencyCode: normalizeCurrency(sourceTransaction.currency_code),
      amountTxn: Number((sourceAmountTxn * -1).toFixed(6)),
      debitBase: 0,
      creditBase: sourceAmountBase,
    },
  ];
}

function buildDirectExchangeReversalJournalLines({
  exchangeBatchId,
  sourceTransaction,
  targetTransaction,
  reverseReason,
}) {
  const sourceAmountTxn = normalizePositiveAmount(
    sourceTransaction.amount,
    "exchangeOut.amountTxn"
  );
  const targetAmountTxn = normalizePositiveAmount(
    targetTransaction.amount,
    "exchangeIn.amountTxn"
  );
  const sourceAmountBase = normalizePositiveAmount(
    sourceTransaction.amount_base ?? sourceTransaction.amount,
    "exchangeOut.amountBase"
  );
  const targetAmountBase = normalizePositiveAmount(
    targetTransaction.amount_base ?? targetTransaction.amount,
    "exchangeIn.amountBase"
  );
  if (!amountsEqual(sourceAmountBase, targetAmountBase)) {
    throw badRequest("Direct exchange source/target base effects must net cleanly");
  }

  const sourceRegisterAccountId = parsePositiveInt(sourceTransaction.register_account_id);
  const targetRegisterAccountId = parsePositiveInt(targetTransaction.register_account_id);
  if (!sourceRegisterAccountId || !targetRegisterAccountId) {
    throw badRequest("Direct exchange register account metadata is missing");
  }

  const lineDescription =
    normalizeText(`Reversal of cash exchange ${exchangeBatchId}: ${reverseReason}`, 255) ||
    `Reversal of cash exchange ${exchangeBatchId}`.slice(0, 255);
  const subledgerReferenceNo = buildExchangeSubledgerReference(exchangeBatchId);

  return [
    {
      accountId: sourceRegisterAccountId,
      operatingUnitId: parsePositiveInt(sourceTransaction.operating_unit_id) || null,
      description: lineDescription,
      subledgerReferenceNo,
      currencyCode: normalizeCurrency(sourceTransaction.currency_code),
      amountTxn: sourceAmountTxn,
      debitBase: sourceAmountBase,
      creditBase: 0,
    },
    {
      accountId: targetRegisterAccountId,
      operatingUnitId: parsePositiveInt(targetTransaction.operating_unit_id) || null,
      description: lineDescription,
      subledgerReferenceNo,
      currencyCode: normalizeCurrency(targetTransaction.currency_code),
      amountTxn: Number((targetAmountTxn * -1).toFixed(6)),
      debitBase: 0,
      creditBase: targetAmountBase,
    },
  ];
}

function mapExchangeBatchRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    legalEntityCode: row.legal_entity_code || null,
    legalEntityName: row.legal_entity_name || null,
    sourceRegisterId: parsePositiveInt(row.source_cash_register_id),
    sourceRegisterCode: row.source_cash_register_code || null,
    sourceRegisterName: row.source_cash_register_name || null,
    sourceOperatingUnitId: parsePositiveInt(row.source_operating_unit_id),
    targetRegisterId: parsePositiveInt(row.target_cash_register_id),
    targetRegisterCode: row.target_cash_register_code || null,
    targetRegisterName: row.target_cash_register_name || null,
    targetOperatingUnitId: parsePositiveInt(row.target_operating_unit_id),
    sourceCurrencyCode: row.source_currency_code || null,
    targetCurrencyCode: row.target_currency_code || null,
    sourceAmountTxn:
      row.source_amount_txn === null || row.source_amount_txn === undefined
        ? null
        : Number(row.source_amount_txn),
    targetAmountTxn:
      row.target_amount_txn === null || row.target_amount_txn === undefined
        ? null
        : Number(row.target_amount_txn),
    sourceAmountBase:
      row.source_amount_base === null || row.source_amount_base === undefined
        ? null
        : Number(row.source_amount_base),
    targetAmountBase:
      row.target_amount_base === null || row.target_amount_base === undefined
        ? null
        : Number(row.target_amount_base),
    realizedFxBase:
      row.realized_fx_base === null || row.realized_fx_base === undefined
        ? null
        : Number(row.realized_fx_base),
    reversalRealizedFxBase:
      row.reversal_realized_fx_base === null || row.reversal_realized_fx_base === undefined
        ? null
        : Number(row.reversal_realized_fx_base),
    feeAmountTxn:
      row.fee_amount_txn === null || row.fee_amount_txn === undefined
        ? null
        : Number(row.fee_amount_txn),
    feeAmountBase:
      row.fee_amount_base === null || row.fee_amount_base === undefined
        ? null
        : Number(row.fee_amount_base),
    clearingAccountId: parsePositiveInt(row.clearing_account_id),
    clearingAccountCode: row.clearing_account_code || null,
    clearingAccountName: row.clearing_account_name || null,
    postingMode: normalizeExchangePostingMode(row.posting_mode),
    feeAccountId: parsePositiveInt(row.fee_account_id),
    feeAccountCode: row.fee_account_code || null,
    feeAccountName: row.fee_account_name || null,
    fxRate: row.fx_rate === null || row.fx_rate === undefined ? null : Number(row.fx_rate),
    fxRateSource: row.fx_rate_source || null,
    fxRateDate: row.fx_rate_date || null,
    providerRef: row.provider_ref || null,
    spreadReferenceRate:
      row.spread_reference_rate === null || row.spread_reference_rate === undefined
        ? null
        : Number(row.spread_reference_rate),
    spreadRateDelta:
      row.spread_rate_delta === null || row.spread_rate_delta === undefined
        ? null
        : Number(row.spread_rate_delta),
    spreadAmountBase:
      row.spread_amount_base === null || row.spread_amount_base === undefined
        ? null
        : Number(row.spread_amount_base),
    status: row.status || null,
    exchangeOutCashTransactionId: parsePositiveInt(row.exchange_out_cash_transaction_id),
    exchangeInCashTransactionId: parsePositiveInt(row.exchange_in_cash_transaction_id),
    feeCashTransactionId: parsePositiveInt(row.fee_cash_transaction_id),
    reversalOutCashTransactionId: parsePositiveInt(row.reversal_out_cash_transaction_id),
    reversalInCashTransactionId: parsePositiveInt(row.reversal_in_cash_transaction_id),
    reversalFeeCashTransactionId: parsePositiveInt(row.reversal_fee_cash_transaction_id),
    postedByUserId: parsePositiveInt(row.posted_by_user_id),
    reversedByUserId: parsePositiveInt(row.reversed_by_user_id),
    postedAt: row.posted_at || null,
    reversedAt: row.reversed_at || null,
    reverseReason: row.reverse_reason || null,
    idempotencyKey: row.idempotency_key || null,
    integrationEventUid: row.integration_event_uid || null,
    note: row.note || null,
    createdByUserId: parsePositiveInt(row.created_by_user_id),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

async function findExchangeBatchById({
  tenantId,
  exchangeBatchId,
  runQuery = query,
  forUpdate = false,
}) {
  const result = await runQuery(
    `${EXCHANGE_BASE_SELECT}
     WHERE ceb.tenant_id = ?
       AND ceb.id = ?
     LIMIT 1
     ${forUpdate ? "FOR UPDATE" : ""}`,
    [tenantId, exchangeBatchId]
  );
  return result.rows?.[0] || null;
}

async function findExchangeBatchByIdempotency({
  tenantId,
  sourceRegisterId,
  idempotencyKey,
  runQuery = query,
  forUpdate = false,
}) {
  const result = await runQuery(
    `${EXCHANGE_BASE_SELECT}
     WHERE ceb.tenant_id = ?
       AND ceb.source_cash_register_id = ?
       AND ceb.idempotency_key = ?
     LIMIT 1
     ${forUpdate ? "FOR UPDATE" : ""}`,
    [tenantId, sourceRegisterId, idempotencyKey]
  );
  return result.rows?.[0] || null;
}

async function findExchangeBatchByIntegrationEventUid({
  tenantId,
  integrationEventUid,
  runQuery = query,
  forUpdate = false,
}) {
  const result = await runQuery(
    `${EXCHANGE_BASE_SELECT}
     WHERE ceb.tenant_id = ?
       AND ceb.integration_event_uid = ?
     LIMIT 1
     ${forUpdate ? "FOR UPDATE" : ""}`,
    [tenantId, integrationEventUid]
  );
  return result.rows?.[0] || null;
}

async function resolveBaseCurrencyCodeForLegalEntity({
  tenantId,
  legalEntityId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT base_currency_code
     FROM books
     WHERE tenant_id = ?
       AND legal_entity_id = ?
     ORDER BY CASE WHEN book_type = 'LOCAL' THEN 0 ELSE 1 END, id ASC
     LIMIT 1`,
    [tenantId, legalEntityId]
  );
  const baseCurrencyCode = normalizeCurrency(result.rows?.[0]?.base_currency_code);
  if (!baseCurrencyCode || baseCurrencyCode.length !== 3) {
    throw badRequest("Book base currency is not configured for exchange legal entity");
  }
  return baseCurrencyCode;
}

async function createDirectExchangeReversalTransactionTx({
  tx,
  tenantId,
  userId,
  originalTransaction,
  reverseReason,
}) {
  const originalTransactionId = parsePositiveInt(originalTransaction?.id);
  if (!originalTransactionId) {
    throw badRequest("Original exchange transaction is required for direct reversal");
  }

  const existingReversal = await findCashTransactionByReversalOf({
    tenantId,
    transactionId: originalTransactionId,
    runQuery: tx.query,
  });
  if (existingReversal) {
    return existingReversal;
  }

  const reversalBookDate = todayIsoDate();
  const reversalTxnNo = await generateCashTxnNoForLegalEntityYearTx({
    tenantId,
    legalEntityId: parsePositiveInt(originalTransaction.legal_entity_id),
    legalEntityCode: originalTransaction.legal_entity_code,
    bookDate: reversalBookDate,
    runQuery: tx.query,
  });

  const reversalId = await insertCashTransaction({
    payload: {
      tenantId,
      registerId: parsePositiveInt(originalTransaction.cash_register_id),
      cashSessionId: parsePositiveInt(originalTransaction.cash_session_id) || null,
      txnNo: reversalTxnNo,
      txnType: originalTransaction.txn_type,
      status: "DRAFT",
      txnDatetime: nowMysqlDateTime(),
      bookDate: reversalBookDate,
      amount: normalizeMoney(originalTransaction.amount),
      amountBase: normalizeMoney(
        originalTransaction.amount_base === null || originalTransaction.amount_base === undefined
          ? originalTransaction.amount
          : originalTransaction.amount_base
      ),
      currencyCode: originalTransaction.currency_code,
      fxRate:
        originalTransaction.fx_rate === null || originalTransaction.fx_rate === undefined
          ? Number(1).toFixed(10)
          : Number(originalTransaction.fx_rate).toFixed(10),
      fxRateSource: originalTransaction.fx_rate_source || "PARITY",
      fxRateDate: originalTransaction.fx_rate_date || reversalBookDate,
      fxFallbackMode: originalTransaction.fx_fallback_mode || null,
      fxFallbackMaxDays:
        originalTransaction.fx_fallback_max_days === undefined
          ? null
          : originalTransaction.fx_fallback_max_days,
      description: `Reversal of ${originalTransaction.txn_no}: ${reverseReason}`.slice(0, 500),
      referenceNo: originalTransaction.reference_no,
      sourceDocType: originalTransaction.source_doc_type,
      sourceDocId: originalTransaction.source_doc_id,
      sourceModule: "CASH",
      sourceEntityType: "cash_transaction_reversal",
      sourceEntityId: String(originalTransactionId),
      integrationLinkStatus: "UNLINKED",
      counterpartyType: originalTransaction.counterparty_type,
      counterpartyId: parsePositiveInt(originalTransaction.counterparty_id) || null,
      counterAccountId: parsePositiveInt(originalTransaction.counter_account_id) || null,
      counterCashRegisterId:
        parsePositiveInt(originalTransaction.counter_cash_register_id_resolved) ||
        parsePositiveInt(originalTransaction.counter_cash_register_id) ||
        null,
      linkedCariSettlementBatchId: null,
      linkedCariUnappliedCashId: null,
      postedJournalEntryId: null,
      reversalOfTransactionId: originalTransactionId,
      overrideCashControl: false,
      overrideReason: null,
      idempotencyKey: `REV-${originalTransactionId}`,
      integrationEventUid: `REV-${originalTransactionId}`,
      userId,
      postedByUserId: null,
      postedAt: null,
    },
    runQuery: tx.query,
  });

  return findCashTransactionById({
    tenantId,
    transactionId: reversalId,
    runQuery: tx.query,
  });
}

async function postDirectExchangeBatch({
  req,
  assertScopeAccess,
  exchangeBatchId,
  tenantId,
  userId,
  legalEntityId,
  sourceRegister,
  targetRegister,
  sourceCashSessionId,
  targetCashSessionId,
  txnDatetime,
  bookDate,
  sourceAmountTxn,
  targetAmountTxn,
  feeAmountTxn,
  feeAmountBaseInput,
  feeAccountId,
  effectiveFxRate,
  effectiveFxRateSource,
  effectiveFxRateDate,
  providerRef,
  spreadReferenceRate,
  spreadRateDelta,
  spreadAmountBase,
  description,
  referenceNo,
}) {
  const exchangeReferenceNo = referenceNo || `EXCH-${exchangeBatchId}`;
  const exchangeDescription =
    description ||
    `Cash exchange direct ${sourceRegister.code || sourceRegister.id} -> ${targetRegister.code || targetRegister.id}`;

  const outTxnCreate = await createCashTransaction({
    req,
    payload: {
      tenantId,
      userId,
      registerId: parsePositiveInt(sourceRegister.id),
      cashSessionId: sourceCashSessionId,
      txnType: "PAYOUT",
      txnDatetime,
      bookDate,
      amount: sourceAmountTxn,
      currencyCode: normalizeCurrency(sourceRegister.currency_code),
      amountBase: null,
      fxRate: null,
      fxRateSource: null,
      fxRateDate: null,
      fxFallbackMode: null,
      fxFallbackMaxDays: null,
      description: description || `Cash exchange out to ${targetRegister.code || targetRegister.id}`,
      referenceNo: exchangeReferenceNo,
      sourceDocType: null,
      sourceDocId: null,
      counterpartyType: null,
      counterpartyId: null,
      counterAccountId: parsePositiveInt(targetRegister.account_id),
      counterCashRegisterId: parsePositiveInt(targetRegister.id),
      linkedCariSettlementBatchId: null,
      linkedCariUnappliedCashId: null,
      sourceModule: "CASH",
      sourceEntityType: "cash_exchange_batch",
      sourceEntityId: String(exchangeBatchId),
      integrationLinkStatus: "LINKED",
      integrationEventUid: buildDerivedKey("CASH_EXCHANGE_OUT_EVENT", exchangeBatchId),
      idempotencyKey: buildDerivedKey("CASH_EXCHANGE_OUT", exchangeBatchId),
    },
    assertScopeAccess,
  });
  const outTxnId = parsePositiveInt(outTxnCreate.row?.id);
  if (!outTxnId) {
    throw badRequest("Failed to create exchange out transaction");
  }

  const sourceAmountBase = normalizePositiveAmount(outTxnCreate.row.amount_base, "sourceAmountBase");
  const baseCurrencyCode = await resolveBaseCurrencyCodeForLegalEntity({
    tenantId,
    legalEntityId,
  });

  let inAmountBase = null;
  let inFxRate = null;
  let inFxRateSource = null;
  let inFxRateDate = null;
  const sourceCurrency = normalizeCurrency(sourceRegister.currency_code);
  const targetCurrency = normalizeCurrency(targetRegister.currency_code);
  if (targetCurrency === baseCurrencyCode) {
    if (!amountsEqual(targetAmountTxn, sourceAmountBase)) {
      throw badRequest(
        "targetAmountTxn must equal source amount_base when target register currency is book base currency"
      );
    }
  } else {
    inAmountBase = sourceAmountBase;
    inFxRate = Number((sourceAmountBase / targetAmountTxn).toFixed(10));
    inFxRateSource = "EXCHANGE_DERIVED";
    inFxRateDate = bookDate;
  }

  const inTxnCreate = await createCashTransaction({
    req,
    payload: {
      tenantId,
      userId,
      registerId: parsePositiveInt(targetRegister.id),
      cashSessionId: targetCashSessionId,
      txnType: "RECEIPT",
      txnDatetime,
      bookDate,
      amount: targetAmountTxn,
      currencyCode: targetCurrency,
      amountBase: inAmountBase,
      fxRate: inFxRate,
      fxRateSource: inFxRateSource,
      fxRateDate: inFxRateDate,
      fxFallbackMode: null,
      fxFallbackMaxDays: null,
      description: description || `Cash exchange in from ${sourceRegister.code || sourceRegister.id}`,
      referenceNo: exchangeReferenceNo,
      sourceDocType: null,
      sourceDocId: null,
      counterpartyType: null,
      counterpartyId: null,
      counterAccountId: parsePositiveInt(sourceRegister.account_id),
      counterCashRegisterId: parsePositiveInt(sourceRegister.id),
      linkedCariSettlementBatchId: null,
      linkedCariUnappliedCashId: null,
      sourceModule: "CASH",
      sourceEntityType: "cash_exchange_batch",
      sourceEntityId: String(exchangeBatchId),
      integrationLinkStatus: "LINKED",
      integrationEventUid: buildDerivedKey("CASH_EXCHANGE_IN_EVENT", exchangeBatchId),
      idempotencyKey: buildDerivedKey("CASH_EXCHANGE_IN", exchangeBatchId),
    },
    assertScopeAccess,
  });
  const inTxnId = parsePositiveInt(inTxnCreate.row?.id);
  if (!inTxnId) {
    throw badRequest("Failed to create exchange in transaction");
  }

  let feeTxnId = null;
  if (feeAmountTxn) {
    let feeAmountBase = feeAmountBaseInput;
    let feeFxRate = null;
    let feeFxRateSource = null;
    let feeFxRateDate = null;

    if (sourceCurrency === baseCurrencyCode) {
      if (feeAmountBase !== null && !amountsEqual(feeAmountBase, feeAmountTxn)) {
        throw badRequest(
          "feeAmountBase must equal feeAmountTxn when source register currency is book base currency"
        );
      }
    } else {
      const sourceFxRate = Number((sourceAmountBase / sourceAmountTxn).toFixed(10));
      if (feeAmountBase === null) {
        if (!(sourceFxRate > 0)) {
          throw badRequest(
            "feeAmountBase or source exchange rate is required for foreign-currency fee posting"
          );
        }
        feeAmountBase = roundAmount(feeAmountTxn * sourceFxRate);
      }
      feeFxRate = Number((feeAmountBase / feeAmountTxn).toFixed(10));
      feeFxRateSource = "EXCHANGE_FEE_EXECUTED";
      feeFxRateDate = bookDate;
    }

    const feeCreate = await createCashTransaction({
      req,
      payload: {
        tenantId,
        userId,
        registerId: parsePositiveInt(sourceRegister.id),
        cashSessionId: sourceCashSessionId,
        txnType: "PAYOUT",
        txnDatetime,
        bookDate,
        amount: feeAmountTxn,
        currencyCode: sourceCurrency,
        amountBase: feeAmountBase,
        fxRate: feeFxRate,
        fxRateSource: feeFxRateSource,
        fxRateDate: feeFxRateDate,
        fxFallbackMode: null,
        fxFallbackMaxDays: null,
        description:
          description ||
          `Cash exchange commission (${providerRef || sourceRegister.code || sourceRegister.id})`,
        referenceNo: exchangeReferenceNo,
        sourceDocType: null,
        sourceDocId: null,
        counterpartyType: null,
        counterpartyId: null,
        counterAccountId: parsePositiveInt(feeAccountId),
        counterCashRegisterId: null,
        linkedCariSettlementBatchId: null,
        linkedCariUnappliedCashId: null,
        sourceModule: "CASH",
        sourceEntityType: "cash_exchange_batch",
        sourceEntityId: String(exchangeBatchId),
        integrationLinkStatus: "LINKED",
        integrationEventUid: buildDerivedKey("CASH_EXCHANGE_FEE_EVENT", exchangeBatchId),
        idempotencyKey: buildDerivedKey("CASH_EXCHANGE_FEE", exchangeBatchId),
      },
      assertScopeAccess,
    });
    feeTxnId = parsePositiveInt(feeCreate.row?.id);
    if (!feeTxnId) {
      throw badRequest("Failed to create exchange fee transaction");
    }
  }

  await withTransaction(async (tx) => {
    const lockedBatch = await findExchangeBatchById({
      tenantId,
      exchangeBatchId,
      runQuery: tx.query,
      forUpdate: true,
    });
    if (!lockedBatch) {
      throw badRequest("Cash exchange batch not found");
    }

    let lockedOutTxn = await findCashTransactionById({
      tenantId,
      transactionId: outTxnId,
      runQuery: tx.query,
      forUpdate: true,
    });
    let lockedInTxn = await findCashTransactionById({
      tenantId,
      transactionId: inTxnId,
      runQuery: tx.query,
      forUpdate: true,
    });
    if (!lockedOutTxn || !lockedInTxn) {
      throw badRequest("Direct exchange draft transactions are missing");
    }

    let sharedJournalEntryId = resolveSharedCashJournalEntryId(
      lockedOutTxn,
      lockedInTxn,
      "Direct exchange transactions"
    );
    if (!sharedJournalEntryId) {
      assertCashTransactionReadyForPosting(lockedOutTxn, "Exchange out transaction");
      assertCashTransactionReadyForPosting(lockedInTxn, "Exchange in transaction");

      const journalPosting = await createAndPostCashJournalTx(tx, {
        tenantId,
        userId,
        legalEntityId,
        cashTxn: lockedOutTxn,
        req,
        journalLinesOverride: buildDirectExchangeJournalLines({
          exchangeBatchId,
          sourceTransaction: lockedOutTxn,
          targetTransaction: lockedInTxn,
          description: exchangeDescription,
        }),
        descriptionOverride: exchangeDescription,
        referenceNoOverride: exchangeReferenceNo,
      });
      sharedJournalEntryId = parsePositiveInt(journalPosting.journalEntryId);
      if (!sharedJournalEntryId) {
        throw badRequest("Failed to post direct exchange journal");
      }

      await upsertJournalSourceLinkTx(tx, {
        tenantId,
        legalEntityId,
        journalEntryId: sharedJournalEntryId,
        sourceRefType: "CASH_TRANSACTION",
        sourceRefId: parsePositiveInt(lockedInTxn.id),
        linkRole: "SUPPORTING",
      });

      await postCashTransaction({
        tenantId,
        transactionId: parsePositiveInt(lockedOutTxn.id),
        userId,
        postedJournalEntryId: sharedJournalEntryId,
        overrideCashControl: false,
        overrideReason: null,
        runQuery: tx.query,
      });
      await postCashTransaction({
        tenantId,
        transactionId: parsePositiveInt(lockedInTxn.id),
        userId,
        postedJournalEntryId: sharedJournalEntryId,
        overrideCashControl: false,
        overrideReason: null,
        runQuery: tx.query,
      });

      lockedOutTxn = await findCashTransactionById({
        tenantId,
        transactionId: outTxnId,
        runQuery: tx.query,
      });
      lockedInTxn = await findCashTransactionById({
        tenantId,
        transactionId: inTxnId,
        runQuery: tx.query,
      });
    }

    await applyCashFxPositionForPostedTransactionTx({
      tenantId,
      cashTransactionId: outTxnId,
      cashTransactionRow: lockedOutTxn,
      runQuery: tx.query,
    });
    await applyCashFxPositionForPostedTransactionTx({
      tenantId,
      cashTransactionId: inTxnId,
      cashTransactionRow: lockedInTxn,
      runQuery: tx.query,
    });

    let feeAmountBasePosted = null;
    if (feeTxnId) {
      let lockedFeeTxn = await findCashTransactionById({
        tenantId,
        transactionId: feeTxnId,
        runQuery: tx.query,
        forUpdate: true,
      });
      if (!lockedFeeTxn) {
        throw badRequest("Exchange fee transaction is missing");
      }

      const feePostedJournalEntryId = parsePositiveInt(lockedFeeTxn.posted_journal_entry_id);
      if (asUpper(lockedFeeTxn.status) !== "POSTED") {
        assertCashTransactionReadyForPosting(lockedFeeTxn, "Exchange fee transaction");
        const feePosting = await createAndPostCashJournalTx(tx, {
          tenantId,
          userId,
          legalEntityId,
          cashTxn: lockedFeeTxn,
          req,
        });
        const directFeeJournalEntryId = parsePositiveInt(feePosting.journalEntryId);
        if (!directFeeJournalEntryId) {
          throw badRequest("Failed to post exchange fee transaction");
        }
        await postCashTransaction({
          tenantId,
          transactionId: feeTxnId,
          userId,
          postedJournalEntryId: directFeeJournalEntryId,
          overrideCashControl: false,
          overrideReason: null,
          runQuery: tx.query,
        });
        lockedFeeTxn = await findCashTransactionById({
          tenantId,
          transactionId: feeTxnId,
          runQuery: tx.query,
        });
      } else if (!feePostedJournalEntryId) {
        throw badRequest("Exchange fee transaction is POSTED without posted_journal_entry_id");
      }

      await applyCashFxPositionForPostedTransactionTx({
        tenantId,
        cashTransactionId: feeTxnId,
        cashTransactionRow: lockedFeeTxn,
        runQuery: tx.query,
      });
      feeAmountBasePosted = normalizePositiveAmount(
        lockedFeeTxn.amount_base,
        "exchangeFee.posted.amountBase"
      );
    }

    lockedOutTxn = await findCashTransactionById({
      tenantId,
      transactionId: outTxnId,
      runQuery: tx.query,
    });
    lockedInTxn = await findCashTransactionById({
      tenantId,
      transactionId: inTxnId,
      runQuery: tx.query,
    });

    const outAmountBase = normalizePositiveAmount(
      lockedOutTxn.amount_base,
      "exchangeOut.posted.amountBase"
    );
    const inAmountBasePosted = normalizePositiveAmount(
      lockedInTxn.amount_base,
      "exchangeIn.posted.amountBase"
    );
    if (!amountsEqual(outAmountBase, inAmountBasePosted)) {
      throw badRequest("Direct exchange source/target base effects must net cleanly");
    }

    const exchangeOutFxLotSummary = await getCashFxLotMovementSummaryByTransaction({
      tenantId,
      cashTransactionId: outTxnId,
      runQuery: tx.query,
    });
    const realizedFxBase = roundAmount(exchangeOutFxLotSummary?.realizedFxBase || 0);

    await tx.query(
      `UPDATE cash_exchange_batches
       SET
         source_amount_base = ?,
         target_amount_base = ?,
         realized_fx_base = ?,
         fee_amount_txn = ?,
         fee_amount_base = ?,
         exchange_out_cash_transaction_id = ?,
         exchange_in_cash_transaction_id = ?,
         fee_cash_transaction_id = ?,
         status = ?,
         posted_by_user_id = ?,
         posted_at = UTC_TIMESTAMP(),
         fx_rate = ?,
         fx_rate_source = ?,
         fx_rate_date = ?,
         provider_ref = ?,
         spread_reference_rate = ?,
         spread_rate_delta = ?,
         spread_amount_base = ?
       WHERE tenant_id = ?
         AND id = ?`,
      [
        outAmountBase,
        inAmountBasePosted,
        realizedFxBase,
        feeAmountTxn,
        feeAmountBasePosted,
        outTxnId,
        inTxnId,
        feeTxnId,
        EXCHANGE_STATUS_POSTED,
        userId,
        effectiveFxRate,
        effectiveFxRateSource,
        effectiveFxRateDate,
        providerRef,
        spreadReferenceRate,
        spreadRateDelta,
        spreadAmountBase,
        tenantId,
        exchangeBatchId,
      ]
    );
  });

  const saved = await findExchangeBatchById({
    tenantId,
    exchangeBatchId,
  });
  if (!saved) {
    throw badRequest("Cash exchange batch not found after posting");
  }
  const transactions = await getBatchTransactions(saved);
  return {
    batch: mapExchangeBatchRow(saved),
    ...transactions,
    fxLot: await buildExchangeBatchFxLotSummary(tenantId, transactions),
    idempotentReplay: false,
  };
}

async function reverseDirectExchangeBatch({
  req,
  tenantId,
  userId,
  exchangeBatchId,
  legalEntityId,
  outTxnId,
  inTxnId,
  reverseReason,
}) {
  const result = await withTransaction(async (tx) => {
    const originalOutTxn = await findCashTransactionById({
      tenantId,
      transactionId: outTxnId,
      runQuery: tx.query,
      forUpdate: true,
    });
    const originalInTxn = await findCashTransactionById({
      tenantId,
      transactionId: inTxnId,
      runQuery: tx.query,
      forUpdate: true,
    });
    if (!originalOutTxn || !originalInTxn) {
      throw badRequest("Cash exchange batch is missing linked posted transactions");
    }

    const outStatus = asUpper(originalOutTxn.status);
    const inStatus = asUpper(originalInTxn.status);
    if (
      outStatus !== "POSTED" &&
      !(outStatus === "REVERSED" && parsePositiveInt(originalOutTxn.posted_journal_entry_id))
    ) {
      throw badRequest("Exchange out transaction must be POSTED before reversal");
    }
    if (
      inStatus !== "POSTED" &&
      !(inStatus === "REVERSED" && parsePositiveInt(originalInTxn.posted_journal_entry_id))
    ) {
      throw badRequest("Exchange in transaction must be POSTED before reversal");
    }

    let reversalOutTxn = await createDirectExchangeReversalTransactionTx({
      tx,
      tenantId,
      userId,
      originalTransaction: originalOutTxn,
      reverseReason,
    });
    let reversalInTxn = await createDirectExchangeReversalTransactionTx({
      tx,
      tenantId,
      userId,
      originalTransaction: originalInTxn,
      reverseReason,
    });
    if (!reversalOutTxn || !reversalInTxn) {
      throw badRequest("Failed to create exchange reversal transactions");
    }

    let reversalJournalEntryId = resolveSharedCashJournalEntryId(
      reversalOutTxn,
      reversalInTxn,
      "Direct exchange reversal transactions"
    );
    if (!reversalJournalEntryId) {
      assertCashTransactionReadyForPosting(reversalOutTxn, "Exchange out reversal transaction");
      assertCashTransactionReadyForPosting(reversalInTxn, "Exchange in reversal transaction");

      const reversalPosting = await createAndPostCashJournalTx(tx, {
        tenantId,
        userId,
        legalEntityId,
        cashTxn: reversalOutTxn,
        req,
        journalLinesOverride: buildDirectExchangeReversalJournalLines({
          exchangeBatchId,
          sourceTransaction: originalOutTxn,
          targetTransaction: originalInTxn,
          reverseReason,
        }),
        descriptionOverride: `Reversal of cash exchange ${exchangeBatchId}: ${reverseReason}`.slice(
          0,
          255
        ),
        referenceNoOverride: originalOutTxn.reference_no || `EXCH-${exchangeBatchId}`,
      });
      reversalJournalEntryId = parsePositiveInt(reversalPosting.journalEntryId);
      if (!reversalJournalEntryId) {
        throw badRequest("Failed to post direct exchange reversal journal");
      }

      await upsertJournalSourceLinkTx(tx, {
        tenantId,
        legalEntityId,
        journalEntryId: reversalJournalEntryId,
        sourceRefType: "CASH_TRANSACTION",
        sourceRefId: parsePositiveInt(reversalInTxn.id),
        linkRole: "SUPPORTING",
      });

      await postCashTransaction({
        tenantId,
        transactionId: parsePositiveInt(reversalOutTxn.id),
        userId,
        postedJournalEntryId: reversalJournalEntryId,
        overrideCashControl: false,
        overrideReason: null,
        runQuery: tx.query,
      });
      await postCashTransaction({
        tenantId,
        transactionId: parsePositiveInt(reversalInTxn.id),
        userId,
        postedJournalEntryId: reversalJournalEntryId,
        overrideCashControl: false,
        overrideReason: null,
        runQuery: tx.query,
      });

      reversalOutTxn = await findCashTransactionById({
        tenantId,
        transactionId: parsePositiveInt(reversalOutTxn.id),
        runQuery: tx.query,
      });
      reversalInTxn = await findCashTransactionById({
        tenantId,
        transactionId: parsePositiveInt(reversalInTxn.id),
        runQuery: tx.query,
      });
    }

    await applyCashFxPositionForPostedTransactionTx({
      tenantId,
      cashTransactionId: parsePositiveInt(reversalOutTxn.id),
      cashTransactionRow: reversalOutTxn,
      runQuery: tx.query,
    });
    await applyCashFxPositionForPostedTransactionTx({
      tenantId,
      cashTransactionId: parsePositiveInt(reversalInTxn.id),
      cashTransactionRow: reversalInTxn,
      runQuery: tx.query,
    });

    if (outStatus !== "REVERSED") {
      await markCashTransactionAsReversed({
        tenantId,
        transactionId: outTxnId,
        userId,
        runQuery: tx.query,
      });
    }
    if (inStatus !== "REVERSED") {
      await markCashTransactionAsReversed({
        tenantId,
        transactionId: inTxnId,
        userId,
        runQuery: tx.query,
      });
    }

    const reversalOutFxLotSummary = await getCashFxLotMovementSummaryByTransaction({
      tenantId,
      cashTransactionId: parsePositiveInt(reversalOutTxn.id),
      runQuery: tx.query,
    });

    return {
      reversalOutTxnId: parsePositiveInt(reversalOutTxn.id),
      reversalInTxnId: parsePositiveInt(reversalInTxn.id),
      reversalRealizedFxBase: roundAmount(reversalOutFxLotSummary?.realizedFxBase || 0),
    };
  });

  return result;
}

function assertExchangeScopeAccess(req, row, assertScopeAccess, label = "exchangeBatchId") {
  assertScopeAccess(req, "legal_entity", row.legal_entity_id, label);
  const sourceOuId = parsePositiveInt(row.source_operating_unit_id);
  if (sourceOuId) {
    assertScopeAccess(req, "operating_unit", sourceOuId, label);
  }
  const targetOuId = parsePositiveInt(row.target_operating_unit_id);
  if (targetOuId && targetOuId !== sourceOuId) {
    assertScopeAccess(req, "operating_unit", targetOuId, label);
  }
}

function assertBatchRequestFingerprint(batchRow, payload) {
  if (!batchRow) {
    return;
  }
  const samePostingMode =
    normalizeExchangePostingMode(batchRow.posting_mode) ===
    normalizeExchangePostingMode(payload.postingMode);
  const sameTargetRegister =
    parsePositiveInt(batchRow.target_cash_register_id) ===
    parsePositiveInt(payload.targetRegisterId);
  const sameClearingAccount =
    parsePositiveInt(batchRow.clearing_account_id) ===
    parsePositiveInt(payload.clearingAccountId);
  const sameFeeAccount =
    parsePositiveInt(batchRow.fee_account_id) === parsePositiveInt(payload.feeAccountId);
  const sameSourceAmount = amountsEqual(batchRow.source_amount_txn, payload.sourceAmountTxn);
  const sameTargetAmount = amountsEqual(batchRow.target_amount_txn, payload.targetAmountTxn);
  const sameFeeAmountTxn = amountsEqual(batchRow.fee_amount_txn, payload.feeAmountTxn || 0);
  const sameFeeAmountBase = amountsEqual(batchRow.fee_amount_base, payload.feeAmountBase || 0);
  const sameSpreadAmountBase = amountsEqual(
    batchRow.spread_amount_base,
    payload.spreadAmountBase || 0
  );
  const sameSpreadReferenceRate = amountsEqual(
    batchRow.spread_reference_rate,
    payload.spreadReferenceRate || 0,
    0.0000000001
  );
  const sameSpreadRateDelta = amountsEqual(
    batchRow.spread_rate_delta,
    payload.spreadRateDelta || 0,
    0.0000000001
  );
  const sameProviderRef = normalizeText(batchRow.provider_ref, 120) === normalizeText(payload.providerRef, 120);
  if (
    !samePostingMode ||
    !sameTargetRegister ||
    !sameClearingAccount ||
    !sameFeeAccount ||
    !sameSourceAmount ||
    !sameTargetAmount ||
    !sameFeeAmountTxn ||
    !sameFeeAmountBase ||
    !sameSpreadAmountBase ||
    !sameSpreadReferenceRate ||
    !sameSpreadRateDelta ||
    !sameProviderRef
  ) {
    throw badRequest("idempotencyKey is already used with a different exchange payload");
  }
}

async function getBatchTransactions(batchRow) {
  if (!batchRow) {
    return {
      exchangeOutTransaction: null,
      exchangeInTransaction: null,
      feeTransaction: null,
      reversalOutTransaction: null,
      reversalInTransaction: null,
      reversalFeeTransaction: null,
    };
  }
  const tenantId = parsePositiveInt(batchRow.tenant_id);
  const outTxnId = parsePositiveInt(batchRow.exchange_out_cash_transaction_id);
  const inTxnId = parsePositiveInt(batchRow.exchange_in_cash_transaction_id);
  const feeTxnId = parsePositiveInt(batchRow.fee_cash_transaction_id);
  const revOutTxnId = parsePositiveInt(batchRow.reversal_out_cash_transaction_id);
  const revInTxnId = parsePositiveInt(batchRow.reversal_in_cash_transaction_id);
  const revFeeTxnId = parsePositiveInt(batchRow.reversal_fee_cash_transaction_id);

  const exchangeOutTransaction = outTxnId
    ? await findCashTransactionById({ tenantId, transactionId: outTxnId })
    : null;
  const exchangeInTransaction = inTxnId
    ? await findCashTransactionById({ tenantId, transactionId: inTxnId })
    : null;
  const feeTransaction = feeTxnId
    ? await findCashTransactionById({ tenantId, transactionId: feeTxnId })
    : null;
  const reversalOutTransaction = revOutTxnId
    ? await findCashTransactionById({ tenantId, transactionId: revOutTxnId })
    : null;
  const reversalInTransaction = revInTxnId
    ? await findCashTransactionById({ tenantId, transactionId: revInTxnId })
    : null;
  const reversalFeeTransaction = revFeeTxnId
    ? await findCashTransactionById({ tenantId, transactionId: revFeeTxnId })
    : null;

  return {
    exchangeOutTransaction,
    exchangeInTransaction,
    feeTransaction,
    reversalOutTransaction,
    reversalInTransaction,
    reversalFeeTransaction,
  };
}

async function buildExchangeBatchFxLotSummary(tenantId, transactions) {
  const tenant = parsePositiveInt(tenantId);
  const outTxnId = parsePositiveInt(transactions?.exchangeOutTransaction?.id);
  const inTxnId = parsePositiveInt(transactions?.exchangeInTransaction?.id);
  const feeTxnId = parsePositiveInt(transactions?.feeTransaction?.id);
  const reversalOutTxnId = parsePositiveInt(transactions?.reversalOutTransaction?.id);
  const reversalInTxnId = parsePositiveInt(transactions?.reversalInTransaction?.id);
  const reversalFeeTxnId = parsePositiveInt(transactions?.reversalFeeTransaction?.id);

  const readSummary = async (transactionId) => {
    if (!transactionId) return null;
    const summary = await getCashFxLotMovementSummaryByTransaction({
      tenantId: tenant,
      cashTransactionId: transactionId,
    });
    if (!summary || Number(summary.movementCount || 0) <= 0) {
      return null;
    }
    return summary;
  };

  return {
    exchangeOut: await readSummary(outTxnId),
    exchangeIn: await readSummary(inTxnId),
    fee: await readSummary(feeTxnId),
    reversalOut: await readSummary(reversalOutTxnId),
    reversalIn: await readSummary(reversalInTxnId),
    reversalFee: await readSummary(reversalFeeTxnId),
  };
}

export async function resolveCashExchangeScope(exchangeBatchId, tenantId) {
  const result = await query(
    `SELECT id, legal_entity_id
     FROM cash_exchange_batches
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, exchangeBatchId]
  );
  const row = result.rows?.[0] || null;
  if (!row) {
    return null;
  }
  return {
    scopeType: "LEGAL_ENTITY",
    scopeId: parsePositiveInt(row.legal_entity_id),
  };
}

export async function getCashExchangeBatchByIdForTenant({
  req,
  tenantId,
  exchangeBatchId,
  assertScopeAccess,
}) {
  const row = await findExchangeBatchById({
    tenantId,
    exchangeBatchId,
  });
  if (!row) {
    throw badRequest("Cash exchange batch not found");
  }
  assertExchangeScopeAccess(req, row, assertScopeAccess, "exchangeBatchId");
  const transactions = await getBatchTransactions(row);
  return {
    batch: mapExchangeBatchRow(row),
    ...transactions,
  };
}

export async function listCashExchangeBatchRows({
  req,
  tenantId,
  filters,
  buildScopeFilter,
  assertScopeAccess,
}) {
  const pagination = resolveOffsetPagination(filters, {
    defaultLimit: filters.limit || 50,
    defaultOffset: filters.offset || 0,
    maxLimit: 200,
  });

  const where = ["ceb.tenant_id = ?"];
  const params = [tenantId];

  if (filters.legalEntityId) {
    where.push("ceb.legal_entity_id = ?");
    params.push(filters.legalEntityId);
  }
  if (filters.sourceRegisterId) {
    where.push("ceb.source_cash_register_id = ?");
    params.push(filters.sourceRegisterId);
  }
  if (filters.targetRegisterId) {
    where.push("ceb.target_cash_register_id = ?");
    params.push(filters.targetRegisterId);
  }
  if (filters.status) {
    where.push("ceb.status = ?");
    params.push(filters.status);
  }
  if (filters.createdDateFrom) {
    where.push("DATE(ceb.created_at) >= ?");
    params.push(filters.createdDateFrom);
  }
  if (filters.createdDateTo) {
    where.push("DATE(ceb.created_at) <= ?");
    params.push(filters.createdDateTo);
  }

  const scopeSql = buildScopeFilter(req, "legal_entity", "ceb.legal_entity_id", params);
  if (scopeSql !== "1 = 1") {
    where.push(scopeSql);
  }
  const whereSql = where.join(" AND ");

  const countResult = await query(
    `SELECT COUNT(*) AS total
     FROM cash_exchange_batches ceb
     WHERE ${whereSql}`,
    params
  );
  const total = Number(countResult.rows?.[0]?.total || 0);

  const result = await query(
    `${EXCHANGE_BASE_SELECT}
     WHERE ${whereSql}
     ORDER BY ceb.id DESC
     LIMIT ${pagination.limit}
     OFFSET ${pagination.offset}`,
    params
  );
  const rows = result.rows || [];
  const mapped = [];
  for (const row of rows) {
    assertExchangeScopeAccess(req, row, assertScopeAccess, "exchangeBatchId");
    mapped.push(mapExchangeBatchRow(row));
  }

  return buildOffsetPaginationResult({
    rows: mapped,
    total,
    limit: pagination.limit,
    offset: pagination.offset,
  });
}

export async function createCashExchangeBatch({
  req,
  payload,
  assertScopeAccess,
}) {
  const postingMode = normalizeExchangePostingMode(payload.postingMode);
  const sourceAmountTxn = normalizePositiveAmount(payload.sourceAmountTxn, "sourceAmountTxn");
  const targetAmountTxn = normalizePositiveAmount(payload.targetAmountTxn, "targetAmountTxn");
  const feeAmountTxn = normalizeOptionalPositiveAmount(payload.feeAmountTxn, "feeAmountTxn");
  const feeAmountBaseInput = normalizeOptionalPositiveAmount(
    payload.feeAmountBase,
    "feeAmountBase"
  );
  const spreadReferenceRate = normalizeOptionalPositiveRate(
    payload.spreadReferenceRate,
    "spreadReferenceRate"
  );
  const spreadRateDelta = normalizeOptionalDecimal(payload.spreadRateDelta, "spreadRateDelta", 10);
  const spreadAmountBase = normalizeOptionalPositiveAmount(
    payload.spreadAmountBase,
    "spreadAmountBase"
  );
  const providerRef = normalizeText(payload.providerRef, 120);
  const bookDate = normalizeDate(payload.bookDate, "bookDate");
  const txnDatetime = normalizeText(payload.txnDatetime, 19) || `${bookDate} 00:00:00`;
  const integrationEventUid =
    normalizeText(payload.integrationEventUid, 100) ||
    buildDerivedKey("CASH_EXCHANGE_EVENT", `${payload.sourceRegisterId}:${payload.idempotencyKey}`);
  const requestedFxRate = normalizeOptionalPositiveRate(payload.fxRate, "fxRate");
  const effectiveFxRate = requestedFxRate || Number((targetAmountTxn / sourceAmountTxn).toFixed(10));
  const effectiveFxRateSource = normalizeText(payload.fxRateSource, 40) || "EXCHANGE_EXECUTED";
  const effectiveFxRateDate = payload.fxRateDate
    ? normalizeDate(payload.fxRateDate, "fxRateDate")
    : bookDate;

  const sourceRegister = await findCashRegisterById({
    tenantId: payload.tenantId,
    registerId: payload.sourceRegisterId,
  });
  if (!sourceRegister) {
    throw badRequest("sourceRegisterId not found for tenant");
  }
  const targetRegister = await findCashRegisterById({
    tenantId: payload.tenantId,
    registerId: payload.targetRegisterId,
  });
  if (!targetRegister) {
    throw badRequest("targetRegisterId not found for tenant");
  }
  await assertRegisterOperationalConfig(sourceRegister, {
    requireActive: true,
    requireCashControlledAccount: true,
  });
  await assertRegisterOperationalConfig(targetRegister, {
    requireActive: true,
    requireCashControlledAccount: true,
  });

  assertScopeAccess(req, "legal_entity", sourceRegister.legal_entity_id, "sourceRegisterId");
  if (sourceRegister.operating_unit_id) {
    assertScopeAccess(req, "operating_unit", sourceRegister.operating_unit_id, "sourceRegisterId");
  }
  assertScopeAccess(req, "legal_entity", targetRegister.legal_entity_id, "targetRegisterId");
  if (
    targetRegister.operating_unit_id &&
    parsePositiveInt(targetRegister.operating_unit_id) !==
      parsePositiveInt(sourceRegister.operating_unit_id)
  ) {
    assertScopeAccess(req, "operating_unit", targetRegister.operating_unit_id, "targetRegisterId");
  }

  if (parsePositiveInt(sourceRegister.id) === parsePositiveInt(targetRegister.id)) {
    throw badRequest("sourceRegisterId and targetRegisterId must be different");
  }
  if (
    parsePositiveInt(sourceRegister.legal_entity_id) !==
    parsePositiveInt(targetRegister.legal_entity_id)
  ) {
    throw badRequest("source and target registers must belong to the same legal entity");
  }

  const legalEntityId = parsePositiveInt(sourceRegister.legal_entity_id);

  const sourceCurrency = normalizeCurrency(sourceRegister.currency_code);
  const targetCurrency = normalizeCurrency(targetRegister.currency_code);
  if (!sourceCurrency || sourceCurrency.length !== 3) {
    throw badRequest("source register currency is invalid");
  }
  if (!targetCurrency || targetCurrency.length !== 3) {
    throw badRequest("target register currency is invalid");
  }
  if (sourceCurrency === targetCurrency) {
    throw badRequest(
      "Source and target register currencies are the same; use cash transit transfer for same-currency movement"
    );
  }
  if (
    postingMode === EXCHANGE_POSTING_MODE_DIRECT &&
    parsePositiveInt(payload.clearingAccountId)
  ) {
    throw badRequest("clearingAccountId must be empty when postingMode is DIRECT");
  }

  const resolvedClearingAccountId =
    postingMode === EXCHANGE_POSTING_MODE_CLEARING
      ? await resolveCashPurposeAccountId({
          tenantId: payload.tenantId,
          legalEntityId,
          purposeCode: CASH_PURPOSE_CODES.EXCHANGE_CLEARING,
          providedAccountId: payload.clearingAccountId,
          fieldLabel: "clearingAccountId",
        })
      : null;
  const effectivePayload = {
    ...payload,
    postingMode,
    clearingAccountId: resolvedClearingAccountId,
  };
  const hasExplicitClearingAccount =
    postingMode === EXCHANGE_POSTING_MODE_CLEARING &&
    Boolean(parsePositiveInt(payload.clearingAccountId));

  if (postingMode === EXCHANGE_POSTING_MODE_CLEARING) {
    await assertAccountBelongsToTenant(
      effectivePayload.tenantId,
      effectivePayload.clearingAccountId,
      "clearingAccountId"
    );
  }
  if (feeAmountTxn && !parsePositiveInt(payload.feeAccountId)) {
    throw badRequest("feeAccountId is required when feeAmountTxn is provided");
  }
  if (!feeAmountTxn && parsePositiveInt(payload.feeAccountId)) {
    throw badRequest("feeAmountTxn is required when feeAccountId is provided");
  }
  if (!feeAmountTxn && feeAmountBaseInput) {
    throw badRequest("feeAmountTxn is required when feeAmountBase is provided");
  }
  if (parsePositiveInt(payload.feeAccountId)) {
    await assertAccountBelongsToTenant(payload.tenantId, payload.feeAccountId, "feeAccountId");
  }

  const replayByIdempotency = await findExchangeBatchByIdempotency({
    tenantId: effectivePayload.tenantId,
    sourceRegisterId: effectivePayload.sourceRegisterId,
    idempotencyKey: effectivePayload.idempotencyKey,
  });
  if (replayByIdempotency) {
    const replayPostingMode = normalizeExchangePostingMode(replayByIdempotency.posting_mode);
    const replayFingerprintPayload =
      replayPostingMode === EXCHANGE_POSTING_MODE_CLEARING &&
      !hasExplicitClearingAccount &&
      parsePositiveInt(replayByIdempotency.clearing_account_id)
        ? {
            ...effectivePayload,
            clearingAccountId: parsePositiveInt(replayByIdempotency.clearing_account_id),
          }
        : effectivePayload;
    assertBatchRequestFingerprint(replayByIdempotency, replayFingerprintPayload);
    assertExchangeScopeAccess(req, replayByIdempotency, assertScopeAccess, "sourceRegisterId");
    if (
      asUpper(replayByIdempotency.status) === EXCHANGE_STATUS_POSTED ||
      asUpper(replayByIdempotency.status) === EXCHANGE_STATUS_REVERSED
    ) {
      const replayTransactions = await getBatchTransactions(replayByIdempotency);
      return {
        batch: mapExchangeBatchRow(replayByIdempotency),
        ...replayTransactions,
        fxLot: await buildExchangeBatchFxLotSummary(effectivePayload.tenantId, replayTransactions),
        idempotentReplay: true,
      };
    }
  }

  const replayByEvent = await findExchangeBatchByIntegrationEventUid({
    tenantId: effectivePayload.tenantId,
    integrationEventUid,
  });
  if (replayByEvent) {
    const replayPostingMode = normalizeExchangePostingMode(replayByEvent.posting_mode);
    const replayFingerprintPayload =
      replayPostingMode === EXCHANGE_POSTING_MODE_CLEARING &&
      !hasExplicitClearingAccount &&
      parsePositiveInt(replayByEvent.clearing_account_id)
        ? {
            ...effectivePayload,
            clearingAccountId: parsePositiveInt(replayByEvent.clearing_account_id),
          }
        : effectivePayload;
    assertBatchRequestFingerprint(replayByEvent, replayFingerprintPayload);
    assertExchangeScopeAccess(req, replayByEvent, assertScopeAccess, "sourceRegisterId");
    if (
      asUpper(replayByEvent.status) === EXCHANGE_STATUS_POSTED ||
      asUpper(replayByEvent.status) === EXCHANGE_STATUS_REVERSED
    ) {
      const replayTransactions = await getBatchTransactions(replayByEvent);
      return {
        batch: mapExchangeBatchRow(replayByEvent),
        ...replayTransactions,
        fxLot: await buildExchangeBatchFxLotSummary(effectivePayload.tenantId, replayTransactions),
        idempotentReplay: true,
      };
    }
  }

  const draftBatch = await withTransaction(async (tx) => {
    const existing = await findExchangeBatchByIdempotency({
      tenantId: effectivePayload.tenantId,
      sourceRegisterId: effectivePayload.sourceRegisterId,
      idempotencyKey: effectivePayload.idempotencyKey,
      runQuery: tx.query,
      forUpdate: true,
    });
    if (existing) {
      return existing;
    }

    const insertResult = await tx.query(
      `INSERT INTO cash_exchange_batches (
         tenant_id,
         legal_entity_id,
         source_cash_register_id,
         target_cash_register_id,
         source_currency_code,
         target_currency_code,
         source_amount_txn,
         target_amount_txn,
         fee_amount_txn,
         fee_amount_base,
         clearing_account_id,
         posting_mode,
         fee_account_id,
         fx_rate,
         fx_rate_source,
         fx_rate_date,
         provider_ref,
         spread_reference_rate,
         spread_rate_delta,
         spread_amount_base,
         status,
         idempotency_key,
         integration_event_uid,
         source_module,
         source_entity_type,
         note,
         created_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CASH', 'cash_exchange_batch', ?, ?)`,
      [
        effectivePayload.tenantId,
        sourceRegister.legal_entity_id,
        effectivePayload.sourceRegisterId,
        effectivePayload.targetRegisterId,
        sourceCurrency,
        targetCurrency,
        sourceAmountTxn,
        targetAmountTxn,
        feeAmountTxn,
        feeAmountBaseInput,
        effectivePayload.clearingAccountId,
        effectivePayload.postingMode,
        parsePositiveInt(effectivePayload.feeAccountId) || null,
        effectiveFxRate,
        effectiveFxRateSource,
        effectiveFxRateDate,
        providerRef,
        spreadReferenceRate,
        spreadRateDelta,
        spreadAmountBase,
        EXCHANGE_STATUS_DRAFT,
        effectivePayload.idempotencyKey,
        integrationEventUid,
        effectivePayload.note || null,
        effectivePayload.userId,
      ]
    );
    const exchangeBatchId = parsePositiveInt(insertResult.rows?.insertId);
    if (!exchangeBatchId) {
      throw badRequest("Failed to create cash exchange batch");
    }
    const inserted = await findExchangeBatchById({
      tenantId: effectivePayload.tenantId,
      exchangeBatchId,
      runQuery: tx.query,
      forUpdate: true,
    });
    if (!inserted) {
      throw badRequest("Failed to load created cash exchange batch");
    }
    return inserted;
  });

  const exchangeBatchId = parsePositiveInt(draftBatch.id);
  if (!exchangeBatchId) {
    throw badRequest("Cash exchange batch id is invalid");
  }

  if (postingMode === EXCHANGE_POSTING_MODE_DIRECT) {
    return postDirectExchangeBatch({
      req,
      assertScopeAccess,
      exchangeBatchId,
      tenantId: effectivePayload.tenantId,
      userId: effectivePayload.userId,
      legalEntityId,
      sourceRegister,
      targetRegister,
      sourceCashSessionId: effectivePayload.sourceCashSessionId,
      targetCashSessionId: effectivePayload.targetCashSessionId,
      txnDatetime,
      bookDate,
      sourceAmountTxn,
      targetAmountTxn,
      feeAmountTxn,
      feeAmountBaseInput,
      feeAccountId: parsePositiveInt(effectivePayload.feeAccountId) || null,
      effectiveFxRate,
      effectiveFxRateSource,
      effectiveFxRateDate,
      providerRef,
      spreadReferenceRate,
      spreadRateDelta,
      spreadAmountBase,
      description: effectivePayload.description || null,
      referenceNo: effectivePayload.referenceNo || null,
    });
  }

  const outTxnCreate = await createCashTransaction({
    req,
    payload: {
      tenantId: effectivePayload.tenantId,
      userId: effectivePayload.userId,
      registerId: effectivePayload.sourceRegisterId,
      cashSessionId: effectivePayload.sourceCashSessionId,
      txnType: "PAYOUT",
      txnDatetime,
      bookDate,
      amount: sourceAmountTxn,
      currencyCode: sourceCurrency,
      amountBase: null,
      fxRate: null,
      fxRateSource: null,
      fxRateDate: null,
      fxFallbackMode: null,
      fxFallbackMaxDays: null,
      description:
        effectivePayload.description ||
        `Cash exchange out to ${targetRegister.code || targetRegister.id}`,
      referenceNo: effectivePayload.referenceNo || `EXCH-${exchangeBatchId}`,
      sourceDocType: null,
      sourceDocId: null,
      counterpartyType: null,
      counterpartyId: null,
      counterAccountId: effectivePayload.clearingAccountId,
      counterCashRegisterId: null,
      linkedCariSettlementBatchId: null,
      linkedCariUnappliedCashId: null,
      sourceModule: "CASH",
      sourceEntityType: "cash_exchange_batch",
      sourceEntityId: String(exchangeBatchId),
      integrationLinkStatus: "LINKED",
      integrationEventUid: buildDerivedKey("CASH_EXCHANGE_OUT_EVENT", exchangeBatchId),
      idempotencyKey: buildDerivedKey("CASH_EXCHANGE_OUT", exchangeBatchId),
    },
    assertScopeAccess,
  });
  const outTxnId = parsePositiveInt(outTxnCreate.row?.id);
  if (!outTxnId) {
    throw badRequest("Failed to create exchange out transaction");
  }

  const sourceAmountBase = normalizePositiveAmount(outTxnCreate.row.amount_base, "sourceAmountBase");
  const baseCurrencyCode = await resolveBaseCurrencyCodeForLegalEntity({
    tenantId: effectivePayload.tenantId,
    legalEntityId: parsePositiveInt(sourceRegister.legal_entity_id),
  });

  let inAmountBase = null;
  let inFxRate = null;
  let inFxRateSource = null;
  let inFxRateDate = null;
  if (targetCurrency === baseCurrencyCode) {
    if (!amountsEqual(targetAmountTxn, sourceAmountBase)) {
      throw badRequest(
        "targetAmountTxn must equal source amount_base when target register currency is book base currency"
      );
    }
  } else {
    inAmountBase = sourceAmountBase;
    inFxRate = Number((sourceAmountBase / targetAmountTxn).toFixed(10));
    inFxRateSource = "EXCHANGE_DERIVED";
    inFxRateDate = bookDate;
  }

  const inTxnCreate = await createCashTransaction({
    req,
    payload: {
      tenantId: effectivePayload.tenantId,
      userId: effectivePayload.userId,
      registerId: effectivePayload.targetRegisterId,
      cashSessionId: effectivePayload.targetCashSessionId,
      txnType: "RECEIPT",
      txnDatetime,
      bookDate,
      amount: targetAmountTxn,
      currencyCode: targetCurrency,
      amountBase: inAmountBase,
      fxRate: inFxRate,
      fxRateSource: inFxRateSource,
      fxRateDate: inFxRateDate,
      fxFallbackMode: null,
      fxFallbackMaxDays: null,
      description:
        effectivePayload.description ||
        `Cash exchange in from ${sourceRegister.code || sourceRegister.id}`,
      referenceNo: effectivePayload.referenceNo || `EXCH-${exchangeBatchId}`,
      sourceDocType: null,
      sourceDocId: null,
      counterpartyType: null,
      counterpartyId: null,
      counterAccountId: effectivePayload.clearingAccountId,
      counterCashRegisterId: null,
      linkedCariSettlementBatchId: null,
      linkedCariUnappliedCashId: null,
      sourceModule: "CASH",
      sourceEntityType: "cash_exchange_batch",
      sourceEntityId: String(exchangeBatchId),
      integrationLinkStatus: "LINKED",
      integrationEventUid: buildDerivedKey("CASH_EXCHANGE_IN_EVENT", exchangeBatchId),
      idempotencyKey: buildDerivedKey("CASH_EXCHANGE_IN", exchangeBatchId),
    },
    assertScopeAccess,
  });
  const inTxnId = parsePositiveInt(inTxnCreate.row?.id);
  if (!inTxnId) {
    throw badRequest("Failed to create exchange in transaction");
  }

  const postOut = await postCashTransactionById({
    req,
    payload: {
      tenantId: effectivePayload.tenantId,
      userId: effectivePayload.userId,
      transactionId: outTxnId,
      overrideCashControl: false,
      overrideReason: null,
    },
    assertScopeAccess,
  });
  const postIn = await postCashTransactionById({
    req,
    payload: {
      tenantId: effectivePayload.tenantId,
      userId: effectivePayload.userId,
      transactionId: inTxnId,
      overrideCashControl: false,
      overrideReason: null,
    },
    assertScopeAccess,
  });

  const outAmountBase = normalizePositiveAmount(
    postOut.row.amount_base,
    "exchangeOut.posted.amountBase"
  );
  const inAmountBasePosted = normalizePositiveAmount(
    postIn.row.amount_base,
    "exchangeIn.posted.amountBase"
  );
  const exchangeOutFxLotSummary = await getCashFxLotMovementSummaryByTransaction({
    tenantId: effectivePayload.tenantId,
    cashTransactionId: outTxnId,
  });
  const realizedFxBase = roundAmount(exchangeOutFxLotSummary?.realizedFxBase || 0);

  let feeTxnId = null;
  let feeAmountBasePosted = null;
  if (feeAmountTxn) {
    let feeAmountBase = feeAmountBaseInput;
    let feeFxRate = null;
    let feeFxRateSource = null;
    let feeFxRateDate = null;

    if (targetCurrency === baseCurrencyCode) {
      if (feeAmountBase !== null && !amountsEqual(feeAmountBase, feeAmountTxn)) {
        throw badRequest(
          "feeAmountBase must equal feeAmountTxn when target register currency is book base currency"
        );
      }
    } else {
      if (feeAmountBase === null) {
        if (!(inFxRate > 0)) {
          throw badRequest(
            "feeAmountBase or derived exchange rate is required for foreign-currency fee posting"
          );
        }
        feeAmountBase = roundAmount(feeAmountTxn * inFxRate);
      }
      feeFxRate = Number((feeAmountBase / feeAmountTxn).toFixed(10));
      feeFxRateSource = "EXCHANGE_FEE_EXECUTED";
      feeFxRateDate = bookDate;
    }

    const feeCreate = await createCashTransaction({
      req,
      payload: {
        tenantId: effectivePayload.tenantId,
        userId: effectivePayload.userId,
        registerId: effectivePayload.targetRegisterId,
        cashSessionId: effectivePayload.targetCashSessionId,
        txnType: "PAYOUT",
        txnDatetime,
        bookDate,
        amount: feeAmountTxn,
        currencyCode: targetCurrency,
        amountBase: feeAmountBase,
        fxRate: feeFxRate,
        fxRateSource: feeFxRateSource,
        fxRateDate: feeFxRateDate,
        fxFallbackMode: null,
        fxFallbackMaxDays: null,
        description:
          effectivePayload.description ||
          `Cash exchange fee (${providerRef || targetRegister.code || targetRegister.id})`,
        referenceNo: effectivePayload.referenceNo || `EXCH-${exchangeBatchId}`,
        sourceDocType: null,
        sourceDocId: null,
        counterpartyType: null,
        counterpartyId: null,
        counterAccountId: parsePositiveInt(effectivePayload.feeAccountId),
        counterCashRegisterId: null,
        linkedCariSettlementBatchId: null,
        linkedCariUnappliedCashId: null,
        sourceModule: "CASH",
        sourceEntityType: "cash_exchange_batch",
        sourceEntityId: String(exchangeBatchId),
        integrationLinkStatus: "LINKED",
        integrationEventUid: buildDerivedKey("CASH_EXCHANGE_FEE_EVENT", exchangeBatchId),
        idempotencyKey: buildDerivedKey("CASH_EXCHANGE_FEE", exchangeBatchId),
      },
      assertScopeAccess,
    });
    feeTxnId = parsePositiveInt(feeCreate.row?.id);
    if (!feeTxnId) {
      throw badRequest("Failed to create exchange fee transaction");
    }

    const postFee = await postCashTransactionById({
      req,
      payload: {
        tenantId: effectivePayload.tenantId,
        userId: effectivePayload.userId,
        transactionId: feeTxnId,
        overrideCashControl: false,
        overrideReason: null,
      },
      assertScopeAccess,
    });
    feeAmountBasePosted = normalizePositiveAmount(
      postFee.row.amount_base,
      "exchangeFee.posted.amountBase"
    );
  }

  await withTransaction(async (tx) => {
    await tx.query(
      `UPDATE cash_exchange_batches
       SET
         source_amount_base = ?,
         target_amount_base = ?,
         realized_fx_base = ?,
         fee_amount_txn = ?,
         fee_amount_base = ?,
         exchange_out_cash_transaction_id = ?,
         exchange_in_cash_transaction_id = ?,
         fee_cash_transaction_id = ?,
         status = ?,
         posted_by_user_id = ?,
         posted_at = UTC_TIMESTAMP(),
         fx_rate = ?,
         fx_rate_source = ?,
         fx_rate_date = ?,
         provider_ref = ?,
         spread_reference_rate = ?,
         spread_rate_delta = ?,
         spread_amount_base = ?
       WHERE tenant_id = ?
         AND id = ?`,
      [
        outAmountBase,
        inAmountBasePosted,
        realizedFxBase,
        feeAmountTxn,
        feeAmountBasePosted,
        outTxnId,
        inTxnId,
        feeTxnId,
        EXCHANGE_STATUS_POSTED,
        effectivePayload.userId,
        effectiveFxRate,
        effectiveFxRateSource,
        effectiveFxRateDate,
        providerRef,
        spreadReferenceRate,
        spreadRateDelta,
        spreadAmountBase,
        effectivePayload.tenantId,
        exchangeBatchId,
      ]
    );
  });

  const saved = await findExchangeBatchById({
    tenantId: effectivePayload.tenantId,
    exchangeBatchId,
  });
  if (!saved) {
    throw badRequest("Cash exchange batch not found after posting");
  }
  const transactions = await getBatchTransactions(saved);
  return {
    batch: mapExchangeBatchRow(saved),
    ...transactions,
    fxLot: await buildExchangeBatchFxLotSummary(effectivePayload.tenantId, transactions),
    idempotentReplay: false,
  };
}

export async function postCashExchangeBatchById({
  req,
  payload,
  assertScopeAccess,
}) {
  const batch = await findExchangeBatchById({
    tenantId: payload.tenantId,
    exchangeBatchId: payload.exchangeBatchId,
  });
  if (!batch) {
    throw badRequest("Cash exchange batch not found");
  }
  assertExchangeScopeAccess(req, batch, assertScopeAccess, "exchangeBatchId");

  const status = asUpper(batch.status);
  if (status === EXCHANGE_STATUS_POSTED || status === EXCHANGE_STATUS_REVERSED) {
    const transactions = await getBatchTransactions(batch);
    return {
      batch: mapExchangeBatchRow(batch),
      ...transactions,
      fxLot: await buildExchangeBatchFxLotSummary(payload.tenantId, transactions),
      idempotentReplay: true,
    };
  }
  if (status !== EXCHANGE_STATUS_DRAFT) {
    throw badRequest("Only DRAFT cash exchange batches can be posted");
  }

  const sourceRegisterId = parsePositiveInt(batch.source_cash_register_id);
  const targetRegisterId = parsePositiveInt(batch.target_cash_register_id);
  const postingMode = normalizeExchangePostingMode(batch.posting_mode);
  const clearingAccountId = parsePositiveInt(batch.clearing_account_id);
  const idempotencyKey = normalizeText(batch.idempotency_key, 100);
  if (!sourceRegisterId || !targetRegisterId || !idempotencyKey) {
    throw badRequest("Draft cash exchange batch is missing required metadata");
  }
  if (postingMode === EXCHANGE_POSTING_MODE_CLEARING && !clearingAccountId) {
    throw badRequest("Draft cash exchange batch is missing required metadata");
  }

  const existingTransactions = await getBatchTransactions(batch);
  const sourceExistingSessionId = parsePositiveInt(
    existingTransactions.exchangeOutTransaction?.cash_session_id
  );
  const targetExistingSessionId = parsePositiveInt(
    existingTransactions.exchangeInTransaction?.cash_session_id
  );
  const sourceCashSessionId =
    parsePositiveInt(payload.sourceCashSessionId) || sourceExistingSessionId || null;
  const targetCashSessionId =
    parsePositiveInt(payload.targetCashSessionId) || targetExistingSessionId || null;

  const defaultBookDateFromOut = toDateOnly(existingTransactions.exchangeOutTransaction?.book_date);
  const defaultBookDateFromBatch = toDateOnly(batch.created_at);
  const bookDate =
    payload.bookDate ||
    defaultBookDateFromOut ||
    defaultBookDateFromBatch ||
    new Date().toISOString().slice(0, 10);

  const defaultTxnDatetimeFromOut = toDateTimeSql(
    existingTransactions.exchangeOutTransaction?.txn_datetime
  );
  const defaultTxnDatetimeFromBatch = toDateTimeSql(batch.created_at);
  const txnDatetime =
    payload.txnDatetime ||
    defaultTxnDatetimeFromOut ||
    defaultTxnDatetimeFromBatch ||
    `${bookDate} 00:00:00`;

  const replayPayload = {
    tenantId: payload.tenantId,
    userId: payload.userId,
    postingMode,
    sourceRegisterId,
    targetRegisterId,
    sourceCashSessionId,
    targetCashSessionId,
    clearingAccountId,
    txnDatetime,
    bookDate,
    sourceAmountTxn: Number(batch.source_amount_txn),
    targetAmountTxn: Number(batch.target_amount_txn),
    feeAmountTxn:
      batch.fee_amount_txn === null || batch.fee_amount_txn === undefined
        ? null
        : Number(batch.fee_amount_txn),
    feeAmountBase:
      batch.fee_amount_base === null || batch.fee_amount_base === undefined
        ? null
        : Number(batch.fee_amount_base),
    feeAccountId: parsePositiveInt(batch.fee_account_id) || null,
    fxRate:
      batch.fx_rate === null || batch.fx_rate === undefined
        ? null
        : Number(batch.fx_rate),
    fxRateSource: normalizeText(batch.fx_rate_source, 40),
    fxRateDate: toDateOnly(batch.fx_rate_date),
    providerRef: normalizeText(batch.provider_ref, 120),
    spreadReferenceRate:
      batch.spread_reference_rate === null || batch.spread_reference_rate === undefined
        ? null
        : Number(batch.spread_reference_rate),
    spreadRateDelta:
      batch.spread_rate_delta === null || batch.spread_rate_delta === undefined
        ? null
        : Number(batch.spread_rate_delta),
    spreadAmountBase:
      batch.spread_amount_base === null || batch.spread_amount_base === undefined
        ? null
        : Number(batch.spread_amount_base),
    description: normalizeText(existingTransactions.exchangeOutTransaction?.description, 500),
    referenceNo: normalizeText(existingTransactions.exchangeOutTransaction?.reference_no, 100),
    note: normalizeText(batch.note, 500),
    integrationEventUid: normalizeText(batch.integration_event_uid, 100),
    idempotencyKey,
  };

  if (postingMode === EXCHANGE_POSTING_MODE_DIRECT) {
    const sourceRegister = await findCashRegisterById({
      tenantId: payload.tenantId,
      registerId: sourceRegisterId,
    });
    const targetRegister = await findCashRegisterById({
      tenantId: payload.tenantId,
      registerId: targetRegisterId,
    });
    if (!sourceRegister || !targetRegister) {
      throw badRequest("Draft cash exchange batch references missing registers");
    }

    return postDirectExchangeBatch({
      req,
      assertScopeAccess,
      exchangeBatchId: payload.exchangeBatchId,
      tenantId: payload.tenantId,
      userId: payload.userId,
      legalEntityId: parsePositiveInt(batch.legal_entity_id),
      sourceRegister,
      targetRegister,
      sourceCashSessionId,
      targetCashSessionId,
      txnDatetime,
      bookDate,
      sourceAmountTxn: Number(batch.source_amount_txn),
      targetAmountTxn: Number(batch.target_amount_txn),
      feeAmountTxn:
        batch.fee_amount_txn === null || batch.fee_amount_txn === undefined
          ? null
          : Number(batch.fee_amount_txn),
      feeAmountBaseInput:
        batch.fee_amount_base === null || batch.fee_amount_base === undefined
          ? null
          : Number(batch.fee_amount_base),
      feeAccountId: parsePositiveInt(batch.fee_account_id) || null,
      effectiveFxRate:
        batch.fx_rate === null || batch.fx_rate === undefined ? null : Number(batch.fx_rate),
      effectiveFxRateSource: normalizeText(batch.fx_rate_source, 40),
      effectiveFxRateDate: toDateOnly(batch.fx_rate_date),
      providerRef: normalizeText(batch.provider_ref, 120),
      spreadReferenceRate:
        batch.spread_reference_rate === null || batch.spread_reference_rate === undefined
          ? null
          : Number(batch.spread_reference_rate),
      spreadRateDelta:
        batch.spread_rate_delta === null || batch.spread_rate_delta === undefined
          ? null
          : Number(batch.spread_rate_delta),
      spreadAmountBase:
        batch.spread_amount_base === null || batch.spread_amount_base === undefined
          ? null
          : Number(batch.spread_amount_base),
      description: normalizeText(existingTransactions.exchangeOutTransaction?.description, 500),
      referenceNo: normalizeText(existingTransactions.exchangeOutTransaction?.reference_no, 100),
    });
  }

  return createCashExchangeBatch({
    req,
    payload: replayPayload,
    assertScopeAccess,
  });
}

export async function reverseCashExchangeBatchById({
  req,
  payload,
  assertScopeAccess,
}) {
  const batch = await findExchangeBatchById({
    tenantId: payload.tenantId,
    exchangeBatchId: payload.exchangeBatchId,
  });
  if (!batch) {
    throw badRequest("Cash exchange batch not found");
  }
  assertExchangeScopeAccess(req, batch, assertScopeAccess, "exchangeBatchId");

  if (asUpper(batch.status) === EXCHANGE_STATUS_REVERSED) {
    const transactions = await getBatchTransactions(batch);
    return {
      batch: mapExchangeBatchRow(batch),
      ...transactions,
      fxLot: await buildExchangeBatchFxLotSummary(payload.tenantId, transactions),
      idempotentReplay: true,
    };
  }
  if (asUpper(batch.status) !== EXCHANGE_STATUS_POSTED) {
    throw badRequest("Only POSTED cash exchange batches can be reversed");
  }

  const outTxnId = parsePositiveInt(batch.exchange_out_cash_transaction_id);
  const inTxnId = parsePositiveInt(batch.exchange_in_cash_transaction_id);
  const feeTxnId = parsePositiveInt(batch.fee_cash_transaction_id);
  if (!outTxnId || !inTxnId) {
    throw badRequest("Cash exchange batch is missing linked posted transactions");
  }

  const postingMode = normalizeExchangePostingMode(batch.posting_mode);
  if (postingMode === EXCHANGE_POSTING_MODE_DIRECT) {
    const directReverse = await reverseDirectExchangeBatch({
      req,
      tenantId: payload.tenantId,
      userId: payload.userId,
      exchangeBatchId: payload.exchangeBatchId,
      legalEntityId: parsePositiveInt(batch.legal_entity_id),
      outTxnId,
      inTxnId,
      reverseReason: payload.reverseReason,
    });

    let feeReverse = null;
    if (feeTxnId) {
      feeReverse = await reverseCashTransactionById({
        req,
        payload: {
          tenantId: payload.tenantId,
          userId: payload.userId,
          transactionId: feeTxnId,
          reverseReason: payload.reverseReason,
        },
        assertScopeAccess,
      });
    }

    const reversalFeeTxnId = parsePositiveInt(feeReverse?.reversal?.id);
    if (feeTxnId && !reversalFeeTxnId) {
      throw badRequest("Failed to create exchange fee reversal transaction");
    }

    await withTransaction(async (tx) => {
      await tx.query(
        `UPDATE cash_exchange_batches
         SET
           status = ?,
           reversal_out_cash_transaction_id = ?,
           reversal_in_cash_transaction_id = ?,
           reversal_fee_cash_transaction_id = ?,
           reversal_realized_fx_base = ?,
           reversed_by_user_id = ?,
           reversed_at = UTC_TIMESTAMP(),
           reverse_reason = ?
         WHERE tenant_id = ?
           AND id = ?`,
        [
          EXCHANGE_STATUS_REVERSED,
          directReverse.reversalOutTxnId,
          directReverse.reversalInTxnId,
          reversalFeeTxnId,
          directReverse.reversalRealizedFxBase,
          payload.userId,
          payload.reverseReason,
          payload.tenantId,
          payload.exchangeBatchId,
        ]
      );
    });

    const saved = await findExchangeBatchById({
      tenantId: payload.tenantId,
      exchangeBatchId: payload.exchangeBatchId,
    });
    if (!saved) {
      throw badRequest("Cash exchange batch not found after reversal");
    }
    const transactions = await getBatchTransactions(saved);
    return {
      batch: mapExchangeBatchRow(saved),
      ...transactions,
      fxLot: await buildExchangeBatchFxLotSummary(payload.tenantId, transactions),
      idempotentReplay: false,
    };
  }

  const outReverse = await reverseCashTransactionById({
    req,
    payload: {
      tenantId: payload.tenantId,
      userId: payload.userId,
      transactionId: outTxnId,
      reverseReason: payload.reverseReason,
    },
    assertScopeAccess,
  });
  const inReverse = await reverseCashTransactionById({
    req,
    payload: {
      tenantId: payload.tenantId,
      userId: payload.userId,
      transactionId: inTxnId,
      reverseReason: payload.reverseReason,
    },
    assertScopeAccess,
  });
  let feeReverse = null;
  if (feeTxnId) {
    feeReverse = await reverseCashTransactionById({
      req,
      payload: {
        tenantId: payload.tenantId,
        userId: payload.userId,
        transactionId: feeTxnId,
        reverseReason: payload.reverseReason,
      },
      assertScopeAccess,
    });
  }

  const reversalOutTxnId = parsePositiveInt(outReverse?.reversal?.id);
  const reversalInTxnId = parsePositiveInt(inReverse?.reversal?.id);
  const reversalFeeTxnId = parsePositiveInt(feeReverse?.reversal?.id);
  if (!reversalOutTxnId || !reversalInTxnId) {
    throw badRequest("Failed to create exchange reversal transactions");
  }
  if (feeTxnId && !reversalFeeTxnId) {
    throw badRequest("Failed to create exchange fee reversal transaction");
  }
  const reversalOutFxLotSummary = await getCashFxLotMovementSummaryByTransaction({
    tenantId: payload.tenantId,
    cashTransactionId: reversalOutTxnId,
  });
  const reversalRealizedFxBase = roundAmount(reversalOutFxLotSummary?.realizedFxBase || 0);

  await withTransaction(async (tx) => {
    await tx.query(
      `UPDATE cash_exchange_batches
       SET
         status = ?,
         reversal_out_cash_transaction_id = ?,
         reversal_in_cash_transaction_id = ?,
         reversal_fee_cash_transaction_id = ?,
         reversal_realized_fx_base = ?,
         reversed_by_user_id = ?,
         reversed_at = UTC_TIMESTAMP(),
         reverse_reason = ?
       WHERE tenant_id = ?
         AND id = ?`,
      [
        EXCHANGE_STATUS_REVERSED,
        reversalOutTxnId,
        reversalInTxnId,
        reversalFeeTxnId,
        reversalRealizedFxBase,
        payload.userId,
        payload.reverseReason,
        payload.tenantId,
        payload.exchangeBatchId,
      ]
    );
  });

  const saved = await findExchangeBatchById({
    tenantId: payload.tenantId,
    exchangeBatchId: payload.exchangeBatchId,
  });
  if (!saved) {
    throw badRequest("Cash exchange batch not found after reversal");
  }
  const transactions = await getBatchTransactions(saved);
  return {
    batch: mapExchangeBatchRow(saved),
    ...transactions,
    fxLot: await buildExchangeBatchFxLotSummary(payload.tenantId, transactions),
    idempotentReplay: false,
  };
}
