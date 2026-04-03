import { useState } from "react";
import AccessDebuggerModal from "../components/security/AccessDebuggerModal.jsx";
import { useI18n } from "../i18n/useI18n.js";

/**
 * Renders a small scope-aware authz explanation for disabled actions and
 * partially visible governed surfaces.
 */
export default function PermissionAccessNotice({
  access,
  permissionCode = "",
  className = "",
}) {
  const { t } = useI18n();
  const [debugOpen, setDebugOpen] = useState(false);

  if (!access || typeof access !== "object") {
    return null;
  }

  const lines = [];
  if (!access.allowed) {
    if (access.missingPermission) {
      lines.push(
        permissionCode
          ? t("authGuards.missingPermissionLine", { permission: permissionCode })
          : t("authGuards.accessDeniedDescription")
      );
    } else if (access.wrongScope) {
      lines.push(t("authGuards.scopeMismatchDescription"));
    }
  }

  if (access.visibilityNarrowed) {
    lines.push(t("authGuards.visibilityNarrowedDescription"));
  }

  if (lines.length === 0) {
    return null;
  }

  const classes = [
    "rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  const debugPermissionCode = String(permissionCode || access?.code || "").trim();
  const debugScope = access?.requestedScope || null;
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
  const debugButtonLabel = access.allowed
    ? t("accessDebugger.actions.explainAccess")
    : t("accessDebugger.actions.whyCantIDoThis");

  return (
    <>
      <div className={classes}>
        {lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
        {debugRequestPayload ? (
          <button
            type="button"
            onClick={() => setDebugOpen(true)}
            className="mt-3 inline-flex rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
          >
            {debugButtonLabel}
          </button>
        ) : null}
      </div>

      <AccessDebuggerModal
        open={debugOpen}
        onClose={() => setDebugOpen(false)}
        requestPayload={debugRequestPayload}
        title={t("accessDebugger.modal.title")}
        subtitle={t("accessDebugger.modal.subtitle")}
      />
    </>
  );
}
