import express from "express";
import {
  assertScopeAccess,
  requirePermission,
} from "../middleware/rbac.js";
import { asyncHandler, parsePositiveInt } from "./_utils.js";
import {
  parseCounterpartyRequestApproveInput,
  parseCounterpartyRequestCreateInput,
  parseCounterpartyRequestListInput,
  parseCounterpartyRequestRejectInput,
} from "./cari.counterparty-request.validators.js";
import {
  approveCounterpartyRequestById,
  createCounterpartyRequest,
  listCounterpartyRequestRows,
  rejectCounterpartyRequestById,
  resolveCounterpartyRequestScope,
} from "../services/cari.counterparty-request.service.js";

const router = express.Router();

function resolveRequestOperatingUnitScope(req) {
  const primaryOperatingUnitId = parsePositiveInt(req.body?.primaryOperatingUnitId);
  if (primaryOperatingUnitId) {
    return { scopeType: "OPERATING_UNIT", scopeId: primaryOperatingUnitId };
  }
  const operatingUnitIds = Array.isArray(req.body?.operatingUnitIds)
    ? req.body.operatingUnitIds
    : [];
  for (const item of operatingUnitIds) {
    const operatingUnitId =
      parsePositiveInt(item?.operatingUnitId) ||
      parsePositiveInt(item?.id) ||
      parsePositiveInt(item);
    if (operatingUnitId) {
      return { scopeType: "OPERATING_UNIT", scopeId: operatingUnitId };
    }
  }
  const legalEntityId = parsePositiveInt(req.body?.legalEntityId);
  if (legalEntityId) {
    return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
  }
  return null;
}

router.get(
  "/",
  requirePermission("cari.card.request", {
    resolveScope: async (req) => {
      const legalEntityId = parsePositiveInt(req.query?.legalEntityId);
      if (legalEntityId) {
        return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
      }
      const primaryOperatingUnitId = parsePositiveInt(req.query?.primaryOperatingUnitId);
      if (primaryOperatingUnitId) {
        return { scopeType: "OPERATING_UNIT", scopeId: primaryOperatingUnitId };
      }
      return null;
    },
  }),
  asyncHandler(async (req, res) => {
    const filters = parseCounterpartyRequestListInput(req);
    const result = await listCounterpartyRequestRows({
      req,
      tenantId: filters.tenantId,
      filters,
      assertScopeAccess,
    });
    return res.json({
      tenantId: filters.tenantId,
      ...result,
    });
  })
);

router.post(
  "/",
  requirePermission("cari.card.request", {
    resolveScope: async (req) => resolveRequestOperatingUnitScope(req),
  }),
  asyncHandler(async (req, res) => {
    const payload = parseCounterpartyRequestCreateInput(req);
    const row = await createCounterpartyRequest({
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
  "/:requestId/approve",
  requirePermission("cari.request.review", {
    resolveScope: async (req, tenantId) =>
      resolveCounterpartyRequestScope(req.params?.requestId, tenantId),
  }),
  asyncHandler(async (req, res) => {
    const payload = parseCounterpartyRequestApproveInput(req);
    const result = await approveCounterpartyRequestById({
      req,
      tenantId: payload.tenantId,
      requestId: payload.requestId,
      userId: payload.userId,
      decisionComment: payload.decisionComment,
      assertScopeAccess,
    });
    return res.json({
      tenantId: payload.tenantId,
      ...result,
    });
  })
);

router.post(
  "/:requestId/reject",
  requirePermission("cari.request.review", {
    resolveScope: async (req, tenantId) =>
      resolveCounterpartyRequestScope(req.params?.requestId, tenantId),
  }),
  asyncHandler(async (req, res) => {
    const payload = parseCounterpartyRequestRejectInput(req);
    const result = await rejectCounterpartyRequestById({
      req,
      tenantId: payload.tenantId,
      requestId: payload.requestId,
      userId: payload.userId,
      decisionComment: payload.decisionComment,
      assertScopeAccess,
    });
    return res.json({
      tenantId: payload.tenantId,
      ...result,
    });
  })
);

export default router;
