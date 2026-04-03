import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import { enqueueJob } from "../services/jobs.service.js";
import {
  listTenantIdsWithOverdueApprovalEscalations,
  sweepDueApprovalEscalations,
} from "../services/approval.escalation.service.js";

const DEFAULT_SCHEDULE_INTERVAL_MINUTES = 15;

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function normalizeLimit(value, fallback = 200, max = 2000) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

function clampIntervalMinutes(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return DEFAULT_SCHEDULE_INTERVAL_MINUTES;
  }
  return Math.max(1, Math.min(24 * 60, Math.floor(n)));
}

function toDate(value, label = "datetime") {
  const parsed = value ? new Date(value) : new Date();
  if (Number.isNaN(parsed.getTime())) {
    throw badRequest(`${label} is invalid`);
  }
  return parsed;
}

function buildApprovalEscalationJobIdempotencyKey({ tenantId, intervalBucket }) {
  return `APPROVAL_ESCALATION_SWEEP|TENANT:${tenantId}|BUCKET:${intervalBucket}`;
}

/**
 * Queue one approval-escalation sweep job per tenant that currently has due requests.
 */
export async function enqueueDueApprovalEscalationJobs({
  tenantId = null,
  userId = null,
  limit = 200,
  dryRun = false,
  now = null,
  intervalMinutes = null,
} = {}) {
  const tickNow = toDate(now, "now");
  const normalizedLimit = normalizeLimit(limit);
  const normalizedIntervalMinutes = clampIntervalMinutes(intervalMinutes);
  const intervalBucket = Math.floor(
    tickNow.getTime() / (normalizedIntervalMinutes * 60000)
  );
  const tenantIds = await listTenantIdsWithOverdueApprovalEscalations({
    tenantId,
    asOf: tickNow,
    limit: normalizedLimit,
  });

  let queuedJobs = 0;
  let idempotentHits = 0;
  const rows = [];

  for (const dueTenantId of tenantIds) {
    const item = {
      tenant_id: dueTenantId,
      due: true,
      queued: false,
      idempotent: false,
      skipped_reason: null,
      job_id: null,
    };

    if (parseBoolean(dryRun, false)) {
      item.skipped_reason = "DRY_RUN";
      rows.push(item);
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const queued = await enqueueJob({
      tenantId: dueTenantId,
      userId: parsePositiveInt(userId) || null,
      spec: {
        queue_name: "ops.approvals.escalation",
        module_code: "APPROVAL",
        job_type: "APPROVAL_ESCALATION_SWEEP",
        run_after_at: new Date(tickNow.getTime() - 1000),
        idempotency_key: buildApprovalEscalationJobIdempotencyKey({
          tenantId: dueTenantId,
          intervalBucket,
        }),
        payload: {
          tenant_id: dueTenantId,
          acting_user_id: parsePositiveInt(userId) || null,
          trigger_mode: "SCHEDULED",
          schedule_due_at: tickNow.toISOString(),
          sweep_limit: 250,
        },
      },
    });

    item.job_id = parsePositiveInt(queued?.job?.id) || null;
    item.idempotent = Boolean(queued?.idempotent);
    item.queued = !item.idempotent;
    if (item.idempotent) {
      idempotentHits += 1;
    } else {
      queuedJobs += 1;
    }
    rows.push(item);
  }

  return {
    now: tickNow.toISOString(),
    tenant_id: parsePositiveInt(tenantId),
    dry_run: parseBoolean(dryRun, false),
    interval_minutes: normalizedIntervalMinutes,
    due_tenants: tenantIds.length,
    queued_jobs: queuedJobs,
    idempotent_hits: idempotentHits,
    rows,
  };
}

/**
 * Run one queued approval-escalation sweep job payload.
 */
export async function runApprovalEscalationSweepJob({
  tenantId,
  now = null,
  limit = null,
  triggerMode = "JOB",
} = {}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  if (!normalizedTenantId) {
    throw badRequest("tenantId is required");
  }

  return sweepDueApprovalEscalations({
    tenantId: normalizedTenantId,
    now,
    limit: normalizeLimit(limit, 250, 1000),
    triggerSource: String(triggerMode || "JOB").trim().toUpperCase() || "JOB",
  });
}

export default {
  enqueueDueApprovalEscalationJobs,
  runApprovalEscalationSweepJob,
};
