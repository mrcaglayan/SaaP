import express from "express";
import { asyncHandler, badRequest, parsePositiveInt, resolveTenantId } from "./_utils.js";
import { query } from "../db.js";
import { assertScopeAccess, requirePermission } from "../middleware/rbac.js";
import inventoryTransferEvidenceRoutes from "./inventory.transfer.evidence.routes.js";
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
  listInventoryTransferTargetWarehouseOptions,
  listInventoryTransfers,
  receiveInventoryTransferById,
  resolveInventoryTransferActionScope,
  resolveInventoryTransferScope,
  resolveInventoryTransferSourceWarehouseScope,
  reverseInventoryTransferById,
  shipInventoryTransferById,
} from "../services/inventory.transfer.service.js";

const router = express.Router();

function resolveLegalEntityScopeFromQuery(req) {
  const legalEntityId = parsePositiveInt(req.query?.legalEntityId);
  return legalEntityId ? { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId } : null;
}

function resolveInventoryReadScopeFromQuery(req) {
  const operatingUnitId = parsePositiveInt(req.query?.operatingUnitId);
  if (operatingUnitId) {
    return { scopeType: "OPERATING_UNIT", scopeId: operatingUnitId };
  }
  return resolveLegalEntityScopeFromQuery(req);
}

function resolveLegalEntityScopeFromBody(req) {
  const legalEntityId = parsePositiveInt(req.body?.legalEntityId);
  return legalEntityId ? { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId } : null;
}

function mapInventoryOwnershipToScope(row) {
  const operatingUnitId = parsePositiveInt(row?.operating_unit_id);
  if (operatingUnitId) {
    return { scopeType: "OPERATING_UNIT", scopeId: operatingUnitId };
  }
  const legalEntityId = parsePositiveInt(row?.legal_entity_id);
  return legalEntityId ? { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId } : null;
}

function requireTenantId(req) {
  const tenantId = parsePositiveInt(resolveTenantId(req));
  return tenantId || null;
}

async function resolveInventoryTransferScopeFromParam(req, tenantId, action = "LEGAL_ENTITY") {
  const transferId = parsePositiveInt(req.params?.transferId);
  const normalizedTenantId = parsePositiveInt(tenantId) || requireTenantId(req);
  if (!transferId || !normalizedTenantId) {
    return null;
  }
  return action === "LEGAL_ENTITY"
    ? resolveInventoryTransferScope(transferId, normalizedTenantId)
    : resolveInventoryTransferActionScope(transferId, normalizedTenantId, action);
}

async function resolveInventoryTransferCreateScopeFromBody(req, tenantId) {
  const normalizedTenantId = parsePositiveInt(tenantId) || requireTenantId(req);
  const sourceWarehouseId = parsePositiveInt(req.body?.sourceWarehouseId);
  const legalEntityId = parsePositiveInt(req.body?.legalEntityId);
  if (!normalizedTenantId || !sourceWarehouseId) {
    return resolveLegalEntityScopeFromBody(req);
  }
  const result = await query(
    `SELECT legal_entity_id, operating_unit_id
       FROM inventory_warehouses
      WHERE tenant_id = ?
        AND id = ?
      LIMIT 1`,
    [normalizedTenantId, sourceWarehouseId]
  );
  const row = result.rows?.[0] || null;
  if (
    row &&
    legalEntityId &&
    parsePositiveInt(row.legal_entity_id) &&
    parsePositiveInt(row.legal_entity_id) !== legalEntityId
  ) {
    throw badRequest("sourceWarehouseId must belong to legalEntityId");
  }
  return mapInventoryOwnershipToScope(row) || resolveLegalEntityScopeFromBody(req);
}

function assertInventoryTransferReadAccess(req, row) {
  const requestedOperatingUnitId = parsePositiveInt(req.query?.operatingUnitId);
  const transferLegalEntityId = parsePositiveInt(row?.legalEntityId ?? row?.legal_entity_id);
  if (requestedOperatingUnitId) {
    const sourceOperatingUnitId = parsePositiveInt(
      row?.sourceOperatingUnitId ?? row?.source_operating_unit_id
    );
    const targetOperatingUnitId = parsePositiveInt(
      row?.targetOperatingUnitId ?? row?.target_operating_unit_id
    );
    if (
      sourceOperatingUnitId !== requestedOperatingUnitId &&
      targetOperatingUnitId !== requestedOperatingUnitId
    ) {
      throw badRequest("operatingUnitId must match the inventory transfer scope");
    }
    assertScopeAccess(
      req,
      "operating_unit",
      requestedOperatingUnitId,
      "inventory transfer operating unit"
    );
    return;
  }
  const requestedLegalEntityId = parsePositiveInt(req.query?.legalEntityId);
  if (requestedLegalEntityId && requestedLegalEntityId !== transferLegalEntityId) {
    throw badRequest("legalEntityId must match the inventory transfer legal entity");
  }
  assertScopeAccess(req, "legal_entity", transferLegalEntityId, "inventory transfer legal entity");
}

