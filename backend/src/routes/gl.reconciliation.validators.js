import { badRequest, parsePositiveInt } from "./_utils.js";

const OPERATING_UNIT_SCOPE_VALUES = Object.freeze([
  "ALL",
  "OPERATING_UNIT",
  "CENTRAL",
]);
const DIRECTION_VALUES = Object.freeze(["ALL", "AR", "AP"]);
const ROW_STATUS_VALUES = Object.freeze(["ALL", "EXCEPTIONS_ONLY"]);

function hasQueryValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function normalizeEnum(value, fieldLabel, allowedValues, defaultValue) {
  const normalized = String(value || defaultValue || "")
    .trim()
    .toUpperCase();
  if (!normalized) {
    return "";
  }
  if (!allowedValues.includes(normalized)) {
    throw badRequest(`${fieldLabel} must be one of ${allowedValues.join(", ")}`);
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

/**
 * Parse the RP10 GL-vs-CARI control reconciliation summary query.
 */
export function parseCariControlReconciliationQuery(query = {}) {
  const legalEntityId = parsePositiveInt(query.legalEntityId);
  const bookId = parsePositiveInt(query.bookId);
  const fiscalPeriodId = parsePositiveInt(query.fiscalPeriodId);
  const counterpartyId = parsePositiveInt(query.counterpartyId);
  const operatingUnitScope = normalizeEnum(
    query.operatingUnitScope,
    "operatingUnitScope",
    OPERATING_UNIT_SCOPE_VALUES,
    "ALL"
  );
  const operatingUnitId = parsePositiveInt(query.operatingUnitId);
  if (operatingUnitScope === "OPERATING_UNIT" && !operatingUnitId) {
    throw badRequest("operatingUnitId is required when operatingUnitScope=OPERATING_UNIT");
  }
  if (operatingUnitScope !== "OPERATING_UNIT" && operatingUnitId) {
    throw badRequest(
      "operatingUnitId is only allowed when operatingUnitScope=OPERATING_UNIT"
    );
  }

  return {
    legalEntityId,
    bookId,
    fiscalPeriodId,
    counterpartyId,
    operatingUnitScope,
    operatingUnitId,
    direction: normalizeEnum(query.direction, "direction", DIRECTION_VALUES, "ALL"),
    rowStatus: normalizeEnum(query.rowStatus, "rowStatus", ROW_STATUS_VALUES, "ALL"),
    limit: parsePositiveLimit(query.limit, 200, 500),
    offset: parseNonNegativeOffset(query.offset),
  };
}

/**
 * Parse the RP10 row-detail drillthrough query.
 */
export function parseCariControlReconciliationDetailQuery(query = {}) {
  const reportQuery = parseCariControlReconciliationQuery(query);
  const rowKey = String(query.rowKey || "")
    .trim();
  if (!rowKey) {
    throw badRequest("rowKey query param is required");
  }

  return {
    ...reportQuery,
    rowKey,
  };
}
