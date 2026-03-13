import { badRequest, parsePositiveInt } from "./_utils.js";
import {
  normalizeCurrencyCode,
  normalizeEnum,
  normalizeText,
  optionalPositiveInt,
  parseBooleanFlag,
  parseAmount,
  parseDateOnly,
  parsePagination,
  requireTenantId,
  requireUserId,
} from "./cash.validators.common.js";

const DIRECTION_VALUES = ["AR", "AP"];
const DOCUMENT_TYPE_VALUES = [
  "INVOICE",
  "DEBIT_NOTE",
  "CREDIT_NOTE",
  "PAYMENT",
  "ADJUSTMENT",
];
const DOCUMENT_STATUS_VALUES = [
  "DRAFT",
  "POSTED",
  "REVERSED",
  "CANCELLED",
  "PARTIALLY_SETTLED",
  "SETTLED",
];
const LINE_KIND_VALUES = ["STANDARD", "COMMENT", "ROUNDING", "ADJUSTMENT", "OTHER"];
const STOCK_IMPACT_MODE_VALUES = ["NONE", "RECEIPT_PENDING", "ISSUE_PENDING"];
const DUE_DATE_REQUIRED_TYPES = new Set(["INVOICE", "DEBIT_NOTE"]);
const MAX_POSTING_LINES = 200;
const MAX_DOCUMENT_LINES = 500;

function parseOptionalDate(value, label) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === "") {
    return null;
  }
  return parseDateOnly(value, label);
}

function parseOptionalFilterDate(value, label) {
  if (value === undefined || value === null) {
    return null;
  }
  const raw = String(value).trim();
  if (!raw) {
    return null;
  }
  return parseDateOnly(raw, label);
}

function pickPrimaryOrAlias(primaryValue, aliasValue) {
  if (primaryValue !== undefined && primaryValue !== null) {
    const normalizedPrimary = String(primaryValue).trim();
    if (normalizedPrimary) {
      return primaryValue;
    }
  }
  return aliasValue;
}

function parseOptionalPositiveIntField(value, label) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === "") {
    return null;
  }
  return optionalPositiveInt(value, label);
}

function parseRequiredPositiveIntField(value, label) {
  const parsed = optionalPositiveInt(value, label);
  if (!parsed) {
    throw badRequest(`${label} is required`);
  }
  return parsed;
}

function parseRequiredRowVersion(value, label = "rowVersion") {
  const parsed = optionalPositiveInt(value, label);
  if (!parsed) {
    throw badRequest(`${label} is required`);
  }
  return parsed;
}

function parseOptionalDecimal(value, label) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw badRequest(`${label} must be a numeric value greater than 0`);
  }
  return parsed.toFixed(10);
}

function parseOptionalShortText(value, label, maxLength = 255) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  const normalized = String(value).trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length > maxLength) {
    throw badRequest(`${label} cannot exceed ${maxLength} characters`);
  }
  return normalized;
}

function parseRequiredAmount(value, label) {
  return parseAmount(value, label, {
    required: true,
    allowZero: false,
  });
}

function parseRequiredNonNegativeAmount(value, label) {
  return parseAmount(value, label, {
    required: true,
    allowZero: true,
  });
}

function parseOptionalNonNegativeAmount(value, label) {
  if (value === undefined) {
    return undefined;
  }
  return parseAmount(value, label, {
    required: true,
    allowZero: true,
  });
}

