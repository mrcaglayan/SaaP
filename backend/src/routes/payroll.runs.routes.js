import express from "express";
import { assertScopeAccess, buildScopeFilter, requirePermission } from "../middleware/rbac.js";
import { applyFieldVisibility } from "../middleware/fieldVisibility.js";
import { parsePositiveInt } from "./_utils.js";
import { asyncHandler } from "./_utils.js";
import { requireTenantId } from "./cash.validators.common.js";
import {
  getPayrollRunByIdForTenant,
  importPayrollRunCsv,
  listPayrollRunLineRows,
  listPayrollRunRows,
  resolvePayrollRunScope,
} from "../services/payroll.runs.service.js";
import {
  parsePayrollRunIdParam,
  parsePayrollRunImportInput,
  parsePayrollRunLineListFilters,
  parsePayrollRunListFilters,
} from "./payroll.runs.validators.js";

const router = express.Router();
const payrollRunLineFieldVisibility = applyFieldVisibility("PAYROLL", "payroll_run_line");

async function resolvePayrollRunsListScope(req) {
  const legalEntityId = parsePositiveInt(req.query?.legalEntityId ?? req.query?.legal_entity_id);
  if (legalEntityId) {
    return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
  }
  return null;
}

router.post(
  "/import",
  requirePermission("payroll.runs.import", {
    resolveScope: async (req, tenantId) => {
      const targetRunId = parsePositiveInt(req.body?.targetRunId ?? req.body?.target_run_id);
      if (targetRunId) {
        return resolvePayrollRunScope(targetRunId, tenantId);
      }
      const legalEntityId = parsePositiveInt(req.body?.legalEntityId ?? req.body?.legal_entity_id);
      if (legalEntityId) {
        return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
      }
      return null;
    },
  }),
  payrollRunLineFieldVisibility,
  asyncHandler(async (req, res) => {
    const payload = parsePayrollRunImportInput(req);
    const row = await importPayrollRunCsv({
      req,
      payload,
      assertScopeAccess,
    });
    const maskedLines = await req.fieldVisibility.applyToRows(row.lines || []);

    return res.status(201).json({
      tenantId: payload.tenantId,
      row: {
        ...row,
        lines: maskedLines,
      },
    });
  })
);

router.get(
  "/",
  requirePermission("payroll.runs.read", {
    resolveScope: resolvePayrollRunsListScope,
  }),
  asyncHandler(async (req, res) => {
    const filters = parsePayrollRunListFilters(req);
    const result = await listPayrollRunRows({
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

router.get(
  "/:runId",
  requirePermission("payroll.runs.read", {
    resolveScope: async (req, tenantId) => {
      return resolvePayrollRunScope(req.params?.runId, tenantId);
    },
  }),
  payrollRunLineFieldVisibility,
  asyncHandler(async (req, res) => {
    const tenantId = requireTenantId(req);
    const runId = parsePayrollRunIdParam(req);
    const row = await getPayrollRunByIdForTenant({
      req,
      tenantId,
      runId,
      assertScopeAccess,
    });
    const maskedLines = await req.fieldVisibility.applyToRows(row.lines || []);
    return res.json({
      tenantId,
      row: {
        ...row,
        lines: maskedLines,
      },
    });
  })
);

router.get(
  "/:runId/lines",
  requirePermission("payroll.runs.read", {
    resolveScope: async (req, tenantId) => {
      return resolvePayrollRunScope(req.params?.runId, tenantId);
    },
  }),
  payrollRunLineFieldVisibility,
  asyncHandler(async (req, res) => {
    const filters = parsePayrollRunLineListFilters(req);
    const result = await listPayrollRunLineRows({
      req,
      tenantId: filters.tenantId,
      runId: filters.runId,
      filters,
      assertScopeAccess,
    });
    const rows = await req.fieldVisibility.applyToRows(result.rows);
    return res.json({
      tenantId: filters.tenantId,
      runId: filters.runId,
      ...result,
      rows,
    });
  })
);

export default router;
