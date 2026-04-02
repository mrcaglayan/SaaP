import express from "express";
import {
  assertScopeAccess,
  buildScopeFilter,
  requirePermission,
} from "../middleware/rbac.js";
import { asyncHandler, parsePositiveInt } from "./_utils.js";
import {
  parseCounterpartyCreateInput,
  parseCounterpartyIdParam,
  parseCounterpartyReadFilters,
  parseCounterpartyUpdateInput,
} from "./cari.counterparty.validators.js";
import { requireTenantId } from "./cash.validators.common.js";
import {
  createCounterparty,
  getCounterpartyByIdForTenant,
  listCounterpartyRows,
  updateCounterpartyById,
} from "../services/cari.counterparty.service.js";

const router = express.Router();

router.get(
  "/",
  requirePermission("cari.card.read", {
    resolveScope: async (req) => {
      const primaryOperatingUnitId = parsePositiveInt(req.query?.primaryOperatingUnitId);
      if (primaryOperatingUnitId) {
        return { scopeType: "OPERATING_UNIT", scopeId: primaryOperatingUnitId };
      }
      const allowedOperatingUnitId = parsePositiveInt(req.query?.allowedOperatingUnitId);
      if (allowedOperatingUnitId) {
        return { scopeType: "OPERATING_UNIT", scopeId: allowedOperatingUnitId };
      }
      // List routes rely on row-level scope filtering in the service layer.
      // Avoid resolving LEGAL_ENTITY scope here so OU-scoped users can search
      // within their parent entity without an upfront 403.
      return null;
    },
  }),
  asyncHandler(async (req, res) => {
    const filters = parseCounterpartyReadFilters(req);
    const result = await listCounterpartyRows({
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
  "/:id",
  requirePermission("cari.card.read", {
    // Detail/edit access is decided in the service layer so OU-scoped users can
    // open only branch-owned cards without needing direct LEGAL_ENTITY scope.
    resolveScope: async () => null,
  }),
  asyncHandler(async (req, res) => {
    const tenantId = requireTenantId(req);
    const counterpartyId = parseCounterpartyIdParam(req);
    const row = await getCounterpartyByIdForTenant({
      req,
      tenantId,
      counterpartyId,
      assertScopeAccess,
    });
    return res.json({
      tenantId,
      row,
    });
  })
);

router.post(
  "/",
  requirePermission("cari.card.upsert", {
    // Create scope is enforced in the service layer so branch-scoped users can
    // save one in-scope OU-owned card without an upfront LEGAL_ENTITY 403.
    resolveScope: async () => null,
  }),
  asyncHandler(async (req, res) => {
    const payload = parseCounterpartyCreateInput(req);
    const row = await createCounterparty({
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

router.put(
  "/:id",
  requirePermission("cari.card.upsert", {
    // Update ownership checks depend on the existing card plus the requested OU
    // anchors, so the service layer performs the final authorization decision.
    resolveScope: async () => null,
  }),
  asyncHandler(async (req, res) => {
    const payload = parseCounterpartyUpdateInput(req);
    const row = await updateCounterpartyById({
      req,
      payload,
      assertScopeAccess,
    });
    return res.json({
      tenantId: payload.tenantId,
      row,
    });
  })
);

export default router;