function parseDocumentLines(value) {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw badRequest("lines must be an array");
  }
  if (value.length === 0) {
    throw badRequest("lines must contain at least one row");
  }
  if (value.length > MAX_DOCUMENT_LINES) {
    throw badRequest(`lines cannot exceed ${MAX_DOCUMENT_LINES} rows`);
  }

  const rows = [];
  for (let index = 0; index < value.length; index += 1) {
    const row = value[index];
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw badRequest(`lines[${index}] must be an object`);
    }

    const lineKind = normalizeEnum(
      row.lineKind ?? row.line_kind ?? "STANDARD",
      `lines[${index}].lineKind`,
      LINE_KIND_VALUES
    );
    const description =
      parseOptionalShortText(
        row.description,
        `lines[${index}].description`,
        500
      ) || null;
    const itemCardId =
      parseOptionalPositiveIntField(
        row.itemCardId ?? row.item_card_id,
        `lines[${index}].itemCardId`
      ) || null;
    const quantity =
      parseOptionalNonNegativeAmount(
        row.quantity ?? row.qty,
        `lines[${index}].quantity`
      ) || "1.000000";
    const unitPriceTxn =
      parseOptionalNonNegativeAmount(
        row.unitPriceTxn ?? row.unit_price_txn ?? row.unitPrice,
        `lines[${index}].unitPriceTxn`
      ) || null;
    const lineNetAmountTxn = parseRequiredNonNegativeAmount(
      row.lineNetAmountTxn ??
        row.line_net_amount_txn ??
        row.netAmountTxn ??
        row.net_amount_txn ??
        row.amountTxn ??
        row.amount_txn,
      `lines[${index}].lineNetAmountTxn`
    );
    const lineTaxAmountTxn =
      parseOptionalNonNegativeAmount(
        row.lineTaxAmountTxn ??
          row.line_tax_amount_txn ??
          row.taxAmountTxn ??
          row.tax_amount_txn,
        `lines[${index}].lineTaxAmountTxn`
      ) || "0.000000";
    const computedGrossAmountTxn = (
      Number(lineNetAmountTxn) + Number(lineTaxAmountTxn)
    ).toFixed(6);
    const lineGrossAmountTxnRaw =
      row.lineGrossAmountTxn ??
      row.line_gross_amount_txn ??
      row.grossAmountTxn ??
      row.gross_amount_txn;
    const lineGrossAmountTxn =
      parseOptionalNonNegativeAmount(
        lineGrossAmountTxnRaw,
        `lines[${index}].lineGrossAmountTxn`
      ) || computedGrossAmountTxn;
    if (Number(lineGrossAmountTxn) !== Number(computedGrossAmountTxn)) {
      throw badRequest(
        `lines[${index}].lineGrossAmountTxn must equal lineNetAmountTxn + lineTaxAmountTxn`
      );
    }

    const postingAccountId =
      parseOptionalPositiveIntField(
        row.postingAccountId ?? row.posting_account_id,
        `lines[${index}].postingAccountId`
      ) || null;
    const taxCodeId =
      parseOptionalPositiveIntField(
        row.taxCodeId ?? row.tax_code_id,
        `lines[${index}].taxCodeId`
      ) || null;
    const taxCode =
      parseOptionalShortText(
        row.taxCode ?? row.tax_code,
        `lines[${index}].taxCode`,
        40
      ) || null;
    const taxCategoryCode =
      parseOptionalShortText(
        row.taxCategoryCode ?? row.tax_category_code,
        `lines[${index}].taxCategoryCode`,
        60
      ) || null;
    const stockImpactMode = normalizeEnum(
      row.stockImpactMode ?? row.stock_impact_mode ?? "NONE",
      `lines[${index}].stockImpactMode`,
      STOCK_IMPACT_MODE_VALUES
    );

    rows.push({
      lineNo: index + 1,
      lineKind,
      description,
      itemCardId,
      quantity,
      unitPriceTxn,
      lineNetAmountTxn,
      lineTaxAmountTxn,
      lineGrossAmountTxn,
      postingAccountId,
      taxCodeId,
      taxCode,
      taxCategoryCode,
      stockImpactMode,
    });
  }

  return rows;
}

