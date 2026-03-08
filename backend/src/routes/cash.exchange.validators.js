import { badRequest, parsePositiveInt } from "./_utils.js";
import {
  normalizeEnum,
  normalizeText,
  optionalPositiveInt,
  parseAmount,
  parseDateOnly,
  parseDateTime,
  parsePagination,
  requireTenantId,
  requireUserId,
} from "./cash.validators.common.js";

const EXCHANGE_STATUSES = ["DRAFT", "POSTED", "REVERSED", "CANCELLED"];

function parseOptionalPositiveDecimal(value, label) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw badRequest(`${label} must be a numeric value greater than 0`);
  }
  return Number(parsed.toFixed(10));
}

function parseOptionalDecimal(value, label, precision = 10) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw badRequest(`${label} must be numeric`);
  }
  return Number(parsed.toFixed(precision));
}

export function parseCashExchangeBatchIdParam(req) {
  const exchangeBatchId = parsePositiveInt(req.params?.exchangeBatchId);
  if (!exchangeBatchId) {
    throw badRequest("exchangeBatchId must be a positive integer");
  }
  return exchangeBatchId;
}

export function parseCashExchangeReadFilters(req) {
  const tenantId = requireTenantId(req);
  const legalEntityId = optionalPositiveInt(req.query?.legalEntityId, "legalEntityId");
  const sourceRegisterId = optionalPositiveInt(req.query?.sourceRegisterId, "sourceRegisterId");
  const targetRegisterId = optionalPositiveInt(req.query?.targetRegisterId, "targetRegisterId");
  const statusRaw = String(req.query?.status || "")
    .trim()
    .toUpperCase();
  const status = statusRaw ? normalizeEnum(statusRaw, "status", EXCHANGE_STATUSES) : null;
  const createdDateFrom = req.query?.createdDateFrom
    ? parseDateOnly(req.query?.createdDateFrom, "createdDateFrom")
    : null;
  const createdDateTo = req.query?.createdDateTo
    ? parseDateOnly(req.query?.createdDateTo, "createdDateTo")
    : null;
  const pagination = parsePagination(req.query, { limit: 50, offset: 0, maxLimit: 200 });

  return {
    tenantId,
    legalEntityId,
    sourceRegisterId,
    targetRegisterId,
    status,
    createdDateFrom,
    createdDateTo,
    limit: pagination.limit,
    offset: pagination.offset,
  };
}

