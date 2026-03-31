import { assertScopeAccess, requirePermission } from "../middleware/rbac.js";
import { asyncHandler, parsePositiveInt, resolveTenantId } from "./_utils.js";
import {
  createLocalClosePack,
  getLocalClosePackById,
  listLocalClosePacks,
  resolveLocalClosePackScope,
} from "../services/local.close-packs.service.js";
import {
  approveLocalClosePack,
  lockLocalClosePack,
  returnLocalClosePack,
  submitLocalClosePack,
} from "../services/local.close-pack.workflow.service.js";
import {
  approveLocalClosePackReopenRequest,
  createLocalClosePackReopenRequest,
  getLocalClosePackEntityReadinessByPackId,
  listLocalClosePackReopenRequests,
  rejectLocalClosePackReopenRequest,
} from "../services/local.close-reopen.service.js";
import {
  parseLocalClosePackActionInput,
  parseLocalClosePackCreateInput,
  parseLocalClosePackIdParam,
  parseLocalClosePackListInput,
} from "./local.close-packs.validators.js";
import {
  parseLocalClosePackReopenRequestCreateInput,
  parseLocalClosePackReopenRequestDecisionInput,
  parseLocalClosePackReopenRequestListInput,
} from "./local.close-reopen.validators.js";

function resolveScopeFromLocalClosePackInput(rawValue) {
  const closeScopeType = String(
    rawValue?.closeScopeType ?? rawValue?.close_scope_type ?? ""
  )
    .trim()
    .toUpperCase();
  const operatingUnitId = parsePositiveInt(
    rawValue?.operatingUnitId ?? rawValue?.operating_unit_id
  );
  if (closeScopeType === "OPERATING_UNIT" && operatingUnitId) {
    return { scopeType: "OPERATING_UNIT", scopeId: operatingUnitId };
  }

  const legalEntityId = parsePositiveInt(
    rawValue?.legalEntityId ?? rawValue?.legal_entity_id
  );
  if (legalEntityId) {
    return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
  }
  return null;
}

/**
 * Register baseline local close-pack header routes for RP06.
 */