function parsePostingLines(value) {
  if (value === undefined) {
    return null;
  }
  if (!Array.isArray(value)) {
    throw badRequest("postingLines must be an array");
  }
  if (value.length === 0) {
    throw badRequest("postingLines must contain at least one row");
  }
  if (value.length > MAX_POSTING_LINES) {
    throw badRequest(`postingLines cannot exceed ${MAX_POSTING_LINES} rows`);
  }

  const rows = [];
  for (let index = 0; index < value.length; index += 1) {
    const row = value[index];
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw badRequest(`postingLines[${index}] must be an object`);
    }

    const amountTxn = parseRequiredAmount(
      row.amountTxn ?? row.amount_txn,
      `postingLines[${index}].amountTxn`
    );
    const amountBase = parseRequiredAmount(
      row.amountBase ?? row.amount_base,
      `postingLines[${index}].amountBase`
    );
    const offsetAccountId = parseOptionalPositiveIntField(
      row.offsetAccountId ?? row.offset_account_id ?? row.offsetGlAccountId,
      `postingLines[${index}].offsetAccountId`
    );
    const offsetAccountCode = parseOptionalShortText(
      row.offsetAccountCode ?? row.offset_account_code ?? row.offsetGlAccountCode,
      `postingLines[${index}].offsetAccountCode`,
      50
    );
    if (offsetAccountId && offsetAccountCode) {
      throw badRequest(
        `Provide either postingLines[${index}].offsetAccountId or postingLines[${index}].offsetAccountCode, not both`
      );
    }

    const description = parseOptionalShortText(
      row.description,
      `postingLines[${index}].description`,
      255
    );

    rows.push({
      amountTxn,
      amountBase,
      offsetAccountId: offsetAccountId || null,
      offsetAccountCode: offsetAccountCode || null,
      description: description || null,
    });
  }

  return rows;
}

function parseOptionalAmount(value, label) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === "") {
    return null;
  }
  return parseAmount(value, label, {
    required: true,
    allowZero: false,
  });
}

function assertFrozenTxnType({ direction, documentType }) {
  if (!DIRECTION_VALUES.includes(direction)) {
    throw badRequest(`direction must be one of ${DIRECTION_VALUES.join(", ")}`);
  }
  if (!DOCUMENT_TYPE_VALUES.includes(documentType)) {
    throw badRequest(
      `documentType must be one of ${DOCUMENT_TYPE_VALUES.join(", ")}`
    );
  }
}

function assertDueDateRule({ documentType, dueDate }) {
  if (DUE_DATE_REQUIRED_TYPES.has(documentType) && !dueDate) {
    throw badRequest(`dueDate is required for documentType=${documentType}`);
  }
}

export function parseDocumentIdParam(req) {
  const documentId = parsePositiveInt(req.params?.documentId);
  if (!documentId) {
    throw badRequest("documentId must be a positive integer");
  }
  return documentId;
}

export function parseDocumentReadFilters(req) {
  const tenantId = requireTenantId(req);
  const legalEntityId = optionalPositiveInt(req.query?.legalEntityId, "legalEntityId");
  const operatingUnitId = optionalPositiveInt(req.query?.operatingUnitId, "operatingUnitId");
  const counterpartyId = optionalPositiveInt(req.query?.counterpartyId, "counterpartyId");
  const q = normalizeText(req.query?.q, "q", 120);
  const dateFrom = parseOptionalFilterDate(
    pickPrimaryOrAlias(req.query?.dateFrom, req.query?.documentDateFrom),
    "dateFrom"
  );
  const dateTo = parseOptionalFilterDate(
    pickPrimaryOrAlias(req.query?.dateTo, req.query?.documentDateTo),
    "dateTo"
  );
  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw badRequest("dateFrom cannot be greater than dateTo");
  }

  const directionRaw = String(req.query?.direction || "")
    .trim()
    .toUpperCase();
  const direction = directionRaw
    ? normalizeEnum(directionRaw, "direction", DIRECTION_VALUES)
    : null;

  const documentTypeRaw = String(req.query?.documentType || "")
    .trim()
    .toUpperCase();
  const documentType = documentTypeRaw
    ? normalizeEnum(documentTypeRaw, "documentType", DOCUMENT_TYPE_VALUES)
    : null;

  const statusRaw = String(req.query?.status || "")
    .trim()
    .toUpperCase();
  const status = statusRaw
    ? normalizeEnum(statusRaw, "status", DOCUMENT_STATUS_VALUES)
    : null;

  const pagination = parsePagination(req.query, { limit: 100, offset: 0, maxLimit: 300 });
  return {
    tenantId,
    legalEntityId,
    operatingUnitId,
    counterpartyId,
    dateFrom,
    dateTo,
    q,
    direction,
    documentType,
    status,
    limit: pagination.limit,
    offset: pagination.offset,
  };
}

