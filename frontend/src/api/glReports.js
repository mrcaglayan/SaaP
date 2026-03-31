import { api } from "./client.js";
import { LOCAL_REPORT_ROUTE_PATHS } from "../reporting/localReportConfig.js";

export const LOCAL_REPORT_SCOPE_MODES = Object.freeze({
  all: "ALL",
  operatingUnit: "OPERATING_UNIT",
  central: "CENTRAL",
});

export const LOCAL_REPORT_CONTEXT_QUERY_KEYS = Object.freeze([
  "closePackId",
  "closeLaunchMode",
]);

const LOCAL_REPORT_QUERY_KEYS = Object.freeze([
  "legalEntityId",
  "bookId",
  "fiscalPeriodId",
  "fiscalPeriodIdFrom",
  "fiscalPeriodIdTo",
  "dateFrom",
  "dateTo",
  "accountId",
  "accountCodeFrom",
  "accountCodeTo",
  "counterpartyId",
  "operatingUnitScope",
  "operatingUnitId",
  "direction",
  "rowStatus",
  "subledgerReferenceNo",
  "sourceModule",
  "sourceType",
  "status",
  "includeReversed",
  "includeZero",
  "includeRollup",
  "groupBy",
  "reportPreset",
  "limit",
  "offset",
  "sortBy",
  "sortDirection",
  ...LOCAL_REPORT_CONTEXT_QUERY_KEYS,
]);

function hasValue(value) {
  return value !== undefined && value !== null && value !== "";
}

function toQueryString(params = {}) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (!hasValue(value)) {
      continue;
    }
    searchParams.set(key, String(value));
  }
  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

/**
 * Normalize the shared local-report query contract used for deep links and API reads.
 */
export function normalizeLocalReportParams(params = {}) {
  const normalized = {};

  for (const key of LOCAL_REPORT_QUERY_KEYS) {
    if (!hasValue(params[key])) {
      continue;
    }
    normalized[key] = params[key];
  }

  const operatingUnitScope = String(normalized.operatingUnitScope || "")
    .trim()
    .toUpperCase();
  if (hasValue(normalized.operatingUnitId) && !operatingUnitScope) {
    normalized.operatingUnitScope = LOCAL_REPORT_SCOPE_MODES.operatingUnit;
  } else if (operatingUnitScope) {
    normalized.operatingUnitScope = operatingUnitScope;
  }

  // CENTRAL scope later maps to NULL operating_unit_id, so a concrete OU id must be absent.
  if (
    normalized.operatingUnitScope === LOCAL_REPORT_SCOPE_MODES.all ||
    normalized.operatingUnitScope === LOCAL_REPORT_SCOPE_MODES.central
  ) {
    delete normalized.operatingUnitId;
  }

  return normalized;
}

/**
 * Preserve local-close context params while report pages rewrite their own
 * filter query string from controlled form state.
 */
export function appendLocalReportContextParams(sourceParams, targetSearchParams) {
  const target = targetSearchParams || new URLSearchParams();
  const readValue = (key) => {
    if (sourceParams instanceof URLSearchParams) {
      return sourceParams.get(key);
    }
    return sourceParams?.[key];
  };

  for (const key of LOCAL_REPORT_CONTEXT_QUERY_KEYS) {
    const value = readValue(key);
    if (hasValue(value)) {
      target.set(key, String(value));
    }
  }

  return target;
}

/**
 * Build a report URL using the shared local-report query contract.
 */
export function buildLocalReportLocation(reportKeyOrPath, params = {}) {
  const path =
    LOCAL_REPORT_ROUTE_PATHS[reportKeyOrPath] || String(reportKeyOrPath || "").trim();
  if (!path) {
    return "";
  }
  return `${path}${toQueryString(normalizeLocalReportParams(params))}`;
}

/**
 * Read the existing posted trial balance using the shared report contract wrapper.
 */
export async function getTrialBalanceReport(params = {}) {
  const response = await api.get(
    `/api/v1/gl/trial-balance${toQueryString(normalizeLocalReportParams(params))}`
  );
  return response.data;
}

/**
 * Read posted local ledger detail using the shared report contract.
 */
export async function getGeneralLedgerReport(params = {}) {
  const response = await api.get(
    `/api/v1/gl/ledger-report${toQueryString(normalizeLocalReportParams(params))}`
  );
  return response.data;
}

/**
 * Read the first-pass local balance sheet report.
 */
export async function getLocalBalanceSheetReport(params = {}) {
  const response = await api.get(
    `/api/v1/gl/balance-sheet-report${toQueryString(normalizeLocalReportParams(params))}`
  );
  return response.data;
}

/**
 * Read the first-pass local income statement report.
 */
export async function getLocalIncomeStatementReport(params = {}) {
  const response = await api.get(
    `/api/v1/gl/income-statement-report${toQueryString(normalizeLocalReportParams(params))}`
  );
  return response.data;
}

/**
 * Read account-summary drillthrough for one local statement row.
 */
export async function getLocalStatementAccountSummary(params = {}) {
  const normalized = normalizeLocalReportParams(params);
  const response = await api.get(
    `/api/v1/gl/statement-account-summary${toQueryString({
      ...normalized,
      statementType: params.statementType,
      statementRowKey: params.statementRowKey,
    })}`
  );
  return response.data;
}

/**
 * Read the first-pass RP10 GL-vs-CARI control reconciliation summary.
 */
export async function getCariControlReconciliationReport(params = {}) {
  const normalized = normalizeLocalReportParams(params);
  const response = await api.get("/api/v1/gl/cari-control-reconciliation", {
    params: {
      ...normalized,
      direction: params.direction,
      rowStatus: params.rowStatus,
    },
  });
  return response.data;
}

/**
 * Read journal/source drillthrough detail for one RP10 reconciliation row.
 */
export async function getCariControlReconciliationDetail(params = {}) {
  const normalized = normalizeLocalReportParams(params);
  const response = await api.get("/api/v1/gl/cari-control-reconciliation/detail", {
    params: {
      ...normalized,
      direction: params.direction,
      rowStatus: params.rowStatus,
      rowKey: params.rowKey,
    },
  });
  return response.data;
}

export { LOCAL_REPORT_ROUTE_PATHS };
