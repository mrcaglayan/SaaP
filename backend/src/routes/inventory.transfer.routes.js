import express from "express";
import { asyncHandler, parsePositiveInt, resolveTenantId } from "./_utils.js";
import { assertScopeAccess, requirePermission } from "../middleware/rbac.js";
import {
  parseInventoryTransferApproveInput,
  parseInventoryTransferCancelInput,
  parseInventoryTransferCreateInput,
  parseInventoryTransferIdParam,
  parseInventoryTransferListFilters,
  parseInventoryTransferReceiveInput,
  parseInventoryTransferReverseInput,
  parseInventoryTransferShipInput,
} from "./inventory.transfer.validators.js";
import {
  approveInventoryTransferById,
  cancelInventoryTransferById,
  createInventoryTransfer,
  getInventoryTransferById,
  listInventoryTransfers,
  receiveInventoryTransferById,
  resolveInventoryTransferScope,
  reverseInventoryTransferById,
  shipInventoryTransferById,
} from "../services/inventory.transfer.service.js";

const router = express.Router();

function resolveLegalEntityScopeFromQuery(req) {
  const legalEntityId = parsePositiveInt(req.query?.legalEntityId);
  return legalEntityId ? { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId } : null;
}

function resolveLegalEntityScopeFromBody(req) {
  const legalEntityId = parsePositiveInt(req.body?.legalEntityId);
  return legalEntityId ? { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId } : null;
}

function requireTenantId(req) {
  const tenantId = parsePositiveInt(resolveTenantId(req));
  return tenantId || null;
}

async function resolveInventoryTransferScopeFromParam(req, tenantId) {
  const transferId = parsePositiveInt(req.params?.transferId);
  const normalizedTenantId = parsePositiveInt(tenantId) || requireTenantId(req);
  if (!transferId || !normalizedTenantId) {
    return null;
  }
  return resolveInventoryTransferScope(transferId, normalizedTenantId);
}

router.get(
  "/transfers",
  requirePermission("inventory.read", {
    resolveScope: async (req) => resolveLegalEntityScopeFromQuery(req),
  }),
  asyncHandler(async (req, res) => {
    const filters = parseInventoryTransferListFilters(req);
    const result = await listInventoryTransfers({
      tenantId: filters.tenantId,
      filters,
    });
    return res.json({
      tenantId: filters.tenantId,
      ...result,
    });
  })
);

router.get(
  "/transfers/:transferId",
  requirePermission("inventory.read", {
    resolveScope: async (req, tenantId) =>
      (await resolveInventoryTransferScopeFromParam(req, tenantId)) ||
      resolveLegalEntityScopeFromQuery(req),
  }),
  asyncHandler(async (req, res) => {
    const transferId = parseInventoryTransferIdParam(req);
    const tenantId = requireTenantId(req);
    const row = await getInventoryTransferById({
      tenantId,
      transferId,
    });
    assertScopeAccess(req, "legal_entity", row.legalEntityId, "inventory transfer legal entity");
    return res.json({
      tenantId,
      row,
    });
  })
);

router.post(
  "/transfers",
  requirePermission("inventory.upsert", {
    resolveScope: async (req) => resolveLegalEntityScopeFromBody(req),
  }),
  asyncHandler(async (req, res) => {
    const payload = parseInventoryTransferCreateInput(req);
    const row = await createInventoryTransfer({
      payload,
    });
    assertScopeAccess(req, "legal_entity", row.legalEntityId, "inventory transfer legal entity");
    return res.status(201).json({
      tenantId: payload.tenantId,
      row,
    });
  })
);

router.post(
  "/transfers/:transferId/approve",
  requirePermission("inventory.upsert", {
    resolveScope: async (req, tenantId) =>
      (await resolveInventoryTransferScopeFromParam(req, tenantId)) ||
      resolveLegalEntityScopeFromBody(req),
  }),
  asyncHandler(async (req, res) => {
    const payload = parseInventoryTransferApproveInput(req);
    const row = await approveInventoryTransferById({
      payload,
    });
    assertScopeAccess(req, "legal_entity", row.legalEntityId, "inventory transfer legal entity");
    return res.json({
      tenantId: payload.tenantId,
      row,
    });
  })
);

router.post(
  "/transfers/:transferId/ship",
  requirePermission("inventory.upsert", {
    resolveScope: async (req, tenantId) =>
      (await resolveInventoryTransferScopeFromParam(req, tenantId)) ||
      resolveLegalEntityScopeFromBody(req),
  }),
  asyncHandler(async (req, res) => {
    const payload = parseInventoryTransferShipInput(req);
    const row = await shipInventoryTransferById({
      payload,
    });
    assertScopeAccess(req, "legal_entity", row.legalEntityId, "inventory transfer legal entity");
    return res.json({
      tenantId: payload.tenantId,
      row,
    });
  })
);

router.post(
  "/transfers/:transferId/receive",
  requirePermission("inventory.upsert", {
    resolveScope: async (req, tenantId) =>
      (await resolveInventoryTransferScopeFromParam(req, tenantId)) ||
      resolveLegalEntityScopeFromBody(req),
  }),
  asyncHandler(async (req, res) => {
    const payload = parseInventoryTransferReceiveInput(req);
    const row = await receiveInventoryTransferById({
      payload,
    });
    assertScopeAccess(req, "legal_entity", row.legalEntityId, "inventory transfer legal entity");
    return res.json({
      tenantId: payload.tenantId,
      row,
    });
  })
);

router.post(
  "/transfers/:transferId/cancel",
  requirePermission("inventory.upsert", {
    resolveScope: async (req, tenantId) =>
      (await resolveInventoryTransferScopeFromParam(req, tenantId)) ||
      resolveLegalEntityScopeFromBody(req),
  }),
  asyncHandler(async (req, res) => {
    const payload = parseInventoryTransferCancelInput(req);
    const row = await cancelInventoryTransferById({
      payload,
    });
    assertScopeAccess(req, "legal_entity", row.legalEntityId, "inventory transfer legal entity");
    return res.json({
      tenantId: payload.tenantId,
      row,
    });
  })
);

router.post(
  "/transfers/:transferId/reverse",
  requirePermission("inventory.upsert", {
    resolveScope: async (req, tenantId) =>
      (await resolveInventoryTransferScopeFromParam(req, tenantId)) ||
      resolveLegalEntityScopeFromBody(req),
  }),
  asyncHandler(async (req, res) => {
    const payload = parseInventoryTransferReverseInput(req);
    const row = await reverseInventoryTransferById({
      payload,
    });
    assertScopeAccess(req, "legal_entity", row.legalEntityId, "inventory transfer legal entity");
    return res.json({
      tenantId: payload.tenantId,
      row,
    });
  })
);

export default router;
