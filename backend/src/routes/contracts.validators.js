import { badRequest, parsePositiveInt } from "./_utils.js";
import {
  normalizeCurrencyCode,
  normalizeEnum,
  normalizeText,
  optionalPositiveInt,
  parseAmount,
  parseDateOnly,
  parsePagination,
  requireTenantId,
  requireUserId,
} from "./cash.validators.common.js";

const CONTRACT_TYPE_VALUES = ["CUSTOMER", "VENDOR"];
const CONTRACT_STATUS_VALUES = ["DRAFT", "ACTIVE", "SUSPENDED", "CLOSED", "CANCELLED"];
const LINE_STATUS_VALUES = ["ACTIVE", "INACTIVE"];
const RECOGNITION_METHOD_VALUES = ["STRAIGHT_LINE", "MILESTONE", "MANUAL"];
const LINK_TYPE_VALUES = ["BILLING", "ADVANCE", "ADJUSTMENT"];

function parseRequiredPositiveIntField(value, label) {
  const parsed = optionalPositiveInt(value, label);
  if (!parsed) {
    throw badRequest(`${label} is required`);
  }
  return parsed;
}

function parseOptionalDate(value, label) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return parseDateOnly(value, label);
}

function parseOptionalText(value, label, maxLength = 500) {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = normalizeText(value, label, maxLength);
  return normalized || null;
}

function parseOptionalPositiveIntField(value, label) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return optionalPositiveInt(value, label);
}

function parseLineStatus(value, label) {
  if (value === undefined || value === null || value === "") {
    return "ACTIVE";
  }
  return normalizeEnum(value, label, LINE_STATUS_VALUES);
}

function parseRecognitionMethod(value, label) {
  if (value === undefined || value === null || value === "") {
    return "STRAIGHT_LINE";
  }
  return normalizeEnum(value, label, RECOGNITION_METHOD_VALUES);
}

function assertRecognitionDates({
  recognitionMethod,
  recognitionStartDate,
  recognitionEndDate,
  basePath,
}) {
  if (recognitionMethod === "STRAIGHT_LINE") {
    if (!recognitionStartDate || !recognitionEndDate) {
      throw badRequest(
        `${basePath}.recognitionStartDate and ${basePath}.recognitionEndDate are required for STRAIGHT_LINE`
      );
    }
  } else {
    const hasStart = Boolean(recognitionStartDate);
    const hasEnd = Boolean(recognitionEndDate);
    if (hasStart !== hasEnd) {
      throw badRequest(
        `${basePath}.recognitionStartDate and ${basePath}.recognitionEndDate must both be provided or both omitted`
      );
    }
  }

  if (
    recognitionStartDate &&
    recognitionEndDate &&
    recognitionStartDate > recognitionEndDate
  ) {
    throw badRequest(
      `${basePath}.recognitionStartDate cannot be greater than ${basePath}.recognitionEndDate`
    );
  }
}

function parseContractLines(linesInput, label = "lines") {
  if (!Array.isArray(linesInput)) {
    throw badRequest(`${label} must be an array`);
  }

  return linesInput.map((line, index) => {
    const linePath = `${label}[${index}]`;
    const description = normalizeText(
      line?.description,
      `${linePath}.description`,
      255,
      { required: true }
    );
    const lineAmountTxn = parseAmount(line?.lineAmountTxn, `${linePath}.lineAmountTxn`, {
      required: true,
      allowZero: false,
    });
    const lineAmountBase = parseAmount(line?.lineAmountBase, `${linePath}.lineAmountBase`, {
      required: true,
      allowZero: false,
    });

    const recognitionMethod = parseRecognitionMethod(
      line?.recognitionMethod,
      `${linePath}.recognitionMethod`
    );
    const recognitionStartDate = parseOptionalDate(
      line?.recognitionStartDate,
      `${linePath}.recognitionStartDate`
    );
    const recognitionEndDate = parseOptionalDate(
      line?.recognitionEndDate,
      `${linePath}.recognitionEndDate`
    );

    assertRecognitionDates({
      recognitionMethod,
      recognitionStartDate,
      recognitionEndDate,
      basePath: linePath,
    });

    return {
      description,
      lineAmountTxn,
      lineAmountBase,
      recognitionMethod,
      recognitionStartDate,
      recognitionEndDate,
      deferredAccountId: parseOptionalPositiveIntField(
        line?.deferredAccountId,
        `${linePath}.deferredAccountId`
      ),
      revenueAccountId: parseOptionalPositiveIntField(
        line?.revenueAccountId,
        `${linePath}.revenueAccountId`
      ),
      status: parseLineStatus(line?.status, `${linePath}.status`),
    };
  });
}

