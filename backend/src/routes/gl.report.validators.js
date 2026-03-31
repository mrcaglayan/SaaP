import { badRequest, parsePositiveInt } from "./_utils.js";

export const LOCAL_REPORT_SCOPE_VALUES = Object.freeze([
  "ALL",
  "OPERATING_UNIT",
  "CENTRAL",
]);

function normalizeUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function hasQueryValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function parseBooleanQuery(value, defaultValue) {
  if (!hasQueryValue(value)) {
    return defaultValue;
  }
  return String(value).trim().toLowerCase() === "true";
}

function assertUnsupportedQueryKeys(query, keys, endpointLabel) {
  const unsupported = keys.filter((key) => hasQueryValue(query?.[key]));
  if (unsupported.length === 0) {
    return;
  }

  throw badRequest(
    `${unsupported.join(", ")} are not yet supported for ${endpointLabel}. Reserve them for later local-report endpoints instead of assuming they already work.`
  );
}

/**
 * Parse the shared local-report contract for the existing trial-balance endpoint.
 * Unsupported dimensions are rejected explicitly so RP01 does not imply false semantics.
 */
export function parseTrialBalanceReportQuery(query = {}) {
  const operatingUnitScope = normalizeUpperText(
    query.operatingUnitScope ?? query.operating_unit_scope
  );
  const operatingUnitId = parsePositiveInt(
    query.operatingUnitId ?? query.operating_unit_id
  );

  if (operatingUnitScope && !LOCAL_REPORT_SCOPE_VALUES.includes(operatingUnitScope)) {
    throw badRequest("operatingUnitScope must be one of ALL, OPERATING_UNIT, CENTRAL");
  }
  if (operatingUnitScope || operatingUnitId) {
    throw badRequest(
      "operatingUnitScope and operatingUnitId are not yet supported for /trial-balance"
    );
  }

  assertUnsupportedQueryKeys(
    query,
    [
      "dateFrom",
      "dateTo",
      "accountId",
      "accountCodeFrom",
      "accountCodeTo",
      "subledgerReferenceNo",
      "sourceModule",
      "sourceType",
      "status",
      "includeReversed",
      "includeZero",
    ],
    "/trial-balance"
  );

  return {
    legalEntityId: parsePositiveInt(query.legalEntityId),
    bookId: parsePositiveInt(query.bookId),
    fiscalPeriodId: parsePositiveInt(query.fiscalPeriodId),
    includeRollup: parseBooleanQuery(query.includeRollup, true),
    operatingUnitScope: "ALL",
    operatingUnitId: null,
  };
}
