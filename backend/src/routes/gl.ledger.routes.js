import { assertScopeAccess, requirePermission } from "../middleware/rbac.js";
import {
  assertAccountBelongsToTenant,
  assertBookBelongsToTenant,
  assertOperatingUnitBelongsToTenant,
} from "../tenantGuards.js";
import {
  asyncHandler,
  badRequest,
  parsePositiveInt,
  resolveTenantId,
} from "./_utils.js";
import { parseLedgerReportQuery } from "./gl.ledger.validators.js";
import { getGeneralLedgerReport } from "../services/gl.ledger-report.service.js";

/**
 * Register report-grade local ledger reads used by Defter-i Kebir and later Muavin modes.
 */
export function registerGlLedgerReportRoutes(router, deps = {}) {
  const { resolveScopeFromBookId } = deps;

  if (typeof resolveScopeFromBookId !== "function") {
    throw new Error("registerGlLedgerReportRoutes requires resolveScopeFromBookId");
  }

  router.get(
    "/ledger-report",
    requirePermission("gl.report.ledger.read", {
      resolveScope: async (req, tenantId) => {
        const legalEntityId = parsePositiveInt(req.query?.legalEntityId);
        if (legalEntityId) {
          return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
        }

        const bookId = parsePositiveInt(req.query?.bookId);
        if (bookId) {
          return resolveScopeFromBookId(bookId, tenantId);
        }

        return null;
      },
    }),
    asyncHandler(async (req, res) => {
      const tenantId = resolveTenantId(req);
      if (!tenantId) {
        throw badRequest("tenantId is required");
      }

      const reportQuery = parseLedgerReportQuery(req.query);
      if (!reportQuery.bookId) {
        throw badRequest("bookId query param is required");
      }
      if (reportQuery.legalEntityId) {
        assertScopeAccess(req, "legal_entity", reportQuery.legalEntityId, "legalEntityId");
      }
      if (reportQuery.operatingUnitId) {
        assertScopeAccess(req, "operating_unit", reportQuery.operatingUnitId, "operatingUnitId");
      }

      const book = await assertBookBelongsToTenant(tenantId, reportQuery.bookId, "bookId");
      const account = reportQuery.accountId
        ? await assertAccountBelongsToTenant(tenantId, reportQuery.accountId, "accountId")
        : null;
      const operatingUnit = reportQuery.operatingUnitId
        ? await assertOperatingUnitBelongsToTenant(
            tenantId,
            reportQuery.operatingUnitId,
            "operatingUnitId"
          )
        : null;

      const bookLegalEntityId = parsePositiveInt(book.legal_entity_id);
      const accountLegalEntityId = parsePositiveInt(account?.legal_entity_id);
      if (
        reportQuery.legalEntityId &&
        bookLegalEntityId &&
        reportQuery.legalEntityId !== bookLegalEntityId
      ) {
        throw badRequest("legalEntityId does not match the selected book");
      }
      if (accountLegalEntityId && bookLegalEntityId && accountLegalEntityId !== bookLegalEntityId) {
        throw badRequest("accountId does not belong to the selected book legal entity");
      }
      if (
        operatingUnit &&
        bookLegalEntityId &&
        parsePositiveInt(operatingUnit.legal_entity_id) !== bookLegalEntityId
      ) {
        throw badRequest("operatingUnitId does not belong to the selected book legal entity");
      }

      const payload = await getGeneralLedgerReport({
        tenantId,
        book,
        reportQuery,
      });

      return res.json(payload);
    })
  );
}
