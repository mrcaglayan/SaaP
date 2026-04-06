import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/useAuth.js";
import { useWorkingContext } from "../context/useWorkingContext.js";
import { useI18n } from "../i18n/useI18n.js";
import { useTenantReadiness } from "./useTenantReadiness.js";

const ENTITY_ACTIVATION_ROUTE = "/app/ayarlar/entity-aktivasyon-alani";
const SETUP_ALLOWLIST = new Set([
  "/app/ayarlar/sirket-ayarlari",
  "/app/ayarlar/organizasyon-yonetimi",
  ENTITY_ACTIVATION_ROUTE,
  "/app/ayarlar/hesap-plani-olustur",
  "/app/ayarlar/hesap-plani-ayarlari",
  "/app/ayarlar/workflow-kurulumu",
  "/app/ayarlar/sube-operatorleri",
  "/app/donem-sonu-islemler/yillik/kapanis-islemleri",
  "/app/donem-sonu-islemler/yillik/konsolidasyon-raporlari",
  "/app/donem-sonu-islemler/yillik/yerel-kapanis-paketleri",
]);

function isTenantSetupAllowedPath(pathname) {
  const normalizedPath = String(pathname || "").trim();
  if (SETUP_ALLOWLIST.has(normalizedPath)) {
    return true;
  }

  return normalizedPath.startsWith(
    "/app/donem-sonu-islemler/yillik/yerel-kapanis-paketleri/"
  );
}

function isSecurityAdminAllowedPath(pathname) {
  const normalizedPath = String(pathname || "").trim();
  return normalizedPath.startsWith("/app/ayarlar/rbac/");
}

/**
 * Redirects only genuine tenant bootstrap gaps to setup pages while allowing
 * scoped setup users to fall back to the entity activation workspace instead
 * of tenant-wide bootstrap pages they cannot complete themselves.
 */
export default function RequireTenantReadiness({ children }) {
  const location = useLocation();
  const { t } = useI18n();
  const { hasPermission } = useAuth();
  const { loadingBase, preferencesHydrated, workingContext } = useWorkingContext();
  const { loading, error, readiness, refresh } = useTenantReadiness();
  const canRunTenantSetup = hasPermission("onboarding.company.setup");
  const hasWorkingLegalEntity = Boolean(workingContext?.legalEntityId);
  const workingContextResolved =
    hasWorkingLegalEntity || (preferencesHydrated && !loadingBase);

  if (loading || (!canRunTenantSetup && !workingContextResolved)) {
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <div className="text-slate-600">{t("readinessGuard.checking")}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl rounded-xl border border-amber-200 bg-amber-50 p-5">
        <h2 className="text-lg font-semibold text-amber-900">
          {t("readinessGuard.failedTitle")}
        </h2>
        <p className="mt-1 text-sm text-amber-800">{error}</p>
        <button
          type="button"
          onClick={() => refresh()}
          className="mt-3 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm font-semibold text-amber-900"
        >
          {t("readinessGuard.retry")}
        </button>
      </div>
    );
  }

  if (readiness?.ready) {
    return children;
  }

  // Keep the close-control surfaces reachable even when tenant readiness is
  // incomplete so operators can inspect what is blocking close instead of
  // getting bounced to company settings first.
  const isSetupPage =
    isTenantSetupAllowedPath(location.pathname) ||
    isSecurityAdminAllowedPath(location.pathname);
  if (!isSetupPage) {
    if (!canRunTenantSetup && hasWorkingLegalEntity) {
      return <Navigate to={ENTITY_ACTIVATION_ROUTE} replace />;
    }
    return <Navigate to="/app/ayarlar/sirket-ayarlari" replace />;
  }

  return children;
}
