import {
  PERIOD_CLOSE_ADMIN_PERMISSION_CODE,
  PERIOD_CLOSE_APPROVE_PERMISSION_CODE,
  PERIOD_CLOSE_EXECUTE_PERMISSION_CODE,
  PERIOD_CLOSE_READINESS_PERMISSION_CODE,
  PERIOD_CLOSE_REOPEN_PERMISSION_CODE,
  PERIOD_CLOSE_VIEW_PERMISSION_CODES,
} from "../../../shared/periodCloseGovernance.js";

const VALID_SCOPE_TYPES = new Set([
  "TENANT",
  "GROUP",
  "COUNTRY",
  "LEGAL_ENTITY",
  "OPERATING_UNIT",
]);

function parsePositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizePermissionCode(value) {
  return String(value || "").trim();
}

function normalizeScopeType(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  return VALID_SCOPE_TYPES.has(normalized) ? normalized : "";
}

function normalizeScopeCandidate(scope) {
  if (!scope || typeof scope !== "object") {
    return null;
  }
  const scopeType = normalizeScopeType(scope.scopeType);
  const scopeId = parsePositiveInt(scope.scopeId);
  if (!scopeType || !scopeId) {
    return null;
  }
  return { scopeType, scopeId };
}

function normalizeRequestedScopes(options = {}) {
  const explicitScopes = Array.isArray(options.scopes) ? options.scopes : [];
  const singleScope = options.scope ? [options.scope] : [];
  return [...singleScope, ...explicitScopes]
    .map((scope) => normalizeScopeCandidate(scope))
    .filter(Boolean);
}

function normalizePermissionRow(row) {
  const code = normalizePermissionCode(row?.code);
  const scopeType = normalizeScopeType(row?.scopeType);
  const scopeIds = Array.from(
    new Set(
      (Array.isArray(row?.scopeIds) ? row.scopeIds : [])
        .map((scopeId) => parsePositiveInt(scopeId))
        .filter(Boolean)
    )
  ).sort((left, right) => left - right);

  if (!code || !scopeType || scopeIds.length === 0) {
    return null;
  }

  return {
    code,
    scopeType,
    scopeIds,
    visibilityNarrowed: Boolean(row?.visibilityNarrowed),
  };
}

function normalizeScopeSummary(scopeSummary = {}) {
  const permissionScopeContext = scopeSummary?.permissionScopeContext || null;
  const visibilityScopeContext = scopeSummary?.visibilityScopeContext || null;

  return {
    permissionScopeContext,
    visibilityScopeContext,
  };
}

function permissionRowMatchesScope(row, scope) {
  if (!row || !scope) {
    return false;
  }
  if (row.scopeType === "TENANT") {
    return true;
  }
  if (row.scopeType !== scope.scopeType) {
    return false;
  }
  return row.scopeIds.includes(scope.scopeId);
}

/**
 * Build the stable empty entitlements shape expected by the frontend auth layer.
 */
export function buildEmptyEntitlementsResponse(overrides = {}) {
  return {
    tenantId: parsePositiveInt(overrides?.tenantId),
    userId: parsePositiveInt(overrides?.userId),
    permissions: [],
    visibilityOverrides: [],
    scopeSummary: {
      permissionScopeContext: null,
      visibilityScopeContext: null,
    },
    isVisibilityNarrowed: false,
    maskedFields: [],
  };
}

/**
 * Normalize `/api/me/entitlements` so the frontend can safely evaluate scope
 * access even during partial rollout or backend fallback conditions.
 */
export function normalizeEntitlementsResponse(payload, fallback = {}) {
  const base = buildEmptyEntitlementsResponse(fallback);
  const permissions = Array.isArray(payload?.permissions)
    ? payload.permissions.map((row) => normalizePermissionRow(row)).filter(Boolean)
    : [];

  const visibilityOverrides = Array.isArray(payload?.visibilityOverrides)
    ? payload.visibilityOverrides
        .map((row) => {
          const scopeType = normalizeScopeType(row?.scopeType);
          const scopeId = parsePositiveInt(row?.scopeId);
          const effect = String(row?.effect || "")
            .trim()
            .toUpperCase();
          if (!scopeType || !scopeId || (effect !== "ALLOW" && effect !== "DENY")) {
            return null;
          }
          return { scopeType, scopeId, effect };
        })
        .filter(Boolean)
    : [];

  const maskedFields = Array.isArray(payload?.maskedFields)
    ? payload.maskedFields
        .map((fieldName) => String(fieldName || "").trim())
        .filter(Boolean)
    : [];

  return {
    tenantId: parsePositiveInt(payload?.tenantId) || base.tenantId,
    userId: parsePositiveInt(payload?.userId) || base.userId,
    permissions,
    visibilityOverrides,
    scopeSummary: normalizeScopeSummary(payload?.scopeSummary),
    isVisibilityNarrowed: Boolean(payload?.isVisibilityNarrowed),
    maskedFields,
  };
}

/**
 * Evaluate one permission against the current entitlements and an optional
 * requested scope so UI can distinguish missing permission vs wrong scope.
 */
