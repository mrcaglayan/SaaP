function freezeScopeTypes(scopeTypes) {
  return Object.freeze([...scopeTypes]);
}

// Consolidation workflow scopes are permission-specific.
//
// Important distinction:
// - COUNTRY is valid for close-task RBAC / visibility in the checklist module.
// - COUNTRY is not valid for creating/running/finalizing consolidation runs in v1.
//
// Current v1 consolidation model:
// - consolidation.run.create may be reviewed at LEGAL_ENTITY or GROUP scope.
// - execution, adjustment, elimination, and finalization are GROUP-level controls.
// - country-level sub-consolidation is intentionally not modeled yet.
const CONSOLIDATION_RUN_CREATE_WORKFLOW_SCOPE_TYPES = freezeScopeTypes([
  "LEGAL_ENTITY",
  "GROUP",
]);

const CONSOLIDATION_GROUP_WORKFLOW_SCOPE_TYPES = freezeScopeTypes(["GROUP"]);

export const WORKFLOW_STEP_ALLOWED_SCOPE_TYPES_BY_PERMISSION = Object.freeze({
  "ouclose.prepare": freezeScopeTypes(["LEGAL_ENTITY"]),
  "ouclose.review": freezeScopeTypes(["LEGAL_ENTITY", "COUNTRY"]),
  "ouclose.approve": freezeScopeTypes(["LEGAL_ENTITY", "COUNTRY"]),
  "ouclose.lock": freezeScopeTypes(["LEGAL_ENTITY", "COUNTRY"]),
  "ouclose.reopen": freezeScopeTypes(["COUNTRY", "GROUP"]),
  "ouclose.admin": freezeScopeTypes(["COUNTRY", "GROUP"]),
  "ouclose.override_post_lock": freezeScopeTypes(["COUNTRY", "GROUP"]),

  "consolidation.run.create": CONSOLIDATION_RUN_CREATE_WORKFLOW_SCOPE_TYPES,
  "consolidation.run.execute": CONSOLIDATION_GROUP_WORKFLOW_SCOPE_TYPES,
  "consolidation.adjustment.post": CONSOLIDATION_GROUP_WORKFLOW_SCOPE_TYPES,
  "consolidation.elimination.post": CONSOLIDATION_GROUP_WORKFLOW_SCOPE_TYPES,
  "consolidation.run.finalize": CONSOLIDATION_GROUP_WORKFLOW_SCOPE_TYPES,
});

function normalizeWorkflowStepPermissionCode(permissionCode) {
  return String(permissionCode || "").trim().toLowerCase();
}

function normalizeWorkflowStepScopeType(scopeType) {
  return String(scopeType || "").trim().toUpperCase();
}

/**
 * Return the supported workflow-step scopes for one permission-backed
 * authority. Unknown permissions intentionally return an empty list so callers
 * can preserve existing custom flows without inventing a hard restriction.
 */
export function getWorkflowStepAllowedScopeTypes(permissionCode) {
  return (
    WORKFLOW_STEP_ALLOWED_SCOPE_TYPES_BY_PERMISSION[
    normalizeWorkflowStepPermissionCode(permissionCode)
    ] || Object.freeze([])
  );
}

/**
 * Check whether one workflow-step scope is valid for a permission-backed
 * authority. Unknown permissions are treated as unconstrained.
 */
export function isWorkflowStepScopeAllowed(permissionCode, scopeType) {
  const allowedScopeTypes = getWorkflowStepAllowedScopeTypes(permissionCode);
  if (allowedScopeTypes.length === 0) {
    return true;
  }
  return allowedScopeTypes.includes(normalizeWorkflowStepScopeType(scopeType));
}