import express from "express";
import { asyncHandler, parsePositiveInt } from "./_utils.js";
import { requirePermission, assertScopeAccess, buildScopeFilter } from "../middleware/rbac.js";
import {
  parseContractCreateInput,
  parseContractIdParam,
  parseContractLifecycleInput,
  parseContractLinkDocumentInput,
  parseContractListFilters,
  parseContractUpdateInput,
} from "./contracts.validators.js";
import {
  activateContractById,
  cancelContractById,
  closeContractById,
  createContract,
  getContractByIdForTenant,
  linkDocumentToContract,
  listContractDocumentLinks,
  listContracts,
  resolveContractScope,
  suspendContractById,
  updateContractById,
} from "../services/contracts.service.js";

const router = express.Router();

function resolveLegalEntityScopeFromQuery(req) {
  const legalEntityId = parsePositiveInt(req.query?.legalEntityId);
  if (!legalEntityId) {
    return null;
  }
  return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
}

function resolveLegalEntityScopeFromBody(req) {
  const legalEntityId = parsePositiveInt(req.body?.legalEntityId);
  if (!legalEntityId) {
    return null;
  }
  return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
}

router.get(
  "/",
  requirePermission("contract.read", {
    resolveScope: async (req) => resolveLegalEntityScopeFromQuery(req),
  }),
  asyncHandler(async (req, res) => {
    const filters = parseContractListFilters(req);
    const result = await listContracts({
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
  "/:contractId",
  requirePermission("contract.read", {
    resolveScope: async (req, tenantId) => {
      return resolveContractScope(req.params?.contractId, tenantId);
    },
  }),
  asyncHandler(async (req, res) => {
    const filters = parseContractListFilters(req);
    const contractId = parseContractIdParam(req);
    const row = await getContractByIdForTenant({
      req,
      tenantId: filters.tenantId,
      contractId,
      assertScopeAccess,
    });

    return res.json({
      tenantId: filters.tenantId,
      row,
    });
  })
);

router.post(
  "/",
  requirePermission("contract.upsert", {
    resolveScope: async (req) => resolveLegalEntityScopeFromBody(req),
  }),
  asyncHandler(async (req, res) => {
    const payload = parseContractCreateInput(req);
    const row = await createContract({
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
  "/:contractId",
  requirePermission("contract.upsert", {
    resolveScope: async (req, tenantId) => {
      const scope = await resolveContractScope(req.params?.contractId, tenantId);
      if (scope) {
        return scope;
      }
      return resolveLegalEntityScopeFromBody(req);
    },
  }),
  asyncHandler(async (req, res) => {
    const payload = parseContractUpdateInput(req);
    const row = await updateContractById({
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

router.post(
  "/:contractId/activate",
  requirePermission("contract.activate", {
    resolveScope: async (req, tenantId) => {
      return resolveContractScope(req.params?.contractId, tenantId);
    },
  }),
  asyncHandler(async (req, res) => {
    const payload = parseContractLifecycleInput(req);
    const row = await activateContractById({
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

router.post(
  "/:contractId/suspend",
  requirePermission("contract.suspend", {
    resolveScope: async (req, tenantId) => {
      return resolveContractScope(req.params?.contractId, tenantId);
    },
  }),
  asyncHandler(async (req, res) => {
    const payload = parseContractLifecycleInput(req);
    const row = await suspendContractById({
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

router.post(
  "/:contractId/close",
  requirePermission("contract.close", {
    resolveScope: async (req, tenantId) => {
      return resolveContractScope(req.params?.contractId, tenantId);
    },
  }),
  asyncHandler(async (req, res) => {
    const payload = parseContractLifecycleInput(req);
    const row = await closeContractById({
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

router.post(
  "/:contractId/cancel",
  requirePermission("contract.cancel", {
    resolveScope: async (req, tenantId) => {
      return resolveContractScope(req.params?.contractId, tenantId);
    },
  }),
  asyncHandler(async (req, res) => {
    const payload = parseContractLifecycleInput(req);
    const row = await cancelContractById({
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

router.post(
  "/:contractId/link-document",
  requirePermission("contract.link_document", {
    resolveScope: async (req, tenantId) => {
      return resolveContractScope(req.params?.contractId, tenantId);
    },
  }),
  asyncHandler(async (req, res) => {
    const payload = parseContractLinkDocumentInput(req);
    const row = await linkDocumentToContract({
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

router.get(
  "/:contractId/documents",
  requirePermission("contract.read", {
    resolveScope: async (req, tenantId) => {
      return resolveContractScope(req.params?.contractId, tenantId);
    },
  }),
  asyncHandler(async (req, res) => {
    const filters = parseContractListFilters(req);
    const contractId = parseContractIdParam(req);
    const rows = await listContractDocumentLinks({
      req,
      tenantId: filters.tenantId,
      contractId,
      assertScopeAccess,
    });
    return res.json({
      tenantId: filters.tenantId,
      contractId,
      rows,
    });
  })
);

export default router;
