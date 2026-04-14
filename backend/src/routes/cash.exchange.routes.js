import express from "express";
import { assertScopeAccess, buildScopeFilter, requirePermission } from "../middleware/rbac.js";
import { asyncHandler, parsePositiveInt } from "./_utils.js";
import { requireTenantId } from "./cash.validators.common.js";
import { resolveCashRegisterScope } from "../services/cash.register.service.js";
import {
  createCashExchangeBatch,
  getCashExchangeBatchByIdForTenant,
  listCashExchangeBatchRows,
  postCashExchangeBatchById,
  reverseCashExchangeBatchById,
} from "../services/cash.exchange.service.js";
import {
  parseCashExchangeBatchIdParam,
  parseCashExchangeCreateInput,
  parseCashExchangePostInput,
  parseCashExchangeReadFilters,
  parseCashExchangeReverseInput,
} from "./cash.exchange.validators.js";

const router = express.Router();

function buildCashExchangeResponse(tenantId, result) {
  return {
    tenantId,
    batch: result.batch || null,
    exchangeOutTransaction: result.exchangeOutTransaction || null,
    exchangeInTransaction: result.exchangeInTransaction || null,
    feeTransaction: result.feeTransaction || null,
    reversalOutTransaction: result.reversalOutTransaction || null,
    reversalInTransaction: result.reversalInTransaction || null,
    reversalFeeTransaction: result.reversalFeeTransaction || null,
    fxLot: result.fxLot || null,
    idempotentReplay: Boolean(result.idempotentReplay),
  };
}

router.get(
  "/",
  requirePermission("cash.txn.read", {
    resolveScope: async (req, tenantId) => {
      const sourceRegisterId = parsePositiveInt(req.query?.sourceRegisterId);
      if (sourceRegisterId) {
        return resolveCashRegisterScope(sourceRegisterId, tenantId);
      }

      const targetRegisterId = parsePositiveInt(req.query?.targetRegisterId);
      if (targetRegisterId) {
        return resolveCashRegisterScope(targetRegisterId, tenantId);
      }

      const legalEntityId = parsePositiveInt(req.query?.legalEntityId);
      if (legalEntityId) {
        return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
      }

      return null;
    },
  }),
  asyncHandler(async (req, res) => {
    const filters = parseCashExchangeReadFilters(req);
    const result = await listCashExchangeBatchRows({
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
  "/:exchangeBatchId",
  requirePermission("cash.txn.read"),
  asyncHandler(async (req, res) => {
    const tenantId = requireTenantId(req);
    const exchangeBatchId = parseCashExchangeBatchIdParam(req);
    const result = await getCashExchangeBatchByIdForTenant({
      req,
      tenantId,
      exchangeBatchId,
      assertScopeAccess,
    });
    return res.json(buildCashExchangeResponse(tenantId, result));
  })
);

router.post(
  "/",
  requirePermission("cash.txn.create", {
    resolveScope: async (req, tenantId) => {
      return resolveCashRegisterScope(req.body?.sourceRegisterId, tenantId);
    },
  }),
  asyncHandler(async (req, res) => {
    const payload = parseCashExchangeCreateInput(req);
    const result = await createCashExchangeBatch({
      req,
      payload,
      assertScopeAccess,
    });
    return res
      .status(result.idempotentReplay ? 200 : 201)
      .json(buildCashExchangeResponse(payload.tenantId, result));
  })
);

router.post(
  "/:exchangeBatchId/post",
  requirePermission("cash.txn.create"),
  asyncHandler(async (req, res) => {
    const payload = parseCashExchangePostInput(req);
    const result = await postCashExchangeBatchById({
      req,
      payload,
      assertScopeAccess,
    });
    return res.json(buildCashExchangeResponse(payload.tenantId, result));
  })
);

router.post(
  "/:exchangeBatchId/reverse",
  requirePermission("cash.txn.reverse"),
  asyncHandler(async (req, res) => {
    const payload = parseCashExchangeReverseInput(req);
    const result = await reverseCashExchangeBatchById({
      req,
      payload,
      assertScopeAccess,
    });
    return res.json(buildCashExchangeResponse(payload.tenantId, result));
  })
);

export default router;
