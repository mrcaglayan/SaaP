import { query } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import {
  checkUserHasPermissionAtScope,
  doesScopeIncludeScope,
  isScopeAllowed,
  loadPermissionBundle,
  loadUserEntitlements,
  normalizeAuthzScope,
} from "./authz.scope.service.js";
import { loadFieldVisibilityPolicies } from "../middleware/fieldVisibility.js";
import { evaluateSoD } from "./sod.service.js";
import { canManageSecurity } from "./systemRoles.service.js";
import { getRequestDiagnostics } from "./approval.engine.service.js";
import { evaluateWorkflowApprovalGate } from "./workflows.service.js";

const DIAGNOSTIC_LAYER_STATUS = Object.freeze({
  PASS: "PASS",
  FAIL: "FAIL",
  SKIPPED: "SKIPPED",
  NOT_APPLICABLE: "NOT_APPLICABLE",
});

const FIELD_VISIBILITY_POLICY_SCOPE_RANK = Object.freeze({
  OPERATING_UNIT: 5,
  LEGAL_ENTITY: 4,
  COUNTRY: 3,
  GROUP: 2,
  TENANT: 1,
  GLOBAL: 0,
});

function forbidden(message) {
  const err = new Error(message);
  err.status = 403;
  return err;
}

function normalizeUpperText(value) {
  return String(value || "").trim().toUpperCase();
}

function summarizeScopeContext(scopeContext) {
  if (!scopeContext) {
    return null;
  }

  const scopedIdsByType = {};
  if (scopeContext.tenantWide) {
    scopedIdsByType.TENANT = [parsePositiveInt(scopeContext.tenantId)];
  }
  if (scopeContext.groups?.size > 0) {
    scopedIdsByType.GROUP = Array.from(scopeContext.groups).sort((left, right) => left - right);
  }
  if (scopeContext.countries?.size > 0) {
    scopedIdsByType.COUNTRY = Array.from(scopeContext.countries).sort(
      (left, right) => left - right
    );
  }
  if (scopeContext.legalEntities?.size > 0) {
    scopedIdsByType.LEGAL_ENTITY = Array.from(scopeContext.legalEntities).sort(
      (left, right) => left - right
    );
  }
  if (scopeContext.operatingUnits?.size > 0) {
    scopedIdsByType.OPERATING_UNIT = Array.from(scopeContext.operatingUnits).sort(
      (left, right) => left - right
    );
  }

  return {
    tenantWide: Boolean(scopeContext.tenantWide),
    sourceRows: Number(scopeContext.sourceRows || 0),
    scopeTypes: Object.keys(scopedIdsByType),
    scopeIdsByType: scopedIdsByType,
  };
}

function buildLayerResult(status, code, message, details = null, blockers = []) {
  return {
    status,
    code: String(code || "").trim() || null,
    message: String(message || "").trim() || null,
    details: details ?? null,
    blockers: Array.isArray(blockers) ? blockers : [],
  };
}

function normalizeRequestedScope(scopeInput, tenantId) {
  if (!scopeInput) {
    return null;
  }
  const scopeType = scopeInput.scopeType ?? scopeInput.scope_type;
  const scopeId = scopeInput.scopeId ?? scopeInput.scope_id;
  if (scopeType === undefined && scopeId === undefined) {
    return null;
  }
  return normalizeAuthzScope({ scopeType, scopeId }, tenantId);
}

function normalizeBusinessStateInput(input) {
  if (!input || typeof input !== "object") {
    return null;
  }

  const blockers = Array.isArray(input.blockers)
    ? input.blockers
        .map((blocker) => ({
          code: String(blocker?.code || "").trim() || null,
          message: String(blocker?.message || "").trim() || null,
          details:
            blocker && typeof blocker === "object" && Object.prototype.hasOwnProperty.call(blocker, "details")
              ? blocker.details
              : null,
        }))
        .filter((blocker) => blocker.code || blocker.message)
    : [];

  let allowed = null;
  if (typeof input.allowed === "boolean") {
    allowed = input.allowed;
  } else if (blockers.length > 0) {
    allowed = false;
  }

  return {
    allowed,
    statusCode: String(input.statusCode || input.status_code || "").trim() || null,
    message: String(input.message || "").trim() || null,
    details:
      input && typeof input === "object" && Object.prototype.hasOwnProperty.call(input, "details")
        ? input.details
        : null,
    blockers,
  };
}

