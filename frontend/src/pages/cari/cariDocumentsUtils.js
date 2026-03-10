export const DOCUMENT_STATUSES = [
  "DRAFT",
  "POSTED",
  "PARTIALLY_SETTLED",
  "SETTLED",
  "CANCELLED",
  "REVERSED",
];

export const DOCUMENT_DIRECTIONS = ["AR", "AP"];

export const DOCUMENT_TYPES = [
  "INVOICE",
  "DEBIT_NOTE",
  "CREDIT_NOTE",
  "PAYMENT",
  "ADJUSTMENT",
];

export const DUE_DATE_REQUIRED_TYPES = new Set(["INVOICE", "DEBIT_NOTE"]);
const DOCUMENT_AMOUNT_PRECISION = 6;

function normalizeCurrencyCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function roundDocumentAmount(value) {
  return Number.isFinite(value) ? Number(value.toFixed(DOCUMENT_AMOUNT_PRECISION)) : null;
}

export function buildDocumentListQuery(filters) {
  return {
    legalEntityId: filters.legalEntityId || undefined,
    operatingUnitId: filters.operatingUnitId || undefined,
    counterpartyId: filters.counterpartyId || undefined,
    direction: filters.direction || undefined,
    documentType: filters.documentType || undefined,
    status: filters.status || undefined,
    dateFrom: filters.dateFrom || filters.documentDateFrom || undefined,
    dateTo: filters.dateTo || filters.documentDateTo || undefined,
    q: filters.q || undefined,
    limit: filters.limit || 100,
    offset: filters.offset || 0,
  };
}

export function requiresDueDate(documentType) {
  return DUE_DATE_REQUIRED_TYPES.has(String(documentType || "").toUpperCase());
}

