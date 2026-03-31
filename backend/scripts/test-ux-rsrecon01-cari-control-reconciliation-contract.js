import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getCariControlReconciliationDetail,
  getCariControlReconciliationReport,
} from "../src/services/gl.cari-control-reconciliation.service.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message} (expected ${expected}, got ${actual})`);
  }
}

function assertAmountEqual(actual, expected, message) {
  const left = Number(actual || 0);
  const right = Number(expected || 0);
  if (Math.abs(left - right) > 0.0001) {
    throw new Error(`${message} (expected ${right}, got ${left})`);
  }
}

function assertIncludes(source, snippet, label) {
  assert(source.includes(snippet), `${label} is missing expected snippet: ${snippet}`);
}

async function readRepoFile(root, relativePath) {
  return readFile(path.resolve(root, relativePath), "utf8");
}

const BOOK_ROW = Object.freeze({
  id: 21,
  legal_entity_id: 11,
  calendar_id: 31,
  code: "STAT",
  name: "Stat Book",
  base_currency_code: "TRY",
});

const PERIOD_ROWS = Object.freeze([
  Object.freeze({
    id: 41,
    fiscal_year: 2026,
    period_no: 1,
    period_name: "Ocak",
    start_date: "2026-01-01",
    end_date: "2026-01-31",
    is_adjustment: 0,
  }),
  Object.freeze({
    id: 42,
    fiscal_year: 2026,
    period_no: 2,
    period_name: "Subat",
    start_date: "2026-02-01",
    end_date: "2026-02-28",
    is_adjustment: 0,
  }),
  Object.freeze({
    id: 43,
    fiscal_year: 2026,
    period_no: 3,
    period_name: "Mart",
    start_date: "2026-03-01",
    end_date: "2026-03-31",
    is_adjustment: 0,
  }),
]);

const PURPOSE_MAPPINGS = Object.freeze([
  Object.freeze({
    purposeCode: "CARI_AR_CONTROL",
    accountId: 110,
    accountCode: "120.01",
    accountName: "Alicilar",
    validForCariPosting: true,
  }),
  Object.freeze({
    purposeCode: "CARI_AP_CONTROL",
    accountId: 210,
    accountCode: "320.01",
    accountName: "Saticilar",
    validForCariPosting: true,
  }),
]);

const OPEN_ITEM_ROWS = Object.freeze([
  Object.freeze({
    openItemId: 501,
    documentId: 301,
    documentNo: "AR-001",
    direction: "AR",
    documentType: "INVOICE",
    documentDate: "2026-03-12",
    dueDate: "2026-03-30",
    counterpartyId: 201,
    counterpartyCodeSnapshot: "CARI-AR-01",
    counterpartyNameSnapshot: "Musteri A",
    operatingUnitId: 101,
    operatingUnitCode: "OU-101",
    operatingUnitName: "Ankara",
    residualAmountTxnAsOf: 150,
    residualAmountBaseAsOf: 150,
    asOfStatus: "OPEN",
  }),
  Object.freeze({
    openItemId: 502,
    documentId: 302,
    documentNo: "AP-001",
    direction: "AP",
    documentType: "INVOICE",
    documentDate: "2026-03-10",
    dueDate: "2026-03-25",
    counterpartyId: 202,
    counterpartyCodeSnapshot: "CARI-AP-01",
    counterpartyNameSnapshot: "Tedarikci B",
    operatingUnitId: null,
    operatingUnitCode: null,
    operatingUnitName: null,
    residualAmountTxnAsOf: 80,
    residualAmountBaseAsOf: 80,
    asOfStatus: "OPEN",
  }),
]);