export function parseDocumentCreateInput(req) {
  const tenantId = requireTenantId(req);
  const userId = requireUserId(req);
  const legalEntityId = parseRequiredPositiveIntField(
    req.body?.legalEntityId,
    "legalEntityId"
  );
  const operatingUnitIdInput = parseOptionalPositiveIntField(
    req.body?.operatingUnitId,
    "operatingUnitId"
  );
  const operatingUnitId =
    operatingUnitIdInput === undefined ? null : operatingUnitIdInput;
  const counterpartyId = parseRequiredPositiveIntField(
    req.body?.counterpartyId,
    "counterpartyId"
  );
  const paymentTermIdInput = parseOptionalPositiveIntField(
    req.body?.paymentTermId,
    "paymentTermId"
  );
  const paymentTermId =
    paymentTermIdInput === undefined ? null : paymentTermIdInput;

  const direction = normalizeEnum(req.body?.direction, "direction", DIRECTION_VALUES);
  const documentType = normalizeEnum(
    req.body?.documentType,
    "documentType",
    DOCUMENT_TYPE_VALUES
  );
  assertFrozenTxnType({ direction, documentType });

  const documentDate = parseDateOnly(req.body?.documentDate, "documentDate");
  const dueDateInput = parseOptionalDate(req.body?.dueDate, "dueDate");
  const dueDate = dueDateInput === undefined ? null : dueDateInput;
  assertDueDateRule({ documentType, dueDate });

  const lines = parseDocumentLines(req.body?.lines);
  const amountTxn =
    lines === undefined
      ? parseRequiredAmount(req.body?.amountTxn, "amountTxn")
      : parseOptionalAmount(req.body?.amountTxn, "amountTxn");
  const amountBase = parseOptionalAmount(req.body?.amountBase, "amountBase");
  const currencyCode = normalizeCurrencyCode(req.body?.currencyCode, "currencyCode");
  const fxRateInput = parseOptionalDecimal(req.body?.fxRate, "fxRate");
  const fxRate = fxRateInput === undefined ? null : fxRateInput;

  return {
    tenantId,
    userId,
    legalEntityId,
    operatingUnitId,
    counterpartyId,
    paymentTermId,
    direction,
    documentType,
    documentDate,
    dueDate,
    amountTxn,
    amountBase,
    currencyCode,
    fxRate,
    lines: lines === undefined ? null : lines,
  };
}

