import { query } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import {
  CONSOLIDATION_REPORT_BALANCE_EPSILON,
  loadConsolidationRunReportAccountBalances,
  summarizeConsolidationRunReportMath,
} from "./consolidation.report-math.service.js";
import { getEntityCloseReadiness } from "./entity.close-readiness.service.js";
import { evaluateWorkflowApprovalGate } from "./workflows.service.js";

function toUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

async function loadConsolidationRunContext({
  tenantId,
  runId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
       cr.id,
       cr.status,
       cr.consolidation_group_id,
       cr.fiscal_period_id,
       cr.presentation_currency_code,
       fp.end_date AS period_end_date,
       cg.group_company_id,
       cg.code AS consolidation_group_code,
       cg.name AS consolidation_group_name
     FROM consolidation_runs cr
     JOIN consolidation_groups cg ON cg.id = cr.consolidation_group_id
     JOIN fiscal_periods fp ON fp.id = cr.fiscal_period_id
     WHERE cr.id = ?
       AND cg.tenant_id = ?
     LIMIT 1`,
    [runId, tenantId]
  );
  return result.rows?.[0] || null;
}

function mapWorkflowGateSummary(gate) {
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

function mapReviewItem({
  code,
  message,
  level = "BLOCKER",
  count = null,
  drill = null,
}) {
  return {
    level,
    code: String(code || "").trim().toUpperCase(),
    message: String(message || "").trim(),
    ...(count !== null ? { count: Number(count || 0) } : {}),
    ...(drill ? { drill } : {}),
  };
}

function formatMetricAmount(value, currencyCode) {
  const numeric = Number(value || 0);
  return `${numeric.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${String(currencyCode || "").trim().toUpperCase() || ""}`.trim();
}

function buildLocalCloseWorkspacePath({
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
  return `/app/donem-sonu-islemler/yillik/yerel-kapanis-paketleri${
    queryString ? `?${queryString}` : ""
  }`;
}

function buildLocalClosePackPath(packId) {
  return `/app/donem-sonu-islemler/yillik/yerel-kapanis-paketleri/${packId}`;
}

function formatLocalCloseScopeLabel(scopeRow) {
  if (toUpperText(scopeRow?.closeScopeType) === "CENTRAL") {
    return "CENTRAL";
  }
  const code = String(scopeRow?.operatingUnitCode || "").trim();
  const name = String(scopeRow?.operatingUnitName || "").trim();
  return code && name ? `${code} - ${name}` : code || name || "OPERATING_UNIT";
}

async function listActiveRunMembers({
  tenantId,
  run,
  runQuery = query,
}) {
  const consolidationGroupId = parsePositiveInt(run?.consolidation_group_id);
  const periodStartDate = run?.period_start_date || null;
  const periodEndDate = run?.period_end_date || null;
  if (!consolidationGroupId || !periodStartDate || !periodEndDate) {
    return [];
  }

  const result = await runQuery(
    `SELECT
       cgm.legal_entity_id,
       le.code AS legal_entity_code,
       le.name AS legal_entity_name,
       cgm.consolidation_method,
       cgm.ownership_pct,
       cgm.effective_from,
       cgm.id
     FROM consolidation_group_members cgm
     JOIN legal_entities le ON le.id = cgm.legal_entity_id
     WHERE cgm.consolidation_group_id = ?
       AND cgm.effective_from <= ?
       AND (cgm.effective_to IS NULL OR cgm.effective_to >= ?)
     ORDER BY le.code ASC, cgm.effective_from DESC, cgm.id DESC`,
    [consolidationGroupId, periodEndDate, periodStartDate]
  );

  const deduped = [];
  const seenEntityIds = new Set();
  for (const row of result.rows || []) {
    const legalEntityId = parsePositiveInt(row?.legal_entity_id);
    if (!legalEntityId || seenEntityIds.has(legalEntityId)) {
      continue;
    }
    seenEntityIds.add(legalEntityId);
    deduped.push({
      legalEntityId,
      legalEntityCode: row?.legal_entity_code || null,
      legalEntityName: row?.legal_entity_name || null,
      consolidationMethod: toUpperText(row?.consolidation_method) || null,
      ownershipPct: Number(row?.ownership_pct || 0),
    });
  }
  return deduped;
}

async function listLocalCloseCandidateBooksForEntity({
  tenantId,
  legalEntityId,
  fiscalPeriodId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT DISTINCT
       lcp.book_id,
       b.code AS book_code,
       b.name AS book_name
     FROM local_close_packs lcp
     JOIN books b ON b.id = lcp.book_id
     WHERE lcp.tenant_id = ?
       AND lcp.legal_entity_id = ?
       AND lcp.fiscal_period_id = ?
     ORDER BY lcp.book_id ASC`,
    [tenantId, legalEntityId, fiscalPeriodId]
  );
  return (result.rows || []).map((row) => ({
    bookId: parsePositiveInt(row?.book_id),
    bookCode: row?.book_code || null,
    bookName: row?.book_name || null,
  }));
}

async function buildMemberReadinessReviewItems({
  tenantId,
  run,
  runQuery = query,
}) {
  const fiscalPeriodId = parsePositiveInt(run?.fiscal_period_id);
  if (!fiscalPeriodId) {
    return [];
  }

  const memberRows = await listActiveRunMembers({
    tenantId,
    run,
    runQuery,
  });
  const blockerGroups = await Promise.all(
    memberRows.map(async (memberRow) => {
      const books = await listLocalCloseCandidateBooksForEntity({
        tenantId,
        legalEntityId: memberRow.legalEntityId,
        fiscalPeriodId,
        runQuery,
      });
      const entityLabel = memberRow.legalEntityCode
        ? `${memberRow.legalEntityCode} - ${memberRow.legalEntityName || ""}`.trim()
        : memberRow.legalEntityName || `#${memberRow.legalEntityId}`;

      if (books.length === 0) {
        return [
          mapReviewItem({
            code: "ENTITY_CLOSE_BOOK_UNRESOLVED",
            message: `Member ${entityLabel} has no local close packs yet; mandatory scopes must be LOCKED before consolidation finalize`,
            drill: {
              path: buildLocalCloseWorkspacePath({
                legalEntityId: memberRow.legalEntityId,
                fiscalPeriodId,
              }),
              label: "Open local close workspace",
            },
          }),
        ];
      }

      if (books.length > 1) {
        return [
          mapReviewItem({
            code: "ENTITY_CLOSE_BOOK_AMBIGUOUS",
            message: `Member ${entityLabel} has multiple local close books for this period; select and lock one consistent close chain before finalize`,
            drill: {
              path: buildLocalCloseWorkspacePath({
                legalEntityId: memberRow.legalEntityId,
                fiscalPeriodId,
              }),
              label: "Open local close workspace",
            },
          }),
        ];
      }

      const selectedBook = books[0];
      const readiness = await getEntityCloseReadiness({
        tenantId,
        legalEntityId: memberRow.legalEntityId,
        bookId: selectedBook.bookId,
        fiscalPeriodId,
        runQuery,
      });
      const unresolvedScopes = (Array.isArray(readiness?.mandatoryScopes)
        ? readiness.mandatoryScopes
        : []
      ).filter((scopeRow) => toUpperText(scopeRow?.status) !== "LOCKED");

      // RP12 follow-up upgrades consolidation finalize from approved-or-locked
      // readiness to lock-only readiness so every mandatory CENTRAL / OU scope
      // has completed the exact local close chain before group publish.
      return unresolvedScopes.map((scopeRow) => {
        const scopeLabel = formatLocalCloseScopeLabel(scopeRow);
        const currentStatus = toUpperText(scopeRow?.status) || "NOT_OPENED";
        const localClosePackId = parsePositiveInt(scopeRow?.localClosePackId);
        return mapReviewItem({
          code:
            currentStatus === "NOT_OPENED"
              ? "ENTITY_CLOSE_SCOPE_NOT_OPENED"
              : "ENTITY_CLOSE_SCOPE_NOT_LOCKED",
          message:
            currentStatus === "NOT_OPENED"
              ? `Member ${entityLabel} is missing the mandatory ${scopeLabel} local close pack`
              : `Member ${entityLabel} scope ${scopeLabel} is ${currentStatus}; mandatory local close packs must be LOCKED before finalize`,
          drill: {
            path: localClosePackId
              ? buildLocalClosePackPath(localClosePackId)
              : buildLocalCloseWorkspacePath({
                  legalEntityId: memberRow.legalEntityId,
                  bookId: selectedBook.bookId,
                  fiscalPeriodId,
                }),
            label: localClosePackId
              ? "Open local close pack"
              : "Open local close workspace",
          },
        });
      });
    })
  );

  return blockerGroups.flat();
}

/**
 * Build the live RP12 consolidation finalize gate from existing run,
 * worklist, workflow, and shared report-math truth. This keeps publish
 * blocking explainable without inventing a second hidden control engine.
 */
export async function getConsolidationRunReviewGate({
  tenantId,
  runId,
  requestedByUserId,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedRunId = parsePositiveInt(runId);
  const normalizedRequestedByUserId = parsePositiveInt(requestedByUserId);
  if (!normalizedTenantId) {
    throw badRequest("tenantId is required");
  }
  if (!normalizedRunId) {
    throw badRequest("runId is required");
  }
  if (!normalizedRequestedByUserId) {
    throw badRequest("requestedByUserId is required");
  }

  const run = await loadConsolidationRunContext({
    tenantId: normalizedTenantId,
    runId: normalizedRunId,
    runQuery,
  });
  if (!run) {
    throw badRequest("Consolidation run not found");
  }

  const [entryResult, draftAdjustmentResult, draftEliminationResult] =
    await Promise.all([
      runQuery(
        `SELECT COUNT(*) AS total
         FROM consolidation_run_entries
         WHERE consolidation_run_id = ?`,
        [normalizedRunId]
      ),
      runQuery(
        `SELECT COUNT(*) AS total
         FROM consolidation_adjustments
         WHERE consolidation_run_id = ?
           AND status = 'DRAFT'`,
        [normalizedRunId]
      ),
      runQuery(
        `SELECT COUNT(*) AS total
         FROM elimination_entries
         WHERE consolidation_run_id = ?
           AND status = 'DRAFT'`,
        [normalizedRunId]
      ),
    ]);

  const entryCount = Number(entryResult.rows?.[0]?.total || 0);
  const draftAdjustmentCount = Number(
    draftAdjustmentResult.rows?.[0]?.total || 0
  );
  const draftEliminationCount = Number(
    draftEliminationResult.rows?.[0]?.total || 0
  );
  const workflowGate = await evaluateWorkflowApprovalGate({
    tenantId: normalizedTenantId,
    processType: "CONSOLIDATION_RUN",
    targetType: "CONSOLIDATION_RUN",
    targetId: normalizedRunId,
    requestedByUserId: normalizedRequestedByUserId,
    scope: {
      groupCompanyId: parsePositiveInt(run?.group_company_id),
    },
    effectiveOn: run?.period_end_date || null,
    runQuery,
  });

  const blockers = [];
  const warnings = [];
  const currentStatus = toUpperText(run?.status);
  let mathSummary = null;

  if (currentStatus !== "LOCKED" && entryCount <= 0) {
    blockers.push(
      mapReviewItem({
        code: "CONSOLIDATION_RUN_NOT_EXECUTED",
        message:
          "Consolidation run has no posted consolidation entries yet; execute the run before finalization",
        drill: {
          surface: "summary",
        },
      })
    );
  }

  if (draftAdjustmentCount > 0) {
    blockers.push(
      mapReviewItem({
        code: "DRAFT_CONSOLIDATION_ADJUSTMENTS_PRESENT",
        message: `Draft consolidation adjustments remain (${draftAdjustmentCount})`,
        count: draftAdjustmentCount,
        drill: {
          surface: "worklist",
          itemType: "adjustment",
        },
      })
    );
  }

  if (draftEliminationCount > 0) {
    blockers.push(
      mapReviewItem({
        code: "DRAFT_CONSOLIDATION_ELIMINATIONS_PRESENT",
        message: `Draft consolidation eliminations remain (${draftEliminationCount})`,
        count: draftEliminationCount,
        drill: {
          surface: "worklist",
          itemType: "elimination",
        },
      })
    );
  }

  if (workflowGate.required && !workflowGate.approved) {
    blockers.push(
      mapReviewItem({
        code: workflowGate.errorCode || "APPROVAL_REQUIRED",
        message:
          workflowGate.message ||
          "Workflow approval is required before consolidation finalize",
        drill: {
          surface: "workflow",
        },
      })
    );
  }

  if (currentStatus !== "LOCKED") {
    blockers.push(
      ...(await buildMemberReadinessReviewItems({
        tenantId: normalizedTenantId,
        run,
        runQuery,
      }))
    );
  }

  if (entryCount > 0) {
    try {
      // RP12 follow-up keeps publish math on the same shared report engine used
      // by the live balance sheet / trial balance routes, so the finalize gate
      // never relies on a second hidden formula path.
      const reportData = await loadConsolidationRunReportAccountBalances({
        tenantId: normalizedTenantId,
        run,
        includeDraft: false,
        preferredRateType: "CLOSING",
        runQuery,
      });
      mathSummary = summarizeConsolidationRunReportMath({
        rows: reportData.rows,
        balanceEpsilon: CONSOLIDATION_REPORT_BALANCE_EPSILON,
      });

      if (mathSummary.hasTrialBalanceImbalance) {
        blockers.push(
          mapReviewItem({
            code: "CONSOLIDATION_TRIAL_BALANCE_OUT_OF_BALANCE",
            message: `Consolidated trial balance delta is ${formatMetricAmount(
              mathSummary.trialBalanceDelta,
              run?.presentation_currency_code
            )}`,
            drill: {
              surface: "trialBalance",
            },
          })
        );
      }

      if (mathSummary.hasBalanceSheetEquationGap) {
        blockers.push(
          mapReviewItem({
            code: "CONSOLIDATION_BALANCE_SHEET_OUT_OF_BALANCE",
            message: `Balance sheet equation delta is ${formatMetricAmount(
              mathSummary.equationDelta,
              run?.presentation_currency_code
            )}`,
            drill: {
              surface: "balanceSheet",
            },
          })
        );
      }
    } catch (err) {
      blockers.push(
        mapReviewItem({
          code: "CONSOLIDATION_PUBLISH_MATH_UNAVAILABLE",
          message:
            err?.message ||
            "Consolidation publish math could not be evaluated from the live report engine",
          drill: {
            surface: "balanceSheet",
          },
        })
      );
    }
  }

  if (currentStatus === "LOCKED") {
    warnings.push(
      mapReviewItem({
        code: "CONSOLIDATION_RUN_ALREADY_LOCKED",
        message: "Consolidation run is already locked",
        level: "WARNING",
      })
    );
  }

  const canFinalize = currentStatus !== "LOCKED" && blockers.length === 0;
  const publishState =
    currentStatus === "LOCKED"
      ? "LOCKED"
      : canFinalize
        ? "READY_TO_PUBLISH"
        : "BLOCKED";

  return {
    run: {
      id: parsePositiveInt(run.id),
      currentStatus,
      nextStatus: currentStatus === "LOCKED" ? "LOCKED" : "LOCKED",
      consolidationGroupId: parsePositiveInt(run.consolidation_group_id),
      consolidationGroupCode: run.consolidation_group_code || null,
      consolidationGroupName: run.consolidation_group_name || null,
      fiscalPeriodId: parsePositiveInt(run.fiscal_period_id),
      presentationCurrencyCode:
        String(run.presentation_currency_code || "").toUpperCase() || null,
    },
    publishState,
    canFinalize,
    counts: {
      entryCount,
      draftAdjustmentCount,
      draftEliminationCount,
      memberReadinessBlockCount: blockers.filter((row) =>
        [
          "ENTITY_CLOSE_BOOK_UNRESOLVED",
          "ENTITY_CLOSE_BOOK_AMBIGUOUS",
          "ENTITY_CLOSE_SCOPE_NOT_OPENED",
          "ENTITY_CLOSE_SCOPE_NOT_LOCKED",
        ].includes(String(row?.code || "").trim().toUpperCase())
      ).length,
    },
    mathSummary,
    workflowGate: mapWorkflowGateSummary(workflowGate),
    blockers,
    warnings,
  };
}

export default {
  getConsolidationRunReviewGate,
};