function normalizeInput(input) {
  const normalizedTenantId = parsePositiveInt(input?.tenantId ?? input?.tenant_id);
  const normalizedActorUserId = parsePositiveInt(input?.actorUserId ?? input?.actor_user_id);
  const normalizedTargetUserId = parsePositiveInt(
    input?.targetUserId ?? input?.target_user_id ?? input?.userId ?? input?.user_id
  );

  if (!normalizedTenantId) {
    throw badRequest("tenantId is required");
  }
  if (!normalizedActorUserId) {
    throw badRequest("actorUserId is required");
  }

  const requestedScope = normalizeRequestedScope(
    {
      scopeType: input?.scopeType ?? input?.scope_type,
      scopeId: input?.scopeId ?? input?.scope_id,
    },
    normalizedTenantId
  );

  const workflowGateInput =
    input?.workflowGate && typeof input.workflowGate === "object"
      ? input.workflowGate
      : null;
  const workflowScope = normalizeRequestedScope(
    workflowGateInput
      ? {
          scopeType: workflowGateInput.scopeType ?? workflowGateInput.scope_type,
          scopeId: workflowGateInput.scopeId ?? workflowGateInput.scope_id,
        }
      : null,
    normalizedTenantId
  );

  return {
    tenantId: normalizedTenantId,
    actorUserId: normalizedActorUserId,
    targetUserId: normalizedTargetUserId || normalizedActorUserId,
    permissionCode: String(input?.permissionCode || input?.permission_code || "").trim() || null,
    requestedScope,
    moduleCode: normalizeUpperText(input?.moduleCode ?? input?.module_code),
    objectType: normalizeUpperText(input?.objectType ?? input?.object_type),
    fieldName: String(input?.fieldName ?? input?.field_name ?? "").trim() || null,
    actionCode: String(input?.actionCode || input?.action_code || "").trim() || null,
    recordType: normalizeUpperText(input?.recordType ?? input?.record_type),
    recordId: parsePositiveInt(input?.recordId ?? input?.record_id),
    sodContext:
      input && typeof input === "object" && Object.prototype.hasOwnProperty.call(input, "sodContext")
        ? input.sodContext
        : input?.context || {},
    workflowRequestId: parsePositiveInt(
      input?.workflowRequestId ?? input?.workflow_request_id ?? input?.approvalRequestId
    ),
    workflowGate: workflowGateInput
      ? {
          processType: String(
            workflowGateInput.processType ?? workflowGateInput.process_type ?? ""
          ).trim(),
          targetType: String(
            workflowGateInput.targetType ?? workflowGateInput.target_type ?? ""
          ).trim(),
          targetId: parsePositiveInt(
            workflowGateInput.targetId ?? workflowGateInput.target_id
          ),
          requestedByUserId: parsePositiveInt(
            workflowGateInput.requestedByUserId ??
              workflowGateInput.requested_by_user_id
          ),
          effectiveOn: String(
            workflowGateInput.effectiveOn ?? workflowGateInput.effective_on ?? ""
          ).trim() || null,
          scope: workflowScope,
        }
      : null,
    businessState: normalizeBusinessStateInput(input?.businessState),
  };
}

async function assertAccessCheckTargetAllowed({
  actorUserId,
  targetUserId,
  tenantId,
  runQuery = query,
}) {
  if (actorUserId === targetUserId) {
    return;
  }
  const allowed = await canManageSecurity(actorUserId, tenantId, runQuery);
  if (!allowed) {
    throw forbidden("Only SecurityAdmin can debug another user's access chain");
  }
}

