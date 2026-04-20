import { query, withTransaction } from "../db.js";
import {
  assertScopeAccess,
  buildScopeFilter,
  requireAnyPermission,
  requirePermission,
} from "../middleware/rbac.js";
import {
  assertBookBelongsToTenant,
  assertFiscalPeriodBelongsToCalendar,
  assertLegalEntityBelongsToTenant,
} from "../tenantGuards.js";
import {
  listPeriodCloseRuns,
} from "../services/gl.period-closing.service.js";
import {
  checkUserCanViewPeriodCloseAtScope,
  loadPermissionBundle,
} from "../services/authz.scope.service.js";
import { evaluateWorkflowApprovalGate } from "../services/workflows.service.js";
import { evaluateCashFxRevaluationCloseGate } from "../services/cash.fx.revaluation.service.js";
import {
  autoLinkAndSyncSource,
  syncCycleItemsBySource,
} from "../services/close.cycle-items.service.js";
import { propagateStaleFromSourceEvent } from "../services/close.stale.service.js";
import {
  parsePeriodCloseRunFilters,
  parsePeriodStatusCloseInput,
} from "./gl.period-closing.validators.js";
import { asyncHandler, badRequest, parsePositiveInt, resolveTenantId } from "./_utils.js";
import {
  PERIOD_CLOSE_EXECUTE_PERMISSION_CODE,
  PERIOD_CLOSE_READINESS_PERMISSION_CODE,
  PERIOD_CLOSE_VIEW_PERMISSION_CODES,
} from "../../../shared/periodCloseGovernance.js";

/**
 * Register period-close routes and keep linked close-cycle items synchronized
 * with the repo's existing technical close-run lifecycle.
 */
