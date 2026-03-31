import { badRequest, parsePositiveInt } from "./_utils.js";

export const LEDGER_REPORT_SORT_FIELDS = Object.freeze([
  "ENTRY_DATE",
  "JOURNAL_NO",
  "REFERENCE_NO",
  "DOCUMENT_DATE",
]);

function normalizeUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function hasQueryValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function parseIsoDateQuery(value, fieldLabel) {
  if (!hasQueryValue(value)) {
    return "";
  }
  const normalized = String(value).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw badRequest(`${fieldLabel} must be a YYYY-MM-DD date`);
  }
  return normalized;
}

function parsePositiveLimit(value, defaultValue, maxValue) {
  if (!hasQueryValue(value)) {
    return defaultValue;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw badRequest("limit must be a positive integer");
  }
  return Math.min(parsed, maxValue);
}

function parseNonNegativeOffset(value) {
  if (!hasQueryValue(value)) {
    return 0;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw badRequest("offset must be a non-negative integer");
  }
  return parsed;
}

function assertUnsupportedQueryKeys(query, keys, endpointLabel) {
  const unsupported = keys.filter((key) => hasQueryValue(query?.[key]));
  if (unsupported.length === 0) {
    return;
  }

  throw badRequest(
    `${unsupported.join(", ")} are not yet supported for ${endpointLabel}. Reserve them for later reporting steps instead of assuming they already work.`
  );
}

/**
 * Parse the shared local-report query contract for the dedicated local ledger endpoint.
 */
export function parseLedgerReportQuery(query = {}) {
  assertUnsupportedQueryKeys(
    query,
    [
      "operatingUnitScope",
      "operating_unit_scope",
      "operatingUnitId",
      "operating_unit_id",
      "accountCodeFrom",
      "account_code_from",
      "accountCodeTo",
      "account_code_to",
      "subledgerReferenceNo",
      "subledger_reference_no",
      "sourceModule",
      "source_module",
      "sourceType",
      "source_type",
      "status",
      "includeReversed",
      "include_reversed",
      "includeZero",
      "include_zero",
    ],
    "/ledger-report"
  );

  const legalEntityId = parsePositiveInt(query.legalEntityId);
  const bookId = parsePositiveInt(query.bookId);
  const accountId = parsePositiveInt(query.accountId);
  const fiscalPeriodId = parsePositiveInt(query.fiscalPeriodId);
  let fiscalPeriodIdFrom = parsePositiveInt(
    query.fiscalPeriodIdFrom ?? query.fiscal_period_id_from
  );
  let fiscalPeriodIdTo = parsePositiveInt(
    query.fiscalPeriodIdTo ?? query.fiscal_period_id_to
  );

  if (fiscalPeriodId) {
    fiscalPeriodIdFrom = fiscalPeriodIdFrom || fiscalPeriodId;
    fiscalPeriodIdTo = fiscalPeriodIdTo || fiscalPeriodId;
  }
  if (!fiscalPeriodIdFrom && fiscalPeriodIdTo) {
    fiscalPeriodIdFrom = fiscalPeriodIdTo;
  }
  if (!fiscalPeriodIdTo && fiscalPeriodIdFrom) {
    fiscalPeriodIdTo = fiscalPeriodIdFrom;
  }

  const dateFrom = parseIsoDateQuery(query.dateFrom ?? query.date_from, "dateFrom");
  const dateTo = parseIsoDateQuery(query.dateTo ?? query.date_to, "dateTo");
  const usesDateRange = Boolean(dateFrom || dateTo);
  const usesFiscalPeriodRange = Boolean(fiscalPeriodIdFrom || fiscalPeriodIdTo);

  if (usesDateRange && usesFiscalPeriodRange) {
    throw badRequest(
      "Use either fiscalPeriodId/fiscalPeriodIdFrom/fiscalPeriodIdTo or dateFrom/dateTo for /ledger-report, not both"
    );
  }
  if (!usesDateRange && !usesFiscalPeriodRange) {
    throw badRequest(
      "Provide either fiscalPeriodId/fiscalPeriodIdFrom/fiscalPeriodIdTo or dateFrom/dateTo for /ledger-report"
    );
  }
  if (usesDateRange && (!dateFrom || !dateTo)) {
    throw badRequest("dateFrom and dateTo are both required for date-range ledger reads");
  }
  if (usesDateRange && dateFrom > dateTo) {
    throw badRequest("dateFrom cannot be after dateTo");
  }

  const sortBy = normalizeUpperText(query.sortBy || "ENTRY_DATE");
  if (!LEDGER_REPORT_SORT_FIELDS.includes(sortBy)) {
    throw badRequest(
      `sortBy must be one of ${LEDGER_REPORT_SORT_FIELDS.join(", ")}`
    );
  }

  const sortDirection = normalizeUpperText(
    query.sortDirection ?? query.sort_direction ?? "ASC"
  );
  if (!["ASC", "DESC"].includes(sortDirection)) {
    throw badRequest("sortDirection must be ASC or DESC");
  }

  return {
    legalEntityId,
    bookId,
    accountId,
    fiscalPeriodId,
    fiscalPeriodIdFrom,
    fiscalPeriodIdTo,
    dateFrom,
    dateTo,
    periodBasis: usesDateRange ? "DATE_RANGE" : "FISCAL_PERIOD",
    limit: parsePositiveLimit(query.limit, 50, 200),
    offset: parseNonNegativeOffset(query.offset),
    sortBy,
    sortDirection,
  };
}