async function evaluateCapabilityLayer({
  tenantId,
  targetUserId,
  permissionCode,
  runQuery = query,
}) {
  if (!permissionCode) {
    return {
      layer: buildLayerResult(
        DIAGNOSTIC_LAYER_STATUS.NOT_APPLICABLE,
        "CAPABILITY_NOT_REQUESTED",
        "No permission code was provided for capability diagnostics."
      ),
      bundle: null,
    };
  }

  const bundle = await loadPermissionBundle({
    userId: targetUserId,
    tenantId,
    permissionCode,
    runQuery,
  });

  if (bundle?.missingPermission) {
    return {
      layer: buildLayerResult(
        DIAGNOSTIC_LAYER_STATUS.FAIL,
        "MISSING_PERMISSION",
        `User does not hold permission ${permissionCode}.`,
        {
          permissionCode,
          source: bundle?.source || null,
          permissionScopeContext: null,
          visibilityScopeContext: summarizeScopeContext(bundle?.visibilityScopeContext),
          scopeContext: summarizeScopeContext(bundle?.scopeContext),
        }
      ),
      bundle,
    };
  }

  return {
    layer: buildLayerResult(
      DIAGNOSTIC_LAYER_STATUS.PASS,
      "PERMISSION_GRANTED",
      `User holds permission ${permissionCode}.`,
      {
        permissionCode,
        source: bundle?.source || null,
        permissionScopeContext: summarizeScopeContext(bundle?.permissionScopeContext),
        visibilityScopeContext: summarizeScopeContext(bundle?.visibilityScopeContext),
        scopeContext: summarizeScopeContext(bundle?.scopeContext),
      }
    ),
    bundle,
  };
}

function evaluateScopeEntitlementLayer({ capabilityLayer, bundle, requestedScope, permissionCode }) {
  if (!permissionCode) {
    return buildLayerResult(
      DIAGNOSTIC_LAYER_STATUS.NOT_APPLICABLE,
      "SCOPE_NOT_REQUESTED",
      "Scope entitlement diagnostics require a permission code."
    );
  }
  if (capabilityLayer.status === DIAGNOSTIC_LAYER_STATUS.FAIL) {
    return buildLayerResult(
      DIAGNOSTIC_LAYER_STATUS.SKIPPED,
      "CAPABILITY_FAILED",
      "Scope entitlement was skipped because the capability layer already failed."
    );
  }
  if (!requestedScope) {
    return buildLayerResult(
      DIAGNOSTIC_LAYER_STATUS.SKIPPED,
      "REQUEST_SCOPE_MISSING",
      "No requested scope was provided for entitlement evaluation."
    );
  }

  const allowed = isScopeAllowed(bundle?.permissionScopeContext, requestedScope);
  return buildLayerResult(
    allowed ? DIAGNOSTIC_LAYER_STATUS.PASS : DIAGNOSTIC_LAYER_STATUS.FAIL,
    allowed ? "SCOPE_ALLOWED" : "SCOPE_DENIED",
    allowed
      ? `Permission scope covers ${requestedScope.scopeType} ${requestedScope.scopeId}.`
      : `Permission scope does not cover ${requestedScope.scopeType} ${requestedScope.scopeId}.`,
    {
      permissionCode,
      requestedScope,
      permissionScopeContext: summarizeScopeContext(bundle?.permissionScopeContext),
    }
  );
}

