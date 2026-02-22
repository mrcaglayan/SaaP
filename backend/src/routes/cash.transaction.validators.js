import { badRequest, parsePositiveInt } from "./_utils.js";
import {
  normalizeCurrencyCode,
  normalizeEnum,
  normalizeText,
  optionalPositiveInt,
  parseAmount,
  parseBooleanFlag,
  parseDateOnly,
  parseDateTime,
  parsePagination,
  requireTenantId,
  requireUserId,
} from "./cash.validators.common.js";

const TXN_TYPES = [
  "RECEIPT",
  "PAYOUT",
  "DEPOSIT_TO_BANK",
  "WITHDRAWAL_FROM_BANK",
  "TRANSFER_OUT",
  "TRANSFER_IN",
  "VARIANCE",
  "OPENING_FLOAT",
  "CLOSING_ADJUSTMENT",
];

const TXN_STATUSES = ["DRAFT", "SUBMITTED", "APPROVED", "POSTED", "REVERSED", "CANCELLED"];

const SOURCE_DOC_TYPES = [
  "AP_PAYMENT",
  "AR_RECEIPT",
  "EXPENSE_CLAIM",
  "PETTY_CASH_VOUCHER",
  "BANK_DEPOSIT_SLIP",
  "OTHER",
];

const COUNTERPARTY_TYPES = ["CUSTOMER", "VENDOR", "EMPLOYEE", "LEGAL_ENTITY", "OTHER"];

export function parseCashTransactionIdParam(req) {
  const transactionId = parsePositiveInt(req.params?.transactionId);
  if (!transactionId) {
    throw badRequest("transactionId must be a positive integer");
  }
  return transactionId;
}

export function parseCashTransactionReadFilters(req) {
  const tenantId = requireTenantId(req);
  const registerId = optionalPositiveInt(req.query?.registerId, "registerId");
  const legalEntityId = optionalPositiveInt(req.query?.legalEntityId, "legalEntityId");
  const sessionId = optionalPositiveInt(req.query?.sessionId, "sessionId");
  const txnTypeRaw = String(req.query?.txnType || "")
    .trim()
    .toUpperCase();
  const txnType = txnTypeRaw ? normalizeEnum(txnTypeRaw, "txnType", TXN_TYPES) : null;
  const statusRaw = String(req.query?.status || "")
    .trim()
    .toUpperCase();
  const status = statusRaw ? normalizeEnum(statusRaw, "status", TXN_STATUSES) : null;
  const bookDateFrom = req.query?.bookDateFrom
    ? parseDateOnly(req.query?.bookDateFrom, "bookDateFrom")
    : null;
  const bookDateTo = req.query?.bookDateTo
    ? parseDateOnly(req.query?.bookDateTo, "bookDateTo")
    : null;
  const pagination = parsePagination(req.query, { limit: 50, offset: 0, maxLimit: 200 });

  return {
    tenantId,
    registerId,
    legalEntityId,
    sessionId,
    txnType,
    status,
    bookDateFrom,
    bookDateTo,
    limit: pagination.limit,
    offset: pagination.offset,
  };
}

export function parseCashTransactionCreateInput(req) {
  const tenantId = requireTenantId(req);
  const userId = requireUserId(req);
  const registerId = optionalPositiveInt(req.body?.registerId, "registerId");
  const cashSessionId = optionalPositiveInt(req.body?.cashSessionId, "cashSessionId");
  const counterAccountId = optionalPositiveInt(req.body?.counterAccountId, "counterAccountId");
  const counterCashRegisterId = optionalPositiveInt(
    req.body?.counterCashRegisterId,
    "counterCashRegisterId"
  );
  const counterpartyId = optionalPositiveInt(req.body?.counterpartyId, "counterpartyId");

  if (!registerId) {
    throw badRequest("registerId is required");
  }

  const txnType = normalizeEnum(req.body?.txnType, "txnType", TXN_TYPES);
  const txnDatetime = parseDateTime(req.body?.txnDatetime, "txnDatetime", new Date().toISOString());
  const bookDate = parseDateOnly(
    req.body?.bookDate,
    "bookDate",
    new Date().toISOString().slice(0, 10)
  );
  const amount = parseAmount(req.body?.amount, "amount", { required: true });
  const currencyCode = normalizeCurrencyCode(req.body?.currencyCode, "currencyCode");
  const description = normalizeText(req.body?.description, "description", 500);
  const referenceNo = normalizeText(req.body?.referenceNo, "referenceNo", 100);
  const sourceDocTypeRaw = String(req.body?.sourceDocType || "")
    .trim()
    .toUpperCase();
  const sourceDocType = sourceDocTypeRaw
    ? normalizeEnum(sourceDocTypeRaw, "sourceDocType", SOURCE_DOC_TYPES)
    : null;
  const sourceDocId = normalizeText(req.body?.sourceDocId, "sourceDocId", 80);
  const counterpartyTypeRaw = String(req.body?.counterpartyType || "")
    .trim()
    .toUpperCase();
  const counterpartyType = counterpartyTypeRaw
    ? normalizeEnum(counterpartyTypeRaw, "counterpartyType", COUNTERPARTY_TYPES)
    : null;
  const idempotencyKey = normalizeText(req.body?.idempotencyKey, "idempotencyKey", 100, {
    required: true,
  });

  return {
    tenantId,
    userId,
    registerId,
    cashSessionId,
    txnType,
    txnDatetime,
    bookDate,
    amount,
    currencyCode,
    description,
    referenceNo,
    sourceDocType,
    sourceDocId,
    counterpartyType,
    counterpartyId,
    counterAccountId,
    counterCashRegisterId,
    idempotencyKey,
  };
}

export function parseCashTransactionCancelInput(req) {
  const tenantId = requireTenantId(req);
  const userId = requireUserId(req);
  const transactionId = parseCashTransactionIdParam(req);
  const cancelReason = normalizeText(req.body?.cancelReason, "cancelReason", 255, {
    required: true,
  });

  return {
    tenantId,
    userId,
    transactionId,
    cancelReason,
  };
}

export function parseCashTransactionPostInput(req) {
  const tenantId = requireTenantId(req);
  const userId = requireUserId(req);
  const transactionId = parseCashTransactionIdParam(req);
  const overrideCashControl = parseBooleanFlag(req.body?.overrideCashControl, false);
  const overrideReason = normalizeText(req.body?.overrideReason, "overrideReason", 500);

  if (overrideCashControl && !overrideReason) {
    throw badRequest("overrideReason is required when overrideCashControl=true");
  }

  return {
    tenantId,
    userId,
    transactionId,
    overrideCashControl,
    overrideReason,
  };
}

export function parseCashTransactionReverseInput(req) {
  const tenantId = requireTenantId(req);
  const userId = requireUserId(req);
  const transactionId = parseCashTransactionIdParam(req);
  const reverseReason = normalizeText(req.body?.reverseReason, "reverseReason", 255, {
    required: true,
  });

  return {
    tenantId,
    userId,
    transactionId,
    reverseReason,
  };
}

