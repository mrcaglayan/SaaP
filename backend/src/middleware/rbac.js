import { badRequest, parsePositiveInt, resolveTenantId } from "../routes/_utils.js";
import {
  assertScopeAccessForContext,
  buildScopeFilterFromContext,
  getPermissionBundleForRequest,
  getPermissionScopeContext,
  getVisibilityScopeContext,
  hasScopeAccessForContext,
  invalidateAuthzScopeCache,
  isScopeAllowed,
  normalizeAuthzScope,
  resolveRequestScope,
} from "../services/authz.scope.service.js";

function forbidden(message) {
  const err = new Error(message);
  err.status = 403;
  return err;
}

function scopesEqual(left, right) {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return left.scopeType === right.scopeType && left.scopeId === right.scopeId;
}

export async function invalidateRbacCache(tenantId) {
  return invalidateAuthzScopeCache(tenantId);
}

/**
 * Return the visibility scope context for the current request.
 *
 * Visibility scope determines what data the user can *see* (list filtering).
 * Falls back to permission scope when no explicit data-scope narrowing exists.
 */
export function getVisibilityScope(req) {
  return getVisibilityScopeContext(req) || getPermissionScopeContext(req);
}

/**
 * Return the permission scope context for the current request.
 *
 * Permission scope determines where the user can *act* (mutation/action guards).
 */
export function getPermissionScope(req) {
  return getPermissionScopeContext(req);
}

/**
 * Check whether the user's permission scope includes the given scope-kind/id.
 * Use this for mutation/action authorization guards.
 */
export function hasScopeAccess(req, scopeKind, scopeId) {
  return hasScopeAccessForContext(getPermissionScope(req), scopeKind, scopeId);
}

/**
 * Assert that the user's permission scope includes the given scope-kind/id.
 * Use this for mutation/action authorization guards.
 */
export function assertScopeAccess(req, scopeKind, scopeId, label = "scope") {
  return assertScopeAccessForContext(getPermissionScope(req), scopeKind, scopeId, label);
}

/**
 * Assert that the authenticated user also holds `permissionCode` without
 * replacing or overwriting the existing `req.rbac` context that was set by
 * `requirePermission(...)`.
 */
export async function assertSecondaryPermission(req, permissionCode, options = {}) {
  const normalizedCode = String(permissionCode || "").trim();
  if (!normalizedCode) {
    throw new Error("permissionCode is required for assertSecondaryPermission");
  }

  const userId = parsePositiveInt(req.user?.userId);
  if (!userId) {
    throw badRequest("Authenticated user is required");
  }

  const tenantId = resolveTenantId(req);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }

  const bundle = await getPermissionBundleForRequest(req, userId, tenantId, normalizedCode);
  if (bundle?.missingPermission || !bundle?.permissionScopeContext) {
    throw forbidden(`Missing secondary permission: ${normalizedCode}`);
  }

  const primaryRequestedScope = resolveRequestScope(req, tenantId);
  let requestedScope = primaryRequestedScope;

  if (typeof options.resolveScope === "function") {
    const rawSecondaryScope = await options.resolveScope(req, tenantId);
    const secondaryRequestedScope = normalizeAuthzScope(rawSecondaryScope, tenantId);
    const matchPrimaryScope = options.matchPrimaryScope !== false;

    if (
      matchPrimaryScope &&
      primaryRequestedScope &&
      secondaryRequestedScope &&
      !scopesEqual(primaryRequestedScope, secondaryRequestedScope)
    ) {
      throw forbidden(`Secondary permission scope mismatch: ${normalizedCode}`);
    }

    if (secondaryRequestedScope) {
      requestedScope = secondaryRequestedScope;
    }
  }

  // Permission scope: can the user act at this scope?
  if (!isScopeAllowed(bundle.permissionScopeContext, requestedScope)) {
    throw forbidden(`Missing secondary permission: ${normalizedCode}`);
  }

  // Visibility scope: can the user access data at this scope?
  const visibilityScope = bundle.visibilityScopeContext || bundle.permissionScopeContext;
  if (requestedScope && !isScopeAllowed(visibilityScope, requestedScope)) {
    throw forbidden(`Secondary data scope denied: ${normalizedCode}`);
  }
  if (!requestedScope && !isScopeAllowed(visibilityScope, null)) {
    throw forbidden(`Secondary data scope denied: ${normalizedCode}`);
  }
}

/**
 * Build a scope-aware SQL WHERE filter using the user's visibility scope.
 * Use this for list queries that filter rows by the user's data access.
 */
export function buildScopeFilter(req, scopeKind, columnName, params) {
  return buildScopeFilterFromContext(getVisibilityScope(req), scopeKind, columnName, params);
}

