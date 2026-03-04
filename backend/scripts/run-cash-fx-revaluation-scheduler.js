#!/usr/bin/env node

import os from "node:os";
import { closePool } from "../src/db.js";
import { enqueueDueCashFxRevaluationJobs } from "../src/services/cash.fx.revaluation.scheduler.service.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseOptionalPositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function main() {
  const pollMs = Math.max(1000, Number(process.env.CASH_FX_REVAL_SCHED_POLL_MS || 60000));
  const tenantId = parseOptionalPositiveInt(process.env.CASH_FX_REVAL_SCHED_TENANT_ID);
  const legalEntityId = parseOptionalPositiveInt(
    process.env.CASH_FX_REVAL_SCHED_LEGAL_ENTITY_ID
  );
  const userId = parseOptionalPositiveInt(process.env.CASH_FX_REVAL_SCHED_USER_ID);
  const limit = parseOptionalPositiveInt(process.env.CASH_FX_REVAL_SCHED_LIMIT) || 200;
  const schedulerId = `cash-fx-reval-scheduler:${os.hostname()}:${process.pid}`;

  // eslint-disable-next-line no-console
  console.log("[cash-fx-revaluation-scheduler] started", {
    schedulerId,
    pollMs,
    tenantId,
    legalEntityId,
    userId,
    limit,
  });

  let shuttingDown = false;
  const stop = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    // eslint-disable-next-line no-console
    console.log(`[cash-fx-revaluation-scheduler] stopping (${signal})`);
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
      const tick = await enqueueDueCashFxRevaluationJobs({
        tenantId,
        legalEntityId,
        userId,
        limit,
      });
      // eslint-disable-next-line no-console
      console.log("[cash-fx-revaluation-scheduler] tick", {
        now: tick.now,
        candidates: tick.total_candidates,
        due: tick.due_runs,
        queued: tick.queued_jobs,
        idempotent: tick.idempotent_hits,
        skipped_not_required: tick.skipped_not_required,
        skipped_already_completed: tick.skipped_already_completed,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[cash-fx-revaluation-scheduler] tick error", err?.message || err);
    }

    // eslint-disable-next-line no-await-in-loop
    await sleep(pollMs);
  }
}

main().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error("[cash-fx-revaluation-scheduler] fatal", err?.message || err);
  try {
    await closePool();
  } catch {
    // ignore close errors
  }
  process.exit(1);
});
