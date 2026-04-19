import { query } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import { evaluateCashFxRevaluationCloseGate } from "./cash.fx.revaluation.service.js";
import { evaluateWorkflowApprovalGate } from "./workflows.service.js";

function toUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function buildPeriodClosePath({
  legalEntityId,
  bookId = null,
  fiscalPeriodId = null,
}) {
  const searchParams = new URLSearchParams();
  if (parsePositiveInt(legalEntityId)) {
    searchParams.set("legalEntityId", String(parsePositiveInt(legalEntityId)));
  }
  if (parsePositiveInt(bookId)) {
    searchParams.set("bookId", String(parsePositiveInt(bookId)));
  }
  if (parsePositiveInt(fiscalPeriodId)) {
    searchParams.set("fiscalPeriodId", String(parsePositiveInt(fiscalPeriodId)));
  }
  const queryString = searchParams.toString();
  return `/app/donem-sonu-islemler/yillik/kapanis-islemleri${
    queryString ? `?${queryString}` : ""
  }`;
}

function mapReviewItem({
  code,
  message,
  level = "BLOCKER",
  drill = null,
}) {
  return {
    level,
    code: String(code || "").trim().toUpperCase(),
    message: String(message || "").trim(),
    ...(drill ? { drill } : {}),
  };
}

function mapWorkflowGateSummary(gate) {
  if (!gate) {
    return null;
  }
  return {
    enabled: Boolean(gate?.enabled),
    required: Boolean(gate?.required),
    approved: Boolean(gate?.approved),
    errorCode: String(gate?.errorCode || "").trim().toUpperCase() || null,
    message: String(gate?.message || "").trim() || null,
    assignment: gate?.assignment || null,
    instance: gate?.instance || null,
  };
}

function mapCashFxGateSummary(gate) {
  if (!gate) {
    return null;
  }
  return {
    required: Boolean(gate?.required),
    satisfied: Boolean(gate?.satisfied),
    reasonCode: String(gate?.reasonCode || "").trim().toUpperCase() || null,
    runType: String(gate?.runType || "").trim().toUpperCase() || null,
    foreignBalanceCount: Number(gate?.foreignBalanceCount || 0),
    periodEndDate: gate?.periodEndDate || null,
    completedRun: gate?.completedRun || null,
    reversalIntegrity: gate?.reversalIntegrity || null,
  };
}

async function loadBookContext({
  tenantId,
  bookId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
       b.id,
       b.code,
       b.name,
       b.calendar_id,
       b.legal_entity_id,
       le.group_company_id
     FROM books b
     JOIN legal_entities le ON le.id = b.legal_entity_id
     WHERE b.tenant_id = ?
       AND b.id = ?
     LIMIT 1`,
    [tenantId, bookId]
  );
  return result.rows?.[0] || null;
}

async function loadFiscalPeriodContext({
  calendarId,
  fiscalPeriodId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
       id,
       fiscal_year,
       period_no,
       period_name,
       start_date,
       end_date
     FROM fiscal_periods
     WHERE id = ?
       AND calendar_id = ?
     LIMIT 1`,
    [fiscalPeriodId, calendarId]
  );
  return result.rows?.[0] || null;
}

async function loadLatestRunForBookPeriod({
  tenantId,
  bookId,
  fiscalPeriodId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
       id,
       status,
       close_status
     FROM period_close_runs
     WHERE tenant_id = ?
       AND book_id = ?
       AND fiscal_period_id = ?
     ORDER BY id DESC
     LIMIT 1`,
    [tenantId, bookId, fiscalPeriodId]
  );
  return result.rows?.[0] || null;
}

async function loadRunContext({
  tenantId,
  runId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
       r.id,
       r.status,
       r.close_status,
       r.book_id,
       r.fiscal_period_id,
       b.code AS book_code,
       b.name AS book_name,
       b.calendar_id,
       b.legal_entity_id,
       le.group_company_id,
       fp.fiscal_year,
       fp.period_no,
       fp.period_name,
       fp.start_date,
       fp.end_date
     FROM period_close_runs r
     JOIN books b ON b.id = r.book_id
     JOIN legal_entities le ON le.id = b.legal_entity_id
     JOIN fiscal_periods fp ON fp.id = r.fiscal_period_id
     WHERE r.tenant_id = ?
       AND r.id = ?
     LIMIT 1`,
    [tenantId, runId]
  );
  return result.rows?.[0] || null;
}

