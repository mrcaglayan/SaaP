const AMOUNT_SCALE = 6;
const AMOUNT_EPSILON = 0.000001;

export const FX_MISSING_REASON_CODES = Object.freeze({
  SETTLEMENT_OR_DOCUMENT_CURRENCY_MISSING:
    "SETTLEMENT_OR_DOCUMENT_CURRENCY_MISSING",
  FUNCTIONAL_CURRENCY_REQUIRED_FOR_DERIVED_CROSS_RATE:
    "FUNCTIONAL_CURRENCY_REQUIRED_FOR_DERIVED_CROSS_RATE",
  SETTLEMENT_DOCUMENT_CONVERSION_RATE_MISSING:
    "SETTLEMENT_DOCUMENT_CONVERSION_RATE_MISSING",
  DERIVED_CROSS_RATE_INVALID: "DERIVED_CROSS_RATE_INVALID",
});

function roundAmount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Number(parsed.toFixed(AMOUNT_SCALE));
}

function normalizeCurrencyCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .slice(0, 3);
}

function normalizeUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normalizeDateOnly(value) {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }
  return text.slice(0, 10);
}

function normalizePositiveRate(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Number(parsed.toFixed(10));
}

function normalizeFxRateRow(row) {
  const fromCurrencyCode = normalizeCurrencyCode(
    row?.from_currency_code || row?.fromCurrencyCode
  );
  const toCurrencyCode = normalizeCurrencyCode(
    row?.to_currency_code || row?.toCurrencyCode
  );
  const rate = normalizePositiveRate(row?.rate ?? row?.value);
  if (!fromCurrencyCode || !toCurrencyCode || !rate) {
    return null;
  }
  const rateType = normalizeUpperText(row?.rate_type || row?.rateType || "SPOT");
  return {
    fromCurrencyCode,
    toCurrencyCode,
    rate,
    rateType: rateType || "SPOT",
    rateDate: normalizeDateOnly(row?.rate_date || row?.rateDate),
    source: String(row?.source || "").trim() || null,
  };
}

function buildFxRatePairMap(fxRates = []) {
  const map = new Map();
  for (const raw of fxRates || []) {
    const row = normalizeFxRateRow(raw);
    if (!row || row.rateType !== "SPOT") {
      continue;
    }
    const key = `${row.fromCurrencyCode}|${row.toCurrencyCode}`;
    if (!map.has(key)) {
      map.set(key, row);
    }
  }
  return map;
}

function lookupFxRate(pairMap, fromCurrencyCode, toCurrencyCode) {
  const from = normalizeCurrencyCode(fromCurrencyCode);
  const to = normalizeCurrencyCode(toCurrencyCode);
  if (!from || !to) {
    return null;
  }
  return pairMap.get(`${from}|${to}`) || null;
}

function pickEarlierDate(leftDate, rightDate, fallbackDate) {
  const left = normalizeDateOnly(leftDate);
  const right = normalizeDateOnly(rightDate);
  if (left && right) {
    return left <= right ? left : right;
  }
  return left || right || normalizeDateOnly(fallbackDate);
}

