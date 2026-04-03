const MASKED_SENSITIVE_VALUE_PATTERN = /^\*{3,}.*$/;

function normalizeFieldToken(value) {
  return String(value || "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
}

/**
 * Classify a value so the UI can distinguish full, masked, hidden, and empty
 * sensitive-field states without inventing a separate transport contract.
 */
export function getSensitiveValueState(value, { hiddenWhenMissing = false } = {}) {
  if (value === undefined) {
    return hiddenWhenMissing ? "hidden" : "empty";
  }
  if (value === null) {
    return "empty";
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return "empty";
    }
    return MASKED_SENSITIVE_VALUE_PATTERN.test(trimmed) ? "masked" : "full";
  }
  return String(value) === "***" ? "masked" : "full";
}

/**
 * Returns whether a state represents a row-scope-sensitive restriction.
 */
export function isRestrictedSensitiveState(state) {
  return state === "masked" || state === "hidden";
}

/**
 * Convenience helper for direct row-value checks on list/detail pages.
 */
export function isRestrictedSensitiveValue(value, options = undefined) {
  return isRestrictedSensitiveState(getSensitiveValueState(value, options));
}

/**
 * Prevents restricted placeholder states from being echoed back into update
 * payloads. A blank restricted input means "keep stored value" until the user
 * explicitly enters a replacement.
 */
export function buildSensitiveUpdateValue(value, restrictedState) {
  const nextValue = String(value || "").trim();
  if (isRestrictedSensitiveState(restrictedState) && !nextValue) {
    return undefined;
  }
  return nextValue || null;
}

/**
 * Intersects the entitlements `maskedFields` summary with fields relevant to
 * the current page so the UI can show compact, high-signal notices.
 */
export function filterMaskedFieldSummary(maskedFields, candidateFields = []) {
  const candidates = new Set(
    (Array.isArray(candidateFields) ? candidateFields : [])
      .map((value) => normalizeFieldToken(value))
      .filter(Boolean)
  );
  const values = Array.isArray(maskedFields) ? maskedFields : [];
  const result = [];
  for (const value of values) {
    const normalized = normalizeFieldToken(value);
    if (!normalized) {
      continue;
    }
    if (candidates.size > 0 && !candidates.has(normalized)) {
      continue;
    }
    if (!result.includes(normalized)) {
      result.push(normalized);
    }
  }
  return result;
}

/**
 * Formats backend field names into short UI tags for page-level masking
 * notices.
 */
export function formatSensitiveFieldLabel(fieldName) {
  const normalized = normalizeFieldToken(fieldName);
  switch (normalized) {
    case "iban":
      return "IBAN";
    case "account_no":
    case "account_number":
      return "Account number";
    case "net_pay":
      return "Net pay";
    case "base_salary":
      return "Base salary";
    default:
      return normalized
        .split("_")
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
  }
}
