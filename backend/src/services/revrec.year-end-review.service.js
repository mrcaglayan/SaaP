import { query } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import { getRevenueFutureYearRollforwardReport } from "./revenue-recognition.service.js";

const BALANCE_MATCH_TOLERANCE = 0.01;

const REVREC_CONTINUITY_CONTROLS = Object.freeze([
  {
    key: "DEFREV",
    familyCode: "DEFREV",
    title: "Deferred revenue carry-forward",
  },
  {
    key: "PREPAID_EXPENSE",
    familyCode: "PREPAID_EXPENSE",
    title: "Prepaid expense carry-forward",
  },
  {
    key: "ACCRUED_REVENUE",
    familyCode: "ACCRUED_REVENUE",
    title: "Accrued revenue carry-forward",
  },
  {
    key: "ACCRUED_EXPENSE",
    familyCode: "ACCRUED_EXPENSE",
    title: "Accrued expense carry-forward",
  },
]);

function toUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function roundAmount(value) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Number(parsed.toFixed(6));
}

function absAmount(value) {
  return roundAmount(Math.abs(Number(value || 0)));
}

function estimateReclassToShortTerm(summary = {}) {
  const shortTerm = Number(
    summary?.shortTermAmountBase ?? summary?.closingShortTermAmountBase ?? 0
  );
  const longTerm = Number(
    summary?.longTermAmountBase ?? summary?.closingLongTermAmountBase ?? 0
  );
  const movement = Number(summary?.movementAmountBase || 0);

  if (
    !Number.isFinite(shortTerm) ||
    !Number.isFinite(longTerm) ||
    !Number.isFinite(movement)
  ) {
    return 0;
  }
  return Number(Math.max(0, shortTerm - longTerm - movement).toFixed(6));
}

function findRollforwardFamilyRow(report, familyCode) {
  const targetFamily = toUpperText(familyCode);
  return (
    (Array.isArray(report?.rows) ? report.rows : []).find(
      (row) => toUpperText(row?.accountFamily) === targetFamily
    ) || null
  );
}

function buildReasonCodeList(issues, warnings) {
  return [
    ...new Set(
      [...(Array.isArray(issues) ? issues : []), ...(Array.isArray(warnings) ? warnings : [])]
        .map((value) => toUpperText(value))
        .filter(Boolean)
    ),
  ];
}

function buildYearEndRevrecPath({ legalEntityId, bookId, fiscalPeriodId }) {
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
  searchParams.set("tab", "balances");
  return `/app/donem-sonu-islemler/yillik/kapanis-islemleri?${searchParams.toString()}`;
}

