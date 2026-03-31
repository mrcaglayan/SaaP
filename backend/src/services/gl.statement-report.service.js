import { query } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";

const BALANCE_EPSILON = 0.0001;
const YEAR_END_CLOSE_REFERENCE_PREFIX = "PERIOD_CLOSE_RUN:%";
const YEAR_END_CLOSE_DESCRIPTION_PREFIX = "Auto year-end P&L close%";
const CURRENT_YEAR_RESULT_CONTROL_PREFIXES = Object.freeze([
  "590",
  "591",
  "690",
  "692",
]);
const STATEMENT_MAPPING_SOURCE =
  "TR_UNIFORM_CODE_BANDS_V1_WITH_ACCOUNT_TYPE_FALLBACK";

const BALANCE_SHEET_DETAIL_ROW_DEFINITIONS = Object.freeze([
  Object.freeze({
    key: "CURRENT_ASSETS",
    label: "Donen Varliklar",
    section: "ASSETS",
    rowKind: "DETAIL",
    presentationFactor: 1,
    accountTypes: Object.freeze(["ASSET"]),
    codePrefixes: Object.freeze(["1"]),
  }),
  Object.freeze({
    key: "NON_CURRENT_ASSETS",
    label: "Duran Varliklar",
    section: "ASSETS",
    rowKind: "DETAIL",
    presentationFactor: 1,
    accountTypes: Object.freeze(["ASSET"]),
    codePrefixes: Object.freeze(["2"]),
  }),
  Object.freeze({
    key: "OTHER_ASSETS",
    label: "Diger Varliklar",
    section: "ASSETS",
    rowKind: "DETAIL",
    presentationFactor: 1,
    accountTypes: Object.freeze(["ASSET"]),
    fallback: true,
  }),
  Object.freeze({
    key: "SHORT_TERM_LIABILITIES",
    label: "Kisa Vadeli Yukumlulukler",
    section: "LIABILITIES_AND_EQUITY",
    rowKind: "DETAIL",
    presentationFactor: -1,
    accountTypes: Object.freeze(["LIABILITY"]),
    codePrefixes: Object.freeze(["3"]),
  }),
  Object.freeze({
    key: "LONG_TERM_LIABILITIES",
    label: "Uzun Vadeli Yukumlulukler",
    section: "LIABILITIES_AND_EQUITY",
    rowKind: "DETAIL",
    presentationFactor: -1,
    accountTypes: Object.freeze(["LIABILITY"]),
    codePrefixes: Object.freeze(["4"]),
  }),
  Object.freeze({
    key: "OTHER_LIABILITIES",
    label: "Diger Yukumlulukler",
    section: "LIABILITIES_AND_EQUITY",
    rowKind: "DETAIL",
    presentationFactor: -1,
    accountTypes: Object.freeze(["LIABILITY"]),
    fallback: true,
  }),
  Object.freeze({
    key: "POSTED_EQUITY",
    label: "Ozkaynaklar",
    section: "LIABILITIES_AND_EQUITY",
    rowKind: "DETAIL",
    presentationFactor: -1,
    accountTypes: Object.freeze(["EQUITY"]),
    codePrefixes: Object.freeze(["5"]),
    excludeCodePrefixes: CURRENT_YEAR_RESULT_CONTROL_PREFIXES,
  }),
  Object.freeze({
    key: "OTHER_EQUITY",
    label: "Diger Ozkaynaklar",
    section: "LIABILITIES_AND_EQUITY",
    rowKind: "DETAIL",
    presentationFactor: -1,
    accountTypes: Object.freeze(["EQUITY"]),
    excludeCodePrefixes: CURRENT_YEAR_RESULT_CONTROL_PREFIXES,
    fallback: true,
  }),
]);

