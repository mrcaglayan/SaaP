import express from "express";
import { assertScopeAccess, buildScopeFilter, requirePermission } from "../middleware/rbac.js";
import { asyncHandler, parsePositiveInt } from "./_utils.js";
import {
  createPayrollOwnershipAssignment,
  deactivatePayrollOwnershipAssignment,
  getPayrollOwnershipAssignmentByIdForTenant,
  listPayrollOwnershipAssignmentRows,
  resolvePayrollOwnershipAssignmentScope,
  updatePayrollOwnershipAssignment,
} from "../services/payroll.ownership.service.js";
import {
  parsePayrollOwnershipAssignmentCreateInput,
  parsePayrollOwnershipAssignmentDeactivateInput,
  parsePayrollOwnershipAssignmentListFilters,
  parsePayrollOwnershipAssignmentReadInput,
  parsePayrollOwnershipAssignmentUpdateInput,
} from "./payroll.ownership.validators.js";

const router = express.Router();

async function resolveOwnershipListScope(req) {
  const legalEntityId = parsePositiveInt(req.query?.legalEntityId ?? req.query?.legal_entity_id);
  if (legalEntityId) {
    return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
  }
  return null;
}

router.get(
  "/ownership/assignments",
  requirePermission("payroll.ownership.read", {
    resolveScope: resolveOwnershipListScope,
  }),
  asyncHandler(async (req, res) => {
    const filters = parsePayrollOwnershipAssignmentListFilters(req);
    const result = await listPayrollOwnershipAssignmentRows({
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
  "/ownership/assignments/:assignmentId",
  requirePermission("payroll.ownership.read", {
    resolveScope: async (req, tenantId) =>
      resolvePayrollOwnershipAssignmentScope(req.params?.assignmentId, tenantId),
  }),
  asyncHandler(async (req, res) => {
    const payload = parsePayrollOwnershipAssignmentReadInput(req);
    const result = await getPayrollOwnershipAssignmentByIdForTenant({
      req,
      tenantId: payload.tenantId,
      assignmentId: payload.assignmentId,
      assertScopeAccess,
    });
    return res.json({
      tenantId: payload.tenantId,
      assignmentId: payload.assignmentId,
      ...result,
    });
  })
);

router.post(
  "/ownership/assignments",
  requirePermission("payroll.ownership.write", {
    resolveScope: async (req) => {
      const legalEntityId = parsePositiveInt(req.body?.legalEntityId ?? req.body?.legal_entity_id);
      if (!legalEntityId) {
        return null;
      }
      return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
    },
  }),
  asyncHandler(async (req, res) => {
    const payload = parsePayrollOwnershipAssignmentCreateInput(req);
    const result = await createPayrollOwnershipAssignment({
      req,
      tenantId: payload.tenantId,
      userId: payload.userId,
      input: payload,
      assertScopeAccess,
    });
    return res.status(201).json({
      tenantId: payload.tenantId,
      legalEntityId: payload.legalEntityId,
      ...result,
    });
  })
);

router.patch(
  "/ownership/assignments/:assignmentId",
  requirePermission("payroll.ownership.write", {
    resolveScope: async (req, tenantId) =>
      resolvePayrollOwnershipAssignmentScope(req.params?.assignmentId, tenantId),
  }),
  asyncHandler(async (req, res) => {
    const payload = parsePayrollOwnershipAssignmentUpdateInput(req);
    const result = await updatePayrollOwnershipAssignment({
      req,
      tenantId: payload.tenantId,
      userId: payload.userId,
      assignmentId: payload.assignmentId,
      input: payload,
      assertScopeAccess,
    });
    return res.json({
      tenantId: payload.tenantId,
      assignmentId: payload.assignmentId,
      ...result,
    });
  })
);

router.post(
  "/ownership/assignments/:assignmentId/deactivate",
  requirePermission("payroll.ownership.write", {
    resolveScope: async (req, tenantId) =>
      resolvePayrollOwnershipAssignmentScope(req.params?.assignmentId, tenantId),
  }),
  asyncHandler(async (req, res) => {
    const payload = parsePayrollOwnershipAssignmentDeactivateInput(req);
    const result = await deactivatePayrollOwnershipAssignment({
      req,
      tenantId: payload.tenantId,
      userId: payload.userId,
      assignmentId: payload.assignmentId,
      assertScopeAccess,
    });
    return res.json({
      tenantId: payload.tenantId,
      assignmentId: payload.assignmentId,
      ...result,
    });
  })
);

export default router;