function resolveSettlementToDocumentCrossRate({
  settlementCurrencyCode,
  documentCurrencyCode,
  functionalCurrencyCode,
  settlementDate,
  providedSettlementFxRate,
  fxRatePairMap,
}) {
  const settlementCurrency = normalizeCurrencyCode(settlementCurrencyCode);
  const documentCurrency = normalizeCurrencyCode(documentCurrencyCode);
  const functionalCurrency = normalizeCurrencyCode(functionalCurrencyCode);
  const normalizedDate = normalizeDateOnly(settlementDate);

  if (!settlementCurrency || !documentCurrency) {
    return {
      appliedCrossRate: null,
      crossRateSource: null,
      crossRateDate: normalizedDate,
      missingRate: true,
      missingReasonCode:
        FX_MISSING_REASON_CODES.SETTLEMENT_OR_DOCUMENT_CURRENCY_MISSING,
      missingReason: "",
    };
  }

  if (settlementCurrency === documentCurrency) {
    return {
      appliedCrossRate: 1,
      crossRateSource: "PARITY",
      crossRateDate: normalizedDate,
      missingRate: false,
      missingReasonCode: "",
      missingReason: "",
    };
  }

  const direct = lookupFxRate(fxRatePairMap, settlementCurrency, documentCurrency);
  if (direct?.rate) {
    return {
      appliedCrossRate: direct.rate,
      crossRateSource: direct.source || "FX_TABLE_EXACT_SPOT",
      crossRateDate: direct.rateDate || normalizedDate,
      missingRate: false,
      missingReasonCode: "",
      missingReason: "",
    };
  }

  if (!functionalCurrency) {
    return {
      appliedCrossRate: null,
      crossRateSource: null,
      crossRateDate: normalizedDate,
      missingRate: true,
      missingReasonCode:
        FX_MISSING_REASON_CODES.FUNCTIONAL_CURRENCY_REQUIRED_FOR_DERIVED_CROSS_RATE,
      missingReason: "",
    };
  }

  let settlementToFunctionalRate = null;
  let settlementToFunctionalSource = "";
  let settlementToFunctionalDate = null;
  if (settlementCurrency === functionalCurrency) {
    settlementToFunctionalRate = 1;
    settlementToFunctionalSource = "PARITY";
    settlementToFunctionalDate = normalizedDate;
  } else {
    const providedRate = normalizePositiveRate(providedSettlementFxRate);
    if (providedRate) {
      settlementToFunctionalRate = providedRate;
      settlementToFunctionalSource = "REQUEST_FX_RATE";
      settlementToFunctionalDate = normalizedDate;
    } else {
      const fx = lookupFxRate(fxRatePairMap, settlementCurrency, functionalCurrency);
      settlementToFunctionalRate = fx?.rate || null;
      settlementToFunctionalSource = fx?.source || "";
      settlementToFunctionalDate = fx?.rateDate || null;
    }
  }

  let documentToFunctionalRate = null;
  let documentToFunctionalSource = "";
  let documentToFunctionalDate = null;
  if (documentCurrency === functionalCurrency) {
    documentToFunctionalRate = 1;
    documentToFunctionalSource = "PARITY";
    documentToFunctionalDate = normalizedDate;
  } else {
    const fx = lookupFxRate(fxRatePairMap, documentCurrency, functionalCurrency);
    documentToFunctionalRate = fx?.rate || null;
    documentToFunctionalSource = fx?.source || "";
    documentToFunctionalDate = fx?.rateDate || null;
  }

  if (!settlementToFunctionalRate || !documentToFunctionalRate) {
    return {
      appliedCrossRate: null,
      crossRateSource: null,
      crossRateDate: normalizedDate,
      missingRate: true,
      missingReasonCode:
        FX_MISSING_REASON_CODES.SETTLEMENT_DOCUMENT_CONVERSION_RATE_MISSING,
      missingReason: "",
    };
  }

  const appliedCrossRate = normalizePositiveRate(
    settlementToFunctionalRate / documentToFunctionalRate
  );
  if (!appliedCrossRate) {
    return {
      appliedCrossRate: null,
      crossRateSource: null,
      crossRateDate: normalizedDate,
      missingRate: true,
      missingReasonCode: FX_MISSING_REASON_CODES.DERIVED_CROSS_RATE_INVALID,
      missingReason: "",
    };
  }

  const sourceUpper = String(settlementToFunctionalSource || "").toUpperCase();
  const documentSourceUpper = String(documentToFunctionalSource || "").toUpperCase();
  let crossRateSource = "DERIVED_VIA_FUNCTIONAL";
  if (sourceUpper === "REQUEST_FX_RATE") {
    crossRateSource = "DERIVED_VIA_FUNCTIONAL_REQUEST";
  } else if (sourceUpper.includes("PRIOR") || documentSourceUpper.includes("PRIOR")) {
    crossRateSource = "DERIVED_VIA_FUNCTIONAL_PRIOR";
  }

  return {
    appliedCrossRate,
    crossRateSource,
    crossRateDate: pickEarlierDate(
      settlementToFunctionalDate,
      documentToFunctionalDate,
      normalizedDate
    ),
    missingRate: false,
    missingReasonCode: "",
    missingReason: "",
  };
}