const GL_LINE_ROWS = Object.freeze([
  Object.freeze({
    journal_id: 1001,
    journal_no: "JRN-1001",
    reference_no: "REF-AR-1",
    entry_date: "2026-03-12",
    document_date: "2026-03-12",
    journal_description: "AR control posting",
    journal_line_id: 2001,
    line_no: 1,
    line_description: "AR control line",
    account_id: 110,
    account_code: "120.01",
    account_name: "Alicilar",
    journal_operating_unit_id: 101,
    journal_operating_unit_code: "OU-101",
    journal_operating_unit_name: "Ankara",
    subledger_reference_no: "SL-AR-1",
    debit_base: 150,
    credit_base: 0,
    source_ref_type: "CARI_DOCUMENT",
    source_ref_id: 301,
    link_role: "PRIMARY",
    document_id: 301,
    document_no: "AR-001",
    document_direction: "AR",
    document_counterparty_id: 201,
    document_operating_unit_id: 101,
    document_counterparty_code: "CARI-AR-01",
    document_counterparty_name: "Musteri A",
    document_operating_unit_code: "OU-101",
    document_operating_unit_name: "Ankara",
    settlement_batch_id: null,
    settlement_no: null,
    settlement_counterparty_id: null,
    settlement_owner_operating_unit_id: null,
    settlement_counterparty_code: null,
    settlement_counterparty_name: null,
    settlement_owner_operating_unit_code: null,
    settlement_owner_operating_unit_name: null,
  }),
  Object.freeze({
    journal_id: 1002,
    journal_no: "JRN-1002",
    reference_no: "REF-AP-1",
    entry_date: "2026-03-15",
    document_date: "2026-03-15",
    journal_description: "AP control posting",
    journal_line_id: 2002,
    line_no: 1,
    line_description: "AP control line",
    account_id: 210,
    account_code: "320.01",
    account_name: "Saticilar",
    journal_operating_unit_id: null,
    journal_operating_unit_code: null,
    journal_operating_unit_name: null,
    subledger_reference_no: "SL-AP-1",
    debit_base: 0,
    credit_base: 80,
    source_ref_type: "CARI_SETTLEMENT_BATCH",
    source_ref_id: 401,
    link_role: "PRIMARY",
    document_id: null,
    document_no: null,
    document_direction: null,
    document_counterparty_id: null,
    document_operating_unit_id: null,
    document_counterparty_code: null,
    document_counterparty_name: null,
    document_operating_unit_code: null,
    document_operating_unit_name: null,
    settlement_batch_id: 401,
    settlement_no: "SET-001",
    settlement_counterparty_id: 202,
    settlement_owner_operating_unit_id: null,
    settlement_counterparty_code: "CARI-AP-01",
    settlement_counterparty_name: "Tedarikci B",
    settlement_owner_operating_unit_code: null,
    settlement_owner_operating_unit_name: null,
  }),
  Object.freeze({
    journal_id: 1003,
    journal_no: "JRN-1003",
    reference_no: "REF-AR-UNLINKED",
    entry_date: "2026-03-20",
    document_date: "2026-03-20",
    journal_description: "Unlinked AR control posting",
    journal_line_id: 2003,
    line_no: 2,
    line_description: "Unlinked line",
    account_id: 110,
    account_code: "120.01",
    account_name: "Alicilar",
    journal_operating_unit_id: 101,
    journal_operating_unit_code: "OU-101",
    journal_operating_unit_name: "Ankara",
    subledger_reference_no: null,
    debit_base: 25,
    credit_base: 0,
    source_ref_type: null,
    source_ref_id: null,
    link_role: null,
    document_id: null,
    document_no: null,
    document_direction: null,
    document_counterparty_id: null,
    document_operating_unit_id: null,
    document_counterparty_code: null,
    document_counterparty_name: null,
    document_operating_unit_code: null,
    document_operating_unit_name: null,
    settlement_batch_id: null,
    settlement_no: null,
    settlement_counterparty_id: null,
    settlement_owner_operating_unit_id: null,
    settlement_counterparty_code: null,
    settlement_counterparty_name: null,
    settlement_owner_operating_unit_code: null,
    settlement_owner_operating_unit_name: null,
  }),
]);

function createRunQueryFixture(queryLog) {
  return async function runQuery(sql, params = []) {
    queryLog.push({ sql, params });

    if (sql.includes("FROM fiscal_periods")) {
      return { rows: PERIOD_ROWS };
    }
    if (
      sql.includes("FROM journal_entries je") &&
      sql.includes("JOIN journal_lines jl")
    ) {
      return { rows: GL_LINE_ROWS };
    }

    throw new Error(`Unexpected query in RS-RECON-01: ${sql}`);
  };
}

