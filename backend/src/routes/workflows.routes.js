import express from "express";
import { assertScopeAccess, requirePermission } from "../middleware/rbac.js";
import { parsePositiveInt } from "./_utils.js";
import { requireTenantId } from "./cash.validators.common.js";
import {
  parseWorkflowAssignmentCreateInput,
  parseWorkflowAssignmentsListInput,
  parseWorkflowAssignmentUpdateInput,
  parseWorkflowDefinitionCreateInput,
  parseWorkflowDefinitionIdParam,
  parseWorkflowDefinitionsListInput,
  parseWorkflowDefinitionStepsReplaceInput,
  parseWorkflowDefinitionUpdateInput,
  parseWorkflowInstanceDecisionInput,
  parseWorkflowInstanceIdParam,
  parseWorkflowInstancesListInput,
} from "./workflows.validators.js";
import {
  approveWorkflowInstance,
  createWorkflowAssignment,
  createWorkflowDefinition,
  getWorkflowInstanceById,
  listWorkflowAssignments,
  listWorkflowDefinitions,
  listWorkflowDefinitionSteps,
  listWorkflowInstances,
  rejectWorkflowInstance,
  returnWorkflowInstance,
  replaceWorkflowDefinitionSteps,
  resolveWorkflowAssignmentScope,
  resolveWorkflowDecisionPermissionAccess,
  resolveWorkflowInstanceScope,
  updateWorkflowAssignment,
  updateWorkflowDefinition,
} from "../services/workflows.service.js";
import { resolveRowScope } from "../services/authz.scope.service.js";

const router = express.Router();