function evaluateVisibilityPolicyLayer({ capabilityLayer, bundle, requestedScope, entitlements }) {
  if (!requestedScope) {
    return buildLayerResult(
      DIAGNOSTIC_LAYER_STATUS.NOT_APPLICABLE,
      "VISIBILITY_SCOPE_NOT_REQUESTED",
      "No row/request scope was provided for visibility policy evaluation."
    );
  }
  if (capabilityLayer.status === DIAGNOSTIC_LAYER_STATUS.FAIL) {
    return buildLayerResult(
      DIAGNOSTIC_LAYER_STATUS.SKIPPED,
      "CAPABILITY_FAILED",
      "Visibility policy was skipped because the capability layer already failed."
    );
  }
  if (!bundle?.visibilityScopeContext) {
    return buildLayerResult(
      DIAGNOSTIC_LAYER_STATUS.PASS,
      "VISIBILITY_NOT_NARROWED",
      "No data-scope visibility narrowing applies to this user.",
      {
        requestedScope,
        isVisibilityNarrowed: false,
        scopeSummary: entitlements?.scopeSummary || null,
      }
    );
  }

  const allowed = isScopeAllowed(bundle.visibilityScopeContext, requestedScope);
  return buildLayerResult(
    allowed ? DIAGNOSTIC_LAYER_STATUS.PASS : DIAGNOSTIC_LAYER_STATUS.FAIL,
    allowed ? "VISIBILITY_SCOPE_ALLOWED" : "VISIBILITY_SCOPE_DENIED",
    allowed
      ? `Visibility scope includes ${requestedScope.scopeType} ${requestedScope.scopeId}.`
      : `Visibility is narrowed away from ${requestedScope.scopeType} ${requestedScope.scopeId}.`,
    {
      requestedScope,
      isVisibilityNarrowed: true,
      visibilityScopeContext: summarizeScopeContext(bundle.visibilityScopeContext),
      visibilityOverrides: entitlements?.visibilityOverrides || [],
      scopeSummary: entitlements?.scopeSummary || null,
    }
  );
}

async function selectFieldVisibilityPolicy({
  tenantId,
  moduleCode,
  objectType,
  fieldName,
  requestedScope,
  runQuery = query,
}) {
  const policies = await loadFieldVisibilityPolicies({
    tenantId,
    moduleCode,
    objectType,
    runQuery,
  });

  const normalizedFieldName = String(fieldName || "").trim();
  let selectedPolicy = null;
  let selectedRank = -1;
  for (const policy of policies) {
    if (String(policy?.fieldName || "").trim() !== normalizedFieldName) {
      continue;
    }

    let applies = true;
    if (policy.appliesToScopeType && policy.appliesToScopeId) {
      applies = await doesScopeIncludeScope(
        tenantId,
        {
          scopeType: policy.appliesToScopeType,
          scopeId: policy.appliesToScopeId,
        },
        requestedScope,
        runQuery
      );
    }
    if (!applies) {
      continue;
    }

    const rank = policy.appliesToScopeType
      ? FIELD_VISIBILITY_POLICY_SCOPE_RANK[policy.appliesToScopeType] || 0
      : FIELD_VISIBILITY_POLICY_SCOPE_RANK.GLOBAL;
    if (rank > selectedRank) {
      selectedPolicy = policy;
      selectedRank = rank;
    }
  }

  return selectedPolicy;
}

