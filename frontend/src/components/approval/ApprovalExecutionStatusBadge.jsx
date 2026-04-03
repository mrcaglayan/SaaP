import { getApprovalExecutionStatusMeta } from "./approvalUi.js";

/**
 * Render the execution status badge for unified approval flows.
 */
export default function ApprovalExecutionStatusBadge({ status, className = "" }) {
  const meta = getApprovalExecutionStatusMeta(status);
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${meta.className} ${className}`.trim()}
    >
      {meta.label}
    </span>
  );
}
