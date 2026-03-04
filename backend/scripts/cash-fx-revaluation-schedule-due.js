#!/usr/bin/env node

import { closePool } from "../src/db.js";
import { enqueueDueCashFxRevaluationJobs } from "../src/services/cash.fx.revaluation.scheduler.service.js";

function parseOptionalPositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  const text = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(text)) return true;
  if (["0", "false", "no", "off"].includes(text)) return false;
  return fallback;
}

async function main() {
  const tenantId = parseOptionalPositiveInt(process.env.CASH_FX_REVAL_SCHED_TENANT_ID);
  const legalEntityId = parseOptionalPositiveInt(
    process.env.CASH_FX_REVAL_SCHED_LEGAL_ENTITY_ID
  );
  const userId = parseOptionalPositiveInt(process.env.CASH_FX_REVAL_SCHED_USER_ID);
  const limit = parseOptionalPositiveInt(process.env.CASH_FX_REVAL_SCHED_LIMIT) || 200;
  const dryRun = parseBoolean(process.env.CASH_FX_REVAL_SCHED_DRY_RUN, false);

  const result = await enqueueDueCashFxRevaluationJobs({
    tenantId,
    legalEntityId,
    userId,
    limit,
    dryRun,
  });

  // eslint-disable-next-line no-console
  console.log("[cash-fx-revaluation-scheduler] tick completed");
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[cash-fx-revaluation-scheduler] fatal", err?.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await closePool();
    } catch {
      // ignore close errors
    }
  });
