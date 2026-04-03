import express from "express";
import { assertScopeAccess, requirePermission } from "../middleware/rbac.js";
import { applyFieldVisibility } from "../middleware/fieldVisibility.js";
import { asyncHandler, parsePositiveInt } from "./_utils.js";
import {
  createPayrollEmployeeBeneficiaryBankAccount,
  getPayrollLiabilityBeneficiarySnapshot,
  listPayrollEmployeeBeneficiaryBankAccounts,
  resolvePayrollBeneficiaryAccountScope,
  resolvePayrollBeneficiaryLiabilitySnapshotScope,
  setPrimaryPayrollEmployeeBeneficiaryBankAccount,
  updatePayrollEmployeeBeneficiaryBankAccount,
} from "../services/payroll.beneficiaries.service.js";
import {
  parsePayrollBeneficiaryAccountCreateInput,
  parsePayrollBeneficiaryAccountListInput,
  parsePayrollBeneficiaryAccountUpdateInput,
  parsePayrollBeneficiarySetPrimaryInput,
  parsePayrollLiabilityBeneficiarySnapshotReadInput,
} from "./payroll.beneficiaries.validators.js";

const router = express.Router();
const payrollBeneficiaryFieldVisibility = applyFieldVisibility("PAYROLL", "beneficiary");

function resolveLegalEntityScopeFromInput(input) {
  const legalEntityId = parsePositiveInt(input?.legalEntityId ?? input?.legal_entity_id);
  if (!legalEntityId) return null;
  return {
    scopeType: "LEGAL_ENTITY",
    scopeId: legalEntityId,
  };
}

router.get(
  "/beneficiaries/accounts",
  requirePermission("payroll.beneficiary.read", {
    resolveScope: async (req) => resolveLegalEntityScopeFromInput(req.query),
  }),
  payrollBeneficiaryFieldVisibility,
  asyncHandler(async (req, res) => {
    const payload = parsePayrollBeneficiaryAccountListInput(req);
    const result = await listPayrollEmployeeBeneficiaryBankAccounts({
      req,
      tenantId: payload.tenantId,
      legalEntityId: payload.legalEntityId,
      employeeCode: payload.employeeCode,
      currencyCode: payload.currencyCode,
      status: payload.status,
      assertScopeAccess,
    });
    const items = await req.fieldVisibility.applyToRows(result.items || []);
    return res.json({
      tenantId: payload.tenantId,
      ...result,
      items,
    });
  })
);

router.post(
  "/beneficiaries/accounts",
  requirePermission("payroll.beneficiary.write", {
    resolveScope: async (req) => resolveLegalEntityScopeFromInput(req.body),
  }),
  payrollBeneficiaryFieldVisibility,
  asyncHandler(async (req, res) => {
    const payload = parsePayrollBeneficiaryAccountCreateInput(req);
    const result = await createPayrollEmployeeBeneficiaryBankAccount({
      req,
      tenantId: payload.tenantId,
      userId: payload.userId,
      input: payload,
      assertScopeAccess,
    });
    const item = await req.fieldVisibility.applyToRow(result.item);
    return res.status(201).json({
      tenantId: payload.tenantId,
      legalEntityId: payload.legalEntityId,
      employeeCode: payload.employeeCode,
      ...result,
      item,
    });
  })
);

router.patch(
  "/beneficiaries/accounts/:accountId",
  requirePermission("payroll.beneficiary.write", {
    resolveScope: async (req, tenantId) =>
      resolvePayrollBeneficiaryAccountScope(req.params?.accountId, tenantId),
  }),
  payrollBeneficiaryFieldVisibility,
  asyncHandler(async (req, res) => {
    const payload = parsePayrollBeneficiaryAccountUpdateInput(req);
    const result = await updatePayrollEmployeeBeneficiaryBankAccount({
      req,
      tenantId: payload.tenantId,
      userId: payload.userId,
      accountId: payload.accountId,
      input: payload,
      assertScopeAccess,
    });
    const item = await req.fieldVisibility.applyToRow(result.item);
    return res.json({
      tenantId: payload.tenantId,
      accountId: payload.accountId,
      ...result,
      item,
    });
  })
);

router.post(
  "/beneficiaries/accounts/:accountId/set-primary",
  requirePermission("payroll.beneficiary.set_primary", {
    resolveScope: async (req, tenantId) =>
      resolvePayrollBeneficiaryAccountScope(req.params?.accountId, tenantId),
  }),
  payrollBeneficiaryFieldVisibility,
  asyncHandler(async (req, res) => {
    const payload = parsePayrollBeneficiarySetPrimaryInput(req);
    const result = await setPrimaryPayrollEmployeeBeneficiaryBankAccount({
      req,
      tenantId: payload.tenantId,
      userId: payload.userId,
      accountId: payload.accountId,
      reason: payload.reason,
      assertScopeAccess,
    });
    const item = await req.fieldVisibility.applyToRow(result.item);
    return res.json({
      tenantId: payload.tenantId,
      accountId: payload.accountId,
      ...result,
      item,
    });
  })
);

router.get(
  "/liabilities/:liabilityId/beneficiary-bank-snapshot",
  requirePermission("payroll.beneficiary.snapshot.read", {
    resolveScope: async (req, tenantId) =>
      resolvePayrollBeneficiaryLiabilitySnapshotScope(req.params?.liabilityId, tenantId),
  }),
  payrollBeneficiaryFieldVisibility,
  asyncHandler(async (req, res) => {
    const payload = parsePayrollLiabilityBeneficiarySnapshotReadInput(req);
    const result = await getPayrollLiabilityBeneficiarySnapshot({
      req,
      tenantId: payload.tenantId,
      liabilityId: payload.liabilityId,
      assertScopeAccess,
    });
    const snapshot = result?.item?.snapshot
      ? await req.fieldVisibility.applyToRow(result.item.snapshot)
      : null;
    return res.json({
      tenantId: payload.tenantId,
      liabilityId: payload.liabilityId,
      ...result,
      item: {
        ...result.item,
        snapshot,
      },
    });
  })
);

export default router;
