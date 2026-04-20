export const PERIOD_CLOSE_WORKFLOW_PROCESS_TYPE = "PERIOD_CLOSE";
export const PERIOD_CLOSE_RUN_TARGET_TYPE = "PERIOD_CLOSE_RUN";

export const PERIOD_CLOSE_LEGACY_PERMISSION_CODE = "gl.period.close";
export const PERIOD_CLOSE_READINESS_PERMISSION_CODE = "org.fiscal_period.read";
export const PERIOD_CLOSE_APPROVE_PERMISSION_CODE = "gl.period.close.approve";
export const PERIOD_CLOSE_EXECUTE_PERMISSION_CODE = "gl.period.close.execute";
export const PERIOD_CLOSE_REOPEN_PERMISSION_CODE = "gl.period.reopen";
export const PERIOD_CLOSE_ADMIN_PERMISSION_CODE = "gl.period.admin";
export const PERIOD_CLOSE_CLOSED_POST_PERMISSION_CODE =
  "gl.journal.post_to_closed_period";

export const PERIOD_CLOSE_ALLOWED_SCOPE_TYPES_BY_PERMISSION = Object.freeze({
  [PERIOD_CLOSE_READINESS_PERMISSION_CODE]: Object.freeze([
    "LEGAL_ENTITY",
    "COUNTRY",
    "GROUP",
  ]),
  [PERIOD_CLOSE_APPROVE_PERMISSION_CODE]: Object.freeze([
    "LEGAL_ENTITY",
    "COUNTRY",
    "GROUP",
  ]),
  [PERIOD_CLOSE_EXECUTE_PERMISSION_CODE]: Object.freeze([
    "LEGAL_ENTITY",
    "COUNTRY",
  ]),
  [PERIOD_CLOSE_REOPEN_PERMISSION_CODE]: Object.freeze([
    "LEGAL_ENTITY",
    "COUNTRY",
  ]),
  [PERIOD_CLOSE_ADMIN_PERMISSION_CODE]: Object.freeze(["COUNTRY", "GROUP"]),
});

export const PERIOD_CLOSE_WORKFLOW_ALLOWED_PERMISSION_CODES = Object.freeze([
  PERIOD_CLOSE_READINESS_PERMISSION_CODE,
  PERIOD_CLOSE_APPROVE_PERMISSION_CODE,
]);

export const PERIOD_CLOSE_VIEW_PERMISSION_CODES = Object.freeze([
  PERIOD_CLOSE_READINESS_PERMISSION_CODE,
  PERIOD_CLOSE_APPROVE_PERMISSION_CODE,
  PERIOD_CLOSE_EXECUTE_PERMISSION_CODE,
  PERIOD_CLOSE_REOPEN_PERMISSION_CODE,
  PERIOD_CLOSE_ADMIN_PERMISSION_CODE,
]);

function normalizePermissionCode(value) {
  return String(value || "").trim();
}

function normalizeScopeType(value) {
  return String(value || "").trim().toUpperCase();
}

/**
 * Return whether one permission code is the retired single-close permission.
 */
export function isPeriodCloseLegacyPermissionCode(value) {
  return (
    normalizePermissionCode(value) === PERIOD_CLOSE_LEGACY_PERMISSION_CODE
  );
}

/**
 * Return whether one permission code is valid on a PERIOD_CLOSE workflow step.
 */
export function isPeriodCloseWorkflowStepPermissionCodeAllowed(value) {
  const normalizedPermissionCode = normalizePermissionCode(value);
  return PERIOD_CLOSE_WORKFLOW_ALLOWED_PERMISSION_CODES.includes(
    normalizedPermissionCode
  );
}

/**
 * Return whether one PERIOD_CLOSE workflow step list includes at least one
 * approval-semantic step.
 */
export function periodCloseWorkflowHasApprovalStep(steps) {
  return (Array.isArray(steps) ? steps : []).some(
    (step) =>
      normalizePermissionCode(
        step?.requiredPermissionCode ?? step?.required_permission_code
      ) === PERIOD_CLOSE_APPROVE_PERMISSION_CODE
  );
}

/**
 * Return whether one permission set includes governed period-close execution.
 */
export function rolePermissionSetIncludesPeriodCloseExecute(permissionCodes) {
  return (Array.isArray(permissionCodes) ? permissionCodes : [])
    .map((permissionCode) => normalizePermissionCode(permissionCode))
    .includes(PERIOD_CLOSE_EXECUTE_PERMISSION_CODE);
}

/**
 * Return whether one permission set still carries the retired close code.
 */
export function rolePermissionSetIncludesLegacyPeriodClose(permissionCodes) {
  return (Array.isArray(permissionCodes) ? permissionCodes : []).some(
    (permissionCode) => isPeriodCloseLegacyPermissionCode(permissionCode)
  );
}

/**
 * Return whether one period-close permission is valid at one scope type.
 */
export function isPeriodClosePermissionScopeAllowed(permissionCode, scopeType) {
  const normalizedPermissionCode = normalizePermissionCode(permissionCode);
  const normalizedScopeType = normalizeScopeType(scopeType);
  return (
    PERIOD_CLOSE_ALLOWED_SCOPE_TYPES_BY_PERMISSION[
      normalizedPermissionCode
    ] || []
  ).includes(normalizedScopeType);
}
