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
export const DOCUMENT_LINE_KINDS = [
  "STANDARD",
  "COMMENT",
  "ROUNDING",
  "ADJUSTMENT",
  "OTHER",
];
export const DOCUMENT_LINE_STOCK_IMPACT_MODES = [
  "NONE",
  "RECEIPT_PENDING",
  "ISSUE_PENDING",
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

function createDocumentLineRowId() {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `doc-line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
}

function normalizeEnum(value, allowedValues, fallbackValue) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  return allowedValues.includes(normalized) ? normalized : fallbackValue;
}

function mapDocumentLineTaxRow(row, fallbackIndex = 0) {
  return {
    componentNo: Number(row?.componentNo ?? row?.component_no ?? fallbackIndex + 1),
    taxCode: String(row?.taxCode ?? row?.tax_code ?? "").trim() || null,
    taxKind: String(row?.taxKind ?? row?.tax_kind ?? "").trim() || null,
    ratePct: toOptionalNumber(row?.ratePct ?? row?.rate_pct),
    taxBaseAmountTxn: toOptionalNumber(
      row?.taxBaseAmountTxn ?? row?.tax_base_amount_txn
    ),
    taxAmountTxn: toOptionalNumber(row?.taxAmountTxn ?? row?.tax_amount_txn),
    taxPurposeCode: String(
      row?.taxPurposeCode ?? row?.tax_purpose_code ?? ""
    ).trim() || null,
    accountId: toPositiveInt(row?.accountId ?? row?.account_id),
  };
}

function resolveLineTaxAmountTxn(line, taxes = []) {
  const explicitTaxAmount = toOptionalNumber(
    line?.lineTaxAmountTxn ??
      line?.line_tax_amount_txn ??
      line?.taxAmountTxn ??
      line?.tax_amount_txn
  );
  if (explicitTaxAmount !== null) {
    return roundDocumentAmount(explicitTaxAmount) ?? 0;
  }
  return roundDocumentAmount(
    taxes.reduce(
      (sum, row) => sum + Number(row?.taxAmountTxn ?? row?.tax_amount_txn ?? 0),
      0
    )
  ) ?? 0;
}

export function computeDocumentLineAmounts(line) {
  const normalizedTaxes = Array.isArray(line?.taxes)
    ? line.taxes.map((row, index) => mapDocumentLineTaxRow(row, index))
    : [];
  const explicitNetAmount = toOptionalNumber(
    line?.lineNetAmountTxn ??
      line?.line_net_amount_txn ??
      line?.netAmountTxn ??
      line?.net_amount_txn ??
      line?.amountTxn ??
      line?.amount_txn
  );
  const quantityInput = toOptionalNumber(line?.quantity ?? line?.qty);
  const quantity =
    quantityInput !== null && quantityInput > 0 ? roundDocumentAmount(quantityInput) : 1;
  let unitPriceTxn = toOptionalNumber(
    line?.unitPriceTxn ?? line?.unit_price_txn ?? line?.unitPrice
  );
  if (unitPriceTxn === null && explicitNetAmount !== null && quantity > 0) {
    unitPriceTxn = roundDocumentAmount(explicitNetAmount / quantity);
  }
  const lineNetAmountTxn =
    unitPriceTxn !== null
      ? roundDocumentAmount(quantity * unitPriceTxn) ?? 0
      : roundDocumentAmount(explicitNetAmount ?? 0) ?? 0;
  const lineTaxAmountTxn = resolveLineTaxAmountTxn(line, normalizedTaxes);
  const lineGrossAmountTxn =
    roundDocumentAmount(lineNetAmountTxn + lineTaxAmountTxn) ?? 0;

  return {
    quantity,
    unitPriceTxn,
    lineNetAmountTxn,
    lineTaxAmountTxn,
    lineGrossAmountTxn,
    taxes: normalizedTaxes,
  };
}

export function createDocumentLineDraft(seed = {}) {
  const amounts = computeDocumentLineAmounts(seed);
  return {
    rowId: String(seed?.rowId || createDocumentLineRowId()),
    lineKind: normalizeEnum(
      seed?.lineKind ?? seed?.line_kind ?? "STANDARD",
      DOCUMENT_LINE_KINDS,
      "STANDARD"
    ),
    description: String(seed?.description || "").trim(),
    itemCardId: String(seed?.itemCardId ?? seed?.item_card_id ?? "").trim(),
    quantity: String(amounts.quantity ?? 1),
    unitPriceTxn:
      amounts.unitPriceTxn === null || amounts.unitPriceTxn === undefined
        ? ""
        : String(amounts.unitPriceTxn),
    lineNetAmountTxn: String(amounts.lineNetAmountTxn ?? 0),
    lineTaxAmountTxn: String(amounts.lineTaxAmountTxn ?? 0),
    lineGrossAmountTxn: String(amounts.lineGrossAmountTxn ?? 0),
    postingAccountId: String(
      seed?.postingAccountId ?? seed?.posting_account_id ?? ""
    ).trim(),
    taxCategoryCode: String(
      seed?.taxCategoryCode ?? seed?.tax_category_code ?? ""
    )
      .trim()
      .toUpperCase(),
    stockImpactMode: normalizeEnum(
      seed?.stockImpactMode ?? seed?.stock_impact_mode ?? "NONE",
      DOCUMENT_LINE_STOCK_IMPACT_MODES,
      "NONE"
    ),
    taxes: amounts.taxes,
    previewStatus: String(seed?.previewStatus || "").trim().toUpperCase(),
    previewError: String(seed?.previewError || "").trim(),
    previewUpdatedAt: String(seed?.previewUpdatedAt || "").trim(),
  };
}

export function normalizeDocumentFormLines(lines, fallback = {}) {
  const normalizedLines = Array.isArray(lines)
    ? lines.map((row) => createDocumentLineDraft(row))
    : [];
  if (normalizedLines.length > 0) {
    return normalizedLines;
  }
  const fallbackAmountTxn = toOptionalNumber(fallback?.amountTxn);
  if (fallbackAmountTxn !== null && fallbackAmountTxn > 0) {
    return [
      createDocumentLineDraft({
        quantity: 1,
        unitPriceTxn: fallbackAmountTxn,
        lineNetAmountTxn: fallbackAmountTxn,
        lineGrossAmountTxn: fallbackAmountTxn,
      }),
    ];
  }
  return [createDocumentLineDraft()];
}

export function getDocumentLineTotals(lines) {
  const normalizedLines = Array.isArray(lines)
    ? lines.map((row) => createDocumentLineDraft(row))
    : [];
  const totals = normalizedLines.reduce(
    (accumulator, row) => {
      accumulator.netAmountTxn += Number(row.lineNetAmountTxn || 0);
      accumulator.taxAmountTxn += Number(row.lineTaxAmountTxn || 0);
      accumulator.grossAmountTxn += Number(row.lineGrossAmountTxn || 0);
      return accumulator;
    },
    {
      lineCount: normalizedLines.length,
      netAmountTxn: 0,
      taxAmountTxn: 0,
      grossAmountTxn: 0,
    }
  );

  return {
    lineCount: totals.lineCount,
    netAmountTxn: roundDocumentAmount(totals.netAmountTxn) ?? 0,
    taxAmountTxn: roundDocumentAmount(totals.taxAmountTxn) ?? 0,
    grossAmountTxn: roundDocumentAmount(totals.grossAmountTxn) ?? 0,
  };
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
  const amountTxnValue =
    row?.amountTxn === null || row?.amountTxn === undefined
      ? row?.amount_txn === null || row?.amount_txn === undefined
        ? ""
        : String(row.amount_txn)
      : String(row.amountTxn);
  const lines = normalizeDocumentFormLines(row?.lines, {
    amountTxn: amountTxnValue,
  });
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
    amountTxn: amountTxnValue,
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
    lines,
  };
}

export function getDocumentFxComputation(form, options = {}) {
  const lineTotals = getDocumentLineTotals(form?.lines);
  const amountTxn =
    lineTotals.lineCount > 0
      ? lineTotals.grossAmountTxn
      : toOptionalNumber(form?.amountTxn);
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
    resolvedAmountTxn: amountTxn,
    lineTotals,
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
  const lines = Array.isArray(form?.lines)
    ? form.lines.map((row, index) => {
        const normalizedLine = createDocumentLineDraft(row);
        return {
          lineNo: index + 1,
          lineKind: normalizedLine.lineKind,
          description: normalizedLine.description || undefined,
          itemCardId: toPositiveInt(normalizedLine.itemCardId) || undefined,
          quantity: toOptionalNumber(normalizedLine.quantity) ?? 1,
          unitPriceTxn: toOptionalNumber(normalizedLine.unitPriceTxn),
          lineNetAmountTxn: toOptionalNumber(normalizedLine.lineNetAmountTxn) ?? 0,
          lineTaxAmountTxn: toOptionalNumber(normalizedLine.lineTaxAmountTxn) ?? 0,
          lineGrossAmountTxn: toOptionalNumber(normalizedLine.lineGrossAmountTxn) ?? 0,
          postingAccountId: toPositiveInt(normalizedLine.postingAccountId) || undefined,
          taxCategoryCode: normalizedLine.taxCategoryCode || undefined,
          stockImpactMode: normalizedLine.stockImpactMode || undefined,
        };
      })
    : [];

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
    amountTxn: lines.length > 0 ? fxComputation.resolvedAmountTxn : amountTxn,
    amountBase: fxComputation.resolvedAmountBase,
    currencyCode,
    fxRate: fxComputation.resolvedFxRate,
    lines: lines.length > 0 ? lines : undefined,
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
  if (payload.lines && payload.lines.length > 0) {
    payload.lines.forEach((line, index) => {
      if ((line.quantity ?? 0) <= 0) {
        errors.push(`lines[${index}].quantity must be > 0.`);
      }
      if ((line.lineNetAmountTxn ?? 0) <= 0) {
        errors.push(`lines[${index}].lineNetAmountTxn must be > 0.`);
      }
      if ((line.lineGrossAmountTxn ?? 0) <= 0) {
        errors.push(`lines[${index}].lineGrossAmountTxn must be > 0.`);
      }
      if ((line.lineTaxAmountTxn ?? 0) > 0 && !line.taxCategoryCode) {
        errors.push(
          `lines[${index}].taxCategoryCode is required when lineTaxAmountTxn > 0.`
        );
      }
    });
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