export function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function toOptionalNumber(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function mapDocumentRowToForm(row) {
  return {
    rowVersion:
      row?.rowVersion === null || row?.rowVersion === undefined
        ? ""
        : String(row.rowVersion),
    legalEntityId: String(row?.legalEntityId ?? row?.legal_entity_id ?? ""),
    operatingUnitId: String(row?.operatingUnitId ?? row?.operating_unit_id ?? ""),
    counterpartyId: String(row?.counterpartyId ?? row?.counterparty_id ?? ""),
    paymentTermId: String(row?.paymentTermId ?? row?.payment_term_id ?? ""),
    direction: String(row?.direction || "AR"),
    documentType: String(row?.documentType ?? row?.document_type ?? "INVOICE"),
    documentDate: String(row?.documentDate ?? row?.document_date ?? ""),
    dueDate: String(row?.dueDate ?? row?.due_date ?? row?.dueDateSnapshot ?? row?.due_date_snapshot ?? ""),
    amountTxn:
      row?.amountTxn === null || row?.amountTxn === undefined
        ? row?.amount_txn === null || row?.amount_txn === undefined
          ? ""
          : String(row.amount_txn)
        : String(row.amountTxn),
    amountBase:
      row?.amountBase === null || row?.amountBase === undefined
        ? row?.amount_base === null || row?.amount_base === undefined
          ? ""
          : String(row.amount_base)
        : String(row.amountBase),
    currencyCode: String(
      row?.currencyCode ??
        row?.currency_code ??
        row?.currencyCodeSnapshot ??
        row?.currency_code_snapshot ??
        ""
    ),
    fxRate:
      row?.fxRate === null || row?.fxRate === undefined
        ? row?.fx_rate === null || row?.fx_rate === undefined
          ? row?.fxRateSnapshot === null || row?.fxRateSnapshot === undefined
            ? row?.fx_rate_snapshot === null || row?.fx_rate_snapshot === undefined
              ? ""
              : String(row.fx_rate_snapshot)
            : String(row.fxRateSnapshot)
          : String(row.fx_rate)
        : String(row.fxRate),
  };
}

export function getDocumentFxComputation(form, options = {}) {
  const amountTxn = toOptionalNumber(form?.amountTxn);
  const amountBaseInput = toOptionalNumber(form?.amountBase);
  const fxRateInput = toOptionalNumber(form?.fxRate);
  const currencyCode = normalizeCurrencyCode(form?.currencyCode);
  const functionalCurrencyCode = normalizeCurrencyCode(options?.functionalCurrencyCode);
  const hasFunctionalCurrency = /^[A-Z]{3}$/.test(functionalCurrencyCode);
  const isLocalCurrency = hasFunctionalCurrency && currencyCode === functionalCurrencyCode;
  const isForeignCurrency =
    hasFunctionalCurrency &&
    /^[A-Z]{3}$/.test(currencyCode) &&
    currencyCode !== functionalCurrencyCode;
  const resolvedFxRate = isLocalCurrency ? 1 : fxRateInput;
  let derivedAmountBase = null;

  if (amountTxn !== null && amountTxn > 0) {
    if (isLocalCurrency) {
      derivedAmountBase = roundDocumentAmount(amountTxn);
    } else if (resolvedFxRate !== null && resolvedFxRate > 0) {
      derivedAmountBase = roundDocumentAmount(amountTxn * resolvedFxRate);
    }
  }

  return {
    functionalCurrencyCode: hasFunctionalCurrency ? functionalCurrencyCode : "",
    isLocalCurrency,
    isForeignCurrency,
    fxRateRequired: isForeignCurrency,
    resolvedFxRate,
    derivedAmountBase,
    resolvedAmountBase: derivedAmountBase ?? amountBaseInput,
  };
}

export function buildDocumentMutationPayload(form, options = {}) {
  const rowVersion = toPositiveInt(form.rowVersion);
  const legalEntityId = toPositiveInt(form.legalEntityId);
  const operatingUnitId = toPositiveInt(form.operatingUnitId);
  const counterpartyId = toPositiveInt(form.counterpartyId);
  const paymentTermId = toPositiveInt(form.paymentTermId);
  const amountTxn = toOptionalNumber(form.amountTxn);
  const fxComputation = getDocumentFxComputation(form, options);
  const direction = String(form.direction || "").trim().toUpperCase();
  const documentType = String(form.documentType || "").trim().toUpperCase();
  const documentDate = String(form.documentDate || "").trim();
  const dueDate = String(form.dueDate || "").trim();
  const currencyCode = normalizeCurrencyCode(form.currencyCode);

  return {
    rowVersion: rowVersion || undefined,
    legalEntityId,
    operatingUnitId: operatingUnitId || undefined,
    counterpartyId,
    paymentTermId,
    direction,
    documentType,
    documentDate,
    dueDate: dueDate || null,
    amountTxn,
    amountBase: fxComputation.resolvedAmountBase,
    currencyCode,
    fxRate: fxComputation.resolvedFxRate,
  };
}

export function validateDocumentMutationForm(form, options = {}) {
  const payload = buildDocumentMutationPayload(form, options);
  const fxComputation = getDocumentFxComputation(form, options);
  const rawFxRate = toOptionalNumber(form.fxRate);
  const errors = [];
  if (!payload.legalEntityId) {
    errors.push("legalEntityId is required.");
  }
  if (!payload.counterpartyId) {
    errors.push("counterpartyId is required.");
  }
  if (!DOCUMENT_DIRECTIONS.includes(payload.direction)) {
    errors.push("direction must be AR or AP.");
  }
  if (!DOCUMENT_TYPES.includes(payload.documentType)) {
    errors.push("documentType is invalid.");
  }
  if (!payload.documentDate) {
    errors.push("documentDate is required.");
  }
  if (requiresDueDate(payload.documentType) && !payload.dueDate) {
    errors.push(`dueDate is required for documentType=${payload.documentType}.`);
  }
  if (payload.amountTxn === null || payload.amountTxn <= 0) {
    errors.push("amountTxn must be > 0.");
  }
  if (!/^[A-Z]{3}$/.test(payload.currencyCode)) {
    errors.push("currencyCode must be a 3-letter code.");
  }
  if (fxComputation.fxRateRequired && (payload.fxRate === null || payload.fxRate <= 0)) {
    errors.push("fxRate is required when currencyCode differs from legal entity functional currency.");
  } else if (String(form.fxRate || "").trim() && (rawFxRate === null || rawFxRate <= 0)) {
    errors.push("fxRate must be > 0 when provided.");
  }

  return {
    payload,
    errors,
  };
}