async function evaluateFieldVisibilityLayer({
  tenantId,
  targetUserId,
  moduleCode,
  objectType,
  fieldName,
  requestedScope,
  runQuery = query,
}) {
  if (!fieldName) {
    return buildLayerResult(
      DIAGNOSTIC_LAYER_STATUS.NOT_APPLICABLE,
      "FIELD_VISIBILITY_NOT_REQUESTED",
      "No field name was provided for field-level visibility diagnostics."
    );
  }
  if (!moduleCode || !objectType || !requestedScope) {
    return buildLayerResult(
      DIAGNOSTIC_LAYER_STATUS.SKIPPED,
      "FIELD_VISIBILITY_INPUT_INCOMPLETE",
      "Field visibility diagnostics require moduleCode, objectType, and scope."
    );
  }

  const policy = await selectFieldVisibilityPolicy({
    tenantId,
    moduleCode,
    objectType,
    fieldName,
    requestedScope,
    runQuery,
  });

  if (!policy) {
    return buildLayerResult(
      DIAGNOSTIC_LAYER_STATUS.PASS,
      "FIELD_VISIBLE",
      "No field visibility policy restricts this field at the requested scope.",
      {
        moduleCode,
        objectType,
        fieldName,
        requestedScope,
        visibilityRule: "FULL",
      }
    );
  }

  let hasOverride = false;
  if (policy.requiredPermissionCode) {
    hasOverride = await checkUserHasPermissionAtScope(
      targetUserId,
      tenantId,
      policy.requiredPermissionCode,
      requestedScope.scopeType,
      requestedScope.scopeId,
      { runQuery }
    );
  }

  const isFullVisibility = hasOverride || policy.visibilityRule === "FULL";
  return buildLayerResult(
    isFullVisibility ? DIAGNOSTIC_LAYER_STATUS.PASS : DIAGNOSTIC_LAYER_STATUS.FAIL,
    isFullVisibility ? "FIELD_VISIBLE" : "FIELD_RESTRICTED",
    isFullVisibility
      ? `Field ${fieldName} is fully visible at ${requestedScope.scopeType} ${requestedScope.scopeId}.`
      : `Field ${fieldName} is restricted by field visibility policy (${policy.visibilityRule}).`,
    {
      moduleCode,
      objectType,
      fieldName,
      requestedScope,
      policy: {
        id: policy.id,
        visibilityRule: policy.visibilityRule,
        appliesToScopeType: policy.appliesToScopeType,
        appliesToScopeId: policy.appliesToScopeId,
        requiredPermissionCode: policy.requiredPermissionCode,
      },
      hasOverride,
    }
  );
}

async function evaluateSoDLayer({
  tenantId,
  targetUserId,
  actionCode,
  recordType,
  recordId,
  context,
}) {
  if (!actionCode && !recordType && !recordId) {
    return buildLayerResult(
      DIAGNOSTIC_LAYER_STATUS.NOT_APPLICABLE,
      "SOD_NOT_REQUESTED",
      "No SoD target was provided."
    );
  }
  if (!actionCode || !recordType || !recordId) {
    return buildLayerResult(
      DIAGNOSTIC_LAYER_STATUS.SKIPPED,
      "SOD_INPUT_INCOMPLETE",
      "SoD diagnostics require actionCode, recordType, and recordId."
    );
  }

  const evaluation = await evaluateSoD({
    tenantId,
    userId: targetUserId,
    actionCode,
    recordType,
    recordId,
    context,
  });

  if (evaluation.findings.length === 0) {
    return buildLayerResult(
      DIAGNOSTIC_LAYER_STATUS.NOT_APPLICABLE,
      "SOD_RULE_NOT_CONFIGURED",
      "No SoD rule applies to this record/action combination.",
      evaluation
    );
  }

  if (evaluation.blockingFindings.length > 0) {
    return buildLayerResult(
      DIAGNOSTIC_LAYER_STATUS.FAIL,
      "SOD_BLOCKED",
      "Segregation-of-duties rules block this action.",
      evaluation,
      evaluation.blockingFindings
    );
  }

  return buildLayerResult(
    DIAGNOSTIC_LAYER_STATUS.PASS,
    evaluation.warningFindings.length > 0 ? "SOD_WARNING" : "SOD_CLEAR",
    evaluation.warningFindings.length > 0
      ? "SoD warnings exist, but no blocking same-record conflict applies."
      : "No blocking SoD conflict applies.",
    evaluation,
    evaluation.warningFindings
  );
}

