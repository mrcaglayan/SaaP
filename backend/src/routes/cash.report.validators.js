import { badRequest, parsePositiveInt } from "./_utils.js";
import { parseCashExchangeReadFilters } from "./cash.exchange.validators.js";
import {
  normalizeEnum,
  optionalPositiveInt,
  parseBooleanFlag,
  parseDateOnly,
  parsePagination,
  requireTenantId,
  requireUserId,
} from "./cash.validators.common.js";

const REVALUATION_RUN_TYPES = ["MONTH_END", "YEAR_END"];
const REVALUATION_RUN_STATUSES = ["DRAFT", "COMPLETED", "FAILED", "REVERSED"];

function parseOptionalDateOnly(value, label) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return parseDateOnly(value, label);
}

function parseOptionalCurrencyCode(value, label) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const normalized = String(value).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw badRequest(`${label} must be a 3-letter currency code`);
  }
  return normalized;
}

function parseOptionalEnum(value, label, allowedValues) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  if (!normalized) {
    return null;
  }
  return normalizeEnum(normalized, label, allowedValues);
}

function parseOptionalNonNegativeNumber(value, label, fallback = null) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw badRequest(`${label} must be a non-negative number`);
  }
  return parsed;
}

function parseOptionalNonNegativeInt(value, label, fallback = null) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw badRequest(`${label} must be a non-negative integer`);
  }
  return parsed;
}

function parseOptionalText(value, label, maxLength, { required = false } = {}) {
  const text = String(value ?? "").trim();
  if (!text) {
    if (required) {
      throw badRequest(`${label} is required`);
    }
    return null;
  }
  if (text.length > maxLength) {
    throw badRequest(`${label} cannot exceed ${maxLength} characters`);
  }
  return text;
}

export function parseCashReportScopeInput(req) {
  return {
    legalEntityId: optionalPositiveInt(req.query?.legalEntityId, "legalEntityId"),
    registerId: optionalPositiveInt(req.query?.registerId, "registerId"),
    sourceRegisterId: optionalPositiveInt(req.query?.sourceRegisterId, "sourceRegisterId"),
    targetRegisterId: optionalPositiveInt(req.query?.targetRegisterId, "targetRegisterId"),
    bookId: optionalPositiveInt(req.query?.bookId, "bookId"),
  };
}

export function parseCashExchangeHistoryReportFilters(req) {
  return parseCashExchangeReadFilters(req);
}

export function parseForeignCashBalanceReportFilters(req) {
  const tenantId = requireTenantId(req);
  const legalEntityId = optionalPositiveInt(req.query?.legalEntityId, "legalEntityId");
  const registerId = optionalPositiveInt(req.query?.registerId, "registerId");
  const asOfDate = parseDateOnly(
    req.query?.asOfDate || req.query?.bookDate,
    "asOfDate",
    new Date().toISOString().slice(0, 10)
  );
  const currencyCode = parseOptionalCurrencyCode(req.query?.currencyCode, "currencyCode");
  const includeBaseCurrency = parseBooleanFlag(req.query?.includeBaseCurrency, false);
  const includeZeroBalances = parseBooleanFlag(req.query?.includeZeroBalances, false);
  const pagination = parsePagination(req.query, {
    limit: 200,
    offset: 0,
    maxLimit: 1_000,
  });

  return {
    tenantId,
    legalEntityId,
    registerId,
    asOfDate,
    currencyCode,
    includeBaseCurrency,
    includeZeroBalances,
    limit: pagination.limit,
    offset: pagination.offset,
  };
}

export function parseCashFxRevaluationRunReportFilters(req) {
  const tenantId = requireTenantId(req);
  const legalEntityId = optionalPositiveInt(req.query?.legalEntityId, "legalEntityId");
  const bookId = optionalPositiveInt(req.query?.bookId, "bookId");
  const runType = parseOptionalEnum(req.query?.runType, "runType", REVALUATION_RUN_TYPES);
  const status = parseOptionalEnum(req.query?.status, "status", REVALUATION_RUN_STATUSES);
  const periodEndFrom = parseOptionalDateOnly(req.query?.periodEndFrom, "periodEndFrom");
  const periodEndTo = parseOptionalDateOnly(req.query?.periodEndTo, "periodEndTo");
  const includeLineCurrencySummary = parseBooleanFlag(
    req.query?.includeLineCurrencySummary,
    true
  );
  const pagination = parsePagination(req.query, {
    limit: 100,
    offset: 0,
    maxLimit: 500,
  });

  if (periodEndFrom && periodEndTo && periodEndFrom > periodEndTo) {
    throw badRequest("periodEndFrom must be <= periodEndTo");
  }

  return {
    tenantId,
    legalEntityId,
    bookId,
    runType,
    status,
    periodEndFrom,
    periodEndTo,
    includeLineCurrencySummary,
    limit: pagination.limit,
    offset: pagination.offset,
  };
}

export function parseCashFxOpsDashboardFilters(req) {
  const tenantId = requireTenantId(req);
  const legalEntityId = optionalPositiveInt(req.query?.legalEntityId, "legalEntityId");
  const dateFrom = parseOptionalDateOnly(req.query?.dateFrom, "dateFrom");
  const dateTo = parseOptionalDateOnly(req.query?.dateTo, "dateTo");
  const days = optionalPositiveInt(req.query?.days, "days");
  const asOfDate = parseDateOnly(
    req.query?.asOfDate || req.query?.bookDate,
    "asOfDate",
    new Date().toISOString().slice(0, 10)
  );
  const abnormalBaseThreshold = parseOptionalNonNegativeNumber(
    req.query?.abnormalBaseThreshold,
    "abnormalBaseThreshold",
    1_000_000
  );
  const includeResolved = parseBooleanFlag(req.query?.includeResolved, false);
  const refresh = parseBooleanFlag(req.query?.refresh, true);
  const pagination = parsePagination(req.query, {
    limit: 50,
    offset: 0,
    maxLimit: 500,
  });

  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw badRequest("dateFrom must be <= dateTo");
  }

  return {
    tenantId,
    legalEntityId,
    dateFrom,
    dateTo,
    days,
    asOfDate,
    abnormalBaseThreshold,
    includeResolved,
    refresh,
    limit: pagination.limit,
  };
}

export function parseCashFxOpsExceptionActionInput(req, { requireReason = false } = {}) {
  const tenantId = requireTenantId(req);
  const userId = requireUserId(req, "Authenticated user");
  const exceptionId = parsePositiveInt(req.params?.exceptionId);
  if (!exceptionId) {
    throw badRequest("exceptionId must be a positive integer");
  }

  const reason = parseOptionalText(req.body?.reason, "reason", 500, {
    required: Boolean(requireReason),
  });
  const resolutionNote = parseOptionalText(
    req.body?.resolutionNote ?? req.body?.resolution_note,
    "resolutionNote",
    500
  );

  return {
    tenantId,
    userId,
    exceptionId,
    reason,
    resolutionNote,
    delaySeconds: parseOptionalNonNegativeInt(
      req.body?.delaySeconds ?? req.body?.delay_seconds,
      "delaySeconds",
      0
    ),
    maxAttempts: parseOptionalNonNegativeInt(
      req.body?.maxAttempts ?? req.body?.max_attempts,
      "maxAttempts",
      null
    ),
  };
}
