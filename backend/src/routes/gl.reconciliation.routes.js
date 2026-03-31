import { assertScopeAccess, requirePermission } from "../middleware/rbac.js";
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
  parseCariControlReconciliationDetailQuery,
  parseCariControlReconciliationQuery,
} from "./gl.reconciliation.validators.js";
import {
  getCariControlReconciliationDetail,
  getCariControlReconciliationReport,
} from "../services/gl.cari-control-reconciliation.service.js";

/**
 * Register the first-pass RP10 reconciliation routes for GL-vs-CARI control
 * balance review and journal/source drillthrough.
 */
export function registerGlReconciliationRoutes(router, deps = {}) {
  const { resolveScopeFromBookId } = deps;

  if (typeof resolveScopeFromBookId !== "function") {
    throw new Error("registerGlReconciliationRoutes requires resolveScopeFromBookId");
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

  async function resolveBookAndQuery(req, queryParser) {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const reportQuery = queryParser(req.query);
    if (!reportQuery.bookId || !reportQuery.fiscalPeriodId) {
      throw badRequest("bookId and fiscalPeriodId query params are required");
    }
    if (reportQuery.legalEntityId) {
      assertScopeAccess(req, "legal_entity", reportQuery.legalEntityId, "legalEntityId");
    }
    if (reportQuery.operatingUnitId) {
      assertScopeAccess(req, "operating_unit", reportQuery.operatingUnitId, "operatingUnitId");
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
    "/cari-control-reconciliation",
    requirePermission("gl.report.ledger.read", {
      resolveScope: resolveReportScope,
    }),
    requirePermission("cari.report.read", {
      resolveScope: resolveReportScope,
    }),
    asyncHandler(async (req, res) => {
      const { tenantId, book, reportQuery } = await resolveBookAndQuery(
        req,
        parseCariControlReconciliationQuery
      );

      return res.json(
        await getCariControlReconciliationReport({
          tenantId,
          book,
          reportQuery,
        })
      );
    })
  );

  router.get(
    "/cari-control-reconciliation/detail",
    requirePermission("gl.report.ledger.read", {
      resolveScope: resolveReportScope,
    }),
    requirePermission("cari.report.read", {
      resolveScope: resolveReportScope,
    }),
    asyncHandler(async (req, res) => {
      const { tenantId, book, reportQuery } = await resolveBookAndQuery(
        req,
        parseCariControlReconciliationDetailQuery
      );

      return res.json(
        await getCariControlReconciliationDetail({
          tenantId,
          book,
          reportQuery,
          rowKey: reportQuery.rowKey,
        })
      );
    })
  );
}