async function evaluateWorkflowLayer({
  tenantId,
  targetUserId,
  workflowRequestId,
  workflowGate,
  runQuery = query,
}) {
  if (!workflowRequestId && !workflowGate) {
    return buildLayerResult(
      DIAGNOSTIC_LAYER_STATUS.NOT_APPLICABLE,
      "WORKFLOW_NOT_REQUESTED",
      "No workflow or approval-request target was provided."
    );
  }

  if (workflowRequestId) {
    const diagnostics = await getRequestDiagnostics(workflowRequestId);
    if (parsePositiveInt(diagnostics?.request?.tenantId) !== tenantId) {
      throw forbidden("Workflow request does not belong to the authenticated tenant");
    }
    const currentStep = diagnostics?.currentStep || null;
    if (!currentStep) {
      return buildLayerResult(
        DIAGNOSTIC_LAYER_STATUS.SKIPPED,
        "WORKFLOW_STEP_NOT_ACTIVE",
        "The approval request has no active review step.",
        diagnostics
      );
    }

    const allowed = (diagnostics.availableApproverUserIds || []).includes(targetUserId);
    return buildLayerResult(
      allowed ? DIAGNOSTIC_LAYER_STATUS.PASS : DIAGNOSTIC_LAYER_STATUS.FAIL,
      allowed ? "WORKFLOW_STEP_ALLOWED" : "WORKFLOW_STEP_DENIED",
      allowed
        ? "User is eligible to act on the current workflow step."
        : "User is not eligible to act on the current workflow step.",
      diagnostics
    );
  }

  if (!workflowGate?.processType || !workflowGate?.targetType || !workflowGate?.targetId) {
    return buildLayerResult(
      DIAGNOSTIC_LAYER_STATUS.SKIPPED,
      "WORKFLOW_GATE_INPUT_INCOMPLETE",
      "Workflow gate diagnostics require processType, targetType, and targetId."
    );
  }

  const gateResult = await evaluateWorkflowApprovalGate({
    tenantId,
    processType: workflowGate.processType,
    targetType: workflowGate.targetType,
    targetId: workflowGate.targetId,
    requestedByUserId: workflowGate.requestedByUserId || targetUserId,
    scope: workflowGate.scope || {},
    effectiveOn: workflowGate.effectiveOn,
    runQuery,
  });

  const allowed = !gateResult.required || gateResult.approved;
  return buildLayerResult(
    allowed ? DIAGNOSTIC_LAYER_STATUS.PASS : DIAGNOSTIC_LAYER_STATUS.FAIL,
    allowed ? "WORKFLOW_GATE_CLEAR" : gateResult.errorCode || "WORKFLOW_GATE_BLOCKED",
    allowed
      ? "Workflow gate does not block the requested action."
      : gateResult.message || "Workflow gate blocks the requested action.",
    gateResult
  );
}

function evaluateBusinessStateLayer(businessState) {
  if (!businessState) {
    return buildLayerResult(
      DIAGNOSTIC_LAYER_STATUS.NOT_APPLICABLE,
      "BUSINESS_STATE_NOT_REQUESTED",
      "No business-state payload was provided."
    );
  }

  const allowed =
    typeof businessState.allowed === "boolean"
      ? businessState.allowed
      : businessState.blockers.length === 0;

  return buildLayerResult(
    allowed ? DIAGNOSTIC_LAYER_STATUS.PASS : DIAGNOSTIC_LAYER_STATUS.FAIL,
    businessState.statusCode || (allowed ? "BUSINESS_STATE_CLEAR" : "BUSINESS_STATE_BLOCKED"),
    businessState.message ||
      (allowed
        ? "Business-state checks do not block the requested action."
        : "Business-state checks block the requested action."),
    businessState.details,
    businessState.blockers
  );
}

function computeOverallDecision(layers) {
  const statuses = Object.values(layers || {}).map((layer) => layer?.status);
  if (statuses.includes(DIAGNOSTIC_LAYER_STATUS.FAIL)) {
    return {
      status: DIAGNOSTIC_LAYER_STATUS.FAIL,
      allowed: false,
    };
  }
  if (statuses.includes(DIAGNOSTIC_LAYER_STATUS.PASS)) {
    return {
      status: DIAGNOSTIC_LAYER_STATUS.PASS,
      allowed: true,
    };
  }
  if (statuses.includes(DIAGNOSTIC_LAYER_STATUS.SKIPPED)) {
    return {
      status: DIAGNOSTIC_LAYER_STATUS.SKIPPED,
      allowed: false,
    };
  }
  return {
    status: DIAGNOSTIC_LAYER_STATUS.NOT_APPLICABLE,
    allowed: false,
  };
}

