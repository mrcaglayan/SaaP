import express from "express";
import { assertScopeAccess, buildScopeFilter, requirePermission } from "../middleware/rbac.js";
import {
  asyncHandler,
  badRequest,
  parsePositiveInt,
  resolveTenantId,
} from "./_utils.js";
import { resolveBankAccountScope } from "../services/bank.accounts.service.js";
import {
  approveApprovalRequest,
  createApprovalPolicy,
  getApprovalPolicyById,
  getApprovalRequestDelegationPreview,
  getApprovalRequestById,
  listApprovalPolicies,
  listApprovalRequestRows,
  rejectApprovalRequest,
  resolveApprovalPolicyScope,
  resolveApprovalRequestScope,
  submitApprovalRequestFromRoute,
  updateApprovalPolicy,
} from "../services/approvalPolicies.service.js";
import {
  createApprovalDelegation,
  getApprovalDelegationById,
  listApprovalDelegations,
  resolveApprovalDelegationScope,
  revokeApprovalDelegation,
} from "../services/approval.delegation.service.js";
import {
  parseBankApprovalPoliciesListInput,
  parseBankApprovalPolicyCreateInput,
  parseBankApprovalPolicyIdParam,
  parseBankApprovalPolicyUpdateInput,
} from "./bank.approvalPolicies.validators.js";
import {
  parseBankApprovalRequestDecisionInput,
  parseBankApprovalRequestIdParam,
  parseBankApprovalRequestsListInput,
  parseBankApprovalRequestSubmitInput,
} from "./bank.approvalRequests.validators.js";

const router = express.Router();

async function resolvePoliciesScope(req, tenantId) {
  const legalEntityId = parsePositiveInt(req.query?.legalEntityId ?? req.body?.legalEntityId ?? req.body?.legal_entity_id);
  if (legalEntityId) return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
  const bankAccountId = parsePositiveInt(req.query?.bankAccountId ?? req.body?.bankAccountId ?? req.body?.bank_account_id);
  if (bankAccountId) return resolveBankAccountScope(bankAccountId, tenantId);
  return null;
}

async function resolveRequestsScope(req, tenantId) {
  const legalEntityId = parsePositiveInt(req.query?.legalEntityId ?? req.body?.legalEntityId ?? req.body?.legal_entity_id);
  if (legalEntityId) return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
  const bankAccountId = parsePositiveInt(req.query?.bankAccountId ?? req.body?.bankAccountId ?? req.body?.bank_account_id);
  if (bankAccountId) return resolveBankAccountScope(bankAccountId, tenantId);
  return null;
}

function parseDateOnlyValue(value, label) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const dateOnlyMatch = String(value).match(/\d{4}-\d{2}-\d{2}/);
  if (dateOnlyMatch) {
    return dateOnlyMatch[0];
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw badRequest(`${label} must be a valid date`);
  }
  return parsed.toISOString().slice(0, 10);
}

function parseBooleanFlag(value, defaultValue = false) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  return ["1", "true", "yes", "y"].includes(normalized);
}

function parseApprovalDelegationIdParam(req) {
  const delegationId = parsePositiveInt(req.params?.delegationId);
  if (!delegationId) {
    throw badRequest("delegationId must be a positive integer");
  }
  return delegationId;
}

function parseApprovalDelegationsListInput(req) {
  const tenantId = resolveTenantId(req);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  return {
    tenantId,
    delegatorUserId: parsePositiveInt(req.query?.delegatorUserId ?? req.query?.delegator_user_id),
    delegateUserId: parsePositiveInt(req.query?.delegateUserId ?? req.query?.delegate_user_id),
    moduleCode: String(req.query?.moduleCode ?? req.query?.module_code ?? "").trim() || null,
    scopeType: req.query?.scopeType ?? req.query?.scope_type ?? null,
    scopeId: parsePositiveInt(req.query?.scopeId ?? req.query?.scope_id),
    activeOnly: parseBooleanFlag(req.query?.activeOnly ?? req.query?.active_only, false),
  };
}

function parseApprovalDelegationCreateInput(req) {
  const tenantId = resolveTenantId(req);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  return {
    tenantId,
    delegatorUserId: parsePositiveInt(req.body?.delegatorUserId ?? req.body?.delegator_user_id),
    delegateUserId: parsePositiveInt(req.body?.delegateUserId ?? req.body?.delegate_user_id),
    moduleCode: String(req.body?.moduleCode ?? req.body?.module_code ?? "").trim() || null,
    scopeType: req.body?.scopeType ?? req.body?.scope_type ?? null,
    scopeId: parsePositiveInt(req.body?.scopeId ?? req.body?.scope_id),
    effectiveFrom: parseDateOnlyValue(
      req.body?.effectiveFrom ?? req.body?.effective_from,
      "effectiveFrom"
    ),
    effectiveTo: parseDateOnlyValue(
      req.body?.effectiveTo ?? req.body?.effective_to,
      "effectiveTo"
    ),
    note: String(req.body?.note ?? "").trim() || null,
    createdByUserId: parsePositiveInt(req.user?.userId),
  };
}