/**
 * Require one permission code and attach the resolved RBAC bundle to `req.rbac`.
 */
export function requirePermission(permissionCode, options = {}) {
  const normalizedPermissionCode = String(permissionCode || "").trim();
  if (!normalizedPermissionCode) {
    throw new Error("permissionCode is required");
  }

  const resolveScope = options.resolveScope;

  return async (req, res, next) => {
    try {
      const userId = parsePositiveInt(req.user?.userId);
      if (!userId) {
        throw badRequest("Authenticated user is required");
      }

      const tenantId = resolveTenantId(req);
      if (!tenantId) {
        throw badRequest("tenantId is required");
      }

      const permissionBundle = await getPermissionBundleForRequest(
        req,
        userId,
        tenantId,
        normalizedPermissionCode
      );
      if (
        permissionBundle?.missingPermission ||
        !permissionBundle?.permissionScopeContext
      ) {
        throw forbidden(`Missing permission: ${normalizedPermissionCode}`);
      }

      let requestedScope = null;
      if (typeof resolveScope === "function") {
        const rawScope = await resolveScope(req, tenantId);
        requestedScope = normalizeAuthzScope(rawScope, tenantId);
      }

      // Permission scope: can the user act at this scope?
      if (!isScopeAllowed(permissionBundle.permissionScopeContext, requestedScope)) {
        throw forbidden(`Missing permission: ${normalizedPermissionCode}`);
      }

      // Visibility scope: can the user access data at this scope?
      const visibilityScope =
        permissionBundle.visibilityScopeContext || permissionBundle.permissionScopeContext;
      if (requestedScope && !isScopeAllowed(visibilityScope, requestedScope)) {
        throw forbidden(`Data scope denied: ${normalizedPermissionCode}`);
      }
      if (!requestedScope && !isScopeAllowed(visibilityScope, null)) {
        throw forbidden(`Data scope denied: ${normalizedPermissionCode}`);
      }

      req.rbac = {
        permissionCode: normalizedPermissionCode,
        tenantId,
        requestedScope,
        source: permissionBundle.source || "permission_scopes",
        permissionScopeContext: permissionBundle.permissionScopeContext,
        visibilityScopeContext: permissionBundle.visibilityScopeContext,
      };

      return next();
    } catch (err) {
      return next(err);
    }
  };
}

/**
 * Require at least one permission code from the supplied list and attach the
 * resolved RBAC bundle for whichever permission granted access.
 */
export function requireAnyPermission(permissionCodes, options = {}) {
  const normalizedPermissionCodes = Array.from(
    new Set(
      (Array.isArray(permissionCodes) ? permissionCodes : [])
        .map((permissionCode) => String(permissionCode || "").trim())
        .filter(Boolean)
    )
  );
  if (normalizedPermissionCodes.length === 0) {
    throw new Error("permissionCodes is required");
  }

  const resolveScope = options.resolveScope;

  return async (req, res, next) => {
    try {
      const userId = parsePositiveInt(req.user?.userId);
      if (!userId) {
        throw badRequest("Authenticated user is required");
      }

      const tenantId = resolveTenantId(req);
      if (!tenantId) {
        throw badRequest("tenantId is required");
      }

      let requestedScope = null;
      if (typeof resolveScope === "function") {
        const rawScope = await resolveScope(req, tenantId);
        requestedScope = normalizeAuthzScope(rawScope, tenantId);
      }

      for (const permissionCode of normalizedPermissionCodes) {
        // eslint-disable-next-line no-await-in-loop
        const permissionBundle = await getPermissionBundleForRequest(
          req,
          userId,
          tenantId,
          permissionCode
        );
        if (
          permissionBundle?.missingPermission ||
          !permissionBundle?.permissionScopeContext
        ) {
          continue;
        }

        if (!isScopeAllowed(permissionBundle.permissionScopeContext, requestedScope)) {
          continue;
        }

        const visibilityScope =
          permissionBundle.visibilityScopeContext || permissionBundle.permissionScopeContext;
        if (requestedScope && !isScopeAllowed(visibilityScope, requestedScope)) {
          continue;
        }
        if (!requestedScope && !isScopeAllowed(visibilityScope, null)) {
          continue;
        }

        req.rbac = {
          permissionCode,
          tenantId,
          requestedScope,
          source: permissionBundle.source || "permission_scopes",
          permissionScopeContext: permissionBundle.permissionScopeContext,
          visibilityScopeContext: permissionBundle.visibilityScopeContext,
        };
        return next();
      }

      throw forbidden(
        `Missing any permission: ${normalizedPermissionCodes.join(", ")}`
      );
    } catch (err) {
      return next(err);
    }
  };
}
