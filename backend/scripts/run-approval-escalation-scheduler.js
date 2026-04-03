#!/usr/bin/env node

import os from "node:os";
import { closePool } from "../src/db.js";
import { enqueueDueApprovalEscalationJobs } from "../src/jobs/approval-escalation.job.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseOptionalPositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function main() {
  const pollMs = Math.max(
    1000,
    Number(process.env.APPROVAL_ESCALATION_POLL_MS || 60000)
  );
  const tenantId = parseOptionalPositiveInt(process.env.APPROVAL_ESCALATION_TENANT_ID);
  const userId = parseOptionalPositiveInt(process.env.APPROVAL_ESCALATION_USER_ID);
  const limit = parseOptionalPositiveInt(process.env.APPROVAL_ESCALATION_LIMIT) || 200;
  const intervalMinutes =
    parseOptionalPositiveInt(process.env.APPROVAL_ESCALATION_INTERVAL_MINUTES) || null;
  const schedulerId = `approval-escalation-scheduler:${os.hostname()}:${process.pid}`;

  // eslint-disable-next-line no-console
  console.log("[approval-escalation-scheduler] started", {
    schedulerId,
    pollMs,
    tenantId,
    userId,
    limit,
    intervalMinutes,
  });

  let shuttingDown = false;
  const stop = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    // eslint-disable-next-line no-console
    console.log(`[approval-escalation-scheduler] stopping (${signal})`);
    try {
      await closePool();
    } finally {
      process.exit(0);
    }
  };

  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));

  while (!shuttingDown) {
    try {
      const tick = await enqueueDueApprovalEscalationJobs({
        tenantId,
        userId,
        limit,
        intervalMinutes,
      });

      // eslint-disable-next-line no-console
      console.log("[approval-escalation-scheduler] tick", {
        now: tick.now,
        due_tenants: tick.due_tenants,
        queued_jobs: tick.queued_jobs,
        idempotent_hits: tick.idempotent_hits,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[approval-escalation-scheduler] tick error", err?.message || err);
    }

    // eslint-disable-next-line no-await-in-loop
    await sleep(pollMs);
  }
}

main().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error("[approval-escalation-scheduler] fatal", err?.message || err);
  try {
    await closePool();
  } catch {
    // ignore close errors during fatal shutdown
  }
  process.exit(1);
});
