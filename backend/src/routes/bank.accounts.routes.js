import express from "express";
import { assertScopeAccess, buildScopeFilter, requirePermission } from "../middleware/rbac.js";
import { asyncHandler, parseIdempotencyKey, parsePositiveInt } from "./_utils.js";
import { requireTenantId } from "./cash.validators.common.js";
import {
  parseBankAccountCreateInput,
  parseBankAccountIdParam,
  parseBankAccountProvisionInput,
  parseBankAccountReadFilters,
  parseBankAccountStatusActionInput,
  parseBankAccountUpdateInput,
} from "./bank.accounts.validators.js";
import {
  createBankAccount,
  getBankAccountByIdForTenant,
  listBankAccountRows,
  provisionBankAccountWith102Child,
  resolveBankAccountScope,
  setBankAccountActive,
  updateBankAccountById,
} from "../services/bank.accounts.service.js";
import { executeIdempotentRequest } from "../services/idempotency.service.js";

const router = express.Router();

router.get(
  "/",
  requirePermission("bank.accounts.read", {
    resolveScope: async (req) => {
      const legalEntityId = parsePositiveInt(req.query?.legalEntityId);
      if (legalEntityId) {
        return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
      }
      return null;
    },
  }),
  asyncHandler(async (req, res) => {
    const filters = parseBankAccountReadFilters(req);
    const result = await listBankAccountRows({
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
  "/:bankAccountId",
  requirePermission("bank.accounts.read", {
    resolveScope: async (req, tenantId) => {
      return resolveBankAccountScope(req.params?.bankAccountId, tenantId);
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = requireTenantId(req);
    const bankAccountId = parseBankAccountIdParam(req);
    const row = await getBankAccountByIdForTenant({
      req,
      tenantId,
      bankAccountId,
      assertScopeAccess,
    });
    return res.json({
      tenantId,
      row,
    });
  })
);

router.post(
  "/",
  requirePermission("bank.accounts.write", {
    resolveScope: async (req) => {
      const legalEntityId = parsePositiveInt(req.body?.legalEntityId);
      if (legalEntityId) {
        return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
      }
      return null;
    },
  }),
  asyncHandler(async (req, res) => {
    const payload = parseBankAccountCreateInput(req);
    const row = await createBankAccount({
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

router.post(
  "/provision-102-child",
  requirePermission("bank.accounts.write", {
    resolveScope: async (req) => {
      const legalEntityId = parsePositiveInt(req.body?.legalEntityId);
      if (legalEntityId) {
        return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
      }
      return null;
    },
  }),
  asyncHandler(async (req, res) => {
    const payload = parseBankAccountProvisionInput(req);
    const idempotencyKey = parseIdempotencyKey(req, { required: false });
    const result = await executeIdempotentRequest({
      scopeCode: `BANK_PROVISION_102_T${payload.tenantId}_LE${payload.legalEntityId}`,
      idempotencyKey,
      requestFingerprintInput: {
        tenantId: payload.tenantId,
        legalEntityId: payload.legalEntityId,
        operatingUnitId: payload.operatingUnitId || null,
        code: payload.code,
        name: payload.name,
        currencyCode: payload.currencyCode,
        bankName: payload.bankName || null,
        branchName: payload.branchName || null,
        iban: payload.iban || null,
        accountNo: payload.accountNo || null,
        isActive: Boolean(payload.isActive),
        glAccountName: payload.glAccountName || null,
      },
      execute: async () => {
        const provisioned = await provisionBankAccountWith102Child({
          req,
          payload,
          assertScopeAccess,
        });
        return {
          status: 201,
          payload: {
            tenantId: payload.tenantId,
            row: provisioned.row,
            glAccount: provisioned.glAccount,
          },
        };
      },
    });

    return res.status(result.status).json({
      ...result.payload,
      idempotentReplay: Boolean(result.idempotentReplay),
    });
  })
);

router.put(
  "/:bankAccountId",
  requirePermission("bank.accounts.write", {
    resolveScope: async (req, tenantId) => {
      const scope = await resolveBankAccountScope(req.params?.bankAccountId, tenantId);
      if (scope) {
        return scope;
      }
      const legalEntityId = parsePositiveInt(req.body?.legalEntityId);
      if (legalEntityId) {
        return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
      }
      return null;
    },
  }),
  asyncHandler(async (req, res) => {
    const payload = parseBankAccountUpdateInput(req);
    const row = await updateBankAccountById({
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
  "/:bankAccountId/activate",
  requirePermission("bank.accounts.write", {
    resolveScope: async (req, tenantId) => {
      return resolveBankAccountScope(req.params?.bankAccountId, tenantId);
    },
  }),
  asyncHandler(async (req, res) => {
    const payload = parseBankAccountStatusActionInput(req);
    const row = await setBankAccountActive({
      req,
      tenantId: payload.tenantId,
      bankAccountId: payload.bankAccountId,
      isActive: true,
      assertScopeAccess,
    });
    return res.json({
      tenantId: payload.tenantId,
      row,
    });
  })
);

router.post(
  "/:bankAccountId/deactivate",
  requirePermission("bank.accounts.write", {
    resolveScope: async (req, tenantId) => {
      return resolveBankAccountScope(req.params?.bankAccountId, tenantId);
    },
  }),
  asyncHandler(async (req, res) => {
    const payload = parseBankAccountStatusActionInput(req);
    const row = await setBankAccountActive({
      req,
      tenantId: payload.tenantId,
      bankAccountId: payload.bankAccountId,
      isActive: false,
      assertScopeAccess,
    });
    return res.json({
      tenantId: payload.tenantId,
      row,
    });
  })
);

export default router;
