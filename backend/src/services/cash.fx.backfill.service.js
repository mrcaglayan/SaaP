import { query, withTransaction } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import { applyCashFxPositionForPostedTransactionTx } from "./cash.fx.position.service.js";

const AMOUNT_EPSILON = 0.000001;
const DEFAULT_METADATA_LIMIT = 10_000;
const DEFAULT_LOT_BACKFILL_LIMIT = 20_000;
const DEFAULT_PRIOR_RATE_MAX_DAYS = 30;

const INBOUND_TXN_TYPES = Object.freeze([
  "RECEIPT",
  "WITHDRAWAL_FROM_BANK",
  "TRANSFER_IN",
  "OPENING_FLOAT",
]);
const OUTBOUND_TXN_TYPES = Object.freeze([
  "PAYOUT",
  "DEPOSIT_TO_BANK",
  "TRANSFER_OUT",
  "CLOSING_ADJUSTMENT",
]);

function asUpper(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toDateOnly(value) {
  const formatDateParts = (year, month, day) =>
    `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(
      2,
      "0"
    )}`;

  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (value instanceof Date) {
    const time = value.getTime();
    if (!Number.isNaN(time)) {
      return formatDateParts(value.getFullYear(), value.getMonth() + 1, value.getDate());
    }
  }

  const normalized = String(value).trim();
  if (!normalized) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return normalized;
  }

  const parsed = new Date(normalized);
  if (!Number.isNaN(parsed.getTime())) {
    return formatDateParts(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
  }

  const prefix = normalized.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(prefix) ? prefix : null;
}

function roundAmount(value) {
  return Number(toNumber(value).toFixed(6));
}

function parseOptionalPositiveInt(value) {
  const parsed = parsePositiveInt(value);
  return parsed || null;
}

function normalizePositiveIntOrDefault(value, fallback, { max = null } = {}) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw badRequest("limit must be a positive integer");
  }
  if (Number.isInteger(max) && parsed > max) {
    return max;
  }
  return parsed;
}

function normalizeNonNegativeInt(value, label, fallback = null) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw badRequest(`${label} must be a non-negative integer`);
  }
  return parsed;
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  throw badRequest("Boolean value is invalid");
}

function ensureTenantId(tenantId) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  if (!normalizedTenantId) {
    throw badRequest("tenantId is required");
  }
  return normalizedTenantId;
}

function buildScopedCashWhere({
  tenantId,
  legalEntityId = null,
  registerId = null,
  alias = "cr",
  params = [],
}) {
  const where = [`${alias}.tenant_id = ?`];
  params.push(tenantId);

  if (parsePositiveInt(legalEntityId)) {
    where.push(`${alias}.legal_entity_id = ?`);
    params.push(parsePositiveInt(legalEntityId));
  }
  if (parsePositiveInt(registerId)) {
    where.push(`${alias}.id = ?`);
    params.push(parsePositiveInt(registerId));
  }
  return where;
}

function buildSignedTxnCase(columnSql) {
  return `CASE
    WHEN ct.txn_type IN ('${INBOUND_TXN_TYPES.join("','")}') THEN ${columnSql}
    WHEN ct.txn_type IN ('${OUTBOUND_TXN_TYPES.join("','")}') THEN -${columnSql}
    ELSE 0
  END`;
}

