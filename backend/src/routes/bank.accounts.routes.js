import express from "express";
import { assertScopeAccess, buildScopeFilter, requirePermission } from "../middleware/rbac.js";
import { applyFieldVisibility } from "../middleware/fieldVisibility.js";
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
  provisionBankAccountWithControlParentChild,
  resolveBankAccountScope,
  setBankAccountActive,
  updateBankAccountById,
} from "../services/bank.accounts.service.js";
import { executeIdempotentRequest } from "../services/idempotency.service.js";

const router = express.Router();
const bankAccountFieldVisibility = applyFieldVisibility("BANK", "bank_account");

function resolveProvisionBankAccountScope(req) {
  const legalEntityId = parsePositiveInt(req.body?.legalEntityId);
  if (legalEntityId) {
    return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
  }
  return null;
}

async function handleProvisionControlParentChild(req, res) {
  const payload = parseBankAccountProvisionInput(req);
  const idempotencyKey = parseIdempotencyKey(req, { required: false });
  const result = await executeIdempotentRequest({
    scopeCode: `BANK_PROVISION_CONTROL_PARENT_CHILD_T${payload.tenantId}_LE${payload.legalEntityId}`,
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
      const provisioned = await provisionBankAccountWithControlParentChild({
        req,
        payload,
        assertScopeAccess,
      });
      const maskedRow = await req.fieldVisibility.applyToRow(provisioned.row);
      return {
        status: 201,
        payload: {
          tenantId: payload.tenantId,
          row: maskedRow,
          glAccount: provisioned.glAccount,
        },
      };
    },
  });

  return res.status(result.status).json({
    ...result.payload,
    idempotentReplay: Boolean(result.idempotentReplay),
  });
}

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
  bankAccountFieldVisibility,
  asyncHandler(async (req, res) => {
    const filters = parseBankAccountReadFilters(req);
    const result = await listBankAccountRows({
      req,
      tenantId: filters.tenantId,
      filters,
      buildScopeFilter,
      assertScopeAccess,
    });
    const rows = await req.fieldVisibility.applyToRows(result.rows);
    return res.json({
      tenantId: filters.tenantId,
      ...result,
      rows,
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
  bankAccountFieldVisibility,
  asyncHandler(async (req, res) => {
    const tenantId = requireTenantId(req);
    const bankAccountId = parseBankAccountIdParam(req);
    const row = await getBankAccountByIdForTenant({
      req,
      tenantId,
      bankAccountId,
      assertScopeAccess,
    });
    const maskedRow = await req.fieldVisibility.applyToRow(row);
    return res.json({
      tenantId,
      row: maskedRow,
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
  bankAccountFieldVisibility,
  asyncHandler(async (req, res) => {
    const payload = parseBankAccountCreateInput(req);
    const row = await createBankAccount({
      req,
      payload,
      assertScopeAccess,
    });
    const maskedRow = await req.fieldVisibility.applyToRow(row);
    return res.status(201).json({
      tenantId: payload.tenantId,
      row: maskedRow,
    });
  })
);

router.post(
  "/provision-control-parent-child",
  requirePermission("bank.accounts.write", {
    resolveScope: resolveProvisionBankAccountScope,
  }),
  bankAccountFieldVisibility,
  asyncHandler(handleProvisionControlParentChild)
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
  bankAccountFieldVisibility,
  asyncHandler(async (req, res) => {
    const payload = parseBankAccountUpdateInput(req);
    const row = await updateBankAccountById({
      req,
      payload,
      assertScopeAccess,
    });
    const maskedRow = await req.fieldVisibility.applyToRow(row);
    return res.json({
      tenantId: payload.tenantId,
      row: maskedRow,
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
  bankAccountFieldVisibility,
  asyncHandler(async (req, res) => {
    const payload = parseBankAccountStatusActionInput(req);
    const row = await setBankAccountActive({
      req,
      tenantId: payload.tenantId,
      bankAccountId: payload.bankAccountId,
      isActive: true,
      assertScopeAccess,
    });
    const maskedRow = await req.fieldVisibility.applyToRow(row);
    return res.json({
      tenantId: payload.tenantId,
      row: maskedRow,
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
  bankAccountFieldVisibility,
  asyncHandler(async (req, res) => {
    const payload = parseBankAccountStatusActionInput(req);
    const row = await setBankAccountActive({
      req,
      tenantId: payload.tenantId,
      bankAccountId: payload.bankAccountId,
      isActive: false,
      assertScopeAccess,
    });
    const maskedRow = await req.fieldVisibility.applyToRow(row);
    return res.json({
      tenantId: payload.tenantId,
      row: maskedRow,
    });
  })
);

export default router;