async function runServiceScenario() {
  const queryLog = [];
  const runQuery = createRunQueryFixture(queryLog);
  const report = await getCariControlReconciliationReport({
    tenantId: 1,
    book: BOOK_ROW,
    reportQuery: {
      legalEntityId: 11,
      bookId: 21,
      fiscalPeriodId: 43,
      operatingUnitScope: "ALL",
      operatingUnitId: null,
      direction: "ALL",
      counterpartyId: null,
      rowStatus: "ALL",
      limit: 200,
      offset: 0,
    },
    runQuery,
    loadPurposeMappings: async () => PURPOSE_MAPPINGS,
    loadOpenItemRows: async () => OPEN_ITEM_ROWS,
  });

  assertEqual(
    report.contract.slice,
    "GL_VS_CARI_CONTROL_OPEN_ITEMS_V1",
    "RP10 contract slice should be exposed"
  );
  assertEqual(
    report.contract.operatingUnitAxisPolicy,
    "FILTER_GROUP_RECONCILIATION_ONLY",
    "OU must remain a filter/grouping axis"
  );
  assertEqual(report.rows.length, 3, "Full RP10 dataset should expose three rows");
  assertEqual(report.summary.exceptionRowCount, 1, "One row should be flagged as exception");
  assertAmountEqual(
    report.summary.absoluteDifferenceBaseTotal,
    25,
    "Absolute difference total should reflect the unlinked GL row"
  );
  assertAmountEqual(
    report.summary.glAmountBaseTotal,
    255,
    "GL total should include AR, AP, and unlinked balances"
  );
  assertAmountEqual(
    report.summary.sourceAmountBaseTotal,
    230,
    "Source total should match the linked open-item balances"
  );
  assertAmountEqual(
    report.summary.differenceBaseTotal,
    25,
    "Net difference should reflect the unmatched GL residue"
  );
  assertEqual(report.controlAccounts.length, 2, "Two configured CARI control accounts should be exposed");
  assertEqual(report.missingPurposeCodes.length, 0, "No required purpose codes should be missing");

  const exceptionRow = report.rows.find((row) => row.rowType === "UNLINKED_GL");
  assert(exceptionRow, "Unlinked GL exception row should be present");
  assertEqual(
    exceptionRow.rowKey,
    "UNLINKED_GL|AR|OU:101|CP:0",
    "Unlinked GL row key should preserve OU and no-counterparty scope"
  );
  assert(
    exceptionRow.issueCodes.includes("MISSING_CARI_LINK") &&
      exceptionRow.issueCodes.includes("MISSING_SUBLEDGER_REF") &&
      exceptionRow.issueCodes.includes("BALANCE_DIFFERENCE"),
    "Unlinked row should expose all three expected issue codes"
  );
  assertAmountEqual(
    exceptionRow.differenceBase,
    25,
    "Unlinked GL row difference should match the unmatched control balance"
  );

  const matchedArRow = report.rows.find(
    (row) => row.rowKey === "COUNTERPARTY_SCOPE|AR|OU:101|CP:201"
  );
  assert(matchedArRow, "Matched AR row should be present");
  assertAmountEqual(matchedArRow.glAmountBase, 150, "Matched AR row GL amount should reconcile");
  assertAmountEqual(
    matchedArRow.sourceAmountBase,
    150,
    "Matched AR row source amount should reconcile"
  );
  assertEqual(matchedArRow.issueCodes.length, 0, "Matched AR row should carry no issue codes");

  const matchedApRow = report.rows.find(
    (row) => row.rowKey === "COUNTERPARTY_SCOPE|AP|CENTRAL|CP:202"
  );
  assert(matchedApRow, "Matched AP row should be present");
  assertAmountEqual(
    matchedApRow.glAmountBase,
    80,
    "AP balances should be presentation-normalized to positive amounts"
  );
  assertAmountEqual(matchedApRow.sourceAmountBase, 80, "AP source row should reconcile");

  const exceptionsOnly = await getCariControlReconciliationReport({
    tenantId: 1,
    book: BOOK_ROW,
    reportQuery: {
      legalEntityId: 11,
      bookId: 21,
      fiscalPeriodId: 43,
      operatingUnitScope: "ALL",
      operatingUnitId: null,
      direction: "ALL",
      counterpartyId: null,
      rowStatus: "EXCEPTIONS_ONLY",
      limit: 200,
      offset: 0,
    },
    runQuery,
    loadPurposeMappings: async () => PURPOSE_MAPPINGS,
    loadOpenItemRows: async () => OPEN_ITEM_ROWS,
  });
  assertEqual(
    exceptionsOnly.rows.length,
    1,
    "Exceptions-only mode should return only the unmatched row"
  );
  assertEqual(
    exceptionsOnly.rows[0].rowKey,
    "UNLINKED_GL|AR|OU:101|CP:0",
    "Exceptions-only mode should preserve the same row identity"
  );

  const matchedDetail = await getCariControlReconciliationDetail({
    tenantId: 1,
    book: BOOK_ROW,
    reportQuery: {
      legalEntityId: 11,
      bookId: 21,
      fiscalPeriodId: 43,
      operatingUnitScope: "ALL",
      operatingUnitId: null,
      direction: "ALL",
      counterpartyId: null,
      rowStatus: "EXCEPTIONS_ONLY",
      limit: 200,
      offset: 0,
    },
    rowKey: "COUNTERPARTY_SCOPE|AR|OU:101|CP:201",
    runQuery,
    loadPurposeMappings: async () => PURPOSE_MAPPINGS,
    loadOpenItemRows: async () => OPEN_ITEM_ROWS,
  });
  assertEqual(
    matchedDetail.contract.drillthrough,
    "RECONCILIATION_ROW_TO_JOURNAL_AND_SOURCE",
    "RP10 detail contract should expose the drillthrough ladder"
  );
  assertEqual(matchedDetail.glRows.length, 1, "Matched AR detail should expose one GL line");
  assertEqual(
    matchedDetail.sourceRows.length,
    1,
    "Matched AR detail should expose one source open item"
  );
  assertEqual(
    matchedDetail.glRows[0].journalId,
    1001,
    "Matched AR detail should preserve the journal drillthrough id"
  );
  assertEqual(
    matchedDetail.glRows[0].sourceLinks.length,
    1,
    "Matched AR detail should preserve the source link payload"
  );

  const exceptionDetail = await getCariControlReconciliationDetail({
    tenantId: 1,
    book: BOOK_ROW,
    reportQuery: {
      legalEntityId: 11,
      bookId: 21,
      fiscalPeriodId: 43,
      operatingUnitScope: "ALL",
      operatingUnitId: null,
      direction: "ALL",
      counterpartyId: null,
      rowStatus: "ALL",
      limit: 200,
      offset: 0,
    },
    rowKey: "UNLINKED_GL|AR|OU:101|CP:0",
    runQuery,
    loadPurposeMappings: async () => PURPOSE_MAPPINGS,
    loadOpenItemRows: async () => OPEN_ITEM_ROWS,
  });
  assertEqual(
    exceptionDetail.glRows.length,
    1,
    "Exception drillthrough should preserve the unmatched GL line"
  );
  assertEqual(
    exceptionDetail.sourceRows.length,
    0,
    "Unlinked GL drillthrough should have no source open-item rows"
  );
  assertEqual(
    exceptionDetail.glRows[0].linkedToCariSource,
    false,
    "Unlinked GL drillthrough should remain explicitly unlinked"
  );

  const throughPeriodRead = queryLog.find(({ sql }) =>
    sql.includes("je.fiscal_period_id IN")
  );
  assert(throughPeriodRead, "GL read should resolve a through-period context");
  assert(
    throughPeriodRead.params.includes(41) &&
      throughPeriodRead.params.includes(42) &&
      throughPeriodRead.params.includes(43),
    "GL read should include all fiscal periods through the selected period"
  );
}

