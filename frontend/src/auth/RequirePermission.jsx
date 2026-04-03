import { useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import AccessDebuggerModal from "../components/security/AccessDebuggerModal.jsx";
import { useI18n } from "../i18n/useI18n.js";
import { useAuth } from "./useAuth.js";

function collectDeniedPermissionCodes(accessRows = []) {
  return accessRows
    .filter((access) => access && !access.allowed)
    .map((access) => String(access.code || "").trim())
    .filter(Boolean);
}

function resolveDeniedState(accessRows = []) {
  if (accessRows.some((access) => access?.wrongScope)) {
    return "wrong_scope";
  }
  if (accessRows.some((access) => access?.missingPermission)) {
    return "missing_permission";
  }
  return "access_denied";
}

export default function RequirePermission({
  anyOf = [],
  allOf = [],
  scope = null,
  scopes = [],
  children,
}) {
  const { isAuthed, booting, getPermissionAccess } = useAuth();
  const { t } = useI18n();
  const location = useLocation();
  const [debugOpen, setDebugOpen] = useState(false);

  if (booting) {
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <div className="text-slate-600">{t("authGuards.loading")}</div>
      </div>
    );
  }

  if (!isAuthed) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  const accessOptions = { scope, scopes };
  const anyOfAccesses = Array.isArray(anyOf)
    ? anyOf.map((permissionCode) => getPermissionAccess(permissionCode, accessOptions))
    : [];
  const allOfAccesses = Array.isArray(allOf)
    ? allOf.map((permissionCode) => getPermissionAccess(permissionCode, accessOptions))
    : [];

  const anyOfAllowed =
    anyOfAccesses.length === 0 || anyOfAccesses.some((access) => access.allowed);
  const allOfAllowed = allOfAccesses.every((access) => access.allowed);
  const allowed = anyOfAllowed && allOfAllowed;

  if (!allowed) {
    const deniedAccesses = [
      ...(anyOfAllowed ? [] : anyOfAccesses),
      ...allOfAccesses.filter((access) => !access.allowed),
    ];
    const primaryDeniedAccess = deniedAccesses.find(Boolean) || null;
    const deniedState = resolveDeniedState(deniedAccesses);
    const deniedPermissionCodes = collectDeniedPermissionCodes(deniedAccesses);
    const visibilityNarrowed = deniedAccesses.some(
      (access) => access?.visibilityNarrowed
    );
    const debugPermissionCode = String(primaryDeniedAccess?.code || "").trim();
    const debugScope = primaryDeniedAccess?.requestedScope || null;
    const debugRequestPayload = debugPermissionCode
      ? {
          permissionCode: debugPermissionCode,
          ...(debugScope
            ? {
                scopeType: debugScope.scopeType,
                scopeId: debugScope.scopeId,
              }
            : {}),
        }
      : null;

    let description = t("authGuards.accessDeniedDescription");
    if (deniedState === "wrong_scope") {
      description = t("authGuards.scopeMismatchDescription");
    } else if (deniedState === "missing_permission") {
      description = t("authGuards.accessDeniedDescription");
    }

    return (
      <div className="mx-auto max-w-2xl rounded-xl border border-amber-200 bg-amber-50 p-5">
        <h2 className="text-lg font-semibold text-amber-900">
          {t("authGuards.accessDeniedTitle")}
        </h2>
        <p className="mt-1 text-sm text-amber-800">
          {description}
        </p>
        {deniedPermissionCodes.length > 0 ? (
          <p className="mt-2 text-xs text-amber-800">
            {t("authGuards.requiredPermissionsLabel")} {deniedPermissionCodes.join(", ")}
          </p>
        ) : null}
        {visibilityNarrowed ? (
          <p className="mt-2 text-xs text-amber-800">
            {t("authGuards.visibilityNarrowedDescription")}
          </p>
        ) : null}
        {debugRequestPayload ? (
          <button
            type="button"
            onClick={() => setDebugOpen(true)}
            className="mt-3 inline-flex rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
          >
            {t("accessDebugger.actions.whyCantIDoThis")}
          </button>
        ) : null}
        <AccessDebuggerModal
          open={debugOpen}
          onClose={() => setDebugOpen(false)}
          requestPayload={debugRequestPayload}
          title={t("accessDebugger.modal.title")}
          subtitle={t("accessDebugger.modal.subtitle")}
        />
      </div>
    );
  }

  return children;
}
