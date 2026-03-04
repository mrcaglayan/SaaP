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
} from "./cash.queries.js";
import { assertRegisterOperationalConfig } from "./cash.register.service.js";
import {
  createCashTransaction,
  postCashTransactionById,
  reverseCashTransactionById,
} from "./cash.transaction.service.js";
import { getCashFxLotMovementSummaryByTransaction } from "./cash.fx.position.service.js";

const EXCHANGE_STATUS_DRAFT = "DRAFT";
const EXCHANGE_STATUS_POSTED = "POSTED";
const EXCHANGE_STATUS_REVERSED = "REVERSED";
const AMOUNT_EPSILON = 0.000001;

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
  JOIN accounts ca ON ca.id = ceb.clearing_account_id
  LEFT JOIN accounts fa ON fa.id = ceb.fee_account_id
`;

function asUpper(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeCurrency(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
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

function buildDerivedKey(prefix, value, maxLength = 100) {
  const normalizedPrefix = String(prefix || "").trim();
  const normalizedValue = String(value || "").trim();
  if (!normalizedPrefix || !normalizedValue) {
    throw badRequest("Unable to derive idempotency key");
  }
  return `${normalizedPrefix}:${normalizedValue}`.slice(0, maxLength);
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

  await assertAccountBelongsToTenant(
    payload.tenantId,
    payload.clearingAccountId,
    "clearingAccountId"
  );
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
    tenantId: payload.tenantId,
    sourceRegisterId: payload.sourceRegisterId,
    idempotencyKey: payload.idempotencyKey,
  });
  if (replayByIdempotency) {
    assertBatchRequestFingerprint(replayByIdempotency, payload);
    assertExchangeScopeAccess(req, replayByIdempotency, assertScopeAccess, "sourceRegisterId");
    if (
      asUpper(replayByIdempotency.status) === EXCHANGE_STATUS_POSTED ||
      asUpper(replayByIdempotency.status) === EXCHANGE_STATUS_REVERSED
    ) {
      const replayTransactions = await getBatchTransactions(replayByIdempotency);
      return {
        batch: mapExchangeBatchRow(replayByIdempotency),
        ...replayTransactions,
        fxLot: await buildExchangeBatchFxLotSummary(payload.tenantId, replayTransactions),
        idempotentReplay: true,
      };
    }
  }

  const replayByEvent = await findExchangeBatchByIntegrationEventUid({
    tenantId: payload.tenantId,
    integrationEventUid,
  });
  if (replayByEvent) {
    assertBatchRequestFingerprint(replayByEvent, payload);
    assertExchangeScopeAccess(req, replayByEvent, assertScopeAccess, "sourceRegisterId");
    if (
      asUpper(replayByEvent.status) === EXCHANGE_STATUS_POSTED ||
      asUpper(replayByEvent.status) === EXCHANGE_STATUS_REVERSED
    ) {
      const replayTransactions = await getBatchTransactions(replayByEvent);
      return {
        batch: mapExchangeBatchRow(replayByEvent),
        ...replayTransactions,
        fxLot: await buildExchangeBatchFxLotSummary(payload.tenantId, replayTransactions),
        idempotentReplay: true,
      };
    }
  }

  const draftBatch = await withTransaction(async (tx) => {
    const existing = await findExchangeBatchByIdempotency({
      tenantId: payload.tenantId,
      sourceRegisterId: payload.sourceRegisterId,
      idempotencyKey: payload.idempotencyKey,
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
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CASH', 'cash_exchange_batch', ?, ?)`,
      [
        payload.tenantId,
        sourceRegister.legal_entity_id,
        payload.sourceRegisterId,
        payload.targetRegisterId,
        sourceCurrency,
        targetCurrency,
        sourceAmountTxn,
        targetAmountTxn,
        feeAmountTxn,
        feeAmountBaseInput,
        payload.clearingAccountId,
        parsePositiveInt(payload.feeAccountId) || null,
        effectiveFxRate,
        effectiveFxRateSource,
        effectiveFxRateDate,
        providerRef,
        spreadReferenceRate,
        spreadRateDelta,
        spreadAmountBase,
        EXCHANGE_STATUS_DRAFT,
        payload.idempotencyKey,
        integrationEventUid,
        payload.note || null,
        payload.userId,
      ]
    );
    const exchangeBatchId = parsePositiveInt(insertResult.rows?.insertId);
    if (!exchangeBatchId) {
      throw badRequest("Failed to create cash exchange batch");
    }
    const inserted = await findExchangeBatchById({
      tenantId: payload.tenantId,
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

  const outTxnCreate = await createCashTransaction({
    req,
    payload: {
      tenantId: payload.tenantId,
      userId: payload.userId,
      registerId: payload.sourceRegisterId,
      cashSessionId: payload.sourceCashSessionId,
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
        payload.description || `Cash exchange out to ${targetRegister.code || targetRegister.id}`,
      referenceNo: payload.referenceNo || `EXCH-${exchangeBatchId}`,
      sourceDocType: null,
      sourceDocId: null,
      counterpartyType: null,
      counterpartyId: null,
      counterAccountId: payload.clearingAccountId,
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
    tenantId: payload.tenantId,
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
      tenantId: payload.tenantId,
      userId: payload.userId,
      registerId: payload.targetRegisterId,
      cashSessionId: payload.targetCashSessionId,
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
        payload.description || `Cash exchange in from ${sourceRegister.code || sourceRegister.id}`,
      referenceNo: payload.referenceNo || `EXCH-${exchangeBatchId}`,
      sourceDocType: null,
      sourceDocId: null,
      counterpartyType: null,
      counterpartyId: null,
      counterAccountId: payload.clearingAccountId,
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
      tenantId: payload.tenantId,
      userId: payload.userId,
      transactionId: outTxnId,
      overrideCashControl: false,
      overrideReason: null,
    },
    assertScopeAccess,
  });
  const postIn = await postCashTransactionById({
    req,
    payload: {
      tenantId: payload.tenantId,
      userId: payload.userId,
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
    tenantId: payload.tenantId,
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
        tenantId: payload.tenantId,
        userId: payload.userId,
        registerId: payload.targetRegisterId,
        cashSessionId: payload.targetCashSessionId,
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
          payload.description ||
          `Cash exchange fee (${providerRef || targetRegister.code || targetRegister.id})`,
        referenceNo: payload.referenceNo || `EXCH-${exchangeBatchId}`,
        sourceDocType: null,
        sourceDocId: null,
        counterpartyType: null,
        counterpartyId: null,
        counterAccountId: parsePositiveInt(payload.feeAccountId),
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
        tenantId: payload.tenantId,
        userId: payload.userId,
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
        payload.userId,
        effectiveFxRate,
        effectiveFxRateSource,
        effectiveFxRateDate,
        providerRef,
        spreadReferenceRate,
        spreadRateDelta,
        spreadAmountBase,
        payload.tenantId,
        exchangeBatchId,
      ]
    );
  });

  const saved = await findExchangeBatchById({
    tenantId: payload.tenantId,
    exchangeBatchId,
  });
  if (!saved) {
    throw badRequest("Cash exchange batch not found after posting");
  }
  const transactions = await getBatchTransactions(saved);
  return {
    batch: mapExchangeBatchRow(saved),
    ...transactions,
    fxLot: await buildExchangeBatchFxLotSummary(payload.tenantId, transactions),
    idempotentReplay: false,
  };
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
