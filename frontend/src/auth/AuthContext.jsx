import { useCallback, useEffect, useMemo, useState } from "react";
import { api, setOnUnauthorized } from "../api/client";
import { AuthContext } from "./authContext.js";

export function AuthProvider({ children }) {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [booting, setBooting] = useState(true);

  const isAuthed = !!token;

  const clearAuthState = useCallback(() => {
    localStorage.removeItem("token");
    setToken(null);
    setUser(null);
    setPermissions([]);
  }, []);

  const applyMePayload = useCallback((payload) => {
    const permissionCodes = Array.isArray(payload?.permissionCodes)
      ? payload.permissionCodes.map((code) => String(code))
      : [];
    setUser(payload || null);
    setPermissions(permissionCodes);
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem("token");
    if (!stored) {
      setBooting(false);
      return;
    }

    setToken(stored);

    (async () => {
      try {
        const res = await api.get("/me");
        applyMePayload(res.data);
      } catch {
        clearAuthState();
      } finally {
        setBooting(false);
      }
    })();
  }, [applyMePayload, clearAuthState]);

  useEffect(() => {
    setOnUnauthorized(() => {
      clearAuthState();
      window.location.href = "/login";
    });
  }, [clearAuthState]);

  const login = useCallback(async (email, password) => {
    const res = await api.post("/auth/login", { email, password });
    const newToken = res.data?.token;

    if (!newToken) {
      throw new Error("Login response did not include token");
    }

    localStorage.setItem("token", newToken);
    setToken(newToken);

    try {
      const me = await api.get("/me");
      applyMePayload(me.data);
    } catch {
      // /me lookup failed, but login itself succeeded.
    }
  }, [applyMePayload]);

  const logout = useCallback(() => {
    clearAuthState();
  }, [clearAuthState]);

  const permissionSet = useMemo(() => new Set(permissions), [permissions]);

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

  const value = useMemo(
    () => ({
      token,
      user,
      permissions,
      isAuthed,
      booting,
      login,
      logout,
      hasPermission,
      hasAnyPermission,
      hasAllPermissions,
    }),
    [
      token,
      user,
      permissions,
      isAuthed,
      booting,
      login,
      logout,
      hasPermission,
      hasAnyPermission,
      hasAllPermissions,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
