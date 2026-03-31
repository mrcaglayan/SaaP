import { badRequest, parsePositiveInt } from "./_utils.js";

function hasQueryValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function parseBooleanQuery(value, defaultValue = false) {
  if (!hasQueryValue(value)) {
    return Boolean(defaultValue);
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  throw badRequest("boolean query flags must be true/false, 1/0, yes/no, or on/off");
}

function assertUnsupportedQueryKeys(query, keys, endpointLabel) {
  const unsupported = keys.filter((key) => hasQueryValue(query?.[key]));
  if (unsupported.length === 0) {
    return;
  }

  throw badRequest(
    `${unsupported.join(", ")} are not yet supported for ${endpointLabel}. RP05 keeps local statements period-first and filter-light.`
  );
}

const UNSUPPORTED_STATEMENT_QUERY_KEYS = Object.freeze([
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
  "includeRollup",
  "groupBy",
  "reportPreset",
  "limit",
  "offset",
  "sortBy",
  "sortDirection",
]);

/**
 * Parse the first-pass local statement query contract shared by balance sheet
 * and income statement reads.
 */
export function parseLocalStatementReportQuery(query = {}, endpointLabel) {
  assertUnsupportedQueryKeys(
    query,
    UNSUPPORTED_STATEMENT_QUERY_KEYS,
    endpointLabel
  );

  return {
    legalEntityId: parsePositiveInt(query.legalEntityId),
    bookId: parsePositiveInt(query.bookId),
    fiscalPeriodId: parsePositiveInt(query.fiscalPeriodId),
    includeZero: parseBooleanQuery(query.includeZero, false),
  };
}

/**
 * Parse the statement-row drillthrough contract used for account-summary reads.
 */
export function parseLocalStatementAccountSummaryQuery(query = {}) {
  const reportQuery = parseLocalStatementReportQuery(
    query,
    "/statement-account-summary"
  );
  const statementType = String(query.statementType || "")
    .trim()
    .toUpperCase();
  const statementRowKey = String(query.statementRowKey || "")
    .trim()
    .toUpperCase();

  if (!["BALANCE_SHEET", "INCOME_STATEMENT"].includes(statementType)) {
    throw badRequest("statementType must be BALANCE_SHEET or INCOME_STATEMENT");
  }
  if (!statementRowKey) {
    throw badRequest("statementRowKey query param is required");
  }

  return {
    ...reportQuery,
    statementType,
    statementRowKey,
  };
}
