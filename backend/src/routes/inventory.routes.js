import express from "express";
import { asyncHandler, parsePositiveInt } from "./_utils.js";
import { query } from "../db.js";
import { requirePermission } from "../middleware/rbac.js";
import {
  parseInventoryCostLayerListFilters,
  parseInventoryMovementCreateInput,
  parseInventoryMovementListFilters,
  parseInventoryMovementReverseInput,
  parseInventoryStockLinkListFilters,
  parseInventoryWarehouseCreateInput,
  parseInventoryWarehouseListFilters,
} from "./inventory.validators.js";
import {
  createInventoryMovementFromStockLink,
  createInventoryWarehouse,
  listInventoryCostLayers,
  listInventoryMovements,
  listInventoryWarehouses,
  listPendingInventoryStockLinks,
  reverseInventoryMovementById,
} from "../services/inventory.service.js";

const router = express.Router();

function resolveLegalEntityScopeFromQuery(req) {
  const legalEntityId = parsePositiveInt(req.query?.legalEntityId);
  return legalEntityId ? { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId } : null;
}

function resolveLegalEntityScopeFromBody(req) {
  const legalEntityId = parsePositiveInt(req.body?.legalEntityId);
  return legalEntityId ? { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId } : null;
}

async function resolveInventoryMovementScopeFromParam(req, tenantId) {
  const movementId = parsePositiveInt(req.params?.movementId);
  const normalizedTenantId = parsePositiveInt(tenantId);
  if (!movementId || !normalizedTenantId) {
    return null;
  }
  const result = await query(
    `SELECT legal_entity_id
       FROM inventory_movements
      WHERE tenant_id = ?
        AND id = ?
      LIMIT 1`,
    [normalizedTenantId, movementId]
  );
  const legalEntityId = parsePositiveInt(result.rows?.[0]?.legal_entity_id);
  return legalEntityId ? { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId } : null;
}

router.get(
  "/warehouses",
  requirePermission("inventory.read", {
    resolveScope: async (req) => resolveLegalEntityScopeFromQuery(req),
  }),
  asyncHandler(async (req, res) => {
    const filters = parseInventoryWarehouseListFilters(req);
    const result = await listInventoryWarehouses({
      tenantId: filters.tenantId,
      filters,
    });
    return res.json({
      tenantId: filters.tenantId,
      ...result,
    });
  })
);

router.post(
  "/warehouses",
  requirePermission("inventory.upsert", {
    resolveScope: async (req) => resolveLegalEntityScopeFromBody(req),
  }),
  asyncHandler(async (req, res) => {
    const payload = parseInventoryWarehouseCreateInput(req);
    const row = await createInventoryWarehouse({ payload });
    return res.status(201).json({
      tenantId: payload.tenantId,
      row,
    });
  })
);

router.get(
  "/cari-stock-links",
  requirePermission("inventory.read", {
    resolveScope: async (req) => resolveLegalEntityScopeFromQuery(req),
  }),
  asyncHandler(async (req, res) => {
    const filters = parseInventoryStockLinkListFilters(req);
    const result = await listPendingInventoryStockLinks({
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
  "/movements",
  requirePermission("inventory.read", {
    resolveScope: async (req) => resolveLegalEntityScopeFromQuery(req),
  }),
  asyncHandler(async (req, res) => {
    const filters = parseInventoryMovementListFilters(req);
    const result = await listInventoryMovements({
      tenantId: filters.tenantId,
      filters,
    });
    return res.json({
      tenantId: filters.tenantId,
      ...result,
    });
  })
);

router.post(
  "/movements",
  requirePermission("inventory.upsert", {
    resolveScope: async (req) => resolveLegalEntityScopeFromBody(req),
  }),
  asyncHandler(async (req, res) => {
    const payload = parseInventoryMovementCreateInput(req);
    const row = await createInventoryMovementFromStockLink({ payload });
    return res.status(201).json({
      tenantId: payload.tenantId,
      row,
    });
  })
);

router.post(
  "/movements/:movementId/reverse",
  requirePermission("inventory.upsert", {
    resolveScope: async (req, tenantId) =>
      (await resolveInventoryMovementScopeFromParam(req, tenantId)) ||
      resolveLegalEntityScopeFromBody(req),
  }),
  asyncHandler(async (req, res) => {
    const payload = parseInventoryMovementReverseInput(req);
    const row = await reverseInventoryMovementById({ payload });
    return res.json({
      tenantId: payload.tenantId,
      row,
    });
  })
);

router.get(
  "/cost-layers",
  requirePermission("inventory.read", {
    resolveScope: async (req) => resolveLegalEntityScopeFromQuery(req),
  }),
  asyncHandler(async (req, res) => {
    const filters = parseInventoryCostLayerListFilters(req);
    const result = await listInventoryCostLayers({
      tenantId: filters.tenantId,
      filters,
    });
    return res.json({
      tenantId: filters.tenantId,
      ...result,
    });
  })
);

export default router;