async function loadPeriodCloseReviewContext(
  {
    tenantId,
    runId = null,
    bookId = null,
    fiscalPeriodId = null,
    legalEntityId = null,
  },
  runQuery = query
) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedRunId = parsePositiveInt(runId);
  const normalizedBookId = parsePositiveInt(bookId);
  const normalizedFiscalPeriodId = parsePositiveInt(fiscalPeriodId);
  const normalizedLegalEntityId = parsePositiveInt(legalEntityId);

  if (!normalizedTenantId) {
    throw badRequest("tenantId is required");
  }
  if (!normalizedRunId && (!normalizedBookId || !normalizedFiscalPeriodId)) {
    throw badRequest("runId or both bookId and fiscalPeriodId are required");
  }

  if (normalizedRunId) {
    const run = await loadRunContext({
      tenantId: normalizedTenantId,
      runId: normalizedRunId,
      runQuery,
    });
    if (!run) {
      throw badRequest("Period close run not found");
    }
    if (
      normalizedBookId &&
      normalizedBookId !== parsePositiveInt(run?.book_id)
    ) {
      throw badRequest("bookId must match the period close run");
    }
    if (
      normalizedFiscalPeriodId &&
      normalizedFiscalPeriodId !== parsePositiveInt(run?.fiscal_period_id)
    ) {
      throw badRequest("fiscalPeriodId must match the period close run");
    }
    if (
      normalizedLegalEntityId &&
      normalizedLegalEntityId !== parsePositiveInt(run?.legal_entity_id)
    ) {
      throw badRequest("legalEntityId must match the period close run book");
    }
    return {
      runId: parsePositiveInt(run?.id),
      currentStatus: toUpperText(run?.status),
      closeStatus: toUpperText(run?.close_status),
      bookId: parsePositiveInt(run?.book_id),
      bookCode: run?.book_code || null,
      bookName: run?.book_name || null,
      legalEntityId: parsePositiveInt(run?.legal_entity_id),
      groupCompanyId: parsePositiveInt(run?.group_company_id),
      fiscalPeriodId: parsePositiveInt(run?.fiscal_period_id),
      fiscalYear: run?.fiscal_year === null ? null : Number(run?.fiscal_year),
      periodNo: run?.period_no === null ? null : Number(run?.period_no),
      periodName: run?.period_name || null,
      periodStartDate: run?.start_date || null,
      periodEndDate: run?.end_date || null,
    };
  }

  const book = await loadBookContext({
    tenantId: normalizedTenantId,
    bookId: normalizedBookId,
    runQuery,
  });
  if (!book) {
    throw badRequest("bookId not found for tenant");
  }
  if (
    normalizedLegalEntityId &&
    normalizedLegalEntityId !== parsePositiveInt(book?.legal_entity_id)
  ) {
    throw badRequest("legalEntityId must match the book legal entity");
  }

  const period = await loadFiscalPeriodContext({
    calendarId: parsePositiveInt(book?.calendar_id),
    fiscalPeriodId: normalizedFiscalPeriodId,
    runQuery,
  });
  if (!period) {
    throw badRequest("fiscalPeriodId does not belong to the book calendar");
  }

  const latestRun = await loadLatestRunForBookPeriod({
    tenantId: normalizedTenantId,
    bookId: normalizedBookId,
    fiscalPeriodId: normalizedFiscalPeriodId,
    runQuery,
  });

  return {
    runId: parsePositiveInt(latestRun?.id),
    currentStatus: toUpperText(latestRun?.status),
    closeStatus: toUpperText(latestRun?.close_status),
    bookId: normalizedBookId,
    bookCode: book?.code || null,
    bookName: book?.name || null,
    legalEntityId: parsePositiveInt(book?.legal_entity_id),
    groupCompanyId: parsePositiveInt(book?.group_company_id),
    fiscalPeriodId: normalizedFiscalPeriodId,
    fiscalYear: period?.fiscal_year === null ? null : Number(period?.fiscal_year),
    periodNo: period?.period_no === null ? null : Number(period?.period_no),
    periodName: period?.period_name || null,
    periodStartDate: period?.start_date || null,
    periodEndDate: period?.end_date || null,
  };
}

