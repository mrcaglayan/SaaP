import { requirePermission, assertScopeAccess } from "../middleware/rbac.js";
import {
  assertBookBelongsToTenant,
  assertFiscalPeriodBelongsToCalendar,
} from "../tenantGuards.js";
import {
  asyncHandler,
  badRequest,
  parsePositiveInt,
  resolveTenantId,
} from "./_utils.js";
import {
  parseLocalStatementAccountSummaryQuery,
  parseLocalStatementReportQuery,
} from "./gl.statement.validators.js";
import {
  getLocalBalanceSheetReport,
  getLocalIncomeStatementReport,
  getLocalStatementAccountSummary,
} from "../services/gl.statement-report.service.js";

/**
 * Register the dedicated local statement routes for RP05 balance sheet,
 * income statement, and statement-row drillthrough.
 */
export function registerGlStatementReportRoutes(router, deps = {}) {
  const { resolveScopeFromBookId } = deps;

  if (typeof resolveScopeFromBookId !== "function") {
    throw new Error("registerGlStatementReportRoutes requires resolveScopeFromBookId");
  }

  async function resolveReportScope(req, tenantId) {
    const legalEntityId = parsePositiveInt(req.query?.legalEntityId);
    if (legalEntityId) {
      return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
    }

    const bookId = parsePositiveInt(req.query?.bookId);
    if (bookId) {
      return resolveScopeFromBookId(bookId, tenantId);
    }

    return null;
  }

  async function resolveBookAndQuery(req, endpointLabel) {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const reportQuery = parseLocalStatementReportQuery(req.query, endpointLabel);
    if (!reportQuery.bookId || !reportQuery.fiscalPeriodId) {
      throw badRequest("bookId and fiscalPeriodId query params are required");
    }
    if (reportQuery.legalEntityId) {
      assertScopeAccess(req, "legal_entity", reportQuery.legalEntityId, "legalEntityId");
    }

    const book = await assertBookBelongsToTenant(tenantId, reportQuery.bookId, "bookId");
    const bookLegalEntityId = parsePositiveInt(book.legal_entity_id);
    if (
      reportQuery.legalEntityId &&
      bookLegalEntityId &&
      reportQuery.legalEntityId !== bookLegalEntityId
    ) {
      throw badRequest("legalEntityId does not match the selected book");
    }

    await assertFiscalPeriodBelongsToCalendar(
      parsePositiveInt(book.calendar_id),
      reportQuery.fiscalPeriodId,
      "fiscalPeriodId"
    );

    return { tenantId, book, reportQuery };
  }

  router.get(
    "/balance-sheet-report",
    requirePermission("gl.report.statement.read", {
      resolveScope: resolveReportScope,
    }),
    asyncHandler(async (req, res) => {
      const { tenantId, book, reportQuery } = await resolveBookAndQuery(
        req,
        "/balance-sheet-report"
      );

      return res.json(
        await getLocalBalanceSheetReport({
          tenantId,
          book,
          fiscalPeriodId: reportQuery.fiscalPeriodId,
          includeZero: reportQuery.includeZero,
        })
      );
    })
  );

  router.get(
    "/income-statement-report",
    requirePermission("gl.report.statement.read", {
      resolveScope: resolveReportScope,
    }),
    asyncHandler(async (req, res) => {
      const { tenantId, book, reportQuery } = await resolveBookAndQuery(
        req,
        "/income-statement-report"
      );

      return res.json(
        await getLocalIncomeStatementReport({
          tenantId,
          book,
          fiscalPeriodId: reportQuery.fiscalPeriodId,
          includeZero: reportQuery.includeZero,
        })
      );
    })
  );

  router.get(
    "/statement-account-summary",
    requirePermission("gl.report.statement.read", {
      resolveScope: resolveReportScope,
    }),
    asyncHandler(async (req, res) => {
      const tenantId = resolveTenantId(req);
      if (!tenantId) {
        throw badRequest("tenantId is required");
      }

      const reportQuery = parseLocalStatementAccountSummaryQuery(req.query);
      if (!reportQuery.bookId || !reportQuery.fiscalPeriodId) {
        throw badRequest("bookId and fiscalPeriodId query params are required");
      }
      if (reportQuery.legalEntityId) {
        assertScopeAccess(req, "legal_entity", reportQuery.legalEntityId, "legalEntityId");
      }

      const book = await assertBookBelongsToTenant(tenantId, reportQuery.bookId, "bookId");
      const bookLegalEntityId = parsePositiveInt(book.legal_entity_id);
      if (
        reportQuery.legalEntityId &&
        bookLegalEntityId &&
        reportQuery.legalEntityId !== bookLegalEntityId
      ) {
        throw badRequest("legalEntityId does not match the selected book");
      }

      await assertFiscalPeriodBelongsToCalendar(
        parsePositiveInt(book.calendar_id),
        reportQuery.fiscalPeriodId,
        "fiscalPeriodId"
      );

      return res.json(
        await getLocalStatementAccountSummary({
          tenantId,
          book,
          statementType: reportQuery.statementType,
          statementRowKey: reportQuery.statementRowKey,
          fiscalPeriodId: reportQuery.fiscalPeriodId,
        })
      );
    })
  );
}
