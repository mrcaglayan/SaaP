import { query } from "../db.js";
import { assertScopeAccess, getScopeContext, requirePermission } from "../middleware/rbac.js";
import { assertLegalEntityBelongsToTenant } from "../tenantGuards.js";
import {
  asyncHandler,
  assertRequiredFields,
  badRequest,
  parsePositiveInt,
  resolveTenantId,
} from "./_utils.js";
import {
  listPurposeMappings,
  upsertPurposeMapping,
} from "../services/gl.purpose-mappings.service.js";

function forbidden(message) {
  const err = new Error(message);
  err.status = 403;
  return err;
}

function parseRequiredLegalEntityId(rawValue, fieldLabel = "legalEntityId") {
  const legalEntityId = parsePositiveInt(rawValue);
  if (!legalEntityId) {
    throw badRequest(`${fieldLabel} must be a positive integer`);
  }
  return legalEntityId;
}

function parseOptionalModuleKey(rawValue) {
  const moduleKey = String(rawValue || "")
    .trim()
    .toUpperCase();
  return moduleKey || undefined;
}

async function resolveAccessibleLegalEntityIds(req, tenantId) {
  const scopeContext = getScopeContext(req);
  if (!scopeContext) {
    return { tenantWide: false, legalEntityIds: [] };
  }
  if (scopeContext.tenantWide) {
    return { tenantWide: true, legalEntityIds: [] };
  }

  const legalEntityIds = new Set(
    Array.from(scopeContext.legalEntities || [])
      .map((value) => parsePositiveInt(value))
      .filter(Boolean)
  );
  const operatingUnitIds = Array.from(scopeContext.operatingUnits || [])
    .map((value) => parsePositiveInt(value))
    .filter(Boolean);

  if (operatingUnitIds.length > 0) {
    const placeholders = operatingUnitIds.map(() => "?").join(", ");
    const result = await query(
      `SELECT DISTINCT legal_entity_id
       FROM operating_units
       WHERE tenant_id = ?
         AND id IN (${placeholders})`,
      [tenantId, ...operatingUnitIds]
    );
    for (const row of result.rows || []) {
      const legalEntityId = parsePositiveInt(row?.legal_entity_id);
      if (legalEntityId) {
        legalEntityIds.add(legalEntityId);
      }
    }
  }

  return {
    tenantWide: false,
    legalEntityIds: Array.from(legalEntityIds),
  };
}

/**
 * Register legal-entity purpose-mapping routes used by module workbenches.
 *
 * Read access intentionally accepts operating-unit scoped GL readers and
 * derives the reachable legal entities from their OU scope because these
 * mappings are legal-entity setup consumed by branch-scoped workflows.
 */
export function registerGlPurposeMappingsRoutes(router) {
  router.get(
    "/journal-purpose-accounts",
    requirePermission("gl.account.read"),
    asyncHandler(async (req, res) => {
      const tenantId = resolveTenantId(req);
      if (!tenantId) {
        throw badRequest("tenantId is required");
      }

      const legalEntityId = parseRequiredLegalEntityId(req.query?.legalEntityId);
      const moduleKey = parseOptionalModuleKey(req.query?.moduleKey);
      await assertLegalEntityBelongsToTenant(tenantId, legalEntityId, "legalEntityId");
      const accessibleScope = await resolveAccessibleLegalEntityIds(req, tenantId);
      if (
        !accessibleScope.tenantWide &&
        !accessibleScope.legalEntityIds.includes(legalEntityId)
      ) {
        throw forbidden("Access denied for legalEntityId");
      }

      const rows = await listPurposeMappings({ tenantId, legalEntityId, moduleKey });
      return res.json({
        tenantId,
        legalEntityId,
        moduleKey: moduleKey || "CARI",
        rows,
      });
    })
  );

  router.post(
    "/journal-purpose-accounts",
    requirePermission("gl.account.upsert", {
      resolveScope: (req, tenantId) => {
        const legalEntityId = parsePositiveInt(req.body?.legalEntityId);
        if (legalEntityId) {
          return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
        }
        return { scopeType: "TENANT", scopeId: tenantId };
      },
    }),
    asyncHandler(async (req, res) => {
      const tenantId = resolveTenantId(req);
      if (!tenantId) {
        throw badRequest("tenantId is required");
      }

      assertRequiredFields(req.body, ["legalEntityId", "purposeCode", "accountId"]);
      const legalEntityId = parseRequiredLegalEntityId(req.body?.legalEntityId);
      const moduleKey = parseOptionalModuleKey(req.body?.moduleKey);
      await assertLegalEntityBelongsToTenant(tenantId, legalEntityId, "legalEntityId");
      assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");

      const row = await upsertPurposeMapping({
        tenantId,
        legalEntityId,
        moduleKey,
        purposeCode: req.body?.purposeCode,
        accountId: req.body?.accountId,
      });
      return res.status(201).json({
        ok: true,
        tenantId,
        legalEntityId,
        moduleKey: moduleKey || row?.moduleKey || "CARI",
        row,
      });
    })
  );
}
