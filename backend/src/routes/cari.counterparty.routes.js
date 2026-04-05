import express from "express";
import {
  assertScopeAccess,
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
  resolveCounterpartyScope,
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
      // Do not turn a legalEntityId list filter into a stricter action-scope
      // requirement. OU-scoped users may legitimately read counterparties
      // inside their parent legal entity through row-level visibility.
      return null;
    },
  }),
  asyncHandler(async (req, res) => {
    const filters = parseCounterpartyReadFilters(req);
    const result = await listCounterpartyRows({
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

router.get(
  "/:id",
  requirePermission("cari.card.read", {
    resolveScope: async (req, tenantId) => {
      return resolveCounterpartyScope(req.params?.id, tenantId);
    },
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
    resolveScope: async (req) => {
      const legalEntityId = parsePositiveInt(req.body?.legalEntityId);
      if (legalEntityId) {
        return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
      }
      return null;
    },
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
    resolveScope: async (req, tenantId) => {
      const scope = await resolveCounterpartyScope(req.params?.id, tenantId);
      if (scope) {
        return scope;
      }
      const legalEntityId = parsePositiveInt(req.body?.legalEntityId);
      if (legalEntityId) {
        return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
      }
      return null;
    },
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