/**
 * Evaluate one explainable access-check chain for self-service debugging or
 * elevated admin diagnostics.
 */
export async function evaluateAccessCheck(input, options = {}) {
  const normalized = normalizeInput(input);
  const runQuery = typeof options?.runQuery === "function" ? options.runQuery : query;

  await assertAccessCheckTargetAllowed({
    actorUserId: normalized.actorUserId,
    targetUserId: normalized.targetUserId,
    tenantId: normalized.tenantId,
    runQuery,
  });

  const [capabilityResult, entitlements] = await Promise.all([
    evaluateCapabilityLayer({
      tenantId: normalized.tenantId,
      targetUserId: normalized.targetUserId,
      permissionCode: normalized.permissionCode,
      runQuery,
    }),
    loadUserEntitlements({
      tenantId: normalized.tenantId,
      userId: normalized.targetUserId,
      runQuery,
    }),
  ]);

  const scopeEntitlement = evaluateScopeEntitlementLayer({
    capabilityLayer: capabilityResult.layer,
    bundle: capabilityResult.bundle,
    requestedScope: normalized.requestedScope,
    permissionCode: normalized.permissionCode,
  });

  const visibilityPolicy = evaluateVisibilityPolicyLayer({
    capabilityLayer: capabilityResult.layer,
    bundle: capabilityResult.bundle,
    requestedScope: normalized.requestedScope,
    entitlements,
  });

  const [fieldVisibility, sod, workflow] = await Promise.all([
    evaluateFieldVisibilityLayer({
      tenantId: normalized.tenantId,
      targetUserId: normalized.targetUserId,
      moduleCode: normalized.moduleCode,
      objectType: normalized.objectType,
      fieldName: normalized.fieldName,
      requestedScope: normalized.requestedScope,
      runQuery,
    }),
    evaluateSoDLayer({
      tenantId: normalized.tenantId,
      targetUserId: normalized.targetUserId,
      actionCode: normalized.actionCode,
      recordType: normalized.recordType,
      recordId: normalized.recordId,
      context: normalized.sodContext,
    }),
    evaluateWorkflowLayer({
      tenantId: normalized.tenantId,
      targetUserId: normalized.targetUserId,
      workflowRequestId: normalized.workflowRequestId,
      workflowGate: normalized.workflowGate,
      runQuery,
    }),
  ]);

  const businessState = evaluateBusinessStateLayer(normalized.businessState);

  const layers = {
    capability: capabilityResult.layer,
    scopeEntitlement,
    visibilityPolicy,
    sod,
    workflow,
    businessState,
    fieldVisibility,
  };

  return {
    tenantId: normalized.tenantId,
    actorUserId: normalized.actorUserId,
    targetUserId: normalized.targetUserId,
    selfCheck: normalized.actorUserId === normalized.targetUserId,
    requested: {
      permissionCode: normalized.permissionCode,
      scope: normalized.requestedScope,
      moduleCode: normalized.moduleCode || null,
      objectType: normalized.objectType || null,
      fieldName: normalized.fieldName,
      actionCode: normalized.actionCode,
      recordType: normalized.recordType || null,
      recordId: normalized.recordId || null,
      workflowRequestId: normalized.workflowRequestId || null,
      workflowGate: normalized.workflowGate,
    },
    entitlements: {
      permissions: entitlements.permissions || [],
      visibilityOverrides: entitlements.visibilityOverrides || [],
      scopeSummary: entitlements.scopeSummary || null,
      isVisibilityNarrowed: Boolean(entitlements.isVisibilityNarrowed),
      maskedFields: entitlements.maskedFields || [],
    },
    decision: computeOverallDecision(layers),
    layers,
  };
}

export default {
  evaluateAccessCheck,
};