function parseHeaderDates(startDateValue, endDateValue) {
  const startDate = parseDateOnly(startDateValue, "startDate");
  const endDate = parseOptionalDate(endDateValue, "endDate");
  if (endDate && startDate > endDate) {
    throw badRequest("startDate cannot be greater than endDate");
  }
  return { startDate, endDate };
}

function parseContractUpsertInput(req, { includeContractId }) {
  const tenantId = requireTenantId(req);
  const userId = requireUserId(req);
  const contractId = includeContractId
    ? parseRequiredPositiveIntField(req.params?.contractId, "contractId")
    : null;

  const legalEntityId = parseRequiredPositiveIntField(
    req.body?.legalEntityId,
    "legalEntityId"
  );
  const counterpartyId = parseRequiredPositiveIntField(
    req.body?.counterpartyId,
    "counterpartyId"
  );
  const contractNo = normalizeText(req.body?.contractNo, "contractNo", 80, {
    required: true,
  });
  const contractType = normalizeEnum(
    req.body?.contractType,
    "contractType",
    CONTRACT_TYPE_VALUES
  );
  const currencyCode = normalizeCurrencyCode(req.body?.currencyCode, "currencyCode");
  const { startDate, endDate } = parseHeaderDates(req.body?.startDate, req.body?.endDate);
  const notes = parseOptionalText(req.body?.notes, "notes", 500);
  const lines = parseContractLines(req.body?.lines, "lines");

  return {
    tenantId,
    userId,
    contractId,
    legalEntityId,
    counterpartyId,
    contractNo,
    contractType,
    currencyCode,
    startDate,
    endDate,
    notes,
    lines,
  };
}

export function parseContractIdParam(req) {
  const contractId = parsePositiveInt(req.params?.contractId);
  if (!contractId) {
    throw badRequest("contractId must be a positive integer");
  }
  return contractId;
}

export function parseContractListFilters(req) {
  const tenantId = requireTenantId(req);
  const legalEntityId = optionalPositiveInt(req.query?.legalEntityId, "legalEntityId");
  const counterpartyId = optionalPositiveInt(req.query?.counterpartyId, "counterpartyId");
  const q = normalizeText(req.query?.q, "q", 120);

  const contractTypeRaw = String(req.query?.contractType || "")
    .trim()
    .toUpperCase();
  const contractType = contractTypeRaw
    ? normalizeEnum(contractTypeRaw, "contractType", CONTRACT_TYPE_VALUES)
    : null;

  const statusRaw = String(req.query?.status || "")
    .trim()
    .toUpperCase();
  const status = statusRaw
    ? normalizeEnum(statusRaw, "status", CONTRACT_STATUS_VALUES)
    : null;

  const pagination = parsePagination(req.query, {
    limit: 100,
    offset: 0,
    maxLimit: 300,
  });

  return {
    tenantId,
    legalEntityId,
    counterpartyId,
    q,
    contractType,
    status,
    limit: pagination.limit,
    offset: pagination.offset,
  };
}

export function parseContractCreateInput(req) {
  return parseContractUpsertInput(req, { includeContractId: false });
}

export function parseContractUpdateInput(req) {
  return parseContractUpsertInput(req, { includeContractId: true });
}

export function parseContractLifecycleInput(req) {
  const tenantId = requireTenantId(req);
  const userId = requireUserId(req);
  const contractId = parseContractIdParam(req);

  return {
    tenantId,
    userId,
    contractId,
  };
}

export function parseContractLinkDocumentInput(req) {
  const tenantId = requireTenantId(req);
  const userId = requireUserId(req);
  const contractId = parseContractIdParam(req);
  const cariDocumentId = parseRequiredPositiveIntField(
    req.body?.cariDocumentId,
    "cariDocumentId"
  );
  const linkType = normalizeEnum(req.body?.linkType, "linkType", LINK_TYPE_VALUES);
  const linkedAmountTxn = parseAmount(req.body?.linkedAmountTxn, "linkedAmountTxn", {
    required: true,
    allowZero: false,
  });
  const linkedAmountBase = parseAmount(req.body?.linkedAmountBase, "linkedAmountBase", {
    required: true,
    allowZero: false,
  });

  return {
    tenantId,
    userId,
    contractId,
    cariDocumentId,
    linkType,
    linkedAmountTxn,
    linkedAmountBase,
  };
}
