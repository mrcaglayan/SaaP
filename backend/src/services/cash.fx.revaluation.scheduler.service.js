import { query } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import { enqueueJob } from "./jobs.service.js";
import { evaluateCashFxRevaluationCloseGate } from "./cash.fx.revaluation.service.js";

const RUN_TYPE_MONTH_END = "MONTH_END";
const RUN_TYPE_YEAR_END = "YEAR_END";

function toIsoDate(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw badRequest("Invalid schedule date");
  }
  return parsed.toISOString().slice(0, 10);
}

function toBoolean(value, fallback = false) {
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

async function listCandidateBookPeriods({
  asOfDate,
  tenantId = null,
  legalEntityId = null,
  limit = 200,
  runQuery = query,
}) {
  const where = ["fp.end_date <= ?", "COALESCE(fp.is_adjustment, FALSE) = FALSE"];
  const params = [asOfDate];

  const scopedTenantId = parsePositiveInt(tenantId);
  if (scopedTenantId) {
    where.push("b.tenant_id = ?");
    params.push(scopedTenantId);
  }
  const scopedLegalEntityId = parsePositiveInt(legalEntityId);
  if (scopedLegalEntityId) {
    where.push("b.legal_entity_id = ?");
    params.push(scopedLegalEntityId);
  }

  const result = await runQuery(
    `SELECT
       b.tenant_id,
       b.legal_entity_id,
       b.id AS book_id,
       b.calendar_id,
       fp.id AS fiscal_period_id,
       fp.fiscal_year,
       fp.period_no,
       fp.end_date
     FROM books b
     JOIN fiscal_periods fp
       ON fp.calendar_id = b.calendar_id
     WHERE ${where.join(" AND ")}
     ORDER BY fp.end_date ASC, b.id ASC
     LIMIT ${normalizeLimit(limit)}`,
    params
  );
  return result.rows || [];
}

async function resolveRunTypeForPeriod({
  calendarId,
  endDate,
  fiscalYear,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT fiscal_year
     FROM fiscal_periods
     WHERE calendar_id = ?
       AND start_date > ?
     ORDER BY start_date ASC, id ASC
     LIMIT 1`,
    [calendarId, endDate]
  );
  const nextYear = Number(result.rows?.[0]?.fiscal_year || fiscalYear || 0);
  return nextYear !== Number(fiscalYear || 0) ? RUN_TYPE_YEAR_END : RUN_TYPE_MONTH_END;
}

function buildJobIdempotencyKey({ bookId, fiscalPeriodId, runType }) {
  return `CASH_FX_REVAL_SCHED|BOOK:${bookId}|PERIOD:${fiscalPeriodId}|TYPE:${runType}`;
}

function buildRunIdempotencyKey({ bookId, fiscalPeriodId, runType }) {
  return `CASH_FX_REVAL_RUN|BOOK:${bookId}|PERIOD:${fiscalPeriodId}|TYPE:${runType}`;
}

export async function enqueueDueCashFxRevaluationJobs({
  tenantId = null,
  legalEntityId = null,
  userId = null,
  limit = 200,
  dryRun = false,
  now = null,
} = {}) {
  const tickDate = now ? new Date(now) : new Date();
  if (Number.isNaN(tickDate.getTime())) {
    throw badRequest("now must be a valid datetime");
  }
  const asOfDate = toIsoDate(tickDate);
  const candidates = await listCandidateBookPeriods({
    asOfDate,
    tenantId,
    legalEntityId,
    limit,
  });

  let dueCount = 0;
  let queuedCount = 0;
  let idempotentHits = 0;
  let skippedNotRequired = 0;
  let skippedAlreadyCompleted = 0;
  const rows = [];

  for (const row of candidates) {
    const runType = await resolveRunTypeForPeriod({
      calendarId: parsePositiveInt(row.calendar_id),
      endDate: row.end_date,
      fiscalYear: Number(row.fiscal_year || 0),
    });
    const gate = await evaluateCashFxRevaluationCloseGate({
      tenantId: parsePositiveInt(row.tenant_id),
      bookId: parsePositiveInt(row.book_id),
      fiscalPeriodId: parsePositiveInt(row.fiscal_period_id),
      runType,
      periodEndDate: row.end_date,
    });

    const item = {
      tenant_id: parsePositiveInt(row.tenant_id),
      legal_entity_id: parsePositiveInt(row.legal_entity_id),
      book_id: parsePositiveInt(row.book_id),
      fiscal_period_id: parsePositiveInt(row.fiscal_period_id),
      run_type: runType,
      period_end_date: row.end_date,
      required: Boolean(gate.required),
      satisfied: Boolean(gate.satisfied),
      reason_code: gate.reasonCode || null,
      foreign_balance_count: Number(gate.foreignBalanceCount || 0),
      queued: false,
      idempotent: false,
      job_id: null,
      skipped_reason: null,
    };

    if (!gate.required) {
      skippedNotRequired += 1;
      item.skipped_reason = "NOT_REQUIRED";
      rows.push(item);
      continue;
    }
    if (gate.satisfied) {
      skippedAlreadyCompleted += 1;
      item.skipped_reason = "ALREADY_COMPLETED";
      rows.push(item);
      continue;
    }

    dueCount += 1;
    if (toBoolean(dryRun, false)) {
      item.skipped_reason = "DRY_RUN";
      rows.push(item);
      continue;
    }

    const queued = await enqueueJob({
      tenantId: parsePositiveInt(row.tenant_id),
      userId: parsePositiveInt(userId) || null,
      spec: {
        queue_name: "ops.cash.fx.revaluation",
        module_code: "CASH",
        job_type: "CASH_FX_REVALUATION_RUN",
        run_after_at: new Date(tickDate.getTime() - 1000),
        idempotency_key: buildJobIdempotencyKey({
          bookId: item.book_id,
          fiscalPeriodId: item.fiscal_period_id,
          runType,
        }),
        payload: {
          tenant_id: item.tenant_id,
          legal_entity_id: item.legal_entity_id,
          book_id: item.book_id,
          fiscal_period_id: item.fiscal_period_id,
          run_type: runType,
          acting_user_id: parsePositiveInt(userId) || null,
          run_idempotency_key: buildRunIdempotencyKey({
            bookId: item.book_id,
            fiscalPeriodId: item.fiscal_period_id,
            runType,
          }),
          trigger_mode: "SCHEDULED",
          schedule_due_date: asOfDate,
        },
      },
    });

    item.job_id = parsePositiveInt(queued?.job?.id) || null;
    item.idempotent = Boolean(queued?.idempotent);
    item.queued = !item.idempotent;
    if (item.idempotent) {
      idempotentHits += 1;
    } else {
      queuedCount += 1;
    }
    rows.push(item);
  }

  return {
    now: tickDate.toISOString(),
    as_of_date: asOfDate,
    dry_run: toBoolean(dryRun, false),
    tenant_id: parsePositiveInt(tenantId),
    legal_entity_id: parsePositiveInt(legalEntityId),
    total_candidates: candidates.length,
    due_runs: dueCount,
    queued_jobs: queuedCount,
    idempotent_hits: idempotentHits,
    skipped_not_required: skippedNotRequired,
    skipped_already_completed: skippedAlreadyCompleted,
    rows,
  };
}

export default {
  enqueueDueCashFxRevaluationJobs,
};