const INCOME_STATEMENT_DETAIL_ROW_DEFINITIONS = Object.freeze([
  Object.freeze({
    key: "GROSS_SALES",
    label: "Brut Satislar",
    section: "INCOME",
    rowKind: "DETAIL",
    presentationFactor: -1,
    codePrefixes: Object.freeze(["60"]),
  }),
  Object.freeze({
    key: "SALES_DISCOUNTS",
    label: "Satis Indirimleri",
    section: "INCOME",
    rowKind: "DETAIL",
    // Contra-revenue stays positive as a deduction row; NET_SALES subtracts it.
    presentationFactor: 1,
    codePrefixes: Object.freeze(["61"]),
  }),
  Object.freeze({
    key: "COST_OF_SALES",
    label: "Satislarin Maliyeti",
    section: "INCOME",
    rowKind: "DETAIL",
    presentationFactor: 1,
    codePrefixes: Object.freeze(["62"]),
  }),
  Object.freeze({
    key: "OPERATING_EXPENSES",
    label: "Faaliyet Giderleri",
    section: "INCOME",
    rowKind: "DETAIL",
    presentationFactor: 1,
    codePrefixes: Object.freeze(["63"]),
  }),
  Object.freeze({
    key: "OTHER_OPERATING_INCOME",
    label: "Diger Faaliyet Gelirleri",
    section: "INCOME",
    rowKind: "DETAIL",
    presentationFactor: -1,
    codePrefixes: Object.freeze(["64"]),
  }),
  Object.freeze({
    key: "OTHER_OPERATING_EXPENSES",
    label: "Diger Faaliyet Giderleri",
    section: "INCOME",
    rowKind: "DETAIL",
    presentationFactor: 1,
    codePrefixes: Object.freeze(["65"]),
  }),
  Object.freeze({
    key: "FINANCIAL_EXPENSES",
    label: "Finansman Giderleri",
    section: "INCOME",
    rowKind: "DETAIL",
    presentationFactor: 1,
    codePrefixes: Object.freeze(["66"]),
  }),
  Object.freeze({
    key: "EXTRAORDINARY_INCOME",
    label: "Olagandisi Gelir ve Karlar",
    section: "INCOME",
    rowKind: "DETAIL",
    presentationFactor: -1,
    codePrefixes: Object.freeze(["67"]),
  }),
  Object.freeze({
    key: "EXTRAORDINARY_EXPENSES",
    label: "Olagandisi Gider ve Zararlar",
    section: "INCOME",
    rowKind: "DETAIL",
    presentationFactor: 1,
    codePrefixes: Object.freeze(["68"]),
  }),
  Object.freeze({
    key: "TAX_AND_LEGAL_OBLIGATIONS",
    label: "Donem Vergi ve Yasal Yukumlulukler",
    section: "INCOME",
    rowKind: "DETAIL",
    presentationFactor: 1,
    codePrefixes: Object.freeze(["691"]),
  }),
  Object.freeze({
    key: "OTHER_REVENUE",
    label: "Diger Gelirler",
    section: "INCOME",
    rowKind: "DETAIL",
    presentationFactor: -1,
    accountTypes: Object.freeze(["REVENUE"]),
    fallback: true,
  }),
  Object.freeze({
    key: "OTHER_EXPENSES",
    label: "Diger Giderler",
    section: "INCOME",
    rowKind: "DETAIL",
    presentationFactor: 1,
    accountTypes: Object.freeze(["EXPENSE"]),
    fallback: true,
  }),
]);

const INCOME_SYNTHETIC_ROW_DEFINITIONS = Object.freeze([
  Object.freeze({
    key: "NET_SALES",
    label: "Net Satislar",
    rowKind: "TOTAL",
    section: "INCOME",
    sources: Object.freeze([
      Object.freeze({ rowKey: "GROSS_SALES", sign: 1 }),
      Object.freeze({ rowKey: "SALES_DISCOUNTS", sign: -1 }),
    ]),
  }),
  Object.freeze({
    key: "GROSS_PROFIT_LOSS",
    label: "Brut Kar / Zarar",
    rowKind: "TOTAL",
    section: "INCOME",
    sources: Object.freeze([
      Object.freeze({ rowKey: "NET_SALES", sign: 1 }),
      Object.freeze({ rowKey: "COST_OF_SALES", sign: -1 }),
    ]),
  }),
  Object.freeze({
    key: "OPERATING_PROFIT_LOSS",
    label: "Faaliyet Kari / Zarari",
    rowKind: "TOTAL",
    section: "INCOME",
    sources: Object.freeze([
      Object.freeze({ rowKey: "GROSS_PROFIT_LOSS", sign: 1 }),
      Object.freeze({ rowKey: "OPERATING_EXPENSES", sign: -1 }),
      Object.freeze({ rowKey: "OTHER_OPERATING_INCOME", sign: 1 }),
      Object.freeze({ rowKey: "OTHER_OPERATING_EXPENSES", sign: -1 }),
    ]),
  }),
  Object.freeze({
    key: "PROFIT_BEFORE_TAX",
    label: "Vergi Oncesi Kar / Zarar",
    rowKind: "TOTAL",
    section: "INCOME",
    sources: Object.freeze([
      Object.freeze({ rowKey: "OPERATING_PROFIT_LOSS", sign: 1 }),
      Object.freeze({ rowKey: "FINANCIAL_EXPENSES", sign: -1 }),
      Object.freeze({ rowKey: "EXTRAORDINARY_INCOME", sign: 1 }),
      Object.freeze({ rowKey: "EXTRAORDINARY_EXPENSES", sign: -1 }),
      Object.freeze({ rowKey: "OTHER_REVENUE", sign: 1 }),
      Object.freeze({ rowKey: "OTHER_EXPENSES", sign: -1 }),
    ]),
  }),
  Object.freeze({
    key: "NET_INCOME_LOSS",
    label: "Net Donem Kari / Zarari",
    rowKind: "TOTAL",
    section: "INCOME",
    sources: Object.freeze([
      Object.freeze({ rowKey: "PROFIT_BEFORE_TAX", sign: 1 }),
      Object.freeze({ rowKey: "TAX_AND_LEGAL_OBLIGATIONS", sign: -1 }),
    ]),
  }),
]);

