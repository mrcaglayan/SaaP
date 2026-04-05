import express from "express";
import {
  assertScopeAccess,
  requireAnyPermission,
  requirePermission,
} from "../middleware/rbac.js";
import { asyncHandler } from "./_utils.js";
import {
  parsePaymentTermCreateInput,
  parsePaymentTermIdParam,
  parsePaymentTermReadFilters,
} from "./cari.payment-term.validators.js";
import { requireTenantId } from "./cash.validators.common.js";
import {
  createPaymentTerm,
  getPaymentTermByIdForTenant,
  listPaymentTerms,
} from "../services/cari.payment-term.service.js";

const router = express.Router();
const PAYMENT_TERM_READ_PERMISSION_CODES = Object.freeze([
  "cari.card.read",
  "cari.card.request",
  "cari.card.upsert",
]);

router.get(
  "/",
  requireAnyPermission(PAYMENT_TERM_READ_PERMISSION_CODES),
  asyncHandler(async (req, res) => {
    const filters = parsePaymentTermReadFilters(req);
    const result = await listPaymentTerms({
      req,
      tenantId: filters.tenantId,
      filters,
    });
    return res.json({
      tenantId: filters.tenantId,
      ...result,
    });
  })
);

router.post(
  "/",
  requirePermission("cari.card.upsert", {
    resolveScope: async (req) => {
      const legalEntityId = parsePositiveInt(req.body?.legalEntityId);
      if (legalEntityId) {
        return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
      }
      return null;
    },
  }),
  asyncHandler(async (req, res) => {
    const payload = parsePaymentTermCreateInput(req);
    const row = await createPaymentTerm({
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
  "/:paymentTermId",
  requireAnyPermission(PAYMENT_TERM_READ_PERMISSION_CODES),
  asyncHandler(async (req, res) => {
    const tenantId = requireTenantId(req);
    const paymentTermId = parsePaymentTermIdParam(req);
    const row = await getPaymentTermByIdForTenant({
      req,
      tenantId,
      paymentTermId,
    });
    return res.json({
      tenantId,
      row,
    });
  })
);

export default router;
