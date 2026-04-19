import express from "express";
import { requireAnyPermission, requirePermission } from "../middleware/rbac.js";
import {
  createCycle,
  getCycleBlockers,
  getCycleCockpit,
  getCycleById,
  getCycleReadiness,
  getCycleWorklist,
  lockCycle,
  listCockpitCycles,
  listManagerCycles,
  listCycles,
  provisionCycle,
  resolveCloseCycleRouteScope,
} from "../services/close.cycles.service.js";
import {
  listCloseCycleCreateFiscalPeriods,
  listCloseCycleScopeOptions,
} from "../services/close.cycle-lookups.service.js";
import { assertConsolidationGroupBelongsToTenant } from "../tenantGuards.js";
import { asyncHandler, badRequest, parsePositiveInt, resolveTenantId } from "./_utils.js";

const router = express.Router();

function parseBooleanLike(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "n", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

async function resolveCreateCycleScope(req, tenantId) {
  const legalEntityId = parsePositiveInt(req.body?.legalEntityId);
  if (legalEntityId) {
    return {
      scopeType: "LEGAL_ENTITY",
      scopeId: legalEntityId,
    };
  }

  const consolidationGroupId = parsePositiveInt(req.body?.consolidationGroupId);
  if (consolidationGroupId) {
    const group = await assertConsolidationGroupBelongsToTenant(
      tenantId,
      consolidationGroupId,
      "consolidationGroupId"
    );
    return {
      scopeType: "GROUP",
      scopeId: parsePositiveInt(group.group_company_id),
    };
  }

  return { scopeType: "TENANT", scopeId: tenantId };
}

router.post(
  "/cycles",
  requirePermission("close.cycle.write", {
    resolveScope: resolveCreateCycleScope,
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    const userId = parsePositiveInt(req.user?.userId);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }
    if (!userId) {
      throw badRequest("Authenticated user is required");
    }

    const row = await createCycle(
      {
        cycleType: req.body?.cycleType,
        fiscalPeriodId: req.body?.fiscalPeriodId,
        legalEntityId: req.body?.legalEntityId,
        consolidationGroupId: req.body?.consolidationGroupId,
        ownerUserId: req.body?.ownerUserId,
        startsAt: req.body?.startsAt,
        dueAt: req.body?.dueAt,
      },
      {
        tenantId,
        userId,
        req,
      }
    );

    return res.status(201).json({
      ok: true,
      tenantId,
      row,
    });
  })
);

router.get(
  "/cockpit/cycles",
  requirePermission("close.cockpit.read"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const result = await listCockpitCycles(
      {
        cycleType: req.query?.cycleType,
        scopeKind: req.query?.scopeKind,
        fiscalPeriodId: req.query?.fiscalPeriodId,
        status: req.query?.status,
        legalEntityId: req.query?.legalEntityId,
        consolidationGroupId: req.query?.consolidationGroupId,
      },
      {
        tenantId,
        req,
      },
    );

    return res.json({
      tenantId,
      ...result,
    });
  }),
);

router.get(
  "/manager/cycles",
  requireAnyPermission([
    "close.cycle.read",
    "close.cycle.provision",
    "close.cycle.lock",
  ]),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const result = await listManagerCycles(
      {
        cycleType: req.query?.cycleType,
        scopeKind: req.query?.scopeKind,
        fiscalPeriodId: req.query?.fiscalPeriodId,
        status: req.query?.status,
        legalEntityId: req.query?.legalEntityId,
        consolidationGroupId: req.query?.consolidationGroupId,
      },
      {
        tenantId,
        req,
      },
    );

    return res.json({
      tenantId,
      ...result,
    });
  }),
);

router.get(
  "/lookups/cycle-scope-options",
  requirePermission("close.cycle.write"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const result = await listCloseCycleScopeOptions({
      tenantId,
      req,
    });

    return res.json({
      tenantId,
      ...result,
    });
  }),
);

router.get(
  "/lookups/fiscal-periods",
  requirePermission("close.cycle.write"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const result = await listCloseCycleCreateFiscalPeriods(
      {
        scopeKind: req.query?.scopeKind,
        legalEntityId: req.query?.legalEntityId,
        consolidationGroupId: req.query?.consolidationGroupId,
      },
      {
        tenantId,
        req,
      },
    );

    return res.json({
      tenantId,
      ...result,
    });
  }),
);

router.get(
  "/cycles",
  requirePermission("close.cycle.read"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const result = await listCycles(
      {
        cycleType: req.query?.cycleType,
        scopeKind: req.query?.scopeKind,
        fiscalPeriodId: req.query?.fiscalPeriodId,
        status: req.query?.status,
        legalEntityId: req.query?.legalEntityId,
        consolidationGroupId: req.query?.consolidationGroupId,
      },
      {
        tenantId,
        req,
      }
    );

    return res.json({
      tenantId,
      ...result,
    });
  })
);

