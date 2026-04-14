import express from "express";
import { asyncHandler, badRequest, parsePositiveInt } from "./_utils.js";
import { requirePermission } from "../middleware/rbac.js";
import { assertOperatingUnitBelongsToTenant } from "../tenantGuards.js";
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

function resolveItemCardReadScopeFromQuery(req) {
  const operatingUnitId = parsePositiveInt(
    req.query?.operatingUnitId ?? req.query?.operating_unit_id
  );
  if (operatingUnitId) {
    return { scopeType: "OPERATING_UNIT", scopeId: operatingUnitId };
  }
  return resolveLegalEntityScopeFromQuery(req);
}

async function resolveItemCardWriteScopeFromBody(
  req,
  tenantId,
  fallbackLegalEntityId = null
) {
  const operatingUnitId = parsePositiveInt(
    req.body?.operatingUnitId ?? req.body?.operating_unit_id
  );
  const legalEntityId =
    parsePositiveInt(req.body?.legalEntityId ?? req.body?.legal_entity_id) ||
    parsePositiveInt(fallbackLegalEntityId);
  if (operatingUnitId) {
    // Item cards stay legal-entity-owned, but branch-scoped operators still need
    // to author them through their OU entitlement when working inside that branch.
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

router.get(
  "/",
  requirePermission("item.card.read", {
    resolveScope: async (req) => resolveItemCardReadScopeFromQuery(req),
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
    resolveScope: async (req, tenantId) =>
      resolveItemCardWriteScopeFromBody(req, tenantId),
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
      const existingLegalEntityId =
        existingScope?.scopeType === "LEGAL_ENTITY" ? existingScope.scopeId : null;
      return (
        (await resolveItemCardWriteScopeFromBody(
          req,
          tenantId,
          existingLegalEntityId
        )) || existingScope
      );
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
