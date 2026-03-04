import { useCallback, useEffect, useMemo, useState } from "react";
import { api, setOnUnauthorized } from "../api/client";
import { AuthContext } from "./authContext.js";

function normalizeFeatureCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [featureCodes, setFeatureCodes] = useState([]);
  const [booting, setBooting] = useState(true);

  const isAuthed = Boolean(user);

  const clearAuthState = useCallback(() => {
    setToken(null);
    setUser(null);
    setPermissions([]);
    setFeatureCodes([]);
  }, []);

  const applyMePayload = useCallback((payload) => {
    const permissionCodes = Array.isArray(payload?.permissionCodes)
      ? payload.permissionCodes.map((code) => String(code))
      : [];
    setUser(payload || null);
    setPermissions(permissionCodes);
  }, []);

  const loadMeFeatures = useCallback(async () => {
    try {
      const response = await api.get("/me/features", { skipAuthRedirect: true });
      const enabledFeatureCodes = Array.isArray(response?.data?.enabledFeatureCodes)
        ? response.data.enabledFeatureCodes
            .map((code) => normalizeFeatureCode(code))
            .filter(Boolean)
        : [];
      setFeatureCodes(enabledFeatureCodes);
    } catch {
      setFeatureCodes([]);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/me", { skipAuthRedirect: true });
        applyMePayload(res.data);
        await loadMeFeatures();
        setToken("cookie-session");
      } catch {
        clearAuthState();
      } finally {
        setBooting(false);
      }
    })();
  }, [applyMePayload, clearAuthState, loadMeFeatures]);

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
    const me = await api.get("/me", { skipAuthRedirect: true });
    applyMePayload(me.data);
    await loadMeFeatures();
    setToken("cookie-session");
  }, [applyMePayload, loadMeFeatures]);

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout", null, { skipAuthRedirect: true });
    } catch {
      // Ignore logout API failures and clear local auth state anyway.
    }
    clearAuthState();
  }, [clearAuthState]);

  const permissionSet = useMemo(() => new Set(permissions), [permissions]);
  const featureSet = useMemo(() => new Set(featureCodes), [featureCodes]);

  const hasPermission = useCallback(
    (permissionCode) => {
      const code = String(permissionCode || "").trim();
      if (!code) {
        return true;
      }
      return permissionSet.has(code);
    },
    [permissionSet]
  );

  const hasAnyPermission = useCallback(
    (permissionCodes) => {
      if (!Array.isArray(permissionCodes) || permissionCodes.length === 0) {
        return true;
      }
      return permissionCodes.some((permissionCode) =>
        hasPermission(permissionCode)
      );
    },
    [hasPermission]
  );

  const hasAllPermissions = useCallback(
    (permissionCodes) => {
      if (!Array.isArray(permissionCodes) || permissionCodes.length === 0) {
        return true;
      }
      return permissionCodes.every((permissionCode) =>
        hasPermission(permissionCode)
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
      isAuthed,
      booting,
      login,
      logout,
      hasPermission,
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
      isAuthed,
      booting,
      login,
      logout,
      hasPermission,
      hasAnyPermission,
      hasAllPermissions,
      hasFeature,
      hasAnyFeature,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
