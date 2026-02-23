import express from "express";
import { requirePermission } from "../middleware/rbac.js";
import counterpartyRoutes from "./cari.counterparty.routes.js";
import {
  asyncHandler,
  badRequest,
  parsePositiveInt,
  resolveTenantId,
} from "./_utils.js";

const router = express.Router();

router.use("/counterparties", counterpartyRoutes);

function requireTenant(req) {
  const tenantId = resolveTenantId(req);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  return tenantId;
}

function resolveCariScope(req) {
  const legalEntityId =
    parsePositiveInt(req.body?.legalEntityId) ||
    parsePositiveInt(req.query?.legalEntityId);
  if (legalEntityId) {
    return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
  }
  return null;
}

function parsePathId(value, fieldName) {
  const parsed = parsePositiveInt(value);
  if (!parsed) {
    throw badRequest(`${fieldName} must be a positive integer`);
  }
  return parsed;
}

function ok(res, payload) {
  return res.json({
    ok: true,
    scaffolded: true,
    ...payload,
  });
}

router.get(
  "/cards",
  requirePermission("cari.card.read", {
    resolveScope: (req) => resolveCariScope(req),
  }),
  asyncHandler(async (req, res) => {
    const tenantId = requireTenant(req);
    return ok(res, {
      tenantId,
      rows: [],
    });
  })
);

router.post(
  "/cards",
  requirePermission("cari.card.upsert", {
    resolveScope: (req) => resolveCariScope(req),
  }),
  asyncHandler(async (req, res) => {
    const tenantId = requireTenant(req);
    return ok(res, {
      tenantId,
      message: "Cari card upsert endpoint is guard-ready for PR-03+",
    });
  })
);

router.get(
  "/documents",
  requirePermission("cari.doc.read", {
    resolveScope: (req) => resolveCariScope(req),
  }),
  asyncHandler(async (req, res) => {
    const tenantId = requireTenant(req);
    return ok(res, {
      tenantId,
      rows: [],
    });
  })
);

router.post(
  "/documents",
  requirePermission("cari.doc.create", {
    resolveScope: (req) => resolveCariScope(req),
  }),
  asyncHandler(async (req, res) => {
    const tenantId = requireTenant(req);
    return ok(res, {
      tenantId,
      message: "Cari document create endpoint is guard-ready for PR-03+",
    });
  })
);

router.put(
  "/documents/:documentId",
  requirePermission("cari.doc.update", {
    resolveScope: (req) => resolveCariScope(req),
  }),
  asyncHandler(async (req, res) => {
    const tenantId = requireTenant(req);
    const documentId = parsePathId(req.params.documentId, "documentId");
    return ok(res, {
      tenantId,
      documentId,
      message: "Cari document update endpoint is guard-ready for PR-03+",
    });
  })
);

router.post(
  "/documents/:documentId/post",
  requirePermission("cari.doc.post", {
    resolveScope: (req) => resolveCariScope(req),
  }),
  asyncHandler(async (req, res) => {
    const tenantId = requireTenant(req);
    const documentId = parsePathId(req.params.documentId, "documentId");
    return ok(res, {
      tenantId,
      documentId,
      message: "Cari document post endpoint is guard-ready for PR-03+",
    });
  })
);

router.post(
  "/documents/:documentId/reverse",
  requirePermission("cari.doc.reverse", {
    resolveScope: (req) => resolveCariScope(req),
  }),
  asyncHandler(async (req, res) => {
    const tenantId = requireTenant(req);
    const documentId = parsePathId(req.params.documentId, "documentId");
    return ok(res, {
      tenantId,
      documentId,
      message: "Cari document reverse endpoint is guard-ready for PR-03+",
    });
  })
);

router.post(
  "/settlements/apply",
  requirePermission("cari.settlement.apply", {
    resolveScope: (req) => resolveCariScope(req),
  }),
  asyncHandler(async (req, res) => {
    const tenantId = requireTenant(req);
    return ok(res, {
      tenantId,
      message: "Cari settlement apply endpoint is guard-ready for PR-03+",
    });
  })
);

router.post(
  "/settlements/:settlementBatchId/reverse",
  requirePermission("cari.settlement.reverse", {
    resolveScope: (req) => resolveCariScope(req),
  }),
  asyncHandler(async (req, res) => {
    const tenantId = requireTenant(req);
    const settlementBatchId = parsePathId(
      req.params.settlementBatchId,
      "settlementBatchId"
    );
    return ok(res, {
      tenantId,
      settlementBatchId,
      message: "Cari settlement reverse endpoint is guard-ready for PR-03+",
    });
  })
);

router.get(
  "/reports/aging",
  requirePermission("cari.report.read", {
    resolveScope: (req) => resolveCariScope(req),
  }),
  asyncHandler(async (req, res) => {
    const tenantId = requireTenant(req);
    return ok(res, {
      tenantId,
      rows: [],
    });
  })
);

router.post(
  "/fx/override",
  requirePermission("cari.fx.override", {
    resolveScope: (req) => resolveCariScope(req),
  }),
  asyncHandler(async (req, res) => {
    const tenantId = requireTenant(req);
    return ok(res, {
      tenantId,
      message: "Cari FX override endpoint is guard-ready for PR-03+",
    });
  })
);

router.get(
  "/audit",
  requirePermission("cari.audit.read", {
    resolveScope: (req) => resolveCariScope(req),
  }),
  asyncHandler(async (req, res) => {
    const tenantId = requireTenant(req);
    return ok(res, {
      tenantId,
      rows: [],
    });
  })
);

router.post(
  "/bank/attach",
  requirePermission("cari.bank.attach", {
    resolveScope: (req) => resolveCariScope(req),
  }),
  asyncHandler(async (req, res) => {
    const tenantId = requireTenant(req);
    return ok(res, {
      tenantId,
      message: "Cari bank attach endpoint is guard-ready for PR-03+",
    });
  })
);

router.post(
  "/bank/apply",
  requirePermission("cari.bank.apply", {
    resolveScope: (req) => resolveCariScope(req),
  }),
  asyncHandler(async (req, res) => {
    const tenantId = requireTenant(req);
    return ok(res, {
      tenantId,
      message: "Cari bank apply endpoint is guard-ready for PR-03+",
    });
  })
);

export default router;
