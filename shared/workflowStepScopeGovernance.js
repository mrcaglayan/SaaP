function freezeScopeTypes(scopeTypes) {
  return Object.freeze([...scopeTypes]);
}

export const WORKFLOW_STEP_ALLOWED_SCOPE_TYPES_BY_PERMISSION = Object.freeze({
  "ouclose.prepare": freezeScopeTypes(["LEGAL_ENTITY"]),
  "ouclose.review": freezeScopeTypes(["LEGAL_ENTITY", "COUNTRY"]),
  "ouclose.approve": freezeScopeTypes(["LEGAL_ENTITY", "COUNTRY"]),
  "ouclose.lock": freezeScopeTypes(["LEGAL_ENTITY", "COUNTRY"]),
  "ouclose.reopen": freezeScopeTypes(["COUNTRY", "GROUP"]),
  "ouclose.admin": freezeScopeTypes(["COUNTRY", "GROUP"]),
  "ouclose.override_post_lock": freezeScopeTypes(["COUNTRY", "GROUP"]),
  "consolidation.run.create": freezeScopeTypes([
    "OPERATING_UNIT",
    "LEGAL_ENTITY",
    "GROUP",
  ]),
  "consolidation.run.execute": freezeScopeTypes([
    "OPERATING_UNIT",
    "LEGAL_ENTITY",
    "GROUP",
  ]),
  "consolidation.adjustment.post": freezeScopeTypes([
    "OPERATING_UNIT",
    "LEGAL_ENTITY",
    "GROUP",
  ]),
  "consolidation.elimination.post": freezeScopeTypes([
    "OPERATING_UNIT",
    "LEGAL_ENTITY",
    "GROUP",
  ]),
  "consolidation.run.finalize": freezeScopeTypes([
    "OPERATING_UNIT",
    "LEGAL_ENTITY",
    "GROUP",
  ]),
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
