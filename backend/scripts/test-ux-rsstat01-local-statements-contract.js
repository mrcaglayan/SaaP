import {
  getLocalBalanceSheetReport,
  getLocalIncomeStatementReport,
  getLocalStatementAccountSummary,
} from "../src/services/gl.statement-report.service.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertAmountEqual(actual, expected, message) {
  const left = Number(actual || 0);
  const right = Number(expected || 0);
  if (Math.abs(left - right) > 0.0001) {
    throw new Error(`${message} (expected ${right}, got ${left})`);
  }
}

function findRow(rows, key) {
  return (Array.isArray(rows) ? rows : []).find((row) => row?.key === key) || null;
}

const BOOK_ROW = Object.freeze({
  id: 101,
  legal_entity_id: 201,
  calendar_id: 301,
  code: "STAT",
  name: "Stat Book",
  base_currency_code: "TRY",
});

const PERIOD_ROWS = Object.freeze([
  Object.freeze({
    id: 401,
    fiscal_year: 2026,
    period_no: 1,
    period_name: "Ocak",
    start_date: "2026-01-01",
    end_date: "2026-01-31",
    is_adjustment: 0,
  }),
  Object.freeze({
    id: 402,
    fiscal_year: 2026,
    period_no: 2,
    period_name: "Subat",
    start_date: "2026-02-01",
    end_date: "2026-02-28",
    is_adjustment: 0,
  }),
  Object.freeze({
    id: 403,
    fiscal_year: 2026,
    period_no: 3,
    period_name: "Mart",
    start_date: "2026-03-01",
    end_date: "2026-03-31",
    is_adjustment: 0,
  }),
]);

const OPEN_BALANCE_ROWS = Object.freeze([
  Object.freeze({
    account_id: 1,
    account_code: "100",
    account_name: "Kasa",
    account_type: "ASSET",
    normal_side: "DEBIT",
    debit_total: 1000,
    credit_total: 0,
    raw_balance: 1000,
  }),
  Object.freeze({
    account_id: 2,
    account_code: "320",
    account_name: "Saticilar",
    account_type: "LIABILITY",
    normal_side: "CREDIT",
    debit_total: 0,
    credit_total: 300,
    raw_balance: -300,
  }),
  Object.freeze({
    account_id: 3,
    account_code: "500",
    account_name: "Sermaye",
    account_type: "EQUITY",
    normal_side: "CREDIT",
    debit_total: 0,
    credit_total: 400,
    raw_balance: -400,
  }),
]);

const CLOSED_BALANCE_ROWS = Object.freeze([
  ...OPEN_BALANCE_ROWS,
  Object.freeze({
    account_id: 4,
    account_code: "570",
    account_name: "Gecmis Yillar Karlari",
    account_type: "EQUITY",
    normal_side: "CREDIT",
    debit_total: 0,
    credit_total: 300,
    raw_balance: -300,
  }),
  Object.freeze({
    account_id: 5,
    account_code: "690",
    account_name: "Donem Kari Zarari",
    account_type: "EQUITY",
    normal_side: "CREDIT",
    debit_total: 0,
    credit_total: 300,
    raw_balance: -300,
  }),
]);

const INCOME_ROWS = Object.freeze([
  Object.freeze({
    account_id: 11,
    account_code: "600",
    account_name: "Yurtici Satislar",
    account_type: "REVENUE",
    normal_side: "CREDIT",
    debit_total: 0,
    credit_total: 1000,
    raw_balance: -1000,
  }),
  Object.freeze({
    account_id: 12,
    account_code: "610",
    account_name: "Satis Iskontolari",
    account_type: "REVENUE",
    normal_side: "DEBIT",
    debit_total: 100,
    credit_total: 0,
    raw_balance: 100,
  }),
  Object.freeze({
    account_id: 13,
    account_code: "621",
    account_name: "Satilan Mal Maliyeti",
    account_type: "EXPENSE",
    normal_side: "DEBIT",
    debit_total: 400,
    credit_total: 0,
    raw_balance: 400,
  }),
  Object.freeze({
    account_id: 14,
    account_code: "632",
    account_name: "Genel Yonetim Giderleri",
    account_type: "EXPENSE",
    normal_side: "DEBIT",
    debit_total: 150,
    credit_total: 0,
    raw_balance: 150,
  }),
  Object.freeze({
    account_id: 15,
    account_code: "691",
    account_name: "Donem Vergisi",
    account_type: "EXPENSE",
    normal_side: "DEBIT",
    debit_total: 50,
    credit_total: 0,
    raw_balance: 50,
  }),
]);

