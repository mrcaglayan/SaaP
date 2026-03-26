import express from "express";
import { asyncHandler, parsePositiveInt } from "./_utils.js";
import { requirePermission } from "../middleware/rbac.js";
import {
  parseInventoryLandedCostVoucherCreateInput,
  parseInventoryLandedCostVoucherDetailInput,
  parseInventoryLandedCostVoucherListInput,
  parseInventoryLandedCostVoucherReverseInput,
  parseInventoryLandedCostVoucherPreviewInput,
  parseInventoryLandedCostVoucherSourceLookupInput,
  parseInventoryLandedCostVoucherTargetLookupInput,
} from "./inventory.landed-cost.validators.js";
import {
  createInventoryLandedCostVoucher,
  getInventoryLandedCostVoucherById,
  listInventoryLandedCostSourceLineLookup,
  listInventoryLandedCostTargetLookup,
  listInventoryLandedCostVouchers,
  previewInventoryLandedCostVoucher,
  resolveInventoryLandedCostVoucherScope,
  reverseInventoryLandedCostVoucher,
} from "../services/inventory.landed-cost.service.js";

const router = express.Router();

function resolvePreviewScopeFromBody(req) {
  const operatingUnitId = parsePositiveInt(req.body?.operatingUnitId);
  if (operatingUnitId) {
    return { scopeType: "OPERATING_UNIT", scopeId: operatingUnitId };
  }
  const legalEntityId = parsePositiveInt(req.body?.legalEntityId);
  return legalEntityId ? { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId } : null;
}

function resolveReadScopeFromQuery(req) {
  const operatingUnitId = parsePositiveInt(req.query?.operatingUnitId);
  if (operatingUnitId) {
    return { scopeType: "OPERATING_UNIT", scopeId: operatingUnitId };
  }
  const legalEntityId = parsePositiveInt(req.query?.legalEntityId);
  return legalEntityId ? { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId } : null;
}

async function resolveVoucherScopeFromParam(req, tenantId) {
  const voucherId = parsePositiveInt(req.params?.voucherId);
  const normalizedTenantId =
    parsePositiveInt(tenantId)
    || parsePositiveInt(req.body?.tenantId)
    || parsePositiveInt(req.query?.tenantId);
  if (!voucherId || !normalizedTenantId) {
    return null;
  }
  return resolveInventoryLandedCostVoucherScope(voucherId, normalizedTenantId);
}

router.get(
  "/landed-cost-vouchers/lookups/source-lines",
  requirePermission("inventory.read", {
    resolveScope: async (req) => resolveReadScopeFromQuery(req),
  }),
  asyncHandler(async (req, res) => {
    const payload = parseInventoryLandedCostVoucherSourceLookupInput(req);
    const result = await listInventoryLandedCostSourceLineLookup({
      tenantId: payload.tenantId,
      legalEntityId: payload.legalEntityId,
      filters: payload,
    });
    return res.json(result);
  })
);

router.get(
  "/landed-cost-vouchers/lookups/receipt-targets",
  requirePermission("inventory.read", {
    resolveScope: async (req) => resolveReadScopeFromQuery(req),
  }),
  asyncHandler(async (req, res) => {
    const payload = parseInventoryLandedCostVoucherTargetLookupInput(req);
    const result = await listInventoryLandedCostTargetLookup({
      tenantId: payload.tenantId,
      legalEntityId: payload.legalEntityId,
      filters: payload,
    });
    return res.json(result);
  })
);

router.get(
  "/landed-cost-vouchers",
  requirePermission("inventory.read", {
    resolveScope: async (req) => resolveReadScopeFromQuery(req),
  }),
  asyncHandler(async (req, res) => {
    const payload = parseInventoryLandedCostVoucherListInput(req);
    const result = await listInventoryLandedCostVouchers({
      tenantId: payload.tenantId,
      filters: payload,
    });
    return res.json(result);
  })
);

router.get(
  "/landed-cost-vouchers/:voucherId",
  requirePermission("inventory.read", {
    resolveScope: async (req, tenantId) => resolveVoucherScopeFromParam(req, tenantId),
  }),
  asyncHandler(async (req, res) => {
    const payload = parseInventoryLandedCostVoucherDetailInput(req);
    const result = await getInventoryLandedCostVoucherById({
      tenantId: payload.tenantId,
      voucherId: payload.voucherId,
    });
    if (!result) {
      return res.status(404).json({
        message: "Landed-cost voucher not found",
      });
    }
    return res.json(result);
  })
);

router.post(
  "/landed-cost-vouchers/preview",
  requirePermission("inventory.read", {
    resolveScope: async (req) => resolvePreviewScopeFromBody(req),
  }),
  asyncHandler(async (req, res) => {
    const payload = parseInventoryLandedCostVoucherPreviewInput(req);
    const result = await previewInventoryLandedCostVoucher({
      payload,
    });
    return res.json(result);
  })
);

router.post(
  "/landed-cost-vouchers",
  requirePermission("inventory.upsert", {
    resolveScope: async (req) => resolvePreviewScopeFromBody(req),
  }),
  asyncHandler(async (req, res) => {
    const payload = parseInventoryLandedCostVoucherCreateInput(req);
    const result = await createInventoryLandedCostVoucher({
      payload,
    });
    return res.status(201).json(result);
  })
);

router.post(
  "/landed-cost-vouchers/:voucherId/reverse",
  requirePermission("inventory.upsert", {
    resolveScope: async (req, tenantId) =>
      (await resolveVoucherScopeFromParam(req, tenantId)) || resolvePreviewScopeFromBody(req),
  }),
  asyncHandler(async (req, res) => {
    const payload = parseInventoryLandedCostVoucherReverseInput(req);
    const result = await reverseInventoryLandedCostVoucher({
      payload,
    });
    return res.json(result);
  })
);

export default router;