async function runFrontendAndOpenApiScenario() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const appSource = await readRepoFile(root, "frontend/src/App.jsx");
  const sidebarSource = await readRepoFile(root, "frontend/src/layouts/sidebarConfig.js");
  const reportConfigSource = await readRepoFile(
    root,
    "frontend/src/reporting/localReportConfig.js"
  );
  const reportApiSource = await readRepoFile(root, "frontend/src/api/glReports.js");
  const pageSource = await readRepoFile(root, "frontend/src/pages/CariControlReconciliationPage.jsx");
  const openApiSource = await readRepoFile(root, "backend/openapi.yaml");

  assertIncludes(
    appSource,
    'appPath: "/app/cari-kontrol-mutabakati"',
    "RP10 implemented route"
  );
  assertIncludes(
    sidebarSource,
    "LOCAL_REPORT_SIDEBAR_ITEMS.cariControlReconciliation",
    "RP10 sidebar wiring"
  );
  assertIncludes(
    reportConfigSource,
    'key: "cariControlReconciliation"',
    "RP10 local-report config key"
  );
  assertIncludes(
    reportApiSource,
    "getCariControlReconciliationReport",
    "RP10 report summary API helper"
  );
  assertIncludes(
    reportApiSource,
    "getCariControlReconciliationDetail",
    "RP10 report detail API helper"
  );
  assertIncludes(
    pageSource,
    "LocalCloseReportBanner",
    "RP10 close-context banner"
  );
  assertIncludes(
    pageSource,
    "Select a book and fiscal period to run the reconciliation.",
    "RP10 empty-state guidance"
  );
  for (const apiPath of [
    "/api/v1/gl/cari-control-reconciliation",
    "/api/v1/gl/cari-control-reconciliation/detail",
  ]) {
    assertIncludes(openApiSource, `"${apiPath}"`, `OpenAPI path ${apiPath}`);
  }
}

async function main() {
  await runServiceScenario();
  await runFrontendAndOpenApiScenario();
  console.log(
    "RS-RECON-01 passed (RP10 control-account reconciliation contract, drillthrough, route wiring, and OpenAPI export are in place)."
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