function buildWorkflowGateBlockedMessage(gate) {
  const errorCode = String(gate?.errorCode || "APPROVAL_REQUIRED").trim().toUpperCase();
  if (errorCode === "WORKFLOW_NOT_ASSIGNED") {
    return "Workflow gate is enabled but no assignment was found";
  }
  if (errorCode === "APPROVAL_INSTANCE_REJECTED") {
    return "Workflow instance is rejected; period close is blocked";
  }
  return "Workflow approval is required before period close can complete";
}

/**
 * Read the live period-close source gates that can block one close-cycle item
 * from completing. Cockpit visibility must work both after a run exists and
 * before one has been linked, because Cash FX gates can block the first close attempt.
 */
export async function getPeriodCloseRunReviewGate({
  tenantId,
  requestedByUserId = null,
  runId = null,
  bookId = null,
  fiscalPeriodId = null,
  legalEntityId = null,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedRequestedByUserId = parsePositiveInt(requestedByUserId);
  if (!normalizedTenantId) {
    throw badRequest("tenantId is required");
  }

  const context = await loadPeriodCloseReviewContext(
    {
      tenantId: normalizedTenantId,
      runId,
      bookId,
      fiscalPeriodId,
      legalEntityId,
    },
    runQuery
  );
  const drillPath = buildPeriodClosePath({
    legalEntityId: context.legalEntityId,
    bookId: context.bookId,
    fiscalPeriodId: context.fiscalPeriodId,
  });

  const cashFxGate = await evaluateCashFxRevaluationCloseGate({
    tenantId: normalizedTenantId,
    bookId: context.bookId,
    fiscalPeriodId: context.fiscalPeriodId,
    runQuery,
  });
  const blockers = [];
  const warnings = [];

  if (cashFxGate?.required && !cashFxGate?.satisfied) {
    blockers.push(
      mapReviewItem({
        code: "CASH_FX_REVALUATION_REQUIRED",
        message:
          "Cash FX revaluation is required before period close. Run cash FX revaluation for this period or use override with dedicated permission.",
        drill: {
          path: drillPath,
        },
      })
    );
  }

  if (cashFxGate?.reversalIntegrity && !cashFxGate.reversalIntegrity.satisfied) {
    blockers.push(
      mapReviewItem({
        code: "CASH_FX_REVALUATION_REVERSAL_REQUIRED",
        message:
          "Cash FX revaluation reversal integrity check failed. Ensure previous-period reversal is posted exactly once in this period before closing.",
        drill: {
          path: drillPath,
        },
      })
    );
  }

  let workflowGate = null;
  if (context.runId && normalizedRequestedByUserId) {
    workflowGate = await evaluateWorkflowApprovalGate({
      tenantId: normalizedTenantId,
      processType: "PERIOD_CLOSE",
      targetType: "PERIOD_CLOSE_RUN",
      targetId: context.runId,
      requestedByUserId: normalizedRequestedByUserId,
      scope: {
        legalEntityId: context.legalEntityId,
        groupCompanyId: context.groupCompanyId,
      },
      effectiveOn: context.periodEndDate || null,
      runQuery,
    });
    if (workflowGate.required && !workflowGate.approved) {
      blockers.push(
        mapReviewItem({
          code: workflowGate.errorCode || "APPROVAL_REQUIRED",
          message: workflowGate.message || buildWorkflowGateBlockedMessage(workflowGate),
          drill: {
            surface: "workflow",
            path: drillPath,
          },
        })
      );
    }
  }

  return {
    run: {
      id: context.runId || null,
      currentStatus: context.currentStatus || null,
      closeStatus: context.closeStatus || null,
      bookId: context.bookId,
      bookCode: context.bookCode,
      bookName: context.bookName,
      legalEntityId: context.legalEntityId,
      fiscalPeriodId: context.fiscalPeriodId,
      fiscalYear: context.fiscalYear,
      periodNo: context.periodNo,
      periodName: context.periodName,
    },
    cashFxGate: mapCashFxGateSummary(cashFxGate),
    workflowGate: mapWorkflowGateSummary(workflowGate),
    blockers,
    warnings,
  };
}

export default {
  getPeriodCloseRunReviewGate,
};