export function buildAutoAllocatePreview(openItems = [], incomingAmountTxn = 0, options = {}) {
  const sorted = [...openItems].sort((a, b) => {
    const aDue = String(a?.dueDate || "");
    const bDue = String(b?.dueDate || "");
    if (aDue !== bDue) return aDue.localeCompare(bDue);
    const aDocumentDate = String(a?.documentDate || "");
    const bDocumentDate = String(b?.documentDate || "");
    if (aDocumentDate !== bDocumentDate) return aDocumentDate.localeCompare(bDocumentDate);
    return Number(a?.openItemId || 0) - Number(b?.openItemId || 0);
  });

  const settlementCurrencyCode = normalizeCurrencyCode(options?.settlementCurrencyCode);
  const functionalCurrencyCode = normalizeCurrencyCode(options?.functionalCurrencyCode);
  const settlementDate = normalizeDateOnly(options?.settlementDate);
  const providedSettlementFxRate = options?.providedSettlementFxRate;
  const fxRatePairMap = buildFxRatePairMap(options?.fxRates || []);

  let remainingSettlementTxn = Math.max(0, roundAmount(incomingAmountTxn || 0));
  let allocationBlockedByFx = false;

  return sorted.map((item) => {
    const openAmountDocTxn = Math.max(
      0,
      roundAmount(item?.residualAmountTxnAsOf || 0)
    );
    const documentCurrencyCode = normalizeCurrencyCode(
      item?.currencyCode || item?.currency_code || item?.currencyCodeSnapshot
    );
    const crossRatePolicy = resolveSettlementToDocumentCrossRate({
      settlementCurrencyCode,
      documentCurrencyCode,
      functionalCurrencyCode,
      settlementDate,
      providedSettlementFxRate,
      fxRatePairMap,
    });

    const rowRemainingBefore = remainingSettlementTxn;
    let expectedApplyDocTxn = 0;
    let expectedApplySettlementTxn = 0;
    if (
      !allocationBlockedByFx &&
      rowRemainingBefore > AMOUNT_EPSILON &&
      openAmountDocTxn > AMOUNT_EPSILON
    ) {
      if (crossRatePolicy.missingRate) {
        allocationBlockedByFx = true;
      } else {
        const crossRate = Number(crossRatePolicy.appliedCrossRate || 0);
        if (crossRate > 0) {
          expectedApplyDocTxn = roundAmount(
            Math.min(openAmountDocTxn, rowRemainingBefore * crossRate)
          );
          expectedApplySettlementTxn = roundAmount(expectedApplyDocTxn / crossRate);
          if (expectedApplySettlementTxn > rowRemainingBefore) {
            expectedApplySettlementTxn = roundAmount(rowRemainingBefore);
            expectedApplyDocTxn = roundAmount(
              Math.min(openAmountDocTxn, expectedApplySettlementTxn * crossRate)
            );
          }
          remainingSettlementTxn = Math.max(
            0,
            roundAmount(remainingSettlementTxn - expectedApplySettlementTxn)
          );
        }
      }
    }

    const expectedResidualDocTxn = Math.max(
      0,
      roundAmount(openAmountDocTxn - expectedApplyDocTxn)
    );

    return {
      openItemId: item?.openItemId || null,
      documentId: item?.documentId || null,
      documentNo: item?.documentNo || null,
      documentDate: item?.documentDate || null,
      dueDate: item?.dueDate || null,
      direction: item?.direction || null,
      operatingUnitId: item?.operatingUnitId ?? item?.operating_unit_id ?? null,
      operatingUnitCode:
        item?.operatingUnitCode ?? item?.operating_unit_code ?? null,
      operatingUnitName:
        item?.operatingUnitName ?? item?.operating_unit_name ?? null,
      operatingUnitContextLabel:
        item?.operatingUnitContextLabel ??
        item?.operating_unit_context_label ??
        item?.ownerContextLabel ??
        item?.owner_context_label ??
        null,
      documentCurrencyCode: documentCurrencyCode || null,
      settlementCurrencyCode: settlementCurrencyCode || null,
      openAmountDocTxn,
      expectedApplyDocTxn,
      expectedApplySettlementTxn,
      expectedResidualDocTxn,
      openAmountTxn: openAmountDocTxn,
      expectedApplyTxn: expectedApplyDocTxn,
      expectedResidualTxn: expectedResidualDocTxn,
      appliedCrossRate: crossRatePolicy.appliedCrossRate,
      crossRateSource: crossRatePolicy.crossRateSource,
      crossRateDate: crossRatePolicy.crossRateDate,
      fxMissing: Boolean(crossRatePolicy.missingRate),
      fxMissingReasonCode: crossRatePolicy.missingReasonCode || "",
      fxMissingReason: crossRatePolicy.missingReason || "",
      autoAllocateBlockedByFx:
        allocationBlockedByFx && rowRemainingBefore > AMOUNT_EPSILON,
    };
  });
}

export function buildSettlementApplyPayload(form) {
  const paymentChannel = String(form.paymentChannel || "").trim().toUpperCase();
  const operatingUnitId = Number(form.operatingUnitId || 0);
  const payload = {
    legalEntityId: Number(form.legalEntityId),
    counterpartyId: Number(form.counterpartyId),
    direction: form.direction || undefined,
    settlementDate: form.settlementDate,
    currencyCode: form.currencyCode,
    incomingAmountTxn: Number(form.incomingAmountTxn || 0),
    idempotencyKey: String(form.idempotencyKey || "").trim(),
    autoAllocate: Boolean(form.autoAllocate),
    useUnappliedCash: Boolean(form.useUnappliedCash),
    allocations: Array.isArray(form.allocations) ? form.allocations : [],
    fxRate: form.fxRate || undefined,
    note: form.note || undefined,
  };

  if (Number.isInteger(operatingUnitId) && operatingUnitId > 0) {
    payload.operatingUnitId = operatingUnitId;
  }

  if (paymentChannel) {
    payload.paymentChannel = paymentChannel;
  }
  if (form.linkedCashTransaction) {
    payload.linkedCashTransaction = form.linkedCashTransaction;
  }
  if (paymentChannel !== "CASH") {
    const offsetAccountId = Number(form.offsetAccountId || 0);
    if (Number.isInteger(offsetAccountId) && offsetAccountId > 0) {
      payload.offsetAccountId = offsetAccountId;
    }
  }

  return payload;
}