export function evaluatePermissionAccess(
  permissionCode,
  permissionCodes = [],
  entitlements = null,
  options = {}
) {
  const code = normalizePermissionCode(permissionCode);
  const permissionSet = new Set(
    (Array.isArray(permissionCodes) ? permissionCodes : [])
      .map((value) => normalizePermissionCode(value))
      .filter(Boolean)
  );
  const normalizedEntitlements = normalizeEntitlementsResponse(entitlements);
  const requestedScopes = normalizeRequestedScopes(options);
  const primaryRequestedScope = requestedScopes[0] || null;
  const entitlementRows = normalizedEntitlements.permissions.filter(
    (row) => row.code === code
  );
  const hasPermission = code ? permissionSet.has(code) || entitlementRows.length > 0 : true;
  const visibilityNarrowed =
    Boolean(normalizedEntitlements.isVisibilityNarrowed) ||
    entitlementRows.some((row) => Boolean(row.visibilityNarrowed));

  if (!code) {
    return {
      code,
      allowed: true,
      hasPermission: true,
      missingPermission: false,
      wrongScope: false,
      visibilityNarrowed,
      scopeChecked: requestedScopes.length > 0,
      requestedScopes,
      requestedScope: primaryRequestedScope,
      status: "allowed",
    };
  }

  if (!hasPermission) {
    return {
      code,
      allowed: false,
      hasPermission: false,
      missingPermission: true,
      wrongScope: false,
      visibilityNarrowed,
      scopeChecked: requestedScopes.length > 0,
      requestedScopes,
      requestedScope: primaryRequestedScope,
      status: "missing_permission",
    };
  }

  if (requestedScopes.length === 0 || entitlementRows.length === 0) {
    return {
      code,
      allowed: true,
      hasPermission: true,
      missingPermission: false,
      wrongScope: false,
      visibilityNarrowed,
      scopeChecked: requestedScopes.length > 0,
      requestedScopes,
      requestedScope: primaryRequestedScope,
      status: "allowed",
    };
  }

  const scopeAllowed = requestedScopes.some((scope) =>
    entitlementRows.some((row) => permissionRowMatchesScope(row, scope))
  );

  if (scopeAllowed) {
    return {
      code,
      allowed: true,
      hasPermission: true,
      missingPermission: false,
      wrongScope: false,
      visibilityNarrowed,
      scopeChecked: true,
      requestedScopes,
      requestedScope: primaryRequestedScope,
      status: "allowed",
    };
  }

  return {
    code,
    allowed: false,
    hasPermission: true,
    missingPermission: false,
    wrongScope: true,
    visibilityNarrowed,
    scopeChecked: true,
    requestedScopes,
    requestedScope: primaryRequestedScope,
    status: "wrong_scope",
  };
}

function buildMissingPermissionAccess(code, options = {}) {
  const requestedScopes = normalizeRequestedScopes(options);
  return {
    code,
    allowed: false,
    hasPermission: false,
    missingPermission: true,
    wrongScope: false,
    visibilityNarrowed: false,
    scopeChecked: requestedScopes.length > 0,
    requestedScopes,
    requestedScope: requestedScopes[0] || null,
    status: "missing_permission",
  };
}

function evaluatePermissionAccessWith(getPermissionAccess, permissionCode, options = {}) {
  if (typeof getPermissionAccess !== "function") {
    return buildMissingPermissionAccess(permissionCode, options);
  }
  return getPermissionAccess(permissionCode, options);
}

function evaluateAnyPermissionAccessWith(
  getPermissionAccess,
  permissionCodes,
  options = {}
) {
  const normalizedPermissionCodes = Array.from(
    new Set(
      (Array.isArray(permissionCodes) ? permissionCodes : [])
        .map((permissionCode) => normalizePermissionCode(permissionCode))
        .filter(Boolean)
    )
  );
  const entries = normalizedPermissionCodes.map((permissionCode) =>
    evaluatePermissionAccessWith(getPermissionAccess, permissionCode, options)
  );
  const allowedEntry = entries.find((entry) => entry?.allowed) || null;
  const requestedScopes = normalizeRequestedScopes(options);
  const requestedScope = requestedScopes[0] || null;

  if (allowedEntry) {
    return {
      ...allowedEntry,
      code: allowedEntry.code || normalizedPermissionCodes[0] || "",
      anyPermissionCodes: normalizedPermissionCodes,
      matchedPermissionCode: allowedEntry.code || "",
      entries,
      requestedScopes,
      requestedScope,
    };
  }

  return {
    code: normalizedPermissionCodes[0] || "",
    allowed: false,
    hasPermission: entries.some((entry) => entry?.hasPermission),
    missingPermission: entries.every((entry) => entry?.missingPermission),
    wrongScope:
      entries.some((entry) => entry?.wrongScope) &&
      !entries.some((entry) => entry?.allowed),
    visibilityNarrowed: entries.some((entry) => entry?.visibilityNarrowed),
    scopeChecked: requestedScopes.length > 0,
    requestedScopes,
    requestedScope,
    status: entries.some((entry) => entry?.wrongScope)
      ? "wrong_scope"
      : "missing_permission",
    anyPermissionCodes: normalizedPermissionCodes,
    matchedPermissionCode: "",
    entries,
  };
}

