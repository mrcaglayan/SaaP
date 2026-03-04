import express from "express";
import { query } from "../db.js";
import { assertScopeAccess, buildScopeFilter, requirePermission } from "../middleware/rbac.js";
import { asyncHandler, parsePositiveInt } from "./_utils.js";
import { resolveCashRegisterScope } from "../services/cash.register.service.js";
import {
  getCashExchangeHistoryReport,
  getCashFxRevaluationRunsReport,
  getForeignCashBalancesReport,
} from "../services/cash.report.service.js";
import {
  getCashFxOpsDashboard,
  overrideCashFxOpsException,
  rerunCashFxOpsExceptionJob,
} from "../services/cash.fx.ops.service.js";
import { resolveExceptionWorkbenchScope } from "../services/exceptions.workbench.service.js";
import {
  parseCashExchangeHistoryReportFilters,
  parseCashFxOpsDashboardFilters,
  parseCashFxOpsExceptionActionInput,
  parseCashFxRevaluationRunReportFilters,
  parseCashReportScopeInput,
  parseForeignCashBalanceReportFilters,
} from "./cash.report.validators.js";

const router = express.Router();

async function resolveBookScope(bookId, tenantId) {
  const result = await query(
    `SELECT legal_entity_id
     FROM books
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, bookId]
  );
  const legalEntityId = parsePositiveInt(result.rows?.[0]?.legal_entity_id);
  if (!legalEntityId) {
    return null;
  }
  return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
}

async function resolveCashReportScope(req, tenantId) {
  const scopeInput = parseCashReportScopeInput(req);

  if (scopeInput.legalEntityId) {
    return { scopeType: "LEGAL_ENTITY", scopeId: scopeInput.legalEntityId };
  }

  if (scopeInput.registerId) {
    return resolveCashRegisterScope(scopeInput.registerId, tenantId);
  }

  if (scopeInput.sourceRegisterId) {
    return resolveCashRegisterScope(scopeInput.sourceRegisterId, tenantId);
  }

  if (scopeInput.targetRegisterId) {
    return resolveCashRegisterScope(scopeInput.targetRegisterId, tenantId);
  }

  if (scopeInput.bookId) {
    return resolveBookScope(scopeInput.bookId, tenantId);
  }

  return null;
}

router.get(
  "/exchange-history",
  requirePermission("cash.report.read", {
    resolveScope: async (req, tenantId) => {
      return resolveCashReportScope(req, tenantId);
    },
  }),
  asyncHandler(async (req, res) => {
    const filters = parseCashExchangeHistoryReportFilters(req);
    const result = await getCashExchangeHistoryReport({
      req,
      filters,
      buildScopeFilter,
      assertScopeAccess,
    });
    return res.json({
      tenantId: filters.tenantId,
      ...result,
    });
  })
);

router.get(
  "/foreign-balances",
  requirePermission("cash.report.read", {
    resolveScope: async (req, tenantId) => {
      return resolveCashReportScope(req, tenantId);
    },
  }),
  asyncHandler(async (req, res) => {
    const filters = parseForeignCashBalanceReportFilters(req);
    const result = await getForeignCashBalancesReport({
      req,
      filters,
      buildScopeFilter,
      assertScopeAccess,
    });
    return res.json({
      tenantId: filters.tenantId,
      ...result,
    });
  })
);

router.get(
  "/revaluation-runs",
  requirePermission("cash.report.read", {
    resolveScope: async (req, tenantId) => {
      return resolveCashReportScope(req, tenantId);
    },
  }),
  asyncHandler(async (req, res) => {
    const filters = parseCashFxRevaluationRunReportFilters(req);
    const result = await getCashFxRevaluationRunsReport({
      req,
      filters,
      buildScopeFilter,
      assertScopeAccess,
    });
    return res.json({
      tenantId: filters.tenantId,
      ...result,
    });
  })
);

router.get(
  "/fx-ops-dashboard",
  requirePermission("cash.report.read", {
    resolveScope: async (req, tenantId) => {
      return resolveCashReportScope(req, tenantId);
    },
  }),
  asyncHandler(async (req, res) => {
    const filters = parseCashFxOpsDashboardFilters(req);
    const result = await getCashFxOpsDashboard({
      req,
      tenantId: filters.tenantId,
      filters,
      buildScopeFilter,
      assertScopeAccess,
    });
    return res.json({
      tenantId: filters.tenantId,
      ...result,
    });
  })
);

router.post(
  "/fx-ops-exceptions/:exceptionId/rerun-job",
  requirePermission("ops.jobs.manage", {
    resolveScope: (req, tenantId) =>
      resolveExceptionWorkbenchScope(req.params?.exceptionId, tenantId),
  }),
  asyncHandler(async (req, res) => {
    const input = parseCashFxOpsExceptionActionInput(req);
    const result = await rerunCashFxOpsExceptionJob({
      req,
      tenantId: input.tenantId,
      exceptionId: input.exceptionId,
      actorUserId: input.userId,
      delaySeconds: input.delaySeconds || 0,
      maxAttempts:
        Number.isInteger(Number(input.maxAttempts)) && Number(input.maxAttempts) > 0
          ? Number(input.maxAttempts)
          : null,
      resolutionNote: input.resolutionNote || input.reason || null,
      assertScopeAccess,
    });
    return res.json({
      tenantId: input.tenantId,
      ...result,
    });
  })
);

router.post(
  "/fx-ops-exceptions/:exceptionId/override",
  requirePermission("ops.exceptions.manage", {
    resolveScope: (req, tenantId) =>
      resolveExceptionWorkbenchScope(req.params?.exceptionId, tenantId),
  }),
  asyncHandler(async (req, res) => {
    const input = parseCashFxOpsExceptionActionInput(req, { requireReason: true });
    const result = await overrideCashFxOpsException({
      req,
      tenantId: input.tenantId,
      exceptionId: input.exceptionId,
      actorUserId: input.userId,
      reason: input.reason,
      assertScopeAccess,
    });
    return res.json({
      tenantId: input.tenantId,
      ...result,
    });
  })
);

export default router;
