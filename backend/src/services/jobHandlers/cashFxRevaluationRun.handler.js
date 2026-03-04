import { parsePositiveInt } from "../../routes/_utils.js";
import { runCashFxRevaluation } from "../cash.fx.revaluation.service.js";

function badJobPayload(message, code) {
  const err = new Error(message);
  err.status = 400;
  err.errorCode = code || "JOB_PAYLOAD_INVALID";
  err.retryable = false;
  return err;
}

const cashFxRevaluationRunHandler = {
  async run({ job, payload }) {
    const tenantId = parsePositiveInt(job?.tenant_id ?? payload?.tenant_id ?? payload?.tenantId);
    const legalEntityId = parsePositiveInt(
      payload?.legal_entity_id ?? payload?.legalEntityId
    );
    const bookId = parsePositiveInt(payload?.book_id ?? payload?.bookId);
    const fiscalPeriodId = parsePositiveInt(
      payload?.fiscal_period_id ?? payload?.fiscalPeriodId
    );
    const runType = String(payload?.run_type ?? payload?.runType ?? "")
      .trim()
      .toUpperCase();
    const actingUserId =
      parsePositiveInt(payload?.acting_user_id ?? payload?.actingUserId) || null;
    const runIdempotencyKey = String(
      payload?.run_idempotency_key ?? payload?.runIdempotencyKey ?? ""
    )
      .trim()
      .slice(0, 100);

    if (!tenantId) {
      throw badJobPayload(
        "tenant_id is required for CASH_FX_REVALUATION_RUN",
        "JOB_CASH_FX_REVAL_MISSING_TENANT"
      );
    }
    if (!bookId) {
      throw badJobPayload(
        "book_id is required for CASH_FX_REVALUATION_RUN",
        "JOB_CASH_FX_REVAL_MISSING_BOOK"
      );
    }
    if (!fiscalPeriodId) {
      throw badJobPayload(
        "fiscal_period_id is required for CASH_FX_REVALUATION_RUN",
        "JOB_CASH_FX_REVAL_MISSING_PERIOD"
      );
    }
    if (!runType) {
      throw badJobPayload(
        "run_type is required for CASH_FX_REVALUATION_RUN",
        "JOB_CASH_FX_REVAL_MISSING_RUN_TYPE"
      );
    }

    const result = await runCashFxRevaluation({
      req: null,
      payload: {
        tenantId,
        userId: actingUserId || 1,
        legalEntityId,
        bookId,
        fiscalPeriodId,
        runType,
        idempotencyKey: runIdempotencyKey || (job?.id ? `JOB:${job.id}` : null),
        source: "JOB",
        appJobId: parsePositiveInt(job?.id) || null,
      },
      assertScopeAccess: null,
    });

    return {
      ok: true,
      cash_fx_revaluation_run_id: parsePositiveInt(result?.run?.id) || null,
      status: result?.run?.status || null,
      idempotent: Boolean(result?.idempotentReplay),
      line_count: Number(result?.run?.lineCount || 0),
      journal_entry_id: parsePositiveInt(result?.run?.journalEntryId) || null,
    };
  },
};

export default cashFxRevaluationRunHandler;