function parseApprovalDelegationRevokeInput(req) {
  const tenantId = resolveTenantId(req);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  return {
    tenantId,
    revokedByUserId: parsePositiveInt(req.user?.userId),
    revokedReason: String(
      req.body?.revokedReason ?? req.body?.revoked_reason ?? req.body?.reason ?? ""
    ).trim() || null,
  };
}

async function resolveDelegationsScope(req, tenantId) {
  const scopeType = req.query?.scopeType ?? req.query?.scope_type ?? req.body?.scopeType ?? req.body?.scope_type;
  const scopeId = parsePositiveInt(
    req.query?.scopeId ??
      req.query?.scope_id ??
      req.body?.scopeId ??
      req.body?.scope_id
  );
  if (scopeType && scopeId) {
    return { scopeType, scopeId };
  }
  return null;
}

router.get(
  "/policies",
  requirePermission("approvals.policies.read", { resolveScope: resolvePoliciesScope }),
  asyncHandler(async (req, res) => {
    const input = parseBankApprovalPoliciesListInput(req);
    const result = await listApprovalPolicies({
      req,
      tenantId: input.tenantId,
      filters: input,
      buildScopeFilter,
      assertScopeAccess,
    });
    return res.json({ tenantId: input.tenantId, ...result });
  })
);

router.get(
  "/policies/:policyId",
  requirePermission("approvals.policies.read", {
    resolveScope: (req, tenantId) => resolveApprovalPolicyScope(req.params?.policyId, tenantId),
  }),
  asyncHandler(async (req, res) => {
    const listInput = parseBankApprovalPoliciesListInput(req);
    const policyId = parseBankApprovalPolicyIdParam(req);
    const row = await getApprovalPolicyById({
      req,
      tenantId: listInput.tenantId,
      policyId,
      assertScopeAccess,
    });
    return res.json({ tenantId: listInput.tenantId, row });
  })
);

router.post(
  "/policies",
  requirePermission("approvals.policies.write", { resolveScope: resolvePoliciesScope }),
  asyncHandler(async (req, res) => {
    const input = parseBankApprovalPolicyCreateInput(req);
    // For PAYROLL policies, default approver permission to generic H04 approval permission if caller did not set it.
    const rawApproverPermission = req.body?.approverPermissionCode ?? req.body?.approver_permission_code;
    if (
      String(input.moduleCode || "BANK").toUpperCase() === "PAYROLL" &&
      (rawApproverPermission === undefined || rawApproverPermission === null || rawApproverPermission === "")
    ) {
      input.approverPermissionCode = "approvals.requests.approve";
    }
    const row = await createApprovalPolicy({ req, input, assertScopeAccess });
    return res.status(201).json({ tenantId: input.tenantId, row });
  })
);

router.patch(
  "/policies/:policyId",
  requirePermission("approvals.policies.write", {
    resolveScope: (req, tenantId) => resolveApprovalPolicyScope(req.params?.policyId, tenantId),
  }),
  asyncHandler(async (req, res) => {
    const input = parseBankApprovalPolicyUpdateInput(req);
    const rawApproverPermission = req.body?.approverPermissionCode ?? req.body?.approver_permission_code;
    if (
      String(input.moduleCode || "").toUpperCase() === "PAYROLL" &&
      (rawApproverPermission === undefined || rawApproverPermission === null || rawApproverPermission === "")
    ) {
      input.approverPermissionCode = "approvals.requests.approve";
    }
    const row = await updateApprovalPolicy({ req, input, assertScopeAccess });
    return res.json({ tenantId: input.tenantId, row });
  })
);

router.get(
  "/requests",
  requirePermission("approvals.requests.read", { resolveScope: resolveRequestsScope }),
  asyncHandler(async (req, res) => {
    const input = parseBankApprovalRequestsListInput(req);
    const result = await listApprovalRequestRows({
      req,
      tenantId: input.tenantId,
      filters: input,
      buildScopeFilter,
      assertScopeAccess,
    });
    return res.json({ tenantId: input.tenantId, ...result });
  })
);

router.get(
  "/requests/:requestId",
  requirePermission("approvals.requests.read", {
    resolveScope: (req, tenantId) => resolveApprovalRequestScope(req.params?.requestId, tenantId),
  }),
  asyncHandler(async (req, res) => {
    const listInput = parseBankApprovalRequestsListInput(req);
    const requestId = parseBankApprovalRequestIdParam(req);
    const row = await getApprovalRequestById({
      req,
      tenantId: listInput.tenantId,
      requestId,
      assertScopeAccess,
    });
    return res.json({ tenantId: listInput.tenantId, row });
  })
);