function createRunQueryFixture({
  balanceRows,
  incomeRows,
  yearEndClosePosted,
  queryLog,
}) {
  return async function runQuery(sql, params = []) {
    queryLog.push({ sql, params });

    if (sql.includes("FROM books")) {
      return { rows: [BOOK_ROW] };
    }
    if (sql.includes("FROM fiscal_periods")) {
      return { rows: PERIOD_ROWS };
    }
    if (
      sql.includes("FROM journal_entries") &&
      sql.includes("fiscal_period_id = ?") &&
      sql.includes("reference_no LIKE ?") &&
      sql.includes("LIMIT 1")
    ) {
      return { rows: yearEndClosePosted ? [{ ok: 1 }] : [] };
    }
    if (
      sql.includes("FROM journal_entries je") &&
      sql.includes("SUM(jl.debit_base - jl.credit_base) AS raw_balance")
    ) {
      if (sql.includes("NOT (je.reference_no LIKE ? AND je.description LIKE ?)")) {
        return { rows: incomeRows };
      }
      return { rows: balanceRows };
    }

    throw new Error(`Unexpected query in RP05 characterization test: ${sql}`);
  };
}

async function runOpenPeriodScenario() {
  const queryLog = [];
  const runQuery = createRunQueryFixture({
    balanceRows: OPEN_BALANCE_ROWS,
    incomeRows: INCOME_ROWS,
    yearEndClosePosted: false,
    queryLog,
  });

  const baseInput = {
    tenantId: 1,
    book: { id: BOOK_ROW.id },
    fiscalPeriodId: 403,
    runQuery,
  };

  const balanceSheet = await getLocalBalanceSheetReport(baseInput);
  const incomeStatement = await getLocalIncomeStatementReport(baseInput);
  const currentYearResultSummary = await getLocalStatementAccountSummary({
    ...baseInput,
    statementType: "BALANCE_SHEET",
    statementRowKey: "CURRENT_YEAR_RESULT",
  });

  assert(
    balanceSheet.contract.statementBasis === "AS_OF_PERIOD_END",
    "Balance sheet should be point-in-time at period end"
  );
  assert(
    incomeStatement.contract.statementBasis === "FISCAL_YEAR_TO_DATE",
    "Income statement should be fiscal-year-to-date"
  );
  assert(
    balanceSheet.contract.retainedEarningsPolicy === "POSTED_EQUITY_BALANCES",
    "Balance sheet retained earnings policy should stay on posted equity"
  );
  assert(
    balanceSheet.contract.currentYearResultPolicy ===
      "SYNTHETIC_FROM_YTD_INCOME_STATEMENT",
    "Open-period balance sheet should keep current-year result synthetic"
  );
  assert(
    incomeStatement.contract.mappingSource ===
      "TR_UNIFORM_CODE_BANDS_V1_WITH_ACCOUNT_TYPE_FALLBACK",
    "Income statement should expose the explicit local mapping source"
  );

  assertAmountEqual(
    findRow(incomeStatement.rows, "GROSS_SALES")?.amount,
    1000,
    "Gross sales row should normalize revenue as positive"
  );
  assertAmountEqual(
    findRow(incomeStatement.rows, "SALES_DISCOUNTS")?.amount,
    100,
    "Sales discounts should stay positive as a deduction row"
  );
  assertAmountEqual(
    incomeStatement.totals.netSales,
    900,
    "Net sales should subtract sales discounts from gross sales"
  );
  assertAmountEqual(
    incomeStatement.totals.netIncomeLoss,
    300,
    "Net income should be the YTD synthetic result"
  );
  assertAmountEqual(
    balanceSheet.totals.currentYearResult,
    300,
    "Balance sheet current-year result should follow the YTD income result before close"
  );
  assertAmountEqual(
    balanceSheet.totals.equationDelta,
    0,
    "Balance sheet equation delta should reconcile to zero"
  );

  const currentYearRow = findRow(balanceSheet.rows, "CURRENT_YEAR_RESULT");
  assert(
    currentYearRow?.drillthroughEnabled === true,
    "Current-year result should support drillthrough before year-end close"
  );
  assertAmountEqual(
    currentYearResultSummary.summary?.amount,
    300,
    "Current-year result account summary should reconcile to the balance-sheet row"
  );
  assertAmountEqual(
    currentYearResultSummary.rows.reduce(
      (sum, row) => sum + Number(row?.contributionAmount || 0),
      0
    ),
    300,
    "Current-year result account contributions should sum to the row amount"
  );
  assert(
    currentYearResultSummary.drillthrough?.reportType === "GENERAL_LEDGER",
    "Statement account summary should drill toward the shared ledger engine"
  );
  assert(
    currentYearResultSummary.drillthrough?.fiscalPeriodIdFrom === 401 &&
      currentYearResultSummary.drillthrough?.fiscalPeriodIdTo === 403,
    "Statement account summary should preserve the fiscal-year-to-date ledger range"
  );

  const ytdRead = queryLog.find(({ sql }) =>
    sql.includes("NOT (je.reference_no LIKE ? AND je.description LIKE ?)")
  );
  assert(
    Boolean(ytdRead),
    "Income statement YTD read should exclude the auto year-end close journal"
  );
  assert(
    ytdRead.params.includes("2026-01-01") && ytdRead.params.includes("2026-03-31"),
    "Income statement YTD read should use the fiscal-year start and selected period end"
  );
}

