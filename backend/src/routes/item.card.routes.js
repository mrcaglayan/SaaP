import express from "express";
import { asyncHandler, parsePositiveInt } from "./_utils.js";
import { requirePermission } from "../middleware/rbac.js";
import {
  parseItemCardCreateInput,
  parseItemCardIdParam,
  parseItemCardListFilters,
  parseItemCardUpdateInput,
} from "./item.card.validators.js";
import {
  createItemCard,
  getItemCardByIdForTenant,
  listItemCards,
  resolveItemCardScope,
  updateItemCardById,
} from "../services/item.card.service.js";

const router = express.Router();

function resolveLegalEntityScopeFromQuery(req) {
  const legalEntityId = parsePositiveInt(
    req.query?.legalEntityId ?? req.query?.legal_entity_id
  );
  return legalEntityId ? { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId } : null;
}

function resolveLegalEntityScopeFromBody(req) {
  const legalEntityId = parsePositiveInt(
    req.body?.legalEntityId ?? req.body?.legal_entity_id
  );
  return legalEntityId ? { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId } : null;
}

router.get(
  "/",
  requirePermission("item.card.read", {
    resolveScope: async (req) => resolveLegalEntityScopeFromQuery(req),
  }),
  asyncHandler(async (req, res) => {
    const filters = parseItemCardListFilters(req);
    const result = await listItemCards({
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
  "/:itemCardId",
  requirePermission("item.card.read", {
    resolveScope: async (req, tenantId) =>
      resolveItemCardScope(req.params?.itemCardId, tenantId),
  }),
  asyncHandler(async (req, res) => {
    const tenantId = parseItemCardListFilters(req).tenantId;
    const itemCardId = parseItemCardIdParam(req);
    const row = await getItemCardByIdForTenant({
      tenantId,
      itemCardId,
    });
    return res.json({
      tenantId,
      row,
    });
  })
);

router.post(
  "/",
  requirePermission("item.card.upsert", {
    resolveScope: async (req) => resolveLegalEntityScopeFromBody(req),
  }),
  asyncHandler(async (req, res) => {
    const payload = parseItemCardCreateInput(req);
    const row = await createItemCard({ payload });
    return res.status(201).json({
      tenantId: payload.tenantId,
      row,
    });
  })
);

router.patch(
  "/:itemCardId",
  requirePermission("item.card.upsert", {
    resolveScope: async (req, tenantId) => {
      const existingScope = await resolveItemCardScope(req.params?.itemCardId, tenantId);
      return existingScope || resolveLegalEntityScopeFromBody(req);
    },
  }),
  asyncHandler(async (req, res) => {
    const payload = parseItemCardUpdateInput(req);
    const row = await updateItemCardById({ payload });
    return res.json({
      tenantId: payload.tenantId,
      row,
    });
  })
);

export default router;
