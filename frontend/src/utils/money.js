const DEFAULT_FALLBACK = "-";
const DEFAULT_MINIMUM_FRACTION_DIGITS = 2;
const DEFAULT_MAXIMUM_FRACTION_DIGITS = 2;

function normalizeFallback(value) {
  const text = String(value ?? "").trim();
  return text || DEFAULT_FALLBACK;
}

function parsePositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function findRowById(rows, targetId) {
  const resolvedTargetId = parsePositiveInt(targetId);
  if (!resolvedTargetId) {
    return null;
  }
  return (
    (Array.isArray(rows) ? rows : []).find(
      (row) => parsePositiveInt(row?.id) === resolvedTargetId
    ) || null
  );
}

export function normalizeMoneyCurrencyCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

export function resolveLegalEntityFunctionalCurrencyCode(legalEntityRows, legalEntityId) {
  const matchedRow = findRowById(legalEntityRows, legalEntityId);
  return normalizeMoneyCurrencyCode(
    matchedRow?.functional_currency_code || matchedRow?.functionalCurrencyCode
  );
}

export function resolveBookBaseCurrencyCode(bookRows, bookId) {
  const matchedRow = findRowById(bookRows, bookId);
  return normalizeMoneyCurrencyCode(
    matchedRow?.base_currency_code || matchedRow?.baseCurrencyCode
  );
}

export function resolveContextBaseCurrencyCode({
  legalEntityRows = [],
  legalEntityId = null,
  bookRows = [],
  bookId = null,
} = {}) {
  return (
    resolveBookBaseCurrencyCode(bookRows, bookId) ||
    resolveLegalEntityFunctionalCurrencyCode(legalEntityRows, legalEntityId)
  );
}

export function formatMoneyAmount(
  value,
  {
    fallback = DEFAULT_FALLBACK,
    locale = undefined,
    minimumFractionDigits = DEFAULT_MINIMUM_FRACTION_DIGITS,
    maximumFractionDigits = DEFAULT_MAXIMUM_FRACTION_DIGITS,
  } = {}
) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return normalizeFallback(fallback);
  }
  return parsed.toLocaleString(locale, {
    minimumFractionDigits,
    maximumFractionDigits,
  });
}

export function formatMoneyText(
  value,
  currencyCode,
  {
    fallback = DEFAULT_FALLBACK,
    locale = undefined,
    minimumFractionDigits = DEFAULT_MINIMUM_FRACTION_DIGITS,
    maximumFractionDigits = DEFAULT_MAXIMUM_FRACTION_DIGITS,
    showCurrency = true,
  } = {}
) {
  const amountText = formatMoneyAmount(value, {
    fallback,
    locale,
    minimumFractionDigits,
    maximumFractionDigits,
  });
  if (!showCurrency) {
    return amountText;
  }
  const normalizedCurrencyCode = normalizeMoneyCurrencyCode(currencyCode);
  return normalizedCurrencyCode ? `${amountText} ${normalizedCurrencyCode}` : amountText;
}