router.use("/transfers/:transferId/evidence", inventoryTransferEvidenceRoutes);

router.get(
  "/transfers/warehouse-options/targets",
  requirePermission("inventory.transfer.create", {
    resolveScope: async (req, tenantId) => {
      const normalizedTenantId = parsePositiveInt(tenantId) || requireTenantId(req);
      const sourceWarehouseId = parsePositiveInt(req.query?.sourceWarehouseId);
      if (!normalizedTenantId || !sourceWarehouseId) {
        return null;
      }
      return resolveInventoryTransferSourceWarehouseScope(
        sourceWarehouseId,
        normalizedTenantId
      );
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = requireTenantId(req);
    const sourceWarehouseId = parsePositiveInt(req.query?.sourceWarehouseId);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }
    if (!sourceWarehouseId) {
      throw badRequest("sourceWarehouseId is required");
    }
    const result = await listInventoryTransferTargetWarehouseOptions({
      tenantId,
      sourceWarehouseId,
    });
    return res.json({
      tenantId,
      ...result,
    });
  })
);

router.get(
  "/transfers",
  requirePermission("inventory.read", {
    resolveScope: async (req) => resolveInventoryReadScopeFromQuery(req),
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
      resolveInventoryReadScopeFromQuery(req) ||
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
    assertInventoryTransferReadAccess(req, row);
    return res.json({
      tenantId,
      row,
    });
  })
);

router.post(
  "/transfers",
  requirePermission("inventory.transfer.create", {
    resolveScope: async (req, tenantId) =>
      resolveInventoryTransferCreateScopeFromBody(req, tenantId),
  }),
  asyncHandler(async (req, res) => {
    const payload = parseInventoryTransferCreateInput(req);
    const row = await createInventoryTransfer({
      payload,
    });
    return res.status(201).json({
      tenantId: payload.tenantId,
      row,
    });
  })
);

router.post(
  "/transfers/:transferId/approve",
  requirePermission("inventory.transfer.approve", {
    resolveScope: async (req, tenantId) =>
      (await resolveInventoryTransferScopeFromParam(req, tenantId, "LEGAL_ENTITY")) ||
      resolveLegalEntityScopeFromBody(req),
  }),
  asyncHandler(async (req, res) => {
    const payload = parseInventoryTransferApproveInput(req);
    const row = await approveInventoryTransferById({
      payload,
    });
    return res.json({
      tenantId: payload.tenantId,
      row,
    });
  })
);

router.post(
  "/transfers/:transferId/ship",
  requirePermission("inventory.transfer.ship", {
    resolveScope: async (req, tenantId) =>
      (await resolveInventoryTransferScopeFromParam(req, tenantId, "SOURCE")) ||
      resolveLegalEntityScopeFromBody(req),
  }),
  asyncHandler(async (req, res) => {
    const payload = parseInventoryTransferShipInput(req);
    const row = await shipInventoryTransferById({
      payload,
    });
    return res.json({
      tenantId: payload.tenantId,
      row,
    });
  })
);

router.post(
  "/transfers/:transferId/receive",
  requirePermission("inventory.transfer.receive", {
    resolveScope: async (req, tenantId) =>
      (await resolveInventoryTransferScopeFromParam(req, tenantId, "TARGET")) ||
      resolveLegalEntityScopeFromBody(req),
  }),
  asyncHandler(async (req, res) => {
    const payload = parseInventoryTransferReceiveInput(req);
    const row = await receiveInventoryTransferById({
      payload,
    });
    return res.json({
      tenantId: payload.tenantId,
      row,
    });
  })
);

router.post(
  "/transfers/:transferId/cancel",
  requirePermission("inventory.transfer.cancel", {
    resolveScope: async (req, tenantId) =>
      (await resolveInventoryTransferScopeFromParam(req, tenantId, "SOURCE")) ||
      resolveLegalEntityScopeFromBody(req),
  }),
  asyncHandler(async (req, res) => {
    const payload = parseInventoryTransferCancelInput(req);
    const row = await cancelInventoryTransferById({
      payload,
    });
    return res.json({
      tenantId: payload.tenantId,
      row,
    });
  })
);

router.post(
  "/transfers/:transferId/reverse",
  requirePermission("inventory.transfer.reverse", {
    resolveScope: async (req, tenantId) =>
      (await resolveInventoryTransferScopeFromParam(req, tenantId, "LEGAL_ENTITY")) ||
      resolveLegalEntityScopeFromBody(req),
  }),
  asyncHandler(async (req, res) => {
    const payload = parseInventoryTransferReverseInput(req);
    const row = await reverseInventoryTransferById({
      payload,
    });
    return res.json({
      tenantId: payload.tenantId,
      row,
    });
  })
);

export default router;
