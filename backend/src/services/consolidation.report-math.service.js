import { query } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";

const VALID_FX_RATE_TYPES = new Set(["SPOT", "AVERAGE", "CLOSING"]);
export const CONSOLIDATION_REPORT_BALANCE_EPSILON = 0.0001;

function toIsoDate(value, fieldLabel = "date") {
  const toLocalYyyyMmDd = (date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
      2,
      "0"
    )}-${String(date.getDate()).padStart(2, "0")}`;

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

async function resolveFxRate({
  tenantId,
  rateDate,
  fromCurrencyCode,
  toCurrencyCode,
  preferredRateType = "CLOSING",
  runQuery = query,
}) {
  const fromCode = String(fromCurrencyCode || "").trim().toUpperCase();
  const toCode = String(toCurrencyCode || "").trim().toUpperCase();
  if (!fromCode || !toCode) {
    throw badRequest("Currency codes are required for FX translation");
  }
  if (fromCode === toCode) {
    return {
      rate: 1,
      rateType: "IDENTITY",
      rateDate,
    };
  }

  const fallbackOrder = [
    String(preferredRateType || "CLOSING").toUpperCase(),
    "CLOSING",
    "SPOT",
    "AVERAGE",
  ].filter(
    (value, index, values) =>
      VALID_FX_RATE_TYPES.has(value) && values.indexOf(value) === index
  );

  const result = await runQuery(
    `SELECT rate, rate_type, rate_date
     FROM fx_rates
     WHERE tenant_id = ?
       AND from_currency_code = ?
       AND to_currency_code = ?
       AND rate_type IN (${fallbackOrder.map(() => "?").join(", ")})
       AND rate_date <= ?
     ORDER BY rate_date DESC,
              FIELD(rate_type, ${fallbackOrder.map(() => "?").join(", ")})
     LIMIT 1`,
    [tenantId, fromCode, toCode, ...fallbackOrder, rateDate, ...fallbackOrder]
  );

  const row = result.rows?.[0] || null;
  if (!row) {
    throw badRequest(
      `FX rate not found for ${fromCode}->${toCode} on or before ${rateDate}`
    );
  }

  return {
    rate: Number(row.rate || 0),
    rateType: String(row.rate_type || "").trim().toUpperCase() || null,
    rateDate: row.rate_date || rateDate,
  };
}

/**
 * Normalize report balances so liabilities, equity, and revenue can be compared
 * on the same positive-balance footing as assets and expenses.
 */
export function normalizeConsolidationBalanceByAccountType(
  accountType,
  balance
) {
  const type = String(accountType || "").trim().toUpperCase();
  const amount = Number(balance || 0);
  if (["LIABILITY", "EQUITY", "REVENUE"].includes(type)) {
    return amount * -1;
  }
  return amount;
}

/**
 * Load the shared consolidated report math rows used by balance sheet, income
 * statement, and publish-gate checks. This keeps RP12 blockers aligned with
 * the live report surfaces instead of introducing a second hidden engine.
 */
export async function loadConsolidationRunReportAccountBalances({
  tenantId,
  run,
  includeDraft = false,
  preferredRateType = "CLOSING",
  runQuery = query,
}) {
  const runId = parsePositiveInt(run?.id);
  const normalizedTenantId = parsePositiveInt(tenantId);
  if (!runId) {
    throw badRequest("Consolidation run not found");
  }
  if (!normalizedTenantId) {
    throw badRequest("tenantId is required");
  }

  const presentationCurrencyCode = String(
    run?.presentation_currency_code || run?.presentationCurrencyCode || ""
  )
    .trim()
    .toUpperCase();
  if (!presentationCurrencyCode) {
    throw badRequest("presentationCurrencyCode is required");
  }

  const rateDate = toIsoDate(
    run?.period_end_date || run?.periodEndDate,
    "periodEndDate"
  );
  const statusFilter = includeDraft ? ["DRAFT", "POSTED"] : ["POSTED"];
  const statusPlaceholders = statusFilter.map(() => "?").join(", ");
  const accountMap = new Map();
  const fxRateCache = new Map();

  function ensureAccount(accountId, accountCode, accountName, accountType) {
    if (!accountMap.has(accountId)) {
      accountMap.set(accountId, {
        accountId,
        accountCode: String(accountCode || `ACC-${accountId}`),
        accountName: accountName ? String(accountName) : null,
        accountType: String(accountType || "").trim().toUpperCase(),
        baseDebit: 0,
        baseCredit: 0,
        baseBalance: 0,
        adjustmentDebit: 0,
        adjustmentCredit: 0,
        adjustmentBalance: 0,
        eliminationDebit: 0,
        eliminationCredit: 0,
        eliminationBalance: 0,
        finalDebit: 0,
        finalCredit: 0,
        finalBalance: 0,
      });
    }
    return accountMap.get(accountId);
  }

  function addAmounts(row, component, debit, credit, balance) {
    row[`${component}Debit`] += debit;
    row[`${component}Credit`] += credit;
    row[`${component}Balance`] += balance;
    row.finalDebit += debit;
    row.finalCredit += credit;
    row.finalBalance += balance;
  }

  async function resolveCachedRate(fromCurrencyCode) {
    const sourceCurrencyCode = String(fromCurrencyCode || "")
      .trim()
      .toUpperCase();
    const cacheKey = `${sourceCurrencyCode}->${presentationCurrencyCode}:${preferredRateType}:${rateDate}`;
    if (fxRateCache.has(cacheKey)) {
      return fxRateCache.get(cacheKey);
    }

    const fx = await resolveFxRate({
      tenantId: normalizedTenantId,
      rateDate,
      fromCurrencyCode: sourceCurrencyCode,
      toCurrencyCode: presentationCurrencyCode,
      preferredRateType,
      runQuery,
    });
    const numericRate = Number(fx.rate || 0);
    fxRateCache.set(cacheKey, numericRate);
    return numericRate;
  }

  const baseResult = await runQuery(
    `SELECT
       cre.group_account_id AS account_id,
       a.code AS account_code,
       a.name AS account_name,
       a.account_type,
       SUM(cre.translated_debit) AS debit_total,
       SUM(cre.translated_credit) AS credit_total,
       SUM(cre.translated_balance) AS balance_total
     FROM consolidation_run_entries cre
     JOIN accounts a ON a.id = cre.group_account_id
     WHERE cre.consolidation_run_id = ?
     GROUP BY cre.group_account_id, a.code, a.name, a.account_type`,
    [runId]
  );

  for (const row of baseResult.rows || []) {
    const accountId = parsePositiveInt(row.account_id);
    if (!accountId) {
      continue;
    }
    const target = ensureAccount(
      accountId,
      row.account_code,
      row.account_name,
      row.account_type
    );
    addAmounts(
      target,
      "base",
      Number(row.debit_total || 0),
      Number(row.credit_total || 0),
      Number(row.balance_total || 0)
    );
  }

  const adjustmentResult = await runQuery(
    `SELECT
       ca.account_id,
       a.code AS account_code,
       a.name AS account_name,
       a.account_type,
       ca.currency_code,
       SUM(ca.debit_amount) AS debit_total,
       SUM(ca.credit_amount) AS credit_total
     FROM consolidation_adjustments ca
     JOIN accounts a ON a.id = ca.account_id
     WHERE ca.consolidation_run_id = ?
       AND ca.status IN (${statusPlaceholders})
     GROUP BY
       ca.account_id,
       a.code,
       a.name,
       a.account_type,
       ca.currency_code`,
    [runId, ...statusFilter]
  );

  for (const row of adjustmentResult.rows || []) {
    const accountId = parsePositiveInt(row.account_id);
    if (!accountId) {
      continue;
    }
    const rate = await resolveCachedRate(row.currency_code);
    const debit = Number(row.debit_total || 0) * rate;
    const credit = Number(row.credit_total || 0) * rate;
    const balance =
      (Number(row.debit_total || 0) - Number(row.credit_total || 0)) * rate;
    const target = ensureAccount(
      accountId,
      row.account_code,
      row.account_name,
      row.account_type
    );
    addAmounts(target, "adjustment", debit, credit, balance);
  }

  const eliminationResult = await runQuery(
    `SELECT
       el.account_id,
       a.code AS account_code,
       a.name AS account_name,
       a.account_type,
       el.currency_code,
       SUM(el.debit_amount) AS debit_total,
       SUM(el.credit_amount) AS credit_total
     FROM elimination_entries ee
     JOIN elimination_lines el ON el.elimination_entry_id = ee.id
     JOIN accounts a ON a.id = el.account_id
     WHERE ee.consolidation_run_id = ?
       AND ee.status IN (${statusPlaceholders})
     GROUP BY
       el.account_id,
       a.code,
       a.name,
       a.account_type,
       el.currency_code`,
    [runId, ...statusFilter]
  );

  for (const row of eliminationResult.rows || []) {
    const accountId = parsePositiveInt(row.account_id);
    if (!accountId) {
      continue;
    }
    const rate = await resolveCachedRate(row.currency_code);
    const debit = Number(row.debit_total || 0) * rate;
    const credit = Number(row.credit_total || 0) * rate;
    const balance =
      (Number(row.debit_total || 0) - Number(row.credit_total || 0)) * rate;
    const target = ensureAccount(
      accountId,
      row.account_code,
      row.account_name,
      row.account_type
    );
    addAmounts(target, "elimination", debit, credit, balance);
  }

  return {
    statusFilter,
    presentationCurrencyCode,
    rows: Array.from(accountMap.values()),
  };
}

/**
 * Summarize consolidated report rows into the same publish-math checks used by
 * the live balance sheet and trial balance surfaces.
 */
export function summarizeConsolidationRunReportMath({
  rows,
  balanceEpsilon = CONSOLIDATION_REPORT_BALANCE_EPSILON,
}) {
  const reportRows = Array.isArray(rows) ? rows : [];
  const totals = {
    assetsTotal: 0,
    liabilitiesTotal: 0,
    equityTotal: 0,
    revenueTotal: 0,
    expenseTotal: 0,
    finalDebitTotal: 0,
    finalCreditTotal: 0,
  };

  for (const row of reportRows) {
    const accountType = String(row?.accountType || row?.account_type || "")
      .trim()
      .toUpperCase();
    const finalBalance = Number(row?.finalBalance || row?.final_balance || 0);
    const normalizedFinalBalance = normalizeConsolidationBalanceByAccountType(
      accountType,
      finalBalance
    );
    const finalDebit = Number(row?.finalDebit || row?.final_debit || 0);
    const finalCredit = Number(row?.finalCredit || row?.final_credit || 0);

    totals.finalDebitTotal += finalDebit;
    totals.finalCreditTotal += finalCredit;

    if (accountType === "ASSET") {
      totals.assetsTotal += normalizedFinalBalance;
    } else if (accountType === "LIABILITY") {
      totals.liabilitiesTotal += normalizedFinalBalance;
    } else if (accountType === "EQUITY") {
      totals.equityTotal += normalizedFinalBalance;
    } else if (accountType === "REVENUE") {
      totals.revenueTotal += normalizedFinalBalance;
    } else if (accountType === "EXPENSE") {
      totals.expenseTotal += normalizedFinalBalance;
    }
  }

  const currentPeriodEarnings = totals.revenueTotal - totals.expenseTotal;
  const trialBalanceDelta = totals.finalDebitTotal - totals.finalCreditTotal;
  const equationDelta =
    totals.assetsTotal -
    (totals.liabilitiesTotal +
      totals.equityTotal +
      currentPeriodEarnings);

  return {
    ...totals,
    currentPeriodEarnings,
    trialBalanceDelta,
    equationDelta,
    balanceEpsilon,
    hasTrialBalanceImbalance:
      Math.abs(Number(trialBalanceDelta || 0)) > balanceEpsilon,
    hasBalanceSheetEquationGap:
      Math.abs(Number(equationDelta || 0)) > balanceEpsilon,
  };
}

export default {
  CONSOLIDATION_REPORT_BALANCE_EPSILON,
  loadConsolidationRunReportAccountBalances,
  normalizeConsolidationBalanceByAccountType,
  summarizeConsolidationRunReportMath,
};
