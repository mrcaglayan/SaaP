import MoneyText from "../MoneyText.jsx";
import {
  formatSensitiveFieldLabel,
  getSensitiveValueState,
  isRestrictedSensitiveState,
} from "../../utils/sensitiveFieldUi.js";

function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

function SensitiveStateBadge({ state }) {
  if (state === "masked") {
    return (
      <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
        Masked
      </span>
    );
  }
  if (state === "hidden") {
    return (
      <span className="inline-flex rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
        Hidden
      </span>
    );
  }
  return null;
}

export function SensitiveFieldValue({
  value,
  state: providedState,
  hiddenWhenMissing = false,
  monospace = false,
  emptyPlaceholder = "-",
  hiddenPlaceholder = "Restricted",
  className = "",
}) {
  const state = providedState || getSensitiveValueState(value, { hiddenWhenMissing });

  if (state === "empty") {
    return <span className={joinClassNames("text-slate-400", className)}>{emptyPlaceholder}</span>;
  }

  return (
    <span className={joinClassNames("inline-flex items-center gap-2", className)}>
      <span
        className={joinClassNames(
          "text-slate-700",
          monospace ? "font-mono tracking-[0.08em]" : "",
          state === "hidden" ? "italic text-slate-500" : ""
        )}
      >
        {state === "hidden" ? hiddenPlaceholder : String(value)}
      </span>
      <SensitiveStateBadge state={state} />
    </span>
  );
}

export function SensitiveMoneyText({
  amount,
  currencyCode,
  state: providedState,
  hiddenWhenMissing = false,
  fallback = "-",
  className = "",
}) {
  const state = providedState || getSensitiveValueState(amount, { hiddenWhenMissing });

  if (state === "full" || state === "empty") {
    return (
      <MoneyText
        amount={amount}
        currencyCode={currencyCode}
        fallback={fallback}
        className={className}
      />
    );
  }

  return (
    <SensitiveFieldValue
      value={state === "hidden" ? undefined : amount}
      state={state}
      hiddenWhenMissing={hiddenWhenMissing}
      monospace
      emptyPlaceholder={fallback}
      className={className}
    />
  );
}

export function SensitiveFieldEditHint({ fieldLabel, state, previewValue = null }) {
  if (!isRestrictedSensitiveState(state)) {
    return null;
  }

  return (
    <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
      <div className="font-semibold">{fieldLabel} is restricted on this scope.</div>
      {state === "masked" && previewValue ? (
        <div className="mt-1 font-mono tracking-[0.08em] text-amber-900">{previewValue}</div>
      ) : null}
      <div className="mt-1">Leave this field blank to keep the stored value, or enter a replacement.</div>
    </div>
  );
}

export function SensitiveFieldsNotice({
  visible = false,
  title,
  description,
  fieldSummary = [],
}) {
  if (!visible) {
    return null;
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <div className="font-semibold">{title}</div>
      {description ? <div className="mt-1 text-amber-800">{description}</div> : null}
      {fieldSummary.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {fieldSummary.map((fieldName) => (
            <span
              key={fieldName}
              className="inline-flex rounded-full border border-amber-300 bg-white/70 px-2 py-0.5 text-[11px] font-medium text-amber-800"
            >
              {formatSensitiveFieldLabel(fieldName)}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
