import { formatMoneyAmount, formatMoneyText, normalizeMoneyCurrencyCode } from "../utils/money.js";

function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

export default function MoneyText({
  amount,
  currencyCode,
  variant = "inline",
  fallback = "-",
  showCurrency = true,
  locale = undefined,
  minimumFractionDigits = 2,
  maximumFractionDigits = 2,
  className = "",
  amountClassName = "",
  currencyClassName = "",
}) {
  const normalizedCurrencyCode = showCurrency
    ? normalizeMoneyCurrencyCode(currencyCode)
    : "";

  if (variant === "stack") {
    const amountText = formatMoneyAmount(amount, {
      fallback,
      locale,
      minimumFractionDigits,
      maximumFractionDigits,
    });
    return (
      <div className={joinClassNames("leading-tight", className)}>
        <div className={amountClassName}>{amountText}</div>
        {normalizedCurrencyCode ? (
          <div
            className={joinClassNames(
              "text-[11px] font-medium uppercase tracking-wide text-slate-500",
              currencyClassName
            )}
          >
            {normalizedCurrencyCode}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <span className={className}>
      {formatMoneyText(amount, normalizedCurrencyCode, {
        fallback,
        locale,
        minimumFractionDigits,
        maximumFractionDigits,
        showCurrency,
      })}
    </span>
  );
}