router.get(
  "/requests/:requestId/delegation-preview",
  requirePermission("approvals.requests.read", {
    resolveScope: (req, tenantId) => resolveApprovalRequestScope(req.params?.requestId, tenantId),
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    const requestId = parseBankApprovalRequestIdParam(req);
    const row = await getApprovalRequestDelegationPreview(requestId, req.user?.userId);
    return res.json({ tenantId, row });
  })
);

router.post(
  "/requests",
  requirePermission("approvals.requests.submit", { resolveScope: resolveRequestsScope }),
  asyncHandler(async (req, res) => {
    const input = parseBankApprovalRequestSubmitInput(req);
    if (
      String(input.moduleCode || "BANK").toUpperCase() === "PAYROLL" &&
      !req.body?.targetSnapshot &&
      !req.body?.target_snapshot
    ) {
      input.targetSnapshot = {
        module_code: "PAYROLL",
        target_type: input.targetType,
        target_id: input.targetId || null,
      };
    }
    const result = await submitApprovalRequestFromRoute({
      req,
      tenantId: input.tenantId,
      userId: input.userId,
      input,
      assertScopeAccess,
    });
    return res.status(201).json({
      tenantId: input.tenantId,
      approval_required: Boolean(result.approval_required),
      item: result.item || null,
      idempotent: Boolean(result.idempotent),
    });
  })
);

router.get(
  "/delegations",
  requirePermission("approvals.policies.read", { resolveScope: resolveDelegationsScope }),
  asyncHandler(async (req, res) => {
    const input = parseApprovalDelegationsListInput(req);
    const hasExplicitScopeFilter = Boolean(input.scopeType && input.scopeId);
    const isTenantWidePolicyReader = Boolean(
      req.rbac?.permissionScopeContext?.tenantWide
    );
    if (!hasExplicitScopeFilter && !isTenantWidePolicyReader) {
      throw badRequest(
        "Scoped delegation list requests must include scopeType and scopeId"
      );
    }
    const rows = await listApprovalDelegations(input);
    return res.json({ tenantId: input.tenantId, rows });
  })
);

router.get(
  "/delegations/:delegationId",
  requirePermission("approvals.policies.read", {
    resolveScope: (req, tenantId) =>
      resolveApprovalDelegationScope(req.params?.delegationId, tenantId),
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    const delegationId = parseApprovalDelegationIdParam(req);
    const row = await getApprovalDelegationById({ tenantId, delegationId });
    return res.json({ tenantId, row });
  })
);

router.post(
  "/delegations",
  requirePermission("approvals.policies.write", { resolveScope: resolveDelegationsScope }),
  asyncHandler(async (req, res) => {
    const input = parseApprovalDelegationCreateInput(req);
    const row = await createApprovalDelegation(input);
    return res.status(201).json({ tenantId: input.tenantId, row });
  })
);

router.post(
  "/delegations/:delegationId/revoke",
  requirePermission("approvals.policies.write", {
    resolveScope: (req, tenantId) =>
      resolveApprovalDelegationScope(req.params?.delegationId, tenantId),
  }),
  asyncHandler(async (req, res) => {
    const delegationId = parseApprovalDelegationIdParam(req);
    const input = parseApprovalDelegationRevokeInput(req);
    const result = await revokeApprovalDelegation(delegationId, input);
    return res.json({
      tenantId: input.tenantId,
      row: result.row,
      idempotent: Boolean(result.idempotent),
    });
  })
);

router.post(
  "/requests/:requestId/approve",
  // Delegated reviewers may not hold the direct approve/reject capability
  // themselves, so the route only requires scoped read access. The engine then
  // performs the authoritative direct-vs-delegated authority check against the
  // resolved approval request context.
  requirePermission("approvals.requests.read", {
    resolveScope: (req, tenantId) => resolveApprovalRequestScope(req.params?.requestId, tenantId),
  }),
  asyncHandler(async (req, res) => {
    const input = parseBankApprovalRequestDecisionInput(req);
    const result = await approveApprovalRequest({
      req,
      tenantId: input.tenantId,
      requestId: input.requestId,
      userId: input.userId,
      decisionComment: input.decisionComment,
      assertScopeAccess,
    });
    return res.json({
      tenantId: input.tenantId,
      item: result.item || null,
      execution_result: result.execution_result || null,
      idempotent: Boolean(result.idempotent),
    });
  })
);

router.post(
  "/requests/:requestId/reject",
  requirePermission("approvals.requests.read", {
    resolveScope: (req, tenantId) => resolveApprovalRequestScope(req.params?.requestId, tenantId),
  }),
  asyncHandler(async (req, res) => {
    const input = parseBankApprovalRequestDecisionInput(req);
    const result = await rejectApprovalRequest({
      req,
      tenantId: input.tenantId,
      requestId: input.requestId,
      userId: input.userId,
      decisionComment: input.decisionComment,
      assertScopeAccess,
    });
    return res.json({
      tenantId: input.tenantId,
      item: result.item || null,
      idempotent: Boolean(result.idempotent),
    });
  })
);

export default router;