export function parseDocumentUpdateInput(req) {
  const tenantId = requireTenantId(req);
  const userId = requireUserId(req);
  const documentId = parseDocumentIdParam(req);
  const rowVersion = parseRequiredRowVersion(req.body?.rowVersion, "rowVersion");

  const legalEntityId = parseOptionalPositiveIntField(
    req.body?.legalEntityId,
    "legalEntityId"
  );
  const operatingUnitId = parseOptionalPositiveIntField(
    req.body?.operatingUnitId,
    "operatingUnitId"
  );
  const counterpartyId = parseOptionalPositiveIntField(
    req.body?.counterpartyId,
    "counterpartyId"
  );
  const paymentTermId = parseOptionalPositiveIntField(
    req.body?.paymentTermId,
    "paymentTermId"
  );

  const direction =
    req.body?.direction !== undefined
      ? normalizeEnum(req.body?.direction, "direction", DIRECTION_VALUES)
      : undefined;
  const documentType =
    req.body?.documentType !== undefined
      ? normalizeEnum(req.body?.documentType, "documentType", DOCUMENT_TYPE_VALUES)
      : undefined;

  if (direction !== undefined && documentType !== undefined) {
    assertFrozenTxnType({ direction, documentType });
  } else if (direction !== undefined || documentType !== undefined) {
    const missingField = direction === undefined ? "direction" : "documentType";
    throw badRequest(
      `${missingField} is required when updating documentType/direction pair`
    );
  }

  const documentDate =
    req.body?.documentDate !== undefined
      ? parseDateOnly(req.body?.documentDate, "documentDate")
      : undefined;
  const dueDate = parseOptionalDate(req.body?.dueDate, "dueDate");
  const lines = parseDocumentLines(req.body?.lines);
  const amountTxn = parseOptionalAmount(req.body?.amountTxn, "amountTxn");
  const amountBase = parseOptionalAmount(req.body?.amountBase, "amountBase");
  const currencyCode =
    req.body?.currencyCode !== undefined
      ? normalizeCurrencyCode(req.body?.currencyCode, "currencyCode")
      : undefined;
  const fxRate = parseOptionalDecimal(req.body?.fxRate, "fxRate");

  const hasAnyMutationField =
    legalEntityId !== undefined ||
    operatingUnitId !== undefined ||
    counterpartyId !== undefined ||
    paymentTermId !== undefined ||
    direction !== undefined ||
    documentType !== undefined ||
    documentDate !== undefined ||
    dueDate !== undefined ||
    lines !== undefined ||
    amountTxn !== undefined ||
    amountBase !== undefined ||
    currencyCode !== undefined ||
    fxRate !== undefined;

  if (!hasAnyMutationField) {
    throw badRequest("At least one updatable field is required");
  }

  return {
    tenantId,
    userId,
    documentId,
    rowVersion,
    legalEntityId,
    operatingUnitId,
    counterpartyId,
    paymentTermId,
    direction,
    documentType,
    documentDate,
    dueDate,
    lines,
    amountTxn,
    amountBase,
    currencyCode,
    fxRate,
  };
}

export function parseDraftCancelInput(req) {
  const tenantId = requireTenantId(req);
  const userId = requireUserId(req);
  const documentId = parseDocumentIdParam(req);
  return {
    tenantId,
    userId,
    documentId,
  };
}

export function parseDocumentPostInput(req) {
  const tenantId = requireTenantId(req);
  const userId = requireUserId(req);
  const documentId = parseDocumentIdParam(req);
  const offsetAccountId = parseOptionalPositiveIntField(
    req.body?.offsetAccountId ?? req.body?.offsetGlAccountId,
    "offsetAccountId"
  );
  const offsetAccountCode = parseOptionalShortText(
    req.body?.offsetAccountCode ?? req.body?.offsetGlAccountCode,
    "offsetAccountCode",
    50
  );
  if (offsetAccountId && offsetAccountCode) {
    throw badRequest("Provide either offsetAccountId or offsetAccountCode, not both");
  }
  const useFxOverride = parseBooleanFlag(
    req.body?.useFxOverride ?? req.body?.overrideFxRate,
    false
  );
  const fxOverrideReason = parseOptionalShortText(
    req.body?.fxOverrideReason ?? req.body?.overrideReason,
    "fxOverrideReason",
    500
  );
  if (!useFxOverride && fxOverrideReason) {
    throw badRequest("fxOverrideReason requires useFxOverride=true");
  }
  const postingLines = parsePostingLines(
    req.body?.postingLines ?? req.body?.postLines ?? req.body?.lineItems
  );

  return {
    tenantId,
    userId,
    documentId,
    offsetAccountId: offsetAccountId || null,
    offsetAccountCode: offsetAccountCode || null,
    useFxOverride,
    fxOverrideReason: fxOverrideReason || null,
    postingLines,
  };
}

export function parseDocumentReverseInput(req) {
  const tenantId = requireTenantId(req);
  const userId = requireUserId(req);
  const documentId = parseDocumentIdParam(req);
  const reason =
    parseOptionalShortText(req.body?.reason, "reason", 255) || "Manual reversal";
  const reversalDate =
    req.body?.reversalDate === undefined
      ? null
      : parseDateOnly(req.body?.reversalDate, "reversalDate");

  return {
    tenantId,
    userId,
    documentId,
    reason,
    reversalDate,
  };
}
