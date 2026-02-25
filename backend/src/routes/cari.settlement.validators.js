import { badRequest, parsePositiveInt } from "./_utils.js";
import {
  normalizeCurrencyCode,
  normalizeEnum,
  normalizeText,
  optionalPositiveInt,
  parseAmount,
  parseBooleanFlag,
  parseDateOnly,
  requirePositiveInt,
  requireTenantId,
  requireUserId,
} from "./cash.validators.common.js";

const DIRECTION_VALUES = ["AR", "AP"];
const BANK_ATTACH_TARGET_VALUES = ["SETTLEMENT", "UNAPPLIED_CASH"];
const SOURCE_MODULE_VALUES = ["MANUAL", "CARI", "CONTRACTS", "REVREC", "CASH", "SYSTEM", "OTHER"];
const INTEGRATION_LINK_STATUS_VALUES = [
  "UNLINKED",
  "PENDING",
  "LINKED",
  "PARTIALLY_LINKED",
  "FAILED",
];

function parseOptionalDate(value, label) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return parseDateOnly(value, label);
}

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

function parseAllocations(value) {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw badRequest("allocations must be an array");
  }

  return value.map((entry, index) => {
    const openItemId = requirePositiveInt(entry?.openItemId, `allocations[${index}].openItemId`);
    const amountTxn = parseAmount(entry?.amountTxn, `allocations[${index}].amountTxn`, {
      required: true,
      allowZero: false,
    });
    return {
      openItemId,
      amountTxn,
    };
  });
}

function parseBankReferenceFields(rawBody, { required = false } = {}) {
  const bankStatementLineId = optionalPositiveInt(
    rawBody?.bankStatementLineId,
    "bankStatementLineId"
  );
  const bankTransactionRef =
    normalizeText(rawBody?.bankTransactionRef, "bankTransactionRef", 100) || null;

  if (required && !bankStatementLineId && !bankTransactionRef) {
    throw badRequest("bankStatementLineId or bankTransactionRef is required");
  }

  return {
    bankStatementLineId: bankStatementLineId || null,
    bankTransactionRef,
  };
}

function parseSettlementApplyCommon(req, { idempotencyKeySource, bankReferenceRequired = false }) {
  const tenantId = requireTenantId(req);
  const userId = requireUserId(req);
  const legalEntityId = requirePositiveInt(req.body?.legalEntityId, "legalEntityId");
  const counterpartyId = requirePositiveInt(req.body?.counterpartyId, "counterpartyId");
  const directionRaw = String(req.body?.direction || "")
    .trim()
    .toUpperCase();
  const direction = directionRaw
    ? normalizeEnum(directionRaw, "direction", DIRECTION_VALUES)
    : null;
  const settlementDate = parseDateOnly(
    req.body?.settlementDate,
    "settlementDate",
    new Date().toISOString().slice(0, 10)
  );
  const cashTransactionId = optionalPositiveInt(req.body?.cashTransactionId, "cashTransactionId");
  const currencyCode = normalizeCurrencyCode(req.body?.currencyCode, "currencyCode");
  const incomingAmountTxn = parseAmount(
    req.body?.incomingAmountTxn ?? req.body?.paymentAmountTxn ?? req.body?.amountTxn ?? 0,
    "incomingAmountTxn",
    {
      allowZero: true,
      required: false,
    }
  );
  const idempotencyKey = normalizeText(idempotencyKeySource, "idempotencyKey", 100, {
    required: true,
  });
  const note = normalizeText(req.body?.note, "note", 500);
  const autoAllocate = parseBooleanFlag(req.body?.autoAllocate, false);
  const useUnappliedCash =
    req.body?.useUnappliedCash !== undefined
      ? parseBooleanFlag(req.body?.useUnappliedCash, true)
      : parseBooleanFlag(req.body?.consumeUnapplied, true);
  const fxRate = parseOptionalPositiveDecimal(req.body?.fxRate, "fxRate");
  const sourceModuleRaw = String(req.body?.sourceModule || "")
    .trim()
    .toUpperCase();
  const sourceModule = sourceModuleRaw
    ? normalizeEnum(sourceModuleRaw, "sourceModule", SOURCE_MODULE_VALUES)
    : null;
  const sourceEntityType = normalizeText(req.body?.sourceEntityType, "sourceEntityType", 60);
  const sourceEntityId = normalizeText(req.body?.sourceEntityId, "sourceEntityId", 120);
  const integrationLinkStatusRaw = String(req.body?.integrationLinkStatus || "")
    .trim()
    .toUpperCase();
  const integrationLinkStatus = integrationLinkStatusRaw
    ? normalizeEnum(
        integrationLinkStatusRaw,
        "integrationLinkStatus",
        INTEGRATION_LINK_STATUS_VALUES
      )
    : null;
  const integrationEventUid =
    normalizeText(req.body?.integrationEventUid, "integrationEventUid", 100) || null;
  const allocations = parseAllocations(req.body?.allocations);
  const bankFields = parseBankReferenceFields(req.body, {
    required: bankReferenceRequired,
  });

  if (!autoAllocate && allocations.length === 0) {
    throw badRequest("allocations are required when autoAllocate=false");
  }
  if (autoAllocate && allocations.length > 0) {
    throw badRequest("allocations must be empty when autoAllocate=true");
  }
  if ((sourceEntityType || sourceEntityId || integrationEventUid) && !sourceModule) {
    throw badRequest(
      "sourceModule is required when sourceEntityType, sourceEntityId, or integrationEventUid is provided"
    );
  }
  if (sourceModule && sourceModule !== "MANUAL" && (!sourceEntityType || !sourceEntityId)) {
    throw badRequest("sourceEntityType and sourceEntityId are required when sourceModule is not MANUAL");
  }
  if (cashTransactionId && integrationLinkStatus === "UNLINKED") {
    throw badRequest("integrationLinkStatus cannot be UNLINKED when cashTransactionId is provided");
  }

  return {
    tenantId,
    userId,
    legalEntityId,
    counterpartyId,
    direction,
    settlementDate,
    cashTransactionId,
    currencyCode,
    idempotencyKey,
    incomingAmountTxn: Number(incomingAmountTxn ?? "0.000000"),
    paymentAmountTxn: Number(incomingAmountTxn ?? "0.000000"),
    useUnappliedCash,
    consumeUnapplied: useUnappliedCash,
    note,
    autoAllocate,
    fxRate,
    sourceModule,
    sourceEntityType,
    sourceEntityId,
    integrationLinkStatus,
    integrationEventUid,
    allocations,
    ...bankFields,
  };
}