export function registerGlPeriodClosingRoutes(router, deps = {}) {
  const {
    buildSystemJournalNo,
    buildYearEndCloseLine,
    closeRunStatuses,
    computeCloseRunHash,
    createSystemJournalWithLines,
    findNextFiscalPeriod,
    getEffectivePeriodStatus,
    getFiscalPeriodDetails,
    getPeriodSourceFingerprint,
    getPostedPeriodAccountBalances,
    getRetainedEarningsAccountForBook,
    isNearlyZero,
    mapPeriodCloseRunRow,
    normalizeCloseTargetStatus,
    parseJsonColumn,
    periodStatuses,
    resolveScopeFromBookId,
    reversePostedJournalWithinTransaction,
    writeAuditLog,
  } = deps;

  if (typeof buildSystemJournalNo !== "function") {
    throw new Error("registerGlPeriodClosingRoutes requires buildSystemJournalNo");
  }
  if (typeof buildYearEndCloseLine !== "function") {
    throw new Error("registerGlPeriodClosingRoutes requires buildYearEndCloseLine");
  }
  if (!closeRunStatuses || typeof closeRunStatuses.has !== "function") {
    throw new Error("registerGlPeriodClosingRoutes requires closeRunStatuses set");
  }
  if (typeof computeCloseRunHash !== "function") {
    throw new Error("registerGlPeriodClosingRoutes requires computeCloseRunHash");
  }
  if (typeof createSystemJournalWithLines !== "function") {
    throw new Error("registerGlPeriodClosingRoutes requires createSystemJournalWithLines");
  }
  if (typeof findNextFiscalPeriod !== "function") {
    throw new Error("registerGlPeriodClosingRoutes requires findNextFiscalPeriod");
  }
  if (typeof getEffectivePeriodStatus !== "function") {
    throw new Error("registerGlPeriodClosingRoutes requires getEffectivePeriodStatus");
  }
  if (typeof getFiscalPeriodDetails !== "function") {
    throw new Error("registerGlPeriodClosingRoutes requires getFiscalPeriodDetails");
  }
  if (typeof getPeriodSourceFingerprint !== "function") {
    throw new Error("registerGlPeriodClosingRoutes requires getPeriodSourceFingerprint");
  }
  if (typeof getPostedPeriodAccountBalances !== "function") {
    throw new Error("registerGlPeriodClosingRoutes requires getPostedPeriodAccountBalances");
  }
  if (typeof getRetainedEarningsAccountForBook !== "function") {
    throw new Error("registerGlPeriodClosingRoutes requires getRetainedEarningsAccountForBook");
  }
  if (typeof isNearlyZero !== "function") {
    throw new Error("registerGlPeriodClosingRoutes requires isNearlyZero");
  }
  if (typeof mapPeriodCloseRunRow !== "function") {
    throw new Error("registerGlPeriodClosingRoutes requires mapPeriodCloseRunRow");
  }
  if (typeof normalizeCloseTargetStatus !== "function") {
    throw new Error("registerGlPeriodClosingRoutes requires normalizeCloseTargetStatus");
  }
  if (typeof parseJsonColumn !== "function") {
    throw new Error("registerGlPeriodClosingRoutes requires parseJsonColumn");
  }
  if (!periodStatuses || typeof periodStatuses.has !== "function") {
    throw new Error("registerGlPeriodClosingRoutes requires periodStatuses set");
  }
  if (typeof resolveScopeFromBookId !== "function") {
    throw new Error("registerGlPeriodClosingRoutes requires resolveScopeFromBookId");
  }
  if (typeof reversePostedJournalWithinTransaction !== "function") {
    throw new Error(
      "registerGlPeriodClosingRoutes requires reversePostedJournalWithinTransaction"
    );
  }
  if (typeof writeAuditLog !== "function") {
    throw new Error("registerGlPeriodClosingRoutes requires writeAuditLog");
  }

  function toApprovalGateResponse(req, gate, details = {}) {
    const errorCode = String(gate?.errorCode || "APPROVAL_REQUIRED").trim().toUpperCase();
    const defaultMessage =
      errorCode === "WORKFLOW_NOT_ASSIGNED"
        ? "Workflow gate is enabled but no assignment was found"
        : errorCode === "APPROVAL_INSTANCE_REJECTED"
          ? "Workflow instance is rejected; period close is blocked"
          : "Workflow approval is required before period close can complete";
    return {
      message: String(gate?.message || defaultMessage),
      code: errorCode,
      details,
      requestId: req.requestId || null,
    };
  }

  function toBoolean(value, fallback = false) {
    if (value === undefined || value === null || value === "") {
      return fallback;
    }
    if (typeof value === "boolean") {
      return value;
    }
    const normalized = String(value).trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
    return fallback;
  }

  function forbidden(message) {
    const err = new Error(message);
    err.status = 403;
    return err;
  }

  async function userHasPermissionCode({
    tenantId,
    userId,
    permissionCode,
    runQuery = query,
  }) {
    const bundle = await loadPermissionBundle({
      tenantId,
      userId,
      permissionCode: String(permissionCode || "").trim(),
      runQuery,
    });
    return !bundle?.missingPermission;
  }

  async function assertPeriodCloseReviewAccess(req) {
    const tenantId = resolveTenantId(req);
    if (!tenantId) throw badRequest("tenantId is required");

    const userId = parsePositiveInt(req.user?.userId);
    if (!userId) throw badRequest("Authenticated user is required");

    const requestedScope = await resolveScopeFromBookId(req.params?.bookId, tenantId);
    if (!requestedScope?.scopeType || !requestedScope?.scopeId) {
      return;
    }

    const canViewPeriodClose = await checkUserCanViewPeriodCloseAtScope(
      userId,
      tenantId,
      requestedScope.scopeType,
      requestedScope.scopeId
    );
    if (!canViewPeriodClose) {
      throw forbidden(
        `Missing period-close governance permission. Expected one of: ${PERIOD_CLOSE_VIEW_PERMISSION_CODES.join(", ")}`
      );
    }
  }

  router.get(
    "/period-closing/:bookId/:periodId/pre-close-review",
    asyncHandler(async (req, _res, next) => {
      // Readiness review is valid for either the readiness reviewer or the
      // close authority, as long as the same org scope is covered.
      await assertPeriodCloseReviewAccess(req);
      next();
    }),
    asyncHandler(async (req, res) => {
      const tenantId = resolveTenantId(req);
      if (!tenantId) throw badRequest("tenantId is required");

      const bookId = parsePositiveInt(req.params.bookId);
      const fiscalPeriodId = parsePositiveInt(req.params.periodId);
      if (!bookId || !fiscalPeriodId) {
        throw badRequest("bookId and periodId must be positive integers");
      }

      const draftsResult = await query(
        `SELECT je.id, je.journal_no, je.description, je.total_debit_base, je.created_by_user_id,
                u.name AS created_by_name
           FROM journal_entries je
           LEFT JOIN users u ON u.id = je.created_by_user_id AND u.tenant_id = je.tenant_id
          WHERE je.tenant_id = ?
            AND je.book_id = ?
            AND je.fiscal_period_id = ?
            AND je.status = 'DRAFT'
          ORDER BY je.id DESC
          LIMIT 200`,
        [tenantId, bookId, fiscalPeriodId]
      );

      return res.json({
        unpostedDrafts: draftsResult.rows || [],
        pendingApprovals: [],
        unapprovedSubledger: [],
      });
    })
  );

  router.get(
    "/period-closing/runs",
    requireAnyPermission(PERIOD_CLOSE_VIEW_PERMISSION_CODES, {
      resolveScope: async (req, tenantId) => {
        return resolveScopeFromBookId(req.query?.bookId, tenantId);
      },
    }),
    asyncHandler(async (req, res) => {
      const tenantId = resolveTenantId(req);
      if (!tenantId) {
        throw badRequest("tenantId is required");
      }
      const filters = parsePeriodCloseRunFilters(req.query, closeRunStatuses);
      const payload = await listPeriodCloseRuns({
        req,
        tenantId,
        filters,
        assertBookBelongsToTenant,
        assertScopeAccess,
        buildScopeFilter,
        mapPeriodCloseRunRow,
      });

      return res.json(payload);
    })
  );

  router.post(
    "/period-closing/:bookId/:periodId/close-run",
    requirePermission(PERIOD_CLOSE_EXECUTE_PERMISSION_CODE, {
      resolveScope: async (req, tenantId) => {
        return resolveScopeFromBookId(req.params?.bookId, tenantId);
      },
    }),
    asyncHandler(async (req, res) => {
      const tenantId = resolveTenantId(req);
      if (!tenantId) {
        throw badRequest("tenantId is required");
      }

      const userId = parsePositiveInt(req.user?.userId);
      if (!userId) {
        throw badRequest("Authenticated user is required");
      }

      const bookId = parsePositiveInt(req.params.bookId);
      const fiscalPeriodId = parsePositiveInt(req.params.periodId);
      if (!bookId || !fiscalPeriodId) {
        throw badRequest("bookId and periodId must be positive integers");
      }

      const book = await assertBookBelongsToTenant(tenantId, bookId, "bookId");
      const legalEntityId = parsePositiveInt(book.legal_entity_id);
      if (legalEntityId) {
        assertScopeAccess(req, "legal_entity", legalEntityId, "bookId");
      }
      const legalEntity = legalEntityId
        ? await assertLegalEntityBelongsToTenant(tenantId, legalEntityId, "book legalEntity")
        : null;
      const groupCompanyId = parsePositiveInt(legalEntity?.group_company_id);

      await assertFiscalPeriodBelongsToCalendar(
        parsePositiveInt(book.calendar_id),
        fiscalPeriodId,
        "periodId"
      );
      const currentPeriod = await getFiscalPeriodDetails(fiscalPeriodId);
      if (!currentPeriod) {
        throw badRequest("periodId not found");
      }

      const nextPeriod = await findNextFiscalPeriod(
        parsePositiveInt(book.calendar_id),
        currentPeriod.end_date
      );
      if (!nextPeriod) {
        throw badRequest(
          "No next fiscal period found for carry-forward. Generate next periods first."
        );
      }

      const isYearEnd =
        Number(nextPeriod.fiscal_year || 0) !== Number(currentPeriod.fiscal_year || 0);

      const closeStatus = normalizeCloseTargetStatus(req.body?.closeStatus);
      const note = req.body?.note ? String(req.body.note) : null;
      const closeGateRunType = isYearEnd ? "YEAR_END" : "MONTH_END";
      const cashFxGate = await evaluateCashFxRevaluationCloseGate({
        tenantId,
        bookId,
        fiscalPeriodId,
        runType: closeGateRunType,
        periodEndDate: String(currentPeriod.end_date),
      });
      const cashFxReversalIntegrity = cashFxGate?.reversalIntegrity || null;
      let cashFxOverrideApplied = false;
      let cashFxOverrideReason = null;

      if (cashFxGate.required && !cashFxGate.satisfied) {
        const requestedOverride = toBoolean(req.body?.cashFxRevaluationOverride, false);
        cashFxOverrideReason = req.body?.cashFxRevaluationOverrideReason
          ? String(req.body.cashFxRevaluationOverrideReason).trim()
          : null;

        if (!requestedOverride) {
          return res.status(409).json({
            message:
              "Cash FX revaluation is required before period close. Run cash FX revaluation for this period or use override with dedicated permission.",
            code: "CASH_FX_REVALUATION_REQUIRED",
            details: {
              bookId,
              fiscalPeriodId,
              runType: closeGateRunType,
              periodEndDate: String(currentPeriod.end_date),
              foreignBalanceCount: Number(cashFxGate.foreignBalanceCount || 0),
            },
            requestId: req.requestId || null,
          });
        }

        if (!cashFxOverrideReason) {
          throw badRequest(
            "cashFxRevaluationOverrideReason is required when cashFxRevaluationOverride=true"
          );
        }

        const canOverrideGate = await userHasPermissionCode({
          tenantId,
          userId,
          permissionCode: "cash.fx.revaluation.override",
        });
        if (!canOverrideGate) {
          throw forbidden("Missing permission: cash.fx.revaluation.override");
        }
        cashFxOverrideApplied = true;
      }

      if (cashFxReversalIntegrity && !cashFxReversalIntegrity.satisfied) {
        return res.status(409).json({
          message:
            "Cash FX revaluation reversal integrity check failed. Ensure previous-period reversal is posted exactly once in this period before closing.",
          code: "CASH_FX_REVALUATION_REVERSAL_REQUIRED",
          details: {
            bookId,
            fiscalPeriodId,
            reasonCode: cashFxReversalIntegrity.reasonCode || null,
            previousFiscalPeriodId:
              parsePositiveInt(cashFxReversalIntegrity.previousFiscalPeriodId) || null,
            previousRunType: cashFxReversalIntegrity.previousRunType || null,
            previousRunId:
              parsePositiveInt(cashFxReversalIntegrity.previousRun?.id) || null,
            reversalJournalEntryId:
              parsePositiveInt(cashFxReversalIntegrity.reversalJournalEntryId) || null,
          },
          requestId: req.requestId || null,
        });
      }

      const retainedEarningsAccountIdRaw =
        req.body?.retainedEarningsAccountId === undefined ||
        req.body?.retainedEarningsAccountId === null ||
        req.body?.retainedEarningsAccountId === ""
          ? null
          : parsePositiveInt(req.body?.retainedEarningsAccountId);

      if (
        req.body?.retainedEarningsAccountId !== undefined &&
        req.body?.retainedEarningsAccountId !== null &&
        req.body?.retainedEarningsAccountId !== "" &&
        !retainedEarningsAccountIdRaw
      ) {
        throw badRequest("retainedEarningsAccountId must be a positive integer");
      }

      if (isYearEnd && !retainedEarningsAccountIdRaw) {
        throw badRequest("retainedEarningsAccountId is required for year-end P&L closing");
      }

      let retainedAccount = null;
      if (retainedEarningsAccountIdRaw) {
        retainedAccount = await getRetainedEarningsAccountForBook(
          tenantId,
          legalEntityId,
          retainedEarningsAccountIdRaw
        );
      }

      const sourceFingerprint = await getPeriodSourceFingerprint(
        tenantId,
        bookId,
        fiscalPeriodId
      );

      const runHash = computeCloseRunHash({
        tenantId,
        bookId,
        fiscalPeriodId,
        nextFiscalPeriodId: parsePositiveInt(nextPeriod.id),
        closeStatus,
        isYearEnd,
        retainedEarningsAccountId: retainedAccount?.id || null,
        sourceFingerprint,
      });

      const closeResult = await withTransaction(async (tx) => {
        const existingResult = await tx.query(
          `SELECT *
           FROM period_close_runs
           WHERE tenant_id = ?
             AND book_id = ?
             AND fiscal_period_id = ?
             AND run_hash = ?
           LIMIT 1
           FOR UPDATE`,
          [tenantId, bookId, fiscalPeriodId, runHash]
        );
        const existingRun = existingResult.rows[0] || null;

        const currentStatus = await getEffectivePeriodStatus(
          bookId,
          fiscalPeriodId,
          tx.query
        );

        if (
          existingRun &&
          String(existingRun.status || "").toUpperCase() === "COMPLETED" &&
          !existingRun.reopened_at
        ) {
          const existingCloseStatus = String(existingRun.close_status || "").toUpperCase();
          if (existingCloseStatus && existingCloseStatus !== currentStatus) {
            await tx.query(
              `INSERT INTO period_statuses (
                  book_id, fiscal_period_id, status, closed_by_user_id, closed_at, note
               )
               VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
               ON DUPLICATE KEY UPDATE
                 status = VALUES(status),
                 closed_by_user_id = VALUES(closed_by_user_id),
                 closed_at = VALUES(closed_at),
                 note = VALUES(note)`,
              [
                bookId,
                fiscalPeriodId,
                existingCloseStatus,
                userId,
                `Idempotent close run #${existingRun.id} reapplied`,
              ]
            );
          }

          const rowResult = await tx.query(
            `SELECT
               r.*,
               b.code AS book_code,
               b.name AS book_name,
               fp.fiscal_year,
               fp.period_no,
               fp.period_name
             FROM period_close_runs r
             JOIN books b ON b.id = r.book_id
             JOIN fiscal_periods fp ON fp.id = r.fiscal_period_id
             WHERE r.id = ?
             LIMIT 1`,
            [existingRun.id]
          );

          return {
            idempotent: true,
            previousStatus: currentStatus,
            run: mapPeriodCloseRunRow(rowResult.rows[0] || existingRun),
            carryForwardLineCount: Number(
              parseJsonColumn(existingRun.metadata_json)?.carryForwardLineCount || 0
            ),
            yearEndLineCount: Number(
              parseJsonColumn(existingRun.metadata_json)?.yearEndLineCount || 0
            ),
          };
        }

        if (currentStatus === "HARD_CLOSED") {
          throw badRequest("Period is HARD_CLOSED. Reopen the period before running close again.");
        }

        let runId = parsePositiveInt(existingRun?.id);
        const existingStatus = String(existingRun?.status || "").toUpperCase();
        const loadRunPayloadById = async (targetRunId) => {
          const runResult = await tx.query(
            `SELECT
               r.*,
               b.code AS book_code,
               b.name AS book_name,
               fp.fiscal_year,
               fp.period_no,
               fp.period_name
             FROM period_close_runs r
             JOIN books b ON b.id = r.book_id
             JOIN fiscal_periods fp ON fp.id = r.fiscal_period_id
             WHERE r.id = ?
             LIMIT 1`,
            [targetRunId]
          );
          return mapPeriodCloseRunRow(runResult.rows?.[0] || null);
        };

        if (existingRun && existingStatus === "IN_PROGRESS") {
          const gate = await evaluateWorkflowApprovalGate({
            tenantId,
            processType: "PERIOD_CLOSE",
            targetType: "PERIOD_CLOSE_RUN",
            targetId: runId,
            requestedByUserId: userId,
            scope: {
              legalEntityId,
              groupCompanyId,
            },
            effectiveOn: currentPeriod.end_date,
            runQuery: tx.query,
          });
          if (gate.required && !gate.approved) {
            return {
              approvalRequired: true,
              previousStatus: currentStatus,
              gate,
              run: await loadRunPayloadById(runId),
            };
          }
          // Resume/overwrite the same run hash after approval state is satisfied.
        }

        if (runId) {
          await tx.query(
            `UPDATE period_close_runs
             SET status = 'IN_PROGRESS',
                 close_status = ?,
                 next_fiscal_period_id = ?,
                 year_end_closed = FALSE,
                 retained_earnings_account_id = ?,
                 carry_forward_journal_entry_id = NULL,
                 year_end_journal_entry_id = NULL,
                 source_journal_count = ?,
                 source_debit_total = ?,
                 source_credit_total = ?,
                 started_by_user_id = ?,
                 completed_by_user_id = NULL,
                 reopened_by_user_id = NULL,
                 started_at = CURRENT_TIMESTAMP,
                 completed_at = NULL,
                 reopened_at = NULL,
                 note = ?,
                 metadata_json = NULL
             WHERE id = ?`,
            [
              closeStatus,
              parsePositiveInt(nextPeriod.id),
              retainedAccount?.id || null,
              sourceFingerprint.sourceJournalCount,
              sourceFingerprint.sourceDebitTotal,
              sourceFingerprint.sourceCreditTotal,
              userId,
              note,
              runId,
            ]
          );

          await tx.query(
            `DELETE FROM period_close_run_lines
             WHERE period_close_run_id = ?`,
            [runId]
          );
        } else {
          const insertResult = await tx.query(
            `INSERT INTO period_close_runs (
                tenant_id,
                book_id,
                fiscal_period_id,
                next_fiscal_period_id,
                run_hash,
                close_status,
                status,
                year_end_closed,
                retained_earnings_account_id,
                source_journal_count,
                source_debit_total,
                source_credit_total,
                started_by_user_id,
                note
             )
             VALUES (?, ?, ?, ?, ?, ?, 'IN_PROGRESS', FALSE, ?, ?, ?, ?, ?, ?)`,
            [
              tenantId,
              bookId,
              fiscalPeriodId,
              parsePositiveInt(nextPeriod.id),
              runHash,
              closeStatus,
              retainedAccount?.id || null,
              sourceFingerprint.sourceJournalCount,
              sourceFingerprint.sourceDebitTotal,
              sourceFingerprint.sourceCreditTotal,
              userId,
              note,
            ]
          );
          runId = parsePositiveInt(insertResult.rows.insertId);
        }

        if (!runId) {
          throw badRequest("Failed to initialize period close run");
        }

        const gate = await evaluateWorkflowApprovalGate({
          tenantId,
          processType: "PERIOD_CLOSE",
          targetType: "PERIOD_CLOSE_RUN",
          targetId: runId,
          requestedByUserId: userId,
          scope: {
            legalEntityId,
            groupCompanyId,
          },
          effectiveOn: currentPeriod.end_date,
          runQuery: tx.query,
        });
        if (gate.required && !gate.approved) {
          return {
            approvalRequired: true,
            previousStatus: currentStatus,
            gate,
            run: await loadRunPayloadById(runId),
          };
        }

        const balances = await getPostedPeriodAccountBalances(
          tenantId,
          bookId,
          fiscalPeriodId,
          tx.query
        );

        const carryForwardBalanceByAccountId = new Map();
        const accountCodeById = new Map();
        for (const row of balances) {
          const accountId = parsePositiveInt(row.account_id);
          if (!accountId) {
            continue;
          }

          accountCodeById.set(accountId, String(row.account_code || `ACC-${accountId}`));

          const accountType = String(row.account_type || "").toUpperCase();
          const isPnlAccount = ["REVENUE", "EXPENSE"].includes(accountType);
          if (!isYearEnd || !isPnlAccount) {
            carryForwardBalanceByAccountId.set(accountId, Number(row.closing_balance || 0));
          }
        }

        const pnlCloseLines = balances
          .filter((row) => ["REVENUE", "EXPENSE"].includes(String(row.account_type || "").toUpperCase()))
          .map((row) => buildYearEndCloseLine(row))
          .filter(Boolean);

        const yearEndLines = [];
        if (isYearEnd) {
          if (!retainedAccount?.id) {
            throw badRequest("retainedEarningsAccountId is required for year-end P&L closing");
          }

          yearEndLines.push(...pnlCloseLines);

          const pnlDebitTotal = pnlCloseLines.reduce(
            (sum, line) => sum + Number(line.debitBase || 0),
            0
          );
          const pnlCreditTotal = pnlCloseLines.reduce(
            (sum, line) => sum + Number(line.creditBase || 0),
            0
          );
          const retainedDifference = pnlDebitTotal - pnlCreditTotal;
          if (!isNearlyZero(retainedDifference)) {
            let retainedLine = null;
            if (retainedDifference > 0) {
              retainedLine = {
                accountId: retainedAccount.id,
                closingBalance: retainedDifference * -1,
                debitBase: 0,
                creditBase: retainedDifference,
                description: "Year-end transfer to retained earnings",
              };
            } else {
              retainedLine = {
                accountId: retainedAccount.id,
                closingBalance: Math.abs(retainedDifference),
                debitBase: Math.abs(retainedDifference),
                creditBase: 0,
                description: "Year-end transfer to retained earnings",
              };
            }

            if (retainedLine) {
              yearEndLines.push(retainedLine);
              accountCodeById.set(
                retainedAccount.id,
                String(retainedAccount.code || `ACC-${retainedAccount.id}`)
              );
              const currentRetainedBalance = Number(
                carryForwardBalanceByAccountId.get(retainedAccount.id) || 0
              );
              carryForwardBalanceByAccountId.set(
                retainedAccount.id,
                currentRetainedBalance +
                  (Number(retainedLine.debitBase || 0) - Number(retainedLine.creditBase || 0))
              );
            }
          }
        }

        const carryForwardLines = [];
        for (const [accountId, closingBalanceRaw] of carryForwardBalanceByAccountId.entries()) {
          const closingBalance = Number(closingBalanceRaw || 0);
          if (isNearlyZero(closingBalance)) {
            continue;
          }

          const accountCode = accountCodeById.get(accountId) || `ACC-${accountId}`;
          if (closingBalance > 0) {
            carryForwardLines.push({
              accountId,
              closingBalance,
              debitBase: closingBalance,
              creditBase: 0,
              description: `Opening from previous period (${accountCode})`,
            });
          } else {
            carryForwardLines.push({
              accountId,
              closingBalance,
              debitBase: 0,
              creditBase: Math.abs(closingBalance),
              description: `Opening from previous period (${accountCode})`,
            });
          }
        }

        let carryForwardJournalEntryId = null;
        if (carryForwardLines.length > 0) {
          const nextPeriodStatus = await getEffectivePeriodStatus(
            bookId,
            parsePositiveInt(nextPeriod.id),
            tx.query
          );
          if (nextPeriodStatus === "HARD_CLOSED") {
            throw badRequest(
              "Next period is HARD_CLOSED; cannot post opening carry-forward entry"
            );
          }

          const carryJournal = await createSystemJournalWithLines(tx, {
            tenantId,
            legalEntityId,
            bookId,
            fiscalPeriodId: parsePositiveInt(nextPeriod.id),
            journalNo: buildSystemJournalNo("CARRY", runId),
            entryDate: String(nextPeriod.start_date),
            documentDate: String(nextPeriod.start_date),
            currencyCode: String(book.base_currency_code || "USD").toUpperCase(),
            description: `Auto carry-forward opening balances from FY${currentPeriod.fiscal_year} P${currentPeriod.period_no}`,
            referenceNo: `PERIOD_CLOSE_RUN:${runId}`,
            userId,
            lines: carryForwardLines,
          });
          carryForwardJournalEntryId = parsePositiveInt(carryJournal?.journalEntryId);
        }

        let yearEndJournalEntryId = null;
        if (isYearEnd && yearEndLines.length > 0) {
          const yearEndJournal = await createSystemJournalWithLines(tx, {
            tenantId,
            legalEntityId,
            bookId,
            fiscalPeriodId,
            journalNo: buildSystemJournalNo("YECLOSE", runId),
            entryDate: String(currentPeriod.end_date),
            documentDate: String(currentPeriod.end_date),
            currencyCode: String(book.base_currency_code || "USD").toUpperCase(),
            description: `Auto year-end P&L close FY${currentPeriod.fiscal_year} P${currentPeriod.period_no}`,
            referenceNo: `PERIOD_CLOSE_RUN:${runId}`,
            userId,
            lines: yearEndLines,
          });
          yearEndJournalEntryId = parsePositiveInt(yearEndJournal?.journalEntryId);
        }

        for (const line of carryForwardLines) {
          // eslint-disable-next-line no-await-in-loop
          await tx.query(
            `INSERT INTO period_close_run_lines (
                period_close_run_id,
                tenant_id,
                line_type,
                account_id,
                closing_balance,
                debit_base,
                credit_base
             )
             VALUES (?, ?, 'CARRY_FORWARD', ?, ?, ?, ?)`,
            [
              runId,
              tenantId,
              parsePositiveInt(line.accountId),
              Number(line.closingBalance || 0),
              Number(line.debitBase || 0),
              Number(line.creditBase || 0),
            ]
          );
        }

        for (const line of yearEndLines) {
          // eslint-disable-next-line no-await-in-loop
          await tx.query(
            `INSERT INTO period_close_run_lines (
                period_close_run_id,
                tenant_id,
                line_type,
                account_id,
                closing_balance,
                debit_base,
                credit_base
             )
             VALUES (?, ?, 'YEAR_END', ?, ?, ?, ?)`,
            [
              runId,
              tenantId,
              parsePositiveInt(line.accountId),
              Number(line.closingBalance || 0),
              Number(line.debitBase || 0),
              Number(line.creditBase || 0),
            ]
          );
        }

        await tx.query(
          `INSERT INTO period_statuses (
              book_id, fiscal_period_id, status, closed_by_user_id, closed_at, note
           )
           VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
           ON DUPLICATE KEY UPDATE
             status = VALUES(status),
             closed_by_user_id = VALUES(closed_by_user_id),
             closed_at = VALUES(closed_at),
             note = VALUES(note)`,
          [
            bookId,
            fiscalPeriodId,
            closeStatus,
            userId,
            `Period close run #${runId}${note ? `: ${note}` : ""}`,
          ]
        );

        const metadata = {
          nextFiscalPeriodId: parsePositiveInt(nextPeriod.id),
          isYearEnd,
          carryForwardLineCount: carryForwardLines.length,
          yearEndLineCount: yearEndLines.length,
          sourceFingerprint,
          cashFxGate: {
            runType: closeGateRunType,
            required: Boolean(cashFxGate.required),
            satisfied: Boolean(cashFxGate.satisfied),
            reasonCode: cashFxGate.reasonCode || null,
            foreignBalanceCount: Number(cashFxGate.foreignBalanceCount || 0),
            overrideApplied: Boolean(cashFxOverrideApplied),
            overrideReason: cashFxOverrideReason || null,
            reversalIntegrity: cashFxReversalIntegrity
              ? {
                  required: Boolean(cashFxReversalIntegrity.required),
                  satisfied: Boolean(cashFxReversalIntegrity.satisfied),
                  reasonCode: cashFxReversalIntegrity.reasonCode || null,
                  previousFiscalPeriodId:
                    parsePositiveInt(cashFxReversalIntegrity.previousFiscalPeriodId) || null,
                  previousRunType: cashFxReversalIntegrity.previousRunType || null,
                  previousRunId:
                    parsePositiveInt(cashFxReversalIntegrity.previousRun?.id) || null,
                  reversalJournalEntryId:
                    parsePositiveInt(cashFxReversalIntegrity.reversalJournalEntryId) || null,
                }
              : null,
          },
        };

        await tx.query(
          `UPDATE period_close_runs
           SET status = 'COMPLETED',
               year_end_closed = ?,
               retained_earnings_account_id = ?,
               carry_forward_journal_entry_id = ?,
               year_end_journal_entry_id = ?,
               completed_by_user_id = ?,
               completed_at = CURRENT_TIMESTAMP,
               metadata_json = ?
           WHERE id = ?`,
          [
            isYearEnd,
            retainedAccount?.id || null,
            carryForwardJournalEntryId,
            yearEndJournalEntryId,
            userId,
            JSON.stringify(metadata),
            runId,
          ]
        );

        await writeAuditLog(tx.query, req, {
          tenantId,
          userId,
          action: "gl.period_close.execute",
          resourceType: "period_close_run",
          resourceId: String(runId),
          scopeType: "LEGAL_ENTITY",
          scopeId: legalEntityId,
          payload: {
            bookId,
            fiscalPeriodId,
            closeStatus,
            runHash,
            isYearEnd,
            retainedEarningsAccountId: retainedAccount?.id || null,
            carryForwardJournalEntryId,
            yearEndJournalEntryId,
            carryForwardLineCount: carryForwardLines.length,
            yearEndLineCount: yearEndLines.length,
            sourceFingerprint,
            cashFxGate: {
              runType: closeGateRunType,
              required: Boolean(cashFxGate.required),
              satisfied: Boolean(cashFxGate.satisfied),
              reasonCode: cashFxGate.reasonCode || null,
              foreignBalanceCount: Number(cashFxGate.foreignBalanceCount || 0),
              overrideApplied: Boolean(cashFxOverrideApplied),
              overrideReason: cashFxOverrideReason || null,
              reversalIntegrity: cashFxReversalIntegrity
                ? {
                    required: Boolean(cashFxReversalIntegrity.required),
                    satisfied: Boolean(cashFxReversalIntegrity.satisfied),
                    reasonCode: cashFxReversalIntegrity.reasonCode || null,
                    previousFiscalPeriodId:
                      parsePositiveInt(cashFxReversalIntegrity.previousFiscalPeriodId) || null,
                    previousRunType: cashFxReversalIntegrity.previousRunType || null,
                    previousRunId:
                      parsePositiveInt(cashFxReversalIntegrity.previousRun?.id) || null,
                    reversalJournalEntryId:
                      parsePositiveInt(cashFxReversalIntegrity.reversalJournalEntryId) || null,
                  }
                : null,
            },
          },
        });

        const runResult = await tx.query(
          `SELECT
             r.*,
             b.code AS book_code,
             b.name AS book_name,
             fp.fiscal_year,
             fp.period_no,
             fp.period_name
           FROM period_close_runs r
           JOIN books b ON b.id = r.book_id
           JOIN fiscal_periods fp ON fp.id = r.fiscal_period_id
           WHERE r.id = ?
           LIMIT 1`,
          [runId]
        );

        return {
          idempotent: false,
          previousStatus: currentStatus,
          run: mapPeriodCloseRunRow(runResult.rows[0]),
          carryForwardLineCount: carryForwardLines.length,
          yearEndLineCount: yearEndLines.length,
        };
      });

      if (closeResult?.approvalRequired) {
        return res
          .status(409)
          .json(
            toApprovalGateResponse(req, closeResult.gate, {
              processType: "PERIOD_CLOSE",
              targetType: "PERIOD_CLOSE_RUN",
              targetId: parsePositiveInt(closeResult?.run?.id),
              bookId,
              fiscalPeriodId,
              closeStatus,
              currentStepNo: Number(closeResult?.gate?.currentStepNo || 0),
              stageScopeType: closeResult?.gate?.stageScopeType || null,
              requiredPermissionCode: closeResult?.gate?.requiredPermissionCode || null,
              run: closeResult.run || null,
              assignment: closeResult.gate?.assignment || null,
              instance: closeResult.gate?.instance || null,
            })
          );
      }

      if (closeResult.run?.id) {
        await autoLinkAndSyncSource("PERIOD_CLOSE_RUN", closeResult.run.id, {
          tenantId,
          userId,
        });
      }

      return res.status(closeResult.idempotent ? 200 : 201).json({
        ok: true,
        tenantId,
        idempotent: closeResult.idempotent,
        previousStatus: closeResult.previousStatus,
        run: closeResult.run,
        carryForwardLineCount: closeResult.carryForwardLineCount,
        yearEndLineCount: closeResult.yearEndLineCount,
      });
    })
  );

  router.post(
    "/period-closing/:bookId/:periodId/reopen",
    requirePermission("gl.period.reopen", {
      resolveScope: async (req, tenantId) => {
        return resolveScopeFromBookId(req.params?.bookId, tenantId);
      },
    }),
    asyncHandler(async (req, res) => {
      const tenantId = resolveTenantId(req);
      if (!tenantId) {
        throw badRequest("tenantId is required");
      }

      const userId = parsePositiveInt(req.user?.userId);
      if (!userId) {
        throw badRequest("Authenticated user is required");
      }

      const bookId = parsePositiveInt(req.params.bookId);
      const fiscalPeriodId = parsePositiveInt(req.params.periodId);
      if (!bookId || !fiscalPeriodId) {
        throw badRequest("bookId and periodId must be positive integers");
      }

      const reason = req.body?.reason ? String(req.body.reason).trim() : null;
      if (!reason) {
        throw badRequest("reason is required to reopen a closed period");
      }

      const book = await assertBookBelongsToTenant(tenantId, bookId, "bookId");
      const legalEntityId = parsePositiveInt(book.legal_entity_id);
      if (legalEntityId) {
        assertScopeAccess(req, "legal_entity", legalEntityId, "bookId");
      }

      await assertFiscalPeriodBelongsToCalendar(
        parsePositiveInt(book.calendar_id),
        fiscalPeriodId,
        "periodId"
      );

      const reopenResult = await withTransaction(async (tx) => {
        const currentStatus = await getEffectivePeriodStatus(
          bookId,
          fiscalPeriodId,
          tx.query
        );
        if (currentStatus === "HARD_CLOSED") {
          throw badRequest("Period is HARD_CLOSED and cannot be reopened.");
        }

        const runResult = await tx.query(
          `SELECT *
           FROM period_close_runs
           WHERE tenant_id = ?
             AND book_id = ?
             AND fiscal_period_id = ?
             AND status = 'COMPLETED'
           ORDER BY id DESC
           LIMIT 1
           FOR UPDATE`,
          [tenantId, bookId, fiscalPeriodId]
        );
        const run = runResult.rows[0] || null;

        const reversalJournalEntryIds = [];
        if (run) {
          const carryReversalId = await reversePostedJournalWithinTransaction(tx, {
            tenantId,
            journalId: parsePositiveInt(run.carry_forward_journal_entry_id),
            userId,
            reason: `Reopen period close run #${run.id}: ${reason}`,
          });
          if (carryReversalId) {
            reversalJournalEntryIds.push(carryReversalId);
          }

          const yearEndReversalId = await reversePostedJournalWithinTransaction(tx, {
            tenantId,
            journalId: parsePositiveInt(run.year_end_journal_entry_id),
            userId,
            reason: `Reopen period close run #${run.id}: ${reason}`,
          });
          if (yearEndReversalId) {
            reversalJournalEntryIds.push(yearEndReversalId);
          }

          const mergedMetadata = {
            ...(parseJsonColumn(run.metadata_json) || {}),
            reopen: {
              reopenedByUserId: userId,
              reopenedAt: new Date().toISOString(),
              reason,
              reversalJournalEntryIds,
            },
          };

          await tx.query(
            `UPDATE period_close_runs
             SET status = 'REOPENED',
                 reopened_by_user_id = ?,
                 reopened_at = CURRENT_TIMESTAMP,
                 note = ?,
                 metadata_json = ?
             WHERE id = ?`,
            [userId, reason, JSON.stringify(mergedMetadata), run.id]
          );
        }

        await tx.query(
          `INSERT INTO period_statuses (
              book_id, fiscal_period_id, status, closed_by_user_id, closed_at, note
           )
           VALUES (?, ?, 'OPEN', ?, CURRENT_TIMESTAMP, ?)
           ON DUPLICATE KEY UPDATE
             status = 'OPEN',
             closed_by_user_id = VALUES(closed_by_user_id),
             closed_at = VALUES(closed_at),
             note = VALUES(note)`,
          [bookId, fiscalPeriodId, userId, `Reopened: ${reason}`]
        );

        await writeAuditLog(tx.query, req, {
          tenantId,
          userId,
          action: "gl.period_close.reopen",
          resourceType: "period_close_run",
          resourceId: run ? String(run.id) : null,
          scopeType: "LEGAL_ENTITY",
          scopeId: legalEntityId,
          payload: {
            bookId,
            fiscalPeriodId,
            previousStatus: currentStatus,
            reason,
            reversalJournalEntryIds,
            runId: run ? parsePositiveInt(run.id) : null,
          },
        });

        let runPayload = null;
        if (run) {
          const latestRunResult = await tx.query(
            `SELECT
               r.*,
               b.code AS book_code,
               b.name AS book_name,
               fp.fiscal_year,
               fp.period_no,
               fp.period_name
             FROM period_close_runs r
             JOIN books b ON b.id = r.book_id
             JOIN fiscal_periods fp ON fp.id = r.fiscal_period_id
             WHERE r.id = ?
             LIMIT 1`,
            [run.id]
          );
          runPayload = mapPeriodCloseRunRow(latestRunResult.rows[0] || run);
        }

        return {
          previousStatus: currentStatus,
          status: "OPEN",
          run: runPayload,
          reversalJournalEntryIds,
        };
      });

      if (reopenResult.run?.id) {
        await syncCycleItemsBySource("PERIOD_CLOSE_RUN", reopenResult.run.id, {
          tenantId,
          userId,
        });
        await propagateStaleFromSourceEvent(
          {
            sourceTargetType: "PERIOD_CLOSE_RUN",
            sourceTargetId: reopenResult.run.id,
            eventCode: "PERIOD_CLOSE_REOPENED",
            payload: {
              reason,
              previousStatus: reopenResult.previousStatus,
            },
          },
          {
            tenantId,
            userId,
          }
        );
      }

      return res.status(201).json({
        ok: true,
        tenantId,
        bookId,
        fiscalPeriodId,
        previousStatus: reopenResult.previousStatus,
        status: reopenResult.status,
        run: reopenResult.run,
        reversalJournalEntryIds: reopenResult.reversalJournalEntryIds,
      });
    })
  );

  router.get(
    "/period-statuses/:bookId/:periodId",
    requirePermission("gl.journal.read", {
      resolveScope: async (req, tenantId) => {
        return resolveScopeFromBookId(req.params?.bookId, tenantId);
      },
    }),
    asyncHandler(async (req, res) => {
      const tenantId = resolveTenantId(req);
      if (!tenantId) throw badRequest("tenantId is required");
      const bookId = parsePositiveInt(req.params.bookId);
      const fiscalPeriodId = parsePositiveInt(req.params.periodId);
      if (!bookId || !fiscalPeriodId) {
        throw badRequest("bookId and periodId must be positive integers");
      }
      const result = await query(
        `SELECT status FROM period_statuses WHERE book_id = ? AND fiscal_period_id = ? LIMIT 1`,
        [bookId, fiscalPeriodId]
      );
      const status = String(result.rows[0]?.status || "OPEN").toUpperCase();
      return res.json({ bookId, fiscalPeriodId, status });
    })
  );

  router.post(
    "/period-statuses/:bookId/:periodId/close",
    requirePermission(PERIOD_CLOSE_EXECUTE_PERMISSION_CODE, {
      resolveScope: async (req, tenantId) => {
        return resolveScopeFromBookId(req.params?.bookId, tenantId);
      },
    }),
    asyncHandler(async (req, res) => {
      // Legacy direct period-status mutation is retired. Period close must run
      // through the governed close-run path so workflow approval cannot be bypassed.
      const { bookId, fiscalPeriodId } = parsePeriodStatusCloseInput(req, periodStatuses);
      return res.status(410).json({
        message:
          "Legacy direct-close route is retired. Use /api/v1/gl/period-closing/{bookId}/{periodId}/close-run.",
        code: "LEGACY_DIRECT_CLOSE_ROUTE_RETIRED",
        details: {
          bookId,
          fiscalPeriodId,
          expectedReadinessPermissionCode: PERIOD_CLOSE_READINESS_PERMISSION_CODE,
          expectedExecutionPermissionCode: PERIOD_CLOSE_EXECUTE_PERMISSION_CODE,
        },
        requestId: req.requestId || null,
      });
    })
  );
}