const BALANCE_SHEET_SYNTHETIC_ROW_DEFINITIONS = Object.freeze([
  Object.freeze({
    key: "ASSETS_TOTAL",
    label: "Toplam Varliklar",
    rowKind: "TOTAL",
    section: "ASSETS",
    sources: Object.freeze([
      Object.freeze({ rowKey: "CURRENT_ASSETS", sign: 1 }),
      Object.freeze({ rowKey: "NON_CURRENT_ASSETS", sign: 1 }),
      Object.freeze({ rowKey: "OTHER_ASSETS", sign: 1 }),
    ]),
  }),
  Object.freeze({
    key: "LIABILITIES_AND_EQUITY_TOTAL",
    label: "Toplam Yukumluluk ve Ozkaynak",
    rowKind: "TOTAL",
    section: "LIABILITIES_AND_EQUITY",
    sources: Object.freeze([
      Object.freeze({ rowKey: "SHORT_TERM_LIABILITIES", sign: 1 }),
      Object.freeze({ rowKey: "LONG_TERM_LIABILITIES", sign: 1 }),
      Object.freeze({ rowKey: "OTHER_LIABILITIES", sign: 1 }),
      Object.freeze({ rowKey: "POSTED_EQUITY", sign: 1 }),
      Object.freeze({ rowKey: "OTHER_EQUITY", sign: 1 }),
      Object.freeze({ rowKey: "CURRENT_YEAR_RESULT", sign: 1 }),
    ]),
  }),
]);