async function runClosedPeriodScenario() {
  const runQuery = createRunQueryFixture({
    balanceRows: CLOSED_BALANCE_ROWS,
    incomeRows: INCOME_ROWS,
    yearEndClosePosted: true,
    queryLog: [],
  });

  const balanceSheet = await getLocalBalanceSheetReport({
    tenantId: 1,
    book: { id: BOOK_ROW.id },
    fiscalPeriodId: 403,
    runQuery,
  });

  assert(
    balanceSheet.contract.currentYearResultPolicy ===
      "ZERO_AFTER_POSTED_YEAR_END_CLOSE",
    "Closed-period balance sheet should zero the synthetic current-year result row"
  );
  assertAmountEqual(
    balanceSheet.totals.currentYearResult,
    0,
    "Balance sheet current-year result should be zero after posted year-end close"
  );
  assertAmountEqual(
    balanceSheet.totals.equationDelta,
    0,
    "Closed-period balance sheet equation delta should still reconcile to zero"
  );
  assert(
    balanceSheet.rows.some((row) => row.key === "POSTED_EQUITY"),
    "Closed-period balance sheet should continue to show posted equity detail"
  );
  assert(
    !balanceSheet.rows.some((row) => row.key === "CURRENT_YEAR_RESULT"),
    "Closed-period balance sheet should hide the zero current-year result row by default"
  );
  assert(
    balanceSheet.warnings.some((warning) => warning.includes("690")),
    "Closed-period balance sheet should warn when control-code balances remain posted"
  );
}

async function main() {
  await runOpenPeriodScenario();
  await runClosedPeriodScenario();
  console.log(
    "RS-STAT-01 passed (RP05 local statement contract matches the locked statutory semantics)."
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