/**
 * Evaluate scoped readiness access for period-close review surfaces.
 */
export function getPeriodCloseReviewAccess(getPermissionAccess, options = {}) {
  return evaluatePermissionAccessWith(
    getPermissionAccess,
    PERIOD_CLOSE_READINESS_PERMISSION_CODE,
    options
  );
}

/**
 * Evaluate scoped workflow-approval access for period close.
 */
export function getPeriodCloseApprovalAccess(getPermissionAccess, options = {}) {
  return evaluatePermissionAccessWith(
    getPermissionAccess,
    PERIOD_CLOSE_APPROVE_PERMISSION_CODE,
    options
  );
}

/**
 * Evaluate scoped execution access for the governed close run.
 */
export function getPeriodCloseExecutionAccess(getPermissionAccess, options = {}) {
  return evaluatePermissionAccessWith(
    getPermissionAccess,
    PERIOD_CLOSE_EXECUTE_PERMISSION_CODE,
    options
  );
}

/**
 * Evaluate scoped reopen access for period-close repair actions.
 */
export function getPeriodCloseReopenAccess(getPermissionAccess, options = {}) {
  return evaluatePermissionAccessWith(
    getPermissionAccess,
    PERIOD_CLOSE_REOPEN_PERMISSION_CODE,
    options
  );
}

/**
 * Evaluate scoped admin access for exceptional period-close controls.
 */
export function getPeriodCloseAdminAccess(getPermissionAccess, options = {}) {
  return evaluatePermissionAccessWith(
    getPermissionAccess,
    PERIOD_CLOSE_ADMIN_PERMISSION_CODE,
    options
  );
}

/**
 * Evaluate whether the current user can view period-close context at all.
 */
export function getPeriodCloseViewAccess(getPermissionAccess, options = {}) {
  return evaluateAnyPermissionAccessWith(
    getPermissionAccess,
    PERIOD_CLOSE_VIEW_PERMISSION_CODES,
    options
  );
}

/**
 * Check whether the current session carries readiness-review permission.
 */
export function hasPeriodCloseReviewPermission(hasPermission) {
  return Boolean(
    typeof hasPermission === "function" &&
      hasPermission(PERIOD_CLOSE_READINESS_PERMISSION_CODE)
  );
}

/**
 * Check whether the current session carries workflow-approval permission.
 */
export function hasPeriodCloseApprovalPermission(hasPermission) {
  return Boolean(
    typeof hasPermission === "function" &&
      hasPermission(PERIOD_CLOSE_APPROVE_PERMISSION_CODE)
  );
}

/**
 * Check whether the current session carries period-close execution permission.
 */
export function hasPeriodCloseExecutionPermission(hasPermission) {
  return Boolean(
    typeof hasPermission === "function" &&
      hasPermission(PERIOD_CLOSE_EXECUTE_PERMISSION_CODE)
  );
}

/**
 * Check whether the current session carries period-reopen permission.
 */
export function hasPeriodCloseReopenPermission(hasPermission) {
  return Boolean(
    typeof hasPermission === "function" &&
      hasPermission(PERIOD_CLOSE_REOPEN_PERMISSION_CODE)
  );
}

/**
 * Check whether the current session can view any period-close governance surface.
 */
export function hasAnyPeriodCloseViewPermission(hasPermission) {
  return Boolean(
    typeof hasPermission === "function" &&
      PERIOD_CLOSE_VIEW_PERMISSION_CODES.some((permissionCode) =>
        hasPermission(permissionCode)
      )
  );
}

/**
 * Return one user-facing missing-permission message for a period-close action.
 */
export function getPeriodCloseMissingPermissionMessage(action, l = (en) => en) {
  const normalizedAction = String(action || "").trim().toLowerCase();
  if (normalizedAction === "review") {
    return l(
      `Missing permission: ${PERIOD_CLOSE_READINESS_PERMISSION_CODE}`,
      `Eksik yetki: ${PERIOD_CLOSE_READINESS_PERMISSION_CODE}`
    );
  }
  if (normalizedAction === "approve") {
    return l(
      `Missing permission: ${PERIOD_CLOSE_APPROVE_PERMISSION_CODE}`,
      `Eksik yetki: ${PERIOD_CLOSE_APPROVE_PERMISSION_CODE}`
    );
  }
  if (normalizedAction === "execute") {
    return l(
      `Missing permission: ${PERIOD_CLOSE_EXECUTE_PERMISSION_CODE}`,
      `Eksik yetki: ${PERIOD_CLOSE_EXECUTE_PERMISSION_CODE}`
    );
  }
  if (normalizedAction === "reopen") {
    return l(
      `Missing permission: ${PERIOD_CLOSE_REOPEN_PERMISSION_CODE}`,
      `Eksik yetki: ${PERIOD_CLOSE_REOPEN_PERMISSION_CODE}`
    );
  }
  return l(
    "Missing period-close governance permission.",
    "Eksik donem kapanisi yonetisim yetkisi."
  );
}
