import express from "express";
import { assertScopeAccess, buildScopeFilter, requirePermission } from "../middleware/rbac.js";
import { asyncHandler, parsePositiveInt } from "./_utils.js";
import { resolveBankAccountScope } from "../services/bank.accounts.service.js";
import {
  createDifferenceProfile,
  getDifferenceProfileById,
  listDifferenceProfiles,
  resolveDifferenceProfileScope,
  updateDifferenceProfile,
} from "../services/bank.reconciliationDifferenceProfiles.service.js";
import {
  parseDifferenceProfileCreateInput,
  parseDifferenceProfileIdParam,
  parseDifferenceProfileListFilters,
  parseDifferenceProfileUpdateInput,
} from "./bank.reconciliationDifferenceProfiles.validators.js";

const router = express.Router();

async function resolveDifferenceProfileListScope(req, tenantId) {
  const legalEntityId = parsePositiveInt(req.query?.legalEntityId ?? req.body?.legalEntityId);
  if (legalEntityId) return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
  const bankAccountId = parsePositiveInt(req.query?.bankAccountId ?? req.body?.bankAccountId);
  if (bankAccountId) return resolveBankAccountScope(bankAccountId, tenantId);
  return null;
}

router.get(
  "/difference-profiles",
  requirePermission("bank.reconcile.diffprofiles.read", { resolveScope: resolveDifferenceProfileListScope }),
  asyncHandler(async (req, res) => {
    const filters = parseDifferenceProfileListFilters(req);
    const result = await listDifferenceProfiles({
      req,
      tenantId: filters.tenantId,
      filters,
      buildScopeFilter,
      assertScopeAccess,
    });
    return res.json({ tenantId: filters.tenantId, ...result });
  })
);

router.get(
  "/difference-profiles/:profileId",
  requirePermission("bank.reconcile.diffprofiles.read", {
    resolveScope: (req, tenantId) => resolveDifferenceProfileScope(req.params?.profileId, tenantId),
  }),
  asyncHandler(async (req, res) => {
    const filters = parseDifferenceProfileListFilters(req);
    const profileId = parseDifferenceProfileIdParam(req);
    const row = await getDifferenceProfileById({
      req,
      tenantId: filters.tenantId,
      profileId,
      assertScopeAccess,
    });
    return res.json({ tenantId: filters.tenantId, row });
  })
);

router.post(
  "/difference-profiles",
  requirePermission("bank.reconcile.diffprofiles.write", { resolveScope: resolveDifferenceProfileListScope }),
  asyncHandler(async (req, res) => {
    const input = parseDifferenceProfileCreateInput(req);
    const row = await createDifferenceProfile({ req, input, assertScopeAccess });
    return res.status(201).json({ tenantId: input.tenantId, row });
  })
);

router.patch(
  "/difference-profiles/:profileId",
  requirePermission("bank.reconcile.diffprofiles.write", {
    resolveScope: (req, tenantId) => resolveDifferenceProfileScope(req.params?.profileId, tenantId),
  }),
  asyncHandler(async (req, res) => {
    const input = parseDifferenceProfileUpdateInput(req);
    const row = await updateDifferenceProfile({ req, input, assertScopeAccess });
    return res.json({ tenantId: input.tenantId, row });
  })
);

export default router;
