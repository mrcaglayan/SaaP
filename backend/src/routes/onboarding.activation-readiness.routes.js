import express from "express";
import { assertScopeAccess, buildScopeFilter, requirePermission } from "../middleware/rbac.js";
import { query } from "../db.js";
import { assertLegalEntityBelongsToTenant } from "../tenantGuards.js";
import {
  asyncHandler,
  badRequest,
  parsePositiveInt,
  resolveTenantId,
} from "./_utils.js";
import { getLegalEntityActivationReadiness } from "../services/legal-entity-activation-readiness.service.js";

const router = express.Router();

async function listVisibleActivationLegalEntityIds({ req, tenantId, runQuery = query }) {
  const params = [tenantId];
  const conditions = ["le.tenant_id = ?", "le.status = 'ACTIVE'"];
  conditions.push(buildScopeFilter(req, "legal_entity", "le.id", params));

  const result = await runQuery(
    `SELECT le.id
     FROM legal_entities le
     WHERE ${conditions.join(" AND ")}
     ORDER BY le.id`,
    params,
  );

  return (result.rows || [])
    .map((row) => parsePositiveInt(row.id))
    .filter(Boolean);
}

router.get(
  "/legal-entity-activation",
  requirePermission("org.tree.read", {
    resolveScope: (req) => {
      const legalEntityId = parsePositiveInt(req.query?.legalEntityId);
      if (legalEntityId) {
        return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
      }
      return null;
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const hasLegalEntityIdFilter =
      req.query?.legalEntityId !== undefined && req.query?.legalEntityId !== "";
    const legalEntityId = parsePositiveInt(req.query?.legalEntityId);
    if (hasLegalEntityIdFilter && !legalEntityId) {
      throw badRequest("legalEntityId must be a positive integer");
    }

    let legalEntityIds = [];
    if (legalEntityId) {
      await assertLegalEntityBelongsToTenant(tenantId, legalEntityId, "legalEntityId");
      assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");
      legalEntityIds = [legalEntityId];
    } else {
      legalEntityIds = await listVisibleActivationLegalEntityIds({ req, tenantId });
    }

    const payload = await getLegalEntityActivationReadiness(tenantId, {
      legalEntityIds,
    });
    return res.json(payload);
  }),
);

export default router;