async function loadBookPeriodContext({
  tenantId,
  bookId,
  fiscalPeriodId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
       b.id AS book_id,
       b.code AS book_code,
       b.name AS book_name,
       b.calendar_id,
       fp.id AS fiscal_period_id,
       fp.fiscal_year,
       fp.period_no,
       fp.period_name,
       fp.start_date,
       fp.end_date
     FROM books b
     JOIN fiscal_periods fp ON fp.id = ?
     WHERE b.tenant_id = ?
       AND b.id = ?
     LIMIT 1`,
    [fiscalPeriodId, tenantId, bookId]
  );
  return result.rows?.[0] || null;
}

async function loadNextFiscalPeriod({
  calendarId,
  fiscalYear,
  periodNo,
  runQuery = query,
}) {
  if (!parsePositiveInt(calendarId) || !Number.isInteger(Number(fiscalYear))) {
    return null;
  }
  const result = await runQuery(
    `SELECT
       id,
       fiscal_year,
       period_no,
       period_name,
       start_date,
       end_date
     FROM fiscal_periods
     WHERE calendar_id = ?
       AND (
         fiscal_year > ?
         OR (fiscal_year = ? AND period_no > ?)
       )
     ORDER BY fiscal_year ASC, period_no ASC
     LIMIT 1`,
    [calendarId, fiscalYear, fiscalYear, periodNo]
  );
  return result.rows?.[0] || null;
}

async function loadRollforwardReport({ tenantId, legalEntityId, fiscalPeriodId }) {
  return getRevenueFutureYearRollforwardReport({
    req: null,
    filters: {
      tenantId,
      legalEntityId,
      fiscalPeriodId,
      limit: 200,
      offset: 0,
    },
    assertScopeAccess: () => {},
    buildScopeFilter: () => "1 = 1",
  });
}

/**
 * Reuse the live REVREC rollforward reports to evaluate closing-period vs
 * next-period opening continuity for one entity/book/period scope.
 *
 * The result intentionally stays report-backed: every blocker row can route the
 * operator to the existing year-end REVREC page instead of introducing hidden
 * balance logic in the close workflow.
 */
export async function getRevrecYearEndContinuityReview({
  tenantId,
  legalEntityId,
  bookId,
  fiscalPeriodId,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedLegalEntityId = parsePositiveInt(legalEntityId);
  const normalizedBookId = parsePositiveInt(bookId);
  const normalizedFiscalPeriodId = parsePositiveInt(fiscalPeriodId);
  if (!normalizedTenantId) {
    throw badRequest("tenantId is required");
  }
  if (!normalizedLegalEntityId) {
    throw badRequest("legalEntityId is required");
  }
  if (!normalizedBookId) {
    throw badRequest("bookId is required");
  }
  if (!normalizedFiscalPeriodId) {
    throw badRequest("fiscalPeriodId is required");
  }

  const context = await loadBookPeriodContext({
    tenantId: normalizedTenantId,
    bookId: normalizedBookId,
    fiscalPeriodId: normalizedFiscalPeriodId,
    runQuery,
  });
  if (!context) {
    throw badRequest("bookId / fiscalPeriodId context could not be resolved");
  }

  const nextPeriod = await loadNextFiscalPeriod({
    calendarId: parsePositiveInt(context.calendar_id),
    fiscalYear: Number(context.fiscal_year || 0),
    periodNo: Number(context.period_no || 0),
    runQuery,
  });
  if (!nextPeriod) {
    return {
      tenantId: normalizedTenantId,
      legalEntityId: normalizedLegalEntityId,
      bookId: normalizedBookId,
      fiscalPeriodId: normalizedFiscalPeriodId,
      nextFiscalPeriodId: null,
      applicable: false,
      blockingRows: [],
      rows: [],
      drillPath: buildYearEndRevrecPath({
        legalEntityId: normalizedLegalEntityId,
        bookId: normalizedBookId,
        fiscalPeriodId: normalizedFiscalPeriodId,
      }),
    };
  }

  const [currentRollforward, nextRollforward] = await Promise.all([
    loadRollforwardReport({
      tenantId: normalizedTenantId,
      legalEntityId: normalizedLegalEntityId,
      fiscalPeriodId: normalizedFiscalPeriodId,
    }),
    loadRollforwardReport({
      tenantId: normalizedTenantId,
      legalEntityId: normalizedLegalEntityId,
      fiscalPeriodId: parsePositiveInt(nextPeriod.id),
    }),
  ]);

  const drillPath = buildYearEndRevrecPath({
    legalEntityId: normalizedLegalEntityId,
    bookId: normalizedBookId,
    fiscalPeriodId: normalizedFiscalPeriodId,
  });
  const rows = REVREC_CONTINUITY_CONTROLS.map((control) => {
    const currentRow = findRollforwardFamilyRow(currentRollforward, control.familyCode);
    const nextRow = findRollforwardFamilyRow(nextRollforward, control.familyCode);
    const issues = [];
    const warnings = [];
    const currentClosingAmountBase = roundAmount(currentRow?.closingAmountBase);
    const nextOpeningAmountBase = roundAmount(nextRow?.openingAmountBase);
    const carryForwardDifferenceBase = roundAmount(
      currentClosingAmountBase - nextOpeningAmountBase
    );

    if (!currentRow) {
      issues.push("CURRENT_PERIOD_ROLLFORWARD_MISSING");
    }
    if (!nextRow) {
      issues.push("NEXT_PERIOD_OPENING_MISSING");
    }
    if (Math.abs(carryForwardDifferenceBase) > BALANCE_MATCH_TOLERANCE) {
      issues.push("NEXT_PERIOD_OPENING_MISMATCH");
    }

    const currentReclassEstimateBase = roundAmount(
      estimateReclassToShortTerm(currentRow || {})
    );
    const nextOpeningAbsBase = absAmount(nextOpeningAmountBase);
    if (
      currentReclassEstimateBase > BALANCE_MATCH_TOLERANCE &&
      nextOpeningAbsBase <= BALANCE_MATCH_TOLERANCE
    ) {
      warnings.push("RECLASS_ESTIMATE_ZEROED_IN_NEXT_OPENING");
    }

    let status = "PASS";
    let detail =
      "Current-period closing amount carries into the next-period opening amount.";
    if (issues.length > 0) {
      status = "FAIL";
      detail = issues.includes("NEXT_PERIOD_OPENING_MISMATCH")
        ? "Current-period closing amount does not match the next-period opening amount."
        : "Rollforward data is missing for the current or next period.";
    } else if (warnings.length > 0) {
      status = "WARN";
      detail =
        "Carry-forward matches, but the expected reclass bridge estimate collapses to zero in the next opening and should be reviewed.";
    }

    return {
      key: control.key,
      familyCode: control.familyCode,
      title: control.title,
      status,
      detail,
      reasonCodes: buildReasonCodeList(issues, warnings),
      currentClosingAmountBase,
      nextOpeningAmountBase,
      carryForwardDifferenceBase,
      currentReclassEstimateBase,
      drill: {
        path: drillPath,
        label: "Open year-end REVREC",
      },
    };
  });

  return {
    tenantId: normalizedTenantId,
    legalEntityId: normalizedLegalEntityId,
    bookId: normalizedBookId,
    fiscalPeriodId: normalizedFiscalPeriodId,
    nextFiscalPeriodId: parsePositiveInt(nextPeriod.id),
    applicable: true,
    drillPath,
    rows,
    blockingRows: rows.filter((row) => row.status !== "PASS"),
  };
}

export default {
  getRevrecYearEndContinuityReview,
};