export function registerLocalClosePackRoutes(router) {
  router.get(
    "/local-close-packs",
    requirePermission("ouclose.read"),
    asyncHandler(async (req, res) => {
      const input = parseLocalClosePackListInput(req);
      const result = await listLocalClosePacks({
        req,
        tenantId: input.tenantId,
        filters: input,
        assertScopeAccess,
      });
      return res.json({
        tenantId: input.tenantId,
        ...result,
      });
    })
  );

  router.get(
    "/local-close-packs/:packId",
    requirePermission("ouclose.read", {
      resolveScope: (req, tenantId) =>
        resolveLocalClosePackScope(req.params?.packId, tenantId),
    }),
    asyncHandler(async (req, res) => {
      const tenantId = resolveTenantId(req);
      const packId = parseLocalClosePackIdParam(req);
      const row = await getLocalClosePackById({
        req,
        tenantId,
        packId,
        assertScopeAccess,
      });
      const entityReadiness = await getLocalClosePackEntityReadinessByPackId({
        req,
        tenantId,
        packId,
        assertScopeAccess,
      });
      return res.json({
        tenantId,
        row,
        entityReadiness,
      });
    })
  );

  router.post(
    "/local-close-packs",
    requirePermission("ouclose.prepare", {
      resolveScope: (req) => resolveScopeFromLocalClosePackInput(req.body),
    }),
    asyncHandler(async (req, res) => {
      const input = parseLocalClosePackCreateInput(req);
      const row = await createLocalClosePack({
        req,
        input,
        assertScopeAccess,
      });
      return res.status(201).json({
        ok: true,
        tenantId: input.tenantId,
        row,
      });
    })
  );

  router.get(
    "/local-close-packs/:packId/reopen-requests",
    requirePermission("ouclose.read", {
      resolveScope: (req, tenantId) =>
        resolveLocalClosePackScope(req.params?.packId, tenantId),
    }),
    asyncHandler(async (req, res) => {
      const input = parseLocalClosePackReopenRequestListInput(req);
      const result = await listLocalClosePackReopenRequests({
        req,
        tenantId: input.tenantId,
        packId: input.packId,
        requestStatus: input.requestStatus,
        assertScopeAccess,
      });
      return res.json({
        tenantId: input.tenantId,
        ...result,
      });
    })
  );

  router.post(
    "/local-close-packs/:packId/submit",
    requirePermission("ouclose.submit", {
      resolveScope: (req, tenantId) =>
        resolveLocalClosePackScope(req.params?.packId, tenantId),
    }),
    asyncHandler(async (req, res) => {
      const input = parseLocalClosePackActionInput(req);
      const result = await submitLocalClosePack({
        req,
        input,
        assertScopeAccess,
      });
      return res.json({
        ok: true,
        tenantId: input.tenantId,
        ...result,
      });
    })
  );

  router.post(
    "/local-close-packs/:packId/return",
    requirePermission("ouclose.review", {
      resolveScope: (req, tenantId) =>
        resolveLocalClosePackScope(req.params?.packId, tenantId),
    }),
    asyncHandler(async (req, res) => {
      const input = parseLocalClosePackActionInput(req, {
        requireDecisionNote: true,
      });
      const result = await returnLocalClosePack({
        req,
        input,
        assertScopeAccess,
      });
      return res.json({
        ok: true,
        tenantId: input.tenantId,
        ...result,
      });
    })
  );

  router.post(
    "/local-close-packs/:packId/approve",
    requirePermission("ouclose.approve", {
      resolveScope: (req, tenantId) =>
        resolveLocalClosePackScope(req.params?.packId, tenantId),
    }),
    asyncHandler(async (req, res) => {
      const input = parseLocalClosePackActionInput(req);
      const result = await approveLocalClosePack({
        req,
        input,
        assertScopeAccess,
      });
      return res.json({
        ok: true,
        tenantId: input.tenantId,
        ...result,
      });
    })
  );

  router.post(
    "/local-close-packs/:packId/lock",
    requirePermission("ouclose.lock", {
      resolveScope: (req, tenantId) =>
        resolveLocalClosePackScope(req.params?.packId, tenantId),
    }),
    asyncHandler(async (req, res) => {
      const input = parseLocalClosePackActionInput(req);
      const result = await lockLocalClosePack({
        req,
        input,
        assertScopeAccess,
      });
      return res.json({
        ok: true,
        tenantId: input.tenantId,
        ...result,
      });
    })
  );

  router.post(
    "/local-close-packs/:packId/reopen-requests",
    requirePermission("ouclose.request_reopen", {
      resolveScope: (req, tenantId) =>
        resolveLocalClosePackScope(req.params?.packId, tenantId),
    }),
    asyncHandler(async (req, res) => {
      const input = parseLocalClosePackReopenRequestCreateInput(req);
      const result = await createLocalClosePackReopenRequest({
        req,
        input,
        assertScopeAccess,
      });
      return res.status(201).json({
        ok: true,
        tenantId: input.tenantId,
        ...result,
      });
    })
  );

  router.post(
    "/local-close-packs/:packId/reopen-requests/:requestId/approve",
    requirePermission("ouclose.reopen", {
      resolveScope: (req, tenantId) =>
        resolveLocalClosePackScope(req.params?.packId, tenantId),
    }),
    asyncHandler(async (req, res) => {
      const input = parseLocalClosePackReopenRequestDecisionInput(req);
      const result = await approveLocalClosePackReopenRequest({
        req,
        input,
        assertScopeAccess,
      });
      return res.status(201).json({
        ok: true,
        tenantId: input.tenantId,
        ...result,
      });
    })
  );

  router.post(
    "/local-close-packs/:packId/reopen-requests/:requestId/reject",
    requirePermission("ouclose.reopen", {
      resolveScope: (req, tenantId) =>
        resolveLocalClosePackScope(req.params?.packId, tenantId),
    }),
    asyncHandler(async (req, res) => {
      const input = parseLocalClosePackReopenRequestDecisionInput(req);
      const result = await rejectLocalClosePackReopenRequest({
        req,
        input,
        assertScopeAccess,
      });
      return res.status(201).json({
        ok: true,
        tenantId: input.tenantId,
        ...result,
      });
    })
  );
}

export default {
  registerLocalClosePackRoutes,
};
