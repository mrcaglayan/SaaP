import { api } from "./client.js";
import { LOCAL_REPORT_ROUTE_PATHS } from "../reporting/localReportConfig.js";

export const LOCAL_REPORT_SCOPE_MODES = Object.freeze({
  all: "ALL",
  operatingUnit: "OPERATING_UNIT",
  central: "CENTRAL",
});

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
  "operatingUnitScope",
  "operatingUnitId",
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

export { LOCAL_REPORT_ROUTE_PATHS };