export function parseCashExchangeCreateInput(req) {
  const tenantId = requireTenantId(req);
  const userId = requireUserId(req);
  const sourceRegisterId = optionalPositiveInt(req.body?.sourceRegisterId, "sourceRegisterId");
  const targetRegisterId = optionalPositiveInt(req.body?.targetRegisterId, "targetRegisterId");
  const sourceCashSessionId = optionalPositiveInt(
    req.body?.sourceCashSessionId,
    "sourceCashSessionId"
  );
  const targetCashSessionId = optionalPositiveInt(
    req.body?.targetCashSessionId,
    "targetCashSessionId"
  );
  const clearingAccountId = optionalPositiveInt(req.body?.clearingAccountId, "clearingAccountId");
  const txnDatetime = parseDateTime(req.body?.txnDatetime, "txnDatetime", new Date().toISOString());
  const bookDate = parseDateOnly(
    req.body?.bookDate,
    "bookDate",
    new Date().toISOString().slice(0, 10)
  );
  const sourceAmountTxn = parseAmount(req.body?.sourceAmountTxn, "sourceAmountTxn", {
    required: true,
  });
  const targetAmountTxn = parseAmount(req.body?.targetAmountTxn, "targetAmountTxn", {
    required: true,
  });
  const feeAmountTxn = parseAmount(req.body?.feeAmountTxn, "feeAmountTxn", {
    required: false,
  });
  const feeAmountBase = parseAmount(req.body?.feeAmountBase, "feeAmountBase", {
    required: false,
  });
  const feeAccountId = optionalPositiveInt(req.body?.feeAccountId, "feeAccountId");
  const fxRate = parseOptionalPositiveDecimal(req.body?.fxRate, "fxRate");
  const fxRateSource = normalizeText(req.body?.fxRateSource, "fxRateSource", 40);
  const fxRateDate = req.body?.fxRateDate
    ? parseDateOnly(req.body?.fxRateDate, "fxRateDate")
    : null;
  const providerRef = normalizeText(req.body?.providerRef, "providerRef", 120);
  const spreadReferenceRate = parseOptionalPositiveDecimal(
    req.body?.spreadReferenceRate,
    "spreadReferenceRate"
  );
  const spreadRateDelta = parseOptionalDecimal(req.body?.spreadRateDelta, "spreadRateDelta");
  const spreadAmountBase = parseAmount(req.body?.spreadAmountBase, "spreadAmountBase", {
    required: false,
  });
  const description = normalizeText(req.body?.description, "description", 500);
  const referenceNo = normalizeText(req.body?.referenceNo, "referenceNo", 100);
  const note = normalizeText(req.body?.note, "note", 500);
  const integrationEventUid = normalizeText(req.body?.integrationEventUid, "integrationEventUid", 100);
  const idempotencyKey = normalizeText(req.body?.idempotencyKey, "idempotencyKey", 100, {
    required: true,
  });

  if (!sourceRegisterId) {
    throw badRequest("sourceRegisterId is required");
  }
  if (!targetRegisterId) {
    throw badRequest("targetRegisterId is required");
  }
  if (sourceRegisterId === targetRegisterId) {
    throw badRequest("sourceRegisterId and targetRegisterId must be different");
  }
  if (feeAmountTxn && !feeAccountId) {
    throw badRequest("feeAccountId is required when feeAmountTxn is provided");
  }
  if (!feeAmountTxn && feeAccountId) {
    throw badRequest("feeAmountTxn is required when feeAccountId is provided");
  }
  if (!feeAmountTxn && feeAmountBase) {
    throw badRequest("feeAmountTxn is required when feeAmountBase is provided");
  }

  return {
    tenantId,
    userId,
    sourceRegisterId,
    targetRegisterId,
    sourceCashSessionId,
    targetCashSessionId,
    clearingAccountId,
    txnDatetime,
    bookDate,
    sourceAmountTxn: Number(sourceAmountTxn),
    targetAmountTxn: Number(targetAmountTxn),
    feeAmountTxn: feeAmountTxn === null ? null : Number(feeAmountTxn),
    feeAmountBase: feeAmountBase === null ? null : Number(feeAmountBase),
    feeAccountId,
    fxRate,
    fxRateSource,
    fxRateDate,
    providerRef,
    spreadReferenceRate,
    spreadRateDelta,
    spreadAmountBase: spreadAmountBase === null ? null : Number(spreadAmountBase),
    description,
    referenceNo,
    note,
    integrationEventUid,
    idempotencyKey,
  };
}

export function parseCashExchangeReverseInput(req) {
  const tenantId = requireTenantId(req);
  const userId = requireUserId(req);
  const exchangeBatchId = parseCashExchangeBatchIdParam(req);
  const reverseReason = normalizeText(req.body?.reverseReason, "reverseReason", 255, {
    required: true,
  });
  return {
    tenantId,
    userId,
    exchangeBatchId,
    reverseReason,
  };
}

export function parseCashExchangePostInput(req) {
  const tenantId = requireTenantId(req);
  const userId = requireUserId(req);
  const exchangeBatchId = parseCashExchangeBatchIdParam(req);
  const sourceCashSessionId = optionalPositiveInt(
    req.body?.sourceCashSessionId,
    "sourceCashSessionId"
  );
  const targetCashSessionId = optionalPositiveInt(
    req.body?.targetCashSessionId,
    "targetCashSessionId"
  );
  const txnDatetime =
    req.body?.txnDatetime === undefined || req.body?.txnDatetime === null || req.body?.txnDatetime === ""
      ? null
      : parseDateTime(req.body?.txnDatetime, "txnDatetime");
  const bookDate =
    req.body?.bookDate === undefined || req.body?.bookDate === null || req.body?.bookDate === ""
      ? null
      : parseDateOnly(req.body?.bookDate, "bookDate");

  return {
    tenantId,
    userId,
    exchangeBatchId,
    sourceCashSessionId,
    targetCashSessionId,
    txnDatetime,
    bookDate,
  };
}
