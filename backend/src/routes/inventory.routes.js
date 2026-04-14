import express from "express";
import { asyncHandler, badRequest, parsePositiveInt } from "./_utils.js";
import { query } from "../db.js";
import { requirePermission } from "../middleware/rbac.js";
import { assertOperatingUnitBelongsToTenant } from "../tenantGuards.js";
import {
  parseInventoryCostLayerListFilters,
  parseInventoryMovementCreateInput,
  parseInventoryMovementListFilters,
  parseInventoryMovementReverseInput,
  parseInventoryStockLinkMaterializeInput,
  parseInventoryStockLinkListFilters,
  parseInventoryWarehouseUpsertInput,
  parseInventoryWarehouseListFilters,
} from "./inventory.validators.js";
import {
  createInventoryMovementFromStockLink,
  upsertInventoryWarehouse,
  getInventoryWorkQueueSummary,
  listInventoryCostLayers,
  listInventoryMovements,
  listInventoryWarehouses,
  listPendingInventoryStockLinks,
  materializeInventoryMovementFromCariStockLink,
  reverseInventoryMovementById,
} from "../services/inventory.service.js";

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

async function resolveInventoryWarehouseWriteScopeFromBody(req, tenantId) {
  const operatingUnitId = parsePositiveInt(req.body?.operatingUnitId);
  const legalEntityId = parsePositiveInt(req.body?.legalEntityId);
  if (operatingUnitId) {
    const operatingUnit = await assertOperatingUnitBelongsToTenant(
      tenantId,
      operatingUnitId,
      "operatingUnitId"
    );
    if (
      legalEntityId &&
      parsePositiveInt(operatingUnit?.legal_entity_id) !== legalEntityId
    ) {
      throw badRequest("operatingUnitId must belong to legalEntityId");
    }
    return { scopeType: "OPERATING_UNIT", scopeId: operatingUnitId };
  }
  return legalEntityId ? { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId } : null;
}

async function resolveInventoryWarehouseScopeFromId(warehouseId, tenantId) {
  const normalizedWarehouseId = parsePositiveInt(warehouseId);
  const normalizedTenantId = parsePositiveInt(tenantId);
  if (!normalizedWarehouseId || !normalizedTenantId) {
    return null;
  }
  const result = await query(
    `SELECT legal_entity_id, operating_unit_id
       FROM inventory_warehouses
      WHERE tenant_id = ?
        AND id = ?
      LIMIT 1`,
    [normalizedTenantId, normalizedWarehouseId]
  );
  return mapInventoryOwnershipToScope(result.rows?.[0] || null);
}

async function resolveInventoryMovementScopeFromParam(req, tenantId) {
  const movementId = parsePositiveInt(req.params?.movementId);
  const normalizedTenantId = parsePositiveInt(tenantId);
  if (!movementId || !normalizedTenantId) {
    return null;
  }
  const result = await query(
    `SELECT m.legal_entity_id, w.operating_unit_id
       FROM inventory_movements m
       LEFT JOIN inventory_warehouses w
         ON w.tenant_id = m.tenant_id
        AND w.id = m.warehouse_id
      WHERE m.tenant_id = ?
        AND m.id = ?
      LIMIT 1`,
    [normalizedTenantId, movementId]
  );
  return mapInventoryOwnershipToScope(result.rows?.[0] || null);
}

async function resolveInventoryMovementScopeFromBody(req, tenantId) {
  const warehouseId = parsePositiveInt(req.body?.warehouseId);
  if (warehouseId) {
    return (
      (await resolveInventoryWarehouseScopeFromId(warehouseId, tenantId)) ||
      resolveLegalEntityScopeFromBody(req)
    );
  }
  return resolveLegalEntityScopeFromBody(req);
}

async function resolveInventoryStockLinkScopeFromParam(req, tenantId) {
  const stockLinkId = parsePositiveInt(req.params?.stockLinkId);
  const normalizedTenantId = parsePositiveInt(tenantId);
  if (!stockLinkId || !normalizedTenantId) {
    return null;
  }
  const result = await query(
    `SELECT sl.legal_entity_id, w.operating_unit_id
       FROM cari_document_line_stock_links sl
       LEFT JOIN inventory_warehouses w
         ON w.tenant_id = sl.tenant_id
        AND w.id = sl.warehouse_id
      WHERE sl.tenant_id = ?
        AND sl.id = ?
      LIMIT 1`,
    [normalizedTenantId, stockLinkId]
  );
  return mapInventoryOwnershipToScope(result.rows?.[0] || null);
}

router.get(
  "/warehouses",
  requirePermission("inventory.read", {
    resolveScope: async (req) => resolveInventoryReadScopeFromQuery(req),
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
  requirePermission("inventory.warehouse.upsert", {
    resolveScope: async (req, tenantId) =>
      resolveInventoryWarehouseWriteScopeFromBody(req, tenantId),
  }),
  asyncHandler(async (req, res) => {
    const payload = parseInventoryWarehouseUpsertInput(req);
    const row = await upsertInventoryWarehouse({ payload });
    return res.status(201).json({
      tenantId: payload.tenantId,
      row,
    });
  })
);

router.get(
  "/work-queue-summary",
  requirePermission("inventory.read", {
    resolveScope: async (req) => resolveInventoryReadScopeFromQuery(req),
  }),
  asyncHandler(async (req, res) => {
    const filters = parseInventoryStockLinkListFilters(req);
    const result = await getInventoryWorkQueueSummary({
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
  "/cari-stock-links",
  requirePermission("inventory.read", {
    resolveScope: async (req) => resolveInventoryReadScopeFromQuery(req),
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

router.post(
  "/cari-stock-links/:stockLinkId/materialize",
  requirePermission("inventory.materialize", {
    resolveScope: async (req, tenantId) =>
      (await resolveInventoryStockLinkScopeFromParam(req, tenantId)) ||
      resolveLegalEntityScopeFromBody(req),
  }),
  asyncHandler(async (req, res) => {
    const payload = parseInventoryStockLinkMaterializeInput(req);
    const row = await materializeInventoryMovementFromCariStockLink({ payload });
    return res.status(201).json({
      tenantId: payload.tenantId,
      row,
    });
  })
);

router.get(
  "/movements",
  requirePermission("inventory.read", {
    resolveScope: async (req) => resolveInventoryReadScopeFromQuery(req),
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
  requirePermission("inventory.materialize", {
    resolveScope: async (req, tenantId) =>
      resolveInventoryMovementScopeFromBody(req, tenantId),
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
  requirePermission("inventory.movement.reverse", {
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
    resolveScope: async (req) => resolveInventoryReadScopeFromQuery(req),
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
