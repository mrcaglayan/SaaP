import { assertScopeAccess, requirePermission } from "../middleware/rbac.js";
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

export function registerGlPurposeMappingsRoutes(router) {
  router.get(
    "/journal-purpose-accounts",
    requirePermission("gl.account.read", {
      resolveScope: (req) => {
        const legalEntityId = parsePositiveInt(req.query?.legalEntityId);
        return legalEntityId
          ? { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId }
          : null;
      },
    }),
    asyncHandler(async (req, res) => {
      const tenantId = resolveTenantId(req);
      if (!tenantId) {
        throw badRequest("tenantId is required");
      }

      const legalEntityId = parseRequiredLegalEntityId(req.query?.legalEntityId);
      const moduleKey = parseOptionalModuleKey(req.query?.moduleKey);
      await assertLegalEntityBelongsToTenant(tenantId, legalEntityId, "legalEntityId");
      assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");

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
