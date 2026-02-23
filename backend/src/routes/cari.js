import express from "express";
import { assertScopeAccess, requirePermission } from "../middleware/rbac.js";
import counterpartyRoutes from "./cari.counterparty.routes.js";
import paymentTermRoutes from "./cari.payment-term.routes.js";
import documentRoutes from "./cari.document.routes.js";
import {
  parseBankApplyInput,
  parseBankAttachInput,
  parseSettlementApplyInput,
  parseSettlementReverseInput,
} from "./cari.settlement.validators.js";
import {
  attachCariBankReference,
  applyCariSettlement,
  resolveCariSettlementScope,
  reverseCariSettlementById,
} from "../services/cari.settlement.service.js";
import {
  asyncHandler,
  badRequest,
  parsePositiveInt,
  resolveTenantId,
} from "./_utils.js";

const router = express.Router();

router.use("/counterparties", counterpartyRoutes);
router.use("/payment-terms", paymentTermRoutes);
router.use("/documents", documentRoutes);

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

function ok(res, payload) {
  return res.json({
    ok: true,
    scaffolded: true,
    ...payload,
  });
}

function buildSettlementApplyResponse(tenantId, result) {
  const metrics = {
    ...(result.applyAuditPayload || {}),
    ...(result.metrics || {}),
  };
  const realizedGainLossBase =
    metrics.realizedFxNetBase === undefined || metrics.realizedFxNetBase === null
      ? null
      : Number(metrics.realizedFxNetBase);
  const unappliedConsumed = Array.isArray(metrics.unappliedConsumed)
    ? metrics.unappliedConsumed
    : [];

  return {
    tenantId,
    row: result.row,
    allocations: Array.isArray(result.allocations) ? result.allocations : [],
    journal: result.journal || null,
    fx: {
      settlementFxRate:
        metrics.settlementFxRate === undefined || metrics.settlementFxRate === null
          ? null
          : Number(metrics.settlementFxRate),
      settlementFxSource: metrics.settlementFxSource || null,
      fxRateDate: metrics.fxRateDate || null,
      realizedGainLossBase,
    },
    unapplied: {
      createdUnappliedCashId: parsePositiveInt(metrics.createdUnappliedCashId) || null,
      consumed: unappliedConsumed.map((entry) => ({
        unappliedCashId: parsePositiveInt(entry?.unappliedCashId) || null,
        consumeTxn:
          entry?.consumeTxn === undefined || entry?.consumeTxn === null
            ? null
            : Number(entry.consumeTxn),
        consumeBase:
          entry?.consumeBase === undefined || entry?.consumeBase === null
            ? null
            : Number(entry.consumeBase),
      })),
      rows: Array.isArray(result.unappliedCash) ? result.unappliedCash : [],
    },
    unappliedCash: Array.isArray(result.unappliedCash) ? result.unappliedCash : [],
    metrics: result.metrics || null,
    idempotentReplay: Boolean(result.idempotentReplay),
    followUpRisks: Array.isArray(result.followUpRisks) ? result.followUpRisks : [],
  };
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

router.post(
  "/settlements/apply",
  requirePermission("cari.settlement.apply", {
    resolveScope: async (req) => resolveCariScope(req),
  }),
  asyncHandler(async (req, res) => {
    const payload = parseSettlementApplyInput(req);
    const result = await applyCariSettlement({
      req,
      payload,
      assertScopeAccess,
    });

    return res
      .status(result.idempotentReplay ? 200 : 201)
      .json(buildSettlementApplyResponse(payload.tenantId, result));
  })
);

router.post(
  "/settlements/:settlementBatchId/reverse",
  requirePermission("cari.settlement.reverse", {
    resolveScope: async (req, tenantId) => {
      return resolveCariSettlementScope(req.params?.settlementBatchId, tenantId);
    },
  }),
  asyncHandler(async (req, res) => {
    const payload = parseSettlementReverseInput(req);
    const result = await reverseCariSettlementById({
      req,
      payload,
      assertScopeAccess,
    });

    return res.status(201).json({
      tenantId: payload.tenantId,
      row: result.row,
      original: result.original,
      journal: result.journal,
      followUpRisks: result.followUpRisks || [],
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
    const payload = parseBankAttachInput(req);
    const result = await attachCariBankReference({
      req,
      payload,
      assertScopeAccess,
    });

    return res.status(result.idempotentReplay ? 200 : 201).json({
      tenantId: payload.tenantId,
      targetType: result.targetType,
      settlement: result.settlement,
      unappliedCash: result.unappliedCash,
      idempotentReplay: result.idempotentReplay,
    });
  })
);

router.post(
  "/bank/apply",
  requirePermission("cari.bank.apply", {
    resolveScope: (req) => resolveCariScope(req),
  }),
  asyncHandler(async (req, res) => {
    const payload = parseBankApplyInput(req);
    const result = await applyCariSettlement({
      req,
      payload,
      assertScopeAccess,
    });

    return res
      .status(result.idempotentReplay ? 200 : 201)
      .json(buildSettlementApplyResponse(payload.tenantId, result));
  })
);

export default router;