async function runPermissionMiddleware(middleware, req, res) {
  await new Promise((resolve, reject) => {
    middleware(req, res, (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

function resolveScopeFromInput(rawValue) {
  const resolvedScope = resolveRowScope({
    operatingUnitId: parsePositiveInt(
      rawValue?.operatingUnitId ?? rawValue?.operating_unit_id
    ),
    legalEntityId: parsePositiveInt(
      rawValue?.legalEntityId ?? rawValue?.legal_entity_id
    ),
    countryId: parsePositiveInt(
      rawValue?.countryId ?? rawValue?.country_id
    ),
    groupCompanyId: parsePositiveInt(
      rawValue?.groupCompanyId ?? rawValue?.group_company_id
    ),
  });
  return resolvedScope
    ? { scopeType: resolvedScope.scopeType, scopeId: resolvedScope.scopeId }
    : null;
}

async function enforceDecisionPermission(
  req,
  res,
  tenantId,
  instanceId,
  decisionCode = "APPROVE"
) {
  const access = await resolveWorkflowDecisionPermissionAccess({
    tenantId,
    instanceId,
    decisionCode,
  });

  if (!String(access.requiredPermissionCode || "").trim()) {
    // AP document workflow steps intentionally use a blank step permission so
    // the decision route relies on scope access and unified engine state.
    // Still enforce the platform-level approval permission so req.rbac gets
    // populated with the user's scope context for downstream scope checks.
    const fallbackMiddleware = requirePermission("approvals.requests.approve", {
      resolveScope: async () => access.scope,
    });
    try {
      await runPermissionMiddleware(fallbackMiddleware, req, res);
    } catch (err) {
      if (Number(err?.status) === 403 && !err?.code) {
        err.code = "APPROVAL_STEP_PERMISSION_DENIED";
      }
      throw err;
    }
    return access;
  }

  const middleware = requirePermission(access.requiredPermissionCode, {
    resolveScope: async () => access.scope,
  });
  try {
    await runPermissionMiddleware(middleware, req, res);
  } catch (err) {
    if (Number(err?.status) === 403 && !err?.code) {
      err.code = "APPROVAL_STEP_PERMISSION_DENIED";
    }
    throw err;
  }
  return access;
}

router.get(
  "/definitions",
  requirePermission("workflow.definition.read"),
  async (req, res, next) => {
    try {
      const input = parseWorkflowDefinitionsListInput(req);
      const result = await listWorkflowDefinitions({
        tenantId: input.tenantId,
        filters: input,
      });
      return res.json({
        tenantId: input.tenantId,
        ...result,
      });
    } catch (err) {
      return next(err);
    }
  }
);

router.post(
  "/definitions",
  requirePermission("workflow.definition.write"),
  async (req, res, next) => {
    try {
      const input = parseWorkflowDefinitionCreateInput(req);
      const row = await createWorkflowDefinition({ input });
      return res.status(201).json({
        ok: true,
        tenantId: input.tenantId,
        row,
      });
    } catch (err) {
      return next(err);
    }
  }
);

router.patch(
  "/definitions/:definitionId",
  requirePermission("workflow.definition.write"),
  async (req, res, next) => {
    try {
      const input = parseWorkflowDefinitionUpdateInput(req);
      const row = await updateWorkflowDefinition({ input });
      return res.json({
        ok: true,
        tenantId: input.tenantId,
        row,
      });
    } catch (err) {
      return next(err);
    }
  }
);

router.get(
  "/definitions/:definitionId/steps",
  requirePermission("workflow.definition.read"),
  async (req, res, next) => {
    try {
      const tenantId = requireTenantId(req);
      const definitionId = parseWorkflowDefinitionIdParam(req);
      const rows = await listWorkflowDefinitionSteps({ tenantId, definitionId });
      return res.json({
        tenantId,
        definitionId,
        rows,
      });
    } catch (err) {
      return next(err);
    }
  }
);

router.post(
  "/definitions/:definitionId/steps",
  requirePermission("workflow.definition.write"),
  async (req, res, next) => {
    try {
      const input = parseWorkflowDefinitionStepsReplaceInput(req);
      const rows = await replaceWorkflowDefinitionSteps({ input });
      return res.json({
        ok: true,
        tenantId: input.tenantId,
        definitionId: input.definitionId,
        rows,
      });
    } catch (err) {
      return next(err);
    }
  }
);

router.get(
  "/assignments",
  requirePermission("workflow.assignment.read", {
    resolveScope: (req) => resolveScopeFromInput(req.query),
  }),
  async (req, res, next) => {
    try {
      const input = parseWorkflowAssignmentsListInput(req);
      const result = await listWorkflowAssignments({
        req,
        tenantId: input.tenantId,
        filters: input,
        assertScopeAccess,
      });
      return res.json({
        tenantId: input.tenantId,
        ...result,
      });
    } catch (err) {
      return next(err);
    }
  }
);

router.post(
  "/assignments",
  requirePermission("workflow.assignment.write", {
    resolveScope: (req) => resolveScopeFromInput(req.body),
  }),
  async (req, res, next) => {
    try {
      const input = parseWorkflowAssignmentCreateInput(req);
      const row = await createWorkflowAssignment({
        req,
        input,
        assertScopeAccess,
      });
      return res.status(201).json({
        ok: true,
        tenantId: input.tenantId,
        row,
      });
    } catch (err) {
      return next(err);
    }
  }
);

router.patch(
  "/assignments/:assignmentId",
  requirePermission("workflow.assignment.write", {
    resolveScope: (req, tenantId) =>
      resolveWorkflowAssignmentScope(req.params?.assignmentId, tenantId),
  }),
  async (req, res, next) => {
    try {
      const input = parseWorkflowAssignmentUpdateInput(req);
      const row = await updateWorkflowAssignment({
        req,
        input,
        assertScopeAccess,
      });
      return res.json({
        ok: true,
        tenantId: input.tenantId,
        row,
      });
    } catch (err) {
      return next(err);
    }
  }
);

router.get(
  "/instances",
  requirePermission("org.tree.read"),
  async (req, res, next) => {
    try {
      const input = parseWorkflowInstancesListInput(req);
      const result = await listWorkflowInstances({
        req,
        tenantId: input.tenantId,
        filters: input,
        assertScopeAccess,
      });
      return res.json({
        tenantId: input.tenantId,
        ...result,
      });
    } catch (err) {
      return next(err);
    }
  }
);

router.get(
  "/instances/:instanceId",
  requirePermission("org.tree.read", {
    resolveScope: (req, tenantId) =>
      resolveWorkflowInstanceScope(req.params?.instanceId, tenantId),
  }),
  async (req, res, next) => {
    try {
      const tenantId = requireTenantId(req);
      const instanceId = parseWorkflowInstanceIdParam(req);
      const row = await getWorkflowInstanceById({
        req,
        tenantId,
        instanceId,
        assertScopeAccess,
      });
      return res.json({
        tenantId,
        row,
      });
    } catch (err) {
      return next(err);
    }
  }
);

router.post("/instances/:instanceId/approve", async (req, res, next) => {
  try {
    const input = parseWorkflowInstanceDecisionInput(req);
    const permissionAccess = await enforceDecisionPermission(
      req,
      res,
      input.tenantId,
      input.instanceId,
      "APPROVE"
    );
    const result = await approveWorkflowInstance({
      req,
      input,
      assertScopeAccess,
    });
    return res.json({
      ok: true,
      tenantId: input.tenantId,
      row: result.row,
      decisions: result.decisions,
      stepDecision: {
        decision: result.decision,
        stepNo: result.currentStepNo,
        minApproverCount: result.minApproverCount,
        stageScopeType: result.stageScopeType,
        requiredPermissionCode:
          result.requiredPermissionCode || permissionAccess.requiredPermissionCode,
        advanced: result.advanced,
        resolved: result.resolved,
      },
    });
  } catch (err) {
    return next(err);
  }
});

router.post("/instances/:instanceId/reject", async (req, res, next) => {
  try {
    const input = parseWorkflowInstanceDecisionInput(req, {
      requireComment: true,
    });
    const permissionAccess = await enforceDecisionPermission(
      req,
      res,
      input.tenantId,
      input.instanceId,
      "REJECT"
    );
    const result = await rejectWorkflowInstance({
      req,
      input,
      assertScopeAccess,
    });
    return res.json({
      ok: true,
      tenantId: input.tenantId,
      row: result.row,
      decisions: result.decisions,
      stepDecision: {
        decision: result.decision,
        stepNo: result.currentStepNo,
        minApproverCount: result.minApproverCount,
        stageScopeType: result.stageScopeType,
        requiredPermissionCode:
          result.requiredPermissionCode || permissionAccess.requiredPermissionCode,
        advanced: result.advanced,
        resolved: result.resolved,
      },
    });
  } catch (err) {
    return next(err);
  }
});

router.post("/instances/:instanceId/return", async (req, res, next) => {
  try {
    const input = parseWorkflowInstanceDecisionInput(req, {
      requireComment: true,
    });
    const permissionAccess = await enforceDecisionPermission(
      req,
      res,
      input.tenantId,
      input.instanceId,
      "RETURN"
    );
    const result = await returnWorkflowInstance({
      req,
      input,
      assertScopeAccess,
    });
    return res.json({
      ok: true,
      tenantId: input.tenantId,
      row: result.row,
      decisions: result.decisions,
      stepDecision: {
        decision: result.decision,
        stepNo: result.currentStepNo,
        minApproverCount: result.minApproverCount,
        stageScopeType: result.stageScopeType,
        requiredPermissionCode:
          result.requiredPermissionCode || permissionAccess.requiredPermissionCode || null,
        advanced: result.advanced,
        resolved: result.resolved,
      },
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
