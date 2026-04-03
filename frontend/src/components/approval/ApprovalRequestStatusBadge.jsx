import { getApprovalRequestStatusMeta } from "./approvalUi.js";

/**
 * Render the review/request status badge for unified approval flows.
 */
export default function ApprovalRequestStatusBadge({ status, className = "" }) {
  const meta = getApprovalRequestStatusMeta(status);
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${meta.className} ${className}`.trim()}
    >
      {meta.label}
    </span>
  );
}
