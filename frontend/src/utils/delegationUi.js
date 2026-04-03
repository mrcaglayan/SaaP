function normalizeDelegationState(state) {
  return String(state || "")
    .trim()
    .toUpperCase();
}

/**
 * Return the shared label/tone metadata for one delegation lifecycle state.
 */
export function getDelegationStateMeta(state) {
  const normalized = normalizeDelegationState(state);
  if (normalized === "ACTIVE") {
    return {
      state: normalized,
      label: "Active",
      className: "border-emerald-200 bg-emerald-50 text-emerald-700",
    };
  }
  if (normalized === "REVOKED") {
    return {
      state: normalized,
      label: "Revoked",
      className: "border-rose-200 bg-rose-50 text-rose-700",
    };
  }
  if (normalized === "EXPIRED") {
    return {
      state: normalized,
      label: "Expired",
      className: "border-amber-200 bg-amber-50 text-amber-800",
    };
  }
  if (normalized === "UPCOMING") {
    return {
      state: normalized,
      label: "Upcoming",
      className: "border-sky-200 bg-sky-50 text-sky-700",
    };
  }
  return {
    state: normalized || "UNKNOWN",
    label: normalized || "Unknown",
    className: "border-slate-200 bg-slate-50 text-slate-700",
  };
}

export function formatDelegationDate(value) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }
  return parsed.toLocaleDateString();
}

export function formatDelegationWindow(row) {
  const start = formatDelegationDate(row?.effectiveFrom || row?.effective_from);
  const end = formatDelegationDate(row?.effectiveTo || row?.effective_to);
  if (start === "-" && end === "-") {
    return "Open-ended";
  }
  return `${start} -> ${end}`;
}

export function formatDelegationScopeLabel(row) {
  const scopeType = String(row?.scopeType ?? row?.scope_type ?? "").trim().toUpperCase();
  const scopeId = row?.scopeId ?? row?.scope_id ?? null;
  if (!scopeType) {
    return "-";
  }
  return `${scopeType}${scopeId ? ` #${scopeId}` : ""}`;
}