async function countExistingLotMovementsByTransaction({
  tenantId,
  cashTransactionId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT COUNT(*) AS total
     FROM cash_fx_lot_movements
     WHERE tenant_id = ?
       AND cash_transaction_id = ?`,
    [tenantId, cashTransactionId]
  );
  return Number(result.rows?.[0]?.total || 0);
}

async function listForeignPostedCashTransactions({
  tenantId,
  legalEntityId = null,
  registerId = null,
  limit = DEFAULT_LOT_BACKFILL_LIMIT,
  runQuery = query,
}) {
  const params = [];
  const scopeWhere = buildScopedCashWhere({
    tenantId,
    legalEntityId,
    registerId,
    alias: "cr",
    params,
  });
  scopeWhere.push("ct.status = 'POSTED'");
  scopeWhere.push("ct.posted_journal_entry_id IS NOT NULL");
  scopeWhere.push("UPPER(ct.currency_code) = UPPER(cr.currency_code)");
  scopeWhere.push("UPPER(cr.currency_code) <> UPPER(le.functional_currency_code)");

  const result = await runQuery(
    `SELECT
       ct.id,
       ct.book_date,
       ct.txn_type,
       ct.status,
       ct.amount,
       ct.amount_base,
       ct.currency_code,
       ct.posted_journal_entry_id,
       ct.reversal_of_transaction_id,
       ct.source_module,
       ct.source_entity_type,
       ct.source_entity_id,
       cr.id AS cash_register_id,
       cr.account_id AS register_account_id,
       cr.legal_entity_id,
       UPPER(le.functional_currency_code) AS base_currency_code
     FROM cash_transactions ct
     JOIN cash_registers cr
       ON cr.id = ct.cash_register_id
      AND cr.tenant_id = ct.tenant_id
     JOIN legal_entities le
       ON le.id = cr.legal_entity_id
      AND le.tenant_id = cr.tenant_id
     WHERE ${scopeWhere.join(" AND ")}
     ORDER BY ct.book_date ASC, ct.id ASC
     LIMIT ${Math.trunc(limit)}`,
    params
  );
  return result.rows || [];
}

async function resolveBackfillFxRate({
  tenantId,
  fromCurrencyCode,
  toCurrencyCode,
  targetDate,
  allowPriorRate = true,
  priorMaxDays = DEFAULT_PRIOR_RATE_MAX_DAYS,
  runQuery = query,
}) {
  const fromCurrency = asUpper(fromCurrencyCode);
  const toCurrency = asUpper(toCurrencyCode);
  const normalizedDate = toDateOnly(targetDate);
  if (!fromCurrency || !toCurrency || !normalizedDate || normalizedDate.length !== 10) {
    return null;
  }

  if (fromCurrency === toCurrency) {
    return {
      fxRate: 1,
      fxRateSource: "PARITY",
      fxRateDate: normalizedDate,
    };
  }

  const exactResult = await runQuery(
    `SELECT rate, rate_date
     FROM fx_rates
     WHERE tenant_id = ?
       AND from_currency_code = ?
       AND to_currency_code = ?
       AND rate_type = 'SPOT'
       AND rate_date = ?
     ORDER BY id DESC
     LIMIT 1`,
    [tenantId, fromCurrency, toCurrency, normalizedDate]
  );
  const exactRate = Number(exactResult.rows?.[0]?.rate);
  if (Number.isFinite(exactRate) && exactRate > 0) {
    return {
      fxRate: Number(exactRate.toFixed(10)),
      fxRateSource: "BACKFILL_EXACT_SPOT",
      fxRateDate: toDateOnly(exactResult.rows?.[0]?.rate_date) || normalizedDate,
    };
  }

  if (!allowPriorRate) {
    return null;
  }

  const priorParams = [tenantId, fromCurrency, toCurrency, normalizedDate];
  let priorExtra = "";
  const maxDays = normalizeNonNegativeInt(priorMaxDays, "priorRateMaxDays", null);
  if (maxDays !== null) {
    priorExtra = "AND DATEDIFF(?, rate_date) <= ?";
    priorParams.push(normalizedDate, maxDays);
  }

  const priorResult = await runQuery(
    `SELECT rate, rate_date
     FROM fx_rates
     WHERE tenant_id = ?
       AND from_currency_code = ?
       AND to_currency_code = ?
       AND rate_type = 'SPOT'
       AND rate_date < ?
       ${priorExtra}
     ORDER BY rate_date DESC, id DESC
     LIMIT 1`,
    priorParams
  );
  const priorRate = Number(priorResult.rows?.[0]?.rate);
  if (Number.isFinite(priorRate) && priorRate > 0) {
    return {
      fxRate: Number(priorRate.toFixed(10)),
      fxRateSource: "BACKFILL_PRIOR_SPOT",
      fxRateDate: toDateOnly(priorResult.rows?.[0]?.rate_date),
    };
  }
  return null;
}

async function listCashTransactionsMissingFxMetadata({
  tenantId,
  legalEntityId = null,
  registerId = null,
  limit = DEFAULT_METADATA_LIMIT,
  runQuery = query,
}) {
  const params = [];
  const scopeWhere = buildScopedCashWhere({
    tenantId,
    legalEntityId,
    registerId,
    alias: "cr",
    params,
  });
  scopeWhere.push("ct.status = 'POSTED'");
  scopeWhere.push(
    "(ct.amount_base IS NULL OR ct.amount_base <= 0 OR ct.fx_rate IS NULL OR ct.fx_rate <= 0 OR ct.fx_rate_source IS NULL OR TRIM(ct.fx_rate_source) = '' OR ct.fx_rate_date IS NULL)"
  );

  const result = await runQuery(
    `SELECT
       ct.id,
       ct.cash_register_id,
       ct.book_date,
       ct.amount,
       ct.amount_base,
       ct.currency_code,
       ct.fx_rate,
       ct.fx_rate_source,
       ct.fx_rate_date,
       cr.legal_entity_id,
       UPPER(le.functional_currency_code) AS base_currency_code
     FROM cash_transactions ct
     JOIN cash_registers cr
       ON cr.id = ct.cash_register_id
      AND cr.tenant_id = ct.tenant_id
     JOIN legal_entities le
       ON le.id = cr.legal_entity_id
      AND le.tenant_id = cr.tenant_id
     WHERE ${scopeWhere.join(" AND ")}
     ORDER BY ct.book_date ASC, ct.id ASC
     LIMIT ${Math.trunc(limit)}`,
    params
  );
  return result.rows || [];
}

export async function seedMissingCashFxMetadata({
  tenantId,
  legalEntityId = null,
  registerId = null,
  allowPriorRate = true,
  priorRateMaxDays = DEFAULT_PRIOR_RATE_MAX_DAYS,
  dryRun = false,
  limit = DEFAULT_METADATA_LIMIT,
}) {
  const normalizedTenantId = ensureTenantId(tenantId);
  const normalizedLimit = normalizePositiveIntOrDefault(limit, DEFAULT_METADATA_LIMIT, {
    max: 200_000,
  });
  const normalizedDryRun = normalizeBoolean(dryRun, false);
  const rows = await listCashTransactionsMissingFxMetadata({
    tenantId: normalizedTenantId,
    legalEntityId,
    registerId,
    limit: normalizedLimit,
  });

  let updatedCount = 0;
  let unresolvedCount = 0;
  const unresolvedRows = [];

  for (const row of rows) {
    const transactionId = parsePositiveInt(row.id);
    if (!transactionId) continue;

    const currencyCode = asUpper(row.currency_code);
    const baseCurrencyCode = asUpper(row.base_currency_code);
    const amountTxn = roundAmount(row.amount);
    const hasAmountBase = toNumber(row.amount_base) > 0;
    const hasFxRate = Number(row.fx_rate) > 0;
    const hasFxRateSource = String(row.fx_rate_source || "").trim().length > 0;
    const hasFxRateDate = Boolean(toDateOnly(row.fx_rate_date));

    let resolvedFx = null;
    if (currencyCode === baseCurrencyCode) {
      resolvedFx = {
        fxRate: 1,
        fxRateSource: "PARITY",
        fxRateDate: toDateOnly(row.book_date),
      };
    } else if (!hasFxRate || !hasFxRateDate || !hasFxRateSource || !hasAmountBase) {
      resolvedFx = await resolveBackfillFxRate({
        tenantId: normalizedTenantId,
        fromCurrencyCode: currencyCode,
        toCurrencyCode: baseCurrencyCode,
        targetDate: row.book_date,
        allowPriorRate: normalizeBoolean(allowPriorRate, true),
        priorMaxDays: priorRateMaxDays,
      });
    }

    const fxRateToPersist = hasFxRate
      ? Number(Number(row.fx_rate).toFixed(10))
      : Number(resolvedFx?.fxRate || 0);
    const fxRateSourceToPersist = hasFxRateSource
      ? String(row.fx_rate_source).trim().slice(0, 40)
      : String(resolvedFx?.fxRateSource || "").trim().slice(0, 40);
    const fxRateDateToPersist = hasFxRateDate
      ? toDateOnly(row.fx_rate_date)
      : toDateOnly(resolvedFx?.fxRateDate);
    const amountBaseToPersist =
      hasAmountBase && toNumber(row.amount_base) > 0
        ? roundAmount(row.amount_base)
        : fxRateToPersist > 0
          ? roundAmount(amountTxn * fxRateToPersist)
          : null;

    if (
      (!hasFxRate || !hasFxRateSource || !hasFxRateDate || !hasAmountBase) &&
      (!fxRateToPersist || !fxRateSourceToPersist || !fxRateDateToPersist || !amountBaseToPersist)
    ) {
      unresolvedCount += 1;
      unresolvedRows.push({
        cashTransactionId: transactionId,
        currencyCode,
        baseCurrencyCode,
        bookDate: toDateOnly(row.book_date),
      });
      continue;
    }

    const needsUpdate =
      !hasAmountBase ||
      !hasFxRate ||
      !hasFxRateSource ||
      !hasFxRateDate;

    if (!needsUpdate) {
      continue;
    }

    if (normalizedDryRun) {
      updatedCount += 1;
      continue;
    }

    await query(
      `UPDATE cash_transactions
       SET amount_base = ?,
           fx_rate = ?,
           fx_rate_source = ?,
           fx_rate_date = ?
       WHERE tenant_id = ?
         AND id = ?`,
      [
        amountBaseToPersist,
        Number(fxRateToPersist).toFixed(10),
        fxRateSourceToPersist,
        fxRateDateToPersist,
        normalizedTenantId,
        transactionId,
      ]
    );
    updatedCount += 1;
  }

  return {
    tenantId: normalizedTenantId,
    legalEntityId: parseOptionalPositiveInt(legalEntityId),
    registerId: parseOptionalPositiveInt(registerId),
    dryRun: normalizedDryRun,
    scannedCount: rows.length,
    updatedCount,
    unresolvedCount,
    unresolvedRows: unresolvedRows.slice(0, 50),
  };
}

export async function backfillCashFxPositionLots({
  tenantId,
  legalEntityId = null,
  registerId = null,
  dryRun = false,
  continueOnError = false,
  limit = DEFAULT_LOT_BACKFILL_LIMIT,
}) {
  const normalizedTenantId = ensureTenantId(tenantId);
  const normalizedLimit = normalizePositiveIntOrDefault(limit, DEFAULT_LOT_BACKFILL_LIMIT, {
    max: 200_000,
  });
  const normalizedDryRun = normalizeBoolean(dryRun, false);
  const normalizedContinueOnError = normalizeBoolean(continueOnError, false);

  const candidates = await listForeignPostedCashTransactions({
    tenantId: normalizedTenantId,
    legalEntityId,
    registerId,
    limit: normalizedLimit,
  });

  let appliedCount = 0;
  let idempotentCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  const errors = [];

  for (const row of candidates) {
    const cashTransactionId = parsePositiveInt(row.id);
    if (!cashTransactionId) continue;

    try {
      const existingMovementCount = await countExistingLotMovementsByTransaction({
        tenantId: normalizedTenantId,
        cashTransactionId,
      });
      if (existingMovementCount > 0) {
        idempotentCount += 1;
        continue;
      }

      if (normalizedDryRun) {
        appliedCount += 1;
        continue;
      }

      const result = await withTransaction(async (tx) => {
        return applyCashFxPositionForPostedTransactionTx({
          tenantId: normalizedTenantId,
          cashTransactionId,
          runQuery: tx.query,
        });
      });

      if (result?.applied && result?.idempotentReplay) {
        idempotentCount += 1;
      } else if (result?.applied) {
        appliedCount += 1;
      } else {
        skippedCount += 1;
      }
    } catch (error) {
      failedCount += 1;
      errors.push({
        cashTransactionId,
        message: String(error?.message || "FX lot backfill failed"),
      });
      if (!normalizedContinueOnError) {
        throw error;
      }
    }
  }

  return {
    tenantId: normalizedTenantId,
    legalEntityId: parseOptionalPositiveInt(legalEntityId),
    registerId: parseOptionalPositiveInt(registerId),
    dryRun: normalizedDryRun,
    continueOnError: normalizedContinueOnError,
    scannedCount: candidates.length,
    appliedCount,
    idempotentCount,
    skippedCount,
    failedCount,
    errors: errors.slice(0, 100),
  };
}

async function aggregateExpectedForeignCashBalances({
  tenantId,
  legalEntityId = null,
  registerId = null,
  runQuery = query,
}) {
  const params = [];
  const scopeWhere = buildScopedCashWhere({
    tenantId,
    legalEntityId,
    registerId,
    alias: "cr",
    params,
  });
  scopeWhere.push("ct.status = 'POSTED'");
  scopeWhere.push("ct.posted_journal_entry_id IS NOT NULL");
  scopeWhere.push("UPPER(cr.currency_code) <> UPPER(le.functional_currency_code)");

  const signedTxn = buildSignedTxnCase("ct.amount");
  const signedBaseTxn = buildSignedTxnCase("COALESCE(ct.amount_base, ct.amount)");

  const result = await runQuery(
    `SELECT
       cr.id AS register_id,
       cr.code AS register_code,
       cr.name AS register_name,
       cr.legal_entity_id,
       le.code AS legal_entity_code,
       le.name AS legal_entity_name,
       UPPER(cr.currency_code) AS currency_code,
       UPPER(le.functional_currency_code) AS base_currency_code,
       COALESCE(SUM(${signedTxn}), 0) AS expected_balance_txn,
       COALESCE(SUM(${signedBaseTxn}), 0) AS expected_carrying_base_txn,
       COALESCE(SUM(COALESCE(jl.debit_base, 0) - COALESCE(jl.credit_base, 0)), 0) AS expected_carrying_base_gl
     FROM cash_transactions ct
     JOIN cash_registers cr
       ON cr.id = ct.cash_register_id
      AND cr.tenant_id = ct.tenant_id
     JOIN legal_entities le
       ON le.id = cr.legal_entity_id
      AND le.tenant_id = cr.tenant_id
     LEFT JOIN journal_lines jl
       ON jl.journal_entry_id = ct.posted_journal_entry_id
      AND jl.account_id = cr.account_id
     WHERE ${scopeWhere.join(" AND ")}
     GROUP BY
       cr.id,
       cr.code,
       cr.name,
       cr.legal_entity_id,
       le.code,
       le.name,
       UPPER(cr.currency_code),
       UPPER(le.functional_currency_code)
     ORDER BY cr.id ASC`,
    params
  );
  return result.rows || [];
}

async function aggregateLotBalances({
  tenantId,
  legalEntityId = null,
  registerId = null,
  runQuery = query,
}) {
  const params = [tenantId];
  const where = ["l.tenant_id = ?"];

  if (parsePositiveInt(legalEntityId)) {
    where.push("l.legal_entity_id = ?");
    params.push(parsePositiveInt(legalEntityId));
  }
  if (parsePositiveInt(registerId)) {
    where.push("l.cash_register_id = ?");
    params.push(parsePositiveInt(registerId));
  }

  const result = await runQuery(
    `SELECT
       l.cash_register_id AS register_id,
       UPPER(l.currency_code) AS currency_code,
       COALESCE(SUM(l.remaining_amount_txn), 0) AS lot_remaining_txn,
       COALESCE(SUM(l.remaining_amount_base), 0) AS lot_remaining_base,
       COUNT(*) AS lot_count,
       SUM(CASE WHEN l.status = 'OPEN' THEN 1 ELSE 0 END) AS open_lot_count
     FROM cash_fx_position_lots l
     WHERE ${where.join(" AND ")}
     GROUP BY l.cash_register_id, UPPER(l.currency_code)
     ORDER BY l.cash_register_id ASC`,
    params
  );
  return result.rows || [];
}

function scopeKey(registerId, currencyCode) {
  return `${Number(registerId)}|${asUpper(currencyCode)}`;
}

export async function reconcileCashFxLotsAgainstGl({
  tenantId,
  legalEntityId = null,
  registerId = null,
}) {
  const normalizedTenantId = ensureTenantId(tenantId);
  const expectedRows = await aggregateExpectedForeignCashBalances({
    tenantId: normalizedTenantId,
    legalEntityId,
    registerId,
  });
  const lotRows = await aggregateLotBalances({
    tenantId: normalizedTenantId,
    legalEntityId,
    registerId,
  });

  const lotMap = new Map();
  for (const row of lotRows) {
    lotMap.set(scopeKey(row.register_id, row.currency_code), row);
  }

  const checks = [];
  let mismatchCount = 0;

  for (const expected of expectedRows) {
    const key = scopeKey(expected.register_id, expected.currency_code);
    const lot = lotMap.get(key) || null;
    const expectedTxn = roundAmount(expected.expected_balance_txn);
    const expectedBaseGl = roundAmount(expected.expected_carrying_base_gl);
    const expectedBaseTxn = roundAmount(expected.expected_carrying_base_txn);
    const lotRemainingTxn = roundAmount(lot?.lot_remaining_txn || 0);
    const lotRemainingBase = roundAmount(lot?.lot_remaining_base || 0);
    const txnDelta = roundAmount(expectedTxn - lotRemainingTxn);
    const baseDeltaGl = roundAmount(expectedBaseGl - lotRemainingBase);
    const baseDeltaTxn = roundAmount(expectedBaseTxn - lotRemainingBase);
    const isMatch =
      Math.abs(txnDelta) <= AMOUNT_EPSILON &&
      Math.abs(baseDeltaGl) <= AMOUNT_EPSILON;

    if (!isMatch) mismatchCount += 1;

    checks.push({
      legalEntityId: parsePositiveInt(expected.legal_entity_id),
      legalEntityCode: expected.legal_entity_code || null,
      legalEntityName: expected.legal_entity_name || null,
      registerId: parsePositiveInt(expected.register_id),
      registerCode: expected.register_code || null,
      registerName: expected.register_name || null,
      currencyCode: expected.currency_code || null,
      baseCurrencyCode: expected.base_currency_code || null,
      expectedBalanceTxn: expectedTxn,
      lotRemainingTxn,
      expectedCarryingBaseTxnModel: expectedBaseTxn,
      expectedCarryingBaseGl: expectedBaseGl,
      lotRemainingBase,
      deltaTxn: txnDelta,
      deltaBaseGl: baseDeltaGl,
      deltaBaseTxnModel: baseDeltaTxn,
      lotCount: Number(lot?.lot_count || 0),
      openLotCount: Number(lot?.open_lot_count || 0),
      isMatch,
    });
  }

  for (const lot of lotRows) {
    const key = scopeKey(lot.register_id, lot.currency_code);
    if (checks.some((row) => scopeKey(row.registerId, row.currencyCode) === key)) {
      continue;
    }
    const lotRemainingTxn = roundAmount(lot.lot_remaining_txn);
    const lotRemainingBase = roundAmount(lot.lot_remaining_base);
    const isMatch =
      Math.abs(lotRemainingTxn) <= AMOUNT_EPSILON &&
      Math.abs(lotRemainingBase) <= AMOUNT_EPSILON;
    if (!isMatch) mismatchCount += 1;
    checks.push({
      legalEntityId: null,
      legalEntityCode: null,
      legalEntityName: null,
      registerId: parsePositiveInt(lot.register_id),
      registerCode: null,
      registerName: null,
      currencyCode: lot.currency_code || null,
      baseCurrencyCode: null,
      expectedBalanceTxn: 0,
      lotRemainingTxn,
      expectedCarryingBaseTxnModel: 0,
      expectedCarryingBaseGl: 0,
      lotRemainingBase,
      deltaTxn: roundAmount(0 - lotRemainingTxn),
      deltaBaseGl: roundAmount(0 - lotRemainingBase),
      deltaBaseTxnModel: roundAmount(0 - lotRemainingBase),
      lotCount: Number(lot?.lot_count || 0),
      openLotCount: Number(lot?.open_lot_count || 0),
      isMatch,
    });
  }

  return {
    tenantId: normalizedTenantId,
    legalEntityId: parseOptionalPositiveInt(legalEntityId),
    registerId: parseOptionalPositiveInt(registerId),
    checkedCount: checks.length,
    mismatchCount,
    rows: checks,
  };
}

export default {
  seedMissingCashFxMetadata,
  backfillCashFxPositionLots,
  reconcileCashFxLotsAgainstGl,
};
