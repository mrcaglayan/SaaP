import { badRequest, parsePositiveInt } from "./_utils.js";

export const LEDGER_REPORT_SORT_FIELDS = Object.freeze([
  "ENTRY_DATE",
  "JOURNAL_NO",
  "REFERENCE_NO",
  "DOCUMENT_DATE",
]);

export const LEDGER_REPORT_GROUP_FIELDS = Object.freeze([
  "NONE",
  "MONTH",
  "SOURCE_TYPE",
  "OPERATING_UNIT",
  "SUBLEDGER_REF",
]);

const JOURNAL_STATUSES = Object.freeze([
  "DRAFT",
  "POSTED",
  "REVERSED",
  "CANCELLED",
]);

function normalizeUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normalizeTrimmedText(value, maxLength = 120) {
  return String(value || "").trim().slice(0, maxLength);
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

function parseOperatingUnitScope(query = {}) {
  const normalized = normalizeUpperText(
    query.operatingUnitScope ?? query.operating_unit_scope ?? "ALL"
  );
  if (!["ALL", "OPERATING_UNIT", "CENTRAL"].includes(normalized)) {
    throw badRequest("operatingUnitScope must be ALL, OPERATING_UNIT, or CENTRAL");
  }
  return normalized;
}

function parseJournalStatus(value) {
  const normalized = normalizeUpperText(value);
  if (!normalized) {
    return "";
  }
  if (!JOURNAL_STATUSES.includes(normalized)) {
    throw badRequest(`status must be one of ${JOURNAL_STATUSES.join(", ")}`);
  }
  return normalized;
}

function parseGroupBy(value) {
  const normalized = normalizeUpperText(value || "NONE");
  if (!LEDGER_REPORT_GROUP_FIELDS.includes(normalized)) {
    throw badRequest(`groupBy must be one of ${LEDGER_REPORT_GROUP_FIELDS.join(", ")}`);
  }
  return normalized;
}

function parseAccountCode(value, fieldLabel) {
  if (!hasQueryValue(value)) {
    return "";
  }
  const normalized = normalizeTrimmedText(value, 60);
  if (!normalized) {
    throw badRequest(`${fieldLabel} cannot be blank`);
  }
  return normalized;
}

/**
 * Parse the shared local-report query contract for the dedicated local ledger endpoint.
 */
export function parseLedgerReportQuery(query = {}) {
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

  const accountCodeFrom = parseAccountCode(
    query.accountCodeFrom ?? query.account_code_from,
    "accountCodeFrom"
  );
  const accountCodeTo = parseAccountCode(
    query.accountCodeTo ?? query.account_code_to,
    "accountCodeTo"
  );
  const normalizedAccountCodeFrom = accountCodeFrom || accountCodeTo;
  const normalizedAccountCodeTo = accountCodeTo || accountCodeFrom;

  if (accountId && (normalizedAccountCodeFrom || normalizedAccountCodeTo)) {
    throw badRequest(
      "Use either accountId or accountCodeFrom/accountCodeTo for /ledger-report, not both"
    );
  }
  if (!accountId && !normalizedAccountCodeFrom && !normalizedAccountCodeTo) {
    throw badRequest(
      "Provide either accountId or accountCodeFrom/accountCodeTo for /ledger-report"
    );
  }
  if (
    normalizedAccountCodeFrom &&
    normalizedAccountCodeTo &&
    normalizedAccountCodeFrom > normalizedAccountCodeTo
  ) {
    throw badRequest("accountCodeFrom cannot be after accountCodeTo");
  }

  const operatingUnitScope = parseOperatingUnitScope(query);
  const operatingUnitId = parsePositiveInt(
    query.operatingUnitId ?? query.operating_unit_id
  );
  if (operatingUnitScope === "OPERATING_UNIT" && !operatingUnitId) {
    throw badRequest("operatingUnitId is required when operatingUnitScope=OPERATING_UNIT");
  }
  if (operatingUnitScope !== "OPERATING_UNIT" && operatingUnitId) {
    throw badRequest(
      "operatingUnitId is only allowed when operatingUnitScope=OPERATING_UNIT"
    );
  }

  const sourceType = normalizeUpperText(query.sourceType ?? query.source_type);
  const sourceModule = normalizeUpperText(query.sourceModule ?? query.source_module);
  if (sourceType && sourceModule && sourceType !== sourceModule) {
    // The current repo does not have a dedicated GL source-module column yet, so RP04
    // keeps sourceModule as a compatibility alias over the same journal source category.
    throw badRequest(
      "sourceModule and sourceType currently map to the same ledger source category; provide only one value or matching values"
    );
  }

  const sortBy = normalizeUpperText(query.sortBy || "ENTRY_DATE");
  if (!LEDGER_REPORT_SORT_FIELDS.includes(sortBy)) {
    throw badRequest(`sortBy must be one of ${LEDGER_REPORT_SORT_FIELDS.join(", ")}`);
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
    accountCodeFrom: normalizedAccountCodeFrom,
    accountCodeTo: normalizedAccountCodeTo,
    fiscalPeriodId,
    fiscalPeriodIdFrom,
    fiscalPeriodIdTo,
    dateFrom,
    dateTo,
    periodBasis: usesDateRange ? "DATE_RANGE" : "FISCAL_PERIOD",
    operatingUnitScope,
    operatingUnitId,
    subledgerReferenceNo: normalizeTrimmedText(
      query.subledgerReferenceNo ?? query.subledger_reference_no,
      80
    ),
    sourceType: sourceType || sourceModule || "",
    sourceModule: sourceModule || sourceType || "",
    status: parseJournalStatus(query.status),
    includeReversed: parseBooleanQuery(
      query.includeReversed ?? query.include_reversed,
      false
    ),
    groupBy: parseGroupBy(query.groupBy ?? query.group_by),
    limit: parsePositiveLimit(query.limit, 50, 200),
    offset: parseNonNegativeOffset(query.offset),
    sortBy,
    sortDirection,
  };
}
