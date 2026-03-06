const DEFAULT_FALLBACK = "-";
const DEFAULT_MINIMUM_FRACTION_DIGITS = 2;
const DEFAULT_MAXIMUM_FRACTION_DIGITS = 6;

function normalizeFallback(value) {
  const text = String(value ?? "").trim();
  return text || DEFAULT_FALLBACK;
}

export function normalizeMoneyCurrencyCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
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