router.get(
  "/cycles/:id",
  requirePermission("close.cycle.read", {
    resolveScope: async (req, tenantId) =>
      resolveCloseCycleRouteScope(req.params?.id, tenantId),
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const cycleId = parsePositiveInt(req.params?.id);
    if (!cycleId) {
      throw badRequest("id must be a positive integer");
    }

    const result = await getCycleById(
      cycleId,
      {
        tenantId,
        req,
      },
      {
        includeItems: parseBooleanLike(req.query?.includeItems, true),
      }
    );

    return res.json({
      tenantId,
      ...result,
    });
  })
);

router.get(
  "/cycles/:id/cockpit",
  requirePermission("close.cockpit.read", {
    resolveScope: async (req, tenantId) =>
      resolveCloseCycleRouteScope(req.params?.id, tenantId),
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    const userId = parsePositiveInt(req.user?.userId);
    const cycleId = parsePositiveInt(req.params?.id);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }
    if (!userId) {
      throw badRequest("Authenticated user is required");
    }
    if (!cycleId) {
      throw badRequest("id must be a positive integer");
    }

    const result = await getCycleCockpit(cycleId, {
      tenantId,
      userId,
      req,
    });

    return res.json({
      tenantId,
      cycleId,
      ...result,
    });
  })
);

router.get(
  "/cycles/:id/worklist",
  requirePermission("close.cockpit.read", {
    resolveScope: async (req, tenantId) =>
      resolveCloseCycleRouteScope(req.params?.id, tenantId),
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    const userId = parsePositiveInt(req.user?.userId);
    const cycleId = parsePositiveInt(req.params?.id);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }
    if (!userId) {
      throw badRequest("Authenticated user is required");
    }
    if (!cycleId) {
      throw badRequest("id must be a positive integer");
    }

    const result = await getCycleWorklist(cycleId, {
      tenantId,
      userId,
      req,
    });

    return res.json({
      tenantId,
      cycleId,
      ...result,
    });
  })
);

router.get(
  "/cycles/:id/blockers",
  requirePermission("close.cockpit.read", {
    resolveScope: async (req, tenantId) =>
      resolveCloseCycleRouteScope(req.params?.id, tenantId),
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    const userId = parsePositiveInt(req.user?.userId);
    const cycleId = parsePositiveInt(req.params?.id);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }
    if (!userId) {
      throw badRequest("Authenticated user is required");
    }
    if (!cycleId) {
      throw badRequest("id must be a positive integer");
    }

    const result = await getCycleBlockers(cycleId, {
      tenantId,
      userId,
      req,
    });

    return res.json({
      tenantId,
      cycleId,
      ...result,
    });
  })
);

router.get(
  "/cycles/:id/readiness",
  requirePermission("close.cockpit.read", {
    resolveScope: async (req, tenantId) =>
      resolveCloseCycleRouteScope(req.params?.id, tenantId),
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    const userId = parsePositiveInt(req.user?.userId);
    const cycleId = parsePositiveInt(req.params?.id);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }
    if (!userId) {
      throw badRequest("Authenticated user is required");
    }
    if (!cycleId) {
      throw badRequest("id must be a positive integer");
    }

    const result = await getCycleReadiness(cycleId, {
      tenantId,
      userId,
      req,
    });

    return res.json({
      tenantId,
      cycleId,
      ...result,
    });
  })
);

router.post(
  "/cycles/:id/provision",
  requirePermission("close.cycle.provision", {
    resolveScope: async (req, tenantId) =>
      resolveCloseCycleRouteScope(req.params?.id, tenantId),
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    const userId = parsePositiveInt(req.user?.userId);
    const cycleId = parsePositiveInt(req.params?.id);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }
    if (!userId) {
      throw badRequest("Authenticated user is required");
    }
    if (!cycleId) {
      throw badRequest("id must be a positive integer");
    }

    const result = await provisionCycle(cycleId, {
      tenantId,
      userId,
      req,
    });

    return res.status(200).json({
      ok: true,
      tenantId,
      cycleId,
      ...result,
    });
  })
);

router.post(
  "/cycles/:id/lock",
  requirePermission("close.cycle.lock", {
    resolveScope: async (req, tenantId) =>
      resolveCloseCycleRouteScope(req.params?.id, tenantId),
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    const userId = parsePositiveInt(req.user?.userId);
    const cycleId = parsePositiveInt(req.params?.id);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }
    if (!userId) {
      throw badRequest("Authenticated user is required");
    }
    if (!cycleId) {
      throw badRequest("id must be a positive integer");
    }

    const result = await lockCycle(cycleId, {
      tenantId,
      userId,
      req,
    });

    return res.status(200).json({
      ok: true,
      tenantId,
      cycleId,
      ...result,
    });
  })
);

export default router;