export function parseSettlementApplyInput(req) {
  const payload = parseSettlementApplyCommon(req, {
    idempotencyKeySource: req.body?.idempotencyKey,
    bankReferenceRequired: false,
  });
  const bankApplyIdempotencyKey =
    normalizeText(req.body?.bankApplyIdempotencyKey, "bankApplyIdempotencyKey", 100) || null;

  return {
    ...payload,
    bankApplyIdempotencyKey,
  };
}

export function parseBankApplyInput(req) {
  const payload = parseSettlementApplyCommon(req, {
    idempotencyKeySource: req.body?.bankApplyIdempotencyKey ?? req.body?.idempotencyKey,
    bankReferenceRequired: true,
  });

  return {
    ...payload,
    bankApplyIdempotencyKey: payload.idempotencyKey,
  };
}

export function parseBankAttachInput(req) {
  const tenantId = requireTenantId(req);
  const userId = requireUserId(req);
  const legalEntityId = requirePositiveInt(req.body?.legalEntityId, "legalEntityId");
  const targetType = normalizeEnum(req.body?.targetType, "targetType", BANK_ATTACH_TARGET_VALUES);
  const settlementBatchId = optionalPositiveInt(req.body?.settlementBatchId, "settlementBatchId");
  const unappliedCashId = optionalPositiveInt(req.body?.unappliedCashId, "unappliedCashId");
  const idempotencyKey = normalizeText(req.body?.idempotencyKey, "idempotencyKey", 100, {
    required: true,
  });
  const note = normalizeText(req.body?.note, "note", 500);
  const bankFields = parseBankReferenceFields(req.body, { required: true });

  if (targetType === "SETTLEMENT" && !settlementBatchId) {
    throw badRequest("settlementBatchId is required when targetType=SETTLEMENT");
  }
  if (targetType === "UNAPPLIED_CASH" && !unappliedCashId) {
    throw badRequest("unappliedCashId is required when targetType=UNAPPLIED_CASH");
  }
  if (targetType === "SETTLEMENT" && unappliedCashId) {
    throw badRequest("unappliedCashId must be empty when targetType=SETTLEMENT");
  }
  if (targetType === "UNAPPLIED_CASH" && settlementBatchId) {
    throw badRequest("settlementBatchId must be empty when targetType=UNAPPLIED_CASH");
  }

  return {
    tenantId,
    userId,
    legalEntityId,
    targetType,
    settlementBatchId: settlementBatchId || null,
    unappliedCashId: unappliedCashId || null,
    idempotencyKey,
    note,
    ...bankFields,
  };
}

export function parseSettlementReverseInput(req) {
  const tenantId = requireTenantId(req);
  const userId = requireUserId(req);
  const settlementBatchId = parsePositiveInt(req.params?.settlementBatchId);
  if (!settlementBatchId) {
    throw badRequest("settlementBatchId must be a positive integer");
  }
  const reversalDate = parseOptionalDate(req.body?.reversalDate, "reversalDate");
  const reason = normalizeText(req.body?.reason, "reason", 255);

  return {
    tenantId,
    userId,
    settlementBatchId,
    reversalDate,
    reason,
  };
}
