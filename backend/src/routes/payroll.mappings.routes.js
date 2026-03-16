import express from "express";
import { assertScopeAccess, buildScopeFilter, requirePermission } from "../middleware/rbac.js";
import { asyncHandler, parsePositiveInt } from "./_utils.js";
import {
  parsePayrollMappingListFilters,
  parsePayrollMappingDeactivateInput,
  parsePayrollMappingUpsertInput,
} from "./payroll.mappings.validators.js";
import {
  listPayrollComponentMappingRows,
  setPayrollComponentMappingActive,
  upsertPayrollComponentMapping,
} from "../services/payroll.mappings.service.js";

const router = express.Router();

async function resolvePayrollMappingsListScope(req) {
  const legalEntityId = parsePositiveInt(req.query?.legalEntityId ?? req.query?.legal_entity_id);
  if (legalEntityId) {
    return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
  }
  return null;
}

router.get(
  "/",
  requirePermission("payroll.mappings.read", {
    resolveScope: resolvePayrollMappingsListScope,
  }),
  asyncHandler(async (req, res) => {
    const filters = parsePayrollMappingListFilters(req);
    const result = await listPayrollComponentMappingRows({
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
  "/upsert",
  requirePermission("payroll.mappings.write", {
    resolveScope: async (req) => {
      const legalEntityId = parsePositiveInt(req.body?.legalEntityId ?? req.body?.legal_entity_id);
      if (legalEntityId) {
        return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
      }
      return null;
    },
  }),
  asyncHandler(async (req, res) => {
    const payload = parsePayrollMappingUpsertInput(req);
    const row = await upsertPayrollComponentMapping({
      req,
      payload,
      assertScopeAccess,
    });
    return res.status(201).json({
      tenantId: payload.tenantId,
      row,
    });
  })
);

router.post(
  "/:mappingId/set-active",
  requirePermission("payroll.mappings.write", {
    resolveScope: async (req) => {
      const mappingId = parsePositiveInt(req.params?.mappingId);
      if (mappingId) {
        return null;
      }
      return null;
    },
  }),
  asyncHandler(async (req, res) => {
    const payload = parsePayrollMappingDeactivateInput(req);
    const result = await setPayrollComponentMappingActive({
      req,
      payload,
      assertScopeAccess,
    });
    return res.json({
      tenantId: payload.tenantId,
      ...result,
    });
  })
);

export default router;
