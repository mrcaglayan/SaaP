function normalizeStatus(value) {
  return String(value || "").trim().toUpperCase();
}

function formatStatusLabel(status, fallbackLabel) {
  const normalized = normalizeStatus(status);
  if (!normalized) {
    return fallbackLabel;
  }
  return normalized
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Return whether a review/request status currently represents an escalated item.
 */
export function isApprovalRequestEscalated(status) {
  return normalizeStatus(status) === "ESCALATED";
}

/**
 * Return display metadata for approval review/request statuses.
 */
export function getApprovalRequestStatusMeta(status) {
  const normalized = normalizeStatus(status);
  switch (normalized) {
    case "SUBMITTED":
    case "PENDING":
    case "PENDING_REVIEW":
      return {
        label: "Pending Review",
        className: "border border-amber-200 bg-amber-50 text-amber-800",
      };
    case "RETURNED":
      return {
        label: "Returned",
        className: "border border-orange-200 bg-orange-50 text-orange-700",
      };
    case "APPROVED":
      return {
        label: "Approved",
        className: "border border-emerald-200 bg-emerald-50 text-emerald-700",
      };
    case "REJECTED":
      return {
        label: "Rejected",
        className: "border border-rose-200 bg-rose-50 text-rose-700",
      };
    case "WITHDRAWN":
    case "CANCELLED":
      return {
        label: "Withdrawn",
        className: "border border-slate-200 bg-slate-100 text-slate-700",
      };
    case "ESCALATED":
      return {
        label: "Escalated",
        className: "border border-amber-300 bg-amber-50 text-amber-800 shadow-[inset_0_0_0_1px_rgba(251,191,36,0.15)]",
      };
    case "DRAFT":
      return {
        label: "Draft",
        className: "border border-slate-200 bg-slate-100 text-slate-700",
      };
    default:
      return {
        label: formatStatusLabel(normalized, "Not Tracked"),
        className: "border border-slate-200 bg-slate-50 text-slate-600",
      };
  }
}

/**
 * Return display metadata for approval execution statuses.
 */
export function getApprovalExecutionStatusMeta(status) {
  const normalized = normalizeStatus(status);
  switch (normalized) {
    case "EXECUTING":
      return {
        label: "Executing",
        className: "border border-sky-200 bg-sky-50 text-sky-700",
      };
    case "EXECUTED":
      return {
        label: "Executed",
        className: "border border-cyan-200 bg-cyan-50 text-cyan-700",
      };
    case "FAILED":
      return {
        label: "Execution Failed",
        className: "border border-rose-200 bg-rose-50 text-rose-700",
      };
    case "REVERSED":
      return {
        label: "Execution Reversed",
        className: "border border-amber-200 bg-amber-50 text-amber-800",
      };
    case "NOT_EXECUTED":
      return {
        label: "Not Executed",
        className: "border border-slate-200 bg-slate-100 text-slate-700",
      };
    default:
      return {
        label: formatStatusLabel(normalized, "Not Tracked"),
        className: "border border-slate-200 bg-slate-50 text-slate-600",
      };
  }
}
