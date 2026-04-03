import { useCallback, useEffect, useMemo, useState } from "react";
import { api, setOnUnauthorized } from "../api/client";
import { getSecurityAdminUiState } from "../api/rbacAdmin.js";
import { AuthContext } from "./authContext.js";
import { getMeEntitlements } from "../api/me.js";
import {
  buildEmptyEntitlementsResponse,
  evaluatePermissionAccess,
  normalizeEntitlementsResponse,
} from "./permissionAccess.js";

function normalizeFeatureCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function shouldLoadSecurityAdminUiState(permissionCodes) {
  const normalizedPermissionCodes = Array.isArray(permissionCodes) ? permissionCodes : [];
  return normalizedPermissionCodes.includes("security.role.read");
}

/**
 * Bootstraps the authenticated user, entitlement bundle, and small admin-only
 * UI state needed for sidebar simplification and governance surfaces.
 */
export function AuthProvider({ children }) {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [featureCodes, setFeatureCodes] = useState([]);
  const [entitlements, setEntitlements] = useState(buildEmptyEntitlementsResponse());
  const [securityAdminUiState, setSecurityAdminUiState] = useState(null);
  const [securityAdminUiStateLoaded, setSecurityAdminUiStateLoaded] = useState(false);
  const [booting, setBooting] = useState(true);

  const isAuthed = Boolean(user);

  const clearAuthState = useCallback(() => {
    setToken(null);
    setUser(null);
    setPermissions([]);
    setFeatureCodes([]);
    setEntitlements(buildEmptyEntitlementsResponse());
    setSecurityAdminUiState(null);
    setSecurityAdminUiStateLoaded(false);
  }, []);

  const applyMePayload = useCallback((payload) => {
    const permissionCodes = Array.isArray(payload?.permissionCodes)
      ? payload.permissionCodes.map((code) => String(code))
      : [];
    setUser(payload || null);
    setPermissions(permissionCodes);
  }, []);

  const applyEntitlementsPayload = useCallback((payload, mePayload = null) => {
    setEntitlements(
      normalizeEntitlementsResponse(payload, {
        tenantId: mePayload?.tenant_id,
        userId: mePayload?.id,
      })
    );
  }, []);

  const loadAuthBootstrap = useCallback(async () => {
    const meResponse = await api.get("/me", { skipAuthRedirect: true });
    const mePayload = meResponse?.data || null;
    const permissionCodes = Array.isArray(mePayload?.permissionCodes)
      ? mePayload.permissionCodes.map((code) => String(code))
      : [];
    applyMePayload(mePayload);

    const bootstrapTasks = [
      getMeEntitlements(),
      api.get("/me/features", { skipAuthRedirect: true }),
    ];
    if (shouldLoadSecurityAdminUiState(permissionCodes)) {
      bootstrapTasks.push(getSecurityAdminUiState());
    }
    const [entitlementsResult, featuresResult, securityAdminUiStateResult] =
      await Promise.allSettled(bootstrapTasks);

    if (entitlementsResult.status === "fulfilled") {
      applyEntitlementsPayload(entitlementsResult.value, mePayload);
    } else {
      applyEntitlementsPayload(null, mePayload);
    }

    if (featuresResult.status === "fulfilled") {
      const enabledFeatureCodes = Array.isArray(featuresResult.value?.data?.enabledFeatureCodes)
        ? featuresResult.value.data.enabledFeatureCodes
            .map((code) => normalizeFeatureCode(code))
            .filter(Boolean)
        : [];
      setFeatureCodes(enabledFeatureCodes);
    } else {
      setFeatureCodes([]);
    }

    if (shouldLoadSecurityAdminUiState(permissionCodes)) {
      if (securityAdminUiStateResult?.status === "fulfilled") {
        setSecurityAdminUiState(securityAdminUiStateResult.value || null);
      } else {
        setSecurityAdminUiState(null);
      }
    } else {
      setSecurityAdminUiState(null);
    }
    setSecurityAdminUiStateLoaded(true);

    return mePayload;
  }, [applyEntitlementsPayload, applyMePayload]);

  useEffect(() => {
    (async () => {
      try {
        await loadAuthBootstrap();
        setToken("cookie-session");
      } catch {
        clearAuthState();
      } finally {
        setBooting(false);
      }
    })();
  }, [clearAuthState, loadAuthBootstrap]);

  useEffect(() => {
    setOnUnauthorized(() => {
      clearAuthState();
      window.location.href = "/login";
    });
  }, [clearAuthState]);

  const login = useCallback(async (email, password) => {
    await api.post(
      "/auth/login",
      { email, password },
      { skipAuthRedirect: true }
    );
    await loadAuthBootstrap();
    setToken("cookie-session");
  }, [loadAuthBootstrap]);

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout", null, { skipAuthRedirect: true });
    } catch {
      // Ignore logout API failures and clear local auth state anyway.
    }
    clearAuthState();
  }, [clearAuthState]);

  const featureSet = useMemo(() => new Set(featureCodes), [featureCodes]);
  const scopeSummary = useMemo(
    () =>
      entitlements?.scopeSummary || {
        permissionScopeContext: null,
        visibilityScopeContext: null,
      },
    [entitlements]
  );
  const isVisibilityNarrowed = Boolean(entitlements?.isVisibilityNarrowed);

  const hasPermission = useCallback(
    (permissionCode, options = undefined) => {
      return evaluatePermissionAccess(permissionCode, permissions, entitlements, options)
        .allowed;
    },
    [entitlements, permissions]
  );

  const getPermissionAccess = useCallback(
    (permissionCode, options = undefined) =>
      evaluatePermissionAccess(permissionCode, permissions, entitlements, options),
    [entitlements, permissions]
  );

  const hasAnyPermission = useCallback(
    (permissionCodes, options = undefined) => {
      if (!Array.isArray(permissionCodes) || permissionCodes.length === 0) {
        return true;
      }
      return permissionCodes.some((permissionCode) =>
        hasPermission(permissionCode, options)
      );
    },
    [hasPermission]
  );

  const hasAllPermissions = useCallback(
    (permissionCodes, options = undefined) => {
      if (!Array.isArray(permissionCodes) || permissionCodes.length === 0) {
        return true;
      }
      return permissionCodes.every((permissionCode) =>
        hasPermission(permissionCode, options)
      );
    },
    [hasPermission]
  );

  const hasFeature = useCallback(
    (featureCode) => {
      const code = normalizeFeatureCode(featureCode);
      if (!code) {
        return false;
      }
      return featureSet.has(code);
    },
    [featureSet]
  );

  const hasAnyFeature = useCallback(
    (featureCodesToCheck) => {
      if (!Array.isArray(featureCodesToCheck) || featureCodesToCheck.length === 0) {
        return true;
      }
      return featureCodesToCheck.some((featureCode) => hasFeature(featureCode));
    },
    [hasFeature]
  );

  const value = useMemo(
    () => ({
      token,
      user,
      permissions,
      featureCodes,
      entitlements,
      securityAdminUiState,
      securityAdminUiStateLoaded,
      scopeSummary,
      isVisibilityNarrowed,
      maskedFields: entitlements?.maskedFields || [],
      isAuthed,
      booting,
      login,
      logout,
      hasPermission,
      getPermissionAccess,
      hasAnyPermission,
      hasAllPermissions,
      hasFeature,
      hasAnyFeature,
    }),
    [
      token,
      user,
      permissions,
      featureCodes,
      entitlements,
      securityAdminUiState,
      securityAdminUiStateLoaded,
      scopeSummary,
      isVisibilityNarrowed,
      isAuthed,
      booting,
      login,
      logout,
      hasPermission,
      getPermissionAccess,
      hasAnyPermission,
      hasAllPermissions,
      hasFeature,
      hasAnyFeature,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
