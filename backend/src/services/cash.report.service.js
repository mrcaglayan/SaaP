import { query } from "../db.js";
import { parsePositiveInt } from "../routes/_utils.js";
import { listCashExchangeBatchRows } from "./cash.exchange.service.js";

const AMOUNT_SCALE = 6;
const AMOUNT_EPSILON = 0.000001;

function asUpper(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundAmount(value) {
  return Number(toNumber(value).toFixed(AMOUNT_SCALE));
}

function signedAmountCase(columnSql) {
  return `CASE
    WHEN ct.txn_type IN ('RECEIPT', 'TRANSFER_IN') THEN ${columnSql}
    WHEN ct.txn_type IN ('PAYMENT', 'TRANSFER_OUT') THEN -${columnSql}
    ELSE 0
  END`;
}

function mapForeignCashBalanceRow(row) {
  return {
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    legalEntityCode: row.legal_entity_code || null,
    legalEntityName: row.legal_entity_name || null,
    registerId: parsePositiveInt(row.cash_register_id),
    registerCode: row.cash_register_code || null,
    registerName: row.cash_register_name || null,
    accountId: parsePositiveInt(row.account_id),
    accountCode: row.account_code || null,
    accountName: row.account_name || null,
    currencyCode: row.currency_code || null,
    baseCurrencyCode: row.base_currency_code || null,
    balanceAmountTxn: roundAmount(row.balance_amount_txn),
    carryingAmountBase: roundAmount(row.carrying_amount_base),
    isForeignCurrency:
      asUpper(row.currency_code) !== asUpper(row.base_currency_code || row.currency_code),
  };
}

function mapRevaluationRunRow(row) {
  return {
    runId: parsePositiveInt(row.id),
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    legalEntityCode: row.legal_entity_code || null,
    legalEntityName: row.legal_entity_name || null,
    bookId: parsePositiveInt(row.book_id),
    fiscalPeriodId: parsePositiveInt(row.fiscal_period_id),
    fiscalYear: Number(row.fiscal_year || 0) || null,
    periodNo: Number(row.period_no || 0) || null,
    periodName: row.period_name || null,
    runType: row.run_type || null,
    status: row.status || null,
    periodEndDate: row.period_end_date || null,
    baseCurrencyCode: row.base_currency_code || null,
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
    completedAt: row.completed_at || null,
    createdAt: row.created_at || null,
  };
}

function buildCashExchangeSummary(rows) {
  const statusCounts = {};
  let sourceAmountTxnTotal = 0;
  let targetAmountTxnTotal = 0;
  let sourceAmountBaseTotal = 0;
  let targetAmountBaseTotal = 0;
  let principalFxDifferenceBaseTotal = 0;
  let realizedFxBaseTotal = 0;
  let feeAmountTxnTotal = 0;
  let feeAmountBaseTotal = 0;
  let spreadAmountBaseTotal = 0;

  for (const row of rows || []) {
    const status = asUpper(row?.status || "UNKNOWN");
    statusCounts[status] = Number(statusCounts[status] || 0) + 1;

    const sourceTxn = toNumber(row?.sourceAmountTxn);
    const targetTxn = toNumber(row?.targetAmountTxn);
    const sourceBase = toNumber(row?.sourceAmountBase);
    const targetBase = toNumber(row?.targetAmountBase);
    const feeTxn = toNumber(row?.feeAmountTxn);
    const feeBase = toNumber(row?.feeAmountBase);
    const realizedFxBase = toNumber(row?.realizedFxBase);
    const spreadBase = toNumber(row?.spreadAmountBase);

    sourceAmountTxnTotal += sourceTxn;
    targetAmountTxnTotal += targetTxn;
    sourceAmountBaseTotal += sourceBase;
    targetAmountBaseTotal += targetBase;
    principalFxDifferenceBaseTotal += targetBase - sourceBase;
    realizedFxBaseTotal += realizedFxBase;
    feeAmountTxnTotal += feeTxn;
    feeAmountBaseTotal += feeBase;
    spreadAmountBaseTotal += spreadBase;
  }

  return {
    statusCounts,
    sourceAmountTxnTotal: roundAmount(sourceAmountTxnTotal),
    targetAmountTxnTotal: roundAmount(targetAmountTxnTotal),
    sourceAmountBaseTotal: roundAmount(sourceAmountBaseTotal),
    targetAmountBaseTotal: roundAmount(targetAmountBaseTotal),
    realizedFxDifferenceBaseTotal: roundAmount(principalFxDifferenceBaseTotal),
    principalFxDifferenceBaseTotal: roundAmount(principalFxDifferenceBaseTotal),
    realizedFxBaseTotal: roundAmount(realizedFxBaseTotal),
    feeAmountTxnTotal: roundAmount(feeAmountTxnTotal),
    feeAmountBaseTotal: roundAmount(feeAmountBaseTotal),
    spreadAmountBaseTotal: roundAmount(spreadAmountBaseTotal),
  };
}

export async function getCashExchangeHistoryReport({
  req,
  filters,
  buildScopeFilter,
  assertScopeAccess,
}) {
  const result = await listCashExchangeBatchRows({
    req,
    tenantId: filters.tenantId,
    filters,
    buildScopeFilter,
    assertScopeAccess,
  });

  return {
    ...result,
    summary: buildCashExchangeSummary(result.rows || []),
  };
}

export async function getForeignCashBalancesReport({
  req,
  filters,
  buildScopeFilter,
  assertScopeAccess,
}) {
  const where = ["ct.tenant_id = ?", "ct.status = 'POSTED'", "ct.book_date <= ?"];
  const params = [filters.tenantId, filters.asOfDate];

  if (filters.legalEntityId) {
    if (typeof assertScopeAccess === "function") {
      assertScopeAccess(req, "legal_entity", filters.legalEntityId, "legalEntityId");
    }
    where.push("cr.legal_entity_id = ?");
    params.push(filters.legalEntityId);
  }

  if (filters.registerId) {
    where.push("cr.id = ?");
    params.push(filters.registerId);
  }

  if (filters.currencyCode) {
    where.push("UPPER(cr.currency_code) = ?");
    params.push(asUpper(filters.currencyCode));
  }

  if (!filters.includeBaseCurrency) {
    where.push("UPPER(cr.currency_code) <> UPPER(le.functional_currency_code)");
  }

  if (typeof buildScopeFilter === "function") {
    const scopeSql = buildScopeFilter(req, "legal_entity", "cr.legal_entity_id", params);
    if (scopeSql && scopeSql !== "1 = 1") {
      where.push(scopeSql);
    }
  }

  const signedTxn = signedAmountCase("ct.amount");
  const signedBase = signedAmountCase("COALESCE(ct.amount_base, ct.amount)");
  const havingSql = filters.includeZeroBalances
    ? ""
    : `HAVING ABS(SUM(${signedTxn})) >= ${AMOUNT_EPSILON}`;
  const whereSql = where.join(" AND ");

  const groupedSql = `SELECT
      cr.legal_entity_id,
      le.code AS legal_entity_code,
      le.name AS legal_entity_name,
      cr.id AS cash_register_id,
      cr.code AS cash_register_code,
      cr.name AS cash_register_name,
      cr.account_id,
      a.code AS account_code,
      a.name AS account_name,
      UPPER(cr.currency_code) AS currency_code,
      UPPER(le.functional_currency_code) AS base_currency_code,
      SUM(${signedTxn}) AS balance_amount_txn,
      SUM(${signedBase}) AS carrying_amount_base
    FROM cash_transactions ct
    JOIN cash_registers cr
      ON cr.id = ct.cash_register_id
     AND cr.tenant_id = ct.tenant_id
    JOIN legal_entities le
      ON le.id = cr.legal_entity_id
     AND le.tenant_id = cr.tenant_id
    JOIN accounts a
      ON a.id = cr.account_id
    WHERE ${whereSql}
    GROUP BY
      cr.legal_entity_id,
      le.code,
      le.name,
      cr.id,
      cr.code,
      cr.name,
      cr.account_id,
      a.code,
      a.name,
      UPPER(cr.currency_code),
      UPPER(le.functional_currency_code)
    ${havingSql}`;

  const countResult = await query(
    `SELECT COUNT(*) AS total
     FROM (${groupedSql}) grouped`,
    params
  );
  const total = Number(countResult.rows?.[0]?.total || 0);

  const summaryResult = await query(
    `SELECT
       COUNT(*) AS register_count,
       COALESCE(SUM(grouped.balance_amount_txn), 0) AS total_balance_txn,
       COALESCE(SUM(grouped.carrying_amount_base), 0) AS total_carrying_base
     FROM (${groupedSql}) grouped`,
    params
  );
  const summaryRow = summaryResult.rows?.[0] || {};

  const rowsResult = await query(
    `SELECT *
     FROM (${groupedSql}) grouped
     ORDER BY grouped.legal_entity_id ASC, grouped.currency_code ASC, grouped.cash_register_id ASC
     LIMIT ${Number(filters.limit || 200)}
     OFFSET ${Number(filters.offset || 0)}`,
    params
  );
  const rows = (rowsResult.rows || []).map(mapForeignCashBalanceRow);

  return {
    asOfDate: filters.asOfDate,
    legalEntityId: filters.legalEntityId || null,
    registerId: filters.registerId || null,
    currencyCode: filters.currencyCode || null,
    includeBaseCurrency: Boolean(filters.includeBaseCurrency),
    includeZeroBalances: Boolean(filters.includeZeroBalances),
    total,
    limit: Number(filters.limit || 200),
    offset: Number(filters.offset || 0),
    summary: {
      registerCount: Number(summaryRow.register_count || 0),
      totalBalanceTxn: roundAmount(summaryRow.total_balance_txn),
      totalCarryingBase: roundAmount(summaryRow.total_carrying_base),
    },
    rows,
  };
}

export async function getCashFxRevaluationRunsReport({
  req,
  filters,
  buildScopeFilter,
  assertScopeAccess,
}) {
  const where = ["r.tenant_id = ?"];
  const params = [filters.tenantId];

  if (filters.legalEntityId) {
    if (typeof assertScopeAccess === "function") {
      assertScopeAccess(req, "legal_entity", filters.legalEntityId, "legalEntityId");
    }
    where.push("r.legal_entity_id = ?");
    params.push(filters.legalEntityId);
  }

  if (filters.bookId) {
    where.push("r.book_id = ?");
    params.push(filters.bookId);
  }

  if (filters.runType) {
    where.push("r.run_type = ?");
    params.push(filters.runType);
  }

  if (filters.status) {
    where.push("r.status = ?");
    params.push(filters.status);
  }

  if (filters.periodEndFrom) {
    where.push("r.period_end_date >= ?");
    params.push(filters.periodEndFrom);
  }

  if (filters.periodEndTo) {
    where.push("r.period_end_date <= ?");
    params.push(filters.periodEndTo);
  }

  if (typeof buildScopeFilter === "function") {
    const scopeSql = buildScopeFilter(req, "legal_entity", "r.legal_entity_id", params);
    if (scopeSql && scopeSql !== "1 = 1") {
      where.push(scopeSql);
    }
  }

  const whereSql = where.join(" AND ");

  const countResult = await query(
    `SELECT COUNT(*) AS total
     FROM cash_fx_revaluation_runs r
     WHERE ${whereSql}`,
    params
  );
  const total = Number(countResult.rows?.[0]?.total || 0);

  const rowsResult = await query(
    `SELECT
       r.*,
       le.code AS legal_entity_code,
       le.name AS legal_entity_name,
       fp.fiscal_year,
       fp.period_no,
       fp.period_name
     FROM cash_fx_revaluation_runs r
     JOIN legal_entities le
       ON le.id = r.legal_entity_id
      AND le.tenant_id = r.tenant_id
     LEFT JOIN fiscal_periods fp
       ON fp.id = r.fiscal_period_id
     WHERE ${whereSql}
     ORDER BY r.period_end_date DESC, r.id DESC
     LIMIT ${Number(filters.limit || 100)}
     OFFSET ${Number(filters.offset || 0)}`,
    params
  );

  const rows = (rowsResult.rows || []).map(mapRevaluationRunRow);

  if (filters.includeLineCurrencySummary && rows.length > 0) {
    const runIds = rows.map((row) => row.runId).filter(Boolean);
    const placeholders = runIds.map(() => "?").join(", ");
    const lineResult = await query(
      `SELECT
         l.cash_fx_revaluation_run_id AS run_id,
         l.currency_code,
         COUNT(*) AS register_count,
         COALESCE(SUM(l.balance_amount_txn), 0) AS balance_amount_txn,
         COALESCE(SUM(l.carrying_amount_base), 0) AS carrying_amount_base,
         COALESCE(SUM(l.closing_amount_base), 0) AS closing_amount_base,
         COALESCE(SUM(l.delta_base), 0) AS delta_base
       FROM cash_fx_revaluation_lines l
       WHERE l.tenant_id = ?
         AND l.cash_fx_revaluation_run_id IN (${placeholders})
       GROUP BY l.cash_fx_revaluation_run_id, l.currency_code
       ORDER BY l.cash_fx_revaluation_run_id ASC, l.currency_code ASC`,
      [filters.tenantId, ...runIds]
    );

    const lineMap = new Map();
    for (const row of lineResult.rows || []) {
      const runId = parsePositiveInt(row.run_id);
      if (!runId) continue;
      const current = lineMap.get(runId) || [];
      current.push({
        currencyCode: row.currency_code || null,
        registerCount: Number(row.register_count || 0),
        balanceAmountTxn: roundAmount(row.balance_amount_txn),
        carryingAmountBase: roundAmount(row.carrying_amount_base),
        closingAmountBase: roundAmount(row.closing_amount_base),
        deltaBase: roundAmount(row.delta_base),
      });
      lineMap.set(runId, current);
    }

    for (const row of rows) {
      row.lineCurrencySummary = lineMap.get(row.runId) || [];
    }
  }

  const summaryResult = await query(
    `SELECT
       COALESCE(SUM(r.total_carrying_base), 0) AS total_carrying_base,
       COALESCE(SUM(r.total_closing_base), 0) AS total_closing_base,
       COALESCE(SUM(r.total_delta_base), 0) AS total_delta_base
     FROM cash_fx_revaluation_runs r
     WHERE ${whereSql}`,
    params
  );
  const summaryRow = summaryResult.rows?.[0] || {};

  return {
    legalEntityId: filters.legalEntityId || null,
    bookId: filters.bookId || null,
    runType: filters.runType || null,
    status: filters.status || null,
    periodEndFrom: filters.periodEndFrom || null,
    periodEndTo: filters.periodEndTo || null,
    includeLineCurrencySummary: Boolean(filters.includeLineCurrencySummary),
    total,
    limit: Number(filters.limit || 100),
    offset: Number(filters.offset || 0),
    summary: {
      totalCarryingBase: roundAmount(summaryRow.total_carrying_base),
      totalClosingBase: roundAmount(summaryRow.total_closing_base),
      totalDeltaBase: roundAmount(summaryRow.total_delta_base),
    },
    rows,
  };
}
