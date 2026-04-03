import { parsePositiveInt } from "../../routes/_utils.js";
import { runApprovalEscalationSweepJob } from "../../jobs/approval-escalation.job.js";

function badJobPayload(message, code) {
  const err = new Error(message);
  err.status = 400;
  err.errorCode = code || "JOB_PAYLOAD_INVALID";
  err.retryable = false;
  return err;
}

const approvalEscalationHandler = {
  async run({ job, payload }) {
    const tenantId = parsePositiveInt(job?.tenant_id ?? payload?.tenant_id ?? payload?.tenantId);
    const limit = parsePositiveInt(payload?.sweep_limit ?? payload?.sweepLimit) || 250;
    const triggerMode = String(payload?.trigger_mode ?? payload?.triggerMode ?? "JOB")
      .trim()
      .toUpperCase();
    const now = payload?.now || payload?.schedule_due_at || payload?.scheduleDueAt || null;

    if (!tenantId) {
      throw badJobPayload(
        "tenant_id is required for APPROVAL_ESCALATION_SWEEP",
        "JOB_APPROVAL_ESCALATION_MISSING_TENANT"
      );
    }

    const result = await runApprovalEscalationSweepJob({
      tenantId,
      now,
      limit,
      triggerMode,
    });

    return {
      ok: true,
      tenant_id: tenantId,
      scanned_requests: Number(result?.scannedRequests || 0),
      escalated_requests: Number(result?.escalatedRequests || 0),
      notification_count: Number(result?.notificationCount || 0),
      skipped_count: Number(result?.skippedCount || 0),
      error_count: Number(result?.errorCount || 0),
    };
  },
};

export default approvalEscalationHandler;