function toAmount(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isNearlyZero(value) {
  return Math.abs(toAmount(value)) < BALANCE_EPSILON;
}

function normalizeCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function formatPeriodLabel(row) {
  if (!row) {
    return "";
  }
  return `FY${row.fiscal_year} P${String(row.period_no).padStart(2, "0")} - ${row.period_name}`;
}

function accountCodeStartsWithAny(code, prefixes = []) {
  const normalizedCode = normalizeCode(code);
  return (Array.isArray(prefixes) ? prefixes : []).some((prefix) =>
    normalizedCode.startsWith(normalizeCode(prefix))
  );
}

function sumContributionAmounts(rows = []) {
  return rows.reduce(
    (sum, row) => sum + toAmount(row?.contributionAmount),
    0
  );
}

function cloneContributionRow(row, sign = 1) {
  return {
    ...row,
    contributionAmount: toAmount(row?.contributionAmount) * sign,
  };
}

function mergeContributionRows(rows = []) {
  const byAccountId = new Map();

  for (const row of rows) {
    const accountId = parsePositiveInt(row?.accountId);
    if (!accountId) {
      continue;
    }

    const current = byAccountId.get(accountId);
    if (!current) {
      byAccountId.set(accountId, {
        ...row,
        contributionAmount: toAmount(row?.contributionAmount),
      });
      continue;
    }

    current.contributionAmount += toAmount(row?.contributionAmount);
    current.debitTotal += toAmount(row?.debitTotal);
    current.creditTotal += toAmount(row?.creditTotal);
    current.rawBalance += toAmount(row?.rawBalance);
  }

  return Array.from(byAccountId.values()).sort((left, right) => {
    const codeCompare = normalizeCode(left.accountCode).localeCompare(
      normalizeCode(right.accountCode)
    );
    if (codeCompare !== 0) {
      return codeCompare;
    }
    return Number(left.accountId || 0) - Number(right.accountId || 0);
  });
}

function normalizeBalanceRow(row, presentationFactor) {
  return {
    accountId: parsePositiveInt(row?.account_id),
    accountCode: String(row?.account_code || ""),
    accountName: String(row?.account_name || ""),
    accountType: normalizeCode(row?.account_type),
    normalSide: normalizeCode(row?.normal_side),
    debitTotal: toAmount(row?.debit_total),
    creditTotal: toAmount(row?.credit_total),
    rawBalance: toAmount(row?.raw_balance),
    contributionAmount: toAmount(row?.raw_balance) * presentationFactor,
  };
}

function isCurrentYearResultControlAccount(accountCode) {
  return accountCodeStartsWithAny(
    accountCode,
    CURRENT_YEAR_RESULT_CONTROL_PREFIXES
  );
}

function matchesDetailRow(definition, row, unmatchedOnly) {
  const accountCode = normalizeCode(row?.account_code);
  const accountType = normalizeCode(row?.account_type);

  if (
    Array.isArray(definition.excludeCodePrefixes) &&
    accountCodeStartsWithAny(accountCode, definition.excludeCodePrefixes)
  ) {
    return false;
  }
  if (unmatchedOnly && !definition.fallback) {
    return false;
  }
  if (!unmatchedOnly && definition.fallback) {
    return false;
  }
  if (
    Array.isArray(definition.accountTypes) &&
    !definition.accountTypes.includes(accountType)
  ) {
    return false;
  }
  if (
    Array.isArray(definition.codePrefixes) &&
    !accountCodeStartsWithAny(accountCode, definition.codePrefixes)
  ) {
    return false;
  }

  return true;
}

function classifyDetailRows(balanceRows, definitions) {
  const rowsByDetailKey = new Map(
    definitions.map((definition) => [definition.key, []])
  );
  const matchedAccountIds = new Set();

  for (const row of balanceRows || []) {
    const accountId = parsePositiveInt(row?.account_id);
    if (!accountId) {
      continue;
    }
    if (isCurrentYearResultControlAccount(row?.account_code)) {
      continue;
    }

    const primaryMatch = definitions.find((definition) =>
      matchesDetailRow(definition, row, false)
    );
    if (primaryMatch) {
      rowsByDetailKey
        .get(primaryMatch.key)
        .push(normalizeBalanceRow(row, primaryMatch.presentationFactor));
      matchedAccountIds.add(accountId);
      continue;
    }

    const fallbackMatch = definitions.find((definition) => {
      if (!definition.fallback || matchedAccountIds.has(accountId)) {
        return false;
      }
      return matchesDetailRow(definition, row, true);
    });
    if (!fallbackMatch) {
      continue;
    }
    rowsByDetailKey
      .get(fallbackMatch.key)
      .push(normalizeBalanceRow(row, fallbackMatch.presentationFactor));
    matchedAccountIds.add(accountId);
  }

  return rowsByDetailKey;
}

function buildDetailRowStates(definitions, classifiedRows, includeZero) {
  const rowStates = new Map();

  for (const definition of definitions) {
    const accountRows = mergeContributionRows(classifiedRows.get(definition.key) || []);
    const amount = sumContributionAmounts(accountRows);
    rowStates.set(definition.key, {
      key: definition.key,
      label: definition.label,
      section: definition.section,
      rowKind: definition.rowKind,
      isSynthetic: false,
      drillthroughEnabled: accountRows.length > 0,
      amount,
      accountRows,
      accountCount: accountRows.length,
      hidden: !includeZero && isNearlyZero(amount),
    });
  }

  return rowStates;
}

function buildSyntheticRowState(definition, sourceStateByKey, includeZero) {
  const sourceStates = (definition.sources || [])
    .map((source) => ({
      source,
      rowState: sourceStateByKey.get(source.rowKey) || null,
    }))
    .filter((row) => row.rowState);

  const amount = sourceStates.reduce(
    (sum, row) => sum + toAmount(row.rowState.amount) * toAmount(row.source.sign),
    0
  );
  const accountRows = mergeContributionRows(
    sourceStates.flatMap((row) =>
      (row.rowState.accountRows || []).map((accountRow) =>
        cloneContributionRow(accountRow, toAmount(row.source.sign))
      )
    )
  );

  return {
    key: definition.key,
    label: definition.label,
    section: definition.section,
    rowKind: definition.rowKind,
    isSynthetic: true,
    drillthroughEnabled: accountRows.length > 0,
    amount,
    accountRows,
    accountCount: accountRows.length,
    hidden: !includeZero && isNearlyZero(amount),
  };
}

async function loadBookDisplayRow(tenantId, bookId, runQuery = query) {
  const result = await runQuery(
    `SELECT
       id,
       legal_entity_id,
       calendar_id,
       code,
       name,
       base_currency_code
     FROM books
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, bookId]
  );
  return result.rows[0] || null;
}

async function loadPeriodContext(calendarId, fiscalPeriodId, runQuery = query) {
  const result = await runQuery(
    `SELECT
       id,
       fiscal_year,
       period_no,
       period_name,
       start_date,
       end_date,
       is_adjustment
     FROM fiscal_periods
     WHERE calendar_id = ?
     ORDER BY fiscal_year ASC, period_no ASC, is_adjustment ASC, id ASC`,
    [calendarId]
  );
  const rows = Array.isArray(result.rows) ? result.rows : [];
  const selectedPeriod = rows.find(
    (row) => Number(row.id) === Number(fiscalPeriodId)
  );
  if (!selectedPeriod) {
    throw badRequest("fiscalPeriodId not found for the selected book calendar");
  }

  const fiscalYearPeriods = rows.filter(
    (row) => Number(row.fiscal_year) === Number(selectedPeriod.fiscal_year)
  );
  const selectedIndex = fiscalYearPeriods.findIndex(
    (row) => Number(row.id) === Number(fiscalPeriodId)
  );
  if (selectedIndex < 0) {
    throw badRequest("fiscalPeriodId not found within the selected fiscal year");
  }

  const selectedYearPeriods = fiscalYearPeriods.slice(0, selectedIndex + 1);
  const fiscalYearStartPeriod = selectedYearPeriods[0] || null;

  return {
    selectedPeriod,
    fiscalYear: Number(selectedPeriod.fiscal_year || 0),
    fiscalYearStartPeriod,
    selectedYearPeriods,
    asOfDate: String(selectedPeriod.end_date || "").slice(0, 10),
    ytdStartDate: String(fiscalYearStartPeriod?.start_date || "").slice(0, 10),
    ytdEndDate: String(selectedPeriod.end_date || "").slice(0, 10),
  };
}

async function loadBalanceRows({
  tenantId,
  bookId,
  legalEntityId,
  startDate = "",
  endDate = "",
  excludeSystemYearEndClose = false,
  runQuery = query,
}) {
  const conditions = [
    "je.tenant_id = ?",
    "je.book_id = ?",
    "je.status = 'POSTED'",
    "(c.legal_entity_id IS NULL OR c.legal_entity_id = ?)",
  ];
  const params = [tenantId, bookId, legalEntityId];

  if (startDate) {
    conditions.push("je.entry_date >= ?");
    params.push(startDate);
  }
  if (endDate) {
    conditions.push("je.entry_date <= ?");
    params.push(endDate);
  }
  if (excludeSystemYearEndClose) {
    // Keep YTD income readable after year-end close by excluding the auto
    // transfer journal that only zeros P&L into retained earnings.
    conditions.push("NOT (je.reference_no LIKE ? AND je.description LIKE ?)");
    params.push(
      YEAR_END_CLOSE_REFERENCE_PREFIX,
      YEAR_END_CLOSE_DESCRIPTION_PREFIX
    );
  }

  const result = await runQuery(
    `SELECT
       a.id AS account_id,
       a.code AS account_code,
       a.name AS account_name,
       a.account_type,
       a.normal_side,
       SUM(jl.debit_base) AS debit_total,
       SUM(jl.credit_base) AS credit_total,
       SUM(jl.debit_base - jl.credit_base) AS raw_balance
     FROM journal_entries je
     JOIN journal_lines jl ON jl.journal_entry_id = je.id
     JOIN accounts a ON a.id = jl.account_id
     JOIN charts_of_accounts c ON c.id = a.coa_id
     WHERE ${conditions.join(" AND ")}
     GROUP BY
       a.id,
       a.code,
       a.name,
       a.account_type,
       a.normal_side
     ORDER BY a.code ASC, a.id ASC`,
    params
  );

  return Array.isArray(result.rows) ? result.rows : [];
}

async function hasPostedYearEndCloseForPeriod({
  tenantId,
  bookId,
  fiscalPeriodId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT 1
     FROM journal_entries
     WHERE tenant_id = ?
       AND book_id = ?
       AND fiscal_period_id = ?
       AND status = 'POSTED'
       AND reference_no LIKE ?
       AND description LIKE ?
     LIMIT 1`,
    [
      tenantId,
      bookId,
      fiscalPeriodId,
      YEAR_END_CLOSE_REFERENCE_PREFIX,
      YEAR_END_CLOSE_DESCRIPTION_PREFIX,
    ]
  );
  return Boolean(result.rows[0]);
}

function buildControlCodeWarnings(rows = [], isReportClosed) {
  const impactedCodes = (rows || [])
    .filter(
      (row) =>
        isCurrentYearResultControlAccount(row?.account_code) &&
        !isNearlyZero(row?.raw_balance)
    )
    .map((row) => normalizeCode(row.account_code));

  if (impactedCodes.length === 0) {
    return [];
  }

  const joinedCodes = Array.from(new Set(impactedCodes)).join(", ");
  if (isReportClosed) {
    return [
      `Posted balances exist on current-year-result control codes ${joinedCodes}. RP05 keeps the balance-sheet current-year-result row at zero after year-end close and does not double count those control balances in posted equity detail.`,
    ];
  }

  return [
    `Posted balances exist on current-year-result control codes ${joinedCodes}. RP05 keeps current-year result on the synthetic row and excludes those control balances from posted equity detail to avoid double counting.`,
  ];
}

function buildIncomeStatementComputation(ytdRows, includeZero) {
  const classifiedDetailRows = classifyDetailRows(
    ytdRows,
    INCOME_STATEMENT_DETAIL_ROW_DEFINITIONS
  );
  const rowStateByKey = buildDetailRowStates(
    INCOME_STATEMENT_DETAIL_ROW_DEFINITIONS,
    classifiedDetailRows,
    includeZero
  );

  for (const definition of INCOME_SYNTHETIC_ROW_DEFINITIONS) {
    rowStateByKey.set(
      definition.key,
      buildSyntheticRowState(definition, rowStateByKey, includeZero)
    );
  }

  const orderedRowKeys = [
    "GROSS_SALES",
    "SALES_DISCOUNTS",
    "NET_SALES",
    "COST_OF_SALES",
    "GROSS_PROFIT_LOSS",
    "OPERATING_EXPENSES",
    "OTHER_OPERATING_INCOME",
    "OTHER_OPERATING_EXPENSES",
    "OPERATING_PROFIT_LOSS",
    "FINANCIAL_EXPENSES",
    "EXTRAORDINARY_INCOME",
    "EXTRAORDINARY_EXPENSES",
    "PROFIT_BEFORE_TAX",
    "TAX_AND_LEGAL_OBLIGATIONS",
    "NET_INCOME_LOSS",
    "OTHER_REVENUE",
    "OTHER_EXPENSES",
  ];

  const rows = orderedRowKeys
    .map((rowKey) => rowStateByKey.get(rowKey) || null)
    .filter(Boolean)
    .filter((row) => !row.hidden);

  return {
    rowStateByKey,
    rows,
    totals: {
      netSales: toAmount(rowStateByKey.get("NET_SALES")?.amount),
      grossProfitLoss: toAmount(rowStateByKey.get("GROSS_PROFIT_LOSS")?.amount),
      operatingProfitLoss: toAmount(
        rowStateByKey.get("OPERATING_PROFIT_LOSS")?.amount
      ),
      profitBeforeTax: toAmount(
        rowStateByKey.get("PROFIT_BEFORE_TAX")?.amount
      ),
      taxAndLegalObligations: toAmount(
        rowStateByKey.get("TAX_AND_LEGAL_OBLIGATIONS")?.amount
      ),
      netIncomeLoss: toAmount(rowStateByKey.get("NET_INCOME_LOSS")?.amount),
    },
  };
}

function buildBalanceSheetComputation({
  balanceSheetRows,
  incomeStatementComputation,
  includeZero,
  yearEndClosePosted,
}) {
  const classifiedDetailRows = classifyDetailRows(
    balanceSheetRows,
    BALANCE_SHEET_DETAIL_ROW_DEFINITIONS
  );
  const rowStateByKey = buildDetailRowStates(
    BALANCE_SHEET_DETAIL_ROW_DEFINITIONS,
    classifiedDetailRows,
    includeZero
  );

  rowStateByKey.set(
    "ASSETS_TOTAL",
    buildSyntheticRowState(
      BALANCE_SHEET_SYNTHETIC_ROW_DEFINITIONS[0],
      rowStateByKey,
      includeZero
    )
  );

  const currentYearResultAccounts = yearEndClosePosted
    ? []
    : (incomeStatementComputation?.rowStateByKey.get("NET_INCOME_LOSS")
        ?.accountRows || []
      ).map((row) => cloneContributionRow(row, 1));
  const currentYearResultAmount = yearEndClosePosted
    ? 0
    : sumContributionAmounts(currentYearResultAccounts);
  rowStateByKey.set("CURRENT_YEAR_RESULT", {
    key: "CURRENT_YEAR_RESULT",
    label: "Cari Donem Sonucu",
    section: "LIABILITIES_AND_EQUITY",
    rowKind: "DETAIL",
    isSynthetic: true,
    drillthroughEnabled: currentYearResultAccounts.length > 0,
    amount: currentYearResultAmount,
    accountRows: mergeContributionRows(currentYearResultAccounts),
    accountCount: currentYearResultAccounts.length,
    hidden: !includeZero && isNearlyZero(currentYearResultAmount),
  });

  rowStateByKey.set(
    "LIABILITIES_AND_EQUITY_TOTAL",
    buildSyntheticRowState(
      BALANCE_SHEET_SYNTHETIC_ROW_DEFINITIONS[1],
      rowStateByKey,
      includeZero
    )
  );

  rowStateByKey.set("EQUATION_DELTA", {
    key: "EQUATION_DELTA",
    label: "Bilanco Denklem Farki",
    section: "LIABILITIES_AND_EQUITY",
    rowKind: "CHECK",
    isSynthetic: true,
    drillthroughEnabled: false,
    amount:
      toAmount(rowStateByKey.get("ASSETS_TOTAL")?.amount) -
      toAmount(rowStateByKey.get("LIABILITIES_AND_EQUITY_TOTAL")?.amount),
    accountRows: [],
    accountCount: 0,
    hidden: false,
  });

  const orderedRowKeys = [
    "CURRENT_ASSETS",
    "NON_CURRENT_ASSETS",
    "OTHER_ASSETS",
    "ASSETS_TOTAL",
    "SHORT_TERM_LIABILITIES",
    "LONG_TERM_LIABILITIES",
    "OTHER_LIABILITIES",
    "POSTED_EQUITY",
    "OTHER_EQUITY",
    "CURRENT_YEAR_RESULT",
    "LIABILITIES_AND_EQUITY_TOTAL",
    "EQUATION_DELTA",
  ];

  const rows = orderedRowKeys
    .map((rowKey) => rowStateByKey.get(rowKey) || null)
    .filter(Boolean)
    .filter((row) => !row.hidden || row.key === "EQUATION_DELTA");

  return {
    rowStateByKey,
    rows,
    totals: {
      assetsTotal: toAmount(rowStateByKey.get("ASSETS_TOTAL")?.amount),
      liabilitiesTotal:
        toAmount(rowStateByKey.get("SHORT_TERM_LIABILITIES")?.amount) +
        toAmount(rowStateByKey.get("LONG_TERM_LIABILITIES")?.amount) +
        toAmount(rowStateByKey.get("OTHER_LIABILITIES")?.amount),
      postedEquityTotal:
        toAmount(rowStateByKey.get("POSTED_EQUITY")?.amount) +
        toAmount(rowStateByKey.get("OTHER_EQUITY")?.amount),
      currentYearResult: toAmount(
        rowStateByKey.get("CURRENT_YEAR_RESULT")?.amount
      ),
      liabilitiesAndEquityTotal: toAmount(
        rowStateByKey.get("LIABILITIES_AND_EQUITY_TOTAL")?.amount
      ),
      equationDelta: toAmount(rowStateByKey.get("EQUATION_DELTA")?.amount),
    },
  };
}

async function buildLocalStatementContext({
  tenantId,
  book,
  fiscalPeriodId,
  includeZero = false,
  runQuery = query,
}) {
  const parsedTenantId = parsePositiveInt(tenantId);
  const parsedBookId = parsePositiveInt(book?.id);
  if (!parsedTenantId || !parsedBookId) {
    throw badRequest("tenantId and bookId are required");
  }

  const bookDisplay = await loadBookDisplayRow(parsedTenantId, parsedBookId, runQuery);
  if (!bookDisplay) {
    throw badRequest("bookId not found for tenant");
  }

  const legalEntityId = parsePositiveInt(bookDisplay.legal_entity_id) || null;
  const periodContext = await loadPeriodContext(
    parsePositiveInt(bookDisplay.calendar_id),
    fiscalPeriodId,
    runQuery
  );
  const yearEndClosePosted = await hasPostedYearEndCloseForPeriod({
    tenantId: parsedTenantId,
    bookId: parsedBookId,
    fiscalPeriodId,
    runQuery,
  });

  const [balanceSheetRows, incomeStatementRows] = await Promise.all([
    loadBalanceRows({
      tenantId: parsedTenantId,
      bookId: parsedBookId,
      legalEntityId,
      endDate: periodContext.asOfDate,
      runQuery,
    }),
    loadBalanceRows({
      tenantId: parsedTenantId,
      bookId: parsedBookId,
      legalEntityId,
      startDate: periodContext.ytdStartDate,
      endDate: periodContext.ytdEndDate,
      excludeSystemYearEndClose: true,
      runQuery,
    }),
  ]);

  const incomeStatementComputation = buildIncomeStatementComputation(
    incomeStatementRows,
    includeZero
  );
  const balanceSheetComputation = buildBalanceSheetComputation({
    balanceSheetRows,
    incomeStatementComputation,
    includeZero,
    yearEndClosePosted,
  });

  return {
    bookDisplay,
    periodContext,
    yearEndClosePosted,
    incomeStatementComputation,
    balanceSheetComputation,
    warnings: buildControlCodeWarnings(balanceSheetRows, yearEndClosePosted),
  };
}

function buildBaseFilters(bookDisplay, fiscalPeriodId, includeZero) {
  return {
    scope: "LOCAL",
    reportBasis: "POSTED",
    periodBasis: "FISCAL_PERIOD",
    legalEntityId: parsePositiveInt(bookDisplay?.legal_entity_id) || null,
    bookId: parsePositiveInt(bookDisplay?.id) || null,
    fiscalPeriodId: parsePositiveInt(fiscalPeriodId) || null,
    includeZero: Boolean(includeZero),
  };
}

function buildBookPayload(bookDisplay) {
  return {
    id: parsePositiveInt(bookDisplay?.id) || null,
    code: String(bookDisplay?.code || ""),
    name: String(bookDisplay?.name || ""),
    legalEntityId: parsePositiveInt(bookDisplay?.legal_entity_id) || null,
    baseCurrencyCode: String(bookDisplay?.base_currency_code || "").toUpperCase(),
  };
}

function buildRangePayload(periodContext) {
  return {
    periodBasis: "FISCAL_PERIOD",
    fiscalYear: Number(periodContext?.fiscalYear || 0),
    fiscalPeriodId: parsePositiveInt(periodContext?.selectedPeriod?.id) || null,
    fiscalYearStartPeriodId:
      parsePositiveInt(periodContext?.fiscalYearStartPeriod?.id) || null,
    periodLabel: formatPeriodLabel(periodContext?.selectedPeriod),
    fiscalYearStartDate: String(periodContext?.ytdStartDate || ""),
    periodEndDate: String(periodContext?.asOfDate || ""),
  };
}

function toStatementRowPayload(row) {
  return {
    key: row.key,
    label: row.label,
    section: row.section,
    rowKind: row.rowKind,
    isSynthetic: Boolean(row.isSynthetic),
    drillthroughEnabled: Boolean(row.drillthroughEnabled),
    accountCount: Number(row.accountCount || 0),
    amount: toAmount(row.amount),
  };
}

function resolveStatementRowState(statementType, statementRowKey, context) {
  const rowKey = normalizeCode(statementRowKey);
  if (statementType === "BALANCE_SHEET") {
    return context.balanceSheetComputation.rowStateByKey.get(rowKey) || null;
  }
  if (statementType === "INCOME_STATEMENT") {
    return context.incomeStatementComputation.rowStateByKey.get(rowKey) || null;
  }
  return null;
}

function buildStatementContractPayload(statementType, context) {
  if (statementType === "BALANCE_SHEET") {
    return {
      statementType,
      mappingSource: STATEMENT_MAPPING_SOURCE,
      statementBasis: "AS_OF_PERIOD_END",
      signPolicy: "ASSETS_DEBIT_POSITIVE_LIABILITIES_EQUITY_CREDIT_POSITIVE",
      retainedEarningsPolicy: "POSTED_EQUITY_BALANCES",
      currentYearResultPolicy: context.yearEndClosePosted
        ? "ZERO_AFTER_POSTED_YEAR_END_CLOSE"
        : "SYNTHETIC_FROM_YTD_INCOME_STATEMENT",
      currentYearResultYearEndClosed: Boolean(context.yearEndClosePosted),
    };
  }

  return {
    statementType,
    mappingSource: STATEMENT_MAPPING_SOURCE,
    statementBasis: "FISCAL_YEAR_TO_DATE",
    signPolicy: "INCOME_ROWS_POSITIVE_EXPENSE_ROWS_POSITIVE_DEDUCTIONS",
    retainedEarningsPolicy: "NOT_APPLICABLE",
    currentYearResultPolicy:
      "NET_RESULT_SYNTHETIC_FROM_YTD_REVENUE_EXPENSE_BANDS",
    excludesSystemYearEndClose: true,
  };
}

function buildStatementAccountSummaryPayload({
  statementType,
  statementRow,
  context,
}) {
  const book = buildBookPayload(context.bookDisplay);
  const range = buildRangePayload(context.periodContext);
  const contributionRows = mergeContributionRows(statementRow.accountRows || []);

  return {
    filters: {
      ...buildBaseFilters(
        context.bookDisplay,
        context.periodContext.selectedPeriod?.id,
        false
      ),
      statementType,
      statementRowKey: statementRow.key,
    },
    contract: buildStatementContractPayload(statementType, context),
    book,
    range,
    statementRow: toStatementRowPayload(statementRow),
    drillthrough: {
      reportType: "GENERAL_LEDGER",
      periodBasis: "FISCAL_PERIOD",
      fiscalPeriodIdFrom: range.fiscalYearStartPeriodId,
      fiscalPeriodIdTo: range.fiscalPeriodId,
    },
    summary: {
      amount: toAmount(statementRow.amount),
      accountCount: contributionRows.length,
    },
    rows: contributionRows.map((row) => ({
      accountId: parsePositiveInt(row.accountId) || null,
      accountCode: String(row.accountCode || ""),
      accountName: String(row.accountName || ""),
      accountType: String(row.accountType || ""),
      normalSide: String(row.normalSide || ""),
      debitTotal: toAmount(row.debitTotal),
      creditTotal: toAmount(row.creditTotal),
      rawBalance: toAmount(row.rawBalance),
      contributionAmount: toAmount(row.contributionAmount),
    })),
  };
}

/**
 * Build the local legal-entity balance sheet on posted book balances at the
 * selected period end.
 */
export async function getLocalBalanceSheetReport({
  tenantId,
  book,
  fiscalPeriodId,
  includeZero = false,
  runQuery = query,
}) {
  const context = await buildLocalStatementContext({
    tenantId,
    book,
    fiscalPeriodId,
    includeZero,
    runQuery,
  });

  return {
    filters: buildBaseFilters(context.bookDisplay, fiscalPeriodId, includeZero),
    contract: buildStatementContractPayload("BALANCE_SHEET", context),
    book: buildBookPayload(context.bookDisplay),
    range: buildRangePayload(context.periodContext),
    warnings: context.warnings,
    totals: context.balanceSheetComputation.totals,
    rows: context.balanceSheetComputation.rows.map(toStatementRowPayload),
  };
}

/**
 * Build the local fiscal-year-to-date income statement on posted book movement,
 * excluding the repo's auto year-end close journal so performance remains
 * readable after close.
 */
export async function getLocalIncomeStatementReport({
  tenantId,
  book,
  fiscalPeriodId,
  includeZero = false,
  runQuery = query,
}) {
  const context = await buildLocalStatementContext({
    tenantId,
    book,
    fiscalPeriodId,
    includeZero,
    runQuery,
  });

  return {
    filters: buildBaseFilters(context.bookDisplay, fiscalPeriodId, includeZero),
    contract: buildStatementContractPayload("INCOME_STATEMENT", context),
    book: buildBookPayload(context.bookDisplay),
    range: buildRangePayload(context.periodContext),
    warnings: context.warnings,
    totals: context.incomeStatementComputation.totals,
    rows: context.incomeStatementComputation.rows.map(toStatementRowPayload),
  };
}

/**
 * Return account-summary drillthrough for one local statement row so the UI can
 * navigate statement row -> account summary -> ledger detail explicitly.
 */
export async function getLocalStatementAccountSummary({
  tenantId,
  book,
  statementType,
  statementRowKey,
  fiscalPeriodId,
  runQuery = query,
}) {
  const normalizedStatementType = normalizeCode(statementType);
  if (
    !["BALANCE_SHEET", "INCOME_STATEMENT"].includes(normalizedStatementType)
  ) {
    throw badRequest(
      "statementType must be BALANCE_SHEET or INCOME_STATEMENT"
    );
  }

  const context = await buildLocalStatementContext({
    tenantId,
    book,
    fiscalPeriodId,
    includeZero: true,
    runQuery,
  });
  const statementRow = resolveStatementRowState(
    normalizedStatementType,
    statementRowKey,
    context
  );
  if (!statementRow) {
    throw badRequest("statementRowKey not found for the requested statementType");
  }

  return buildStatementAccountSummaryPayload({
    statementType: normalizedStatementType,
    statementRow,
    context,
  });
}
